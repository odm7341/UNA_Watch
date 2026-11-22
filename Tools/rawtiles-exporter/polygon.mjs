// Work in normalized Web Mercator so the edges match the map's straight
// screen segments. Recursively discard empty quadrants (even for thin shapes).
export function polygonTiles(vertices, min, max, limit = 1024) {
  if (min > max) throw Error('Minimum zoom exceeds maximum zoom.');
  if (vertices.length < 3) throw Error('Add at least three corners.');
  if (vertices.length > 256) throw Error('Limit: 256 corners.');
  const ring = vertices.map(({lat,lng}, i) => {
    if (!Number.isFinite(lat+lng) || Math.abs(lat)>85.051129 || Math.abs(lng)>180 ||
        Math.abs(lng-vertices[(i+1)%vertices.length].lng)>180)
      throw Error('Choose an area within the map that does not cross the date line.');
    return [(lng+180)/360,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2];
  });
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for (let i=0;i<ring.length;i++) {
    const a=ring[i], b=ring[(i+1)%ring.length];
    if (a[0]===b[0] && a[1]===b[1]) throw Error('Remove the duplicate corner.');
    for (let j=i+2;j<ring.length;j++) {
      if (i===0 && j===ring.length-1) continue;
      const c=ring[j], d=ring[(j+1)%ring.length];
      if ([0,1].some(k=>Math.min(a[k],b[k])>Math.max(c[k],d[k]) ||
          Math.min(c[k],d[k])>Math.max(a[k],b[k]))) continue;
      if (cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0)
        throw Error('Polygon edges must not cross.');
    }
  }
  function half(points, axis, boundary, sign) {
    const out=[];
    for(let i=0;i<points.length;i++) {
      const a=points[(i+points.length-1)%points.length], b=points[i];
      const insideA=sign*(a[axis]-boundary)>=0, insideB=sign*(b[axis]-boundary)>=0;
      if(insideA!==insideB) {
        const t=(boundary-a[axis])/(b[axis]-a[axis]), p=[0,0];
        p[axis]=boundary; p[1-axis]=a[1-axis]+t*(b[1-axis]-a[1-axis]); out.push(p);
      }
      if(insideB) out.push(b);
    }
    return out;
  }
  const tiles=[];
  function visit(points,z,x,y) {
    let area=0;
    for(let i=2;i<points.length;i++) area+=cross(points[0],points[i-1],points[i]);
    if(!area) return;
    if(z>=min) {
      tiles.push({z,x,y});
      if(tiles.length>limit) throw Error(`Limit: ${limit} tiles. Reduce the area or zoom range.`);
    }
    if(z===max) return;
    const size=2**-z;
    for(let dx=0;dx<2;dx++) {
      const side=half(points,0,(x+.5)*size,dx?1:-1);
      for(let dy=0;dy<2;dy++) visit(half(side,1,(y+.5)*size,dy?1:-1),z+1,2*x+dx,2*y+dy);
    }
  }
  visit(ring,0,0,0);
  if(!tiles.length) throw Error('Choose a polygon with nonzero area.');
  return tiles.sort((a,b)=>a.z-b.z || a.x-b.x || a.y-b.y);
}
