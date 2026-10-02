import { formatDate, formatDistance, formatDuration, formatElevation, formatNumber, formatSpeedForSport, sportLabel } from "./analytics.js";

const COLORS = Object.freeze({
  background: "#0b1119",
  panel: "#101923",
  border: "#253348",
  grid: "#223044",
  text: "#edf4fb",
  muted: "#8d9cb0",
  accent: "#6cd8ae",
  blue: "#68a8e8",
  yellow: "#e7bd68",
  pink: "#ee7489",
  purple: "#aa8bde",
  orange: "#e39363",
});
const SERIES_COLORS = [COLORS.accent, COLORS.blue, COLORS.yellow, COLORS.purple, COLORS.orange, COLORS.pink];
const STAGE_COLORS = [COLORS.pink, COLORS.blue, COLORS.purple];
const STAGE_LABELS = ["Awake", "Light", "Deep"];

function prepare(canvas, height = null) {
  if (height !== null) canvas.style.height = `${height}px`;
  const width = Math.max(280, Math.floor(canvas.clientWidth || 800));
  const logicalHeight = Math.max(180, Math.floor(canvas.clientHeight || height || 260));
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(logicalHeight * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, logicalHeight);
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, width, logicalHeight);
  return { context, width, height: logicalHeight };
}

function text(context, value, x, y, options = {}) {
  context.save();
  context.fillStyle = options.color ?? COLORS.muted;
  context.font = options.font ?? "11px Inter, system-ui, sans-serif";
  context.textAlign = options.align ?? "left";
  context.textBaseline = options.baseline ?? "alphabetic";
  context.fillText(String(value), x, y);
  context.restore();
}

function line(context, x1, y1, x2, y2, color = COLORS.grid, width = 1, dash = []) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dash);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
}

function noData(canvas, message) {
  const { context, width, height } = prepare(canvas);
  text(context, message, width / 2, height / 2, { align: "center", baseline: "middle" });
}

function extent(values, padding = 0.08) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) return null;
  let minimum = Math.min(...valid);
  let maximum = Math.max(...valid);
  if (minimum === maximum) {
    minimum -= Math.max(1, Math.abs(minimum) * 0.1);
    maximum += Math.max(1, Math.abs(maximum) * 0.1);
  }
  const margin = (maximum - minimum) * padding;
  return [minimum - margin, maximum + margin];
}

function axes(context, plot, yRange, labelFormatter = (value) => Math.round(value)) {
  for (let index = 0; index <= 4; index += 1) {
    const fraction = index / 4;
    const y = plot.top + fraction * plot.height;
    line(context, plot.left, y, plot.left + plot.width, y);
    const value = yRange[1] - fraction * (yRange[1] - yRange[0]);
    text(context, labelFormatter(value), plot.left - 8, y, { align: "right", baseline: "middle" });
  }
}

function bindReadout(canvas, points, formatter) {
  let output = canvas.nextElementSibling;
  if (!(output instanceof HTMLOutputElement) || !output.classList.contains("chart-readout")) {
    output = document.createElement("output");
    output.className = "chart-readout";
    canvas.insertAdjacentElement("afterend", output);
  }
  canvas.tabIndex = 0;
  canvas._chartReadout = { points, formatter, output, index: Math.max(0, points.length - 1) };
  if (canvas.dataset.readoutBound) return;
  canvas.dataset.readoutBound = "true";
  const show = (index) => {
    const state = canvas._chartReadout;
    if (!state || state.points.length === 0) return;
    state.index = Math.max(0, Math.min(state.points.length - 1, index));
    state.output.value = state.formatter(state.points[state.index]);
  };
  canvas.addEventListener("pointermove", (event) => {
    const state = canvas._chartReadout;
    const fraction = event.offsetX / Math.max(1, canvas.clientWidth);
    show(Math.round(fraction * Math.max(0, state.points.length - 1)));
  });
  canvas.addEventListener("focus", () => show(canvas._chartReadout.index));
  canvas.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    show(canvas._chartReadout.index + (event.key === "ArrowRight" ? 1 : -1));
  });
  show(canvas._chartReadout.index);
}

