// Visual generalization of measured DEM data, never procedural elevation.
// See docs/terrain-quality.md for the bounded filter and its limitations.
export const TERRAIN_QUALITY_TILES = 'terrain-clean://terrarium/{z}/{x}/{y}.png';
export const TERRAIN_QUALITY_POLICY = Object.freeze({
  windowSize: 5, minimumDeviationMeters: 160, madMultiplier: 6,
  maximumPasses: 3, maximumChangedFraction: 0.01,
  maximumParentLevels: 3,
  cacheBytes: 8 * 1024 * 1024, cacheTiles: 96,
});

function invalidTerrain(message, details = {}) {
  return Object.assign(new Error(message), {name:'TerrainDataError',code:'TERRAIN_DATA_INVALID',details});
}

// In-place selection avoids allocating and sorting 25-element arrays per pixel.
function median25(values) {
  let left = 0, right = 24;
  while (left < right) {
    const pivot = values[(left + right) >> 1];
    let low = left, high = right;
    while (low <= high) {
      while (values[low] < pivot) low++;
      while (values[high] > pivot) high--;
      if (low <= high) {
        const value = values[low]; values[low++] = values[high]; values[high--] = value;
      }
    }
    if (12 <= high) right = high;
    else if (12 >= low) left = low;
    else break;
  }
  return values[12];
}

/** Modify RGBA only at isolated height outliers; all boundaries stay unchanged. */
export function filterTerrariumRgba(rgba, width, height) {
  if (width !== 256 || height !== 256 || rgba.length !== width * height * 4) {
    throw invalidTerrain('Terrain quality filter requires an opaque 256×256 Terrarium tile.', {width,height});
  }
  const started = performance.now(), count = width * height;
  const original = new Float32Array(count);
  let minimumBefore = Infinity, maximumBefore = -Infinity;
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    if (rgba[offset + 3] !== 255) throw invalidTerrain('Terrain tile contains transparent, unmeasured pixels.');
    const elevation = rgba[offset] * 256 + rgba[offset + 1] + rgba[offset + 2] / 256 - 32768;
    original[i] = elevation;
    minimumBefore = Math.min(minimumBefore, elevation); maximumBefore = Math.max(maximumBefore, elevation);
  }
  let current = original, passes = 0;
  const values = new Float32Array(25), deviations = new Float32Array(25);
  for (let pass = 0; pass < TERRAIN_QUALITY_POLICY.maximumPasses; pass++) {
    const next = current.slice();
    let changedThisPass = 0;
    for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
      const index = y * width + x;
      let cursor = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        values[cursor++] = current[index + dy * width + dx];
      }
      const median = median25(values);
      const deviation = Math.abs(current[index] - median);
      if (deviation <= TERRAIN_QUALITY_POLICY.minimumDeviationMeters) continue;
      for (let i = 0; i < 25; i++) deviations[i] = Math.abs(values[i] - median);
      const mad = median25(deviations);
      if (deviation > Math.max(TERRAIN_QUALITY_POLICY.minimumDeviationMeters, TERRAIN_QUALITY_POLICY.madMultiplier * mad)) {
        next[index] = median; changedThisPass++;
      }
    }
    passes++;
    if (!changedThisPass) break;
    current = next;
  }
  let changedPixels = 0, absoluteChange = 0, maximumAbsoluteChange = 0;
  let minimumAfter = Infinity, maximumAfter = -Infinity, invalidPixels = 0;
  for (let i = 0; i < count; i++) {
    const elevation = current[i];
    // Reject unresolved nonphysical data instead of manufacturing a zero tile.
    if (elevation < -12000 || elevation > 9000) invalidPixels++;
    minimumAfter = Math.min(minimumAfter, elevation); maximumAfter = Math.max(maximumAfter, elevation);
    if (elevation === original[i]) continue;
    changedPixels++;
    const delta = Math.abs(elevation - original[i]);
    absoluteChange += delta; maximumAbsoluteChange = Math.max(maximumAbsoluteChange, delta);
  }
  if (invalidPixels) throw invalidTerrain('Terrain tile contains unresolved invalid elevations.', {minimumBefore,maximumBefore,minimumAfter,maximumAfter,invalidPixels});
  if (changedPixels > count * TERRAIN_QUALITY_POLICY.maximumChangedFraction) {
    throw invalidTerrain('Terrain tile requires extensive correction; refusing to invent its surface.', {minimumBefore,maximumBefore,minimumAfter,maximumAfter,changedPixels});
  }
  for (let i = 0; i < count; i++) if (current[i] !== original[i]) {
    const packed = Math.round((current[i] + 32768) * 256), offset = i * 4;
    rgba[offset] = packed >>> 16; rgba[offset + 1] = (packed >>> 8) & 255; rgba[offset + 2] = packed & 255;
  }
  return {changedPixels, totalPixels:count, passes, minimumBefore, maximumBefore, minimumAfter, maximumAfter,
    meanAbsoluteChange:absoluteChange / count, maximumAbsoluteChange, filterMs:performance.now() - started};
}

