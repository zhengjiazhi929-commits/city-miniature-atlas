import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {Readable} from 'node:stream';
import {isIP} from 'node:net';
import {prepareCustomRegionBoundary} from '../src/region-boundaries.js';
import {containsCoordinate} from '../src/geographic-bounds.js';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
export const CITY_SOURCE_LIMITS=Object.freeze({maxResponseBytes:5*1024*1024,maxTotalBytes:32*1024*1024,timeoutMs:25000,maxSources:16,maxFeatures:30000,maxCoordinates:250000,retries:0});
const fail=(message,code='CITY_SOURCE_INVALID')=>Object.assign(new Error(`City sources: ${message}`),{code});
const check=(condition,message,code)=>{if(!condition)throw fail(message,code);};
const checkAbort=signal=>{if(signal?.aborted)throw new DOMException('City source acquisition cancelled.','AbortError');};
const slug=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const coordinate=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=85;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const closed=ring=>ring.length>=4&&same(ring[0],ring.at(-1));

function sourceMetadata(value){
  check(value&&typeof value==='object','source attribution is required');
  let url;try{url=new URL(value.url);}catch{throw fail('source URL is required');}
  check(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'source URL must be HTTP(S) without credentials');
  check(typeof value.license==='string'&&value.license.trim()&&typeof value.attribution==='string'&&value.attribution.trim(),'source license and attribution are required');
  return {url:url.href,license:value.license,attribution:value.attribution};
}

/** Read data only: no dotfiles, traversal, absolute paths, scripts, or symlinks. */
async function localBytes(root,relative,signal,maxBytes){
  check(typeof relative==='string'&&/^(?:\.\/)?(?:data|examples)\/[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*\.(?:geojson|json)$/.test(relative),'local input must be a plain project-relative data/ or examples/ JSON path');
  const parts=relative.replace(/^\.\//,'').split('/');
  check(parts.every(p=>p!=='.'&&p!=='..'&&!p.startsWith('.')),'local source path cannot escape the project');
  let target=root;
  for(let i=0;i<parts.length;i++){
    checkAbort(signal);target=path.join(target,parts[i]);const stat=await fs.lstat(target);
    check(!stat.isSymbolicLink(),'symlink source paths are not allowed');
    check(i===parts.length-1?stat.isFile():stat.isDirectory(),'source path must name a regular JSON file');
  }
  const handle=await fs.open(target,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();check(stat.size<=maxBytes,'source exceeds byte limit','CITY_SOURCE_TOO_LARGE');
    const chunks=[];let offset=0;
    while(true){checkAbort(signal);const buffer=Buffer.alloc(Math.min(65536,maxBytes+1-offset));const result=await handle.read(buffer,0,buffer.length,offset);if(!result.bytesRead)break;offset+=result.bytesRead;check(offset<=maxBytes,'source exceeds byte limit','CITY_SOURCE_TOO_LARGE');chunks.push(buffer.subarray(0,result.bytesRead));}
    checkAbort(signal);return Buffer.concat(chunks);
  }finally{await handle.close();}
}

function publicDataUrl(value){
  let url;try{url=new URL(value);}catch{throw fail('invalid download URL');}
  check(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443'),'download URL must use public HTTPS without credentials, ports, or fragments');
  // This is deliberately a small, inspectable adapter, not a general URL fetcher.
  const allowed=(url.hostname==='overpass-api.de'&&url.pathname==='/api/interpreter'&&[...url.searchParams.keys()].every(k=>k==='data'))||
    (url.hostname==='api.openstreetmap.org'&&/^\/api\/0\.6\/(?:map\.json|(?:way|relation|node)\/\d+(?:\/full)?\.json)$/.test(url.pathname)&&[...url.searchParams.keys()].every(k=>k==='bbox'))||
    (url.hostname==='raw.githubusercontent.com'&&/^\/[^/]+\/[^/]+\/[^/]+\/.+\.(?:geojson|json)$/.test(url.pathname)&&!url.search);
  check(allowed,'download host/path is not in the public JSON data allowlist');
  return url;
}
function publicIp(address){
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)));}
  // Global unicast only; rejects loopback, mapped IPv4, link-local and ULA.
  return isIP(address)===6&&/^2[0-9a-f]{3}:/i.test(address)&&!/^2001:(?:db8|0|10|20):/i.test(address)&&!/^2002:/i.test(address);
}
async function pinnedFetch(url,{signal}){
  const addresses=await lookup(url.hostname,{all:true});checkAbort(signal);
  check(addresses.length&&addresses.every(a=>publicIp(a.address)),'download host resolves to a non-public address');
  const pinned=addresses[0];
  return await new Promise((resolve,reject)=>{
    const request=https.get(url,{signal,headers:{Accept:'application/json','User-Agent':'city-miniature-atlas-source-adapter/1'},lookup:(_host,options,callback)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family)},response=>{
      resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers}));
    });request.on('error',reject);
  });
}
async function networkBytes(value,{signal,fetchImpl,timeoutMs,maxBytes}){
  const url=publicDataUrl(value),controller=new AbortController();let timedOut=false;
  const onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});
  let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(fail('download timed out','CITY_SOURCE_TIMEOUT'));},timeoutMs);});
  const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(timedOut?fail('download timed out','CITY_SOURCE_TIMEOUT'):new DOMException('City source acquisition cancelled.','AbortError')),{once:true}));
  const operation=(async()=>{
    checkAbort(signal);
    const response=await (fetchImpl===globalThis.fetch?pinnedFetch(url,{signal:controller.signal}):fetchImpl(url.href,{signal:controller.signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json'}}));
    check(response.ok&&response.status>=200&&response.status<300,`download failed (HTTP ${response.status}); no automatic retries`,'CITY_SOURCE_HTTP');
    check(!response.redirected&&(!response.url||new URL(response.url).href===url.href),'redirected downloads are not allowed');
    const type=response.headers.get('content-type')||'';check(/^(?:application\/(?:[a-z0-9.-]+\+)?json|application\/geo\+json)(?:\s*;|$)/i.test(type),'download must have JSON content type');
    check(Number(response.headers.get('content-length')||0)<=maxBytes,'download exceeds byte limit','CITY_SOURCE_TOO_LARGE');
    check(response.body,'download has no JSON body');const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){checkAbort(controller.signal);const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=maxBytes,'download exceeds byte limit','CITY_SOURCE_TOO_LARGE');chunks.push(Buffer.from(value));}}
    catch(error){void reader.cancel().catch(()=>{});throw error;}
    finally{reader.releaseLock();}
    return Buffer.concat(chunks);
  })();
  try{return await Promise.race([operation,deadline,aborted]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();}
}

