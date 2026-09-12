import * as THREE from 'three';

/** Physical, deliberately simplified landmark symbols. Not measured reconstructions.
 * Local +X = east, -Z = north; y=0 is the supporting terrain/water surface.
 * Each call owns its materials and geometry; no shared resources survive disposal.
 */
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const vector = (a) => new THREE.Vector3(...a);

function materials() {
  const make = (color) => new THREE.MeshStandardMaterial({ color, roughness: .87, metalness: 0 });
  return Object.fromEntries(Object.entries({
    stone: '#d8cfb7', pale: '#f2e9d4', stoneDark: '#89978c', earth: '#ae956e',
    grass: '#7caa51', green: '#487943', lightGreen: '#91b958', leaf: '#326750',
    bark: '#735239', white: '#efe9d9', yellow: '#e6b13d', red: '#b55e43',
    wood: '#785543', roof: '#4c605d', roofLight: '#6e7b6c', dark: '#304949',
    glass: '#719caa', blue: '#467789', gold: '#caa34b', petal: '#e4ebe2',
  }).map(([key, color]) => [key, make(color)]));
}

class Builder {
  constructor(group, palette) { this.group = group; this.m = palette; this.buckets = new Map(); }
  add(source, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    const q = rotation.isQuaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    g.applyMatrix4(new THREE.Matrix4().compose(vector(position), q, vector(scale)));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
  }
  box(x, y, z, w, h, d, mat, angle = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), mat, [x, y, z], [1, 1, 1], [0, angle, 0]);
  }
  cylinder(x, y, z, top, bottom, h, mat, sides = 10) {
    this.add(new THREE.CylinderGeometry(top, bottom, h, sides), mat, [x, y, z]);
  }
  ball(x, y, z, rx, ry, rz, mat, detail = 0) {
    this.add(new THREE.IcosahedronGeometry(1, detail), mat, [x, y, z], [rx, ry, rz]);
  }
  rod(a, b, radius, mat, sides = 5) {
    const start = vector(a), finish = vector(b), axis = finish.clone().sub(start);
    if (axis.length() < 1e-8) return;
    this.add(new THREE.CylinderGeometry(radius, radius, axis.length(), sides), mat,
      start.add(finish).multiplyScalar(.5).toArray(), [1, 1, 1],
      new THREE.Quaternion().setFromUnitVectors(UP, axis.normalize()));
  }
  polygon(points, top, thickness, mat, holes = []) {
    // Shape's XY becomes world XZ; invert its Y to preserve north/south.
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = holes.map((ring) => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 8, steps: 1 });
    g.rotateX(-Math.PI / 2);
    this.add(g, mat, [0, top - thickness, 0]);
  }
  loft(rings, mat) {
    const positions = [], indices = [], n = rings[0].length;
    rings.forEach((ring) => ring.forEach((point) => positions.push(...point)));
    for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = row * n + i, c = (row + 1) * n + i;
      indices.push(a, row * n + j, c, row * n + j, (row + 1) * n + j, c);
    }
    // Ring winding is clockwise when viewed from above. Reverse bottom only.
    for (let i = 1; i < n - 1; i++) {
      indices.push(0, i + 1, i);
      const a = (rings.length - 1) * n;
      indices.push(a, a + i, a + i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals();
    this.add(g, mat);
  }
  finish() {
    let triangles = 0;
    for (const [mat, list] of this.buckets) {
      const count = list.reduce((n, g) => n + g.getAttribute('position').count, 0);
      const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
      let offset = 0;
      for (const g of list) {
        positions.set(g.getAttribute('position').array, offset);
        normals.set(g.getAttribute('normal').array, offset);
        offset += g.getAttribute('position').array.length; g.dispose();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh); triangles += count / 3;
    }
    const used = new Set(this.buckets.keys());
    Object.values(this.m).forEach((mat) => { if (!used.has(mat)) mat.dispose(); });
    this.buckets.clear();
    return triangles;
  }
}

function rectangle(x, y, z, width, depth, cornerLift = 0) {
  return [[x - width / 2, y + cornerLift, z - depth / 2], [x - width / 2, y + cornerLift, z + depth / 2],
    [x + width / 2, y + cornerLift, z + depth / 2], [x + width / 2, y + cornerLift, z - depth / 2]];
}

