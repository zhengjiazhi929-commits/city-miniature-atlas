#!/usr/bin/env node
// Reuse checked local archives; fetch missing tiles from this exact snapshot.
// Never substitute the live/current tile endpoint or a different snapshot.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {VectorTile} from '../vendor/vector-tile.js';
import Pbf from '../vendor/pbf.js';

const app=fileURLToPath(new URL('../',import.meta.url));
const root=process.env.ATLAS_SOURCE_ROOT?path.resolve(process.env.ATLAS_SOURCE_ROOT):app;
const dir=path.join(app,'work/hangzhou-five-v020/east-source');
const bbox=[120.38,30.12,120.66,30.46],zoom=13,snapshot='20260830_080001_pt';
const template=`https://tiles.openfreemap.org/planet/${snapshot}/{z}/{x}/{y}.pbf`;
const layers=['building','landuse','landcover','water','waterway','transportation','park','place'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const tx=lon=>Math.floor((lon+180)/360*2**zoom);
const ty=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**zoom);
const jobs=[];
for(let y=ty(bbox[3]);y<=ty(bbox[1]);y++)for(let x=tx(bbox[0]);x<=tx(bbox[2]);x++)jobs.push({x,y,z:zoom});
await fs.mkdir(path.join(dir,'tiles'),{recursive:true});
const candidates=new Map();
for(const archive of ['work/hangzhou-concept-v3/supports/expanded','work/hangzhou-concept-v3/supports','work/hangzhou-unified-v013/source']){
  const file=path.join(root,archive,'provenance.json');let provenance;
  try{provenance=JSON.parse(await fs.readFile(file,'utf8'));}catch{continue;}
  for(const t of provenance.tiles||[]){
    if(t.z!==zoom||!t.url.includes(`/planet/${snapshot}/`)||t.status==='failed')continue;
    const key=`${t.z}-${t.x}-${t.y}`;
    if(!candidates.has(key))candidates.set(key,{...t,archive,archiveRetrievedAt:provenance.retrievedAt});
  }
}
let cursor=0,complete=0,reused=0,downloaded=0;
const records=new Array(jobs.length),failureRecords=[];
await Promise.all(Array.from({length:4},async()=>{
  while(cursor<jobs.length){
    const index=cursor++,job=jobs[index],{x,y,z}=job,key=`${z}-${x}-${y}`;
    const url=template.replace('{z}',z).replace('{x}',x).replace('{y}',y),file=path.join(dir,'tiles',`${key}.pbf`);
    try{
      let bytes=null,origin=null;const prior=candidates.get(key);
      if(prior){
        const previous=path.join(root,prior.archive,'tiles',`${key}.pbf`);
        try{
          const candidate=await fs.readFile(previous);
          if((!prior.bytes||prior.bytes===candidate.length)&&(!prior.sha256||prior.sha256===digest(candidate))){
            new VectorTile(new Pbf(candidate));bytes=candidate;origin={kind:'reused-local-archive',path:path.relative(root,previous),retrievedAt:prior.archiveRetrievedAt};reused++;
          }
        }catch{}
      }
      const attempts=[];
      if(!bytes)for(let attempt=1;attempt<=3&&!bytes;attempt++){
        try{
          const response=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:'error'});
          attempts.push({attempt,status:response.status});
          if(!response.ok)throw Error(`HTTP ${response.status}`);
          const candidate=Buffer.from(await response.arrayBuffer());new VectorTile(new Pbf(candidate));
          bytes=candidate;origin={kind:'fixed-snapshot-public-get',retrievedAt:new Date().toISOString(),etag:response.headers.get('etag')};downloaded++;
        }catch(error){if(attempts.at(-1)?.attempt!==attempt)attempts.push({attempt,error:String(error)});else attempts.at(-1).error=String(error);if(attempt===3)throw Error(JSON.stringify(attempts));}
      }
      await fs.writeFile(file,bytes);
      records[index]={...job,url,status:'success',bytes:bytes.length,sha256:digest(bytes),origin};
    }catch(error){const item={...job,url,status:'failed',error:String(error)};records[index]=item;failureRecords.push(item);}
    complete++;if(complete%20===0||complete===jobs.length)console.log(JSON.stringify({complete,total:jobs.length,reused,downloaded,failed:failureRecords.length}));
  }
}));
const provenance={retrievedAt:new Date().toISOString(),bbox,coordinateReference:'WGS84 longitude latitude, no GCJ02 conversion',zoom,snapshot,template,
  attribution:'© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap',
  note:'Fixed source snapshot. Raw MVT tile buffers are retained in this archive; consumers must crop to bbox and actual Hangzhou municipality. No feature absence proves empty land. Newly fetched tiles must use the same snapshot as reused archived tiles.',
  tiles:records,failures:failureRecords,stats:{expectedTiles:jobs.length,successfulTiles:jobs.length-failureRecords.length,reusedTiles:reused,downloadedTiles:downloaded}};
await fs.writeFile(path.join(dir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
if(failureRecords.length)throw Error(`Fixed snapshot unavailable for ${failureRecords.length} tiles; recorded failures, refusing mixed-version or partial extraction.`);

const collections=Object.fromEntries(layers.map(layer=>[layer,{type:'FeatureCollection',features:[]}]));
for(const t of records){
  const tile=new VectorTile(new Pbf(await fs.readFile(path.join(dir,'tiles',`${t.z}-${t.x}-${t.y}.pbf`))));
  for(const name of layers){const layer=tile.layers[name];if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const f=layer.feature(i).toGeoJSON(t.x,t.y,t.z);
      if(name==='transportation'&&!['motorway','trunk','primary','secondary'].includes(f.properties.class))continue;
      f.properties={...f.properties,sourceLayer:name,sourceTile:`${t.z}/${t.x}/${t.y}`,sourceSnapshot:snapshot};
      collections[name].features.push(f);
    }
  }
}
provenance.counts={};provenance.extractedFiles=[];
for(const [name,collection]of Object.entries(collections)){
  const bytes=JSON.stringify(collection)+'\n',filename=`${name}.geojson`;
  await fs.writeFile(path.join(dir,filename),bytes);provenance.counts[name]=collection.features.length;
  provenance.extractedFiles.push({file:filename,bytes:Buffer.byteLength(bytes),sha256:digest(bytes)});
}
provenance.script={path:path.relative(app,fileURLToPath(import.meta.url)),sha256:digest(await fs.readFile(fileURLToPath(import.meta.url)))};
await fs.writeFile(path.join(dir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({complete:true,...provenance.stats,counts:provenance.counts}));
