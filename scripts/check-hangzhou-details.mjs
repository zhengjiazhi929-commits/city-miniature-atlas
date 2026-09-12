import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {attractions,cities} from '../src/catalog.js';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.join(app,'data/scenes/hangzhou-details');
const hash=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p));
const manifests=read(path.join(root,'sources/manifest.json'));
for(const r of manifests.records){const b=fs.readFileSync(path.join(root,'sources',r.file));assert.equal(hash(b),r.sha256);assert.equal(b.length,r.bytes);assert.ok(r.url.startsWith('https://api.openstreetmap.org/'));}
for(const r of read(path.join(root,'sources/dem-manifest.json')).tiles)assert.equal(hash(fs.readFileSync(path.join(root,r.file))),r.sha256);
const cityHash=hash(fs.readFileSync(path.join(app,'data/hangzhou-atlas/scene-data.json'))),ids=[...cities.find(c=>c.id==='hangzhou').attractions,'zshc'];
assert.equal(new Set(ids).size,12);
const bundles=[];
const overviewOnlyIds=['olympic','hubin-yintai','zshc'];
for(const id of ids){
 if(overviewOnlyIds.includes(id)){
  assert.equal(attractions[id].overviewOnly,true,id+' stays in the city overview');
  assert.equal(attractions[id].create,undefined,id+' must not load a detail model');
 }else{assert.equal(typeof attractions[id].create,'function',id+' must open a real scene');assert.notEqual(attractions[id].overviewOnly,true);}
 if(['westlake','leifeng'].includes(id))continue;
 const file=path.join(root,id+'.json'),d=read(file);assert.equal(d.source.cityFallbackSha256,cityHash,id+' city fallback source changed');
 assert.ok(d.terrain.positions.length>300&&d.terrain.positions.every(Number.isFinite));assert.ok(d.terrain.indices.every(i=>Number.isInteger(i)&&i>=0&&i<d.terrain.positions.length/3));
 assert.ok(d.bbox[0]<attractions[id].coordinates[0]&&d.bbox[2]>attractions[id].coordinates[0]&&d.bbox[1]<attractions[id].coordinates[1]&&d.bbox[3]>attractions[id].coordinates[1],id+' anchor must be inside declared crop');
 assert.ok(fs.existsSync(path.resolve(app,attractions[id].source)));bundles.push({id,bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file)),sourceBuildings:d.buildings.length,roads:d.roads.length,water:d.water.length});
}
const airport=read(path.join(app,'data/airports/hangzhou.json'));assert.deepEqual(attractions.zshc.coordinates,airport.coordinates);
console.log(JSON.stringify({passed:true,independentDestinations:ids.length-overviewOnlyIds.length,overviewOnlyIds,osmSnapshots:manifests.records.length,bundles,limitations:'Integrity, declared crop and route availability only; runtime rendering and physical contacts checked separately.'},null,2));
