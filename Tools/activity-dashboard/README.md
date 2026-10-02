# UNA Activity Dashboard

UNA Activity Dashboard is a static, browser-local viewer for completed activity FIT files. It combines SleepVue sleep sessions and ordinary recorded workouts in one library with summaries, trends, comparisons, laps, time-series charts, and local route traces.

Open the deployed dashboard at [https://odm7341.github.io/UNA_Watch/activity-dashboard/](https://odm7341.github.io/UNA_Watch/activity-dashboard/).

## Supported files

- Completed FIT activity files with session, lap, and/or record messages.
- SleepVue activity FIT files whose developer metadata identifies the `SleepVue` application and defines `sleep_stage` values `0` (awake), `1` (light), and `2` (deep).
- Single-session and multisport recordings.
- Optional standard activity fields including heart rate, distance, speed, altitude, cadence, power, calories, and GPS coordinates.

The dashboard deliberately rejects invalid CRCs and FIT files that define planned workouts, courses, schedules, or monitoring data. The tracked SleepLab watch app writes CSV/JSON rather than FIT; those files are not supported. The first release uses manual file selection only. The retained UNA FTS modules are transport code for a possible later Bluetooth adapter and are not loaded by the current UI.

## Privacy and local storage

FIT bytes are parsed in the browser and stored in IndexedDB on the current device. The dashboard has no account, backend, analytics, telemetry, or upload endpoint. Route traces are drawn without requesting basemap tiles, so GPS coordinates are not sent to a map provider.

A SHA-256 digest of each complete file is its local identity. Importing identical bytes under another filename reports a duplicate instead of creating another record. Removing an activity deletes only the browser copy; the original FIT file is unchanged.

The repository contains no personal FIT files. Test inputs are generated from synthetic timestamps, coordinates, heart rates, stages, and workout summaries in `test-support/fit-fixtures.js`.

## Use the dashboard

1. Open the hosted page or run the local development server.
2. Select **Import FIT files** and choose one or more completed activity files.
3. Use the period, kind, sport, and unit filters to change dashboard and library results.
4. Select an activity for its timeline, route, session/lap data, previous-activity comparison, raw download, or local deletion.

Imports continue after an invalid file, and the result banner reports imported, duplicate, and failed files separately. Metric/statute preference is retained in local storage. Imported activities persist in IndexedDB across page reloads.

## Develop and verify

Node 22 or newer is required by the pinned Vite release.

```bash
cd Tools/activity-dashboard
npm ci
npm test
npm run dev
```

Open the localhost URL printed by Vite. Production verification uses:

```bash
npm run build
npm run preview
```

`npm test` uses Node's built-in test runner. Coverage includes strict FIT validation, SleepVue developer fields, generic GPS workouts, multisport aggregation, content identity, analytics, unit formatting, comparisons, and the retained UNA FTS packet codec.

## Project contents

- `index.html` and `styles.css` — accessible responsive application shell and visual system.
- `src/app.js` — file ingestion, browser state, rendering orchestration, download, and deletion.
- `src/fit.js` — strict FIT parsing, SleepVue classification, normalization, and SHA-256 identity.
- `src/analytics.js` — filters, aggregates, comparisons, and unit/date formatting.
- `src/chart.js` — Canvas dashboard, activity, sleep-stage, and route renderers.
- `src/store.js` — IndexedDB activity metadata and raw-byte storage.
- `src/fts-client.js` and `src/protocol.js` — retained UNA Bluetooth file-transfer transport and packet codec.
- `test/` and `test-support/` — behavioral tests and synthetic FIT builders.

## Deployment

`.github/workflows/deploy-browser-tools.yml` runs `npm ci`, `npm test`, and `npm run build`, then publishes `dist/` at `/activity-dashboard/`. It also preserves `/rawtiles-exporter/` and publishes `Tools/site/` at the Pages root.

Generated `node_modules/`, `dist/`, and `_site/` directories are ignored and must not be committed.
