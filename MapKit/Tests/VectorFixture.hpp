#pragma once
#include "PackFixture.hpp" // independent CRC and trust-marker helpers
namespace MapKitTest {
struct VectorSpec {
    uint8_t zoomMin=12,zoomMax=14,formatMajor=1;
    bool goodMagic=true;
    int32_t minLon=-76100000,minLat=44500000,maxLon=-75900000,maxLat=44700000;
    std::string attribution="Test map";
};
inline std::string vectorFixture(const VectorSpec& s={}) {
    const unsigned n=s.zoomMax-s.zoomMin+1;
    const std::string emptyLayer="\x1a\x0b\x0a\x04land\x28\x80\x02\x78\x02";
    std::string bytes(224+20*n,'\0');
    auto* h=reinterpret_cast<uint8_t*>(bytes.data());
    memcpy(h,s.goodMagic?"VMAP":"NOPE",4); h[4]=s.formatMajor;h[5]=s.zoomMin;h[6]=s.zoomMax;
    writeU32LE(h+8,n);writeI32LE(h+12,s.minLon);writeI32LE(h+16,s.minLat);
    writeI32LE(h+20,s.maxLon);writeI32LE(h+24,s.maxLat);
    writeU32LE(h+28,224);writeU32LE(h+32,bytes.size());writeU16LE(h+36,s.attribution.size());
    memcpy(h+40,s.attribution.data(),s.attribution.size());
    for(unsigned i=0;i<n;i++){
        auto* e=h+224+20*i;e[0]=s.zoomMin+i;
        writeU32LE(e+12,bytes.size()+emptyLayer.size()*i);writeU32LE(e+16,emptyLayer.size());
    }
    for(unsigned i=0;i<n;i++) bytes+=emptyLayer;
    auto crc=crc32(reinterpret_cast<const uint8_t*>(bytes.data()),bytes.size());
    uint8_t footer[4];writeU32LE(footer,crc);bytes.append(reinterpret_cast<char*>(footer),4);return bytes;
}
}
