import {
  buildDashboard,
  compareActivities,
  filterActivities,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatNumber,
  formatPercent,
  formatSpeed,
  formatSpeedForSport,
  previousComparable,
  sportLabel,
} from "./analytics.js";
import { renderActivityChart, renderHeartRateTrend, renderRouteChart, renderSleepTrend, renderWeeklyChart } from "./chart.js";
import { compactActivity, parseFitActivity } from "./fit.js";
import { deleteActivity, getActivity, listActivities, putActivity } from "./store.js";

const UNIT_KEY = "una.activity.units";
const elements = Object.fromEntries([
  "file-input", "progress-area", "progress-label", "progress-value", "import-progress", "import-results", "error-banner", "capability-note",
  "range-filter", "kind-filter", "sport-filter", "unit-filter", "clear-filters", "dashboard-empty", "dashboard-content",
  "workout-analytics", "workout-range-label", "workout-summary", "weekly-chart", "heart-rate-trend", "sport-totals", "recorded-highs",
  "sleep-analytics", "sleep-summary", "sleep-trend", "activity-count", "activity-list", "empty-library", "empty-detail", "detail-content",
  "detail-kind", "detail-title", "detail-timing", "download-button", "delete-button", "detail-summary", "comparison-section", "comparison-date",
  "comparison-grid", "detail-chart-card", "detail-chart-caption", "detail-chart", "route-card", "route-chart", "sessions-card", "sessions-table",
  "laps-card", "laps-table", "detail-accessible-summary",
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));

const state = {
  records: [],
  selectedId: null,
  selectedActivity: null,
  busy: false,
  filters: { range: "30d", kind: "all", sport: "all" },
  units: localStorage.getItem(UNIT_KEY) === "statute" ? "statute" : "metric",
};

function setBusy(value) {
  state.busy = value;
  elements.file_input.disabled = value;
}

function setProgress(label, value, detail = "") {
  elements.progress_area.hidden = false;
  elements.progress_label.textContent = label;
  elements.progress_value.textContent = detail;
  elements.import_progress.value = Math.max(0, Math.min(1, value));
}

function hideProgress() {
  elements.progress_area.hidden = true;
  elements.import_progress.value = 0;
  elements.progress_value.textContent = "";
}

function showError(error) {
  elements.error_banner.textContent = error instanceof Error ? error.message : String(error);
  elements.error_banner.hidden = false;
}

function clearMessages() {
  elements.error_banner.hidden = true;
  elements.error_banner.textContent = "";
  elements.import_results.hidden = true;
  elements.import_results.textContent = "";
}

function summaryCard(label, value) {
  const card = document.createElement("div");
  card.className = "summary-card";
  const name = document.createElement("span");
  name.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  card.append(name, content);
  return card;
}

function renderTable(container, headers, rows) {
  container.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-library";
    empty.textContent = "No data available.";
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "metric-table";
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = header;
    headingRow.append(cell);
  }
  head.append(headingRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tableRow = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  table.append(head, body);
  container.append(table);
}

function filteredRecords() {
  return filterActivities(state.records, state.filters);
}

function renderSportOptions() {
  const current = state.filters.sport;
  const sports = [...new Set(state.records.filter((record) => record.kind === "workout").map((record) => record.summary.sport))].sort();
  elements.sport_filter.replaceChildren(new Option("All sports", "all"), ...sports.map((sport) => new Option(sportLabel(sport), sport)));
  if (current !== "all" && sports.includes(current)) elements.sport_filter.value = current;
  else {
    state.filters.sport = "all";
    elements.sport_filter.value = "all";
  }
}

function renderWorkoutAnalytics(analytics) {
  const visible = analytics.count > 0;
  elements.workout_analytics.hidden = !visible;
  if (!visible) return;
  elements.workout_summary.replaceChildren(
    summaryCard("Activities", formatNumber(analytics.count)),
    summaryCard("Active time", formatDuration(analytics.totalTimerSeconds)),
    summaryCard("Distance", formatDistance(analytics.totalDistanceMeters, state.units)),
    summaryCard("Calories", formatNumber(analytics.totalCalories, " kcal")),
    summaryCard("Ascent", formatElevation(analytics.totalAscentMeters, state.units)),
  );
  elements.workout_range_label.textContent = elements.range_filter.selectedOptions[0].textContent;
  renderTable(elements.sport_totals, ["Sport", "Count", "Time", "Distance", "Ascent"], analytics.sportTotals.map((row) => [
    sportLabel(row.sport),
    formatNumber(row.count),
    formatDuration(row.durationSeconds),
    formatDistance(row.distanceMeters, state.units),
    formatElevation(row.ascentMeters, state.units),
  ]));
  renderTable(elements.recorded_highs, ["Sport", "Distance", "Duration", "Ascent", "Avg speed"], analytics.recordedHighs.map((row) => [
    sportLabel(row.sport),
    formatDistance(row.distanceMeters, state.units),
    formatDuration(row.durationSeconds),
    formatElevation(row.ascentMeters, state.units),
    formatSpeedForSport(row.averageSpeedMps, row.sport, state.units),
  ]));
  requestAnimationFrame(() => {
    renderWeeklyChart(elements.weekly_chart, analytics.weekly, state.units);
    renderHeartRateTrend(elements.heart_rate_trend, analytics.heartRateTrend);
  });
}

