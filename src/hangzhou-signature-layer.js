import * as THREE from 'three';
import {createSignatureBuilding} from './hangzhou-signature-buildings.js';
import {createLandFootprintGuard} from './hangzhou-footprint-guard.js';
import {groundModelOnTerrain} from './hangzhou-model-grounding.js';
import {sourceRoadExclusions} from './source-road-exclusions.js';

// Source anchors/label leaders never move; representative models may shift
// by up to 1500 source metres on the same major river bank. Envelope enlargement is a cartographic display
// choice, fitted against the same real water, airport and municipal boundaries.
const COPY={"hangzhou-gate":{"descriptionZh":"两座曲面玻璃塔通过中部连桥相接，拱形下腹形成鲜明轮廓。","districtLabel":"奥体·钱江世纪城"},"civic-center":{"descriptionZh":"六座高楼围合开放中庭，高位连接形成连续的环状轮廓。","districtLabel":"钱江新城"},"conference-center":{"descriptionZh":"金色球体嵌入低矮的椭圆附属建筑，是钱塘江北岸的标志建筑。","districtLabel":"钱江新城"},"big-lotus":{"descriptionZh":"开放式椭圆体育场，28片大花瓣与27片小花瓣交叠，中央保留田径场。","districtLabel":"奥体片区"},"small-lotus":{"descriptionZh":"近圆形网球馆，24片固定花瓣围合场馆，8片可旋转屋盖组成顶部。","districtLabel":"奥体片区"},"hangzhou-center":{"descriptionZh":"两座矩形玻璃塔立于多层商业裙房之上，退台屋顶带有花园。","districtLabel":"武林片区"},"efc":{"descriptionZh":"细长的玻璃双塔以竖向框架强调轮廓，周边分布较宽楼体与低层商业。","districtLabel":"未来科技城"},"alibaba-xixi-c":{"descriptionZh":"六栋中层办公楼与访客中心围绕开放庭园，通过共享空间与连桥组织园区。","districtLabel":"未来科技城·西溪C区"}};
const WIDTHS={'hangzhou-gate':1.0,'civic-center':1.2,'conference-center':1.05,'big-lotus':1.25,'small-lotus':.95,'hangzhou-center':1.1076923076923078,efc:1.3,'alibaba-campus':1.3};
const HEIGHTS={'hangzhou-gate':1.677,'civic-center':1.25,'hangzhou-center':1.8,efc:1.56,'alibaba-campus':.75};
const HEIGHT_ASPECT={'hangzhou-gate':3.744,'civic-center':2.4,'hangzhou-center':4.2,efc:3.588,'alibaba-campus':.9};
const MINIMUM_WIDTH={'hangzhou-gate':.15,'civic-center':.16,'conference-center':.11,'big-lotus':.09,'small-lotus':.07,'hangzhou-center':.14,efc:.18,'alibaba-campus':.13};
// Match the closer block view by shrinking complete landmarks uniformly.
for(const table of [WIDTHS,HEIGHTS,MINIMUM_WIDTH]) for(const key of Object.keys(table)) table[key]*=.5;
const PROPORTIONAL_HEIGHT={'conference-center':1.03,'big-lotus':1.3,'small-lotus':1.1};
// Reproducible cartographic arrangement. Every replay still rechecks current
// projected physical silhouettes, actual land/water, bank and model separation.
const BASE_LAYOUT={"revision":"fixed-base-joint-seed-from-broad-footprints-0.4","registrySha256":"2ec74f45cee1ef6319317e44ee178fe88abb01b511daec769e8279979375b0b2","modelSha256":"242bdc741df5bf3797377c8d33b013431532512c0166d9598f973e6396dc9dde","placements":{"hangzhou-gate":{"coordinates":[120.23255605,30.22974409],"sizeMeters":[156.2458267211914,310,174.7729949951172],"east":791.2658773651216,"north":745.5127018921823,"distance":1087.1480475836686,"sector":0,"fit":0.24,"displayWidth":0.24},"civic-center":{"coordinates":[120.20521943,30.248993],"sizeMeters":[158.67515563964844,110,142.373291015625],"east":0.0,"north":500.00000000016115,"distance":500,"sector":0,"fit":0.32000000000000006,"displayWidth":0.384},"conference-center":{"coordinates":[120.20918315,30.24488676],"sizeMeters":[160.55548095703125,85,150.94052124023438],"east":-1190.7849302034558,"north":-687.499999999925,"distance":1375,"sector":0,"fit":0.2,"displayWidth":0.21000000000000002},"big-lotus":{"coordinates":[120.22441242,30.23169573],"sizeMeters":[265.5717468261719,65,318.3620300292969],"east":-187.49999999939976,"north":-324.75952641903643,"distance":375,"sector":0,"fit":0.128,"displayWidth":0.16000000000000003},"small-lotus":{"coordinates":[120.22899371,30.22982347],"sizeMeters":[135.05532836914062,48,134.134521484375],"east":-601.2790121880138,"north":-1182.15419838403,"distance":1326.2823980037424,"sector":0,"fit":0.12,"displayWidth":0.11399999999999999},"hangzhou-center":{"coordinates":[120.16093467,30.27499438],"sizeMeters":[145.4091567993164,130,155.57342529296875],"east":563.2488351417201,"north":-988.605814759145,"distance":1137.8008205588974,"sector":0,"fit":0.32000000000000006,"displayWidth":0.35446153846153855},"efc":{"coordinates":[119.99718097,30.28316965],"sizeMeters":[200.15008544921875,220,219.2638931274414],"east":-683.0127018922767,"north":-250.00000000008058,"distance":727.3282277942499,"sector":0,"fit":0.27999999999999997,"displayWidth":0.364},"alibaba-xixi-c":{"coordinates":[120.01851444,30.28577736],"sizeMeters":[693.3581237792969,80,516.9788818359375],"east":191.51111077988364,"north":-160.69690242156668,"distance":250,"sector":0,"fit":0.12996923076923078,"displayWidth":0.16896}},"layoutKey":""};
const FROZEN_LAYOUT={"revision":"2026-09-09-fixed-global-geography-joint-v0.9.2","registrySha256":"2ec74f45cee1ef6319317e44ee178fe88abb01b511daec769e8279979375b0b2","modelSha256":"242bdc741df5bf3797377c8d33b013431532512c0166d9598f973e6396dc9dde","placements":{"hangzhou-gate":{"coordinates":[120.23255605,30.22974409],"sizeMeters":[156.2458267211914,310,174.7729949951172],"east":500.00000000006685,"north":866.0254037843608,"distance":1000,"sector":0,"fit":0.3,"displayWidth":0.3},"civic-center":{"coordinates":[120.20521943,30.248993],"sizeMeters":[158.67515563964844,110,142.373291015625],"east":0.0,"north":999.9999999999268,"distance":1000,"sector":0,"fit":0.4,"displayWidth":0.48},"conference-center":{"coordinates":[120.20918315,30.24488676],"sizeMeters":[160.55548095703125,85,150.94052124023438],"east":-1190.7849302034558,"north":-687.499999999925,"distance":1375,"sector":0,"fit":0.25,"displayWidth":0.2625},"big-lotus":{"coordinates":[120.22441242,30.23169573],"sizeMeters":[265.5717468261719,65,318.3620300292969],"east":-187.49999999939976,"north":-324.75952641903643,"distance":375,"sector":0,"fit":0.16,"displayWidth":0.2},"small-lotus":{"coordinates":[120.22899371,30.22982347],"sizeMeters":[135.05532836914062,48,134.134521484375],"east":-601.2790121880138,"north":-1182.15419838403,"distance":1326.2823980037424,"sector":0,"fit":0.16,"displayWidth":0.152},"hangzhou-center":{"coordinates":[120.16093467,30.27499438],"sizeMeters":[145.4091567993164,130,155.57342529296875],"east":745.0000000006527,"north":-1290.3778516388638,"distance":1490,"sector":0,"fit":0.4,"displayWidth":0.44307692307692315},"efc":{"coordinates":[119.99718097,30.28316965],"sizeMeters":[200.15008544921875,220,219.2638931274414],"east":-999.9999999997196,"north":0.0,"distance":1000,"sector":0,"fit":0.4,"displayWidth":0.52},"alibaba-xixi-c":{"coordinates":[120.01851444,30.28577736],"sizeMeters":[693.3581237792969,80,516.9788818359375],"east":0.0,"north":999.9999999999268,"distance":1000,"sector":0,"fit":0.2,"displayWidth":0.26}},"layoutKey":"{\"projection\":{\"revision\":\"hangzhou-base-geography-v0.9.2\",\"lenses\":[]},\"widths\":{\"hangzhou-gate\":1,\"civic-center\":1.2,\"conference-center\":1.05,\"big-lotus\":1.25,\"small-lotus\":0.95,\"hangzhou-center\":1.1076923076923078,\"efc\":1.3,\"alibaba-campus\":1.3},\"heights\":{\"hangzhou-gate\":2.15,\"civic-center\":1.25,\"hangzhou-center\":1.8,\"efc\":2,\"alibaba-campus\":0.75},\"proportionalHeight\":{\"conference-center\":1.03,\"big-lotus\":1.3,\"small-lotus\":1.1},\"heightAspectLimit\":2,\"maxSourceOffsetMeters\":1500}"};
function convexHull(source){
 const unique=new Map();for(const p of source)unique.set(`${p[0]}:${p[1]}`,p);
 const points=[...unique.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(points.length<3)return points;
 const span=Math.max(points.at(-1)[0]-points[0][0],Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))),epsilon=span*span*1e-12;
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lower=[],upper=[];
 for(const p of points){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=epsilon)lower.pop();lower.push(p);}
 for(const p of points.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=epsilon)upper.pop();upper.push(p);}
 lower.pop();upper.pop();return lower.concat(upper);
}
function geometryFootprints(model,item){
 const split=['hangzhou-gate','efc'].includes(item.shape.type),yaw=(90-(item.orientation?.degreesFromNorth??90))*Math.PI/180,c=Math.cos(yaw),s=Math.sin(yaw),buckets=split?[[],[]]:[[]];
 model.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position;
  for(let i=0;i<p.count;i+=3){const triangle=[0,1,2].map(j=>[p.getX(i+j),p.getZ(i+j)]);if(!split){buckets[0].push(...triangle);continue;}
   const xs=triangle.map(p=>p[0]*c-p[1]*s);
   for(let j=0;j<3;j++){buckets[xs[j]<0?0:1].push(triangle[j]);const k=(j+1)%3;if(xs[j]*xs[k]<0){const t=xs[j]/(xs[j]-xs[k]),q=[triangle[j][0]+(triangle[k][0]-triangle[j][0])*t,triangle[j][1]+(triangle[k][1]-triangle[j][1])*t];buckets[0].push(q);buckets[1].push(q);}else if(xs[j]===0){buckets[0].push(triangle[j]);buckets[1].push(triangle[j]);}}
  }
 });return buckets.map(convexHull).filter(r=>r.length>=3);
}
const boundsOf=r=>r.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
function convexOverlap(a,b,padding=.010){
 const x=boundsOf(a),y=boundsOf(b);if(x[2]+padding<y[0]||y[2]+padding<x[0]||x[3]+padding<y[1]||y[3]+padding<x[1])return false;
 for(const ring of[a,b])for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length],dx=q[0]-p[0],dz=q[1]-p[1],len=Math.hypot(dx,dz);if(!len)continue;const nx=-dz/len,nz=dx/len,range=r=>r.reduce((out,v)=>{const t=v[0]*nx+v[1]*nz;return[Math.min(out[0],t),Math.max(out[1],t)];},[Infinity,-Infinity]),u=range(a),v=range(b);if(u[1]+padding<v[0]||v[1]+padding<u[0])return false;}
 return true;
}
const collides=(a,b)=>a.footprints.some(x=>b.footprints.some(y=>convexOverlap(x,y)));
export function createSignatureLayer({items,data,airports,project,projection,sampleHeight}){
 const group=new THREE.Group();group.name='杭州真实标志建筑';
 const projectPolygon=poly=>poly.map(r=>r.map(c=>{const p=project(c,0);return[p.x,p.z];}));
 const roadExclusions=sourceRoadExclusions({data,projection});
 const guard=createLandFootprintGuard({boundary:data.boundary.map(projectPolygon),water:data.water.map(w=>projectPolygon(w.rings)),exclusions:[...airports.flatMap(a=>a.boundary||[]).map(projectPolygon),...roadExclusions],cellSize:.02});
 const area=r=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2),majorWater=data.water.filter(w=>area(w.rings[0])>.000035);
 const bankGuard=createLandFootprintGuard({boundary:data.boundary.map(projectPolygon),water:majorWater.map(w=>projectPolygon(w.rings)),cellSize:.03});
 const sourceBankGuard=createLandFootprintGuard({boundary:data.boundary,water:majorWater.map(w=>w.rings),cellSize:.02});
 const entries=[],exclusions=[],ownedModels=[],diagnostics={count:0,disposed:false,policy:'unchanged source anchors; bounded same-bank model offsets; conservative physical silhouette guards; joint eastern landmark placement',buildings:[],placementSearch:{candidateTests:0,validCandidates:{},jointCombinations:0,symbolSizingPolicy:'Fit fixed base geography; no mandatory pixel width or ground deformation'}};
 const allocated=[];
 const TAU=Math.PI*2;
 const offsets=[{east:0,north:0,distance:0,sector:0}];
 // Leave a 5-metre margin for the independent WGS84 geodesic distance.
 // The source anchor and its bank remain unchanged; this only places the symbol.
 for(const radius of[125,250,375,500,625,750,875,1000,1125,1250,1375,1495])for(let i=0;i<36;i++){const angle=i*TAU/36;offsets.push({east:Math.cos(angle)*radius,north:Math.sin(angle)*radius,distance:radius,sector:i});}
 try{
  for(const item of items){const owned=createSignatureBuilding(item),model=owned.group,box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),horizontal=WIDTHS[item.shape.type]/Math.max(size.x,size.z);ownedModels.push({item,owned,model,box,size,horizontal,localFootprints:geometryFootprints(model,item),anchor:project(item.coordinates)});}
  const corridorAllowed=(a,b,g,epsilon)=>{const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<epsilon)return true;const px=-dz/len*epsilon,pz=dx/len*epsilon;return g.allows([[a[0]+px,a[1]+pz],[b[0]+px,b[1]+pz],[b[0]-px,b[1]-pz],[a[0]-px,a[1]-pz]]);};
  function candidatesFor(record,fits,overrideOffsets=null){
   const {item,localFootprints,horizontal,anchor}=record,valid=[],positions=[];
   for(const offset of overrideOffsets||offsets){const coord=[item.coordinates[0]+offset.east/(111320*Math.cos(item.coordinates[1]*Math.PI/180)),item.coordinates[1]+offset.north/111320],position=project(coord);
    if(!corridorAllowed([anchor.x,anchor.z],[position.x,position.z],bankGuard,.000006)||!corridorAllowed(item.coordinates,coord,sourceBankGuard,1e-9))continue;
    positions.push({...offset,coord,position});
   }
   for(const fit of fits){if(fit*WIDTHS[item.shape.type]<(MINIMUM_WIDTH[item.shape.type]??.1)-1e-8)continue;const atFit=[];
    for(const offset of positions){diagnostics.placementSearch.candidateTests++;const {position}=offset,scale=horizontal*fit,footprints=localFootprints.map(r=>{const p=r.flatMap(([x,z])=>{const px=position.x+x*scale,pz=position.z+z*scale;return[[px,pz],[Math.fround(px),Math.fround(pz)]];});return convexHull(p.flatMap(q=>[[-1,-1],[-1,1],[1,-1],[1,1]].map(([dx,dz])=>[q[0]+dx*.00001,q[1]+dz*.00001])));});
     const candidate={...offset,fit,footprints,score:fit*10-offset.distance/2500};
     if(footprints.some(p=>!guard.allows(p))||allocated.some(p=>collides(candidate,p)))continue;
     atFit.push(candidate);
    }
    // Keep distant safe choices: a near candidate can block another building.
    valid.push(...atFit);
   }
   valid.sort((a,b)=>b.score-a.score);diagnostics.placementSearch.validCandidates[item.id]=valid.length;return valid;
  }
  const easternIds=['big-lotus','hangzhou-gate','small-lotus'],eastern=easternIds.map(id=>ownedModels.find(r=>r.item.id===id));
  const choices=new Map();
  const layoutKey=JSON.stringify({projection:{revision:projection.displayPolicy.revision,lenses:projection.displayPolicy.localizedLenses.map(({id,center,sigmaMeters,amplitude})=>({id,center,sigmaMeters,amplitude}))},widths:WIDTHS,heights:HEIGHTS,proportionalHeight:PROPORTIONAL_HEIGHT,heightAspectLimit:HEIGHT_ASPECT,minimumWidth:MINIMUM_WIDTH,roadWidths:{motorway:250,trunk:210,primary:155},roadMarginMeters:10,maxSourceOffsetMeters:1500});
  diagnostics.placementSearch.layoutKey=layoutKey;
  const cacheEligible=FROZEN_LAYOUT.layoutKey===layoutKey&&ownedModels.every(r=>{const f=FROZEN_LAYOUT.placements[r.item.id];return f&&r.item.coordinates.every((v,i)=>v===f.coordinates[i])&&r.size.toArray().every((v,i)=>Math.abs(v-f.sizeMeters[i])<1e-6);});
  // Reserve the complete reviewed arrangement, reduced to 40% of its old
  // broad-projection footprint widths. Every seed is checked against the
  // unchanged base geography before one bounded enlargement pass. In
  // particular, the small lotus keeps its reserved readable footprint.
  let cacheReplayed=cacheEligible;
  const reserveOrder=['big-lotus','small-lotus','hangzhou-gate'];
  for(const record of [...ownedModels].sort((a,b)=>(reserveOrder.includes(a.item.id)?reserveOrder.indexOf(a.item.id):3)-(reserveOrder.includes(b.item.id)?reserveOrder.indexOf(b.item.id):3))){
   let candidate;
   if(cacheEligible){const f=FROZEN_LAYOUT.placements[record.item.id];candidate=candidatesFor(record,[f.fit],[f])[0];}
   else{
    const seed=BASE_LAYOUT.placements[record.item.id];
    if(seed)candidate=candidatesFor(record,[seed.displayWidth/WIDTHS[record.item.shape.type]],[seed])[0];
   }
   if(!candidate){
    cacheReplayed=false;
    // Cached arrangements predate the explicit road corridors. Refit their
    // physical silhouettes without covering or removing any real centre line.
    const maxFit=FROZEN_LAYOUT.placements[record.item.id]?.fit??.4;
    for(const fit of [...new Set([maxFit,...[.4,.3,.25,.2,.18,.16,.14,.12,.10,.08,.06,.04,.025,.016].filter(f=>f<maxFit),(MINIMUM_WIDTH[record.item.shape.type]??.1)/WIDTHS[record.item.shape.type]])].sort((a,b)=>b-a)){
      candidate=candidatesFor(record,[fit])[0];if(candidate)break;
    }
   }
   if(!candidate)throw new Error(`${record.item.name}无法在固定道路与地理下保留安全的代表占地`,{cause:diagnostics.placementSearch});
   choices.set(record.item.id,candidate);allocated.push(candidate);
  }
  const replayed=cacheReplayed;
  if(!cacheEligible){
   for(const id of ['big-lotus','small-lotus','hangzhou-gate','civic-center','conference-center','hangzhou-center','efc','alibaba-xixi-c']){
    const record=ownedModels.find(r=>r.item.id===id);if(!record)continue;
    const prior=choices.get(id);allocated.splice(allocated.indexOf(prior),1);
    const localOffsets=[prior,{east:0,north:0,distance:0,sector:0}];
    for(const radius of[500,1000,1490])for(let i=0;i<12;i++){const a=i*TAU/12;localOffsets.push({east:Math.cos(a)*radius,north:Math.sin(a)*radius,distance:radius,sector:i});}
    const fits=[1,.8,.6,.5,.4,.3,.25,.2,.16,.12,.08,.04,prior.fit].filter((v,i,a)=>v>=prior.fit&&a.indexOf(v)===i).sort((a,b)=>b-a);
    const candidates=candidatesFor(record,fits,localOffsets).filter(c=>id!=='small-lotus'||c.fit*WIDTHS['small-lotus']<choices.get('big-lotus').fit*WIDTHS['big-lotus']*.85);
    const chosen=candidates[0]||prior;choices.set(id,chosen);allocated.push(chosen);
   }
  }
  diagnostics.placementSearch.replay={revision:FROZEN_LAYOUT.revision,registrySha256:FROZEN_LAYOUT.registrySha256,modelSha256:FROZEN_LAYOUT.modelSha256,accepted:replayed,revalidatedAgainstCurrentGeometry:true};
  // A single bounded local pass seeks wider low stadiums without elongating
  // their bowls or turning the petals into towers. Keep the safe prior slot
  // if a larger complete footprint cannot fit the unchanged roads and water.
  for(const id of ['big-lotus','small-lotus']){
   const record=ownedModels.find(r=>r.item.id===id),prior=choices.get(id);if(!record||!prior)continue;
   allocated.splice(allocated.indexOf(prior),1);
   const localOffsets=[prior];
   for(const east of [-150,-75,0,75,150])for(const north of [-150,-75,0,75,150]){
    const x=prior.east+east,y=prior.north+north,distance=Math.hypot(x,y);if(distance<=1495)localOffsets.push({east:x,north:y,distance,sector:0});
   }
   const candidates=candidatesFor(record,[prior.fit*1.35,prior.fit*1.2,prior.fit*1.1],localOffsets).filter(c=>id!=='small-lotus'||c.fit*WIDTHS['small-lotus']<choices.get('big-lotus').fit*WIDTHS['big-lotus']*.86);
   const chosen=candidates[0]||prior;choices.set(id,chosen);allocated.push(chosen);
   diagnostics.placementSearch.stadiumReadability??={};diagnostics.placementSearch.stadiumReadability[id]={widthBefore:prior.fit*WIDTHS[record.item.shape.type],widthAfter:chosen.fit*WIDTHS[record.item.shape.type],expanded:chosen!==prior,candidateLimit:localOffsets.length*3};
  }
  diagnostics.placementSearch.geographyPolicy='unchanged base projection and major-road centrelines; every complete signature silhouette clears real land/water and conservative primary/trunk/motorway road corridors; no land or road manipulation';
  for(const record of ownedModels){
   const {item,owned,model,box,size,horizontal,anchor}=record,{fit,position,footprints,distance,coord:displayCoordinates}=choices.get(item.id),heightScale=(PROPORTIONAL_HEIGHT[item.shape.type]?horizontal*fit*PROPORTIONAL_HEIGHT[item.shape.type]:Math.min(HEIGHTS[item.shape.type]*Math.sqrt(fit)/size.y,horizontal*fit*HEIGHT_ASPECT[item.shape.type])),footprintsGeo=footprints.map(r=>r.map(p=>projection.unproject(...p))),all=footprintsGeo.flat(),coords=convexHull(footprints.flat()).map(p=>projection.unproject(...p));
   model.scale.set(horizontal*fit,heightScale,horizontal*fit);model.position.copy(position);
   const grounding=groundModelOnTerrain(model,{project,projection});
   const disposeAuthored=owned.dispose.bind(owned);owned.dispose=()=>{grounding.dispose?.();disposeAuthored();};
   model.userData.signatureId=item.id;model.userData.landmarkId=item.id;model.traverse(o=>{o.userData.landmarkId=item.id;if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
   const placement={id:item.id,coordinates:[...item.coordinates],displayCoordinates,displayOffsetMeters:distance,maxDisplayOffsetMeters:1500,horizontalScale:horizontal*fit,verticalScale:heightScale,fit,footprint:coords,footprints:footprintsGeo,footprintsWorld:footprints,footprintPolicy:'conservative convex projection of all physical geometry; source-axis split with exact triangle clipping for the two tower pairs; bounding-box gaps are not occupied',sourceHeightMeters:item.verifiedHeightMeters??null,displayHeight:model.scale.y*size.y,displayWidth:Math.max(size.x,size.z)*horizontal*fit,placementMethod:replayed?'frozen joint layout with live physical guard verification':'one bounded fit on unchanged base geography with all eight joint footprints reserved'};
   placement.grounding=model.userData.grounding;model.userData.displayPlacement=placement;owned.diagnostics.placement=placement;group.add(model);entries.push({item:{...item,...COPY[item.id],city:'hangzhou',category:'architecture',overviewOnly:true,subtitle:item.shape.description},group:model,owned,anchor});
   for(const ring of footprintsGeo)exclusions.push([[...ring,ring[0]]]);diagnostics.buildings.push(owned.diagnostics);
  }
  diagnostics.count=entries.length;
 }catch(error){for(const {owned}of ownedModels)owned.dispose();throw error;}finally{guard.dispose();bankGuard.dispose();sourceBankGuard.dispose();}
 return{group,entries,exclusions,diagnostics,dispose(){if(diagnostics.disposed)return;diagnostics.disposed=true;for(const entry of entries)entry.owned.dispose();group.removeFromParent();group.clear();entries.length=0;exclusions.length=0;}};
}
