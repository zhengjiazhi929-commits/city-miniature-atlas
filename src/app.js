import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {cities,attractions,cityById,citiesInProvince} from './catalog.js';
import {createChinaMap,project} from './map.js';
import {createResourcePool} from './scene-resources.js';
import {loadCityAirports} from './city-airports.js';
import {isHangzhouOverviewPlace} from './hangzhou-overview-policy.js';

const $=s=>document.querySelector(s);
const icons={back:'<svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>',share:'<svg viewBox="0 0 24 24"><path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8"/></svg>',camera:'<svg viewBox="0 0 24 24"><path d="M3 7h5l2-3h4l2 3h5v13H3z"/><circle cx="12" cy="13" r="4"/></svg>'};
const state={province:null,city:null,attraction:null,labels:true,rotating:false,collectionPage:0,geoCity:null,focusedAttraction:null};
let reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const sceneCache=new Map();
const resourcePool=createResourcePool(),viewLeases=[];
let geographic=null,hkAnchors=[],geoPlaces=[],navigationController=null,baseLease=null,exportsInProgress=0;
let airportCoverage={status:'unverified',airports:[]};
const usingGeography=()=>!state.attraction&&!!state.province;const labelNodes=[];const hotspotNodes=[];
let map,renderer,camera,controls,world,content,keyLight,ground,currentScene,geojson,transition=null,toastTimer,loadToken=0,frameCount=0,cityOverview=null,labelsTouched=false;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const stage=$('.stage');let canvas=$('#scene');
const escapeHtml=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cityName=id=>cityById(id)?.name||'';
const matchesCity=(city,place)=>city.name.replace(/市$/,'')===place.name.replace(/市$/,'')||Math.hypot(city.coordinates[0]-place.coordinates[0],city.coordinates[1]-place.coordinates[1])<.045;
const provinceData=id=>geojson.features.find(f=>f.properties.id===id)?.properties;
const collectionPageSize=()=>matchMedia('(max-width:720px)').matches?2:4;
const collectionIds=()=>{const list=cityById(state.city)?.attractions||[];return list.slice(state.collectionPage*collectionPageSize(),(state.collectionPage+1)*collectionPageSize());};
const mode=()=>state.attraction?'scene':state.city?'city':state.province?'province':'national';

function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
const encodePlace=place=>`${place.coordinates.join(',')}|${encodeURIComponent(place.name)}|${encodeURIComponent(place.boundaryId||'')}|${encodeURIComponent(place.nameEn||'')}`;
function decodePlace(value){const [pair,name,boundaryId,nameEn]=value.split('|');try{const coordinates=pair.split(',').map(Number);if(coordinates.length!==2||!coordinates.every(Number.isFinite)||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>85)return null;return{coordinates,name:decodeURIComponent(name||'城市'),boundaryId:decodeURIComponent(boundaryId||''),nameEn:decodeURIComponent(nameEn||'')};}catch{return null;}}
function cityLandmarks(cityId=state.city){return [...(cityById(cityId)?.attractions||[]).map(id=>({...attractions[id],...(cityId==='hong-kong'?(hkAnchors.find(a=>a.id===id)||{}):{})})),...airportCoverage.airports.filter(a=>a.city===cityId&&!a.external)];}
function scenicAreaSection(){
  if(state.city!=='hangzhou')return '';
  return `<section class="index-section scenic-area-section"><h2 class="index-heading">景区总览 <span>独立沙盘</span></h2>${row('西湖','展开完整湖面与近岸景点','scene','westlake')}</section>`;
}
function airportSection(){
  const items=airportCoverage.airports;
  return `<section class="index-section airport-section"><h2 class="index-heading">机场 <span>城市交通</span></h2>${items.length?items.map(a=>a.external?`<p class="airport-external"><strong>${escapeHtml(a.name)}</strong><br>市外服务机场 · 距城市定位点约 ${Math.round(a.distanceKm)} km（直线距离）</p>`:`<button class="place-row geo-landmark-row airport-row" data-action="locate-attraction" data-id="${escapeHtml(a.id)}"><span class="place-title"><span><small aria-hidden="true">✈</small>${escapeHtml(a.name)}</span><span class="arrow">${icons.back}</span></span><span class="place-subtitle">${escapeHtml(a.subtitle)} · 点击定位</span></button>`).join(''):'<p class="empty-note">机场资料待核实</p>'}</section>`;
}
function renderGeoPlaces(){
  const container=$('#geo-city-list');if(!container)return;
  const known=citiesInProvince(state.province),list=geoPlaces.filter(p=>!known.some(c=>matchesCity(c,p))).slice(0,40);
  $('#geo-city-count').textContent=list.length?`${list.length} 处`:'';
  container.innerHTML=list.length?list.map(p=>row(p.name,'打开独立城市沙盘','map-city',encodePlace(p))).join(''):`<p class="empty-note">${known.length?'暂无更多可匹配的城市边界，可从上方进入已有景点的城市。':'这个区域暂未收录可匹配的城市边界。'}</p>`;
}
async function ensureGeographicMap(signal,initialView){
    const {createGeographicMap}=await import(initialView.city?.id==='hangzhou'?'./hangzhou-sandtable.js':'./regional-viewer.js');
    signal.throwIfAborted();
    if(initialView.city?.id==='hong-kong'&&!hkAnchors.length){
      const response=await fetch('./data/hong-kong-landmarks.json',{signal});
      if(!response.ok)throw new Error('景点定位资料加载失败');
      const anchors=await response.json();hkAnchors=Array.isArray(anchors)?anchors:anchors.landmarks||[];
    }
    signal.throwIfAborted();
    if(initialView.city){const coverage=await loadCityAirports(initialView.city,{signal});signal.throwIfAborted();airportCoverage=coverage;renderPanel();}
    const viewer=await createGeographicMap({airports:airportCoverage.airports.filter(a=>!a.external),landmarks:initialView.city?.id?cityLandmarks(initialView.city.id):[],container:$('#geographic-map'),geojson,signal,initialView,
      onCityPick:place=>{const known=citiesInProvince(state.province).find(c=>matchesCity(c,place));if(known)navigate('city',known.id);else navigate('map-city',place);},
      onAttractionPick:place=>focusGeoAttraction(typeof place==='string'?place:place.id),
      onPlacesChange:places=>{if(signal.aborted)return;geoPlaces=places;renderGeoPlaces();},
      onStatus:status=>{if(signal.aborted||!usingGeography())return;const info=typeof status==='string'?{state:'loading',message:status}:status;$('#geo-status').hidden=info.state==='ready';$('#geo-status').textContent=info.message||'正在读取地形与城市数据…';$('#geo-status').classList.toggle('is-error',info.state==='error');if(info.state==='error'){const retry=document.createElement('button');retry.className='geo-retry';retry.textContent='重新加载地图';retry.onclick=()=>location.reload();$('#geo-status').append(retry);}}
    });
    if(signal.aborted){viewer.destroy();signal.throwIfAborted();}
    geographic=viewer;if(initialView.city?.id==='hangzhou')renderPanel();return viewer;
}