function renderSleepAnalytics(analytics) {
  const visible = analytics.count > 0;
  elements.sleep_analytics.hidden = !visible;
  if (!visible) return;
  elements.sleep_summary.replaceChildren(
    summaryCard("Nights", formatNumber(analytics.count)),
    summaryCard("Average sleep", formatDuration(analytics.averageDurationSeconds)),
    summaryCard("Average HR", formatNumber(analytics.averageHeartRate, " bpm")),
    summaryCard("Light", formatPercent(analytics.lightPercent)),
    summaryCard("Deep", formatPercent(analytics.deepPercent)),
  );
  requestAnimationFrame(() => renderSleepTrend(elements.sleep_trend, analytics.trend));
}

function renderDashboard() {
  const dashboard = buildDashboard(state.records, state.filters);
  const empty = dashboard.filtered.length === 0;
  elements.dashboard_empty.hidden = !empty;
  elements.dashboard_content.hidden = empty;
  if (empty) return;
  renderWorkoutAnalytics(dashboard.workouts);
  renderSleepAnalytics(dashboard.sleep);
}

function activityListTitle(record) {
  if (record.kind === "sleep") return `Sleep · ${formatDate(record.summary.startTime)}`;
  return `${sportLabel(record.summary.sport)} · ${formatDate(record.summary.startTime)}`;
}

function activityListMetadata(record) {
  const fields = [formatDuration(record.summary.timerSeconds)];
  if (record.summary.distanceMeters !== null) fields.push(formatDistance(record.summary.distanceMeters, state.units));
  if (record.summary.averageHeartRate !== null) fields.push(`${Math.round(record.summary.averageHeartRate)} bpm`);
  return fields.join(" · ");
}

function renderLibrary() {
  const records = filteredRecords();
  elements.activity_list.replaceChildren();
  elements.activity_count.textContent = String(records.length);
  elements.empty_library.hidden = records.length > 0;
  for (const record of records) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "activity-item";
    button.setAttribute("aria-current", String(record.id === state.selectedId));
    const kind = document.createElement("span");
    kind.className = "item-kind";
    kind.textContent = record.kind === "sleep" ? "SleepVue sleep" : sportLabel(record.summary.subSport || record.summary.sport);
    const title = document.createElement("strong");
    title.textContent = activityListTitle(record);
    const metadata = document.createElement("span");
    metadata.textContent = activityListMetadata(record);
    button.append(kind, title, metadata);
    button.addEventListener("click", () => selectActivity(record.id).catch(showError));
    elements.activity_list.append(button);
  }
}

function detailSummaryCards(activity) {
  const summary = activity.summary;
  if (activity.kind === "sleep") {
    return [
      summaryCard("Duration", formatDuration(summary.sleep.totalSeconds)),
      summaryCard("Awake", `${formatDuration(summary.sleep.awakeSeconds)} · ${formatPercent(summary.sleep.awakePercent)}`),
      summaryCard("Light", `${formatDuration(summary.sleep.lightSeconds)} · ${formatPercent(summary.sleep.lightPercent)}`),
      summaryCard("Deep", `${formatDuration(summary.sleep.deepSeconds)} · ${formatPercent(summary.sleep.deepPercent)}`),
      summaryCard("Average HR", formatNumber(summary.averageHeartRate, " bpm")),
      summaryCard("Max HR", formatNumber(summary.maxHeartRate, " bpm")),
    ];
  }
  const cards = [
    summaryCard("Duration", formatDuration(summary.timerSeconds)),
    summaryCard("Distance", formatDistance(summary.distanceMeters, state.units)),
    summaryCard("Average HR", formatNumber(summary.averageHeartRate, " bpm")),
    summaryCard(PACE_LABELS.has(summary.sport) ? "Average pace" : "Average speed", formatSpeedForSport(summary.averageSpeedMps, summary.sport, state.units)),
    summaryCard("Ascent", formatElevation(summary.ascentMeters, state.units)),
    summaryCard("Calories", formatNumber(summary.calories, " kcal")),
  ];
  if (summary.averagePowerWatts !== null) cards.push(summaryCard("Average power", formatNumber(summary.averagePowerWatts, " W")));
  if (summary.averageCadence !== null) cards.push(summaryCard("Average cadence", formatNumber(summary.averageCadence)));
  return cards;
}

