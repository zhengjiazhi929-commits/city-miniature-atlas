// Run against the local preview after changing source data or display options.
// Only builds the current city's derived fabric; no externally supplied asset
// is trusted without matching source/input and compressed-payload hashes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const executablePath=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
const browser=await chromium.launch({headless:true,executablePath,args:process.platform==='darwin'?['--use-angle=metal','--enable-gpu']:[]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 await page.route('**/fabric-cache-manifest.json',route=>route.fulfill({status:200,contentType:'application/json',body:'{"version":0}'}));
 await page.goto(`${process.env.ATLAS_URL||'http://127.0.0.1:4173/'}#/city/hangzhou`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__atlas?.geographic?.diagnostics.ready||document.body.innerText.includes('区域沙盘暂时无法展开'),null,{timeout:300000});
 const exported=await page.evaluate(async()=>{
  const v=window.__atlas?.geographic;if(!v?.diagnostics.ready)throw Error(document.body.innerText);
  v.hide();const group=v.scene.getObjectByName('Hangzhou source-based 3D roads, trees and urban groups');group.updateMatrixWorld(true);
  const key=v.diagnostics.fabricCacheKey;
  const payload=JSON.stringify({version:1,key,group:group.toJSON(),diagnostics:v.diagnostics.fabric});
  const compressed=new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary='';for(let i=0;i<compressed.length;i+=32768)binary+=String.fromCharCode(...compressed.subarray(i,i+32768));
  return {key,base64:btoa(binary)};
 });
 const bytes=Buffer.from(exported.base64,'base64'),dir=path.join(root,'data/hangzhou-atlas');
 await fs.writeFile(path.join(dir,'fabric-cache.json.gz'),bytes);
 await fs.writeFile(path.join(dir,'fabric-cache-manifest.json'),JSON.stringify({version:1,key:exported.key,file:'fabric-cache.json.gz',sha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n');
 console.log(`Saved derived Hangzhou fabric: ${(bytes.length/1048576).toFixed(1)} MiB compressed.`);
}finally{await browser.close();}
