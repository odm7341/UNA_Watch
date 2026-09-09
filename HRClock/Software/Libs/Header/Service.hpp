/**
 ******************************************************************************
 * @file    Service.hpp
 * @date    27-August-2026
 * @author  Denys Saienko <denys.saienko@droid-technologies.com>
 * @brief   HRClock service: minute time, cheap sensors, duty-cycled HR.
 ******************************************************************************
 */

#ifndef SERVICE_HPP
#define SERVICE_HPP

#include "SDK/Kernel/Kernel.hpp"
#include "SDK/SensorLayer/SensorConnection.hpp"
#include "SDK/SensorLayer/SensorTypes.hpp"
#include "SDK/SensorLayer/SensorDataBatch.hpp"

#include <cstdint>
#include <ctime>

class Service
{
public:
    Service(SDK::Kernel &kernel);
    virtual ~Service();

    void run();

private:
    enum class HrState : uint8_t {
        Idle,
        Acquiring,
    };

    static constexpr uint32_t kStepGoal = 10000;
#if defined(SIMULATOR)
    static constexpr uint32_t kHrRefreshSeconds = 15;       ///< Preview-only acceleration
#else
    static constexpr uint32_t kHrRefreshSeconds = 15 * 60;  ///< Production default: 15 minutes
#endif
    static constexpr uint32_t kHrAcquireTimeoutSeconds = 15;
    static constexpr uint32_t kHrPeriodMs = 1000;
    static constexpr uint32_t kHrLatencyMs = 2000;

    void connect();
    void disconnect();
    void connectCheapSensors();
    void disconnectAllSensors();

    void handleSensorData(uint16_t handle, SDK::Sensor::DataBatch &data, std::time_t now);
    void handleBatteryData(SDK::Sensor::DataBatch &data);
    void handleStepData(SDK::Sensor::DataBatch &data);
    void handleHeartRateData(SDK::Sensor::DataBatch &data, std::time_t now);

    void serviceHeartRate(std::time_t now);
    void startHeartRate(std::time_t now);
    void stopHeartRate(bool success, std::time_t now);

    uint32_t nextWaitMs(const std::tm &local, std::time_t now) const;
    uint32_t msToNextHeartRateWork(std::time_t now) const;

    void publishTime(const std::tm &local);
    void publishBatteryLevel(uint8_t level);
    void publishSteps(uint32_t steps);
    void publishHeartRate(uint16_t bpm, uint8_t trustLevel, std::time_t timestamp);
    void publishAlertsMuted(bool muted);

    static uint32_t stepDisplayBucket(uint32_t steps);
    static uint8_t stepProgressPercent(uint32_t steps);

#ifdef PULSECLOCK_DEBUG_POWER
    void logPowerCounters(const char *event, std::time_t now) const;
#endif

    SDK::Kernel            &mKernel;
    SDK::Sensor::Connection mBatterySensor;
    SDK::Sensor::Connection mStepSensor;
    SDK::Sensor::Connection mHeartRateSensor;

    uint8_t mHour;
    uint8_t mMinute;
    uint8_t mMday;
    uint8_t mWday;
    bool    mTimeSent;

    uint8_t mLevel;
    bool    mLevelSent;

    uint32_t mSteps;
    uint32_t mStepBucket;
    uint8_t  mStepProgress;
    bool     mStepsSent;

    uint16_t mHeartRate;
    uint8_t  mHeartRateTrust;
    bool     mHeartRateSent;
    HrState  mHeartRateState;
    std::time_t mNextHeartRateAttempt;
    std::time_t mHeartRateStartedAt;
    bool        mHeartRateSawData;
    bool        mHeartRateSawValidData;

    bool mMuted;
    bool mMutedSent;

#ifdef PULSECLOCK_DEBUG_POWER
    uint32_t mHrStarts;
    uint32_t mHrActiveSeconds;
    uint32_t mHrSuccesses;
    uint32_t mHrFailures;
#endif
};

#endif // SERVICE_HPP