export function renderWeeklyChart(canvas, weekly, units = "metric") {
  if (!weekly?.length) return noData(canvas, "No workout volume in this period");
  const { context, width, height } = prepare(canvas);
  const plot = { left: 48, top: 18, width: width - 92, height: height - 54 };
  const sports = [...new Set(weekly.flatMap((bucket) => Object.keys(bucket.sports)))];
  const durationMax = Math.max(1, ...weekly.map((bucket) => bucket.durationSeconds));
  const distanceMax = Math.max(1, ...weekly.map((bucket) => bucket.distanceMeters));
  const slot = plot.width / weekly.length;
  axes(context, plot, [0, durationMax], (value) => `${Math.round(value / 3600)}h`);

  weekly.forEach((bucket, bucketIndex) => {
    let stackBottom = plot.top + plot.height;
    sports.forEach((sport, sportIndex) => {
      const duration = bucket.sports[sport] ?? 0;
      const barHeight = (duration / durationMax) * plot.height;
      context.fillStyle = SERIES_COLORS[sportIndex % SERIES_COLORS.length];
      context.fillRect(plot.left + bucketIndex * slot + slot * 0.18, stackBottom - barHeight, slot * 0.5, barHeight);
      stackBottom -= barHeight;
    });
    text(context, bucket.week.slice(5), plot.left + bucketIndex * slot + slot * 0.44, plot.top + plot.height + 19, { align: "center" });
  });

  context.save();
  context.strokeStyle = COLORS.text;
  context.lineWidth = 2;
  context.beginPath();
  weekly.forEach((bucket, index) => {
    const x = plot.left + index * slot + slot * 0.44;
    const y = plot.top + plot.height - (bucket.distanceMeters / distanceMax) * plot.height;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
  text(context, `distance max ${formatDistance(distanceMax, units)}`, plot.left + plot.width, plot.top + 10, { align: "right", color: COLORS.text });
  sports.forEach((sport, index) => {
    context.fillStyle = SERIES_COLORS[index % SERIES_COLORS.length];
    context.fillRect(plot.left + index * 96, 1, 8, 8);
    text(context, sportLabel(sport), plot.left + index * 96 + 13, 9);
  });
  bindReadout(canvas, weekly, (bucket) => `${formatDate(bucket.week)} · ${formatDuration(bucket.durationSeconds)} · ${formatDistance(bucket.distanceMeters, units)}`);
}

export function renderHeartRateTrend(canvas, points) {
  if (!points?.length) return noData(canvas, "No average heart-rate data");
  const { context, width, height } = prepare(canvas);
  const plot = { left: 42, top: 18, width: width - 58, height: height - 50 };
  const yRange = extent(points.map((point) => point.value)) ?? [40, 180];
  axes(context, plot, yRange, (value) => Math.round(value));
  const xAt = (index) => plot.left + (index / Math.max(1, points.length - 1)) * plot.width;
  const yAt = (value) => plot.top + plot.height - ((value - yRange[0]) / (yRange[1] - yRange[0])) * plot.height;
  context.save();
  context.strokeStyle = COLORS.pink;
  context.lineWidth = 2;
  context.beginPath();
  points.forEach((point, index) => index === 0 ? context.moveTo(xAt(index), yAt(point.value)) : context.lineTo(xAt(index), yAt(point.value)));
  context.stroke();
  context.fillStyle = COLORS.pink;
  points.forEach((point, index) => { context.beginPath(); context.arc(xAt(index), yAt(point.value), 2.8, 0, Math.PI * 2); context.fill(); });
  context.restore();
  bindReadout(canvas, points, (point) => `${formatDate(point.date)} · ${Math.round(point.value)} bpm · ${sportLabel(point.sport)}`);
}

export function renderSleepTrend(canvas, points) {
  if (!points?.length) return noData(canvas, "No SleepVue sleep data in this period");
  const { context, width, height } = prepare(canvas);
  const plot = { left: 48, top: 20, width: width - 92, height: height - 56 };
  const durationMax = Math.max(1, ...points.map((point) => point.durationSeconds));
  const hrValues = points.map((point) => point.averageHeartRate).filter(Number.isFinite);
  const hrRange = extent(hrValues) ?? [40, 100];
  const slot = plot.width / points.length;
  axes(context, plot, [0, durationMax], (value) => `${Math.round(value / 3600)}h`);
  points.forEach((point, index) => {
    let bottom = plot.top + plot.height;
    [point.awakePercent, point.lightPercent, point.deepPercent].forEach((percent, stage) => {
      const stageHeight = (point.durationSeconds * percent / 100 / durationMax) * plot.height;
      context.fillStyle = STAGE_COLORS[stage];
      context.fillRect(plot.left + index * slot + slot * 0.18, bottom - stageHeight, slot * 0.48, stageHeight);
      bottom -= stageHeight;
    });
    text(context, new Date(point.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }), plot.left + index * slot + slot * 0.42, plot.top + plot.height + 19, { align: "center" });
  });
  if (hrValues.length > 0) {
    context.save();
    context.strokeStyle = COLORS.text;
    context.lineWidth = 1.8;
    context.beginPath();
    let started = false;
    points.forEach((point, index) => {
      if (!Number.isFinite(point.averageHeartRate)) return;
      const x = plot.left + index * slot + slot * 0.42;
      const y = plot.top + plot.height - ((point.averageHeartRate - hrRange[0]) / (hrRange[1] - hrRange[0])) * plot.height;
      if (!started) { context.moveTo(x, y); started = true; } else context.lineTo(x, y);
    });
    context.stroke();
    context.restore();
  }
  STAGE_LABELS.forEach((label, index) => {
    context.fillStyle = STAGE_COLORS[index];
    context.fillRect(plot.left + index * 80, 2, 8, 8);
    text(context, label, plot.left + index * 80 + 13, 10);
  });
  bindReadout(canvas, points, (point) => `${formatDate(point.date)} · ${formatDuration(point.durationSeconds)} · deep ${point.deepPercent.toFixed(1)}% · ${Number.isFinite(point.averageHeartRate) ? `${Math.round(point.averageHeartRate)} bpm` : "no HR"}`);
}

function recordBounds(records) {
  const times = records.map((record) => Date.parse(record.timestamp)).filter(Number.isFinite);
  return times.length > 0 ? [Math.min(...times), Math.max(...times)] : null;
}

function drawPanel(context, panel, records, key, color, label, formatter, timeBounds) {
  context.fillStyle = COLORS.panel;
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
  context.strokeStyle = COLORS.border;
  context.strokeRect(panel.left + 0.5, panel.top + 0.5, panel.width - 1, panel.height - 1);
  text(context, label.toUpperCase(), panel.left + 10, panel.top + 17, { color: COLORS.muted, font: "700 10px Inter, system-ui, sans-serif" });
  const values = records.map((record) => record[key]).filter(Number.isFinite);
  const range = extent(values) ?? [0, 1];
  const plot = { left: panel.left + 52, top: panel.top + 28, width: panel.width - 66, height: panel.height - 42 };
  axes(context, plot, range, formatter);
  const xAt = (time) => plot.left + ((time - timeBounds[0]) / Math.max(1, timeBounds[1] - timeBounds[0])) * plot.width;
  const yAt = (value) => plot.top + plot.height - ((value - range[0]) / (range[1] - range[0])) * plot.height;
  const valid = records.filter((record) => Number.isFinite(record[key]));
  const intervals = valid.slice(1).map((record, index) => Date.parse(record.timestamp) - Date.parse(valid[index].timestamp)).filter((value) => value > 0).sort((a, b) => a - b);
  const median = intervals.length > 0 ? intervals[Math.floor(intervals.length / 2)] : 60_000;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.8;
  context.beginPath();
  let previousTime = null;
  for (const record of valid) {
    const time = Date.parse(record.timestamp);
    const x = xAt(time);
    const y = yAt(record[key]);
    if (previousTime === null || time - previousTime > Math.max(300_000, median * 3)) context.moveTo(x, y); else context.lineTo(x, y);
    previousTime = time;
  }
  context.stroke();
  context.restore();
}

function drawSleepPanel(context, panel, records, timeBounds) {
  context.fillStyle = COLORS.panel;
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
  context.strokeStyle = COLORS.border;
  context.strokeRect(panel.left + 0.5, panel.top + 0.5, panel.width - 1, panel.height - 1);
  text(context, "SLEEP STAGE", panel.left + 10, panel.top + 17, { font: "700 10px Inter, system-ui, sans-serif" });
  const plot = { left: panel.left + 52, top: panel.top + 27, width: panel.width - 66, height: panel.height - 38 };
  const rowHeight = plot.height / 3;
  STAGE_LABELS.forEach((label, stage) => {
    const y = plot.top + stage * rowHeight;
    text(context, label, plot.left - 8, y + rowHeight / 2, { align: "right", baseline: "middle" });
    if (stage > 0) line(context, plot.left, y, plot.left + plot.width, y);
  });
  const staged = records.filter((record) => Number.isInteger(record.sleepStage));
  staged.forEach((record, index) => {
    const start = Date.parse(record.timestamp);
    const end = index + 1 < staged.length ? Date.parse(staged[index + 1].timestamp) : start + (index > 0 ? start - Date.parse(staged[index - 1].timestamp) : 30_000);
    const x = plot.left + ((start - timeBounds[0]) / Math.max(1, timeBounds[1] - timeBounds[0])) * plot.width;
    const xEnd = plot.left + ((end - timeBounds[0]) / Math.max(1, timeBounds[1] - timeBounds[0])) * plot.width;
    context.fillStyle = STAGE_COLORS[record.sleepStage];
    context.fillRect(x, plot.top + record.sleepStage * rowHeight + 2, Math.max(1, xEnd - x), rowHeight - 4);
  });
}

export function renderActivityChart(canvas, activity, units = "metric") {
  const records = activity?.records ?? [];
  const timeBounds = recordBounds(records);
  const panels = [];
  if (activity?.kind === "sleep" && records.some((record) => record.sleepStage !== null)) panels.push({ type: "sleep", label: "Sleep stage" });
  if (records.some((record) => record.heartRate !== null)) panels.push({ key: "heartRate", label: "Heart rate · bpm", color: COLORS.pink, formatter: (value) => Math.round(value) });
  if (records.some((record) => record.speedMps !== null)) panels.push({ key: "speedMps", label: `${PACE_SPORTS.has(activity.summary.sport) ? "Speed" : "Speed"} · m/s`, color: COLORS.accent, formatter: (value) => value.toFixed(1) });
  if (records.some((record) => record.altitudeMeters !== null)) panels.push({ key: "altitudeMeters", label: "Elevation · m", color: COLORS.blue, formatter: (value) => Math.round(value) });
  if (records.some((record) => record.cadence !== null)) panels.push({ key: "cadence", label: "Cadence", color: COLORS.yellow, formatter: (value) => Math.round(value) });
  if (records.some((record) => record.powerWatts !== null)) panels.push({ key: "powerWatts", label: "Power · W", color: COLORS.purple, formatter: (value) => Math.round(value) });
  if (!timeBounds || panels.length === 0) return noData(canvas, "No timestamped sample series in this activity");
  const panelHeight = 150;
  const height = panels.length * panelHeight + 12;
  const { context, width } = prepare(canvas, height);
  panels.forEach((panel, index) => {
    const bounds = { left: 8, top: 6 + index * panelHeight, width: width - 16, height: panelHeight - 8 };
    if (panel.type === "sleep") drawSleepPanel(context, bounds, records, timeBounds);
    else drawPanel(context, bounds, records, panel.key, panel.color, panel.label, panel.formatter, timeBounds);
  });
  bindReadout(canvas, records, (record) => {
    const parts = [new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(record.timestamp))];
    if (record.sleepStage !== null) parts.push(STAGE_LABELS[record.sleepStage]);
    if (record.heartRate !== null) parts.push(`${Math.round(record.heartRate)} bpm`);
    if (record.speedMps !== null) parts.push(formatSpeedForSport(record.speedMps, activity.summary.sport, units));
    if (record.altitudeMeters !== null) parts.push(formatElevation(record.altitudeMeters, units));
    if (record.cadence !== null) parts.push(`${Math.round(record.cadence)} cadence`);
    if (record.powerWatts !== null) parts.push(`${Math.round(record.powerWatts)} W`);
    return parts.join(" · ");
  });
}