function layer(tags){
  if(tags.building&&tags.building!=='no'||tags['building:part']&&tags['building:part']!=='no')return 'building';
  if(tags.highway||tags.railway)return 'transportation';
  if(tags.natural==='water'||tags.water||tags.waterway==='riverbank')return 'water';
  if(tags.waterway)return 'waterway';
  if(['park','garden','nature_reserve'].includes(tags.leisure))return 'park';
  return 'landuse';
}
const areaTag=tags=>tags.area!=='no'&&(tags.area==='yes'||(tags.building&&tags.building!=='no')||tags['building:part']||tags.landuse||tags.leisure||tags.natural==='water'||tags.natural==='wood'||tags.water||tags.waterway==='riverbank');
function area(ring){let sum=0;for(let i=1;i<ring.length;i++)sum+=(ring[i-1][0]-ring[0][0])*(ring[i][1]-ring[0][1])-(ring[i][0]-ring[0][0])*(ring[i-1][1]-ring[0][1]);return sum/2;}
const orientation=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersects(a,b,c,d){
  const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);
  const on=(a,b,p)=>orientation(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
  return (o1*o2<0&&o3*o4<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function validRing(ring){
  if(!closed(ring)||ring.length>5000||Math.abs(area(ring))<1e-14)return false;
  for(let i=1;i<ring.length;i++)for(let j=i+2;j<ring.length;j++){if(i===1&&j===ring.length-1)continue;if(intersects(ring[i-1],ring[i],ring[j-1],ring[j]))return false;}
  return true;
}
function ringsIntersect(a,b){for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++)if(intersects(a[i-1],a[i],b[j-1],b[j]))return true;return false;}
function joinRings(segments){
  const pending=segments.map(s=>s.map(p=>[...p])),rings=[];
  while(pending.length){let ring=pending.shift();while(!same(ring[0],ring.at(-1))){
    const matches=[];for(let i=0;i<pending.length;i++){if(same(ring.at(-1),pending[i][0]))matches.push([i,false]);if(same(ring.at(-1),pending[i].at(-1)))matches.push([i,true]);}
    if(matches.length!==1)return null;const [index,reverse]=matches[0],segment=pending.splice(index,1)[0];if(reverse)segment.reverse();ring.push(...segment.slice(1));
  }if(!validRing(ring))return null;rings.push(ring);}return rings;
}

/** OSM ways with full geometry, or OSM map JSON nodes+ways. Never close an open way.
 * Ambiguous/incomplete/self-crossing multipolygons are skipped with diagnostics.
 */
export function normalizeOverpass(json){
  check(json&&Array.isArray(json.elements),'Overpass response needs elements');
  check(!json.remark,`Overpass returned incomplete/error response: ${json.remark}`,'CITY_SOURCE_INCOMPLETE');
  check(json.elements.length<=100000,'too many OSM elements','CITY_SOURCE_TOO_LARGE');
  const warnings=[],features=[],nodes=new Map(),ways=new Map(),consumed=new Set();
  for(const e of json.elements)if(e.type==='node'&&coordinate([e.lon,e.lat]))nodes.set(e.id,[e.lon,e.lat]);
  const points=e=>{const values=Array.isArray(e.geometry)?e.geometry.map(p=>p&&[p.lon,p.lat]):Array.isArray(e.nodes)?e.nodes.map(id=>nodes.get(id)):null;return values?.length>=2&&values.every(coordinate)?values:null;};
  for(const e of json.elements)if(e.type==='way')ways.set(e.id,e);
  const emit=(e,geometry)=>features.push({type:'Feature',id:`${e.type}/${e.id}`,properties:{...e.tags,osmType:e.type,osmId:e.id,sourceLayer:layer(e.tags||{})},geometry});
  for(const e of json.elements){if(e.type!=='relation'||e.tags?.type!=='multipolygon')continue;
    const members=e.members||[],outer=[],inner=[],memberIds=[];let safe=members.length>0;
    for(const member of members){
      if(member.type!=='way'||!['outer','inner',''].includes(member.role||'')){safe=false;break;}
      const geometry=points(member)||points(ways.get(member.ref)||{});if(!geometry){safe=false;break;}
      (member.role==='inner'?inner:outer).push(geometry);memberIds.push(member.ref);
    }
    const outers=safe?joinRings(outer):null,inners=safe?joinRings(inner):null;
    if(!outers?.length||!inners)safe=false;
    const polygons=outers?.map(r=>[r])||[];
    if(safe){for(let i=0;i<outers.length;i++)for(let j=i+1;j<outers.length;j++)if(ringsIntersect(outers[i],outers[j])||containsCoordinate({type:'Feature',geometry:{type:'Polygon',coordinates:[outers[i]]}},outers[j][0])||containsCoordinate({type:'Feature',geometry:{type:'Polygon',coordinates:[outers[j]]}},outers[i][0]))safe=false;
      for(const hole of inners){const matches=[];for(let i=0;i<outers.length;i++)if(containsCoordinate({type:'Feature',geometry:{type:'Polygon',coordinates:[outers[i]]}},hole[0])&&!ringsIntersect(outers[i],hole))matches.push(i);if(matches.length!==1){safe=false;break;}polygons[matches[0]].push(hole);}
      for(const polygon of polygons)for(let i=1;i<polygon.length;i++)for(let j=i+1;j<polygon.length;j++)if(ringsIntersect(polygon[i],polygon[j])||containsCoordinate({type:'Feature',geometry:{type:'Polygon',coordinates:[polygon[i]]}},polygon[j][0])||containsCoordinate({type:'Feature',geometry:{type:'Polygon',coordinates:[polygon[j]]}},polygon[i][0]))safe=false;
    }
    if(!safe){warnings.push({code:'OSM_RELATION_SKIPPED',id:`relation/${e.id}`,reason:'Incomplete, ambiguous, intersecting, or unsupported multipolygon; no polygon synthesized.'});continue;}
    emit(e,polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons});memberIds.forEach(id=>consumed.add(id));
  }
  for(const e of ways.values()){
    if(consumed.has(e.id))continue;const coordinates=points(e);
    if(!coordinates){warnings.push({code:'OSM_WAY_SKIPPED',id:`way/${e.id}`,reason:'Missing or invalid full geometry.'});continue;}
    if(!e.tags||!Object.keys(e.tags).length)continue;
    if(areaTag(e.tags)){
      if(!validRing(coordinates)){warnings.push({code:'OSM_WAY_SKIPPED',id:`way/${e.id}`,reason:'Area is open, degenerate, too complex, or self-intersecting; no polygon synthesized.'});continue;}
      emit(e,{type:'Polygon',coordinates:[coordinates]});
    }else emit(e,{type:'LineString',coordinates});
  }
  return {type:'FeatureCollection',features,warnings};
}

