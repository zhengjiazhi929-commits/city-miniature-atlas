// Planar WGS84 helpers for this atlas's non-antimeridian province GeoJSON.
// Extents retain every island. Polygon holes never count as province interiors.
function polygons(feature) {
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

const validCoordinate = (point) => Array.isArray(point) &&
  Number.isFinite(point[0]) && Number.isFinite(point[1]);

/** Return MapLibre bounds [[west, south], [east, north]], or null if empty. */
export function provinceBounds(feature) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const polygon of polygons(feature)) for (const ring of polygon || []) {
    for (const point of ring || []) {
      if (!validCoordinate(point)) continue;
      west = Math.min(west, point[0]); east = Math.max(east, point[0]);
      south = Math.min(south, point[1]); north = Math.max(north, point[1]);
    }
  }
  return Number.isFinite(west) ? [[west, south], [east, north]] : null;
}

// 0 = outside; 1 = inside; 2 = on a segment (including its endpoints).
function ringLocation(ring, point) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (!validCoordinate(a) || !validCoordinate(b)) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    // Tolerance in degrees is below the precision of the shipped boundaries.
    const epsilon = 1e-10;
    const cross = (x - a[0]) * dy - (y - a[1]) * dx;
    if (Math.abs(cross) <= epsilon * Math.max(1, Math.abs(dx), Math.abs(dy)) &&
        x >= Math.min(a[0], b[0]) - epsilon && x <= Math.max(a[0], b[0]) + epsilon &&
        y >= Math.min(a[1], b[1]) - epsilon && y <= Math.max(a[1], b[1]) + epsilon) return 2;
    if ((a[1] > y) !== (b[1] > y) &&
        x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : 0;
}

/** Include exterior boundaries; exclude holes and their boundaries. */
export function containsCoordinate(feature, lnglat) {
  if (!validCoordinate(lnglat)) return false;
  return polygons(feature).some((polygon) => {
    if (!polygon?.length || !ringLocation(polygon[0], lnglat)) return false;
    return !polygon.slice(1).some((hole) => ringLocation(hole, lnglat) !== 0);
  });
}
