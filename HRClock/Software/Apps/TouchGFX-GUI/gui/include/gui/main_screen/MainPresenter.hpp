#ifndef MAINPRESENTER_HPP
#define MAINPRESENTER_HPP

#include <gui/model/ModelListener.hpp>
#include <mvp/Presenter.hpp>

using namespace touchgfx;

class MainView;

class MainPresenter : public touchgfx::Presenter, public ModelListener
{
public:
    MainPresenter(MainView& v);

    virtual void activate();
    virtual void deactivate();
    virtual ~MainPresenter() {}

    WallTime currentTime() const { return model->currentTime(); }
    uint8_t batteryLevel() const { return model->batteryLevel(); }
    uint32_t steps() const { return model->steps(); }
    uint16_t heartRate() const { return model->heartRate(); }
    uint8_t heartRateTrustLevel() const { return model->heartRateTrustLevel(); }
    uint32_t heartRateTimestamp() const { return model->heartRateTimestamp(); }
    uint8_t heartRateHistoryCount() const { return model->heartRateHistoryCount(); }
    const HrSample &heartRateSampleAt(uint8_t index) const { return model->heartRateSampleAt(index); }
    bool alertsMuted() const { return model->alertsMuted(); }

    virtual void onTime(const WallTime &time) override;
    virtual void onBatteryLevel(uint8_t level) override;
    virtual void onSteps(uint32_t steps) override;
    virtual void onHeartRateSample(uint16_t bpm, uint8_t trustLevel, uint32_t timestamp) override;
    virtual void onAlertsMuted(bool muted) override;

private:
    MainPresenter();

    MainView& view;
};

#endif // MAINPRESENTER_HPP
