// Source-driven, deterministic display planning. All public coordinates are
// WGS84; dimensions are metres. No authored asset is a surveyed building.
const SCHEMA = 'city-build-plan-v1';
const METRES = 111320;
const EPS = 1e-5;
const ASSETS = Object.freeze({
  residential: ['residential-slab', 'residential-twins', 'residential-gallery', 'residential-point'],
  commercial: ['commercial-office', 'commercial-block'],
  industrial: ['industrial-sheds', 'industrial-logistics'],
  generic: ['generic-courtyard', 'generic-stepped', 'generic-ribbon', 'generic-point'],
});
const ROAD_WIDTHS = {motorway: 24, trunk: 20, primary: 14, secondary: 10};
const DEFAULTS = {maxFeatures: 5000, maxBuildings: 2000, maxRoads: 1500, maxTrees: 1200, maxPolygons: 2000,
  maxCoordinates: 250000, maxGeometryCoordinates: 12000, treeSpacingMeters: 28, maxHeightMeters: 300,
  maxSlenderness: 6, estimatedBuildingHeightMeters: 15, maxBuildingDimensionMeters: 300};
const CAPS = {maxFeatures: 10000, maxBuildings: 4000, maxRoads: 3000, maxTrees: 2500, maxPolygons: 4000,
  maxCoordinates: 500000, maxGeometryCoordinates: 30000};
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const coordinate = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const bounds = points => points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const touches = (a, b) => a[0] <= b[2] + EPS && a[2] + EPS >= b[0] && a[1] <= b[3] + EPS && a[3] + EPS >= b[1];
const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const issue = (code, severity, message, extra = {}) => ({code, severity, message, ...extra});
const tagged = value => value === true || value === 1 || (typeof value === 'string' && !['', 'no', 'false', '0'].includes(value.toLowerCase()));
function hash(text) { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function options(display) {
  if (!display || typeof display !== 'object' || Array.isArray(display)) throw new TypeError('City plan display must be an object.');
  const result = {...DEFAULTS};
  for (const [name, value] of Object.entries(DEFAULTS)) {
    if (display[name] == null) continue;
    if (!Number.isFinite(display[name])) throw new TypeError(`City plan display.${name} must be finite.`);
    if (name.startsWith('max') && name in CAPS) result[name] = Math.floor(clamp(display[name], 0, CAPS[name]));
    else result[name] = display[name];
  }
  result.treeSpacingMeters = clamp(result.treeSpacingMeters, 8, 200);
  result.maxHeightMeters = clamp(result.maxHeightMeters, 3, 600);
  result.maxSlenderness = clamp(result.maxSlenderness, 1, 10);
  result.estimatedBuildingHeightMeters = clamp(result.estimatedBuildingHeightMeters, 3, 100);
  result.maxBuildingDimensionMeters = clamp(result.maxBuildingDimensionMeters, 5, 500);
  return result;
}

function geometryPolygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function validateGeometry(geometry, maxCoordinates, polygonOnly = false) {
  let count = 0;
  const line = (points, ring = false) => {
    if (!Array.isArray(points) || points.length < (ring ? 4 : 2)) throw new TypeError('Geometry requires complete lines and closed rings.');
    if (ring && !same(points[0] || [], points.at(-1) || [])) throw new TypeError('Polygon rings must be closed.');
    for (let i = 0; i < points.length; i++) {
      if (++count > maxCoordinates) throw new RangeError('Geometry coordinate budget exceeded.');
      if (!coordinate(points[i])) throw new TypeError('Geometry requires finite WGS84 coordinates within latitude ±85.');
      if (i && Math.abs(points[i][0] - points[i - 1][0]) > 180) throw new RangeError('Antimeridian geometry needs explicit preprocessing.');
    }
    if (ring && Math.abs(area(points.map(p => [p[0] - points[0][0], p[1] - points[0][1]]))) < 1e-14) throw new RangeError('Polygon ring has zero area.');
  };
  if (['Polygon', 'MultiPolygon'].includes(geometry?.type)) {
    const polygons = geometryPolygons(geometry);
    if (!Array.isArray(polygons) || !polygons.length) throw new TypeError('Polygon geometry is empty.');
    for (const rings of polygons) {
      if (!Array.isArray(rings) || !rings.length) throw new TypeError('Polygon needs an outer ring.');
      for (const ring of rings) line(ring, true);
    }
  } else if (!polygonOnly && geometry?.type === 'LineString') line(geometry.coordinates);
  else if (!polygonOnly && geometry?.type === 'MultiLineString') {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new TypeError('Line geometry is empty.');
    for (const points of geometry.coordinates) line(points);
  } else if (!polygonOnly && geometry?.type === 'Point' && coordinate(geometry.coordinates)) count = 1;
  else throw new TypeError('Unsupported or invalid source geometry.');
  return count;
}

function projection(boundary) {
  if (boundary?.type !== 'Feature') throw new TypeError('City plan boundary must be a GeoJSON Feature.');
  validateGeometry(boundary.geometry, 60000, true);
  const b = bounds(geometryPolygons(boundary.geometry).flatMap(rings => rings[0]));
  const lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2, xScale = METRES * Math.cos(lat * Math.PI / 180);
  if (b[2] - b[0] > 15 || b[3] - b[1] > 15) throw new RangeError('Boundary exceeds the bounded local city projection; preprocess a smaller region.');
  return {to: p => [(p[0] - lon) * xScale, (p[1] - lat) * METRES], from: p => [lon + p[0] / xScale, lat + p[1] / METRES],
    origin: [lon, lat], metresPerLongitudeDegree: xScale};
}

function onSegment(p, a, b) {
  return Math.abs(cross(a, b, p)) <= EPS * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])) &&
    p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
