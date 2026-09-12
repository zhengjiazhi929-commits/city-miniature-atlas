import * as THREE from 'three';

// Hand-authored miniature: recognizable landmarks, compressed scenic geography.
// Geometry is batched by material so architectural detail does not become a
// separate draw call per window, railing, roof tile, or tree branch.
const TAU = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0);
const V = (p) => new THREE.Vector3(...p);

function rng(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function palette() {
  const m = (color, roughness = .85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    base: m('#d8cdb7'), rim: m('#ece3cc'), soil: m('#8c9f72'), grass: m('#8d9f70'),
    foliage: [m('#496e53'), m('#648260'), m('#82955e'), m('#a6ac70')],
    willow: m('#92a95b'), willowDark: m('#6f8952'), bark: m('#685444'),
    stone: m('#ddd5b8'), stoneLight: m('#f0e5cc'), stoneDark: m('#9b9b83'),
    wood: m('#754b35'), red: m('#99593d'), roof: m('#aa8450', .66, .16),
    roofDark: m('#5f5948'), gold: m('#c8a468', .58, .22), dark: m('#343d32'),
    boat: m('#ad6c41'), sail: m('#edddae'), lotus: m('#adb77e'), blossom: m('#e7ae9b'),
    water: m('#639889', .3, .13), ripple: m('#8aafa0', .5, .05),
  };
}

class Batch {
  constructor(group) { this.group = group; this.buckets = new Map(); this.matrix = new THREE.Matrix4(); }
  add(geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = null) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const q = rotation instanceof THREE.Quaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0])));
    this.matrix.compose(V(position), q, V(scale)); g.applyMatrix4(this.matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
  }
  box(x, y, z, w, h, d, mat, rotation = [0, 0, 0]) { this.add(new THREE.BoxGeometry(w, h, d), mat, [x, y, z], [1, 1, 1], rotation); }
  cylinder(x, y, z, rt, rb, h, mat, n = 12) { this.add(new THREE.CylinderGeometry(rt, rb, h, n), mat, [x, y, z]); }
  ball(x, y, z, sx, sy, sz, mat, detail = 1) { this.add(new THREE.IcosahedronGeometry(1, detail), mat, [x, y, z], [sx, sy, sz]); }
  rod(a, b, r, mat, n = 6) {
    const start = V(a), end = V(b), axis = end.clone().sub(start), len = axis.length();
    if (len < .00001) return;
    this.add(new THREE.CylinderGeometry(r, r, len, n), mat, start.add(end).multiplyScalar(.5).toArray(), [1, 1, 1], new THREE.Quaternion().setFromUnitVectors(Y, axis.normalize()));
  }
  curve(points, r, mat, seg = 12) {
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)), seg, r, 4, false), mat);
  }
  finish() {
    for (const [material, list] of this.buckets) {
      const total = list.reduce((s, g) => s + g.attributes.position.count, 0);
      const positions = new Float32Array(total * 3), normals = new Float32Array(total * 3);
      let offset = 0;
      for (const g of list) {
        positions.set(g.attributes.position.array, offset); normals.set(g.attributes.normal.array, offset);
        offset += g.attributes.position.array.length; g.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.buckets.clear();
  }
}

function roundedShape(width, depth, radius) {
  const x = -width / 2, z = -depth / 2, s = new THREE.Shape();
  s.moveTo(x + radius, z); s.lineTo(x + width - radius, z);
  s.quadraticCurveTo(x + width, z, x + width, z + radius);
  s.lineTo(x + width, z + depth - radius); s.quadraticCurveTo(x + width, z + depth, x + width - radius, z + depth);
  s.lineTo(x + radius, z + depth); s.quadraticCurveTo(x, z + depth, x, z + depth - radius);
  s.lineTo(x, z + radius); s.quadraticCurveTo(x, z, x + radius, z);
  return s;
}

function slab(batch, shape, top, thickness, material, bevel = .07) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0, bevelSegments: 3, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 16 });
  geometry.rotateX(-Math.PI / 2);
  batch.add(geometry, material, [0, top - thickness, 0]);
}

