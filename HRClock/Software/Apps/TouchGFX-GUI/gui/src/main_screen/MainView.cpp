#include <gui/main_screen/MainView.hpp>

#include <texts/TextKeysAndLanguages.hpp>
#include <touchgfx/Color.hpp>

#include <ctime>


static touchgfx::colortype color(uint8_t r, uint8_t g, uint8_t b)
{
    return touchgfx::Color::getColorFromRGB(r, g, b);
}

MainView::MainView()
    : mShown{ 0xFF, 0xFF, 0xFF, 0xFF }
    , mBatteryShown(0xFF)
    , mStepsShown(0xFFFFFFFFU)
    , mStepProgressShown(0xFF)
    , mHeartRateShown(0)
    , mHeartRateTrustShown(0)
    , mHeartRateTimestampShown(0)
    , mGraphCountShown(0)
{
}

void MainView::setupScreen()
{
    MainViewBase::setupScreen();

    dial.setVisible(false);
    speakerMute.setVisible(false);
    dayText.setVisible(false);
    dateText.setVisible(false);
    hourStem.setVisible(false);
    hourBody.setVisible(false);
    minuteStem.setVisible(false);
    minuteBody.setVisible(false);
    hub.setVisible(false);
    battery.setVisible(false);

    setupText();
    setupGraph();
    setupProgress();

    setTime(presenter->currentTime());
    setBatteryLevel(presenter->batteryLevel());
    setSteps(presenter->steps());
    setHeartRate(presenter->heartRate(),
                 presenter->heartRateTrustLevel(),
                 presenter->heartRateTimestamp());
    setAlertsMuted(presenter->alertsMuted());
}

void MainView::tearDownScreen()
{
    MainViewBase::tearDownScreen();
}

void MainView::setupText()
{
    setText(mDateText, mDateTextBuffer, T_TMP_MEDIUM_16, 0, 16, 240, 24, color(160, 160, 160));
    setText(mTimeText, mTimeTextBuffer, T_TMP_MEDIUM_42, 0, 41, 240, 54, color(255, 255, 255));
    setText(mHeartRateText, mHeartRateTextBuffer, T_TMP_MEDIUM_16, 0, 91, 240, 24, color(255, 64, 96));
    setText(mStepsText, mStepsTextBuffer, T_TMP_MEDIUM_16, 18, 154, 86, 24, color(255, 255, 255));
    setText(mStepsLabel, mStepsLabelBuffer, T_TMP_MEDIUM_16, 18, 174, 86, 18, color(128, 128, 128));
    setText(mBatteryText, mBatteryTextBuffer, T_TMP_MEDIUM_16, 136, 154, 86, 24, color(128, 220, 128));
    setText(mBatteryLabel, mBatteryLabelBuffer, T_TMP_MEDIUM_16, 136, 174, 86, 18, color(128, 128, 128));
    setText(mGoalText, mGoalTextBuffer, T_TMP_MEDIUM_16, 0, 218, 240, 18, color(128, 128, 128));

    Unicode::snprintf(mStepsLabelBuffer, kLabelTextSize, "STEPS");
    mStepsLabel.invalidate();
    Unicode::snprintf(mBatteryLabelBuffer, kLabelTextSize, "BAT");
    mBatteryLabel.invalidate();
}

void MainView::setupProgress()
{
    mStepTrack.setPosition(35, 208, 170, 6);
    mStepTrack.setColor(color(64, 64, 64));
    add(mStepTrack);

    mStepFill.setPosition(35, 208, 0, 6);
    mStepFill.setColor(color(0, 192, 192));
    add(mStepFill);
}

void MainView::setupGraph()
{
    mHeartGraphPainter.setColor(color(255, 64, 96));

    for (uint8_t i = 0; i < kHrGraphSegments; ++i) {
        mHeartGraph[i].setPosition(0, 0, 240, 240);
        mHeartGraph[i].setPainter(mHeartGraphPainter);
        mHeartGraph[i].setLineWidth(2);
        mHeartGraph[i].setLineEndingStyle(touchgfx::Line::ROUND_CAP_ENDING);
        mHeartGraph[i].setLine(34, 130, 34, 130);
        mHeartGraph[i].setVisible(false);
        add(mHeartGraph[i]);
    }
}

