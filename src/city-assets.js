import * as THREE from 'three';

const SCHEMA = 'city-kit-geometry-v1';
const MANIFEST = new URL('../assets/city-kit/v1/manifest.json', import.meta.url);
const FAMILIES = ['residential', 'commercial', 'industrial', 'generic'];
const EPSILON = 0.000002;

function check(condition, message) { if (!condition) throw new Error(`City kit: ${message}`); }
function abort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('City kit aborted.', 'AbortError');
}

/** Pure validation of actual buffers; part metadata never substitutes for bounds. */
export function validateCityAsset(asset) {
  check(asset?.schema === SCHEMA, 'unsupported asset schema');
  check(typeof asset.id === 'string' && /^[a-z0-9-]+$/.test(asset.id), 'invalid asset id');
  const geometry = asset.geometry;
  check(geometry?.type === 'BufferGeometry' && geometry.data?.attributes, `${asset.id} must store fixed BufferGeometry buffers`);
  const {position, normal, color} = geometry.data.attributes;
  check(position?.itemSize === 3 && Array.isArray(position.array) && position.array.length % 9 === 0, `${asset.id} positions must be triangle triples`);
  check(!geometry.data.index, `${asset.id} must use explicit triangle buffers`);
  const vertices = position.array.length / 3, triangles = vertices / 3;
  check(triangles > 0 && triangles < 1500, `${asset.id} exceeds triangle budget`);
  check(asset.triangles === triangles, `${asset.id} triangle metadata mismatch`);
  for (const attribute of [position, normal, color]) {
    check(attribute?.itemSize === 3 && attribute.type === 'Float32Array' && attribute.array.length === vertices * 3, `${asset.id} attribute size/type mismatch`);
    check(attribute.array.every(Number.isFinite), `${asset.id} has nonfinite values`);
  }
  check(color.array.every(v => v >= 0 && v <= 1), `${asset.id} colour outside linear 0–1`);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.array.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], position.array[i + axis]);
      max[axis] = Math.max(max[axis], position.array[i + axis]);
    }
    const length = Math.hypot(...normal.array.slice(i, i + 3));
    check(Math.abs(length - 1) < 0.002, `${asset.id} has invalid normals`);
  }
  check(asset.bounds?.min?.length === 3 && asset.bounds?.max?.length === 3, `${asset.id} missing bounds`);
  for (let axis = 0; axis < 3; axis++) {
    check(Math.abs(min[axis] - asset.bounds.min[axis]) < EPSILON && Math.abs(max[axis] - asset.bounds.max[axis]) < EPSILON, `${asset.id} claimed bounds differ from actual vertices`);
  }
  if (asset.role === 'ordinary-building') {
    check(FAMILIES.includes(asset.family), `${asset.id} unknown building family`);
    for (const field of ['recommendedHeightToWidth', 'recommendedDepthToWidth']) {
      const range = asset[field];
      // v1.0 files predate depth profiles; preserve their unit-depth contract.
      if (field === 'recommendedDepthToWidth' && range == null && asset.version === '1.0.0') continue;
      check(Array.isArray(range) && range.length === 2 && range.every(value => Number.isFinite(value) && value > 0) && range[1] >= range[0], `${asset.id} invalid ${field}`);
    }
    for (const axis of [0, 2]) check(Math.abs(min[axis] + 0.5) < EPSILON && Math.abs(max[axis] - 0.5) < EPSILON, `${asset.id} footprint must be exactly 1 × 1`);
    check(Math.abs(min[1]) < EPSILON && Math.abs(max[1] - 1) < EPSILON, `${asset.id} height must occupy 0–1`);
  }
  return {vertices, triangles, bounds: {min, max}};
}

