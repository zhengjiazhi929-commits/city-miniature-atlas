import {containsCoordinate} from './geographic-bounds.js';
import {prepareCustomRegionBoundary} from './region-boundaries.js';

const check=(condition,message)=>{if(!condition)throw new Error(`City config: ${message}`);};
const coordinate=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=85;
const slug=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const sourceUrl=value=>{try{return ['https:','http:'].includes(new URL(value).protocol);}catch{return false;}};

/** Local data paths only. A starter never fetches arbitrary configuration URLs. */
export function resolveCityDataUrl(path,appRoot){
  check(typeof path==='string'&&/^\.\/data\/[A-Za-z0-9_./-]+\.(?:geo)?json$/.test(path),'path must be a plain ./data/ JSON or GeoJSON path');
  const root=new URL(appRoot),url=new URL(path,root);
  check(url.origin===root.origin&&url.pathname.startsWith(new URL('./data/',root).pathname),'path must stay inside the app data directory');
  check(!url.search&&!url.hash,'data paths cannot contain query strings or fragments');
  return url;
}

export function validateCityStarterConfig(config,boundary){
  check(config?.schema==='city-starter-v1','unsupported schema');
  check(slug(config.id),'id must be a lowercase URL-safe slug');
  check(typeof config.name==='string'&&config.name.trim(),'name is required');
  check(coordinate(config.coordinates),'coordinates must be [longitude, latitude] in WGS84');
  check(config.boundary&&/^[a-f0-9]{64}$/.test(config.boundary.sha256),'boundary SHA-256 is required');
  resolveCityDataUrl(config.boundary.path,'https://atlas.example/');
  check(config.airports?.status==='unverified','this starter does not generate airport coverage; keep status unverified');
  check(Array.isArray(config.landmarks)&&config.landmarks.length<=80,'landmarks must be an array of at most 80 entries');
  const ids=new Set();
  for(const place of config.landmarks){
    check(slug(place.id)&&!ids.has(place.id),'landmark ids must be unique slugs');ids.add(place.id);
    check(typeof place.name==='string'&&place.name.trim()&&coordinate(place.coordinates),'landmark needs a name and real WGS84 coordinate');
    check(sourceUrl(place.sourceUrl),'each landmark needs its own sourceUrl');
    check(typeof place.description==='string','landmark description must be text');
  }
  if(boundary){
    const prepared=prepareCustomRegionBoundary(boundary,{city:config,source:config.boundary.source});
    for(const place of config.landmarks)check(containsCoordinate(prepared,place.coordinates),`${place.name} is outside the supplied boundary`);
  }else{
    check(sourceUrl(config.boundary.source?.url)&&config.boundary.source?.license?.trim()&&config.boundary.source?.attribution?.trim(),'boundary source URL, license and attribution are required');
  }
  return config;
}