function roof(b, x, y, z, width, depth, rise, mat = b.m.roof, tiled = true) {
  b.loft([
    rectangle(x, y - .012, z, width, depth),
    rectangle(x, y + .008, z, width, depth),
    rectangle(x, y + rise * .3, z, width * .79, depth * .73),
    rectangle(x, y + rise, z, width * .49, depth * .035),
  ], mat);
  b.box(x, y + rise + .008, z, width * .56, .018, .025, b.m.roofLight);
  if (tiled) for (const sign of [-1, 1]) {
    b.rod([x - width * .48, y + .012, z + sign * depth * .5],
      [x + width * .48, y + .012, z + sign * depth * .5], .008, b.m.roofLight);
  }
}

function hall(b, x, base, z, width, depth, height, wall = b.m.white, detailed = true) {
  b.box(x, base + .015, z, width * 1.07, .03, depth * 1.07, b.m.stone);
  b.box(x, base + .03 + height / 2, z, width, height, depth, wall);
  const front = z + depth / 2 + .003;
  for (const f of [-.3, 0, .3]) {
    b.box(x + width * f, base + .03 + height * .46, front, width * .13, height * .68, .009, b.m.dark);
    if (detailed) b.cylinder(x + width * (f - .085), base + .03 + height / 2, front + .013, .01, .01, height, b.m.red, 6);
  }
  roof(b, x, base + .03 + height, z, width * 1.19, depth * 1.28, height * .40);
}

function house(b, x, base, z, width, depth, height, wall = b.m.white, shops = false) {
  b.box(x, base + height / 2, z, width, height, depth, wall);
  const front = z + depth / 2 + .004;
  // Separate shop doors and upstairs windows make these domestic buildings,
  // rather than small temple halls with floor-to-ceiling repeated columns.
  for (const offset of [-.25, .25]) {
    b.box(x + width * offset, base + height * .73, front, width * .20, height * .20, .009, b.m.dark);
    b.box(x + width * offset, base + height * .73, front + .006, .006, height * .20, .006, b.m.wood);
  }
  b.box(x, base + height * .21, front, width * .42, height * .40, .01, b.m.wood);
  b.box(x, base + height * .5, front, width * .97, .014, .014, b.m.wood);
  if (shops) {
    b.box(x, base + height * .44, front + .029, width * .91, .011, .064, b.m.wood);
    b.box(x, base + height * .58, front + .004, width * .37, .029, .013, b.m.gold);
  }
  // Two pitched roof planes with real closed triangular gables; no upturned
  // temple eaves. The ridge follows the frontage.
  const w = width * 1.10, d = depth * 1.16, y = base + height, rise = height * .22;
  const points = [
    [-w/2,y,-d/2],[w/2,y,-d/2],[w/2,y+rise,0],[-w/2,y+rise,0],
    [-w/2,y,d/2],[w/2,y,d/2],
  ].map(([px,py,pz])=>[x+px,py,z+pz]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));
  g.setIndex([0,3,2,0,2,1,3,4,5,3,5,2,0,4,3,1,2,5,0,1,5,0,5,4]);
  g.computeVertexNormals();b.add(g,b.m.roof);
  b.box(x,y+rise+.006,z,w,.012,.018,b.m.roofLight);
}

function tree(b, x, y, z, size = .1, variant = 0) {
  b.cylinder(x, y + size * .52, z, size * .065, size * .085, size * 1.04, b.m.bark, 5);
  const mat = [b.m.green, b.m.leaf, b.m.lightGreen][variant % 3];
  b.ball(x, y + size * 1.24, z, size * .59, size * .72, size * .57, mat, 1);
}

function steps(b, x, base, z, width, run, rise, count = 6) {
  for (let i = 0; i < count; i++) {
    const h = rise * (i + 1) / count;
    b.box(x, base + h / 2, z - run * (i + .5) / count, width, h, run / count + .002, b.m.stone);
  }
}

function pagodaRoof(b, y, radius, rise, mat) {
  const ring = (r, h) => Array.from({ length: 8 }, (_, i) => {
    const a = -i * TAU / 8 + Math.PI / 8;
    return [Math.cos(a) * r, h, Math.sin(a) * r];
  });
  b.loft([ring(radius, y), ring(radius, y + .018), ring(radius * .77, y + .035),
    ring(radius * .4, y + rise * .62), ring(radius * .16, y + rise)], mat);
  for (let i = 0; i < 8; i++) {
    const a = -i * TAU / 8 + Math.PI / 8, next = a - TAU / 8;
    b.rod([Math.cos(a) * radius, y + .025, Math.sin(a) * radius],
      [Math.cos(next) * radius, y + .025, Math.sin(next) * radius], .009, b.m.gold);
  }
}