function intersects(a, b, c, d) {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
  return ((ac > 0 && ad < 0 || ac < 0 && ad > 0) && (ca > 0 && cb < 0 || ca < 0 && cb > 0)) ||
    onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
const ringRows = new WeakMap();
function indexRing(ring) {
  if (ring.length < 64) return;
  const b = bounds(ring), step = Math.max(.1, (b[3] - b[1]) / 128), rows = new Map();
  edges(ring, (a, b) => {
    for (let y = Math.floor(Math.min(a[1], b[1]) / step); y <= Math.floor(Math.max(a[1], b[1]) / step); y++) {
      if (!rows.has(y)) rows.set(y, []); rows.get(y).push([a, b]);
    }
  });
  ringRows.set(ring, {rows, step});
}
function inRing(p, ring, includeEdge = true) {
  let inside = false;
  const indexed = ringRows.get(ring), candidates = indexed ? indexed.rows.get(Math.floor(p[1] / indexed.step)) || [] : null;
  const count = candidates ? candidates.length : ring.length - 1;
  for (let i = 0; i < count; i++) {
    const [a, b] = candidates ? candidates[i] : [ring[i], ring[i + 1]];
    if (onSegment(p, a, b)) return includeEdge;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const inPolygon = (p, polygon) => touches([p[0], p[1], p[0], p[1]], polygon.bounds) && inRing(p, polygon.rings[0], false) && !polygon.rings.slice(1).some(ring => inRing(p, ring));
const preparePolygon = (rings, project = p => p) => {
  const metric = rings.map(ring => ring.map(project)), b = bounds(metric[0]);
  const edgeIndex = spatialIndex(Math.max(10, Math.max(b[2] - b[0], b[3] - b[1]) / 128));
  for (const ring of metric) {
    indexRing(ring);
    edges(ring, (a, b) => edgeIndex.add({a, b, bounds: bounds([a, b])}));
  }
  return {rings: metric, bounds: b, edgeIndex};
};
function edges(ring, visit) { for (let i = 1; i < ring.length; i++) if (visit(ring[i - 1], ring[i]) === false) return false; return true; }
function facesIntersect(a, b) {
  if (!touches(bounds(a), bounds(b))) return false;
  if (a.some(p => inRing(p, b)) || b.some(p => inRing(p, a))) return true;
  return edges(a, (p, q) => edges(b, (r, s) => !intersects(p, q, r, s))) === false;
}
function containsFace(polygon, face) {
  if (!face.every(p => inPolygon(p, polygon))) return false;
  // Checking only corners misses a lake/hole entirely enclosed by a rectangle.
  return polygon.edgeIndex.query(bounds(face)).every(({a, b}) => !inRing(a, face) && edges(face, (c, d) => !intersects(a, b, c, d)));
}
function overlapsPolygon(face, polygon) {
  if (!touches(bounds(face), polygon.bounds)) return false;
  if (face.some(p => inPolygon(p, polygon))) return true;
  return polygon.edgeIndex.query(bounds(face)).some(({a, b}) => inRing(a, face) || edges(face, (c, d) => !intersects(a, b, c, d)) === false);
}

// Large features use an overflow bucket, so long road edges cannot allocate an
// unbounded number of grid cells. Queries have the same bound.
function spatialIndex(cell = 160) {
  const bins = new Map(), overflow = [], all = [];
  const keys = b => {
    const x0 = Math.floor(b[0] / cell), x1 = Math.floor(b[2] / cell), y0 = Math.floor(b[1] / cell), y1 = Math.floor(b[3] / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) return null;
    const result = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x}:${y}`); return result;
  };
  return {
    add(item) { all.push(item); const cells = keys(item.bounds); if (!cells) overflow.push(item); else for (const key of cells) { if (!bins.has(key)) bins.set(key, []); bins.get(key).push(item); } },
    query(b) { const cells = keys(b); return (cells ? [...new Set([...overflow, ...cells.flatMap(key => bins.get(key) || [])])] : all).filter(item => touches(item.bounds, b)); },
  };
}

function distanceSegment(p, a, b) {
  const x = b[0] - a[0], y = b[1] - a[1], d = x * x + y * y;
  const t = d ? clamp(((p[0] - a[0]) * x + (p[1] - a[1]) * y) / d, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
}
function roadTouchesFace(road, face) {
  const {a, b, radius} = road;
  if (inRing(a, face) || inRing(b, face)) return true;
  return edges(face, (p, q) => !intersects(a, b, p, q) && Math.min(distanceSegment(p, a, b), distanceSegment(q, a, b), distanceSegment(a, p, q), distanceSegment(b, p, q)) > radius + EPS) === false;
}

function context(plan, project) {
  const land = geometryPolygons(plan.boundary.geometry).map(rings => preparePolygon(rings, project.to));
  const water = spatialIndex(), roads = spatialIndex(), landmarkFootprints = spatialIndex();
  for (const item of plan.water) water.add({...preparePolygon(item.rings, project.to), item});
  for (const item of plan.landmarkFootprints || []) landmarkFootprints.add({...preparePolygon(item.rings, project.to), item});
  for (const item of plan.roads) {
    if (item.tunnel) continue;
    const points = item.coordinates.map(project.to), radius = item.widthMeters / 2;
    edges(points, (a, b) => { const bb = bounds([a, b]); roads.add({a, b, radius, item, bounds: [bb[0] - radius, bb[1] - radius, bb[2] + radius, bb[3] + radius]}); });
  }
  const reason = face => {
    if (!land.some(polygon => containsFace(polygon, face))) return 'outside-boundary';
    if (water.query(bounds(face)).some(polygon => overlapsPolygon(face, polygon))) return 'over-water';
    if (roads.query(bounds(face)).some(road => roadTouchesFace(road, face))) return 'over-road';
    if (landmarkFootprints.query(bounds(face)).some(polygon => overlapsPolygon(face, polygon))) return 'over-landmark-footprint';
    return null;
  };
  return {land, water, roads, reason};
}

function rectangle(center, width, depth, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const face = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [center[0] + x * width / 2 * c - y * depth / 2 * s, center[1] + x * width / 2 * s + y * depth / 2 * c]);
  return [...face, [...face[0]]];
}

function representativeRectangle(polygon, maxDimension) {
  const ring = polygon.rings[0], average = ring.slice(0, -1).reduce((p, q) => [p[0] + q[0] / (ring.length - 1), p[1] + q[1] / (ring.length - 1)], [0, 0]);
  let longest = 0, angle = 0;
  edges(ring, (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d > longest) { longest = d; angle = Math.atan2(b[1] - a[1], b[0] - a[0]); } });
  let best = null;
  for (const rotation of [...new Set([angle, 0])]) {
    const c = Math.cos(rotation), s = Math.sin(rotation), local = ring.map(p => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]), b = bounds(local);
    const width = Math.min(maxDimension, b[2] - b[0]), depth = Math.min(maxDimension, b[3] - b[1]);
    const toWorld = p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
    const centers = [average, toWorld([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])];
    for (const x of [.2, .5, .8]) for (const y of [.2, .5, .8]) centers.push(toWorld([b[0] + (b[2] - b[0]) * x, b[1] + (b[3] - b[1]) * y]));
    for (let ci = 0; ci < centers.length; ci++) {
      if (ci >= 2 && best && best.width * best.depth > Math.abs(area(ring)) * .35) break;
      const center = centers[ci]; if (!inPolygon(center, polygon)) continue;
      let low = 0, high = 1;
      for (let k = 0; k < 16; k++) { const mid = (low + high) / 2; if (containsFace(polygon, rectangle(center, width * mid, depth * mid, rotation))) low = mid; else high = mid; }
      const w = width * low * .995, d = depth * low * .995;
      if (w >= 2 && d >= 2 && (!best || w * d > best.width * best.depth)) best = {center, width: w, depth: d, rotation, face: rectangle(center, w, d, rotation)};
    }
  }
  return best;
}

function lengthMetres(value) {
  if (typeof value === 'number') return value > 0 && Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  return match && Number(match[1]) > 0 ? Number(match[1]) * (/^(ft|feet|')$/i.test(match[2] || '') ? .3048 : 1) : null;
}
function buildingFamily(tags) {
  const kind = String(tags.building || '').toLowerCase();
  if (['apartments', 'residential', 'house', 'detached', 'terrace', 'dormitory', 'semidetached_house'].includes(kind) || tags['building:use'] === 'residential') return 'residential';
  if (['industrial', 'warehouse', 'manufacture', 'factory'].includes(kind) || tags['building:use'] === 'industrial') return 'industrial';
  if (['commercial', 'retail', 'office', 'hotel', 'supermarket'].includes(kind) || tags.office || tags.shop) return 'commercial';
  return 'generic';
}

/**
 * Supported source tags: building/building:levels/height, major highway classes,
 * bridge/tunnel/width/lanes, natural=water|wood, water, waterway=riverbank,
 * landuse=reservoir|forest|grass|meadow|recreation_ground, leisure=park|garden.
 * A cap is a declared partial result. Unknown areas never receive infill.
 */
export function buildCityPlan({boundary, features, landmarks = [], display = {}} = {}) {
  const project = projection(boundary), limits = options(display);
  if (features?.type !== 'FeatureCollection' || !Array.isArray(features.features)) throw new TypeError('City plan features must be a GeoJSON FeatureCollection.');
  if (!Array.isArray(landmarks) || landmarks.length > 1000) throw new TypeError('City plan landmarks must be an array of at most 1000 entries.');
  const plan = {schema: SCHEMA, boundary: clone(boundary), landmarks: clone(landmarks), display: clone(display), limits,
    buildings: [], roads: [], water: [], green: [], trees: [], landmarkFootprints: [], sourceIssues: [], stats: {}, issues: []};
  const notes = plan.sourceIssues, candidates = [], ids = new Set();
  const sourceStats = {inputFeatures: features.features.length, consideredFeatures: Math.min(features.features.length, limits.maxFeatures), sourceBuildings: 0,
    sourceRoads: 0, sourceWater: 0, sourceGreen: 0, invalidFeatures: 0, coordinates: 0, estimatedHeights: 0};
  if (features.features.length > limits.maxFeatures) notes.push(issue('feature-budget', 'warning', `Only the first ${limits.maxFeatures} of ${features.features.length} source features were considered.`));
  const selected = features.features.slice(0, limits.maxFeatures).map((feature, index) => ({feature, index, id: feature?.id ?? feature?.properties?.id ?? feature?.properties?.['@id']}))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)) || a.index - b.index);
  for (const {feature, index, id} of selected) {
    const sourceId = id == null ? `missing-id-${index}` : String(id), extra = {sourceId};
    if (id == null) { notes.push(issue('missing-source-id', 'warning', 'Feature skipped because a stable source id is missing.', extra)); sourceStats.invalidFeatures++; continue; }
    if (ids.has(sourceId)) { notes.push(issue('duplicate-source-id', 'warning', 'Duplicate source feature skipped.', extra)); continue; } ids.add(sourceId);
    try {
      if (feature?.type !== 'Feature') throw new TypeError('Source entry must be a GeoJSON Feature.');
      const count = validateGeometry(feature.geometry, limits.maxGeometryCoordinates);
      if (sourceStats.coordinates + count > limits.maxCoordinates) { notes.push(issue('coordinate-budget', 'warning', 'Remaining source geometry exceeds the total coordinate budget.', extra)); break; }
      sourceStats.coordinates += count;
    } catch (error) { notes.push(issue('invalid-source-geometry', 'warning', error.message, extra)); sourceStats.invalidFeatures++; continue; }
    const tags = {...(feature.properties || {}), ...(feature.properties?.tags || {})}, polygons = geometryPolygons(feature.geometry);
    if (tagged(tags.building) && !['construction', 'proposed', 'demolished', 'ruins'].includes(String(tags.building))) {
      if (!polygons.length) { notes.push(issue('building-footprint-missing', 'warning', 'A building requires its sourced polygon footprint.', extra)); continue; }
      sourceStats.sourceBuildings += polygons.length;
      polygons.forEach((rings, part) => candidates.push({sourceId, id: `building:${sourceId}:${part}`, rings, tags}));
    }
    const roadClass = String(tags.highway || '').replace(/_link$/, '');
    if (Object.hasOwn(ROAD_WIDTHS, roadClass)) {
      const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
      if (!lines.length) notes.push(issue('road-line-missing', 'warning', 'A major road requires source line geometry.', extra));
      const width = lengthMetres(tags.width), lanes = Number(tags.lanes), inferred = Number.isFinite(lanes) && lanes > 0 && lanes <= 16 ? lanes * 3.3 : ROAD_WIDTHS[roadClass];
      for (const [part, coordinates] of lines.entries()) {
        sourceStats.sourceRoads++;
        if (plan.roads.length >= limits.maxRoads) continue;
        plan.roads.push({id: `road:${sourceId}:${part}`, sourceId, coordinates: clone(coordinates), widthMeters: clamp(width || inferred, 3, 60),
          bridge: tagged(tags.bridge), tunnel: tagged(tags.tunnel), class: String(tags.highway), widthSource: width ? 'source-width' : Number.isFinite(lanes) && lanes > 0 && lanes <= 16 ? 'source-lanes-estimate' : 'class-display-estimate'});
      }
    }
    const isWater = tags.natural === 'water' || tagged(tags.water) || tags.waterway === 'riverbank' || ['reservoir', 'basin'].includes(tags.landuse);
    const isGreen = tags.natural === 'wood' || ['forest', 'grass', 'meadow', 'recreation_ground'].includes(tags.landuse) || ['park', 'garden'].includes(tags.leisure);
    if (isWater || isGreen) for (const [part, rings] of polygons.entries()) {
      const list = isWater ? plan.water : plan.green, kind = isWater ? 'water' : 'green'; sourceStats[isWater ? 'sourceWater' : 'sourceGreen']++;
      if (list.length < limits.maxPolygons) list.push({id: `${kind}:${sourceId}:${part}`, sourceId, rings: clone(rings), kind: String(tags.natural || tags.landuse || tags.leisure || kind),
        ...(isWater ? {} : {treeEligible: tags.natural === 'wood' || tags.landuse === 'forest' || ['park', 'garden'].includes(tags.leisure)})});
    }
  }
  for (const [count, emitted, name] of [[sourceStats.sourceRoads, plan.roads.length, 'road'], [sourceStats.sourceWater, plan.water.length, 'water'], [sourceStats.sourceGreen, plan.green.length, 'green']]) {
    if (count > emitted) notes.push(issue(`${name}-budget`, 'warning', `${count - emitted} sourced ${name} parts exceed the display budget.`));
  }
  // Incomplete exclusions cannot support a claim that later placements avoid
  // every source road or water polygon. Preserve visible source layers and stop
  // placement rather than fill unchecked land.
  const incompleteExclusions = sourceStats.sourceRoads > plan.roads.length || sourceStats.sourceWater > plan.water.length || notes.some(n => ['coordinate-budget', 'feature-budget'].includes(n.code));
  // Only explicit source identity establishes a landmark/footprint match. A
  // nearby label, name, URL, or city-specific rule cannot replace that evidence.
  const landmarkSources = new Map(), reservedSources = new Set();
  for (const landmark of landmarks) if (typeof landmark?.sourceId === 'string' && landmark.sourceId.trim()) {
    if (!landmarkSources.has(landmark.sourceId)) landmarkSources.set(landmark.sourceId, []);
    landmarkSources.get(landmark.sourceId).push(landmark.id);
  }
  const ordinaryCandidates = [];
  for (const candidate of candidates) {
    if (!landmarkSources.has(candidate.sourceId)) { ordinaryCandidates.push(candidate); continue; }
    const landmarkIds = landmarkSources.get(candidate.sourceId);
    plan.landmarkFootprints.push({id: `landmark-footprint:${candidate.id}`, sourceId: candidate.sourceId, landmarkIds: clone(landmarkIds), rings: clone(candidate.rings)});
    if (!reservedSources.has(candidate.sourceId)) notes.push(issue('LANDMARK_MODEL_REQUIRED', 'warning', 'This explicitly identified landmark retains its source footprint and location; a dedicated architectural model is required. No ordinary building substitute is generated.', {sourceId: candidate.sourceId, landmarkIds: clone(landmarkIds)}));
    reservedSources.add(candidate.sourceId);
  }
  sourceStats.landmarkFootprints = plan.landmarkFootprints.length;
  const ctx = context(plan, project), occupied = spatialIndex();
  for (const candidate of incompleteExclusions ? [] : ordinaryCandidates) {
    if (plan.buildings.length >= limits.maxBuildings) break;
    const polygon = preparePolygon(candidate.rings, project.to), rect = representativeRectangle(polygon, limits.maxBuildingDimensionMeters);
    const extra = {sourceId: candidate.sourceId, objectId: candidate.id};
    if (!rect) { notes.push(issue('building-unrepresentable', 'warning', 'No conservative rectangle of at least 2 × 2 metres fits the source footprint.', extra)); continue; }
    const invalid = ctx.reason(rect.face);
    if (invalid) { notes.push(issue(`source-building-${invalid}`, 'warning', 'Source building representation conflicts with boundary, water, or a sourced major road; omitted without relocation.', extra)); continue; }
    if (occupied.query(bounds(rect.face)).some(item => facesIntersect(item.face, rect.face))) { notes.push(issue('source-building-overlap', 'warning', 'Overlapping building display omitted without moving either source.', extra)); continue; }
    const family = buildingFamily(candidate.tags), seed = hash(candidate.sourceId), variants = ASSETS[family];
    const sourceHeight = lengthMetres(candidate.tags.height), levels = Number(candidate.tags['building:levels']);
    const validLevels = Number.isFinite(levels) && levels > 0 && levels <= 200;
    const heightSource = sourceHeight ? 'source-height' : validLevels ? 'source-levels-estimate' : 'display-estimate';
    const estimate = limits.estimatedBuildingHeightMeters * ({residential: 1.2, commercial: 1.5, industrial: .65, generic: 1}[family]) * (.8 + (seed % 41) / 100);
    const rawHeight = sourceHeight || (validLevels ? levels * 3 : estimate);
    const heightMeters = clamp(rawHeight, 2, Math.min(limits.maxHeightMeters, Math.min(rect.width, rect.depth) * limits.maxSlenderness));
    if (heightSource !== 'source-height') sourceStats.estimatedHeights++;
    if (Math.abs(rawHeight - heightMeters) > .01) notes.push(issue('display-height-capped', 'warning', 'Height is capped for display proportions; source height remains recorded.', {...extra, sourceHeightMeters: rawHeight, displayHeightMeters: heightMeters}));
    const building = {id: candidate.id, sourceId: candidate.sourceId, coordinate: project.from(rect.center), widthMeters: rect.width, depthMeters: rect.depth, heightMeters,
      rotation: rect.rotation, assetId: variants[seed % variants.length], family, footprint: rect.face.map(project.from), sourceRings: clone(candidate.rings),
      heightSource, sourceHeightMeters: sourceHeight, sourceLevels: validLevels ? levels : null};
    plan.buildings.push(building); occupied.add({id: building.id, face: rect.face, bounds: bounds(rect.face)});
  }
  if (incompleteExclusions) notes.push(issue('placement-blocked-incomplete-exclusions', 'warning', 'Building and tree placement was withheld because road/water input was truncated; increase bounded budgets or supply a smaller complete extract.'));
  else if (ordinaryCandidates.length > limits.maxBuildings && plan.buildings.length >= limits.maxBuildings) notes.push(issue('building-budget', 'warning', 'Additional source buildings exceed the display budget.'));
  if (sourceStats.estimatedHeights) notes.push(issue('estimated-building-heights', 'warning', `${sourceStats.estimatedHeights} building heights use explicit level or display estimates.`));
  // A fixed metric grid with a source-id phase is reproducible and independent
  // of render order. Tree crowns are contained by sourced green polygons.
  let treeAttempts = 0;
  for (const source of incompleteExclusions ? [] : plan.green) {
    if (!source.treeEligible) continue;
    if (plan.trees.length >= limits.maxTrees || treeAttempts >= Math.max(1000, limits.maxTrees * 30)) break;
    const polygon = preparePolygon(source.rings, project.to), seed = hash(source.id), spacing = limits.treeSpacingMeters, b = polygon.bounds;
    const x0 = Math.ceil(b[0] / spacing) * spacing + (seed % 997) / 997 * spacing * .35, y0 = Math.ceil(b[1] / spacing) * spacing + ((seed >>> 8) % 991) / 991 * spacing * .35;
    let count = 0;
    treeLoop: for (let x = x0; x <= b[2]; x += spacing) for (let y = y0; y <= b[3]; y += spacing) {
      if (plan.trees.length >= limits.maxTrees || treeAttempts++ >= Math.max(1000, limits.maxTrees * 30)) break treeLoop;
      const radius = 2.3 + (hash(`${source.id}:${count}`) % 18) / 10, face = rectangle([x, y], radius * 2, radius * 2, 0);
      const treeId = `tree:${source.id}:${count++}`;
      if (!containsFace(polygon, face) || ctx.reason(face) || occupied.query(bounds(face)).some(item => facesIntersect(item.face, face))) continue;
      plan.trees.push({id: treeId, sourceId: source.sourceId, greenId: source.id, coordinate: project.from([x, y]), radiusMeters: radius, heightMeters: radius * 2.3,
        assetId: hash(treeId) % 3 ? 'tree-broad-crown' : 'tree-upright-crown'});
      occupied.add({id: treeId, face, bounds: bounds(face)});
    }
  }
  if (plan.green.length && (plan.trees.length >= limits.maxTrees || treeAttempts >= Math.max(1000, limits.maxTrees * 30))) notes.push(issue('tree-budget', 'warning', 'Tree placement reached its object or candidate budget; remaining sourced green area is left unfilled.'));
  if (!sourceStats.sourceBuildings) notes.push(issue('missing-building-data', 'warning', 'No usable source building polygons were supplied.'));
  if (!sourceStats.sourceRoads) notes.push(issue('missing-road-data', 'warning', 'No usable major-road source lines were supplied; road coverage is unknown.'));
  if (!sourceStats.sourceWater) notes.push(issue('missing-water-data', 'warning', 'No source water polygons were supplied; water coverage is unknown.'));
  if (!sourceStats.sourceGreen) notes.push(issue('missing-green-data', 'warning', 'No source green polygons were supplied; no trees were invented.'));
  notes.push(issue('coverage-unverified', 'warning', 'A feature extract does not establish complete city coverage; source completeness and visual acceptance require review.'));
  plan.stats = {...sourceStats, treeAttempts};
  const report = inspectCityPlan(plan); plan.stats = report.stats; plan.issues = report.issues;
  return plan;
}

/** Inspection recomputes placements and never trusts previous issues/stats. */
export function inspectCityPlan(plan) {
  const issues = Array.isArray(plan?.sourceIssues) ? clone(plan.sourceIssues) : [];
  const fail = (code, message, extra = {}) => issues.push(issue(code, 'error', message, extra));
  let project, limits;
  try {
    if (plan?.schema !== SCHEMA) throw new TypeError('Unsupported city build plan schema.');
    project = projection(plan.boundary); limits = options(plan.limits || plan.display || {});
    for (const name of ['buildings', 'roads', 'water', 'green', 'trees']) if (!Array.isArray(plan[name])) throw new TypeError(`Plan ${name} must be an array.`);
    if (plan.landmarks !== undefined && !Array.isArray(plan.landmarks)) throw new TypeError('Plan landmarks must be an array.');
    if (plan.buildings.length > CAPS.maxBuildings || plan.trees.length > CAPS.maxTrees || plan.roads.length > CAPS.maxRoads || plan.water.length > CAPS.maxPolygons || plan.green.length > CAPS.maxPolygons) throw new RangeError('Plan exceeds hard object budgets.');
    if (plan.landmarkFootprints !== undefined && (!Array.isArray(plan.landmarkFootprints) || plan.landmarkFootprints.length > CAPS.maxCoordinates / 4)) throw new RangeError('Invalid reserved landmark footprint budget.');
    let count = 0;
    for (const name of ['water', 'green', 'landmarkFootprints']) for (const item of plan[name] || []) count += validateGeometry({type: 'Polygon', coordinates: item.rings}, CAPS.maxGeometryCoordinates, true);
    for (const road of plan.roads) {
      count += validateGeometry({type: 'LineString', coordinates: road.coordinates}, CAPS.maxGeometryCoordinates);
      if (!Number.isFinite(road.widthMeters) || road.widthMeters < 3 || road.widthMeters > 60) throw new TypeError(`Road ${road.id} has an invalid physical width.`);
    }
    for (const building of plan.buildings) if (Array.isArray(building?.sourceRings)) {
      for (const ring of building.sourceRings) if (Array.isArray(ring)) count += ring.length;
    }
    if (count > CAPS.maxCoordinates) throw new RangeError('Plan source geometry exceeds the hard coordinate budget.');
  } catch (error) { fail('invalid-plan-source', error.message); return {ok: false, status: 'failed', issues, stats: {...(plan?.stats || {}), errors: issues.filter(i => i.severity === 'error').length, warnings: issues.filter(i => i.severity === 'warning').length}}; }
  const ctx = context(plan, project), occupied = spatialIndex(), seen = new Set(), greenById = new Map(plan.green.filter(item => item.treeEligible).map(item => [item.id, preparePolygon(item.rings, project.to)]));
  const landmarkSourceIds = new Set((plan.landmarks || []).filter(item => typeof item?.sourceId === 'string').map(item => item.sourceId));
  for (const item of [...plan.water, ...plan.green, ...plan.roads]) {
    if (typeof item.id !== 'string' || !item.id || seen.has(item.id)) fail('duplicate-source-display-id', 'Source layer ids must be unique and nonempty.', {objectId: item.id});
    seen.add(item.id);
  }
  for (const [kind, instances] of [['building', plan.buildings], ['tree', plan.trees]]) for (const [objectIndex, item] of instances.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { fail('invalid-display-instance', 'Display instance must be an object.', {kind, objectIndex}); continue; }
    const extra = {objectId: item.id, sourceId: item.sourceId, kind, objectIndex};
    if (typeof item.id !== 'string' || !item.id || seen.has(item.id)) { fail('duplicate-display-id', 'Display instance ids must be unique and nonempty.', extra); continue; } seen.add(item.id);
    if (!coordinate(item.coordinate) || typeof item.sourceId !== 'string' || !item.sourceId || !Number.isFinite(item.heightMeters) || item.heightMeters <= 0) { fail('invalid-display-instance', 'Display instance requires a source id, finite coordinate, and positive height.', extra); continue; }
    let face;
    if (kind === 'building') {
      if (landmarkSourceIds.has(item.sourceId)) fail('LANDMARK_GENERIC_SUBSTITUTE', 'An explicitly identified landmark requires its own model and cannot use an ordinary building substitute.', extra);
      if (![item.widthMeters, item.depthMeters, item.rotation].every(Number.isFinite) || item.widthMeters < 2 || item.depthMeters < 2 || item.widthMeters > limits.maxBuildingDimensionMeters || item.depthMeters > limits.maxBuildingDimensionMeters || !ASSETS[item.family]?.includes(item.assetId)) { fail('invalid-display-instance', 'Building dimensions or asset family are invalid.', extra); continue; }
      face = rectangle(project.to(item.coordinate), item.widthMeters, item.depthMeters, item.rotation);
      try {
        validateGeometry({type: 'Polygon', coordinates: [item.footprint]}, 5, true);
        validateGeometry({type: 'Polygon', coordinates: item.sourceRings}, CAPS.maxGeometryCoordinates, true);
        if (item.footprint.length !== 5 || item.footprint.some((p, i) => Math.hypot(...project.to(p).map((v, axis) => v - face[i][axis])) > .03)) throw new TypeError('Stored footprint does not match the display transform.');
        if (!containsFace(preparePolygon(item.sourceRings, project.to), face)) fail('outside-source-footprint', 'Whole display rectangle must remain inside its original source footprint, including holes.', extra);
      } catch (error) { fail('invalid-display-footprint', error.message, extra); continue; }
      if (item.heightMeters > Math.min(limits.maxHeightMeters, Math.min(item.widthMeters, item.depthMeters) * limits.maxSlenderness) + EPS) fail('excessive-height', 'Display height exceeds the physical height or slenderness bound.', extra);
    } else {
      if (!Number.isFinite(item.radiusMeters) || item.radiusMeters < 1 || item.radiusMeters > 10 || item.heightMeters > 30) { fail('invalid-display-instance', 'Tree dimensions exceed physical display bounds.', extra); continue; }
      face = rectangle(project.to(item.coordinate), item.radiusMeters * 2, item.radiusMeters * 2, 0);
      const green = greenById.get(item.greenId);
      if (!green || !containsFace(green, face)) fail('outside-source-green', 'The full tree crown must fit inside its sourced green polygon.', extra);
    }
    const reason = ctx.reason(face); if (reason) fail(reason, 'Whole display footprint intersects a source exclusion or leaves the supplied boundary.', extra);
    const collision = occupied.query(bounds(face)).find(other => facesIntersect(other.face, face));
    if (collision) fail('display-overlap', 'Display footprints overlap; source instances must not be relocated to resolve this.', {...extra, otherId: collision.id});
    occupied.add({id: item.id, face, bounds: bounds(face)});
  }
  if (plan.stats?.sourceBuildings > 0 && !plan.buildings.length) issues.push(issue('no-building-representation', 'warning', 'Source buildings exist but the plan has no building display instances.'));
  const stats = {...(plan.stats || {}), buildings: plan.buildings.length, roads: plan.roads.length, water: plan.water.length, green: plan.green.length, trees: plan.trees.length,
    errors: issues.filter(i => i.severity === 'error').length, warnings: issues.filter(i => i.severity === 'warning').length};
  return {ok: stats.errors === 0, status: stats.errors ? 'failed' : stats.warnings ? 'partial' : 'ready', issues, stats};
}

/** Only presentation objects may be clamped/removed. Source layers stay exact. */
export function repairCityPlan(input, {maxChanges = 100} = {}) {
  if (!Number.isInteger(maxChanges) || maxChanges < 0 || maxChanges > 10000) throw new RangeError('maxChanges must be an integer between 0 and 10000.');
  const plan = clone(input), changes = [], report = inspectCityPlan(plan);
  if (!Array.isArray(plan?.buildings) || !Array.isArray(plan?.trees) || report.issues.some(i => i.code === 'invalid-plan-source')) return {plan, changes, unresolved: report.issues};
  const limits = options(plan.limits || plan.display || {});
  const errors = new Map();
  for (const entry of report.issues) if (entry.severity === 'error' && entry.kind) { const key = `${entry.kind}:${entry.objectId}`; if (!errors.has(key)) errors.set(key, []); errors.get(key).push(entry); }
  const seen = new Set([...plan.roads || [], ...plan.water || [], ...plan.green || []].map(item => item.id));
  for (const [kind, key] of [['building', 'buildings'], ['tree', 'trees']]) {
    const keep = [];
    for (const item of plan[key]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        if (changes.length < maxChanges) changes.push({action: 'remove-display-instance', kind, reasons: ['invalid-display-instance']});
        else keep.push(item);
        continue;
      }
      const problems = errors.get(`${kind}:${item.id}`) || [], duplicate = seen.has(item.id), harmful = problems.filter(p => !['excessive-height', 'duplicate-display-id'].includes(p.code));
      if (changes.length < maxChanges && (duplicate || harmful.length || problems.some(p => p.code === 'duplicate-display-id') && !item.id)) {
        changes.push({action: 'remove-display-instance', objectId: item.id, sourceId: item.sourceId, kind, reasons: duplicate ? ['duplicate-display-id'] : harmful.map(p => p.code)}); continue;
      }
      if (changes.length < maxChanges && kind === 'building' && problems.some(p => p.code === 'excessive-height')) {
        const before = item.heightMeters; item.heightMeters = Math.min(item.heightMeters, limits.maxHeightMeters, Math.min(item.widthMeters, item.depthMeters) * limits.maxSlenderness);
        changes.push({action: 'clamp-display-height', objectId: item.id, sourceId: item.sourceId, before, after: item.heightMeters});
      }
      keep.push(item); seen.add(item.id);
    }
    plan[key] = keep;
  }
  if (changes.length) {
    if (!Array.isArray(plan.sourceIssues)) plan.sourceIssues = [];
    plan.sourceIssues.push(issue('presentation-repaired', 'warning', `${changes.length} bounded presentation changes were applied. Removed instances do not establish complete source coverage.`, {changes: clone(changes)}));
  }
  const after = inspectCityPlan(plan); plan.stats = after.stats; plan.issues = after.issues;
  return {plan, changes, unresolved: after.issues};
}
