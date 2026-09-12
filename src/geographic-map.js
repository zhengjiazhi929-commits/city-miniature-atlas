import {provinceBounds, containsCoordinate} from './geographic-bounds.js';
import {installTerrainQualityProtocol, TERRAIN_QUALITY_TILES} from './terrain-quality.js';

const TERRAIN_TILES=TERRAIN_QUALITY_TILES;
const TERRAIN_ATTRIBUTION='Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen</a> / <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">USGS · NOAA and contributors</a>';
const PLACE_FILTER=['match',['get','class'],['city','town'],true,false];
const LABEL_TEXT=['coalesce',['get','name:zh-Hans'],['get','name:zh'],['get','name'],['get','name:en']];
const EMPTY={type:'FeatureCollection',features:[]};
// MapLibre 5.12 limits unused tiles per source, not active tiles or total RAM.
export const GEOGRAPHIC_CACHE_POLICY=Object.freeze({maxTileCacheSize:32,maxTileCacheZoomLevels:2});

function installMarkerStyle(){
  if(document.getElementById('geographic-marker-style'))return;
  const style=document.createElement('style');style.id='geographic-marker-style';
  style.textContent=`.geo-attraction-marker{border:0;background:none;padding:0 0 7px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;color:#244b3d;font:12px/1.4 system-ui,sans-serif;filter:drop-shadow(0 3px 4px #233d3524)}.geo-attraction-marker:focus-visible{outline:3px solid #a86442;outline-offset:5px}.geo-attraction-marker .geo-marker-label{display:block;white-space:nowrap;background:#fffdf4ed;border:1px solid #6f806150;border-radius:3px;padding:5px 8px;font-weight:600}.geo-attraction-marker .geo-marker-dot{width:12px;height:12px;border:2px solid #fffbed;border-radius:50%;background:#295e4c;box-shadow:0 0 0 1px #294f3b55}.geo-attraction-marker[aria-pressed=true]{z-index:5}.geo-attraction-marker[aria-pressed=true] .geo-marker-label{background:#285543;color:#fffbed;border-color:#285543}.geo-attraction-marker[aria-pressed=true] .geo-marker-dot{background:#b76c46;width:15px;height:15px}.geo-attraction-marker .geo-marker-label[hidden]{display:none}`;
  style.textContent+=`.geo-attraction-marker{pointer-events:none}.geo-attraction-marker .geo-marker-label,.geo-attraction-marker .geo-marker-dot{pointer-events:auto}.geo-attraction-marker .geo-marker-label{transform:translateY(calc(-1 * var(--geo-label-lift,0px)))}.geo-attraction-marker .geo-marker-stem{position:absolute;bottom:18px;left:50%;width:1px;height:calc(8px + var(--geo-label-lift,0px));background:#3f6758;z-index:-1;pointer-events:none}.geo-attraction-marker:has(.geo-marker-label[hidden]) .geo-marker-stem{display:none}`;
  style.textContent+=`.geo-attraction-marker[data-compact=true] .geo-marker-dot{display:grid;place-items:center;width:24px;height:24px;color:#fffbed;font:600 11px/1 system-ui,sans-serif}.geo-attraction-marker[data-compact=true][aria-pressed=true] .geo-marker-dot{width:27px;height:27px}.geo-attraction-marker[data-compact=true] .geo-marker-stem{bottom:30px;height:8px}`;
  document.head.append(style);
}

function featureCollection(feature){return {type:'FeatureCollection',features:feature?[feature]:[]};}
function regionMask(feature){
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[
    [[-179.99,-85],[179.99,-85],[179.99,85],[-179.99,85],[-179.99,-85]],
    ...polygons.map(p=>p[0].slice().reverse()),
  ]}};
}

