import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createRegionProjection} from './region-projection.js';
import {createRegionTerrain} from './region-terrain.js';
import {createRegionVectors} from './region-vectors.js';
import * as boundaries from './region-boundaries.js';
import {applyTerrainStyle} from './terrain-style.js';
import {containsCoordinate} from './geographic-bounds.js';
import {layoutCityLabels} from './city-label-layout.js';
import {createAirportModel} from './airport-model.js';

/** An independent, physically clipped region. No continuous map or hidden map engine. */
export async function createGeographicMap({container,geojson,signal,initialView,boundary,boundarySource,airports=[],onCityPick=()=>{},onAttractionPick=()=>{},onStatus=()=>{},onPlacesChange=()=>{},landmarks:initialLandmarks=[]}){
  const lifetime=new AbortController(),activeSignal=lifetime.signal;
  const root=document.createElement('div');root.className='regional-viewer';
  const canvas=document.createElement('canvas');canvas.className='region-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label','独立三维区域，拖动旋转，滚轮缩放');
  const labelsLayer=document.createElement('div');labelsLayer.className='region-labels';
  const credit=document.createElement('div');credit.className='region-credit';
  const detailNote=document.createElement('div');detailNote.className='region-detail-note';
  credit.innerHTML='<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen DEM</a>';
  const dataNote=document.createElement('a');dataNote.href=new URL('../docs/regions.md',import.meta.url).href;dataNote.textContent='数据与边界';dataNote.target='_blank';dataNote.rel='noopener';credit.append(' · ',dataNote);
  root.append(canvas,labelsLayer,credit,detailNote);container.append(root);
  let renderer=null,scene=null,camera=null,controls=null,terrain=null,vectors=null,projection=null,region=null,districts=null;
  let destroyed=false,visible=true,labelsVisible=true,frame=0,tween=null,selection=null,landmarks=initialLandmarks,places=[],markers=[],ticks=0,lastDetail=0,detailDirty=true,ready=false;
  let placesTask=Promise.resolve(),placesSerial=0;
  const airportModels=[];
  const kind=initialView.city?'city':'province',reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const zhejiang=!boundary&&initialView.province?.properties.id==='zhejiang',hangzhou=!boundary&&initialView.city?.id==='hangzhou',illustrated=zhejiang||hangzhou,urbanCenter=[120.17,30.25];
  if(zhejiang)root.classList.add('zhejiang-province');
  let lastFrame=0,hoveredCity=null,pointerDown=null,lastPick=0;
  const picker=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const status=(state,message)=>{if(!destroyed)onStatus({state,message});};
  const abort=()=>destroy();signal?.addEventListener('abort',abort,{once:true});
  const motionChange=()=>{districts?.setReducedMotion(reduceMotion.matches);if(reduceMotion.matches)setRotation(false);};reduceMotion.addEventListener('change',motionChange);
  const stageSize=()=>({width:Math.max(container.clientWidth,1),height:Math.max(container.clientHeight,1)});
  const surfaceHeight=coordinate=>terrain?.sampleSurfaceHeight?.(coordinate)??terrain?.sampleHeight(coordinate)??0;
  const point=coordinate=>projection.project(coordinate,surfaceHeight(coordinate)*terrain.heightScale);
  function clearMarkers(){for(const marker of markers)marker.node.remove();markers=[];}
  function addMarker(item,type){
    if(!containsCoordinate(region,item.coordinates))return;
    const node=document.createElement('button');node.type='button';node.className=`region-marker ${type==='landmark'?'geo-attraction-marker':'region-city-marker'}`;
    if(item.category==='airport')node.classList.add('airport-marker');node.dataset.id=item.id;
    const label=document.createElement('span');label.className='geo-marker-label';label.textContent=item.name;
    const dot=document.createElement('span');dot.className='geo-marker-dot';node.append(label,dot);
    if(zhejiang){const stem=document.createElement('span');stem.className='city-label-stem';node.prepend(stem);node.dataset.cityId=item.id;}node.setAttribute('aria-label',`${type==='landmark'?'查看':'进入'}${item.name}`);
    node.onclick=event=>{event.stopPropagation();if(type==='landmark')onAttractionPick(item);else onCityPick({...item,province:initialView.province?.properties.id||item.province});};
    if(type==='city'){node.addEventListener('pointerenter',()=>hoverCity(item.id));node.addEventListener('pointerleave',()=>hoverCity(null));node.addEventListener('focus',()=>hoverCity(item.id));node.addEventListener('blur',()=>hoverCity(null));}
    labelsLayer.append(node);markers.push({node,item,type,position:point(item.coordinates)});
  }
  function hoverCity(id){
    const item=districts?.cities.find(c=>c.id===id||c.boundaryId===id||c.name===id);districts?.setHovered(item?.id||null);hoveredCity=item||null;
    canvas.style.cursor=item?'pointer':'grab';
    for(const node of document.querySelectorAll('[data-city-hover]'))node.classList.toggle('is-city-hovered',!!item&&node.dataset.cityHover===item.boundaryId);
    if(zhejiang)detailNote.textContent=item?`${item.name} · 点击进入`:'悬停城市分区，展开这一方山水';
    if(camera)updateLabels();
  }
  function pickCity(event){
    if(!districts||!ready||destroyed)return null;
    const box=canvas.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,1-(event.clientY-box.top)/box.height*2);picker.setFromCamera(pointer,camera);
    const hit=picker.intersectObject(terrain.terrainMesh,false)[0];return hit?districts.hitTest(projection.unproject(hit.point.x,hit.point.z)):null;
  }
  canvas.addEventListener('pointerdown',event=>{pointerDown={x:event.clientX,y:event.clientY,moved:false};hoverCity(null);},{signal:activeSignal});
  canvas.addEventListener('pointermove',event=>{if(pointerDown){if(Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)>5)pointerDown.moved=true;return;}if(performance.now()-lastPick<45)return;lastPick=performance.now();hoverCity(pickCity(event)?.id);},{signal:activeSignal});
  canvas.addEventListener('pointerup',event=>{const click=pointerDown&&!pointerDown.moved;pointerDown=null;if(click){const item=pickCity(event);if(item)onCityPick(item);else if(kind==='city'&&ready){const box=canvas.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,1-(event.clientY-box.top)/box.height*2);picker.setFromCamera(pointer,camera);const hit=picker.intersectObjects(airportModels.map(model=>model.group),true)[0];if(hit)onAttractionPick(landmarks.find(place=>place.id===hit.object.userData.airportId));}}},{signal:activeSignal});
  canvas.addEventListener('pointercancel',()=>{pointerDown=null;hoverCity(null);},{signal:activeSignal});
  canvas.addEventListener('pointerleave',()=>{if(!pointerDown)hoverCity(null);},{signal:activeSignal});
  function refreshMarkers(){clearMarkers();for(const item of(kind==='city'?landmarks:places))addMarker(item,kind==='city'?'landmark':'city');detailDirty=true;}
  function updateProvinceLabels(){
    const {width,height}=stageSize(),visible=[];
    for(const marker of markers){
      const position=marker.position.clone();if(marker.item.id===hoveredCity?.id)position.y+=districts.diagnostics.lift;
      const p=position.project(camera),x=(p.x+1)*width/2,y=(1-p.y)*height/2;
      marker.node.setAttribute('aria-pressed',String(marker.item.id===hoveredCity?.id));
      marker.node.hidden=!labelsVisible||p.z<0||p.z>1||x<10||x>width-10||y<45||y>height-58;
      if(marker.node.hidden)continue;
      const label=marker.node.querySelector('.geo-marker-label');
      visible.push({id:marker.item.id,x,y,w:label.offsetWidth||50,h:label.offsetHeight||29,marker,label});
    }
    const positions=layoutCityLabels(visible,{width,height});
    for(const item of visible){
      const {marker,label,x,y}=item,position=positions.get(item.id),dx=position.x-x,dy=position.y-y;
      marker.node.style.left=`${x}px`;marker.node.style.top=`${y}px`;
      label.style.left=`${6+dx}px`;label.style.top=`${6+dy}px`;
      const stem=marker.node.querySelector('.city-label-stem'),endY=dy+(dy<0?item.h/2:-item.h/2);
      stem.style.width=`${Math.hypot(dx,endY)}px`;stem.style.transform=`rotate(${Math.atan2(endY,dx)}rad)`;
    }
  }
  function updateLabels(){
    if(zhejiang)return updateProvinceLabels();
    const {width,height}=stageSize(),placed=[];
    for(const marker of [...markers].sort((a,b)=>((a.item.id===selection||a.item.id===hoveredCity?.id)?-1:0)-((b.item.id===selection||b.item.id===hoveredCity?.id)?-1:0))){
      const position=marker.position.clone();if(marker.type==='city'&&marker.item.id===hoveredCity?.id)position.y+=districts.diagnostics.lift;
      const p=position.project(camera),x=(p.x+1)*width/2,y=(1-p.y)*height/2;
      marker.node.setAttribute('aria-pressed',String(marker.item.id===selection||marker.item.id===hoveredCity?.id));
      const off=!labelsVisible||p.z<0||p.z>1||x<12||x>width-12||y<50||y>height-60;
      marker.node.hidden=off;if(off)continue;
      const w=marker.node.offsetWidth||80,h=marker.node.offsetHeight||40;
      const overlap=placed.some(r=>Math.abs(r.x-x)<(r.w+w)/2+5&&Math.abs(r.y-y)<(r.h+h)/2+4);
      marker.node.hidden=overlap&&marker.item.id!==selection&&marker.item.id!==hoveredCity?.id;
      if(!marker.node.hidden){placed.push({x,y,w,h});marker.node.style.left=`${x}px`;marker.node.style.top=`${y}px`;}
    }
  }
  function cameraTo(target,distance,animate=true){
    const direction=new THREE.Vector3(...(illustrated?[.28,1.2,1]:[.65,.8,1])).normalize(),position=target.clone().addScaledVector(direction,distance);
    if(animate&&!reduceMotion.matches)tween={start:performance.now(),from:camera.position.clone(),fromTarget:controls.target.clone(),to:position,target};
    else{tween=null;camera.position.copy(position);controls.target.copy(target);controls.update();}
    detailDirty=true;
  }
  function fullView(animate=true){
    if(!camera)return;
    const {width,height}=stageSize();cameraTo(new THREE.Vector3(0,0,0),Math.max(65,65/(width/height)),animate);
  }
  function showUrbanView(animate=true){if(!hangzhou)return fullView(animate);selection=null;cameraTo(point(urbanCenter),projection.metersToUnits*12500,animate);}
  function focusAttraction(id){
    if(destroyed||!ready)return;const item=landmarks.find(l=>l.id===id);if(!item)return;
    selection=id;const target=point(item.coordinates),distance=Math.max(.7,projection.metersToUnits*(item.category==='airport'?14000:hangzhou?2700:5500));
    cameraTo(target,distance);updateLabels();
  }
  function fitAllLandmarks(){
    if(destroyed||!landmarks.length)return;if(hangzhou){showUrbanView();return;}selection=null;
    const box=new THREE.Box3().setFromPoints(landmarks.map(l=>point(l.coordinates))),size=box.getSize(new THREE.Vector3());
    cameraTo(box.getCenter(new THREE.Vector3()),Math.max(4,Math.max(size.x,size.z)*2.1));
  }
  function resetView(){if(destroyed)return;selection=null;setRotation(false);fullView();}
  function setLabels(value){labelsVisible=!!value;if(camera)updateLabels();}
  function setRotation(value){if(controls)controls.autoRotate=!!value&&!reduceMotion.matches;}
  function resize(){if(!renderer||destroyed)return;const {width,height}=stageSize();camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);detailDirty=true;}
  function animate(now=0){
    if(destroyed)return;frame=requestAnimationFrame(animate);if(!visible||document.hidden||!renderer)return;
    if(tween){const t=Math.min(1,(now-tween.start)/1000),e=1-(1-t)**3;camera.position.lerpVectors(tween.from,tween.to,e);controls.target.lerpVectors(tween.fromTarget,tween.target,e);if(t===1)tween=null;}
    controls.update();districts?.update(lastFrame?Math.min(.1,(now-lastFrame)/1000):0);lastFrame=now;renderer.render(scene,camera);
    const compass=container.parentElement.querySelector('.compass svg');if(compass)compass.style.transform=`rotate(${-controls.getAzimuthalAngle()*180/Math.PI}deg)`;
    if(ticks++%2===0)updateLabels();
    if(ready&&kind==='city'){
      const info=vectors?.diagnostics||{};
      detailNote.textContent=hangzhou?(info.detailLoading?'正在展开景点周边…':info.detailErrors?'部分景点细节暂未加载':selection?'景点周边 · 真实轮廓简化展示':'主干道路 · 楼群体块示意，非单栋楼高'):info.detailLoading?'正在展开附近街道与楼群…':info.detailErrors?'部分建筑细节暂未加载，可稍后重新靠近。':info.detailTruncated?'当前视野展示部分楼群':camera.position.distanceTo(controls.target)>projection.metersToUnits*15000?'城市全貌 · 选择景点或放大，查看附近楼群':'';
    }
    if(detailDirty&&!tween&&now-lastDetail>350){detailDirty=false;lastDetail=now;const {width,height}=stageSize();vectors?.updateView({camera,target:controls.target,viewportWidth:width,viewportHeight:height});}
  }
  function destroy(){
    if(destroyed)return;destroyed=true;ready=false;visible=false;lifetime.abort();signal?.removeEventListener('abort',abort);
    reduceMotion.removeEventListener('change',motionChange);
    cancelAnimationFrame(frame);tween=null;clearMarkers();places=[];landmarks=[];
    controls?.dispose();districts?.dispose();for(const model of airportModels)model.dispose();airportModels.length=0;airports=[];vectors?.dispose();terrain?.dispose();
    if(renderer){renderer.dispose();renderer.forceContextLoss();renderer=null;}
    scene?.clear();root.remove();onPlacesChange([]);
  }
  try{
    if(signal?.aborted){destroy();activeSignal.throwIfAborted();}
    status('loading','正在读取这个区域的真实边界…');
    region=boundary?boundaries.prepareCustomRegionBoundary(boundary,{kind,city:initialView.city,source:boundarySource,signal:activeSignal}):zhejiang?await boundaries.loadZhejiangDisplayBoundary({signal:activeSignal}):await boundaries.loadRegionBoundary({kind,province:initialView.province||initialView.city?.province,city:initialView.city,geojson,signal:activeSignal});
    if(boundary){const link=document.createElement('a');link.href=region.properties.source.url;link.textContent=`边界：${region.properties.attribution} (${region.properties.license})`;link.target='_blank';link.rel='noopener';credit.append(' · ',link);boundary=null;boundarySource=null;}
    if(!zhejiang&&!region.properties?.customBoundary&&region.properties?.license==='CC-BY-3.0-IGO'){
      credit.append(' · ');const attribution=document.createElement('a');attribution.href='./data/regions/prefectures/README.md';attribution.target='_blank';attribution.rel='noopener';attribution.textContent='geoBoundaries / HDX (2020)';credit.append(attribution);
    }
    activeSignal.throwIfAborted();projection=createRegionProjection(region);airports=airports.filter(a=>containsCoordinate(region,a.coordinates));
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=zhejiang ? .86 : .9;
    scene=new THREE.Scene();scene.background=new THREE.Color('#efede5');
    scene.add(new THREE.HemisphereLight('#fff8e6','#718370',zhejiang ? .68 : .85));
    const sun=new THREE.DirectionalLight('#fff5df',2.5);sun.position.set(-20,40,30);scene.add(sun);
    const fill=new THREE.DirectionalLight('#cbdeda',.25);fill.position.set(15,15,-20);scene.add(fill);
    camera=new THREE.PerspectiveCamera(37,1,.005,500);
    controls=new OrbitControls(camera,canvas);controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.4;controls.maxDistance=130;controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI*.46;controls.autoRotateSpeed=.45;
    controls.addEventListener('start',()=>{tween=null;});controls.addEventListener('change',()=>{detailDirty=true;});
    resize();fullView(false);
    terrain=await createRegionTerrain({region,projection,kind,heightExaggeration:zhejiang?10:undefined,surfaceStyle:illustrated?'illustrated':undefined,signal:activeSignal,onProgress:message=>status('loading',typeof message==='string'?message:message?.message||'正在塑造真实地貌…')});
    activeSignal.throwIfAborted();scene.add(terrain.group);animate();
    vectors=await createRegionVectors({region,projection,kind,buildingExclusions:airports.flatMap(a=>(a.terminals||[]).map(t=>t.rings)),sampleHeight:coordinate=>surfaceHeight(coordinate),heightScale:terrain.heightScale,surfaceStyle:illustrated?'illustrated':undefined,overviewBlocks:hangzhou?{maxBlocks:180,displayHeightMeters:60}:false,focusPoint:hangzhou?urbanCenter:null,landmarks,signal:activeSignal,onProgress:message=>{if(!ready)status('loading',typeof message==='string'?message:message?.message||'正在铺设河流、道路与城市…');},onPlacesChange:items=>{
      if(kind!=='province'||zhejiang)return;
      const serial=++placesSerial;
      placesTask=(async()=>{const available=await boundaries.filterAvailableCityPlaces(items,{province:initialView.province,geojson,signal:activeSignal});if(destroyed||serial!==placesSerial)return;places=available;onPlacesChange(available);refreshMarkers();})();
      placesTask.catch(()=>{});
    }});
    scene.add(vectors.group);await vectors.ready;await placesTask;activeSignal.throwIfAborted();
    if(vectors.diagnostics?.coarseFailed)throw new Error('部分地表数据未能加载，请检查网络后重试。');
    if(vectors.waterMask)terrain.setWaterMask(vectors.waterMask);
    if(vectors.surfaceTexture)terrain.setSurfaceTexture(vectors.surfaceTexture);
    vectors.refreshSurfaceHeights?.();
    if(vectors.surfaceCoverage){await terrain.setSurfaceCutout(vectors.surfaceCoverage);activeSignal.throwIfAborted();}
    if(zhejiang){
      status('loading','正在沿真实市界划分浙江十一城…');
      const {createProvinceDistricts}=await import('./province-districts.js');activeSignal.throwIfAborted();
      districts=await createProvinceDistricts({region,projection,terrain,signal:activeSignal,reducedMotion:reduceMotion.matches});activeSignal.throwIfAborted();scene.add(districts.group);
      districts.group.traverse(mesh=>{if(mesh.isMesh&&mesh.name.endsWith('lifted terrain'))applyTerrainStyle(mesh.material,{metersToUnits:projection.metersToUnits,heightScale:terrain.heightScale,contours:true,vivid:true});});
      places=[...districts.cities];onPlacesChange(places);
      const source=document.createElement('a');source.href='./docs/zhejiang-city-districts.md';source.textContent='市界：geoBoundaries / HDX (2020)';source.target='_blank';source.rel='noopener';credit.append(' · ',source);
      detailNote.textContent='悬停城市分区，展开这一方山水';
    }
    for(const airport of airports){const model=createAirportModel({airport,project:point,metersToUnits:projection.metersToUnits,heightExaggeration:4});airportModels.push(model);scene.add(model.group);}
    if(hangzhou)showUrbanView(false);
    ready=true;refreshMarkers();status('ready','独立区域已展开');detailDirty=true;
    return {get map(){return null;},get region(){return region;},get projection(){return projection;},get camera(){return camera;},get controls(){return controls;},get renderer(){return renderer;},get scene(){return scene;},
      showProvince(){},hoverCity,showUrbanView,showCity(city,items=[]){landmarks=items;refreshMarkers();},focusAttraction,fitAllLandmarks,resetView,setLabels,setRotation,resize,
      show(){visible=true;root.hidden=false;resize();},hide(){visible=false;root.hidden=true;},destroy,get visible(){return visible;},
      get diagnostics(){return{kind,ready,destroyed,activeMarkers:markers.length,regionId:region?.properties.id,airports:airportModels.map(model=>model.diagnostics),districts:districts?.diagnostics,terrain:terrain?.diagnostics,vectors:vectors?.diagnostics,renderer:renderer?{...renderer.info.memory,triangles:renderer.info.render.triangles}:null};}
    };
  }catch(error){destroy();throw error;}
}
