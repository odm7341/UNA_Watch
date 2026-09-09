#ifndef __SERVICE_HPP__
#define __SERVICE_HPP__

#include "SDK/Kernel/KernelProviderService.hpp"
#include "SDK/Interfaces/ISensorDataListener.hpp"
#include "SDK/SensorLayer/SensorConnection.hpp"
#include "SDK/SensorLayer/SensorDataBatch.hpp"

class Service
{
public:
    Service(SDK::Kernel& kernel);

    virtual ~Service() = default;

    void run();

private:
    static constexpr float kGpsPeriodMs = 1000.0F;

    SDK::Kernel&             mKernel;
    SDK::Sensor::Connection  mGpsSensor;
    bool                     mGUIStarted;

    void handleGpsData(SDK::Sensor::DataBatch& data);
    void publishGpsLocation(bool valid, int32_t latitudeUdeg, int32_t longitudeUdeg);

    void onStartGUI();
    void onStopGUI();

    static uint32_t ParseVersion(const char* str);
};

#endif
