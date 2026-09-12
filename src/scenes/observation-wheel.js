import * as THREE from 'three';
import {Batch, roundedShape, polygonShape, slab, simpleTree, rng} from './hong-kong-geometry.js';
import {harbourPalette, addIFC, createFerryModel} from './victoria-harbour.js';

const TAU = Math.PI * 2;
export function createObservationWheel() {
  const group = new THREE.Group(), batch = new Batch(group), m = harbourPalette(), random = rng(2014);
  slab(batch, roundedShape(17.4, 13.5, 1), -.13, .65, m.base, .085);
  slab(batch, roundedShape(17.22, 13.32, .93), .035, .17, m.water, .02);
  const shore = [[-8.23, -6.23], [8.23, -6.23], [8.23, 2.9], [5.2, 3.05], [1.1, 2.75], [-3.5, 2.95], [-8.23, 2.6]];
  slab(batch, polygonShape(shore), .25, .37, m.paving, .045);
  slab(batch, polygonShape([[-7.9, -2.9], [-2.5, -2.9], [-2.5, 1.95], [-7.9, 1.95]]), .285, .03, m.lawn, .03);
  slab(batch, polygonShape([[3.65, -3], [7.9, -3], [7.9, 1.95], [3.65, 1.95]]), .285, .03, m.lawn, .03);
  batch.box(.65, .29, -.3, 5.55, .06, 4.8, m.cream);
  addIFC(batch, -5.8, .29, -4.6, .79, m);
  for (let i = 0; i < 7; i++) {
    const x = -2.3 + i * 1.32, h = 1.2 + random() * 1.3;
    batch.box(x, .3 + h / 2, -4.87, .83, h, 1, i % 2 ? m.glassLight : m.glass);
    for (let f = 0; f < h / .19; f++) batch.box(x, .32 + f * .19, -4.87, .85, .018, 1.02, m.metal);
  }
  for (let i = 0; i < 18; i++) {
    const x = -7.9 + i * .92;
    if (x > -2.4 && x < 3.45) continue;
    simpleTree(batch, x, .31, 1.38, .63 + random() * .13, m);
    simpleTree(batch, x, .31, -2.1, .7, m);
    batch.box(x, .48, .6, .48, .08, .19, m.bronze);
    for (const dx of [-.17, .17]) batch.box(x + dx, .37, .6, .03, .2, .17, m.road);
  }
  // Queue canopies and a small ticket hall remain clear of the lowest capsules.
  batch.box(2.55, .58, 1.42, 1.75, .56, .85, m.white); batch.box(2.55, .93, 1.42, 1.9, .13, .98, m.red);
  for (let i = 0; i < 4; i++) batch.box(2.01 + i * .35, .61, 1.854, .22, .26, .016, m.glassDark);
  for (let i = 0; i < 5; i++) { const x = -.78 + i * .49; batch.rod([x, .35, 1.7], [x, .7, 1.7], .016, m.metal); batch.rod([x, .7, 1.7], [x, .7, 2.42], .016, m.metal); }
  batch.rod([-8, .55, 2.62], [7.95, .55, 2.9], .026, m.metal);
  for (let i = 0; i < 38; i++) batch.cylinder(-8 + i * .431, .4, 2.62 + i / 37 * .28, .018, .018, .31, m.metal, 5);
  const centre = new THREE.Vector3(.45, 4.15, -.05), radius = 3.35;
  // Four splayed legs converge on a single axle. Both wheel sides have depth.
  for (const z of [-.77, .77]) {
    for (const x of [-1.65, 1.65]) {
      batch.box(centre.x + x, .34, z, .7, .16, .74, m.cream);
      batch.rod([centre.x + x, .39, z], [centre.x, centre.y, centre.z + z * .46], .092, m.white, 10);
    }
  }
  batch.rod([centre.x, centre.y, -.7], [centre.x, centre.y, .7], .145, m.metal, 16);
  for (let i = 0; i < 26; i++) {
    const x = random() * 15.7 - 7.8, z = 3.45 + random() * 2.5;
    batch.curve([[x - .24, .071, z], [x, .074, z + .015], [x + .24, .071, z]], .008, m.ripple, 4);
  }
  batch.finish();
  const wheel = new THREE.Group(), wb = new Batch(wheel); wheel.position.copy(centre); group.add(wheel);
  for (const z of [-.18, .18]) {
    wb.add(new THREE.TorusGeometry(radius, .048, 8, 168), m.white, [0, 0, z]);
    wb.add(new THREE.TorusGeometry(radius - .16, .017, 5, 168), m.metal, [0, 0, z]);
    for (let i = 0; i < 42; i++) {
      const a = i / 42 * TAU;
      wb.rod([Math.cos(a + .7) * .17, Math.sin(a + .7) * .17, z * .5], [Math.cos(a) * radius, Math.sin(a) * radius, z], .011, m.white, 5);
      wb.rod([Math.cos(a - .7) * .17, Math.sin(a - .7) * .17, z * .5], [Math.cos(a) * radius, Math.sin(a) * radius, z], .011, m.white, 5);
    }
  }
  for (let i = 0; i < 42; i++) { const a = i / 42 * TAU; wb.rod([Math.cos(a) * radius, Math.sin(a) * radius, -.22], [Math.cos(a) * radius, Math.sin(a) * radius, .22], .028, m.metal, 6); }
  wb.add(new THREE.CylinderGeometry(.2, .2, .55, 24), m.white, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]); wb.finish();
  // Build one detailed cabin, then instance it 42 times. Matrices keep cabins upright.
  const cabinGroup = new THREE.Group(), cb = new Batch(cabinGroup);
  cb.cylinder(0, -.03, 0, .17, .17, .22, m.glassDark, 8);
  cb.cylinder(0, -.17, 0, .175, .155, .085, m.red, 8);
  cb.cylinder(0, .103, 0, .145, .18, .075, m.red, 8);
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; cb.rod([Math.cos(a) * .168, -.14, Math.sin(a) * .168], [Math.cos(a) * .168, .08, Math.sin(a) * .168], .009, m.red, 4); }
  for (const z of [-.16, .16]) cb.box(0, -.045, z, .23, .038, .015, m.white);
  cb.rod([-.12, .12, 0], [0, .23, 0], .012, m.metal); cb.rod([.12, .12, 0], [0, .23, 0], .012, m.metal); cb.finish();
  const cabins = cabinGroup.children.map((mesh) => { const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, 42); instances.castShadow = true; instances.receiveShadow = true; instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(instances); return instances; });
  const transform = new THREE.Matrix4();
  const update = (time = 0) => {
    if (!Number.isFinite(time)) return;
    const phase = time * .038; wheel.rotation.z = phase;
    for (let i = 0; i < 42; i++) {
      const a = i / 42 * TAU + phase; transform.makeTranslation(centre.x + Math.cos(a) * radius, centre.y + Math.sin(a) * radius - .23, centre.z);
      for (const mesh of cabins) mesh.setMatrixAt(i, transform);
    }
    for (const mesh of cabins) mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  // Recompute after all initial matrices; disabling frustum culling avoids stale dynamic bounds.
  for (const mesh of cabins) { mesh.computeBoundingSphere(); mesh.frustumCulled = false; }
  const ferry = createFerryModel(m); ferry.scale.setScalar(.48); ferry.position.set(-3.5, .11, 4.75); ferry.rotation.y = 1.15; group.add(ferry);
  return { group, camera: {position: [17.7, 13.4, 23.8], target: [0, 2.55, -.45]}, description: '转动的白色巨轮，临海的草坪，以及中环高楼之间的一段留白。',
    hotspots: [
      {label: '香港摩天轮', position: [.45, 7.75, -.05], description: '42 个座舱悬挂在轮缘。轮体缓缓转动，座舱保持竖直，近看轮圈、辐条与支撑结构。'},
      {label: '中环海滨', position: [4.5, .55, 2.8], description: '摩天轮位于中环海滨，草坪、步道与维港相连；周围布局在这里做了艺术化简化。'},
      {label: '国金二期', position: [-5.8, 6.2, -4.6], description: '国金二期位于摩天轮西侧一带。以缩小后的楼体和分叉冠部交代中环的城市背景。'},
    ], update };
}
