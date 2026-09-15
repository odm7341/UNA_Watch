#include "HistoryStore.hpp"
#include <cassert>
#include <cstdio>
#include <limits>
#include <map>
#include <string>
#include <vector>

// In-memory disk survives estimator/service recreation and can tear a write.
struct Disk {
    std::map<std::string, std::vector<char>> files;
    bool tear = false;
    unsigned writes = 0;
};
class File final : public SDK::Interface::IFile {
public:
    File(Disk &d, const char *p) : disk(d), name(p) {}
    void setPath(const char *p) override { name = p; }
    const char *getPath() const override { return name.c_str(); }
    bool exist() const override { return disk.files.count(name); }
    bool rename(const char *) override { return false; }
    bool remove() override { return disk.files.erase(name); }
    size_t size() const override { return exist() ? disk.files.at(name).size() : 0; }
    bool open(bool write = false, bool truncate = false) override {
        if (!write && !exist()) return false;
        if (truncate) disk.files[name].clear();
        opened = true;
        return true;
    }
    bool isOpen() const override { return opened; }
    bool close() override { opened = false; return true; }
    bool read(char *p, size_t n, size_t &count) override {
        const auto &data = disk.files.at(name);
        count = n < data.size() ? n : data.size();
        std::memcpy(p, data.data(), count);
        return true;
    }
    bool write(const char *p, size_t n, size_t &count) override {
        ++disk.writes;
        count = disk.tear ? n / 2 : n;
        disk.files[name] = std::vector<char>(p, p + count);
        return !disk.tear;
    }
    bool seek(size_t) override { return false; }
    bool truncate(size_t) override { return false; }
    bool flush() override { return true; }
    size_t getPosition() const override { return 0; }
private:
    Disk &disk;
    std::string name;
    bool opened = false;
};
class Fs final : public SDK::Interface::IFileSystem {
public:
    Disk disk;
    bool mkdir(const char *) override { return true; }
    std::unique_ptr<SDK::Interface::IFile> file(const char *p) override {
        return std::make_unique<File>(disk, p);
    }
    std::unique_ptr<SDK::Interface::IDirectory> dir(const char *) override { return {}; }
    bool exist(const char *p) const override { return disk.files.count(p); }
    bool remove(const char *p) override { return disk.files.erase(p); }
    bool rename(const char *, const char *) override { return false; }
    bool copy(const char *, const char *) override { return false; }
    bool objectInfo(const char *, ObjectInfo &) const override { return false; }
};

int main()
{
    using E = RemainingTimeEstimator;
    constexpr uint32_t start = 1800000000U;
    Fs fs;
    E first;
    HistoryStore initialStore(fs);
    initialStore.load(first);
    first.observe(start, 300, 400);
    assert(first.result(start, true, false, true, 300).state == E::State::Learning);
    assert(initialStore.save(first));
    const auto writes = fs.disk.writes;
    assert(initialStore.save(first) && fs.disk.writes == writes);

    // No service or samples during six hours asleep. A fresh instance learns
    // 24 mAh / 6 h = 4 mA, not the current drawn while opening the glance.
    E second;
    HistoryStore secondStore(fs);
    secondStore.load(second);
    second.observe(start + 21600, 276, 400);
    assert(second.result(start + 21600, true, false, true, 276).minutes == 4140);
    assert(secondStore.save(second));
    E reopened;
    HistoryStore reopenStore(fs);
    reopenStore.load(reopened);
    assert(reopened.result(start + 21605, true, false, true, 276).minutes == 4140);

    // An interrupted next write leaves the preceding complete snapshot usable.
    reopened.observe(start + 25200, 272, 400);
    fs.disk.tear = true;
    assert(!reopenStore.save(reopened));
    E recovered;
    HistoryStore recoveryStore(fs);
    recoveryStore.load(recovered);
    assert(recovered.result(start + 25200, true, false, true, 272).minutes == 4080);
    fs.disk.tear = false;

    // Charging breaks the interval, while retaining the previous learned rate.
    recovered.charging();
    assert(recoveryStore.save(recovered));
    E afterCharge;
    HistoryStore chargedStore(fs);
    chargedStore.load(afterCharge);
    afterCharge.observe(start + 28800, 390, 400);
    assert(afterCharge.result(start + 28800, true, false, true, 390).minutes == 5850);
    assert(afterCharge.result(start + 28800, true, true, true, 390).state == E::State::Charging);
    afterCharge.observe(start + 32400, 350, 400);
    assert(afterCharge.result(start + 32400, true, false, true, 350).minutes < 5850);

    E noise;
    noise.observe(start, 300, 400);
    noise.observe(start + 3600, 299, 400);
    assert(noise.result(start + 3600, true, false, true, 299).state == E::State::Learning);
    noise.observe(start + 7200, 330, 400); // unseen charging/gauge jump
    assert(noise.history().anchorMah == 330);
    noise.observe(start + 10800, 322, 400);
    assert(noise.result(start + 10800, true, false, true, 322).minutes == 2415);
    noise.observe(start - 1, 320, 400); // backwards wall clock
    assert(noise.result(start - 1, true, false, true, 320).state == E::State::Learning);
    assert(second.result(start + 8 * 86400, true, false, true, 100).state == E::State::Learning);
    assert(second.result(start + 21600, false, false, true, 276).state == E::State::Learning);
    assert(!E::valid(start, std::numeric_limits<float>::quiet_NaN(), 400));
    auto corrupt = second.history();
    corrupt.rateMahPerHour = std::numeric_limits<float>::infinity();
    assert(!noise.restore(corrupt));
    // Visiting more often must not make identical discharge look faster.
    E frequent;
    frequent.observe(start, 300, 400);
    for (uint32_t hour = 1; hour <= 6; ++hour) {
        frequent.observe(start + hour * 3600, 300.0f - 4.0f * hour, 400);
    }
    assert(frequent.result(start + 21600, true, false, true, 276).minutes == 4140);
    frequent.observe(start + 4 * 86400, 250, 400);
    assert(frequent.result(start + 4 * 86400, true, false, true, 250).state == E::State::Learning);
    std::puts("PASS: sleep interval, reopen, charging, torn write, unchanged writes, noise, clock reversal, staleness, invalid data");
}
