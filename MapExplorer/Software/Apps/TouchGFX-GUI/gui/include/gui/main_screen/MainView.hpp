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
    touchgfx::Box mOperationBackground;
    touchgfx::TextAreaWithOneWildcard mOperationText;
    touchgfx::Box mGpsBackground;
    touchgfx::TextAreaWithOneWildcard mGpsText;
    touchgfx::Unicode::UnicodeChar mGpsBuffer[8] {};
    touchgfx::Unicode::UnicodeChar mOperationBuffer[20] {};
public:
    MainView();
    virtual ~MainView() {}
    virtual void setupScreen();
    virtual void tearDownScreen();
    void onGpsLocation(bool valid, int32_t latitudeUdeg, int32_t longitudeUdeg);

protected:
    virtual void handleKeyEvent(uint8_t key) override;
    virtual void handleTickEvent() override;
    void refreshMap();
    void refreshOperationHint();
    void refreshGpsHint(bool valid);
};

#endif // MAINVIEW_HPP
