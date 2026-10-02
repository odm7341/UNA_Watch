const DAY_MS = 86_400_000;
const RANGE_DAYS = Object.freeze({ "7d": 7, "30d": 30, "90d": 90, "1y": 365 });
const PACE_SPORTS = new Set(["running", "walking", "hiking"]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sum(items, selector) {
  const values = items.map(selector).filter((value) => finite(value) !== null);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

function average(items, selector) {
  const values = items.map(selector).filter((value) => finite(value) !== null);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function dateValue(activity) {
  const value = Date.parse(activity.summary?.startTime ?? activity.startTime ?? "");
  return Number.isFinite(value) ? value : null;
}

function mondayKey(value) {
  const date = new Date(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function titleCase(value) {
  return String(value ?? "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function filterActivities(activities, filters = {}, now = new Date()) {
  const range = filters.range ?? "30d";
  const kind = filters.kind ?? "all";
  const sport = filters.sport ?? "all";
  const days = RANGE_DAYS[range] ?? null;
  const lowerBound = days === null ? null : now.getTime() - days * DAY_MS;
  return activities.filter((activity) => {
    const start = dateValue(activity);
    if (lowerBound !== null && (start === null || start < lowerBound || start > now.getTime())) return false;
    if (kind !== "all" && activity.kind !== kind) return false;
    if (sport !== "all" && activity.summary?.sport !== sport) return false;
    return true;
  });
}

export function workoutAnalytics(activities) {
  const workouts = activities.filter((activity) => activity.kind === "workout");
  const weeklyMap = new Map();
  const sportMap = new Map();
  const highsMap = new Map();

  for (const activity of workouts) {
    const summary = activity.summary;
    const start = dateValue(activity);
    const sport = summary.sport ?? "generic";
    if (start !== null) {
      const week = mondayKey(start);
      const bucket = weeklyMap.get(week) ?? { week, durationSeconds: 0, distanceMeters: 0, sports: {} };
      bucket.durationSeconds += finite(summary.timerSeconds) ?? 0;
      bucket.distanceMeters += finite(summary.distanceMeters) ?? 0;
      bucket.sports[sport] = (bucket.sports[sport] ?? 0) + (finite(summary.timerSeconds) ?? 0);
      weeklyMap.set(week, bucket);
    }

    const totals = sportMap.get(sport) ?? { sport, count: 0, durationSeconds: 0, distanceMeters: 0, calories: 0, ascentMeters: 0 };
    totals.count += 1;
    totals.durationSeconds += finite(summary.timerSeconds) ?? 0;
    totals.distanceMeters += finite(summary.distanceMeters) ?? 0;
    totals.calories += finite(summary.calories) ?? 0;
    totals.ascentMeters += finite(summary.ascentMeters) ?? 0;
    sportMap.set(sport, totals);

    const highs = highsMap.get(sport) ?? { sport, distanceMeters: null, durationSeconds: null, ascentMeters: null, averageSpeedMps: null };
    for (const [target, source] of [
      ["distanceMeters", "distanceMeters"],
      ["durationSeconds", "timerSeconds"],
      ["ascentMeters", "ascentMeters"],
      ["averageSpeedMps", "averageSpeedMps"],
    ]) {
      const value = finite(summary[source]);
      if (value !== null && (highs[target] === null || value > highs[target])) highs[target] = value;
    }
    highsMap.set(sport, highs);
  }

  return {
    count: workouts.length,
    totalTimerSeconds: sum(workouts, (activity) => activity.summary.timerSeconds),
    totalDistanceMeters: sum(workouts, (activity) => activity.summary.distanceMeters),
    totalCalories: sum(workouts, (activity) => activity.summary.calories),
    totalAscentMeters: sum(workouts, (activity) => activity.summary.ascentMeters),
    weekly: [...weeklyMap.values()].sort((left, right) => left.week.localeCompare(right.week)),
    heartRateTrend: workouts
      .filter((activity) => dateValue(activity) !== null && finite(activity.summary.averageHeartRate) !== null)
      .sort((left, right) => dateValue(left) - dateValue(right))
      .map((activity) => ({ date: activity.summary.startTime, value: activity.summary.averageHeartRate, sport: activity.summary.sport })),
    sportTotals: [...sportMap.values()].sort((left, right) => right.durationSeconds - left.durationSeconds),
    recordedHighs: [...highsMap.values()].sort((left, right) => left.sport.localeCompare(right.sport)),
  };
}

export function sleepAnalytics(activities) {
  const nights = activities.filter((activity) => activity.kind === "sleep" && activity.summary.sleep);
  return {
    count: nights.length,
    averageDurationSeconds: average(nights, (activity) => activity.summary.sleep.totalSeconds),
    averageHeartRate: average(nights, (activity) => activity.summary.averageHeartRate),
    awakePercent: average(nights, (activity) => activity.summary.sleep.awakePercent),
    lightPercent: average(nights, (activity) => activity.summary.sleep.lightPercent),
    deepPercent: average(nights, (activity) => activity.summary.sleep.deepPercent),
    trend: nights
      .filter((activity) => dateValue(activity) !== null)
      .sort((left, right) => dateValue(left) - dateValue(right))
      .map((activity) => ({
        date: activity.summary.startTime,
        durationSeconds: activity.summary.sleep.totalSeconds,
        averageHeartRate: activity.summary.averageHeartRate,
        awakePercent: activity.summary.sleep.awakePercent,
        lightPercent: activity.summary.sleep.lightPercent,
        deepPercent: activity.summary.sleep.deepPercent,
      })),
  };
}

export function buildDashboard(activities, filters = {}, now = new Date()) {
  const filtered = filterActivities(activities, filters, now);
  return {
    filtered,
    workouts: workoutAnalytics(filtered),
    sleep: sleepAnalytics(filtered),
  };
}

export function previousComparable(current, activities) {
  if (!current) return null;
  const currentTime = dateValue(current);
  if (currentTime === null) return null;
  return activities
    .filter((activity) => activity.id !== current.id
      && activity.kind === current.kind
      && activity.summary?.sport === current.summary?.sport
      && dateValue(activity) !== null
      && dateValue(activity) < currentTime)
    .sort((left, right) => dateValue(right) - dateValue(left))[0] ?? null;
}

export function compareActivities(current, previous) {
  if (!current || !previous) return [];
  const fields = current.kind === "sleep"
    ? [
      ["Duration", (activity) => activity.summary.sleep?.totalSeconds, "duration"],
      ["Awake", (activity) => activity.summary.sleep?.awakePercent, "percent"],
      ["Light", (activity) => activity.summary.sleep?.lightPercent, "percent"],
      ["Deep", (activity) => activity.summary.sleep?.deepPercent, "percent"],
      ["Average HR", (activity) => activity.summary.averageHeartRate, "heartRate"],
    ]
    : [
      ["Duration", (activity) => activity.summary.timerSeconds, "duration"],
      ["Distance", (activity) => activity.summary.distanceMeters, "distance"],
      ["Average speed", (activity) => activity.summary.averageSpeedMps, "speed"],
      ["Ascent", (activity) => activity.summary.ascentMeters, "elevation"],
      ["Calories", (activity) => activity.summary.calories, "number"],
      ["Average HR", (activity) => activity.summary.averageHeartRate, "heartRate"],
    ];
  return fields.flatMap(([label, getter, format]) => {
    const currentValue = finite(getter(current));
    const previousValue = finite(getter(previous));
    return currentValue === null || previousValue === null ? [] : [{ label, value: currentValue - previousValue, format }];
  });
}

export function sportLabel(value) {
  return titleCase(value);
}

export function formatDateTime(value, options = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: options.dateStyle ?? "medium",
    timeStyle: options.timeStyle ?? "short",
  }).format(date);
}

export function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function formatDuration(seconds, options = {}) {
  const value = finite(seconds);
  if (value === null) return "—";
  const sign = value < 0 ? "−" : options.sign && value > 0 ? "+" : "";
  const absolute = Math.abs(Math.round(value));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const remainder = absolute % 60;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  if (minutes > 0) return `${sign}${minutes}m ${remainder}s`;
  return `${sign}${remainder}s`;
}

export function formatDistance(meters, units = "metric", options = {}) {
  const value = finite(meters);
  if (value === null) return "—";
  const sign = value < 0 ? "−" : options.sign && value > 0 ? "+" : "";
  const absolute = Math.abs(value);
  if (units === "statute") return `${sign}${(absolute / 1609.344).toFixed(2)} mi`;
  if (absolute < 1000) return `${sign}${Math.round(absolute)} m`;
  return `${sign}${(absolute / 1000).toFixed(2)} km`;
}

export function formatElevation(meters, units = "metric", options = {}) {
  const value = finite(meters);
  if (value === null) return "—";
  const sign = value < 0 ? "−" : options.sign && value > 0 ? "+" : "";
  const absolute = Math.abs(value);
  return units === "statute" ? `${sign}${Math.round(absolute * 3.28084)} ft` : `${sign}${Math.round(absolute)} m`;
}

export function formatSpeed(speedMps, units = "metric", options = {}) {
  const value = finite(speedMps);
  if (value === null) return "—";
  const sign = value < 0 ? "−" : options.sign && value > 0 ? "+" : "";
  const absolute = Math.abs(value);
  const converted = units === "statute" ? absolute * 2.236936 : absolute * 3.6;
  return `${sign}${converted.toFixed(1)} ${units === "statute" ? "mph" : "km/h"}`;
}

export function formatPace(speedMps, units = "metric") {
  const value = finite(speedMps);
  if (value === null || value <= 0) return "—";
  const seconds = (units === "statute" ? 1609.344 : 1000) / value;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder} /${units === "statute" ? "mi" : "km"}`;
}

export function formatSpeedForSport(speedMps, sport, units = "metric") {
  return PACE_SPORTS.has(sport) ? formatPace(speedMps, units) : formatSpeed(speedMps, units);
}

export function formatNumber(value, suffix = "", options = {}) {
  const number = finite(value);
  if (number === null) return "—";
  const sign = number < 0 ? "−" : options.sign && number > 0 ? "+" : "";
  return `${sign}${Math.abs(number).toLocaleString(undefined, { maximumFractionDigits: options.digits ?? 0 })}${suffix}`;
}

export function formatPercent(value, options = {}) {
  return formatNumber(value, "%", { digits: 1, ...options });
}
