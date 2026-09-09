#ifndef MAINVIEW_HPP
#define MAINVIEW_HPP

#include <MapKit/MapBrowserSession.hpp>
#include <MapKit/MapTileView.hpp>
#include <MapKit/TileCache.hpp>

#include <touchgfx/widgets/Box.hpp>
#include <touchgfx/widgets/TextAreaWithWildcard.hpp>

#include <gui_generated/main_screen/MainViewBase.hpp>
#include <gui/main_screen/MainPresenter.hpp>

class MainView : public MainViewBase
{
    MapKit::MapTileView mMap;
    MapKit::TileCache mCache;
    MapKit::MapSession mSession;
    MapKit::MapBrowserSession mBrowser;
    uint8_t mPollTicks = 0;
    bool mWasRenderable = false;
    uint8_t mLastKey = 0;
    touchgfx::Box mOperationBackground;
    touchgfx::TextAreaWithOneWildcard mOperationText;
    touchgfx::Unicode::UnicodeChar mOperationBuffer[20] {};
public:
    MainView();
    virtual ~MainView() {}
    virtual void setupScreen();
    virtual void tearDownScreen();

protected:
    virtual void handleKeyEvent(uint8_t key) override;
    virtual void handleTickEvent() override;
    void refreshMap();
    void refreshOperationHint();
};

#endif // MAINVIEW_HPP
