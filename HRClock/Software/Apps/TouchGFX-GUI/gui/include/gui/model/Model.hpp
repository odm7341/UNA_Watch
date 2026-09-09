#ifndef MODEL_HPP
#define MODEL_HPP

#include "SDK/Kernel/Kernel.hpp"
#include "SDK/Interfaces/IGuiLifeCycleCallback.hpp"
#include "SDK/Interfaces/ICustomMessageHandler.hpp"

#include <cstdint>

struct WallTime
{
    uint8_t hour;       ///< 0..23
    uint8_t minute;     ///< 0..59
    uint8_t mday;       ///< Day of month, 1..31
    uint8_t wday;       ///< Day of week, 0 = Sunday

    bool operator==(const WallTime &o) const
    {
        return (hour == o.hour) && (minute == o.minute) &&
               (mday == o.mday) && (wday == o.wday);
    }
};

struct HrSample
{
    uint16_t bpm;
    uint8_t  trustLevel;
    uint32_t timestamp;
};

class FrontendApplication;
class ModelListener;

class Model : public SDK::Interface::IGuiLifeCycleCallback,
              public SDK::Interface::ICustomMessageHandler
{
public:
    static constexpr uint8_t kHrHistorySize = 16;

    Model();

    void bind(ModelListener *listener)
    {
        modelListener = listener;
    }

    FrontendApplication &application();
    void tick();

    WallTime currentTime() const { return mTime; }
    uint8_t batteryLevel() const { return mBatteryLevel; }
    uint32_t steps() const { return mSteps; }
    uint16_t heartRate() const { return mHeartRate; }
    uint8_t heartRateTrustLevel() const { return mHeartRateTrustLevel; }
    uint32_t heartRateTimestamp() const { return mHeartRateTimestamp; }
    uint8_t heartRateHistoryCount() const { return mHrHistoryCount; }
    const HrSample &heartRateSampleAt(uint8_t index) const;
    bool alertsMuted() const { return mAlertsMuted; }

protected:
    ModelListener *modelListener;
    const SDK::Kernel &mKernel;

    bool mResumed = false;

    WallTime mTime {};
    uint8_t  mBatteryLevel = 0;
    uint32_t mSteps = 0;
    uint16_t mHeartRate = 0;
    uint8_t  mHeartRateTrustLevel = 0;
    uint32_t mHeartRateTimestamp = 0;
    HrSample mHrHistory[kHrHistorySize] {};
    uint8_t  mHrHistoryCount = 0;
    uint8_t  mHrHistoryHead = 0;
    bool     mAlertsMuted = false;

    void onStart()   override;
    void onResume()  override;
    void onSuspend() override;
    void onStop()    override;

    bool customMessageHandler(SDK::MessageBase *message) override;

    WallTime now() const;
    void adopt(const WallTime &time);
    void addHeartRateSample(uint16_t bpm, uint8_t trustLevel, uint32_t timestamp);
};

#endif // MODEL_HPP