async function fetchJson(url, signal) {
  const response = await fetch(url, {signal});
  check(response.ok, `${url.pathname}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  abort(signal);
  return {json: JSON.parse(new TextDecoder().decode(bytes)), bytes};
}

async function sha256(bytes) {
  check(globalThis.crypto?.subtle, 'SHA-256 needs a secure browser context');
  const value = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(value), n => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Fixed, city-independent display assets, not surveyed architecture.
 * One call owns all returned geometries; no global cache or shared lifetime.
 * Buildings use createCityAssetMaterials() with the geometry's wall, glazing
 * and metal groups. Do not set instanceColor: it would tint every surface.
 * Crown buffers are white and intentionally accept tree instance colours.
 */
export async function loadCityAssets({signal, manifestUrl = MANIFEST} = {}) {
  abort(signal);
  const url = new URL(manifestUrl, import.meta.url), owned = new Set();
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    for (const geometry of owned) geometry.dispose();
    owned.clear();
  }
  try {
    const {json: manifest, bytes: manifestBytes} = await fetchJson(url, signal);
    const fingerprint = await sha256(manifestBytes);
    check(manifest.schema === 'city-kit-manifest-v1' && /^1\.\d+\.\d+$/.test(manifest.version), 'unsupported manifest');
    check(Array.isArray(manifest.assets) && manifest.assets.length > 0 && manifest.assets.length <= 32, 'invalid manifest asset count');
    const assets = {}, buildings = Object.fromEntries(FAMILIES.map(family => [family, []])), trees = {}, roads = {};
    const parser = new THREE.BufferGeometryLoader();
    // Serial small-file loads keep failure/abort ownership simple. The full kit
    // remains under a few MiB and only this city invocation holds its buffers.
    for (const entry of manifest.assets) {
      abort(signal);
      check(typeof entry.file === 'string' && /^[a-z0-9-]+\.json$/.test(entry.file), 'asset path must remain within the version folder');
      check(typeof entry.glb?.file === 'string' && /^[a-z0-9-]+\.glb$/.test(entry.glb.file), 'GLB download path must remain within the version folder');
      check(/^[a-f0-9]{64}$/.test(entry.sha256 ?? ''), `${entry.id} missing hash`);
      check(!assets[entry.id], `duplicate asset ${entry.id}`);
      const {json, bytes} = await fetchJson(new URL(entry.file, url), signal);
      check(bytes.length === entry.bytes && await sha256(bytes) === entry.sha256, `${entry.id} integrity mismatch`);
      abort(signal);
      check(json.version === manifest.version && json.id === entry.id && json.role === entry.role && json.family === entry.family, `${entry.id} manifest identity mismatch`);
      const validation = validateCityAsset(json);
      const geometry = parser.parse(json.geometry);
      owned.add(geometry);
      geometry.name = json.id;
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      geometry.userData = {cityAssetId: json.id, cityAssetRole: json.role, version: manifest.version};
      const item = {id: json.id, name: json.name, file: entry.file, glb: entry.glb, family: json.family, variant: json.variant, role: json.role,
        geometry, bounds: validation.bounds, triangles: validation.triangles,
        parts: json.parts, displayUnit: json.displayUnit ?? (json.role === 'ordinary-building' ? 'building' : 'component'), buildingCount: json.buildingCount ?? (json.role === 'ordinary-building' ? 1 : 0), sharedSpace: json.sharedSpace ?? null, primaryBody: json.primaryBody ?? null, previewHeightToWidth: json.previewHeightToWidth ?? null, primaryHeightToWidth: json.primaryHeightToWidth ?? null, maxPrimarySlenderness: json.maxPrimarySlenderness ?? null, recommendedHeightToWidth: json.recommendedHeightToWidth, recommendedDepthToWidth: json.recommendedDepthToWidth ?? [1, 1],
        downloads: {json: new URL(entry.file, url).href, glb: new URL(entry.glb.file, url).href}};
      assets[json.id] = item;
      if (json.role === 'ordinary-building') buildings[json.family].push(item);
      else if (json.family === 'tree') trees[json.variant] = item;
      else if (json.family === 'road') roads[json.variant] = item;
    }
    for (const family of FAMILIES) check(buildings[family].length === (['generic','residential'].includes(family) && manifest.version === '1.7.0' ? 4 : 2), `${family} variant count mismatch`);
    for (const name of ['broadCrown', 'uprightCrown', 'trunk']) check(trees[name], `missing tree ${name}`);
    for (const name of ['deck', 'pier']) check(roads[name], `missing road ${name}`);
    abort(signal);
    signal?.addEventListener('abort', dispose, {once: true});
    return {version: manifest.version, fingerprint, assets, buildings, trees, roads,
      roadProfile: manifest.roadProfile, presets: manifest.presets, notice: manifest.notice,
      diagnostics: {assets: owned.size, triangles: Object.values(assets).reduce((sum, item) => sum + item.triangles, 0),
        bytes: manifest.assets.reduce((sum, item) => sum + item.bytes, 0)}, dispose};
  } catch (error) { dispose(); throw error; }
}

/** The caller owns this material; the kit owns only its loaded geometries. */
export function createCityAssetMaterial(options = {}) {
  return new THREE.MeshStandardMaterial({roughness: 0.32, metalness: 0.18, ...options, color: '#ffffff', vertexColors: true});
}

/** Material slots correspond to geometry.groups. All are owned by the caller.
 * Glass is backed architectural glazing: a reflective coated surface, not an
 * empty transparent volume. This preserves depth and avoids sorting thousands
 * of overlapping transparent buildings in the urban overview.
 */
export function createCityAssetMaterials({wallColour='#c1c9cd',glassColour='#b3bdc1'} = {}) {
  const opaque=new THREE.MeshStandardMaterial({color:wallColour,vertexColors:true,roughness:.78,metalness:.035});
  opaque.name='City Kit · masonry and roof';
  const glass=new THREE.MeshPhysicalMaterial({color:glassColour,vertexColors:true,roughness:.085,metalness:.65,clearcoat:.55,clearcoatRoughness:.05,ior:1.52,specularIntensity:1,emissive:'#53616c',emissiveIntensity:.045});
  glass.name='City Kit · reflective architectural glazing';
  const metal=new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.34,metalness:.65});
  metal.name='City Kit · aluminium mullions';
  return [opaque,glass,metal];
}
