#ifndef MODELLISTENER_HPP
#define MODELLISTENER_HPP

#include <gui/model/Model.hpp>
#include <gui/common/FrontendApplication.hpp>

class ModelListener
{
public:
    ModelListener() : model(0) {}
    virtual ~ModelListener() {}

    void bind(Model* m)
    {
        model = m;
    }

    virtual void onTime(const WallTime &time) { (void)time; }
    virtual void onBatteryLevel(uint8_t level) { (void)level; }
    virtual void onSteps(uint32_t steps) { (void)steps; }
    virtual void onHeartRateSample(uint16_t bpm, uint8_t trustLevel, uint32_t timestamp)
    {
        (void)bpm;
        (void)trustLevel;
        (void)timestamp;
    }
    virtual void onAlertsMuted(bool muted) { (void)muted; }

protected:
    Model* model;
};

#endif // MODELLISTENER_HPP
