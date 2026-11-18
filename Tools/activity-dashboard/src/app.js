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
import { FTSClient } from "./fts-client.js";
import { deleteActivity, getActivity, listActivities, putActivity, changeWorkoutType, markHealthShared } from "./store.js";
import { listWatchFits } from "./watch-files.js";
import { healthPayload } from "./health.js";
import { parseDailyHealth, dailyHealthPayload, putDailyHealth, listDailyHealth, markDailyHealthShared } from "./daily-health.js";
import { applyEdits, healthShareLabel, needsHealthShare, WORKOUT_TYPES } from "./activity-edits.js";

const UNIT_KEY = "una.activity.units";
const elements = Object.fromEntries([
  "file-input", "progress-area", "progress-label", "progress-value", "import-progress", "import-results", "error-banner", "capability-note",
  "range-filter", "kind-filter", "sport-filter", "unit-filter", "clear-filters", "dashboard-empty", "dashboard-content",
  "workout-analytics", "workout-range-label", "workout-summary", "weekly-chart", "heart-rate-trend", "sport-totals", "recorded-highs",
  "sleep-analytics", "sleep-summary", "sleep-trend", "activity-count", "activity-list", "empty-library", "empty-detail", "detail-content",
  "detail-kind", "detail-title", "detail-timing", "download-button", "strava-button", "delete-button", "detail-summary", "comparison-section", "comparison-date",
  "comparison-grid", "detail-chart-card", "detail-chart-caption", "detail-chart", "route-card", "route-chart", "sessions-card", "sessions-table",
  "laps-card", "laps-table", "detail-accessible-summary", "health-button", "health-status",
  "health-panel", "health-all", "health-auto", "health-batch-status", "type-editor", "workout-type", "save-type",
  "connect-watch", "scan-watch", "disconnect-watch", "watch-panel", "watch-status", "watch-files", "import-watch",
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));

const watch = new FTSClient();
const state = {
  records: [],
  selectedId: null,
  selectedActivity: null,
  busy: false,
  watchFiles: [],
  filters: { range: "30d", kind: "all", sport: "all" },
  units: localStorage.getItem(UNIT_KEY) === "statute" ? "statute" : "metric",
};

