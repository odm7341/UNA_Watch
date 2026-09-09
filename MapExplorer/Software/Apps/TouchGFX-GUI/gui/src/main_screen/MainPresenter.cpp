#include <gui/main_screen/MainView.hpp>
#include <gui/main_screen/MainPresenter.hpp>

MainPresenter::MainPresenter(MainView& v)
    : view(v)
{

}

void MainPresenter::activate()
{

}

void MainPresenter::deactivate()
{

}

void MainPresenter::onGpsLocation(bool valid, int32_t latitudeUdeg, int32_t longitudeUdeg)
{
    view.onGpsLocation(valid, latitudeUdeg, longitudeUdeg);
}
