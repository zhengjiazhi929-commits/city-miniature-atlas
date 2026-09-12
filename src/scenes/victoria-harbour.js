import * as THREE from 'three';
import { Batch, material, roundedShape, polygonShape, slab, simpleTree, rng } from './hong-kong-geometry.js';

const TAU = Math.PI * 2;
export function harbourPalette() {
  return {
    base: material('#d6cdbb'), paving: material('#dedcc9'), cream: material('#ede9d9'),
    glass: material('#617d8a', .33, .24), glassLight: material('#8ba6ad', .31, .23), glassDark: material('#3f606d', .38, .2),
    bronze: material('#a28a62', .5, .25), metal: material('#c6d1cb', .44, .3), white: material('#ecece0', .63),
    water: material('#5c938a', .29, .12), ripple: material('#9abbab', .5), road: material('#858f86'),
    lawn: material('#8eaa72'), bark: material('#685742'), leaves: [material('#557858'), material('#728c5c'), material('#9cab72')],
    ferryGreen: material('#376b54'), ferryDark: material('#253f3b'), red: material('#a8422c'), brick: material('#b97854'), stone: material('#d9cfac'), gold: material('#c6a15d', .5, .35),
  };
}

function outline(batch, points, y, radius, mat, close = true) {
  for (let i = 0; i < points.length - (close ? 0 : 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length]; batch.rod([a[0], y, a[1]], [b[0], y, b[1]], radius, mat);
  }
}

function facade(batch, x, y, z, width, depth, height, glass, trim, step = .2) {
  batch.box(x, y + height / 2, z, width, height, depth, glass);
  for (let yy = y + .12; yy < y + height; yy += step) {
    batch.box(x, yy, z, width + .015, .022, depth + .015, trim);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 4; i++) batch.box(x - width / 2 + i * width / 4, y + height / 2, z + side * (depth / 2 + .009), .015, height, .022, trim);
    for (let i = 0; i <= 3; i++) batch.box(x + side * (width / 2 + .009), y + height / 2, z - depth / 2 + i * depth / 3, .022, height, .015, trim);
  }
}

export function addIFC(batch, x, y, z, scale, m) {
  const height = 6.7 * scale, width = 1.45 * scale, depth = 1.04 * scale;
  const ring = (t) => {
    const taper = 1 - .15 * t * t;
    return Array.from({ length: 32 }, (_, i) => { const a = i / 32 * TAU; return [x + Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), .55) * width * .5 * taper, z + Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), .55) * depth * .5 * taper]; });
  };
  const positions = [], indices = [];
  for (let j = 0; j <= 12; j++) for (const [xx, zz] of ring(j / 12)) positions.push(xx, y + j / 12 * height, zz);
  for (let j = 0; j < 12; j++) for (let i = 0; i < 32; i++) { const a = j * 32 + i, b = j * 32 + (i + 1) % 32, c = a + 32, d = b + 32; indices.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); batch.add(g, m.glassLight);
  for (let j = 1; j < 49; j++) outline(batch, ring(j / 49), y + j / 49 * height, .012 * scale, m.metal);
  for (let i = 0; i < 32; i += 2) batch.curve(Array.from({ length: 7 }, (_, j) => { const p = ring(j / 6)[i]; return [p[0], y + j / 6 * height, p[1]]; }), .017 * scale, m.cream, 6);
  // Two ifc's split finial crown, open above a recessed roof.
  const top = ring(1); outline(batch, top, y + height, .035 * scale, m.metal);
  batch.box(x, y + height - .055 * scale, z, width * .68, .1 * scale, depth * .58, m.glassDark);
  for (let i = 0; i < 32; i++) {
    const p = top[i], h = (.15 + .35 * Math.abs(Math.cos(i / 32 * TAU)) ** 3) * scale;
    batch.rod([p[0], y + height - .07 * scale, p[1]], [p[0] * .98 + x * .02, y + height + h, p[1] * .98 + z * .02], .021 * scale, m.metal);
  }
  batch.box(x, y + .13 * scale, z, width * 1.25, .26 * scale, depth * 1.25, m.paving);
}

function prism(batch, points, topHeights, y, mat) {
  const positions = [], indices = [], n = points.length;
  points.forEach(([x, z]) => positions.push(x, y, z));
  points.forEach(([x, z], i) => positions.push(x, y + topHeights[i], z));
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(i, n + i, j, j, n + i, n + j); }
  for (let i = 1; i < n - 1; i++) indices.push(n, n + i + 1, n + i);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); batch.add(geometry, mat);
}