function leifeng(b) {
  for (let i = 0; i < 3; i++) b.cylinder(0, .025 + .04 * i, 0, .37 - i * .026, .39 - i * .026, .05, b.m.stone, 8);
  for (let floor = 0; floor < 5; floor++) {
    const y = .12 + floor * .205, r = .24 - floor * .019;
    b.cylinder(0, y + .084, 0, r * .84, r * .85, .17, b.m.red, 8);
    b.cylinder(0, y + .019, 0, r * 1.15, r * 1.15, .025, b.m.wood, 8);
    for (let side = 0; side < 8; side++) {
      const a = side * TAU / 8, corner = a + Math.PI / 8;
      b.box(Math.cos(a) * r * .792, y + .102, Math.sin(a) * r * .792,
        r * .28, .085, .008, b.m.dark, Math.PI / 2 - a);
      b.cylinder(Math.cos(corner) * r, y + .087, Math.sin(corner) * r, .011, .013, .17, b.m.red, 5);
    }
    pagodaRoof(b, y + .172, r * 1.36, .085, b.m.gold);
  }
  b.cylinder(0, 1.257, 0, .005, .026, .17, b.m.gold, 8);
  tree(b, -.36, 0, -.13, .10); tree(b, .34, 0, .15, .09, 1);
  return { pagodaStoreys: 5, pagodaSides: 8 };
}

function liuhe(b) {
  b.cylinder(0,.035,0,.38,.40,.07,b.m.stone,8);
  // Thirteen exterior eave tiers, seven actual interior storeys. Keep this
  // darker, denser silhouette distinct from Leifeng's five golden roofs.
  for (let tier=0;tier<13;tier++) {
    const y=.07+tier*.092, r=.255-tier*.009;
    b.cylinder(0,y+.033,0,r*.82,r*.83,.066,b.m.wood,8);
    if(tier%2===0) for(let side=0;side<8;side++) {
      const a=side*TAU/8;
      b.box(Math.cos(a)*r*.78,y+.034,Math.sin(a)*r*.78,r*.28,.042,.008,b.m.dark,Math.PI/2-a);
    }
    pagodaRoof(b,y+.06,r*1.32,.045,b.m.roof);
  }
  b.cylinder(0,1.315,0,.004,.024,.16,b.m.gold,8);
  tree(b,-.35,0,.12,.12); tree(b,.34,0,-.12,.10,1);
  return { exteriorEaveTiers:13, interiorStoreys:7, pagodaSides:8 };
}

function santan(b) {
  const island = [[-.41,-.12],[-.34,-.33],[-.13,-.4],[.15,-.37],[.36,-.23],[.39,-.03],[.29,.13],[.02,.17],[-.26,.12]];
  const pond = [[-.14,-.23],[.11,-.25],[.19,-.12],[.06,-.03],[-.13,-.07]];
  b.polygon(island, .045, .045, b.m.grass, [pond]);
  b.box(0, .055, -.12, .038, .025, .35, b.m.stone);
  hall(b, -.12, .046, -.31, .17, .11, .09, b.m.white, false);
  [[-.3,-.16],[.27,-.15],[.17,.04],[-.27,.01]].forEach(([x,z], i) => tree(b, x, .045, z, .075, i));
  // Exactly three short stone lantern-pagodas SOUTH of the island, never on it.
  for (const [x, z] of [[-.20,.33],[.19,.33],[.02,.50]]) {
    b.cylinder(x, .015, z, .048, .059, .03, b.m.stone, 10);
    b.cylinder(x, .056, z, .034, .039, .055, b.m.stone, 10);
    b.ball(x, .080, z, .049, .043, .049, b.m.pale, 1);
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4;
      b.ball(x + Math.cos(a) * .046, .080, z + Math.sin(a) * .046, .010, .015, .010, b.m.dark);
    }
    b.cylinder(x, .116, z, .009, .041, .031, b.m.stone, 10);
    b.ball(x, .14, z, .013, .018, .013, b.m.pale);
  }
  return { stoneLanterns: 3, lanternPosition: 'south-of-island', containsWaterPlane: false };
}

