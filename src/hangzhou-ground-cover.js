import * as THREE from 'three';

const DEFAULT_BOUNDS = [119.78, 30.06, 120.46, 30.58];
const DEFAULT_PALETTE = {
  forest: '#719254',
  urban: '#c6bdab',
  urbanClasses: {
    residential: '#c8bea8', commercial: '#bcb6aa', industrial: '#b6b4aa',
    retail: '#c4b8a8', institutional: '#cec6b0',
  },
};
const COVER_CLASS_ORDER = ['park', 'grass', 'farmland', 'scrub', 'forest', 'wetland'];
const COVER_PALETTE = {
  grass: '#a9b987', farmland: '#b5b28a', park: '#90aa72',
  scrub: '#889d69', wetland: '#86a08b', forest: '#719254',
};
const PATCH_REVISION = 'hangzhou-ground-cover-v5';
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

// Binary closing joins small gaps within the existing urban pattern. Its square
// kernel is inscribed in the requested metre radius, so even diagonal display
// infill stays within that radius of a mapped urban pixel. It never assigns a
// residential/commercial/industrial class to the infill.
async function closeUrbanMask(mask, size, radiusX, radiusY, signal) {
  const scratch = new Uint8Array(mask.length);
  async function pass(source, target, radius, vertical, dilate) {
    for (let row = 0; row < size; row++) {
      if (row % 128 === 0) { aborted(signal); await nextTask(); }
      const at = i => vertical ? i * size + row : row * size + i;
      let count = 0;
      for (let i = 0; i <= radius && i < size; i++) count += source[at(i)];
      for (let i = 0; i < size; i++) {
        target[at(i)] = dilate ? Number(count > 0) : Number(count === radius * 2 + 1);
        if (i - radius >= 0) count -= source[at(i - radius)];
        if (i + radius + 1 < size) count += source[at(i + radius + 1)];
      }
    }
  }
  await pass(mask, scratch, radiusX, false, true);
  await pass(scratch, mask, radiusY, true, true);
  await pass(mask, scratch, radiusX, false, false);
  await pass(scratch, mask, radiusY, true, false);
  return mask;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('Ground cover needs a Canvas 2D implementation.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function aborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('Ground cover creation aborted.', 'AbortError');
}

function validBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)
    && bounds[0] < bounds[2] && bounds[1] < bounds[3]
    && bounds[0] >= -180 && bounds[2] <= 180 && bounds[1] > -85.05 && bounds[3] < 85.05;
}

/**
 * Ground colour only: mapped forest/urban and explicitly supplied land-cover
 * polygons, clipped to the municipality and cleared over source water.
 * classes accepts only forest/grass/farmland/park/scrub/wetland. Every shape must
 * come from source geometry; neither land use nor surface details are inferred.
 * Optional continuityMeters adds a neutral display substrate in small gaps of
 * that urban pattern. This is cartographic colour infill, never new land-use
 * evidence. Explicit natural cover, source water and the municipal clip win.
 * gapColour is an explicitly requested landscaping treatment for remaining
 * unpainted ground, not an inferred park class. Airport context colours use
 * actual aerodrome outlines; solid runways/aprons are separate scene geometry.
 *
 * Await this once per city, then applyToMaterial(terrainMesh.material). The terrain
 * must use the supplied, unchanged regional projection in world X/Z. No UV
 * attributes, positions or elevation values are edited. Apply only to terrain,
 * not water, buildings, the cut face, or their shared materials.
 *
 * This owner holds one RGBA canvas and one texture (each 16 MiB at 2048 squared;
 * no mipmaps). dispose() removes its material hooks and releases its own resources,
 * never the caller's materials/geometries. A supplied signal also disposes on abort.
 * canvasFactory is optional for non-DOM hosts and pure code validation.
 */
