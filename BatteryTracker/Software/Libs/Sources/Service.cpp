#include "Service.hpp"

#include "SDK/Messages/CommandMessages.hpp"
#include "SDK/Messages/MessageGuard.hpp"
#include "SDK/Messages/MessageTypes.hpp"
#include "SDK/Messages/SensorLayerMessages.hpp"
#include "SDK/SensorLayer/DataParsers/SensorDataParserBatteryCharging.hpp"
#include <ctime>
#include <cstdio>
#include <cstring>
#include "SDK/SensorLayer/DataParsers/SensorDataParserBatteryMetrics.hpp"

#define LOG_MODULE_PRX "BatteryGlance"
#define LOG_MODULE_LEVEL LOG_LEVEL_INFO
#include "SDK/UnaLogger/Logger.h"

Service::Service(SDK::Kernel &kernel)
    : mKernel(kernel)
    , mStore(kernel.fs)
    , mChargingSensor(SDK::Sensor::Type::BATTERY_CHARGING)
    , mMetricsSensor(SDK::Sensor::Type::BATTERY_METRICS,
                     1000, 0)
{
}

Service::~Service()
{
    disconnectSensors();
}

void Service::run()
{
    mStore.load(mEstimator);
    while (true) {
        SDK::MessageBase *message = nullptr;
        if (!mKernel.comm.getMessage(message)) continue;

        switch (message->getType()) {
            case SDK::MessageType::EVENT_GLANCE_START:
                if (!configureGlance()) {
                    mKernel.comm.releaseMessage(message);
                    mKernel.sys.exit(1);
                    return;
                }
                createControls();
                connectSensors();
                break;

            case SDK::MessageType::EVENT_GLANCE_TICK:
                refreshText();
                publishGlance();
                break;

            case SDK::MessageType::EVENT_SENSOR_LAYER_DATA: {
                auto *event = static_cast<SDK::Message::Sensor::EventData *>(message);
                SDK::Sensor::DataBatch batch(event->data, event->count, event->stride);
                handleSensorData(event->handle, batch);
            } break;

            case SDK::MessageType::COMMAND_APP_STOP:
            case SDK::MessageType::EVENT_GLANCE_STOP:
                saveHistory();
                disconnectSensors();
                mKernel.comm.releaseMessage(message);
                return;

            default:
                break;
        }
        mKernel.comm.releaseMessage(message);
    }
}

bool Service::configureGlance()
{
    if (auto config = SDK::make_msg<SDK::Message::RequestGlanceConfig>(mKernel)) {
        if (config.send(100) && config.ok() && config->maxControls >= 2) {
            mForm.setWidth(config->width);
            mForm.setHeight(config->height);
            return true;
        }
    }
    return false;
}

void Service::createControls()
{
    mTitle = mForm.createText();
    mTitle.pos({10, 0}, {220, 25})
        .font(GlanceFont_t::GLANCE_FONT_POPPINS_SEMIBOLD_20)
        .color(GlanceColor_t::GLANCE_COLOR_TEAL)
        .setText("Battery remaining")
        .alignment(GlanceAlignH_t::GLANCE_ALIGN_H_CENTER);

    mEstimateText = mForm.createText();
    mEstimateText.pos({8, 27}, {224, 40})
        .font(GlanceFont_t::GLANCE_FONT_POPPINS_SEMIBOLD_30)
        .color(GlanceColor_t::GLANCE_COLOR_WHITE)
        .setText("learning")
        .alignment(GlanceAlignH_t::GLANCE_ALIGN_H_CENTER);
}

void Service::connectSensors()
{
    if (!mChargingSensor.isConnected()) mChargingSensor.connect();
    if (!mMetricsSensor.isConnected()) mMetricsSensor.connect();
}

void Service::disconnectSensors()
{
    if (mMetricsSensor.isConnected()) mMetricsSensor.disconnect();
    if (mChargingSensor.isConnected()) mChargingSensor.disconnect();
}

void Service::handleSensorData(uint16_t handle, SDK::Sensor::DataBatch &data)
{
    if (data.size() == 0) return;
    const SDK::Sensor::DataView latest = data[data.size() - 1];

    const uint32_t now = static_cast<uint32_t>(time(nullptr));
    bool chargeTransition = false;
    if (mChargingSensor.matchesDriver(handle)) {
        SDK::SensorDataParser::BatteryCharging parser(latest);
        if (!parser.isDataValid()) { mChargingKnown = false; refreshText(); return; }
        const bool charging = parser.isCharging() || parser.isUsbConnected();
        chargeTransition = charging != mCharging;
        mChargingKnown = true;
        mCharging = charging;
        // Do not combine a previous charging sample with a new discharge state.
        if (chargeTransition) mMetricsValid = false;
        if (mCharging) mEstimator.charging();
    } else if (mMetricsSensor.matchesDriver(handle)) {
        SDK::SensorDataParser::BatteryMetrics parser(latest);
        mMetricsValid = parser.isDataValid()
            && RemainingTimeEstimator::valid(now, parser.getCapacity(), parser.getDesignCapacity());
        if (mMetricsValid) {
            mCapacityMah = parser.getCapacity();
            mDesignCapacityMah = parser.getDesignCapacity();
        }
        if (!mSlowMetrics) {
            // One prompt reading on entry; subsequent requests are minute-spaced.
            mMetricsSensor.disconnect();
            mMetricsSensor.connect(kMetricsPeriodMs, 0);
            mSlowMetrics = true;
        }
    }
    if (mChargingKnown && !mCharging && mMetricsValid) {
        mEstimator.observe(now, mCapacityMah, mDesignCapacityMah);
    }
    if (chargeTransition || !mLastSaveMs || mKernel.sys.getTimeMs() - mLastSaveMs >= 60000U) {
        saveHistory();
    }
    refreshText();
}

void Service::refreshText()
{
    const auto estimate = mEstimator.result(static_cast<uint32_t>(time(nullptr)),
        mChargingKnown, mCharging, mMetricsValid, mCapacityMah);
    char text[32] = {};
    if (mSaveFailed) {
        std::strcpy(text, "save error");
    } else if (estimate.state == RemainingTimeEstimator::State::Charging) {
        std::strcpy(text, "charging");
    } else if (estimate.state != RemainingTimeEstimator::State::Ready) {
        std::strcpy(text, mEstimator.history().rateUtc ? "checking" : "learning");
    } else if (estimate.minutes < 60) {
        std::snprintf(text, sizeof(text), "~%u min", static_cast<unsigned>(estimate.minutes));
    } else if (estimate.minutes < 48U * 60U) {
        std::snprintf(text, sizeof(text), "~%u hours", static_cast<unsigned>((estimate.minutes + 30U) / 60U));
    } else {
        std::snprintf(text, sizeof(text), "~%u days", static_cast<unsigned>((estimate.minutes + 720U) / 1440U));
    }
    if (std::strcmp(text, mDisplayedText) != 0) {
        std::strcpy(mDisplayedText, text);
        mEstimateText.setText(text);
    }
}

void Service::publishGlance()
{
    if (!mForm.isInvalid()) return;
    if (auto update = SDK::make_msg<SDK::Message::RequestGlanceUpdate>(mKernel)) {
        update->name = APP_NAME;
        update->controls = mForm.data();
        update->controlsNumber = static_cast<uint32_t>(mForm.size());
        update.send(100);
    }
    mForm.setValid();
}

void Service::saveHistory()
{
    mSaveFailed = !mStore.save(mEstimator);
    mLastSaveMs = mKernel.sys.getTimeMs();
    if (mSaveFailed) LOG_ERROR("Battery history save failed\n");
}