function formatComparison(item, sport) {
  if (item.format === "duration") return formatDuration(item.value, { sign: true });
  if (item.format === "distance") return formatDistance(item.value, state.units, { sign: true });
  if (item.format === "speed") return formatSpeed(item.value, state.units, { sign: true });
  if (item.format === "elevation") return formatElevation(item.value, state.units, { sign: true });
  if (item.format === "percent") return formatPercent(item.value, { sign: true });
  if (item.format === "heartRate") return formatNumber(item.value, " bpm", { sign: true });
  return formatNumber(item.value, "", { sign: true });
}

function renderComparison(activity) {
  const previous = previousComparable(activity, state.records);
  const comparisons = compareActivities(activity, previous);
  elements.comparison_section.hidden = comparisons.length === 0;
  if (comparisons.length === 0) return;
  elements.comparison_date.textContent = `Previous: ${formatDate(previous.summary.startTime)}`;
  elements.comparison_grid.replaceChildren(...comparisons.map((item) => {
    const node = document.createElement("div");
    node.className = "comparison-item";
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = formatComparison(item, activity.summary.sport);
    node.append(label, value);
    return node;
  }));
}

function renderSessions(activity) {
  const visible = activity.sessions.length > 1;
  elements.sessions_card.hidden = !visible;
  if (!visible) return;
  renderTable(elements.sessions_table, ["Segment", "Sport", "Time", "Distance", "Avg HR"], activity.sessions.map((session) => [
    String(session.index + 1),
    sportLabel(session.sport),
    formatDuration(session.timerSeconds),
    formatDistance(session.distanceMeters, state.units),
    formatNumber(session.averageHeartRate, " bpm"),
  ]));
}

function renderLaps(activity) {
  const visible = activity.laps.length > 0;
  elements.laps_card.hidden = !visible;
  if (!visible) return;
  renderTable(elements.laps_table, ["Lap", "Time", "Distance", "Avg HR", "Max HR", "Avg speed", "Ascent"], activity.laps.map((lap) => [
    String(lap.index + 1),
    formatDuration(lap.timerSeconds),
    formatDistance(lap.distanceMeters, state.units),
    formatNumber(lap.averageHeartRate, " bpm"),
    formatNumber(lap.maxHeartRate, " bpm"),
    formatSpeedForSport(lap.averageSpeedMps, activity.summary.sport, state.units),
    formatElevation(lap.ascentMeters, state.units),
  ]));
}

function renderDetail() {
  const activity = state.selectedActivity;
  if (!activity) {
    elements.empty_detail.hidden = false;
    elements.detail_content.hidden = true;
    return;
  }
  elements.empty_detail.hidden = true;
  elements.detail_content.hidden = false;
  elements.detail_kind.textContent = activity.kind === "sleep" ? "SLEEPVUE SLEEP" : `${sportLabel(activity.summary.sport)} ACTIVITY`;
  elements.detail_title.textContent = activity.kind === "sleep" ? `Sleep · ${formatDate(activity.summary.startTime)}` : sportLabel(activity.summary.subSport === "generic" ? activity.summary.sport : activity.summary.subSport);
  elements.detail_timing.textContent = `${formatDateTime(activity.summary.startTime)} → ${formatDateTime(activity.summary.endTime, { dateStyle: "medium", timeStyle: "short" })} · ${activity.filename}`;
  elements.detail_summary.replaceChildren(...detailSummaryCards(activity));
  renderComparison(activity);
  renderSessions(activity);
  renderLaps(activity);

  const hasSeries = Object.values(activity.features).some(Boolean);
  elements.detail_chart_card.hidden = !hasSeries;
  elements.detail_chart_caption.textContent = `${activity.summary.recordCount.toLocaleString()} timestamped records`;
  elements.route_card.hidden = !activity.features.route;
  elements.detail_accessible_summary.textContent = `${activityListTitle(activity)}. ${activityListMetadata(activity)}.`;
  requestAnimationFrame(() => {
    if (hasSeries) renderActivityChart(elements.detail_chart, activity, state.units);
    if (activity.features.route) renderRouteChart(elements.route_chart, activity);
  });
}

async function selectActivity(id) {
  if (!id) {
    state.selectedId = null;
    state.selectedActivity = null;
    renderLibrary();
    renderDetail();
    return;
  }
  const stored = await getActivity(id);
  if (!stored) return;
  const activity = await parseFitActivity({
    bytes: stored.bytes,
    filename: stored.filename,
    source: stored.source,
    importedAt: stored.importedAt,
  });
  state.selectedId = id;
  state.selectedActivity = activity;
  renderLibrary();
  renderDetail();
}

