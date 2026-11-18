// UNA DailyHealth files contain local-wall-clock minute buckets, not raw sensor events.
// Keep these separate from FIT activities: they must never create exercise sessions.
async function digest(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
}
const validBpm = value => Number.isInteger(value) && value > 0 && value <= 300 ? value : null;

export async function parseDailyHealth(filename, data, timeZone, now = Date.now()) {
  const match = /^dh_(\d{4})(\d{2})(\d{2})\.json$/.exec(filename);
  if (!match || !Array.isArray(data.hrPerMinute) || data.hrPerMinute.length !== 1440)
    throw new Error("Expected dh_YYYYMMDD.json with 1440 heart-rate minute buckets");
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date
      || +match[1] < 2020 || midnight > now + 86_400_000)
    throw new Error(`Invalid daily-health date: ${date}`);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const wallTime = instant => {
    const p = Object.fromEntries(formatter.formatToParts(instant).map(v => [v.type, v.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  };
  // Collect both offsets across a DST boundary. Ambiguous/missing local minutes
  // cannot be recovered from this format, so omit them rather than guess.
  const offsets = new Set([-36, -12, 12, 36].map(h => {
    const t = midnight + h * 3_600_000;
    return wallTime(t) - t;
  }));
  const samples = [];
  let ambiguous = 0;
  for (let minute = 0; minute < 1440; minute++) {
    const bpm = data.hrPerMinute[minute];
    if (!Number.isInteger(bpm) || bpm <= 0 || bpm > 300) continue;
    const wall = midnight + minute * 60_000;
    const candidates = [...offsets].map(offset => wall - offset).filter(t => wallTime(t) === wall);
    if (candidates.length !== 1) { ambiguous++; continue; }
    if (candidates[0] >= now) continue;
    samples.push({ time: candidates[0], bpm });
  }
  if (!samples.length) throw new Error(`${filename}: no valid past heart-rate samples`);
  const restingHeartRate = validBpm(data.restingHeartRate);
  const averageHeartRate = validBpm(data.averageHeartRate);
  return {
    id: await digest(`una-daily-heart:${date}`), date, filename, timeZone,
    samples, ambiguous, restingHeartRate, averageHeartRate,
    fingerprint: await digest(JSON.stringify({ timeZone, samples, restingHeartRate, averageHeartRate })),
  };
}

export async function dailyHealthPayload(day, activities) {
  const intervals = activities.filter(a => a.healthSharedVersion > 0)
    .map(a => [Date.parse(a.summary.startTime), Date.parse(a.summary.endTime)]);
  const heartRate = day.samples.filter(s => !intervals.some(([start, end]) => s.time >= start && s.time < end));
  const restingHeartRate = validBpm(day.restingHeartRate);
  // Timestamp the daily summary at its last recorded minute, not an invented
  // resting measurement. Health Connect represents resting HR as a point record.
  const restingHeartRateTime = restingHeartRate ? day.samples.at(-1).time : null;
  const signature = await digest(JSON.stringify({ heartRate, restingHeartRate, restingHeartRateTime, timeZone: day.timeZone }));
  return {
    type: "health", kind: "heart-rate", id: day.id,
    version: Math.max(Date.now(), (day.sharedVersion || 0) + 1),
    start: day.samples[0].time, end: day.samples.at(-1).time + 1,
    heartRate, restingHeartRate, restingHeartRateTime, timeZone: day.timeZone,
    signature, excluded: day.samples.length - heartRate.length,
  };
}

async function transaction(mode, action) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("una-daily-health", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("days", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("days", mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Daily health storage aborted"));
      action(tx.objectStore("days"), value => { result = value; });
    });
  } finally { db.close(); }
}

export const listDailyHealth = () => transaction("readonly", (store, done) => {
  store.getAll().onsuccess = e => done(e.target.result.sort((a, b) => a.date.localeCompare(b.date)));
});
export const putDailyHealth = day => transaction("readwrite", (store, done) => {
  store.get(day.id).onsuccess = e => {
    const old = e.target.result;
    if (old?.fingerprint === day.fingerprint) { done("duplicate"); return; }
    store.put({ ...day, sharedVersion: old?.sharedVersion, sharedSignature: old?.sharedSignature,
      sharedSamples: old?.sharedSamples, sharedRestingHeartRate: old?.sharedRestingHeartRate, sharedAt: old?.sharedAt });
    done(old ? "updated" : "imported");
  };
});
export const markDailyHealthShared = (id, payload) => transaction("readwrite", store => {
  store.get(id).onsuccess = e => {
    if (e.target.result) store.put({ ...e.target.result, sharedVersion: payload.version,
      sharedSignature: payload.signature, sharedSamples: payload.heartRate.length,
      sharedRestingHeartRate: payload.restingHeartRate ?? null,
      sharedAt: new Date().toISOString() });
  };
});
