import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectCitySources} from './city-sources.mjs';
import {buildCityPlan,inspectCityPlan,repairCityPlan} from '../src/city-build-plan.js';
import {containsCoordinate} from '../src/geographic-bounds.js';

export const ROOT=fileURLToPath(new URL('../',import.meta.url));
const slug=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=80;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(value,message)=>{if(!value)throw new Error(message);};
const now=()=>new Date().toISOString();

async function safePath(root,relative){
  check(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).includes('..'),'Path must remain project-relative');
  const full=path.resolve(root,relative),base=path.resolve(root);
  check(full.startsWith(base+path.sep),'Path must remain inside project');
  let current=base;
  for(const part of path.relative(base,full).split(path.sep)){
    current=path.join(current,part);
    try{check(!(await fs.lstat(current)).isSymbolicLink(),'Symlink paths are not accepted');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return full;
}
async function readJSON(file,limit=32*1024*1024){
  check((await fs.stat(file)).size<=limit,'JSON exceeds workflow size limit');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
async function atomicJSON(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  await fs.rename(tmp,file);
}
async function jobDir(root,id){check(slug(id),'Run ID must be a lowercase slug of at most 80 characters');return safePath(root,`work/city-runs/${id}`);}
async function withLock(dir,task){
  const lock=path.join(dir,'run.lock');let handle;
  try{handle=await fs.open(lock,'wx');}catch(e){
    if(e.code!=='EEXIST')throw e;
    const previous=await readJSON(lock,4096);let dead=false;
    if(previous.host===os.hostname()&&Number.isInteger(previous.pid)){
      try{process.kill(previous.pid,0);}catch(reason){dead=reason.code==='ESRCH';}
    }
    check(dead,'This run is locked by another process; wait for it to finish');
    await fs.unlink(lock);handle=await fs.open(lock,'wx');
  }
  await handle.writeFile(JSON.stringify({pid:process.pid,host:os.hostname(),startedAt:now()}));
  try{return await task();}finally{await handle.close();await fs.unlink(lock);}
}
async function fileDigests(root,directories){
  const result=[];
  async function visit(relative){
    const full=await safePath(root,relative),info=await fs.lstat(full);
    if(info.isDirectory()){for(const name of (await fs.readdir(full)).sort())await visit(path.join(relative,name));}
    else if(info.isFile())result.push([relative,sha(await fs.readFile(full))]);
  }
  for(const relative of directories)await visit(relative);
  return result;
}
async function sourceFingerprint(root){
  // Conservative complete runtime/asset fingerprint: changes invalidate review.
  return sha(JSON.stringify(await fileDigests(root,['src','vendor','assets/city-kit/v1','examples/city-workflow','scripts/city-workflow.mjs','scripts/city-workflow','scripts/city-sources.mjs','regions.css'])));
}
async function collectorFingerprint(root){
  return sha(JSON.stringify(await fileDigests(root,['scripts/city-sources.mjs','src/region-boundaries.js','src/geographic-bounds.js'])));
}
async function recoverAliases(dir,state){
  if(!state.pendingAliases?.length)return;
  for(const name of state.pendingAliases){
    const blob=await safePath(dir,state.blobs[name]),bytes=await fs.readFile(blob);
    check(sha(bytes)===state.artifacts[name],`Immutable artifact corrupt: ${name}`);
    const target=await safePath(dir,name);await fs.mkdir(path.dirname(target),{recursive:true});
    const temporary=`${target}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,target);
  }
  state.pendingAliases=[];await atomicJSON(path.join(dir,'state.json'),state);
}
async function saveState(dir,state,event){
  state.updatedAt=now();state.revision=(state.revision||0)+1;
  if(event)state.events.push({at:state.updatedAt,...event});
  // Commit state references first. Recovery can finish aliases after interruption.
  await atomicJSON(path.join(dir,'state.json'),state);await recoverAliases(dir,state);
}
async function saveArtifact(dir,state,name,value){
  await safePath(dir,name);
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),digest=sha(bytes),blobName=`artifacts/${digest}.json`,blob=await safePath(dir,blobName);
  await fs.mkdir(path.dirname(blob),{recursive:true});
  try{await fs.writeFile(blob,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;check(sha(await fs.readFile(blob))===digest,'Immutable artifact hash mismatch');}
  state.artifacts[name]=digest;state.blobs??={};state.blobs[name]=blobName;state.pendingAliases??=[];
  if(!state.pendingAliases.includes(name))state.pendingAliases.push(name);
  return value;
}
async function readArtifact(dir,state,name){
  check(state.artifacts[name],`No recorded artifact: ${name}`);
  const file=await safePath(dir,name),bytes=await fs.readFile(file);
  check(sha(bytes)===state.artifacts[name],`Artifact changed outside workflow: ${name}. Restore the recorded artifact or create a new run; generated results are immutable.`);
  return JSON.parse(bytes);
}
async function trackSources(dir,state,folder){
  const walk=async base=>{for(const entry of await fs.readdir(base,{withFileTypes:true})){
    const file=path.join(base,entry.name);check(!entry.isSymbolicLink(),'Source snapshot must not contain symlinks');
    if(entry.isDirectory())await walk(file);else state.artifacts[path.relative(dir,file)]=sha(await fs.readFile(file));
  }};await walk(folder);
}
async function verifyArtifacts(dir,state){
  for(const [name,hash] of Object.entries(state.artifacts)){
    const file=await safePath(dir,name);check(sha(await fs.readFile(file))===hash,`Artifact integrity failure: ${name}`);
  }
}

export function validateBrief(brief){
  check(brief?.schema==='city-task-v1','Expected schema city-task-v1');
  check(slug(brief.city?.id)&&typeof brief.city.name==='string'&&brief.city.name.trim(),'City needs id and real name');
  check(Array.isArray(brief.city.coordinates)&&brief.city.coordinates.length===2&&brief.city.coordinates.every(Number.isFinite),'City needs WGS84 coordinates');
  check(brief.boundary?.path&&brief.boundary?.source,'City needs a sourced boundary');
  check(Array.isArray(brief.sources)&&brief.sources.length>0&&brief.sources.length<=16,'Supply 1–16 real source entries');
  check(Array.isArray(brief.landmarks)&&brief.landmarks.length<=80,'Supply a landmarks array');
  check(!brief.display||typeof brief.display==='object'&&!Array.isArray(brief.display),'Display must be an object');
  return brief;
}
export async function initRun({root=ROOT,id,briefPath}){
  root=await fs.realpath(root);
  const file=await safePath(root,briefPath),brief=validateBrief(await readJSON(file,128*1024));
  const dir=await jobDir(root,id);await fs.mkdir(path.dirname(dir),{recursive:true});
  await fs.mkdir(dir); // Deliberately refuses to overwrite a previous run.
  const state={schema:'city-run-v1',id,city:brief.city,status:'created',createdAt:now(),revision:0,attempt:0,
    stages:{collect:'pending',build:'pending',check:'pending',visual:'pending'},artifacts:{},events:[],repairHistory:[]};
  await saveArtifact(dir,state,'brief.json',brief);
  await saveState(dir,state,{type:'created'});return summarize(state);
}
function summarize(state){
  return {id:state.id,city:state.city,status:state.status,revision:state.revision,attempt:state.attempt,stages:state.stages,
    check:state.checkSummary||null,repairs:state.repairHistory.length,error:state.error||null,
    preview:`/examples/city-workflow/?run=${state.id}`,
    next:state.status==='ready_for_delivery'?'Review the preview and deliver files within the authorized scope.':
      state.status==='awaiting_visual_review'?'Run capture, inspect the actual PNG, then submit a hash-bound review; source gaps remain explicit.':
      state.status==='needs_revision'?'Inspect findings; revise display settings or source code, then run again.':
      state.status==='failed'?'Correct the recorded source/tool error, then rerun or create a new brief.':'Run the workflow; use --network only for explicitly selected remote sources.'};
}
export async function statusRun({root=ROOT,id}){
  root=await fs.realpath(root);
  const dir=await jobDir(root,id);return withLock(dir,async()=>{
    const state=await readJSON(path.join(dir,'state.json'));await recoverAliases(dir,state);await verifyArtifacts(dir,state);
    if(state.fingerprint&&state.fingerprint!==await sourceFingerprint(root))return {...summarize(state),status:'needs_rebuild',next:'Runtime, tools or assets changed. Run again before capture/review.',stale:true};
    return summarize(state);
  });
}
async function assertCurrentBuild(root,dir,state){
  check(state.stages.build==='done'&&state.stages.check==='done','Run build and checks after revision before capture/review');
  check(state.fingerprint===await sourceFingerprint(root),'Tools or render assets changed; rebuild before capture/review');
  const plan=await readArtifact(dir,state,'plan.json');
  check(plan.workflow?.briefSha256===state.artifacts['brief.json'],'Plan is stale for the current brief; rebuild');
  return plan;
}
export function checkAndRepairPlan(initial,{maxRepairs=2,signal}={}){
  check(Number.isInteger(maxRepairs)&&maxRepairs>=0&&maxRepairs<=3,'maxRepairs must be 0–3');
  let plan=initial,result=inspectCityPlan(plan);const history=[];
  for(let pass=0;!result.ok&&pass<maxRepairs;pass++){
    signal?.throwIfAborted();const repaired=repairCityPlan(plan,{maxChanges:100});
    history.push({pass:pass+1,changes:repaired.changes,unresolved:repaired.unresolved});
    if(!repaired.changes.length)break;
    plan=repaired.plan;result=inspectCityPlan(plan);
  }
  signal?.throwIfAborted();return {plan,result,history};
}
export async function runWorkflow({root=ROOT,id,allowNetwork=false,maxRepairs=2,rebuild=false,signal}){
  root=await fs.realpath(root);
  check(Number.isInteger(maxRepairs)&&maxRepairs>=0&&maxRepairs<=3,'maxRepairs must be 0–3');
  const dir=await jobDir(root,id);
  return withLock(dir,async()=>{
    const state=await readJSON(path.join(dir,'state.json'));
    try{
      await recoverAliases(dir,state);await verifyArtifacts(dir,state);signal?.throwIfAborted();
      const brief=validateBrief(await readArtifact(dir,state,'brief.json')),fingerprint=await sourceFingerprint(root),collectFingerprint=await collectorFingerprint(root);
      if(state.collectFingerprint&&state.collectFingerprint!==collectFingerprint&&state.stages.collect==='done')throw new Error('Source parser or validation changed. Create a new run from the recorded source snapshots to re-parse; old normalized data cannot be reused.');
      if(state.fingerprint!==fingerprint||rebuild){
        state.stages.build=state.stages.check=state.stages.visual='pending';delete state.visual;state.status='created';
      }
      if(state.stages.check==='done'&&['awaiting_visual_review','ready_for_delivery','needs_revision'].includes(state.status)&&!rebuild)return summarize(state);
      state.fingerprint=fingerprint;state.error=null;state.status='running';state.attempt++;
      const attempt=`attempts/${String(state.attempt).padStart(3,'0')}`;
      await saveState(dir,state,{type:'started',attempt:state.attempt});
      let collected;
      if(state.stages.collect==='done')collected=await readArtifact(dir,state,'collected.json');
      else{
        state.stages.collect='running';await saveState(dir,state,{type:'stage',stage:'collect'});
        const outputDir=path.join(dir,attempt,'sources');
        collected=await collectCitySources(brief,{root,outputDir,signal,allowNetwork});
        await trackSources(dir,state,outputDir);
        await saveArtifact(dir,state,'collected.json',collected);state.stages.collect='done';state.collectFingerprint=collectFingerprint;
        await saveState(dir,state,{type:'stage-done',stage:'collect'});
      }
      signal?.throwIfAborted();state.stages.build='running';await saveState(dir,state,{type:'stage',stage:'build'});
      let plan=buildCityPlan({...collected,display:brief.display||collected.display||{}});
      plan.city=brief.city;plan.provenance=collected.provenance;plan.coverage=brief.coverage||brief.display?.coverageNotice||'仅表示已采集范围；缺少要素不代表空地。';
      plan.workflow={runId:id,attempt:state.attempt,fingerprint,briefSha256:state.artifacts['brief.json']};
      await saveArtifact(dir,state,`${attempt}/initial-plan.json`,plan);state.stages.build='done';state.stages.check='running';
      await saveState(dir,state,{type:'stage',stage:'check'});
      const checked=checkAndRepairPlan(plan,{maxRepairs,signal});plan=checked.plan;const result=checked.result;
      state.repairHistory.push(...checked.history.map(row=>({...row,attempt:state.attempt})));
      signal?.throwIfAborted();
      await saveArtifact(dir,state,'plan.json',plan);await saveArtifact(dir,state,`${attempt}/final-plan.json`,plan);
      await saveArtifact(dir,state,'checks.json',result);await saveArtifact(dir,state,`${attempt}/checks.json`,result);
      state.checkSummary={ok:result.ok,status:result.status,stats:result.stats,issues:result.issues};state.stages.check='done';state.stages.visual='pending';delete state.visual;
      state.status=result.ok?'awaiting_visual_review':'needs_revision';
      signal?.throwIfAborted();await saveState(dir,state,{type:'checked',status:state.status});return summarize(state);
    }catch(e){
      state.status=signal?.aborted?'cancelled':'failed';state.error=e.message;
      for(const stage of ['collect','build','check'])if(state.stages[stage]==='running')state.stages[stage]='failed';
      await saveState(dir,state,{type:'failed',message:e.message});throw e;
    }
  });
}

const displayKeys=new Set(['focus','focusDistanceMeters','maxFeatures','maxBuildings','maxRoads','maxTrees','maxPolygons','maxCoordinates','maxGeometryCoordinates','maxHeightMeters','maxSlenderness','estimatedBuildingHeightMeters','maxBuildingDimensionMeters','treeSpacingMeters']);
export async function reviseRun({root=ROOT,id,patchPath}){
  root=await fs.realpath(root);
  const patch=await readJSON(await safePath(root,patchPath),16384);
  check(patch&&typeof patch==='object'&&!Array.isArray(patch)&&Object.keys(patch).length,'Display patch must be a nonempty object');
  for(const [key,value] of Object.entries(patch)){
    check(displayKeys.has(key),`Cannot revise source geography or unknown display option: ${key}`);
    check(key==='focus'?Array.isArray(value)&&value.length===2&&value.every(Number.isFinite):Number.isFinite(value)&&value>0,'Invalid display value');
  }
  const dir=await jobDir(root,id);return withLock(dir,async()=>{
    const state=await readJSON(path.join(dir,'state.json'));await recoverAliases(dir,state);await verifyArtifacts(dir,state);
    if(patch.focus){
      const collected=await readArtifact(dir,state,'collected.json');
      check(containsCoordinate(collected.boundary,patch.focus),'Display focus must lie inside the city; source geography cannot be relocated');
    }
    if(patch.focusDistanceMeters!==undefined)check(patch.focusDistanceMeters>=100&&patch.focusDistanceMeters<=2000000,'Focus distance must be 100–2000000 meters');
    const brief=await readArtifact(dir,state,'brief.json');await saveArtifact(dir,state,`revisions/${state.revision}-brief.json`,brief);
    brief.display={...brief.display,...patch};await saveArtifact(dir,state,'brief.json',brief);
    state.stages.build=state.stages.check=state.stages.visual='pending';state.status='created';delete state.visual;
    await saveState(dir,state,{type:'display-revision',patch});return summarize(state);
  });
}

export function runtimeCaptureErrors(plan,capture){
  const d=capture.diagnostics,errors=[];
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  if(!d?.ready||!d.renderReady||d.finite!==true||!count(d.drawCalls)||d.drawCalls===0||!count(d.triangles)||d.triangles===0)errors.push('Actual finite geometry/draw calls were not verified');
  for(const [key,kind] of Object.entries({buildings:'building',roads:'road',water:'water',green:'green',trees:'tree',landmarks:'landmark'})){
    const actual=d?.counts?.[key],items=plan[key]||[];
    if(!count(actual)||actual>items.length){errors.push(`Invalid rendered count: ${key}`);continue;}
    const ids=new Set(items.map(item=>item.id));
    const skipped=new Set((d?.skipped||[]).filter(item=>item.kind===kind&&ids.has(item.id)&&typeof item.reason==='string'&&item.reason.trim()).map(item=>item.id));
    if(items.length-actual>skipped.size)errors.push(`Unexplained missing objects: ${key}`);
  }
  if(plan.buildings.length>0&&!(d?.counts?.buildings>0))errors.push('No planned building was rendered');
  if(plan.stats?.sourceBuildings>0&&plan.buildings.length===0)errors.push('Source buildings exist but no ordinary building is represented; this cannot pass city delivery review');
  if(d?.supportViolations!==undefined&&(!count(d.supportViolations)||d.supportViolations>0))errors.push('Runtime ground support violations remain');
  return errors;
}
export async function markCaptureAttempt({root=ROOT,id,planSha256,error=null}){
  root=await fs.realpath(root);const dir=await jobDir(root,id);
  return withLock(dir,async()=>{
    const state=await readJSON(path.join(dir,'state.json'));await recoverAliases(dir,state);await verifyArtifacts(dir,state);
    check(state.artifacts['plan.json']===planSha256,'Capture attempt belongs to an obsolete plan');
    state.stages.visual=error?'failed':'capturing';state.status=error?'needs_revision':'awaiting_visual_review';state.captureValid=false;delete state.visual;
    await saveState(dir,state,{type:error?'capture-failed':'capture-started',message:error});return summarize(state);
  });
}
export async function recordCapture({root=ROOT,id,capture}){
  root=await fs.realpath(root);
  const dir=await jobDir(root,id);return withLock(dir,async()=>{
    const state=await readJSON(path.join(dir,'state.json'));await recoverAliases(dir,state);await verifyArtifacts(dir,state);
    const plan=await assertCurrentBuild(root,dir,state);
    check(capture.schema==='city-capture-v1'&&capture.planSha256===state.artifacts['plan.json'],'Capture is stale or belongs to another plan');
    check(Array.isArray(capture.images)&&capture.images.length>=1,'Capture needs screenshot evidence');
    const runtime=runtimeCaptureErrors(plan,capture);
    if(runtime.length){capture={...capture,ok:false,errors:[...(capture.errors||[]),...runtime]};}
    for(const image of capture.images){
      check(/^captures\/[a-z0-9-]+\.png$/.test(image.path),'Capture image must live in this run captures folder');
      const bytes=await fs.readFile(await safePath(dir,image.path));
      check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>1024,'Capture must be a real PNG');
      check(sha(bytes)===image.sha256,'Screenshot hash mismatch');state.artifacts[image.path]=image.sha256;
    }
    await saveArtifact(dir,state,'capture.json',capture);
    state.stages.visual='captured';state.status='awaiting_visual_review';state.captureValid=true;delete state.visual;
    await saveState(dir,state,{type:'captured'});return summarize(state);
  });
}
export async function reviewRun({root=ROOT,id,reportPath}){
  root=await fs.realpath(root);
  const review=await readJSON(await safePath(root,reportPath),128*1024),dir=await jobDir(root,id);
  return withLock(dir,async()=>{
    const state=await readJSON(path.join(dir,'state.json'));await recoverAliases(dir,state);await verifyArtifacts(dir,state);
    await assertCurrentBuild(root,dir,state);
    check(review.schema==='city-visual-review-v1'&&['pass','revise'].includes(review.verdict),'Invalid visual review');
    check(review.planSha256===state.artifacts['plan.json'],'Visual review is stale or for another plan');
    check(typeof review.summary==='string'&&review.summary.trim()&&Array.isArray(review.findings),'Review requires observations and findings');
    for(const finding of review.findings)check(finding&&typeof finding.code==='string'&&['error','warning','info'].includes(finding.severity)&&typeof finding.message==='string'&&finding.message.trim(),'Findings require code, severity and observation');
    const capture=await readArtifact(dir,state,'capture.json');
    check(capture.planSha256===review.planSha256&&review.captureSha256===state.artifacts['capture.json'],'Review must reference the current capture');
    const checks=await readArtifact(dir,state,'checks.json');
    if(review.verdict==='pass'){
      check(state.captureValid===true,'A new capture is required after the current capture attempt failed or started');
      check(['captured','reviewed','needs_revision'].includes(state.stages.visual),'Current capture attempt has not succeeded');
      const plan=await readArtifact(dir,state,'plan.json');check(!runtimeCaptureErrors(plan,capture).length,'Runtime diagnostics do not establish a rendered plan');
      check(checks.ok,'Cannot pass visual review while geometry checks fail');
      check(capture.ok&&!(capture.errors||[]).length,'Cannot pass while runtime capture failed');
      check(!review.findings.some(f=>f.severity==='error'),'A passing review cannot contain unresolved errors');
    }
    await saveArtifact(dir,state,'visual-review.json',review);state.visual=review;
    state.stages.visual=review.verdict==='pass'?'reviewed':'needs_revision';state.status=review.verdict==='pass'?'ready_for_delivery':'needs_revision';
    await saveState(dir,state,{type:'visual-review',verdict:review.verdict});return summarize(state);
  });
}

function argumentsFor(argv){
  const [command,...rest]=argv,options={};
  for(let i=0;i<rest.length;i++){
    check(rest[i].startsWith('--'),'Use named options');const key=rest[i].slice(2);
    check(!Object.hasOwn(options,key),'Duplicate option');
    if(['network','rebuild'].includes(key))options[key]=true;
    else{check(rest[i+1]!==undefined&&!rest[i+1].startsWith('--'),`Missing --${key} value`);options[key]=rest[++i];}
  }
  return {command,options};
}
export async function main(argv=process.argv.slice(2)){
  const {command,options:o}=argumentsFor(argv),allowed={init:['id','brief'],run:['id','network','max-repairs','rebuild'],status:['id'],revise:['id','patch'],review:['id','report'],capture:['id','url'],help:[]};
  check(allowed[command],`Unknown command: ${command}. Use help.`);for(const key of Object.keys(o))check(allowed[command].includes(key),`Unknown option --${key}`);
  const controller=new AbortController();const cancel=()=>controller.abort(new DOMException('Workflow cancelled','AbortError'));process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try{
    if(command==='help')return {commands:{init:'--id <run> --brief examples/city-workflow/<city>.json',run:'--id <run> [--network] [--max-repairs 0..3] [--rebuild]',status:'--id <run>',revise:'--id <run> --patch <project-relative display.json>',capture:'--id <run> --url http://127.0.0.1:4173/',review:'--id <run> --report <project-relative review.json>'},note:'Codex supplies research and visual judgment. Tools persist sources, build, check and perform bounded display repairs. No embedded LLM or model API billing.'};
    if(command==='init')return await initRun({id:o.id,briefPath:o.brief});
    if(command==='run')return await runWorkflow({id:o.id,allowNetwork:!!o.network,maxRepairs:o['max-repairs']===undefined?2:Number(o['max-repairs']),rebuild:!!o.rebuild,signal:controller.signal});
    if(command==='status')return await statusRun({id:o.id});
    if(command==='revise')return await reviseRun({id:o.id,patchPath:o.patch});
    if(command==='review')return await reviewRun({id:o.id,reportPath:o.report});
    if(command==='capture'){const {captureRun}=await import('./city-workflow/capture.mjs');return await captureRun({id:o.id,url:o.url,signal:controller.signal});}
  }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(JSON.stringify({error:error.message}));process.exitCode=1;});
}