void MainView::setText(touchgfx::TextAreaWithOneWildcard &text,
                       touchgfx::Unicode::UnicodeChar *buffer,
                       TEXTS typedText,
                       int16_t x, int16_t y, int16_t w, int16_t h,
                       touchgfx::colortype textColor)
{
    text.setPosition(x, y, w, h);
    text.setColor(textColor);
    text.setLinespacing(0);
    text.setTypedText(touchgfx::TypedText(typedText));
    text.setWildcard(buffer);
    add(text);
}

void MainView::setTime(const WallTime &time)
{
    if (time == mShown) {
        return;
    }

    const bool clockChanged = (time.hour != mShown.hour) || (time.minute != mShown.minute);
    const bool dateChanged = (time.mday != mShown.mday) || (time.wday != mShown.wday);

    mShown = time;

    if (dateChanged) {
        refreshDateText();
    }

    if (clockChanged) {
        refreshTimeText();
    }

    refreshHeartRateText();
}

void MainView::refreshDateText()
{
    const char *day = dayName(mShown.wday);
    mDateTextBuffer[0] = day[0];
    mDateTextBuffer[1] = day[1];
    mDateTextBuffer[2] = day[2];
    mDateTextBuffer[3] = ' ';
    mDateTextBuffer[4] = static_cast<touchgfx::Unicode::UnicodeChar>('0' + (mShown.mday / 10U));
    mDateTextBuffer[5] = static_cast<touchgfx::Unicode::UnicodeChar>('0' + (mShown.mday % 10U));
    mDateTextBuffer[6] = 0;
    mDateText.invalidate();
}

void MainView::refreshTimeText()
{
    Unicode::snprintf(mTimeTextBuffer, kTimeTextSize, "%02u:%02u",
                      static_cast<unsigned>(mShown.hour),
                      static_cast<unsigned>(mShown.minute));
    mTimeText.invalidate();
}

void MainView::setBatteryLevel(uint8_t level)
{
    if (level == mBatteryShown) {
        return;
    }

    mBatteryShown = level;
    refreshBatteryText(level);
}

void MainView::refreshBatteryText(uint8_t level)
{
    mBatteryText.setColor(level < 20 ? color(255, 64, 96) : color(128, 220, 128));
    Unicode::snprintf(mBatteryTextBuffer, kBatteryTextSize, "%u%%", static_cast<unsigned>(level));
    mBatteryText.invalidate();
}

void MainView::setSteps(uint32_t steps)
{
    if (steps == mStepsShown) {
        return;
    }

    mStepsShown = steps;
    refreshStepsText(steps);
    refreshStepProgress(steps);
}

void MainView::refreshStepsText(uint32_t steps)
{
    if (steps < 1000) {
        Unicode::snprintf(mStepsTextBuffer, kStepsTextSize, "%u", static_cast<unsigned>(steps));
    } else {
        Unicode::snprintf(mStepsTextBuffer, kStepsTextSize, "%u.%uK",
                          static_cast<unsigned>(steps / 1000U),
                          static_cast<unsigned>((steps / 100U) % 10U));
    }
    mStepsText.invalidate();
}

void MainView::refreshStepProgress(uint32_t steps)
{
    const uint8_t percent = stepProgressPercent(steps);
    if (percent == mStepProgressShown) {
        return;
    }

    mStepProgressShown = percent;
    const int16_t width = static_cast<int16_t>((170U * percent) / 100U);
    mStepTrack.invalidate();
    mStepFill.invalidate();
    mStepFill.setWidth(width);
    mStepFill.invalidate();

    Unicode::snprintf(mGoalTextBuffer, kLabelTextSize, "%u%% GOAL", static_cast<unsigned>(percent));
    mGoalText.invalidate();
}

void MainView::setHeartRate(uint16_t bpm, uint8_t trustLevel, uint32_t timestamp)
{
    if ((bpm == mHeartRateShown) &&
        (trustLevel == mHeartRateTrustShown) &&
        (timestamp == mHeartRateTimestampShown) &&
        (presenter->heartRateHistoryCount() == mGraphCountShown)) {
        return;
    }

    mHeartRateShown = bpm;
    mHeartRateTrustShown = trustLevel;
    mHeartRateTimestampShown = timestamp;
    refreshHeartRateText();
    refreshHeartRateGraph();
}