/** Real tiled geography. Procedural attraction models remain a separate view. */
export async function createGeographicMap({container,geojson,signal,initialView=null,onCityPick=()=>{},onAttractionPick=()=>{},onStatus=()=>{},onPlacesChange=()=>{}}){
  const lib=window.maplibregl;
  if(!lib?.Map)throw new Error('地理地图引擎未能加载。');
  const abortError=()=>new DOMException('Geographic view cancelled.','AbortError');
  if(signal?.aborted)throw abortError();
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let destroyed=false,visible=true,labels=true,rotating=false,mode='province',province=null,city=null,landmarks=[],selection=null;
  let frame=0,lastFrame=0,placesTimer=0,statusTimer=0,labelTimer=0,groundTimer=0,viewSerial=0,viewFailed=false,lastPlaceSignature='',lastStatus='',resetCamera=null;
  let map=null,terrainQuality=null,motionChange=null,initCleanup=null,rejectInitialization=null,mapRemoved=false,firstView=true;
  const mapListeners=[],provinceById=new Map(geojson.features.map(feature=>[feature.properties.id,feature]));
  const markerEntries=new Map();
  const recentErrors=[],failedTiles=new Map();
  const onAbort=()=>{rejectInitialization?.(abortError());destroy();};
  signal?.addEventListener('abort',onAbort,{once:true});
  function listenMap(...args){map.on(...args);mapListeners.push(args);}
  function destroy(){
    if(destroyed)return;
    destroyed=true;visible=false;rotating=false;
    initCleanup?.();initCleanup=null;rejectInitialization=null;
    for(const timer of [placesTimer,statusTimer,labelTimer,groundTimer])clearTimeout(timer);
    placesTimer=statusTimer=labelTimer=groundTimer=0;cancelAnimationFrame(frame);frame=lastFrame=0;
    signal?.removeEventListener('abort',onAbort);
    if(motionChange)reduceMotion.removeEventListener('change',motionChange);
    for(const {marker} of markerEntries.values())marker.remove();markerEntries.clear();
    if(map){
      for(const args of mapListeners)map.off(...args);
      mapListeners.length=0;
      // Public remove() destroys style/source tiles, renderer and GL context.
      try{map.remove();}finally{mapRemoved=true;map=null;terrainQuality?.release();}
    }else terrainQuality?.release();
    provinceById.clear();failedTiles.clear();landmarks=[];province=city=resetCamera=null;
  }
  try{
  terrainQuality=installTerrainQualityProtocol(lib);
  installMarkerStyle();
  const status=(state,message)=>{const signature=state+message;if(destroyed||signature===lastStatus)return;lastStatus=signature;onStatus({state,message});};
  status('loading','正在连接真实地图数据…');
  const styleResponse=await fetch(new URL('../data/geographic-style.json',import.meta.url),{signal});
  if(!styleResponse.ok)throw new Error('地理底图样式未能加载。');
  const style=await styleResponse.json();
  if(signal?.aborted||destroyed)throw abortError();
  const initialCamera=initialView?.city?cityCamera(initialView.city):{center:[105,35],zoom:3.2,pitch:0,bearing:0};
  const initialBounds=initialView?.province?provinceBounds(initialView.province):null;
  map=new lib.Map({container,style,...initialCamera,...(initialBounds?{bounds:initialBounds,pitch:58,bearing:-12,fitBoundsOptions:{padding:{top:65,bottom:60,left:55,right:55},maxZoom:12.2,bearing:-12,pitch:58}}:{}),...GEOGRAPHIC_CACHE_POLICY,maxPitch:75,maxZoom:19,minZoom:2,attributionControl:true,renderWorldCopies:false,fadeDuration:reduceMotion.matches?0:250});
  map.addControl(new lib.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new lib.ScaleControl({maxWidth:105,unit:'metric'}),'bottom-left');
  listenMap('error',event=>{
    const message=event.error?.message||'地图数据请求失败';
    if(/abort/i.test(message)||destroyed)return;
    const tileId=event.tile?.tileID||event.tile?.coord||event.coord,canonical=tileId?.canonical||tileId;
    const tile=Number.isFinite(canonical?.z)?{z:canonical.z,x:canonical.x,y:canonical.y,wrap:tileId.wrap||0}:null;
    const error={message,sourceId:event.sourceId||null,tile,viewSerial,time:Date.now()};
    recentErrors.push(error);if(recentErrors.length>32)recentErrors.shift();
    if(tile)failedTiles.set(`${error.sourceId}:${tile.z}/${tile.x}/${tile.y}/${tile.wrap}`,error);
    viewFailed=true;
    status('error',event.sourceId==='atlas-dem'?'高程数据加载失败，暂时无法完整显示地形。':'部分地图数据未能加载，请检查网络后重试。');
  });
  await new Promise((resolve,reject)=>{
    const onStyle=()=>{initCleanup();resolve();};
    const timeout=setTimeout(()=>{initCleanup();reject(new Error('地图初次加载超时，请检查网络。'));},25000);
    initCleanup=()=>{clearTimeout(timeout);map?.off('style.load',onStyle);rejectInitialization=null;};
    rejectInitialization=error=>{initCleanup();reject(error);};
    // Layers are ready at style.load. Do not wait for unused national-view
    // tiles before moving to the province or city the user actually opened.
    map.on('style.load',onStyle);
    if(signal?.aborted||destroyed)rejectInitialization(abortError());
  });
  if(signal?.aborted||destroyed)throw abortError();
  initCleanup=null;

  map.addSource('atlas-dem',{type:'raster-dem',tiles:[TERRAIN_TILES],tileSize:256,encoding:'terrarium',maxzoom:15,attribution:TERRAIN_ATTRIBUTION});
  map.addSource('atlas-hillshade-dem',{type:'raster-dem',tiles:[TERRAIN_TILES],tileSize:256,encoding:'terrarium',maxzoom:15,attribution:TERRAIN_ATTRIBUTION});
  const firstSymbol=map.getStyle().layers.find(layer=>layer.type==='symbol')?.id;
  map.addLayer({id:'atlas-hillshade',type:'hillshade',source:'atlas-hillshade-dem',paint:{'hillshade-shadow-color':'#52664b','hillshade-highlight-color':'#f8f3d6','hillshade-accent-color':'#7e8962','hillshade-exaggeration':.3}},firstSymbol);
  map.addSource('atlas-province',{type:'geojson',data:EMPTY});
  map.addSource('atlas-region-mask',{type:'geojson',data:EMPTY});
  map.addLayer({id:'atlas-region-mask',type:'fill',source:'atlas-region-mask',paint:{'fill-color':'#efede5','fill-opacity':.76}},firstSymbol);
  map.addLayer({id:'atlas-province-halo',type:'line',source:'atlas-province',paint:{'line-color':'#fffced','line-width':5,'line-opacity':.9}});
  map.addLayer({id:'atlas-province-line',type:'line',source:'atlas-province',paint:{'line-color':'#315e4d','line-width':2,'line-opacity':.95}});
  map.addLayer({id:'atlas-city-points',type:'circle',source:'openmaptiles','source-layer':'place',filter:PLACE_FILTER,paint:{'circle-radius':['interpolate',['linear'],['zoom'],4,3,8,5,12,6],'circle-color':'#a96344','circle-stroke-color':'#fff9e8','circle-stroke-width':1.8}});
  map.addLayer({id:'atlas-city-labels',type:'symbol',source:'openmaptiles','source-layer':'place',filter:PLACE_FILTER,layout:{'text-field':LABEL_TEXT,'text-font':['Noto Sans Regular'],'text-size':13,'text-anchor':'top','text-offset':[0,.7],'text-optional':true},paint:{'text-color':'#304a3d','text-halo-color':'#fffbea','text-halo-width':1.5}});
  const originalSymbolVisibility=new Map(map.getStyle().layers.filter(l=>l.type==='symbol').map(l=>[l.id,l.layout?.visibility||'visible']));
  const readyMessage=()=>mode==='province'?'公开高程已加载 · 高差放大 8 倍 · 局部异常过滤':'真实路网与建筑轮廓已加载 · 部分楼高为数据源估算';
  function beginView(){
    viewSerial++;viewFailed=false;lastPlaceSignature='';clearTimeout(statusTimer);
    status('loading','正在加载地形、道路与建筑数据…');
    const serial=viewSerial;
    statusTimer=setTimeout(()=>{if(serial===viewSerial&&!destroyed&&!map.areTilesLoaded())status('error','地图数据加载超时，部分地理信息可能尚未显示。请检查网络后重试。');},25000);
  }
  function failedTileVisible(error){
    const {tile}=error,bounds=map.getBounds(),count=2**tile.z;
    const latitude=y=>Math.atan(Math.sinh(Math.PI*(1-2*y/count)))*180/Math.PI;
    const west=tile.x/count*360-180+tile.wrap*360,east=(tile.x+1)/count*360-180+tile.wrap*360;
    return east>=bounds.getWest()&&west<=bounds.getEast()&&latitude(tile.y)>=bounds.getSouth()&&latitude(tile.y+1)<=bounds.getNorth();
  }
  listenMap('sourcedata',event=>{
    if(event.tile?.state!=='loaded')return;
    const tileId=event.tile.tileID||event.coord,tile=tileId?.canonical||tileId;
    if(tile)failedTiles.delete(`${event.sourceId}:${tile.z}/${tile.x}/${tile.y}/${tileId.wrap||0}`);
  });
  function clearMarkers(){for(const {marker} of markerEntries.values())marker.remove();markerEntries.clear();}
  function alignMarker(entry){
    const {marker,element,dot}=entry;
    // Anchor the dot center, not the transparent button's bottom edge.
    marker.setOffset([0,element.offsetHeight-dot.offsetTop-dot.offsetHeight/2]);
    marker.setLngLat(marker.getLngLat());
  }
  function setProvinceOutline(feature,mask){
    map.getSource('atlas-province').setData(featureCollection(feature));
    map.getSource('atlas-region-mask').setData(mask&&feature?featureCollection(regionMask(feature)):EMPTY);
  }
  function updateLayerVisibility(){
    for(const [id,baseVisibility]of originalSymbolVisibility){
      if(!map.getLayer(id))continue;
      const isOwn=id==='atlas-city-labels',isDuplicatePlace=['label_city','label_city_capital','label_town'].includes(id);
      const show=labels&&baseVisibility!=='none'&&(isOwn?mode==='province':!(mode==='province'&&isDuplicatePlace));
      map.setLayoutProperty(id,'visibility',show?'visible':'none');
    }
    map.setLayoutProperty('atlas-city-points','visibility',mode==='province'?'visible':'none');
    updateMarkerAppearance();
  }
  function updateMarkerAppearance(){
    const compact=container.clientWidth<640;
    for(const [id,entry] of markerEntries){
      entry.element.dataset.compact=String(compact);
      entry.label.hidden=!labels||(compact&&id!==selection);
      entry.dot.textContent=compact?String(entry.number):'';
      if(compact||entry.label.hidden)entry.element.style.setProperty('--geo-label-lift','0px');
      alignMarker(entry);
    }
    scheduleMarkerLabels();
  }
  function arrangeMarkerLabels(){
    labelTimer=0;if(!visible||!labels||mode!=='city'||destroyed)return;
    const viewport=container.getBoundingClientRect(),placed=[];
    const entries=[...markerEntries.entries()].sort(([a],[b])=>(a===selection?-1:0)-(b===selection?-1:0));
    for(const [,{marker,element,label}]of entries){
      if(label.hidden||element.dataset.compact==='true')continue;
      const point=map.project(marker.getLngLat());
      if(point.x<0||point.x>viewport.width||point.y<0||point.y>viewport.height)continue;
      const rect=label.getBoundingClientRect(),previous=Number.parseFloat(element.style.getPropertyValue('--geo-label-lift'))||0;
      const baseTop=rect.top+previous;let lift=0;
      const overlaps=()=>placed.some(r=>rect.left<r.right+5&&rect.right>r.left-5&&baseTop-lift<r.bottom+5&&baseTop-lift+rect.height>r.top-5);
      for(let n=0;n<9&&overlaps();n++)lift+=rect.height+7;
      element.style.setProperty('--geo-label-lift',`${lift}px`);
      placed.push({left:rect.left,right:rect.right,top:baseTop-lift,bottom:baseTop-lift+rect.height});
    }
  }
  function scheduleMarkerLabels(){if(!labelTimer)labelTimer=setTimeout(arrangeMarkerLabels,90);}
  function refreshPlaces(){
    if(destroyed||!visible||mode!=='province'||!province||!map.isStyleLoaded())return;
    const found=map.querySourceFeatures('openmaptiles',{sourceLayer:'place',filter:PLACE_FILTER}),dedup=new Map();
    for(const feature of found){
      if(feature.geometry.type!=='Point'||!containsCoordinate(province,feature.geometry.coordinates))continue;
      const p=feature.properties,coordinates=feature.geometry.coordinates,name=p['name:zh-Hans']||p['name:zh']||p.name||p['name:en'];
      if(!name)continue;
      const id=feature.id!=null?`osm-${feature.id}`:`place-${coordinates[0].toFixed(5)}-${coordinates[1].toFixed(5)}`;
      dedup.set(id,{id,name,coordinates,province:province.properties.id,class:p.class,rank:Number(p.rank)||99});
    }
    // Macau's Natural Earth outline can omit the real OSM city point. Only
    // when that named city is actually missing, admit its nearby source point;
    // never substitute the polygon centroid or manufacture a city coordinate.
    if(province.properties.id==='macao'){
      const isMacau=name=>/^(澳门|澳門)(市|特别行政区|特別行政區)?$/.test(name);
      if(![...dedup.values()].some(place=>isMacau(place.name))){
        const bounds=provinceBounds(province),fallbackIds=[];
        for(const feature of found){
          const p=feature.properties,c=feature.geometry.coordinates,name=p['name:zh-Hans']||p['name:zh']||p.name;
          if(feature.geometry.type!=='Point'||p.class!=='city'||!isMacau(name)||c[0]<bounds[0][0]-.04||c[0]>bounds[1][0]+.04||c[1]<bounds[0][1]-.04||c[1]>bounds[1][1]+.04)continue;
          const id=`osm-${feature.id}`;dedup.set(id,{id,name,coordinates:c,province:'macao',class:p.class,rank:Number(p.rank)||1});
          if(feature.id!=null)fallbackIds.push(feature.id);
        }
        if(fallbackIds.length){
          const filter=['all',PLACE_FILTER,['any',['within',province],['in',['id'],['literal',fallbackIds]]]];
          if(JSON.stringify(map.getFilter('atlas-city-points'))!==JSON.stringify(filter)){
            map.setFilter('atlas-city-points',filter);map.setFilter('atlas-city-labels',filter);
          }
        }
      }
    }
    const places=[...dedup.values()].sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name,'zh-CN'));
    const signature=places.map(p=>p.id).join('|');if(signature!==lastPlaceSignature){lastPlaceSignature=signature;onPlacesChange(places);}
  }
  const schedulePlaces=()=>{clearTimeout(placesTimer);placesTimer=setTimeout(refreshPlaces,220);};
  function settleCameraOnGround(){
    groundTimer=0;if(destroyed||!visible||map.isMoving()||!map.getTerrain())return;
    // In GL JS 5.12 a completed terrain flight can leave elevation frozen at
    // the previous center. Use the public API to aim at the loaded ground,
    // without adding a second height to the geographic marker itself.
    const elevation=map.queryTerrainElevation(map.getCenter());
    if(Number.isFinite(elevation)&&Math.abs(map.getCenterElevation()-elevation)>.2)map.setCenterElevation(elevation);
    for(const entry of markerEntries.values())alignMarker(entry);
    scheduleMarkerLabels();
  }
  function scheduleGroundCamera(){clearTimeout(groundTimer);groundTimer=setTimeout(settleCameraOnGround,40);}
  listenMap('sourcedata',schedulePlaces);listenMap('moveend',schedulePlaces);listenMap('move',scheduleMarkerLabels);listenMap('idle',scheduleMarkerLabels);
  listenMap('moveend',scheduleGroundCamera);listenMap('idle',scheduleGroundCamera);
  listenMap('idle',()=>{
    refreshPlaces();
    if(!visible)return;
    const failedVisible=[...failedTiles.values()].some(failedTileVisible);
    if(failedVisible){status('error','部分地图数据未能加载，请检查网络后重试。');return;}
    if(!viewFailed){clearTimeout(statusTimer);status('ready',readyMessage());}
  });
  const pickCity=event=>{
    if(mode!=='province'||!event.features?.length)return;
    const f=event.features[0],p=f.properties;
    onCityPick({id:f.id!=null?`osm-${f.id}`:`place-${f.geometry.coordinates.join('-')}`,name:p['name:zh-Hans']||p['name:zh']||p.name,coordinates:f.geometry.coordinates,province:province?.properties.id});
  };
  for(const layer of ['atlas-city-points','atlas-city-labels']){
    listenMap('click',layer,pickCity);
    listenMap('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
    listenMap('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
  }

  function fly(options){
    if(firstView){firstView=false;map.jumpTo(options);return;}
    map.flyTo({...options,duration:reduceMotion.matches?0:1200,essential:false});
  }
  function fit(bounds,options={}){map.fitBounds(bounds,{padding:{top:65,bottom:60,left:55,right:55},duration:reduceMotion.matches?0:1000,...options});}
  function fitProvince(bounds){
    const camera=map.cameraForBounds(bounds,{padding:{top:65,bottom:60,left:55,right:55},bearing:-12,maxZoom:12.2});
    if(camera)fly({...camera,zoom:Math.min(camera.zoom+.4,12.6),pitch:58,bearing:-12});
  }
  function cityCamera(nextCity){
    const hongKong=nextCity.id==='hong-kong',narrow=container.clientWidth<640;
    return {center:hongKong?(narrow?[114.159,22.282]:[114.157,22.28]):nextCity.coordinates,zoom:hongKong?(narrow?14.6:15.1):(narrow?14.2:14.7),pitch:60,bearing:hongKong?-20:-15};
  }
  function showProvince(feature){
    if(destroyed)return;beginView();visible=true;mode='province';province=feature;city=null;landmarks=[];selection=null;clearMarkers();onPlacesChange([]);container.style.visibility='visible';map.resize();
    setProvinceOutline(feature,true);map.setTerrain({source:'atlas-dem',exaggeration:8});map.setPaintProperty('atlas-hillshade','hillshade-exaggeration',.44);
    const filter=['all',PLACE_FILTER,['within',feature]];map.setFilter('atlas-city-points',filter);map.setFilter('atlas-city-labels',filter);updateLayerVisibility();
    const bounds=provinceBounds(feature);resetCamera={kind:'province',bounds};fitProvince(bounds);schedulePlaces();
  }
  function showCity(nextCity,nextLandmarks=[]){
    if(destroyed)return;beginView();visible=true;mode='city';city=nextCity;province=provinceById.get(city.province)||null;landmarks=nextLandmarks;selection=null;clearMarkers();onPlacesChange([]);container.style.visibility='visible';map.resize();
    // The province outlines are simplified navigation geometry. At street
    // scale they must not be mistaken for a surveyed coastline or boundary.
    setProvinceOutline(null,false);map.setTerrain({source:'atlas-dem',exaggeration:1});map.setPaintProperty('atlas-hillshade','hillshade-exaggeration',.3);
    for(const [index,landmark] of landmarks.entries()){
      const element=document.createElement('button');element.type='button';element.className='geo-attraction-marker';element.setAttribute('aria-label',`查看${landmark.name}`);element.setAttribute('aria-pressed','false');element.title=landmark.name;
      const label=document.createElement('span');label.className='geo-marker-label';label.textContent=landmark.name;
      const dot=document.createElement('span');dot.className='geo-marker-dot';dot.setAttribute('aria-hidden','true');
      const stem=document.createElement('span');stem.className='geo-marker-stem';stem.setAttribute('aria-hidden','true');element.append(label,stem,dot);
      const marker=new lib.Marker({element,anchor:'bottom',offset:[0,7]}).setLngLat(landmark.coordinates).addTo(map);
      element.addEventListener('click',event=>{event.stopPropagation();onAttractionPick(landmark);});markerEntries.set(landmark.id,{marker,element,label,dot,number:index+1});
    }
    updateLayerVisibility();
    resetCamera={kind:'city',options:cityCamera(city)};
    fly(resetCamera.options);
  }
  function focusAttraction(id){
    if(destroyed)return;
    const landmark=landmarks.find(item=>item.id===id);if(!landmark)return;
    beginView();
    selection=id;for(const [key,{element}]of markerEntries)element.setAttribute('aria-pressed',String(key===id));
    updateMarkerAppearance();
    const broad=['victoria-harbour','hong-kong-disneyland','ocean-park','ngong-ping'].includes(id);
    fly({center:landmark.coordinates,zoom:broad?14.7:16,pitch:60,bearing:map.getBearing()});
  }
  function fitAllLandmarks(){
    if(destroyed||!landmarks.length)return;
    beginView();
    const bounds=new lib.LngLatBounds();landmarks.forEach(item=>bounds.extend(item.coordinates));
    selection=null;for(const {element}of markerEntries.values())element.setAttribute('aria-pressed','false');
    updateMarkerAppearance();
    fit(bounds,{pitch:45,bearing:-10,maxZoom:14.5});
  }
  function resetView(){
    if(destroyed||!resetCamera)return;beginView();
    setRotation(false);selection=null;for(const {element}of markerEntries.values())element.setAttribute('aria-pressed','false');
    updateMarkerAppearance();
    if(resetCamera?.kind==='province')fitProvince(resetCamera.bounds);
    else if(resetCamera)fly(cityCamera(city));
  }
  function animate(now){
    if(!rotating||!visible||destroyed||reduceMotion.matches){frame=0;lastFrame=0;return;}
    if(lastFrame)map.setBearing(map.getBearing()+Math.min(now-lastFrame,50)*.0018);
    lastFrame=now;frame=requestAnimationFrame(animate);
  }
  function setRotation(value){if(destroyed)return;rotating=Boolean(value)&&!reduceMotion.matches;cancelAnimationFrame(frame);frame=0;lastFrame=0;if(rotating&&visible)frame=requestAnimationFrame(animate);}
  function setLabels(value){if(destroyed)return;labels=Boolean(value);updateLayerVisibility();}
  motionChange=()=>{if(reduceMotion.matches)setRotation(false);};reduceMotion.addEventListener('change',motionChange);
  function hide(){if(destroyed)return;visible=false;map.stop();cancelAnimationFrame(frame);frame=0;lastFrame=0;container.style.visibility='hidden';}
  function show(){if(destroyed)return;visible=true;container.style.visibility='visible';map.resize();if(rotating&&!frame)frame=requestAnimationFrame(animate);schedulePlaces();}
  return {get map(){return map;},showProvince,showCity,focusAttraction,fitAllLandmarks,resetView,setLabels,setRotation,resize:()=>{if(!destroyed){map.resize();updateMarkerAppearance();}},hide,show,destroy,terrainQuality,get visible(){return visible;},get diagnostics(){return {destroyed,mapRemoved,activeMarkers:markerEntries.size,activeListeners:mapListeners.length,pendingTimers:[placesTimer,statusTimer,labelTimer,groundTimer].filter(Boolean).length,cachePolicy:GEOGRAPHIC_CACHE_POLICY,viewSerial,viewFailed,recentErrors:recentErrors.slice(),failedTiles:[...failedTiles.values()]};}};
  }catch(error){destroy();throw error;}
}
