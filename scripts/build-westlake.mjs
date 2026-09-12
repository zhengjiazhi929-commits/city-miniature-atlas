#!/usr/bin/env node
/** Rebuild the West Lake bundle from existing local Hangzhou data; no network. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import polygonClipping from '../vendor/polygon-clipping.js';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(app,'data/scenes/westlake');
const bbox=[120.105,30.217,120.169,30.273];
const sourceNames=['scene-data.json','terrain-mesh.json'];
const sourceText=await Promise.all(sourceNames.map(n=>fs.readFile(path.join(app,'data/hangzhou-atlas',n),'utf8')));
const [source,baked]=sourceText.map(JSON.parse);
const circumference=40075016.68557849;
const merc=([lng,lat])=>[(lng+180)/360,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2];
const inv=([x,y])=>[x*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI];
const origin=[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2],center=merc(origin);
const metresPerMercator=circumference*Math.cos(origin[1]*Math.PI/180);
const project=coord=>{const p=merc(coord);return[(p[0]-center[0])*metresPerMercator,(p[1]-center[1])*metresPerMercator];};
const oldCenter=merc(baked.stats.projectionCenter);
const oldScale=baked.stats.metersToUnits*circumference*Math.cos(baked.stats.projectionCenter[1]*Math.PI/180);
const fromOld=(x,z)=>inv([x/oldScale+oldCenter[0],z/oldScale+oldCenter[1]]);
const oldProject=coord=>{const p=merc(coord);return[(p[0]-oldCenter[0])*oldScale,(p[1]-oldCenter[1])*oldScale];};
const nw=oldProject([bbox[0],bbox[3]]),se=oldProject([bbox[2],bbox[1]]),clipBox=[nw[0],nw[1],se[0],se[1]];
const rect=[[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]];
const extent=rings=>{const ps=rings.flat();return[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];};
const intersects=b=>b[2]>=bbox[0]&&b[0]<=bbox[2]&&b[3]>=bbox[1]&&b[1]<=bbox[3];
const within=c=>c[0]>=bbox[0]&&c[0]<=bbox[2]&&c[1]>=bbox[1]&&c[1]<=bbox[3];
function clippedPolygons(entries){
  return entries.flatMap((p,index)=>{
    if(!intersects(extent(p.rings)))return[];
    if(p.rings.every(r=>r.every(within)))return[{...p,sourceIndex:index}];
    return polygonClipping.intersection(p.rings,rect).map(rings=>({...p,rings,sourceIndex:index,clipped:true}));
  });
}
const water=clippedPolygons(source.water),forest=clippedPolygons(source.forest),urban=clippedPolygons(source.urban);
const lake=water.find(w=>w.areaMeters===6124570);
if(!lake||lake.clipped||lake.rings.length!==7)throw new Error('The complete source lake and all six holes must be preserved.');
lake.id='westlake-water';
function clipSegment(a,b){
  let t0=0,t1=1;const dx=b[0]-a[0],dy=b[1]-a[1];
  for(const[p,q]of[[-dx,a[0]-bbox[0]],[dx,bbox[2]-a[0]],[-dy,a[1]-bbox[1]],[dy,bbox[3]-a[1]]]){
    if(p===0){if(q<0)return null;continue;}const r=q/p;if(p<0)t0=Math.max(t0,r);else t1=Math.min(t1,r);if(t0>t1)return null;
  }
  return[[a[0]+dx*t0,a[1]+dy*t0],[a[0]+dx*t1,a[1]+dy*t1]];
}
const roads=[];
for(const road of source.roads){
  if(!intersects(extent([road.points])))continue;
  let points=[];const flush=()=>{if(points.length>1)roads.push({...road,points});points=[];};
  for(let i=1;i<road.points.length;i++){
    const part=clipSegment(road.points[i-1],road.points[i]);
    if(!part){flush();continue;}
    if(points.length&&Math.hypot(points.at(-1)[0]-part[0][0],points.at(-1)[1]-part[0][1])>1e-8)flush();
    if(!points.length)points.push(part[0]);points.push(part[1]);
  }flush();
}
function clipPolygon(points,axis,edge,keepGreater){
  const result=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],aa=keepGreater?a[axis]>=edge:a[axis]<=edge,bb=keepGreater?b[axis]>=edge:b[axis]<=edge;
    if(aa)result.push(a);
    if(aa!==bb){const t=(edge-a[axis])/(b[axis]-a[axis]);result.push(a.map((v,k)=>v+(b[k]-v)*t));}
  }return result;
}
const positions=[],indices=[],keys=new Map();
function vertex(p){
  const[x,z]=project(fromOld(p[0],p[2]));
  const values=[Number(x.toFixed(4)),Number(p[1].toFixed(4)),Number(z.toFixed(4))],key=values.join(',');
  if(keys.has(key))return keys.get(key);const id=positions.length/3;keys.set(key,id);positions.push(...values);return id;
}
let sourceTriangles=0;
for(let i=0;i<baked.indices.length;i+=3){
  let poly=baked.indices.slice(i,i+3).map(j=>baked.positions.slice(j*3,j*3+3));
  if(Math.max(...poly.map(p=>p[0]))<clipBox[0]||Math.min(...poly.map(p=>p[0]))>clipBox[2]||Math.max(...poly.map(p=>p[2]))<clipBox[1]||Math.min(...poly.map(p=>p[2]))>clipBox[3])continue;
  for(const[axis,edge,g]of[[0,clipBox[0],true],[0,clipBox[2],false],[2,clipBox[1],true],[2,clipBox[3],false]]){poly=clipPolygon(poly,axis,edge,g);if(!poly.length)break;}
  if(poly.length<3)continue;sourceTriangles++;
  for(let j=1;j<poly.length-1;j++){
    const ids=[poly[0],poly[j],poly[j+1]].map(vertex);
    const[a,b,c]=ids.map(id=>positions.slice(id*3,id*3+3));
    const area=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
    if(Math.abs(area)<.00001)continue;indices.push(...(area>0?[ids[0],ids[2],ids[1]]:ids));
  }
}
const boundaries=new Map();
for(let i=0;i<indices.length;i+=3)for(const[a,b]of[[indices[i],indices[i+1]],[indices[i+1],indices[i+2]],[indices[i+2],indices[i]]]){
  const k=[Math.min(a,b),Math.max(a,b)].join(',');const found=boundaries.get(k);if(found)found.count++;else boundaries.set(k,{a,b,count:1});
}
const cutEdges=[...boundaries.values()].filter(e=>e.count===1).map(({a,b})=>[a,b]);
const terrain={positions,indices,cutEdges,sourceTriangles,rawElevationRange:[Math.min(...positions.filter((_,i)=>i%3===1)),Math.max(...positions.filter((_,i)=>i%3===1))]};
const landmarks=source.landmarks.filter(l=>['leifeng','santan','broken-bridge'].includes(l.id));
const data={version:1,id:'westlake',crs:'EPSG:4326',bbox,extentRole:'Declared viewing rectangle around the complete lake and immediate surroundings; not an official scenic-area or administrative boundary.',
  projection:{type:'local-scaled-web-mercator',origin,metresPerMercator,metersToUnits:.004,heightScale:2.5,horizontalDeformation:false,extentMeters:[...project([bbox[0],bbox[3]]),...project([bbox[2],bbox[1]])]},
  terrain,water,roads,forest,urban,landmarks,
  source:{upstream:'data/hangzhou-atlas/NOTICE.md',localSources:sourceNames.map((name,i)=>({path:`data/hangzhou-atlas/${name}`,sha256:createHash('sha256').update(sourceText[i]).digest('hex')})),vectors:'© OpenStreetMap contributors / OpenFreeMap / OpenMapTiles; ODbL',terrain:'AWS Terrain Tiles / Mapzen; cropped already-baked city DEM mesh',sourceDemGridMetersApprox:900},
  stats:{terrainVertices:positions.length/3,terrainTriangles:indices.length/3,waterPolygons:water.length,mainLakeRings:lake.rings.length,mainLakeOriginalAreaMeters:lake.areaMeters,roads:roads.length,sourceForestPolygons:forest.length,sourceUrbanPolygons:urban.length,landmarks:landmarks.length}};
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'scene-data.json'),JSON.stringify(data)+'\n');
console.log(JSON.stringify({...data.stats,terrainRange:terrain.rawElevationRange,extentMeters:data.projection.extentMeters,bytes:(await fs.stat(path.join(out,'scene-data.json'))).size},null,2));