export async function createHangzhouGroundCover({
  data,
  urban = data?.urban ?? [],
  classes = [],
  projection,
  bounds = DEFAULT_BOUNDS,
  size = 2048,
  fadeMeters = 3000,
  opacity = 0.92,
  continuityMeters = 0,
  gapColour = null,
  airports = [],
  airportContextMeters = 1000,
  airportPavingColour = '#8a8d80',
  airportFieldColour = '#788e5c',
  palette = {},
  signal,
  canvasFactory = makeCanvas,
} = {}) {
  aborted(signal);
  if (!validBounds(bounds)) throw new Error('Ground-cover bounds must be [west, south, east, north].');
  if (!Number.isInteger(size) || size < 64 || size > 2048) throw new Error('Ground-cover size must be 64–2048 pixels.');
  if (!(fadeMeters >= 0) || !Number.isFinite(fadeMeters)) throw new Error('Ground-cover fade must be finite nonnegative metres.');
  if (!(opacity >= 0 && opacity <= 1)) throw new Error('Ground-cover opacity must be between 0 and 1.');
  if (!Number.isFinite(continuityMeters) || continuityMeters < 0 || continuityMeters > 400) throw new Error('Ground continuity must be 0–400 display metres.');
  if (!Array.isArray(airports) || !Number.isFinite(airportContextMeters) || airportContextMeters < 0 || airportContextMeters > 2000) throw new Error('Ground cover needs an airport list and a context radius of 0–2000 metres.');
  if (typeof projection?.project !== 'function' || !Number.isFinite(projection.metersToUnits) || !(projection.metersToUnits > 0)) {
    throw new Error('Ground cover requires the regional project() and metersToUnits.');
  }
  if (!Array.isArray(data?.boundary) || !data.boundary.length) throw new Error('Ground cover requires the source municipal boundary.');
  if (!Array.isArray(urban)) throw new Error('Ground-cover urban input must be a polygon list.');
  if (!Array.isArray(classes)) throw new Error('Ground-cover classes input must be a source polygon list.');

  const [west, south, east, north] = bounds;
  const northwest = projection.project([west, north], 0), southeast = projection.project([east, south], 0);
  const minX = northwest.x, minZ = northwest.z, spanX = southeast.x - minX, spanZ = southeast.z - minZ;
  if (!(spanX > 0 && spanZ > 0)) throw new Error('Ground-cover projection must have east +X and south +Z.');
  // Corner-derived texture coordinates require the current separable base map,
  // and must not silently accept a later lens/warp that would misalign land use.
  for (const coordinate of [[west, south], [east, north], [(west + east) / 2, north], [west, (south + north) / 2]]) {
    const p = projection.project(coordinate, 0);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)
      || coordinate[0] === west && Math.abs(p.x - minX) > 1e-7
      || coordinate[1] === north && Math.abs(p.z - minZ) > 1e-7
      || coordinate[0] === east && Math.abs(p.x - minX - spanX) > 1e-7
      || coordinate[1] === south && Math.abs(p.z - minZ - spanZ) > 1e-7) {
      throw new Error('Ground-cover projection must retain the unwarped regional frame.');
    }
  }
  const colours = {...DEFAULT_PALETTE, ...palette,
    urbanClasses: {...DEFAULT_PALETTE.urbanClasses, ...palette.urbanClasses},
    coverClasses: {...COVER_PALETTE, forest: palette.forest ?? DEFAULT_PALETTE.forest, ...palette.coverClasses}};
  for (const colour of [colours.urban, colours.forest, ...Object.values(colours.urbanClasses), ...Object.values(colours.coverClasses), ...(gapColour ? [gapColour] : []), airportPavingColour, airportFieldColour]) {
    if (typeof colour !== 'string' || !/^#[\da-f]{6}$/i.test(colour)) throw new Error('Ground-cover colours must use #rrggbb.');
  }

  let canvas = canvasFactory(size, size), texture = null, disposed = false;
  const context = canvas?.getContext('2d');
  if (!context) {
    if (canvas) canvas.width = canvas.height = 0;
    throw new Error('Ground-cover Canvas 2D context is unavailable.');
  }
  canvas.width = canvas.height = size;
  const attachments = new Map();
  const diagnostics = {
    revision: PATCH_REVISION, bounds: [...bounds], size, fadeMeters, opacity,
    continuity: {requestedMeters: continuityMeters, radiusPixels: [0, 0], radiusMeters: 0, candidateInfillPixelsBeforeNaturalAndWater: 0, role: 'neutral-cartographic-substrate-only'},
    displayGreening: {gapColour, role: gapColour ? 'user-requested-schematic-ground-planting' : 'none', inferredLandUse: false},
    airportContext: {ids: [], radiusMeters: airportContextMeters, pavingColour: airportPavingColour, fieldColour: airportFieldColour},
    projectedBounds: [minX, minZ, minX + spanX, minZ + spanZ],
    textureBytes: size * size * 4, canvasBytes: size * size * 4, mipmaps: false,
    urbanClassInputs: {}, urbanClassDrawn: {}, urbanClassColours: {},
    urbanPolygons: 0, forestPolygons: 0, waterPolygons: 0, boundaryPolygons: 0,
    classPolygons: 0, ignoredClassPolygons: 0,
    classes: Object.fromEntries(COVER_CLASS_ORDER.map(name => [name, {input: 0, drawn: 0, culled: 0, invalid: 0}])),
    classDrawOrder: [...COVER_CLASS_ORDER],
    culledPolygons: 0, invalidPolygons: 0, projectedVertices: 0, disposed: false,
    sourcePolicy: 'Mapped urban classes above bounded neutral infill. Airport context lightens only existing urban paint within a source-boundary buffer; the source airport outline gets a field colour. Explicit natural cover wins. Optional user-requested green substrate fills remaining urban-view gaps without inferring land use. Water erased last; municipal clip. Actual roads, aprons and plazas keep their separate solid surfaces. No building display envelopes used. All colours and gap planting are cartographic display choices.',
  };
  const uvForPosition = (x, z) => [(x - minX) / spanX, 1 - (z - minZ) / spanZ];
  const uvForCoordinate = coordinate => {
    const p = projection.project(coordinate, 0);
    return uvForPosition(p.x, p.z);
  };

  function trace(rings) {
    if (!Array.isArray(rings) || !rings.length || rings.some(ring => !Array.isArray(ring) || ring.length < 3)) {
      diagnostics.invalidPolygons++;
      return false;
    }
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const ring of rings) for (const coordinate of ring) {
      if (!Array.isArray(coordinate) || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) || Math.abs(coordinate[1]) >= 85.05) {
        diagnostics.invalidPolygons++;
        return false;
      }
      w = Math.min(w, coordinate[0]); s = Math.min(s, coordinate[1]);
      e = Math.max(e, coordinate[0]); n = Math.max(n, coordinate[1]);
    }
    if (e < west || w > east || n < south || s > north) {
      diagnostics.culledPolygons++;
      return false;
    }
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const p = projection.project(ring[i], 0), x = (p.x - minX) / spanX * size, y = (p.z - minZ) / spanZ * size;
        if (i) context.lineTo(x, y);
        else context.moveTo(x, y);
        diagnostics.projectedVertices++;
      }
      context.closePath();
    }
    return true;
  }

  async function fillEntries(entries, kind, colourAt) {
    for (let i = 0; i < entries.length; i++) {
      if (i % 128 === 0) { aborted(signal); await nextTask(); }
      context.beginPath();
      if (!trace(entries[i]?.rings)) continue;
      context.fillStyle = colourAt(entries[i]);
      context.fill('evenodd');
      diagnostics[kind]++;
      if(kind === 'urbanPolygons') {
        const name=entries[i].class ?? 'unknown';
        diagnostics.urbanClassDrawn[name]=(diagnostics.urbanClassDrawn[name]||0)+1;
        diagnostics.urbanClassColours[name]=colours.urbanClasses[name] ?? colours.urban;
      }
    }
  }

  async function fillDisplayGaps() {
    if (!continuityMeters) return;
    const pixelX = spanX / projection.metersToUnits / size, pixelY = spanZ / projection.metersToUnits / size;
    const radiusX = Math.floor(continuityMeters / Math.SQRT2 / pixelX), radiusY = Math.floor(continuityMeters / Math.SQRT2 / pixelY);
    if (!radiusX || !radiusY) return;
    Object.assign(diagnostics.continuity, {radiusPixels: [radiusX, radiusY], radiusMeters: Math.hypot(radiusX * pixelX, radiusY * pixelY)});
    const pixels = context.getImageData(0, 0, size, size), mask = new Uint8Array(size * size);
    for (let i = 0; i < mask.length; i++) mask[i] = Number(pixels.data[i * 4 + 3] >= 128);
    await closeUrbanMask(mask, size, radiusX, radiusY, signal);
    const rgb = [1, 3, 5].map(i => parseInt(colours.urban.slice(i, i + 2), 16));
    for (let i = 0; i < mask.length; i++) {
      const p = i * 4;
      if (mask[i] && pixels.data[p + 3] < 255) diagnostics.continuity.candidateInfillPixelsBeforeNaturalAndWater++;
      pixels.data[p] = rgb[0]; pixels.data[p + 1] = rgb[1]; pixels.data[p + 2] = rgb[2]; pixels.data[p + 3] = mask[i] * 255;
    }
    // putImageData ignores clipping. Stage it on a temporary canvas, then draw
    // through the SAME municipal clip underneath the sourced class colours.
    // Only the original single canvas/texture survives this one-time pass.
    const substrate = canvasFactory(size, size);
    try {
      substrate.width = substrate.height = size;
      const substrateContext = substrate.getContext('2d');
      if (!substrateContext) throw new Error('Ground continuity Canvas 2D context is unavailable.');
      substrateContext.putImageData(pixels, 0, 0);
      context.save();
      context.globalCompositeOperation = 'destination-over';
      context.drawImage(substrate, 0, 0);
      context.restore();
    } finally { substrate.width = substrate.height = 0; }
  }

  function paintAirportContext() {
    // Work in projected metres so the surrounding buffer is circular in the
    // map, despite the different X/Y texture pixel sizes. source-atop changes
    // existing urban paint only; it cannot invent an apron beyond the airport.
    context.save();
    context.setTransform(size / spanX, 0, 0, size / spanZ, -minX * size / spanX, -minZ * size / spanZ);
    for (const airport of airports) {
      if (!Array.isArray(airport.boundary) || !airport.boundary.length) continue;
      context.beginPath();
      for (const rings of airport.boundary) for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const p = projection.project(ring[i], 0);
          if (i) context.lineTo(p.x, p.z); else context.moveTo(p.x, p.z);
        }
        context.closePath();
      }
      context.globalCompositeOperation = 'source-atop';
      context.fillStyle = context.strokeStyle = airportPavingColour;
      context.lineWidth = 2 * airportContextMeters * projection.metersToUnits;
      context.lineJoin = context.lineCap = 'round';
      if (airportContextMeters) context.stroke();
      context.fill('evenodd');
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = airportFieldColour;
      context.fill('evenodd');
      diagnostics.airportContext.ids.push(airport.id);
    }
    context.restore();
  }


  async function fillSourceClasses() {
    // The whitelist, not the caller's palette keys, decides which source classes
    // are eligible. No substring matching or fallback maps unknown classes to land.
    const groups = new Map(COVER_CLASS_ORDER.map(name => [name, []]));
    for (let i = 0; i < classes.length; i++) {
      if (i % 256 === 0) { aborted(signal); await nextTask(); }
      const entry = classes[i], group = groups.get(entry?.class);
      if (!group) { diagnostics.ignoredClassPolygons++; continue; }
      group.push(entry);
      diagnostics.classes[entry.class].input++;
    }
    // A known green/open-space polygon must not disappear below a broad urban
    // mask. Within overlapping explicit sources this documented order is only a
    // cartographic paint priority, not evidence of a different ground-use class.
    for (const name of COVER_CLASS_ORDER) {
      // Woods remain visible within broad park/urban polygons; explicitly mapped
      // wetland is painted above them, in the source sidecar's declared priority.
      if (name === 'forest') await fillEntries(data.forest ?? [], 'forestPolygons', () => colours.forest);
      const entries = groups.get(name), stats = diagnostics.classes[name];
      for (let i = 0; i < entries.length; i++) {
        if (i % 128 === 0) { aborted(signal); await nextTask(); }
        context.beginPath();
        const invalidBefore = diagnostics.invalidPolygons;
        if (!trace(entries[i].rings)) {
          if (diagnostics.invalidPolygons > invalidBefore) stats.invalid++;
          else stats.culled++;
          continue;
        }
        context.fillStyle = colours.coverClasses[name];
        context.fill('evenodd');
        stats.drawn++; diagnostics.classPolygons++;
      }
      groups.delete(name);
    }
  }

  function detach(material) {
    const state = attachments.get(material);
    if (!state) return;
    // Do not overwrite a hook the caller replaced after this module attached.
    if (material.onBeforeCompile === state.compile) material.onBeforeCompile = state.previousCompile;
    if (material.customProgramCacheKey === state.cacheKey) material.customProgramCacheKey = state.previousCacheKey;
    for (const shader of state.shaders) if (shader.uniforms.hgcOpacity) shader.uniforms.hgcOpacity.value = 0;
    state.shaders.clear();
    attachments.delete(material);
    material.needsUpdate = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true; diagnostics.disposed = true;
    signal?.removeEventListener('abort', dispose);
    for (const material of [...attachments.keys()]) detach(material);
    texture?.dispose();
    if (texture) texture.image = null;
    if (canvas) canvas.width = canvas.height = 0;
    canvas = null;
  }

  function applyToMaterial(material) {
    if (disposed) throw new Error('Cannot attach disposed ground cover.');
    if (!material?.isMeshStandardMaterial) throw new Error('Ground cover expects the terrain MeshStandardMaterial.');
    if (attachments.has(material)) return () => detach(material);
    const previousCompile = material.onBeforeCompile, previousCacheKey = material.customProgramCacheKey;
    const state = {previousCompile, previousCacheKey, shaders: new Set()};
    state.compile = function(shader, renderer) {
      previousCompile.call(this, shader, renderer);
      if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('#include <color_fragment>')) {
        throw new Error('Ground-cover shader cannot find the standard terrain colour/projection chunks.');
      }
      shader.uniforms.hgcTexture = {value: texture};
      shader.uniforms.hgcBounds = {value: new THREE.Vector4(minX, minZ, 1 / spanX, 1 / spanZ)};
      shader.uniforms.hgcSizeMeters = {value: new THREE.Vector2(spanX / projection.metersToUnits, spanZ / projection.metersToUnits)};
      shader.uniforms.hgcFadeMeters = {value: fadeMeters};
      shader.uniforms.hgcOpacity = {value: opacity};
      shader.vertexShader = 'varying vec2 vHgcUv;\nuniform vec4 hgcBounds;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec2 hgcXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
        vHgcUv = (hgcXZ - hgcBounds.xy) * hgcBounds.zw;
        vHgcUv.y = 1.0 - vHgcUv.y;
      `);
      shader.fragmentShader = `varying vec2 vHgcUv;
        uniform sampler2D hgcTexture;
        uniform vec2 hgcSizeMeters;
        uniform float hgcFadeMeters;
        uniform float hgcOpacity;
      ` + shader.fragmentShader;
      // Applied after source vertex colour but before all physically based lighting.
      // CanvasTexture is tagged sRGB; the GPU supplies linear sampled colours.
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (vHgcUv.x >= 0.0 && vHgcUv.x <= 1.0 && vHgcUv.y >= 0.0 && vHgcUv.y <= 1.0) {
          vec4 hgcCover = texture2D(hgcTexture, vHgcUv);
          vec2 hgcEdge = min(vHgcUv, vec2(1.0) - vHgcUv) * hgcSizeMeters;
          float hgcFade = hgcFadeMeters > 0.0 ? smoothstep(0.0, hgcFadeMeters, min(hgcEdge.x, hgcEdge.y)) : 1.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, hgcCover.rgb, hgcCover.a * hgcFade * hgcOpacity);
        }
      `);
      state.shaders.add(shader);
    };
    state.cacheKey = function() { return previousCacheKey.call(this) + ':' + PATCH_REVISION; };
    attachments.set(material, state);
    material.onBeforeCompile = state.compile;
    material.customProgramCacheKey = state.cacheKey;
    material.needsUpdate = true;
    return () => detach(material);
  }

  try {
    context.clearRect(0, 0, size, size);
    // The scene boundary is a valid MultiPolygon; one even-odd clip preserves its
    // holes and islands without an additional full-sized masking canvas.
    context.save();
    context.beginPath();
    for (const rings of data.boundary) if (trace(rings)) diagnostics.boundaryPolygons++;
    if (!diagnostics.boundaryPolygons) throw new Error('Ground-cover bounds do not intersect the municipal boundary.');
    context.clip('evenodd');
    // Base developed/mixed coverage is drawn first by the caller; sourced
    // specific classifications overlay it in source order. This is a visual
    // priority for overlapping records, not a claim of unique real-world use.
    for(const entry of urban){const name=entry.class ?? 'unknown';diagnostics.urbanClassInputs[name]=(diagnostics.urbanClassInputs[name]||0)+1;}
    await fillEntries(urban, 'urbanPolygons', entry => colours.urbanClasses[entry.class] ?? colours.urban);
    await fillDisplayGaps();
    paintAirportContext();
    await fillSourceClasses();
    if (gapColour) {
      // A requested model-landscaping treatment, not a newly mapped park class.
      // Keep sourced urban/natural paint and independent solid paving on top.
      context.save();
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = gapColour;
      context.fillRect(0, 0, size, size);
      context.restore();
    }
    context.globalCompositeOperation = 'destination-out';
    await fillEntries(data.water ?? [], 'waterPolygons', () => '#ffffff');
    context.restore();
    aborted(signal);
    texture = new THREE.CanvasTexture(canvas);
    texture.name = 'Hangzhou source land-use ground colours';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = true;
    texture.needsUpdate = true;
    signal?.addEventListener('abort', dispose, {once: true});
    // No source arrays belong to this owner after the one-time drawing pass.
    data = null; urban = null; classes = null; airports = null;
    return {texture, diagnostics, uvForCoordinate, uvForPosition, applyToMaterial, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}
