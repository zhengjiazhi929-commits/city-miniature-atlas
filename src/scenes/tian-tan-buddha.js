import * as THREE from 'three';
import { Batch, material, simpleTree, rng } from './hong-kong-geometry.js';

// A sculpted bronze study: all facial features, hands and folds are geometry.
const TAU = Math.PI * 2;
const V = p => new THREE.Vector3(...p);
function ellipsoid(b, p, s, mat, rotation = [0, 0, 0], segments = 24) {
  b.add(new THREE.SphereGeometry(1, segments, 16), mat, p, s, rotation);
}
function tube(b, points, radius, mat, segments = 24, sides = 8) {
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)), segments, radius, sides, false), mat);
}
function limb(b, points, radii, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map(V));
  const count = 28, sides = 16, frames = curve.computeFrenetFrames(count, false);
  const positions = [], indices = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count, p = curve.getPointAt(t), f = t * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(f));
    const r = THREE.MathUtils.lerp(radii[k], radii[k + 1], f - k);
    for (let j = 0; j <= sides; j++) {
      const a = TAU * j / sides, q = p.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      positions.push(q.x, q.y, q.z);
      if (i < count && j < sides) { const s = i * (sides + 1) + j; indices.push(s, s + 1, s + sides + 1, s + 1, s + sides + 2, s + sides + 1); }
    }
  }
  const cap0 = positions.length / 3, start = curve.getPointAt(0), end = curve.getPointAt(1);
  positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  for (let j = 0; j < sides; j++) {
    indices.push(cap0, j + 1, j);
    const k = count * (sides + 1) + j; indices.push(cap0 + 1, k, k + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); b.add(g, mat);
}
function ring(b, x, y, z, r, thickness, mat) {
  b.add(new THREE.TorusGeometry(r, thickness, 6, 80), mat, [x, y, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
}

// The robe and both arms form one continuous surface. A smooth implicit union
// avoids exposed intersections at the shoulders when the sculpture is orbited.
function continuousBodyGeometry() {
  const smoothMin = (a, b, k = .24) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; };
  const ellipsoidDistance = (x, y, z, cy, rx, ry, rz) => {
    const yy = y - cy, k0 = Math.hypot(x / rx, yy / ry, z / rz), k1 = Math.hypot(x / (rx * rx), yy / (ry * ry), z / (rz * rz));
    return k1 > 1e-6 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
  };
  const specs = [
    [[[-.82, 6.41, 0], [-1.35, 6.32, .06], [-1.77, 5.84, .48], [-1.94, 6.34, .84], [-1.9, 6.85, 1.06]], [.45, .43, .35, .23]],
    [[[.83, 6.4, 0], [1.40, 6.16, .1], [1.69, 5.27, .6], [1.12, 4.96, 1.01], [.62, 4.94, 1.22]], [.46, .43, .34, .20]],
  ];
  const segments = [];
  for (const [arm, [points, radii]] of specs.entries()) {
    const path = new THREE.CatmullRomCurve3(points.map(V));
    for (let i = 0; i < 18; i++) {
      const a = path.getPointAt(i / 18), c = path.getPointAt((i + 1) / 18), d = c.clone().sub(a);
      const radius = t => { const q = t * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(q)); return THREE.MathUtils.lerp(radii[k], radii[k + 1], q - k); };
      segments.push({ arm, a: a.toArray(), d: d.toArray(), length2: d.lengthSq(), r0: radius(i / 18), r1: radius((i + 1) / 18) });
    }
  }
  const field = (x, y, z) => {
    let f = ellipsoidDistance(x, y, z, 5.43, 1.19, 1.23, .84);
    f = smoothMin(f, ellipsoidDistance(x, y, z, 6.25, 1.31, .52, .85), .26);
    f = smoothMin(f, ellipsoidDistance(x, y, z, 4.63, 1.17, .49, .79), .20);
    f = smoothMin(f, ellipsoidDistance(x, y, z, 6.94, .37, .49, .34), .20);
    const arms = [Infinity, Infinity];
    for (const s of segments) {
      const x0 = x - s.a[0], y0 = y - s.a[1], z0 = z - s.a[2];
      const t = Math.max(0, Math.min(1, (x0 * s.d[0] + y0 * s.d[1] + z0 * s.d[2]) / s.length2));
      const distance = Math.hypot(x0 - t * s.d[0], y0 - t * s.d[1], z0 - t * s.d[2]) - THREE.MathUtils.lerp(s.r0, s.r1, t);
      arms[s.arm] = Math.min(arms[s.arm], distance);
    }
    return smoothMin(smoothMin(f, arms[0], .27), arms[1], .27);
  };
  const nx = 44, ny = 42, nz = 28, min = [-2.55, 3.92, -1.22], max = [2.55, 7.55, 1.62];
  const values = new Float32Array((nx + 1) * (ny + 1) * (nz + 1)), grid = [];
  const id = (x, y, z) => (z * (ny + 1) + y) * (nx + 1) + x;
  for (let z = 0; z <= nz; z++) for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    const p = [min[0] + (max[0] - min[0]) * x / nx, min[1] + (max[1] - min[1]) * y / ny, min[2] + (max[2] - min[2]) * z / nz], index = id(x, y, z);
    grid[index] = p; values[index] = field(...p);
  }
  const positions = [], indices = [], edgeCache = new Map();
  const edgeVertex = (a, c) => {
    const key = a < c ? a + ':' + c : c + ':' + a;
    if (edgeCache.has(key)) return edgeCache.get(key);
    const t = values[a] / (values[a] - values[c]), p = grid[a], q = grid[c], index = positions.length / 3;
    positions.push(p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])); edgeCache.set(key, index); return index;
  };
  const triangle = (a, c, d, out) => {
    const av = new THREE.Vector3().fromArray(positions, a * 3), cv = new THREE.Vector3().fromArray(positions, c * 3), dv = new THREE.Vector3().fromArray(positions, d * 3);
    const normal = cv.clone().sub(av).cross(dv.clone().sub(av));
    if (normal.dot(out) > 0) indices.push(a, c, d); else indices.push(a, d, c);
  };
  const tetra = [ [0,1,2,6], [0,2,3,6], [0,3,7,6], [0,7,4,6], [0,4,5,6], [0,5,1,6] ];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const corners = [id(x,y,z),id(x+1,y,z),id(x+1,y+1,z),id(x,y+1,z),id(x,y,z+1),id(x+1,y,z+1),id(x+1,y+1,z+1),id(x,y+1,z+1)];
    if (corners.every(k => values[k] >= 0) || corners.every(k => values[k] < 0)) continue;
    for (const t of tetra) {
      const inside = t.map(k => corners[k]).filter(k => values[k] < 0), outside = t.map(k => corners[k]).filter(k => values[k] >= 0);
      if (!inside.length || !outside.length) continue;
      const inward = new THREE.Vector3(), outward = new THREE.Vector3();
      inside.forEach(k => inward.add(V(grid[k]))); outside.forEach(k => outward.add(V(grid[k])));
      const out = outward.divideScalar(outside.length).sub(inward.divideScalar(inside.length));
      if (inside.length === 1) triangle(...outside.map(k => edgeVertex(inside[0], k)), out);
      else if (outside.length === 1) triangle(...inside.map(k => edgeVertex(outside[0], k)), out);
      else {
        const a = edgeVertex(inside[0], outside[0]), c = edgeVertex(inside[0], outside[1]), d = edgeVertex(inside[1], outside[1]), e = edgeVertex(inside[1], outside[0]);
        triangle(a, c, d, out); triangle(a, d, e, out);
      }
    }
  }
  const normals = [], epsilon = .003;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const n = new THREE.Vector3(field(x + epsilon, y, z) - field(x - epsilon, y, z), field(x, y + epsilon, z) - field(x, y - epsilon, z), field(x, y, z + epsilon) - field(x, y, z - epsilon)).normalize();
    normals.push(n.x, n.y, n.z);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(indices);
  return geometry;
}
function roof(b, x, y, z, w, d, h, mats) {
  const points = [], indices = [], nx = 24, nz = 10;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx * 2 - 1, v = j / nz * 2 - 1;
    const yy = y + h * (1 - Math.abs(u)) + .18 * Math.pow(Math.abs(u), 5) + .13 * Math.pow(Math.abs(v), 8);
    points.push(x + u * w / 2, yy, z + v * d / 2);
    if (i < nx && j < nz) { const a = j * (nx + 1) + i; indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setIndex(indices); g.computeVertexNormals(); b.add(g, mats.roof);
  for (let j = 0; j <= 18; j++) {
    const zz = z + (j / 18 - .5) * d;
    for (const sign of [-1, 1]) tube(b, [[x, y + h + .025, zz], [x + sign * w * .23, y + h * .55, zz], [x + sign * w * .5, y + .19, zz]], .023, mats.gold, 8, 5);
  }
  tube(b, [[x, y + h + .03, z - d / 2], [x, y + h + .06, z], [x, y + h + .03, z + d / 2]], .065, mats.gold, 12, 6);
}
function temple(b, x, y, z, scale, mats) {
  const w = 3.25 * scale, d = 2.0 * scale;
  b.box(x, y + .12, z, w, .24, d, mats.stone);
  b.box(x, y + .67 * scale, z, w * .83, .95 * scale, d * .7, mats.wood);
  for (let i = 0; i < 5; i++) {
    const xx = x + (i - 2) * w / 5.3;
    b.cylinder(xx, y + .8 * scale, z + d * .36, .055 * scale, .06 * scale, 1.28 * scale, mats.red, 8);
    if (i < 4) b.box(xx + w / 10.6, y + .75 * scale, z + d * .353, w / 6.8, .72 * scale, .035, mats.dark);
  }
  roof(b, x, y + 1.3 * scale, z, w * 1.15, d * 1.3, .68 * scale, mats);
  roof(b, x, y + 1.92 * scale, z, w * .68, d * .82, .46 * scale, mats);
}

export function createTianTanBuddha() {
  const group = new THREE.Group(); group.name = 'Tian Tan Buddha — sculpted bronze and Ngong Ping hillside';
  const b = new Batch(group), random = rng(9301);
  const m = {
    base: material('#c8bea4'), grass: material('#8d9a6c'), stone: material('#d7d2bc'), lightStone: material('#e8e1c9'),
    darkStone: material('#a2a28d'), bronze: material('#78614b', .62, .38), bronzeLit: material('#897057', .59, .39),
    bronzeShade: material('#574736', .73, .3), hair: material('#50463b', .74, .3), mouth: material('#594937', .68, .3),
    bark: material('#63533c'), leaves: [material('#486651'), material('#59754f'), material('#70865b'), material('#879263')],
    roof: material('#bda464', .65, .12), gold: material('#d2b572', .57, .24), red: material('#894b34'), wood: material('#735640'), dark: material('#454c39'),
  };
  b.add(new THREE.CylinderGeometry(8.65, 8.78, .48, 96), m.base, [0, -.06, 0], [1, 1, .86]);
  const height = (x, z) => .2 + 2.05 * Math.exp(-(x * x / 24 + (z + 1.4) * (z + 1.4) / 18));
  const terrainPositions = [], terrainIndices = [], nr = 24, na = 100;
  for (let i = 0; i <= nr; i++) for (let j = 0; j <= na; j++) {
    const a = TAU * j / na, r = i / nr, x = 8.6 * r * Math.cos(a), z = 7.35 * r * Math.sin(a);
    terrainPositions.push(x, height(x, z), z);
    if (i < nr && j < na) { const k = i * (na + 1) + j; terrainIndices.push(k, k + 1, k + na + 1, k + 1, k + na + 2, k + na + 1); }
  }
  const land = new THREE.BufferGeometry(); land.setAttribute('position', new THREE.Float32BufferAttribute(terrainPositions, 3)); land.setIndex(terrainIndices); land.computeVertexNormals(); b.add(land, m.grass);

  // Circular altar and compressed stepped climb, left open along the central axis.
  const cz = -1.45;
  b.cylinder(0, 2.25, cz, 3.55, 3.8, .48, m.darkStone, 72);
  b.cylinder(0, 2.54, cz, 3.68, 3.68, .18, m.lightStone, 72);
  b.cylinder(0, 2.93, cz, 2.62, 2.7, .63, m.stone, 64);
  b.cylinder(0, 3.32, cz, 2.78, 2.78, .16, m.lightStone, 64);
  for (let i = 0; i < 30; i++) {
    const z = 6.75 - i * .158, top = .45 + i * .071;
    b.box(0, top - .09, z, 2.15, .18, .19, m.lightStone);
    for (const side of [-1, 1]) {
      b.box(side * 1.22, top + .07, z, .18, .18, .20, m.stone);
      if (i % 3 === 0) { b.cylinder(side * 1.23, top + .38, z, .055, .065, .6, m.lightStone, 8); b.ball(side * 1.23, top + .73, z, .09, .10, .09, m.lightStone, 1); }
    }
  }
  for (const side of [-1, 1]) tube(b, [[side * 1.23, 1.13, 6.8], [side * 1.23, 2.2, 4.4], [side * 1.23, 3.23, 2.08]], .07, m.lightStone, 30, 6);
  for (let i = 0; i < 56; i++) {
    const a = TAU * i / 56, x = Math.sin(a) * 3.38, z = cz + Math.cos(a) * 3.38;
    if (z > 1.15 && Math.abs(x) < 1.38) continue;
    b.cylinder(x, 2.91, z, .055, .07, .63, m.lightStone, 8); b.ball(x, 3.26, z, .09, .09, .09, m.lightStone, 1);
    const a2 = a + TAU / 56, x2 = Math.sin(a2) * 3.38, z2 = cz + Math.cos(a2) * 3.38;
    if (!(z2 > 1.15 && Math.abs(x2) < 1.38)) { b.rod([x, 3.14, z], [x2, 3.14, z2], .043, m.lightStone); b.rod([x, 2.87, z], [x2, 2.87, z2], .035, m.lightStone); }
  }
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU;
    b.add(new THREE.BoxGeometry(.37, .44, .025), m.bronzeShade, [Math.sin(a) * 2.66, 2.94, cz + Math.cos(a) * 2.66], [1, 1, 1], [0, a, 0]);
  }
  // Lotus throne: overlapping upper and lower petal whorls.
  b.cylinder(0, 3.58, cz, 2.25, 2.46, .35, m.bronze, 64);
  ring(b, 0, 3.8, cz, 2.19, .09, m.bronzeLit);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 26; i++) {
    const a = TAU * (i + row * .5) / 26, r = row ? 2.12 : 2.27;
    ellipsoid(b, [Math.sin(a) * r, 3.56 + row * .18, cz + Math.cos(a) * r], [.24, .4, .14], m.bronzeLit, [.36, a, 0], 14);
  }

  // Whole seated silhouette, modeled at the altar origin.
  const sculpt = new THREE.Group(), sb = new Batch(sculpt);
  const z0 = cz;
  ellipsoid(sb, [-.93, 4.13, z0 + .3], [1.42, .48, .82], m.bronze, [0, -.2, -.09]);
  ellipsoid(sb, [.91, 4.17, z0 + .39], [1.45, .49, .85], m.bronze, [0, .2, .09]);
  ellipsoid(sb, [-.17, 4.46, z0 + 1.03], [1.48, .28, .45], m.bronzeLit, [0, .08, -.05]);
  ellipsoid(sb, [.6, 4.43, z0 + .72], [.66, .21, .36], m.bronze, [0, -.3, -.13]);
  sb.add(continuousBodyGeometry(), m.bronze, [0, 0, z0]);
  // Raised right palm, separate curved fingers and an anatomical thumb.
  ellipsoid(sb, [-1.91, 7.02, z0 + 1.12], [.29, .36, .14], m.bronzeLit, [0, .1, -.07]);
  for (let i = 0; i < 4; i++) {
    const x = -2.11 + i * .135, len = [.44, .56, .59, .49][i];
    limb(sb, [[x, 7.19, z0 + 1.12], [x - .035, 7.4, z0 + 1.14], [x - .035, 7.19 + len, z0 + 1.07]], [.055, .063, .048], m.bronzeLit);
    ellipsoid(sb, [x - .035, 7.19 + len, z0 + 1.07], [.049, .068, .047], m.bronzeLit, [0, 0, 0], 12);
  }
  limb(sb, [[-1.68, 6.92, z0 + 1.12], [-1.5, 7.10, z0 + 1.14], [-1.52, 7.29, z0 + 1.10]], [.09, .085, .055], m.bronzeLit);
  tube(sb, [[-2.07, 7.07, z0 + 1.258], [-1.94, 6.99, z0 + 1.267], [-1.79, 7.05, z0 + 1.249]], .017, m.bronzeShade, 12, 5);
  // Left hand rests open in the lap; fingers rest across the folded robe.
  ellipsoid(sb, [.36, 4.95, z0 + 1.25], [.44, .12, .26], m.bronzeLit, [0, 0, .05]);
  for (let i = 0; i < 4; i++) limb(sb, [[.18, 4.96, z0 + 1.06 + i * .1], [-.09, 4.98, z0 + 1.08 + i * .105], [-.23, 4.96, z0 + 1.07 + i * .11]], [.049, .048, .038], m.bronzeLit);

  // Calm oval head, modeled brow, nose, eyelids, lips, elongated ears and curls.
  const head = new THREE.SphereGeometry(1, 40, 30), hp = head.attributes.position;
  for (let i = 0; i < hp.count; i++) { const yy = hp.getY(i); hp.setX(i, hp.getX(i) * (.9 + .1 * Math.max(0, yy))); }
  head.computeVertexNormals(); sb.add(head, m.bronzeLit, [0, 7.84, z0 + .045], [.65, .88, .59]);
  for (const side of [-1, 1]) {
    ellipsoid(sb, [side * .655, 7.76, z0 + .025], [.145, .43, .16], m.bronze);
    ellipsoid(sb, [side * .66, 7.47, z0 + .09], [.11, .22, .115], m.bronzeLit);
    tube(sb, [[side * .65, 8.08, z0 + .15], [side * .73, 7.98, z0 + .18], [side * .72, 7.69, z0 + .17], [side * .65, 7.58, z0 + .17]], .037, m.bronzeLit, 16, 6);
    tube(sb, [[side * .13, 8.01, z0 + .604], [side * .31, 8.06, z0 + .599], [side * .48, 7.97, z0 + .5]], .032, m.bronze, 16, 6);
    tube(sb, [[side * .13, 7.88, z0 + .62], [side * .30, 7.85, z0 + .615], [side * .45, 7.88, z0 + .546]], .018, m.mouth, 16, 5);
  }
  ellipsoid(sb, [0, 7.86, z0 + .592], [.105, .26, .115], m.bronzeLit);
  ellipsoid(sb, [0, 7.65, z0 + .676], [.14, .09, .105], m.bronzeLit);
  tube(sb, [[-.17, 7.46, z0 + .588], [0, 7.45, z0 + .645], [.17, 7.46, z0 + .588]], .022, m.mouth, 16, 5);
  tube(sb, [[-.14, 7.41, z0 + .582], [0, 7.40, z0 + .616], [.14, 7.41, z0 + .582]], .025, m.bronzeLit, 16, 6);
  ellipsoid(sb, [0, 8.17, z0 + .591], [.045, .044, .025], m.bronze, [0, 0, 0], 12);
  ellipsoid(sb, [0, 8.48, z0 + .025], [.61, .38, .56], m.hair);
  ellipsoid(sb, [0, 8.82, z0 + .015], [.30, .34, .29], m.hair);
  for (let row = 0; row < 7; row++) {
    const phi = .18 + row * .18, rad = .625 * Math.sin(phi + .55), yy = 8.47 + .39 * Math.cos(phi + .55);
    const n = 12 + row * 4;
    for (let i = 0; i < n; i++) { const a = TAU * (i + row * .5) / n; ellipsoid(sb, [Math.sin(a) * rad, yy, z0 + .025 + Math.cos(a) * rad * .92], [.067, .064, .066], i % 4 ? m.hair : m.bronzeShade, [0, 0, 0], 10); }
  }
  for (let row = 0; row < 3; row++) for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ellipsoid(sb, [.26 * Math.sin(a), 8.73 + row * .1, z0 + .24 * Math.cos(a)], [.058, .06, .058], m.hair, [0, 0, 0], 10); }
  // Raised cloth ridges follow the curved torso and thighs, not flat decals.
  for (let i = 0; i < 8; i++) {
    const y = 6.69 - i * .21;
    tube(sb, [[-1.15 + i * .02, y, z0 + .42], [-.66, y - .38, z0 + .79], [.2, y - .57, z0 + .87], [1.06 - i * .025, y - .64, z0 + .48]], .035, m.bronzeLit, 22, 6);
  }
  for (let i = 0; i < 6; i++) tube(sb, [[-1.84 + i * .11, 4.19, z0 + .85], [-.87, 4.2 + i * .06, z0 + 1.11], [.04, 4.29 + i * .025, z0 + 1.37], [.94, 4.24 + i * .035, z0 + 1.05]], .025, m.bronzeLit, 20, 5);
  sb.finish(); group.add(sculpt);

  temple(b, 4.65, height(4.65, -3.9), -3.9, .89, m);
  temple(b, 5.35, height(5.35, -.85), -.85, .56, m);
  // Po Lin-style entry gate is a contextual vignette, deliberately compressed.
  const gy = height(4.5, 2.8);
  for (const x of [3.58, 4.5, 5.42]) b.cylinder(x, gy + .64, 2.8, .09, .12, 1.28, m.stone, 10);
  roof(b, 4.5, gy + 1.28, 2.8, 2.7, .65, .36, m);
  b.box(4.5, gy + 1.15, 2.8, 2.38, .18, .16, m.red);
  for (let i = 0; i < 70; i++) {
    const a = random() * TAU, r = 4.15 + random() * 3.8, x = Math.cos(a) * r, z = Math.sin(a) * r * .84;
    if ((Math.abs(x) < 1.65 && z > 1.0) || (x > 3.1 && x < 6.65 && z > -5.1 && z < 3.5)) continue;
    simpleTree(b, x, height(x, z) - .04, z, .72 + random() * .75, m);
  }
  b.finish();
  return {
    group,
    camera: { position: [15.18, 12.65, 19.4], target: [0, 3.3, -.4] },
    hotspots: [
      { label: '天坛大佛', position: [0, 9.45, cz], description: '昂坪的青铜坐佛。抬起的右掌、结跏趺坐与莲花宝座，以实体几何重新创作。' },
      { label: '拾级登坛', position: [0, 1.9, 4.7], description: '登坛石阶连接山脚与圆形基座；微缩作品压缩了实地阶数、尺度与坡度。' },
      { label: '宝莲禅寺', position: [4.65, 3.4, -3.9], description: '以寺院重檐与昂坪山林交代环境。建筑位置和周边路径作了艺术化合并。' },
    ],
    description: '青铜坐佛端坐于莲台之上，长阶从山林间拾级而上，寺院重檐掩映在昂坪的绿色山地中。',
    update() {},
  };
}
