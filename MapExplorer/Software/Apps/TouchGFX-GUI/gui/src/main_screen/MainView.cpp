#include <gui/main_screen/MainView.hpp>

#include <gui/common/GuiConfig.hpp>
#include <texts/TextKeysAndLanguages.hpp>

#include <touchgfx/Color.hpp>

#include "SDK/Kernel/KernelProviderGUI.hpp"

MainView::MainView()
    : mSession(SDK::KernelProviderGUI::GetInstance().getKernel(), mCache, "MapExplorer")
    , mBrowser(mSession)
{
}

void MainView::setupScreen()
{
    MainViewBase::setupScreen();
    buttons.setVisible(false);
    mMap.setPosition(0, 0, 240, 240);
    mMap.setSources(&mSession.container(), &mSession.cache(), nullptr);
    add(mMap);
    mOperationBackground.setPosition(76, 218, 88, 16);
    mOperationBackground.setColor(touchgfx::Color::getColorFromRGB(0, 0, 0));
    add(mOperationBackground);
    mOperationText.setPosition(80, 220, 80, 12);
    mOperationText.setTypedText(touchgfx::TypedText(T_TMP_MEDIUM_10));
    mOperationText.setColor(touchgfx::Color::getColorFromRGB(255, 255, 255));
    mOperationText.setWildcard(mOperationBuffer);
    add(mOperationText);
    mBrowser.openInitialPack();
    mWasRenderable = mBrowser.renderable();
    refreshOperationHint();
    refreshMap();
}

void MainView::tearDownScreen()
{
    remove(mOperationText);
    remove(mOperationBackground);
    remove(mMap);
    MainViewBase::tearDownScreen();
}

void MainView::refreshMap()
{
    if (mBrowser.renderable()) {
        mMap.setViewportWithTiles(mBrowser.centerX(), mBrowser.centerY(), mBrowser.zoom(), false);
    } else {
        mMap.setTraceOnlyViewport(mBrowser.centerX(), mBrowser.centerY(), mBrowser.zoom(), false);
    }
    mMap.invalidate();
}

void MainView::handleTickEvent()
{
    if (++mPollTicks < 60) {
        return;
    }
    mPollTicks = 0;
    mSession.poll();
    const bool renderable = mBrowser.renderable();
    if (renderable != mWasRenderable) {
        mWasRenderable = renderable;
        refreshMap();
    }
}


void MainView::refreshOperationHint()
{
    const char* label = nullptr;
    switch (mBrowser.operation()) {
    case MapKit::MapBrowserSession::Operation::NorthSouth: label = "PAN N/S"; break;
    case MapKit::MapBrowserSession::Operation::EastWest:   label = "PAN E/W"; break;
    case MapKit::MapBrowserSession::Operation::Zoom:       label = "ZOOM"; break;
    case MapKit::MapBrowserSession::Operation::Pack:       label = "PACK"; break;
    }
    touchgfx::Unicode::strncpy(mOperationBuffer, label, sizeof(mOperationBuffer) / sizeof(mOperationBuffer[0]) - 1);
    mOperationBuffer[sizeof(mOperationBuffer) / sizeof(mOperationBuffer[0]) - 1] = 0;
    mOperationText.invalidate();
}
void MainView::handleKeyEvent(uint8_t key)
{
    // Keep the tutorial's deliberate double-R2 escape hatch. One R2 remains
    // the browser's positive adjustment; two consecutive presses return to
    // the watch launcher without requiring a hidden gesture.
    if (key == Gui::Config::Button::R2 && mLastKey == key) {
        presenter->exit();
        return;
    }
    if (key == Gui::Config::Button::L1) {
        mBrowser.cycleOperation(-1);
    } else if (key == Gui::Config::Button::L2) {
        mBrowser.cycleOperation(1);
    } else if (key == Gui::Config::Button::R1) {
        mBrowser.adjust(false);
    } else if (key == Gui::Config::Button::R2) {
        mBrowser.adjust(true);
    }
    mLastKey = key;
    refreshMap();
    refreshOperationHint();
}