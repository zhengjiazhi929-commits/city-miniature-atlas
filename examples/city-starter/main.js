import {createGeographicMap} from '../../src/regional-viewer.js';
import {validateCityStarterConfig,resolveCityDataUrl} from '../../src/city-starter-config.js';

const appRoot=new URL('../../',import.meta.url),$=id=>document.getElementById(id);
let controller=null,viewer=null,config=null,labels=true;
window.__cityStarter={get viewer(){return viewer;},get config(){return config;},get ready(){return !!viewer?.diagnostics.ready;}};

async function readJson(url,signal,limit){
  const response=await fetch(url,{signal,cache:'no-cache'});
  if(!response.ok)throw new Error(`数据读取失败（HTTP ${response.status}）：${url.pathname}`);
  if(Number(response.headers.get('content-length'))>limit)throw new Error('配置或边界文件超出大小限制');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('配置或边界文件超出大小限制');}parts.push(value);}}finally{reader.releaseLock();}
  signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return {value:JSON.parse(new TextDecoder().decode(bytes)),bytes};
}

function selectPlace(place){
  viewer?.focusAttraction(place.id);const card=$('place-detail');card.hidden=false;
  card.querySelector('h3').textContent=place.name;card.querySelector('p').textContent=place.description;
  card.querySelector('a').href=place.sourceUrl;
}
function release(){controller?.abort();viewer?.destroy();viewer=null;}
async function start(){
  release();controller=new AbortController();const active=controller.signal;
  $('retry').hidden=true;$('status').hidden=false;$('status').classList.remove('error');$('status').textContent='读取配置…';
  $('full-view').disabled=$('labels').disabled=true;$('places').replaceChildren();$('place-detail').hidden=true;
  try{
    const id=new URL(location.href).searchParams.get('city')||'wuhan-example';
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new Error('城市配置名只能使用小写字母、数字与连接号');
    const path=`./data/cities/${id}.json`;
    const {value}=await readJson(resolveCityDataUrl(path,appRoot),active,128*1024);validateCityStarterConfig(value);
    if(value.id!==id)throw new Error('配置文件名与城市 ID 不一致');
    const {value:boundary,bytes}=await readJson(resolveCityDataUrl(value.boundary.path,appRoot),active,2*1024*1024);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==value.boundary.sha256)throw new Error('边界校验值不匹配；请核实数据变更并重新生成配置');
    validateCityStarterConfig(value,boundary);active.throwIfAborted();config=value;
    $('city-name').textContent=config.name;document.title=`${config.name} · 城市接入示例`;$('config-path').textContent=`配置：${path}`;
    $('boundary-source').href=config.boundary.source.url;$('boundary-source').textContent=`${config.boundary.source.attribution} · ${config.boundary.source.license} ↗`;
    const result=await createGeographicMap({container:$('viewer'),initialView:{city:config},boundary,boundarySource:config.boundary.source,
      signal:active,landmarks:config.landmarks,onAttractionPick:selectPlace,
      onStatus:info=>{if(active.aborted)return;$('status').textContent=info.message;$('status').hidden=info.state==='ready';}});
    if(active.aborted){result.destroy();return;}viewer=result;
    viewer.setLabels(labels);$('labels').setAttribute('aria-pressed',String(labels));
    for(const place of config.landmarks){const button=document.createElement('button');button.className='place';button.textContent=place.name;button.onclick=()=>selectPlace(place);$('places').append(button);}
    if(!config.landmarks.length){const empty=document.createElement('p');empty.textContent='尚未添加景点位置。先核实坐标和来源，再填入配置。';$('places').append(empty);}
    $('full-view').disabled=$('labels').disabled=false;
  }catch(error){
    if(active.aborted)return;viewer?.destroy();viewer=null;$('status').hidden=false;$('status').classList.add('error');
    $('status').textContent=`无法展开：${error.message}`;$('retry').hidden=false;console.error(error);
  }
}
$('full-view').onclick=()=>viewer?.resetView();
$('labels').onclick=()=>{labels=!labels;viewer?.setLabels(labels);$('labels').setAttribute('aria-pressed',String(labels));};
$('retry').onclick=start;
window.addEventListener('resize',()=>viewer?.resize());
window.addEventListener('pagehide',release);
// pagehide releases GPU/network resources even when this document enters
// BFCache. A persisted restore must rebuild the viewer rather than show a
// formerly enabled control panel above an already-disposed canvas.
window.addEventListener('pageshow',event=>{if(event.persisted)start();});
start();
