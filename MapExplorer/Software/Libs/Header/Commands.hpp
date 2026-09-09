#pragma once

#include "SDK/Messages/MessageBase.hpp"
#include "SDK/Messages/MessageTypes.hpp"

#include <cstdint>

#pragma pack(push, 4)
namespace MapExplorerMessage {

constexpr SDK::MessageType::Type GPS_LOCATION = 0x00000001;

/// Latest GPS fix, expressed as microdegrees for lossless MapMath conversion.
struct GpsLocation : public SDK::MessageBase {
    GpsLocation()
        : MessageBase(GPS_LOCATION)
        , valid(0)
        , latitude(0)
        , longitude(0)
    {}

    uint8_t valid;
    int32_t latitude;
    int32_t longitude;
};

} // namespace MapExplorerMessage
#pragma pack(pop)
