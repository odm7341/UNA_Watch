#pragma once

#include "RemainingTimeEstimator.hpp"
#include "SDK/Interfaces/IFileSystem.hpp"
#include <cstddef>
#include <cstring>

class HistoryStore {
public:
    explicit HistoryStore(SDK::Interface::IFileSystem &fs) : mFs(fs) {}

    void load(RemainingTimeEstimator &estimator)
    {
        Record best {};
        for (unsigned slot = 0; slot < 2; ++slot) {
            Record record {};
            auto file = mFs.file(path(slot));
            if (!file || !file->open()) continue;
            size_t count = 0;
            const bool read = file->size() == sizeof(record)
                && file->read(reinterpret_cast<char *>(&record), sizeof(record), count);
            file->close();
            RemainingTimeEstimator candidate;
            if (!read || count != sizeof(record) || record.version != 1
                || !record.sequence || record.checksum != checksum(record)
                || !candidate.restore(record.history)) continue;
            if (record.sequence > best.sequence) { best = record; mSlot = slot; }
        }
        if (best.sequence) {
            estimator.restore(best.history);
            mSequence = best.sequence;
            mSaved = best.history;
        }
    }

    bool save(const RemainingTimeEstimator &estimator)
    {
        if (mSequence && std::memcmp(&mSaved, &estimator.history(), sizeof(mSaved)) == 0) return true;
        if (!mFs.mkdir("../SharedData/BatteryTime")) return false;
        Record record {};
        record.version = 1;
        record.sequence = mSequence + 1;
        if (!record.sequence) return false;
        record.history = estimator.history();
        record.checksum = checksum(record);
        const unsigned next = 1 - mSlot;
        auto file = mFs.file(path(next));
        if (!file || !file->open(true, true)) return false;
        size_t count = 0;
        const bool written = file->write(reinterpret_cast<const char *>(&record), sizeof(record), count)
            && count == sizeof(record) && file->flush();
        const bool closed = file->close();
        if (!written || !closed) return false;
        mSequence = record.sequence;
        mSlot = next;
        mSaved = record.history;
        return true;
    }

private:
    struct Record {
        uint32_t version = 0;
        uint32_t sequence = 0;
        RemainingTimeEstimator::History history;
        uint32_t checksum = 0;
    };
    static uint32_t checksum(const Record &record)
    {
        uint32_t value = 2166136261U;
        const auto *bytes = reinterpret_cast<const unsigned char *>(&record);
        for (size_t i = 0; i < offsetof(Record, checksum); ++i) value = (value ^ bytes[i]) * 16777619U;
        return value;
    }
    static const char *path(unsigned slot)
    {
        return slot ? "../SharedData/BatteryTime/history-b.bin"
                    : "../SharedData/BatteryTime/history-a.bin";
    }
    SDK::Interface::IFileSystem &mFs;
    RemainingTimeEstimator::History mSaved;
    uint32_t mSequence = 0;
    unsigned mSlot = 0;
};