export function renderRouteChart(canvas, activity) {
  const points = (activity?.records ?? []).filter((record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude));
  if (points.length < 2) return noData(canvas, "No route coordinates");
  const { context, width, height } = prepare(canvas);
  const averageLatitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitudeScale = Math.cos(averageLatitude * Math.PI / 180);
  const projected = points.map((point) => ({ x: point.longitude * longitudeScale, y: point.latitude }));
  const xRange = extent(projected.map((point) => point.x), 0.04);
  const yRange = extent(projected.map((point) => point.y), 0.04);
  const padding = 22;
  const xAt = (value) => padding + ((value - xRange[0]) / (xRange[1] - xRange[0])) * (width - padding * 2);
  const yAt = (value) => height - padding - ((value - yRange[0]) / (yRange[1] - yRange[0])) * (height - padding * 2);
  for (let index = 1; index < 5; index += 1) {
    line(context, padding, padding + index * (height - padding * 2) / 5, width - padding, padding + index * (height - padding * 2) / 5);
    line(context, padding + index * (width - padding * 2) / 5, padding, padding + index * (width - padding * 2) / 5, height - padding);
  }
  context.save();
  context.strokeStyle = COLORS.accent;
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.beginPath();
  projected.forEach((point, index) => index === 0 ? context.moveTo(xAt(point.x), yAt(point.y)) : context.lineTo(xAt(point.x), yAt(point.y)));
  context.stroke();
  context.restore();
  const markers = [[projected[0], COLORS.accent, "S"], [projected.at(-1), COLORS.pink, "F"]];
  markers.forEach(([point, color, label]) => {
    context.fillStyle = color;
    context.beginPath();
    context.arc(xAt(point.x), yAt(point.y), 7, 0, Math.PI * 2);
    context.fill();
    text(context, label, xAt(point.x), yAt(point.y) + 0.5, { color: COLORS.background, align: "center", baseline: "middle", font: "700 8px Inter, sans-serif" });
  });
  text(context, `${points.length.toLocaleString()} GPS samples`, width - padding, height - 6, { align: "right" });
}

const PACE_SPORTS = new Set(["running", "walking", "hiking"]);