export function addBankOfChina(batch, x, y, z, scale, m) {
  const r = .68 * scale;
  const corners = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([xx, zz]) => [x + xx, z + zz]);
  const tops = [[6.1, 6.5, 5.65], [5.65, 5.65, 4.5], [4.5, 4.5, 3.85], [5.3, 3.85, 5.3]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, points = [[x, z], corners[i], corners[j]], h = tops[i].map((v) => v * scale);
    prism(batch, points, h, y, i % 2 ? m.glassLight : m.glass);
    const topPts = points.map(([xx, zz], k) => [xx, y + h[k], zz]);
    for (let k = 0; k < 3; k++) batch.rod(topPts[k], topPts[(k + 1) % 3], .027 * scale, m.white);
    const a = corners[i], b = corners[j], ha = h[1], hb = h[2], common = Math.min(ha, hb);
    batch.rod([a[0], y, a[1]], [a[0], y + ha, a[1]], .027 * scale, m.white);
    for (let level = 0; level < 3; level++) {
      const bottom = level * 1.25 * scale, top = Math.min(common, bottom + 1.25 * scale);
      batch.rod([a[0], y + bottom, a[1]], [b[0], y + top, b[1]], .022 * scale, m.white);
      batch.rod([b[0], y + bottom, b[1]], [a[0], y + top, a[1]], .022 * scale, m.white);
    }
    for (let floor = .13 * scale; floor < common; floor += .18 * scale) batch.rod([a[0], y + floor, a[1]], [b[0], y + floor, b[1]], .006 * scale, m.glassDark, 4);
  }
  for (const xx of [-.12, .14]) batch.cylinder(x + xx * scale, y + 6.75 * scale, z - .48 * scale, .018 * scale, .025 * scale, 1.3 * scale, m.metal, 7);
  batch.box(x, y + .12 * scale, z, 1.8 * scale, .24 * scale, 1.7 * scale, m.paving);
}

function addCentralPlaza(batch, x, y, z, scale, m) {
  const points = [[-.68, .42], [.68, .42], [0, -.73]].map(([a, b]) => [x + a * scale, z + b * scale]);
  prism(batch, points, [5.35 * scale, 5.35 * scale, 5.35 * scale], y, m.bronze);
  for (let yy = .17; yy < 5.35; yy += .17) outline(batch, points, y + yy * scale, .014 * scale, m.glassLight);
  for (const p of points) batch.rod([p[0], y, p[1]], [p[0], y + 5.35 * scale, p[1]], .043 * scale, m.cream);
  batch.cylinder(x, y + 5.52 * scale, z, .21 * scale, .52 * scale, .52 * scale, m.bronze, 3);
  batch.cylinder(x, y + 6.08 * scale, z, .02 * scale, .18 * scale, .8 * scale, m.metal, 8);
  batch.cylinder(x, y + 6.64 * scale, z, .01 * scale, .022 * scale, .45 * scale, m.metal, 8);
}

function addConventionCentre(batch, x, y, z, m) {
  batch.add(new THREE.CylinderGeometry(1, 1.05, .22, 48), m.paving, [x, y, z], [1.88, 1, 1.16]);
  batch.box(x, y + .38, z, 2.9, .7, 1.55, m.glass);
  for (let i = -12; i <= 12; i++) batch.box(x + i * .112, y + .44, z + .79, .017, .68, .02, m.metal);
  const sample = (u, v) => [x + u * 1.88 * (.88 + .12 * (1 - v * v)), y + .66 + .45 * Math.cos(u * Math.PI / 2) + .24 * Math.sin(v * Math.PI / 2) + .16 * Math.abs(u) ** 3, z + v * 1.05 * (1 - .3 * u * u)];
  const positions = [], indices = [], nu = 40, nv = 24;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) positions.push(...sample(i / nu * 2 - 1, j / nv * 2 - 1));
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1; indices.push(a, c, b, b, c, c + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); batch.add(g, m.metal);
  for (const v of [-1, 1]) batch.curve(Array.from({ length: 25 }, (_, i) => sample(i / 24 * 2 - 1, v)), .03, m.white, 24);
  for (let i = 0; i <= 16; i++) batch.curve(Array.from({ length: 17 }, (_, j) => sample(i / 16 * 2 - 1, j / 16 * 2 - 1).map((p, k) => k === 1 ? p + .009 : p)), .008, m.cream, 16);
}

