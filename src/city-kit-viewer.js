import {createCityReflectionEnvironment} from './city-reflection-environment.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadCityAssets, createCityAssetMaterials} from './city-assets.js';

const canvas = document.querySelector('#canvas');
const main = canvas.closest('main');
const list = document.querySelector('#list');
const detail = document.querySelector('#detail');
const status = document.querySelector('#status');
const labels = document.querySelector('#labels');
const tabs = [...document.querySelectorAll('[data-family]')];
const lifetime = new AbortController();
const ownedMaterials = new Set(), ownedGeometries = new Set();
const ownedShadows = new Set();
const models = new Map(), labelNodes = new Map(), listNodes = new Map();
let kit = null, scene = null, renderer = null, camera = null, controls = null, observer = null;
let entries = [], family = 'all', selectedId = null, destroyed = false, frame = 0, dirty = true, tween = null;
let selectedFrame = null, pointerStart = null, reflectionEnvironment=null;
const familyNames = {residential: '住宅', commercial: '商用', industrial: '工业', generic: '街坊', tree: '树木', road: '道路组件'};
const cameraDirection = new THREE.Vector3(1, 1.04, 1.35).normalize();
const diagnostics = {ready: false, destroyed: false, state: 'loading', entries: 0, visible: 0, family: 'all', selectedId: null, kitVersion: null, errors: []};
const api = {ready: false, diagnostics, scene: null, camera: null, renderer: null,
  setFamily, select: id => select(id, true), resetView: () => overview(true), destroy};
window.__cityKit = api;
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', '共享城市资产三维图库，拖动旋转，滚轮缩放，点击模型或左侧列表查看详情');
status.setAttribute('role', 'status');
for (const tab of tabs) tab.disabled = true;

const material = options => { const value = new THREE.MeshStandardMaterial(options); ownedMaterials.add(value); return value; };
const ownGeometry = value => { ownedGeometries.add(value); return value; };
const node = (tag, text, className) => { const value = document.createElement(tag); if (text != null) value.textContent = text; if (className) value.className = className; return value; };
const visibleEntries = () => entries.filter(entry => family === 'all' || entry.section === family);
const format = value => Number(value.toFixed(2)).toString();

function dimensionText(bounds) {
  return bounds.max.map((value, axis) => format(value - bounds.min[axis])).join(' × ');
}

function resize() {
  if (!renderer || destroyed) return;
  const width = Math.max(main.clientWidth, 1), height = Math.max(main.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height; camera.updateProjectionMatrix();
  dirty = true;
}

function viewTo(target, distance, animate) {
  const position = target.clone().addScaledVector(cameraDirection, distance);
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tween = {start: performance.now(), from: camera.position.clone(), targetFrom: controls.target.clone(), to: position, target};
  } else {
    tween = null; camera.position.copy(position); controls.target.copy(target); controls.update();
  }
  dirty = true;
}

function overview(animate = false) {
  if (!camera || !entries.length) return;
  const visible = visibleEntries(), bounds = new THREE.Box3();
  for (const entry of visible) bounds.expandByObject(models.get(entry.id).group);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  center.y = Math.max(.35, center.y * .48);
  const extent = bounds.getSize(new THREE.Vector3());
  // Fit both the width and depth of an oblique grid with comfortable label room.
  const distance = Math.max(5.4, Math.max(extent.x / Math.max(camera.aspect, .65), extent.z * .95) * 1.95 + extent.y * .6);
  controls.maxDistance = Math.max(28, distance * 1.5);
  viewTo(center, distance, animate);
  status.textContent = `${kit.version} · ${visible.length}个固定模型 · 选择模型查看尺寸与下载`;
}

function populateList() {
  list.replaceChildren(); listNodes.clear();
  for (const entry of visibleEntries()) {
    const button = node('button'); button.type = 'button';
    button.append(node('span', entry.name), node('small', familyNames[entry.family]));
    button.setAttribute('aria-pressed', String(entry.id === selectedId));
    button.classList.toggle('active', entry.id === selectedId);
    // Buttons are discarded together with their direct handlers on a new filter.
    button.addEventListener('click', () => select(entry.id, true));
    list.append(button); listNodes.set(entry.id, button);
  }
}

