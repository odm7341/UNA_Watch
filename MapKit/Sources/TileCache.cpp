#include <MapKit/TileCache.hpp>
#include <MapKit/VectorTile.hpp>
#include <algorithm>
#include <cstdlib>
#include <cstring>

namespace MapKit {
namespace {
// Exporter clips and quantizes to extent 256 and triangulates fills on the
// desktop. No polygon lists, sorting, floating point or allocation on watch.
class Paint final : public VectorTile::Sink {
public:
    Paint(uint8_t* dst,int scale,int ox,int oy) : pixels(dst),scale(scale),ox(ox),oy(oy) {}
    bool good = true;
    void beginLayer(const char* name, size_t n, uint32_t extent) override {
        auto is = [&](const char* s){ return strlen(s)==n && !memcmp(name,s,n); };
        colour = is("land") ? 1 : is("water") ? 2 : is("road") || is("trail") || is("peak") || is("contour") ? 3 : 0;
        dashed = is("trail");
        contour = is("contour");
        if (extent != 256) good = false;
    }
    void beginFeature(VectorTile::Geometry g) override { type = g; vertices = 0; }
    void moveTo(int32_t x,int32_t y) override {
        if (!bounded(x,y)) return;
        x=x*scale-ox; y=y*scale-oy;
        first = last = {x,y}; vertices = 1;
        if (type == VectorTile::Geometry::Point) dot(x,y);
    }
    void lineTo(int32_t x,int32_t y) override {
        if (!bounded(x,y)) return;
        x=x*scale-ox; y=y*scale-oy;
        if (type == VectorTile::Geometry::Polygon) {
            if (++vertices == 2) middle = {x,y};
            else if (vertices != 3) good = false;
        } else {
            if ((last.x<0 && x<0) || (last.y<0 && y<0) ||
                (last.x>=256 && x>=256) || (last.y>=256 && y>=256)) { last={x,y}; return; }
            int dx = abs(x-last.x), dy = -abs(y-last.y);
            int sx = last.x<x ? 1:-1, sy = last.y<y ? 1:-1, err=dx+dy;
            if (!spend(1+std::max(dx,-dy)/scale)) return;
            for (int i=0;;++i) {
                if ((!dashed || (i%6)<4) && (!contour || ((last.x+last.y)&3)==0)) dot(last.x,last.y);
                if (last.x==x && last.y==y) break;
                int e=2*err;
                if(e>=dy){err+=dy;last.x+=sx;}
                if(e<=dx){err+=dx;last.y+=sy;}
            }
        }
        last = {x,y};
    }
    void closePath() override {
        if (!good || !colour) return;
        if (vertices != 3) {good=false;return;}
        P a=first,b=middle,c=last;
        if(a.y>b.y) std::swap(a,b);
        if(b.y>c.y) std::swap(b,c);
        if(a.y>b.y) std::swap(a,b);
        for(int y=std::max(a.y,0);y<std::min(c.y,256);++y){
            auto cross=[y](P p,P q){return p.x+(q.x-p.x)*(y-p.y)/(q.y-p.y);};
            int l=cross(a,c), r=y<b.y ? cross(a,b):cross(b,c);
            if(l>r) std::swap(l,r);
            l=std::max(0,l);r=std::min(256,r);
            if((y+oy)%scale==0 && !spend(4+std::max(0,r-l)/(4*scale))) return;
            while(l<r && (l&3)) dot(l++,y);
            int bytes=(r-l)/4;
            if(bytes>0){memset(pixels+y*64+l/4,colour*0x55,bytes);l+=bytes*4;}
            while(l<r) dot(l++,y);
        }
    }
private:
    struct P {int x,y;} first{},middle{},last{};
    uint8_t* pixels;
    int scale,ox,oy;
    VectorTile::Geometry type{};
    unsigned vertices=0, colour=0;
    int budget=500000;
    bool dashed=false, contour=false;
    bool spend(int n){budget-=n;return good = budget>=0;}
    bool bounded(int x,int y){if(x < -8 || x>264 || y < -8 || y>264) good=false;return good && colour;}
    void dot(int x,int y){
        if(unsigned(x)>=256 || unsigned(y)>=256) return;
        auto& b=pixels[y*64+x/4]; int shift=2*(x&3);
        b=uint8_t((b & ~(3<<shift)) | (colour<<shift));
    }
};
}
const uint8_t* TileCache::get(const VectorPack& pack,uint8_t z,uint32_t x,uint32_t y){
    Slot& s=slots[(x&1)+2*(y&1)];
    if(!s.used || s.x!=x || s.y!=y || s.z!=z){
        s.x=x;s.y=y;s.z=z;s.used=true;s.valid=false;
        const unsigned shift=pack.displayShift(z), scale=1u<<shift;
        auto tile=pack.findTile(z-shift,x>>shift,y>>shift);
        if(tile.valid() && pack.readTile(tile,input,sizeof(input))){
            memset(s.pixels,0,sizeof(s.pixels));
            Paint paint(s.pixels,scale,(x%scale)*256,(y%scale)*256);
            s.valid=VectorTile::decode(input,tile.length,paint) && paint.good;
        }
    }
    return s.valid ? s.pixels : nullptr;
}
}
