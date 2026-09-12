import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createRegionProjection} from './region-projection.js';
import {createRegionTerrain} from './region-terrain.js';
import {loadCityAssets, createCityAssetMaterials} from './city-assets.js';
import {createCityReflectionEnvironment} from './city-reflection-environment.js';

const cancelled = () => new DOMException('City plan viewer cancelled.', 'AbortError');
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const coordinate = value => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) < 85;
const positive = value => Number.isFinite(value) && value > 0;

/** Sample the triangles actually shown, rather than the finer DEM underneath.
 * A regular spatial index keeps footprint and ribbon sampling inexpensive. */
function renderedSurfaceSampler(mesh, fallback) {
  const geometry = mesh.geometry, positions = geometry.attributes.position.array, index = geometry.index.array;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox, size = 128, bins = Array.from({length: size * size}, () => []);
  const bx = x => Math.max(0, Math.min(size - 1, Math.floor((x - bounds.min.x) / (bounds.max.x - bounds.min.x) * size)));
  const bz = z => Math.max(0, Math.min(size - 1, Math.floor((z - bounds.min.z) / (bounds.max.z - bounds.min.z) * size)));
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const x0 = bx(Math.min(positions[a], positions[b], positions[c])), x1 = bx(Math.max(positions[a], positions[b], positions[c]));
    const z0 = bz(Math.min(positions[a + 2], positions[b + 2], positions[c + 2])), z1 = bz(Math.max(positions[a + 2], positions[b + 2], positions[c + 2]));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) bins[z * size + x].push(i);
  }
  return (x, z) => {
    for (const i of bins[bz(z) * size + bx(x)]) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
      const ax = positions[a], az = positions[a + 2], bx = positions[b], bz = positions[b + 2], cx = positions[c], cz = positions[c + 2];
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(denominator) < 1e-15) continue;
      const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
      const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator, wc = 1 - wa - wb;
      if (wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6) return wa * positions[a + 1] + wb * positions[b + 1] + wc * positions[c + 1];
    }
    return fallback(x, z);
  };
}

/** Render one data-derived city-build-plan-v1. Every resource belongs to this
 * invocation; no municipal styling, fabricated objects, or global asset cache. */
