#include "Service.hpp"
#include "Commands.hpp"

#include "SDK/Messages/MessageBase.hpp"
#include "SDK/Messages/MessageTypes.hpp"
#include "SDK/Messages/MessageGuard.hpp"
#include "SDK/Messages/SensorLayerMessages.hpp"
#include "SDK/SensorLayer/DataParsers/SensorDataParserBatteryLevel.hpp"
#include "SDK/SensorLayer/DataParsers/SensorDataParserHeartRate.hpp"
#include "SDK/SensorLayer/DataParsers/SensorDataParserStepCounter.hpp"

#include <ctime>

#define LOG_MODULE_PRX      "Service"
#define LOG_MODULE_LEVEL    LOG_LEVEL_INFO
#include "SDK/UnaLogger/Logger.h"

static constexpr uint32_t kSecondsPerMinute = 60;
static constexpr uint32_t kMsPerSecond      = 1000;

static std::time_t readLocalTime(std::tm &out)
{
    std::time_t utc = time(nullptr);

#if defined(_WIN32) || defined(_WIN64)
    localtime_s(&out, &utc);
#else
    localtime_r(&utc, &out);
#endif

    return utc;
}

static uint32_t msToNextMinute(const std::tm &local)
{
    const uint32_t sec = static_cast<uint32_t>(local.tm_sec) % kSecondsPerMinute;
    return (kSecondsPerMinute - sec) * kMsPerSecond;
}

Service::Service(SDK::Kernel &kernel)
    : mKernel(kernel)
    , mBatterySensor(SDK::Sensor::Type::BATTERY_LEVEL)
    , mStepSensor(SDK::Sensor::Type::STEP_COUNTER)
    , mHeartRateSensor(SDK::Sensor::Type::HEART_RATE, kHrPeriodMs, kHrLatencyMs)
    , mHour(0)
    , mMinute(0)
    , mMday(0)
    , mWday(0)
    , mTimeSent(false)
    , mLevel(0)
    , mLevelSent(false)
    , mSteps(0)
    , mStepBucket(0)
    , mStepProgress(0)
    , mStepsSent(false)
    , mHeartRate(0)
    , mHeartRateTrust(0)
    , mHeartRateSent(false)
    , mHeartRateState(HrState::Idle)
    , mNextHeartRateAttempt(0)
    , mHeartRateStartedAt(0)
    , mHeartRateSawData(false)
    , mHeartRateSawValidData(false)
    , mMuted(false)
    , mMutedSent(false)
#ifdef PULSECLOCK_DEBUG_POWER
    , mHrStarts(0)
    , mHrActiveSeconds(0)
    , mHrSuccesses(0)
    , mHrFailures(0)
#endif
{
}

Service::~Service()
{
    disconnect();
}

void Service::run()
{
    LOG_INFO("Started\n");
    connect();

    while (true) {
        std::tm local {};
        const std::time_t now = readLocalTime(local);
        publishTime(local);
        serviceHeartRate(now);

        SDK::MessageBase *msg;
        if (!mKernel.comm.getMessage(msg, nextWaitMs(local, now))) {
            continue;
        }

        bool done = false;

        switch (msg->getType()) {
            case SDK::MessageType::EVENT_SENSOR_LAYER_DATA: {
                auto *event = static_cast<SDK::Message::Sensor::EventData*>(msg);
                SDK::Sensor::DataBatch batch(event->data, event->count, event->stride);
                handleSensorData(event->handle, batch, std::time(nullptr));
            } break;

            case SDK::MessageType::COMMAND_APP_NOTIF_GUI_RUN:
                LOG_INFO("GUI is now running\n");
                break;

            case SDK::MessageType::COMMAND_APP_STOP:
            case SDK::MessageType::COMMAND_APP_NOTIF_GUI_STOP:
                done = true;
                break;

            default:
                break;
        }

        mKernel.comm.releaseMessage(msg);

        if (done) {
            LOG_INFO("Exiting\n");
            disconnect();
            return;
        }
    }
}

void Service::connect()
{
    connectCheapSensors();
}

void Service::disconnect()
{
    disconnectAllSensors();
}

void Service::connectCheapSensors()
{
    if (!mBatterySensor.isConnected()) {
        mBatterySensor.connect();
    }

    if (!mStepSensor.isConnected()) {
        mStepSensor.connect();
    }
}