/** Browser PNG → encoded heights → bounded correction → lossless PNG. */
async function readTerrariumPng(buffer) {
  const bitmap = await createImageBitmap(new Blob([buffer], {type:'image/png'}), {colorSpaceConversion:'none',premultiplyAlpha:'none'});
  const {width, height} = bitmap;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), {width, height});
  const context = canvas.getContext('2d', {willReadFrequently:true, colorSpace:'srgb'});
  if (!context) { bitmap.close(); throw new Error('Unable to decode terrain pixels.'); }
  context.drawImage(bitmap, 0, 0); bitmap.close();
  const pixels = context.getImageData(0, 0, width, height);
  return {canvas,context,pixels,width,height};
}

async function writeTerrariumPng(canvas, context, pixels) {
  context.putImageData(pixels, 0, 0);
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({type:'image/png'}) : await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Unable to encode terrain PNG.')), 'image/png'));
  return blob.arrayBuffer();
}

export async function transformTerrariumPng(buffer) {
  const {canvas,context,pixels,width,height} = await readTerrariumPng(buffer);
  const stats = filterTerrariumRgba(pixels.data, width, height);
  // Preserve original compressed bytes when the filter makes no changes.
  if (!stats.changedPixels) return {data:buffer, stats};
  return {data:await writeTerrariumPng(canvas,context,pixels), stats};
}

/** Sample the requested descendant quadrant from validated parent heights.
 * Bilinear interpolation takes place in meters, never in encoded RGB channels.
 */
export async function resampleTerrariumParent(buffer, {levels,offsetX,offsetY}) {
  const scale = 2 ** levels;
  if (!Number.isInteger(levels) || levels < 1 || levels > TERRAIN_QUALITY_POLICY.maximumParentLevels ||
      !Number.isInteger(offsetX) || !Number.isInteger(offsetY) || offsetX < 0 || offsetY < 0 || offsetX >= scale || offsetY >= scale) {
    throw new Error('Invalid terrain parent crop.');
  }
  const {canvas,context,pixels,width,height} = await readTerrariumPng(buffer);
  if (width !== 256 || height !== 256) throw invalidTerrain('Invalid parent terrain dimensions.', {width,height});
  const heights = new Float32Array(65536), input = pixels.data;
  for (let i = 0; i < heights.length; i++) {
    const p = i * 4, value = input[p] * 256 + input[p + 1] + input[p + 2] / 256 - 32768;
    if (input[p + 3] !== 255 || value < -12000 || value > 9000) throw invalidTerrain('Parent terrain is not valid for resampling.');
    heights[i] = value;
  }
  let minimumAfter = Infinity, maximumAfter = -Infinity;
  const output = context.createImageData(256,256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    // Convert descendant pixel centers into the parent's pixel-center grid.
    const px = Math.max(0, Math.min(255, (offsetX * 256 + x + .5) / scale - .5));
    const py = Math.max(0, Math.min(255, (offsetY * 256 + y + .5) / scale - .5));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(255,x0 + 1), y1 = Math.min(255,y0 + 1);
    const tx = px - x0, ty = py - y0;
    const top = heights[y0 * 256 + x0] * (1 - tx) + heights[y0 * 256 + x1] * tx;
    const bottom = heights[y1 * 256 + x0] * (1 - tx) + heights[y1 * 256 + x1] * tx;
    const packed = Math.round((top * (1 - ty) + bottom * ty + 32768) * 256), p = (y * 256 + x) * 4;
    output.data[p] = packed >>> 16; output.data[p + 1] = (packed >>> 8) & 255; output.data[p + 2] = packed & 255; output.data[p + 3] = 255;
    const encodedHeight = packed / 256 - 32768;
    minimumAfter = Math.min(minimumAfter,encodedHeight); maximumAfter = Math.max(maximumAfter,encodedHeight);
  }
  return {data:await writeTerrariumPng(canvas,context,output),stats:{changedPixels:0,filterMs:0,resampledPixels:65536,minimumAfter,maximumAfter}};
}