function terrain(batch, height, mat) {
  const nx = 100, nz = 82, positions = [], indices = [], colors = [];
  const low = new THREE.Color('#a2ae79'), high = new THREE.Color('#708655');
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      let x = (i / nx - .5) * 16.65, z = (j / nz - .5) * 13.65;
      // Round the grid boundary into the same footprint as the display plinth.
      const ax = Math.abs(x), az = Math.abs(z), cx = 7.52, cz = 6.02;
      if (ax > cx && az > cz) {
        const dx = ax - cx, dz = az - cz, len = Math.hypot(dx, dz);
        if (len > .8) { x = Math.sign(x) * (cx + dx / len * .8); z = Math.sign(z) * (cz + dz / len * .8); }
      }
      const yy = height(x, z);
      positions.push(x, yy, z);
      const c = low.clone().lerp(high, THREE.MathUtils.clamp(yy / 2 + .07 * Math.sin(x * 1.5 + z * .7), 0, 1));
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices); g.computeVertexNormals();
  const material = mat.clone(); material.color.set('#ffffff'); material.vertexColors = true;
  const mesh = new THREE.Mesh(g, material); mesh.castShadow = true; mesh.receiveShadow = true; batch.group.add(mesh);
}

function groundPath(batch, points, width, height, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const positions = [], indices = [];
  for (let i = 0; i <= 100; i++) {
    const p = curve.getPoint(i / 100), t = curve.getTangent(i / 100), n = new THREE.Vector3(-t.z, 0, t.x);
    for (const sign of [-1, 1]) {
      const q = p.clone().addScaledVector(n, sign * width / 2); positions.push(q.x, height(q.x, q.z) + .035, q.z);
    }
    if (i < 100) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); batch.add(g, mat);
}

function roof(batch, x, y, z, radius, rise, mat, trim, sides = 8) {
  const rows = 8, cols = 8, positions = [], indices = [];
  const point = (face, u, t) => {
    const a = face / sides * TAU + Math.PI / sides, b = (face + 1) / sides * TAU + Math.PI / sides;
    const px = Math.cos(a) * (1 - u) + Math.cos(b) * u, pz = Math.sin(a) * (1 - u) + Math.sin(b) * u;
    const r = radius * (.22 + .78 * t);
    const h = rise * Math.pow(1 - t, 1.7) + .14 * radius * Math.pow(t, 5) * Math.pow(Math.abs(u * 2 - 1), 6);
    return [x + px * r, y + h, z + pz * r];
  };
  for (let f = 0; f < sides; f++) {
    const offset = positions.length / 3;
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) positions.push(...point(f, c / cols, r / rows));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = offset + r * (cols + 1) + c, b = a + 1, d = a + cols + 1;
      indices.push(a, b, d, b, d + 1, d);
    }
    batch.curve(Array.from({ length: 9 }, (_, i) => point(f, i / 8, 1)), .025, trim, 8);
    batch.curve(Array.from({ length: 9 }, (_, i) => point(f, 0, i / 8).map((v, k) => k === 1 ? v + .014 : v)), .026, trim, 8);
    // Thin raised tile courses follow the roof's actual concave profile.
    for (const u of [.25, .5, .75]) batch.curve(Array.from({ length: 7 }, (_, i) => point(f, u, i / 6).map((v, k) => k === 1 ? v + .007 : v)), .009, trim, 6);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); batch.add(g, mat);
  // Finish the central octagonal crown, hidden under the next story or finial.
  batch.cylinder(x, y + rise - .012, z, radius * .22, radius * .22, .035, mat, sides);
}

function octagonRail(batch, x, y, z, r, mat, height = .28) {
  for (let side = 0; side < 8; side++) {
    const a = side * TAU / 8 + Math.PI / 8, b = a + TAU / 8;
    const p = [x + Math.cos(a) * r, y, z + Math.sin(a) * r], q = [x + Math.cos(b) * r, y, z + Math.sin(b) * r];
    for (const h of [height * .42, height]) batch.rod([p[0], y + h, p[2]], [q[0], y + h, q[2]], .023, mat);
    for (let j = 0; j < 4; j++) {
      const t = j / 4, xx = p[0] * (1 - t) + q[0] * t, zz = p[2] * (1 - t) + q[2] * t;
      batch.cylinder(xx, y + height / 2, zz, .025, .025, height + .055, mat, 6);
    }
  }
}

