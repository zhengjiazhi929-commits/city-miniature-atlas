import * as THREE from 'three';
import { Batch, material, roundedShape, polygonShape, slab, rng } from './hong-kong-geometry.js';

const TAU = Math.PI * 2, V = p => new THREE.Vector3(...p);
const curve = (b, points, r, mat, segments = 20, sides = 6) => b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)), segments, r, sides, false), mat);

function octagonalRoof(b, x, z, eave, radius, innerRadius, rise, mats) {
  const positions = [], indices = [], nt = 12, nu = 12;
  const point = (a, u, t) => {
    const aa = a * TAU / 8 + Math.PI / 8, ab = aa + TAU / 8;
    const r = innerRadius + (radius - innerRadius) * t;
    return [x + r * ((1 - u) * Math.sin(aa) + u * Math.sin(ab)), eave + rise * Math.pow(1 - t, 1.72) + .20 * Math.pow(t, 7) * Math.pow(2 * Math.abs(u - .5), 2), z + r * ((1 - u) * Math.cos(aa) + u * Math.cos(ab))];
  };
  for (let a = 0; a < 8; a++) {
    const start = positions.length / 3;
    for (let i = 0; i <= nt; i++) for (let j = 0; j <= nu; j++) {
      positions.push(...point(a, j / nu, i / nt));
      if (i < nt && j < nu) { const k = start + i * (nu + 1) + j; indices.push(k, k + nu + 1, k + 1, k + 1, k + nu + 1, k + nu + 2); }
    }
    for (let j = 0; j <= 9; j++) {
      const pts = Array.from({ length: 9 }, (_, i) => { const p = point(a, j / 9, i / 8); p[1] += .025; return p; });
      curve(b, pts, j === 0 ? .045 : .018, mats.goldLight, 12, 5);
    }
    const edge = Array.from({ length: 7 }, (_, j) => point(a, j / 6, 1));
    curve(b, edge, .065, mats.goldLight, 12, 6);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals(); b.add(geo, mats.gold);
}

function pavilion(b, x, z, mats) {
  b.cylinder(x, .66, z, 1.65, 1.78, .38, mats.stone, 8);
  b.cylinder(x, .91, z, 1.47, 1.47, .14, mats.goldDark, 8);
  b.cylinder(x, 1.03, z, 1.42, 1.42, .12, mats.gold, 8);
  for (let floor = 0; floor < 2; floor++) {
    const radius = floor ? .73 : 1.08, bottom = floor ? 2.97 : 1.07, h = floor ? .75 : 1.48;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + Math.PI / 8, aa = a + TAU / 8;
      const xx = x + Math.sin(a) * radius, zz = z + Math.cos(a) * radius;
      const x2 = x + Math.sin(aa) * radius, z2 = z + Math.cos(aa) * radius;
      b.cylinder(xx, bottom + h / 2, zz, .074, .083, h, mats.gold, 10);
      b.cylinder(xx, bottom + .06, zz, .12, .13, .13, mats.goldLight, 8);
      b.rod([xx, bottom + h - .06, zz], [x2, bottom + h - .06, z2], .065, mats.goldDark, 8);
      b.rod([xx, bottom + h - .20, zz], [x2, bottom + h - .20, z2], .034, mats.gold, 6);
      // Bracket arms express the timber structure below each broad eave.
      for (const sign of [-1, 1]) b.rod([xx, bottom + h - .26, zz], [xx + Math.cos(a) * sign * .14, bottom + h - .08, zz - Math.sin(a) * sign * .14], .038, mats.goldLight, 5);
      if (!floor && Math.abs(Math.cos(a)) > .35) {
        for (let k = 1; k < 5; k++) {
          const t = k / 5, bx = THREE.MathUtils.lerp(xx, x2, t), bz = THREE.MathUtils.lerp(zz, z2, t);
          b.cylinder(bx, bottom + .22, bz, .021, .021, .42, mats.gold, 6);
        }
        b.rod([xx, bottom + .46, zz], [x2, bottom + .46, z2], .035, mats.goldLight);
      }
    }
  }
  b.cylinder(x, 2.54, z, 1.23, 1.23, .1, mats.goldDark, 8);
  octagonalRoof(b, x, z, 2.58, 2.04, .48, .84, mats);
  b.cylinder(x, 3.66, z, .88, .88, .12, mats.goldDark, 8);
  octagonalRoof(b, x, z, 3.72, 1.52, .10, 1.08, mats);
  b.cylinder(x, 4.85, z, .10, .18, .20, mats.goldLight, 16);
  b.add(new THREE.SphereGeometry(.17, 16, 12), mats.gold, [x, 5.03, z], [1, 1.5, 1]);
  b.cylinder(x, 5.29, z, .015, .08, .28, mats.goldLight, 12);
}

