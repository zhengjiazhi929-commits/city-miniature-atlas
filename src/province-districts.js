import * as THREE from 'three';
import polygonClipping from '../vendor/polygon-clipping.js';
import {regionPolygons} from './region-projection.js';
import {containsCoordinate} from './geographic-bounds.js';

const DATA_URL = new URL('../data/regions/zhejiang-cities.geojson', import.meta.url);
const GRID_SIZE = 64;
const SURFACE_OFFSET = .018;
// Covers projected Float32 / clipping roundoff, not cartographic boundary gaps.
const BOUNDARY_TOLERANCE = 1e-5;
const MAX_BYTES = 512 * 1024;
const MAX_COORDINATES = 20000;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const abortError = () => new DOMException('城市分区加载已取消。', 'AbortError');

function bounds(polygons) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const ring of polygon) for (const [x, z] of ring) {
    result[0] = Math.min(result[0], x); result[1] = Math.min(result[1], z);
    result[2] = Math.max(result[2], x); result[3] = Math.max(result[3], z);
  }
  return result;
}

function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const insidePolygons = (polygons, x, z) => polygons.some(p => insideRing(p[0], x, z) && !p.slice(1).some(r => insideRing(r, x, z)));

function boundarySegments(polygons) {
  const segments = [];
  for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], dx = b[0] - a[0], dz = b[1] - a[1];
    segments.push({a, dx, dz, length2: dx * dx + dz * dz,
      left: Math.min(a[0], b[0]) - BOUNDARY_TOLERANCE, right: Math.max(a[0], b[0]) + BOUNDARY_TOLERANCE,
      near: Math.min(a[1], b[1]) - BOUNDARY_TOLERANCE, far: Math.max(a[1], b[1]) + BOUNDARY_TOLERANCE});
  }
  return segments;
}

function onBoundary(segments, x, z) {
  return segments.some(s => {
    if (x < s.left || x > s.right || z < s.near || z > s.far) return false;
    const t = Math.max(0, Math.min(1, ((x - s.a[0]) * s.dx + (z - s.a[1]) * s.dz) / (s.length2 || 1)));
    return Math.hypot(x - s.a[0] - t * s.dx, z - s.a[1] - t * s.dz) <= BOUNDARY_TOLERANCE;
  });
}

/** City surfaces are clipped from the final province triangles, not resampled DEM.
 * Create after terrain.setWaterMask/setSurfaceTexture. update() takes seconds.
 * The returned object owns its geometry/materials, never the borrowed terrain map.
 */