void MainView::refreshHeartRateText()
{
    const bool stale = heartRateIsStale(static_cast<uint32_t>(std::time(nullptr)));
    mHeartRateText.setColor(stale ? color(128, 128, 128) : color(255, 64, 96));

    if (mHeartRateShown == 0) {
        Unicode::snprintf(mHeartRateTextBuffer, kHeartRateTextSize, "HR -- BPM");
    } else {
        Unicode::snprintf(mHeartRateTextBuffer, kHeartRateTextSize, "HR %u BPM",
                          static_cast<unsigned>(mHeartRateShown));
    }
    mHeartRateText.invalidate();
}

void MainView::refreshHeartRateGraph()
{
    const uint8_t count = presenter->heartRateHistoryCount();
    mGraphCountShown = count;

    for (uint8_t i = 0; i < kHrGraphSegments; ++i) {
        mHeartGraph[i].setVisible(false);
        mHeartGraph[i].invalidate();
    }

    if (count < 2) {
        return;
    }

    uint16_t minHr = 0xFFFFU;
    uint16_t maxHr = 0;
    for (uint8_t i = 0; i < count; ++i) {
        const HrSample &sample = presenter->heartRateSampleAt(i);
        if (sample.bpm == 0) {
            continue;
        }
        if (sample.bpm < minHr) {
            minHr = sample.bpm;
        }
        if (sample.bpm > maxHr) {
            maxHr = sample.bpm;
        }
    }

    if (minHr == 0xFFFFU) {
        return;
    }

    uint16_t displayMin = minHr;
    uint16_t displayMax = maxHr;
    const uint16_t span = static_cast<uint16_t>(displayMax - displayMin);
    if (span < kHrGraphMinSpan) {
        const uint16_t mid = static_cast<uint16_t>((displayMin + displayMax) / 2U);
        displayMin = mid > (kHrGraphMinSpan / 2U) ? static_cast<uint16_t>(mid - (kHrGraphMinSpan / 2U)) : 0;
        displayMax = static_cast<uint16_t>(displayMin + kHrGraphMinSpan);
    } else {
        displayMin = displayMin > 4U ? static_cast<uint16_t>(displayMin - 4U) : 0;
        displayMax = static_cast<uint16_t>(displayMax + 4U);
    }

    const int16_t graphX = 34;
    const int16_t graphY = 121;
    const int16_t graphW = 172;
    const int16_t graphH = 26;
    const uint16_t graphSpan = static_cast<uint16_t>(displayMax - displayMin);
    const bool stale = heartRateIsStale(static_cast<uint32_t>(std::time(nullptr)));
    mHeartGraphPainter.setColor(stale ? color(128, 128, 128) : color(255, 64, 96));

    for (uint8_t i = 1; i < count; ++i) {
        const HrSample &a = presenter->heartRateSampleAt(static_cast<uint8_t>(i - 1));
        const HrSample &b = presenter->heartRateSampleAt(i);
        const uint16_t ayNorm = a.bpm > displayMin ? static_cast<uint16_t>(a.bpm - displayMin) : 0;
        const uint16_t byNorm = b.bpm > displayMin ? static_cast<uint16_t>(b.bpm - displayMin) : 0;
        const int16_t x0 = static_cast<int16_t>(graphX + ((graphW * (i - 1U)) / (count - 1U)));
        const int16_t x1 = static_cast<int16_t>(graphX + ((graphW * i) / (count - 1U)));
        const int16_t y0 = static_cast<int16_t>(graphY + graphH - ((graphH * ayNorm) / graphSpan));
        const int16_t y1 = static_cast<int16_t>(graphY + graphH - ((graphH * byNorm) / graphSpan));

        touchgfx::Line &line = mHeartGraph[i - 1U];
        line.setLine(x0, y0, x1, y1);
        line.setVisible(true);
        line.invalidate();
    }
}

void MainView::setAlertsMuted(bool muted)
{
    speakerMute.setVisible(muted);
    speakerMute.invalidate();
}

const char *MainView::dayName(uint8_t wday)
{
    static const char *names[] = { "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT" };
    return names[wday % 7U];
}

uint8_t MainView::stepProgressPercent(uint32_t steps)
{
    if (steps >= kStepGoal) {
        return 100;
    }
    return static_cast<uint8_t>((steps * 100U) / kStepGoal);
}

bool MainView::heartRateIsStale(uint32_t now) const
{
    if (mHeartRateTimestampShown == 0) {
        return true;
    }
    return (now - mHeartRateTimestampShown) > kHrStaleSeconds;
}
