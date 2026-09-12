#!/usr/bin/env node
/** Verify the current West Lake scene without rebuilding its source bundle. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {createResourcePool} from '../src/scene-resources.js';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--report' || !args[1]))throw new Error('Usage: node scripts/check-westlake.mjs [--report output.json]');
const reportPath=args.length?path.resolve(args[1]):path.join(app,'docs/qa/westlake-numerical.json');
const asModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const three=pathToFileURL(path.join(app,'vendor/three.module.js')).href;
const landmarkSource=(await fs.readFile(path.join(app,'src/hangzhou-landmarks.js'),'utf8')).replace("from 'three'",`from '${three}'`);
const source=(await fs.readFile(path.join(app,'src/scenes/westlake-geographic.js'),'utf8')).replace("from 'three'",`from '${three}'`).replace("from '../hangzhou-landmarks.js'",`from '${asModule(landmarkSource)}'`).replace("new URL('../../data/scenes/westlake/',import.meta.url)",`new URL('${pathToFileURL(path.join(app,'data/scenes/westlake/')).href}')`);
const requests=[];
globalThis.fetch=async(url,{signal}={})=>{signal?.throwIfAborted();requests.push(String(url));const bytes=await fs.readFile(fileURLToPath(url));signal?.throwIfAborted();return new Response(bytes,{headers:{'content-length':String(bytes.length)}});};
const {createWestLakeGeographic}=await import(asModule(source));
const controller=new AbortController();
const started=performance.now(),scene=await createWestLakeGeographic(controller.signal),creationMilliseconds=performance.now()-started;
assert.equal(requests.length,1);assert.match(requests[0],/data\/scenes\/westlake\/display-scene-data\.json$/);
assert.equal(scene.diagnostics.mainLakeIslandHoles,6);assert.equal(scene.diagnostics.horizontalDeformation,false);
assert.deepEqual(scene.hotspots.filter(h=>h.sceneId).map(h=>h.sceneId).sort(),['leifeng','santan']);
let meshCount=0,triangles=0;
scene.group.traverse(object=>{if(!object.isMesh)return;meshCount++;const p=object.geometry.attributes.position;assert(p.array.every(Number.isFinite));if(object.geometry.index)assert([...object.geometry.index.array].every(i=>i>=0&&i<p.count));triangles+=(object.geometry.index?.count||p.count)/3*(object.count||1);});
const data=JSON.parse(await fs.readFile(path.join(app,'data/scenes/westlake/display-scene-data.json'),'utf8'));
const sourceData=JSON.parse(await fs.readFile(path.join(app,'data/hangzhou-atlas/scene-data.json'),'utf8'));
assert.deepEqual(data.water.find(w=>w.id==='westlake-water').rings,sourceData.water.find(w=>w.areaMeters===6124570).rings);
const inRing=(p,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
const inWater=(p,rings)=>inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r));
const marker=[120.143,30.247];assert(inWater(marker,data.water.find(w=>w.id==='westlake-water').rings));
const landBounds=new THREE.Box3().setFromObject(scene.group),camera=new THREE.PerspectiveCamera(37,1.3,.1,400);camera.position.fromArray(scene.camera.position);camera.lookAt(new THREE.Vector3(...scene.camera.target));camera.updateMatrixWorld();
const projectedCorners=[];for(const x of[landBounds.min.x,landBounds.max.x])for(const z of[landBounds.min.z,landBounds.max.z])projectedCorners.push(new THREE.Vector3(x,0,z).project(camera).toArray());
const pool=createResourcePool(),lease=pool.retain(scene.group),resourcesBefore=pool.stats();lease.release();assert(Object.values(pool.stats()).every(v=>v===0));
const aborted=new AbortController();aborted.abort();await assert.rejects(createWestLakeGeographic(aborted.signal),{name:'AbortError'});
const during=new AbortController(),pending=createWestLakeGeographic(during.signal);setTimeout(()=>during.abort(),0);await assert.rejects(pending,{name:'AbortError'});
// Force cancellation after actual geometry allocation; observe every partial
// geometry receiving dispose when the module next yields and checks its signal.
const partial=new AbortController(),partialGeometries=new Set(),partialDisposed=new Set(),originalSetAttribute=THREE.BufferGeometry.prototype.setAttribute;
THREE.BufferGeometry.prototype.setAttribute=function(...args){if(!partialGeometries.has(this)){partialGeometries.add(this);this.addEventListener('dispose',()=>partialDisposed.add(this));}partial.abort();return originalSetAttribute.apply(this,args);};
try{await assert.rejects(createWestLakeGeographic(partial.signal),{name:'AbortError'});}finally{THREE.BufferGeometry.prototype.setAttribute=originalSetAttribute;}
assert(partialGeometries.size>0);assert.equal(partialDisposed.size,partialGeometries.size);
const output={ok:true,creationMilliseconds:Number(creationMilliseconds.toFixed(1)),meshCount,triangles,bounds:{min:landBounds.min.toArray(),max:landBounds.max.toArray()},resourcesBefore,resourcesAfter:pool.stats(),projectedCorners,markerInOpenLake:true,sourceLakeRingsExact:true,aborts:{preload:true,inflight:true,afterGeometryAllocation:true,partialGeometriesDisposed:partialDisposed.size},diagnostics:scene.diagnostics};
await fs.mkdir(path.dirname(reportPath),{recursive:true});
await fs.writeFile(reportPath,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({...output,reportPath},null,2));
