import * as THREE from 'three';
import {VectorTile} from '../vendor/vector-tile.js';
import Pbf from '../vendor/pbf.js';
import clipping from '../vendor/polygon-clipping.js';
import {containsCoordinate} from './geographic-bounds.js';
import {CITY_ROAD_CLASSES,CITY_PALETTE,cityAbstractionOptions,coordinateDistance,sourcePolygonMetrics,stableBlockOrder} from './city-abstraction.js';
import {applyTerrainStyle} from './terrain-style.js';

const TILEJSON='https://tiles.openfreemap.org/planet';
const DETAIL_ZOOM=14,DETAIL_LIMIT=9,TRIANGLE_LIMIT=300000;
const abortError=()=>new DOMException('Region vectors cancelled.','AbortError');
const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
const tileX=(lon,z)=>Math.floor((lon+180)/360*2**z);
const tileY=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
function tileRing(x,y,z){const n=2**z,lon=i=>i/n*360-180,lat=i=>Math.atan(Math.sinh(Math.PI*(1-2*i/n)))*180/Math.PI;return [[lon(x),lat(y)],[lon(x+1),lat(y)],[lon(x+1),lat(y+1)],[lon(x),lat(y+1)],[lon(x),lat(y)]];}
function tileRange(bounds,z){return [tileX(bounds[0][0],z),tileY(bounds[1][1],z),tileX(bounds[1][0],z),tileY(bounds[0][1],z)];}
function tileCount(range){return (range[2]-range[0]+1)*(range[3]-range[1]+1);}
function disposeGroup(group){group.traverse(object=>{object.geometry?.dispose();});group.clear();}
function median(values){values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)]||0;}
function cleanRing(ring){const out=ring.slice();if(out.length>1&&out[0][0]===out.at(-1)[0]&&out[0][1]===out.at(-1)[1])out.pop();return out;}