export function addClockTower(batch, x, y, z, scale, m) {
  const b = (xx, yy, zz, w, h, d, mat) => batch.box(x + xx * scale, y + yy * scale, z + zz * scale, w * scale, h * scale, d * scale, mat);
  b(0, .08, 0, .68, .16, .68, m.stone); b(0, .82, 0, .43, 1.5, .43, m.brick);
  for (const xx of [-.19, .19]) for (const zz of [-.19, .19]) b(xx, .83, zz, .07, 1.48, .07, m.stone);
  for (const yy of [.22, 1.14, 1.45]) b(0, yy, 0, .49, .06, .49, m.stone);
  b(0, 1.63, 0, .48, .34, .48, m.brick);
  for (let side = 0; side < 4; side++) {
    const a = side * Math.PI / 2, q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
    const xx = x + Math.sin(a) * .247 * scale, zz = z + Math.cos(a) * .247 * scale;
    batch.add(new THREE.CircleGeometry(.118 * scale, 24), m.cream, [xx, y + 1.65 * scale, zz], [1, 1, 1], q);
    batch.add(new THREE.TorusGeometry(.125 * scale, .012 * scale, 4, 24), m.stone, [xx, y + 1.65 * scale, zz], [1, 1, 1], q);
    batch.rod([xx, y + 1.65 * scale, zz], [xx, y + 1.725 * scale, zz], .008 * scale, m.ferryDark, 4);
    batch.rod([xx, y + 1.65 * scale, zz], [xx + Math.cos(a) * .061 * scale, y + 1.62 * scale, zz - Math.sin(a) * .061 * scale], .008 * scale, m.ferryDark, 4);
  }
  b(0, 1.85, 0, .56, .085, .56, m.stone);
  batch.cylinder(x, y + 1.98 * scale, z, .13 * scale, .27 * scale, .22 * scale, m.bronze, 4);
  batch.cylinder(x, y + 2.19 * scale, z, .012 * scale, .022 * scale, .32 * scale, m.metal, 8);
}

export function createFerryModel(m = harbourPalette(), detailed = false) {
  const group = new THREE.Group(), batch = new Batch(group);
  // Symmetric bow and stern are essential to Star Ferry's double-ended silhouette.
  const outlinePoints = [[0, -1.55], [.3, -1.2], [.43, -.8], [.43, .8], [.3, 1.2], [0, 1.55], [-.3, 1.2], [-.43, .8], [-.43, -.8], [-.3, -1.2]];
  slab(batch, polygonShape(outlinePoints), .16, .28, m.ferryGreen, .018);
  slab(batch, polygonShape(outlinePoints.map(([x, z]) => [x * .97, z * .97])), .21, .055, m.white, .01);
  batch.box(0, .4, 0, .77, .4, 2.02, m.ferryGreen);
  batch.box(0, .67, 0, .9, .065, 2.36, m.white);
  batch.box(0, .91, 0, .74, .42, 1.94, m.cream);
  batch.box(0, 1.17, 0, .91, .075, 2.24, m.white);
  // Both passenger decks have open dark window rhythm, short columns and rails.
  for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
    batch.box(side * .389, .43, -.87 + i * .218, .022, .23, .155, m.ferryDark);
    batch.box(side * .379, .93, -.83 + i * .21, .022, .25, .15, m.glassDark);
    batch.cylinder(side * .427, .87, -.94 + i * .235, .011, .013, .37, m.white, 5);
  }
  for (const side of [-1, 1]) for (const yy of [.31, .52, .74, 1.06]) batch.rod([side * .426, yy, -1.12], [side * .426, yy, 1.12], .011, m.white);
  for (const zz of [-.96, .96]) {
    batch.box(0, .96, zz, .52, .31, .3, m.white);
    batch.box(0, .99, zz + Math.sign(zz) * .16, .4, .16, .013, m.glassDark);
    batch.box(0, 1.16, zz, .67, .065, .48, m.white);
  }
  batch.cylinder(0, 1.35, -.08, .105, .14, .35, m.ferryGreen, 10);
  batch.cylinder(0, 1.54, -.08, .13, .13, .045, m.ferryDark, 10);
  batch.cylinder(0, 1.5, .56, .012, .018, .65, m.metal, 6);
  // Geometric star emblems on the funnel, no logos or image textures.
  for (const side of [-1, 1]) {
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + Math.PI / 2, r = i % 2 ? .025 : .055; const xx = Math.cos(a) * r, yy = Math.sin(a) * r; i ? star.lineTo(xx, yy) : star.moveTo(xx, yy); }
    star.closePath(); const g = new THREE.ShapeGeometry(star); g.rotateY(side * Math.PI / 2); batch.add(g, m.white, [side * .122, 1.36, -.08]);
  }
  if (detailed) {
    for (const side of [-1, 1]) for (const z of [-.66, .5]) batch.add(new THREE.TorusGeometry(.075, .018, 6, 20), m.red, [side * .44, .9, z], [1, 1, 1], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 11; i++) batch.box(0, .252, -.95 + i * .19, .66, .012, .015, m.bronze);
    for (const zz of [-1.3, 1.3]) for (const xx of [-.2, .2]) batch.cylinder(xx, .26, zz, .024, .031, .095, m.ferryDark, 7);
    for (const side of [-1, 1]) for (let i = 0; i < 15; i++) batch.cylinder(side * .426, .4, -1.03 + i * .147, .009, .009, .27, m.white, 5);
  }
  batch.finish();
  // Ferries are broad, low vessels; preserve two decks without a bus-like height.
  for (const mesh of group.children) { mesh.geometry.scale(1, .66, 1.14); mesh.geometry.computeBoundingSphere(); }
  return group;
}