function normalizeGeoJSON(json){
  const collection=json?.type==='Feature'?{type:'FeatureCollection',features:[json]}:json;
  check(collection?.type==='FeatureCollection'&&Array.isArray(collection.features),'GeoJSON source must be a Feature or FeatureCollection');
  check(collection.features.length<=CITY_SOURCE_LIMITS.maxFeatures,'too many source features','CITY_SOURCE_TOO_LARGE');
  let count=0;
  const point=p=>{check(coordinate(p),'invalid WGS84 coordinate');check(++count<=CITY_SOURCE_LIMITS.maxCoordinates,'too many coordinates','CITY_SOURCE_TOO_LARGE');};
  const line=l=>{check(Array.isArray(l)&&l.length>=2,'invalid line');l.forEach(point);};
  const polygon=p=>{check(Array.isArray(p)&&p.length>0,'empty polygon');p.forEach(r=>{line(r);check(closed(r)&&Math.abs(area(r))>1e-14,'polygon ring must be closed and nonzero');});};
  for(const feature of collection.features){check(feature?.type==='Feature'&&feature.geometry&&feature.properties&&typeof feature.properties==='object'&&!Array.isArray(feature.properties),'invalid GeoJSON feature');const {type,coordinates:c}=feature.geometry;
    if(type==='Point')point(c);else if(type==='MultiPoint'){check(Array.isArray(c)&&c.length>0,'empty multipoint');c.forEach(point);}else if(type==='LineString')line(c);else if(type==='MultiLineString'){check(Array.isArray(c)&&c.length>0,'empty multiline');c.forEach(line);}else if(type==='Polygon')polygon(c);else if(type==='MultiPolygon'){check(Array.isArray(c)&&c.length>0,'empty multipolygon');c.forEach(polygon);}else throw fail(`unsupported geometry ${type}`);
  }
  return structuredClone(collection);
}

