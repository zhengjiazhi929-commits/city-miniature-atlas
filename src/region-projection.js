import * as THREE from 'three';

const EARTH_CIRCUMFERENCE = 40075016.68557849;
export const REGION_EXTENT = 40;

/** WGS84 longitude/latitude → normalized Web Mercator, north at y=0. */
export function toRegionMercator([longitude, latitude]) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 85.051129) {
    throw new Error('Region coordinates must be finite WGS84 longitude/latitude.');
  }
  return [(longitude + 180) / 360, (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2];
}

export function fromRegionMercator([x, y]) {
  return [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
}

export function regionPolygons(feature) {
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature?.geometry || feature;
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error('A region requires a Polygon or MultiPolygon boundary.');
}

/** East=x, south=z, elevation=y. Every region has its own local 40-unit frame. */
export function createRegionProjection(feature) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const polygon of regionPolygons(feature)) for (const ring of polygon) for (const coordinate of ring) {
    const [longitude, latitude] = coordinate;
    toRegionMercator(coordinate);
    west = Math.min(west, longitude); east = Math.max(east, longitude);
    south = Math.min(south, latitude); north = Math.max(north, latitude);
  }
  if (!(east > west && north > south)) throw new Error('Region boundary has no finite area.');
  const [minX, minY] = toRegionMercator([west, north]);
  const [maxX, maxY] = toRegionMercator([east, south]);
  const centerMercator = [(minX + maxX) / 2, (minY + maxY) / 2];
  const center = fromRegionMercator(centerMercator);
  const scale = REGION_EXTENT / Math.max(maxX - minX, maxY - minY);
  // Mercator expands horizontal ground meters by 1/cos(latitude). Apply the
  // same local scale to vertical meters; exaggeration belongs to the view.
  const metersToUnits = scale / (EARTH_CIRCUMFERENCE * Math.cos(center[1] * Math.PI / 180));
  return {
    bounds: [[west, south], [east, north]],
    mercatorBounds: [minX, minY, maxX, maxY], center, centerMercator, scale, metersToUnits,
    project(lnglat, meters = 0) {
      if (!Number.isFinite(meters)) throw new Error('Region elevation must be finite meters.');
      const [x, y] = toRegionMercator(lnglat);
      return new THREE.Vector3((x - centerMercator[0]) * scale, meters * metersToUnits, (y - centerMercator[1]) * scale);
    },
    unproject(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Region position must be finite.');
      return fromRegionMercator([x / scale + centerMercator[0], z / scale + centerMercator[1]]);
    },
  };
}
