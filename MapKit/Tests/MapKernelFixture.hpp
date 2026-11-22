#pragma once
// The apps-v1.3.0 fake implements files but returns empty directories. Add
// enumeration here so discovery and trust can be tested with the build SDK.
#include "KernelTestDoubles.hpp"
#include <algorithm>
#include <cstring>
#include <vector>

namespace MapKitTest {
class MapFileSystem : public SDK::TestSupport::InMemoryFileSystem {
    class Listing : public SDK::Interface::IDirectory {
    public:
        Listing(std::string p, const MapFileSystem& fs) : path(p) {
            const auto prefix = path + '/';
            for (const auto& [key, value] : fs.files) {
                if (!value.exists || key.compare(0,prefix.size(),prefix) != 0) continue;
                auto name = key.substr(prefix.size());
                if (name.find('/') != name.npos || name.size() >= sizeof(ObjectInfo::name)) continue;
                ObjectInfo item{};
                std::memcpy(item.name,name.c_str(),name.size()+1);
                item.size=value.content.size(); entries.push_back(item);
            }
            std::sort(entries.begin(),entries.end(),[](const auto& a,const auto& b){return strcmp(a.name,b.name)<0;});
        }
        void setPath(const char* p) override { path=p; }
        const char* getPath() const override { return path.c_str(); }
        bool exist() const override { return true; }
        bool open() override { pos=0; return opened=true; }
        bool isOpen() const override { return opened; }
        bool close() override { opened=false;return true; }
        bool create() override { return false; }
        bool rename(const char*) override { return false; }
        bool remove() override { return false; }
        bool readNext(ObjectInfo& out,bool reset=false) override {
            if (!opened) return false;
            if (reset) {pos=0;return true;}
            if (pos>=entries.size()) return false;
            out=entries[pos++];return true;
        }
    private:
        std::string path;
        std::vector<ObjectInfo> entries;
        size_t pos=0;
        bool opened=false;
    };
public:
    std::unique_ptr<SDK::Interface::IDirectory> dir(const char* path) override {
        return std::make_unique<Listing>(path,*this);
    }
};
struct KernelFixture {
    SDK::TestSupport::StubSystem system;
    SDK::TestSupport::StubLogger logger;
    SDK::TestSupport::StubAppMemory memory;
    SDK::TestSupport::StubAppComm comm;
    MapFileSystem fileSystem;
    SDK::Kernel kernel{system,logger,memory,comm,fileSystem};
};
}
