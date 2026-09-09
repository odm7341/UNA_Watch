#ifndef MAINVIEW_HPP
#define MAINVIEW_HPP

#include <gui_generated/main_screen/MainViewBase.hpp>
#include <gui/main_screen/MainPresenter.hpp>
#include <texts/TextKeysAndLanguages.hpp>

#include <touchgfx/widgets/Box.hpp>
#include <touchgfx/widgets/TextAreaWithWildcard.hpp>
#include <touchgfx/widgets/canvas/Line.hpp>
#include <touchgfx/widgets/canvas/PainterABGR2222.hpp>

#include <cstdint>

class MainView : public MainViewBase
{
public:
    MainView();
    virtual ~MainView() {}
    virtual void setupScreen();
    virtual void tearDownScreen();

    void setTime(const WallTime &time);
    void setBatteryLevel(uint8_t level);
    void setSteps(uint32_t steps);
    void setHeartRate(uint16_t bpm, uint8_t trustLevel, uint32_t timestamp);
    void setAlertsMuted(bool muted);

private:
    static constexpr uint32_t kStepGoal = 10000;
    static constexpr uint32_t kHrStaleSeconds = 45 * 60;
    static constexpr uint16_t kHrGraphMinSpan = 24;
    static constexpr uint8_t  kHrGraphSegments = Model::kHrHistorySize - 1;

    static constexpr uint16_t kDateTextSize = 8;
    static constexpr uint16_t kTimeTextSize = 6;
    static constexpr uint16_t kHeartRateTextSize = 13;
    static constexpr uint16_t kStepsTextSize = 8;
    static constexpr uint16_t kBatteryTextSize = 6;
    static constexpr uint16_t kLabelTextSize = 10;

    void setupText();
    void setupProgress();
    void setupGraph();
    void setText(touchgfx::TextAreaWithOneWildcard &text,
                 touchgfx::Unicode::UnicodeChar *buffer,
                 TEXTS typedText,
                 int16_t x, int16_t y, int16_t w, int16_t h,
                 touchgfx::colortype color);

    void refreshDateText();
    void refreshTimeText();
    void refreshHeartRateText();
    void refreshHeartRateGraph();
    void refreshBatteryText(uint8_t level);
    void refreshStepsText(uint32_t steps);
    void refreshStepProgress(uint32_t steps);

    static const char *dayName(uint8_t wday);
    static uint8_t stepProgressPercent(uint32_t steps);
    bool heartRateIsStale(uint32_t now) const;

    WallTime mShown;
    uint8_t  mBatteryShown;
    uint32_t mStepsShown;
    uint8_t  mStepProgressShown;
    uint16_t mHeartRateShown;
    uint8_t  mHeartRateTrustShown;
    uint32_t mHeartRateTimestampShown;
    uint8_t  mGraphCountShown;

    touchgfx::TextAreaWithOneWildcard mDateText;
    touchgfx::TextAreaWithOneWildcard mTimeText;
    touchgfx::TextAreaWithOneWildcard mHeartRateText;
    touchgfx::TextAreaWithOneWildcard mStepsText;
    touchgfx::TextAreaWithOneWildcard mStepsLabel;
    touchgfx::TextAreaWithOneWildcard mBatteryText;
    touchgfx::TextAreaWithOneWildcard mBatteryLabel;
    touchgfx::TextAreaWithOneWildcard mGoalText;

    touchgfx::Unicode::UnicodeChar mDateTextBuffer[kDateTextSize];
    touchgfx::Unicode::UnicodeChar mTimeTextBuffer[kTimeTextSize];
    touchgfx::Unicode::UnicodeChar mHeartRateTextBuffer[kHeartRateTextSize];
    touchgfx::Unicode::UnicodeChar mStepsTextBuffer[kStepsTextSize];
    touchgfx::Unicode::UnicodeChar mStepsLabelBuffer[kLabelTextSize];
    touchgfx::Unicode::UnicodeChar mBatteryTextBuffer[kBatteryTextSize];
    touchgfx::Unicode::UnicodeChar mBatteryLabelBuffer[kLabelTextSize];
    touchgfx::Unicode::UnicodeChar mGoalTextBuffer[kLabelTextSize];

    touchgfx::Box mStepTrack;
    touchgfx::Box mStepFill;
    touchgfx::Line mHeartGraph[kHrGraphSegments];
    touchgfx::PainterABGR2222 mHeartGraphPainter;
};

#endif // MAINVIEW_HPP
