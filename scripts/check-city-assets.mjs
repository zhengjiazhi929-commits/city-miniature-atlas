#!/usr/bin/env node
// Read-only asset/loader checks. Does not rebuild the kit or launch a browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const APP = fileURLToPath(new URL('../', import.meta.url));
const DIR = path.join(APP, 'assets/city-kit/v1');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reportArgument = process.argv.findIndex(value => value === '--report');
const reportPath = reportArgument >= 0 ? process.argv[reportArgument + 1] : process.argv.find(value => value.startsWith('--report='))?.slice(9);
if (reportArgument >= 0 && !reportPath) throw new Error('--report needs an output file path');
const report = {passed: false, readOnlyKit: true, rebuilt: false, browserStarted: false, checks: [], assets: [], glbs: []};
const check = (name, callback) => { callback(); report.checks.push(name); };
const manifestBytes = await fs.readFile(path.join(DIR, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
report.version = manifest.version; report.manifestSha256 = hash(manifestBytes);
const initialHashes = new Map([['manifest.json', report.manifestSha256]]);

// Node has no browser import map. Resolve only the existing local Three alias
// and default manifest URL in-memory; test the actual unchanged loader source.
const loaderPath = path.join(APP, 'src/city-assets.js');
const loaderSource = await fs.readFile(loaderPath, 'utf8');
report.loaderSha256 = hash(loaderSource);
const resolved = loaderSource.replace("from 'three'", `from '${pathToFileURL(path.join(APP, 'vendor/three.module.js')).href}'`)
  .replace("new URL('../assets/city-kit/v1/manifest.json', import.meta.url)", `new URL('${pathToFileURL(path.join(DIR, 'manifest.json')).href}')`);
const {loadCityAssets, validateCityAsset} = await import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));

function closedParts(asset) {
  const p = asset.geometry.data.attributes.position.array;
  for (const part of asset.parts) {
    const edges = new Map(); let volume = 0;
    for (let triangle = part.triangleStart; triangle < part.triangleStart + part.triangleCount; triangle++) {
      const vertices = [0,1,2].map(i => new THREE.Vector3(...p.slice(triangle * 9 + i * 3, triangle * 9 + i * 3 + 3)));
      const [a,b,c] = vertices;
      assert(b.clone().sub(a).cross(c.clone().sub(a)).length() > 1e-10, `${asset.id}/${part.name}: degenerate triangle`);
      volume += a.dot(b.clone().cross(c)) / 6;
      const keys = vertices.map(v => v.toArray().map(value => Math.round(value * 1e5)).join(','));
      for (const [i,j] of [[0,1],[1,2],[2,0]]) {
        const key = [keys[i],keys[j]].sort().join('|'), row = edges.get(key) ?? [0,0];
        row[0]++; row[1] += keys[i] < keys[j] ? 1 : -1; edges.set(key,row);
      }
    }
    assert(volume > 0, `${asset.id}/${part.name}: nonpositive volume`);
    assert([...edges.values()].every(([count,winding]) => count === 2 && winding === 0), `${asset.id}/${part.name}: open or inconsistently wound component`);
  }
}

function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12); assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(bytes.subarray(20,20+jsonLength));
  assert.equal(gltf.asset.version, '2.0');
  assert(!gltf.images && !gltf.textures, 'Kit GLBs must remain texture-free');
  const binaryHeader = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(binaryHeader+4), 0x004e4942);
  assert.equal(binaryHeader + 8 + bytes.readUInt32LE(binaryHeader), bytes.length);
  return {gltf, binaryStart: binaryHeader + 8};
}

