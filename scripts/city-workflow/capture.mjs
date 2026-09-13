import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {ROOT,statusRun,recordCapture,runtimeCaptureErrors,markCaptureAttempt} from '../city-workflow.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function captureRun({root=ROOT,id,url='http://127.0.0.1:4173/',signal}={}){
  root=await fs.realpath(root);
  const state=await statusRun({root,id});
  if(state.stale||state.stages.build!=='done'||state.stages.check!=='done')throw new Error('Build the current brief before capturing it');
  const base=new URL(url);
  if(!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.search||base.hash)throw new Error('Capture URL must be your local preview server base URL');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  const dir=path.join(root,'work/city-runs',id),planBytes=await fs.readFile(path.join(dir,'plan.json')),plan=JSON.parse(planBytes);
  const planSha256=hash(planBytes);
  await markCaptureAttempt({root,id,planSha256});
  try{
  const remote=await fetch(new URL(`work/city-runs/${id}/plan.json`,base),{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
  if(!remote.ok||Number(remote.headers.get('content-length'))>32*1024*1024)throw new Error('Preview server is not serving the current plan');
  if(hash(Buffer.from(await remote.arrayBuffer()))!==planSha256)throw new Error('Preview server belongs to another checkout or plan version');
  let chromium;
  try{({chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright'));}
  catch{throw new Error('Capture needs optional Playwright: install it in your development environment, or set PLAYWRIGHT_MODULE to its module path. The city website itself needs neither Playwright nor a model API.');}
  const options={headless:true};
  if(process.env.CHROME_PATH)options.executablePath=process.env.CHROME_PATH;
  if(process.platform==='darwin')options.args=['--use-angle=metal','--enable-gpu'];
  const browser=await chromium.launch(options),errors=[],failedRequests=[],images=[];
  const cancel=()=>{browser.close().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  const captures=path.join(dir,'captures');
  try{if((await fs.lstat(captures)).isSymbolicLink())throw new Error('Capture folder must not be a symlink');}catch(e){if(e.code!=='ENOENT'){await browser.close();throw e;}}
  await fs.mkdir(captures,{recursive:true});
  let diagnostics=null;
  try{
    signal?.throwIfAborted();const page=await browser.newPage({viewport:{width:1600,height:1000}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')failedRequests.push({url:request.url(),error:request.failure()?.errorText});});
    await page.goto(new URL(`examples/city-workflow/?run=${id}`,base).href,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>window.__cityWorkflow?.ready||window.__cityWorkflow?.error,null,{timeout:180000});
    const error=await page.evaluate(()=>window.__cityWorkflow?.error);if(error)throw new Error(String(error));
    const same=await page.evaluate(p=>JSON.stringify(window.__cityWorkflow.plan)===JSON.stringify(p),plan);if(!same)throw new Error('Browser did not render the requested plan');
    const save=async pose=>{
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const relative=`captures/${Date.now()}-${pose}.png`,file=path.join(dir,relative);
      await page.screenshot({path:file});images.push({pose,path:relative,sha256:hash(await fs.readFile(file))});
    };
    await save('default');
    diagnostics=await page.evaluate(()=>window.__cityWorkflow.viewer.diagnostics);
    await page.locator('#full-view').click();
    await page.waitForTimeout(1200);await save('full');
    if(plan.landmarks?.length){
      await page.locator('#places button').first().click();
      await page.waitForTimeout(1200);await save('landmark');
    }
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
    const released=await page.evaluate(()=>!document.querySelector('canvas'));
    if(!released)errors.push('Viewer canvas not released on pagehide');
  }catch(error){errors.push(error.message);}
  finally{signal?.removeEventListener('abort',cancel);await browser.close();}
  signal?.throwIfAborted();
  if(!images.length)throw new Error(errors.join('; ')||'No rendered screenshot was captured');
  errors.push(...runtimeCaptureErrors(plan,{diagnostics}));
  const capture={schema:'city-capture-v1',capturedAt:new Date().toISOString(),planSha256,viewport:{width:1600,height:1000},
    ok:!errors.length&&!failedRequests.length,images,errors,failedRequests,diagnostics,
    scope:'Actual Chrome rendering and lifecycle sample; image appearance still requires Codex or human review.'};
  const result=await recordCapture({root,id,capture});return {...result,capture};
  }catch(error){
    try{await markCaptureAttempt({root,id,planSha256,error:error.message});}catch{}
    throw error;
  }
}
