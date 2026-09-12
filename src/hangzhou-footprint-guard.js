// All inputs use one common 2D coordinate system. This module does not project,
// enlarge or relocate geometry. Run a separate guard for source and display.
const extent = points => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
  return b;
};
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function preparePolygons(polygons, name) {
  if (!Array.isArray(polygons)) throw new TypeError(`${name} must be an array of polygon rings.`);
  return polygons.map((polygon, pi) => {
    if (!Array.isArray(polygon) || !polygon.length) throw new TypeError(`${name}[${pi}] needs an outer ring.`);
    const rings = polygon.map((ring, ri) => {
      if (!Array.isArray(ring) || ring.some(p => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new TypeError(`${name}[${pi}][${ri}] has invalid coordinates.`);
      const result = ring.map(p => [p[0], p[1]]).filter((p, i, all) => !i || !same(p, all[i - 1]));
      if (result.length > 1 && same(result[0], result[result.length - 1])) result.pop();
      if (result.length < 3) throw new TypeError(`${name}[${pi}][${ri}] needs three distinct vertices.`);
      return result;
    });
    return {rings, bounds: extent(rings[0])};
  });
}

function polygonIndex(polygons, cell, rowStep) {
  const bins = new Map();
  function ringTest(ring) {
    const rows = new Map();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (a[1] === b[1]) continue;
      for (let y = Math.floor(Math.min(a[1], b[1]) / rowStep); y <= Math.floor(Math.max(a[1], b[1]) / rowStep); y++) {
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push([a, b]);
      }
    }
    return p => {
      let inside = false;
      for (const [a, b] of rows.get(Math.floor(p[1] / rowStep)) || []) if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      return inside;
    };
  }
  for (const polygon of polygons) {
    const tests = polygon.rings.map(ringTest), b = polygon.bounds;
    const row = {bounds: b, has: p => tests[0](p) && !tests.slice(1).some(test => test(p))};
    for (let x = Math.floor(b[0] / cell); x <= Math.floor(b[2] / cell); x++) for (let y = Math.floor(b[1] / cell); y <= Math.floor(b[3] / cell); y++) {
      const key = `${x},${y}`; if (!bins.has(key)) bins.set(key, []); bins.get(key).push(row);
    }
  }
  return {
    has: p => (bins.get(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`) || []).some(row => p[0] >= row.bounds[0] && p[0] <= row.bounds[2] && p[1] >= row.bounds[1] && p[1] <= row.bounds[3] && row.has(p)),
    dispose() { bins.clear(); },
  };
}

/**
 * Conservative whole-footprint support guard, including polygon holes.
 * boundary/water/exclusions: polygons -> [outerRing, ...holeRings] -> [x,y].
 * allows accepts a convex footprint in perimeter order, either winding.
 * Any boundary touch, crossing, enclosed forbidden ring or invalid face fails.
 * Source polygon overlap can cause conservative rejection, never new land.
 */
export function createLandFootprintGuard({boundary, water, exclusions = [], cellSize} = {}) {
  const landPolygons = preparePolygons(boundary, 'boundary');
  const waterPolygons = preparePolygons(water, 'water');
  const excludedPolygons = preparePolygons(exclusions, 'exclusions');
  const all = [...landPolygons, ...waterPolygons, ...excludedPolygons];
  const bounds = extent(landPolygons.flatMap(p => [[p.bounds[0], p.bounds[1]], [p.bounds[2], p.bounds[3]]]));
  const cell = cellSize ?? Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 256;
  if (!landPolygons.length || !Number.isFinite(cell) || cell <= 0) throw new RangeError('Footprint guard requires a nonempty boundary and positive cellSize.');
  const epsilon = cell * 1e-8;
  const land = polygonIndex(landPolygons, cell * 12, cell);
  const forbidden = polygonIndex([...waterPolygons, ...excludedPolygons], cell * 12, cell);
  const edges = new Map();
  const diagnostics = {polygons: all.length, indexedEdges: 0, edgeCells: 0, queries: 0, accepted: 0, disposed: false};
  const cells = (b, visit) => {
    for (let x = Math.floor((b[0] - epsilon) / cell); x <= Math.floor((b[2] + epsilon) / cell); x++) for (let y = Math.floor((b[1] - epsilon) / cell); y <= Math.floor((b[3] + epsilon) / cell); y++) if (visit(`${x},${y}`) === false) return false;
    return true;
  };
  for (const polygon of all) for (const ring of polygon.rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], edge = {a, b, bounds: extent([a, b])};
    if (same(a, b)) continue;
    cells(edge.bounds, key => { if (!edges.has(key)) edges.set(key, []); edges.get(key).push(edge); });
    diagnostics.indexedEdges++;
  }
  diagnostics.edgeCells = edges.size;
  function onSegment(p, a, b) {
    return Math.abs(cross(a, b, p)) <= epsilon * Math.hypot(b[0] - a[0], b[1] - a[1]) && p[0] >= Math.min(a[0], b[0]) - epsilon && p[0] <= Math.max(a[0], b[0]) + epsilon && p[1] >= Math.min(a[1], b[1]) - epsilon && p[1] <= Math.max(a[1], b[1]) + epsilon;
  }
  function intersects(a, b, c, d) {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
  }
  function inFace(p, face) {
    let inside = false;
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (onSegment(p, a, b)) return true;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function allows(corners) {
    diagnostics.queries++;
    if (diagnostics.disposed || !Array.isArray(corners) || corners.some(p => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return false;
    const face = corners.length > 1 && same(corners[0], corners[corners.length - 1]) ? corners.slice(0, -1) : corners;
    if (face.length < 3) return false;
    // Caller may supply an affine parallelogram, but never a self-crossing or
    // concave order. Reject collapsed faces rather than making a false claim.
    let winding = 0;
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length], c = face[(i + 2) % face.length], turn = cross(a, b, c);
      if (same(a, b) || Math.abs(turn) <= epsilon * (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]))) return false;
      if (winding && Math.sign(turn) !== winding) return false;
      winding = Math.sign(turn);
    }
    if (!face.every(p => land.has(p) && !forbidden.has(p))) return false;
    const b = extent(face), seen = new Set();
    const accepted = cells(b, key => {
      for (const edge of edges.get(key) || []) {
        if (seen.has(edge)) continue; seen.add(edge); const e = edge.bounds;
        if (e[2] < b[0] - epsilon || e[0] > b[2] + epsilon || e[3] < b[1] - epsilon || e[1] > b[3] + epsilon) continue;
        // A forbidden polygon completely enclosed by the footprint may never
        // intersect its perimeter. Testing indexed edge vertices catches it.
        if (inFace(edge.a, face) || inFace(edge.b, face)) return false;
        for (let i = 0; i < face.length; i++) if (intersects(face[i], face[(i + 1) % face.length], edge.a, edge.b)) return false;
      }
      return true;
    });
    if (accepted) diagnostics.accepted++;
    return accepted;
  }
  function dispose() {
    if (diagnostics.disposed) return;
    diagnostics.disposed = true; land.dispose(); forbidden.dispose(); edges.clear();
    all.length = landPolygons.length = waterPolygons.length = excludedPolygons.length = 0;
  }
  return {allows, dispose, diagnostics};
}
