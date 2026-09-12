/** Cartographic abstraction of real source polygons; no generated footprints. */
export const CITY_ROAD_CLASSES=new Set(['motorway','trunk','primary','secondary']);
export const CITY_PALETTE={base:'#b3bf9b',water:'#71abc1',waterway:'#80b1be',road:'#f0e4cd',minorRoad:'#ede2ce',wood:'#668568',forest:'#668568',grass:'#a0b58a',farmland:'#c3c69a',scrub:'#8ca27b',wetland:'#8eaca0',sand:'#dacbad',rock:'#aeaf98',residential:'#d6c7ae',industrial:'#c9bda8',cemetery:'#8fa487',park:'#88a67b',building:'#d5bd97'};
export function cityAbstractionOptions(option,focusPoint,landmarks=[]){
  if(!option)return null;
  const input=typeof option==='object'?option:{};
  return {center:focusPoint||input.center||landmarks[0]?.coordinates,landmarks,
    maxBlocks:Math.max(1,Math.min(180,input.maxBlocks||180)),maxTriangles:18000,
    displayHeightMeters:Math.max(1,Math.min(120,input.displayHeightMeters||24)),
    minimumAreaMeters:2500,detailRadiusMeters:1500,detailTriangles:30000,detailTiles:4};
}
export function coordinateDistance(a,b){const lat=(a[1]+b[1])*.5*Math.PI/180;return Math.hypot((a[0]-b[0])*111320*Math.cos(lat),(a[1]-b[1])*111320);}
export function sourcePolygonMetrics(polygon,projection){
  let area=0;const outer=polygon[0];
  for(let r=0;r<polygon.length;r++){const points=polygon[r].map(c=>projection.project(c));let a=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];a+=p.x*q.z-q.x*p.z;}area+=(r?-1:1)*Math.abs(a/2)/projection.metersToUnits**2;}
  const unique=outer.length>1&&outer[0][0]===outer.at(-1)[0]&&outer[0][1]===outer.at(-1)[1]?outer.slice(0,-1):outer;
  const center=unique.reduce((sum,c)=>[sum[0]+c[0]/unique.length,sum[1]+c[1]/unique.length],[0,0]);
  return {area:Math.max(0,area),center};
}
export function stableBlockOrder(candidates,center){
  // Prefer substantial source clusters near the requested urban view. Stable
  // source keys break ties, so network completion order never selects buildings.
  return candidates.sort((a,b)=>(b.area/(1+coordinateDistance(b.center,center)/4000))-(a.area/(1+coordinateDistance(a.center,center)/4000))||a.key.localeCompare(b.key));
}