function pagoda(batch, x, y, z, m, scale = 1) {
  // All nested dimensions are proportionate to the tower, with a broad plinth.
  for (let i = 0; i < 3; i++) batch.cylinder(x, y + (.07 + i * .1) * scale, z, (1.65 - i * .1) * scale, (1.69 - i * .1) * scale, .12 * scale, i === 2 ? m.stoneLight : m.stone, 8);
  octagonRail(batch, x, y + .35 * scale, z, 1.5 * scale, m.stoneLight, .28 * scale);
  const bodyBase = y + .36 * scale;
  for (let floor = 0; floor < 5; floor++) {
    const yy = bodyBase + floor * .94 * scale, r = (1.06 - floor * .083) * scale, h = (floor === 0 ? .85 : .75) * scale;
    batch.cylinder(x, yy + h / 2, z, r * .79, r * .8, h, m.red, 8);
    batch.cylinder(x, yy + .045 * scale, z, r * 1.2, r * 1.2, .08 * scale, m.wood, 8);
    octagonRail(batch, x, yy + .07 * scale, z, r * 1.15, m.red, .25 * scale);
    for (let face = 0; face < 8; face++) {
      const angle = face * Math.PI / 4, nx = Math.cos(angle), nz = Math.sin(angle), tx = -nz, tz = nx;
      for (let bay = -1; bay <= 1; bay++) {
        const tangential = bay * r * .19;
        const wx = x + nx * r * .748 + tx * tangential, wz = z + nz * r * .748 + tz * tangential;
        batch.box(wx, yy + h * .57, wz, r * .15, h * .52, .028 * scale, m.dark, [0, Math.PI / 2 - angle, 0]);
        batch.rod([wx + tx * r * .026, yy + h * .33, wz + tz * r * .026], [wx + tx * r * .026, yy + h * .83, wz + tz * r * .026], .009 * scale, m.gold);
      }
      const corner = angle + Math.PI / 8;
      const px = x + Math.cos(corner) * r, pz = z + Math.sin(corner) * r;
      batch.cylinder(px, yy + h / 2, pz, .047 * scale, .052 * scale, h, m.red, 8);
      batch.box(px, yy + h - .11 * scale, pz, .17 * scale, .055 * scale, .17 * scale, m.gold, [0, -corner, 0]);
      batch.box(px, yy + h - .055 * scale, pz, .24 * scale, .05 * scale, .22 * scale, m.wood, [0, -corner, 0]);
    }
    roof(batch, x, yy + h, z, r * 1.48, .42 * scale, m.roof, m.gold);
  }
  const top = bodyBase + 4 * .94 * scale + .75 * scale + .44 * scale;
  batch.cylinder(x, top + .07 * scale, z, .14 * scale, .23 * scale, .18 * scale, m.gold, 12);
  batch.cylinder(x, top + .46 * scale, z, .015 * scale, .07 * scale, .8 * scale, m.gold, 12);
  for (let i = 0; i < 6; i++) batch.cylinder(x, top + (.19 + i * .09) * scale, z, (.14 - i * .013) * scale, (.14 - i * .013) * scale, .034 * scale, m.gold, 12);
  batch.ball(x, top + .88 * scale, z, .075 * scale, .115 * scale, .075 * scale, m.gold);
  // Front stairway visibly joins the octagonal platform and the hillside.
  for (let i = 0; i < 8; i++) batch.box(x, y + .025 + (7 - i) * .043 * scale, z + (1.25 + i * .13) * scale, .75 * scale, .065 * scale, .19 * scale, m.stoneLight);
}