/** One abortable region's real vector tiles. No MapLibre renderer is created. */
export async function createRegionVectors({region,projection,kind='city',sampleHeight,heightScale=1,signal,onProgress=()=>{},onPlacesChange=()=>{},overviewBlocks=false,landmarks=[],focusPoint=null,surfaceStyle=null,buildingExclusions=[]}){
  if(signal?.aborted)throw abortError();
  const abstraction=kind==='city'?cityAbstractionOptions(overviewBlocks,focusPoint,landmarks):null;
  const illustrated=!!abstraction||surfaceStyle==='illustrated';
  if(abstraction&&!abstraction.center)throw new Error('City abstraction requires a real focusPoint coordinate.');
  const triangleLimit=abstraction?.detailTriangles||TRIANGLE_LIMIT,detailLimit=abstraction?.detailTiles||DETAIL_LIMIT;
  const group=new THREE.Group();group.name='Real region vectors';
  const waterGroup=new THREE.Group(),detailGroup=new THREE.Group();group.add(waterGroup,detailGroup);
  const overviewGroup=new THREE.Group(),overviewBuildings=new THREE.Group();overviewGroup.name='Source-derived city overview';overviewGroup.add(overviewBuildings);if(abstraction)group.add(overviewGroup);
  const waterMaterial=new THREE.MeshStandardMaterial({color:illustrated?CITY_PALETTE.water:'#a9c8c0',roughness:.74,metalness:.05,side:THREE.DoubleSide});
  const buildingMaterial=new THREE.MeshStandardMaterial({color:illustrated?CITY_PALETTE.building:'#e6e1ce',roughness:.84,metalness:0,flatShading:true});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;
  const context=canvas.getContext('2d');
  const surfaceTexture=new THREE.CanvasTexture(canvas);surfaceTexture.colorSpace=THREE.SRGBColorSpace;surfaceTexture.anisotropy=4;
  const stats={disposed:false,coarseZoom:0,coarseTiles:0,coarseTileTotal:0,coarseFailed:0,waterPolygons:0,landcoverPolygons:0,roadFeatures:0,placeCount:0,buildingTiles:0,buildingFeatures:0,buildingTriangles:0,heightFallbacks:0,detailTruncated:false,detailLoading:false,detailErrors:0,detailSurfaceTriangles:0,clipPrecisionRetries:0,activeRequests:0,errors:[],attribution:'© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap'};
  Object.assign(stats,{abstraction:!!abstraction,surfaceStyle:illustrated?'illustrated':'standard',overviewTiles:0,overviewFailed:0,overviewBlocks:0,overviewTriangles:0,overviewSourcePolygons:0,overviewOmitted:0,overviewHeightMeters:abstraction?.displayHeightMeters||null,overviewHeightMeaning:abstraction?'fixed visual height for generalized source building clusters':null,roadClasses:{},detailRoadClasses:{}});
  const requests=new Set(),detailRequests=new Set(),detailTiles=new Map(),placeMap=new Map(),overviewTiles=new Map(),overviewSelections=[];
  const waterMask={type:'FeatureCollection',features:[]};
  let coverageShape=[],fineWaterShape=[],fineWaterFeatures=[],fineWaterLookup=[];
  const regionShape=polygons(region.geometry),bounds=projection.bounds;
  let disposed=false,template=null,detailKey='',generation=0,lastUpdate=0,reservedTriangles=0;
  const [west,north,east,south]=projection.mercatorBounds;
  const uvPoint=coordinate=>{const p=projection.project(coordinate);return [(p.x/(projection.scale)+(west+east)/2-west)/(east-west)*canvas.width,(p.z/projection.scale+(north+south)/2-north)/(south-north)*canvas.height];};
  function report(message,loaded=stats.coarseTiles,total=stats.coarseTileTotal){if(!disposed)onProgress({stage:'vectors',message,loaded,total});}
  function check(){if(disposed||signal?.aborted)throw abortError();}
  function recordError(error,tile){if(error.name==='AbortError'||disposed)return;stats.errors.push({message:error.message,tile});if(stats.errors.length>20)stats.errors.shift();}
  async function fetchBuffer(url,detail=false){
    check();const controller=new AbortController();requests.add(controller);if(detail)detailRequests.add(controller);stats.activeRequests=requests.size;
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},18000);
    try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error(`Vector data HTTP ${response.status}`);return await response.arrayBuffer();}
    catch(error){if(timedOut&&!disposed&&!signal?.aborted)throw new Error('Vector tile request timed out.');throw error;}
    finally{clearTimeout(timeout);requests.delete(controller);detailRequests.delete(controller);stats.activeRequests=requests.size;}
  }
  async function readTile(x,y,z,detail=false){
    const url=template.replace('{z}',z).replace('{x}',x).replace('{y}',y);
    const data=await fetchBuffer(url,detail);check();return new VectorTile(new Pbf(new Uint8Array(data)));
  }
  function intersectShapes(subject,boundary,operation='intersection'){
    if(!subject.length||!boundary.length)return [];
    const origin=boundary[0][0][0];
    // MVT edge duplicates differ by floating-point roundoff after projection.
    // Work near zero and snap below source resolution (about 1 mm, retry 1 cm).
    const normalize=(shape,precision)=>shape.map(p=>p.map(r=>r.map(c=>[Math.round((c[0]-origin[0])*precision)/precision,Math.round((c[1]-origin[1])*precision)/precision])));
    let result;
    try{result=clipping[operation](normalize(subject,1e8),normalize(boundary,1e8));}
    catch{stats.clipPrecisionRetries++;result=clipping[operation](normalize(subject,1e7),normalize(boundary,1e7));}
    return result.map(p=>p.map(r=>r.map(c=>[c[0]+origin[0],c[1]+origin[1]])));
  }
  const subtractShapes=(subject,boundary)=>boundary.length?intersectShapes(subject,boundary,'difference'):subject;
  const unionShapes=shape=>shape.length?intersectShapes(shape,shape,'union'):[];
  function tileClip(x,y,z){return intersectShapes(regionShape,[[tileRing(x,y,z)]]);}
  function clippedFeature(feature,tileBoundary){const shape=polygons(feature.geometry);return shape.length?intersectShapes(shape,tileBoundary):[];}
  function clippedBuildingFeature(feature,tileBoundary){return subtractShapes(clippedFeature(feature,tileBoundary),buildingExclusions);}
  function pathShape(shape){context.beginPath();for(const polygon of shape)for(const ring of polygon){ring.forEach((coordinate,i)=>{const [x,y]=uvPoint(coordinate);i?context.lineTo(x,y):context.moveTo(x,y);});context.closePath();}}
  function paintShape(shape,color){if(!shape.length)return;pathShape(shape);context.fillStyle=color;context.fill('evenodd');}
  function waterLevel(shape,properties){
    if(properties.class==='ocean'||properties.ocean===true)return 0;
    const coordinates=shape.flatMap(p=>p[0]),step=Math.max(1,Math.floor(coordinates.length/16)),heights=[];
    for(let i=0;i<coordinates.length&&heights.length<16;i+=step){const h=sampleHeight(coordinates[i]);if(Number.isFinite(h))heights.push(h);}
    return median(heights);
  }
  function flatShape(shape,meters){
    const positions=[],y=meters*heightScale*projection.metersToUnits+(abstraction?projection.metersToUnits*.4:.002);
    for(const polygon of shape){
      const rings=polygon.map(cleanRing).filter(r=>r.length>=3);if(!rings.length)continue;
      const points=rings.map(r=>r.map(c=>{const p=projection.project(c);return new THREE.Vector2(p.x,p.z);}));
      const faces=THREE.ShapeUtils.triangulateShape(points[0],points.slice(1)),flat=points.flat();
      for(const face of faces)for(const index of [face[0],face[2],face[1]])positions.push(flat[index].x,y,flat[index].y);
    }
    return positions;
  }
  function makeMesh(positions,material,name){if(!positions.length)return null;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.name=name;return mesh;}
  function layerFeatures(tile,name,x,y,z,callback){const layer=tile.layers[name];if(!layer)return;for(let i=0;i<layer.length;i++){const feature=layer.feature(i);callback(feature.toGeoJSON(x,y,z),feature);}}
  function drawCoarse(tile,x,y,z,tileBoundary,skipWater=false){
    check();context.save();pathShape(tileBoundary);context.clip('evenodd');
    const waterPositions=[];
    try{
    for(const name of ['landcover','landuse','park'])layerFeatures(tile,name,x,y,z,feature=>{
      const c=feature.properties.class,colors=illustrated?CITY_PALETTE:{wood:'#91ae85',forest:'#91ae85',grass:'#c7d4ae',farmland:'#dadbb2',scrub:'#b1c59b',wetland:'#b1c5b0',sand:'#e6dbb9',rock:'#d1d1b8',residential:'#e2dfce',industrial:'#d1d5ce',cemetery:'#b3c5a8',park:'#b3cca3'};
      const shape=clippedFeature(feature,tileBoundary);paintShape(shape,colors[c]||(name==='park'?'#b3cca3':'#d7dfc2'));stats.landcoverPolygons+=shape.length;
    });
    if(!skipWater)layerFeatures(tile,'water',x,y,z,feature=>{
      const shape=clippedFeature(feature,tileBoundary);if(!shape.length)return;
      const level=waterLevel(shape,feature.properties),ocean=feature.properties.class==='ocean';
      paintShape(shape,illustrated?CITY_PALETTE.water:'#aac9c1');for(const value of flatShape(shape,level))waterPositions.push(value);
      waterMask.features.push({type:'Feature',properties:{...feature.properties,ocean,waterLevelMeters:level,waterLevelEstimated:!ocean},geometry:{type:'MultiPolygon',coordinates:shape}});stats.waterPolygons+=shape.length;
    });
    for(const name of ['waterway','transportation'])layerFeatures(tile,name,x,y,z,feature=>{
      const p=feature.properties,lines=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:[];
      if(!lines.length||p.brunnel==='tunnel'||['path','track','service','ferry'].includes(p.class))return;
      if(illustrated&&name==='transportation'&&!CITY_ROAD_CLASSES.has(p.class))return;
      const major=['motorway','trunk','primary'].includes(p.class);
      context.beginPath();for(const line of lines)line.forEach((coordinate,i)=>{const [px,py]=uvPoint(coordinate);i?context.lineTo(px,py):context.moveTo(px,py);});
      context.strokeStyle=illustrated?(name==='waterway'?CITY_PALETTE.waterway:CITY_PALETTE.road):name==='waterway'?'#91b8b0':major?'#f4e9c9':p.class==='rail'?'#82938c':'#f3efdf';context.lineWidth=name==='waterway'?1.15:major?2.6:p.class==='rail'?.85:1.3;context.lineJoin='round';context.stroke();stats.roadFeatures++;if(name==='transportation')stats.roadClasses[p.class]=(stats.roadClasses[p.class]||0)+1;
    });
    layerFeatures(tile,'place',x,y,z,feature=>{
      const p=feature.properties;if(feature.geometry.type!=='Point'||!['city','town'].includes(p.class)||!containsCoordinate(region,feature.geometry.coordinates))return;
      const name=p['name:zh-Hans']||p['name:zh']||p.name||p['name:en'];if(!name)return;
      const coordinates=feature.geometry.coordinates,id=feature.id!=null?`osm-${feature.id}`:`place-${coordinates[0].toFixed(5)}-${coordinates[1].toFixed(5)}`;
      placeMap.set(id,{id,name,nameEn:p['name:en']||p['name:latin']||'',coordinates,class:p.class,rank:Number(p.rank)||99,province:region.properties?.id});
    });
    }finally{context.restore();}
    const mesh=makeMesh(waterPositions,waterMaterial,`Water ${z}/${x}/${y}`);if(mesh)waterGroup.add(mesh);
  }
  async function parallel(items,callback,count=4){let cursor=0;await Promise.all(Array.from({length:Math.min(count,items.length)},async()=>{while(cursor<items.length){check();await callback(items[cursor++]);}}));}
  const ready=(async()=>{
    const raw=await fetchBuffer(TILEJSON),metadata=JSON.parse(new TextDecoder().decode(raw));template=metadata.tiles?.[0];if(!template)throw new Error('Vector TileJSON does not contain a tile URL.');
    let zoom=kind==='province'?8:11,range=tileRange(bounds,zoom);while(zoom>3&&tileCount(range)>36){zoom--;range=tileRange(bounds,zoom);}
    const tiles=[];for(let y=range[1];y<=range[3];y++)for(let x=range[0];x<=range[2];x++){const boundary=tileClip(x,y,zoom);if(boundary.length)tiles.push({x,y,z:zoom,boundary});}
    stats.coarseZoom=zoom;stats.coarseTileTotal=tiles.length;context.fillStyle=illustrated?CITY_PALETTE.base:'#dce2c9';context.fillRect(0,0,canvas.width,canvas.height);report('正在读取真实水体、道路与地表…');
    await parallel(tiles,async item=>{try{const tile=await readTile(item.x,item.y,item.z);drawCoarse(tile,item.x,item.y,item.z,item.boundary);stats.coarseTiles++;}catch(error){if(error.name==='AbortError')throw error;stats.coarseFailed++;recordError(error,`${item.z}/${item.x}/${item.y}`);}report('正在铺设真实地表与道路…');});
    if(abstraction)await loadOverviewBlocks();
    check();surfaceTexture.needsUpdate=true;const places=[...placeMap.values()].sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name,'zh-CN'));stats.placeCount=places.length;onPlacesChange(places);
    if(!stats.coarseTiles)throw new Error('该区域的矢量地理数据未能加载。');
    report(stats.coarseFailed?'部分地理瓦片未能加载，已保留可用数据。':'真实水体、道路与地表已加载。');return {surfaceTexture,waterMask,places};
  })().catch(error=>{recordError(error,'coarse');throw error;});
  // Attach a handler immediately: the owner still receives rejection by awaiting ready.
  ready.catch(()=>{});

  function buildingGeometry(shape,ground,height,minHeight){
    const positions=[],bottom=(ground*heightScale+minHeight)*projection.metersToUnits,top=(ground*heightScale+height)*projection.metersToUnits;
    for(const polygon of shape){
      const rings=polygon.map(cleanRing).filter(r=>r.length>=3);if(!rings.length)continue;
      const points=rings.map(r=>r.map(c=>{const p=projection.project(c);return new THREE.Vector2(p.x,p.z);})),flat=points.flat();
      const faces=THREE.ShapeUtils.triangulateShape(points[0],points.slice(1));
      for(const face of faces)for(const index of [face[0],face[2],face[1]])positions.push(flat[index].x,top,flat[index].y);
      for(const ring of points)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];positions.push(a.x,bottom,a.y,b.x,bottom,b.y,b.x,top,b.y,a.x,bottom,a.y,b.x,top,b.y,a.x,top,a.y);}
    }
    return positions;
  }
  async function loadOverviewBlocks(){
    const z=13,cx=tileX(abstraction.center[0],z),cy=tileY(abstraction.center[1],z),items=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=cx+dx,y=cy+dy,boundary=tileClip(x,y,z);if(boundary.length)items.push({x,y,z,boundary});}
    const loaded=new Map();report('正在提取主城的真实楼群轮廓…',0,items.length);
    await parallel(items,async item=>{try{loaded.set(`${item.x}/${item.y}`,await readTile(item.x,item.y,z));stats.overviewTiles++;}catch(error){if(error.name==='AbortError')throw error;stats.overviewFailed++;stats.coarseFailed++;recordError(error,`overview ${z}/${item.x}/${item.y}`);}report('正在提取主城的真实楼群轮廓…',stats.overviewTiles,items.length);},3);
    const available=items.filter(item=>loaded.has(`${item.x}/${item.y}`));
    coverageShape=unionShapes(available.flatMap(item=>item.boundary));
    const waterById=new Map();
    for(const {x,y,boundary}of available){const tile=loaded.get(`${x}/${y}`);layerFeatures(tile,'water',x,y,z,feature=>{
      const shape=clippedFeature(feature,boundary);if(!shape.length)return;
      const id=feature.properties.id??feature.id??`${x}/${y}/${waterById.size}`,key=`${feature.properties.class}/${id}`;
      if(!waterById.has(key))waterById.set(key,{properties:{...feature.properties,sourceWaterId:id},shape:[]});
      waterById.get(key).shape.push(...shape);
    });}
    // A source lake crossing tile edges receives one estimated water level.
    // Remove all coarse water underneath this replacement surface, too.
    const outsideWater=waterMask.features.map(feature=>({...feature,geometry:{type:'MultiPolygon',coordinates:subtractShapes(polygons(feature.geometry),coverageShape)}})).filter(feature=>feature.geometry.coordinates.length);
    fineWaterFeatures=[];
    for(const value of waterById.values()){
      const shape=unionShapes(value.shape),level=waterLevel(shape,value.properties);
      fineWaterFeatures.push({type:'Feature',properties:{...value.properties,waterLevelMeters:level,waterLevelEstimated:value.properties.class!=='ocean',sourceZoom:13},geometry:{type:'MultiPolygon',coordinates:shape}});
    }
    fineWaterShape=unionShapes(fineWaterFeatures.flatMap(feature=>polygons(feature.geometry)));
    fineWaterLookup=fineWaterFeatures.flatMap(feature=>polygons(feature.geometry).map(polygon=>{
      let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;for(const p of polygon[0]){west=Math.min(west,p[0]);east=Math.max(east,p[0]);south=Math.min(south,p[1]);north=Math.max(north,p[1]);}
      return {polygon,west,south,east,north,level:feature.properties.waterLevelMeters,feature:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:polygon}}};
    }));
    waterMask.features.splice(0,waterMask.features.length,...outsideWater,...fineWaterFeatures);
    disposeGroup(waterGroup);const waterPositions=[];
    for(const feature of outsideWater)for(const value of flatShape(polygons(feature.geometry),feature.properties.waterLevelMeters))waterPositions.push(value);
    const waterMesh=makeMesh(waterPositions,waterMaterial,'Canonical water surfaces — one level per source waterbody');if(waterMesh)waterGroup.add(waterMesh);
    stats.canonicalWaterBodies=fineWaterFeatures.length;stats.canonicalWaterZoom=13;stats.surfaceCoverageTiles=available.length;
    const candidates=[];
    // Process a fixed tile order after concurrent fetches. Source feature order
    // and network timing cannot change the overview budget's spatial selection.
    for(const item of items){
      check();const {x,y,boundary}=item,tile=loaded.get(`${x}/${y}`);if(!tile)continue;
      drawCoarse(tile,x,y,z,boundary,true);
      const surface=detailSurface(tile,x,y,z,boundary,overviewGroup);
      surface.waterMaterial=createOverviewWaterSurface(surface.texture,x,y,z,boundary);
      overviewTiles.set(`${z}/${x}/${y}`,surface);
      layerFeatures(tile,'building',x,y,z,feature=>{
        const shapes=clippedBuildingFeature(feature,boundary);stats.overviewSourcePolygons+=shapes.length;
        shapes.forEach((polygon,index)=>{const metrics=sourcePolygonMetrics(polygon,projection);if(metrics.area<abstraction.minimumAreaMeters)return;candidates.push({polygon,...metrics,key:`${z}/${x}/${y}/${feature.id??'aggregate'}/${index}`});});
      });
      loaded.delete(`${x}/${y}`);
    }
    const positions=[];
    for(const candidate of stableBlockOrder(candidates,abstraction.center)){
      if(overviewSelections.length>=abstraction.maxBlocks)break;
      const ground=sampleHeight(candidate.center);if(!Number.isFinite(ground))continue;
      // z13 is already a generalized source building block. Its footprint is
      // retained exactly; a fixed display height is not a surveyed roof height.
      const data=buildingGeometry([candidate.polygon],ground,abstraction.displayHeightMeters,0);
      if(positions.length/9+data.length/9>abstraction.maxTriangles)continue;
      for(const value of data)positions.push(value);
      overviewSelections.push({key:candidate.key,coordinates:candidate.center,areaMeters:Math.round(candidate.area),triangles:data.length/9});
    }
    check();const mesh=makeMesh(positions,buildingMaterial,'Generalized source building clusters — fixed display height');if(mesh)overviewBuildings.add(mesh);
    stats.overviewBlocks=overviewSelections.length;stats.overviewTriangles=positions.length/9;stats.overviewOmitted=stats.overviewSourcePolygons-stats.overviewBlocks;
  }
  function localSurfaceHeight(coordinate){
    // Explicit source shore vertices must meet their water plane. The tiny
    // boundary tolerance only compensates for polygon-clipping roundoff.
    for(const item of fineWaterLookup){
        const {polygon,west,south,east,north}=item;
        const e=.000003;if(coordinate[0]<west-e||coordinate[0]>east+e||coordinate[1]<south-e||coordinate[1]>north+e)continue;
        if(containsCoordinate(item.feature,coordinate))return item.level;
        const cos=Math.cos(coordinate[1]*Math.PI/180);
        for(const ring of polygon)for(let i=1;i<ring.length;i++){
          const a=[(ring[i-1][0]-coordinate[0])*cos,ring[i-1][1]-coordinate[1]],b=[(ring[i][0]-coordinate[0])*cos,ring[i][1]-coordinate[1]],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy||1)));
          if(Math.hypot(a[0]+t*dx,a[1]+t*dy)*111320<.25)return item.level;
        }
    }
    return sampleHeight(coordinate);
  }
  function createOverviewWaterSurface(texture,x,y,z,boundary){
    const positions=[],uv=[];
    for(const feature of fineWaterFeatures){const shape=intersectShapes(polygons(feature.geometry),boundary);if(!shape.length)continue;for(const value of flatShape(shape,feature.properties.waterLevelMeters))positions.push(value);}
    for(let i=0;i<positions.length;i+=3){const [lon,lat]=projection.unproject(positions[i],positions[i+2]);uv.push((lon+180)/360*2**z-x,1-((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z-y));}
    // The actual road texture also crosses the flat water where the source
    // records a bridge. This adds no invented deck height or new bridge shape.
    const material=new THREE.MeshStandardMaterial({map:texture,color:'#ffffff',roughness:.74,metalness:.05,side:THREE.DoubleSide});
    const mesh=makeMesh(positions,material,`Canonical water ${z}/${x}/${y}`);if(mesh){mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));waterGroup.add(mesh);}return material;
  }
  function detailSurface(tile,x,y,z,boundary,parent=detailGroup){
    const image=document.createElement('canvas');image.width=image.height=512;const ctx=image.getContext('2d'),n=2**z;
    const ring=tileRing(x,y,z),corner=uvPoint(ring[0]),opposite=uvPoint(ring[2]);
    ctx.fillStyle=illustrated?CITY_PALETTE.base:'#dce2c9';ctx.fillRect(0,0,512,512);ctx.drawImage(canvas,corner[0],corner[1],opposite[0]-corner[0],opposite[1]-corner[1],0,0,512,512);
    const pixel=coordinate=>{const lon=(coordinate[0]+180)/360,lat=(1-Math.asinh(Math.tan(coordinate[1]*Math.PI/180))/Math.PI)/2;return [(lon*n-x)*512,(lat*n-y)*512];};
    const drawPath=shape=>{ctx.beginPath();for(const polygon of shape)for(const points of polygon){points.forEach((c,i)=>{const [a,b]=pixel(c);i?ctx.lineTo(a,b):ctx.moveTo(a,b);});ctx.closePath();}};
    ctx.save();drawPath(boundary);ctx.clip('evenodd');
    if(illustrated)for(const name of ['landcover','landuse','park'])layerFeatures(tile,name,x,y,z,feature=>{const shape=clippedFeature(feature,boundary);drawPath(shape);ctx.fillStyle=CITY_PALETTE[feature.properties.class]||(name==='park'?CITY_PALETTE.park:CITY_PALETTE.base);ctx.fill('evenodd');});
    layerFeatures(tile,'water',x,y,z,feature=>{const shape=clippedFeature(feature,boundary);drawPath(shape);ctx.fillStyle=illustrated?CITY_PALETTE.water:'#aac9c1';ctx.fill('evenodd');});
    layerFeatures(tile,'transportation',x,y,z,feature=>{
      const p=feature.properties,lines=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:[];
      if(p.brunnel==='tunnel'||p.class==='ferry'||illustrated&&!CITY_ROAD_CLASSES.has(p.class))return;ctx.beginPath();for(const line of lines)line.forEach((c,i)=>{const [a,b]=pixel(c);i?ctx.lineTo(a,b):ctx.moveTo(a,b);});
      ctx.lineWidth=['motorway','trunk','primary'].includes(p.class)?3.3:['secondary','tertiary'].includes(p.class)?2.3:p.class==='rail'?.8:1.3;
      ctx.strokeStyle=illustrated?CITY_PALETTE.road:p.class==='rail'?'#809086':['path','track'].includes(p.class)?'#c4bda1':'#fcf7e4';ctx.lineJoin='round';ctx.stroke();stats.detailRoadClasses[p.class]=(stats.detailRoadClasses[p.class]||0)+1;
    });ctx.restore();
    const landBoundary=abstraction?subtractShapes(boundary,fineWaterShape):boundary;
    const positions=[],uv=[],segments=20;
    for(let j=0;j<segments;j++)for(let i=0;i<segments;i++){
      const shape=intersectShapes([[tileRing(x*segments+i,y*segments+j,z+Math.log2(segments))]],landBoundary);
      // tileRing accepts fractional zoom, giving the exact uniform sub-grid.
      for(const polygon of shape){
        const rings=polygon.map(cleanRing).filter(r=>r.length>=3);if(!rings.length)continue;
        const vertices=rings.map(r=>r.map(c=>{const p=projection.project(c,(abstraction?localSurfaceHeight(c):sampleHeight(c))*heightScale);return {p,c};})),flat=vertices.flat();
        const faces=THREE.ShapeUtils.triangulateShape(vertices[0].map(v=>new THREE.Vector2(v.p.x,v.p.z)),vertices.slice(1).map(r=>r.map(v=>new THREE.Vector2(v.p.x,v.p.z))));
        for(const face of faces){
          if(abstraction){
            const points=face.map(i=>[Math.fround(flat[i].p.x),Math.fround(flat[i].p.z)]),a=points[0],b=points[1],c=points[2],area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2/projection.metersToUnits**2;
            if(area<2){const center=projection.unproject((a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3);if(fineWaterLookup.some(item=>center[0]>=item.west&&center[0]<=item.east&&center[1]>=item.south&&center[1]<=item.north&&containsCoordinate(item.feature,center))){stats.waterRoundoffSlivers=(stats.waterRoundoffSlivers||0)+1;continue;}}
          }
          for(const index of [face[0],face[2],face[1]]){const {p,c}=flat[index],[u,v]=pixel(c);positions.push(p.x,p.y+(abstraction?projection.metersToUnits*.8:.004),p.z);uv.push(u/512,1-v/512);}
        }
      }
    }
    const texture=new THREE.CanvasTexture(image);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const material=new THREE.MeshStandardMaterial({map:texture,roughness:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    if(illustrated)applyTerrainStyle(material,{metersToUnits:projection.metersToUnits,heightScale,contours:false,surfaceOffsetUnits:abstraction?projection.metersToUnits*.8:.004});
    const mesh=makeMesh(positions,material,`Detailed roads and water ${z}/${x}/${y}`);
    if(mesh){mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));parent.add(mesh);if(parent===detailGroup)stats.detailSurfaceTriangles+=positions.length/9;}
    return {surface:mesh,texture,material};
  }
  async function loadBuildings(item,serial,tile){
    const {x,y,z}=item,key=`${z}/${x}/${y}`;if(disposed||serial!==generation)return;
    const boundary=tileClip(x,y,z),layer=tile.layers.building;if(!boundary.length)return;
    const surface=abstraction?refineOverviewRoads(tile,x,y,z,boundary):detailSurface(tile,x,y,z,boundary);
    // Register textures before the cancellable feature loop so replacement
    // of a target also disposes an only-partially-built detail tile.
    detailTiles.set(key,{mesh:null,...surface,features:0,triangles:0,fallbacks:0});stats.buildingTiles=detailTiles.size;
    if(abstraction)return loadCityDetail(item,serial,tile,boundary,surface);
    const positions=[];let features=0,fallbacks=0,allocated=0,committed=false;
    try{
    for(let i=0;i<(layer?.length||0);i++){
      if(i%100===0){await new Promise(resolve=>setTimeout(resolve,0));if(disposed||serial!==generation)return;}
      const source=layer.feature(i),p=source.properties;if(p.hide_3d===true||p.hide_3d===1||p.hide_3d==='true')continue;
      const feature=source.toGeoJSON(x,y,z),shape=clippedBuildingFeature(feature,boundary);if(!shape.length)continue;
      const coordinates=shape[0][0],center=coordinates.reduce((a,c)=>[a[0]+c[0]/coordinates.length,a[1]+c[1]/coordinates.length],[0,0]);
      const ground=sampleHeight(center);if(!Number.isFinite(ground))continue;
      let height=Number(p.render_height),minHeight=Number(p.render_min_height)||0;if(!Number.isFinite(height)||height<=0){height=5;fallbacks++;}if(height<=minHeight)continue;
      const data=buildingGeometry(shape,ground,height,minHeight),triangles=data.length/9;
      if(reservedTriangles+triangles>triangleLimit){stats.detailTruncated=true;break;}
      // Reserve before yielding; the ordered builder owns this view's budget.
      reservedTriangles+=triangles;allocated+=triangles;
      // Avoid spread-argument limits for large footprints.
      for(const value of data)positions.push(value);features++;
    }
    if(disposed||serial!==generation)return;
    const mesh=makeMesh(positions,buildingMaterial,`Buildings ${key}`);if(mesh)detailGroup.add(mesh);
    detailTiles.set(key,{mesh,...surface,features,triangles:positions.length/9,fallbacks});stats.buildingTiles=detailTiles.size;stats.buildingFeatures+=features;stats.buildingTriangles+=positions.length/9;stats.heightFallbacks+=fallbacks;committed=true;
    }finally{if(!committed&&serial===generation)reservedTriangles-=allocated;}
  }
  function refineOverviewRoads(tile,x,y,z,boundary){
    const parent=overviewTiles.get(`13/${Math.floor(x/2)}/${Math.floor(y/2)}`);
    if(!parent?.texture)return {surface:null,texture:null,material:null};
    const image=parent.texture.image,ctx=image.getContext('2d'),px=Math.floor(x/2),py=Math.floor(y/2),n=2**13;
    const pixel=c=>[(c[0]+180)/360*n*image.width-px*image.width,(1-Math.asinh(Math.tan(c[1]*Math.PI/180))/Math.PI)/2*n*image.height-py*image.height];
    ctx.save();ctx.beginPath();for(const polygon of boundary)for(const ring of polygon){ring.forEach((c,i)=>{const[a,b]=pixel(c);i?ctx.lineTo(a,b):ctx.moveTo(a,b);});ctx.closePath();}ctx.clip('evenodd');
    layerFeatures(tile,'transportation',x,y,z,feature=>{
      const p=feature.properties;if(p.brunnel==='tunnel'||!CITY_ROAD_CLASSES.has(p.class))return;
      const lines=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:[];
      ctx.beginPath();for(const line of lines)line.forEach((c,i)=>{const[a,b]=pixel(c);i?ctx.lineTo(a,b):ctx.moveTo(a,b);});ctx.lineWidth=p.class==='secondary'?1.15:1.65;ctx.strokeStyle=CITY_PALETTE.road;ctx.lineJoin='round';ctx.stroke();stats.detailRoadClasses[p.class]=(stats.detailRoadClasses[p.class]||0)+1;
    });ctx.restore();parent.texture.needsUpdate=true;
    // Keep the canonical z13 shoreline and its flat plane. Fine tiles update
    // this same texture, never add a second, differently sampled terrain mesh.
    return {surface:null,texture:null,material:null};
  }
  async function loadCityDetail(item,serial,tile,boundary,surface){
    const {x,y,z}=item,key=`${z}/${x}/${y}`,candidates=[],anchors=abstraction.landmarks.map(l=>l.coordinates);
    layerFeatures(tile,'building',x,y,z,feature=>{
      const p=feature.properties;if(p.hide_3d===true||p.hide_3d===1||p.hide_3d==='true')return;
      clippedBuildingFeature(feature,boundary).forEach((polygon,index)=>{
        const metrics=sourcePolygonMetrics(polygon,projection),distance=Math.min(...anchors.map(a=>coordinateDistance(a,metrics.center)));
        if(distance>abstraction.detailRadiusMeters)return;
        candidates.push({polygon,...metrics,distance,p,key:`${feature.id??'source'}/${index}`});
      });
    });
    candidates.sort((a,b)=>a.distance-b.distance||b.area-a.area||a.key.localeCompare(b.key));
    const positions=[];let features=0,fallbacks=0,allocated=0,committed=false;
    try{
      for(let i=0;i<candidates.length;i++){
        if(i%100===0){await new Promise(resolve=>setTimeout(resolve,0));if(disposed||serial!==generation)return;}
        const c=candidates[i],ground=sampleHeight(c.center);if(!Number.isFinite(ground))continue;
        let height=Number(c.p.render_height),minimum=Number(c.p.render_min_height)||0;const fallback=!Number.isFinite(height)||height<=0;if(fallback)height=5;if(height<=minimum)continue;
        const data=buildingGeometry([c.polygon],ground,height,minimum),triangles=data.length/9;
        // Every tile has a fixed fair share. Tiny source fragments cannot let
        // one tile exhaust the entire scene, regardless of response ordering.
        if(allocated+triangles>triangleLimit/detailLimit||reservedTriangles+triangles>triangleLimit){stats.detailTruncated=true;continue;}
        reservedTriangles+=triangles;allocated+=triangles;for(const value of data)positions.push(value);features++;if(fallback)fallbacks++;
      }
      if(disposed||serial!==generation)return;
      const mesh=makeMesh(positions,buildingMaterial,`Attraction-near source footprints ${key}`);if(mesh)detailGroup.add(mesh);
      detailTiles.set(key,{mesh,...surface,features,triangles:positions.length/9,fallbacks});stats.buildingFeatures+=features;stats.buildingTriangles+=positions.length/9;stats.heightFallbacks+=fallbacks;committed=true;
      if(features)overviewBuildings.visible=false;
    }finally{if(!committed&&serial===generation)reservedTriangles-=allocated;}
  }
  async function buildDetailInOrder(items,serial){
    const pending=new Map();
    const prefetch=index=>{
      if(index>=items.length||disposed||serial!==generation)return;
      const {x,y,z}=items[index];
      // Fetch concurrently, but consume the resolved tiles in stable focus
      // order. Network response order cannot change which buildings fit.
      pending.set(index,readTile(x,y,z,true).then(tile=>({tile}),error=>({error})));
    };
    for(let i=0;i<Math.min(3,items.length);i++)prefetch(i);
    try{
      for(let i=0;i<items.length;i++){
        if(disposed||serial!==generation)return;
        const result=await pending.get(i);pending.delete(i);
        if(disposed||serial!==generation)return;
        prefetch(i+3);
        const item=items[i];
        try{if(result.error)throw result.error;await loadBuildings(item,serial,result.tile);}
        catch(error){if(serial===generation&&error.name!=='AbortError'){stats.detailErrors++;recordError(error,`${item.z}/${item.x}/${item.y}`);}}
      }
    }finally{pending.clear();}
  }
  function clearDetail(){generation++;for(const request of detailRequests)request.abort();detailRequests.clear();disposeGroup(detailGroup);for(const tile of detailTiles.values()){tile.texture?.dispose();tile.material?.dispose();}detailTiles.clear();reservedTriangles=0;stats.buildingTiles=stats.buildingFeatures=stats.buildingTriangles=stats.heightFallbacks=stats.detailSurfaceTriangles=0;stats.detailTruncated=false;stats.detailLoading=false;stats.detailErrors=0;overviewBuildings.visible=true;}
  function updateView({camera,target,viewportWidth=1000}){
    if(disposed||kind==='province'||!template||!camera||!target)return;
    const distance=camera.position.distanceTo(target),coordinate=projection.unproject(target.x,target.z);
    if(abstraction&&!abstraction.landmarks.some(l=>coordinateDistance(l.coordinates,coordinate)<=abstraction.detailRadiusMeters)){if(detailKey){detailKey='';clearDetail();}return;}
    const visibleHeight=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov||37)/2)/projection.metersToUnits;
    const visibleWidth=visibleHeight*Math.max(camera.aspect||1,1),tileMeters=40075016.68557849*Math.cos(coordinate[1]*Math.PI/180)/2**DETAIL_ZOOM;
    const coverage=abstraction?2:3;stats.visibleDetailWidthMeters=visibleWidth;stats.availableDetailWidthMeters=tileMeters*coverage;
    if(visibleWidth>tileMeters*coverage){if(detailKey){detailKey='';clearDetail();}return;}
    const now=performance.now();if(now-lastUpdate<350)return;lastUpdate=now;
    const cx=tileX(coordinate[0],DETAIL_ZOOM),cy=tileY(coordinate[1],DETAIL_ZOOM),key=`${cx}/${cy}`;
    if(key===detailKey)return;detailKey=key;clearDetail();const serial=generation,tiles=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=cx+dx,y=cy+dy,ring=tileRing(x,y,DETAIL_ZOOM),center=[(ring[0][0]+ring[2][0])/2,(ring[0][1]+ring[2][1])/2];if(tileClip(x,y,DETAIL_ZOOM).length)tiles.push({x,y,z:DETAIL_ZOOM,distance:abstraction?coordinateDistance(coordinate,center):dx*dx+dy*dy});}
    tiles.sort((a,b)=>a.distance-b.distance||a.y-b.y||a.x-b.x);stats.detailLoading=tiles.length>0;
    buildDetailInOrder(tiles.slice(0,detailLimit),serial).catch(error=>recordError(error,'detail')).finally(()=>{if(serial===generation)stats.detailLoading=false;});
  }
  function refreshSurfaceHeights(){if(disposed||!abstraction)return;for(const {surface}of overviewTiles.values()){const position=surface?.geometry.getAttribute('position');if(!position)continue;for(let i=0;i<position.count;i++){const c=projection.unproject(position.getX(i),position.getZ(i));position.setY(i,localSurfaceHeight(c)*heightScale*projection.metersToUnits+projection.metersToUnits*.8);}position.needsUpdate=true;surface.geometry.computeVertexNormals();surface.geometry.computeBoundingSphere();}}
  function dispose(){if(disposed)return;disposed=true;stats.disposed=true;signal?.removeEventListener('abort',dispose);for(const request of requests)request.abort();requests.clear();stats.activeRequests=0;clearDetail();disposeGroup(waterGroup);disposeGroup(overviewBuildings);disposeGroup(overviewGroup);for(const tile of overviewTiles.values()){tile.texture?.dispose();tile.material?.dispose();tile.waterMaterial?.dispose();}overviewTiles.clear();overviewSelections.length=0;coverageShape=[];fineWaterShape=[];fineWaterFeatures=[];fineWaterLookup=[];buildingExclusions=[];stats.overviewTiles=stats.overviewBlocks=stats.overviewTriangles=0;group.clear();waterMaterial.dispose();buildingMaterial.dispose();surfaceTexture.dispose();canvas.width=canvas.height=1;waterMask.features.length=0;placeMap.clear();}
  signal?.addEventListener('abort',dispose,{once:true});
  return {group,ready,updateView,refreshSurfaceHeights,dispose,get surfaceCoverage(){return coverageShape.length?{type:'MultiPolygon',coordinates:coverageShape}:null;},get surfaceTexture(){return surfaceTexture;},get waterMask(){return waterMask;},get diagnostics(){return {...stats,roadClasses:{...stats.roadClasses},detailRoadClasses:{...stats.detailRoadClasses},overviewSelections:overviewSelections.map(item=>({...item})),errors:stats.errors.slice(),detailTileStats:[...detailTiles].map(([tile,value])=>({tile,features:value.features,triangles:value.triangles,fallbacks:value.fallbacks})),reservedBuildingTriangles:reservedTriangles,activeRequests:requests.size,detailTileLimit:detailLimit,buildingTriangleLimit:triangleLimit};}};
}