function faxi(b) {
  // Nested, ascending courtyards, rather than a freestanding pagoda.
  for (let tier = 0; tier < 3; tier++) {
    const y = tier * .085, z = .24 - tier * .29, w = .66 - tier * .055;
    b.box(0, y / 2 + .025, z, w + .12, y + .05, .29, b.m.stone);
    hall(b, -.055, y + .05, z - .072, w * .66, .125, .115 + tier * .012, b.m.yellow);
    for (const sign of [-1, 1]) {
      b.box(sign * w / 2, y + .1, z + .018, .035, .13, .23, b.m.yellow);
      roof(b, sign * w / 2, y + .165, z + .018, .085, .255, .029, b.m.roof, false);
    }
    if (tier < 2) steps(b, w * .365, y + .05, z + .015, .12, .19, .085, 7);
  }
  tree(b, -.21, .05, .29, .087, 2);
  return { ascendingCourtyards: 3, form: 'yellow-walls-grey-roofs-stairs', hasPagoda: false };
}

function xiaohe(b) {
  // Two representative domestic frontages form one long, narrow canal street.
  // The paving follows the street rather than inventing a broad island/plot;
  // the shared authored northwest/southeast orientation is applied afterwards.
  b.box(0, .0225, 0, .99, .045, .22, b.m.stone);
  b.box(0, .052, .060, .98, .014, .065, b.m.pale);
  house(b, -.245, .045, -.043, .42, .10, .23, b.m.white, true);
  house(b, .245, .045, -.043, .395, .10, .245, b.m.pale, true);
  b.box(0, .058, .111, .99, .026, .026, b.m.stoneDark);
  return { buildingStoreys: 2, representativeBuildings: 2, form: 'narrow-canalside-old-street', hasTemple: false, containsWaterPlane: false, displayPolicy: 'Two simplified white-wall grey-roof frontages, not a surveyed count or new waterside facility.' };
}

function lingyin(b) {
  b.box(0, .025, 0, .76, .05, .92, b.m.stone);
  hall(b, 0, .05, -.22, .59, .31, .24, b.m.yellow);
  roof(b, 0, .31, -.22, .79, .47, .085);
  hall(b, 0, .05, .32, .40, .13, .10, b.m.yellow);
  for (const x of [-.33, .33]) hall(b, x, .05, .08, .115, .30, .095, b.m.yellow, false);
  for (const [x,z] of [[-.46,-.36],[.46,-.27],[-.39,.29],[.38,.36]]) tree(b, x, 0, z, .16, 1);
  return { form: 'woodland-temple-courtyard' };
}

function liangzhu(b) {
  b.polygon([[-.47,-.24],[-.22,-.42],[.30,-.39],[.48,-.14],[.43,.33],[-.29,.42],[-.5,.15]], .07, .07, b.m.grass);
  for (let tier = 0; tier < 3; tier++) b.box(0, .10 + tier * .065, -.05, .65 - tier * .12, .066, .52 - tier * .11, tier === 2 ? b.m.earth : b.m.grass);
  for (const x of [-.13, .07]) for (const z of [-.12, .05]) {
    b.box(x, .25, z, .11, .019, .025, b.m.stone);
    b.box(x - .043, .25, z + .045, .025, .019, .09, b.m.stone);
  }
  steps(b, .22, .07, .35, .12, .19, .125, 5);
  tree(b, -.37, .07, .2, .09, 2);
  return { form: 'archaeological-earth-terraces', hasPalace: false };
}

function archBridge(b, length = 1, arches = 3, height = .31, depth = .23) {
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, 0); shape.lineTo(-length / 2, .095);
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, x = -length / 2 + length * t;
    shape.lineTo(x, .095 + height * Math.sin(Math.PI * t));
  }
  shape.lineTo(length / 2, 0);
  // Return along the underside, following each arch. This forms genuinely open
  // arches and avoids holes intersecting the outer contour at ground level.
  for (let i = arches - 1; i >= 0; i--) {
    const cx = (i - (arches - 1) / 2) * length * .285;
    const r = length * (i === Math.floor(arches / 2) ? .126 : .103);
    const cap = height * (i === Math.floor(arches / 2) ? .82 : .54);
    shape.lineTo(cx + r, 0); shape.lineTo(cx + r, .031);
    for (let j = 0; j <= 12; j++) {
      const a = j / 12 * Math.PI;
      shape.lineTo(cx + Math.cos(a) * r, .031 + Math.sin(a) * cap);
    }
    shape.lineTo(cx - r, 0);
  }
  shape.lineTo(-length / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
  b.add(g, b.m.stone, [0, .004, -depth / 2]);
  for (const sign of [-1, 1]) for (let i = 0; i < 20; i++) {
    const t = i / 20, q = (i + 1) / 20;
    const a = [-length / 2 + length * t, .12 + height * Math.sin(Math.PI * t), sign * depth / 2];
    const c = [-length / 2 + length * q, .12 + height * Math.sin(Math.PI * q), sign * depth / 2];
    b.rod(a, c, .012, b.m.pale);
    if (i % 2 === 0) b.cylinder(a[0], a[1] - .011, a[2], .012, .014, .062, b.m.pale, 5);
  }
}