export async function createCityPlanViewer({container, plan, signal, onStatus = () => {}}) {
  if (!container?.append || plan?.schema !== 'city-build-plan-v1') throw new Error('需要容器和 city-build-plan-v1 方案');
  signal?.throwIfAborted();
  const projection = createRegionProjection(plan.boundary), unit = projection.metersToUnits;
  const controller = new AbortController(), ownedGeometry = new Set(), ownedMaterial = new Set(), ownedShadow = new Set(), ownedInstances = new Set();
  const diagnostics = {ready: false, renderReady: false, state: 'loading', destroyed: false, finite: true,
    counts: {buildings: 0, roads: 0, roadSegments: 0, bridges: 0, bridgePiers: 0, water: 0, green: 0, trees: 0, landmarks: 0},
    planned: Object.fromEntries(['buildings', 'roads', 'water', 'green', 'trees', 'landmarks'].map(key => [key, plan[key]?.length || 0])),
    supportComputed: 0, supportViolations: 0, groundedBuildings: 0, supportSkirts: 0, maxSupportMeters: 0,
    skipped: [], warnings: [], regionalTerrain: null,
    coverage: plan.provenance?.inputs?.filter(input => input.coverage).map(input => ({sourceId: input.id, ...input.coverage})) ?? plan.provenance?.coverage ?? plan.sourceCoverage ?? null,
    waterSupport: [], waterElevationMethod: 'Median shoreline elevation sampled from the displayed measured terrain; reject shoreline relief above 2 m.'};
  let terrain = null, kit = null, renderer = null, scene = null, camera = null, controls = null, environment = null, observer = null;
  let frame = 0, destroyed = false, labelsVisible = true, dirty = true, tween = null, sampleSurface = null;
  const landmarkPositions = new Map(), labelNodes = new Map();
  const canvas = document.createElement('canvas'), labels = document.createElement('div');
  canvas.className = 'city-plan-canvas'; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '城市方案三维预览，拖动旋转，滚轮缩放，右键拖动平移');
  labels.className = 'city-plan-labels'; container.append(canvas, labels);
  const assertActive = () => { if (destroyed || controller.signal.aborted) throw cancelled(); };
  const status = (state, message) => { if (!destroyed) { diagnostics.state = state; onStatus({state, message, diagnostics}); } };
  const ownGeometry = value => { ownedGeometry.add(value); return value; };
  const material = options => { const value = new THREE.MeshStandardMaterial(options); ownedMaterial.add(value); return value; };
  const skip = (kind, item, reason) => { diagnostics.skipped.push({kind, id: item.id ?? null, sourceId: item.sourceId ?? null, reason}); };
  const listeners = new AbortController();

  function destroy() {
    if (destroyed) return;
    destroyed = true; diagnostics.ready = diagnostics.renderReady = false; diagnostics.destroyed = true; diagnostics.state = 'disposed';
    signal?.removeEventListener('abort', destroy); controller.abort(); listeners.abort();
    cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose();
    if (scene) scene.environment = null;
    environment?.dispose(); terrain?.dispose(); kit?.dispose(); scene?.clear();
    for (const mesh of ownedInstances) mesh.dispose();
    for (const geometry of ownedGeometry) geometry.dispose();
    for (const value of ownedMaterial) value.dispose();
    for (const value of ownedShadow) value.dispose();
    ownedGeometry.clear(); ownedMaterial.clear(); ownedShadow.clear(); ownedInstances.clear();
    renderer?.dispose(); renderer?.forceContextLoss(); canvas.remove(); labels.remove();
    landmarkPositions.clear(); labelNodes.clear(); sampleSurface = null; tween = null;
    renderer = scene = camera = controls = environment = terrain = kit = observer = null;
  }
  signal?.addEventListener('abort', destroy, {once: true});

  function resize() {
    if (destroyed || !renderer) return;
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); dirty = true;
  }
  function moveTo(point, distance, animate = true) {
    if (destroyed || !controls) return;
    const target = point.clone(), position = target.clone().addScaledVector(new THREE.Vector3(.45, .87, 1.05).normalize(), distance);
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) tween = {from: camera.position.clone(), fromTarget: controls.target.clone(), position, target, start: performance.now()};
    else { tween = null; camera.position.copy(position); controls.target.copy(target); controls.update(); }
    diagnostics.view = {target: target.toArray(), distance}; dirty = true;
  }
  function resetView() {
    if (destroyed || !terrain) return;
    const bounds = new THREE.Box3().setFromObject(terrain.group), center = bounds.getCenter(new THREE.Vector3()), extent = bounds.getSize(new THREE.Vector3());
    center.y = Math.max(0, center.y);
    moveTo(center, Math.max(extent.x / Math.max(camera.aspect, .6), extent.z) * 1.68 + 7);
    diagnostics.activeLandmark = null;
  }
  function focusAttraction(id) {
    if (destroyed || !terrain) return false;
    const landmark = (plan.landmarks || []).find(item => item.id === id);
    const raw = id === 'focus' ? plan.display?.focus : landmark?.coordinate ?? landmark?.coordinates;
    if (!coordinate(raw)) return false;
    const point = projection.project(raw); point.y = sampleSurface(point.x, point.z);
    const distanceMeters = id === 'focus' ? plan.display?.focusDistanceMeters : landmark?.focusDistanceMeters ?? plan.display?.focusDistanceMeters * .35;
    moveTo(point, Math.max(650 * unit, positive(distanceMeters) ? distanceMeters * unit : 4000 * unit));
    diagnostics.activeLandmark = id;
    for (const [key, label] of labelNodes) label.classList.toggle('selected', key === id);
    return true;
  }
  function setLabels(value) { labelsVisible = !!value; labels.hidden = !labelsVisible; dirty = true; }
  function updateLabels() {
    if (!labelsVisible) return;
    const width = container.clientWidth, height = container.clientHeight, accepted = [];
    for (const [id, point] of landmarkPositions) {
      const p = point.clone().project(camera), x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2;
      const node = labelNodes.get(id), left = x - 55, right = x + 55;
      const hidden = p.z < -1 || p.z > 1 || x < 45 || x > width - 45 || y < 25 || y > height - 35 || accepted.some(box => left < box.right && right > box.left && Math.abs(y - box.y) < 30);
      node.hidden = hidden;
      if (!hidden) { node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -120%)`; accepted.push({left, right, y}); }
    }
  }
  function tick(now) {
    if (destroyed) return;
    frame = requestAnimationFrame(tick);
    if (document.hidden) return;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / 600), ease = 1 - (1 - t) ** 3;
      camera.position.lerpVectors(tween.from, tween.position, ease); controls.target.lerpVectors(tween.fromTarget, tween.target, ease);
      if (t === 1) tween = null; dirty = true;
    }
    controls.update();
    if (dirty) { renderer.render(scene, camera); updateLabels(); dirty = false; }
  }
  const api = {diagnostics, focusAttraction, resetView, setLabels, resize, destroy};

  function bufferMesh(positions, mat, name) {
    if (!positions.length) return null;
    if (!positions.every(Number.isFinite)) { diagnostics.finite = false; throw new Error(`${name} 出现非有限坐标`); }
    const geometry = ownGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, mat); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  }
  const triangle = (out, a, b, c) => out.push(...a, ...b, ...c);
  const quad = (out, a, b, c, d) => { triangle(out, a, b, c); triangle(out, a, c, d); };
  function densify(points, spacing) {
    const result = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
      for (let j = 0; j < steps; j++) { const t = j / steps; result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (points.length) result.push(points.at(-1)); return result;
  }
  function ringsOf(item) {
    if (!Array.isArray(item.rings) || !item.rings.length || item.rings.some(ring => ring.length < 4 || ring.some(c => !coordinate(c)))) throw new Error('多边形缺少有效 WGS84 闭合环');
    return item.rings.map(ring => ring.map(c => { const p = projection.project(c); return [p.x, p.z]; }));
  }

  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    scene = new THREE.Scene(); scene.background = new THREE.Color('#edf0eb');
    camera = new THREE.PerspectiveCamera(36, 1, Math.max(.0002, unit * 2), 180);
    controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
    controls.minDistance = 180 * unit; controls.maxDistance = 160; controls.maxPolarAngle = Math.PI / 2 - .055;
    controls.addEventListener('change', () => { dirty = true; }); controls.addEventListener('start', () => { tween = null; });
    scene.add(new THREE.HemisphereLight('#fffbed', '#718678', 2));
    const sun = new THREE.DirectionalLight('#fff0d8', 2.7); sun.position.set(-14, 30, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left: -23, right: 23, top: 23, bottom: -23, near: .5, far: 90});
    sun.shadow.bias = -.00003; sun.shadow.normalBias = unit * .15; ownedShadow.add(sun.shadow); scene.add(sun);
    environment = createCityReflectionEnvironment(renderer); scene.environment = environment.texture; scene.environmentIntensity = .5;
    observer = new ResizeObserver(resize); observer.observe(container); resize();
    status('loading', '读取真实高程与共享建筑资产…');
    // Each late result explicitly checks lifetime and disposes itself. A sibling
    // rejection aborts both producers through the outer cleanup.
    await Promise.all([
      createRegionTerrain({region: plan.boundary, projection, kind: 'city', heightExaggeration: 1, signal: controller.signal,
        onProgress: info => status('loading', `${info.message} ${info.completed}/${info.total}`)}).then(value => { if (destroyed) { value.dispose(); throw cancelled(); } terrain = value; }),
      loadCityAssets({signal: controller.signal}).then(value => { if (destroyed) { value.dispose(); throw cancelled(); } kit = value; }),
    ]);
    assertActive(); scene.add(terrain.group); diagnostics.regionalTerrain = terrain.diagnostics; diagnostics.kitVersion = kit.version;
    const unmodifiedSurface = renderedSurfaceSampler(terrain.terrainMesh, (x, z) => terrain.sampleHeight(projection.unproject(x, z)) * unit);
    const waterItems = [], waterLevels = new Map();
    for (const item of plan.water || []) {
      try {
        const rings = ringsOf(item), samples = rings.flatMap(ring => densify(ring, 30 * unit).map(([x, z]) => unmodifiedSurface(x, z) / unit));
        if (!samples.length || !samples.every(Number.isFinite)) throw new Error('水域岸线缺少有效地表高程');
        samples.sort((a, b) => a - b);
        const shorelineReliefMeters = samples.at(-1) - samples[0], levelMeters = samples[Math.floor(samples.length / 2)];
        if (shorelineReliefMeters > 2) throw new Error(`显示地表岸线高差 ${shorelineReliefMeters.toFixed(2)} m 超过 2 m；需要更细地形或实测水位，暂不绘制`);
        waterLevels.set(item.id, levelMeters); waterItems.push(item);
        diagnostics.waterSupport.push({id: item.id, sourceId: item.sourceId, levelMeters, shorelineReliefMeters, samples: samples.length});
      } catch (error) { if (error.name === 'AbortError') throw error; skip('water', item, error.message); }
    }
    const waterFeatures = {type: 'FeatureCollection', features: waterItems.map(item => ({type: 'Feature', properties: {waterLevelMeters: waterLevels.get(item.id)}, geometry: {type: 'Polygon', coordinates: item.rings}}))};
    if (waterItems.length) terrain.setWaterMask(waterFeatures);
    sampleSurface = renderedSurfaceSampler(terrain.terrainMesh, (x, z) => terrain.sampleSurfaceHeight(projection.unproject(x, z)) * unit);
    // A coarse terrain triangle can straddle a shoreline. Remove its covered
    // part before replacing the water surface, rather than float a water decal
    // above residual land. Keep the pre-cut surface sampler for support checks.
    if (waterItems.length) { status('loading', '沿水域真实轮廓裁切地表…'); await terrain.setSurfaceCutout(waterFeatures); assertActive(); }
    const buildingMaterials = createCityAssetMaterials({wallColour: '#d2d5d0', glassColour: '#a2b4b9'}); buildingMaterials.forEach(value => ownedMaterial.add(value));
    const supportMaterial = material({color: '#aeb6a5', roughness: .96, side: THREE.DoubleSide});
    const roadMaterial = material({color: '#7a827f', roughness: .87, side: THREE.DoubleSide});
    const bridgeMaterial = material({color: '#b1b7ad', roughness: .7, side: THREE.DoubleSide});
    const greenMaterial = material({color: '#9db782', roughness: .98, side: THREE.DoubleSide});
    const waterMaterial = material({color: '#6babb5', roughness: .25, metalness: .12, side: THREE.DoubleSide});
    const supportPositions = [], roadPositions = [], bridgePositions = [], pierPositions = [];
    const groups = new Map(), dummy = new THREE.Object3D();
    status('loading', '按真实位置安放建筑，并计算地形支撑…');
    let buildingIndex = 0;
    for (const item of plan.buildings || []) {
      assertActive();
      try {
        if (!coordinate(item.coordinate) || ![item.widthMeters, item.depthMeters, item.heightMeters].every(positive) || !Number.isFinite(item.rotation)) throw new Error('建筑坐标、尺寸或旋转无效');
        const asset = kit.assets[item.assetId]; if (!asset || asset.role !== 'ordinary-building') throw new Error(`建筑资产不存在：${item.assetId}`);
        const center = projection.project(item.coordinate), width = item.widthMeters * unit, depth = item.depthMeters * unit;
        const cos = Math.cos(item.rotation), sin = Math.sin(item.rotation);
        const point = (x, z) => [center.x + x * cos + z * sin, center.z - x * sin + z * cos];
        const corners = [[-.5, -.5], [-.5, .5], [.5, .5], [.5, -.5]].map(([x, z]) => point(x * width, z * depth));
        const perimeter = densify([...corners, corners[0]], Math.max(6 * unit, Math.min(width, depth) / 3));
        const samples = perimeter.map(([x, z]) => sampleSurface(x, z));
        for (const x of [-.5, 0, .5]) for (const z of [-.5, 0, .5]) samples.push(sampleSurface(...point(x * width, z * depth)));
        const max = Math.max(...samples), min = Math.min(...samples), supportMeters = (max - min) / unit;
        diagnostics.supportComputed++;
        if (!samples.every(Number.isFinite)) throw new Error('地形支撑包含无效高程');
        if (supportMeters > Math.min(12, Math.min(item.widthMeters, item.depthMeters) * .45)) throw new Error(`坡差 ${supportMeters.toFixed(1)} m 超出支撑阈值，需独立工程处理`);
        const base = max + .08 * unit;
        dummy.position.set(center.x, base, center.z); dummy.rotation.set(0, item.rotation, 0); dummy.scale.set(width, item.heightMeters * unit, depth); dummy.updateMatrix();
        if (!groups.has(asset.id)) groups.set(asset.id, {asset, matrices: [], identities: []});
        groups.get(asset.id).matrices.push(dummy.matrix.clone()); groups.get(asset.id).identities.push({id: item.id, sourceId: item.sourceId, supportMeters, baseElevationMeters: base / unit});
        for (let i = 0; i < perimeter.length - 1; i++) {
          const a = perimeter[i], b = perimeter[i + 1];
          quad(supportPositions, [a[0], sampleSurface(...a) - .08 * unit, a[1]], [b[0], sampleSurface(...b) - .08 * unit, b[1]], [b[0], base, b[1]], [a[0], base, a[1]]);
        }
        // The small level footing is closed on top and joined to the sampled
        // terrain along its entire perimeter; it is never a suspended slab.
        quad(supportPositions, ...corners.map(([x, z]) => [x, base, z]));
        diagnostics.counts.buildings++; diagnostics.groundedBuildings++; diagnostics.supportSkirts++;
        diagnostics.maxSupportMeters = Math.max(diagnostics.maxSupportMeters, supportMeters);
      } catch (error) { if (error.name === 'AbortError') throw error; skip('building', item, error.message); }
      if (++buildingIndex % 160 === 0) { await pause(); assertActive(); }
    }
    for (const {asset, matrices, identities} of groups.values()) {
      const mesh = new THREE.InstancedMesh(asset.geometry, buildingMaterials, matrices.length); mesh.name = `CityKit ${asset.id}`;
      ownedInstances.add(mesh);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.userData.sourceInstances = identities; mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    }
    bufferMesh(supportPositions, supportMaterial, 'Terrain-connected building support skirts');
    status('loading', '构建立体道路、水域和绿地…');
    let roadIndex = 0;
    for (const item of plan.roads || []) {
      assertActive();
      try {
        if (!Array.isArray(item.coordinates) || item.coordinates.length < 2 || item.coordinates.some(p => !coordinate(p)) || !positive(item.widthMeters)) throw new Error('道路坐标或宽度无效');
        const sourcePoints = item.coordinates.map(c => { const p = projection.project(c); return [p.x, p.z]; });
        const points = densify(sourcePoints, 35 * unit).filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-9);
        if (points.length < 2) throw new Error('道路长度为零');
        const half = item.widthMeters * unit / 2, topLift = (item.bridge ? 8 : .32) * unit, thickness = (item.bridge ? 1.2 : .5) * unit;
        const sections = points.map((p, i) => {
          const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const nx = -(b[1] - a[1]) / length * half, nz = (b[0] - a[0]) / length * half;
          const left = [p[0] + nx, p[1] + nz], right = [p[0] - nx, p[1] - nz];
          return {p, left, right, leftGround: sampleSurface(...left), rightGround: sampleSurface(...right)};
        });
        const bridgeLevel = item.bridge ? Math.max(...sections.flatMap(s => [s.leftGround, s.rightGround])) + topLift : null;
        const out = [];
        for (const s of sections) {
          const leftY = bridgeLevel ?? s.leftGround + topLift, rightY = bridgeLevel ?? s.rightGround + topLift;
          s.vertices = [[...s.left.slice(0, 1), leftY, s.left[1]], [s.right[0], rightY, s.right[1]], [s.right[0], rightY - thickness, s.right[1]], [s.left[0], leftY - thickness, s.left[1]]];
        }
        for (let i = 0; i < sections.length - 1; i++) {
          const a = sections[i], b = sections[i + 1], length = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
          if (!item.bridge && Math.abs(b.leftGround - a.leftGround) / length > .55) throw new Error('道路坡度超过 55%，需独立工程处理');
          for (let side = 0; side < 4; side++) quad(out, a.vertices[side], b.vertices[side], b.vertices[(side + 1) % 4], a.vertices[(side + 1) % 4]);
        }
        quad(out, ...sections[0].vertices); quad(out, ...sections.at(-1).vertices.slice().reverse());
        const destination = item.bridge ? bridgePositions : roadPositions;
        for (const value of out) destination.push(value);
        if (item.bridge) {
          for (let i = 1; i < sections.length - 1; i += 2) {
            const s = sections[i], ground = sampleSurface(...s.p), radius = Math.min(item.widthMeters * .16, 2.5) * unit;
            const top = bridgeLevel - thickness;
            const corners = [[s.p[0] - radius, s.p[1] - radius], [s.p[0] - radius, s.p[1] + radius], [s.p[0] + radius, s.p[1] + radius], [s.p[0] + radius, s.p[1] - radius]];
            for (let j = 0; j < 4; j++) { const a = corners[j], b = corners[(j + 1) % 4]; quad(pierPositions, [a[0], ground - .3 * unit, a[1]], [b[0], ground - .3 * unit, b[1]], [b[0], top, b[1]], [a[0], top, a[1]]); }
            diagnostics.counts.bridgePiers++;
          }
          diagnostics.counts.bridges++;
        }
        diagnostics.counts.roads++; diagnostics.counts.roadSegments += sections.length - 1;
      } catch (error) { if (error.name === 'AbortError') throw error; skip('road', item, error.message); }
      if (++roadIndex % 30 === 0) { await pause(); assertActive(); }
    }
    bufferMesh(roadPositions, roadMaterial, 'Volumetric terrain-following roads'); bufferMesh(bridgePositions, bridgeMaterial, 'Bridge decks'); bufferMesh(pierPositions, bridgeMaterial, 'Grounded bridge piers');

    async function makePolygons(items, kind, mat) {
      const out = [];
      for (const item of items) {
        assertActive();
        try {
          const rings = ringsOf(item), shapeRings = rings.map(ring => ring.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)));
          const vertices = shapeRings.flat(), triangles = THREE.ShapeUtils.triangulateShape(shapeRings[0], shapeRings.slice(1));
          if (!triangles.length) throw new Error('多边形不能生成三角面');
          const waterLevel = kind === 'water' ? waterLevels.get(item.id) * unit : null;
          const surface = (x, z) => kind === 'water' ? waterLevel + .12 * unit : sampleSurface(x, z) + .24 * unit;
          const local = [], maxEdge = (kind === 'water' ? 400 : 120) * unit;
          const emit = (a, b, c, depth = 0) => {
            const lengths = [[a, b, c], [b, c, a], [c, a, b]].map(points => ({points, length: points[0].distanceTo(points[1])})).sort((a, b) => b.length - a.length);
            if (lengths[0].length > maxEdge && depth < 12 && local.length < 600000) {
              const [p, q, r] = lengths[0].points, mid = p.clone().add(q).multiplyScalar(.5); emit(p, mid, r, depth + 1); emit(mid, q, r, depth + 1); return;
            }
            const points = [a, b, c].map(v => [v.x, surface(v.x, v.y), v.y]); triangle(local, ...points);
          };
          for (const face of triangles) emit(...face.map(i => vertices[i]));
          for (const ring of rings) {
            const points = densify(ring, 90 * unit);
            for (let i = 0; i < points.length - 1; i++) {
              const a = points[i], b = points[i + 1], ya = surface(...a), yb = surface(...b);
              const bottomA = kind === 'water' ? Math.min(ya - 1.5 * unit, sampleSurface(...a) - .2 * unit) : ya - .48 * unit;
              const bottomB = kind === 'water' ? Math.min(yb - 1.5 * unit, sampleSurface(...b) - .2 * unit) : yb - .48 * unit;
              quad(local, [a[0], bottomA, a[1]], [b[0], bottomB, b[1]], [b[0], yb, b[1]], [a[0], ya, a[1]]);
            }
          }
          for (const value of local) out.push(value); diagnostics.counts[kind]++;
        } catch (error) { if (error.name === 'AbortError') throw error; skip(kind, item, error.message); }
        await pause(); assertActive();
      }
      bufferMesh(out, mat, `Physical ${kind} polygons`);
    }
    await makePolygons(waterItems, 'water', waterMaterial); await makePolygons(plan.green || [], 'green', greenMaterial);

    const trees = [], crown = kit.trees.broadCrown, trunk = kit.trees.trunk;
    for (const item of plan.trees || []) {
      try {
        if (!coordinate(item.coordinate) || !positive(item.radiusMeters) || !positive(item.heightMeters)) throw new Error('树木坐标或尺寸无效');
        const p = projection.project(item.coordinate), ground = sampleSurface(p.x, p.z), trunkHeight = item.heightMeters * .52 * unit, crownHeight = item.heightMeters * .72 * unit;
        if (!Number.isFinite(ground)) throw new Error('树木缺少地面高程');
        trees.push({item, p, ground, trunkHeight, crownHeight});
      } catch (error) { if (error.name === 'AbortError') throw error; skip('tree', item, error.message); }
    }
    if (trees.length) {
      const trunkMesh = new THREE.InstancedMesh(trunk.geometry, material({color: '#897559', roughness: 1, vertexColors: true}), trees.length);
      const crownMesh = new THREE.InstancedMesh(crown.geometry, material({color: '#6f945d', roughness: .98, vertexColors: true}), trees.length);
      ownedInstances.add(trunkMesh); ownedInstances.add(crownMesh);
      trees.forEach(({item, p, ground, trunkHeight, crownHeight}, i) => {
        const radius = Math.max(.2, item.radiusMeters * .11) * unit;
        dummy.rotation.set(0, 0, 0); dummy.position.set(p.x, ground + trunkHeight / 2, p.z); dummy.scale.set(radius, trunkHeight, radius); dummy.updateMatrix(); trunkMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(p.x, ground + item.heightMeters * unit - crownHeight / 2, p.z); dummy.scale.set(item.radiusMeters * unit / crown.bounds.max[0], crownHeight / (crown.bounds.max[1] - crown.bounds.min[1]), item.radiusMeters * unit / crown.bounds.max[2]); dummy.updateMatrix(); crownMesh.setMatrixAt(i, dummy.matrix);
      });
      for (const mesh of [trunkMesh, crownMesh]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); }
      diagnostics.counts.trees = trees.length;
    }
    for (const landmark of plan.landmarks || []) {
      const raw = landmark.coordinate ?? landmark.coordinates;
      if (!coordinate(raw)) { skip('landmark', landmark, '景点坐标无效'); continue; }
      const p = projection.project(raw); p.y = sampleSurface(p.x, p.z);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'city-plan-label'; button.textContent = `${landmark.name ?? landmark.id} · 位置`;
      button.addEventListener('click', () => focusAttraction(landmark.id), {signal: listeners.signal}); labels.append(button);
      landmarkPositions.set(landmark.id, p); labelNodes.set(landmark.id, button); diagnostics.counts.landmarks++;
    }
    assertActive();
    diagnostics.warnings.push('建筑是共享风格资产，尺寸与位置来自方案；立面不代表实测建筑。');
    if (diagnostics.counts.landmarks) diagnostics.warnings.push('独立景点模型尚未制作；景点只显示屏幕位置标注。');
    if (diagnostics.skipped.length) diagnostics.warnings.push(`${diagnostics.skipped.length} 个对象因数据或地形约束未绘制，详见 diagnostics.skipped。`);
    if (!diagnostics.counts.buildings) diagnostics.warnings.push('没有可绘制的建筑；当前画面不能作为城市生成验收。');
    diagnostics.ready = diagnostics.renderReady = true;
    Object.assign(diagnostics, diagnostics.counts);
    diagnostics.renderedObjects = Object.values(diagnostics.counts).reduce((sum, n) => sum + n, 0);
    resetView(); if (coordinate(plan.display?.focus)) focusAttraction('focus'); tween = null;
    if (diagnostics.view) moveTo(new THREE.Vector3(...diagnostics.view.target), diagnostics.view.distance, false);
    renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); updateLabels();
    diagnostics.drawCalls = renderer.info.render.calls; diagnostics.triangles = renderer.info.render.triangles;
    frame = requestAnimationFrame(tick);
    status(diagnostics.skipped.length ? 'partial' : 'ready', `已呈现 ${diagnostics.counts.buildings} 栋建筑、${diagnostics.counts.roads} 条道路、${diagnostics.counts.trees} 棵树${diagnostics.skipped.length ? `；跳过 ${diagnostics.skipped.length} 个对象` : ''}`);
    return api;
  } catch (error) {
    const aborted = destroyed || signal?.aborted || error.name === 'AbortError';
    destroy();
    if (!aborted) { diagnostics.state = 'failed'; diagnostics.error = error.message; onStatus({state: 'failed', message: error.message, diagnostics}); }
    throw error;
  }
}