const assetPayloads = new Map();
try {
  check('Manifest has twelve buildings, three tree components and two road primitives', () => {
    assert.equal(manifest.assets.length, 17); assert.equal(manifest.presets.length, 2);
    assert.equal(manifest.assets.filter(entry => entry.role === 'ordinary-building').length, 12);
  });
  for (const entry of manifest.assets) {
    const bytes = await fs.readFile(path.join(DIR,entry.file)), asset = JSON.parse(bytes);
    assert.equal(hash(bytes),entry.sha256); assert.equal(bytes.length,entry.bytes);
    initialHashes.set(entry.file,hash(bytes));
    const actual = validateCityAsset(asset); closedParts(asset);
    assetPayloads.set(entry.id,asset);
    report.assets.push({id:entry.id,sha256:entry.sha256,triangles:actual.triangles,bounds:actual.bounds,closedComponents:asset.parts.length});
  }
  check('Actual fixed buffers, bounds, colours, normals and closed component topology', () => assert.equal(report.assets.length,17));
  check('Twelve building JSON files below 2.4 MB and every asset below 1500 triangles', () => {
    assert(manifest.assets.filter(a=>a.role==='ordinary-building').reduce((n,a)=>n+a.bytes,0)<2.4e6);
    assert(report.assets.every(a=>a.triangles<1500));
  });
  for (const entry of [...manifest.assets,...manifest.presets]) {
    const bytes = await fs.readFile(path.join(DIR,entry.glb.file));
    assert.equal(hash(bytes),entry.glb.sha256); assert.equal(bytes.length,entry.glb.bytes);
    initialHashes.set(entry.glb.file,hash(bytes));
    const {gltf,binaryStart} = parseGlb(bytes), source = assetPayloads.get(entry.id);
    if (source) {
      assert.equal(gltf.meshes.length,1);
      const groups=source.geometry.data.groups??[{start:0,count:source.geometry.data.attributes.position.array.length/3,materialIndex:0}],primitives=gltf.meshes[0].primitives;
      assert.equal(primitives.length,groups.length);
      for(let pi=0;pi<primitives.length;pi++){
      const primitive=primitives[pi],group=groups[pi];
      if(primitive.indices!=null){const acc=gltf.accessors[primitive.indices],view=gltf.bufferViews[acc.bufferView],size=acc.componentType===5125?4:2;assert.equal(acc.count,group.count);for(let i=0;i<acc.count;i++){const at=binaryStart+(view.byteOffset??0)+(acc.byteOffset??0)+i*size;assert.equal(size===4?bytes.readUInt32LE(at):bytes.readUInt16LE(at),group.start+i,`${entry.id}: material range index changed`);}}
      if(source.role==='ordinary-building'){
       const m=gltf.materials[primitive.material],pbr=m.pbrMetallicRoughness;
       if(group.materialIndex===1){assert.equal(pbr.roughnessFactor,.085);assert.equal(pbr.metallicFactor,.65);assert.equal(m.extensions.KHR_materials_clearcoat.clearcoatFactor,.55);}
       else if(group.materialIndex===0)assert.equal(pbr.roughnessFactor,.78);
      }

      for (const [gltfName,sourceName] of [['POSITION','position'],['COLOR_0','color']]) {
        const accessor=gltf.accessors[primitive.attributes[gltfName]], view=gltf.bufferViews[accessor.bufferView];
        assert.equal(accessor.componentType,5126); assert.equal(accessor.type,'VEC3');
        const values=source.geometry.data.attributes[sourceName].array;
        assert.equal(accessor.count*3,values.length);
        for(let i=0;i<accessor.count;i++)for(let c=0;c<3;c++){
          const offset=binaryStart+(view.byteOffset??0)+(accessor.byteOffset??0)+i*(view.byteStride??12)+c*4;
          assert(Math.abs(bytes.readFloatLE(offset)-values[i*3+c])<2e-6,`${entry.id}: ${gltfName} GLB/JSON mismatch`);
        }
      }
      }
    } else {
      for(const part of entry.recipe){
        const node=gltf.nodes.find(node=>node.name===part.asset);assert(node,`${entry.id}: missing recipe component`);
        const expected=new THREE.Matrix4().compose(new THREE.Vector3(...part.position),new THREE.Quaternion(),new THREE.Vector3(...part.scale));
        assert(node.matrix && node.matrix.every((value,i)=>Math.abs(value-expected.elements[i])<1e-6));
      }
    }
    report.glbs.push({file:entry.glb.file,sha256:entry.glb.sha256,geometryParity:!!source,recipeParity:!source});
  }
  report.checks.push('Nineteen texture-free GLBs: structure, JSON buffer parity and complete-tree recipes');

  const nativeFetch=globalThis.fetch, originalDispose=THREE.BufferGeometry.prototype.dispose;
  let requests=0, disposed=0, tamper=null, abortDuring=null;
  const checkpoint=()=>disposed;
  globalThis.fetch=async(url,{signal}={})=>{
    signal?.throwIfAborted(); requests++;
    if(abortDuring && requests===3){abortDuring.abort(new Error('test-mid-load-abort'));signal.throwIfAborted();}
    const bytes=await fs.readFile(new URL(url));
    const payload=String(url).endsWith(tamper??'never-match')?Buffer.from(bytes.toString().replace('Original','Modified')):bytes;
    return new Response(payload,{status:200});
  };
  THREE.BufferGeometry.prototype.dispose=function(){disposed++;return originalDispose.call(this);};
  try {
    const controller=new AbortController(),kit=await loadCityAssets({signal:controller.signal});
    assert.equal(kit.diagnostics.assets,17);assert.equal(kit.fingerprint,report.manifestSha256);
    for(const family of ['residential','commercial','industrial','generic'])assert.equal(kit.buildings[family].length,['generic','residential'].includes(family)?4:2);
    const previous=kit.buildings.residential[0].geometry;controller.abort();kit.dispose();assert.equal(disposed,17);
    const second=await loadCityAssets();assert.notEqual(second.buildings.residential[0].geometry,previous);second.dispose();assert.equal(disposed,34);
    report.checks.push('All seventeen geometries load; independent invocations; complete and idempotent disposal');
    const early=new AbortController();early.abort(new Error('test-before-load'));const before=checkpoint();
    await assert.rejects(loadCityAssets({signal:early.signal}),/test-before-load/);assert.equal(disposed,before);
    requests=0;abortDuring=new AbortController();
    await assert.rejects(loadCityAssets({signal:abortDuring.signal}),/test-mid-load-abort/);assert.equal(disposed,before+1);abortDuring=null;
    requests=0;tamper='residential-twins.json';
    await assert.rejects(loadCityAssets(),/integrity mismatch/);assert.equal(disposed,before+2);tamper=null;
    report.lifecycle={fullLoads:2,geometriesPerLoad:17,disposedGeometryEvents:disposed,abortBeforeLoad:true,abortDuringLoad:true,abortAfterLoad:true,partialIntegrityFailureCleanup:true};
    report.checks.push('Abort before/during/after load and partial integrity failure release owned buffers');
  } finally { globalThis.fetch=nativeFetch;THREE.BufferGeometry.prototype.dispose=originalDispose; }

  for(const [file,expected]of initialHashes)assert.equal(hash(await fs.readFile(path.join(DIR,file))),expected,`Checker changed ${file}`);
  report.checkedFiles=initialHashes.size;
  report.checks.push('All fixed asset files unchanged by this check');
  report.limitations=['Does not rebuild assets, so this report does not claim byte-identical regeneration.','Component closure does not prove arbitrary placement support or clearance in a city.','No browser rendering, interaction or user visual acceptance is covered.'];
  report.passed=true;
} catch(error) { report.error=error.stack??String(error);process.exitCode=1; }
if(reportPath){const output=path.resolve(reportPath);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
