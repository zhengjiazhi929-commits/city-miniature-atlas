import * as THREE from 'three';
import {Batch, roundedShape, polygonShape, slab, simpleTree, rng} from './hong-kong-geometry.js';
import {harbourPalette, createFerryModel, addFerryPier, addClockTower, addIFC, addBankOfChina} from './victoria-harbour.js';

export function createStarFerry() {
  const group = new THREE.Group(), batch = new Batch(group), m = harbourPalette(), random = rng(1880);
  slab(batch, roundedShape(17.8, 13.4, 1.15), -.13, .66, m.base, .09);
  slab(batch, roundedShape(17.62, 13.22, 1.06), .04, .18, m.water, .018);
  // The foreground is Kowloon's western pier edge; the small skyline is across the water.
  const nearShore = [[-8.45, 1.25], [-5.95, 1.25], [-5.2, 3], [-3.1, 3.6], [-3.1, 6.22], [-8.45, 6.22]];
  slab(batch, polygonShape(nearShore), .3, .41, m.paving, .05);
  const farShore = [[-8.4, -6.25], [8.4, -6.25], [8.4, -4.75], [4, -4.55], [-2.2, -4.7], [-8.4, -4.6]];
  slab(batch, polygonShape(farShore), .19, .3, m.paving, .035);
  addFerryPier(batch, -4.9, .3, 3.12, 1.36, m, true);
  addClockTower(batch, -6.9, .35, 4.55, 1.32, m);
  for (let i = 0; i < 7; i++) {
    const z = 2 + i * .56; simpleTree(batch, -7.93, .34, z, .6, m);
    batch.rod([-5.9, .34, z], [-5.9, .9, z], .018, m.metal); batch.ball(-5.9, .93, z, .075, .075, .075, m.white, 0);
  }
  for (let i = 0; i < 11; i++) {
    const z = 1.4 + i * .41; batch.rod([-8.25, .34, z], [-8.25, .66, z], .02, m.metal);
  }
  batch.rod([-8.25, .66, 1.4], [-8.25, .66, 5.5], .022, m.metal);
  addIFC(batch, -3.5, .2, -5.4, .48, m); addBankOfChina(batch, -.8, .2, -5.45, .37, m);
  for (let i = 0; i < 15; i++) {
    const x = -7.5 + i * 1.03;
    if (Math.abs(x + 3.5) < .65 || Math.abs(x + .8) < .55) continue;
    const h = .75 + random() * 1.35, width = .48 + random() * .24;
    batch.box(x, .2 + h / 2, -5.43, width, h, .69, i % 2 ? m.glass : m.glassLight);
    for (let j = 0; j < h / .17; j++) batch.box(x, .22 + j * .17, -5.43, width + .01, .016, .71, m.metal);
    for (const dx of [-.3, 0, .3]) batch.box(x + dx * width, .2 + h / 2, -5.07, .015, h, .016, m.metal);
  }
  // Broken water highlights frame the hero vessel without hiding its silhouette.
  for (let i = 0; i < 65; i++) {
    const x = random() * 15 - 7.5, z = random() * 8.3 - 4.3;
    if (x < -5 && z > 1) continue;
    batch.curve([[x - .3, .077, z], [x, .081, z + .015], [x + .3, .077, z]], .009, m.ripple, 4);
  }
  batch.finish();
  const ferry = createFerryModel(m, true); ferry.scale.setScalar(2.28); ferry.position.set(1.55, .16, 1.5); ferry.rotation.y = 1.23; group.add(ferry);
  // The ferry is deliberately larger than its setting: a transport portrait, not a scale chart.
  return {
    group, camera: {position: [20.5, 14.5, 22], target: [0, 1.25, -.25]},
    description: '靠近绿白船身，看看上下层甲板、双头驾驶室与穿越维港的日常。',
    hotspots: [
      {label: '绿白双层小轮', position: [2.1, 2.95, 1.5], description: '双头船身、上下层客舱和绿白配色，构成天星小轮熟悉的轮廓。这里放大船体，便于近看栏杆与甲板。'},
      {label: '尖沙咀码头', position: [-4.9, 1.7, 3.1], description: '小轮从九龙海旁往返中环与湾仔。码头、钟楼与远岸天际线以压缩比例组成场景。'},
      {label: '隔海望中环', position: [-3.4, 3.8, -5.4], description: '维多利亚港连接香港岛与九龙。远岸地标在这个船舶特写中有意缩小。'},
    ],
    update(time = 0) {
      if (!Number.isFinite(time)) return;
      ferry.position.x = 1.55 + .2 * Math.sin(time * .11); ferry.position.z = 1.5 + .13 * Math.sin(time * .11);
      ferry.position.y = .16 + .021 * Math.sin(time * .62); ferry.rotation.z = .006 * Math.sin(time * .72);
    },
  };
}
