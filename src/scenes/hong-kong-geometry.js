import * as THREE from 'three';

export const material = (color, roughness = .78, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const V = (p) => new THREE.Vector3(...p), UP = new THREE.Vector3(0, 1, 0);

/** Merge static architecture by material: detailed repeated components stay cheap. */
export class Batch {
  constructor(group) { this.group = group; this.buckets = new Map(); }
  add(geometry, mat, position = [0, 0, 0], scale = [1, 1, 1], rotation = null) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const q = rotation instanceof THREE.Quaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0])));
    g.applyMatrix4(new THREE.Matrix4().compose(V(position), q, V(scale)));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
  }
  box(x, y, z, w, h, d, mat, rotation = [0, 0, 0]) { this.add(new THREE.BoxGeometry(w, h, d), mat, [x, y, z], [1, 1, 1], rotation); }
  cylinder(x, y, z, rt, rb, h, mat, sides = 12) { this.add(new THREE.CylinderGeometry(rt, rb, h, sides), mat, [x, y, z]); }
  ball(x, y, z, sx, sy, sz, mat, detail = 1) { this.add(new THREE.IcosahedronGeometry(1, detail), mat, [x, y, z], [sx, sy, sz]); }
  rod(a, b, radius, mat, sides = 6) {
    const start = V(a), end = V(b), axis = end.clone().sub(start), len = axis.length();
    if (len < 1e-6) return;
    this.add(new THREE.CylinderGeometry(radius, radius, len, sides), mat, start.add(end).multiplyScalar(.5).toArray(), [1, 1, 1], new THREE.Quaternion().setFromUnitVectors(UP, axis.normalize()));
  }
  curve(points, radius, mat, segments = 12, sides = 4) { this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)), segments, radius, sides, false), mat); }
  finish() {
    for (const [mat, list] of this.buckets) {
      const count = list.reduce((sum, g) => sum + g.attributes.position.count, 0);
      const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3); let offset = 0;
      for (const g of list) { positions.set(g.attributes.position.array, offset); normals.set(g.attributes.normal.array, offset); offset += g.attributes.position.array.length; g.dispose(); }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, mat); mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    }
    this.buckets.clear(); return this.group;
  }
}

export function roundedShape(width, depth, radius = .25) {
  const x = -width / 2, z = -depth / 2, s = new THREE.Shape();
  s.moveTo(x + radius, z); s.lineTo(x + width - radius, z); s.quadraticCurveTo(x + width, z, x + width, z + radius);
  s.lineTo(x + width, z + depth - radius); s.quadraticCurveTo(x + width, z + depth, x + width - radius, z + depth);
  s.lineTo(x + radius, z + depth); s.quadraticCurveTo(x, z + depth, x, z + depth - radius);
  s.lineTo(x, z + radius); s.quadraticCurveTo(x, z, x + radius, z); return s;
}

/** Polygon uses world x,z. THREE.Shape's y is inverted to preserve geography. */
export function polygonShape(points) { const s = new THREE.Shape(); points.forEach(([x, z], i) => i ? s.lineTo(x, -z) : s.moveTo(x, -z)); s.closePath(); return s; }

export function slab(batch, shape, top, thickness, mat, bevel = .04) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0, bevelSegments: 3, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 14 });
  g.rotateX(-Math.PI / 2); batch.add(g, mat, [0, top - thickness, 0]);
}

export function simpleTree(batch, x, y, z, size, materials) {
  const bark = materials.bark, leaves = materials.leaves || materials.foliage;
  batch.cylinder(x, y + size * .35, z, size * .035, size * .055, size * .7, bark, 6);
  for (let k = 0; k < 4; k++) {
    const a = k * 2.4, r = k ? size * .15 : 0;
    batch.ball(x + Math.cos(a) * r, y + size * (.77 + (k % 2) * .12), z + Math.sin(a) * r, size * .3, size * .34, size * .3, Array.isArray(leaves) ? leaves[k % leaves.length] : leaves, 1);
  }
}

export function rng(seed = 6311) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
