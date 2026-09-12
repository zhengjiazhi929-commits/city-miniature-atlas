import * as THREE from 'three';

const validCoordinate = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) < 85;
const positive = n => Number.isFinite(n) && n > 0;
const area = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p.x * q.z - q.x * p.z;
}, 0) / 2;

/**
 * Source footprints and runway centre lines stay in WGS84 until projected.
 * `project(lnglat)` must return the displayed ground surface. Recorded ARP and
 * feature elevations are metadata, not a replacement for that terrain surface.
 * This module exaggerates only physical structure heights, never positions.
 */
export function createAirportModel({ airport, project, metersToUnits, heightExaggeration = 1, foundationInsetMeters = 0 }) {
  if (!airport?.id || !validCoordinate(airport.coordinates) || typeof project !== 'function' || !positive(metersToUnits) || !positive(heightExaggeration)) {
    throw new Error('Airport model requires an id, WGS84 coordinates, a ground projection and positive scales.');
  }
  const group = new THREE.Group();
  group.name = `airport:${airport.id}`;
  group.userData = { airportId: airport.id, category: 'airport', source: airport.sources || [] };
  const diagnostics = {
    id: airport.id, runways: 0, terminals: 0, aprons: 0, triangles: 0, drawCalls: 0,
    float32FacesDropped: 0, float32FacesReoriented: 0,
    foundationInsetDisplayMeters: foundationInsetMeters, heightExaggeration, heightAssumptions: [], skipped: [], disposed: false,
    markingPolicy: 'Illustrative threshold bars and centre dashes within verified runway footprints; not operational aeronautical markings.',
    thicknessMeters: { runway: 2, apron: 0.8, markings: 0.2 },
    displayGroundPolicy: 'Always project(coordinate) onto the displayed terrain; ARP and feature elevation metadata do not flatten or lift the airport.',
    aircraft: 0,
  };
  const vertical = metersToUnits * heightExaggeration;
  const footingInset = Math.max(0,foundationInsetMeters) * metersToUnits;
  const buckets = new Map();
  const geometries = new Set(), materials = new Set();
  const palette = {
    runway: [0x35414a, 0.92], pavementSide: [0x555d5c, 1],
    apron: [0x8f9898, 0.96], terminalWall: [0xc8d5d5, 0.77],
    terminalRoof: [0x598795, 0.62], markings: [0xf7f5e8, 0.88],
  };
  const skip = (kind, feature, reason) => diagnostics.skipped.push({ kind, id: feature?.id ?? null, reason });
  const triangle = (bucket, a, b, c) => {
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const upward = (bucket, a, b, c, reverse = false) => {
    const winding = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(winding) < 1e-16) return;
    if ((winding < 0) !== reverse) triangle(bucket, a, b, c);
    else triangle(bucket, a, c, b);
  };
  const quad = (bucket, a, b, c, d) => { triangle(bucket, a, b, c); triangle(bucket, a, c, d); };
  const ground = coordinate => {
    const p = project(coordinate);
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) throw new Error(`Nonfinite airport projection for ${airport.id}.`);
    return new THREE.Vector3(p.x, p.y, p.z);
  };
  function solidPolygon(feature, kind) {
    if (!Array.isArray(feature.rings) || !feature.rings.length) return skip(kind, feature, 'Missing polygon rings.');
    const rings = [];
    for (const source of feature.rings) {
      if (!Array.isArray(source) || !source.every(validCoordinate)) return skip(kind, feature, 'Invalid WGS84 polygon ring.');
      const ring = source.filter((p, i) => !i || p[0] !== source[i - 1][0] || p[1] !== source[i - 1][1]);
      if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
      if (ring.length < 3) return skip(kind, feature, 'Degenerate polygon ring.');
      const projected = ring.map(p => ground(p, feature));
      if (Math.abs(area(projected)) < 1e-14) return skip(kind, feature, 'Polygon has no projected area.');
      // Clockwise outer and anticlockwise holes produce outward side walls.
      if ((area(projected) < 0) !== (rings.length === 0)) projected.reverse();
      rings.push(projected);
    }
    const points = rings.flat();
    const isTerminal = kind === 'terminal';
    const height = isTerminal ? (positive(feature.heightMeters) ? feature.heightMeters : 18) : diagnostics.thicknessMeters.apron;
    if (isTerminal && !positive(feature.heightMeters)) diagnostics.heightAssumptions.push({ id: feature.id, heightMeters: 18, basis: 'Display mass only; source building height unavailable.' });
    const highestBase = points.reduce((max, p) => Math.max(max, p.y), -Infinity);
    // Terminal roof is one plane; apron vertices follow their sampled ground.
    const top = points.map(p => new THREE.Vector3(p.x, (isTerminal ? highestBase : p.y) + height * vertical, p.z));
    // A shallow underside inset closes subpixel DEM interpolation seams.
    // Roofs and pavement tops retain their original source-based heights.
    const bottom = points.map(p=>new THREE.Vector3(p.x,p.y-footingInset,p.z));
    const faces = THREE.ShapeUtils.triangulateShape(rings[0].map(p => new THREE.Vector2(p.x, p.z)), rings.slice(1).map(r => r.map(p => new THREE.Vector2(p.x, p.z))));
    if (!faces.length) return skip(kind, feature, 'Polygon triangulation yielded no faces.');
    for (const [a, b, c] of faces) {
      upward(isTerminal ? 'terminalRoof' : 'apron', top[a], top[b], top[c]);
      upward(isTerminal ? 'terminalWall' : 'pavementSide', bottom[a], bottom[b], bottom[c], true);
    }
    let offset = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = offset + i, b = offset + (i + 1) % ring.length;
        quad(isTerminal ? 'terminalWall' : 'pavementSide', bottom[a], bottom[b], top[b], top[a]);
      }
      offset += ring.length;
    }
    diagnostics[isTerminal ? 'terminals' : 'aprons']++;
  }

  const origin = airport.coordinates;
  const longitudeScale = 111320 * Math.cos(origin[1] * Math.PI / 180);
  const toLocal = p => [(p[0] - origin[0]) * longitudeScale, (p[1] - origin[1]) * 111320];
  const fromLocal = p => [origin[0] + p[0] / longitudeScale, origin[1] + p[1] / 111320];
  function runway(feature) {
    if (['planned', 'proposed', 'construction', 'closed', 'disused', 'abandoned'].includes(String(feature.status).toLowerCase())) return skip('runway', feature, 'Non-operational source status.');
    if (!Array.isArray(feature.points) || feature.points.length < 2 || !feature.points.every(validCoordinate) || !positive(feature.widthMeters)) return skip('runway', feature, 'Verified centre line and positive width are required.');
    const path = feature.points.map(toLocal).filter((p, i, all) => !i || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 0.01);
    if (path.length < 2) return skip('runway', feature, 'Runway has no length.');
    const distances = [0];
    for (let i = 1; i < path.length; i++) distances.push(distances[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const length = distances.at(-1), halfWidth = feature.widthMeters / 2;
    const pointAt = (distance, lateral = 0) => {
      let i = 0;
      while (i < path.length - 2 && distances[i + 1] < distance) i++;
      const a = path[i], b = path[i + 1], span = distances[i + 1] - distances[i];
      const t = Math.max(0, Math.min(1, (distance - distances[i]) / span));
      return ground(fromLocal([a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) / span * lateral, a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) / span * lateral]), feature);
    };
    const stops = [...distances];
    for (let distance = 120; distance < length; distance += 120) stops.push(distance);
    stops.sort((a, b) => a - b);
    const sections = [...new Set(stops)].map(distance => {
      const left = pointAt(distance, -halfWidth), right = pointAt(distance, halfWidth);
      const y = Math.max(left.y, right.y) + diagnostics.thicknessMeters.runway * vertical;
      left.y-=footingInset;right.y-=footingInset;
      return { distance, left, right, topLeft: new THREE.Vector3(left.x, y, left.z), topRight: new THREE.Vector3(right.x, y, right.z), y };
    });
    for (let i = 1; i < sections.length; i++) {
      const a = sections[i - 1], b = sections[i];
      upward('runway', a.topLeft, b.topLeft, b.topRight); upward('runway', a.topLeft, b.topRight, a.topRight);
      upward('pavementSide', a.left, b.left, b.right, true); upward('pavementSide', a.left, b.right, a.right, true);
      quad('pavementSide', a.left, b.left, b.topLeft, a.topLeft);
      quad('pavementSide', b.right, a.right, a.topRight, b.topRight);
    }
    const first = sections[0], last = sections.at(-1);
    quad('pavementSide', first.right, first.left, first.topLeft, first.topRight);
    quad('pavementSide', last.left, last.right, last.topRight, last.topLeft);
    const surfaceY = distance => {
      let i = 0;
      while (i < sections.length - 2 && sections[i + 1].distance < distance) i++;
      const a = sections[i], b = sections[i + 1];
      return a.y + (b.y - a.y) * (distance - a.distance) / (b.distance - a.distance);
    };
    function marking(start, end, left, right) {
      const base = [[start, left], [end, left], [end, right], [start, right]].map(([distance, lateral]) => {
        const p = pointAt(distance, lateral); p.y = surfaceY(distance) + 0.12 * vertical; return p;
      });
      const top = base.map(p => new THREE.Vector3(p.x, p.y + diagnostics.thicknessMeters.markings * vertical, p.z));
      upward('markings', top[0], top[1], top[2]); upward('markings', top[0], top[2], top[3]);
      for (let i = 0; i < 4; i++) quad('markings', base[i], base[(i + 1) % 4], top[(i + 1) % 4], top[i]);
    }
    const margin = Math.min(80, length * 0.1);
    for (let distance = margin; distance + 30 < length - margin; distance += 65) marking(distance, distance + 30, -0.6, 0.6);
    const thresholdLength = Math.min(30, length * 0.025), thresholdInset = Math.min(12, length * 0.02);
    const barWidth = Math.min(1.8, feature.widthMeters / 20);
    for (let side of [-1, 1]) for (let i = 1; i <= 4; i++) {
      const center = side * halfWidth * i / 5;
      marking(thresholdInset, thresholdInset + thresholdLength, center - barWidth / 2, center + barWidth / 2);
      marking(length - thresholdInset - thresholdLength, length - thresholdInset, center - barWidth / 2, center + barWidth / 2);
    }
    diagnostics.runways++;
  }
  function dispose() {
    if (diagnostics.disposed) return;
    group.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear(); geometries.clear(); materials.clear(); buckets.clear();
    diagnostics.disposed = true;
  }
  try {
    for (const feature of airport.aprons || []) solidPolygon(feature, 'apron');
    for (const feature of airport.runways || []) runway(feature);
    for (const feature of airport.terminals || []) solidPolygon(feature, 'terminal');
    for (const [name, positions] of buckets) {
      if (!positions.length) continue;
      // Survey polygons may contain sub-centimetre slivers. Orient and reject
      // collapsed faces after Float32 conversion, as actually sent to the GPU.
      const packed = new Float32Array(positions), clean = [];
      const topLayer = ['runway', 'apron', 'terminalRoof'].includes(name);
      for (let i = 0; i < packed.length; i += 9) {
        const ux = packed[i + 3] - packed[i], uy = packed[i + 4] - packed[i + 1], uz = packed[i + 5] - packed[i + 2];
        const vx = packed[i + 6] - packed[i], vy = packed[i + 7] - packed[i + 1], vz = packed[i + 8] - packed[i + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if ((nx === 0 && ny === 0 && nz === 0) || (topLayer && ny === 0)) { diagnostics.float32FacesDropped++; continue; }
        clean.push(packed[i], packed[i + 1], packed[i + 2]);
        const flipped = topLayer && ny < 0;
        if (flipped) diagnostics.float32FacesReoriented++;
        for (const offset of flipped ? [6, 3] : [3, 6]) clean.push(packed[i + offset], packed[i + offset + 1], packed[i + offset + 2]);
      }
      if (!clean.length) continue;
      const geometry = new THREE.BufferGeometry(); geometries.add(geometry);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(clean, 3));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const [color, roughness] = palette[name];
      const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: name === 'terminalRoof' ? 0.2 : 0, side: THREE.DoubleSide });
      materials.add(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${airport.id}:${name}`; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { airportId: airport.id, category: 'airport', layer: name };
      group.add(mesh); diagnostics.triangles += clean.length / 9; diagnostics.drawCalls++;
    }
    buckets.clear();
    group.userData.diagnostics = diagnostics;
    return { group, diagnostics, dispose };
  } catch (error) { dispose(); throw error; }
}
