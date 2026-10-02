import assert from "node:assert/strict";
import test from "node:test";

import { FitBaseType, FitEncoder } from "fit-file-parser";

import {
  buildDashboard,
  compareActivities,
  filterActivities,
  formatDistance,
  formatDuration,
  previousComparable,
} from "../src/analytics.js";
import { compactActivity, hashFitBytes, parseFitActivity } from "../src/fit.js";
import {
  FTS,
  crc32,
  makeDigest,
  makeListDir,
  makeRead,
  makeReadPacing,
  parseDigestStatus,
  parseListDirEntry,
  parseReadData,
} from "../src/protocol.js";
import { makeMultisportFit, makeSleepFit, makeWorkoutFit } from "../test-support/fit-fixtures.js";

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function metadata(activity) {
  const { bytes, records, ...record } = activity;
  return record;
}

test("FTS command packets match the UNA little-endian wire format", () => {
  assert.equal(hex(makeListDir("/A")), "500002002f41");
  assert.equal(hex(makeDigest("/A")), "700002002f41");
  assert.equal(hex(makeRead("/A", 0x01020304, 4096)), "1000020004030201001000002f41");
  assert.equal(hex(makeReadPacing(0x01020304, 4096)), "120100000403020100100000");
});

test("FTS response parsers decode directory, read, and digest responses", () => {
  const entry = new Uint8Array(32);
  const entryView = new DataView(entry.buffer);
  entry[0] = FTS.command.listDirEntry;
  entry[1] = FTS.status.ok;
  entryView.setUint16(2, 4, true);
  entryView.setUint32(4, 0, true);
  entryView.setUint32(8, 1, true);
  entryView.setUint32(12, 0, true);
  entryView.setBigUint64(16, 123456789n, true);
  entryView.setUint32(24, 4321, true);
  entry.set(new TextEncoder().encode("x.bin".slice(0, 4)), 28);
  assert.deepEqual(parseListDirEntry(entry), {
    kind: "entry",
    name: "x.bi",
    isDirectory: false,
    modificationTimeNs: 123456789n,
    fileSize: 4321,
  });

  const terminator = new Uint8Array(28);
  const terminatorView = new DataView(terminator.buffer);
  terminator[0] = FTS.command.listDirEntry;
  terminator[1] = FTS.status.ok;
  terminatorView.setUint32(4, 1, true);
  terminatorView.setUint32(8, 1, true);
  assert.deepEqual(parseListDirEntry(terminator), { kind: "done" });

  const read = new Uint8Array(19);
  const readView = new DataView(read.buffer);
  read[0] = FTS.command.readData;
  read[1] = FTS.status.ok;
  readView.setUint32(4, 20, true);
  readView.setUint32(8, 100, true);
  readView.setUint32(12, 3, true);
  read.set([7, 8, 9], 16);
  assert.deepEqual(parseReadData(read), {
    status: FTS.status.ok,
    offset: 20,
    totalLength: 100,
    data: new Uint8Array([7, 8, 9]),
  });

  const digest = new Uint8Array(12);
  const digestView = new DataView(digest.buffer);
  digest[0] = FTS.command.digestStatus;
  digest[1] = FTS.status.ok;
  digestView.setUint32(4, 4321, true);
  digestView.setUint32(8, 0x12345678, true);
  assert.deepEqual(parseDigestStatus(digest), {
    status: FTS.status.ok,
    fileSize: 4321,
    crc32: 0x12345678,
  });
});