async function refresh(preferredId = state.selectedId) {
  state.records = await listActivities();
  renderSportOptions();
  renderDashboard();
  const filtered = filteredRecords();
  const nextId = filtered.some((record) => record.id === preferredId) ? preferredId : filtered[0]?.id ?? null;
  await selectActivity(nextId);
}

async function importFiles(files) {
  if (files.length === 0) return;
  clearMessages();
  setBusy(true);
  const results = [];
  let preferredId = null;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setProgress(`Importing ${file.name}`, index / files.length, `${index + 1} / ${files.length}`);
      try {
        if (!file.name.toLowerCase().endsWith(".fit")) throw new Error("unsupported format; choose a completed activity .fit file");
        const activity = await parseFitActivity({
          bytes: new Uint8Array(await file.arrayBuffer()),
          filename: file.name,
          source: { kind: "manual" },
        });
        const result = await putActivity(compactActivity(activity));
        results.push({ filename: file.name, status: result.status });
        preferredId = activity.id;
      } catch (error) {
        results.push({ filename: file.name, status: "failed", message: error instanceof Error ? error.message : String(error) });
      }
      setProgress(`Imported ${index + 1} of ${files.length}`, (index + 1) / files.length, `${index + 1} / ${files.length}`);
    }
    const imported = results.filter((result) => result.status === "imported").length;
    const duplicates = results.filter((result) => result.status === "duplicate").length;
    const failures = results.filter((result) => result.status === "failed");
    const summary = [`${imported} imported`, `${duplicates} duplicate${duplicates === 1 ? "" : "s"}`];
    if (failures.length > 0) summary.push(`${failures.length} failed: ${failures.map((failure) => `${failure.filename} — ${failure.message}`).join("; ")}`);
    elements.import_results.textContent = summary.join(" · ");
    elements.import_results.hidden = false;
    await refresh(preferredId);
  } finally {
    hideProgress();
    setBusy(false);
    elements.file_input.value = "";
  }
}

function applyFilters() {
  state.filters.range = elements.range_filter.value;
  state.filters.kind = elements.kind_filter.value;
  state.filters.sport = elements.sport_filter.value;
  renderDashboard();
  const records = filteredRecords();
  if (!records.some((record) => record.id === state.selectedId)) {
    selectActivity(records[0]?.id ?? null).catch(showError);
  } else {
    renderLibrary();
    renderDetail();
  }
}

function checkCapabilities() {
  const missing = [];
  if (!globalThis.crypto?.subtle) missing.push("Web Crypto");
  if (!globalThis.indexedDB) missing.push("IndexedDB");
  if (!globalThis.CanvasRenderingContext2D) missing.push("Canvas 2D");
  if (missing.length > 0) {
    elements.file_input.disabled = true;
    elements.capability_note.textContent = `Unsupported browser: ${missing.join(", ")} required.`;
    showError(`This dashboard requires ${missing.join(", ")}. Use a current browser over HTTPS or localhost.`);
    return false;
  }
  return true;
}

elements.file_input.addEventListener("change", () => importFiles([...elements.file_input.files]).catch(showError));
for (const filter of [elements.range_filter, elements.kind_filter, elements.sport_filter]) filter.addEventListener("change", applyFilters);
elements.unit_filter.value = state.units;
elements.unit_filter.addEventListener("change", () => {
  state.units = elements.unit_filter.value;
  localStorage.setItem(UNIT_KEY, state.units);
  renderDashboard();
  renderLibrary();
  renderDetail();
});
elements.clear_filters.addEventListener("click", () => {
  elements.range_filter.value = "30d";
  elements.kind_filter.value = "all";
  elements.sport_filter.value = "all";
  applyFilters();
});
elements.download_button.addEventListener("click", () => {
  if (!state.selectedActivity) return;
  const blob = new Blob([state.selectedActivity.bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.selectedActivity.filename;
  anchor.click();
  URL.revokeObjectURL(url);
});
elements.delete_button.addEventListener("click", async () => {
  if (!state.selectedActivity) return;
  if (!window.confirm(`Remove ${state.selectedActivity.filename} from this browser? The original file is unchanged.`)) return;
  const id = state.selectedActivity.id;
  state.selectedActivity = null;
  state.selectedId = null;
  await deleteActivity(id);
  await refresh();
});

let resizeFrame = null;
const resizeObserver = new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    renderDashboard();
    renderDetail();
  });
});
resizeObserver.observe(document.querySelector(".dashboard-section"));
resizeObserver.observe(document.querySelector(".activity-detail"));

const PACE_LABELS = new Set(["running", "walking", "hiking"]);
if (checkCapabilities()) refresh().catch(showError);