function tree(batch, x, y, z, size, m, rand, willow = false) {
  const h = size * (willow ? 1.28 : 1.1);
  batch.rod([x, y - .04, z], [x + size * .07, y + h * .74, z], size * .055, m.bark, 7);
  if (willow) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + rand() * .2, dx = Math.cos(a), dz = Math.sin(a);
      const ex = x + dx * size * .49, ez = z + dz * size * .49;
      batch.curve([[x, y + h * .6, z], [x + dx * size * .28, y + h * .93, z + dz * size * .28], [ex, y + h * .85, ez]], size * .026, m.bark, 6);
      for (let j = 0; j < 3; j++) {
        const aa = a + (j - 1) * .24, sx = Math.cos(aa), sz = Math.sin(aa);
        const reach = size * (.63 + rand() * .18), low = y + size * (.18 + rand() * .22);
        const strand = new THREE.CatmullRomCurve3([[x + dx * size * .24, y + h * .88, z + dz * size * .24], [x + sx * reach * .8, y + h * .84, z + sz * reach * .8], [x + sx * reach, y + h * .48, z + sz * reach], [x + sx * reach * .92, low, z + sz * reach * .92]].map(V));
        batch.add(new THREE.TubeGeometry(strand, 9, size * .012, 4, false), m.willowDark);
        for (let k = 0; k < 5; k++) {
          const p = strand.getPoint(.2 + k * .155);
          batch.ball(p.x, p.y - size * .035, p.z, size * .072, size * .14, size * .052, (k + j) % 2 ? m.willow : m.willowDark, 0);
        }
      }
    }
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * TAU;
      batch.ball(x + Math.cos(a) * size * .22, y + h * .88, z + Math.sin(a) * size * .22, size * .25, size * .18, size * .25, k % 2 ? m.willowDark : m.willow);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4, r = i === 0 ? 0 : size * .21;
      batch.ball(x + Math.cos(a) * r, y + h * (.76 + rand() * .17), z + Math.sin(a) * r, size * (.29 + rand() * .1), size * (.33 + rand() * .14), size * (.3 + rand() * .1), m.foliage[Math.floor(rand() * m.foliage.length)], 1);
    }
  }
}

function pavilion(batch, x, y, z, radius, m) {
  batch.cylinder(x, y + .055, z, radius, radius * 1.05, .11, m.stoneLight, 8);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; batch.cylinder(x + Math.cos(a) * radius * .68, y + radius * .56, z + Math.sin(a) * radius * .68, .032, .032, radius * 1.05, m.red, 8); }
  roof(batch, x, y + radius * 1.1, z, radius * 1.2, radius * .58, m.roofDark, m.gold, 6);
  batch.ball(x, y + radius * 1.75, z, .07, .13, .07, m.gold);
}