// The same module runs in one worker; it does not import the app or the map.
const inWorker = typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope;
if (inWorker) globalThis.onmessage = async ({data:{id, buffer, crop}}) => {
  try {
    const result = crop ? await resampleTerrariumParent(buffer,crop) : await transformTerrariumPng(buffer);
    globalThis.postMessage({id, ...result}, [result.data]);
  } catch (error) {
    globalThis.postMessage({id, error:error.message,code:error.code,details:error.details});
  }
};

const installations = new WeakMap();
const abortError = () => new DOMException('Terrain request aborted.', 'AbortError');

/** Lease a shared protocol session; its final release drops all terrain resources. */
export function installTerrainQualityProtocol(maplibregl) {
  if (installations.has(maplibregl)) return installations.get(maplibregl).acquire();
  const cache = new Map(), inflight = new Map(), pendingWorker = new Map();
  const lifetime = new AbortController();
  const totals = {processedTiles:0, changedPixels:0, filterMs:0, cacheHits:0,
    fallbackTiles:0, parentFetches:0, parentCacheHits:0, maximumParentLevelsUsed:0, fallbackFailures:0};
  const recentFallbacks = [];
  let cacheBytes = 0, nextWorkerId = 1, worker = null, workerFailure = null;
  let leases = 0, disposed = false;
  const assertActive = signal => { if (disposed || signal?.aborted) throw abortError(); };
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    worker = new Worker(new URL('./terrain-quality.js', import.meta.url), {type:'module',name:'atlas-terrain-quality'});
    worker.onmessage = ({data}) => {
      const pending = pendingWorker.get(data.id); if (!pending) return;
      pendingWorker.delete(data.id);
      data.error ? pending.reject(Object.assign(new Error(data.error), {code:data.code,details:data.details})) : pending.resolve({data:data.data,stats:data.stats});
    };
    worker.onerror = () => {
      if (disposed) return;
      workerFailure = new Error('Terrain quality worker failed.');
      for (const pending of pendingWorker.values()) pending.reject(workerFailure);
      pendingWorker.clear();
    };
  }
  const transform = async (buffer, crop, signal) => {
    assertActive(signal);
    if (workerFailure) throw workerFailure;
    if (!worker) {
      const result = await (crop ? resampleTerrariumParent(buffer,crop) : transformTerrariumPng(buffer));
      assertActive(signal); return result;
    }
    const result = await new Promise((resolve, reject) => {
      const id = nextWorkerId++; pendingWorker.set(id, {resolve,reject});
      try { worker.postMessage({id,buffer,crop}, [buffer]); }
      catch (error) { pendingWorker.delete(id); reject(error); }
    });
    assertActive(signal); return result;
  };
  const remember = (key, result) => {
    assertActive();
    if (cache.has(key)) cacheBytes -= cache.get(key).data.byteLength;
    cache.set(key, result); cacheBytes += result.data.byteLength;
    while (cache.size > TERRAIN_QUALITY_POLICY.cacheTiles || cacheBytes > TERRAIN_QUALITY_POLICY.cacheBytes) {
      const oldest = cache.keys().next().value; cacheBytes -= cache.get(oldest).data.byteLength; cache.delete(oldest);
    }
  };
  const fetchDirect = async (key, signal) => {
    assertActive(signal);
    const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`, {signal,credentials:'omit'});
    assertActive(signal);
    if (response.status === 404 || response.status === 410) throw invalidTerrain(`Terrain source tile is unavailable (${key}).`);
    if (!response.ok) throw new Error(`Terrain tile request failed (${response.status}; ${key}).`);
    const buffer = await response.arrayBuffer();
    assertActive(signal);
    return transform(buffer, undefined, signal);
  };
  const loadWithParentFallback = async (z, x, y, signal) => {
    const key = `${z}/${x}/${y}`, attempts = [];
    let originalError;
    try { return await fetchDirect(key, signal); }
    catch (error) {
      assertActive(signal);
      if (error.code !== 'TERRAIN_DATA_INVALID') throw error;
      originalError = error; attempts.push({tile:key,message:error.message,details:error.details});
    }
    // Read each ancestor directly. Never recurse through previously derived
    // cache entries, which could silently exceed the maximum fallback depth.
    for (let levels = 1; levels <= Math.min(z,TERRAIN_QUALITY_POLICY.maximumParentLevels); levels++) {
      assertActive(signal);
      const scale = 2 ** levels, parentKey = `${z-levels}/${Math.floor(x/scale)}/${Math.floor(y/scale)}`;
      try {
        let parent = cache.get(parentKey), cached = !!parent && !parent.fallback;
        if (cached) totals.parentCacheHits++;
        else {
          totals.parentFetches++;
          parent = await fetchDirect(parentKey,signal);
          assertActive(signal);
          remember(parentKey,parent);
        }
        const result = await transform(parent.data.slice(0), {levels,offsetX:x%scale,offsetY:y%scale}, signal);
        assertActive(signal);
        result.stats.filterMs += cached ? 0 : parent.stats.filterMs;
        result.stats.changedPixels += cached ? 0 : parent.stats.changedPixels;
        result.fallback = {requestedTile:key,sourceTile:parentKey,levels,method:'bilinear-height',
          reason:originalError.message,attempts,minimumAfter:result.stats.minimumAfter,maximumAfter:result.stats.maximumAfter};
        totals.fallbackTiles++; totals.maximumParentLevelsUsed = Math.max(totals.maximumParentLevelsUsed,levels);
        recentFallbacks.push(result.fallback); if (recentFallbacks.length > 16) recentFallbacks.shift();
        return result;
      } catch (error) {
        assertActive(signal);
        if (error.code !== 'TERRAIN_DATA_INVALID') throw error;
        attempts.push({tile:parentKey,message:error.message,details:error.details});
      }
    }
    assertActive(signal); totals.fallbackFailures++;
    throw invalidTerrain(`Terrain tile ${key} and its ${Math.min(z,TERRAIN_QUALITY_POLICY.maximumParentLevels)} parent levels contain no usable elevation.`, {attempts});
  };
  const protocol = async (params, abortController) => {
    const signal = abortController?.signal;
    assertActive(signal);
    const match = /^terrain-clean:\/\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(params.url);
    if (!match) throw new Error('Invalid terrain tile URL.');
    const [z,x,y] = match.slice(1).map(Number);
    if (z > 15 || x >= 2 ** z || y >= 2 ** z) throw new Error('Terrain tile outside supported pyramid.');
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) {
      const result = cache.get(key); cache.delete(key); cache.set(key, result); totals.cacheHits++;
      return {data:result.data.slice(0)};
    }
    let task = inflight.get(key);
    if (task?.controller.signal.aborted) { inflight.delete(key); task = null; }
    if (!task) {
      task = {controller:new AbortController(), consumers:0};
      const sharedTask = task;
      task.promise = (async () => {
        const result = await loadWithParentFallback(z,x,y,sharedTask.controller.signal);
        assertActive(sharedTask.controller.signal);
        totals.processedTiles++; totals.changedPixels += result.stats.changedPixels; totals.filterMs += result.stats.filterMs;
        remember(key, result); return result;
      })().finally(() => { if (inflight.get(key) === sharedTask) inflight.delete(key); });
      inflight.set(key, task);
    }
    task.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort);
        lifetime.signal.removeEventListener('abort', onAbort);
        task.consumers--; if (!task.consumers && inflight.get(key) === task) task.controller.abort();
        error ? reject(error) : resolve({data:result.data.slice(0)});
      };
      const onAbort = () => finish(abortError());
      signal?.addEventListener('abort', onAbort, {once:true});
      lifetime.signal.addEventListener('abort', onAbort, {once:true});
      task.promise.then(result => finish(null, result), error => finish(error));
      if (disposed || signal?.aborted) onAbort();
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // Settle consumers immediately, including a decoder or fetch that ignores abort.
    lifetime.abort();
    for (const task of inflight.values()) task.controller.abort();
    inflight.clear();
    for (const pending of pendingWorker.values()) pending.reject(abortError());
    pendingWorker.clear();
    if (worker) {
      worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = null;
    }
    cache.clear(); cacheBytes = 0; recentFallbacks.length = 0;
  };
  const installation = {acquire() {
    assertActive(); leases++;
    let released = false;
    return {
      stats:() => ({...totals, cacheBytes, cachedTiles:cache.size, inflightTiles:inflight.size,
        worker:!!worker, pendingWorkerTasks:pendingWorker.size, leases, released, disposed,
        recentFallbacks:recentFallbacks.slice()}),
      release() {
        if (released) return;
        released = true; leases--;
        if (leases) return;
        dispose();
        try { maplibregl.removeProtocol('terrain-clean'); }
        finally { if (installations.get(maplibregl) === installation) installations.delete(maplibregl); }
      },
    };
  }};
  try { maplibregl.addProtocol('terrain-clean', protocol); }
  catch (error) { dispose(); throw error; }
  installations.set(maplibregl, installation);
  return installation.acquire();
}