async function saveInputs(root,outputDir,inputs,provenance){
  const target=path.resolve(root,outputDir),relative=path.relative(root,target);
  check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'outputDir must stay inside the project');
  check(!/^(?:data|examples|src|scripts|vendor)(?:\/|$)/.test(relative),'outputDir must use a work/output directory, not existing project data or code');
  let current=root;for(const part of relative.split(path.sep)){check(part&&!part.startsWith('.'),'hidden output paths are not allowed');current=path.join(current,part);try{const stat=await fs.lstat(current);check(stat.isDirectory()&&!stat.isSymbolicLink(),'output directory cannot contain symlinks');}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(current);}}
  check((await fs.readdir(target)).length===0,'outputDir must be empty; refusing to replace evidence');
  for(const input of inputs)await fs.writeFile(path.join(target,input.record.snapshotPath),input.bytes,{flag:'wx'});
  await fs.writeFile(path.join(target,'provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
}

/** Acquire and validate a city brief; local by default. Network is a bounded,
 * opt-in GET to named public data services, with no redirects or retries.
 * Optional timeoutMs/maxResponseBytes can only reduce the fixed upper limits.
 */
export async function collectCitySources(brief,{root=defaultRoot,outputDir,signal,fetchImpl=globalThis.fetch,allowNetwork=false,timeoutMs=CITY_SOURCE_LIMITS.timeoutMs,maxResponseBytes=CITY_SOURCE_LIMITS.maxResponseBytes}={}){
  checkAbort(signal);root=await fs.realpath(root);
  check(brief?.schema==='city-task-v1','unsupported brief schema');
  check(slug(brief.city?.id)&&typeof brief.city.name==='string'&&brief.city.name.trim()&&coordinate(brief.city.coordinates),'city needs an id, name and real WGS84 coordinate');
  check(Array.isArray(brief.sources)&&brief.sources.length>0&&brief.sources.length<=CITY_SOURCE_LIMITS.maxSources,'provide 1–16 source files');
  check(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=CITY_SOURCE_LIMITS.timeoutMs,'invalid timeout limit');
  check(Number.isInteger(maxResponseBytes)&&maxResponseBytes>0&&maxResponseBytes<=CITY_SOURCE_LIMITS.maxResponseBytes,'invalid byte limit');
  const inputs=[],warnings=[],ids=new Set(['boundary']);let totalBytes=0;
  const acquire=async(spec,id,kind)=>{
    checkAbort(signal);const source=sourceMetadata(spec?.source);check((typeof spec.path==='string')!==(typeof spec.url==='string'),'source must provide exactly one path or URL');
    let bytes;const acquiredAt=new Date().toISOString();
    if(spec.path)bytes=await localBytes(root,spec.path,signal,maxResponseBytes);
    else{check(allowNetwork===true,'network acquisition requires explicit allowNetwork','CITY_SOURCE_NETWORK_DISABLED');bytes=await networkBytes(spec.url,{signal,fetchImpl,timeoutMs,maxBytes:maxResponseBytes});}
    totalBytes+=bytes.length;check(totalBytes<=CITY_SOURCE_LIMITS.maxTotalBytes,'combined source byte limit exceeded','CITY_SOURCE_TOO_LARGE');
    const sha256=hash(bytes);if(spec.sha256!==undefined)check(/^[a-f0-9]{64}$/.test(spec.sha256)&&spec.sha256===sha256,`SHA-256 mismatch for ${id}`,'CITY_SOURCE_HASH_MISMATCH');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail(`${id} is not valid UTF-8 JSON`);}
    const record={id,kind,source,...(spec.path?{inputPath:spec.path}:{downloadUrl:spec.url}),acquisition:spec.path?'local-file-copy':'public-https-get',acquiredAt,bytes:bytes.length,sha256,snapshotPath:`${id}.${kind==='geojson'?'geojson':'json'}`,...(spec.coverage?{coverage:structuredClone(spec.coverage)}:{}),...(value.osm3s?.timestamp_osm_base?{sourceTimestamp:value.osm3s.timestamp_osm_base}:{})};
    inputs.push({bytes,record});return value;
  };
  const rawBoundary=await acquire(brief.boundary,'boundary','geojson');
  const boundary=prepareCustomRegionBoundary(rawBoundary,{city:brief.city,source:brief.boundary.source,signal});
  const knownNames=[rawBoundary.properties?.name,rawBoundary.properties?.fullName,rawBoundary.properties?.nameEn].filter(Boolean).map(n=>n.toLowerCase().replace(/市$/,'').replace(/ city$/,''));
  if(knownNames.length)check([brief.city.name,brief.city.nameEn].filter(Boolean).some(n=>knownNames.includes(n.toLowerCase().replace(/市$/,'').replace(/ city$/,''))),'city name does not match supplied administrative boundary');
  const features=[];
  for(const spec of brief.sources){check(slug(spec.id)&&!ids.has(spec.id),'source ids must be unique slugs');ids.add(spec.id);check(['geojson','overpass'].includes(spec.kind),'source kind must be geojson or overpass');const raw=await acquire(spec,spec.id,spec.kind);const collection=normalizeGeoJSON(spec.kind==='overpass'?normalizeOverpass(raw):raw);warnings.push(...(collection.warnings||[]).map(w=>({...w,sourceId:spec.id})));if(!collection.features.length)warnings.push({code:'SOURCE_EMPTY',sourceId:spec.id,reason:'Source explicitly contains no supported features; absence is unknown, not vacant land.'});for(const f of collection.features)features.push({...f,properties:{...f.properties,sourceId:spec.id}});check(features.length<=CITY_SOURCE_LIMITS.maxFeatures,'too many combined features','CITY_SOURCE_TOO_LARGE');}
  const landmarks=structuredClone(brief.landmarks||[]),landmarkIds=new Set();check(Array.isArray(landmarks)&&landmarks.length<=80,'at most 80 landmarks are supported');
  for(const place of landmarks){check(slug(place.id)&&!landmarkIds.has(place.id),'landmark ids must be unique slugs');landmarkIds.add(place.id);check(typeof place.name==='string'&&place.name.trim()&&coordinate(place.coordinates)&&typeof place.description==='string','landmark needs name, coordinate and description');sourceMetadata({url:place.sourceUrl,attribution:'landmark source',license:'reference only'});check(containsCoordinate(boundary,place.coordinates),`${place.name} is outside the supplied city boundary`);}
  const display=structuredClone(brief.display||{});check(display&&typeof display==='object'&&!Array.isArray(display),'display must be an object');
  if(display.focus!==undefined)check(coordinate(display.focus)&&containsCoordinate(boundary,display.focus),'display focus must lie inside the city');
  if(display.focusDistanceMeters!==undefined)check(Number.isFinite(display.focusDistanceMeters)&&display.focusDistanceMeters>=100&&display.focusDistanceMeters<=2000000,'invalid focus distance');
  const provenance={schema:'city-sources-v1',cityId:brief.city.id,acquiredAt:new Date().toISOString(),coordinateReference:'WGS84 longitude latitude; no GCJ02 conversion',inputs:inputs.map(i=>i.record),warnings,coverageNotice:'Feature coverage is limited to the declared source extent and mapped features; omitted or out-of-coverage features are unknown, not vacant land.',totalBytes};
  checkAbort(signal);if(outputDir!==undefined)await saveInputs(root,outputDir,inputs,provenance);checkAbort(signal);
  return {boundary,features:{type:'FeatureCollection',features},provenance,landmarks,display};
}
