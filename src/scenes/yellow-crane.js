import * as THREE from 'three';

// An authored architectural miniature: the five exterior storeys and curved
// eaves are recognisable; the garden is deliberately compressed, not surveyed.
export function createYellowCrane() {
  const group = new THREE.Group();
  group.name = 'Yellow Crane Tower · 黄鹤楼';
  const materials = {
    stone: new THREE.MeshStandardMaterial({ color: '#d3c7ae', roughness: 0.88 }),
    stoneLight: new THREE.MeshStandardMaterial({ color: '#e4d8bd', roughness: 0.85 }),
    earth: new THREE.MeshStandardMaterial({ color: '#a49b71', roughness: 1 }),
    grass: new THREE.MeshStandardMaterial({ color: '#7e9367', roughness: 1 }),
    red: new THREE.MeshStandardMaterial({ color: '#973e2d', roughness: 0.68 }),
    wood: new THREE.MeshStandardMaterial({ color: '#643326', roughness: 0.82 }),
    cream: new THREE.MeshStandardMaterial({ color: '#f3deb4', roughness: 0.82 }),
    teal: new THREE.MeshStandardMaterial({ color: '#315c55', roughness: 0.78 }),
    roof: new THREE.MeshStandardMaterial({ color: '#d9a249', roughness: 0.5, metalness: 0.08, side: THREE.DoubleSide }),
    roofRib: new THREE.MeshStandardMaterial({ color: '#edbd63', roughness: 0.57 }),
    shadow: new THREE.MeshStandardMaterial({ color: '#382e26', roughness: 0.73 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#5a674e', roughness: 0.64, metalness: 0.18 }),
    water: new THREE.MeshStandardMaterial({ color: '#7ca8a0', roughness: 0.28, metalness: 0.1 }),
    waterLine: new THREE.MeshStandardMaterial({ color: '#b0c8b6', roughness: 0.5 }),
  };
  const geometry = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
    rod: new THREE.CylinderGeometry(1, 1, 1, 5),
    sphere: new THREE.IcosahedronGeometry(1, 1),
    lowSphere: new THREE.IcosahedronGeometry(1, 0),
    plinth: new THREE.CylinderGeometry(1, 1, 1, 64),
  };
  const batches = new Map();
  const transform = new THREE.Object3D();
  function instance(shape, material, position, scale, rotation = [0, 0, 0], color) {
    const key = `${shape}/${material}`;
    if (!batches.has(key)) batches.set(key, { shape, material, items: [] });
    transform.position.set(...position);
    transform.scale.set(...scale);
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    batches.get(key).items.push({ matrix: transform.matrix.clone(), color });
  }
  const box = (material, p, s, r, c) => instance('box', material, p, s, r, c);
  function rod(material, a, b, radius = 0.03, shape = 'rod') {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    transform.position.copy(start.add(end).multiplyScalar(0.5));
    transform.scale.set(radius, delta.length(), radius);
    transform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    transform.updateMatrix();
    const key = `${shape}/${material}`;
    if (!batches.has(key)) batches.set(key, { shape, material, items: [] });
    batches.get(key).items.push({ matrix: transform.matrix.clone() });
  }
  let seed = 4106;
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  // A cut-away garden island. The thin brass-coloured reveal ties its edges to
  // the glazed roof; the stepped limestone podium carries the actual tower.
  instance('plinth', 'earth', [0, -0.52, 0], [8.9, 0.92, 8.9]);
  instance('plinth', 'stoneLight', [0, -0.055, 0], [8.91, 0.08, 8.91]);
  instance('plinth', 'grass', [0, 0.01, 0], [8.83, 0.06, 8.83]);
  box('stone', [0, 0.15, -0.1], [8.2, 0.26, 7.2]);
  box('stoneLight', [0, 0.32, -0.1], [7.8, 0.12, 6.85]);
  box('stone', [0, 0.51, -0.1], [7.3, 0.3, 6.45]);
  box('stoneLight', [0, 0.71, -0.1], [7.5, 0.12, 6.65]);
  // Individual limestone paving rather than a large featureless square.
  for (let x = -3.8; x < 3.9; x += 0.48) {
    for (let z = 3.75; z < 7.4; z += 0.43) {
      if (Math.hypot(x, z) < 8.65) box('stoneLight', [x, 0.075, z], [0.455, 0.05, 0.406], undefined, undefined);
    }
  }
  for (let n = 0; n < 9; n++) {
    box('stoneLight', [0, 0.07 + (n + 1) * 0.038, 5.65 - n * 0.28], [3.45, (n + 1) * 0.076, 0.3]);
    for (const side of [-1, 1]) {
      box('stone', [side * 1.88, 0.18 + n * 0.08, 5.65 - n * 0.28], [0.19, 0.28, 0.29]);
      if (n % 2 === 0) {
        instance('cylinder', 'stoneLight', [side * 1.88, 0.49 + n * 0.079, 5.65 - n * 0.28], [0.07, 0.46, 0.07]);
        instance('sphere', 'stoneLight', [side * 1.88, 0.74 + n * 0.079, 5.65 - n * 0.28], [0.11, 0.1, 0.11]);
      }
    }
  }
  for (const side of [-1, 1]) rod('stoneLight', [side * 1.88, 0.7, 5.88], [side * 1.88, 1.41, 3.35], 0.068);

  // A clipped square gives the square-with-octagonal-corners massing.
  const plan = [[-1, -.48], [-.48, -1], [.48, -1], [1, -.48], [1, .48], [.48, 1], [-.48, 1], [-1, .48]];
  const mix = (a, b, t) => a + (b - a) * t;
  function roofPoint(edge, u, t, radius, innerRadius, base, rise, lift) {
    const a = plan[edge], b = plan[(edge + 1) % plan.length];
    const x = mix(a[0], b[0], u), z = mix(a[1], b[1], u);
    const r = mix(innerRadius, radius, t);
    const corner = Math.pow(Math.abs(u * 2 - 1), 3.5);
    return [x * r, base + rise * Math.pow(1 - t, 2.1) + lift * Math.pow(t, 5) * (0.14 + 0.86 * corner), z * r - 0.1];
  }
  function curvedRoof(radius, innerRadius, base, rise, lift, tiles = true) {
    const positions = [], indices = [];
    const across = 16, radial = 12;
    for (let edge = 0; edge < 8; edge++) {
      const offset = positions.length / 3;
      for (let v = 0; v <= radial; v++) for (let u = 0; u <= across; u++) {
        positions.push(...roofPoint(edge, u / across, v / radial, radius, innerRadius, base, rise, lift));
      }
      for (let v = 0; v < radial; v++) for (let u = 0; u < across; u++) {
        const a = offset + v * (across + 1) + u, b = a + across + 1;
        indices.push(a, b + 1, b, a, a + 1, b + 1);
      }
      // Ridges follow the double curvature of the roof, so silhouette and
      // glints remain architectural when the visitor rotates the model.
      const grooves = tiles ? 13 : 6;
      for (let u = 0; u <= grooves; u++) {
        for (let k = 0; k < 6; k++) {
          const a = roofPoint(edge, u / grooves, k / 6, radius, innerRadius, base + .012, rise, lift);
          const b = roofPoint(edge, u / grooves, (k + 1) / 6, radius, innerRadius, base + .012, rise, lift);
          rod('roofRib', a, b, u === 0 || u === grooves ? .028 : .012);
        }
      }
      for (let k = 0; k < 12; k++) {
        const a = roofPoint(edge, k / 12, 1, radius, innerRadius, base, rise, lift);
        const b = roofPoint(edge, (k + 1) / 12, 1, radius, innerRadius, base, rise, lift);
        rod('roofRib', a, b, .041);
        rod('red', a.map((c, i) => i === 1 ? c - .072 : c), b.map((c, i) => i === 1 ? c - .072 : c), .044);
      }
      const tip = roofPoint(edge, 0, 1, radius, innerRadius, base, rise, lift);
      rod('roofRib', tip, [tip[0] * 1.03, tip[1] + .16, (tip[2] + .1) * 1.03 - .1], .027);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materials.roof);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  function facade(radius, floor, height, story) {
    const wallR = radius * .69;
    box('cream', [0, floor + height * .43, -.1], [wallR * 2, height * .86, wallR * 2]);
    box('wood', [0, floor + .07, -.1], [radius * 1.86, .14, radius * 1.86]);
    // Four principal faces, each with five panel bays and a covered gallery.
    for (let face = 0; face < 4; face++) {
      const angle = face * Math.PI / 2;
      const local = (x, y, z) => [x * Math.cos(angle) + z * Math.sin(angle), y, z * Math.cos(angle) - x * Math.sin(angle) - .1];
      const z = radius * .83;
      box('teal', local(0, floor + height - .02, z), [radius * 1.75, .13, .11], [0, angle, 0]);
      box('roofRib', local(0, floor + height - .06, z + .065), [radius * 1.75, .035, .022], [0, angle, 0]);
      for (let c = -2; c <= 2; c++) {
        const x = c * radius * .365;
        instance('cylinder', 'red', local(x, floor + height / 2, z), [.072, height, .072]);
        box('stoneLight', local(x, floor + .1, z), [.18, .12, .18]);
        // Bracket stacks: three stepped arms, projecting farther upwards.
        for (let k = 0; k < 3; k++) {
          box(k % 2 ? 'cream' : 'teal', local(x, floor + height - .23 + k * .09, z + k * .04), [.16 + k * .13, .063, .17 + k * .09], [0, angle, 0]);
        }
      }
      for (let w = -2; w <= 2; w++) {
        const x = w * wallR * .34;
        box('shadow', local(x, floor + height * .5, wallR + .009), [wallR * .265, height * .5, .021], [0, angle, 0]);
        for (const m of [-1, 0, 1]) box('red', local(x + m * wallR * .069, floor + height * .5, wallR + .025), [.023, height * .5, .029], [0, angle, 0]);
        for (const h of [.36, .61]) box('red', local(x, floor + height * h, wallR + .026), [wallR * .267, .025, .03], [0, angle, 0]);
      }
      if (story > 0) {
        for (const y of [.21, .44]) box('red', local(0, floor + y, radius * .93), [radius * 1.83, .047, .052], [0, angle, 0]);
        for (let c = -10; c <= 10; c++) box('red', local(c * radius * .084, floor + .31, radius * .93), [.025, .32, .035], [0, angle, 0]);
      }
    }
  }
  // Exterior storeys are retained as five. Height is a deliberate miniature
  // proportion, not a numerical reproduction of published building height.
  const levels = [
    { r: 3.23, y: .79, h: 1.29, roof: 2.03 },
    { r: 2.78, y: 2.24, h: 1.19, roof: 3.4 },
    { r: 2.52, y: 3.61, h: 1.13, roof: 4.73 },
    { r: 2.25, y: 4.95, h: 1.08, roof: 6.02 },
    { r: 1.99, y: 6.25, h: 1.05, roof: 7.29 },
  ];
  levels.forEach((level, i) => {
    facade(level.r * .91, level.y, level.h, i);
    curvedRoof(level.r, i === 4 ? .05 : level.r * .5, level.roof, i === 4 ? 1.48 : .84, .5);
    // Secondary corner eaves give the overlapping wing profile seen in the
    // reference; the top tier resolves to a single pointed crown.
    if (i < 4) {
      for (let corner = 0; corner < 4; corner++) {
        const a = Math.PI / 4 + corner * Math.PI / 2;
        const r = level.r * .91;
        const p = [Math.sin(a) * r, level.roof + .3, Math.cos(a) * r - .1];
        rod('roofRib', [p[0] * .9, p[1] - .2, (p[2] + .1) * .9 - .1], [p[0] * 1.15, p[1] + .18, (p[2] + .1) * 1.15 - .1], .046);
      }
    }
  });
  instance('cylinder', 'roofRib', [0, 8.94, -.1], [.065, .55, .065]);
  instance('sphere', 'roofRib', [0, 9.11, -.1], [.14, .2, .14]);
  instance('sphere', 'roofRib', [0, 9.31, -.1], [.08, .12, .08]);

  // A real sign, set into a solid frame. Canvas is only lettering; all
  // building silhouettes, roof tiles, windows and railings are geometry.
  function sign(text, p, width, height, fontSize = 110) {
    box('roofRib', p, [width + .11, height + .1, .095]);
    box('shadow', [p[0], p[1], p[2] + .054], [width, height, .035]);
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = '#302e29'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#edc277'; context.font = `600 ${fontSize}px "Songti SC", "STSong", serif`;
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 384, 136);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .8 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(p[0], p[1], p[2] + .075); group.add(mesh);
  }
  sign('黄 鹤 楼', [0, 6.86, 1.62], 1.5, .4);
  sign('气 吞 云 梦', [0, 1.67, 2.61], 1.3, .35, 94);

  // White-stone terrace balustrades, interrupted at the ceremonial stairs.
  for (let side = 0; side < 4; side++) {
    for (let n = -8; n <= 8; n++) {
      if (side === 0 && Math.abs(n) < 4) continue;
      const angle = side * Math.PI / 2;
      const p = [n * .43 * Math.cos(angle) + 3.24 * Math.sin(angle), 1.0, 3.24 * Math.cos(angle) - n * .43 * Math.sin(angle) - .1];
      instance('cylinder', 'stoneLight', p, [.053, .44, .053]);
      instance('sphere', 'stoneLight', [p[0], 1.26, p[2]], [.085, .09, .085]);
      if (n < 8 && !(side === 0 && n === -4)) {
        box('stoneLight', [p[0] + .215 * Math.cos(angle), 1.17, p[2] - .215 * Math.sin(angle)], [.43, .055, .075], [0, angle, 0]);
      }
    }
  }

  // A small three-opening ceremonial gateway frames the foreground, while
  // staying low enough for the complete staircase to remain readable.
  const gateZ = 7.0;
  for (const x of [-2.55, -.99, .99, 2.55]) {
    box('stone', [x, .17, gateZ], [.35, .25, .39]);
    instance('cylinder', 'red', [x, .94, gateZ], [.094, 1.6, .094]);
    box('teal', [x, 1.68, gateZ], [.48, .12, .4]);
  }
  box('red', [0, 1.6, gateZ], [5.38, .17, .23]);
  box('teal', [0, 1.78, gateZ], [5.72, .19, .36]);
  // Swept gateway roof: a genuinely curved gabled surface, not a wedge.
  const gatePos = [], gateIndex = [];
  for (let j = 0; j <= 8; j++) for (let i = 0; i <= 40; i++) {
    const x = -2.97 + i / 40 * 5.94, z = -.5 + j / 8;
    const y = 1.91 + .22 * (1 - Math.abs(z) * 2) + .33 * Math.pow(Math.abs(x) / 2.97, 7);
    gatePos.push(x, y, gateZ + z);
    if (j < 8 && i < 40) { const a = j * 41 + i; gateIndex.push(a, a + 41, a + 1, a + 1, a + 41, a + 42); }
  }
  const gateGeo = new THREE.BufferGeometry(); gateGeo.setAttribute('position', new THREE.Float32BufferAttribute(gatePos, 3)); gateGeo.setIndex(gateIndex); gateGeo.computeVertexNormals();
  const gateMesh = new THREE.Mesh(gateGeo, materials.roof); gateMesh.castShadow = gateMesh.receiveShadow = true; group.add(gateMesh);
  for (let i = 0; i <= 36; i++) {
    const x = -2.97 + i / 36 * 5.94, corner = .33 * Math.pow(Math.abs(x) / 2.97, 7);
    rod('roofRib', [x, 1.922 + corner, gateZ -.5], [x, 2.142 + corner, gateZ], .014);
    rod('roofRib', [x, 2.142 + corner, gateZ], [x, 1.922 + corner, gateZ + .5], .014);
  }
  sign('楚 天 极 目', [0, 1.53, gateZ + .17], 1.35, .32, 94);

  // Pines and broadleaf crowns use reused geometry and seeded placement.
  // Different heights, leaning branches and clustered canopies make a garden
  // canopy rather than a row of identical geometric lollipops.
  const leafColors = ['#365d47', '#456a4e', '#637f50', '#819361', '#9a9c61'];
  function tree(x, z, scale, pine = false) {
    const trunkH = (pine ? 1.42 : 1.15) * scale;
    const lean = (random() -.5) * .22;
    rod('wood', [x, .05, z], [x + lean, trunkH, z -.1 * scale], .074 * scale, 'cylinder');
    const crowns = pine ? 5 : 4;
    for (let k = 0; k < crowns; k++) {
      const angle = k * 2.399 + random() * .5, spread = (.15 + random() * .38) * scale;
      const cx = x + Math.sin(angle) * spread, cz = z + Math.cos(angle) * spread;
      const cy = trunkH * (.68 + k / crowns * .4);
      rod('wood', [x, cy -.25, z], [cx, cy, cz], .025 * scale);
      instance('sphere', 'leaf', [cx, cy + .15 * scale, cz], [(pine ? .57 : .5) * scale, (pine ? .22 : .47) * scale, .48 * scale], [(random() -.5) * .08, random() * Math.PI * 2, (random() -.5) * .1], leafColors[Math.floor(random() * leafColors.length)]);
    }
  }
  for (let n = 0; n < 75; n++) {
    const angle = random() * Math.PI * 2, r = 4.45 + random() * 3.72;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    if ((z > 2.7 && Math.abs(x) < 4.05) || (x < -6.05 && z < 1.7 && z > -5.5)) continue;
    tree(x, z, .68 + random() * .55, random() < .52);
    if (n % 2 === 0) instance('sphere', 'leaf', [x + .37, .29, z -.3], [.56, .28, .44], [0, random(), 0], '#9b9b65');
  }
  // Side garden stones, lanterns and a bonsai-sized crane sculpture.
  for (const side of [-1, 1]) {
    for (let n = 0; n < 5; n++) {
      const x = side * (4.6 + random() * .7), z = 2.45 + n * .63;
      instance('lowSphere', 'stone', [x, .19, z], [.21 + random() * .14, .24, .28], [random(), random(), random()]);
    }
    for (const z of [3.9, 6.0]) {
      instance('cylinder', 'stone', [side * 3.1, .47, z], [.075, .8, .075]);
      box('stoneLight', [side * 3.1, .9, z], [.27, .24, .27]);
      box('shadow', [side * 3.1, .92, z + .143], [.14, .12, .015]);
      instance('sphere', 'stoneLight', [side * 3.1, 1.08, z], [.23, .11, .23]);
    }
  }
  instance('lowSphere', 'stone', [2.7, .38, 4.78], [.57, .4, .44], [0, .35, .15]);
  for (const dx of [-.09, .09]) rod('bronze', [2.7 + dx, .52, 4.78], [2.7 + dx, 1.1, 4.7], .024);
  instance('sphere', 'bronze', [2.7, 1.17, 4.67], [.22, .28, .14], [-.4, 0, 0]);
  rod('bronze', [2.7, 1.3, 4.59], [2.66, 1.73, 4.55], .04);
  rod('bronze', [2.66, 1.73, 4.55], [2.7, 1.92, 4.69], .035);
  instance('sphere', 'bronze', [2.7, 1.93, 4.69], [.075, .08, .085]);
  rod('bronze', [2.7, 1.93, 4.69], [2.7, 1.87, 4.91], .027);

  // A narrow slice evokes the Yangtze without pretending this is a to-scale
  // park-to-river plan. All geography inside the island is illustrative.
  const riverPositions = [], riverIndices = [];
  let previousBank = null;
  for (let n = 0; n <= 32; n++) {
    const t = n / 32, z = -5.3 + t * 6.85;
    const outerX = -Math.sqrt(8.78 ** 2 - z ** 2);
    const bankX = -6.32 + Math.sin(t * Math.PI * 1.4) * .17;
    riverPositions.push(outerX, .078, z, bankX, .078, z);
    if (n < 32) { const a = n * 2; riverIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const bank = [bankX, .11, z];
    if (previousBank) rod('stone', previousBank, bank, .055);
    previousBank = bank;
    if (n % 4 === 1) box('waterLine', [(outerX + bankX) * .5, .087, z], [(bankX - outerX) * .43, .005, .018]);
    if (n % 3 === 0) instance('lowSphere', 'stone', [bankX + .05, .13, z], [.16, .12, .21], [0, random(), 0]);
  }
  const riverGeo = new THREE.BufferGeometry();
  riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(riverPositions, 3));
  riverGeo.setIndex(riverIndices); riverGeo.computeVertexNormals();
  const river = new THREE.Mesh(riverGeo, materials.water); river.receiveShadow = true; group.add(river);

  // Finalise primitive batches. Thousands of columns/roof ribs/rail parts are
  // rendered in a few dozen calls, rather than one Mesh per tile.
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometry[batch.shape], materials[batch.material], batch.items.length);
    mesh.name = `yellow-crane:${batch.shape}:${batch.material}`;
    const hasColor = batch.items.some(item => item.color);
    batch.items.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      if (hasColor) mesh.setColorAt(i, new THREE.Color(item.color || '#ffffff'));
    });
    mesh.castShadow = batch.material !== 'water' && batch.material !== 'waterLine';
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  group.userData.attribution = 'Sources and artistic deviations: docs/yellow-crane-sources.md';
  group.userData.spatialType = 'authored-miniature';
  return {
    group,
    hotspots: [
      { label: '五层飞檐', position: [1.84, 6.42, 1.65], description: '保留黄鹤楼外观五层、层层飞檐的辨识特征；屋面曲线与斗拱以程序化几何重绘。' },
      { label: '登楼望楚天', position: [0, 3.9, 2.3], description: '回廊环绕楼身，檐下朱柱与浅色墙面交替。此模型展示外观，暂未复原室内。' },
      { label: '黄鹤与石阶', position: [2.7, 1.75, 4.73], description: '以前庭石阶与铜鹤为灵感的微缩景观；位置和距离经过艺术压缩。' },
    ],
    camera: { position: [16, 12.4, 19.8], target: [0, 2.4, 0] },
    update: () => {},
    description: '朱柱、金瓦与五层飞檐，把蛇山之巅的武汉地标收进一座可旋转的微缩园林。',
  };
}