// One task per screen; filters are shared by Library and Trends.
document.documentElement.classList.add("focused-ui");
const dashboardFilters = elements.range_filter.closest(".filter-row");
document.querySelector("#units-setting").append(elements.unit_filter.closest("label"));
document.querySelector("#filter-controls").append(dashboardFilters);
function showView(view) {
  document.documentElement.dataset.view = view;
  for (const button of document.querySelectorAll(".app-navigation button")) {
    if (button.dataset.view === (view === "detail" ? "library" : view)) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  if (view === "trends") renderDashboard();
  if (view === "detail") renderDetail();
}
for (const button of document.querySelectorAll(".app-navigation button"))
  button.addEventListener("click", () => showView(button.dataset.view));
document.querySelector("#back-library").addEventListener("click", () => showView("library"));
document.documentElement.dataset.view = "library";

function setBusy(value) {
  state.busy = value;
  elements.file_input.disabled = value;
  elements.connect_watch.disabled = value || !FTSClient.isSupported();
  elements.scan_watch.disabled = value || !watch.isConnected;
  elements.disconnect_watch.disabled = value || !watch.isConnected;
  elements.import_watch.disabled = value || !watch.isConnected || !elements.watch_files.querySelector("input:checked");
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
    kind.textContent = record.kind === "sleep" ? "SleepVue sleep" : sportLabel(
      record.summary.subSport && record.summary.subSport !== "generic" ? record.summary.subSport : record.summary.sport);
    const title = document.createElement("strong");
    title.textContent = activityListTitle(record);
    const metadata = document.createElement("span");
    metadata.textContent = activityListMetadata(record);
    button.append(kind, title, metadata);
    if (window.AndroidExport) {
      const sharing = document.createElement("span");
      sharing.textContent = healthShareLabel(record);
      button.append(sharing);
    }
    button.addEventListener("click", () => selectActivity(record.id).catch(showError));
    button.addEventListener("click", () => showView("detail"));
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
  elements.strava_button.hidden = !window.AndroidExport || activity.kind !== "workout";
  elements.health_button.hidden = !window.AndroidExport;
  elements.health_status.hidden = !window.AndroidExport;
  elements.health_status.textContent = healthShareLabel(activity);
  elements.type_editor.hidden = activity.kind !== "workout";
  elements.workout_type.value = activity.typeOverride ?? Object.keys(WORKOUT_TYPES).find(key =>
    WORKOUT_TYPES[key][0] === activity.summary.sport && WORKOUT_TYPES[key][1] === activity.summary.subSport) ?? "";
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
  state.selectedActivity = applyEdits(activity, stored);
  renderLibrary();
  renderDetail();
}

async function refresh(preferredId = state.selectedId) {
  state.records = await listActivities();
  updateHealthControls();
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
        autoShare(result);
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

function renderWatchFiles() {
  elements.watch_files.replaceChildren();
  if (state.watchFiles.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No completed activity FIT files found on the watch.";
    elements.watch_files.append(empty);
  }
  for (const file of state.watchFiles) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = file.path;
    checkbox.addEventListener("change", () => setBusy(state.busy));
    const name = document.createElement("span");
    name.textContent = `${file.app} · ${file.name} (${Math.round(file.size / 1024)} KB)`;
    label.append(checkbox, name);
    elements.watch_files.append(label);
  }
  setBusy(state.busy);
}

async function scanWatch() {
  setBusy(true);
  elements.watch_status.textContent = "Looking for activity FIT files…";
  try {
    state.watchFiles = await listWatchFits(watch, (message) => {
      elements.watch_status.textContent = message;
      reportWatchDiagnostic(message);
    });
    renderWatchFiles();
    elements.watch_status.textContent = `${state.watchFiles.length} FIT file${state.watchFiles.length === 1 ? "" : "s"} on watch`;
  } catch (error) {
    reportWatchDiagnostic(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    setBusy(false);
  }
}

async function connectWatch() {
  clearMessages();
  // The browser's device picker must be opened directly from the click gesture.
  const connection = watch.connect();
  setBusy(true);
  elements.watch_panel.hidden = false;
  try {
    await connection;
    await scanWatch();
  } finally {
    setBusy(false);
  }
}

async function importWatchFiles() {
  const selected = new Set([...elements.watch_files.querySelectorAll("input:checked")].map((input) => input.value));
  const files = state.watchFiles.filter((file) => selected.has(file.path));
  if (files.length === 0) return;
  clearMessages();
  setBusy(true);
  const results = [];
  let preferredId = null;
  try {
    for (const [index, file] of files.entries()) {
      setProgress(`Reading ${file.name}`, index / files.length, `${index + 1} / ${files.length}`);
      try {
        const bytes = await watch.readVerified(file.path, (fraction) =>
          setProgress(`Reading ${file.name}`, (index + fraction) / files.length, `${index + 1} / ${files.length}`));
        const activity = await parseFitActivity({
          bytes, filename: file.name, source: { kind: "watch", path: file.path },
        });
        const result = await putActivity(compactActivity(activity));
        results.push(`${file.name}: ${result.status}`);
        preferredId = activity.id;
      } catch (error) {
        results.push(`${file.name}: failed (${error instanceof Error ? error.message : String(error)})`);
        if (!watch.isConnected) break;
      }
    }
    elements.import_results.textContent = results.join(" · ");
    elements.import_results.hidden = false;
    await refresh(preferredId);
  } finally {
    hideProgress();
    setBusy(false);
  }
}

function applyFilters() {
  state.filters.range = elements.range_filter.value;
  state.filters.kind = elements.kind_filter.value;
  state.filters.sport = elements.sport_filter.value;
  document.querySelector("#filter-description").textContent =
    `${elements.range_filter.selectedOptions[0].textContent} · ${elements.kind_filter.selectedOptions[0].textContent}`
    + (state.filters.sport !== "all" ? ` · ${sportLabel(state.filters.sport)}` : "");
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
  if (!FTSClient.isSupported()) {
    elements.connect_watch.disabled = true;
    elements.capability_note.textContent += " Web Bluetooth is unavailable here; manual FIT import still works.";
  }
  return true;
}

// Called only by the Android shell after native FTS v5 digest verification.
// FIT parsing here still enforces the completed-activity and FIT CRC checks.
window.unaDashboardNative = () => {
  document.documentElement.classList.add("android-app");
  elements.connect_watch.hidden = true;
  elements.watch_panel.hidden = true;
  elements.download_button.hidden = true; // WebView has no browser blob download manager.
  document.querySelector("#import-title").textContent = "Your recordings";
  document.querySelector(".import-copy .eyebrow").textContent = "PRIVATE ACTIVITY LIBRARY";
  document.querySelector(".import-copy > p:last-child").textContent =
    "Share FIT files from UNA, or add them from your phone.";
  elements.capability_note.textContent = "Offline on this phone · Watch transfers require CRC-32 and FIT integrity checks.";
  elements.health_panel.hidden = false;
  updateHealthControls();
};
let nativeTransfer = null;
window.unaDashboardShareStart = (filename) => {
  if (!filename.toLowerCase().endsWith(".fit")) throw new Error("Please share a FIT recording");
  nativeTransfer = { filename, path: null, chunks: [] };
};
window.unaDashboardImportStart = (filename, path) => {
  if (!filename.toLowerCase().endsWith(".fit")
      || !/^\/Apps\/[^/.][^/]*\/Activity\/20[0-9]{4}\/[^/]+\.fit$/i.test(path)
      || path.substring(path.lastIndexOf("/") + 1) !== filename) {
    throw new Error("Unexpected watch file path");
  }
  nativeTransfer = { filename, path, chunks: [] };
};
window.unaDashboardImportChunk = (base64) => {
  if (!nativeTransfer || !/^[a-zA-Z0-9+/=]+$/.test(base64)) throw new Error("Invalid watch transfer");
  nativeTransfer.chunks.push(base64);
};
window.unaDashboardImportFinish = async () => {
  const transfer = nativeTransfer;
  nativeTransfer = null;
  clearMessages();
  try {
    if (!transfer || transfer.chunks.length === 0) throw new Error("Incomplete watch transfer");
    const { filename, path } = transfer;
    const binary = atob(transfer.chunks.join(""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const activity = await parseFitActivity({ bytes, filename, source: path ? { kind: "watch", path } : { kind: "shared" } });
    const result = await putActivity(compactActivity(activity));
    autoShare(result);
    await refresh(activity.id);
    showView("library");
    elements.import_results.textContent = result.status === "duplicate"
      ? `${filename}: Already imported — duplicate skipped. No extra copy added.`
      : `${filename}: imported · ${path ? "Verified watch transfer" : "Shared FIT · integrity checked"}`;
    elements.import_results.hidden = false;
  } catch (error) {
    showError(error);
  }
};

elements.file_input.addEventListener("change", () => importFiles([...elements.file_input.files]).catch(showError));
const AUTO_HEALTH_KEY = "una.health.auto";
const healthQueue = [];
let healthRunning = false;
let healthPending = null;
let stopHealthQueue = false;
elements.health_auto.checked = localStorage.getItem(AUTO_HEALTH_KEY) === "true";
for (const [key, [, , label]] of Object.entries(WORKOUT_TYPES)) {
  elements.workout_type.add(new Option(label, key));
}
elements.workout_type.add(new Option("Original / unrecognized type", ""), 0);

function updateHealthControls() {
  const count = state.records.filter(needsHealthShare).length;
  elements.health_all.textContent = `Share all unshared recordings (${count})`;
  elements.health_all.disabled = healthRunning || count === 0;
  elements.health_button.disabled = healthRunning;
  document.querySelector("#daily-share").disabled = healthRunning;
}

function autoShare(result) {
  if (result.status === "imported" && elements.health_auto.checked && window.AndroidExport)
    enqueueHealth([result.record.id], true);
}

function enqueueHealth(ids, confirmed) {
  if (!window.AndroidExport) return;
  for (const id of ids) {
    if (!healthQueue.some(item => item.id === id)) healthQueue.push({ id, confirmed });
  }
  if (!healthRunning) runHealthQueue().catch(showError);
}

window.unaHealthStatus = message => { elements.health_batch_status.textContent = message; };
window.unaHealthResult = result => {
  if (healthPending?.id === result.id && healthPending.version === result.version)
    healthPending.resolve(result);
};

async function runHealthQueue() {
  healthRunning = true;
  stopHealthQueue = false;
  updateHealthControls();
  let shared = 0;
  let failed = 0;
  let failure = "";
  try {
    while (healthQueue.length && !stopHealthQueue) {
      const item = healthQueue.shift();
      try {
        const daily = item.daily;
        const stored = daily || await getActivity(item.id);
        if (!stored) continue;
        const payload = daily
          ? { ...await dailyHealthPayload(daily, state.records), confirmed: true }
          : { ...healthPayload(applyEdits(await parseFitActivity(stored), stored)), confirmed: item.confirmed };
        if (daily && payload.signature === daily.sharedSignature) continue;
        if (daily && !payload.heartRate.length && !payload.restingHeartRate) {
          if (daily.sharedVersion) throw new Error("All daily samples now overlap recordings. Remove this day's previous daily heart-rate record in Health Connect before resyncing.");
          continue;
        }
        const message = JSON.stringify(payload);
        if (message.length > 2_000_000) throw new Error("Recording too large for Health Connect export");
        elements.health_batch_status.textContent = `Sharing ${stored.filename} · ${healthQueue.length} remaining`;
        const result = await new Promise((resolve, reject) => {
          healthPending = { id: payload.id, version: payload.version, resolve };
          try { window.AndroidExport.postMessage(message); }
          catch (error) { reject(error); }
        });
        healthPending = null;
        if (!result.success) {
          failed++;
          failure = result.message;
          break; // Avoid repeated permission prompts; remaining items stay unshared.
        }
        if (daily) await markDailyHealthShared(item.id, payload);
        else await markHealthShared(item.id, payload.version);
        shared++;
      } catch (error) {
        failed++;
        failure = error.message;
        break;
      }
    }
  } finally {
    healthPending = null;
    healthQueue.length = 0;
    healthRunning = false;
    await refresh();
    elements.health_batch_status.textContent = `${shared} shared${failed ? ` · stopped: ${failure}` : ""}. `
      + "Sharing status tracks this app's successful exports; Health Connect copies can be managed in Android settings.";
    updateHealthControls();
    await updateDailyStatus();
  }
}

const dailyZone = document.querySelector("#daily-zone");
dailyZone.value = localStorage.getItem("una.daily.zone") || Intl.DateTimeFormat().resolvedOptions().timeZone;
async function updateDailyStatus() {
  const days = await listDailyHealth();
  document.querySelector("#daily-status").textContent = days.length
    ? `${days.length} days · ${days[0].date} – ${days.at(-1).date} · `
      + `${days.reduce((n, d) => n + (d.sharedSamples || 0), 0).toLocaleString()} samples last shared. `
      + `${days.filter(d => d.sharedRestingHeartRate > 0).length} resting-HR summaries shared. `
      + "Sync again after importing more recordings to reconcile overlaps."
    : "No daily heart-rate history imported.";
}
window.unaImportDailyHealth = async files => {
  const counts = { imported: 0, updated: 0, duplicate: 0, errors: [] };
  for (const file of files) {
    try {
      const day = await parseDailyHealth(file.filename, file.data, dailyZone.value.trim());
      counts[await putDailyHealth(day)]++;
    } catch (error) { counts.errors.push(`${file.filename}: ${error.message}`); }
  }
  localStorage.setItem("una.daily.zone", dailyZone.value.trim());
  await updateDailyStatus();
  return counts;
};
document.querySelector("#daily-input").addEventListener("change", async event => {
  try {
    const files = await Promise.all([...event.target.files].map(async f => ({ filename: f.name, data: JSON.parse(await f.text()) })));
    const result = await window.unaImportDailyHealth(files);
    document.querySelector("#daily-status").textContent += ` Imported ${result.imported}, updated ${result.updated}, duplicates ${result.duplicate}. ${result.errors.join("; ")}`;
  } catch (error) { document.querySelector("#daily-status").textContent = error.message; }
});
document.querySelector("#daily-share").addEventListener("click", async () => {
  if (healthRunning || !window.AndroidExport) return;
  const days = await listDailyHealth();
  if (!days.length || !window.confirm(`Sync ${days.length} days of heart-rate history with Health Connect? Existing daily exports will be updated; shared recording intervals will be excluded.`)) return;
  for (const daily of days) healthQueue.push({ id: daily.id, daily, confirmed: true });
  runHealthQueue().catch(showError);
});
updateDailyStatus().catch(showError);

elements.health_button.addEventListener("click", () => {
  if (state.selectedActivity) enqueueHealth([state.selectedActivity.id], false);
});
elements.health_all.addEventListener("click", () => {
  const ids = state.records.filter(needsHealthShare).map(record => record.id);
  if (ids.length && window.confirm(`Share ${ids.length} unshared or changed recordings with Health Connect? `
    + "Apps you have authorized, including Google Fit / Google Health, can read them."))
    enqueueHealth(ids, true);
});
elements.health_auto.addEventListener("change", () => {
  if (elements.health_auto.checked && !window.confirm("Automatically share future imports and type corrections "
    + "with Health Connect? Authorized apps can read them. Existing imports are shared only with Share all."))
    elements.health_auto.checked = false;
  localStorage.setItem(AUTO_HEALTH_KEY, String(elements.health_auto.checked));
  if (!elements.health_auto.checked) stopHealthQueue = true;
});
elements.save_type.addEventListener("click", async () => {
  const id = state.selectedId;
  const type = elements.workout_type.value;
  if (!id || !type) return;
  try {
    await changeWorkoutType(id, type);
    await refresh(id);
    if (elements.health_auto.checked) enqueueHealth([id], true);
  } catch (error) { showError(error); }
});
elements.connect_watch.addEventListener("click", () => connectWatch().catch(showError));
elements.scan_watch.addEventListener("click", () => scanWatch().catch(showError));
elements.import_watch.addEventListener("click", () => importWatchFiles().catch(showError));
elements.disconnect_watch.addEventListener("click", () => watch.disconnect());
watch.addEventListener("statechange", (event) => {
  elements.watch_status.textContent = event.detail.message;
  if (!watch.isConnected) {
    state.watchFiles = [];
    elements.watch_files.replaceChildren();
  }
  setBusy(state.busy);
});
function reportWatchDiagnostic(message) {
  console.info("[watch]", message);
  if (import.meta.env.DEV) {
    fetch("/__watch-diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).catch(() => {});
  }
}
watch.addEventListener("log", (event) => reportWatchDiagnostic(event.detail));
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
elements.strava_button.addEventListener("click", () => {
  const activity = state.selectedActivity;
  if (!window.AndroidExport || activity?.kind !== "workout") return;
  try {
    const bytes = new Uint8Array(activity.bytes);
    window.AndroidExport.postMessage(JSON.stringify({ type: "start", filename: activity.filename }));
    for (let offset = 0; offset < bytes.length; offset += 24576) {
      const piece = bytes.subarray(offset, offset + 24576);
      let binary = "";
      for (const byte of piece) binary += String.fromCharCode(byte);
      window.AndroidExport.postMessage(JSON.stringify({ type: "chunk", value: btoa(binary) }));
    }
    window.AndroidExport.postMessage(JSON.stringify({ type: "finish" }));
  } catch (error) {
    showError(error);
  }
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