function redBridge(b, sign, z, mats) {
  const start = 1.3, length = 4.20, n = 30;
  const point = t => [sign * (start + length * t), .86 + .30 * Math.sin(t * Math.PI), z];
  for (let i = 0; i < n; i++) {
    const t = (i + .5) / n, p = point(t);
    b.box(p[0], p[1], z, length / n + .012, .13, .9, mats.red);
    if (i % 3 === 0 || i === n - 1) for (const edge of [-1, 1]) {
      b.box(p[0], p[1] + .36, z + edge * .48, .075, .65, .075, mats.red);
      b.ball(p[0], p[1] + .715, z + edge * .48, .064, .055, .064, mats.redLight, 1);
    }
    if (i % 2 === 0) for (const edge of [-1, 1]) b.box(p[0], p[1] + .20, z + edge * .48, .034, .36, .036, mats.red);
  }
  for (const edge of [-1, 1]) {
    for (const yOffset of [.50, .24, -.03]) {
      const points = Array.from({ length: 15 }, (_, i) => { const p = point(i / 14); return [p[0], p[1] + yOffset, z + edge * .48]; });
      curve(b, points, yOffset === .5 ? .044 : .032, mats.redLight, 28, 6);
    }
    const arc = Array.from({ length: 13 }, (_, i) => { const p = point(i / 12); return [p[0], p[1] - .19, z + edge * .38]; });
    curve(b, arc, .065, mats.red, 28, 6);
  }
}

function pine(b, x, y, z, scale, rotation, mats) {
  const dx = Math.cos(rotation), dz = Math.sin(rotation), top = y + scale * 1.05;
  curve(b, [[x, y, z], [x - dx * .12 * scale, y + scale * .32, z - dz * .12 * scale], [x + dx * .13 * scale, y + scale * .78, z + dz * .13 * scale], [x + dx * .04 * scale, top, z]], .073 * scale, mats.bark, 16, 7);
  for (let i = 0; i < 5; i++) {
    const a = rotation + i * 2.36, spread = (i ? .32 : .12) * scale, xx = x + Math.cos(a) * spread, zz = z + Math.sin(a) * spread;
    const yy = y + scale * (.56 + i * .115);
    b.rod([x + dx * .04 * scale, yy - .14 * scale, z], [xx, yy, zz], .036 * scale, mats.bark, 6);
    b.ball(xx, yy + .08 * scale, zz, scale * .39, scale * .15, scale * .32, mats.leaves[i % mats.leaves.length], 2);
    b.ball(xx + Math.cos(a + 1) * scale * .15, yy + .12 * scale, zz + Math.sin(a + 1) * scale * .15, scale * .23, scale * .12, scale * .23, mats.leaves[(i + 1) % mats.leaves.length], 1);
  }
}

