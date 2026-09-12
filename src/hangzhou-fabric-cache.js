import * as THREE from 'three';

const CACHE_VERSION=1;
const MANIFEST_URL=new URL('../data/hangzhou-atlas/fabric-cache-manifest.json',import.meta.url);
const ASSET_URL=new URL('../data/hangzhou-atlas/fabric-cache.json.gz',import.meta.url);
const SOURCE_URLS=['./hangzhou-district-massing.js','./hangzhou-fabric.js','./city-assets.js','../assets/city-kit/v1/manifest.json','./hangzhou-footprint-guard.js','./hangzhou-surface.js','./region-projection.js','./hangzhou-display-projection.js'].map(file=>new URL(file,import.meta.url));

function assertActive(signal){if(signal?.aborted)throw signal.reason??new DOMException('Fabric loading was aborted.','AbortError');}
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');

// Object keys have stable ordering; array order stays significant because it
// affects deterministic representative placement. Runtime callback functions
// are excluded, while the caller supplies their numerical/geographic inputs.
function canonicalJSON(input){
  const parents=new Set();
  const encode=value=>{
    if(value===null)return 'null';
    if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
    if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('Fabric cache input contains a nonfinite number.');return JSON.stringify(value);}
    if(typeof value==='undefined'||typeof value==='function')return undefined;
    if(typeof value!=='object')throw new TypeError('Unsupported fabric cache input.');
    if(parents.has(value))throw new TypeError('Circular fabric cache input.');parents.add(value);
    let encoded;
    if(Array.isArray(value)||ArrayBuffer.isView(value))encoded=`[${Array.from(value,item=>encode(item)??'null').join(',')}]`;
    else encoded=`{${Object.keys(value).sort().flatMap(key=>{const item=encode(value[key]);return item===undefined?[]:[`${JSON.stringify(key)}:${item}`];}).join(',')}}`;
    parents.delete(value);return encoded;
  };
  return encode(input);
}

/** Hash the exact factory data/options and the source that interprets them.
 * Required caller inputs: `data` (including urbanClassPolygons, landmarks and
 * objectExclusions), `options`, plus `terrain`, `heightScale` and `projection`
 * when those affect the supplied project/sampleHeight callbacks. Additional
 * serializable arguments are included automatically. Functions are omitted.
 * No large geographic asset is fetched a second time, and nothing is retained
 * globally after this invocation. Returns one lower-case SHA-256 string.
 */
export async function computeFabricCacheKey({signal,...inputs}){
  assertActive(signal);
  if(!inputs.data||typeof inputs.data!=='object')throw new TypeError('Fabric cache fingerprint requires the actual factory data.');
  const sources=await Promise.all(SOURCE_URLS.map(async url=>{
    const response=await fetch(url,{signal,cache:'no-cache'});
    if(!response.ok)throw new Error(`Cannot fingerprint fabric source ${url.pathname}: HTTP ${response.status}.`);
    const bytes=await response.arrayBuffer();assertActive(signal);
    return [url.pathname.split('/').at(-1),await digest(bytes)];
  }));
  assertActive(signal);
  const bytes=new TextEncoder().encode(canonicalJSON({version:CACHE_VERSION,threeRevision:THREE.REVISION,sources:Object.fromEntries(sources),inputs}));
  const key=await digest(bytes);assertActive(signal);return key;
}

/** Optional, owned compiled geometry. A cache miss returns null. A corrupt or
 * unsupported cache also returns null after reporting the error through
 * `onError`, allowing the caller to run the normal deterministic builder.
 * Cancellation is always rethrown and never turned into a cache miss.
 *
 * Manifest: {version:1,key,file:'fabric-cache.json.gz',sha256:<gzip sha256>}
 * Gzip JSON: {version:1,key,group:<group.toJSON()>,diagnostics:<builder stats>}
 */
export async function loadCachedFabric({key,signal,onError=error=>console.warn('Compiled Hangzhou fabric unavailable; rebuilding from source.',error)}){
  let group=null;
  const geometries=new Set(),materials=new Set(),textures=new Set();
  const release=()=>{
    if(group){group.traverse(object=>{if(object.isInstancedMesh)object.dispose?.();if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[])materials.add(material);});group.removeFromParent();group.clear();}
    for(const material of materials){for(const value of Object.values(material))if(value?.isTexture)textures.add(value);material.dispose();}
    for(const geometry of geometries)geometry.dispose();for(const texture of textures)texture.dispose();geometries.clear();materials.clear();textures.clear();
  };
  try{
    assertActive(signal);
    if(!/^[a-f0-9]{64}$/.test(key))throw new TypeError('Fabric cache key must be a SHA-256 string.');
    const manifestResponse=await fetch(MANIFEST_URL,{signal,cache:'no-cache'});
    if(manifestResponse.status===404)return null;
    if(!manifestResponse.ok)throw new Error(`Fabric manifest HTTP ${manifestResponse.status}.`);
    const manifest=await manifestResponse.json();assertActive(signal);
    if(manifest.version!==CACHE_VERSION||manifest.key!==key)return null;
    if(manifest.file!=='fabric-cache.json.gz'||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw new Error('Invalid compiled fabric manifest.');
    const response=await fetch(ASSET_URL,{signal,cache:'no-cache'});
    if(response.status===404)return null;
    if(!response.ok)throw new Error(`Compiled fabric HTTP ${response.status}.`);
    const compressed=await response.arrayBuffer();assertActive(signal);
    if(await digest(compressed)!==manifest.sha256)throw new Error('Compiled fabric checksum mismatch.');
    const header=new Uint8Array(compressed,0,Math.min(2,compressed.byteLength));
    if(header.length!==2||header[0]!==0x1f||header[1]!==0x8b)throw new Error('Compiled fabric must be served as a gzip file without HTTP Content-Encoding.');
    if(typeof DecompressionStream!=='function')throw new Error('This browser does not support gzip DecompressionStream.');
    const text=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();assertActive(signal);
    const payload=JSON.parse(text);
    if(payload.version!==CACHE_VERSION||payload.key!==key||!payload.group?.object||!payload.diagnostics||typeof payload.diagnostics!=='object')throw new Error('Invalid compiled fabric payload.');
    // Fabric currently has no textures, external assets or custom shaders.
    // Reject those here so ObjectLoader cannot start an unowned async load.
    if(payload.group.images?.length||payload.group.textures?.length||payload.group.materials?.some(material=>['ShaderMaterial','RawShaderMaterial'].includes(material.type)))throw new Error('Compiled fabric may contain only owned geometry and standard, texture-free materials.');
    const loader=new THREE.ObjectLoader(),parseGeometries=loader.parseGeometries.bind(loader),parseMaterials=loader.parseMaterials.bind(loader);
    loader.parseGeometries=(...args)=>{const result=parseGeometries(...args);Object.values(result).forEach(value=>geometries.add(value));return result;};
    loader.parseMaterials=(...args)=>{const result=parseMaterials(...args);Object.values(result).forEach(value=>materials.add(value));return result;};
    group=loader.parse(payload.group);
    // Let pending navigation/abort events run before accepting the new owner.
    await new Promise(resolve=>setTimeout(resolve,0));assertActive(signal);
    const diagnostics={...payload.diagnostics,disposed:false,compiledCache:{key,version:CACHE_VERSION,source:'local-precompiled-fabric',gzipBytes:compressed.byteLength}};
    let disposed=false;
    return {group,diagnostics,dispose(){if(disposed)return;disposed=true;diagnostics.disposed=true;release();}};
  }catch(error){
    release();assertActive(signal);if(error?.name==='AbortError')throw error;
    onError(error);return null;
  }
}