function showDetail(entry) {
  detail.replaceChildren();
  detail.append(node('strong', entry.name), node('p', `${familyNames[entry.family]} · ${entry.triangles}个三角面`));
  const dimensions = entry.section === 'trees'
    ? `组合尺寸（宽 × 高 × 深）：${dimensionText(entry.bounds)}`
    : `标准包络（宽 × 高 × 深）：${dimensionText(entry.bounds)}`;
  detail.append(node('p', dimensions));
  if (entry.previewRatios) detail.append(node('p', `当前预览：高/宽 ${format(entry.previewRatios.height)}，深/宽 ${format(entry.previewRatios.depth)}。这里展示资产预览比例，城市中会按选定建筑基准调整显示尺度。`));
  detail.append(node('p', entry.description));
  const download = node('a', '下载此模型 · GLB', 'download');
  download.href = entry.glbUrl;
  download.download = entry.glbFile;
  download.setAttribute('aria-label', `下载${entry.name}的GLB模型`);
  detail.append(download);
  if (entry.jsonUrl) {
    const json = node('a', '几何数据 · JSON', 'download');
    json.href = entry.jsonUrl; json.download = entry.jsonFile;
    detail.append(json);
  }
  detail.append(node('code', entry.id));
}

function select(id, focus = false) {
  if (destroyed || !api.ready) return false;
  const entry = entries.find(item => item.id === id);
  if (!entry) return false;
  if (family !== 'all' && entry.section !== family) setFamily(entry.section);
  selectedId = id; diagnostics.selectedId = id;
  for (const [key, button] of listNodes) {
    button.classList.toggle('active', key === id); button.setAttribute('aria-pressed', String(key === id));
  }
  for (const [key, label] of labelNodes) {
    label.style.background = key === id ? '#2e5946' : '#eeede5ed';
    label.style.color = key === id ? '#fff9e9' : '#3c5848';
  }
  const model = models.get(id);
  selectedFrame.visible = true;
  selectedFrame.position.set(model.group.position.x, -.015, model.group.position.z);
  selectedFrame.scale.set(model.extent.x + .26, 1, model.extent.z + .26);
  showDetail(entry);
  if (focus) {
    const target = model.group.position.clone().add(new THREE.Vector3(0, model.extent.y * .46, 0));
    const distance = Math.max(4.3, model.extent.y * 2.4, model.extent.x * 2.2 / Math.max(camera.aspect, .65));
    viewTo(target, distance, true);
    status.textContent = `${entry.name} · 点击上方家族按钮返回排列总览`;
  }
  dirty = true;
  return true;
}

function setFamily(value) {
  if (!['all', 'buildings', 'trees', 'roads'].includes(value) || !api.ready || destroyed) return false;
  family = value; diagnostics.family = value;
  const visible = visibleEntries();
  const columns = Math.min(4, visible.length), gapX = 3.15, gapZ = 3.25;
  const rows = Math.ceil(visible.length / columns);
  for (const [id, model] of models) {
    model.group.visible = visible.some(entry => entry.id === id);
    labelNodes.get(id).hidden = !model.group.visible;
  }
  visible.forEach((entry, i) => {
    const group = models.get(entry.id).group;
    group.position.set((i % columns - (columns - 1) / 2) * gapX, 0, (Math.floor(i / columns) - (rows - 1) / 2) * gapZ);
    group.updateMatrixWorld(true);
  });
  diagnostics.visible = visible.length;
  if (!visible.some(entry => entry.id === selectedId)) selectedId = visible[0]?.id ?? null;
  for (const tab of tabs) {
    const active = tab.dataset.family === value;
    tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active));
  }
  populateList();
  if (selectedId) select(selectedId, false);
  renderer.shadowMap.needsUpdate = true;
  overview(false);
  return true;
}

function updateLabels() {
  const width = main.clientWidth, height = main.clientHeight;
  const point = new THREE.Vector3();
  for (const entry of entries) {
    const model = models.get(entry.id), label = labelNodes.get(entry.id);
    if (!model.group.visible) { label.hidden = true; continue; }
    point.copy(model.group.position).add(new THREE.Vector3(0, .035, model.extent.z / 2 + .24)).project(camera);
    const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
    label.hidden = point.z < -1 || point.z > 1 || x < 10 || x > width - 10 || y < 62 || y > height - 43;
    label.style.left = `${x}px`; label.style.top = `${y}px`;
  }
}

function tick(now) {
  if (destroyed) return;
  frame = requestAnimationFrame(tick);
  if (document.hidden || !renderer) return;
  if (tween) {
    const t = Math.min(1, (now - tween.start) / 480), eased = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(tween.from, tween.to, eased);
    controls.target.lerpVectors(tween.targetFrom, tween.target, eased);
    if (t === 1) tween = null;
    dirty = true;
  }
  controls.update();
  if (dirty) { renderer.render(scene, camera); updateLabels(); dirty = false; }
}

