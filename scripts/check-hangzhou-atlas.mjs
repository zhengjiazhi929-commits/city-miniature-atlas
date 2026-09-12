#!/usr/bin/env node
/** Reproducible spatial checks against the actual runtime modules and sources.
 * This verifies geometry/data contracts, not visual acceptance or surveyed
 * architectural dimensions. No application files are changed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=process.env.ATLAS_SOURCE_ROOT?path.resolve(process.env.ATLAS_SOURCE_ROOT):app;
let reportPath=path.join(app,'docs/qa/hangzhou-spatial-latest.json'),requireSourceArchive=false;
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  if(args[i]==='--require-source-archive')requireSourceArchive=true;
  else if(args[i]==='--report'){
    if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('--report requires an output path.');
    reportPath=path.resolve(args[++i]);
  }else if(args[i].startsWith('--report=')){
    if(!args[i].slice(9))throw new Error('--report requires an output path.');
    reportPath=path.resolve(args[i].slice(9));
  }else throw new Error(`Unknown argument: ${args[i]}. Supported: --require-source-archive, --report <path>.`);
}
const started=performance.now();
const report={version:1,seed:20260909,options:{requireSourceArchive,reportPath},checks:[],limits:[
  'Checks geographic and numerical consistency of this local source snapshot, not current surveying accuracy.',
  'Landmark symbol sizes and tree/building counts are display choices, not measured inventories.',
  'All test tolerances, including 5 cm at transformed shoreline edges, are numerical mesh tolerances; they do not describe real-world geographic data accuracy.',
  'Numeric checks do not replace browser visual, interaction, or GPU-resource acceptance.',
]};
const check=(name,passed,details={})=>report.checks.push({name,status:passed?'passed':'failed',passed:!!passed,...details});
const hash=text=>createHash('sha256').update(text).digest('hex');
const readJson=async relative=>JSON.parse(await fs.readFile(path.join(app,relative),'utf8'));
let state=report.seed>>>0;
const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const choose=n=>Math.min(n-1,Math.floor(random()*n));
const finiteCoordinate=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
function extent(rings){const e=[Infinity,Infinity,-Infinity,-Infinity];for(const ring of rings)for(const p of ring){e[0]=Math.min(e[0],p[0]);e[1]=Math.min(e[1],p[1]);e[2]=Math.max(e[2],p[0]);e[3]=Math.max(e[3],p[1]);}return e;}
function insideRing(point,ring){
  let crossings=0;
  for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i];
    if((a[1]>point[1])===(b[1]>point[1]))continue;
    const crossingX=a[0]+(point[1]-a[1])*(b[0]-a[0])/(b[1]-a[1]);
    if(crossingX>point[0])crossings++;
  }
  return crossings%2===1;
}
const insidePolygon=(point,rings)=>insideRing(point,rings[0])&&!rings.slice(1).some(ring=>insideRing(point,ring));
function polygonIndex(polygons,step=.025){
  const bins=new Map();
  for(const rings of polygons){const bounds=extent(rings),entry={rings,bounds};for(let x=Math.floor(bounds[0]/step);x<=Math.floor(bounds[2]/step);x++)for(let y=Math.floor(bounds[1]/step);y<=Math.floor(bounds[3]/step);y++){const key=`${x},${y}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(entry);}}
  return {contains(point){return(bins.get(`${Math.floor(point[0]/step)},${Math.floor(point[1]/step)}`)||[]).some(({rings,bounds})=>point[0]>=bounds[0]&&point[0]<=bounds[2]&&point[1]>=bounds[1]&&point[1]<=bounds[3]&&insidePolygon(point,rings));}};
}
function groundDistance(a,b){const latitude=(a[1]+b[1])*.5*Math.PI/180;return Math.hypot((a[0]-b[0])*111320*Math.cos(latitude),(a[1]-b[1])*111320);}
async function importBrowserModule(relative){
  const source=await fs.readFile(path.join(app,relative),'utf8');
  report.runtimeModuleSha256??={};report.runtimeModuleSha256[relative]=hash(source);
  const vendor=pathToFileURL(path.join(app,'vendor/three.module.js')).href;
  const code=source.replace(/from\s+(['"])three\1/g,`from '${vendor}'`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

async function run(){
  const sourceText=await fs.readFile(path.join(app,'data/hangzhou-atlas/scene-data.json'),'utf8');
  const data=JSON.parse(sourceText),baked=await readJson('data/hangzhou-atlas/terrain-mesh.json');
  const projectionText=await fs.readFile(path.join(app,'src/region-projection.js'),'utf8');
  check('baked-source-hash',baked.stats.sourceSha256===hash(sourceText),{expected:baked.stats.sourceSha256,actual:hash(sourceText)});
  check('baked-projection-source-hash',baked.stats.projectionSourceSha256===hash(projectionText),{expected:baked.stats.projectionSourceSha256,actual:hash(projectionText)});
  const sourceMismatches=[],missingSources=[],sourceReadErrors=[];let verifiedSourceFiles=0;
  for(const file of data.sources.files){
    try{if(hash(await fs.readFile(path.join(root,file.path)))!==file.sha256)sourceMismatches.push(file.path);else verifiedSourceFiles++;}
    catch(error){if(error.code==='ENOENT')missingSources.push(file.path);else sourceReadErrors.push({path:file.path,error:error.message});}
  }
  const archiveFailed=sourceMismatches.length>0||sourceReadErrors.length>0||(requireSourceArchive&&missingSources.length>0);
  const archiveStatus=archiveFailed?'failed':missingSources.length?'skipped':'passed';
  check('local-geographic-source-hashes',!archiveFailed,{status:archiveStatus,passed:archiveStatus==='skipped'?null:!archiveFailed,files:data.sources.files.length,verifiedFiles:verifiedSourceFiles,required:requireSourceArchive,archiveRoot:root,missingPaths:missingSources,mismatches:sourceMismatches,readErrors:sourceReadErrors,note:missingSources.length&&!requireSourceArchive?'Original source archives are not all bundled here. Missing-file verification is skipped; every present archive was still hashed. All packaged data, baked-mesh and runtime numerical checks remain mandatory.':'Every required source file must be present and every available source hash must match.'});

  const [west,south,east,north]=data.bbox,grid=data.terrain;
  check('bbox-and-coordinate-reference',data.crs==='EPSG:4326'&&[west,south,east,north].every(Number.isFinite)&&west<east&&south<north&&west>=-180&&east<=180&&south>=-90&&north<=90,{bbox:data.bbox});
  check('dem-grid-finite-and-complete',grid.values.length===grid.width*grid.height&&grid.mask.length===grid.values.length&&grid.values.every(v=>Number.isFinite(v)&&v>=-12000&&v<=9000)&&grid.mask.every(v=>v===0||v===1)&&grid.rowOrder==='north-to-south',{width:grid.width,height:grid.height,samples:grid.values.length,rowOrder:grid.rowOrder});
  const badRings=[],outsideBbox=[];
  for(const [layer,polygons]of Object.entries({boundary:data.boundary,water:data.water.map(p=>p.rings),forest:data.forest.map(p=>p.rings),urban:data.urban.map(p=>p.rings)})){
    for(let p=0;p<polygons.length;p++)for(let r=0;r<polygons[p].length;r++){
      const ring=polygons[p][r],first=ring[0],last=ring.at(-1);
      if(ring.length<4||!ring.every(finiteCoordinate)||first[0]!==last[0]||first[1]!==last[1])badRings.push({layer,p,r});
      if(ring.some(c=>c[0]<west-1e-6||c[0]>east+1e-6||c[1]<south-1e-6||c[1]>north+1e-6))outsideBbox.push({layer,p,r});
    }
  }
  check('closed-source-polygon-rings',badRings.length===0,{invalid:badRings.slice(0,20)});
  check('source-polygons-within-municipal-bbox',outsideBbox.length===0,{outside:outsideBbox.slice(0,20)});
  check('major-road-data-contract',data.roads.every(r=>['motorway','trunk','primary','secondary'].includes(r.class)&&Array.isArray(r.points)&&r.points.length>=2&&r.points.every(finiteCoordinate)&&typeof r.bridge==='boolean'&&typeof r.tunnel==='boolean'),{roads:data.roads.length,note:'Validates the supplied data contract; road truth is bounded by the hashed source snapshot, not a mirror of the road-rendering implementation.'});

  const {cities,attractions}=await import(pathToFileURL(path.join(app,'src/catalog.js')).href);
  const [{hangzhouOverviewIds,isHangzhouOverviewPlace},{westLakePlace},{hubinPlace},{cityAirportRegistry}]=await Promise.all([
    import(pathToFileURL(path.join(app,'src/hangzhou-overview-policy.js')).href),
    import(pathToFileURL(path.join(app,'src/westlake-place.js')).href),
    import(pathToFileURL(path.join(app,'src/hubin-place.js')).href),
    import(pathToFileURL(path.join(app,'src/city-airports.js')).href),
  ]);
  const city=cities.find(c=>c.id==='hangzhou'),ids=data.landmarks.map(l=>l.id);
  // This list is the user's approved overview scope, independent of the runtime
  // policy. Source records outside it remain valid archives and sub-scenes.
  const required=['westlake','xiaohe','faxi','lingyin','leifeng','longmen','tianmu','xixi','olympic','hubin-yintai','qiandao'];
  const sameIds=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
  const airportRegistry=cityAirportRegistry.hangzhou,airports=await Promise.all((airportRegistry?.files||[]).map(file=>readJson(`data/airports/${file}.json`)));
  const runtimePlaceIds=[...data.landmarks,westLakePlace,hubinPlace].filter(isHangzhouOverviewPlace).map(l=>l.id);
  check('curated-overview-eleven-places-plus-airport',sameIds(city.attractions,required)&&sameIds(hangzhouOverviewIds,required)&&sameIds(runtimePlaceIds,required)&&required.every(id=>attractions[id]?.city==='hangzhou')&&airportRegistry?.status==='inside'&&airports.length===1&&airports[0].id==='zshc'&&airports[0].iata==='HGH'&&airports[0].cityId==='hangzhou',{requiredOverviewPlaces:required,airportIds:airports.map(a=>a.id),totalOverviewItems:runtimePlaceIds.length+airports.length,note:'Exactly the approved 11 tourism places and Xiaoshan airport; archived source landmarks are not required to remain city-overview markers.'});
  const mismatches=[],missingInData=city.attractions.filter(id=>!ids.includes(id)),supplementalIds=['westlake','hubin-yintai'];let maxAnchorError=0;
  for(const landmark of data.landmarks){
    const item=attractions[landmark.id];
    if(!item||!finiteCoordinate(item.coordinates)){mismatches.push({id:landmark.id,reason:'Missing catalog coordinate'});continue;}
    const error=groundDistance(item.coordinates,landmark.coordinates);maxAnchorError=Math.max(maxAnchorError,error);
    if(error>.05||item.city!=='hangzhou'||item.coordinateSource!==landmark.source)mismatches.push({id:landmark.id,errorMeters:error,catalogSource:item.coordinateSource,dataSource:landmark.source});
  }
  check('landmark-catalog-anchor-consistency',mismatches.length===0&&sameIds(missingInData,supplementalIds)&&new Set(ids).size===ids.length&&new Set(city.attractions).size===city.attractions.length,{dataLandmarks:ids.length,catalogOverviewPlaces:city.attractions.length,maxAnchorErrorMeters:maxAnchorError,toleranceMeters:.05,mismatches,supplementalIds:missingInData,note:'Every original source anchor, including archived non-overview places, still matches its catalog coordinate and source; the two later additions are independently checked below.'});

  const westLakeData=await readJson('data/scenes/westlake/scene-data.json'),mainLakes=westLakeData.water.filter(p=>p.id==='westlake-water');
  const mainLake=mainLakes[0],sourceLakes=data.water.filter(p=>p.areaMeters===westLakeData.stats.mainLakeOriginalAreaMeters);
  const westLakeSourceErrors=[];
  for(const source of westLakeData.source.localSources){if(hash(await fs.readFile(path.join(app,source.path)))!==source.sha256)westLakeSourceErrors.push(source.path);}
  const westLakeSourceNotice=await fs.readFile(path.resolve(app,westLakePlace.coordinateSource),'utf8');
  check('west-lake-added-anchor-and-source-water',westLakePlace.category==='scenic-area'&&finiteCoordinate(westLakePlace.coordinates)&&mainLakes.length===1&&sourceLakes.length===1&&JSON.stringify(mainLake.rings)===JSON.stringify(sourceLakes[0].rings)&&insidePolygon(westLakePlace.coordinates,mainLake.rings)&&groundDistance(attractions.westlake.coordinates,westLakePlace.coordinates)<.05&&attractions.westlake.coordinateSource===westLakePlace.coordinateSource&&typeof attractions.westlake.create==='function'&&westLakeSourceErrors.length===0&&westLakeSourceNotice.includes('OpenStreetMap'),{coordinate:westLakePlace.coordinates,coordinateRole:westLakePlace.coordinateRole,sourceNotice:westLakePlace.coordinateSource,mainLakeMatchesMunicipalSource:JSON.stringify(mainLake?.rings)===JSON.stringify(sourceLakes[0]?.rings),sourceHashErrors:westLakeSourceErrors,note:'The scenic-area anchor lies inside the unchanged source lake; it is a display point, not an official centroid or entrance.'});

  const footprint=hubinPlace.sourceFootprintCoordinates,origin=footprint[0];let crossSum=0,cx=0,cy=0;
  for(let i=1;i<footprint.length;i++){const a=[footprint[i-1][0]-origin[0],footprint[i-1][1]-origin[1]],b=[footprint[i][0]-origin[0],footprint[i][1]-origin[1]],cross=a[0]*b[1]-b[0]*a[1];crossSum+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross;}
  const hubinCentroid=[origin[0]+cx/(3*crossSum),origin[1]+cy/(3*crossSum)],hubinError=groundDistance(hubinCentroid,hubinPlace.coordinates);
  check('hubin-added-anchor-matches-source-footprint',footprint.length>=4&&footprint.every(finiteCoordinate)&&JSON.stringify(footprint[0])===JSON.stringify(footprint.at(-1))&&finiteCoordinate(hubinCentroid)&&hubinError<.05&&insidePolygon(hubinPlace.coordinates,[footprint])&&groundDistance(attractions['hubin-yintai'].coordinates,hubinPlace.coordinates)<.05&&hubinPlace.coordinateSource==='https://www.openstreetmap.org/way/109882469'&&attractions['hubin-yintai'].coordinateSource===hubinPlace.coordinateSource&&attractions['hubin-yintai'].overviewOnly===true&&attractions['hubin-yintai'].create===undefined,{source:hubinPlace.coordinateSource,coordinate:hubinPlace.coordinates,independentAreaCentroid:hubinCentroid,errorMeters:hubinError,toleranceMeters:.05,note:'Recomputes the named A-district source polygon centroid; does not treat it as the centre of every in77 district.'});
  const santan=data.landmarks.find(l=>l.id==='santan'),lakeSantan=westLakeData.landmarks.find(l=>l.id==='santan');
  check('santan-retains-independent-scene-and-original-anchor',!city.attractions.includes('santan')&&!isHangzhouOverviewPlace('santan')&&attractions.santan?.city==='hangzhou'&&typeof attractions.santan.create==='function'&&!!santan&&!!lakeSantan&&groundDistance(santan.coordinates,lakeSantan.coordinates)<.05&&lakeSantan.source===santan.source,{overviewMarker:false,catalogSceneAvailable:typeof attractions.santan?.create==='function',westLakeChildAnchor:lakeSantan?.coordinates,note:'Checks independent scene registration and the West Lake child source contract; browser scene navigation is validated separately.'});
  const airport=airports[0],airportSourcesFailed=[];
  for(const source of airport?.sourceSnapshots||[]){if(hash(await fs.readFile(path.join(app,'data/airports',source.path)))!==source.sha256)airportSourcesFailed.push(source.path);}
  check('xiaoshan-airport-retains-inside-city-sourced-anchor',!!airport&&finiteCoordinate(airport.coordinates)&&data.boundary.some(rings=>insidePolygon(airport.coordinates,rings))&&airport.boundary.some(rings=>insidePolygon(airport.coordinates,rings))&&airport.crs==='EPSG:4326'&&airport.anchor?.source?.url===airport.boundarySource?.url&&airport.anchor.source.url==='https://www.openstreetmap.org/way/328062510'&&airport.sourceSnapshots.length>0&&airportSourcesFailed.length===0,{coordinate:airport?.coordinates,source:airport?.anchor?.source?.url,sourceHashErrors:airportSourcesFailed,note:'Airport stays within the municipal and sourced aerodrome boundaries; it is not relocated into a tourism cluster.'});

  const {createRegionProjection}=await importBrowserModule('src/region-projection.js');
  const {createHangzhouDisplayProjection}=await importBrowserModule('src/hangzhou-display-projection.js');
  const {createHangzhouSurfaceSampler,orientHangzhouSurface}=await importBrowserModule('src/hangzhou-surface.js');
  const region={type:'Feature',properties:{id:'hangzhou'},geometry:{type:'MultiPolygon',coordinates:data.boundary}};
  const base=createRegionProjection(region),projection=createHangzhouDisplayProjection(base),boundary=polygonIndex(data.boundary),water=polygonIndex(data.water.map(p=>p.rings));
  check('landmarks-inside-boundary',data.landmarks.every(l=>boundary.contains(l.coordinates)),{landmarks:ids.length});
  let maxRoundtrip=0,maxHeightError=0;const cityPoints=[];
  for(let attempt=0;cityPoints.length<1500&&attempt<20000;attempt++){const p=[west+random()*(east-west),south+random()*(north-south)];if(boundary.contains(p))cityPoints.push(p);}
  for(const coord of [...cityPoints,...data.landmarks.map(l=>l.coordinates),projection.displayPolicy.center]){
    const elevation=-100+random()*2200,point=projection.project(coord,elevation),recovered=projection.unproject(point.x,point.z);
    maxRoundtrip=Math.max(maxRoundtrip,groundDistance(coord,recovered));maxHeightError=Math.max(maxHeightError,Math.abs(point.y-elevation*base.metersToUnits));
  }
  check('display-projection-roundtrip',cityPoints.length===1500&&maxRoundtrip<.01&&maxHeightError<1e-10,{municipalSamples:cityPoints.length,extraLandmarkAndCenterSamples:ids.length+1,maxHorizontalErrorMeters:maxRoundtrip,toleranceMeters:.01,maxVerticalWorldError:maxHeightError,displayPolicy:projection.displayPolicy});
  let maxWarpError=0,maxUnwarpError=0,maxBaseProjectionError=0,identityProbes=0,invalidIdentityValues=0;
  const identityAt=(x,z)=>{
    const warped=projection.warp(x,z),unwarped=projection.unwarp(x,z);identityProbes++;
    if(![...warped,...unwarped].every(Number.isFinite)){invalidIdentityValues++;return;}
    maxWarpError=Math.max(maxWarpError,Math.hypot(warped[0]-x,warped[1]-z));
    maxUnwarpError=Math.max(maxUnwarpError,Math.hypot(unwarped[0]-x,unwarped[1]-z));
  };
  const geographicIdentityPoints=[...cityPoints,...data.boundary.flat(2),...data.water.flatMap(p=>p.rings.flat()),...data.roads.flatMap(r=>r.points),...data.landmarks.map(l=>l.coordinates),westLakePlace.coordinates,hubinPlace.coordinates,airport.coordinates];
  for(const coordinate of geographicIdentityPoints){
    const original=base.project(coordinate,0),display=projection.project(coordinate,0);
    if(![original.x,original.z,display.x,display.z].every(Number.isFinite)){invalidIdentityValues++;continue;}
    maxBaseProjectionError=Math.max(maxBaseProjectionError,Math.hypot(original.x-display.x,original.z-display.z));identityAt(original.x,original.z);
  }
  for(let i=0;i<baked.positions.length;i+=3)identityAt(baked.positions[i],baked.positions[i+2]);
  const identityTolerance=1e-10;
  check('display-projection-is-global-horizontal-identity',invalidIdentityValues===0&&maxWarpError<identityTolerance&&maxUnwarpError<identityTolerance&&maxBaseProjectionError<identityTolerance&&projection.displayPolicy.horizontalDeformation===false&&projection.displayPolicy.centerScale===1&&projection.displayPolicy.localizedLenses.length===0,{geographicSamples:geographicIdentityPoints.length,bakedVertexSamples:baked.positions.length/3,identityProbes,maxWarpWorldError:maxWarpError,maxUnwarpWorldError:maxUnwarpError,maxBaseProjectionWorldError:maxBaseProjectionError,invalidIdentityValues,toleranceWorldUnits:identityTolerance,note:'Checks the complete municipal terrain vertices plus source boundary, water, road and landmark points against the unchanged regional projection; no obsolete radial-lens parameters or a main-city-only sample.'});

  const vertexCount=baked.positions.length/3,triangleCount=baked.indices.length/3;
  check('baked-mesh-buffer-and-index-contract',Number.isInteger(vertexCount)&&Number.isInteger(triangleCount)&&baked.positions.every(Number.isFinite)&&baked.indices.every(i=>Number.isInteger(i)&&i>=0&&i<vertexCount)&&baked.projection==='region-40-webmercator',{vertices:vertexCount,triangles:triangleCount});
  const positions=new Float32Array(baked.positions),heightScale=14,heightFactor=base.metersToUnits*heightScale;
  let negativeRawVertices=0,minRaw=Infinity,minDisplay=Infinity,maxDisplay=-Infinity;
  for(let i=0;i<positions.length;i+=3){
    const raw=positions[i+1];minRaw=Math.min(minRaw,raw);if(raw<0)negativeRawVertices++;
    const [x,z]=projection.warp(positions[i],positions[i+2]);positions[i]=x;positions[i+2]=z;positions[i+1]=Math.max(0,raw)*heightFactor;
    minDisplay=Math.min(minDisplay,positions[i+1]);maxDisplay=Math.max(maxDisplay,positions[i+1]);
  }
  check('display-negative-dem-policy',minDisplay>=0&&(negativeRawVertices===0||minDisplay===0),{policy:'Raw source and baked DEM stay unchanged, including negatives. Display vertices use max(0, raw DEM) before vertical exaggeration.',negativeRawVertices,minRawElevationMeters:minRaw,minDisplayWorldY:minDisplay,maxDisplayWorldY:maxDisplay,heightScale,heightFactor});
  const originalIndicesHash=hash(JSON.stringify(baked.indices));
  const oriented=orientHangzhouSurface(positions,baked.indices),displayIndices=oriented.indices,displayTriangleCount=displayIndices.length/3;
  check('oriented-index-range-and-source-preservation',displayIndices.every(i=>Number.isInteger(i)&&i>=0&&i<vertexCount)&&Number.isInteger(displayTriangleCount)&&displayTriangleCount===triangleCount-oriented.degenerate&&hash(JSON.stringify(baked.indices))===originalIndicesHash,{sourceTriangles:triangleCount,displayTriangles:displayTriangleCount,reorientedTriangles:oriented.flipped,discardedDegenerateTriangles:oriented.degenerate,sourceIndicesUnchanged:hash(JSON.stringify(baked.indices))===originalIndicesHash});
  const faceKey=(array,offset)=>array.slice(offset,offset+3).sort((a,b)=>a-b).join(',');
  const sourceFaces=new Map();for(let i=0;i<baked.indices.length;i+=3){const key=faceKey(baked.indices,i);sourceFaces.set(key,(sourceFaces.get(key)||0)+1);}
  let newOrRepeatedFaces=0;
  for(let i=0;i<displayIndices.length;i+=3){const key=faceKey(displayIndices,i),remaining=sourceFaces.get(key)||0;if(!remaining)newOrRepeatedFaces++;else sourceFaces.set(key,remaining-1);}
  const removedSourceFaces=[...sourceFaces.values()].reduce((a,b)=>a+b,0);
  check('orientation-does-not-invent-triangles',newOrRepeatedFaces===0&&removedSourceFaces===oriented.degenerate,{newOrRepeatedFaces,removedSourceFaces});
  let downward=0,collapsed=0,largestReversedArea=0,reversedArea=0;const reversedExamples=[];
  for(let i=0;i<displayIndices.length;i+=3){const[a,b,c]=displayIndices.slice(i,i+3).map(v=>v*3);const signed=(positions[b]-positions[a])*(positions[c+2]-positions[a+2])-(positions[b+2]-positions[a+2])*(positions[c]-positions[a]);if(signed===0)collapsed++;if(signed>0){downward++;largestReversedArea=Math.max(largestReversedArea,signed/2);reversedArea+=signed/2;if(reversedExamples.length<6)reversedExamples.push({triangle:i/3,areaWorldUnits:signed/2});}}
  check('warped-terrain-triangles-face-up',downward===0&&collapsed===0,{triangles:displayTriangleCount,reversedTriangles:downward,collapsedTriangles:collapsed,largestReversedAreaWorldUnits:largestReversedArea,totalReversedAreaWorldUnits:reversedArea,examples:reversedExamples});

  const sampler=createHangzhouSurfaceSampler(positions,displayIndices,projection,heightFactor);
  const rayThree=await import(pathToFileURL(path.join(app,'vendor/three.module.js')).href),rayGeometry=new rayThree.BufferGeometry();
  rayGeometry.setAttribute('position',new rayThree.Float32BufferAttribute(positions,3));rayGeometry.setIndex(displayIndices);
  const rayMesh=new rayThree.Mesh(rayGeometry,new rayThree.MeshBasicMaterial({side:rayThree.FrontSide}));rayMesh.updateMatrixWorld(true);
  const ray=new rayThree.Raycaster();
  let heightError=0,uniquePlaneError=0,misses=0,uniqueSurfaceSamples=0,overlapSamples=0,maxUnderlyingPlaneDifference=0;const failures=[],overlapExamples=[];
  for(let sample=0;sample<1500;sample++){
    const triangle=choose(displayTriangleCount),offset=triangle*3,[a,b,c]=displayIndices.slice(offset,offset+3).map(v=>v*3);
    // Strict interior barycentric weights give an independent original plane.
    // A separate Three.js vertical ray determines the visible top plane when
    // nonlinear transformation leaves several overlapping coastal slivers.
    const values=[.2+random(),.2+random(),.2+random()],sum=values.reduce((s,v)=>s+v,0),weights=values.map(v=>v/sum);
    const x=weights[0]*positions[a]+weights[1]*positions[b]+weights[2]*positions[c];
    const z=weights[0]*positions[a+2]+weights[1]*positions[b+2]+weights[2]*positions[c+2];
    const expected=(weights[0]*positions[a+1]+weights[1]*positions[b+1]+weights[2]*positions[c+1])/heightFactor;
    const observed=sampler.sample(projection.unproject(x,z));
    if(observed==null){misses++;if(failures.length<8)failures.push({triangle,reason:'No surface sample'});continue;}
    ray.set(new rayThree.Vector3(x,100,z),new rayThree.Vector3(0,-1,0));
    const intersections=ray.intersectObject(rayMesh,false).map(hit=>({triangle:hit.faceIndex,elevationMeters:hit.point.y/heightFactor}));
    if(!intersections.length){misses++;if(failures.length<8)failures.push({triangle,reason:'No independent vertical ray intersection'});continue;}
    const visibleExpected=intersections[0].elevationMeters;
    const distinctPlanes=intersections.some(hit=>Math.abs(hit.elevationMeters-visibleExpected)>1e-5);
    if(distinctPlanes){overlapSamples++;maxUnderlyingPlaneDifference=Math.max(maxUnderlyingPlaneDifference,Math.abs(expected-visibleExpected));if(overlapExamples.length<6)overlapExamples.push({triangle,originalPlaneMeters:expected,visibleTopPlaneMeters:visibleExpected,intersections:intersections.slice(0,6)});}
    else{uniqueSurfaceSamples++;uniquePlaneError=Math.max(uniquePlaneError,Math.abs(observed-expected));}
    const error=Math.abs(observed-visibleExpected);heightError=Math.max(heightError,error);
    if(error>.02&&failures.length<8){
      failures.push({triangle,expectedVisibleMeters:visibleExpected,originalPlaneMeters:expected,observedMeters:observed,errorMeters:error,worldXZ:[x,z],coordinate:projection.unproject(x,z),intersections:intersections.slice(0,6)});
    }
  }
  check('surface-sampler-matches-rendered-triangle-planes',misses===0&&heightError<.02&&uniquePlaneError<.02,{samples:1500,misses,uniqueSurfaceSamples,overlapSamples,maxVisiblePlaneErrorMeters:heightError,maxUniqueOriginalPlaneErrorMeters:uniquePlaneError,toleranceMeters:.02,indexBins:sampler.bins,failures,note:'Unique coverage points must match their original barycentric plane. Overlaps must match the independent vertical ray first hit, the same top surface visible to the renderer.'});
  report.overlapDiagnostics={samples:overlapSamples,maxUnderlyingPlaneDifferenceMeters:maxUnderlyingPlaneDifference,examples:overlapExamples,note:'Overlapping coastal slivers remain disclosed; numerical QA does not claim that the deformed mesh is perfectly non-overlapping.'};
  rayMesh.geometry.dispose();rayMesh.material.dispose();
  sampler.dispose();

  let waterIntrusions=0,warpedWaterIntrusions=0,outsideBoundary=0,deepWaterIntrusions=0,maxShorelineIntrusion=0;const waterFailures=[],warpedWaterFailures=[];
  const shorelineToleranceMeters=.05;
  for(let sample=0;sample<1200;sample++){
    const triangle=choose(displayTriangleCount),offset=triangle*3,indices=displayIndices.slice(offset,offset+3).map(v=>v*3);
    const x=indices.reduce((sum,i)=>sum+baked.positions[i],0)/3,z=indices.reduce((sum,i)=>sum+baked.positions[i+2],0)/3;
    const coord=base.unproject(x,z);
    if(water.contains(coord)){waterIntrusions++;if(waterFailures.length<8)waterFailures.push({triangle,coordinate:coord});}
    if(!boundary.contains(coord))outsideBoundary++;
    const displayX=indices.reduce((sum,i)=>sum+positions[i],0)/3,displayZ=indices.reduce((sum,i)=>sum+positions[i+2],0)/3;
    const displayCoord=projection.unproject(displayX,displayZ);
    if(water.contains(displayCoord)){
      warpedWaterIntrusions++;
      {
        const longitudeMeters=111320*Math.cos(displayCoord[1]*Math.PI/180);let shorelineDistance=Infinity;
        for(const feature of data.water){const bounds=extent(feature.rings);if(displayCoord[0]<bounds[0]||displayCoord[0]>bounds[2]||displayCoord[1]<bounds[1]||displayCoord[1]>bounds[3]||!insidePolygon(displayCoord,feature.rings))continue;
          for(const ring of feature.rings)for(let j=1;j<ring.length;j++){
            const a=[(ring[j-1][0]-displayCoord[0])*longitudeMeters,(ring[j-1][1]-displayCoord[1])*111320],b=[(ring[j][0]-displayCoord[0])*longitudeMeters,(ring[j][1]-displayCoord[1])*111320],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/den)):0;
            shorelineDistance=Math.min(shorelineDistance,Math.hypot(a[0]+t*dx,a[1]+t*dy));
          }
        }
        maxShorelineIntrusion=Math.max(maxShorelineIntrusion,shorelineDistance);
        if(shorelineDistance>shorelineToleranceMeters)deepWaterIntrusions++;
        if(warpedWaterFailures.length<8)warpedWaterFailures.push({triangle,sourceCentroid:coord,inverseWarpedCentroid:displayCoord,distanceInsideShoreMeters:shorelineDistance});
      }
    }
  }
  check('terrain-centroids-exclude-source-water',waterIntrusions===0&&outsideBoundary===0,{samples:1200,sourceWaterIntrusions:waterIntrusions,outsideMunicipalBoundary:outsideBoundary,failures:waterFailures});
  check('warped-terrain-centroids-exclude-source-water',deepWaterIntrusions===0,{samples:1200,waterIntrusions:warpedWaterIntrusions,intrusionsBeyondTolerance:deepWaterIntrusions,maximumShorelineIntrusionMeters:maxShorelineIntrusion,shorelineToleranceMeters,examples:warpedWaterFailures,note:'Actual transformed triangle centers are checked against inverse-projected source water. The 5 cm threshold is a numerical mesh tolerance for Float32/curved-edge tessellation only, not source geographic accuracy; source-space clipping above remains strict.'});
  const westLakePoints=[[120.14,30.246],[120.143,30.25],[120.15,30.246],[120.136,30.245]];
  check('west-lake-source-water-present',westLakePoints.every(p=>water.contains(p)),{independentLakePoints:westLakePoints,note:'These are water-interior checks, not the locations of the three stone pagodas.'});

  report.source={sceneDataSha256:hash(sourceText),bakedMeshSha256:hash(await fs.readFile(path.join(app,'data/hangzhou-atlas/terrain-mesh.json'))),projectionSourceSha256:hash(projectionText)};
}

try{await run();}catch(error){check('qa-execution',false,{error:error.message,stack:error.stack?.split('\n').slice(0,6)});}
report.passed=report.checks.every(c=>c.status!=='failed');report.elapsedMilliseconds=Math.round(performance.now()-started);
report.summary={passed:report.checks.filter(c=>c.status==='passed').length,failed:report.checks.filter(c=>c.status==='failed').length,skipped:report.checks.filter(c=>c.status==='skipped').length};
await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.passed,passedTests:report.summary.passed,failedTests:report.summary.failed,skippedTests:report.summary.skipped,elapsedMilliseconds:report.elapsedMilliseconds,report:reportPath,failures:report.checks.filter(c=>c.status==='failed'),skipped:report.checks.filter(c=>c.status==='skipped').map(c=>({name:c.name,missingPaths:c.missingPaths}))}));
if(!report.passed)process.exitCode=1;
