import {createCityAssetMaterials} from './city-assets.js';
import {districtMassing,buildingPalette,BUILDING_PALETTES} from './hangzhou-district-massing.js';
import * as THREE from 'three';
import polygonClipping from '../vendor/polygon-clipping.js';
import {createLandFootprintGuard} from './hangzhou-footprint-guard.js';

// All centres and road alignments come from the supplied WGS84 data. Dimensions
// below are cartographic display dimensions, not surveyed tree/building heights.
const DEFAULTS = {
  displayScale: 1,
  maxTrees: 5000,
  maxUrbanGroups: 800,
  treeHeightMeters: [800, 1300],
  buildingFootprintMeters: [300, 600],
  roadWidthMeters: {motorway: 300, trunk: 260, primary: 220, secondary: 150},
  roadThicknessMeters: 70,
  curbHeightMeters: 12,
  showCurbs: false,
  roadSampleStepMeters: 600,
  roadSimplifyMeters: 60,
  secondaryRoadRadiusMeters: 4000,
  bridgeClearanceMeters: 100,
  bridgePierSpacingMeters: 600,
  landmarkClearanceMeters: 450,
  treeLandmarkClearanceMeters: 120,
  buildingLandmarkClearanceMeters: 180,
  landmarkDetailRadiusMeters: 3500,
  forestClusterMeters: 2400,
  ridgeSampleMeters: 850,
  ridgeTreeScale: 0.45,
  urbanClusterSpacingMeters: 380,
  roadMergeCellMeters: 1200,
  roadParallelToleranceMeters: 95,
  roadReceiveShadow: false,
  bridgeRampMeters: 350,
  maxRoadSections: 28000,
  maxRoadTriangles: 200000,
  maxCandidateCells: 250000,
  urbanFocusBounds: null,
  coverageCellMeters: 2400,
  urbanTransitionMeters: 3000,
  maxBuildingFoundationMeters: 95,
  foundationSampleStepMeters: 65,
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
const validCoordinate = coordinate => Array.isArray(coordinate) && coordinate.length >= 2 && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]);
const tagged = value => value === true || value === 1 || (typeof value === 'string' && !['', 'no', 'false', '0'].includes(value.toLowerCase()));
const hash = (x, y, salt = 0) => {
  let value = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((y | 0) + salt, 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
};
// Continuous cartographic variation creates groves, not a uniform point carpet.
// It changes representation only inside measured forest; it is not vegetation data.
function groveField(x, y, size) {
  const a = x / size, b = y / size, ix = Math.floor(a), iy = Math.floor(b);
  const sx = (a - ix) ** 2 * (3 - 2 * (a - ix)), sy = (b - iy) ** 2 * (3 - 2 * (b - iy));
  return mix(mix(hash(ix, iy, 601), hash(ix + 1, iy, 601), sx), mix(hash(ix, iy + 1, 601), hash(ix + 1, iy + 1, 601), sx), sy);
}

const ringRows = new WeakMap();
function inRing(point, ring) {
  // Large supplied lake/forest rings are queried hundreds of thousands of
  // times during construction. Index only crossing edges at the queried row;
  // this is the same ray test, without rescanning every vertex for every tree.
  let index = ringRows.get(ring);
  if (!index) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of ring) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const step = Math.max(10, (maxY - minY) / 128), rows = new Map();
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j]; if (a[1] === b[1]) continue;
      for (let row = Math.floor(Math.min(a[1], b[1]) / step); row <= Math.floor(Math.max(a[1], b[1]) / step); row++) {
        if (!rows.has(row)) rows.set(row, []); rows.get(row).push([a, b]);
      }
    }
    index = {step, rows}; ringRows.set(ring, index);
  }
  let inside = false;
  for (const [a, b] of index.rows.get(Math.floor(point[1] / index.step)) || []) {
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function contains(point, rings) {
  return !!rings.length && inRing(point, rings[0]) && !rings.slice(1).some(ring => inRing(point, ring));
}

function boundsOf(points) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  return bounds;
}

// Linear-time rectangular preclip avoids feeding an entire 25k-vertex lake or
// city outline to the sweep-line boolean operation for every small road cell.
function clipRingToBox(source, box) {
  let points = source.slice(0, -1);
  for (const [axis, value, greater] of [[0, box[0], true], [0, box[2], false], [1, box[1], true], [1, box[3], false]]) {
    if (!points.length) break;
    const output = []; let a = points.at(-1), aInside = greater ? a[axis] >= value : a[axis] <= value;
    for (const b of points) {
      const bInside = greater ? b[axis] >= value : b[axis] <= value;
      if (aInside !== bInside) { const t = (value - a[axis]) / (b[axis] - a[axis]); const p = [mix(a[0], b[0], t), mix(a[1], b[1], t)]; p[axis] = value; output.push(p); }
      if (bInside) output.push(b);
      a = b; aInside = bInside;
    }
    points = output;
  }
  if (points.length < 3) return null;
  return [...points, points[0]];
}

function areaOf(rings) {
  return Math.max(0, rings.reduce((total, ring, ringIndex) => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    return total + Math.abs(area) / 2 * (ringIndex ? -1 : 1);
  }, 0));
}