export function addFerryPier(batch, x, y, z, scale, m, north = true) {
  batch.box(x, y, z, 1.04 * scale, .14 * scale, 1.9 * scale, m.paving);
  for (const dx of [-.41, .41]) for (const dz of [-.75, 0, .75]) batch.cylinder(x + dx * scale, y - .2 * scale, z + dz * scale, .045 * scale, .065 * scale, .5 * scale, m.road, 6);
  batch.box(x, y + .35 * scale, z, .9 * scale, .53 * scale, 1.64 * scale, m.cream);
  for (const dx of [-.46, .46]) for (let i = 0; i < 7; i++) batch.box(x + dx * scale, y + .4 * scale, z + (-.67 + i * .224) * scale, .025 * scale, .3 * scale, .14 * scale, m.ferryDark);
  const g = new THREE.CylinderGeometry(.68, .68, 1.84, 3, 1); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); batch.add(g, m.ferryGreen, [x, y + .65 * scale, z], [scale, .35 * scale, scale]);
  for (let i = 0; i < 7; i++) batch.box(x, y + .13 * scale, z + (north ? -1 : 1) * (1 + i * .06) * scale, .76 * scale, .03 * scale, .04 * scale, m.wood || m.bronze);
}

function ridge(group, m) {
  const n = 86, d = 22, positions = [], colors = [], indices = [], lo = new THREE.Color('#739063'), hi = new THREE.Color('#9eb282');
  for (let j = 0; j <= d; j++) for (let i = 0; i <= n; i++) {
    const x = (i / n - .5) * 17.2, z = -7 + j / d * 2.5;
    const envelope = Math.sin(j / d * Math.PI) ** .75;
    const yy = .28 + envelope * (2.85 * Math.exp(-((x + 3.4) ** 2) / 14) + 1.95 * Math.exp(-((x - 3.3) ** 2) / 7) + .15 * Math.sin(x * 1.4));
    positions.push(x, yy, z); const c = lo.clone().lerp(hi, Math.max(0, (yy - .3) / 2)); colors.push(c.r, c.g, c.b);
    if (j < d && i < n) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1; indices.push(a, c, b, b, c, c + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setIndex(indices); g.computeVertexNormals(); const mat = material('#ffffff'); mat.vertexColors = true; const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
}

export function createVictoriaHarbour() {
  const group = new THREE.Group(), batch = new Batch(group), m = harbourPalette(), random = rng(1841);
  slab(batch, roundedShape(18, 14.8, 1), -.14, .64, m.base, .09);
  slab(batch, roundedShape(17.82, 14.62, .95), .035, .16, m.water, .025);
  const island = [[-8.6, -7.1], [8.6, -7.1], [8.6, -2.1], [6.9, -1.8], [5.2, -1.9], [3.7, -1.35], [1.7, -1.8], [-.4, -1.95], [-2.7, -1.78], [-5.4, -1.95], [-8.6, -2.1]];
  slab(batch, polygonShape(island), .27, .38, m.paving, .045);
  const kowloon = [[-8.6, 5], [-5.6, 4.85], [-3, 4.9], [-1.1, 4.4], [1.3, 4.55], [4.5, 4.6], [8.6, 4.25], [8.6, 7.1], [-8.6, 7.1]];
  slab(batch, polygonShape(kowloon), .29, .42, m.paving, .045);
  ridge(group, m);
  batch.box(0, .304, -2.58, 16.95, .04, .37, m.road);
  for (let i = -16; i <= 16; i++) batch.box(i * .48, .327, -2.58, .22, .007, .018, m.cream);
  const skip = (x, z) => Math.hypot(x + 4.5, z + 3.3) < 1.12 || Math.hypot(x + 1.7, z + 4.2) < 1.15 || Math.hypot(x - 4.55, z + 4.35) < 1.05;
  for (let row = 0; row < 2; row++) for (let i = 0; i < 17; i++) {
    const x = -7.75 + i * .96, z = row ? -5.23 : -3.48;
    if (skip(x, z)) continue;
    const h = .9 + random() * (row ? 1.8 : 2.35), w = .51 + random() * .24, d = .58 + random() * .24;
    facade(batch, x, .3, z, w, d, h, [m.glass, m.glassLight, m.glassDark, m.bronze][i % 4], i % 2 ? m.metal : m.paving, .21);
    batch.box(x, .3 + h + .05, z, w * .42, .11, d * .42, m.road);
  }
  addIFC(batch, -4.5, .3, -3.4, 1, m);
  addBankOfChina(batch, -1.7, .3, -4.12, .87, m);
  addCentralPlaza(batch, 4.55, .3, -4.2, .85, m);
  addConventionCentre(batch, 3.6, .34, -1.52, m);
  // Central's ferry pier sits west of the convention centre, across from Kowloon.
  addFerryPier(batch, -4.05, .25, -1.07, .66, m, false);
  addFerryPier(batch, -1.25, .25, 4.12, .66, m, true);
  addClockTower(batch, .32, .3, 5.2, .85, m);
  // Low cultural waterfront massing keeps the foreground open to the skyline.
  batch.box(3.35, .52, 6.1, 3.7, .45, 1.5, m.cream);
  const cultureRoof = new THREE.CylinderGeometry(1, 1, 3.6, 32, 1, true, 0, Math.PI); cultureRoof.rotateZ(Math.PI / 2);
  batch.add(cultureRoof, m.paving, [3.35, .65, 6.15], [1, .55, .95]);
  for (let i = 0; i < 25; i++) {
    const x = -8.1 + i * .66, z = 5 + .1 * Math.cos(x);
    if (Math.abs(x - .3) < .7 || Math.abs(x + 1.25) < .7) continue;
    batch.cylinder(x, .35, z, .15, .17, .11, m.cream, 10); simpleTree(batch, x, .41, z, .51 + random() * .1, m);
    batch.rod([x, .32, z - .35], [x, .8, z - .35], .017, m.metal); batch.ball(x, .83, z - .35, .055, .055, .055, m.white, 0);
  }
  for (let i = 0; i < 48; i++) {
    const x = random() * 16 - 8, z = random() * 5.5 - 1.4;
    const len = .12 + random() * .35; batch.curve([[x - len, .074, z], [x, .077, z + .02], [x + len, .074, z]], .007, m.ripple, 4);
  }
  batch.finish();
  const ferry = createFerryModel(m, true); ferry.scale.setScalar(.8); group.add(ferry);
  const secondFerry = createFerryModel(m); secondFerry.scale.setScalar(.52); secondFerry.position.set(5.7, .1, 1.4); secondFerry.rotation.y = .5; group.add(secondFerry);
  const camera = { position: [20, 17, 24], target: [0, 2.5, -.2] };
  const hotspots = [
    { label: '港岛天际线', position: [-3.8, 7.6, -3.5], description: '国金二期、中银大厦与湾仔的高楼沿海岸展开，山脊在城市背后。建筑间距经过艺术化压缩。' },
    { label: '香港会展中心', position: [3.65, 1.85, -1.5], description: '向海伸出的会展中心，以飞鸟展翅般的弧形屋顶成为维港岸线的标志。' },
    { label: '尖沙咀海旁', position: [.35, 2.7, 5.2], description: '隔海望向港岛。钟楼、天星码头与滨海步道共同构成这段观景海岸。' },
  ];
  return { group, hotspots, camera, description: '越过一湾碧水，收藏香港的山、海与城市天际线。', update(time = 0) {
    if (!Number.isFinite(time)) return;
    const t = .5 + .5 * Math.sin(time * .035 - .8); ferry.position.set(-3.3 + t * 1.5, .1 + .015 * Math.sin(time * .7), .05 + t * 2.8); ferry.rotation.y = Math.atan2(1.5, 2.8);
    secondFerry.position.y = .1 + .009 * Math.sin(time * .8 + 2);
  } };
}
