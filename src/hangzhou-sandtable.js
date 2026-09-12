import {createCityReflectionEnvironment} from './city-reflection-environment.js';
import {loadCityAssets} from './city-assets.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {createRegionProjection} from './region-projection.js';
import {createHangzhouDisplayProjection} from './hangzhou-display-projection.js';
import {createHangzhouSurfaceSampler,orientHangzhouSurface} from './hangzhou-surface.js';
import {createHangzhouFabric} from './hangzhou-fabric.js';
import {computeFabricCacheKey,loadCachedFabric} from './hangzhou-fabric-cache.js';
import {createHangzhouLandmark} from './hangzhou-landmarks.js';
import {createAirportModel} from './airport-model.js';
import {createHangzhouShoreline} from './hangzhou-shoreline.js';
import {createHangzhouGroundCover} from './hangzhou-ground-cover.js';
import {createUrbanGroundPlanting} from './city-ground-planting.js';
import {createSignatureLayer} from './hangzhou-signature-layer.js';
import {createTourismDisplay} from './hangzhou-tourism-display.js';
import {createTourismLayout} from './hangzhou-tourism-layout.js';
import {createHangzhouCutFace} from './hangzhou-cut-face.js';
import {westLakePlace} from './westlake-place.js';
import {hubinPlace} from './hubin-place.js';
import {createHubinOverview} from './hubin-overview.js';
import {isHangzhouOverviewPlace,hangzhouUrbanView} from './hangzhou-overview-policy.js';
import {hangzhouBuildingScale} from './hangzhou-building-scale.js';

const UNIFIED_URBAN_BOUNDS=[119.78,30.06,120.66,30.58];
// Keep developed ground darker than the silver building walls. Specific land
// uses remain subtly distinct; natural areas keep their own sourced palette.
const URBAN_GROUND_PALETTE={forest:'#355e48',urban:'#55534c',urbanClasses:{residential:'#5d5b54',commercial:'#514f4a',industrial:'#59574f',retail:'#5a584f',institutional:'#626056',school:'#626056',university:'#626056',college:'#626056',hospital:'#626056'},coverClasses:{forest:'#355e48',park:'#5d864b',grass:'#6d9355',farmland:'#83955d',scrub:'#496c43',wetland:'#507d75'}};
const URBAN_GAP_GREEN='#557e43';
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const rectangle=(x0,z0,x1,z1)=>[[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]];
const bounds=rings=>{const p=rings.flat();return[Math.min(...p.map(p=>p[0])),Math.min(...p.map(p=>p[1])),Math.max(...p.map(p=>p[0])),Math.max(...p.map(p=>p[1]))];};
const inRing=(p,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
const inPolygon=(p,rings)=>inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r));

