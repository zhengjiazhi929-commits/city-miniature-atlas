#!/usr/bin/env node
/** Pre-triangulate the checked Hangzhou boundary minus real water polygons.
 * No fetching, texture generation, or display-height exaggeration.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three.module.js';
import polygonClipping from '../vendor/polygon-clipping.js';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourcePath=path.join(app,'data/hangzhou-atlas/scene-data.json');
const outputPath=path.join(app,'data/hangzhou-atlas/terrain-mesh.json');
const projectionPath=path.join(app,'src/region-projection.js');
const sourceText=await fs.readFile(sourcePath,'utf8');
const projectionSource=await fs.readFile(projectionPath,'utf8');
// Reuse the actual runtime projection, substituting only the browser import-map
// identifier so the exact same module runs under Node without dependencies.
const projectionCode=projectionSource.replace("from 'three'",`from '${pathToFileURL(path.join(app,'vendor/three.module.js')).href}'`);
const {createRegionProjection}=await import(`data:text/javascript;base64,${Buffer.from(projectionCode).toString('base64')}`);
const data=JSON.parse(sourceText),started=performance.now();
const region={type:'Feature',properties:{id:'hangzhou',name:'杭州'},geometry:{type:'MultiPolygon',coordinates:data.boundary}};
const projection=createRegionProjection(region);
const toXZ=c=>{const p=projection.project(c);return[p.x,p.z];};
const polygons=data.boundary.map(poly=>poly.map(ring=>ring.map(toXZ)));
const water=data.water.map(poly=>poly.rings.map(ring=>ring.map(toXZ)));
const waterUnion=water.length?polygonClipping.union(...water):[];
const land=waterUnion.length?polygonClipping.difference(polygons,waterUnion):polygons;
const clippingReady=performance.now();

function rawHeight([lng,lat]){
  const g=data.terrain,[w,s,e,n]=g.bbox;
  const fx=THREE.MathUtils.clamp((lng-w)/(e-w)*(g.width-1),0,g.width-1);
  const fy=THREE.MathUtils.clamp((n-lat)/(n-s)*(g.height-1),0,g.height-1);
  const x=Math.floor(fx),y=Math.floor(fy),u=fx-x,v=fy-y;
  const read=(a,b)=>g.values[Math.min(g.height-1,b)*g.width+Math.min(g.width-1,a)];
  const height=(read(x,y)*(1-u)+read(x+1,y)*u)*(1-v)+(read(x,y+1)*(1-u)+read(x+1,y+1)*u)*v;
  if(!Number.isFinite(height))throw new Error(`Missing DEM sample at ${lng},${lat}`);
  return height;
}

const extent=[Infinity,Infinity,-Infinity,-Infinity];
for(const polygon of polygons)for(const ring of polygon)for(const[x,z]of ring){extent[0]=Math.min(extent[0],x);extent[1]=Math.min(extent[1],z);extent[2]=Math.max(extent[2],x);extent[3]=Math.max(extent[3],z);}
const width=extent[2]-extent[0],depth=extent[3]-extent[1];
const columns=256,rows=Math.ceil(columns*depth/width),dx=width/columns,dz=depth/rows;
const rectangle=(x,z,xx,zz)=>[[[x,z],[xx,z],[xx,zz],[x,zz],[x,z]]];
const positions=[],indices=[],vertices=new Map();
let minimumElevation=Infinity,maximumElevation=-Infinity,degenerateTriangles=0,emptyCells=0;
function vertex(x,z){
  const key=`${x.toFixed(7)},${z.toFixed(7)}`;
  if(vertices.has(key))return vertices.get(key);
  const index=positions.length/3;
  const h=rawHeight(projection.unproject(x,z));
  positions.push(Number(x.toFixed(7)),Number(h.toFixed(4)),Number(z.toFixed(7)));
  minimumElevation=Math.min(minimumElevation,h);maximumElevation=Math.max(maximumElevation,h);
  vertices.set(key,index);return index;
}

for(let row=0;row<rows;row++){
  const z0=extent[1]+row*dz,z1=z0+dz;
  const strip=polygonClipping.intersection(land,rectangle(extent[0],z0,extent[2],z1));
  if(strip.length)for(let col=0;col<columns;col++){
    const x0=extent[0]+col*dx;
    const cell=polygonClipping.intersection(strip,rectangle(x0,z0,x0+dx,z1));
    if(!cell.length){emptyCells++;continue;}
    for(const polygon of cell){
      const rings=polygon.map(r=>r.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,z)));
      const points=rings.flat(),local=points.map(p=>vertex(p.x,p.y));
      for(const[a,b,c]of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1))){
        const ia=local[a],ib=local[b],ic=local[c];
        const ax=positions[ia*3],az=positions[ia*3+2],bx=positions[ib*3],bz=positions[ib*3+2],cx=positions[ic*3],cz=positions[ic*3+2];
        const area=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
        if(Math.abs(area)<=1e-9){degenerateTriangles++;continue;}
        // A clockwise X/Z triangle has positive Y normal in this coordinate frame.
        indices.push(ia,...(area>0?[ic,ib]:[ib,ic]));
      }
    }
  }
  else emptyCells+=columns;
  if(row%24===0||row===rows-1)process.stderr.write(`Hangzhou terrain: ${row+1}/${rows} strips, ${indices.length/3} triangles\n`);
}

let downwardTriangles=0,outOfRangeIndices=0;
for(let i=0;i<indices.length;i+=3){
  const a=indices[i],b=indices[i+1],c=indices[i+2];
  if(a>=positions.length/3||b>=positions.length/3||c>=positions.length/3)outOfRangeIndices++;
  const signed=(positions[b*3]-positions[a*3])*(positions[c*3+2]-positions[a*3+2])-(positions[b*3+2]-positions[a*3+2])*(positions[c*3]-positions[a*3]);
  if(signed>=0)downwardTriangles++;
}
if(downwardTriangles||outOfRangeIndices)throw new Error(`Invalid triangulation: ${downwardTriangles} downward, ${outOfRangeIndices} invalid indices`);
const stats={
  sourceSha256:createHash('sha256').update(sourceText).digest('hex'),
  projectionSourceSha256:createHash('sha256').update(projectionSource).digest('hex'),
  source:'scene-data.json, checked local OSM/OpenFreeMap polygons and AWS Terrarium DEM',
  rawElevationUnits:'meters; apply metersToUnits and chosen heightScale at runtime',
  horizontalCoordinates:'x east, z south; same createRegionProjection 40-unit frame',
  projectionCenter:projection.center,metersToUnits:projection.metersToUnits,bbox:data.bbox,extentXZ:extent,
  columns,rows,vertices:positions.length/3,triangles:indices.length/3,
  waterSourcePolygons:water.length,landPolygons:land.length,landHoles:land.reduce((sum,p)=>sum+p.length-1,0),
  minimumElevationMeters:Number(minimumElevation.toFixed(4)),maximumElevationMeters:Number(maximumElevation.toFixed(4)),
  degenerateTrianglesSkipped:degenerateTriangles,emptyCells,downwardTriangles,outOfRangeIndices,
  clippingMilliseconds:Math.round(clippingReady-started),bakeMilliseconds:Math.round(performance.now()-started),
};
const output={positions,indices,projection:'region-40-webmercator',stats};
await fs.writeFile(outputPath,JSON.stringify(output)+'\n');
process.stdout.write(JSON.stringify({...stats,path:outputPath,bytes:(await fs.stat(outputPath)).size})+'\n');