export async function createProvinceDistricts({region, projection, terrain, signal, onHover = () => {}, reducedMotion = false, liftHeight = .22}) {
  signal?.throwIfAborted();
  if (region?.properties?.id !== 'zhejiang') throw new Error('当前城市分区仅提供浙江省。');
  const sourceMesh = terrain?.terrainMesh;
  if (!sourceMesh?.geometry?.index || !sourceMesh.geometry.attributes.uv) throw new Error('请先完成省份地形与水面，再创建城市分区。');
  const lifetime = new AbortController(), group = new THREE.Group(), cities = [], entries = [], geometries = new Set(), materials = new Set();
  group.name = 'Zhejiang real prefecture boundaries';
  const diagnostics = {cityCount: 0, sourceYear: '2020', triangleCount: 0, clippedSourceTriangles: 0, copiedSourceTriangles: 0,
    boundarySegments: 0, discardedInternalEdges: 0, geometryBytes: 0, materialCount: 0, hoveredId: null, visibleCityCount: 0, lift: 0,
    liftHeight: THREE.MathUtils.clamp(Number(liftHeight) || .22, .15, .35), surfaceOffset: SURFACE_OFFSET,
    buildMs: 0, borrowedTexture: !!sourceMesh.material.map, disposed: false, cities: []};
  let hovered = null, hoverLift = 0, texture = sourceMesh.material.map || null, defaultLines = null;
  let topMaterial, skirtMaterial, hoverLineMaterial, baseLineMaterial;
  const started = performance.now();
  const active = () => { if (lifetime.signal.aborted || diagnostics.disposed) throw abortError(); };
  const registerGeometry = value => { geometries.add(value); return value; };
  const registerMaterial = value => { materials.add(value); return value; };
  function dispose() {
    if (diagnostics.disposed) return;
    diagnostics.disposed = true; lifetime.abort(); signal?.removeEventListener('abort', dispose);
    for (const geometry of geometries) {
      geometry.dispose(); for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name); geometry.setIndex(null);
    }
    for (const material of materials) { material.map = null; material.dispose(); }
    geometries.clear(); materials.clear(); group.clear(); cities.length = entries.length = 0;
    hovered = texture = defaultLines = topMaterial = skirtMaterial = hoverLineMaterial = baseLineMaterial = null;
    diagnostics.geometryBytes = diagnostics.visibleCityCount = diagnostics.materialCount = 0;
    diagnostics.hoveredId = null; diagnostics.lift = 0;
  }
  signal?.addEventListener('abort', dispose, {once: true});
  try {
    const timeout = setTimeout(() => lifetime.abort(), 20000);
    let collection;
    try {
      const response = await fetch(DATA_URL, {signal: lifetime.signal, cache: 'no-store', credentials: 'same-origin'});
      active();
      if (!response.ok) throw new Error(`浙江城市边界暂时无法读取（${response.status}）。`);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('浙江城市边界文件过大。');
      const buffer = await response.arrayBuffer(); active();
      if (buffer.byteLength > MAX_BYTES) throw new Error('浙江城市边界文件过大。');
      collection = JSON.parse(new TextDecoder().decode(buffer));
    } finally { clearTimeout(timeout); }
    if (collection?.type !== 'FeatureCollection' || collection.features?.length !== 11) throw new Error('浙江城市分区必须包含 11 个真实城市面。');
    diagnostics.coverage = collection.metadata?.coverage;
    diagnostics.attribution = collection.metadata?.attribution;
    diagnostics.license = collection.metadata?.license;
    const projectPolygons = feature => regionPolygons(feature).map(p => p.map(r => r.map(c => { const v = projection.project(c); return [v.x, v.z]; })));
    const provincePolygons = projectPolygons(region), extent = bounds(provincePolygons);
    const width = extent[2] - extent[0], depth = extent[3] - extent[1];
    const binX = x => Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((x - extent[0]) / width * GRID_SIZE)));
    const binZ = z => Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((z - extent[1]) / depth * GRID_SIZE)));
    const bins = Array.from({length: GRID_SIZE * GRID_SIZE}, () => []), usedIds = new Set();
    let coordinateCount = 0;
    for (const feature of collection.features) {
      active();
      const p = feature.properties || {};
      if (p.province !== 'zhejiang' || !p.id || usedIds.has(p.id)) throw new Error('浙江城市分区身份无效。');
      usedIds.add(p.id);
      for (const polygon of regionPolygons(feature)) for (const ring of polygon) {
        if (ring.length < 4 || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('城市边界环未闭合。');
        for (const c of ring) {
          if (++coordinateCount > MAX_COORDINATES || !c.slice(0, 2).every(Number.isFinite)) throw new Error('城市边界坐标无效或过多。');
        }
      }
      const polygons = polygonClipping.intersection(projectPolygons(feature), provincePolygons);
      if (!polygons.length) throw new Error(`“${p.name}”与浙江省范围不相交。`);
      const item = Object.freeze({id: p.id, name: p.name, nameEn: p.nameEn, province: 'zhejiang', coordinates: [...p.coordinates],
        boundaryId: p.boundaryId, sourceBoundaryId: p.sourceBoundaryId, coordinateRole: p.coordinateRole});
      const entry = {item, feature, polygons, bounds: bounds(polygons), positions: [], normals: [], uvs: [], colors: [], indices: [], vertexMap: new Map(), edges: new Map(), clippingStrips: new Map()};
      cities.push(item); entries.push(entry);
      // A cell wholly away from any boundary has constant membership. Only
      // triangles in boundary cells need the more expensive polygon clipping.
      const boundaryBins = new Set();
      for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        for (let z = binZ(Math.min(a[1], b[1])); z <= binZ(Math.max(a[1], b[1])); z++)
          for (let x = binX(Math.min(a[0], b[0])); x <= binX(Math.max(a[0], b[0])); x++) boundaryBins.add(z * GRID_SIZE + x);
      }
      for (let z = binZ(entry.bounds[1]); z <= binZ(entry.bounds[3]); z++) for (let x = binX(entry.bounds[0]); x <= binX(entry.bounds[2]); x++) {
        const index = z * GRID_SIZE + x, boundary = boundaryBins.has(index);
        if (boundary || insidePolygons(polygons, extent[0] + (x + .5) * width / GRID_SIZE, extent[1] + (z + .5) * depth / GRID_SIZE)) bins[index].push({entry, boundary});
      }
    }
    collection = null;
    const source = sourceMesh.geometry, sourcePosition = source.attributes.position, sourceNormal = source.attributes.normal, sourceUv = source.attributes.uv, sourceColor = source.attributes.color;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const weights = [0, 0, 0], sourceVertices = [0, 0, 0];
    function vertex(entry, x, z) {
      const key = `${Math.round(x * 1e7)}/${Math.round(z * 1e7)}`;
      if (entry.vertexMap.has(key)) return entry.vertexMap.get(key);
      const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      weights[0] = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / determinant;
      weights[1] = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / determinant;
      weights[2] = 1 - weights[0] - weights[1];
      const interpolate = (attribute, component) => weights.reduce((total, weight, i) => total + weight * attribute.array[sourceVertices[i] * attribute.itemSize + component], 0);
      const y = interpolate(sourcePosition, 1), nx = sourceNormal ? interpolate(sourceNormal, 0) : 0,
        ny = sourceNormal ? interpolate(sourceNormal, 1) : 1, nz = sourceNormal ? interpolate(sourceNormal, 2) : 0, n = Math.hypot(nx, ny, nz) || 1;
      if (![x, y, z, nx, ny, nz].every(Number.isFinite)) throw new Error('城市表面包含无效顶点。');
      const index = entry.positions.length / 3;
      entry.positions.push(x, y, z); entry.normals.push(nx / n, ny / n, nz / n); entry.uvs.push(interpolate(sourceUv, 0), interpolate(sourceUv, 1));
      if (sourceColor) entry.colors.push(interpolate(sourceColor, 0), interpolate(sourceColor, 1), interpolate(sourceColor, 2));
      entry.vertexMap.set(key, index); return index;
    }
    function triangle(entry, points) {
      let ids = points.map(p => vertex(entry, p[0], p[1]));
      const p = entry.positions, [i, j, k] = ids;
      const signedArea = (Math.fround(p[j * 3]) - Math.fround(p[i * 3])) * (Math.fround(p[k * 3 + 2]) - Math.fround(p[i * 3 + 2])) -
        (Math.fround(p[j * 3 + 2]) - Math.fround(p[i * 3 + 2])) * (Math.fround(p[k * 3]) - Math.fround(p[i * 3]));
      if (new Set(ids).size !== 3 || Math.abs(signedArea) < 1e-10) return;
      if (signedArea > 0) ids = [i, k, j];
      entry.indices.push(...ids);
      for (const [u, v] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
        const key = u < v ? `${u}/${v}` : `${v}/${u}`;
        if (entry.edges.has(key)) entry.edges.delete(key); else entry.edges.set(key, [u, v]);
      }
    }
    for (let offset = 0; offset < source.index.count; offset += 3) {
      if (offset % 9000 === 0) { active(); await pause(); active(); }
      for (let i = 0; i < 3; i++) sourceVertices[i] = source.index.getX(offset + i);
      a.fromBufferAttribute(sourcePosition, sourceVertices[0]); b.fromBufferAttribute(sourcePosition, sourceVertices[1]); c.fromBufferAttribute(sourcePosition, sourceVertices[2]);
      if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-10) continue;
      const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x), z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z), candidates = new Map();
      for (let z = binZ(z0); z <= binZ(z1); z++) for (let x = binX(x0); x <= binX(x1); x++)
        for (const candidate of bins[z * GRID_SIZE + x]) candidates.set(candidate.entry, (candidates.get(candidate.entry) || false) || candidate.boundary);
      const triangleRing = [[a.x, a.z], [b.x, b.z], [c.x, c.z], [a.x, a.z]];
      for (const [entry, boundary] of candidates) {
        if (!boundary) { triangle(entry, triangleRing.slice(0, 3)); diagnostics.copiedSourceTriangles++; continue; }
        if (entry.bounds[2] < x0 || entry.bounds[0] > x1 || entry.bounds[3] < z0 || entry.bounds[1] > z1) continue;
        // Reuse narrow real-polygon strips. Intersecting every boundary triangle
        // with all islands/vertices of a city repeats most clipping work.
        const firstRow = binZ(z0), lastRow = binZ(z1), stripKey = `${firstRow}/${lastRow}`;
        let strip = entry.clippingStrips.get(stripKey);
        if (!strip) {
          const lower = extent[1] + firstRow * depth / GRID_SIZE - 1e-5, upper = extent[1] + (lastRow + 1) * depth / GRID_SIZE + 1e-5;
          strip = polygonClipping.intersection(entry.polygons, [[[extent[0] - 1e-5, lower], [extent[2] + 1e-5, lower], [extent[2] + 1e-5, upper], [extent[0] - 1e-5, upper], [extent[0] - 1e-5, lower]]]);
          entry.clippingStrips.set(stripKey, strip);
        }
        const clipped = strip.length ? polygonClipping.intersection(strip, [triangleRing]) : [];
        for (const polygon of clipped) {
          const rings = polygon.map(r => r.slice(0, -1).map(p => new THREE.Vector2(...p))), points = rings.flat();
          for (const face of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) triangle(entry, face.map(i => [points[i].x, points[i].y]));
        }
        diagnostics.clippedSourceTriangles++;
      }
    }
    active();
    topMaterial = registerMaterial(new THREE.MeshStandardMaterial({color: '#bdcc9c', map: texture, vertexColors: !texture && !!sourceColor,
      roughness: .92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1}));
    skirtMaterial = registerMaterial(new THREE.MeshStandardMaterial({color: '#597a51', roughness: 1, side: THREE.DoubleSide}));
    hoverLineMaterial = registerMaterial(new THREE.LineBasicMaterial({color: '#365c38', transparent: true, opacity: .95}));
    baseLineMaterial = registerMaterial(new THREE.LineBasicMaterial({color: '#526044', transparent: true, opacity: .78}));
    const allLines = [], sharedEdges = new Set();
    for (const entry of entries) {
      active();
      if (!entry.indices.length) throw new Error(`“${entry.item.name}”未能生成贴合省份的表面。`);
      const topGeometry = registerGeometry(new THREE.BufferGeometry());
      topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(entry.positions, 3));
      topGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(entry.normals, 3));
      topGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(entry.uvs, 2));
      if (entry.colors.length) topGeometry.setAttribute('color', new THREE.Float32BufferAttribute(entry.colors, 3));
      topGeometry.setIndex(entry.indices); topGeometry.computeBoundingSphere();
      const top = new THREE.Mesh(topGeometry, topMaterial); top.name = `${entry.item.name} lifted terrain`; top.receiveShadow = true; top.renderOrder = 2;
      const cityGroup = new THREE.Group(); cityGroup.name = `${entry.item.name} hover`; cityGroup.visible = false; cityGroup.add(top); group.add(cityGroup);
      const skirt = [], skirtIndices = [], line = [], sourceBoundary = boundarySegments(entry.polygons);
      let discardedInternalEdges = 0;
      for (const [u, v] of entry.edges.values()) {
        const p = entry.positions, ai = u * 3, bi = v * 3, n = skirt.length / 3;
        const av = [p[ai], p[ai + 1], p[ai + 2]], bv = [p[bi], p[bi + 1], p[bi + 2]];
        // Clipped adjacent triangles can split a shared edge differently. Those
        // T-junction edges survive index cancellation, but are not city borders.
        // Validate against the actual clipped administrative rings (incl. holes).
        if (!onBoundary(sourceBoundary, (av[0] + bv[0]) / 2, (av[2] + bv[2]) / 2) ||
            !onBoundary(sourceBoundary, av[0], av[2]) || !onBoundary(sourceBoundary, bv[0], bv[2])) {
          discardedInternalEdges++; continue;
        }
        skirt.push(...av, ...bv, ...av, ...bv); skirtIndices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        line.push(...av, ...bv);
        const keys = [av, bv].map(point => point.map(number => Math.round(number * 1e6)).join('/')).sort(), key = keys.join('|');
        if (!sharedEdges.has(key)) { sharedEdges.add(key); allLines.push(...av, ...bv); }
      }
      const skirtGeometry = registerGeometry(new THREE.BufferGeometry());
      skirtGeometry.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3)); skirtGeometry.setIndex(skirtIndices);
      const skirtBase = skirtGeometry.attributes.position.array.slice();
      // Precompute stable outward normals with a non-zero skirt, then animate
      // only its upper edge; the lower edge stays on the province surface.
      for (let i = 0; i < skirt.length; i += 12) { skirtGeometry.attributes.position.array[i + 7] += diagnostics.liftHeight; skirtGeometry.attributes.position.array[i + 10] += diagnostics.liftHeight; }
      skirtGeometry.computeVertexNormals(); skirtGeometry.computeBoundingSphere();
      const skirtMesh = new THREE.Mesh(skirtGeometry, skirtMaterial); skirtMesh.frustumCulled = false; skirtMesh.name = `${entry.item.name} connecting skirt`; cityGroup.add(skirtMesh);
      const lineGeometry = registerGeometry(new THREE.BufferGeometry()); lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
      const outline = new THREE.LineSegments(lineGeometry, hoverLineMaterial); outline.renderOrder = 3; cityGroup.add(outline);
      Object.assign(entry, {group: cityGroup, top, skirt: skirtMesh, skirtBase, outline});
      diagnostics.triangleCount += entry.indices.length / 3;
      diagnostics.discardedInternalEdges += discardedInternalEdges;
      diagnostics.cities.push({id: entry.item.id, vertices: entry.positions.length / 3, triangles: entry.indices.length / 3, boundarySegments: line.length / 6, discardedInternalEdges});
      entry.positions = entry.normals = entry.uvs = entry.colors = entry.indices = null; entry.vertexMap.clear(); entry.edges.clear(); entry.clippingStrips.clear();
    }
    const lineGeometry = registerGeometry(new THREE.BufferGeometry()); lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(allLines, 3));
    defaultLines = new THREE.LineSegments(lineGeometry, baseLineMaterial); defaultLines.name = 'All 11 city boundary lines'; defaultLines.position.y = SURFACE_OFFSET + .004; defaultLines.renderOrder = 1; group.add(defaultLines);
    diagnostics.boundarySegments = allLines.length / 6; diagnostics.cityCount = cities.length; diagnostics.materialCount = materials.size;
    for (const geometry of geometries) { for (const attribute of Object.values(geometry.attributes)) diagnostics.geometryBytes += attribute.array.byteLength; diagnostics.geometryBytes += geometry.index?.array.byteLength || 0; }
    diagnostics.buildMs = performance.now() - started;
    function applyLift() {
      if (!hovered) return;
      hovered.top.position.y = hoverLift + SURFACE_OFFSET; hovered.outline.position.y = hoverLift + SURFACE_OFFSET + .01;
      const positions = hovered.skirt.geometry.attributes.position;
      for (let i = 0; i < positions.array.length; i += 12) {
        for (const offset of [1, 4]) positions.array[i + offset] = hovered.skirtBase[i + offset] + SURFACE_OFFSET;
        for (const offset of [7, 10]) positions.array[i + offset] = hovered.skirtBase[i + offset] + SURFACE_OFFSET + hoverLift;
      }
      positions.needsUpdate = true; diagnostics.lift = hoverLift;
    }
    function setHovered(id) {
      if (diagnostics.disposed) return;
      const next = entries.find(entry => entry.item.id === id || entry.item.boundaryId === id) || null;
      if (next === hovered) return;
      if (hovered) hovered.group.visible = false;
      hovered = next; hoverLift = reducedMotion && next ? diagnostics.liftHeight : 0;
      if (hovered) { hovered.group.visible = true; applyLift(); }
      diagnostics.hoveredId = hovered?.item.id || null; diagnostics.visibleCityCount = hovered ? 1 : 0; diagnostics.lift = hoverLift;
      onHover(hovered?.item || null);
    }
    function update(deltaSeconds = 0) {
      if (diagnostics.disposed || !hovered) return;
      // Bounded, monotonic ease; no overshoot or spring motion.
      hoverLift = reducedMotion ? diagnostics.liftHeight : THREE.MathUtils.lerp(hoverLift, diagnostics.liftHeight, 1 - Math.exp(-12 * THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, .1)));
      if (diagnostics.liftHeight - hoverLift < .0001) hoverLift = diagnostics.liftHeight;
      applyLift();
    }
    const hitTest = lnglat => {
      if (diagnostics.disposed || !containsCoordinate(region, lnglat)) return null;
      return entries.find(entry => containsCoordinate(entry.feature, lnglat))?.item || null;
    };
    active();
    return {group, cities, hitTest, setHovered, update, dispose, diagnostics,
      setReducedMotion(value) { reducedMotion = !!value; if (reducedMotion && hovered) { hoverLift = diagnostics.liftHeight; applyLift(); } }};
  } catch (error) { dispose(); throw error; }
}