function boat(group, x, z, angle, scale, m) {
  const g = new THREE.Group(), batch = new Batch(g);
  // A true pointed hull with upturned bow, raised gunwales and woven canopy.
  const sections = 16, p = [], ind = [];
  for (let i = 0; i <= sections; i++) {
    const t = i / sections, zz = (t - .5) * 1.75, width = .31 * Math.pow(Math.sin(t * Math.PI), .66), lift = .11 * Math.pow(Math.abs(2 * t - 1), 3);
    p.push(-width, .13 + lift, zz, 0, -.06 + lift, zz, width, .13 + lift, zz);
    if (i < sections) { const a = i * 3; ind.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setIndex(ind); geo.computeVertexNormals(); batch.add(geo, m.boat);
  batch.box(0, .12, 0, .41, .065, 1.18, m.wood);
  for (const s of [-1, 1]) batch.curve(Array.from({ length: 17 }, (_, i) => { const t = i / 16; return [s * .31 * Math.pow(Math.sin(t * Math.PI), .66), .145 + .11 * Math.pow(Math.abs(t * 2 - 1), 3), (t - .5) * 1.75]; }), .022, m.gold, 16);
  for (const zz of [-.36, -.18, 0, .18, .36]) {
    batch.curve([[-.25, .17, zz], [-.22, .48, zz], [0, .61, zz], [.22, .48, zz], [.25, .17, zz]], .022, m.wood, 10);
  }
  // Parametric barrel roof avoids orientation assumptions of half cylinders.
  const cp = [], ci = [];
  for (let j = 0; j <= 12; j++) for (let i = 0; i < 2; i++) cp.push(Math.cos(j / 12 * Math.PI) * .26, .34 + Math.sin(j / 12 * Math.PI) * .27, i ? .38 : -.38);
  for (let j = 0; j < 12; j++) { const a = j * 2; ci.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setIndex(ci); cg.computeVertexNormals(); batch.add(cg, m.sail);
  batch.rod([.12, .23, .55], [.55, .05, 1.04], .017, m.wood);
  batch.finish(); g.position.set(x, .13, z); g.rotation.y = angle; g.scale.setScalar(scale); group.add(g); return g;
}

function bridge(batch, points, width, m) {
  // Zigzag timber/stone garden walkway; every support reaches the waterbed.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), angle = Math.atan2(dx, dz);
    batch.box((a[0] + b[0]) / 2, .32, (a[1] + b[1]) / 2, width, .16, len + .1, m.stone, [0, angle, 0]);
    const nx = dz / len, nz = -dx / len;
    for (const sign of [-1, 1]) {
      const aa = [a[0] + nx * width * .45 * sign, .63, a[1] + nz * width * .45 * sign];
      const bb = [b[0] + nx * width * .45 * sign, .63, b[1] + nz * width * .45 * sign];
      batch.rod(aa, bb, .027, m.stoneLight);
      const steps = Math.max(1, Math.ceil(len / .45));
      for (let k = 0; k <= steps; k++) { const t = k / steps; batch.cylinder(aa[0] * (1 - t) + bb[0] * t, .32, aa[2] * (1 - t) + bb[2] * t, .036, .047, .66, m.stoneLight, 6); }
    }
  }
}

function lantern(batch, x, z, m) {
  // Gourd profile, low mushroom cap, five inset round apertures; not a roofed pavilion.
  const points = [[.43, .02], [.48, .06], [.45, .13], [.25, .2], [.19, .3], [.21, .43], [.32, .53], [.36, .7], [.32, .86], [.2, .98], [.19, 1.07], [.4, 1.08], [.47, 1.13], [.35, 1.22], [.24, 1.31], [.15, 1.35], [.12, 1.4], [.17, 1.48], [.13, 1.6], [.08, 1.66], [.07, 1.77], [0, 1.81]].map(([r, y]) => new THREE.Vector2(r, y));
  batch.add(new THREE.LatheGeometry(points, 40), m.stone, [x, .045, z]);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU, q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    batch.add(new THREE.CircleGeometry(.095, 16), m.dark, [x + Math.cos(a) * .342, .745, z + Math.sin(a) * .342], [1, 1, 1], q);
    batch.add(new THREE.TorusGeometry(.105, .019, 5, 18), m.stoneLight, [x + Math.cos(a) * .348, .745, z + Math.sin(a) * .348], [1, 1, 1], q);
  }
}

export function createWestLake(variant = 'leifeng') {
  const isPools = variant === 'santan';
  const group = new THREE.Group(); group.name = isPools ? 'Three Pools Mirroring the Moon · miniature' : 'Leifeng Pagoda · miniature';
  const m = palette(), batch = new Batch(group), random = rng(isPools ? 6228 : 975);
  slab(batch, roundedShape(17, 14, 1), -.13, .6, m.base, .12);
  slab(batch, roundedShape(17.02, 14.02, 1), -.13, .08, m.rim, .035);
  slab(batch, roundedShape(16.68, 13.68, .85), .038, .16, m.water, .025);
  let height, hotspots, camera;

  if (!isPools) {
    height = (x, z) => {
      const hill = 1.82 * Math.exp(-((x + 3.6) ** 2 / 9 + (z + 1.2) ** 2 / 9));
      const left = .85 * Math.exp(-((x + 7.2) ** 2 / 8 + (z + .8) ** 2 / 28));
      const rear = 1.8 * Math.exp(-((x + .1) ** 2 / 21 + (z + 5.8) ** 2 / 2.5));
      return Math.max(-.19, hill + left + rear - .32 + .045 * Math.sin(x * 1.3) * Math.cos(z));
    };
    terrain(batch, height, m.grass);
    const towerX = -3.55, towerZ = -1.55, towerY = height(towerX, towerZ) + .02;
    pagoda(batch, towerX, towerY, towerZ, m, .92);
    groundPath(batch, [[-7.8, 3.4], [-5.8, 3.3], [-3.6, 1.25], [-3.55, .38]], .52, height, m.stone);
    groundPath(batch, [[-7.8, 1.8], [-6.5, -.2], [-5.6, -3.6], [-3.8, -4.5], [-.6, -4.5], [2.3, -5.2], [5.2, -5.8]], .31, height, m.stone);
    // A lakeside pavilion occupies its own small level terrace.
    const px = -6.55, pz = 1.65, py = height(px, pz);
    batch.cylinder(px, py + .035, pz, .69, .76, .18, m.stone, 12); pavilion(batch, px, py + .13, pz, .58, m);
    // Shore trees are placed using the same sampled ground as the land mesh.
    for (let i = 0; i < 245; i++) {
      const x = random() * 15.7 - 7.8, z = random() * 11.2 - 6.1, y = height(x, z);
      if (y < .15 || Math.hypot(x - towerX, z - towerZ) < 1.85 || Math.hypot(x - px, z - pz) < .9 || (Math.abs(x + 3.6) < .6 && z > -1.5)) continue;
      tree(batch, x, y, z, .43 + random() * .58, m, random, false);
    }
    for (const [x, z, size] of [[-6, 3.9, 1.22], [-4.6, 2.2, 1.06], [-1.25, -1.5, 1.05], [.4, -4.3, .95], [2.7, -5.2, 1.1], [-7.6, .15, 1.2]]) {
      if (height(x, z) > .035) tree(batch, x, height(x, z), z, size, m, random, true);
    }
    // Low shoreline boulders establish water contact and avoid a floating island.
    for (let i = 0; i < 48; i++) {
      const x = random() * 15 - 7.5, z = random() * 11 - 5.5, y = height(x, z);
      if (y > -.04 && y < .15) batch.ball(x, .03, z, .16 + random() * .19, .12 + random() * .12, .12 + random() * .22, m.stoneDark);
    }
    hotspots = [
      { label: '雷峰塔', position: [towerX, towerY + 5.6, towerZ], description: '八角重檐与层层回廊，取意雷峰夕照的标志性轮廓。' },
      { label: '湖山相望', position: [1.9, .25, 1.7], description: '湖面、山体与塔影构成西湖的经典景观关系。' },
      { label: '柳岸小亭', position: [px, py + 1.2, pz], description: '沿着柳树与曲岸，转到小亭一侧看见不同的湖山层次。' },
    ];
    camera = { position: [17, 13.5, 19], target: [-.7, 1.9, -.5] };
  } else {
    // Little Yingzhou: island enclosing ponds, crossways and garden pavilions.
    height = (x, z) => {
      const ring = Math.hypot(x / 5.9, (z + 3.1) / 2.65);
      const edge = .58 * Math.exp(-((ring - .77) ** 2) / .012);
      const rear = .18 * Math.exp(-((x + 2.7) ** 2 / 7 + (z + 5.3) ** 2 / 1.4));
      const crossX = Math.abs(x) < .21 && z < -1 && z > -5.25 ? .4 : 0;
      const crossZ = Math.abs(z + 3.15) < .19 && Math.abs(x) < 4.4 ? .4 : 0;
      return Math.max(-.16, edge + rear - .13, crossX - .1, crossZ - .1);
    };
    terrain(batch, height, m.grass);
    groundPath(batch, [[-4.65, -3.1], [-3.3, -4.7], [0, -5.16], [3.35, -4.7], [4.55, -3.1], [3.25, -1.56], [0, -1.03], [-3.2, -1.6], [-4.65, -3.1]], .23, height, m.stone);
    bridge(batch, [[-4.5, -3.15], [-2.8, -3.15], [-1.5, -3.55], [0, -3.15], [1.5, -2.75], [2.9, -3.15], [4.5, -3.15]], .36, m);
    bridge(batch, [[0, -5.1], [0, -3.15], [.45, -2.12], [0, -1.13]], .36, m);
    for (const [x, z, r] of [[0, -1.1, .68], [-4.4, -3.1, .53], [3.4, -4.65, .56]]) {
      const y = Math.max(.25, height(x, z)); batch.cylinder(x, y, z, r * 1.07, r * 1.1, .18, m.stone, 8); pavilion(batch, x, y + .1, z, r, m);
    }
    for (let i = 0; i < 75; i++) {
      const a = random() * TAU, x = Math.cos(a) * (4.6 + random() * .22), z = -3.1 + Math.sin(a) * (1.95 + random() * .1), y = height(x, z);
      if (y < .12 || Math.hypot(x, z + 1.1) < .92 || Math.hypot(x + 4.4, z + 3.1) < .7 || Math.hypot(x - 3.4, z + 4.65) < .8) continue;
      tree(batch, x, y, z, .51 + random() * .38, m, random, i % 12 === 0);
    }
    lantern(batch, -2.55, 2.35, m); lantern(batch, 2.85, 2.95, m); lantern(batch, .35, -.02, m);
    // Separate ripples around precisely three towers, with scale exaggerated for readability.
    for (const [x, z] of [[-2.55, 2.35], [2.85, 2.95], [.35, -.02]]) for (const rr of [.7, 1.05, 1.46]) {
      const curve = Array.from({ length: 33 }, (_, j) => [x + Math.cos(j / 32 * TAU) * rr, .076, z + Math.sin(j / 32 * TAU) * rr * .72]);
      batch.curve(curve, .008, m.ripple, 32);
    }
    for (let i = 0; i < 18; i++) {
      const x = random() * 2.1 + 1.3, z = random() * 1.4 - 4.25;
      batch.cylinder(x, .071, z, .12, .12, .012, m.lotus, 12);
      if (i % 5 === 0) batch.ball(x, .105, z, .065, .06, .065, m.blossom);
    }
    hotspots = [
      { label: '三潭印月', position: [2.85, 1.94, 2.95], description: '三座葫芦形石塔立于湖中；塔腹的五个圆孔，是这一景观的辨识细节。' },
      { label: '小瀛洲', position: [-2.7, 1.1, -4.7], description: '湖中有岛、岛中有湖，以园林环岛和曲桥表现小瀛洲的空间意趣。' },
      { label: '曲桥寻幽', position: [1.4, .7, -2.75], description: '转折的桥与临水亭，让游览视线随着行进不断变化。' },
    ];
    camera = { position: [14, 13.8, 18], target: [0, .5, -.6] };
  }

  // Quiet surface glints are real thin curves placed only over open water.
  for (let i = 0; i < 42; i++) {
    const x = random() * 15 - 7.5, z = random() * 11.6 - 5.8;
    if (height(x, z) > -.07) continue;
    const len = .15 + random() * .4;
    batch.curve([[x - len, .072, z], [x, .075, z + .012], [x + len, .072, z]], .008, m.ripple, 4);
  }
  batch.finish();
  const boats = isPools ? [boat(group, -5.1, 2, -.8, .7, m), boat(group, 5.9, -.2, .4, .68, m)] : [boat(group, 3.4, 1.7, -.65, .92, m), boat(group, 1.3, 4.2, .9, .64, m), boat(group, 5.7, -2.8, .3, .55, m)];
  const original = boats.map((b) => ({ x: b.position.x, z: b.position.z, angle: b.rotation.y }));
  return {
    group, hotspots, camera,
    description: isPools ? '以三座石塔、湖中园林与曲桥，收藏一片西湖月色。' : '将雷峰塔、柳岸与湖山，收进一方可以转动的微缩西湖。',
    update(time = 0) {
      if (!Number.isFinite(time)) return;
      boats.forEach((b, i) => {
        b.position.y = .13 + Math.sin(time * .68 + i * 1.9) * .014;
        b.position.x = original[i].x + Math.sin(time * .09 + i) * .09;
        b.position.z = original[i].z + Math.cos(time * .085 + i) * .07;
        b.rotation.z = Math.sin(time * .6 + i) * .008;
      });
    },
  };
}