function pick(event) {
  if (!pointerStart || event.pointerId !== pointerStart.id) return;
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  pointerStart = null;
  if (moved > 5 || !api.ready) return;
  const rect = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
  const hit = ray.intersectObjects(visibleEntries().map(entry => models.get(entry.id).group), true)[0];
  if (!hit) return;
  let object = hit.object;
  while (object && !object.userData.cityGalleryId) object = object.parent;
  if (object) select(object.userData.cityGalleryId, true);
}

function destroy() {
  if (destroyed) return;
  destroyed = true; api.ready = diagnostics.ready = false;
  diagnostics.destroyed = true; diagnostics.state = 'disposed';
  lifetime.abort(); cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose();
  // Models only reference shared kit buffers. Only the kit releases them.
  if(scene)scene.environment=null;reflectionEnvironment?.dispose();reflectionEnvironment=null;scene?.clear(); kit?.dispose(); kit = null;
  for (const value of ownedGeometries) value.dispose();
  for (const value of ownedMaterials) value.dispose();
  for (const value of ownedShadows) value.dispose();
  ownedGeometries.clear(); ownedMaterials.clear();
  ownedShadows.clear();
  renderer?.dispose(); renderer?.forceContextLoss();
  renderer = camera = controls = scene = selectedFrame = observer = null;
  api.renderer = api.camera = api.scene = null;
  entries = []; models.clear(); labelNodes.clear(); listNodes.clear();
  list.replaceChildren(); labels.replaceChildren(); tween = pointerStart = null;
}

window.addEventListener('pagehide', destroy, {once: true});
window.addEventListener('pageshow', event => { if (event.persisted && destroyed) location.reload(); });