function gongchen(b) { archBridge(b); return { archCount: 3, form: 'three-arch-stone-bridge' }; }

function qiandao(b) {
  // The actual reservoir and islands belong to the GIS terrain layer.
  b.box(0, .025, 0, .37, .05, .30, b.m.stone);
  hall(b, 0, .05, 0, .25, .20, .16, b.m.white, false);
  tree(b, -.29, 0, -.07, .16, 1); tree(b, .29, 0, -.10, .13);
  b.box(.29, .04, .24, .24, .045, .075, b.m.wood);
  return { form: 'lakeside-pavilion-and-trees', containsWaterPlane: false, hasInventedIslandOutline: false };
}

function tianmu(b) {
  hall(b, 0, 0, .23, .39, .22, .14, b.m.yellow, false);
  [[-.32,-.20,.25],[0,-.28,.29],[.31,-.14,.24],[-.27,.11,.18],[.29,.12,.17]].forEach(([x,z,s], i) => tree(b, x, 0, z, s, i));
  return { form: 'forest-and-entry-temple', hasInventedMountain: false };
}

function yaolin(b) {
  // Real empty cave opening surrounded by a faceted rock arch, not a black decal.
  for (let i = 0; i < 9; i++) {
    const a = i / 8 * Math.PI;
    b.ball(Math.cos(a) * .34, .07 + Math.sin(a) * .29, -.02, .145, .145, .19, i % 2 ? b.m.stone : b.m.stoneDark, 1);
  }
  b.box(0, .018, .12, .55, .036, .35, b.m.stone);
  b.box(0, .11, -.19, .37, .20, .035, b.m.dark);
  for (const [x, h] of [[-.12,.09],[0,.13],[.13,.065]]) b.cylinder(x, .20 - h / 2, -.07, .028, .001, h, b.m.pale, 6);
  tree(b, -.42, 0, -.07, .14, 2); tree(b, .4, 0, -.14, .12);
  return { form: 'open-cave-portal-and-stalactites' };
}

function yanziling(b) {
  b.box(0, .055, 0, .65, .11, .47, b.m.stoneDark);
  b.box(0, .125, 0, .59, .03, .43, b.m.stone);
  hall(b, -.08, .14, -.07, .28, .20, .18, b.m.white, false);
  steps(b, .31, 0, .4, .16, .39, .14, 8);
  tree(b, -.31, .11, -.16, .18, 1);
  b.box(.15, .162, .17, .17, .016, .038, b.m.stone);
  return { form: 'riverside-fishing-terrace-and-pavilion', containsWaterPlane: false };
}

function village(b, ancestral = false) {
  b.box(0, .02, 0, .87, .04, .80, b.m.grass);
  b.box(0, .046, .09, .8, .012, .06, b.m.stone);
  for (const row of [-1, 1]) for (let i = 0; i < 4; i++) {
    if (ancestral && row === -1 && i === 1) continue;
    house(b, -.31 + i * .205, .04, row * .23, .16, .18, .18 + (i % 2) * .045, b.m.white);
  }
  if (ancestral) hall(b, -.08, .04, -.17, .32, .24, .21, b.m.white);
  tree(b, -.42, 0, .15, .1); tree(b, .39, .04, .04, .085, 2);
  return { form: ancestral ? 'clan-village-and-ancestral-hall' : 'white-wall-grey-roof-village' };
}

