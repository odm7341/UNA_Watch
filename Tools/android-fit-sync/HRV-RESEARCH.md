# UNA HRV investigation — 2026-11-18

## Finding

**Decision:** custom-kernel development and the proposed HRV Check app are
deferred at the user's request. This document records research, not an active
firmware implementation plan.

The public kernel source changes the feasibility assessment: its vendor
library includes an HRV algorithm and the driver already acquires raw PPG.
An experimental firmware integration is plausible. HRV is still not exposed
in the imported daily history or documented app-facing sensor payloads.
Do not derive HRV from minute HR, smoothed BPM, or variance of sleep epochs.

## Kernel-source findings

Inspected `UNAWatch/una-kernel-public` at
`52f0d6cbee0787d03fa21e320e501237354b7ef0`.

- `Software/ThirdParty/VendorLib/README.md` documents PixArt HRV V3131,
  providing R-R intervals, SDNN, RMSSD, LF/HF and respiration rate.
- `include/pixart/alg/pxialg_hrv_v3.h` declares `HHRVGetRMSSD`,
  `HHRVGetSDNN`, online RRI/time/confidence, readiness and quality getters.
  The downloaded ARM library actually defines these symbols; disassembly
  confirms `HHRVGetRMSSD` forwards to `hrv_get_rmssd_v3`. This is more than
  an unused header, but does not establish validated on-watch results.
- The documented HRV sensor profile is `PAH831X_PPG_REG_SETTING_3`,
  25 Hz, one green LED. The current `PAH8316LS::powerUp()` selects profile 1,
  20 Hz, both green LEDs, for the HRD algorithm.
- `PAH8316LS::processAlgo()` receives raw PPG/DAC samples with batch timestamps
  and aligns accelerometer samples before calling `PixArtHrSession::process()`.
  That session uses `pah8series_entrance` and publishes BPM/trust; it does not
  invoke the HRV API.
- The repository documents reproducible custom `.ota` builds and installation
  through the bootloader or official app.

Recommended first implementation: a bounded, opt-in resting spot-measurement
mode in the kernel, using the documented HRV profile and vendor algorithm.
Validate units, timing, quality gates, memory consumption, recovery/cleanup,
and coexistence with regular HR before considering overnight integration.
Export validated RMSSD through Health Connect's RMSSD record type; retain
SDNN and source quality separately rather than substituting them for RMSSD.
No custom firmware has been built or flashed in this investigation.

## Evidence

- The current public SDK's `HeartRateMetrics` parser exposes exactly two
  fields: average HR and resting HR. It contains no RMSSD/SDNN/HRV field.
- `HEART_BEAT` (0x40) and raw `PPG` (0xF0) appear in the sensor enum, but
  the public sensor table provides no parser or field layout. An enum entry
  alone does not establish firmware support.
- SleepVue ADR-0002 reports its September 14, 2026 diagnostic found
  `HEART_BEAT` unregistered (`isValid() == 0`) and zero beat events in three
  sessions. This is an upstream finding, not a new test of the user's current
  firmware. That investigation did not probe raw PPG.
- The inspected DailyHealth history contains `restingHeartRate`,
  `averageHeartRate`, and 1440 HR minute buckets, plus activity totals.
  There are no RR intervals or HRV summaries.
- Newer external-sensor support and `HEART_RATE_EX` expose optical/external
  BPM and confidence/source information, not RR intervals.
- The user's saved `prb_*.csv` files did not contain the upstream `K,`
  diagnostic lines, so they do not independently establish current beat
  sensor availability.

## Next experiment, if pursuing firmware capability

Run a short, manually launched daytime diagnostic that requests sensor
handles/descriptors for HEART_BEAT and PPG and checks connection/event delivery.
Do not modify SleepVue or install an overnight recorder for this test.
If a stream exists, obtain its field units, sampling rate, timestamp semantics,
and signal-quality definition from UNA before interpreting it.

Raw PPG availability would only enable further research: reliable pulse-interval
extraction, motion/artifact rejection, and validation against a beat-interval
reference are still required. It is not an immediate HRV export solution.

A practical independent source is a BLE chest strap that actually transmits
RR intervals, read directly by a phone app. The documented UNA accessory API
does not currently provide those intervals to watch apps.

## Sources

- https://github.com/UNAWatch/una-sdk/blob/main/Docs/SensorsLayer.md
- https://github.com/UNAWatch/una-sdk/blob/main/Libs/Header/SDK/SensorLayer/DataParsers/SensorDataParserHeartRateMetrics.hpp
- https://github.com/UNAWatch/una-sdk/blob/main/Docs/ExternalSensors.md
- https://github.com/UNAWatch/una-kernel-public/tree/52f0d6cbee0787d03fa21e320e501237354b7ef0
- https://github.com/UNAWatch/una-kernel-public/blob/52f0d6cbee0787d03fa21e320e501237354b7ef0/Software/ThirdParty/VendorLib/README.md
- Locally checked SleepVue checkout: `docs/adr/0002-hrv-free-rem-signal.md`
  and `CONTEXT.md` (HRV and RR interval definitions).

No watch software or recording configuration was changed during this investigation.
