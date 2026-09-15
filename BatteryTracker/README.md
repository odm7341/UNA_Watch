# Battery Time Glance

Battery Time shows approximate remaining battery life without repeating the system battery percentage.

## Estimation

The app measures remaining-capacity loss over elapsed UTC time, including time between glance visits when the app is not running:

```text
consumption (mAh/hour) = capacity lost / elapsed hours
remaining hours = current capacity / learned consumption
```

Initially the display says `learning`. Open the glance to establish an observation, then use the watch normally and revisit after sufficient discharge. Leaving and returning does not discard learning. A previously learned estimate resumes once fresh capacity and charging state arrive (`checking` while waiting); there is no six-sample warm-up. The service requests an initial reading at a one-second period, then switches to one-minute reporting after the first metrics event, with no requested batching delay.

It never uses instantaneous or firmware-filtered current to predict runtime. A new discharge interval must span at least one hour and lose at least 2% of design capacity before contributing to the rate. Intervals are weighted by elapsed time, with historical weight capped at 24 hours so usage changes can affect the estimate. This is an extrapolation of observed use, not a guarantee of future runtime.

Charging breaks the active measurement interval without discarding the learned discharge rate. Capacity increases exceeding 1% of design capacity also break it. Clock reversals, capacity-design changes, or observation gaps longer than three days reset history. Rates older than seven days are not shown. Unsupported/invalid capacity data does not fall back to a current-based guess.

The SDK does not expose a charging-history counter: a charge and subsequent discharge entirely between visits can go undetected if capacity ends lower. Likewise, a forward clock adjustment can distort an interval. A glance-only app cannot reliably distinguish those events from ordinary discharge with the available observations.

## Power and persistence

- No background service, wake-up timers, or sampling while glances are closed.
- Capacity/charging subscriptions exist only while the glance service is active.
- No redundant text updates when the displayed value has not changed.
- Two alternating 44-byte, versioned/checksummed snapshots retain observations and the learned rate. A torn write leaves the previous snapshot available.
- Writes occur at most once per minute while open, plus charging transitions and exit; unchanged state is not rewritten.
- App-relative storage: `../SharedData/BatteryTime/history-{a,b}.bin`. On the watch this is `Apps/SharedData/BatteryTime/`.
- Storage failures show `save error` rather than silently claiming persistence.

No browser or phone integration. Actual power consumption and firmware filesystem behavior still require hardware verification; the implementation adds no work while its service is stopped.

## Build and verification

Set `UNA_SDK` to your local SDK checkout, then:

```sh
mkdir -p BatteryTracker/Output
cmake -G "Unix Makefiles" -S BatteryTracker/Software/Apps/BatteryTracker-CMake -B BatteryTracker/Software/Apps/BatteryTracker-CMake/build
cmake --build BatteryTracker/Software/Apps/BatteryTracker-CMake/build

g++ -std=c++17 -Wall -Wextra -Werror -I BatteryTracker/Software/Libs/Header -I una-sdk/Libs/Header BatteryTracker/Tests/DischargeHistory.cpp -o /tmp/battery-history-test
/tmp/battery-history-test
```

Install `BatteryTracker/Output/BatteryTracker_*.uapp` in `Apps/BatteryTracker/`, safely eject, disconnect USB, and reboot. Open **Battery Time** in the glance carousel.
