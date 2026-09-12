import {provinceBounds, containsCoordinate} from './geographic-bounds.js';

export const REGION_BOUNDARY_LIMITS = Object.freeze({timeoutMs:20000,maxResponseBytes:2*1024*1024,maxCoordinates:20000});
const appRoot = new URL('../', import.meta.url);
let localManifest = null;
let prefectureManifest = null;
const abortError = () => new DOMException('区域边界加载已取消。', 'AbortError');
const fail = (message, code='REGION_BOUNDARY_UNAVAILABLE') => Object.assign(new Error(message), {code});
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const normalName = name => String(name || '').normalize('NFKC').trim().replace(/市$/, '');
const normalEnglish = name => String(name||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
  .replace(/[’']/g,'').replace(/[-_]/g,' ').trim().replace(/(?:\s+(?:shi|city|prefecture|municipality))+$/,'').replace(/\s+/g,' ');
const featureId = feature => feature?.properties?.id || feature?.id;

async function readLocalJson(relativePath, signal) {
  checkAbort(signal);
  const url = new URL(relativePath, appRoot);
  if (url.origin !== appRoot.origin || !url.pathname.startsWith(new URL('./data/',appRoot).pathname)) {
    throw fail('区域数据路径无效。', 'REGION_BOUNDARY_INVALID');
  }
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort',onAbort,{once:true});
  const timeout = setTimeout(() => { timedOut=true;controller.abort(); },REGION_BOUNDARY_LIMITS.timeoutMs);
  try {
    const response = await fetch(url,{signal:controller.signal,credentials:'same-origin',cache:'no-store'});
    if (!response.ok) throw fail(`区域边界数据暂时无法读取（${response.status}）。`);
    if (Number(response.headers.get('content-length')) > REGION_BOUNDARY_LIMITS.maxResponseBytes) {
      throw fail('该区域边界数据过大，暂不能加载。','REGION_BOUNDARY_TOO_LARGE');
    }
    const reader=response.body.getReader(),parts=[];
    let bytes=0;
    try {
      while (true) {
        const {done,value}=await reader.read();
        if (done) break;
        bytes+=value.byteLength;
        if (bytes>REGION_BOUNDARY_LIMITS.maxResponseBytes) {
          await reader.cancel();
          throw fail('该区域边界数据过大，暂不能加载。','REGION_BOUNDARY_TOO_LARGE');
        }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    checkAbort(signal);
    if (timedOut) throw fail('区域边界加载超时，请稍后重试。','REGION_BOUNDARY_TIMEOUT');
    const joined=new Uint8Array(bytes);
    let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.byteLength;}
    return JSON.parse(new TextDecoder().decode(joined));
  } catch (error) {
    controller.abort();
    checkAbort(signal);
    if (timedOut) throw fail('区域边界加载超时，请稍后重试。','REGION_BOUNDARY_TIMEOUT');
    if (error.code) throw error;
    throw fail('区域边界数据未能读取，请稍后重试。');
  } finally { clearTimeout(timeout);signal?.removeEventListener('abort',onAbort); }
}

function validateFeature(feature) {
  if (feature?.type!=='Feature'||!['Polygon','MultiPolygon'].includes(feature.geometry?.type)) {
    throw fail('该地点尚无可用的行政边界面。','REGION_BOUNDARY_INVALID');
  }
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  if (!Array.isArray(polygons)||!polygons.length) throw fail('区域边界为空。','REGION_BOUNDARY_INVALID');
  let coordinates=0;
  for(const polygon of polygons){
    if(!Array.isArray(polygon)||!polygon.length)throw fail('区域边界结构无效。','REGION_BOUNDARY_INVALID');
    for(const ring of polygon){
      if(!Array.isArray(ring)||ring.length<4)throw fail('区域边界环无效。','REGION_BOUNDARY_INVALID');
      for(const point of ring){
        if(!Array.isArray(point)||point.length<2||!point.slice(0,2).every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>85){
          throw fail('区域边界坐标无效。','REGION_BOUNDARY_INVALID');
        }
        if(++coordinates>REGION_BOUNDARY_LIMITS.maxCoordinates)throw fail('该区域边界过于复杂，暂不能加载。','REGION_BOUNDARY_TOO_LARGE');
      }
      const first=ring[0],last=ring.at(-1);
      if(first[0]!==last[0]||first[1]!==last[1])throw fail('区域边界尚未闭合。','REGION_BOUNDARY_INVALID');
    }
  }
  return feature;
}

async function manifest(signal) {
  checkAbort(signal);
  if (localManifest) return localManifest;
  const value=await readLocalJson('./data/regions/index.json',signal);
  checkAbort(signal);
  if(!Array.isArray(value.regions))throw fail('区域边界目录无效。','REGION_BOUNDARY_INVALID');
  // Only small file metadata is retained. Region geometry belongs to the caller.
  localManifest=value;return value;
}

async function bulkManifest(signal) {
  checkAbort(signal);
  if(prefectureManifest)return prefectureManifest;
  const value=await readLocalJson('./data/regions/prefectures/index.json',signal);
  checkAbort(signal);
  if(!Array.isArray(value.regions))throw fail('城市边界目录无效。','REGION_BOUNDARY_INVALID');
  prefectureManifest=value;return value;
}

function provinceContext(province,city,geojson) {
  const id=typeof province==='string'?province:featureId(province)||city?.province;
  return {id,feature:province?.type==='Feature'?province:geojson?.features?.find(feature=>featureId(feature)===id)};
}

function cityNamesMatch(entry,city,{local=false}={}) {
  if(local&&[entry.name,entry.fullName].some(name=>normalName(name)===normalName(city.name)))return true;
  const english=city.nameEn||city['name:en']||(/[a-z]/i.test(city.name||'')?city.name:'');
  return !!english&&normalEnglish(english)===normalEnglish(entry.nameEn);
}

function localCityEntry(index,context,city) {
  return index.regions.find(region=>(region.level==='city'||region.id===context.id)&&
    (region.parentId===context.id||region.id===context.id)&&cityNamesMatch(region,city,{local:true})&&
    (!city.boundaryId||city.boundaryId===region.id));
}

function bulkCityEntries(index,context,city) {
  const point=city.coordinates;
  if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))return [];
  if(!context.id||!context.feature)return [];
  if(city.province&&context.id&&city.province!==context.id)return [];
  // The source name must match first. A town merely lying inside a prefecture
  // does not acquire that prefecture's boundary.
  if(context.feature&&!containsCoordinate(context.feature,point))return [];
  return index.regions.filter(region=>region.citySelectable&&cityNamesMatch(region,city)&&
    (!city.boundaryId||city.boundaryId===region.id)&&
    point[0]>=region.bounds[0][0]&&point[0]<=region.bounds[1][0]&&point[1]>=region.bounds[0][1]&&point[1]<=region.bounds[1][1]);
}

async function readEntry(entry,signal) {
  const feature=await readLocalJson(entry.path,signal);checkAbort(signal);
  if(featureId(feature)!==entry.id)throw fail('区域边界与目录不匹配。','REGION_BOUNDARY_INVALID');
  return validateFeature(feature);
}

function preparedFeature(feature,{kind,city,sourceFallback=false}) {
  validateFeature(feature);
  const bounds=provinceBounds(feature);
  if(!bounds)throw fail('区域边界没有有效范围。','REGION_BOUNDARY_INVALID');
  if(kind==='city'&&city?.coordinates&&!containsCoordinate(feature,city.coordinates)) {
    throw fail(`“${city.name||'该城市'}”的地点与现有行政边界不匹配，暂不能展示。`,'REGION_BOUNDARY_MISMATCH');
  }
  const properties={...feature.properties,bounds,center:[(bounds[0][0]+bounds[1][0])/2,(bounds[0][1]+bounds[1][1])/2],
    centerMethod:'bounding-box midpoint; camera framing only',scopeKind:kind,boundaryRole:'administrative-extent'};
  if(kind==='city'&&city?.name)Object.assign(properties,{name:city.name,boundaryId:featureId(feature)});
  if(sourceFallback)Object.assign(properties,{boundaryQuality:'generalized-province',simplificationToleranceDegrees:.03,
    source:{provider:'Natural Earth',url:'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/'},
    attribution:'Natural Earth',license:'Public domain',boundaryNotice:'用于省级浏览的简化轮廓，非精确海岸线。'});
  return {...feature,properties,bbox:[...bounds[0],...bounds[1]]};
}

/** Validate a caller-owned boundary without entering the built-in city registry.
 * Checks file geometry and containment, not the legal accuracy of a boundary.
 * The copy belongs to the active viewer and is released with that viewer.
 */
export function prepareCustomRegionBoundary(feature,{kind='city',city,source,signal}={}) {
  checkAbort(signal);
  if(kind!=='city')throw fail('Custom boundaries currently support city views only.','REGION_BOUNDARY_INVALID');
  let sourceUrl;
  try{sourceUrl=new URL(source?.url);}catch{throw fail('Boundary source URL is required.','REGION_BOUNDARY_INVALID');}
  if(!['https:','http:'].includes(sourceUrl.protocol)||!source?.attribution?.trim()||!source?.license?.trim()) {
    throw fail('Boundary source needs an HTTP(S) URL, attribution and license.','REGION_BOUNDARY_INVALID');
  }
  if(!Array.isArray(city?.coordinates)||city.coordinates.length!==2||!city.coordinates.every(Number.isFinite)) {
    throw fail('A city needs its real WGS84 focus coordinate.','REGION_BOUNDARY_INVALID');
  }
  const copy=structuredClone(validateFeature(feature)),bounds=provinceBounds(copy);
  if(!(bounds[1][0]>bounds[0][0]&&bounds[1][1]>bounds[0][1])||bounds[1][0]-bounds[0][0]>=180) {
    throw fail('Boundary needs a nonzero extent and must not cross the antimeridian.','REGION_BOUNDARY_INVALID');
  }
  const polygons=copy.geometry.type==='Polygon'?[copy.geometry.coordinates]:copy.geometry.coordinates;
  for(const polygon of polygons)for(const ring of polygon){
    let area=0;for(let i=1;i<ring.length;i++)area+=(ring[i-1][0]-ring[0][0])*(ring[i][1]-ring[0][1])-(ring[i][0]-ring[0][0])*(ring[i-1][1]-ring[0][1]);
    if(Math.abs(area)<1e-14)throw fail('Boundary contains a zero-area ring.','REGION_BOUNDARY_INVALID');
  }
  const result=preparedFeature(copy,{kind,city});
  result.properties={...result.properties,source:{...source,url:sourceUrl.href},attribution:source.attribution,license:source.license,
    customBoundary:true,boundaryValidation:'geometry, finite extent and point containment only; source accuracy requires review'};
  checkAbort(signal);return result;
}

/** Resolve a real region Feature. Never substitute a viewport rectangle or a city point. */
export async function loadRegionBoundary({kind,province,city,geojson,signal}={}) {
  checkAbort(signal);
  if(!['province','city'].includes(kind))throw fail('区域类型无效。','REGION_BOUNDARY_INVALID');
  const context=provinceContext(province,city,geojson),provinceKey=context.id,provinceFeature=context.feature;
  const index=await manifest(signal);
  let entry;
  if(kind==='province')entry=index.regions.find(region=>region.id===provinceKey&&region.level==='province');
  else {
    if(!city?.name)throw fail('缺少城市名称。','REGION_BOUNDARY_INVALID');
    entry=localCityEntry(index,context,city);
  }
  if(entry){
    const feature=await readEntry(entry,signal);
    return preparedFeature(feature,{kind,city});
  }
  if(kind==='province'&&provinceFeature){
    checkAbort(signal);
    return preparedFeature(structuredClone(provinceFeature),{kind,sourceFallback:true});
  }
  if(kind==='city'){
    const bulk=await bulkManifest(signal);
    for(const candidate of bulkCityEntries(bulk,context,city)){
      checkAbort(signal);
      const feature=await readEntry(candidate,signal);
      if(containsCoordinate(feature,city.coordinates))return preparedFeature(feature,{kind,city});
    }
  }
  // Public Nominatim is not a runtime dependency; callers display this explicit gap.
  throw fail(kind==='city'?`“${city.name}”的独立行政边界尚未收录，暂不能打开该区域。`:'该省份的行政边界尚未收录。');
}

/** Only offer places with a name-matched, containing administrative polygon.
 * Candidate geometry exists only during this call; only manifests are retained.
 * Callers pass cancellation when a province is replaced and persist boundaryId
 * plus nameEn in deep links so a reload never needs public geocoding.
 */
export async function filterAvailableCityPlaces(places,{province,geojson,signal}={}) {
  checkAbort(signal);
  const index=await manifest(signal),bulk=await bulkManifest(signal),available=[],seen=new Set(),geometry=new Map();
  try {
    for(const city of places||[]){
      checkAbort(signal);
      if(!city?.name||!Array.isArray(city.coordinates)||city.coordinates.length!==2||!city.coordinates.every(Number.isFinite))continue;
      const context=provinceContext(province,city,geojson);
      const local=localCityEntry(index,context,city);
      const candidates=local?[local]:bulkCityEntries(bulk,context,city);
      for(const candidate of candidates){
        checkAbort(signal);
        let feature=geometry.get(candidate.id);
        if(!feature){feature=await readEntry(candidate,signal);geometry.set(candidate.id,feature);}
        if(!containsCoordinate(feature,city.coordinates))continue;
        if(!seen.has(candidate.id)){
          seen.add(candidate.id);available.push({...city,province:context.id||city.province,
            boundaryId:candidate.id,nameEn:city.nameEn||candidate.nameEn});
        }
        break;
      }
    }
    checkAbort(signal);return available;
  } finally { geometry.clear(); }
}

/** Province presentation may exclude administrative sea; city routing stays canonical. */
export async function loadZhejiangDisplayBoundary({signal}={}){
  const feature=validateFeature(await readLocalJson('./data/regions/zhejiang-display.geojson',signal));
  if(feature.properties?.id!=='zhejiang'||feature.properties?.boundaryRole!=='prefecture-union-display-outline')throw fail('Zhejiang display outline is invalid.','REGION_BOUNDARY_INVALID');
  return feature;
}