/** The municipality is data geometry. Landmark size and vertical relief are display choices. */
export async function createGeographicMap({container,signal,airports=[],onStatus=()=>{},onAttractionPick=()=>{}}){
  const lifetime=new AbortController(),active=lifetime.signal;
  let cityAssets=null,data=null,classifications=null,urbanClusters=null,signatureData=null,signatures=null,tourismLayout=null,renderer=null,scene=null,camera=null,controls=null,fabric=null,shoreline=null,groundCover=null,groundPlanting=null,surface=null,worldSurface=null,frame=0,ready=false,destroyed=false,visible=true,labelsVisible=true,selection=null,tween=null;
  let hoveredArchitecture=null,hoverPoint=null,hoverDirty=false,updateHover=()=>{},updateShadowView=()=>{};
  const root=document.createElement('div');root.className='regional-viewer hangzhou-atlas';
  const canvas=document.createElement('canvas');canvas.className='region-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label','杭州全域三维旅游沙盘，拖动旋转，滚轮适度缩放，点击景点');
  const lines=document.createElementNS('http://www.w3.org/2000/svg','svg');lines.classList.add('hangzhou-leaders');
  const labelsLayer=document.createElement('div');labelsLayer.className='region-labels';
  const heading=document.createElement('div');heading.className='hangzhou-map-heading';heading.innerHTML='<span>HANGZHOU · A LANDSCAPE ATLAS</span><strong>杭州</strong><p>从湖岸街区，走向群山。</p>';
  const credit=document.createElement('div');credit.className='region-credit';credit.innerHTML='<a href="./data/hangzhou-atlas/NOTICE.md" target="_blank" rel="noopener">地理与模型来源</a> · © OpenStreetMap · Mapzen DEM';
  root.append(canvas,lines,labelsLayer,heading,credit);container.append(root);
  // A moving label must not trap the wheel halfway through a zoom gesture.
  // Keep label clicks native and route only their wheel input to OrbitControls.
  labelsLayer.addEventListener('wheel',event=>{
    event.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel',{
      deltaX:event.deltaX,deltaY:event.deltaY,deltaZ:event.deltaZ,deltaMode:event.deltaMode,
      clientX:event.clientX,clientY:event.clientY,ctrlKey:event.ctrlKey,
      shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey,cancelable:true,
    }));
  },{passive:false,signal:active});
  let reflectionEnvironment=null;
  let allLandmarks=[],urbanTarget=null,zoomFocus=null,zoomGesture=false;
  const fullTarget=new THREE.Vector3(.8,.5,0);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)'),markers=[],models=[],airportModels=[],geometries=new Set(),materials=new Set();
  const loadStarted=performance.now();
  const diag={loadStages:[],kind:'city',regionId:'hangzhou',style:'tourism-relief',heightScale:8,horizontalDeformation:false,waterPolygons:0,terrainTriangles:0,landmarkCount:0,ready:false,destroyed:false};
  const status=message=>{diag.loadStages.push({message,ms:performance.now()-loadStarted});if(!destroyed)onStatus({state:'loading',message});};
  const assert=()=>{active.throwIfAborted();signal?.throwIfAborted();};
  const material=options=>{const m=new THREE.MeshStandardMaterial({roughness:.86,...options});materials.add(m);return m;};
  const mesh=(positions,indices,mat,name,colors)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(indices)g.setIndex(indices);if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();geometries.add(g);const m=new THREE.Mesh(g,mat);m.name=name;m.receiveShadow=true;scene.add(m);return m;};
  function disposeTree(group){group?.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of[o.material].flat().filter(Boolean))materials.add(m);if(o.isInstancedMesh)o.dispose();if(o.shadow)o.shadow.dispose();});}
  function destroy(){
    if(destroyed)return;destroyed=true;ready=false;visible=false;diag.destroyed=true;diag.ready=false;lifetime.abort();signal?.removeEventListener('abort',destroy);reduce.removeEventListener('change',motionChanged);cancelAnimationFrame(frame);controls?.dispose();
    tourismLayout?.dispose();tourismLayout=null;signatures?.dispose();signatures=null;signatureData=null;groundPlanting?.dispose();groundPlanting=null;fabric?.dispose();fabric=null;cityAssets?.dispose();cityAssets=null;shoreline?.dispose();shoreline=null;groundCover?.dispose();groundCover=null;classifications=null;for(const model of airportModels)model.dispose();airportModels.length=0;airports=[];surface?.dispose();worldSurface?.dispose();worldSurface=null;surface=null;disposeTree(scene);for(const g of geometries)g.dispose();for(const m of materials){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}geometries.clear();materials.clear();
    if(scene)scene.environment=null;reflectionEnvironment?.dispose();reflectionEnvironment=null;
    renderer?.dispose();renderer?.forceContextLoss();renderer=null;scene?.clear();models.length=markers.length=allLandmarks.length=0;data=null;urbanClusters=null;updateShadowView=()=>{};root.remove();
  }
  signal?.addEventListener('abort',destroy,{once:true});
  function motionChanged(){if(reduce.matches)setRotation(false);}reduce.addEventListener('change',motionChanged);
  function size(){return{width:Math.max(container.clientWidth,1),height:Math.max(container.clientHeight,1)};}
  function resize(){if(!renderer||destroyed)return;const{width,height}=size();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
  function setRotation(value){if(controls)controls.autoRotate=!!value&&!reduce.matches;}
  function clearHover(){hoveredArchitecture=null;hoverPoint=null;hoverDirty=false;}
  function clearSelection(){selection=null;clearHover();if(camera)updateLabels();}
  function setLabels(value){labelsVisible=!!value;clearHover();labelsLayer.hidden=!labelsVisible;lines.style.display=labelsVisible?'':'none';if(camera)updateLabels();}
  function cameraTo(target,distance,animate=true,viewDirection=null){
    zoomGesture=false;zoomFocus=target.clone();
    const direction=new THREE.Vector3(...(viewDirection||[.13,1.22,1])).normalize(),position=target.clone().addScaledVector(direction,distance);
    if(animate&&!reduce.matches)tween={time:performance.now(),from:camera.position.clone(),targetFrom:controls.target.clone(),to:position,target};
    else{tween=null;camera.position.copy(position);controls.target.copy(target);controls.update();}
  }
  function fullView(animate=true){if(!camera)return;controls.minDistance=hangzhouUrbanView.distance;clearSelection();const{width,height}=size();cameraTo(fullTarget,Math.max(56,58/(width/height)),animate);zoomFocus=urbanTarget?.clone()||fullTarget.clone();}
  function urbanView(animate=true){if(!camera||!urbanTarget)return;controls.minDistance=hangzhouUrbanView.distance;clearSelection();const{width,height}=size();cameraTo(urbanTarget,hangzhouUrbanView.distance*Math.max(1,1.25/(width/height)),animate,hangzhouUrbanView.direction);}
  function updateZoomFraming(){
    if(!zoomGesture||tween||!zoomFocus)return;
    const distance=camera.position.distanceTo(controls.target),blend=THREE.MathUtils.smoothstep(distance,24,56),target=zoomFocus.clone().lerp(fullTarget,blend),shift=target.sub(controls.target);
    camera.position.add(shift);controls.target.add(shift);
  }
  function focusAttraction(id){if(!ready)return;const found=markers.find(m=>m.item.id===id);if(!found)return;clearHover();selection=id;controls.minDistance=5.2;cameraTo(found.anchor.clone(),found.item.category==='airport'?6.5:(found.item.id==='qiandao'?22:found.item.id==='tianmu'?9:5.4),true,['leifeng','santan','faxi','lingyin'].includes(id)?[1,1.6,-.75]:null);}
  function resetView(){setRotation(false);urbanView();}
  function updateLabels(){
    const{width,height}=size(),placed=[];
    const priorityOf=m=>(m.item.id===selection?100:m.item.id===hoveredArchitecture?90:0)+(m.priority||0);
    const ranked=[...markers].sort((a,b)=>priorityOf(b)-priorityOf(a));
    for(const m of ranked){
      const screen=m.anchor.clone().project(camera),x=(screen.x+1)*width/2,y=(1-screen.y)*height/2;
      const detailHidden=m.item.category==='architecture'&&selection!==m.item.id&&hoveredArchitecture!==m.item.id;
      const off=!labelsVisible||detailHidden||screen.z>1||screen.z<0||x<0||x>width||y<32||y>height-35;m.line.style.display=m.dot.style.display=off?'none':'';m.node.hidden=off;m.node.setAttribute('aria-pressed',String(selection===m.item.id));if(off)continue;
      const w=m.node.offsetWidth||78,h=m.node.offsetHeight||30;
      let best=null;
      for(let ring=0;ring<8;ring++)for(const [dx,dy]of[[0,-32-ring*35],[50+ring*23,-22],[-50-ring*23,-22],[30+ring*25,28+ring*20],[-30-ring*25,28+ring*20],[0,34+ring*34]]){
        const px=THREE.MathUtils.clamp(x+dx,20+w/2,width-22-w/2),py=THREE.MathUtils.clamp(y+dy,65,height-85);
        const collision=placed.reduce((n,r)=>n+(Math.abs(r.x-px)<(r.w+w)/2+7&&Math.abs(r.y-py)<(r.h+h)/2+6?1:0),0);
        const headingPenalty=px<210&&py<150?3:0,score=collision*10000+headingPenalty*1000+Math.hypot(px-x,py-y);
        if(!best||score<best.score)best={x:px,y:py,w,h,score};
      }
      m.dot.setAttribute('cx',x);m.dot.setAttribute('cy',y);placed.push(best);m.node.style.left=`${best.x}px`;m.node.style.top=`${best.y}px`;
      m.line.setAttribute('points',`${x.toFixed(1)},${y.toFixed(1)} ${best.x.toFixed(1)},${(best.y+best.h/2+7).toFixed(1)} ${best.x.toFixed(1)},${(best.y+best.h/2).toFixed(1)}`);m.line.classList.toggle('is-selected',selection===m.item.id);
      m.node.dataset.anchorX=x.toFixed(1);m.node.dataset.anchorY=y.toFixed(1);
    }
  }
  function animate(now){if(destroyed)return;frame=requestAnimationFrame(animate);if(!visible||document.hidden||!renderer)return;if(tween){const t=Math.min(1,(now-tween.time)/900),e=1-(1-t)**3;camera.position.lerpVectors(tween.from,tween.to,e);controls.target.lerpVectors(tween.targetFrom,tween.target,e);if(t===1)tween=null;}controls.update();updateZoomFraming();updateShadowView(now);renderer.render(scene,camera);updateHover();updateLabels();const compass=container.parentElement.querySelector('.compass svg');if(compass)compass.style.transform=`rotate(${-controls.getAzimuthalAngle()*180/Math.PI}deg)`;}

  try{
    assert();status('正在展开杭州的山川与市域…');
    const response=await fetch(new URL('../data/hangzhou-atlas/scene-data.json',import.meta.url),{signal:active});if(!response.ok)throw new Error('杭州本地地理资料加载失败');data=await response.json();assert();
    const classificationResponse=await fetch(new URL('../data/hangzhou-atlas/source-classifications.json',import.meta.url),{signal:active});if(!classificationResponse.ok)throw new Error('杭州城区分类资料加载失败');classifications=await classificationResponse.json();assert();
    const blocksResponse=await fetch(new URL('../data/hangzhou-atlas/urban-building-clusters.json',import.meta.url),{signal:active});if(!blocksResponse.ok)throw new Error('杭州主城街区资料加载失败');urbanClusters=await blocksResponse.json();assert();
    const neighbourhoodResponse=await fetch(new URL('../data/hangzhou-atlas/urban-neighbourhoods.json',import.meta.url),{signal:active});if(!neighbourhoodResponse.ok)throw new Error('杭州街区资料加载失败');const neighbourhoodData=await neighbourhoodResponse.json();assert();diag.neighbourhoodSources=neighbourhoodData.stats;
    const envelopeResponse=await fetch(new URL('../data/hangzhou-atlas/urban-display-envelopes.json',import.meta.url),{signal:active});if(!envelopeResponse.ok)throw new Error('Hangzhou display envelopes unavailable');const displayEnvelopes=await envelopeResponse.json();assert();
    if(displayEnvelopes.role!=='cartographic-display-footprint-only'||displayEnvelopes.maximumSourceEdgeExtensionMeters!==hangzhouBuildingScale.maximumSourceEdgeExtensionMeters)throw new Error('Unsupported Hangzhou building display envelope');
    diag.buildingFootprintGeneralization={maximumSourceEdgeExtensionMeters:displayEnvelopes.maximumSourceEdgeExtensionMeters,sourceAnchorsUnchanged:true};
    const eastResponse=await fetch(new URL('../data/hangzhou-atlas/east-context.json',import.meta.url),{signal:active});if(!eastResponse.ok)throw new Error('杭州东部用地资料加载失败');const eastContext=await eastResponse.json();assert();diag.eastContext={urban:eastContext.urban.length,cover:eastContext.cover.length,snapshot:eastContext.snapshot};
    const cityUrban=[...data.urban,...urbanClusters.urban,...eastContext.urban];diag.urbanBuildingSources=urbanClusters.stats;
    const signatureResponse=await fetch(new URL('../data/hangzhou-atlas/signature-buildings.json',import.meta.url),{signal:active});if(!signatureResponse.ok)throw new Error('杭州标志建筑资料加载失败');signatureData=await signatureResponse.json();assert();
    const region={type:'Feature',properties:{id:'hangzhou',name:'杭州'},geometry:{type:'MultiPolygon',coordinates:data.boundary}},baseProjection=createRegionProjection(region),projection=createHangzhouDisplayProjection(baseProjection),unit=projection.metersToUnits;
    diag.horizontalDeformation=projection.displayPolicy;
    const heightScale=diag.heightScale;
    function rawHeight([lng,lat]){const g=data.terrain,[w,s,e,n]=g.bbox,fx=THREE.MathUtils.clamp((lng-w)/(e-w)*(g.width-1),0,g.width-1),fy=THREE.MathUtils.clamp((n-lat)/(n-s)*(g.height-1),0,g.height-1),x=Math.floor(fx),y=Math.floor(fy),u=fx-x,v=fy-y;const read=(a,b)=>g.values[Math.min(g.height-1,b)*g.width+Math.min(g.width-1,a)]??0;return Math.max(0,(read(x,y)*(1-u)+read(x+1,y)*u)*(1-v)+(read(x,y+1)*(1-u)+read(x+1,y+1)*u)*v);}
    const waterEntries=data.water.map(w=>({...w,bounds:bounds(w.rings)}));
    function sampleHeight(coord){const h=surface?.sample(coord);if(h!=null)return h;for(const w of waterEntries){const[x,z]=coord,b=w.bounds;if(x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&inPolygon(coord,w.rings))return w.levelMeters;}return rawHeight(coord);}
    const project=(coord,height=sampleHeight(coord))=>projection.project(coord,height*heightScale);
    urbanTarget=project(hangzhouUrbanView.coordinates);
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
    scene=new THREE.Scene();scene.background=new THREE.Color('#f1ede3');scene.add(new THREE.HemisphereLight('#edf6ff','#73858e',1.45));reflectionEnvironment=createCityReflectionEnvironment(renderer);scene.environment=reflectionEnvironment.texture;scene.environmentIntensity=.55;
    const sun=new THREE.DirectionalLight('#fffdf6',2.8);sun.position.set(-20,36,15);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-27,right:27,top:25,bottom:-25,near:1,far:90});sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;scene.add(sun);scene.add(new THREE.DirectionalLight('#dce9ef',.4));
    camera=new THREE.PerspectiveCamera(36,1,.05,180);controls=new OrbitControls(camera,canvas);controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=16;controls.maxDistance=82;controls.minPolarAngle=.28;controls.maxPolarAngle=1.12;controls.autoRotateSpeed=.3;controls.addEventListener('start',()=>{tween=null;});canvas.addEventListener('wheel',()=>{zoomGesture=true;},{passive:true,signal:active});resize();urbanView(false);
    // Spend the same shadow texture on the part of the city being viewed.
    // The previous municipality-wide shadow frustum blurred block contact at
    // the urban camera; fitting it keeps small volumes visibly grounded.
    scene.add(sun.target);
    let shadowTarget=new THREE.Vector3(Infinity,Infinity,Infinity),shadowExtent=0,lastShadowUpdate=-Infinity;
    updateShadowView=now=>{
      const extent=Math.max(8,Math.min(42,camera.position.distanceTo(controls.target)*.72));
      if(now-lastShadowUpdate<180||Math.abs(extent-shadowExtent)<.18&&shadowTarget.distanceToSquared(controls.target)<.045)return;
      shadowTarget.copy(controls.target);shadowExtent=extent;lastShadowUpdate=now;
      sun.target.position.copy(shadowTarget);sun.position.copy(shadowTarget).add(new THREE.Vector3(-20,36,15));
      Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.normalBias=.009;renderer.shadowMap.needsUpdate=true;
    };
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),material({color:'#f1ede3',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.92;ground.receiveShadow=true;scene.add(ground);geometries.add(ground.geometry);
    const polygons=data.boundary.map(poly=>poly.map(r=>r.map(c=>{const p=projection.project(c);return[p.x,p.z];})));
    const waterProjected=waterEntries.map(w=>({source:w,rings:w.rings.map(r=>r.map(c=>{const p=projection.project(c);return[p.x,p.z];}))}));
    status('正在沿岸线裁出湖泊、江流与立体地形…');await pause();assert();
    const meshResponse=await fetch(new URL('../data/hangzhou-atlas/terrain-mesh.json',import.meta.url),{signal:active});if(!meshResponse.ok)throw new Error('杭州地形模型加载失败');const baked=await meshResponse.json();assert();
    // Shade the measured forest footprint even where a representative grove
    // leaves space for ridges; sparse trees must not turn forest into bare land.
    const landStep=.025;
    function landIndex(polygons){const bins=new Map();for(const polygon of polygons){const box=bounds(polygon.rings);for(let x=Math.floor(box[0]/landStep);x<=Math.floor(box[2]/landStep);x++)for(let y=Math.floor(box[1]/landStep);y<=Math.floor(box[3]/landStep);y++){const key=x+','+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(polygon.rings);}}return bins;}
    const urbanBins=landIndex(cityUrban),forestBins=landIndex(data.forest);
    const inLand=(bins,coord)=>(bins.get(Math.floor(coord[0]/landStep)+','+Math.floor(coord[1]/landStep))||[]).some(r=>inPolygon(coord,r));
    const positions=new Float32Array(baked.positions),colors=new Float32Array(positions.length),low=new THREE.Color('#a2a196'),forest=new THREE.Color('#365c3f'),rock=new THREE.Color('#817b6c'),color=new THREE.Color();
    for(let i=0;i<positions.length;i+=3){const coord=projection.unproject(...projection.warp(positions[i],positions[i+2]));const [x,z]=projection.warp(positions[i],positions[i+2]),h=Math.max(0,positions[i+1]);positions[i]=x;positions[i+2]=z;positions[i+1]=h*unit*heightScale;color.copy(low).lerp(forest,THREE.MathUtils.smoothstep(h,50,420));if(h>850)color.lerp(rock,THREE.MathUtils.clamp((h-850)/1200,0,.55));if(inLand(forestBins,coord))color.lerp(forest,.68);color.multiplyScalar(1+Math.sin(x*3.7+z*2.3)*.018);color.toArray(colors,i);}
    const oriented=orientHangzhouSurface(positions,baked.indices);diag.surfaceOrientation={flipped:oriented.flipped,degenerate:oriented.degenerate};const terrainMesh=mesh(positions,oriented.indices,material({vertexColors:true,color:'#ffffff'}),'杭州实测高程与真实岸线',colors);
    // Share only shading normals at coincident vertices; keep all source
    // positions and the same oriented triangles for ground sampling.
    const sharpTerrain=terrainMesh.geometry;sharpTerrain.deleteAttribute('normal');const smoothTerrain=mergeVertices(sharpTerrain,.000001);smoothTerrain.computeVertexNormals();terrainMesh.geometry=smoothTerrain;geometries.delete(sharpTerrain);sharpTerrain.dispose();geometries.add(smoothTerrain);
    terrainMesh.castShadow=true;diag.terrainTriangles=oriented.indices.length/3;diag.negativeDemPolicy='display-clamped-to-zero; raw source retained';surface=createHangzhouSurfaceSampler(positions,oriented.indices,projection,unit*heightScale);
    const coverResponse=await fetch(new URL('../data/hangzhou-atlas/urban-ground-cover.json',import.meta.url),{signal:active});if(!coverResponse.ok)throw new Error('杭州主城地表资料加载失败');let coverData=await coverResponse.json();assert();coverData.classes.push(...eastContext.cover);
    const buildingNaturalExclusions=coverData.classes.filter(p=>['forest','park','grass','farmland','scrub','wetland'].includes(p.class));
    const urbanGreenAreas=coverData.classes.filter(p=>['park','grass'].includes(p.class));
    groundCover=await createHangzhouGroundCover({data,urban:[...cityUrban,...classifications.urban],classes:coverData.classes,projection,bounds:UNIFIED_URBAN_BOUNDS,size:2048,fadeMeters:3000,opacity:1,continuityMeters:220,gapColour:URBAN_GAP_GREEN,airports,palette:URBAN_GROUND_PALETTE,signal:active});coverData=null;assert();groundCover.applyToMaterial(terrainMesh.material);diag.groundCover=groundCover.diagnostics;
    const cutFace=createHangzhouCutFace({polygons,heightAt:p=>rawHeight(projection.unproject(...p))*unit*heightScale,rimColorAt:(p,height)=>{
      const h=height/(unit*heightScale),coord=projection.unproject(...p),c=low.clone().lerp(forest,THREE.MathUtils.smoothstep(h,50,420));
      if(h>850)c.lerp(rock,THREE.MathUtils.clamp((h-850)/1200,0,.55));if(inLand(forestBins,coord))c.lerp(forest,.68);if(inLand(urbanBins,coord))c.set('#b6b39b');return c;
    }});scene.add(cutFace.group);diag.cutFace=cutFace.diagnostics;urbanBins.clear();forestBins.clear();
    const waterMat=material({color:'#ffffff',vertexColors:true,roughness:.42,metalness:.06,side:THREE.DoubleSide}),waterPositions=[],waterIndices=[],waterColors=[];
    for(const entry of waterProjected){const rings=entry.rings.map(r=>r.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,z))),points=rings.flat(),offset=waterPositions.length/3,waterColor=new THREE.Color(entry.source.areaMeters<120000?'#829a91':'#277d89');for(const p of points){waterPositions.push(p.x,entry.source.levelMeters*unit*heightScale+.008,p.y);waterColor.toArray(waterColors,waterColors.length);}for(const t of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1)))waterIndices.push(...t.map(i=>offset+i));}mesh(waterPositions,waterIndices,waterMat,'真实湖泊与河流水面',waterColors);diag.waterPolygons=waterEntries.length;
    shoreline=createHangzhouShoreline({data,project,metersToUnits:unit,uniformDetailBounds:UNIFIED_URBAN_BOUNDS});scene.add(shoreline.group);diag.shoreline=shoreline.diagnostics;
    airports=airports.filter(a=>data.boundary.some(rings=>inPolygon(a.coordinates,rings)));
    status('正在还原杭州各城区的标志建筑…');await pause();assert();
    signatures=createSignatureLayer({items:signatureData.buildings,data,airports,project,projection,sampleHeight});scene.add(signatures.group);diag.signatures=signatures.diagnostics;signatureData=null;
    const objectExclusions=[...airports.flatMap(a=>a.boundary||[]),...signatures.exclusions];
    const priority=['faxi','xiaohe','leifeng','lingyin','hubin-yintai'];
    const displayLandmarks=[...data.landmarks.filter(isHangzhouOverviewPlace),hubinPlace];
    // Keep the previously reviewed shore offsets; growth is predominantly in
    // the vertical silhouette, so pagodas don't acquire a wider lake platform.
    const symbolLayout={
      xiaohe:{horizontal:1,offset:[-.2948968951456443,.03165417865671927],distanceMeters:800},
      leifeng:{horizontal:.6,offset:[.0505227455,.1634470084],distanceMeters:453},
      liuhe:{horizontal:.6,offset:[-.0414523813,-.0666933947],distanceMeters:217},
    };
    diag.symbolLayout=symbolLayout;diag.landmarkDisplay=[];
    const transportTourism=createTourismDisplay({baseProjection,projection,project});
    tourismLayout=createTourismLayout({data,airports,signatureExclusions:signatures.exclusions,projection,project});
    allLandmarks=[westLakePlace,...displayLandmarks,...airports];
    function addMarker(item,anchor,scale=.4){
      const isAirport=item.category==='airport',isArchitecture=item.category==='architecture';
      const node=document.createElement('button');node.type='button';node.className=isArchitecture?'hangzhou-signature-label':'hangzhou-landmark-label'+(isAirport?' airport-marker':'');node.textContent=({qianjiang:'钱江新城',olympic:'奥体中心',liangzhu:'良渚古城',xixi:'西溪湿地',tianmu:'天目山'})[item.id]||item.name;node.dataset.id=item.id;node.setAttribute('aria-label',`定位${item.name}`);node.onclick=()=>onAttractionPick(item);labelsLayer.append(node);
      node.hidden=isArchitecture;
      if(isArchitecture){
        node.addEventListener('pointerenter',()=>{clearHover();if(labelsVisible)hoveredArchitecture=item.id;},{signal:active});
        node.addEventListener('pointerleave',clearHover,{signal:active});
      }
      const line=document.createElementNS('http://www.w3.org/2000/svg','polyline'),dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('r','2.5');lines.append(line,dot);markers.push({item,node,line,dot,anchor:anchor.clone().add(new THREE.Vector3(0,scale*.2+.06,0)),priority:isAirport?8:priority.includes(item.id)?10:isArchitecture?2:0});
    }
    for(const item of [...displayLandmarks,...airports]){
      assert();const isAirport=item.category==='airport',replaced=['qianjiang','olympic','qiandao'].includes(item.id),airportModel=isAirport?createAirportModel({airport:item,project,metersToUnits:unit,heightExaggeration:heightScale,foundationInsetMeters:6}):null;
      if(airportModel)airportModels.push(airportModel);
      const group=airportModel?.group||(replaced?new THREE.Group():item.id==='hubin-yintai'?createHubinOverview():createHangzhouLandmark(item)),anchor=project(item.coordinates);let scale=['leifeng','faxi','lingyin','xiaohe','santan','gongchen'].includes(item.id)?.48:1.05;
      if(item.id==='santan')scale=.34;if(['liuhe','broken-bridge','gongchen'].includes(item.id))scale=.4;if(['hefang','xixi','xianghu'].includes(item.id))scale=.58;if(item.id==='qiandao'||item.id==='tianmu')scale=.85;
      if(!isAirport&&!replaced){
        const key=priority.includes(item.id),growthY=key?1.65:1.4,growthXZ=['leifeng','liuhe','santan','gongchen','broken-bridge','xixi','xianghu'].includes(item.id)?1:key?1.22:1.12;
        const contextScale=['faxi','lingyin'].includes(item.id)?.5:.72;
        group.scale.set(scale*growthXZ*contextScale,scale*growthY*contextScale,scale*growthXZ*contextScale);group.position.copy(anchor);
        const layout=symbolLayout[item.id];if(layout){group.scale.x*=layout.horizontal;group.scale.z*=layout.horizontal;group.position.copy(project(projection.unproject(anchor.x+layout.offset[0],anchor.z+layout.offset[1])));}
        const transported=tourismLayout.fit(group,item,transportTourism(group,item,layout)),corners=transported.footprint;
        objectExclusions.push([[...corners,corners[0]]]);diag.landmarkDisplay.push({id:item.id,growthY,growthXZ,scale:group.scale.toArray(),...transported.metadata});
      }
      group.name=item.name;group.traverse(o=>{o.userData.landmarkId=item.id;if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(group);models.push({item,group});addMarker(item,anchor,scale);
    }
    tourismLayout.dispose();tourismLayout=null;
    // West Lake already exists in the source water mesh; add only an entry,
    // never a second lake or an oversized model over the real shoreline.
    addMarker(westLakePlace,project(westLakePlace.coordinates),.4);
    markers.at(-1).priority=14;markers.at(-1).node.setAttribute('aria-label','打开西湖景区沙盘');
    for(const entry of signatures.entries){
      const parentId=['civic-center','conference-center'].includes(entry.item.shape.type)?'qianjiang':['big-lotus','small-lotus'].includes(entry.item.shape.type)?'olympic':null;
      const parent=models.find(m=>m.item.id===parentId);
      if(parent)parent.group.add(entry.group);
      // Signature silhouettes are context. Only the curated Olympic place is
      // interactive; other city architecture creates no extra label or hit target.
      entry.group.traverse(o=>{delete o.userData.landmarkId;if(parent)o.userData.landmarkId=parentId;});
    }
    diag.landmarkCount=displayLandmarks.length+1;diag.overviewPlaceIds=allLandmarks.map(p=>p.id);diag.defaultView='urban';diag.unifiedUrbanBounds=[...UNIFIED_URBAN_BOUNDS];diag.airports=airportModels.map(model=>model.diagnostics);
    status('正在展开主城街区、山林与实体道路…');await pause();assert();
    const fabricData={...data,neighbourhoods:neighbourhoodData.neighbourhoods,neighbourhoodSources:neighbourhoodData.groups,neighbourhoodDisplayEnvelopes:displayEnvelopes.groups,urban:cityUrban,landmarks:displayLandmarks,urbanClassPolygons:[...classifications.urban,...urbanClusters.urban,...eastContext.urban],objectExclusions,buildingNaturalExclusions,urbanGreenAreas};
    const fabricOptions={
      metersToUnits:unit,unproject:(x,z)=>projection.unproject(x,z),
      surfaceSamplingPolicy:'realized-float32-world-terrain-v1',
      sampleWorldHeight:(x,z)=>{
        if(!worldSurface){
          terrainMesh.updateWorldMatrix(true,false);
          const attribute=terrainMesh.geometry.attributes.position,vertices=new Float64Array(attribute.count*3),p=new THREE.Vector3();
          for(let i=0;i<attribute.count;i++){p.fromBufferAttribute(attribute,i).applyMatrix4(terrainMesh.matrixWorld);vertices.set(p.toArray(),i*3);}
          const index=terrainMesh.geometry.index?.array||Uint32Array.from({length:attribute.count},(_,i)=>i);
          worldSurface=createHangzhouSurfaceSampler(vertices,index,{project:p=>({x:p[0],z:p[1]})},1);
        }
        return worldSurface.sample([x,z]);
      },
      sampleWorldHeightRange:corners=>{if(!worldSurface)fabricOptions.sampleWorldHeight(...corners[0]);return worldSurface.heightRange(corners);},
      urbanFocusBounds:UNIFIED_URBAN_BOUNDS,maxTrees:6500,maxUrbanGroups:6500,
      buildingScaleReference:hangzhouBuildingScale,
      primaryBuildingSpacingMeters:0,supplementaryLowRiseMeters:[170,380],
      urbanSampleStepMeters:200,buildingFootprintMeters:[200,1100],
      landmarkDetailRadiusMeters:6000,secondaryRoadRadiusMeters:0,
      treeHeightMeters:[240,380],
      roadWidthMeters:{motorway:110,trunk:90,primary:65,secondary:42},
      roadThicknessMeters:22,showCurbs:true,curbHeightMeters:5,
      bridgeClearanceMeters:70,forestClusterMeters:2000,ridgeSampleMeters:850,ridgeTreeScale:.8,
      treeLandmarkClearanceMeters:160,buildingLandmarkClearanceMeters:220,urbanClusterSpacingMeters:420,
    };
    diag.fabricCacheKey=await computeFabricCacheKey({data:fabricData,options:fabricOptions,terrain:baked,heightScale,projection:projection.displayPolicy,signal:active});
    const cachedFabric=await loadCachedFabric({key:diag.fabricCacheKey,signal:active,onError:error=>{diag.fabricCacheError=error.message;}});
    if(!cachedFabric){cityAssets=await loadCityAssets({signal:active});assert();}
    const builtFabric=cachedFabric||createHangzhouFabric({data:fabricData,project,sampleHeight,options:fabricOptions,assets:cityAssets});worldSurface?.dispose();worldSurface=null;diag.fabricCacheHit=!!cachedFabric;if(active.aborted||signal?.aborted){builtFabric.dispose();assert();}fabric=builtFabric;classifications=null;urbanClusters=null;scene.add(fabric.group);diag.fabric=fabric.diagnostics;
    status('正在铺设城区绿地与低矮灌木…');await pause();assert();
    groundPlanting=await createUrbanGroundPlanting({data,projection,texture:groundCover.texture,textureBounds:groundCover.diagnostics.projectedBounds,greenColours:[URBAN_GAP_GREEN,URBAN_GROUND_PALETTE.coverClasses.park,URBAN_GROUND_PALETTE.coverClasses.grass,URBAN_GROUND_PALETTE.coverClasses.scrub],fabric:fabric.group,exclusions:objectExclusions,sampleHeightRange:fabricOptions.sampleWorldHeightRange,signal:active});assert();scene.add(groundPlanting.group);diag.groundPlanting=groundPlanting.diagnostics;worldSurface?.dispose();worldSurface=null;
    const picker=new THREE.Raycaster(),pointer=new THREE.Vector2(),pickGroups=models.map(m=>m.group);let down=null;
    function pickPlace(x,y){
      const r=canvas.getBoundingClientRect();pointer.set((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2);picker.setFromCamera(pointer,camera);
      // Resolve the nearest identified child before its enclosing city landmark:
      // signature buildings retain their own IDs inside Qianjiang and Olympic groups.
      let object=picker.intersectObjects(pickGroups,true)[0]?.object;
      while(object){const item=allLandmarks.find(m=>m.id===object.userData.landmarkId);if(item)return item;object=object.parent;}
      return null;
    }
    updateHover=()=>{if(!hoverDirty||down||!hoverPoint||!labelsVisible)return;hoverDirty=false;const item=pickPlace(...hoverPoint);hoveredArchitecture=item?.category==='architecture'?item.id:null;};
    const markHoverDirty=()=>{if(hoverPoint)hoverDirty=true;};
    controls.addEventListener('change',markHoverDirty);active.addEventListener('abort',()=>{controls?.removeEventListener('change',markHoverDirty);clearHover();updateHover=()=>{};},{once:true});
    canvas.addEventListener('pointermove',e=>{if(down||e.buttons||e.pointerType==='touch'||!labelsVisible)return;hoverPoint=[e.clientX,e.clientY];hoverDirty=true;},{signal:active});
    canvas.addEventListener('pointerleave',e=>{if(!e.relatedTarget?.closest?.('.hangzhou-signature-label'))clearHover();},{signal:active});
    root.addEventListener('pointerleave',clearHover,{signal:active});
    window.addEventListener('blur',clearHover,{signal:active});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)clearHover();},{signal:active});
    canvas.addEventListener('pointerdown',e=>{clearHover();down=[e.clientX,e.clientY];},{signal:active});
    canvas.addEventListener('pointercancel',()=>{down=null;clearHover();},{signal:active});
    canvas.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5){down=null;clearHover();return;}down=null;const item=pickPlace(e.clientX,e.clientY);if(item)onAttractionPick(item);},{signal:active});
    ready=diag.ready=true;diag.loadMs=performance.now()-loadStarted;onStatus({state:'ready',message:'杭州全域沙盘已展开'});frame=requestAnimationFrame(animate);
    return{region,projection,get map(){return null;},get camera(){return camera;},get controls(){return controls;},get renderer(){return renderer;},get scene(){return scene;},get visible(){return visible;},
      get signaturePlaces(){return [];},getPlace(id){return allLandmarks.find(item=>item.id===id);},showCity(){},showProvince(){},hoverCity(){},focusAttraction,clearSelection,clearHover,fitAllLandmarks:urbanView,showUrbanView:urbanView,showFullView:fullView,resetView,setLabels,setRotation,resize,destroy,
      show(){visible=true;root.hidden=false;resize();},hide(){visible=false;root.hidden=true;clearSelection();},
      get diagnostics(){return{...diag,selection,hoveredArchitecture,labelsVisible,activeMarkers:markers.length,renderer:renderer?{...renderer.info.memory,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls}:null};}};
  }catch(error){destroy();throw error;}
}
