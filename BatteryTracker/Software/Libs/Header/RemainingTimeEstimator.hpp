#pragma once

#include <cmath>
#include <cstdint>

class RemainingTimeEstimator {
public:
    enum class State { Learning, Ready, Charging };
    struct Result { State state = State::Learning; uint32_t minutes = 0; };
    // Fixed-size, versioned by the storage record. No pointers or runtime clocks.
    struct History {
        uint32_t anchorUtc = 0;
        uint32_t lastUtc = 0;
        uint32_t rateUtc = 0;
        float anchorMah = 0;
        float lastMah = 0;
        float designMah = 0;
        float rateMahPerHour = 0;
        float rateHours = 0;
    };

    const History &history() const { return mHistory; }
    bool restore(const History &h)
    {
        if (!std::isfinite(h.anchorMah) || !std::isfinite(h.lastMah)
            || !std::isfinite(h.designMah) || !std::isfinite(h.rateMahPerHour)
            || !std::isfinite(h.rateHours) || h.designMah < 0 || h.designMah > 10000
            || h.anchorMah < 0 || h.lastMah < 0 || h.anchorMah > h.designMah
            || h.lastMah > h.designMah || h.rateMahPerHour < 0
            || h.rateMahPerHour > h.designMah || h.rateHours < 0 || h.rateHours > 24
            || h.anchorUtc > h.lastUtc || h.rateUtc > h.lastUtc) return false;
        mHistory = h;
        return true;
    }

    void charging() { mHistory.anchorUtc = 0; }

    void observe(uint32_t utc, float capacity, float design)
    {
        if (!valid(utc, capacity, design)) return;
        auto &h = mHistory;
        if (h.lastUtc && (utc < h.lastUtc || utc - h.lastUtc > kMaxGap
            || std::fabs(design - h.designMah) > design * 0.01f)) h = {};
        if (h.rateUtc && utc - h.rateUtc > kRateLifetime) {
            h.rateMahPerHour = 0;
            h.rateHours = 0;
            h.rateUtc = 0;
        }
        // An increase may be charging or a gauge correction. Never bridge it.
        if (h.lastUtc && capacity > h.lastMah + design * 0.01f) h.anchorUtc = 0;
        h.lastUtc = utc;
        h.lastMah = capacity;
        h.designMah = design;
        if (!h.anchorUtc) {
            h.anchorUtc = utc;
            h.anchorMah = capacity;
            return;
        }
        const uint32_t elapsed = utc - h.anchorUtc;
        const float loss = h.anchorMah - capacity;
        if (elapsed < 3600 || loss < design * 0.02f) return;
        const float hours = static_cast<float>(elapsed) / 3600.0f;
        const float rate = loss / hours;
        if (rate > design) { h.anchorUtc = 0; return; }
        // Weight actual elapsed time, not number of visits or sensor events.
        const float weight = hours < 24.0f ? hours : 24.0f;
        h.rateMahPerHour = (h.rateMahPerHour * h.rateHours + rate * weight)
                            / (h.rateHours + weight);
        h.rateHours = h.rateHours + weight < 24.0f ? h.rateHours + weight : 24.0f;
        h.rateUtc = utc;
        h.anchorUtc = utc;
        h.anchorMah = capacity;
    }

    Result result(uint32_t utc, bool chargingKnown, bool isCharging,
                  bool haveCapacity, float capacity) const
    {
        if (chargingKnown && isCharging) return {State::Charging, 0};
        if (!chargingKnown || !haveCapacity || !std::isfinite(capacity) || capacity < 0
            || !mHistory.rateUtc || utc < mHistory.lastUtc
            || utc - mHistory.rateUtc > kRateLifetime || mHistory.rateMahPerHour <= 0) return {};
        const float minutes = capacity / mHistory.rateMahPerHour * 60.0f;
        if (!std::isfinite(minutes) || minutes > 30.0f * 24.0f * 60.0f) return {};
        return {State::Ready, static_cast<uint32_t>(minutes + 0.5f)};
    }

    static bool valid(uint32_t utc, float capacity, float design)
    {
        return utc >= 1577836800U && std::isfinite(capacity) && std::isfinite(design)
            && design > 0 && design <= 10000 && capacity >= 0 && capacity <= design;
    }

private:
    static constexpr uint32_t kMaxGap = 3U * 86400U;
    static constexpr uint32_t kRateLifetime = 7U * 86400U;
    History mHistory;
};