function timberHall(b, x, z, w, d, y, mats) {
  b.box(x, y + .1, z, w + .35, .20, d + .35, mats.stone);
  b.box(x, y + .63, z - d * .18, w * .94, 1.02, d * .55, mats.wood);
  for (let i = 0; i <= 6; i++) {
    const xx = x + (i / 6 - .5) * w * .88;
    b.cylinder(xx, y + .68, z + d * .34, .055, .065, 1.25, mats.woodLight, 8);
    if (i < 6) {
      b.box(xx + w * .88 / 12, y + .72, z - .02, w * .11, .72, .04, mats.glass);
      for (let j = 0; j < 4; j++) b.box(xx + w * .03 + j * w * .025, y + .74, z + .012, .017, .70, .045, mats.woodLight);
      for (const yy of [y + .48, y + .72, y + .96]) b.box(xx + w * .88 / 12, yy, z + .014, w * .11, .021, .043, mats.woodLight);
    }
  }
  b.box(x, y + 1.23, z, w, .13, d, mats.woodLight);
  const positions = [], indices = [], nx = 24, nz = 12;
  const roofY = (xx, zz) => y + 1.39 + .74 * (1 - Math.abs(zz)) ** 1.55 + .11 * Math.abs(xx) ** 8 + .14 * Math.abs(zz) ** 9;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const xx = i / nx * 2 - 1, zz = j / nz * 2 - 1;
    positions.push(x + xx * (w + .8) / 2, roofY(xx, zz), z + zz * (d + .85) / 2);
    if (i < nx && j < nz) { const a = j * (nx + 1) + i; indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals(); b.add(geo, mats.roof);
  for (let i = 0; i < 32; i++) {
    const xx = i / 31 * 2 - 1;
    for (const sign of [-1, 1]) curve(b, Array.from({ length: 7 }, (_, j) => { const zz = sign * j / 6; return [x + xx * (w + .8) / 2, roofY(xx, zz) + .018, z + zz * (d + .85) / 2]; }), .021, mats.roofLight, 10, 5);
  }
  curve(b, [[x - w / 2 - .38, y + 2.26, z], [x, y + 2.15, z], [x + w / 2 + .38, y + 2.26, z]], .063, mats.roofLight, 20, 6);
}

export function createNanLianGarden() {
  const group = new THREE.Group(); group.name = 'Nan Lian Garden — golden pavilion, Zi Wu bridges and pine garden';
  const b = new Batch(group), random = rng(4406);
  const m = {
    base: material('#c9baa0'), stone: material('#ddd5ba'), gravel: material('#c3bca0'), grass: material('#a4ad76'), moss: material('#8b9a62'),
    water: material('#477f70', .32, .16), waterLight: material('#79a491', .42, .08), rock: material('#6c735f'), rockLight: material('#939681'),
    gold: material('#cfaa47', .50, .40), goldLight: material('#e4c768', .52, .3), goldDark: material('#ae8630', .68, .28),
    red: material('#b33725', .72, .02), redLight: material('#d14931', .64, .03),
    wood: material('#665441'), woodLight: material('#887050'), glass: material('#454d3f'), roof: material('#535955'), roofLight: material('#72776a'),
    bark: material('#68543e'), leaves: [material('#345940'), material('#496a45'), material('#617c4d')],
  };
  slab(b, roundedShape(17.8, 14.6, 1.55), .25, .6, m.base, .1);
  slab(b, roundedShape(17.6, 14.4, 1.48), .34, .11, m.gravel, .04);
  // The oval circuit is retained as a spatial composition around the central pond.
  const lake = [];
  for (let i = 0; i < 96; i++) { const a = i / 96 * TAU, r = 1 + .045 * Math.cos(3 * a) + .026 * Math.sin(5 * a); lake.push([6.72 * r * Math.cos(a), .5 + 4.82 * r * Math.sin(a)]); }
  slab(b, polygonShape(lake), .48, .18, m.rock, .035);
  slab(b, polygonShape(lake.map(([x, z]) => [x * .985, .5 + (z - .5) * .982])), .535, .025, m.water, 0);
  const pathway = new THREE.Shape(), outer = [], inner = [];
  for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU; outer.push([8.15 * Math.cos(a), 6.3 * Math.sin(a)]); inner.push([7.25 * Math.cos(a), 5.45 * Math.sin(a)]); }
  outer.forEach(([x,z],i)=>i?pathway.lineTo(x,-z):pathway.moveTo(x,-z)); const hole=new THREE.Path();inner.reverse().forEach(([x,z],i)=>i?hole.lineTo(x,-z):hole.moveTo(x,-z));pathway.holes.push(hole);slab(b,pathway,.39,.04,m.stone,0);
  // Two red bridges meet the golden octagonal pavilion at the pond's centre.
  pavilion(b, 0, .68, m); redBridge(b, -1, .68, m); redBridge(b, 1, .68, m);
  timberHall(b, -.8, -5.33, 6.1, 1.58, .40, m);
  timberHall(b, -6.9, -1.65, 2.0, 2.18, .40, m);

  // Banks, scholar rocks and sculpted pine canopies give the garden its own rhythm.
  for (let i = 0; i < 64; i++) {
    const a = TAU * i / 64, xx = 6.8 * Math.cos(a), zz = .5 + 4.90 * Math.sin(a);
    if (Math.abs(zz - .68) < .78 && Math.abs(xx) > 4.6) continue;
    const size = .23 + random() * .25;
    b.ball(xx, .49 + size * .15, zz, size, size * .40, size * .75, i % 3 ? m.rock : m.rockLight, 1);
  }
  const beds = [
    [-5.8, 4.56, 2.1, 1.16], [-2.7, 5.25, 1.55, .70], [3.0, 5.1, 2.1, .87], [6.85, 3.1, .80, 1.7],
    [-5.40, -4.68, 1.63, .92], [4.36, -4.4, 2.26, 1.19], [7.0, -1.9, .65, 1.46],
  ];
  for (const [x,z,sx,sz] of beds) {
    b.add(new THREE.SphereGeometry(1, 24, 12), m.moss, [x,.37,z], [sx,.19,sz]);
  }
  const pines = [[-6.0,4.5,1.48],[-4.6,5.04,1.10],[-2.3,5.70,1.13],[2.1,5.55,1.43],[4.15,4.95,1.54],[6.48,3.48,1.60],[7.37,1.75,1.20],[7.3,-1.6,1.28],[6.2,-3.7,1.64],[4.2,-4.88,1.54],[2.72,-5.59,1.10],[-4.50,-5.58,1.23],[-6.65,-4.28,1.34],[-7.54,2.78,1.30],[-7.43,.68,.9],[-.4,6.23,.96]];
  pines.forEach(([x,z,s], i) => pine(b,x,.49,z,s,i*2.7,m));
  for (let i=0;i<33;i++) {
    const a=random()*TAU,x=7.8*Math.cos(a),z=6.4*Math.sin(a);
    if(z < -4.9 || (x < -5.4 && z < .6 && z > -3.2))continue;
    b.ball(x,.52,z,.25+random()*.18,.18+random()*.12,.25+random()*.22,m.leaves[i%3],1);
  }
  for (const [x,z,s] of [[4.8,-3.8,.9],[5.4,-3.5,.68],[5.2,-4.25,1.3],[-5.8,3.7,.54],[-4.8,4.3,.66],[2.8,5.1,.71]]) {
    b.add(new THREE.IcosahedronGeometry(1,1),m.rock,[x,.52+s*.50,z],[s*.53,s,s*.62],[.16,x*.2,.2]);
    b.add(new THREE.IcosahedronGeometry(1,0),m.rockLight,[x+s*.25,.58,z+s*.18],[s*.38,s*.42,s*.40],[0,.5,.2]);
  }
  // A small rock cascade and scattered koi are sculptural accents in the pond.
  for(let i=0;i<4;i++) curve(b,[[5.12+i*.08,1.12,-3.73],[5.22+i*.08,.88,-3.43],[5.12+i*.08,.53,-3.16]],.025,m.waterLight,12,5);
  const koiMat=material('#dfaa66');
  for(const [x,z,a] of [[-2.9,2.4,.4],[2.5,-1.25,1.4],[3.6,2.6,-.4],[-3.9,-1.4,2]]) {
    b.add(new THREE.SphereGeometry(1,12,8),koiMat,[x,.548,z],[.13,.018,.045],[0,a,0]);
    b.add(new THREE.ConeGeometry(.055,.1,3),koiMat,[x-Math.cos(a)*.13,.548,z+Math.sin(a)*.13],[1,.2,1],[Math.PI/2,0,Math.PI/2+a]);
  }
  b.finish();
  return {
    group,
    camera: { position: [16.39, 14.85, 20.13], target: [0, 1.1, 0] },
    hotspots: [
      { label:'圆满阁',position:[0,5.63,.68],description:'金色八角亭是南莲园池的视觉中心。重檐、檐角、柱间栏杆均由可编辑几何构成。' },
      { label:'朱红双桥',position:[-3.3,1.75,.68],description:'两侧朱红木桥把亭阁与池岸相连，是园池最鲜明的色彩与空间关系。' },
      { label:'唐风园林',position:[3.7,2.45,-4.1],description:'以环池游径、修剪松树、置石与木构厅堂表达唐风园林；布局和距离为微缩展示作了压缩。' },
    ],
    description:'金色圆满阁立在碧池中央，两道朱桥展开；松影、奇石与深色木构沿环形游径次第相接。',
    update() {},
  };
}