function releaseView(){
  navigationController?.abort();navigationController=null;
  geographic?.destroy();geographic=null;geoPlaces=[];airportCoverage={status:'unverified',airports:[]};
  transition=null;currentScene=null;cityOverview=null;map=null;
  content?.clear();sceneCache.clear();
  for(const lease of viewLeases)lease.release();viewLeases.length=0;
  renderer?.renderLists.dispose();
  $('#map-labels').replaceChildren();labelNodes.length=0;
  $('#hotspots').replaceChildren();hotspotNodes.length=0;
}

function disposeThreeRuntime(){
  if(!renderer)return;
  controls.dispose();baseLease?.release();baseLease=null;
  const oldRenderer=renderer;renderer=null;
  oldRenderer.dispose();oldRenderer.forceContextLoss();
  world.clear();world=null;camera=null;controls=null;content=null;keyLight=null;ground=null;
  // A fresh canvas gets a fresh context on the next Three view. The old
  // drawing buffer and context are deliberately lost when entering geography.
  const replacement=canvas.cloneNode(false);replacement.width=1;replacement.height=1;
  canvas.replaceWith(replacement);canvas=replacement;
}

async function loadScene(id,signal,token){
  const result=await attractions[id].create(signal);
  const lease=resourcePool.retain(result.group);
  if(signal.aborted||token!==loadToken){lease.release();signal.throwIfAborted();throw new DOMException('View replaced','AbortError');}
  result.group.name=attractions[id].name;
  viewLeases.push(lease);sceneCache.set(id,result);return result;
}
function placeGeoCard(){const card=$('#geo-attraction-card'),parent=matchMedia('(max-width:720px)').matches?$('.travel-index'):stage;if(card.parentElement!==parent)parent.prepend(card);}
function focusGeoAttraction(id){
  if(state.city==='hangzhou'&&!attractions[id]?.overviewOnly&&typeof attractions[id]?.create==='function'&&usingGeography()){navigate('scene',id);return;}
  const location=cityLandmarks().find(a=>a.id===id)||geographic?.getPlace?.(id);const a=location?{...location,overviewOnly:attractions[id]?.overviewOnly??location.overviewOnly}:null;if(!a||!usingGeography())return;
  state.focusedAttraction=id;geographic?.focusAttraction(id);
  for(const row of document.querySelectorAll('.geo-landmark-row'))row.classList.toggle('selected',row.dataset.id===id);
  $('#geo-attraction-card').innerHTML=`<button class="geo-card-close" aria-label="关闭地图景点介绍"><svg class="inline-icon" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button><span class="geo-card-kicker">${escapeHtml(cityName(a.city))} · ${a.category==='airport'?'机场位置':a.category==='architecture'?'城市地标':'景点位置'}</span><h2>${escapeHtml(a.name)}</h2><p>${escapeHtml(a.category==='architecture'?(a.descriptionZh||'保留建筑的标志轮廓与真实位置，按沙盘观看尺度简化细部。'):a.category==='airport'?a.subtitle:a.anchor||a.subtitle)}</p>${a.category==='airport'?'<span class="geo-card-note">机场轮廓与跑道按来源位置建模，建筑高度为概括表达。</span><a class="airport-source-link" href="./data/airports/NOTICE.md" target="_blank" rel="noopener">机场资料来源 ↗</a>':a.category==='architecture'?'<span class="geo-card-note">建筑模型适度放大，位置以真实地理资料为准。</span><a class="airport-source-link" href="./data/hangzhou-atlas/signature-buildings-NOTICE.md" target="_blank" rel="noopener">建筑参考资料 ↗</a>':a.overviewOnly?'<span class="geo-card-note">代表模型已在沙盘上展开</span>':`<button class="primary-button" data-action="scene" data-id="${id}">打开微缩景观 <svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>`}`;
  placeGeoCard();$('#geo-attraction-card').hidden=false;if(matchMedia('(max-width:720px)').matches)$('.travel-index').scrollTop=0;$('.geo-card-close').onclick=()=>{state.focusedAttraction=null;geographic?.clearSelection?.();$('#geo-attraction-card').hidden=true;document.querySelectorAll('.geo-landmark-row.selected').forEach(row=>row.classList.remove('selected'));};
}
function row(title,subtitle,action,id,selected=false){const boundary=action==='city'?id:action==='map-city'?decodePlace(id)?.boundaryId:'';return `<button ${boundary?`data-city-hover="${escapeHtml(boundary)}"`:''} class="place-row${selected?' selected':''}" data-action="${action}" data-id="${id}"><span class="place-title">${escapeHtml(title)}<span class="arrow" aria-hidden="true"><svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></span><span class="place-subtitle">${escapeHtml(subtitle)}</span></button>`;}
function back(label,action,id=''){return `<button class="back-button" data-action="${action}" data-id="${id}">${icons.back}${label}</button>`;}
function featuredCities(){return [...cities].sort((a,b)=>(a.id==='hangzhou'?-1:0)-(b.id==='hangzhou'?-1:0)).map(c=>row(c.name,`${c.province===c.id?'热门十景':provinceData(c.province).name} · ${c.attractions.length} 处微缩景观`,'city',c.id)).join('');}
function renderPanel(){
  let html='';
  if(!state.province){
    html=`<h1 class="panel-title">山河万里，<br>入掌成景。</h1><p class="panel-intro">从一张地图出发，<br>走近中国的山水与楼阁。</p><section class="index-section"><h2 class="index-heading">从浙江启程 <span>湖山与城</span></h2>${row('浙江 · 十一城','从省域地形，走近杭州与雷峰塔','province','zhejiang')}</section><div class="search-wrap"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="province-search" type="search" placeholder="寻找省份 / 城市 / 景点" aria-label="寻找省份、城市或景点" autocomplete="off"></div><div id="search-results"></div><div id="province-list" class="province-grid">${geojson.features.map(f=>`<button class="province-option ${citiesInProvince(f.properties.id).length?'available':''}" data-action="province" data-id="${f.properties.id}">${f.properties.name}</button>`).join('')}</div><p class="legend"><i></i>已有可探索的微缩景观</p>`;
  }else if(state.geoCity){
    const c=state.geoCity;
    html=`${back(`${provinceData(state.province).name} · 选择城市`,'province',state.province)}<h1 class="panel-title small">${escapeHtml(c.name)}</h1><p class="panel-intro">一座城市，独立展开。<br>旋转沙盘，看山川、街道与楼群。</p><div class="geo-facts"><span>真实地形</span><span>道路与建筑轮廓</span></div>${airportSection()}<p class="empty-note">这座城市尚未收录独立景点模型。可以旋转、放大沙盘，查看已有地貌与建筑数据。</p><p class="hint-block">建筑轮廓来自公开地理数据，高度可能采用估算值。<br><a href="./docs/geographic-data.md" target="_blank" rel="noopener">查看数据说明</a></p>`;
  }else if(!state.city){
    const p=provinceData(state.province),list=citiesInProvince(state.province);
    html=`${back('全国地图','home')}<h1 class="panel-title small">${p.name}</h1><p class="panel-intro">把这一方山水，<br>单独放在眼前。</p><div class="geo-facts"><span>独立省份沙盘</span><span>高差放大 ${state.province==='zhejiang'?10:8} 倍</span></div>${list.length?`<section class="index-section"><h2 class="index-heading">已有景点的城市</h2>${list.map(c=>row(c.name,`${c.subtitle} · ${c.attractions.length} 处景观`,'city',c.id)).join('')}</section>`:''}<section class="index-section"><h2 class="index-heading">沙盘中的城市 <span id="geo-city-count"></span></h2><div id="geo-city-list"><p class="empty-note">正在读取城市位置…</p></div></section><p class="hint-block">围绕沙盘旋转，从标记或列表选择城市。<br>地形保留真实高低关系；平原地区的起伏较小。</p>`;
  }else if(!state.attraction){
    const city=cityById(state.city),p=provinceData(city.province);
    html=`${back(`${p.name} · 选择城市`,'province',city.province)}<h1 class="panel-title small">${city.name}</h1><p class="panel-intro">${city.id==='hangzhou'?'先从主城的湖岸与街区出发，<br>拉远，去看杭州的群山与千岛。':'一座城市，一方山水。<br>沿真实地貌，寻找熟悉的风景。'}</p><div class="geo-facts"><span>独立城市沙盘</span><span>${city.id==='hangzhou'?'11处景点 · 1座机场':'真实地貌与道路'}</span></div>${scenicAreaSection()}${airportSection()}<section class="index-section"><h2 class="index-heading">沙盘中的景点 <span>选择地点</span></h2>${city.attractions.filter(id=>attractions[id].category!=='scenic-area').map((id,i)=>{const a=attractions[id];return `<button class="place-row geo-landmark-row" data-action="locate-attraction" data-id="${id}"><span class="place-title"><span><small>${String(i+1).padStart(2,'0')}</small>${a.name}</span><span class="arrow">${icons.back}</span></span><span class="place-subtitle">${a.subtitle}</span></button>`;}).join('')}</section><p class="hint-block">${city.id==='hangzhou'?'拖动旋转，滚轮拉远可看全市；景点可进入独立模型；商业建筑、奥体中心和机场在总览中定位。':'拖动沙盘旋转，滚轮缩放；点击景点，查看或进入对应微缩景观。'}<br>${city.id==='hangzhou'?'地理骨架来自实测资料；树楼与地标按观看尺度概括，山地高差适度放大。':'建筑位置来自公开数据，高度可能采用估算值。'}<br><a href="./docs/regions.md" target="_blank" rel="noopener">区域与数据说明</a></p>`;
  }else{
    const a=attractions[state.attraction],city=cityById(a.city);
    html=`${back(`${city.name} · 城市沙盘`,'city',city.id)}${['leifeng','santan'].includes(a.id)?back('西湖 · 景区总览','scene','westlake'):''}<h1 class="panel-title small">${a.id==='zshc'?'萧山国际机场':a.name}</h1><p class="scenic-description">${a.description}</p><p class="location-line">${a.coordinates[1].toFixed(3)}° N &nbsp; ${a.coordinates[0].toFixed(3)}° E</p><div class="scene-actions"><button id="save-image">${icons.camera}保存图片</button><button id="share-scene">${icons.share}分享景点</button></div><button id="export-model" class="export-button">下载 3D 模型 · GLB</button>${city.attractions.length>1?`<section class="attraction-switcher"><h2 class="index-heading">也在${city.name}</h2>${city.attractions.filter(id=>id!==a.id&&!attractions[id].overviewOnly).map(id=>row(attractions[id].name,attractions[id].subtitle,'scene',id)).join('')}</section>`:''}<div class="hint-block">${a.geographic?(a.geographicNote||'真实地形、水岸与道路；塔体按已知尺寸简化。约一公里取景范围，不代表景区边界。'):'微缩景观根据公开资料创作，保留标志性特征，周边布局与比例经过艺术化压缩。'}<br>${a.geographic?`<span>${escapeHtml(a.attribution||'© OpenStreetMap contributors · Mapzen DEM')}</span><br>`:''}<a href="${a.source}" target="_blank" rel="noopener">查看参考资料 <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></a></div>`;
  }
  $('#panel-content').innerHTML=html;
  $('.travel-index').scrollTop=0;
  $('#province-search')?.addEventListener('input',e=>searchPlaces(e.target.value));
  $('#save-image')?.addEventListener('click',saveImage);
  $('#share-scene')?.addEventListener('click',shareScene);
  $('#export-model')?.addEventListener('click',exportModel);
  const viewButton=$('#geo-view-switch [data-action="geo-overview"]');if(viewButton)viewButton.textContent=state.city==='hangzhou'?'主城视角':'景点分布';
  const fullButton=$('#geo-view-switch [data-action="geo-harbour"]');if(fullButton)fullButton.textContent=state.city==='hangzhou'?'杭州全览':'区域全貌';
  renderBreadcrumb();
  const zoom=matchMedia('(max-width:720px)').matches?'双指缩放':'滚轮缩放';
  $('#scene-caption').textContent=`拖动旋转 · ${zoom} · ${state.attraction?'标注可在右侧开关':'点击地点探索'}`;
  $('#scene-note').textContent=state.attraction?(attractions[state.attraction].presentation==='standalone-subject'?'独立主体模型 · 拖动旋转查看':attractions[state.attraction].geographic?(state.attraction==='westlake'?'来源湖岸与岛屿 · 景点细部概括':'来源地理 · 建筑与植被概括'):'艺术化微缩景观 · 非实测复原'):state.city?'城市微缩景观集':'旅行主题示意地图';
  if(usingGeography()){$('#scene-caption').textContent=state.province==='zhejiang'&&!state.city&&!state.geoCity?'悬停分区 · 点击进入城市 · 拖动旋转':'拖动旋转 · 滚轮缩放 · 点击地点进入';$('#scene-note').textContent=state.city==='hangzhou'?'真实地理骨架 · 景点与体量艺术化表达':state.city||state.geoCity?'独立城市沙盘 · 楼高含估算':`独立省份沙盘 · 地形高差 ${state.province==='zhejiang'?10:8}×`;}
  document.title=state.attraction?`${attractions[state.attraction].name} · 山河入掌`:'山河入掌 · 3D 中国景点地图';
}
function renderBreadcrumb(){
  const crumbs=[{name:'中国',action:'home',id:''}];
  if(state.province&&state.province!==state.city)crumbs.push({name:provinceData(state.province).name,action:'province',id:state.province});
  if(state.geoCity)crumbs.push({name:escapeHtml(state.geoCity.name),action:'map-city',id:encodePlace(state.geoCity)});
  if(state.city)crumbs.push({name:cityName(state.city),action:'city',id:state.city});
  if(state.attraction)crumbs.push({name:attractions[state.attraction].name,action:'scene',id:state.attraction});
  $('#breadcrumb').innerHTML=crumbs.map((c,i)=>`${i?'<span aria-hidden="true">/</span>':''}<button data-action="${c.action}" data-id="${c.id}" ${i===crumbs.length-1?'class="crumb-current" aria-current="page"':''}>${c.name}</button>`).join('');
}
function searchPlaces(query){
  const q=query.trim().toLowerCase();
  const provinceButtons=[...document.querySelectorAll('.province-option')];
  for(const b of provinceButtons){const p=provinceData(b.dataset.id);b.hidden=!!q&&!`${p.name} ${p.nameEn} ${p.id}`.toLowerCase().includes(q);}
  const matches=[];
  if(q){
    for(const c of cities)if(`${c.name} ${c.id}`.includes(q))matches.push(row(c.name,`${provinceData(c.province).name} · 城市`,'city',c.id));
    for(const a of Object.values(attractions).filter(a=>a.city!=='hangzhou'||isHangzhouOverviewPlace(a)))if(`${a.name} ${a.en}`.toLowerCase().includes(q))matches.push(row(a.name,`${cityName(a.city)} · 景点`,'scene',a.id));
  }
  const anyProvince=provinceButtons.some(b=>!b.hidden);
  $('#search-results').innerHTML=matches.join('')+(!anyProvince&&!matches.length?'<p class="empty-note">暂未找到这个地点。试试“杭州”或“黄鹤楼”。</p>':'');
}
function stateHash(){if(state.geoCity)return`#/place/${state.province}/${state.geoCity.coordinates.join(',')}/${encodeURIComponent(state.geoCity.name)}/${encodeURIComponent(state.geoCity.boundaryId||'')}/${encodeURIComponent(state.geoCity.nameEn||'')}`;return state.attraction?`#/scene/${state.attraction}`:state.city?`#/city/${state.city}`:state.province?`#/province/${state.province}`:'#/';}
function cityCollectionCamera(count){
  if(count===1)return{position:[12,13,16],target:[0,0,0]};
  if(count===2)return{position:[0,24,27],target:[0,0,0]};
  const columns=Math.min(3,Math.ceil(Math.sqrt(count))),rows=Math.ceil(count/columns);
  const distance=Math.max(columns*12/Math.max(camera.aspect,.8),rows*12)*1.25+8;
  return{position:[0,distance,distance*1.12],target:[0,0,0]};
}
async function navigate(action,id='',push=true){
  if(action==='scene'&&attractions[id]?.overviewOnly){await navigate('city',attractions[id].city,push);if(!push)history.replaceState(null,'',stateHash());focusGeoAttraction(id);return;}
  if(action==='locate-attraction'){focusGeoAttraction(id);return;}
  if(action==='geo-overview'){state.focusedAttraction=null;geographic?.clearSelection?.();geographic?.fitAllLandmarks();$('#geo-attraction-card').hidden=true;return;}
  if(action==='geo-harbour'){state.focusedAttraction=null;geographic?.clearSelection?.();(geographic?.showFullView||geographic?.resetView)?.();$('#geo-attraction-card').hidden=true;return;}
  if(window.__atlas)window.__atlas.ready=false;
  const previousCity=state.city;
  if(['home','province','city','scene'].includes(action))state.geoCity=null;
  if(['home','province'].includes(action))state.focusedAttraction=null;
  if(action==='home'){state.province=null;state.city=null;state.attraction=null;}
  if(action==='province'&&provinceData(id)){state.province=id;state.city=null;state.attraction=null;}
  if(action==='city'&&cityById(id)){state.province=cityById(id).province;state.city=id;state.attraction=null;}
  if(action==='scene'&&attractions[id]){state.attraction=id;state.city=attractions[id].city;state.province=cityById(state.city).province;}
  if(action==='map-city'){const place=typeof id==='string'?decodePlace(id):id;if(!place||!place.coordinates?.every(Number.isFinite))return;state.province=place.province||state.province;state.city=null;state.attraction=null;state.geoCity={...place,province:state.province};}
  if(state.city!==previousCity){state.collectionPage=0;state.focusedAttraction=null;}
  if(state.attraction)state.collectionPage=Math.floor(cityById(state.city).attractions.indexOf(state.attraction)/collectionPageSize());
  if(action==='collection-page'){const max=Math.ceil(cityById(state.city).attractions.length/collectionPageSize())-1;state.collectionPage=Math.max(0,Math.min(max,state.collectionPage+Number(id)));}
  const token=++loadToken;
  releaseView();navigationController=new AbortController();
  const signal=navigationController.signal,geographicMode=usingGeography();
  if(geographicMode)disposeThreeRuntime();else createThreeRuntime();
  if(!labelsTouched)state.labels=!state.attraction||stage.clientWidth>600;
  $('#labels-toggle').setAttribute('aria-pressed',String(state.labels));
  $('#map-labels').style.visibility=state.labels?'visible':'hidden';
  if(push&&location.hash!==stateHash())history.pushState(null,'',stateHash());
  $('#scene-detail').hidden=true;$('#geo-attraction-card').hidden=true;
  renderPanel();
  renderCollectionNav();
  if(controls)controls.autoRotate=false;state.rotating=false;$('#rotate-view').setAttribute('aria-pressed','false');
  canvas.hidden=geographicMode;$('#geographic-map').hidden=!geographicMode;stage.classList.toggle('geographic-mode',geographicMode);
  $('#geo-view-switch').hidden=!(geographicMode&&state.city);
  if(!geographicMode)$('#geo-status').hidden=true;
  $('#map-labels').hidden=!!state.attraction;
  if(geographicMode){
    $('#map-labels').hidden=true;$('#hotspots').hidden=true;$('#loading').hidden=false;
    try{
      const initialView=state.city?{city:cityById(state.city)}:state.geoCity?{city:state.geoCity}:{province:geojson.features.find(f=>f.properties.id===state.province)};
      const viewer=await ensureGeographicMap(signal,initialView);if(token!==loadToken)return;viewer.show();viewer.resize();viewer.setLabels(state.labels);
      if(state.city){await viewer.showCity(cityById(state.city),cityLandmarks());if(token!==loadToken)return;if(state.focusedAttraction)focusGeoAttraction(state.focusedAttraction);}
      else if(state.geoCity)await viewer.showCity(state.geoCity,[]);
      else await viewer.showProvince(geojson.features.find(f=>f.properties.id===state.province));
      if(token!==loadToken)return;$('#stage-error').hidden=true;
    }catch(error){if(token===loadToken){releaseView();showError(`区域沙盘暂时无法展开：${error.message}`);}return;}
    finally{if(token===loadToken)$('#loading').hidden=true;}
  }else if(state.attraction){
    const id=state.attraction;$('#loading').hidden=false;
    try{
      const result=await loadScene(id,signal,token);
      if(token!==loadToken)return;
      currentScene=result;content.add(result.group);
      $('#stage-error').hidden=true;
      keyLight.position.set(-14,24,18);keyLight.shadow.camera.left=-24;keyLight.shadow.camera.right=24;keyLight.shadow.camera.top=24;keyLight.shadow.camera.bottom=-24;keyLight.shadow.camera.updateProjectionMatrix();
      ground.position.y=currentScene.viewer?.groundY??-1.4;
      controls.minDistance=currentScene.viewer?.minDistance??8;controls.maxDistance=currentScene.viewer?.maxDistance??65;controls.maxPolarAngle=Math.PI*.47;
      applyCamera(currentScene.camera,false);
      createHotspots();
    }catch(error){if(token!==loadToken)return;showError(`景观暂时无法加载：${error.message}`);return;}
    finally{if(token===loadToken)$('#loading').hidden=true;}
  }else if(state.city){
    const city=cityById(state.city);$('#loading').hidden=false;
    try{
      const scenes=[];
      for(const id of collectionIds())scenes.push({id,result:await loadScene(id,signal,token)});
      if(token!==loadToken)return;
      cityOverview=new THREE.Group();cityOverview.name=city.name+' miniature collection';content.add(cityOverview);
      keyLight.position.set(-14,24,18);keyLight.shadow.camera.left=-24;keyLight.shadow.camera.right=24;keyLight.shadow.camera.top=24;keyLight.shadow.camera.bottom=-24;keyLight.shadow.camera.updateProjectionMatrix();
      $('#map-labels').replaceChildren();labelNodes.length=0;
      const columns=Math.min(3,Math.ceil(Math.sqrt(scenes.length))),rows=Math.ceil(scenes.length/columns);
      scenes.forEach(({id,result},index)=>{
        const group=result.group;const x=(index%columns-(columns-1)/2)*12,z=(Math.floor(index/columns)-(rows-1)/2)*12;
        group.scale.setScalar(.53);group.position.set(x,0,z);group.traverse(obj=>obj.userData.attraction=id);cityOverview.add(group);
        makeMapLabel(attractions[id].name,'展开景观',new THREE.Vector3(x,0,z-5),()=>navigate('scene',id),true);
        labelNodes[labelNodes.length-1].position.y=1;
      });
      ground.position.y=-.7;controls.minDistance=8;controls.maxDistance=65;controls.maxPolarAngle=Math.PI*.47;
      applyCamera(cityCollectionCamera(scenes.length),false);
      $('#stage-error').hidden=true;
    }catch(error){if(token===loadToken){releaseView();showError(`城市景观加载失败：${error.message}`);}return;}
    finally{if(token===loadToken)$('#loading').hidden=true;}
  }else{
    $('#loading').hidden=true;$('#stage-error').hidden=true;
    map=createChinaMap(geojson);viewLeases.push(resourcePool.retain(map.group));content.add(map.group);
    map.select(state.province);ground.position.y=-.16;
    keyLight.position.set(-20,40,25);keyLight.shadow.camera.left=-40;keyLight.shadow.camera.right=40;keyLight.shadow.camera.top=40;keyLight.shadow.camera.bottom=-40;keyLight.shadow.camera.updateProjectionMatrix();
    controls.minDistance=8;controls.maxDistance=115;controls.maxPolarAngle=Math.PI*.44;
    applyCamera(mapCamera(),true);createMapLabels();
  }
  $('#hotspots').hidden=geographicMode||!state.labels;
  if(token!==loadToken)return;
  window.__atlas.ready=true;
}
function renderCollectionNav(){
  const city=cityById(state.city),pages=city?Math.ceil(city.attractions.length/collectionPageSize()):0;
  $('#collection-nav').hidden=usingGeography()||!!state.attraction||pages<2;
  $('#collection-nav').innerHTML=pages>1?`<button data-action="collection-page" data-id="-1" aria-label="上一组景观" ${state.collectionPage===0?'disabled':''}>${icons.back}</button><span aria-live="polite">${state.collectionPage+1} / ${pages} 组</span><button data-action="collection-page" data-id="1" aria-label="下一组景观" ${state.collectionPage===pages-1?'disabled':''}>${icons.back}</button>`:'';
}
function mapCamera(){
  if(state.province){
    const {box}=map.byId.get(state.province);const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const distance=Math.max(size.x/Math.max(camera.aspect,.8),size.z)*1.25+2;
    return {position:[center.x,Math.max(8,distance),center.z+Math.max(7,distance*.67)],target:[center.x,0,center.z]};
  }
  const distance=camera.aspect<1?70:56;
  return{position:[0,distance,distance*.72],target:[0,0,-1]};
}
function applyCamera(config,animate=true){
  if(!config)config={position:[24,22,28],target:[0,2,0]};
  const target=new THREE.Vector3(...config.target),position=new THREE.Vector3(...config.position);
  if(currentScene?.viewer?.fitSubject){
    // Fit the actual object in both axes; a tall pagoda cannot use a plan-only fit.
    const direction=position.clone().sub(target).normalize();
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),margin=.84;let distance=0;
    const point=new THREE.Vector3();currentScene.group.updateMatrixWorld(true);
    currentScene.group.traverse(object=>{
      if(!object.isMesh||!object.visible)return;const vertices=object.geometry.attributes.position;
      for(let i=0;i<vertices.count;i++){
        point.fromBufferAttribute(vertices,i).applyMatrix4(object.matrixWorld).sub(target);const depth=point.dot(direction);
        distance=Math.max(distance,depth+Math.abs(point.dot(right))/(tangent*camera.aspect*margin),depth+Math.abs(point.dot(up))/(tangent*margin));
      }
    });
    position.copy(target).addScaledVector(direction,distance);
  }
  // Portrait stage is shallow and wide on phones, so scenes can keep the authored camera.
  if(state.attraction==='santan')position.sub(target).multiplyScalar(1.08).add(target);
  if(camera.aspect<1){position.sub(target).multiplyScalar(1.2).add(target);}
  if(animate&&!reducedMotion){transition={start:performance.now(),from:camera.position.clone(),fromTarget:controls.target.clone(),to:position,toTarget:target};}
  else{transition=null;camera.position.copy(position);controls.target.copy(target);controls.update();}
}
function createMapLabels(){
  $('#map-labels').replaceChildren();labelNodes.length=0;
  if(state.province){
    for(const city of citiesInProvince(state.province))makeMapLabel(city.name,'点击选景点',project(city.coordinates),()=>navigate('city',city.id),true);
  }else{
    for(const city of cities)makeMapLabel(provinceData(city.province).name,city.id===city.province?'十处景观':city.name,project(provinceData(city.province).center),()=>navigate('province',city.province),true);
    const selected=['xinjiang','tibet','inner-mongolia','heilongjiang','sichuan','yunnan','guangdong','shandong','taiwan','hainan','qinghai','gansu','fujian'];
    for(const id of selected){const p=provinceData(id);if(p)makeMapLabel(p.name,'',project(p.center),null,false);}
  }
}
function makeMapLabel(name,sub,position,onclick,primary){
  const button=document.createElement(onclick?'button':'span');button.className=`map-label${primary?'':' province-label'}`;
  button.innerHTML=`${name}${sub?`<span>${sub}</span>`:''}`;
  position.y=primary?2:.7;
  if(onclick)button.addEventListener('click',onclick);
  $('#map-labels').append(button);labelNodes.push({node:button,position});
}
function createHotspots(){
  for(const h of currentScene.hotspots||[]){
    const b=document.createElement('button');b.className='hotspot';b.textContent=h.label;
    b.addEventListener('click',()=>{
      $('#scene-detail').innerHTML=`<button aria-label="关闭景点说明"><svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button><h3>${escapeHtml(h.label)}</h3><p>${escapeHtml(h.description)}</p>${h.sceneId&&attractions[h.sceneId]&&!attractions[h.sceneId].overviewOnly?`<button class="primary-button" data-action="scene" data-id="${h.sceneId}">进入${escapeHtml(attractions[h.sceneId].name)}景观</button>`:''}`;
      $('#scene-detail').hidden=false;$('#scene-detail button').onclick=()=>$('#scene-detail').hidden=true;
    });
    $('#hotspots').append(b);hotspotNodes.push({node:b,position:new THREE.Vector3(...h.position)});
  }
}
const projected=new THREE.Vector3();
function updateLabels(list){
  const w=stage.clientWidth,h=stage.clientHeight,placed=[];
  for(const {node,position}of list){
    projected.copy(position).project(camera);
    const x=(projected.x+1)*w/2;let y=(-projected.y+1)*h/2;
    node.hidden=projected.z>1||projected.z<0||x<12||x>w-12||y<12||y>h-30;
    if(node.hidden)continue;
    const nw=node.offsetWidth,nh=node.offsetHeight,originalY=y;
    const overlaps=()=>placed.some(r=>Math.abs(x-r.x)<(nw+r.w)/2+6&&Math.abs(y-r.y)<(nh+r.h)/2+7);
    if(node.classList.contains('province-label')&&overlaps()){node.hidden=true;continue;}
    let attempts=0;while(overlaps()&&attempts++<3)y-=nh+10;
    node.style.setProperty('--stem',`${24+originalY-y}px`);
    placed.push({x,y,w:nw,h:nh});
    node.style.left=`${x}px`;node.style.top=`${y}px`;
  }
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function saveImage(){
  if(!currentScene)return;
  renderer.render(world,camera);
  const out=document.createElement('canvas');out.width=1600;out.height=1100;const ctx=out.getContext('2d');
  ctx.fillStyle='#efede5';ctx.fillRect(0,0,out.width,out.height);
  const aspect=canvas.width/canvas.height,w=1520,h=940,drawW=Math.min(w,h*aspect),drawH=drawW/aspect;
  ctx.drawImage(canvas,(1600-drawW)/2,40+(h-drawH)/2,drawW,drawH);
  const a=attractions[state.attraction];
  ctx.fillStyle='#233d35';ctx.font='36px "Noto Serif SC","Songti SC",serif';ctx.fillText(`${cityName(a.city)} · ${a.name}`,58,1030);
  ctx.font='16px sans-serif';ctx.fillStyle='#62695d';ctx.fillText('山河入掌 · CHINA IN MINIATURE',58,1068);
  ctx.textAlign='right';ctx.fillText(a.attribution||(a.geographic?'© OpenStreetMap contributors · Mapzen DEM · 景观概括':'艺术化微缩景观'),1540,1068);
  out.toBlob(blob=>{if(blob){download(blob,`山河入掌-${a.name}.png`);toast('已保存当前视角');}else toast('图片保存失败，请重试');},'image/png');
}
async function shareScene(){
  const url=location.href;
  try{await navigator.clipboard.writeText(url);toast(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'已复制本地预览链接；上线后可对外分享':'已复制景点链接');}
  catch{const field=document.createElement('textarea');field.value=url;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();const ok=document.execCommand('copy');field.remove();toast(ok?'已复制景点链接':'复制失败，请复制浏览器地址栏中的链接');}
}
async function exportModel(){
  if(!currentScene)return;
  if(exportsInProgress){toast('已有模型正在打包，请等它完成后再导出');return;}
  const model=currentScene.group.clone(true),lease=resourcePool.retain(model),sceneId=state.attraction,button=$('#export-model');
  exportsInProgress++;model.visible=true;button.disabled=true;button.textContent='正在打包模型…';
  try{
    const{GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
    const exporter=new GLTFExporter();
    const result=await exporter.parseAsync(model,{binary:true,onlyVisible:true});
    download(new Blob([result],{type:'model/gltf-binary'}),`${sceneId}.glb`);toast('已下载可编辑的景点模型');
  }catch(error){console.error(error);toast('模型导出失败，请稍后重试');}
  finally{lease.release();model.clear();exportsInProgress--;if(button.isConnected){button.disabled=false;button.textContent='下载 3D 模型 · GLB';}}
}
function showError(message){$('#loading').hidden=true;$('#error-copy').textContent=message;$('#stage-error').hidden=false;}
function readRoute(){
  const parts=location.hash.replace(/^#\/?/,'').split('/');
  if(parts[0]==='place'&&provinceData(parts[1])){const coordinates=parts[2]?.split(',').map(Number);if(coordinates?.length===2&&coordinates.every(Number.isFinite)&&Math.abs(coordinates[0])<=180&&Math.abs(coordinates[1])<=85){let name,boundaryId='',nameEn='';try{name=decodeURIComponent(parts[3]||'城市');boundaryId=decodeURIComponent(parts[4]||'');nameEn=decodeURIComponent(parts[5]||'');}catch{name='城市';}return navigate('map-city',{province:parts[1],coordinates,name,boundaryId,nameEn},false);}}
  const [action,id]=location.hash.replace(/^#\/?/,'').split('/');
  if(action==='scene'&&attractions[id])return navigate('scene',id,false);
  if(action==='city'&&cityById(id))return navigate('city',id,false);
  if(action==='province'&&provinceData(id))return navigate('province',id,false);
  if(action)toast('没有找到这个地点，已返回全国地图');
  return navigate('home','',false);
}
function createThreeRuntime(){
  if(renderer)return;
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.setSize(stage.clientWidth,stage.clientHeight,false);
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
    world=new THREE.Scene();world.background=new THREE.Color('#efede5');world.fog=new THREE.Fog('#efede5',100,190);
    camera=new THREE.PerspectiveCamera(37,stage.clientWidth/stage.clientHeight,.1,400);camera.position.set(0,56,40);
    controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=true;controls.autoRotateSpeed=.6;controls.minPolarAngle=.18;
    controls.addEventListener('start',()=>{transition=null;});
    world.add(new THREE.HemisphereLight('#fff9e8','#869276',2.25));
    keyLight=new THREE.DirectionalLight('#fff4d6',3.4);keyLight.castShadow=true;keyLight.shadow.mapSize.set(2048,2048);keyLight.shadow.normalBias=.035;keyLight.shadow.bias=-.00008;keyLight.shadow.camera.near=.5;keyLight.shadow.camera.far=150;keyLight.shadow.radius=3;world.add(keyLight);
    const fill=new THREE.DirectionalLight('#d6e6e6',.8);fill.position.set(18,12,-25);world.add(fill);
    ground=new THREE.Mesh(new THREE.PlaneGeometry(800,800),new THREE.ShadowMaterial({color:'#334b34',opacity:.13}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;world.add(ground);
    content=new THREE.Group();world.add(content);
    baseLease=resourcePool.retain(world);
    let pointerStart=null;
    canvas.addEventListener('pointerdown',e=>pointerStart=[e.clientX,e.clientY]);
    function mapHit(e){const r=canvas.getBoundingClientRect();pointer.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(pointer,camera);if(cityOverview)return raycaster.intersectObjects(cityOverview.children,true)[0]?.object.userData.attraction;return raycaster.intersectObjects((map?.meshes||[]).filter(m=>m.parent.visible),false)[0]?.object.userData.province;}
    canvas.addEventListener('pointerup',e=>{if(!state.attraction&&pointerStart&&Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])<5){const hit=mapHit(e);if(hit){if(cityOverview)navigate('scene',hit);else if(state.province===hit&&citiesInProvince(hit).length===1)navigate('city',citiesInProvince(hit)[0].id);else navigate('province',hit);}}pointerStart=null;});
    canvas.addEventListener('pointermove',e=>{if(state.attraction||e.buttons)return;const hit=mapHit(e);if(!cityOverview)map?.highlight(hit||state.province);canvas.style.cursor=hit?'pointer':'grab';});
    canvas.addEventListener('pointerleave',()=>{if(map)map.highlight(state.province);});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(e.target===canvas&&renderer)showError('图形环境已暂停。请重新加载页面恢复。');});
}
async function init(){
  try{
    const response=await fetch('./data/china-provinces.geojson');if(!response.ok)throw new Error('地图数据未能加载');geojson=await response.json();
    document.addEventListener('pointerover',event=>{const row=event.target.closest('[data-city-hover]');if(row&&state.province==='zhejiang'&&!state.city)geographic?.hoverCity?.(row.dataset.cityHover);});
    document.addEventListener('pointerout',event=>{const row=event.target.closest('[data-city-hover]');if(row&&!row.contains(event.relatedTarget))geographic?.hoverCity?.(null);});
    document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button)navigate(button.dataset.action,button.dataset.id);});
    $('#home').onclick=()=>navigate('home');$('#retry').onclick=()=>location.reload();
    for(const id of ['about-open','sources-open'])$('#'+id).onclick=()=>$('#about-dialog').showModal();
    $('#about-dialog').addEventListener('click',event=>{if(event.target===$('#about-dialog')){const b=event.target.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)event.target.close();}});
    $('#reset-view').onclick=()=>{if(usingGeography()){geographic?.setRotation(false);state.rotating=false;$('#rotate-view').setAttribute('aria-pressed','false');geographic?.resetView();return;}controls.autoRotate=false;state.rotating=false;$('#rotate-view').setAttribute('aria-pressed','false');const city=cityById(state.city);applyCamera(currentScene?currentScene.camera:city?cityCollectionCamera(collectionIds().length):mapCamera(),true);};
    $('#rotate-view').onclick=()=>{transition=null;state.rotating=!matchMedia('(prefers-reduced-motion: reduce)').matches&&!state.rotating;if(controls)controls.autoRotate=state.rotating;$('#rotate-view').setAttribute('aria-pressed',String(state.rotating));if(usingGeography()){if(controls)controls.autoRotate=false;geographic?.setRotation(state.rotating);}};
    $('#labels-toggle').onclick=()=>{labelsTouched=true;state.labels=!state.labels;$('#labels-toggle').setAttribute('aria-pressed',String(state.labels));$('#map-labels').style.visibility=state.labels?'visible':'hidden';$('#hotspots').hidden=!state.labels;if(usingGeography())geographic?.setLabels(state.labels);};
    window.addEventListener('popstate',readRoute);
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{reducedMotion=event.matches;if(event.matches){state.rotating=false;if(controls)controls.autoRotate=false;geographic?.setRotation(false);$('#rotate-view').setAttribute('aria-pressed','false');}});
    new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;if(w&&h){if(renderer){camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}geographic?.resize();}}).observe(stage);
    matchMedia('(max-width:720px)').addEventListener('change',()=>{placeGeoCard();if(state.city&&!state.attraction&&!usingGeography()){state.collectionPage=0;navigate('city',state.city,false);}});
    window.__atlas={state,navigate,sceneCache,ready:false,
      get renderer(){return renderer;},get scene(){return world;},get camera(){return camera;},
      get controls(){return controls;},get map(){return map;},get geographic(){return geographic;},
      get resources(){return {policy:'current-view-only',activeRegion:stateHash(),activeSceneIds:[...sceneCache.keys()],threeActive:!!renderer,geographicActive:!!geographic,exportsInProgress,owned:resourcePool.stats(),threeMemory:renderer?{...renderer.info.memory}:null};}
    };
    animate();await readRoute();
  }catch(error){console.error(error);showError(`请使用支持 WebGL 2 的浏览器，并通过本地服务打开页面。${error.message}`);}
}
function animate(now=0){
  requestAnimationFrame(animate);
  if(document.hidden||usingGeography()||!renderer)return;
  if(transition){
    const t=Math.min(1,(performance.now()-transition.start)/1000),e=1-Math.pow(1-t,4);
    camera.position.lerpVectors(transition.from,transition.to,e);controls.target.lerpVectors(transition.fromTarget,transition.toTarget,e);if(t===1)transition=null;
  }
  controls.update();if(currentScene&&!reducedMotion)currentScene.update?.(now/1000);
  renderer.render(world,camera);
  if(frameCount++%2===0){if(!state.attraction)updateLabels(labelNodes);else updateLabels(hotspotNodes);}
  const azimuth=controls.getAzimuthalAngle();$('.compass svg').style.transform=`rotate(${-azimuth*180/Math.PI}deg)`;
}
init();
