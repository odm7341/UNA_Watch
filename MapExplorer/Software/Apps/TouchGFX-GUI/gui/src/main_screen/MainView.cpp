#include <gui/main_screen/MainView.hpp>

#include <gui/common/GuiConfig.hpp>
#include <texts/TextKeysAndLanguages.hpp>
#include <MapKit/MapMath.hpp>

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
    mMap.setShowMarker(false);
    add(mMap);
    mOperationBackground.setPosition(76, 218, 88, 16);
    mOperationBackground.setColor(touchgfx::Color::getColorFromRGB(0, 0, 0));
    add(mOperationBackground);
    mOperationText.setPosition(80, 220, 80, 12);
    mOperationText.setTypedText(touchgfx::TypedText(T_TMP_MEDIUM_10));
    mOperationText.setColor(touchgfx::Color::getColorFromRGB(255, 255, 255));
    mOperationText.setWildcard(mOperationBuffer);
    add(mOperationText);
    mGpsBackground.setPosition(4, 4, 42, 16);
    mGpsBackground.setColor(touchgfx::Color::getColorFromRGB(0, 0, 0));
    add(mGpsBackground);
    mGpsText.setPosition(8, 6, 36, 12);
    mGpsText.setTypedText(touchgfx::TypedText(T_TMP_MEDIUM_10));
    mGpsText.setColor(touchgfx::Color::getColorFromRGB(255, 255, 255));
    mGpsText.setWildcard(mGpsBuffer);
    add(mGpsText);
    refreshGpsHint(false);
    mBrowser.openInitialPack();
    mWasRenderable = mBrowser.renderable();
    refreshOperationHint();
    refreshMap();
}

void MainView::tearDownScreen()
{
    remove(mGpsText);
    remove(mGpsBackground);
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

void MainView::onGpsLocation(bool valid, int32_t latitudeUdeg, int32_t longitudeUdeg)
{
    if (!valid) {
        mBrowser.clearLocation();
        mMap.setLocation(false, 0, 0);
        refreshGpsHint(false);
        return;
    }

    const MapKit::MapMath::WorldPx location =
        MapKit::MapMath::toWorldPx(latitudeUdeg, longitudeUdeg, MapKit::MapMath::TRACE_ZOOM);
    mMap.setLocation(true, location.x, location.y);
    if (mBrowser.onLocation(location.x, location.y)) {
        refreshMap();
    }
    refreshGpsHint(true);
}

void MainView::refreshGpsHint(bool valid)
{
    const char* label = valid ? "GPS" : "GPS...";
    touchgfx::Unicode::strncpy(mGpsBuffer, label, sizeof(mGpsBuffer) / sizeof(mGpsBuffer[0]) - 1);
    mGpsBuffer[sizeof(mGpsBuffer) / sizeof(mGpsBuffer[0]) - 1] = 0;
    mGpsText.invalidate();
}


void MainView::refreshOperationHint()
{
    const char* label = nullptr;
    switch (mBrowser.operation()) {
    case MapKit::MapBrowserSession::Operation::NorthSouth: label = "PAN N/S"; break;
    case MapKit::MapBrowserSession::Operation::EastWest:   label = "PAN E/W"; break;
    case MapKit::MapBrowserSession::Operation::Zoom:       label = "ZOOM"; break;
    case MapKit::MapBrowserSession::Operation::Pack:       label = "PACK"; break;
    case MapKit::MapBrowserSession::Operation::Follow:
        label = mBrowser.following() ? "FOLLOW ON" : "FOLLOW OFF";
        break;
    case MapKit::MapBrowserSession::Operation::Exit:       label = "EXIT"; break;
    }
    touchgfx::Unicode::strncpy(mOperationBuffer, label, sizeof(mOperationBuffer) / sizeof(mOperationBuffer[0]) - 1);
    mOperationBuffer[sizeof(mOperationBuffer) / sizeof(mOperationBuffer[0]) - 1] = 0;
    mOperationText.invalidate();
}
void MainView::handleKeyEvent(uint8_t key)
{
    if (key == Gui::Config::Button::L1) {
        mBrowser.cycleOperation(-1);
    } else if (key == Gui::Config::Button::L2) {
        mBrowser.cycleOperation(1);
    } else if (key == Gui::Config::Button::R1 || key == Gui::Config::Button::R2) {
        if (mBrowser.operation() == MapKit::MapBrowserSession::Operation::Exit) {
            presenter->exit();
            return;
        }
        mBrowser.adjust(key == Gui::Config::Button::R2);
    }
    refreshMap();
    refreshOperationHint();
}