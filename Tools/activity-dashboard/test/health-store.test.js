import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { healthPayload } from "../src/health.js";
import { compactActivity, parseFitActivity } from "../src/fit.js";
import { getActivity, listActivities, putActivity, changeWorkoutType, markHealthShared } from "../src/store.js";
import { applyEdits, needsHealthShare } from "../src/activity-edits.js";
import { makeWorkoutFit, makeSleepFit } from "../test-support/fit-fixtures.js";

test("concurrent reimports and renamed FITs retain exactly one workout and original bytes", async () => {
  const bytes = makeWorkoutFit();
  const first = compactActivity(await parseFitActivity({ bytes, filename: "original.fit" }));
  const renamed = compactActivity(await parseFitActivity({ bytes, filename: "download-again.fit" }));
  const results = await Promise.all([putActivity(first), putActivity(renamed), putActivity(first)]);
  assert.deepEqual(results.map(r => r.status).sort(), ["duplicate", "duplicate", "imported"]);
  assert.equal((await listActivities()).length, 1);
  assert.deepEqual(new Uint8Array((await getActivity(first.id)).bytes), new Uint8Array(bytes));
  assert.equal((await putActivity(renamed)).status, "duplicate");
});

test("health export preserves workout identity and measured data", async () => {
  const activity = await parseFitActivity({ bytes: makeWorkoutFit(), filename: "run.fit" });
  const payload = healthPayload(activity);
  assert.equal(payload.id, activity.id);
  assert.equal(payload.kind, "workout");
  assert.equal(payload.distanceMeters, activity.summary.distanceMeters);
  assert.equal(payload.start, Date.parse(activity.summary.startTime));
  assert.ok(payload.heartRate.length > 0);
  assert.deepEqual(payload.stages, []);
});

test("rowing corrections survive reload and reimport, and stale export acknowledgments stay pending", async () => {
  const original = await parseFitActivity({ bytes: makeWorkoutFit(), filename: "hike.fit" });
  await putActivity(compactActivity(original));
  await markHealthShared(original.id, 1);
  assert.equal(needsHealthShare(await getActivity(original.id)), false);
  await changeWorkoutType(original.id, "indoor_rowing");
  const stored = await getActivity(original.id);
  assert.equal(stored.summary.sport, "rowing");
  assert.equal(stored.summary.subSport, "indoor_rowing");
  assert.equal(needsHealthShare(stored), true);
  const reloaded = applyEdits(await parseFitActivity(stored), stored);
  assert.equal(healthPayload(reloaded).sport, "rowing");
  assert.equal(healthPayload(reloaded).subSport, "indoor_rowing");
  assert.equal(healthPayload(reloaded).id, original.id);
  await markHealthShared(original.id, 1); // Older in-flight export finished after editing.
  assert.equal(needsHealthShare(await getActivity(original.id)), true);
  await markHealthShared(original.id, stored.healthVersion);
  assert.equal(needsHealthShare(await getActivity(original.id)), false);
  await putActivity(compactActivity(original));
  assert.equal((await getActivity(original.id)).typeOverride, "indoor_rowing");
  assert.deepEqual((await getActivity(original.id)).bytes, stored.bytes);
});

test("sleep export contains only recorded stages, no fabricated REM or long gaps", async () => {
  const activity = await parseFitActivity({ bytes: makeSleepFit(), filename: "sleep.fit" });
  const payload = healthPayload(activity);
  assert.equal(payload.kind, "sleep");
  assert.ok(payload.stages.length > 0);
  assert.ok(payload.stages.every(s => [0, 1, 2].includes(s.stage) && s.end > s.start));
  const start = Date.parse("2026-11-01T00:00:00Z");
  const gap = healthPayload({
    id: "test", kind: "sleep",
    summary: { startTime: new Date(start).toISOString(), endTime: new Date(start + 600_000).toISOString() },
    records: [{ timestamp: new Date(start).toISOString(), sleepStage: 1 },
      { timestamp: new Date(start + 540_000).toISOString(), sleepStage: 2 }],
  });
  assert.deepEqual(gap.stages, [
    { start, end: start + 60_000, stage: 1 },
    { start: start + 540_000, end: start + 600_000, stage: 2 },
  ]);
  assert.throws(() => healthPayload({ summary: { startTime: null, endTime: null } }), /interval/);
});