void Service::disconnectAllSensors()
{
    if (mHeartRateSensor.isConnected()) {
        mHeartRateSensor.disconnect();
    }
    mHeartRateState = HrState::Idle;

    if (mStepSensor.isConnected()) {
        mStepSensor.disconnect();
    }

    if (mBatterySensor.isConnected()) {
        mBatterySensor.disconnect();
    }
}

void Service::handleSensorData(uint16_t handle, SDK::Sensor::DataBatch &data, std::time_t now)
{
    if (mBatterySensor.matchesDriver(handle)) {
        handleBatteryData(data);
        return;
    }

    if (mStepSensor.matchesDriver(handle)) {
        handleStepData(data);
        return;
    }

    if (mHeartRateSensor.matchesDriver(handle)) {
        handleHeartRateData(data, now);
    }
}

void Service::handleBatteryData(SDK::Sensor::DataBatch &data)
{
    if (data.size() == 0) {
        return;
    }

    SDK::SensorDataParser::BatteryLevel parser(data[data.size() - 1]);
    if (parser.isDataValid()) {
        publishBatteryLevel(static_cast<uint8_t>(parser.getCharge()));
    }
}

void Service::handleStepData(SDK::Sensor::DataBatch &data)
{
    if (data.size() == 0) {
        return;
    }

    SDK::SensorDataParser::StepCounter parser(data[data.size() - 1]);
    if (parser.isDataValid()) {
        publishSteps(parser.getStepCount());
    }
}

void Service::handleHeartRateData(SDK::Sensor::DataBatch &data, std::time_t now)
{
    if ((mHeartRateState != HrState::Acquiring) || (data.size() == 0)) {
        return;
    }

    if (!mHeartRateSawData) {
        mHeartRateSawData = true;
        LOG_INFO("HR first data at %lu\n", static_cast<unsigned long>(now));
    }

    SDK::SensorDataParser::HeartRate parser(data[data.size() - 1]);
    if (!parser.isDataValid()) {
        return;
    }

    if (!mHeartRateSawValidData) {
        mHeartRateSawValidData = true;
        LOG_INFO("HR first valid data at %lu\n", static_cast<unsigned long>(now));
    }

    const float bpm = parser.getBpm();
    if (bpm < 1.0f) {
        return;
    }

    uint16_t clamped = static_cast<uint16_t>(bpm > 65535.0f ? 65535.0f : bpm);
    LOG_INFO("HR accepted sample at %lu bpm=%u trust=%u\n",
             static_cast<unsigned long>(now),
             static_cast<unsigned>(clamped),
             static_cast<unsigned>(parser.getTrustLevel()));
    publishHeartRate(clamped, static_cast<uint8_t>(parser.getTrustLevel()), now);
    stopHeartRate(true, now);
}

void Service::serviceHeartRate(std::time_t now)
{
    if (mHeartRateState == HrState::Acquiring) {
        if (static_cast<uint32_t>(now - mHeartRateStartedAt) >= kHrAcquireTimeoutSeconds) {
            LOG_INFO("HR acquisition timed out after %u s\n", static_cast<unsigned>(kHrAcquireTimeoutSeconds));
            stopHeartRate(false, now);
        }
        return;
    }

    if (now >= mNextHeartRateAttempt) {
        startHeartRate(now);
    }
}

void Service::startHeartRate(std::time_t now)
{
    if (mHeartRateSensor.isConnected()) {
        mHeartRateState = HrState::Acquiring;
        mHeartRateStartedAt = now;
        mHeartRateSawData = false;
        mHeartRateSawValidData = false;
        return;
    }

    LOG_INFO("HR acquisition start at %lu\n", static_cast<unsigned long>(now));

    if (!mHeartRateSensor.connect()) {
        LOG_INFO("HR acquisition unavailable; retry at normal interval\n");
        mNextHeartRateAttempt = now + kHrRefreshSeconds;
#ifdef PULSECLOCK_DEBUG_POWER
        ++mHrFailures;
        logPowerCounters("hr-connect-failed", now);
#endif
        return;
    }

    mHeartRateState = HrState::Acquiring;
    mHeartRateStartedAt = now;
    mHeartRateSawData = false;
    mHeartRateSawValidData = false;
#ifdef PULSECLOCK_DEBUG_POWER
    ++mHrStarts;
    logPowerCounters("hr-start", now);
#endif
}

