# HRClock

HRClock is a 240×240 dashboard for UNA Watch. It presents time, date, battery level, steps, current heart rate, and heart-rate history.

## Current app type

HRClock currently builds as a **Utility**. The released UNA firmware registers third-party `Clockface` packages but does not yet expose the watch-face selector required to activate them. This keeps HRClock launchable from the utility flow today.

When UNA ships the official third-party watch-face selector, HRClock is intended to become a real watch face again by changing `APP_TYPE` in `Software/Apps/HRClock-CMake/CMakeLists.txt` from `Utility` to `Clockface` and rebuilding.

## Build

Build against a local UNA SDK checkout using the STMicroelectronics ARM toolchain:

```sh
export UNA_SDK=/path/to/una-sdk
export PATH=/opt/st/stm32cubeclt_1.22.0/GNU-tools-for-STM32/bin:$PATH

cmake -S Software/Apps/HRClock-CMake -B build-app -G "Unix Makefiles"
cmake --build build-app
```

The package is emitted under `build-app/` and `Output/`. Build artifacts are intentionally not tracked.
