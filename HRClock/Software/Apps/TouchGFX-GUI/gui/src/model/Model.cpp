#include <gui/model/Model.hpp>
#include <gui/model/ModelListener.hpp>
#include <gui/common/FrontendApplication.hpp>

#include "SDK/Kernel/KernelProviderGUI.hpp"
#include "SDK/Port/TouchGFX/TouchGFXCommandProcessor.hpp"

#include "Commands.hpp"

#include <ctime>

#define LOG_MODULE_PRX      "Model"
#define LOG_MODULE_LEVEL    LOG_LEVEL_INFO
#include "SDK/UnaLogger/Logger.h"

Model::Model()
    : modelListener(nullptr)
    , mKernel(SDK::KernelProviderGUI::GetInstance().getKernel())
{
    SDK::TouchGFXCommandProcessor::GetInstance().setAppLifeCycleCallback(this);
    SDK::TouchGFXCommandProcessor::GetInstance().setCustomMessageHandler(this);

    mTime = now();

#if defined(SIMULATOR)
    LOG_INFO("Simulator.\n");
#endif
}

WallTime Model::now() const
{
    std::tm local {};
    std::time_t utc = std::time(nullptr);

#if defined(_WIN32) || defined(_WIN64)
    localtime_s(&local, &utc);
#else
    localtime_r(&utc, &local);
#endif

    return { static_cast<uint8_t>(local.tm_hour),
             static_cast<uint8_t>(local.tm_min),
             static_cast<uint8_t>(local.tm_mday),
             static_cast<uint8_t>(local.tm_wday) };
}

FrontendApplication& Model::application()
{
    return *static_cast<FrontendApplication*>(touchgfx::Application::getInstance());
}

void Model::tick()
{
    if (!mResumed) {
        return;
    }

    mResumed = false;
    adopt(now());
    application().invalidate();
}

void Model::adopt(const WallTime &time)
{
    if (mTime == time) {
        return;
    }

    mTime = time;

    if (modelListener) {
        modelListener->onTime(mTime);
    }
}

const HrSample &Model::heartRateSampleAt(uint8_t index) const
{
    static const HrSample empty { 0, 0, 0 };
    if (index >= mHrHistoryCount) {
        return empty;
    }

    const uint8_t first = static_cast<uint8_t>((mHrHistoryHead + kHrHistorySize - mHrHistoryCount) % kHrHistorySize);
    return mHrHistory[(first + index) % kHrHistorySize];
}

void Model::addHeartRateSample(uint16_t bpm, uint8_t trustLevel, uint32_t timestamp)
{
    mHrHistory[mHrHistoryHead] = { bpm, trustLevel, timestamp };
    mHrHistoryHead = static_cast<uint8_t>((mHrHistoryHead + 1U) % kHrHistorySize);
    if (mHrHistoryCount < kHrHistorySize) {
        ++mHrHistoryCount;
    }
}

void Model::onStart()
{
    LOG_INFO("Started\n");
}

void Model::onResume()
{
    mResumed = true;
}

void Model::onSuspend()
{
}

void Model::onStop()
{
    LOG_INFO("Force exit from the application\n");
}

bool Model::customMessageHandler(SDK::MessageBase *message)
{
    if (!message) {
        return false;
    }

    switch (message->getType()) {
        case CustomMessage::TIME: {
            auto *msg = static_cast<CustomMessage::Time*>(message);
            adopt(WallTime{ msg->hour, msg->minute, msg->mday, msg->wday });
        } break;

        case CustomMessage::BATTERY: {
            auto *msg = static_cast<CustomMessage::Battery*>(message);
            if (mBatteryLevel != msg->level) {
                mBatteryLevel = msg->level;
                if (modelListener) {
                    modelListener->onBatteryLevel(mBatteryLevel);
                }
            }
        } break;

        case CustomMessage::STEPS: {
            auto *msg = static_cast<CustomMessage::Steps*>(message);
            if (mSteps != msg->count) {
                mSteps = msg->count;
                if (modelListener) {
                    modelListener->onSteps(mSteps);
                }
            }
        } break;

        case CustomMessage::HEART_RATE: {
            auto *msg = static_cast<CustomMessage::HeartRate*>(message);
            mHeartRate = msg->bpm;
            mHeartRateTrustLevel = msg->trustLevel;
            mHeartRateTimestamp = msg->timestamp;
            addHeartRateSample(mHeartRate, mHeartRateTrustLevel, mHeartRateTimestamp);
            if (modelListener) {
                modelListener->onHeartRateSample(mHeartRate, mHeartRateTrustLevel, mHeartRateTimestamp);
            }
        } break;

        case CustomMessage::ALERTS_MUTED: {
            auto *msg = static_cast<CustomMessage::AlertsMuted*>(message);
            if (mAlertsMuted != msg->muted) {
                mAlertsMuted = msg->muted;
                if (modelListener) {
                    modelListener->onAlertsMuted(mAlertsMuted);
                }
            }
        } break;

        default:
            break;
    }

    return true;
}