class SpatialIndex {
  constructor(cellSize = 2200) { this.cellSize = cellSize; this.cells = new Map(); }
  add(item, bounds) {
    const s = this.cellSize;
    for (let y = Math.floor(bounds[1] / s); y <= Math.floor(bounds[3] / s); y++) {
      for (let x = Math.floor(bounds[0] / s); x <= Math.floor(bounds[2] / s); x++) {
        const key = `${x}:${y}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(item);
      }
    }
  }
  at(point) { return this.cells.get(`${Math.floor(point[0] / this.cellSize)}:${Math.floor(point[1] / this.cellSize)}`) || []; }
  clear() { this.cells.clear(); }
}

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq, 0, 1) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function simplifyLine(points, tolerance) {
  if (points.length < 3 || tolerance <= 0) return points;
  const keep = new Set([0, points.length - 1]), pending = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop(); let furthest = -1, distance = tolerance;
    for (let i = start + 1; i < end; i++) {
      const next = distanceToSegment(points[i], points[start], points[end]);
      if (next > distance) { distance = next; furthest = i; }
    }
    if (furthest !== -1) { keep.add(furthest); pending.push([start, furthest], [furthest, end]); }
  }
  return [...keep].sort((a, b) => a - b).map(index => points[index]);
}

/**
 * Source-constrained volumetric vegetation, urban groups and major roads.
 * project([lng,lat], metres) must include the viewer's terrain exaggeration.
 * sampleHeight returns measured metres, not world Y. Object display heights are
 * independent of terrain exaggeration. No loader, texture, renderer or camera is
 * owned here. Add result.group to a scene and call dispose when leaving the city.
 */
export function createHangzhouFabric({data, project, sampleHeight, options = {}, assets}) {
  if (!assets?.buildings || !assets?.trees) throw new TypeError('Load a city asset kit before constructing city fabric.');
  for(const asset of Object.values(assets.buildings).flat()) for(const key of ['recommendedHeightToWidth','recommendedDepthToWidth']) {
    const range=asset[key];if(!Array.isArray(range)||range.length!==2||!range.every(v=>Number.isFinite(v)&&v>0)||range[1]<range[0]) throw new TypeError(`City asset ${asset.id} requires a valid ${key} range.`);
  }
  if (!data || typeof project !== 'function' || typeof sampleHeight !== 'function') throw new TypeError('Hangzhou fabric requires data, project and sampleHeight.');
  if (!Array.isArray(data.bbox) || data.bbox.length !== 4 || !data.bbox.every(Number.isFinite)) throw new TypeError('Hangzhou fabric requires a WGS84 bbox.');
  const config = {...DEFAULTS, ...options, roadWidthMeters: {...DEFAULTS.roadWidthMeters, ...options.roadWidthMeters}};
  const scaleReference=config.buildingScaleReference;
  if(scaleReference) for(const asset of Object.values(assets.buildings).flat()) {
    if(!asset.primaryBody||![asset.primaryBody.width,asset.primaryBody.height,asset.primaryBody.depth].every(v=>Number.isFinite(v)&&v>0))throw new TypeError(`City asset ${asset.id} needs actual primary-body bounds for individual-building calibration.`);
    if(scaleReference.mode==='streetwall-and-skyline'&&(!Array.isArray(asset.primaryHeightToWidth)||asset.primaryHeightToWidth.length!==2||!asset.primaryHeightToWidth.every(v=>Number.isFinite(v)&&v>0)||!(asset.maxPrimarySlenderness>0)))throw new TypeError(`City asset ${asset.id} needs a primary massing profile.`);
  }
  const [west, south, east, north] = data.bbox;
  const longitudeMetres = 111320 * Math.cos((south + north) * Math.PI / 360), latitudeMetres = 111320;
  const toMetric = coordinate => [(coordinate[0] - west) * longitudeMetres, (coordinate[1] - south) * latitudeMetres];
  const toCoordinate = point => [west + point[0] / longitudeMetres, south + point[1] / latitudeMetres];
  const origin = [west, south], unitOrigin = project(origin, 0);
  const metresToUnits = options.metersToUnits ?? unitOrigin.distanceTo(project([west + 1 / longitudeMetres, south], 0));
  if (!(metresToUnits > 0) || !(config.displayScale > 0)) throw new RangeError('Hangzhou fabric requires a positive display scale.');
  const units = metres => metres * metresToUnits * config.displayScale;
  const group = new THREE.Group(); group.name = 'Hangzhou source-based 3D roads, trees and urban groups';
  const geometries = new Set(), materials = new Set(), instances = [];
  const diagnostics = {
    source: 'Supplied WGS84 polygons and major-road centre lines', displayDimensionsOnly: true,
    trees: 0, urbanGroups: 0, buildingBlocks: 0, roadFeatures: 0, roadSections: 0,
    roadTriangles: 0, bridgeSections: 0, bridgePiers: 0, skippedTunnels: 0,
    skippedInvalidHeights: 0, skippedWaterRoadSections: 0, skippedDistantSecondary: 0, candidateCells: 0,
    candidateBudgetReached: false, roadBudgetReached: false, sourceForestPolygons: 0,
    sourceUrbanPolygons: 0, drawCalls: 0, triangles: 0, disposed: false,
    exactDuplicateRoads: 0, parallelSectionsNarrowed: 0, mergedRoadCells: 0, roadMergeFailures: 0,
    forestRidgeSamples: 0, reducedRidgeTrees: 0, skippedGroveGaps: 0,
    sourceClassPolygons: 0, buildingClassCounts: {}, buildingSourcePolicy: 'Each centre remains in measured developed land; known land-use class is matched at that centre; no surveyed building height is implied.',
    rejectedSteepBuildingParcels: 0, buildingSupportSamples: 0,
    maxBuildingFoundationDisplayMeters: 0, foundationTriangles: 0,
    buildingGroundingSamples: [], urbanFocusBuildings: 0, supportedTreeStems: 0,
    coverageCells: {},
  };
  const geometry = value => { geometries.add(value); return value; };
  const material = properties => { const value = new THREE.MeshStandardMaterial({roughness: 0.88, metalness: 0, ...properties}); materials.add(value); return value; };
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), axisY = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  const makeInstances = (name, shape, surface, rows) => {
    if (!rows.length) return;
    const mesh = new THREE.InstancedMesh(shape, surface, rows.length); mesh.name = name;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]; rotation.setFromAxisAngle(axisY, row.angle || 0);
      if (row.axisX && row.axisZ) {
        const [sx, sy, sz] = row.scale;
        matrix.set(row.axisX[0] * sx, 0, row.axisZ[0] * sz, row.position.x, 0, sy, 0, row.position.y, row.axisX[1] * sx, 0, row.axisZ[1] * sz, row.position.z, 0, 0, 0, 1);
      } else { scale.set(...row.scale); matrix.compose(row.position, rotation, scale); }
      mesh.setMatrixAt(i, matrix);
      if (row.colour) mesh.setColorAt(i, colour.set(row.colour));
    }
    if(rows.some(row=>row.placement)) mesh.userData.placementRows=rows.map(row=>row.placement??null);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere();
    instances.push(mesh); group.add(mesh);
    diagnostics.triangles += (shape.index ? shape.index.count : shape.attributes.position.count) / 3 * rows.length;
    return mesh;
  };
  const metricPolygons = features => (features || []).map(feature => {
    const sourceRings = Array.isArray(feature) ? feature : feature.rings;
    if (!Array.isArray(sourceRings) || !sourceRings[0]?.length) return null;
    const rings = sourceRings.map(ring => ring.filter(validCoordinate).map(toMetric)).filter(ring => ring.length >= 3);
    if (!rings.length) return null;
    return {rings, bounds: boundsOf(rings[0]), area: areaOf(rings), class: feature.class || '', source: feature};
  }).filter(Boolean);
  const forest = metricPolygons(data.forest), urban = metricPolygons(data.urban), water = metricPolygons(data.water), boundary = metricPolygons(data.boundary);
  const classPolygons = metricPolygons(data.urbanClassPolygons);
  diagnostics.sourceClassPolygons = classPolygons.length;
  diagnostics.sourceForestPolygons = forest.length; diagnostics.sourceUrbanPolygons = urban.length;
  const polygonIndex = polygons => {
    const index = new SpatialIndex(); for (const item of polygons) index.add(item, item.bounds);
    return index;
  };
  const exclusions=metricPolygons(data.objectExclusions),exclusionIndex=polygonIndex(exclusions);
  const forestIndex = polygonIndex(forest), urbanIndex = polygonIndex(urban), waterIndex = polygonIndex(water), boundaryIndex = polygonIndex(boundary);
  const classIndex = polygonIndex(classPolygons);
  const specificClasses = new Set(['residential', 'commercial', 'retail', 'industrial', 'school', 'university', 'college', 'hospital']);
  const classAt = point => {
    const hits = new Set(classIndex.at(point).filter(p => specificClasses.has(p.class) && contains(point, p.rings)).map(p => p.class));
    return hits.size === 1 ? [...hits][0] : hits.size > 1 ? 'mixed' : 'unknown';
  };
  const atPolygon = (index, point) => index.at(point).find(item => contains(point, item.rings));
  const inBoundary = point => !boundary.length || !!atPolygon(boundaryIndex, point);
  const inWater = point => !!atPolygon(waterIndex, point);
  const inExclusion = point => !!atPolygon(exclusionIndex, point);
  const landmarks = (data.landmarks || []).filter(item => validCoordinate(item.coordinates)).map(item => toMetric(item.coordinates));
  const landmarkDistance = point => landmarks.reduce((distance, other) => Math.min(distance, Math.hypot(point[0] - other[0], point[1] - other[1])), Infinity);
  const inUrbanFocus = point => {
    if (!config.urbanFocusBounds) return false;
    const [lng, lat] = toCoordinate(point), [w, s, e, n] = config.urbanFocusBounds;
    return lng >= w && lng <= e && lat >= s && lat <= n;
  };
  const focusMetric = config.urbanFocusBounds ? [...toMetric(config.urbanFocusBounds.slice(0,2)),...toMetric(config.urbanFocusBounds.slice(2))] : null;
  const qualityWeight = point => {
    if (!focusMetric) return 0;
    const [w,s,e,n]=focusMetric,dx=Math.max(w-point[0],0,point[0]-e),dy=Math.max(s-point[1],0,point[1]-n);
    const t=clamp(1-Math.hypot(dx,dy)/config.urbanTransitionMeters,0,1);
    return t*t*(3-2*t);
  };
  const coverageKey = point => `${Math.floor(point[0]/config.coverageCellMeters)}:${Math.floor(point[1]/config.coverageCellMeters)}`;
  function recordCoverage(point,type){
    const key=coverageKey(point),cell=diagnostics.coverageCells[key] ||= {buildings:0,trees:0,buildingCandidates:0,treeCandidates:0,focusBuildings:0,focusTrees:0};
    cell[type]++;
    if(inUrbanFocus(point)&&type==='buildings')cell.focusBuildings++;
    if(inUrbanFocus(point)&&type==='trees')cell.focusTrees++;
  }
  function* spatialCandidates(candidates){
    // Each eligible source neighbourhood gets repeated opportunities. Landmark
    // proximity cannot consume the budget before the rest of the visible city.
    const cells=new Map();
    for(const candidate of candidates){
      const key=coverageKey(candidate.point);
      if(!cells.has(key))cells.set(key,{rows:[],index:0,x:Math.floor(candidate.point[0]/config.coverageCellMeters),y:Math.floor(candidate.point[1]/config.coverageCellMeters)});
      cells.get(key).rows.push(candidate);
    }
    const ordered=[...cells.values()].sort((a,b)=>hash(a.x,a.y,823)-hash(b.x,b.y,823));
    for(const cell of ordered){
      cell.rows.sort((a,b)=>a.score-b.score);
      cell.weight=1+3*qualityWeight([(cell.x+.5)*config.coverageCellMeters,(cell.y+.5)*config.coverageCellMeters]);
    }
    let remaining=candidates.length,round=0;
    while(remaining){
      for(let slot=0;slot<4;slot++)for(const cell of ordered){
        // Equal opportunities throughout the main-city area; only the outside
        // transition changes weighting, smoothly, rather than one abrupt box.
        const count=Math.floor(cell.weight)+(hash(cell.x,cell.y,round+827)<cell.weight%1?1:0);
        if(slot<count&&cell.index<cell.rows.length){remaining--;yield cell.rows[cell.index++];}
      }
      round++;
    }
  }
  const pointOnGround = point => {
    const coordinate = toCoordinate(point);
    let height;
    try { height = sampleHeight(coordinate); } catch { diagnostics.skippedInvalidHeights++; return null; }
    if (!Number.isFinite(height)) { diagnostics.skippedInvalidHeights++; return null; }
    const position = project(coordinate, height);
    if (![position.x, position.y, position.z].every(Number.isFinite)) { diagnostics.skippedInvalidHeights++; return null; }
    return position;
  };

  // Index the widened source lines once. Vegetation/building placement queries
  // only nearby segments; there is no per-candidate scan of the whole network.
  const roads = [], roadIndex = new SpatialIndex(1500), roadKeys = new Set(), bridgeEndpoints = new Map();
  const endpointKey = point => `${Math.round(point[0])}:${Math.round(point[1])}`;
  for (const source of data.roads || []) {
    if (tagged(source.tunnel)) { diagnostics.skippedTunnels++; continue; }
    const roadClass = String(source.class || '').replace(/_link$/, '');
    if (!Object.hasOwn(config.roadWidthMeters, roadClass)) continue;
    let points = (source.points || []).filter(validCoordinate).map(toMetric).filter((point, index, values) => !index || Math.hypot(point[0] - values[index - 1][0], point[1] - values[index - 1][1]) > 1);
    if (points.length < 2) continue;
    if (roadClass === 'secondary' && !points.some(point => landmarkDistance(point) < config.secondaryRoadRadiusMeters)) { diagnostics.skippedDistantSecondary++; continue; }
    const forward = points.map(p => `${Math.round(p[0])},${Math.round(p[1])}`).join(';');
    const backward = points.slice().reverse().map(p => `${Math.round(p[0])},${Math.round(p[1])}`).join(';');
    const key = `${roadClass}:${tagged(source.bridge)}:${forward < backward ? forward : backward}`;
    if (roadKeys.has(key)) { diagnostics.exactDuplicateRoads++; continue; } roadKeys.add(key);
    points = simplifyLine(points, config.roadSimplifyMeters);
    const road = {id: roads.length, points, width: config.roadWidthMeters[roadClass] * config.displayScale, bridge: tagged(source.bridge), class: roadClass};
    roads.push(road);
    if (road.bridge) for (const p of [points[0], points.at(-1)]) bridgeEndpoints.set(endpointKey(p), (bridgeEndpoints.get(endpointKey(p)) || 0) + 1);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], pad = road.width / 2 + 550;
      roadIndex.add({a, b, width: road.width, road}, [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad]);
    }
  }
  // Shared source endpoints reconnect bridge fragments cut at vector-tile edges.
  // Dry contacts belong to these actual bridge footprints; ARP/guessed levels
  // are never used to float a bridge above the supplied displayed landscape.
  const bridgeNodes = new Map(), bridgeComponents = [];
  for (const road of roads.filter(r => r.bridge)) for (const p of [road.points[0], road.points.at(-1)]) {
    const key = endpointKey(p); if (!bridgeNodes.has(key)) bridgeNodes.set(key, []); bridgeNodes.get(key).push(road);
  }
  for (const first of roads.filter(r => r.bridge)) {
    if (first.bridgeComponent) continue;
    const component = {contacts: [], roads: [], heightCache: new Map()}, pending = [first], contacts = new Set(); first.bridgeComponent = component;
    while (pending.length) {
      const road = pending.pop(); component.roads.push(road);
      for (const p of [road.points[0], road.points.at(-1)]) for (const other of bridgeNodes.get(endpointKey(p)) || []) if (!other.bridgeComponent && other.class === road.class) { other.bridgeComponent = component; pending.push(other); }
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(length / 100));
        for (let j = 0; j <= steps; j++) for (const offset of [-road.width / 2, 0, road.width / 2]) {
          const p = [mix(a[0], b[0], j / steps) - dy / length * offset, mix(a[1], b[1], j / steps) + dx / length * offset], key = endpointKey(p);
          if (contacts.has(key) || !inBoundary(p) || inWater(p)) continue;
          const v = pointOnGround(p); if (v) { contacts.add(key); component.contacts.push({point: p, y: v.y}); }
        }
      }
    }
    bridgeComponents.push(component);
  }
  diagnostics.bridgeComponents = bridgeComponents.length;
  diagnostics.bridgeComponentsWithoutDryContacts = bridgeComponents.filter(c => !c.contacts.length).length;
  diagnostics.bridgeGroundPolicy = 'Source bridge footprints interpolate nearby actual dry-land contacts across water; local land is a lower support bound. The source alignments remain unchanged.';
  const bridgeGround = (point, component) => {
    const key = `${point[0].toFixed(3)}:${point[1].toFixed(3)}`;
    if (component.heightCache.has(key)) return component.heightCache.get(key);
    const ground = pointOnGround(point); if (!ground) return null;
    if (inWater(point) && component.contacts.length) {
      let nearest = null, next = null;
      for (const contact of component.contacts) {
        const d = Math.hypot(point[0] - contact.point[0], point[1] - contact.point[1]);
        if (!nearest || d < nearest.d) { next = nearest; nearest = {d, y: contact.y}; } else if (!next || d < next.d) next = {d, y: contact.y};
      }
      const y = next && nearest.d > .01 ? (nearest.y / nearest.d + next.y / next.d) / (1 / nearest.d + 1 / next.d) : nearest.y;
      ground.y = Math.max(ground.y, y);
    }
    component.heightCache.set(key, ground); return ground;
  };
  const priority = {motorway: 0, trunk: 1, primary: 2, secondary: 3};
  roads.sort((a, b) => priority[a.class] - priority[b.class]);
  const nearRoad = (point, clearance = 0) => roadIndex.at(point).some(segment => distanceToSegment(point, segment.a, segment.b) < segment.width / 2 + clearance);

  const roadTop = [], roadSides = [], curbFaces = [], pierRows = [];
  const bridgeTopTriangles = [];
  const roadCells = new Map(), cellSize = Math.max(400, config.roadMergeCellMeters);
  function collectGroundStrip(a, b) {
    const ring = [a.metricLeft, a.metricRight, b.metricRight, b.metricLeft].map(p => p.map(v => Math.round(v * 1000) / 1000)); ring.push(ring[0]);
    const box = boundsOf(ring);
    for (let x = Math.floor(box[0] / cellSize); x <= Math.floor(box[2] / cellSize); x++) for (let y = Math.floor(box[1] / cellSize); y <= Math.floor(box[3] / cellSize); y++) {
      const key = `${x}:${y}`;
      if (!roadCells.has(key)) roadCells.set(key, {x, y, pieces: []});
      const clipped = box[0] >= x * cellSize && box[2] <= (x + 1) * cellSize && box[1] >= y * cellSize && box[3] <= (y + 1) * cellSize ? [[ring]] : polygonClipping.intersection([ring], [[[x * cellSize, y * cellSize], [(x + 1) * cellSize, y * cellSize], [(x + 1) * cellSize, (y + 1) * cellSize], [x * cellSize, (y + 1) * cellSize], [x * cellSize, y * cellSize]]]);
      for (const poly of clipped) roadCells.get(key).pieces.push(poly);
    }
  }
  const addQuad = (target, a, b, c, d) => { for (const p of [a, b, d, b, c, d]) target.push(p.x, p.y, p.z); };
  const addSolidSegment = (targetTop, targetSides, a, b, thickness, bottom = true) => {
    const al = a.left, ar = a.right, bl = b.left, br = b.right;
    const al0 = al.clone().add(new THREE.Vector3(0, -thickness, 0)), ar0 = ar.clone().add(new THREE.Vector3(0, -thickness, 0));
    const bl0 = bl.clone().add(new THREE.Vector3(0, -thickness, 0)), br0 = br.clone().add(new THREE.Vector3(0, -thickness, 0));
    addQuad(targetTop, al, ar, br, bl);
    addQuad(targetSides, al0, al, bl, bl0); addQuad(targetSides, ar, ar0, br0, br);
    if (bottom) addQuad(targetSides, al0, bl0, br0, ar0);
  };
  const capSection = (target, section, thickness) => {
    const left = section.left.clone().add(new THREE.Vector3(0, -thickness, 0));
    const right = section.right.clone().add(new THREE.Vector3(0, -thickness, 0));
    addQuad(target, left, right, section.right, section.left);
  };
  for (const road of roads) {
    if (diagnostics.roadSections >= config.maxRoadSections) { diagnostics.roadBudgetReached = true; break; }
    const resampled = [road.points[0]];
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / config.roadSampleStepMeters);
      for (let part = 1; part <= count; part++) resampled.push([mix(a[0], b[0], part / count), mix(a[1], b[1], part / count)]);
    }
    const thickness = units(config.roadThicknessMeters), curbHeight = units(config.curbHeightMeters);
    const curbWidth = Math.min(0.12, 15 / road.width);
    const rail = (section, side) => {
      const outer = (side ? section.right : section.left).clone(), inner = outer.clone().lerp(side ? section.left : section.right, curbWidth);
      outer.y += curbHeight; inner.y += curbHeight;
      return side ? {left: inner, right: outer} : {left: outer, right: inner};
    };
    let previous = null, bridgeDistance = 0, visible = false, runFirst = null, runLast = null;
    const closeRun = () => {
      if (road.bridge && runFirst && runLast) {
        for (const section of [runFirst, runLast]) {
          capSection(roadSides, section, thickness);
          if (config.showCurbs) for (const side of [0, 1]) capSection(curbFaces, rail(section, side), curbHeight);
        }
      }
      runFirst = runLast = null;
    };
    const cumulative = [0]; for (let i = 1; i < resampled.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(resampled[i][0] - resampled[i - 1][0], resampled[i][1] - resampled[i - 1][1]));
    let bridgeHalfWidth=road.width/2;
    if(road.bridge)for(let i=0;i<resampled.length;i++){
      const point=resampled[i],before=resampled[Math.max(0,i-1)],after=resampled[Math.min(resampled.length-1,i+1)],dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy);if(!length)continue;
      for(const segment of roadIndex.at(point)){
        if(segment.road===road||segment.road.class!==road.class||!segment.road.bridge)continue;
        const sx=segment.b[0]-segment.a[0],sy=segment.b[1]-segment.a[1],sl=Math.hypot(sx,sy);if(!sl||Math.abs((dx*sx+dy*sy)/(length*sl))<.995)continue;
        const t=((point[0]-segment.a[0])*sx+(point[1]-segment.a[1])*sy)/(sl*sl),distance=distanceToSegment(point,segment.a,segment.b);
        if(t>.04&&t<.96&&distance>8&&distance<config.roadParallelToleranceMeters)bridgeHalfWidth=Math.min(bridgeHalfWidth,Math.max(12,distance*.56));
      }
    }
    if(road.bridge&&bridgeHalfWidth<road.width/2)diagnostics.constantWidthBridgeFragments=(diagnostics.constantWidthBridgeFragments||0)+1;
    for (let i = 0; i < resampled.length; i++) {
      if (diagnostics.roadSections >= config.maxRoadSections || (roadTop.length + roadSides.length + curbFaces.length) / 9 + 36 >= config.maxRoadTriangles) { diagnostics.roadBudgetReached = true; break; }
      const point = resampled[i], before = resampled[Math.max(0, i - 1)], after = resampled[Math.min(resampled.length - 1, i + 1)];
      const dx = after[0] - before[0], dy = after[1] - before[1], length = Math.hypot(dx, dy);
      if (!length || !inBoundary(point)) { closeRun(); previous = null; continue; }
      // Ground carriageways keep the designed width. Their later polygon union
      // creates one coherent strip at overlaps instead of jagged pinches down
      // to 24 metres. Bridges use one conservative width per source fragment.
      const normal = [-dy / length, dx / length],halfWidth=road.bridge?bridgeHalfWidth:road.width/2;
      if (halfWidth < road.width / 2) diagnostics.parallelSectionsNarrowed++;
      const leftPoint = [point[0] + normal[0] * halfWidth, point[1] + normal[1] * halfWidth];
      const rightPoint = [point[0] - normal[0] * halfWidth, point[1] - normal[1] * halfWidth];
      const centre = pointOnGround(point), left = pointOnGround(leftPoint), right = pointOnGround(rightPoint);
      if (!centre || !left || !right) { closeRun(); previous = null; continue; }
      // Untagged roads are not made into bridges just because their widened
      // cartographic footprint overlaps a lake. Gaps preserve source semantics.
      if (!road.bridge && (inWater(point) || inWater(leftPoint) || inWater(rightPoint))) {
        diagnostics.skippedWaterRoadSections++; closeRun(); previous = null; continue;
      }
      const rampIn = (bridgeEndpoints.get(endpointKey(road.points[0])) || 0) > 1 ? 1 : clamp(cumulative[i] / config.bridgeRampMeters, 0, 1);
      const rampOut = (bridgeEndpoints.get(endpointKey(road.points.at(-1))) || 0) > 1 ? 1 : clamp((cumulative.at(-1) - cumulative[i]) / config.bridgeRampMeters, 0, 1);
      const clearance = road.bridge ? units(config.bridgeClearanceMeters * Math.min(rampIn, rampOut)) : 0;
      if (road.bridge) { left.y = bridgeGround(leftPoint, road.bridgeComponent)?.y ?? left.y; right.y = bridgeGround(rightPoint, road.bridgeComponent)?.y ?? right.y; }
      left.y += thickness + clearance; right.y += thickness + clearance;
      const section = {left, right, point, metricLeft: leftPoint, metricRight: rightPoint, clearance};
      if (previous) {
        const middle = [(point[0] + previous.point[0]) / 2, (point[1] + previous.point[1]) / 2];
        if (road.bridge || !inWater(middle)) {
          if (!runFirst) runFirst = previous;
          runLast = section;
          if (road.bridge) {
            // The adaptive top pass shares this dry-contact bridge profile;
            // clearance ramps join the existing source endpoints.
            const scratch = []; addSolidSegment(scratch, roadSides, previous, section, thickness, false);
            bridgeTopTriangles.push([previous.metricLeft, previous.metricRight, section.metricLeft, [previous.clearance, previous.clearance, section.clearance], road.bridgeComponent], [previous.metricRight, section.metricRight, section.metricLeft, [previous.clearance, section.clearance, section.clearance], road.bridgeComponent]);
          }
          else collectGroundStrip(previous, section);
          // Curbs have actual raised cross-sections and side faces.
          if (road.bridge && config.showCurbs) for (const side of [0, 1]) {
            addSolidSegment(curbFaces, curbFaces, rail(previous, side), rail(section, side), curbHeight, false);
          }
          diagnostics.roadSections++; visible = true;
          if (road.bridge) diagnostics.bridgeSections++;
        } else closeRun();
        bridgeDistance += Math.hypot(point[0] - previous.point[0], point[1] - previous.point[1]);
      }
      if (road.bridge && i > 0 && bridgeDistance >= config.bridgePierSpacingMeters) {
        const bottomY = centre.y, topY = Math.min(left.y, right.y) - thickness;
        if (topY > bottomY + units(5)) {
          pierRows.push({position: new THREE.Vector3(centre.x, (topY + bottomY) / 2, centre.z), scale: [units(Math.min(55, road.width * 0.22)), topY - bottomY, units(Math.min(55, road.width * 0.22))]});
          diagnostics.bridgePiers++;
        }
        bridgeDistance = 0;
      }
      previous = section;
    }
    closeRun();
    if (visible) diagnostics.roadFeatures++;
  }
  // Union short source-derived road ribbons locally. Intersections and tile
  // fragments become a single surface, rather than several nearly coplanar
  // strips fighting for depth. Bridges retain their separate elevated decks.
  const mergeStarted = performance.now(), roadPointCache = new Map(), thickness = units(config.roadThicknessMeters), groundSideStart = roadSides.length;
  const roadPoint = p => {
    const key = `${p[0].toFixed(3)}:${p[1].toFixed(3)}`;
    if (!roadPointCache.has(key)) {
      const v = pointOnGround(p);
      if (v) {
        // Exact shoreline coordinates may classify as water after Float32
        // projection, despite belonging to a land-side road polygon. Read the
        // adjacent measured LAND surface, never the lake's constant water level.
        const edge = coastIndex.at(p).find(e => e.kind === 'water' && distanceToSegment(p, e.a, e.b) < 3);
        if (edge) {
          const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1], length = Math.hypot(dx, dy);
          if (length) for (const side of [-1, 1]) {
            const probe = [p[0] - dy / length * side * 4, p[1] + dx / length * side * 4];
            if (inBoundary(probe) && !inWater(probe)) { const land = pointOnGround(probe); if (land && land.y > v.y) { v.y = land.y; diagnostics.shoreRoadHeightCorrections = (diagnostics.shoreRoadHeightCorrections || 0) + 1; } }
          }
        }
        v.y += thickness;
      }
      roadPointCache.set(key, v);
    }
    return roadPointCache.get(key);
  };
  const nearbyPolygons = (index, box) => {
    const found = new Set(), s = index.cellSize;
    for (let y = Math.floor(box[1] / s); y <= Math.floor(box[3] / s); y++) for (let x = Math.floor(box[0] / s); x <= Math.floor(box[2] / s); x++) {
      for (const p of index.at([(x + .5) * s, (y + .5) * s])) if (p.bounds[0] <= box[2] && p.bounds[2] >= box[0] && p.bounds[1] <= box[3] && p.bounds[3] >= box[1]) found.add(p);
    }
    return [...found];
  };
  const roadTriangle = (a, b, c, depth = 0, lifts = [0, 0, 0], bridgeComponent = null) => {
    const topPoint = p => bridgeComponent ? bridgeGround(p, bridgeComponent)?.clone().add(new THREE.Vector3(0, thickness, 0)) : roadPoint(p);
    const vertices = [topPoint(a), topPoint(b), topPoint(c)].map((v, i) => v?.clone().add(new THREE.Vector3(0, lifts[i], 0))); if (vertices.some(v => !v)) return;
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
    const mids = [ab, bc, ca], lengths = [Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1])];
    const centre = topPoint([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]);
    let error = centre ? Math.abs(centre.y + (lifts[0] + lifts[1] + lifts[2]) / 3 - (vertices[0].y + vertices[1].y + vertices[2].y) / 3) : 0;
    for (let i = 0; i < 3; i++) { const p = topPoint(mids[i]); if (p) error = Math.max(error, Math.abs(p.y + (lifts[i] + lifts[(i + 1) % 3]) / 2 - (vertices[i].y + vertices[(i + 1) % 3].y) / 2)); }
    if (depth < 8 && (Math.max(...lengths) > 550 || error > thickness * .55) && roadTop.length / 9 < config.maxRoadTriangles * .8) {
      const edge = lengths.indexOf(Math.max(...lengths));
      if (edge === 0) { roadTriangle(a, ab, c, depth + 1, [lifts[0], (lifts[0] + lifts[1]) / 2, lifts[2]], bridgeComponent); roadTriangle(ab, b, c, depth + 1, [(lifts[0] + lifts[1]) / 2, lifts[1], lifts[2]], bridgeComponent); }
      else if (edge === 1) { roadTriangle(a, b, bc, depth + 1, [lifts[0], lifts[1], (lifts[1] + lifts[2]) / 2], bridgeComponent); roadTriangle(a, bc, c, depth + 1, [lifts[0], (lifts[1] + lifts[2]) / 2, lifts[2]], bridgeComponent); }
      else { roadTriangle(a, b, ca, depth + 1, [lifts[0], lifts[1], (lifts[2] + lifts[0]) / 2], bridgeComponent); roadTriangle(ca, b, c, depth + 1, [(lifts[2] + lifts[0]) / 2, lifts[1], lifts[2]], bridgeComponent); }
      return;
    }
    const [va, vb, vc] = vertices;
    const up = (vb.z - va.z) * (vc.x - va.x) - (vb.x - va.x) * (vc.z - va.z);
    if (Math.abs(up) < 1e-14) return;
    for (const p of up > 0 ? vertices : [va, vc, vb]) roadTop.push(p.x, p.y, p.z);
  };
  const coastIndex = new SpatialIndex(cellSize);
  for (const [kind, polygons] of [['boundary', boundary], ['water', water]]) for (const polygon of polygons) for (const ring of polygon.rings) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i]; coastIndex.add({kind, polygon, a, b}, [Math.min(a[0], b[0]) - 12, Math.min(a[1], b[1]) - 12, Math.max(a[0], b[0]) + 12, Math.max(a[1], b[1]) + 12]);
  }
  const clippedRings = (p, box) => { const outer = clipRingToBox(p.rings[0], box); return outer ? [outer, ...p.rings.slice(1).map(r => clipRingToBox(r, box)).filter(Boolean)] : null; };
  diagnostics.roadBooleanMs = 0;
  for (const cell of roadCells.values()) {
    if (!cell.pieces.length) continue;
    const box = [cell.x * cellSize, cell.y * cellSize, (cell.x + 1) * cellSize, (cell.y + 1) * cellSize];
    let merged;
    const booleanStart = performance.now();
    try {
      merged = polygonClipping.union(...cell.pieces);
      const center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], coast = coastIndex.at(center);
      const limitSet = new Set(coast.filter(p => p.kind === 'boundary').map(p => p.polygon)), lakeSet = new Set(coast.filter(p => p.kind === 'water').map(p => p.polygon));
      if (limitSet.size) { const limits = [...limitSet].map(p => clippedRings(p, box)).filter(Boolean); if (limits.length) merged = polygonClipping.intersection(merged, limits); }
      else if (!inBoundary(center)) merged = [];
      if (lakeSet.size && merged.length) { const lakes = [...lakeSet].map(p => clippedRings(p, box)).filter(Boolean); if (lakes.length) merged = polygonClipping.difference(merged, ...lakes); }
      else if (inWater(center)) merged = [];
    } catch { diagnostics.roadMergeFailures++; merged = cell.pieces; }
    diagnostics.roadBooleanMs += performance.now() - booleanStart;
    for (const polygon of merged) {
      const rings = polygon.map(r => r.slice(0, -1)), points = rings.flat();
      if (!rings[0]?.length) continue;
      const triangles = THREE.ShapeUtils.triangulateShape(rings[0].map(p => new THREE.Vector2(...p)), rings.slice(1).map(r => r.map(p => new THREE.Vector2(...p))));
      for (const [a, b, c] of triangles) roadTriangle(points[a], points[b], points[c]);
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        // Artificial subdivision boundaries do not gain visible vertical walls.
        if ([0, 2].some(j => Math.abs(a[0] - box[j]) < .002 && Math.abs(b[0] - box[j]) < .002) || [1, 3].some(j => Math.abs(a[1] - box[j]) < .002 && Math.abs(b[1] - box[j]) < .002)) continue;
        const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 300));
        for (let step = 0; step < count; step++) {
          const p = roadPoint([mix(a[0], b[0], step / count), mix(a[1], b[1], step / count)]), q = roadPoint([mix(a[0], b[0], (step + 1) / count), mix(a[1], b[1], (step + 1) / count)]);
          if (p && q) addQuad(roadSides, p.clone().add(new THREE.Vector3(0, -thickness, 0)), p, q, q.clone().add(new THREE.Vector3(0, -thickness, 0)));
        }
      }
    }
    diagnostics.mergedRoadCells++;
  }
  for (const [a, b, c, lifts, component] of bridgeTopTriangles) roadTriangle(a, b, c, 0, lifts, component);
  for (const component of bridgeComponents) { component.heightCache.clear(); component.contacts.length = 0; component.roads.length = 0; } bridgeComponents.length = 0; bridgeNodes.clear();
  diagnostics.roadMergeMs = performance.now() - mergeStarted;
  roadCells.clear(); roadPointCache.clear(); roadKeys.clear(); bridgeEndpoints.clear(); coastIndex.clear(); bridgeTopTriangles.length = 0;
  // Validate the final Float32 surface against its actual displayed terrain.
  // A few coastline/overlapping-terrain fragments can cross a height seam after
  // projection. Correct only offending shared vertices instead of subdividing
  // the whole network, deleting a real connection or globally raising roads.
  const supportLifts = new Map(), supportVertices = new Map();
  diagnostics.omittedSliverTriangles = 0; diagnostics.omittedSliverSourceAreaMeters2 = 0;
  diagnostics.roadSupportCorrectedTriangles = 0; diagnostics.roadSupportCorrectedSourceAreaMeters2 = 0; diagnostics.roadSupportMaxLiftUnits = 0;
  if (typeof config.unproject === 'function') {
    const packed = new Float32Array(roadTop), keyAt = (x, y, z) => `${x}:${y}:${z}`;
    diagnostics.roadSupportProbes = 0;
    for (let i = 0; i < packed.length; i += 9) {
      const vertices = [0, 3, 6].map(j => [packed[i + j], packed[i + j + 1], packed[i + j + 2]]);
      let lift = 0;
      const longest = Math.max(...vertices.map((a,j) => Math.hypot(a[0]-vertices[(j+1)%3][0],a[2]-vertices[(j+1)%3][2])));
      const divisions = Math.max(3, Math.min(14, Math.ceil(longest / units(65))));
      const probes = [[1/3,1/3,1/3],[.2,.4,.4],[.4,.2,.4],[.4,.4,.2]];
      for (let u=0;u<=divisions;u++) for(let v=0;v<=divisions-u;v++) probes.push([u/divisions,v/divisions,1-(u+v)/divisions]);
      // Narrow road triangles can cross a DEM seam between their midpoint and
      // centroid. A fine barycentric grid follows every final road triangle;
      // shared vertices receive the same local lift so adjacent decks stay shut.
      for (const weights of probes) {
        const p = [0,1,2].map(axis => vertices.reduce((sum, v, j) => sum + v[axis] * weights[j], 0));
        const coord = config.unproject(p[0], p[2]), h = sampleHeight(coord);
        if (!Number.isFinite(h)) continue;
        diagnostics.roadSupportProbes++;
        const ground = project(coord, h).y;
        if (ground > p[1] + units(.08)) lift = Math.max(lift, ground + units(8) - p[1]);
      }
      if (lift <= 0) continue;
      diagnostics.roadSupportCorrectedTriangles++;
      const metric = vertices.map(v => toMetric(config.unproject(v[0], v[2])));
      diagnostics.roadSupportCorrectedSourceAreaMeters2 += Math.abs((metric[1][0]-metric[0][0])*(metric[2][1]-metric[0][1])-(metric[1][1]-metric[0][1])*(metric[2][0]-metric[0][0]))/2;
      diagnostics.roadSupportMaxLiftUnits = Math.max(diagnostics.roadSupportMaxLiftUnits, lift);
      for (const [x,y,z] of vertices) { const key = keyAt(x,y,z); supportLifts.set(key, Math.max(supportLifts.get(key) || 0, lift)); }
    }
    for (let i = 0; i < packed.length; i += 3) {
      const x=packed[i],y=packed[i+1],z=packed[i+2],lift=supportLifts.get(keyAt(x,y,z)) || 0;
      roadTop[i+1] = y + lift;
      if (lift) { const key = `${Math.round(x*1e6)}:${Math.round(z*1e6)}`; if (!supportVertices.has(key)) supportVertices.set(key, []); supportVertices.get(key).push({y,lift}); }
    }
    const lookupLift = (x,y,z) => {
      const candidates=supportVertices.get(`${Math.round(Math.fround(x)*1e6)}:${Math.round(Math.fround(z)*1e6)}`) || [];
      return candidates.reduce((lift,v)=>Math.abs(v.y-y)<1e-5 ? Math.max(lift,v.lift) : lift,0);
    };
    for (let i=0;i<roadSides.length;i+=3) {
      const x=roadSides[i],y=roadSides[i+1],z=roadSides[i+2];
      // Ground-road sidewall bottoms stay on their sampled terrain when a top
      // triangle is corrected. Raising both was creating an unsupported strip.
      roadSides[i+1] += i >= groundSideStart ? lookupLift(x,y,z) : Math.max(lookupLift(x,y,z),lookupLift(x,y+thickness,z));
    }
    for (const row of pierRows) {
      const lift=lookupLift(row.position.x,row.position.y+row.scale[1]/2+thickness,row.position.z);
      if(lift){row.position.y+=lift/2;row.scale[1]+=lift;}
    }
    diagnostics.roadSupportPolicy = 'Dense actual Float32 triangle probes at up to 65 display metres spacing; only buried shared top vertices and existing sides/piers are corrected, retaining every road triangle. Ground sidewall bottoms remain terrain-contacting.';
  } else diagnostics.roadSupportPolicy = 'Final display-space support check unavailable: caller did not provide unproject.';
  supportLifts.clear(); supportVertices.clear();
  const addSurface = (name, positions, surface) => {
    if (!positions.length) return;
    const packed = new Float32Array(positions), clean = [], top = name === 'Solid major road decks';
    for (let i = 0; i < packed.length; i += 9) {
      const ux = packed[i + 3] - packed[i], uy = packed[i + 4] - packed[i + 1], uz = packed[i + 5] - packed[i + 2], vx = packed[i + 6] - packed[i], vy = packed[i + 7] - packed[i + 1], vz = packed[i + 8] - packed[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if ((nx === 0 && ny === 0 && nz === 0) || (top && ny === 0)) continue;
      clean.push(...packed.subarray(i, i + 3)); for (const offset of top && ny < 0 ? [6, 3] : [3, 6]) clean.push(...packed.subarray(i + offset, i + offset + 3));
    }
    const shape = geometry(new THREE.BufferGeometry()); shape.setAttribute('position', new THREE.Float32BufferAttribute(clean, 3)); shape.computeVertexNormals(); shape.computeBoundingSphere();
    const mesh = new THREE.Mesh(shape, surface); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = config.roadReceiveShadow; group.add(mesh);
    diagnostics.roadTriangles += clean.length / 9; diagnostics.triangles += clean.length / 9;
  };
  // DoubleSide avoids road winding depending on the source centre-line direction;
  // independently computed side-face normals retain the visible solid section.
  addSurface('Solid major road decks', roadTop, material({color: assets.roadProfile.roadColor, side: THREE.DoubleSide}));
  addSurface('Major road physical sidewalls', roadSides, material({color: assets.roadProfile.sideColor, side: THREE.DoubleSide}));
  addSurface('Raised major road curbs', curbFaces, material({color: assets.roadProfile.curbColor, side: THREE.DoubleSide}));
  const box = geometry(assets.roads.pier.geometry.clone().translate(0,-.5,0));
  makeInstances('Source-tagged bridge piers', box, material({color: assets.roadProfile.pierColor}), pierRows);

  function sampleCandidates(polygons, index, maximum, minimumSpacing, salt, clearance) {
    if (!maximum || !polygons.length) return [];
    const area = polygons.reduce((sum, polygon) => sum + polygon.area, 0);
    const spacing = Math.max(minimumSpacing, Math.sqrt(area / (maximum * 2.2)));
    const visited = new Set(), candidates = [];
    let budgetReached = false;
    for (const polygon of polygons) {
      if (budgetReached) break;
      for (let y = Math.floor(polygon.bounds[1] / spacing); y <= Math.ceil(polygon.bounds[3] / spacing); y++) {
        if (budgetReached) break;
        for (let x = Math.floor(polygon.bounds[0] / spacing); x <= Math.ceil(polygon.bounds[2] / spacing); x++) {
          const key = `${x}:${y}`; if (visited.has(key)) continue;
          visited.add(key); diagnostics.candidateCells++;
          if (visited.size > config.maxCandidateCells) { diagnostics.candidateBudgetReached = true; budgetReached = true; break; }
          const point = salt === 97 ? [(x+.5)*spacing,(y+.5)*spacing] : [(x + 0.23 + hash(x, y, salt) * 0.54) * spacing, (y + 0.23 + hash(x, y, salt + 1) * 0.54) * spacing];
          const source = atPolygon(index, point);
          if (!source || !inBoundary(point) || inWater(point) || inExclusion(point) || nearRoad(point, clearance)) continue;
          const distance = landmarkDistance(point);
          const landmarkClearance = salt === 61 ? config.treeLandmarkClearanceMeters : config.buildingLandmarkClearanceMeters;
          if (distance < landmarkClearance) continue;
          const detail = distance < config.landmarkDetailRadiusMeters;
          const historicalPriority = detail ? (salt === 97 ? 3 : 1.3) : 1;
          candidates.push({point, source, detail, distance, random: hash(x, y, salt + 2), score: hash(x, y, salt + 3) / mix(historicalPriority,1,qualityWeight(point))});
        }
      }
    }
    const selected=[];
    for(const candidate of spatialCandidates(candidates)){selected.push(candidate);if(selected.length>=maximum)break;}
    return selected;
  }

  const trunkRows = [], broadRows = [], coneRows = [];
  const sourceGuard = createLandFootprintGuard({boundary: boundary.map(p => p.rings), water: water.map(p => p.rings), exclusions: exclusions.map(p => p.rings), cellSize: 1600});
  const displayPolygons = polygons => polygons.map(p => p.rings.map(r => r.map(point => { const v = project(toCoordinate(point), 0); return [v.x, v.z]; })));
  const displayGuard = createLandFootprintGuard({boundary: displayPolygons(boundary), water: displayPolygons(water), exclusions: displayPolygons(exclusions), cellSize: units(1600)});
  // Building-only barriers; trees must still be allowed in their source forest.
  const buildingForbidden=[...forest,...metricPolygons(data.buildingNaturalExclusions)].flatMap(p=>{
    // Some source interior rings contain only repeated coordinates. Such a
    // zero-area hole cannot form land; omit it without changing any valid ring.
    const usable=r=>new Set(r.map(v=>v.join(','))).size>=3;
    if(!usable(p.rings[0]))return [];
    return [{...p,rings:[p.rings[0],...p.rings.slice(1).filter(usable)]}];
  });
  const buildingSourceGuard=createLandFootprintGuard({boundary:boundary.map(p=>p.rings),water:[],exclusions:buildingForbidden.map(p=>p.rings),cellSize:1600});
  const buildingDisplayGuard=createLandFootprintGuard({boundary:displayPolygons(boundary),water:[],exclusions:displayPolygons(buildingForbidden),cellSize:units(1600)});
  const forestPalette = ['#235743', '#2d694b', '#3d7950', '#528553'];
  const broadCrown = assets.trees.broadCrown.geometry, uprightCrown = assets.trees.uprightCrown.geometry;
  const crownVertices = new Map();
  for (const crown of [broadCrown,uprightCrown]) {
    const unique = new Map(), a = crown.attributes.position;
    for (let i=0;i<a.count;i++) { const p=[a.getX(i),a.getY(i),a.getZ(i)]; unique.set(p.join(':'),p); }
    crownVertices.set(crown,[...unique.values()]);
  }
  function crownClearsTerrain(crown,row,point,angle) {
    const transform=new THREE.Matrix4();
    transform.set(row.axisX[0]*row.scale[0],0,row.axisZ[0]*row.scale[2],row.position.x,0,row.scale[1],0,row.position.y,row.axisX[1]*row.scale[0],0,row.axisZ[1]*row.scale[2],row.position.z,0,0,0,1);
    transform.fromArray(new Float32Array(transform.elements));
    const vertex=new THREE.Vector3();
    for (const [x,y,z] of crownVertices.get(crown)) {
      vertex.set(x,y,z).applyMatrix4(transform);
      const wx=vertex.x,wz=vertex.z,wy=vertex.y;
      const metricX=x*row.scale[0]/metresToUnits,metricY=-z*row.scale[2]/metresToUnits;
      const coord=typeof config.unproject==='function'?config.unproject(wx,wz):toCoordinate([point[0]+metricX*Math.cos(angle)-metricY*Math.sin(angle),point[1]+metricX*Math.sin(angle)+metricY*Math.cos(angle)]);
      const actual=typeof config.sampleWorldHeight==='function'?config.sampleWorldHeight(wx,wz):null;
      if(typeof config.sampleWorldHeight==='function'&&!Number.isFinite(actual))return false;
      const ground=Number.isFinite(actual)?actual:project(coord,sampleHeight(coord)).y;
      diagnostics.actualCrownVertexProbes=(diagnostics.actualCrownVertexProbes||0)+1;
      if (ground > wy-units(2)) return false;
    }
    return true;
  }
  const placedTrees = new SpatialIndex(1200);
  const maxTreeRadius=config.treeHeightMeters[1]*config.displayScale*.7;
  function crownSpacingAllows(point,row,crown,angle){
    const b=crown.boundingBox,rx=Math.max(Math.abs(b.min.x),Math.abs(b.max.x))*row.scale[0]/metresToUnits,rz=Math.max(Math.abs(b.min.z),Math.abs(b.max.z))*row.scale[2]/metresToUnits;
    const extent={rx,rz,angle,point};
    for(const other of placedTrees.at(point)){
      const dx=point[0]-other.point[0],dy=point[1]-other.point[1],distance=Math.hypot(dx,dy);if(distance<1)return null;
      const support=e=>{const c=Math.cos(e.angle),s=Math.sin(e.angle);return Math.hypot((dx*c+dy*s)/distance*e.rx,(-dx*s+dy*c)/distance*e.rz);};
      // Permit a narrow meeting edge (14%), not overlapping green masses.
      if(distance<(support(extent)+support(other))*.86)return null;
    }
    return extent;
  }
  const forestSeeds=sampleCandidates(forest,forestIndex,config.maxTrees*4,options.treeSampleStepMeters||500,61,100);
  function* individualTreeSeeds(){
    const spread=(config.treeHeightMeters[0]+config.treeHeightMeters[1])*.5*.56;
    for(const seed of forestSeeds)for(const [i,dx,dy] of [[0,0,0],[1,-spread,spread*.35],[2,spread,-spread*.35]]){
      const point=[seed.point[0]+dx,seed.point[1]+dy];
      if(!atPolygon(forestIndex,point))continue;
      yield{...seed,point,random:clamp(seed.random+(i-1)*.13,0,1),distance:landmarkDistance(point)};
    }
  }
  for (const seed of individualTreeSeeds()) {
    if (diagnostics.trees >= config.maxTrees) break;
    recordCoverage(seed.point,'treeCandidates');
    const relocation = Math.min(180,config.treeHeightMeters[0]*.22);
    const trialPoints = [[0,0],[relocation,0],[-relocation,0],[0,relocation],[0,-relocation]].map(([dx,dy])=>[seed.point[0]+dx,seed.point[1]+dy]).filter(point=>atPolygon(forestIndex,point)&&inBoundary(point)&&!inWater(point)&&!inExclusion(point)&&!nearRoad(point,100)&&landmarkDistance(point)>=config.treeLandmarkClearanceMeters);
    // A representative grove may move within the same local measured forest
    // to find a supported shoulder. Prefer this to squeezing a broad crown into
    // a needle whenever the original sample falls on a steep DEM triangle.
    trialPoints.sort((a,b)=>(pointOnGround(b)?.y??-Infinity)-(pointOnGround(a)?.y??-Infinity));
    for (const point of trialPoints) {
    const candidate={...seed,point,distance:landmarkDistance(point)};
    const grove = groveField(...candidate.point, config.forestClusterMeters);
    if (candidate.random > .24 + grove * .82) { diagnostics.skippedGroveGaps++; continue; }
    const base = pointOnGround(candidate.point); if (!base) continue;
    if(typeof config.sampleWorldHeight==='function'){const actual=config.sampleWorldHeight(base.x,base.z);if(!Number.isFinite(actual))continue;base.y=actual;}
    const raw = sampleHeight(toCoordinate(candidate.point)), ridgeHeights = [];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const p = [candidate.point[0] + dx * config.ridgeSampleMeters, candidate.point[1] + dy * config.ridgeSampleMeters];
      if (!inBoundary(p)) continue;
      const h = sampleHeight(toCoordinate(p)); if (Number.isFinite(h)) ridgeHeights.push(h);
    }
    diagnostics.forestRidgeSamples += ridgeHeights.length;
    const prominence = ridgeHeights.length ? Math.max(0, raw - ridgeHeights.reduce((a, b) => a + b, 0) / ridgeHeights.length) : 0;
    const ridge = clamp((prominence - 30) / 170, 0, 1);
    if (ridge > .2) diagnostics.reducedRidgeTrees++;
    const nearLandmark = mix(mix(.80, 1, clamp((candidate.distance - config.treeLandmarkClearanceMeters) / 950, 0, 1)),1,qualityWeight(point));
    const height = units(mix(...config.treeHeightMeters, grove * .68 + candidate.random * .32) * mix(1, Math.max(.68, config.ridgeTreeScale), ridge) * nearLandmark*.82);
    const width = height * (.96 + grove * .30), trunkHeight = height * .33, angle = candidate.random * Math.PI;
    const broad = grove > .50, crown = broad ? broadCrown : uprightCrown;
    const crownScale = [width*.50,height*.47,width*.48];
    const crownBounds = crown.boundingBox;
    let footprintWidth = Math.max(Math.abs(crownBounds.min.x), Math.abs(crownBounds.max.x)) * crownScale[0] * 2 / metresToUnits;
    let footprintDepth = Math.max(Math.abs(crownBounds.min.z), Math.abs(crownBounds.max.z)) * crownScale[2] * 2 / metresToUnits;
    // Enlarging a canopy is not permission to cover water, airports, a real
    // major road or another reserved signature. Skip rather than make confetti.
    if (crossesRoad(candidate.point, footprintWidth, footprintDepth, angle) || !safeSolidLandFootprint(candidate.point, footprintWidth, footprintDepth, angle)) { diagnostics.rejectedGroveFootprints = (diagnostics.rejectedGroveFootprints || 0) + 1; continue; }
    let canopyGround = footprintGround(candidate.point, footprintWidth, footprintDepth, angle,true);
    if (canopyGround && canopyGround.maxY > base.y + height * .32) {
      const fullWidth = footprintWidth, fullDepth = footprintDepth;
      for (const factor of [.88, .76]) {
        const profile = footprintGround(candidate.point, fullWidth * factor, fullDepth * factor, angle,true);
        if (profile && profile.maxY <= base.y + height * .32) {
          canopyGround = profile; crownScale[0] *= factor; crownScale[2] *= factor;
          footprintWidth *= factor; footprintDepth *= factor;
          diagnostics.narrowSlopeCrowns = (diagnostics.narrowSlopeCrowns || 0) + 1; break;
        }
      }
    }
    if (!canopyGround || canopyGround.maxY > base.y + height * .32) {
      diagnostics.rejectedSteepCanopies = (diagnostics.rejectedSteepCanopies || 0) + 1; continue;
    }
    // A broad crown is symbolic, but the stem is physically rooted. Its bottom
    // covers the entire small trunk footprint, instead of floating at its centre.
    const stemGround = footprintGround(candidate.point,height*.052/metresToUnits,height*.052/metresToUnits,angle,true);
    if (!stemGround) continue;
    const stemBottom = stemGround.minY - units(2), stemTop = base.y + trunkHeight;
    const basis = projectedBuildingAxes(candidate.point, angle);
    const row = {position:base.clone().add(new THREE.Vector3(0,height*.66,0)),scale:crownScale,...basis,colour:forestPalette[Math.min(forestPalette.length-1,Math.floor(grove*forestPalette.length))]};
    if (!crownClearsTerrain(crown,row,candidate.point,angle)) {
      const fullScale=row.scale.slice();let fits=false;
      for (const factor of [.90]) {
        row.scale[0]=fullScale[0]*factor;row.scale[2]=fullScale[2]*factor;
        if(crownClearsTerrain(crown,row,candidate.point,angle)){fits=true;diagnostics.vertexFittedCrowns=(diagnostics.vertexFittedCrowns||0)+1;break;}
      }
      if(!fits){diagnostics.rejectedCrownVertices=(diagnostics.rejectedCrownVertices||0)+1;continue;}
    }
    const crownExtent=crownSpacingAllows(point,row,crown,angle);
    if(!crownExtent){diagnostics.rejectedOverlappingCrowns=(diagnostics.rejectedOverlappingCrowns||0)+1;continue;}
    (broad ? broadRows : coneRows).push(row);
    trunkRows.push({position:new THREE.Vector3(base.x,(stemTop+stemBottom)/2,base.z),scale:[height*.026,stemTop-stemBottom,height*.026],...basis});
    diagnostics.supportedTreeStems++;
    diagnostics.trees++;
    recordCoverage(point,'trees');
    const spacing=Math.max(crownExtent.rx,crownExtent.rz)+maxTreeRadius;placedTrees.add(crownExtent,[point[0]-spacing,point[1]-spacing,point[0]+spacing,point[1]+spacing]);
    if(Math.hypot(point[0]-seed.point[0],point[1]-seed.point[1])>1)diagnostics.relocatedGroveCentres=(diagnostics.relocatedGroveCentres||0)+1;
    break;
    }
  }
  makeInstances('Measured forest representative trunks', assets.trees.trunk.geometry, material({color: '#776347'}), trunkRows);
  const foliage = material({color: '#ffffff', vertexColors:true, flatShading: false});
  makeInstances('Measured forest broad tree crowns', broadCrown, foliage, broadRows);
  makeInstances('Measured forest upright tree crowns', uprightCrown, foliage, coneRows);

  const buildingRows = [], residentialRows = [], commercialRows = [], industrialRows = [], buildingFoundations = [];

  const occupiedBuildings = new SpatialIndex(900), representedSmallParcels = new Set(), attemptedParcelCentres = new Set();
  function projectedBuildingAxes(point, angle) {
    const axes = [[Math.cos(angle), Math.sin(angle)], [Math.sin(angle), -Math.cos(angle)]];
    const [axisX, axisZ] = axes.map(([x, y]) => {
      const a = project(toCoordinate([point[0] - x * 50, point[1] - y * 50]), 0), b = project(toCoordinate([point[0] + x * 50, point[1] + y * 50]), 0);
      return [(b.x - a.x) / (100 * metresToUnits), (b.z - a.z) / (100 * metresToUnits)];
    });
    return {axisX, axisZ};
  }
  function footprintGround(point, width, depth, angle) {
    const nx = Math.max(2, Math.ceil(width / config.foundationSampleStepMeters)), nz = Math.max(2, Math.ceil(depth / config.foundationSampleStepMeters));
    const c = Math.cos(angle), s = Math.sin(angle), rows = [];
    // Match the actual Float32 instance matrix, including its affine edges.
    // Projecting every source-grid point independently bends the foundation
    // very slightly away from a wide building's straight displayed footprint.
    const origin=project(toCoordinate(point),0),basis=projectedBuildingAxes(point,angle);
    const xx=Math.fround(basis.axisX[0]*width*metresToUnits),xz=Math.fround(basis.axisX[1]*width*metresToUnits),zx=Math.fround(basis.axisZ[0]*depth*metresToUnits),zz=Math.fround(basis.axisZ[1]*depth*metresToUnits),ox=Math.fround(origin.x),oz=Math.fround(origin.z);
    let minY = Infinity, maxY = -Infinity;
    for (let z = 0; z <= nz; z++) {
      const row = [];
      for (let x = 0; x <= nx; x++) {
        const dx = (x / nx - .5) * width, dy = (z / nz - .5) * depth;
        const p = [point[0] + dx * c - dy * s, point[1] + dx * s + dy * c];
        const u=x/nx-.5,vz=.5-z/nz,wx=ox+xx*u+zx*vz,wz=oz+xz*u+zz*vz;
        const actual=typeof config.sampleWorldHeight==='function'?config.sampleWorldHeight(wx,wz):pointOnGround(p)?.y;
        if(!Number.isFinite(actual))return null;
        const v=new THREE.Vector3(wx,actual,wz);
        v.metricPoint = typeof config.unproject==='function'?toMetric(config.unproject(wx,wz)):p;
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); row.push(v);
      }
      rows.push(row);
    }
    const corners=[rows[0][0],rows[0][nx],rows[nz][nx],rows[nz][0]].map(p=>[p.x,p.z]);
    const range=config.sampleWorldHeightRange?.(corners);
    if(typeof config.sampleWorldHeightRange==='function'&&!range)return null;
    if(range){minY=Math.min(minY,range.min);maxY=Math.max(maxY,range.max);}
    return {rows, nx, nz, minY, maxY, solidUndersideY:range?minY-units(2):null,samples: (nx + 1) * (nz + 1)};
  }
  function addFoundation(profile, topY) {
    // A closed, low earth-contact plinth. Only the bottom follows the measured
    // terrain; neither terrain vertices nor building walls are deformed.
    const top = p => new THREE.Vector3(p.x, topY, p.z);
    const {rows, nx, nz} = profile;
    const bottom = new Map(), triangles = [];
    for (const row of rows) for (const p of row) bottom.set(p, {point: new THREE.Vector3(p.x,profile.solidUndersideY??p.y-units(2),p.z), metric: p.metricPoint});
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const a = rows[z][x], b = rows[z][x + 1], c = rows[z + 1][x + 1], d = rows[z + 1][x];
      triangles.push([bottom.get(d),bottom.get(c),bottom.get(a)],[bottom.get(c),bottom.get(b),bottom.get(a)]);
    }
    // The DEM can change triangle slope between grid nodes. Probe the actual
    // underside triangles and lower shared vertices locally to close those
    // seams; adjusting an entire building upward would preserve the air gap.
    for (let pass = 0; pass < (profile.solidUndersideY==null?2:0); pass++) for (const triangle of triangles) {
      let lower = 0;
      for (const weights of pass ? [[1/3,1/3,1/3]] : [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]) {
        const metric = [0,1].map(axis => triangle.reduce((sum,v,i) => sum + v.metric[axis] * weights[i], 0));
        const wx=triangle.reduce((sum,v,i)=>sum+v.point.x*weights[i],0),wz=triangle.reduce((sum,v,i)=>sum+v.point.z*weights[i],0);
        const groundY=typeof config.sampleWorldHeight==='function'?config.sampleWorldHeight(wx,wz):pointOnGround(metric)?.y;
        if(!Number.isFinite(groundY))continue;
        const y = triangle.reduce((sum,v,i) => sum + v.point.y * weights[i], 0);
        lower = Math.max(lower, y - groundY + units(2));
      }
      if (lower > units(.01)) {
        for (const vertex of triangle) vertex.point.y -= lower;
        diagnostics.foundationContactCorrections = (diagnostics.foundationContactCorrections || 0) + 1;
      }
    }
    for (const triangle of triangles) for (const vertex of triangle) buildingFoundations.push(vertex.point.x, vertex.point.y, vertex.point.z);
    const below = p => bottom.get(p).point;
    addQuad(buildingFoundations, top(rows[0][0]), top(rows[0][nx]), top(rows[nz][nx]), top(rows[nz][0]));
    const edges = [rows[0], rows.map(row => row[nx]), rows[nz].slice().reverse(), rows.map(row => row[0]).reverse()];
    for (const edge of edges) for (let i = 1; i < edge.length; i++) addQuad(buildingFoundations, below(edge[i - 1]), top(edge[i - 1]), top(edge[i]), below(edge[i]));
  }
  function crossesRoad(point, width, depth, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const radius = Math.hypot(width, depth) / 2, nearby = new Set(), cell = roadIndex.cellSize;
    // Query every cell touched by a large representative footprint, rather
    // than relying on the old 550m centre-only index padding.
    for (let y = Math.floor((point[1] - radius) / cell); y <= Math.floor((point[1] + radius) / cell); y++) for (let x = Math.floor((point[0] - radius) / cell); x <= Math.floor((point[0] + radius) / cell); x++) {
      for (const segment of roadIndex.cells.get(`${x}:${y}`) || []) nearby.add(segment);
    }
    return [...nearby].some(segment => {
      const local = p => [(p[0] - point[0]) * c + (p[1] - point[1]) * s, -(p[0] - point[0]) * s + (p[1] - point[1]) * c];
      const a = local(segment.a), b = local(segment.b), half = [width / 2 + segment.width / 2 + 12, depth / 2 + segment.width / 2 + 12];
      let low = 0, high = 1;
      for (let axis = 0; axis < 2; axis++) {
        const delta = b[axis] - a[axis];
        if (Math.abs(delta) < 1e-9) { if (Math.abs(a[axis]) > half[axis]) return false; }
        else { const u = (-half[axis] - a[axis]) / delta, v = (half[axis] - a[axis]) / delta; low = Math.max(low, Math.min(u, v)); high = Math.min(high, Math.max(u, v)); if (low > high) return false; }
      }
      return true;
    });
  }
  function parcelCentre(source, fallback) {
    const ring = source.rings[0]; let crossSum = 0, x = 0, y = 0;
    for (let i = 1; i < ring.length; i++) { const a = ring[i - 1], b = ring[i], cross = a[0] * b[1] - b[0] * a[1]; crossSum += cross; x += (a[0] + b[0]) * cross; y += (a[1] + b[1]) * cross; }
    const p = crossSum ? [x / (3 * crossSum), y / (3 * crossSum)] : fallback;
    return contains(p, source.rings) && inBoundary(p) && !inWater(p) && !inExclusion(p) ? p : fallback;
  }
  function overlapsBuilding(point, width, depth, angle) {
    const ax = [Math.cos(angle), Math.sin(angle)], az = [-ax[1], ax[0]];
    return occupiedBuildings.at(point).some(other => {
      if(config.primaryBuildingSpacingMeters&&Math.hypot(point[0]-other.point[0],point[1]-other.point[1])<config.primaryBuildingSpacingMeters)return true;
      const bx = [Math.cos(other.angle), Math.sin(other.angle)], bz = [-bx[1], bx[0]], delta = [point[0] - other.point[0], point[1] - other.point[1]];
      return [ax, az, bx, bz].every(axis => {
        const dot = v => Math.abs(v[0] * axis[0] + v[1] * axis[1]);
        return dot(delta) < dot(ax) * width / 2 + dot(az) * depth / 2 + dot(bx) * other.width / 2 + dot(bz) * other.depth / 2 + Math.min(20, Math.min(width, depth, other.width, other.depth) * .12);
      });
    });
  }
  function safeSolidLandFootprint(point, width, depth, angle, building = false) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const corners = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([dx, dy]) => [point[0] + dx * c - dy * s, point[1] + dx * s + dy * c]);
    if (!sourceGuard.allows(corners) || (building && !buildingSourceGuard.allows(corners))) { diagnostics.rejectedSourceFootprints = (diagnostics.rejectedSourceFootprints || 0) + 1; return false; }
    const base = project(toCoordinate(point), 0), {axisX, axisZ} = projectedBuildingAxes(point, angle);
    // Three stores instance transforms in Float32. Test precisely that affine
    // footprint, with a 2 cm display-space margin for GPU addition round-off.
    const sx = width * metresToUnits, sz = depth * metresToUnits;
    const xx = Math.fround(axisX[0] * sx), xz = Math.fround(axisX[1] * sx), zx = Math.fround(axisZ[0] * sz), zz = Math.fround(axisZ[1] * sz), ox = Math.fround(base.x), oz = Math.fround(base.z);
    const margin = 1 + units(.02) / Math.min(sx, sz);
    const displayed = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, z]) => [ox + (xx * x + zx * z) * margin, oz + (xz * x + zz * z) * margin]);
    if (!displayGuard.allows(displayed) || (building && !buildingDisplayGuard.allows(displayed))) { diagnostics.rejectedDisplayFootprints = (diagnostics.rejectedDisplayFootprints || 0) + 1; return false; }
    return true;
  }
  const buildingKind = sourceClass => sourceClass === 'industrial' ? 'industrial' : sourceClass === 'residential' ? 'residential' : ['commercial','retail'].includes(sourceClass) ? 'commercial' : 'generic';
  function assetForBlock(sourceClass, point, candidate) {
    const kind=buildingKind(sourceClass), variants=assets.buildings[kind];
    // A connected source parcel split by the real road network shares one
    // compound family. The grid remains only for the distant legacy exterior.
    const groupKey=candidate?.neighbourhood?.sourceGroupId;
    const groupSeed=groupKey?[...groupKey].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261):null;
    const block=groupSeed==null?hash(Math.floor(point[0]/1300),Math.floor(point[1]/1300),523):hash(groupSeed,groupSeed>>>10,523);
    const index=['generic','residential'].includes(kind) ? Math.min(variants.length-1,Math.floor(block*variants.length)) : candidate?.infill ? (kind==='commercial'?1:kind==='industrial'?(block<.5?0:1):0) : sourceClass === 'retail' ? 1 : block < (kind==='residential'?.57:.53) ? 0 : 1;
    return {kind,asset:variants[Math.min(index,variants.length-1)],block};
  }
  const safeBuildingFootprint = (point, width, depth, angle, displayEnvelope = null) => {
    // Every centre remains in measured developed land, with its own source
    // class. The whole display body still clears real water, roads and reserves.
    if (!atPolygon(urbanIndex, point) || crossesRoad(point, width, depth, angle) || overlapsBuilding(point, width, depth, angle)) return false;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const [dx, dy] of [[0, 0], [-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]) {
      const check = [point[0] + dx * c - dy * s, point[1] + dx * s + dy * c];
      if ((!displayEnvelope&&!atPolygon(urbanIndex, check)) || !inBoundary(check) || inWater(check) || inExclusion(check) || landmarkDistance(check) < config.buildingLandmarkClearanceMeters) return false;
    }
    // Checking five points misses undeveloped holes and gaps between source
    // polygons. Require the complete padded footprint inside their union.
    const face=[[-width/2-.04,-depth/2-.04],[width/2+.04,-depth/2-.04],[width/2+.04,depth/2+.04],[-width/2-.04,depth/2+.04]].map(([dx,dy])=>[point[0]+dx*c-dy*s,point[1]+dx*s+dy*c]);
    face.push(face[0]);
    const box=[Math.min(...face.map(p=>p[0])),Math.min(...face.map(p=>p[1])),Math.max(...face.map(p=>p[0])),Math.max(...face.map(p=>p[1]))];
    const sourceLand=displayEnvelope?displayEnvelope.map(rings=>({rings})):nearbyPolygons(urbanIndex,box);
    try {
      if(!sourceLand.length||polygonClipping.difference([face],...sourceLand.map(p=>p.rings)).length){diagnostics.rejectedIncompleteUrbanSupport=(diagnostics.rejectedIncompleteUrbanSupport||0)+1;return false;}
    } catch {diagnostics.rejectedInvalidUrbanSupport=(diagnostics.rejectedInvalidUrbanSupport||0)+1;return false;}
    return safeSolidLandFootprint(point, width, depth, angle, true);
  };
  // Display envelopes are separately bounded cartographic geometry, never
  // replacements for source urban land. Original placement anchors stay fixed.
  const neighbourhoodSources=new Map((data.neighbourhoodSources||[]).map(row=>[row.id,row.sourceRings.map(ring=>ring.map(toMetric))]));
  // A shared source-group centre controls height rhythm only. It never moves
  // a building, changes its source classification or modifies a road/parcel.
  const neighbourhoodRhythmOrigins=new Map([...neighbourhoodSources].map(([id,rings])=>{
    const box=boundsOf(rings.flat());return[id,toCoordinate([(box[0]+box[2])/2,(box[1]+box[3])/2])];
  }));
  const neighbourhoodEnvelopes=new Map((data.neighbourhoodDisplayEnvelopes||[]).map(row=>[row.id,row.polygons.map(p=>p.map(ring=>ring.map(toMetric)))]));
  function urbanCandidates() {
    const planned=[];
    for(const neighbourhood of data.neighbourhoods||[]){
      const coordinate=neighbourhood.coordinates;
      if(!validCoordinate(coordinate))continue;
      const point=toMetric(coordinate),source=atPolygon(urbanIndex,point);
      if(!source||!inBoundary(point)||inWater(point)||inExclusion(point))continue;
      const distance=landmarkDistance(point);
      if(distance<config.buildingLandmarkClearanceMeters)continue;
      const sourceClass=classAt(point);
      // Never turn an unknown/conflicting source parcel into commercial land.
      if(buildingKind(sourceClass)!==buildingKind(neighbourhood.sourceClass))continue;
      const random=hash(Math.round(point[0]),Math.round(point[1]),718);
      planned.push({point,source,neighbourhood,distance,random,detail:true,
        score:-10-Math.min(2,neighbourhood.widthMeters*neighbourhood.depthMeters/1e6)+random*.01});
      recordCoverage(point,'buildingCandidates');
    }
    diagnostics.plannedNeighbourhoodCandidates=planned.length;

    const candidates=[],seen=new Set(),meanWidth=config.supplementaryLowRiseMeters?(config.supplementaryLowRiseMeters[0]+config.supplementaryLowRiseMeters[1])*.5:(config.buildingFootprintMeters[0]+config.buildingFootprintMeters[1])*.5;
    const push=(point,frontage=null)=>{
      const key=`${Math.round(point[0]/90)}:${Math.round(point[1]/90)}`;if(seen.has(key))return;
      // Large sourced plots are placed first. Smaller low-rise bodies may then
      // fill remaining sourced land along its roads, with identical guards.
      const infill=!!config.supplementaryLowRiseMeters&&qualityWeight(point)>.02;
      if(data.neighbourhoods?.length&&qualityWeight(point)>.02&&!infill)return;
      const source=atPolygon(urbanIndex,point);if(!source||!inBoundary(point)||inWater(point)||inExclusion(point)||nearRoad(point,20))return;
      const distance=landmarkDistance(point);if(distance<config.buildingLandmarkClearanceMeters)return;
      seen.add(key);const random=hash(Math.round(point[0]/80),Math.round(point[1]/80),712);
      recordCoverage(point,'buildingCandidates');
      const historicalPriority=distance<config.landmarkDetailRadiusMeters?2:5;
      candidates.push({point,source,frontage,infill,distance,detail:distance<config.landmarkDetailRadiusMeters,random,score:historicalPriority*(1-qualityWeight(point))+(frontage?0:1)+random*.25});
    };
    for(const road of roads){
      if(road.bridge)continue;
      for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<20)continue;
        const axis=[dx/length,dy/length],normal=[-axis[1],axis[0]],count=Math.max(1,Math.ceil(length/(meanWidth+20)));
        for(let j=0;j<count;j++)for(const side of [-1,1])for(const row of [0,1]){
          const anchor=[mix(a[0],b[0],(j+.5)/count),mix(a[1],b[1],(j+.5)/count)];
          const offset=road.width/2+meanWidth*.44+18+row*(meanWidth*.88+24);
          push([anchor[0]+normal[0]*side*offset,anchor[1]+normal[1]*side*offset],{anchor,axis,segment:[a,b],normal:normal.map(v=>v*side),roadHalf:road.width/2,row});
        }
      }
    }
    diagnostics.sourceRoadFrontageCandidates=candidates.length;
    for(const item of sampleCandidates(urban,urbanIndex,config.maxUrbanGroups*15,options.urbanSampleStepMeters||220,97,20))push(item.point);
    return (function*(){yield* spatialCandidates(planned);yield* spatialCandidates(candidates);})();
  }
  for (const candidate of urbanCandidates()) {
    if (diagnostics.urbanGroups >= config.maxUrbanGroups) break;
    if (!qualityWeight(candidate.point) && representedSmallParcels.has(candidate.source)) continue;
    const smallParcel = candidate.source.area < 500000;
    const centre = !candidate.neighbourhood && !candidate.frontage && smallParcel && !attemptedParcelCentres.has(candidate.source) ? parcelCentre(candidate.source, candidate.point) : candidate.point;
    attemptedParcelCentres.add(candidate.source);
    const nearby = roadIndex.at(centre).slice().sort((a, b) => distanceToSegment(centre, a.a, a.b) - distanceToSegment(centre, b.a, b.b))[0];
    // Buildings follow a supplied nearby major road, or the longest measured
    // parcel edge where no road is available. Random rotations make a city read
    // as scattered objects and have no geographic justification.
    const parcelEdge = candidate.source.rings[0].slice(1).map((b, i) => ({a: candidate.source.rings[0][i], b})).sort((a,b) => Math.hypot(b.b[0]-b.a[0],b.b[1]-b.a[1])-Math.hypot(a.b[0]-a.a[0],a.b[1]-a.a[1]))[0];
    const direction = nearby && distanceToSegment(centre, nearby.a, nearby.b) < 1800 ? nearby : parcelEdge;
    const sourceSegment=candidate.neighbourhood?.alignmentSegment?.map(toMetric);
    const plannedAngle=sourceSegment?.length===2?Math.atan2(sourceSegment[1][1]-sourceSegment[0][1],sourceSegment[1][0]-sourceSegment[0][0]):candidate.neighbourhood?.angleRadians;
    const angle = candidate.neighbourhood ? plannedAngle : candidate.frontage ? Math.atan2(candidate.frontage.axis[1],candidate.frontage.axis[0]) : direction ? Math.atan2(direction.b[1] - direction.a[1], direction.b[0] - direction.a[0]) : 0;
    // One coherent mass per selected source neighbourhood. The previous four
    // displaced boxes spent the budget on fragments, then shrank around roads.
    const count = 1;
    let built = 0;
    for (let i = 0; i < count; i++) {
      const random = hash(Math.round(candidate.point[0]), Math.round(candidate.point[1]), i + 109);
      let point = centre;
      if (!contains(point, candidate.source.rings)) { if (i === 0) point = candidate.point; else continue; }
      let sourceClass = classAt(point);
      const nearLandmark = mix(mix(.92, 1, clamp((landmarkDistance(point) - config.buildingLandmarkClearanceMeters) / 800, 0, 1)),1,qualityWeight(point));
      let industrial = sourceClass === 'industrial', residential = sourceClass === 'residential';
      const chosen=assetForBlock(sourceClass,point,candidate),asset=chosen.asset;
      const depthRatio=candidate.neighbourhood?clamp(candidate.neighbourhood.depthMeters/candidate.neighbourhood.widthMeters,...asset.recommendedDepthToWidth):mix(...asset.recommendedDepthToWidth,clamp(chosen.block*.7+random*.3,0,1));
      const basisAtCentre=projectedBuildingAxes(centre,angle),depthCorrection=Math.hypot(...basisAtCentre.axisX)/Math.hypot(...basisAtCentre.axisZ);
      const slot=candidate.neighbourhood;
      const widthRange=candidate.infill?config.supplementaryLowRiseMeters:config.buildingFootprintMeters;
      let targetWidth = slot
        ? Math.min(slot.widthMeters-2,(slot.depthMeters-2)/(depthRatio*depthCorrection),config.buildingFootprintMeters[1])
        : Math.max(widthRange[0],mix(...widthRange,.25+candidate.random*.7)*nearLandmark)*config.displayScale;
      if(scaleReference&&scaleReference.mode!=='streetwall-and-skyline'){
        const widthFactor=scaleReference.widthFactors[chosen.kind]*mix(...scaleReference.widthVariation,chosen.block*.65+random*.35);
        const desiredBodyWidth=scaleReference.bodyWidth*widthFactor;
        targetWidth=Math.min(targetWidth,desiredBodyWidth/(asset.primaryBody.width*metresToUnits*Math.hypot(...basisAtCentre.axisX)));
      }
      const seedWidth=targetWidth,sourceRegion=slot&&neighbourhoodSources.get(slot.sourceGroupId),displayEnvelope=slot&&neighbourhoodEnvelopes.get(slot.sourceGroupId);
      if(sourceRegion&&scaleReference?.plannedFootprintGrowth)targetWidth*=scaleReference.plannedFootprintGrowth;
      const minimumWidth=slot?config.buildingFootprintMeters[0]-2/Math.min(1,depthRatio*depthCorrection)-.02:widthRange[0];
      if(targetWidth<minimumWidth)continue;
      let width=targetWidth,depth=width*depthRatio,support=null;
      let placed=false;
      const c=Math.cos(angle),s=Math.sin(angle);
      // Search within the same local source-developed block before considering
      // a modest size change. Never fill a leftover slit with a tiny tower.
      for(const factor of (slot&&sourceRegion?[1,.92,.84,.76,.68,.6,1/(scaleReference?.plannedFootprintGrowth||1),.48]:slot?[1,.90,.80]:[1,.90,.78,.65])){
        width=slot?Math.max(minimumWidth,targetWidth*factor):Math.max(widthRange[0]*config.displayScale,targetWidth*factor);depth=width*depthRatio;
        let origin=centre;
        if(candidate.frontage){const f=candidate.frontage,offset=f.roadHalf+depth/2+18+f.row*(depth+24);origin=[f.anchor[0]+f.normal[0]*offset,f.anchor[1]+f.normal[1]*offset];}
        for(const [dx,dy] of (slot?[[0,0]]:[[0,0],[-width*.22,0],[width*.22,0],[0,depth*.22],[0,-depth*.22],[-width*.38,depth*.22],[width*.38,depth*.22]])){
          const trial=[origin[0]+dx*c-dy*s,origin[1]+dx*s+dy*c];
          // Preserve the fixed asset's real rendered proportions through the
          // unchanged regional projection; do not normalize terrain/map axes.
          const trialBasis=projectedBuildingAxes(trial,angle);
          const actualDepth=width*depthRatio*Math.hypot(...trialBasis.axisX)/Math.hypot(...trialBasis.axisZ);
          if(Math.hypot(trial[0]-candidate.point[0],trial[1]-candidate.point[1])>900)continue;
          if(sourceRegion){
            const ring=[[-width/2,-actualDepth/2],[width/2,-actualDepth/2],[width/2,actualDepth/2],[-width/2,actualDepth/2]].map(([dx,dy])=>[trial[0]+dx*c-dy*s,trial[1]+dx*s+dy*c]);ring.push(ring[0]);
            try{if(polygonClipping.difference([ring],...(displayEnvelope||[sourceRegion])).length)continue;}catch{continue;}
          }
          if(!safeBuildingFootprint(trial,width,actualDepth,angle,displayEnvelope))continue;
          if(buildingKind(classAt(trial))!==chosen.kind)continue;
          const profile=footprintGround(trial,width,actualDepth,angle);
          if(!profile||profile.maxY-profile.minY>units(config.maxBuildingFoundationMeters))continue;
          point=trial;depth=actualDepth;support=profile;placed=true;break;
        }
        if(placed)break;
      }
      if(!placed){diagnostics.rejectedWholeBlockCandidates=(diagnostics.rejectedWholeBlockCandidates||0)+1;continue;}
      sourceClass=classAt(point);
      industrial=sourceClass==='industrial';residential=sourceClass==='residential';
      // Land use chooses a representative form, never a surveyed height. Known
      // landmark towers remain responsible for the actual skyline identity.
      const basis = projectedBuildingAxes(point, angle);
      const heightRatio=mix(...asset.recommendedHeightToWidth,clamp(chosen.block*.65+random*.35,0,1));
      const bodyWidth=asset.primaryBody.width*width*metresToUnits*Math.hypot(...basis.axisX);
      const bodyDepth=asset.primaryBody.depth*depth*metresToUnits*Math.hypot(...basis.axisZ);
      // A narrower parcel gets a shorter building, never a stretched tower.
      // Most variation follows the connected source block, with a smaller
      // within-block variation so streets have rhythm without random spikes.
      const district=districtMassing(toCoordinate(point),sourceClass,chosen.block,random,neighbourhoodRhythmOrigins.get(slot?.sourceGroupId)||toCoordinate(point));
      const originalHeight = scaleReference?.mode==='streetwall-and-skyline'
        ? Math.min(
            bodyWidth*mix(...asset.primaryHeightToWidth,chosen.block*.45+random*.55),
            Math.min(bodyWidth,bodyDepth)*asset.maxPrimarySlenderness,
            scaleReference.bodyHeight*scaleReference.maximumBodyHeightRatio,
            scaleReference.maximumBodyVolumeFactor?scaleReference.bodyWidth*scaleReference.bodyDepth*scaleReference.bodyHeight*scaleReference.maximumBodyVolumeFactor/(bodyWidth*bodyDepth):Infinity
          )/asset.primaryBody.height
        : scaleReference
          ? scaleReference.bodyHeight*scaleReference.heightFactors[chosen.kind]*mix(...scaleReference.heightVariation,chosen.block*.65+random*.35)/asset.primaryBody.height
          : width * metresToUnits * Math.hypot(...basis.axisX) * heightRatio;
      // District scaling cannot exceed the already validated body-volume and
      // slenderness ceilings used to construct originalHeight.
      const height=originalHeight*Math.min(1,district.heightMultiplier);
      const allowedRelief = Math.min(units(config.maxBuildingFoundationMeters), originalHeight * .23);
      if (!support || support.maxY - support.minY > allowedRelief) {
        diagnostics.rejectedSteepBuildingParcels++;continue;
      }
      const base = pointOnGround(point); if (!base) continue;
      base.y = support.maxY + units(8);
      addFoundation(support, base.y);
      diagnostics.buildingSupportSamples += support.samples;
      diagnostics.maxBuildingFoundationDisplayMeters = Math.max(diagnostics.maxBuildingFoundationDisplayMeters, (base.y - support.minY + units(2)) / metresToUnits);
      if (inUrbanFocus(point)) diagnostics.urbanFocusBuildings++;
      if(candidate.frontage)diagnostics.roadAlignedBlockGroups=(diagnostics.roadAlignedBlockGroups||0)+1;
      if (diagnostics.buildingGroundingSamples.length < 48) diagnostics.buildingGroundingSamples.push({coordinate: toCoordinate(point), width, depth, angle, baseY: base.y, minGroundY: support.minY, maxGroundY: support.maxY, samples: support.samples});
      const rows = {industrial:industrialRows,residential:residentialRows,commercial:commercialRows,generic:buildingRows}[chosen.kind];
      const paletteKey=buildingPalette(sourceClass,chosen.block);
      const placement={districtLevel:district.level,districtZone:district.zone,displayPalette:paletteKey,sourceCoordinate:toCoordinate(point),sourceClass,supplementaryLowRise:!!candidate.infill,
        heightRhythm:district.rhythm,
        sourceParcelId:slot?.id??null,compoundGroupId:slot?.sourceGroupId??null,
        orientationRad:angle,alignmentBasis:slot?.alignmentBasis??(candidate.frontage?'source-road-frontage':direction===nearby?'source-road-frontage':'source-parcel-axis'),
        alignmentSegment:slot?.alignmentSegment??(candidate.frontage?candidate.frontage.segment.map(toCoordinate):direction?[toCoordinate(direction.a),toCoordinate(direction.b)]:null),
        sourceFootprint:slot?.footprint??null,sourceRegionId:sourceRegion?slot.sourceGroupId:null,displayEnvelopeId:displayEnvelope?slot.sourceGroupId:null,maximumSourceEdgeExtensionMeters:displayEnvelope?scaleReference.maximumSourceEdgeExtensionMeters:0,expandedFromSeed:!!(slot&&width>seedWidth+.1),widthMeters:width,depthMeters:depth,
        ...(scaleReference?{scaleReferenceId:scaleReference.referenceId,primaryBodyWorldSize:{width:asset.primaryBody.width*width*metresToUnits*Math.hypot(...basis.axisX),height:asset.primaryBody.height*height,depth:asset.primaryBody.depth*depth*metresToUnits*Math.hypot(...basis.axisZ)}}:{})};
      rows.push({position: base, scale: [width * metresToUnits, height, depth * metresToUnits], ...basis, paletteKey,assetId:asset.id,placement});
      if(slot){diagnostics.plannedNeighbourhoods=(diagnostics.plannedNeighbourhoods||0)+1;diagnostics.compoundSourceGroups||={};diagnostics.compoundSourceGroups[slot.sourceGroupId]=(diagnostics.compoundSourceGroups[slot.sourceGroupId]||0)+1;}
      diagnostics.representativeBuildings=(diagnostics.representativeBuildings||0)+(asset.buildingCount||1);
      const radius = Math.hypot(width, depth) / 2 + Math.max(...config.buildingFootprintMeters);
      occupiedBuildings.add({point, width, depth, angle}, [point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius]);
      diagnostics.buildingClassCounts[sourceClass] = (diagnostics.buildingClassCounts[sourceClass] || 0) + 1;
      diagnostics.buildingSourceWidthMinMeters = Math.min(diagnostics.buildingSourceWidthMinMeters ?? Infinity, width);
      diagnostics.buildingSourceWidthMaxMeters = Math.max(diagnostics.buildingSourceWidthMaxMeters || 0, width);
      diagnostics.buildingSourceWidthTotalMeters = (diagnostics.buildingSourceWidthTotalMeters || 0) + width;
      if(candidate.infill)diagnostics.supplementaryLowRise=(diagnostics.supplementaryLowRise||0)+1;
      if(slot&&width>seedWidth+.1)diagnostics.expandedSourceBuildings=(diagnostics.expandedSourceBuildings||0)+1;
      diagnostics.districtBands||={low:0,medium:0,high:0};diagnostics.districtBands[district.level]++;
      diagnostics.buildingBlocks++; built++;
      recordCoverage(point,'buildings');
    }
    if (built) { diagnostics.urbanGroups++; if (smallParcel && !qualityWeight(centre)) representedSmallParcels.add(candidate.source); }
  }
  // Planted urban trees are representative streetscape, not surveyed tree points.
  // Every crown still clears full building footprints, real roads and water.
  const urbanGreen=metricPolygons(data.urbanGreenAreas),urbanGreenIndex=polygonIndex(urbanGreen);
  const greenStems=[],greenCrowns=[],greenSeen=new Set();
  diagnostics.urbanGreenery={trees:0,streetTrees:0,parkTrees:0,courtyardTrees:0,policy:'Representative planted trees in source urban/park/grass areas; coordinates are display samples, not mapped individual trees.'};
  const greenCandidates=[];
  const queueGreen=(point,role,radius=43)=>{const key=point.map(n=>Math.round(n/32)).join(':');if(greenSeen.has(key))return;greenSeen.add(key);greenCandidates.push({point,role,radius});};
  // Sample cumulative road length, including short source segments. Start/end
  // vertex density must not decide whether an avenue receives planted verges.
  for(const road of roads){
    if(road.bridge||road.tunnel)continue;
    let next=45;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      if(length<.01)continue;const normal=[-dy/length,dx/length];
      for(;next<length;next+=110)for(const side of [-1,1]){
        const radius=road.width>45?44:35,offset=road.width/2+radius+16;
        queueGreen([a[0]+dx*next/length+normal[0]*side*offset,a[1]+dy*next/length+normal[1]*side*offset],'streetTrees',radius);
      }
      next-=length;
    }
  }
  for(const g of urbanGreen)for(let x=g.bounds[0]+65;x<g.bounds[2];x+=145)for(let y=g.bounds[1]+65;y<g.bounds[3];y+=145){if(contains([x,y],g.rings))queueGreen([x,y],'parkTrees',48);}
  for(const row of [...buildingRows,...residentialRows,...commercialRows,...industrialRows]){
    const p=toMetric(row.placement.sourceCoordinate),w=row.placement.widthMeters,d=row.placement.depthMeters,a=row.placement.orientationRad,c=Math.cos(a),ss=Math.sin(a);
    const at=(x,y)=>[p[0]+c*x-ss*y,p[1]+ss*x+c*y];
    for(const side of [-1,1]){
      for(let x=-w/2+35;x<w/2;x+=95)queueGreen(at(x,side*(d/2+40)),'courtyardTrees',31);
      for(let y=-d/2+35;y<d/2;y+=95)queueGreen(at(side*(w/2+40),y),'courtyardTrees',31);
    }
  }
  const eligible=p=>!!atPolygon(urbanIndex,p)||!!atPolygon(urbanGreenIndex,p);
  // Thin gaps receive smaller planting rather than a full-size crown pushed
  // into the street or into the neighbouring building.
  for(const candidate of spatialCandidates(greenCandidates.map(r=>({...r,score:hash(Math.round(r.point[0]),Math.round(r.point[1]),827)})))){
    if(greenStems.length>=10000)break;
    const {point,role}=candidate;if(!inUrbanFocus(point)||!eligible(point)||inWater(point)||inExclusion(point)||landmarkDistance(point)<config.treeLandmarkClearanceMeters)continue;
    const r=hash(Math.round(point[0]),Math.round(point[1]),841);
    for(const shrink of [1,.67]){
      const radius=candidate.radius*shrink;
      if(nearRoad(point,radius+6)||![[0,0],[-radius,-radius],[radius,-radius],[radius,radius],[-radius,radius]].every(([x,y])=>eligible([point[0]+x,point[1]+y])))continue;
      if(overlapsBuilding(point,radius*2+8,radius*2+8,0)||!safeSolidLandFootprint(point,radius*2,radius*2,0,false))continue;
      const basis=projectedBuildingAxes(point,0),base=pointOnGround(point);if(!base)continue;
      const stemGround=footprintGround(point,14,14,0,true);if(!stemGround||stemGround.maxY-stemGround.minY>units(30))continue;
      base.y=stemGround.maxY;const h=units((role==='parkTrees'?160:130)+r*40)*Math.sqrt(shrink),stemTop=base.y+h*.40,stemBottom=stemGround.minY-units(2);
      const row={position:base.clone().add(new THREE.Vector3(0,h*.72,0)),scale:[units(radius),h*.46,units(radius)],...basis,colour:['#39734f','#57824b','#6d9256'][Math.floor(r*3)],placement:{sourceCoordinate:toCoordinate(point),role,representativePlanting:true}};
      if(!crownClearsTerrain(broadCrown,row,point,0))continue;
      const extent=crownSpacingAllows(point,row,broadCrown,0);if(!extent)continue;
      placedTrees.add(extent,[point[0]-250,point[1]-250,point[0]+250,point[1]+250]);
      greenCrowns.push(row);greenStems.push({position:new THREE.Vector3(base.x,(stemTop+stemBottom)/2,base.z),scale:[units(6),stemTop-stemBottom,units(6)],...basis,placement:row.placement});
      diagnostics.urbanGreenery.trees++;diagnostics.urbanGreenery[role]++;break;
    }
  }
  makeInstances('Urban planted tree stems',assets.trees.trunk.geometry,material({color:'#78614d'}),greenStems);
  makeInstances('Urban planted tree crowns',broadCrown,material({color:'#ffffff',vertexColors:true}),greenCrowns);
  greenStems.length=greenCrowns.length=greenCandidates.length=urbanGreen.length=0;greenSeen.clear();urbanGreenIndex.clear();
  sourceGuard.dispose(); displayGuard.dispose(); buildingSourceGuard.dispose(); buildingDisplayGuard.dispose();
  if (buildingFoundations.length) {
    const shape = geometry(new THREE.BufferGeometry());
    shape.setAttribute('position', new THREE.Float32BufferAttribute(buildingFoundations, 3)); shape.computeVertexNormals(); shape.computeBoundingSphere();
    const mesh = new THREE.Mesh(shape, material({color: '#a49b84', side: THREE.DoubleSide}));
    mesh.name = 'Terrain-contact building foundations'; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    diagnostics.foundationTriangles = buildingFoundations.length / 9; diagnostics.triangles += diagnostics.foundationTriangles;
  }
  // Fixed, versioned assets are loaded once for the active city. Instances
  // reuse the asset geometry; their transforms still come from guarded GIS.
  // Palette batches share the fixed geometry and keep every placement matrix.
  // Separate wall/glass colours leave aluminium and glass reflection intact;
  // instanceColor would multiply all three material slots indiscriminately.
  const citySurfaces=new Map();
  const paletteSurface=key=>{
    if(!citySurfaces.has(key)){
      const surfaces=createCityAssetMaterials(BUILDING_PALETTES[key]);
      for(const surface of surfaces)materials.add(surface);
      citySurfaces.set(key,surfaces);
    }
    return citySurfaces.get(key);
  };
  diagnostics.buildingPalettes={counts:{},batches:0,policy:'Coherent source-block display colours by available land use; not surveyed facade colours. Metal and reflective material properties retain the City Kit defaults.'};
  diagnostics.sharedAssets={version:assets.version,buildings:{},trees:[],roadProfile:assets.roadProfile,roadComponents:[assets.roads.deck.id,assets.roads.pier.id]};
  for(const [kind,rows,prefix] of [
    ['generic',buildingRows,'Source urban footprint grouped building volumes'],
    ['residential',residentialRows,'Source residential neighbourhood volumes'],
    ['commercial',commercialRows,'Source commercial neighbourhood volumes'],
    ['industrial',industrialRows,'Source industrial neighbourhood volumes'],
  ]){
    const variants=assets.buildings[kind],batches=variants.map(()=>new Map());
    for(let i=0;i<rows.length;i++){
      const {assetId,paletteKey,...row}=rows[i];
      const v=variants.findIndex(asset=>asset.id===assetId);
      if(v<0)throw new Error('Placed asset is not registered in its source land-use family.');
      if(!batches[v].has(paletteKey))batches[v].set(paletteKey,[]);
      batches[v].get(paletteKey).push(row);
      diagnostics.buildingPalettes.counts[paletteKey]=(diagnostics.buildingPalettes.counts[paletteKey]||0)+1;
    }
    variants.forEach((asset,i)=>{
      let count=0;
      for(const [paletteKey,placed] of batches[i]){
        const mesh=makeInstances(prefix+' / '+asset.id+' / '+paletteKey,asset.geometry,paletteSurface(paletteKey),placed);
        if(mesh)Object.assign(mesh.userData,{cityAssetId:asset.id,cityAssetRole:'ordinary-building',cityAssetClass:kind,buildingPalette:paletteKey,displayUnit:asset.displayUnit||'compound',buildingCount:asset.buildingCount||1});
        count+=placed.length;diagnostics.buildingPalettes.batches++;
      }
      diagnostics.sharedAssets.buildings[asset.id]=count;
    });
  }
  diagnostics.assetScalePolicy=scaleReference?.policy||'The selected fixed asset supplies actual height/width and depth/width ranges before footprint placement.';
  if(scaleReference)diagnostics.buildingScaleReference=scaleReference;
  diagnostics.sharedAssets.trees=[assets.trees.broadCrown.id,assets.trees.uprightCrown.id,assets.trees.trunk.id];
  diagnostics.urbanRepresentation = 'Large varied principal buildings occupy connected sourced land-use blocks split by real major roads. Seed anchors stay in their original source region; schematic model edges may expand by at most 80 m inside separately stored envelopes bounded by real roads and natural exclusions; remaining buildings use the same scale and safety rules. Internal architecture is representative, not a surveyed estate.';
  diagnostics.buildingGroundingPolicy = 'Foundation edges use the exact realized Float32 affine building footprint. Dense full-footprint actual-world terrain profile, reject or reduce steep footprints, then a closed low foundation. Whole-footprint clipped terrain extrema bound a solid underside below every ground triangle; eight display metres of top margin keep the building above relief. Terrain stays unchanged.';
  diagnostics.forestRepresentation = 'Individually rooted trees in measured forest, distributed by spatial-cell round robin with equal main-city weighting and a gradual outer transition. Each tree keeps full-footprint, road, water, stem and actual Float32 crown-terrain checks; the budget counts individual stems.';
  diagnostics.coveragePolicy = 'Shared building detail and full scale throughout the main-city bounds, independent of landmark distance. Candidate opportunities rotate through 2.4 km source cells; a 3 km exterior transition changes priority and historical scale gradually. Actual land class, source coverage and safe supported footprints determine realised density.';
  diagnostics.buildingSourceWidthMeanMeters = diagnostics.buildingBlocks ? diagnostics.buildingSourceWidthTotalMeters / diagnostics.buildingBlocks : 0;

  diagnostics.drawCalls = group.children.reduce((n,o)=>n+(Array.isArray(o.material)?o.geometry.groups.length:1),0);
  diagnostics.metresToUnits = metresToUnits;
  diagnostics.displayScale = config.displayScale;
  diagnostics.roadReceiveShadow = config.roadReceiveShadow;
  representedSmallParcels.clear(); attemptedParcelCentres.clear(); crownVertices.clear();forestSeeds.length=0;
  // CPU lookup tables are construction-only. GPU ownership stays local to this
  // module so a city switch can release everything with one idempotent call.
  for (const index of [forestIndex, urbanIndex, waterIndex, boundaryIndex, roadIndex, exclusionIndex, classIndex, occupiedBuildings, placedTrees]) index.clear();
  for (const rows of [roadTop, roadSides, curbFaces, pierRows, trunkRows, broadRows, coneRows, buildingRows, residentialRows, commercialRows, industrialRows, buildingFoundations, forest, urban, water, boundary, roads, landmarks, exclusions, classPolygons]) rows.length = 0;
  function dispose() {
    if (diagnostics.disposed) return;
    diagnostics.disposed = true; group.removeFromParent();
    for (const mesh of instances) mesh.dispose?.();
    for (const value of geometries) value.dispose();
    for (const value of materials) value.dispose();
    geometries.clear(); materials.clear(); instances.length = 0; group.clear();
  }
  return {group, diagnostics, dispose};
}
