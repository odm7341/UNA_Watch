#include "SDK/Messages/SensorLayerMessages.hpp"
#include "Commands.hpp"

#include "SDK/Messages/MessageGuard.hpp"
#include "SDK/SensorLayer/DataParsers/SensorDataParserGpsLocation.hpp"

#include <cmath>


#include "Service.hpp"

#define LOG_MODULE_PRX      "Service"
#define LOG_MODULE_LEVEL    LOG_LEVEL_INFO
#include "SDK/UnaLogger/Logger.h"

Service::Service(SDK::Kernel& kernel)
    : mKernel(kernel)
    , mGpsSensor(SDK::Sensor::Type::GPS_LOCATION, kGpsPeriodMs)
    , mGUIStarted(false)
{}

void Service::run()
{
    LOG_INFO("thread started\n");

    while (true) {
        SDK::MessageBase *msg;
        if (mKernel.comm.getMessage(msg, 1000)) {
            // Command handling
            switch (msg->getType()) {
                // Kernel messages
                case SDK::MessageType::COMMAND_APP_STOP:
                    LOG_INFO("Force exit from the application\n");
                    mGpsSensor.disconnect();
                    mKernel.comm.releaseMessage(msg);
                    return;

                case SDK::MessageType::COMMAND_APP_NOTIF_GUI_RUN:
                    LOG_INFO("GUI is now running\n");
                    onStartGUI();
                    break;

                case SDK::MessageType::COMMAND_APP_NOTIF_GUI_STOP:
                    LOG_INFO("GUI stopped\n");
                    onStopGUI();
                    break;

                case SDK::MessageType::EVENT_SENSOR_LAYER_DATA: {
                    auto* event = static_cast<SDK::Message::Sensor::EventData*>(msg);
                    if (mGpsSensor.matchesDriver(event->handle)) {
                        SDK::Sensor::DataBatch batch(event->data, event->count, event->stride);
                        handleGpsData(batch);
                    }
                } break;

                default:
                    break;
            }

            // Release message after processing
            mKernel.comm.releaseMessage(msg);
        }
    }

    LOG_INFO("thread stopped\n");
}

void Service::onStartGUI()
{
    LOG_INFO("GUI started\n");
    mGUIStarted = true;
    mGpsSensor.connect();
}

void Service::onStopGUI()
{
    LOG_INFO("GUI stopped\n");
    mGUIStarted = false;
    mGpsSensor.disconnect();
}

void Service::handleGpsData(SDK::Sensor::DataBatch& data)
{
    if (data.size() == 0) {
        return;
    }

    SDK::SensorDataParser::GpsLocation parser(data[data.size() - 1]);
    if (!parser.isDataValid()) {
        return;
    }
    if (!parser.isCoordinatesValid()) {
        publishGpsLocation(false, 0, 0);
        return;
    }

    const int32_t latitudeUdeg = static_cast<int32_t>(std::lround(parser.getLatitude() * 1000000.0F));
    const int32_t longitudeUdeg = static_cast<int32_t>(std::lround(parser.getLongitude() * 1000000.0F));
    publishGpsLocation(true, latitudeUdeg, longitudeUdeg);
}

void Service::publishGpsLocation(bool valid, int32_t latitudeUdeg, int32_t longitudeUdeg)
{
    auto message = SDK::make_msg<MapExplorerMessage::GpsLocation>(mKernel);
    if (message) {
        message->valid = valid ? 1U : 0U;
        message->latitude = latitudeUdeg;
        message->longitude = longitudeUdeg;
        message.send();
    }
}

uint32_t Service::ParseVersion(const char* str)
{
    if (str == nullptr) {
        return 0;
    }

    typedef union {
        struct {
            uint8_t patch;
            uint8_t minor;
            uint8_t major;
        }ver;
        uint32_t u32;
    } FirmwareVersion_t;

    FirmwareVersion_t v{};

    int major, minor, patch;

    if (sscanf(str, "%d.%d.%d", &major, &minor, &patch) == 3) {
        v.ver.major = static_cast<uint8_t>(major);
        v.ver.minor = static_cast<uint8_t>(minor);
        v.ver.patch = static_cast<uint8_t>(patch);
        return v.u32;
    }

    return 0;
}
