#ifndef SERVICE_HPP
#define SERVICE_HPP

#include "RemainingTimeEstimator.hpp"
#include "HistoryStore.hpp"
#include "SDK/Glance/GlanceControl.hpp"
#include "SDK/Kernel/Kernel.hpp"
#include "SDK/SensorLayer/SensorConnection.hpp"
#include "SDK/SensorLayer/SensorDataBatch.hpp"

#include <cstdint>

class Service {
public:
    explicit Service(SDK::Kernel &kernel);
    ~Service();
    void run();

private:
    static constexpr uint32_t kMetricsPeriodMs = 60000;

    bool configureGlance();
    void createControls();
    void publishGlance();
    void refreshText();
    void connectSensors();
    void disconnectSensors();
    void handleSensorData(uint16_t handle, SDK::Sensor::DataBatch &data);
    void saveHistory();

    SDK::Kernel &mKernel;
    SDK::Glance::Form mForm;
    SDK::Glance::ControlText mTitle;
    SDK::Glance::ControlText mEstimateText;

    RemainingTimeEstimator mEstimator;
    HistoryStore mStore;
    uint32_t mLastSaveMs = 0;
    bool mSaveFailed = false;
    char mDisplayedText[32] = {};
    bool mSlowMetrics = false;

    SDK::Sensor::Connection mChargingSensor;
    SDK::Sensor::Connection mMetricsSensor;

    bool mChargingKnown = false;
    bool mCharging = false;
    bool mMetricsValid = false;
    float mCapacityMah = 0.0f;
    float mDesignCapacityMah = 0.0f;
};

#endif