function olympic(b) {
  const n = 24;
  // Hollow annular bowl, keeping the playing field visible from above.
  for (let i = 0; i < n; i++) {
    const a = -i * TAU / n, c = -(i + 1) * TAU / n;
    b.loft([
      [[Math.cos(a)*.45, .035, Math.sin(a)*.34],[Math.cos(c)*.45,.035,Math.sin(c)*.34],[Math.cos(c)*.29,.035,Math.sin(c)*.20],[Math.cos(a)*.29,.035,Math.sin(a)*.20]],
      [[Math.cos(a)*.46, .16, Math.sin(a)*.35],[Math.cos(c)*.46,.16,Math.sin(c)*.35],[Math.cos(c)*.31,.10,Math.sin(c)*.22],[Math.cos(a)*.31,.10,Math.sin(a)*.22]],
    ], b.m.stone);
    const centre = (a + c) / 2;
    const outward = new THREE.Vector3(Math.cos(centre), 0, Math.sin(centre));
    const tangent = new THREE.Vector3(-Math.sin(centre), 0, Math.cos(centre));
    const center = new THREE.Vector3(Math.cos(centre)*.465,.17,Math.sin(centre)*.35);
    const rings = [
      [[-.025,-.14,-.02],[.025,-.14,-.02],[.025,-.14,.02],[-.025,-.14,.02]],
      [[-.065,.035,-.035],[.065,.035,-.035],[.065,.035,.035],[-.065,.035,.035]],
      [[-.014,.16,-.005],[.014,.16,-.005],[.014,.16,.005],[-.014,.16,.005]],
    ].map((row) => row.map(([u,v,w]) => center.clone().addScaledVector(tangent,u).addScaledVector(outward,w + v * .18).add(new THREE.Vector3(0,v,0)).toArray()));
    b.loft(rings, i % 2 ? b.m.petal : b.m.white);
  }
  const g = new THREE.CylinderGeometry(.29, .29, .025, 32); b.add(g, b.m.grass, [0,.017,0],[1,1,.66]);
  b.box(0,.034,0,.25,.008,.14,b.m.lightGreen);
  b.box(0,.040,0,.004,.006,.14,b.m.pale);
  for (const x of [-.127,.127]) b.box(x,.039,0,.005,.006,.14,b.m.pale);
  return { form: 'lotus-petal-stadium', petalCount: n };
}

function tower(b, x, z, w, d, height, material = b.m.glass) {
  b.box(x, height / 2, z, w, height, d, material);
  for (let y = .08; y < height - .04; y += .085) b.box(x, y, z, w * 1.02, .012, d * 1.02, b.m.pale);
  b.box(x, height + .012, z, w * .72, .025, d * .72, b.m.stone);
}

function qianjiang(b) {
  tower(b,-.29,-.14,.16,.19,.63); tower(b,-.06,-.25,.14,.18,.78,b.m.blue);
  tower(b,.18,-.23,.15,.20,.60); tower(b,.36,-.10,.12,.17,.44,b.m.white);
  tower(b,-.33,.15,.13,.15,.36,b.m.white);
  b.cylinder(.09,.025,.22,.22,.24,.05,b.m.stone,20);
  b.ball(.09,.195,.22,.195,.185,.195,b.m.gold,2);
  for (const x of [-.15,.34]) tree(b,x,0,.3,.085,2);
  return { form: 'qianjiang-towers-and-golden-conference-centre' };
}

function xixi(b) {
  for (let i = 0; i < 4; i++) b.box(-.3+i*.20,.045,-.04+((i%2)*.15),.24,.04,.065,b.m.wood,i%2?.45:-.45);
  for (const [x,z] of [[-.4,-.18],[-.15,-.26],[.23,-.19],[.37,.18],[-.23,.27]]) tree(b,x,0,z,.13,2);
  hall(b,.17,0,.19,.21,.15,.12,b.m.white,false);
  return { form: 'wetland-boardwalk-and-groves', containsWaterPlane: false };
}

function duanqiao(b) {
  archBridge(b,.84,1,.11,.23);
  tree(b,-.45,0,-.17,.13,2); tree(b,.44,0,-.17,.10,2);
  return { archCount: 1, form: 'low-stone-bridge-and-causeway' };
}

function xianghu(b) {
  hall(b,-.19,0,-.12,.26,.20,.17,b.m.white,false);
  tree(b,-.35,0,-.17,.16); tree(b,.30,0,-.18,.14,2);
  b.box(.13,.045,.16,.46,.055,.095,b.m.stone);
  for (const x of [-.06,.14,.34]) b.cylinder(x,.075,.19,.008,.008,.09,b.m.pale,5);
  return { form: 'lakeside-pavilion-and-walkway', containsWaterPlane: false };
}

