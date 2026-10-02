import FitParser from "fit-file-parser";

const SLEEP_APP_ID = "SleepVue";
const SLEEP_FIELD = "sleep_stage";
const SLEEP_STAGE_NAMES = Object.freeze(["awake", "light", "deep"]);
const SUPPORTED_ACTIVITY_TYPES = new Set(["activity"]);

export class FitImportError extends Error {
  constructor(filename, message, options = {}) {
    super(`${filename || "FIT file"}: ${message}`, options);
    this.name = "FitImportError";
    this.filename = filename || "FIT file";
  }
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("FIT input must be an ArrayBuffer or typed array");
}

function storedBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function timestamp(value) {
  return asDate(value)?.toISOString() ?? null;
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined) ?? null;
}

function sumPresent(values) {
  const present = values.filter((value) => finite(value) !== null);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function maxPresent(values) {
  const present = values.filter((value) => finite(value) !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

function weightedAverage(items, valueKey, weightKey = "timerSeconds") {
  let weighted = 0;
  let weight = 0;
  for (const item of items) {
    const value = finite(item[valueKey]);
    const itemWeight = positive(item[weightKey]);
    if (value === null || itemWeight === null || itemWeight === 0) continue;
    weighted += value * itemWeight;
    weight += itemWeight;
  }
  if (weight > 0) return weighted / weight;
  const values = items.map((item) => finite(item[valueKey])).filter((value) => value !== null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function normalizeSport(value, fallback = "generic") {
  if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  if (typeof value === "number") return String(value);
  return fallback;
}

function normalizeSession(session, index) {
  const startTime = timestamp(session.start_time);
  const endTime = timestamp(session.timestamp);
  return {
    index,
    startTime,
    endTime,
    elapsedSeconds: positive(session.total_elapsed_time),
    timerSeconds: positive(session.total_timer_time),
    sport: normalizeSport(session.sport),
    subSport: normalizeSport(session.sub_sport),
    distanceMeters: positive(session.total_distance),
    calories: positive(session.total_calories),
    ascentMeters: positive(session.total_ascent),
    descentMeters: positive(session.total_descent),
    averageHeartRate: positive(session.avg_heart_rate),
    maxHeartRate: positive(session.max_heart_rate),
    averageSpeedMps: firstPresent(positive(session.enhanced_avg_speed), positive(session.avg_speed)),
    maxSpeedMps: firstPresent(positive(session.enhanced_max_speed), positive(session.max_speed)),
    averageCadence: positive(session.avg_cadence),
    maxCadence: positive(session.max_cadence),
    averagePowerWatts: positive(session.avg_power),
    maxPowerWatts: positive(session.max_power),
    lapCount: positive(session.num_laps),
  };
}

function normalizeLap(lap, index) {
  return {
    index,
    startTime: timestamp(lap.start_time),
    endTime: timestamp(lap.timestamp),
    elapsedSeconds: positive(lap.total_elapsed_time),
    timerSeconds: positive(lap.total_timer_time),
    distanceMeters: positive(lap.total_distance),
    calories: positive(lap.total_calories),
    ascentMeters: positive(lap.total_ascent),
    descentMeters: positive(lap.total_descent),
    averageHeartRate: positive(lap.avg_heart_rate),
    maxHeartRate: positive(lap.max_heart_rate),
    averageSpeedMps: firstPresent(positive(lap.enhanced_avg_speed), positive(lap.avg_speed)),
    maxSpeedMps: firstPresent(positive(lap.enhanced_max_speed), positive(lap.max_speed)),
    averageCadence: positive(lap.avg_cadence),
    maxCadence: positive(lap.max_cadence),
    averagePowerWatts: positive(lap.avg_power),
    maxPowerWatts: positive(lap.max_power),
  };
}

function normalizeRecord(record, sleepEnabled) {
  const recordTimestamp = timestamp(record.timestamp);
  if (!recordTimestamp) return null;
  const latitude = finite(record.position_lat);
  const longitude = finite(record.position_long);
  const sleepStage = sleepEnabled && Number.isInteger(record[SLEEP_FIELD]) && record[SLEEP_FIELD] >= 0 && record[SLEEP_FIELD] <= 2
    ? record[SLEEP_FIELD]
    : null;
  return {
    timestamp: recordTimestamp,
    elapsedSeconds: positive(record.elapsed_time),
    timerSeconds: positive(record.timer_time),
    latitude,
    longitude,
    distanceMeters: positive(record.distance),
    altitudeMeters: firstPresent(finite(record.enhanced_altitude), finite(record.altitude)),
    speedMps: firstPresent(positive(record.enhanced_speed), positive(record.speed)),
    heartRate: positive(record.heart_rate),
    cadence: positive(record.cadence),
    powerWatts: positive(record.power),
    temperatureCelsius: finite(record.temperature),
    sleepStage,
  };
}

function decodeApplicationId(applicationId) {
  if (!Array.isArray(applicationId) && !(applicationId instanceof Uint8Array)) return "";
  const bytes = Array.from(applicationId);
  const end = bytes.indexOf(0);
  const textBytes = end === -1 ? bytes : bytes.slice(0, end);
  return new TextDecoder().decode(Uint8Array.from(textBytes));
}

function hasSleepVueContract(parsed) {
  const indices = new Set(
    (parsed.developer_data_ids ?? [])
      .filter((item) => decodeApplicationId(item.application_id).startsWith(SLEEP_APP_ID))
      .map((item) => item.developer_data_index),
  );
  return (parsed.field_descriptions ?? []).some((field) =>
    indices.has(field.developer_data_index) && field.field_name === SLEEP_FIELD,
  );
}

function deriveRecordDistance(records) {
  const distances = records.map((record) => record.distanceMeters).filter((value) => value !== null);
  if (distances.length < 2) return null;
  return Math.max(0, distances.at(-1) - distances[0]);
}

function deriveRecordAverage(records, key) {
  const values = records.map((record) => record[key]).filter((value) => value !== null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sleepSummary(records) {
  const totals = [0, 0, 0];
  const staged = records.filter((record) => record.sleepStage !== null);
  if (staged.length === 0) return null;
  for (let index = 0; index < staged.length; index += 1) {
    const current = new Date(staged[index].timestamp).getTime();
    const next = index + 1 < staged.length ? new Date(staged[index + 1].timestamp).getTime() : null;
    const previous = index > 0 ? new Date(staged[index - 1].timestamp).getTime() : null;
    const duration = next !== null ? (next - current) / 1000 : previous !== null ? (current - previous) / 1000 : 30;
    if (duration > 0 && Number.isFinite(duration)) totals[staged[index].sleepStage] += duration;
  }
  const totalSeconds = totals.reduce((sum, value) => sum + value, 0);
  const percentages = totals.map((value) => totalSeconds > 0 ? (value / totalSeconds) * 100 : 0);
  return {
    totalSeconds,
    awakeSeconds: totals[0],
    lightSeconds: totals[1],
    deepSeconds: totals[2],
    awakePercent: percentages[0],
    lightPercent: percentages[1],
    deepPercent: percentages[2],
  };
}

function activityBounds(parsed, sessions, records) {
  const startCandidates = [
    ...sessions.map((session) => asDate(session.startTime)?.getTime()),
    ...records.slice(0, 1).map((record) => asDate(record.timestamp)?.getTime()),
    ...(parsed.file_ids ?? []).map((file) => asDate(file.time_created)?.getTime()),
  ].filter(Number.isFinite);
  const endCandidates = [
    ...sessions.map((session) => asDate(session.endTime)?.getTime()),
    asDate(parsed.activity?.timestamp)?.getTime(),
    ...records.slice(-1).map((record) => asDate(record.timestamp)?.getTime()),
  ].filter(Number.isFinite);
  return {
    startTime: startCandidates.length > 0 ? new Date(Math.min(...startCandidates)).toISOString() : null,
    endTime: endCandidates.length > 0 ? new Date(Math.max(...endCandidates)).toISOString() : null,
  };
}

export async function hashFitBytes(input) {
  const bytes = asBytes(input);
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable in this browser");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseFitActivity({ bytes: input, filename = "activity.fit", source = { kind: "manual" }, importedAt = new Date().toISOString() }) {
  const bytes = asBytes(input);
  if (bytes.byteLength === 0) throw new FitImportError(filename, "file is empty");

  let parsed;
  try {
    parsed = await new FitParser({
      force: false,
      mode: "list",
      lengthUnit: "m",
      speedUnit: "m/s",
      elapsedRecordField: true,
    }).parseAsync(storedBuffer(bytes));
  } catch (error) {
    throw new FitImportError(filename, `invalid FIT data (${String(error)})`, { cause: error });
  }

  const fileTypes = (parsed.file_ids ?? []).map((file) => file.type).filter((value) => value !== undefined);
  if (fileTypes.length > 0 && !fileTypes.some((type) => SUPPORTED_ACTIVITY_TYPES.has(type))) {
    throw new FitImportError(filename, `unsupported FIT file type “${fileTypes[0]}”; expected a completed activity`);
  }

  const rawSessions = parsed.sessions ?? [];
  const rawRecords = parsed.records ?? [];
  if (rawSessions.length === 0 && rawRecords.length === 0) {
    throw new FitImportError(filename, "contains no recorded activity sessions or samples");
  }

  const sleepContract = hasSleepVueContract(parsed);
  const sessions = rawSessions.map(normalizeSession);
  const laps = (parsed.laps ?? []).map(normalizeLap);
  const records = rawRecords
    .map((record) => normalizeRecord(record, sleepContract))
    .filter(Boolean)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const sleep = sleepContract ? sleepSummary(records) : null;
  const kind = sleep ? "sleep" : "workout";
  const sports = [...new Set(sessions.map((session) => session.sport).filter(Boolean))];
  const sport = kind === "sleep" ? "sleep" : sports.length > 1 ? "multisport" : sports[0] ?? "generic";
  const subSports = [...new Set(sessions.map((session) => session.subSport).filter(Boolean))];
  const subSport = subSports.length > 1 ? "multisport" : subSports[0] ?? "generic";
  const bounds = activityBounds(parsed, sessions, records);
  const elapsedSeconds = firstPresent(
    sumPresent(sessions.map((session) => session.elapsedSeconds)),
    bounds.startTime && bounds.endTime ? (new Date(bounds.endTime) - new Date(bounds.startTime)) / 1000 : null,
  );
  const timerSeconds = firstPresent(
    sumPresent(sessions.map((session) => session.timerSeconds)),
    positive(parsed.activity?.total_timer_time),
    elapsedSeconds,
  );
  const distanceMeters = firstPresent(sumPresent(sessions.map((session) => session.distanceMeters)), deriveRecordDistance(records));
  const averageSpeedMps = firstPresent(weightedAverage(sessions, "averageSpeedMps"), distanceMeters !== null && timerSeconds > 0 ? distanceMeters / timerSeconds : null, deriveRecordAverage(records, "speedMps"));

  const summary = {
    startTime: bounds.startTime,
    endTime: bounds.endTime,
    elapsedSeconds,
    timerSeconds,
    sport,
    subSport,
    distanceMeters,
    calories: sumPresent(sessions.map((session) => session.calories)),
    ascentMeters: sumPresent(sessions.map((session) => session.ascentMeters)),
    descentMeters: sumPresent(sessions.map((session) => session.descentMeters)),
    averageHeartRate: firstPresent(weightedAverage(sessions, "averageHeartRate"), deriveRecordAverage(records, "heartRate")),
    maxHeartRate: firstPresent(maxPresent(sessions.map((session) => session.maxHeartRate)), maxPresent(records.map((record) => record.heartRate))),
    averageSpeedMps,
    maxSpeedMps: firstPresent(maxPresent(sessions.map((session) => session.maxSpeedMps)), maxPresent(records.map((record) => record.speedMps))),
    averageCadence: firstPresent(weightedAverage(sessions, "averageCadence"), deriveRecordAverage(records, "cadence")),
    maxCadence: firstPresent(maxPresent(sessions.map((session) => session.maxCadence)), maxPresent(records.map((record) => record.cadence))),
    averagePowerWatts: firstPresent(weightedAverage(sessions, "averagePowerWatts"), deriveRecordAverage(records, "powerWatts")),
    maxPowerWatts: firstPresent(maxPresent(sessions.map((session) => session.maxPowerWatts)), maxPresent(records.map((record) => record.powerWatts))),
    recordCount: records.length,
    sessionCount: sessions.length,
    lapCount: laps.length,
    sleep,
  };

  const features = {
    route: records.some((record) => record.latitude !== null && record.longitude !== null),
    heartRate: records.some((record) => record.heartRate !== null) || summary.averageHeartRate !== null,
    speed: records.some((record) => record.speedMps !== null) || summary.averageSpeedMps !== null,
    elevation: records.some((record) => record.altitudeMeters !== null) || summary.ascentMeters !== null,
    cadence: records.some((record) => record.cadence !== null) || summary.averageCadence !== null,
    power: records.some((record) => record.powerWatts !== null) || summary.averagePowerWatts !== null,
    sleep: sleep !== null,
  };

  return {
    id: await hashFitBytes(bytes),
    filename,
    bytes,
    size: bytes.byteLength,
    importedAt,
    source: { kind: source.kind ?? "manual", ...source },
    kind,
    summary,
    sessions,
    laps,
    records,
    features,
  };
}

export function compactActivity(activity) {
  return {
    id: activity.id,
    filename: activity.filename,
    bytes: storedBuffer(activity.bytes),
    size: activity.size,
    importedAt: activity.importedAt,
    source: activity.source,
    kind: activity.kind,
    startTime: activity.summary.startTime,
    sport: activity.summary.sport,
    summary: activity.summary,
    sessions: activity.sessions,
    laps: activity.laps,
    features: activity.features,
  };
}

export { SLEEP_STAGE_NAMES };