async function start() {
  try {
    kit = await loadCityAssets({signal: lifetime.signal});
    if (destroyed) return;
    renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    scene = new THREE.Scene(); scene.background = new THREE.Color('#eeede5');reflectionEnvironment=createCityReflectionEnvironment(renderer);scene.environment=reflectionEnvironment.texture;scene.environmentIntensity=.55;
    camera = new THREE.PerspectiveCamera(35, 1, .05, 120);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.minDistance = 2.8; controls.maxDistance = 35;
    controls.minPolarAngle = .18; controls.maxPolarAngle = Math.PI / 2 - .045;
    controls.addEventListener('change', () => { dirty = true; });
    controls.addEventListener('start', () => { tween = null; });
    scene.add(new THREE.HemisphereLight('#fff9ea', '#8a9988', 1.65));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.5);
    ownedShadows.add(sun.shadow);
    sun.position.set(-8, 16, 9); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {left: -11, right: 11, top: 11, bottom: -11, near: .5, far: 45});
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .003;
    scene.add(sun);
    const floor = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(80, 80)), material({color: '#e8e7dc', roughness: 1}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.04; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(24, 24, '#bec7b6', '#d4d9ca'); grid.position.y = -.032;
    ownGeometry(grid.geometry);
    for (const value of [grid.material].flat()) { value.transparent = true; value.opacity = .48; ownedMaterials.add(value); }
    scene.add(grid);
    const outline = ownGeometry(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, 0, -.5), new THREE.Vector3(.5, 0, .5), new THREE.Vector3(-.5, 0, .5),
    ]));
    const lineMaterial = new THREE.LineBasicMaterial({color: '#b18b53'}); ownedMaterials.add(lineMaterial);
    selectedFrame = new THREE.LineLoop(outline, lineMaterial); selectedFrame.visible = false; scene.add(selectedFrame);
    const buildingMaterial=createCityAssetMaterials();for(const m of buildingMaterial)ownedMaterials.add(m);
    for (const items of Object.values(kit.buildings)) for (const item of items) {
      const group = new THREE.Group(), mesh = new THREE.Mesh(item.geometry, buildingMaterial);
      const width = item.family === 'industrial' ? 1.95 : 1.65;
      const ratio = item.previewHeightToWidth ?? item.recommendedHeightToWidth.reduce((sum, value) => sum + value, 0) / 2;
      const depthRatio = item.recommendedDepthToWidth.reduce((sum, value) => sum + value, 0) / 2;
      mesh.scale.set(width, width * ratio, width * depthRatio); mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      entries.push({id: item.id, name: item.name, family: item.family, section: 'buildings',
        bounds: item.bounds, triangles: item.triangles, glbUrl: item.downloads.glb, glbFile: item.glb.file,
        previewRatios: {height: ratio, depth: depthRatio},
        jsonUrl: item.downloads.json, jsonFile: item.file,
        description: item.displayUnit === 'compound' ? `完整街区组合，含${item.buildingCount}栋主体建筑。内部${({garden:'庭院',plaza:'广场',yard:'装卸院落'})[item.sharedSpace] ?? '公共空间'}为示意布局，不代表实测地块。城市中按整块足迹放置。` : '底部为完整承台，最高实体为1。预览按建筑类型显示比例；城市中可独立设置宽、高、深。通用模型，不对应某栋实测建筑。'});
      models.set(item.id, {group});
    }
    const materialByColour = new Map();
    for (const preset of kit.presets) {
      const group = new THREE.Group(); let triangles = 0;
      for (const part of preset.recipe) {
        const asset = kit.assets[part.asset];
        if (!materialByColour.has(part.color)) materialByColour.set(part.color, material({color: part.color, vertexColors: true, roughness: .86}));
        const mesh = new THREE.Mesh(asset.geometry, materialByColour.get(part.color));
        mesh.position.fromArray(part.position); mesh.scale.fromArray(part.scale);
        mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); triangles += asset.triangles;
      }
      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group);
      entries.push({id: preset.id, name: preset.name, family: 'tree', section: 'trees', triangles,
        bounds: {min: bounds.min.toArray(), max: bounds.max.toArray()},
        glbUrl: new URL(`../assets/city-kit/v1/${preset.glb.file}`, import.meta.url).href, glbFile: preset.glb.file,
        description: '树干与树冠使用同一套组件组合，完整GLB与此组合一致。城市中仍可分别调整组件，使树干与坡面正确接触。'});
      group.scale.setScalar(1.3); models.set(preset.id, {group});
    }
    const roadMaterial=material({color:'#ffffff',vertexColors:true,roughness:.85});
    for (const item of Object.values(kit.roads)) {
      const group = new THREE.Group(), mesh = new THREE.Mesh(item.geometry, roadMaterial);
      mesh.scale.fromArray(item.variant === 'deck' ? [2.1, .16, 1.45] : [.5, 1.55, .5]);
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
      entries.push({id: item.id, name: item.name, family: 'road', section: 'roads', bounds: item.bounds,
        triangles: item.triangles, glbUrl: item.downloads.glb, glbFile: item.glb.file, jsonUrl: item.downloads.json, jsonFile: item.file,
        description: '单位闭合实体组件，预览展示一种长宽高比例。道路走向、桥梁位置与实际尺寸由城市真实路网提供。'});
      models.set(item.id, {group});
    }
    for (const entry of entries) {
      const model = models.get(entry.id); model.group.userData.cityGalleryId = entry.id;
      model.group.updateMatrixWorld(true);
      model.extent = new THREE.Box3().setFromObject(model.group).getSize(new THREE.Vector3());
      scene.add(model.group);
      const label = node('div', entry.name, 'label'); labels.append(label); labelNodes.set(entry.id, label);
    }
    canvas.addEventListener('pointerdown', event => { pointerStart = {id: event.pointerId, x: event.clientX, y: event.clientY}; }, {signal: lifetime.signal});
    canvas.addEventListener('pointerup', pick, {signal: lifetime.signal});
    canvas.addEventListener('pointercancel', () => { pointerStart = null; }, {signal: lifetime.signal});
    for (const tab of tabs) {
      tab.disabled = false;
      tab.addEventListener('click', () => setFamily(tab.dataset.family), {signal: lifetime.signal});
    }
    observer = new ResizeObserver(resize); observer.observe(main); resize();
    Object.assign(diagnostics, {ready: true, state: 'ready', entries: entries.length, kitVersion: kit.version,
      kitFingerprint: kit.fingerprint, sourceGeometries: kit.diagnostics.assets,
      sharedGeometry: true, generatedThumbnails: false,
      familyCounts:Object.fromEntries(['buildings','trees','roads'].map(section=>[section,entries.filter(entry=>entry.section===section).length]))});
    api.scene = scene; api.camera = camera; api.renderer = renderer; api.ready = true;
    setFamily('all'); frame = requestAnimationFrame(tick);
  } catch (error) {
    if (destroyed) return;
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.errors.push(message); destroy();
    diagnostics.state = 'error';
    status.textContent = '资产图库暂时无法展开';
    detail.replaceChildren(node('p', message), node('p', '请通过本地HTTP预览服务打开此页面。'));
    console.error('City kit viewer:', error);
  }
}

start();
