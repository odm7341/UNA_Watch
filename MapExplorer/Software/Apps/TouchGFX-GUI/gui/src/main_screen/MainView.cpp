#include <gui/main_screen/MainView.hpp>

#include <gui/common/GuiConfig.hpp>

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
    mBrowser.openInitialPack();
    mWasRenderable = mBrowser.renderable();
    refreshMap();
}

void MainView::tearDownScreen()
{
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

void MainView::handleKeyEvent(uint8_t key)
{
    if (key == Gui::Config::Button::L1) {
        mBrowser.cycleOperation(-1);
    } else if (key == Gui::Config::Button::L2) {
        mBrowser.cycleOperation(1);
    } else if (key == Gui::Config::Button::R1) {
        mBrowser.adjust(false);
    } else if (key == Gui::Config::Button::R2) {
        mBrowser.adjust(true);
    }
    refreshMap();
}