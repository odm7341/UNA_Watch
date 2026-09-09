#ifndef MODELLISTENER_HPP
#define MODELLISTENER_HPP

#include <gui/model/Model.hpp>
#include <gui/common/FrontendApplication.hpp>

#include <cstdint>

class ModelListener
{
public:
    ModelListener() : model(0) {}
    
    virtual ~ModelListener() {}

    void bind(Model* m)
    {
        model = m;
    }

    virtual void onIdleTimeout() {}
    virtual void onGpsLocation(bool valid, int32_t latitudeUdeg, int32_t longitudeUdeg)
    {
        (void)valid;
        (void)latitudeUdeg;
        (void)longitudeUdeg;
    }

protected:
    Model* model;

    
};

#endif // MODELLISTENER_HPP
