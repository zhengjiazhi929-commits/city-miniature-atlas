import * as THREE from 'three';
import {hubinPlace} from './hubin-place.js';

/** A compact physical symbol for the city overview, not an independent scene.
 * +X east / -Z north. The complete support slab has a bottom at local Y=0.
 * All transforms are baked into vertex buffers so whole-footprint placement
 * can inspect the true bounds without depending on child mesh matrices.
 * The caller must fit and ground this complete footprint on the source land.
 */
export function createHubinOverview() {
  const group = new THREE.Group();
  group.name = 'hubin-yintai-overview';
  const colors = {
    paving: '#cfc7ae', limestone: '#e7ddc7', brick: '#aa7862',
    roof: '#657976', glass: '#426773', trim: '#ece6d6', brass: '#a9864e',
  };
  const materials = Object.fromEntries(Object.entries(colors).map(([key, color]) =>
    [key, new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: key === 'glass' ? .15 : 0 })]));
  const buckets = new Map();
  function box(x, y, z, width, height, depth, material) {
    const source = new THREE.BoxGeometry(width, height, depth);
    const geometry = source.toNonIndexed();
    source.dispose();
    geometry.translate(x, y, z);
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(geometry);
  }
  const slab = .016;
  box(0, slab / 2, 0, .84, slab, .56, 'paving');
  // Six representative shop volumes leave a continuous open pedestrian spine
  // and two cross passages. They are deliberately fewer than the real shops.
  const shops = [
    [-.277, -.16, .218, .174, .145, 'limestone'],
    [0, -.16, .218, .174, .176, 'brick'],
    [.277, -.16, .218, .174, .158, 'limestone'],
    [-.277, .16, .218, .174, .17, 'brick'],
    [0, .16, .218, .174, .145, 'limestone'],
    [.277, .16, .218, .174, .196, 'limestone'],
  ];
  for (const [x, z, width, depth, height, wall] of shops) {
    box(x, slab + height / 2, z, width, height, depth, wall);
    const inward = z > 0 ? -1 : 1;
    const frontageZ = z + inward * (depth / 2 + .003);
    // Glass and frames have volume; no raster facade or ground decals.
    for (const dx of [-.063, 0, .063]) {
      box(x + dx, slab + .048, frontageZ, .046, .072, .01, 'glass');
      box(x + dx, slab + height * .72, frontageZ, .043, .038, .01, 'glass');
    }
    const canopyZ = z + inward * (depth / 2 + .02);
    box(x, slab + .093, canopyZ, width + .012, .012, .044, 'trim');
    for (const dx of [-.099, .099]) {
      box(x + dx, slab + .044, canopyZ + inward * .014, .012, .088, .012, 'limestone');
    }
    // Flat parapet roofs and broad horizontal cornices maintain low-rise form.
    box(x, slab + height + .006, z, width + .013, .012, depth + .014, 'trim');
    box(x, slab + height + .014, z, width - .02, .004, depth - .02, 'roof');
    box(x, slab + .105, frontageZ + inward * .005, width * .72, .012, .009, 'brass');
  }
  let triangles = 0;
  for (const [material, geometries] of buckets) {
    const count = geometries.reduce((n, geometry) => n + geometry.attributes.position.count, 0);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
    let offset = 0;
    for (const geometry of geometries) {
      positions.set(geometry.attributes.position.array, offset);
      normals.set(geometry.attributes.normal.array, offset);
      offset += geometry.attributes.position.array.length;
      geometry.dispose();
    }
    // Float32 translation can leave a tiny negative residue on the slab floor.
    for (let i = 1; i < positions.length; i += 3) if (Math.abs(positions[i]) < 1e-8) positions[i] = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[material]);
    mesh.name = `hubin-${material}`; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); triangles += count / 3;
  }
  group.userData = {
    landmarkId: hubinPlace.id,
    source: hubinPlace.source,
    modelRole: hubinPlace.modelRole,
    nativeDimensions: [.84, .228, .56],
    supportPolygon: [[-.42,-.28],[.42,-.28],[.42,.28],[-.42,.28]],
    baselineY: 0, triangles,
  };
  return group;
}
