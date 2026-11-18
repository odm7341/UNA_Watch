import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { parseDailyHealth, dailyHealthPayload, putDailyHealth, listDailyHealth, markDailyHealthShared } from "../src/daily-health.js";

const data = () => ({ hrPerMinute: Array(1440).fill(0) });
test("daily heart rate uses historical timezone offsets, leaves missing/invalid minutes empty", async () => {
  const d = data();
  d.hrPerMinute[0] = 61;
  d.hrPerMinute[1] = 301;
  d.hrPerMinute[2] = "62";
  d.hrPerMinute[3] = 63;
  const day = await parseDailyHealth("dh_20261017.json", d, "America/New_York", Date.UTC(2027, 0));
  assert.deepEqual(day.samples, [
    { time: Date.parse("2026-10-17T04:00:00Z"), bpm: 61 },
    { time: Date.parse("2026-10-17T04:03:00Z"), bpm: 63 },
  ]);
  await assert.rejects(parseDailyHealth("dh_20260230.json", d, "UTC"), /Invalid/);
  await assert.rejects(parseDailyHealth("dh_20000309.json", d, "UTC"), /Invalid/);
});
test("DST ambiguous and nonexistent minute buckets are omitted", async () => {
  const d = data(); d.hrPerMinute.fill(60);
  const fall = await parseDailyHealth("dh_20261101.json", d, "America/New_York", Date.UTC(2027, 0));
  assert.equal(fall.samples.length, 1380);
  assert.equal(fall.ambiguous, 60);
  assert.equal(fall.samples[60].time, Date.parse("2026-11-01T07:00:00Z"));
  const spring = await parseDailyHealth("dh_20260308.json", d, "America/New_York", Date.UTC(2027, 0));
  assert.equal(spring.samples.length, 1380);
});
test("daily reimports preserve receipts, changed days update in place, shared FIT intervals are excluded", async () => {
  const d = data(); d.hrPerMinute[0] = 60; d.hrPerMinute[1] = 61; d.hrPerMinute[2] = 62;
  const day = await parseDailyHealth("dh_20261117.json", d, "America/New_York");
  assert.equal(await putDailyHealth(day), "imported");
  const payload = await dailyHealthPayload(day, [{ healthSharedVersion: 1,
    summary: { startTime: "2026-11-17T05:01:00Z", endTime: "2026-11-17T05:02:00Z" } }]);
  assert.equal(payload.kind, "heart-rate");
  assert.equal(payload.heartRate.length, 2);
  assert.equal(payload.excluded, 1);
  await markDailyHealthShared(day.id, payload);
  assert.equal(await putDailyHealth(day), "duplicate");
  assert.equal((await listDailyHealth())[0].sharedSignature, payload.signature);
  d.hrPerMinute[3] = 63;
  const changed = await parseDailyHealth("dh_20261117.json", d, "America/New_York");
  assert.equal(changed.id, day.id);
  assert.equal(await putDailyHealth(changed), "updated");
  assert.equal((await listDailyHealth()).length, 1);
  assert.notEqual((await dailyHealthPayload(changed, [])).signature, payload.signature);
});

test("resting HR remains exportable when all minute readings overlap FITs; summary changes trigger updates", async () => {
  const d = data();
  d.hrPerMinute[720] = 71;
  d.restingHeartRate = 46;
  d.averageHeartRate = 68;
  const day = await parseDailyHealth("dh_20261116.json", d, "America/New_York");
  const covered = [{ healthSharedVersion: 1, summary: {
    startTime: "2026-11-16T00:00:00Z", endTime: "2026-11-17T00:00:00Z",
  } }];
  const payload = await dailyHealthPayload(day, covered);
  assert.deepEqual(payload.heartRate, []);
  assert.equal(payload.restingHeartRate, 46);
  assert.equal(payload.restingHeartRateTime, Date.parse("2026-11-16T17:00:00Z"));
  assert.equal(day.averageHeartRate, 68);
  assert.equal(payload.averageHeartRate, undefined); // No fake instantaneous average-HR reading.
  d.restingHeartRate = 47;
  const updated = await parseDailyHealth("dh_20261116.json", d, "America/New_York");
  assert.equal(updated.id, day.id);
  assert.notEqual(updated.fingerprint, day.fingerprint);
  assert.notEqual((await dailyHealthPayload(updated, covered)).signature, payload.signature);
  for (const invalid of [0, -1, 301, "45", null]) {
    d.restingHeartRate = invalid;
    const missing = await parseDailyHealth("dh_20261116.json", d, "America/New_York");
    assert.equal((await dailyHealthPayload(missing, [])).restingHeartRate, null);
  }
});