test("CRC-32 matches the standard zlib vector", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("SleepVue developer data classifies sleep and preserves three-stage durations", async () => {
  const bytes = makeSleepFit();
  const activity = await parseFitActivity({ bytes, filename: "synthetic-sleep.fit" });
  assert.equal(activity.kind, "sleep");
  assert.equal(activity.summary.sport, "sleep");
  assert.equal(activity.summary.recordCount, 3);
  assert.deepEqual(activity.records.map((record) => record.sleepStage), [1, 2, 0]);
  assert.deepEqual({
    totalSeconds: activity.summary.sleep.totalSeconds,
    awakeSeconds: activity.summary.sleep.awakeSeconds,
    lightSeconds: activity.summary.sleep.lightSeconds,
    deepSeconds: activity.summary.sleep.deepSeconds,
  }, { totalSeconds: 90, awakeSeconds: 30, lightSeconds: 30, deepSeconds: 30 });
  for (const stage of ["awakePercent", "lightPercent", "deepPercent"]) {
    assert.ok(Math.abs(activity.summary.sleep[stage] - 100 / 3) < 1e-10);
  }
  assert.equal(activity.summary.averageHeartRate, 59);
  assert.equal(activity.features.sleep, true);
  assert.equal(activity.features.route, false);
});

test("generic recorded activity normalizes route and workout summaries", async () => {
  const activity = await parseFitActivity({ bytes: makeWorkoutFit(), filename: "synthetic-run.fit" });
  assert.equal(activity.kind, "workout");
  assert.equal(activity.summary.sport, "running");
  assert.equal(activity.summary.subSport, "street");
  assert.equal(activity.summary.distanceMeters, 1000);
  assert.equal(activity.summary.timerSeconds, 120);
  assert.equal(activity.summary.averageHeartRate, 130);
  assert.equal(activity.summary.averagePowerWatts, 200);
  assert.equal(activity.features.route, true);
  assert.equal(activity.features.sleep, false);
  assert.ok(Math.abs(activity.records[0].latitude - 0.01) < 0.0001);
  assert.equal(compactActivity(activity).bytes.byteLength, makeWorkoutFit().byteLength);
});

test("multisport files stay one activity with preserved session segments", async () => {
  const activity = await parseFitActivity({ bytes: makeMultisportFit(), filename: "synthetic-multisport.fit" });
  assert.equal(activity.summary.sport, "multisport");
  assert.equal(activity.summary.sessionCount, 2);
  assert.equal(activity.summary.timerSeconds, 1800);
  assert.equal(activity.summary.distanceMeters, 10_000);
  assert.deepEqual(activity.sessions.map((session) => session.sport), ["running", "cycling"]);
});

test("strict parsing rejects corrupted and non-activity FIT files", async () => {
  const corrupted = makeWorkoutFit();
  corrupted[corrupted.length - 1] ^= 0xff;
  await assert.rejects(parseFitActivity({ bytes: corrupted, filename: "broken.fit" }), /invalid FIT data/i);

  const encoder = new FitEncoder();
  encoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 5 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date("2026-01-01T00:00:00Z")) },
  ]);
  await assert.rejects(parseFitActivity({ bytes: encoder.close(), filename: "plan.fit" }), /unsupported FIT file type/i);
});

test("SHA-256 identity is content-based rather than filename-based", async () => {
  const bytes = makeWorkoutFit();
  const [left, right] = await Promise.all([hashFitBytes(bytes), hashFitBytes(bytes.slice())]);
  const changed = bytes.slice();
  changed[20] ^= 1;
  assert.equal(left, right);
  assert.notEqual(left, await hashFitBytes(changed));
});

test("dashboard analytics separate workouts and sleep and honor filters", async () => {
  const sleep = metadata(await parseFitActivity({ bytes: makeSleepFit(), filename: "sleep.fit" }));
  const workout = metadata(await parseFitActivity({ bytes: makeWorkoutFit(), filename: "run.fit" }));
  const multisport = metadata(await parseFitActivity({ bytes: makeMultisportFit(), filename: "multi.fit" }));
  const activities = [sleep, workout, multisport];
  const dashboard = buildDashboard(activities, { range: "30d", kind: "all", sport: "all" }, new Date("2026-01-31T00:00:00Z"));
  assert.equal(dashboard.workouts.count, 2);
  assert.equal(dashboard.workouts.totalDistanceMeters, 11_000);
  assert.equal(dashboard.sleep.count, 1);
  assert.equal(dashboard.sleep.averageDurationSeconds, 90);
  assert.equal(filterActivities(activities, { range: "all", kind: "sleep", sport: "all" }).length, 1);
  assert.equal(filterActivities(activities, { range: "all", kind: "all", sport: "running" }).length, 1);
});

test("activity comparison uses the immediately previous same-sport record", async () => {
  const previous = metadata(await parseFitActivity({ bytes: makeWorkoutFit(), filename: "previous.fit" }));
  const current = structuredClone(previous);
  current.id = "newer";
  current.summary.startTime = "2026-01-05T08:00:00.000Z";
  current.summary.distanceMeters = 1200;
  current.summary.timerSeconds = 110;
  const selected = previousComparable(current, [previous]);
  assert.equal(selected.id, previous.id);
  const comparisons = compareActivities(current, selected);
  assert.deepEqual(comparisons.find((item) => item.label === "Distance"), { label: "Distance", value: 200, format: "distance" });
  assert.deepEqual(comparisons.find((item) => item.label === "Duration"), { label: "Duration", value: -10, format: "duration" });
});

test("unit formatters preserve signed comparisons and human duration", () => {
  assert.equal(formatDuration(3723), "1h 2m");
  assert.equal(formatDuration(-10, { sign: true }), "−10s");
  assert.equal(formatDistance(1609.344, "statute"), "1.00 mi");
  assert.equal(formatDistance(1000, "metric", { sign: true }), "+1.00 km");
});
