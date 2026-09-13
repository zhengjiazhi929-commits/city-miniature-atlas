import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {collectCitySources,normalizeOverpass,CITY_SOURCE_LIMITS} from './city-sources.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)),root=await fs.mkdtemp(path.join(os.tmpdir(),'city-source-check-'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=v=>structuredClone(v);
const brief=JSON.parse(await fs.readFile(path.join(repo,'examples/city-workflow/wuhan.json'),'utf8'));
const jsonResponse=(body,extra={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{headers:{'content-type':'application/json',...extra}});
const line={type:'Feature',properties:{highway:'primary'},geometry:{type:'LineString',coordinates:[[114.29,30.54],[114.31,30.55]]}};
const collection={type:'FeatureCollection',features:[line]};
const networkBrief=()=>{const b=clone(brief);b.sources=[{id:'test-net',kind:'geojson',url:'https://overpass-api.de/api/interpreter?data=test',source:b.sources[0].source}];return b;};
let checks=0;
const reject=async(p,pattern)=>{await assert.rejects(p,pattern);checks++;};
try{
  await fs.mkdir(path.join(root,'data/regions'),{recursive:true});await fs.mkdir(path.join(root,'data/city-workflow-samples'),{recursive:true});
  for(const file of ['data/regions/wuhan.geojson','data/city-workflow-samples/wuhan-yellow-crane-overpass.json'])await fs.copyFile(path.join(repo,file),path.join(root,file));
  const initial=await fs.readFile(path.join(root,brief.sources[0].path));
  const acquisition=JSON.parse(await fs.readFile(path.join(repo,'data/city-workflow-samples/wuhan-yellow-crane-acquisition.json')));
  assert.equal(digest(initial),acquisition.sha256);assert.equal(initial.length,acquisition.bytes);
  const tower=JSON.parse(initial).elements.find(e=>e.type==='way'&&e.id===81641900);
  const towerCenter=['lon','lat'].map(axis=>Number(((Math.min(...tower.geometry.map(p=>p[axis]))+Math.max(...tower.geometry.map(p=>p[axis])))/2).toFixed(7)));
  assert.deepEqual(brief.landmarks[0].coordinates,towerCenter);assert.equal(brief.landmarks[0].sourceUrl,'https://www.openstreetmap.org/way/81641900');
  const result=await collectCitySources(brief,{root,outputDir:'work/frozen'});
  assert.equal(result.boundary.properties.name,'武汉');assert.equal(result.features.features.length,1439);
  assert.deepEqual(result.display.focus,[114.2970471,30.5470776]);
  assert.equal(result.provenance.warnings.length,0);
  assert.ok(result.features.features.some(f=>f.properties.sourceLayer==='water'));assert.ok(result.features.features.some(f=>f.properties.sourceLayer==='park'));
  for(const input of result.provenance.inputs){const bytes=await fs.readFile(path.join(root,'work/frozen',input.snapshotPath));assert.equal(digest(bytes),input.sha256);assert.equal(bytes.length,input.bytes);assert.ok(Number.isFinite(Date.parse(input.acquiredAt)));assert.deepEqual(bytes,await fs.readFile(path.join(root,input.inputPath)));}
  assert.deepEqual(await fs.readFile(path.join(root,brief.sources[0].path)),initial);checks++;
  await reject(collectCitySources(brief,{root,outputDir:'work/frozen'}),/must be empty/);
  await reject(collectCitySources(brief,{root,outputDir:'data/do-not-write'}),/existing project data/);
  await reject(collectCitySources(brief,{root,outputDir:'../escaped-output'}),/stay inside/);
  const badHash=clone(brief);badHash.sources[0].sha256='0'.repeat(64);await reject(collectCitySources(badHash,{root,outputDir:'work/bad-hash'}),{code:'CITY_SOURCE_HASH_MISMATCH'});
  await assert.rejects(fs.access(path.join(root,'work/bad-hash')),{code:'ENOENT'});
  for(const invalidPath of ['../outside.json','/tmp/private.json','./data/../package.json','./package.json','./data/.private.json','./data/secret.mjs','./data/secret.json?query=1']){
    const bad=clone(brief);bad.sources[0].path=invalidPath;await reject(collectCitySources(bad,{root}),/plain project-relative|escape/);
  }
  await fs.symlink(path.join(root,'data/city-workflow-samples/wuhan-yellow-crane-overpass.json'),path.join(root,'data/symlink.json'));
  const linked=clone(brief);linked.sources[0].path='./data/symlink.json';await reject(collectCitySources(linked,{root}),/symlink/);
  await fs.symlink(path.join(root,'data/city-workflow-samples'),path.join(root,'data/link-directory'));
  linked.sources[0].path='./data/link-directory/wuhan-yellow-crane-overpass.json';await reject(collectCitySources(linked,{root}),/symlink/);
  await fs.mkdir(path.join(root,'work/existing'),{recursive:true});await fs.symlink(path.join(root,'work/existing'),path.join(root,'work/output-link'));await reject(collectCitySources(brief,{root,outputDir:'work/output-link/new'}),/symlink/);
  await fs.writeFile(path.join(root,'data/not-json.json'),'<script>should never execute</script>');
  const malformed=clone(brief);delete malformed.sources[0].sha256;malformed.sources[0].path='./data/not-json.json';await reject(collectCitySources(malformed,{root}),/not valid UTF-8 JSON/);
  const large=await fs.open(path.join(root,'data/oversized.json'),'w');await large.truncate(CITY_SOURCE_LIMITS.maxResponseBytes+1);await large.close();malformed.sources[0].path='./data/oversized.json';await reject(collectCitySources(malformed,{root}),{code:'CITY_SOURCE_TOO_LARGE'});
  const wrongCity=clone(brief);wrongCity.city.name='杭州';delete wrongCity.city.nameEn;await reject(collectCitySources(wrongCity,{root}),/name does not match/);
  const wrongLandmark=clone(brief);wrongLandmark.landmarks[0].coordinates=[120.1,30.2];await reject(collectCitySources(wrongLandmark,{root}),/outside/);
  const wrongFocus=clone(brief);wrongFocus.display.focus=[120.1,30.2];await reject(collectCitySources(wrongFocus,{root}),/focus must lie inside/);
  const both=networkBrief();both.sources[0].path=brief.sources[0].path;await reject(collectCitySources(both,{root}),/exactly one/);
  let called=false;await reject(collectCitySources(networkBrief(),{root,fetchImpl:async()=>{called=true;return jsonResponse(collection);}}),{code:'CITY_SOURCE_NETWORK_DISABLED'});assert.equal(called,false);
  for(const url of ['http://overpass-api.de/api/interpreter','https://localhost/source.json','https://127.0.0.1/source.json','https://169.254.169.254/latest/meta-data.json','https://[::1]/data.json','https://name:password@overpass-api.de/api/interpreter','https://overpass-api.de:8443/api/interpreter','https://overpass-api.de.evil.example/api/interpreter','https://raw.githubusercontent.com/user/repo/main/code.js','https://overpass-api.de/api/interpreter?token=secret']){
    const b=networkBrief();b.sources[0].url=url;await reject(collectCitySources(b,{root,allowNetwork:true,fetchImpl:async()=>{throw Error('unsafe fetch reached');}}),/public HTTPS|allowlist/);
  }
  let observedOptions;const good=await collectCitySources(networkBrief(),{root,allowNetwork:true,outputDir:'work/network',fetchImpl:async(_url,options)=>{observedOptions=options;return jsonResponse(collection);}});assert.equal(observedOptions.redirect,'error');assert.equal(observedOptions.credentials,'omit');assert.equal(good.features.features.length,1);assert.equal(good.provenance.inputs[1].acquisition,'public-https-get');checks++;
  await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,fetchImpl:async()=>new Response('moved',{status:302,headers:{location:'http://127.0.0.1/private.json'}})}),{code:'CITY_SOURCE_HTTP'});
  await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,fetchImpl:async()=>new Response(JSON.stringify(collection),{headers:{'content-type':'text/html'}})}),/JSON content type/);
  await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,fetchImpl:async()=>jsonResponse(collection,{'content-length':String(CITY_SOURCE_LIMITS.maxResponseBytes+1)})}),{code:'CITY_SOURCE_TOO_LARGE'});
  await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(CITY_SOURCE_LIMITS.maxResponseBytes+1));controller.close();}}),{headers:{'content-type':'application/json'}})}),{code:'CITY_SOURCE_TOO_LARGE'});
  await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,fetchImpl:async()=>jsonResponse('{not json')}),/not valid UTF-8 JSON/);
  await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,timeoutMs:15,fetchImpl:async()=>new Promise(()=>{})}),{code:'CITY_SOURCE_TIMEOUT'});
  await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,timeoutMs:15,fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})}),{code:'CITY_SOURCE_TIMEOUT'});
  const cancelled=new AbortController();cancelled.abort();await reject(collectCitySources(brief,{root,signal:cancelled.signal}),{name:'AbortError'});
  const midflight=new AbortController();await reject(collectCitySources(networkBrief(),{root,allowNetwork:true,signal:midflight.signal,fetchImpl:async()=>{setTimeout(()=>midflight.abort(),10);return new Promise(()=>{});}}),{name:'AbortError'});
  const square=[[1,1],[5,1],[5,5],[1,5],[1,1]],hole=[[2,2],[3,2],[3,3],[2,3],[2,2]];
  const geom=points=>points.map(([lon,lat])=>({lon,lat}));
  const relation={type:'relation',id:10,tags:{type:'multipolygon',natural:'water'},members:[{type:'way',ref:1,role:'outer',geometry:geom(square.slice(0,3))},{type:'way',ref:2,role:'outer',geometry:geom([square[0],square[3],square[2]])},{type:'way',ref:3,role:'inner',geometry:geom(hole)}]};
  const normalized=normalizeOverpass({elements:[relation]});assert.equal(normalized.features.length,1);assert.equal(normalized.features[0].geometry.type,'Polygon');assert.equal(normalized.features[0].geometry.coordinates.length,2);assert.equal(normalized.warnings.length,0);checks++;
  const incomplete=clone(relation);incomplete.members.pop();incomplete.members[1].geometry.pop();const skipped=normalizeOverpass({elements:[incomplete]});assert.equal(skipped.features.length,0);assert.equal(skipped.warnings[0].code,'OSM_RELATION_SKIPPED');checks++;
  const invalidHole=clone(relation);invalidHole.members[2].geometry=geom([[4,4],[6,4],[6,6],[4,6],[4,4]]);assert.equal(normalizeOverpass({elements:[invalidHole]}).features.length,0);checks++;
  const openArea=normalizeOverpass({elements:[{type:'way',id:1,tags:{building:'yes'},geometry:geom(square.slice(0,-1))}]});assert.equal(openArea.features.length,0);assert.equal(openArea.warnings.length,1);checks++;
  assert.throws(()=>normalizeOverpass({elements:[],remark:'runtime error: Query timed out'}),{code:'CITY_SOURCE_INCOMPLETE'});checks++;
  const nodeWay=normalizeOverpass({elements:[{type:'node',id:1,lon:1,lat:1},{type:'node',id:2,lon:2,lat:2},{type:'way',id:3,nodes:[1,2],tags:{highway:'primary'}}]});assert.equal(nodeWay.features[0].geometry.type,'LineString');checks++;
  assert.equal((await fs.readFile(path.join(root,brief.sources[0].path))).compare(initial),0);
  console.log(`City source acquisition checks passed (${checks} groups): real Wuhan snapshot, hash/byte preservation, geometry, unsafe relation rejection, path/symlink protections, network limits, timeout and cancellation.`);
}finally{await fs.rm(root,{recursive:true,force:true});}