const MODELS = {
  leifeng, liuhe, santan, faxi, xiaohe, lingyin, liangzhu, gongchen, qiandao, tianmu,
  yaolin, yanziling, longmen: (b) => village(b,true), xinye: (b) => village(b,false),
  olympic, qianjiang, xixi, duanqiao, xianghu, hefang: (b) => village(b,false),
  westlake: santan,
  generic: (b) => { hall(b,0,0,0,.58,.38,.23,b.m.white,false); return { form: 'unclassified-pavilion-symbol' }; },
};
const TARGET_HEIGHT = { leifeng: 1.50, liuhe:1.48, santan: .40, faxi: .66, xiaohe: .48, lingyin: .69,
  liangzhu: .40, gongchen: .47, qiandao: .56, tianmu: .79, yaolin: .61, yanziling: .66,
  longmen: .46, xinye: .45, olympic: .42, qianjiang: .98, xixi: .48, duanqiao: .40,
  xianghu: .52, hefang: .45, westlake: .40, generic: .45 };
const ALIASES = {
  leifeng: ['leifeng','雷峰'], liuhe: ['liuhe','六和'], santan: ['santan','三潭','xiaoyingzhou','小瀛洲'],
  faxi: ['faxi','法喜','上天竺'], xiaohe: ['xiaohe','小河直街'], lingyin: ['lingyin','灵隐'],
  liangzhu: ['liangzhu','良渚'], gongchen: ['gongchen','拱宸'], qiandao: ['qiandao','千岛'],
  tianmu: ['tianmu','天目'], yaolin: ['yaolin','瑶琳'], yanziling: ['yanziling','严子陵'],
  longmen: ['longmen','龙门'], xinye: ['xinye','新叶'], olympic: ['olympic','奥体','莲花'],
  qianjiang: ['qianjiang','钱江新城','国际会议中心'], xixi: ['xixi','西溪'],
  duanqiao: ['duanqiao','broken-bridge','断桥'], xianghu: ['xianghu','湘湖'], hefang: ['hefang','河坊'],
  westlake: ['westlake','west-lake','西湖'],
};

export const HANGZHOU_LANDMARK_TYPES = Object.freeze(Object.keys(MODELS));

/** Return a disposable, material-batched Group at y=0, centered in XZ, width/depth <=1.
 * The landmark's authored geographic orientation is preserved. Parent owns geolocation,
 * map-scale exaggeration, label, selection, terrain fitting and lifetime.
 */
export function createHangzhouLandmark({ id = '', type = '', name = '' } = {}) {
  let modelType = MODELS[type] ? type : null;
  if (!modelType) for (const value of [id, name, type]) {
    const text = String(value).toLowerCase();
    modelType = Object.keys(ALIASES).find((key) => ALIASES[key].some((alias) => text.includes(alias)));
    if (modelType) break;
  }
  const recognized = Boolean(modelType);
  modelType ||= 'generic';
  const group = new THREE.Group(); group.name = name || id || modelType;
  const b = new Builder(group, materials());
  const semantics = MODELS[modelType](b), triangles = b.finish();
  // OSM way 234289068 runs northwest/southeast. Only its direction is used;
  // these representative frontages are not purported to be its surveyed footprint.
  const authoredYaw = modelType === 'xiaohe' ? -.785 : 0;
  if (authoredYaw) group.children.forEach((mesh) => mesh.geometry.rotateY(authoredYaw));
  const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
  const horizontal = 1 / Math.max(size.x, size.z);
  const vertical = TARGET_HEIGHT[modelType] / size.y;
  const center = bounds.getCenter(new THREE.Vector3());
  const normalization = new THREE.Matrix4().makeScale(horizontal, vertical, horizontal)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.applyMatrix4(normalization);
    object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
  });
  group.userData = {
    landmarkId: id, modelType, recognized, representative: true,
    accuracy: '代表性实体示意模型，非测量复原；建筑数量与高度经过视觉简化。',
    localAxes: '+X east; -Z north; +Y up',
    authoredYaw,
    normalizedSize: new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).toArray(),
    triangles, drawCalls: group.children.length, ...semantics,
  };
  return group;
}

/** Optional convenience; safe because create calls do not share owned resources. */
export function disposeHangzhouLandmark(group) {
  const seen = new Set();
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!seen.has(mat)) { mat.dispose(); seen.add(mat); }
    }
  });
  group.removeFromParent(); group.clear();
}