void Service::stopHeartRate(bool success, std::time_t now)
{
    if (mHeartRateSensor.isConnected()) {
        mHeartRateSensor.disconnect();
    }

    const uint32_t activeSeconds = static_cast<uint32_t>(now - mHeartRateStartedAt);
    LOG_INFO("HR acquisition stop at %lu after %u s (%s)\n",
             static_cast<unsigned long>(now),
             static_cast<unsigned>(activeSeconds),
             success ? "ok" : "failed");

    mHeartRateState = HrState::Idle;
    mNextHeartRateAttempt = now + kHrRefreshSeconds;

#ifdef PULSECLOCK_DEBUG_POWER
    mHrActiveSeconds += activeSeconds;
    if (success) {
        ++mHrSuccesses;
    } else {
        ++mHrFailures;
    }
    logPowerCounters(success ? "hr-success" : "hr-timeout", now);
#endif
}

uint32_t Service::nextWaitMs(const std::tm &local, std::time_t now) const
{
    uint32_t wait = msToNextMinute(local);
    const uint32_t hrWait = msToNextHeartRateWork(now);
    if (hrWait < wait) {
        wait = hrWait;
    }
    return wait == 0 ? 1 : wait;
}

uint32_t Service::msToNextHeartRateWork(std::time_t now) const
{
    if (mHeartRateState == HrState::Acquiring) {
        const std::time_t deadline = mHeartRateStartedAt + kHrAcquireTimeoutSeconds;
        return now >= deadline ? 1 : static_cast<uint32_t>(deadline - now) * kMsPerSecond;
    }

    return now >= mNextHeartRateAttempt ? 1 : static_cast<uint32_t>(mNextHeartRateAttempt - now) * kMsPerSecond;
}

void Service::publishTime(const std::tm &local)
{
    const uint8_t hour   = static_cast<uint8_t>(local.tm_hour);
    const uint8_t minute = static_cast<uint8_t>(local.tm_min);
    const uint8_t mday   = static_cast<uint8_t>(local.tm_mday);
    const uint8_t wday   = static_cast<uint8_t>(local.tm_wday);

    if (mTimeSent && (hour == mHour) && (minute == mMinute) &&
        (mday == mMday) && (wday == mWday)) {
        return;
    }

    mHour     = hour;
    mMinute   = minute;
    mMday     = mday;
    mWday     = wday;
    mTimeSent = true;

    SDK::send_msg<CustomMessage::Time>(mKernel, hour, minute, mday, wday);
}

void Service::publishBatteryLevel(uint8_t level)
{
    if (mLevelSent && (level == mLevel)) {
        return;
    }

    mLevel     = level;
    mLevelSent = true;

    SDK::send_msg<CustomMessage::Battery>(mKernel, mLevel);
}

void Service::publishSteps(uint32_t steps)
{
    const uint32_t bucket = stepDisplayBucket(steps);
    const uint8_t progress = stepProgressPercent(steps);

    if (mStepsSent && (bucket == mStepBucket) && (progress == mStepProgress)) {
        return;
    }

    mSteps = steps;
    mStepBucket = bucket;
    mStepProgress = progress;
    mStepsSent = true;

    SDK::send_msg<CustomMessage::Steps>(mKernel, mSteps);
}

void Service::publishHeartRate(uint16_t bpm, uint8_t trustLevel, std::time_t timestamp)
{
    mHeartRate = bpm;
    mHeartRateTrust = trustLevel;
    mHeartRateSent = true;

    SDK::send_msg<CustomMessage::HeartRate>(mKernel, mHeartRate, mHeartRateTrust,
                                            static_cast<uint32_t>(timestamp));
}

void Service::publishAlertsMuted(bool muted)
{
    if (mMutedSent && (muted == mMuted)) {
        return;
    }

    mMuted     = muted;
    mMutedSent = true;

    SDK::send_msg<CustomMessage::AlertsMuted>(mKernel, mMuted);
}

uint32_t Service::stepDisplayBucket(uint32_t steps)
{
    return steps < 1000 ? steps : (steps / 100);
}

uint8_t Service::stepProgressPercent(uint32_t steps)
{
    if (steps >= kStepGoal) {
        return 100;
    }
    return static_cast<uint8_t>((steps * 100U) / kStepGoal);
}

#ifdef PULSECLOCK_DEBUG_POWER
void Service::logPowerCounters(const char *event, std::time_t now) const
{
    LOG_INFO("POWER %s t=%lu hrStarts=%u hrActiveS=%u hrOk=%u hrFail=%u\n",
             event,
             static_cast<unsigned long>(now),
             static_cast<unsigned>(mHrStarts),
             static_cast<unsigned>(mHrActiveSeconds),
             static_cast<unsigned>(mHrSuccesses),
             static_cast<unsigned>(mHrFailures));
}
#endif
