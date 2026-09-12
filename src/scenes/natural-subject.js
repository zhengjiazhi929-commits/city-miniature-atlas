import * as THREE from 'three';
import {SubjectBuilder,shopHouse,fitSubject,disposeSubject} from './subject-kit.js';
import {broadleaf,willow,cedar,fern,reedClump,pavilion,stonePagodas,visitorBoat} from './natural-kit.js';
import {createHangzhouLandmark} from '../hangzhou-landmarks.js';
import {createHangzhouSurfaceSampler} from '../hangzhou-surface.js';

const NAME={westlake:'西湖',xixi:'西溪湿地',qiandao:'千岛湖',tianmu:'天目山'};
const inRing=(p,r)=>{let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;};
const inside=(p,rs)=>inRing(p,rs[0])&&!rs.slice(1).some(r=>inRing(p,r));
const square=(x,z,r)=>[[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r]];
function random(seed){return()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
function distances(lines,cell){
 const bins=new Map();
 for(const line of lines)for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],segment=[a,b];
  for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)
   for(let z=Math.floor(Math.min(a[1],b[1])/cell);z<=Math.floor(Math.max(a[1],b[1])/cell);z++){
    const k=x+','+z;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(segment);
   }
 }
 return p=>{
  let best=cell*2;const ix=Math.floor(p[0]/cell),iz=Math.floor(p[1]/cell);
  for(let x=ix-2;x<=ix+2;x++)for(let z=iz-2;z<=iz+2;z++)for(const[a,b]of bins.get(x+','+z)||[]){
   const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
   best=Math.min(best,Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t));
  }
  return best;
 };
}
function polyPrism(b,ring,top,bottom,key){
 const verts=[],n=ring.length,p=(i,y)=>[ring[i][0],Array.isArray(y)?y[i]:y,ring[i][1]];
 const tris=THREE.ShapeUtils.triangulateShape(ring.map(v=>new THREE.Vector2(...v)),[]);
 for(const[a,c,d]of tris){verts.push(...p(a,top),...p(d,top),...p(c,top));verts.push(...p(a,bottom),...p(c,bottom),...p(d,bottom));}
 for(let i=0;i<n;i++){const j=(i+1)%n;verts.push(...p(i,top),...p(j,top),...p(j,bottom),...p(i,top),...p(j,bottom),...p(i,bottom));}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();b.add(g,key);
}
function section(a,c,w){
 const dx=c[0]-a[0],dz=c[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l*w/2,nz=dx/l*w/2;
 return [[a[0]+nx,a[1]+nz],[c[0]+nx,c[1]+nz],[c[0]-nx,c[1]-nz],[a[0]-nx,a[1]-nz]];
}

export async function createNaturalSubject(id,signal){
 signal?.throwIfAborted();const root=new THREE.Group();root.name=NAME[id]+' · 景物主体';let b,surface;
 try{
  const response=await fetch(new URL(`../../data/scenes/hangzhou-subjects/${id}.json`,import.meta.url),{signal});
  if(!response.ok)throw new Error('景物资料加载失败');const d=await response.json();signal?.throwIfAborted();
  b=new SubjectBuilder(root);const y0=Math.min(...d.terrain.positions.filter((_,i)=>i%3===1),...d.water.map(w=>w.level)),unit=d.unit,Y=y=>(y-y0)*d.heightScale;
  const [west,south,east,north]=d.extent,span=Math.max(east-west,north-south),waterAt=q=>d.water.find(w=>inside(q,w.rings));
  const coastDistance=distances(d.water.flatMap(w=>w.rings),Math.max(20,span/65)),pathDistance=distances((d.paths||[]).map(p=>p.points),Math.max(20,span/65));
  const p=new Float32Array(d.terrain.positions.map((v,i)=>i%3===1?Y(v):v)),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setIndex(d.terrain.indices);g.computeVertexNormals();
  const colour=new Float32Array(p.length),normal=g.attributes.normal,c=new THREE.Color();
  for(let i=0;i<p.length;i+=3){
   const slope=1-normal.getY(i/3),coast=coastDistance([p[i],p[i+2]]);
   c.set(id==='tianmu'?'#476144':id==='xixi'?'#7b8651':'#507342');
   if(id==='qiandao'&&coast<8)c.lerp(new THREE.Color('#af9c6d'),1-coast/8);
   else if(id==='westlake'&&coast<10)c.lerp(new THREE.Color('#c3b995'),1-coast/10);
   else c.lerp(new THREE.Color(id==='tianmu'?'#877d64':'#9b9b70'),Math.max(0,slope-.28)*.64);
   c.toArray(colour,i);
  }
  g.setAttribute('color',new THREE.BufferAttribute(colour,3));const terrain=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96}));terrain.name='来源地形';terrain.castShadow=terrain.receiveShadow=true;root.add(terrain);
  surface=createHangzhouSurfaceSampler(Float32Array.from(p,v=>v*unit),d.terrain.indices,{project:([x,z])=>({x:x*unit,z:z*unit})},unit);
  const base=-Math.max(9,span*.0035);
  for(const rings of d.outline)b.solid(rings,base-2,base,'#a5997e');
  const cut=[];for(const[a,c]of d.terrain.edges){const x=Array.from(p.slice(a*3,a*3+3)),z=Array.from(p.slice(c*3,c*3+3));cut.push(...x,z[0],base,z[2],...z,...x,x[0],base,x[2],z[0],base,z[2]);}
  const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(cut,3));cg.computeVertexNormals();
  if(id==='tianmu'){
   const cc=new Float32Array(cut.length),rock=new THREE.Color();
   for(let i=0;i<cut.length;i+=3){const seam=.06*Math.sin(cut[i+1]*.22)+.035*Math.cos(cut[i]*.16+cut[i+2]*.09);rock.set('#766f5e').multiplyScalar(1+seam).toArray(cc,i);}
   cg.setAttribute('color',new THREE.BufferAttribute(cc,3));const cutMesh=new THREE.Mesh(cg,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));cutMesh.name='地形取景切面';cutMesh.castShadow=cutMesh.receiveShadow=true;root.add(cutMesh);
  }else b.add(cg,'#9c9675');
  const waterColour=id==='xixi'?'#356f68':id==='qiandao'?'#286f78':'#337c7f';
  for(const w of d.water)b.solid(w.rings,base+.05,Y(w.level)+.02,waterColour);
  if(d.water.length)Object.assign(b.material(waterColour),{roughness:.27,metalness:.18});
  const diagnostics={id,presentation:'standalone-subject',subjectKind:'natural-subject',identity:d.identity,trees:0,willows:0,cedars:0,reeds:0,ferns:0,paths:0,bridges:0,boats:0,features:[],sourceTriangles:d.terrain.indices.length/3,scope:d.scope};
  const hotspots=[],obstacles=[],supports=[];
  const reserve=(x,z,r)=>obstacles.push({x,z,r});
  const available=(x,z,r=0)=>!obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.r+r);
  const safeLand=ring=>ring.every(q=>surface.sample(q)!==null&&!waterAt(q));
  // All paths retain clipped source centerlines. Arches only occur on mapped
  // bridges. Solid stair/path undersides extend below the terrain minimum.
  for(const path of d.paths||[]){
   const width=id==='westlake'?(path.bridge?27:16):id==='tianmu'?7:4,pts=path.points;
   let total=0;for(let i=1;i<pts.length;i++)total+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
   let travelled=0,count=0;const meanWater=d.water.length?Y(d.water[0].level):0,ends=[surface.sample(pts[0]),surface.sample(pts.at(-1))].map(v=>v??meanWater+1);
   for(let i=1;i<pts.length;i++){
    const a=pts[i-1],c=pts[i],len=Math.hypot(c[0]-a[0],c[1]-a[1]),n=Math.max(1,Math.ceil(len/(id==='tianmu'?5:12)));
    for(let k=0;k<n;k++){
     const q=[a[0]+(c[0]-a[0])*k/n,a[1]+(c[1]-a[1])*k/n],r=[a[0]+(c[0]-a[0])*(k+1)/n,a[1]+(c[1]-a[1])*(k+1)/n],ring=section(q,r,width);
     if(!path.bridge&&!safeLand(ring))continue;
     const range=surface.heightRange(ring);if(!path.bridge&&!range)continue;
     if(path.bridge){
      const t0=(travelled+len*k/n)/total,t1=(travelled+len*(k+1)/n)/total,arch=t=>ends[0]*(1-t)+ends[1]*t+Math.sin(t*Math.PI)*Math.min(18,total*.17)+1.7,top=[arch(t0),arch(t1),arch(t1),arch(t0)];
      polyPrism(b,ring,top,top.map(y=>y-2.5),'#c9c3a8');
      for(const[u,v]of [[0,1],[3,2]]){b.rod([ring[u][0],top[u]+3,ring[u][1]],[ring[v][0],top[v]+3,ring[v][1]],.65,'#d7cfb3',5);b.rod([ring[u][0],top[u],ring[u][1]],[ring[u][0],top[u]+3,ring[u][1]],.75,'#c9c3a8',5);}
     }else{
      const top=id==='tianmu'?ring.map(()=>range.max+.45):ring.map(q=>surface.sample(q)+.65);
      polyPrism(b,ring,top,range.min-.7,id==='tianmu'?'#c0b697':'#c7c3aa');supports.push({kind:'path',ring,bottom:range.min-.7});
     }
     count++;
    }travelled+=len;
   }
   if(count){diagnostics.paths++;if(path.bridge){diagnostics.bridges++;if(path.name==='断桥'||path.name==='望山桥'){const q=pts[Math.floor(pts.length/2)];hotspots.push({label:path.name,position:[q[0],Math.max(...ends)+20,q[1]],description:'依据来源桥位建模，桥身、栏杆与弧形桥面作放大表达。'});}}}
  }
  for(const item of d.buildings){
   const f=item.frame;if(!f||Math.max(f.width,f.depth)>95)continue;
   const ca=Math.cos(f.yaw),sa=Math.sin(f.yaw),w=f.width,dep=f.depth,ring=[[-w/2,-dep/2],[w/2,-dep/2],[w/2,dep/2],[-w/2,dep/2]].map(([x,z])=>[f.x+x*ca+z*sa,f.z-x*sa+z*ca]);
   if(!safeLand(ring))continue;const range=surface.heightRange(ring);if(!range||range.max-range.min>7)continue;
   const model=shopHouse({width:w*.92,depth:dep*.92,height:Math.max(9,Math.min(w,dep)*.70),name:item.name||'来源临水街屋'});b.solid([ring],range.min-.5,range.max+.05,'#aaa48a');model.position.set(f.x,range.max,f.z);model.rotation.y=f.yaw;root.add(model);reserve(f.x,f.z,Math.hypot(w,dep)/2+3);supports.push({kind:'house',ring,bottom:range.min-.5});
  }
  for(const item of d.features||[]){
   const[x,z]=item.local,w=waterAt([x,z]);
   if(item.kind==='stone-pagodas'){
    if(!w)continue;stonePagodas(b,x,Y(w.level),z,58);reserve(x,z,75);diagnostics.features.push('three-stone-pagodas');
    hotspots.push({label:'三潭印月',position:[x,Y(w.level)+120,z],description:'三座瓶形石塔位于小瀛洲南侧。以来源石塔点为锚，三塔间距及体量为观赏性概括。',sceneId:'santan'});
   }else{
    let width=item.width;while(width>8&&!safeLand(square(x,z,width*.52)))width*=.76;const radius=width*.52,ring=square(x,z,radius);if(!safeLand(ring))continue;const range=surface.heightRange(ring);if(!range)continue;
    b.solid([ring],range.min-.8,range.max+.2,'#b8ad8b');const model=pavilion(width,item.height,item.name);model.position.set(x,range.max+.2,z);root.add(model);reserve(x,z,radius+9);supports.push({kind:'pavilion',ring,bottom:range.min-.8});diagnostics.features.push(item.name);
    if(item.name==='湖心亭')hotspots.push({label:'湖心亭',position:[x,range.max+item.height+8,z],description:'保留来源亭址，放大亭台、屋檐与柱廊。'});
   }
  }
  for(const item of (d.landmarks||[]).filter(x=>x.id==='leifeng')){
   const[x,z]=item.local,model=createHangzhouLandmark(item),size=165,radius=58,ring=square(x,z,radius),range=surface.heightRange(ring);
   if(!range||!safeLand(ring)){disposeSubject(model);continue;}
   model.scale.setScalar(size);model.position.set(x,range.max,z);root.add(model);b.solid([ring],range.min-.7,range.max+.02,'#a3a07c');reserve(x,z,95);supports.push({kind:'pagoda',ring,bottom:range.min-.7});diagnostics.features.push('leifeng');
   hotspots.push({label:'雷峰塔',position:[x,range.max+315,z],description:'五层八面、金色重檐。点击单独查看塔体。',sceneId:'leifeng'});
  }
  const rand=random(75251),step=id==='tianmu'?32:id==='xixi'?24:id==='qiandao'?29:55,candidateTrees=[];
  for(let z=south+step*.5;z<north;z+=step)for(let x=west+step*.5;x<east;x+=step){
   const px=x+(rand()-.5)*step*.65,pz=z+(rand()-.5)*step*.65,pos=[px,pz],h0=surface.sample(pos);
   if(h0===null||waterAt(pos)||!available(px,pz,step*.12)||pathDistance(pos)<(id==='westlake'?18:id==='tianmu'?13:6))continue;
   if(id==='xixi'&&rand()>.38)continue;
   const coast=coastDistance(pos),isWillow=(id==='westlake'||id==='xixi')&&coast<55;
   const h=id==='tianmu'?(52+rand()*38):id==='qiandao'?(32+rand()*22):id==='xixi'?(17+rand()*11):(34+rand()*18),r=h*(isWillow?.35:id==='tianmu'?.20:.27);
   const groundRing=square(px,pz,h*.05),range=surface.heightRange(groundRing);if(!range||!safeLand(groundRing))continue;
   const crown=surface.heightRange(square(px,pz,r));if(crown&&crown.max>range.max+h*.35)continue;
   const seed=Math.floor(rand()*10000),y=range.max-.3;
   if(id==='tianmu'&&rand()<.76){cedar(b,px,y,pz,h,seed);diagnostics.cedars++;}
   else if(isWillow){willow(b,px,y,pz,h,seed);diagnostics.willows++;}
   else broadleaf(b,px,y,pz,id==='tianmu'?h*.45:h,seed);
   b.add(new THREE.CylinderGeometry(h*.028,h*.047,range.max-range.min+1.3,7),'#756149',[px,(range.max+range.min)/2-.45,pz]);
   supports.push({kind:'tree',ring:groundRing,bottom:range.min-1.1});reserve(px,pz,h*.05);diagnostics.trees++;candidateTrees.push({x:px,y,z:pz,h});
  }
  if(id==='xixi'){
   for(let z=south+4;z<north;z+=9)for(let x=west+4;x<east;x+=9){
    const px=x+(rand()-.5)*6,pz=z+(rand()-.5)*6,q=[px,pz],h=surface.sample(q);
    if(h===null||waterAt(q)||pathDistance(q)<6||!available(px,pz,5)||coastDistance(q)>45)continue;
    const reedHeight=6+rand()*3,rootRadius=reedHeight*.35;
    const ring=square(px,pz,rootRadius);if(!safeLand(ring)||coastDistance(q)<rootRadius)continue;const range=surface.heightRange(ring);if(!range)continue;
    reedClump(b,px,range.min-.15,pz,reedHeight,diagnostics.reeds);supports.push({kind:'reed',ring,bottom:range.min-.45});diagnostics.reeds++;
   }
  }
  if(id==='tianmu'){
   for(let z=south+10;z<north;z+=20)for(let x=west+10;x<east;x+=20){
    const q=[x+(rand()-.5)*12,z+(rand()-.5)*12],y=surface.sample(q);
    if(y===null||pathDistance(q)<8||!available(q[0],q[1],3))continue;
    fern(b,q[0],y+.15,q[1],4.5+rand()*3,diagnostics.ferns++);
   }
   const t=candidateTrees.sort((a,c)=>Math.hypot(a.x+350,a.z+300)-Math.hypot(c.x+350,c.z+300))[0];
   if(t)hotspots.push({label:'古柳杉林',position:[t.x,t.y+t.h+10,t.z],description:'以天目山古柳杉群落的高干与层状枝冠为特征。此处是森林类型示意，未冒充某一株具名古树的位置。'});
   const path=d.paths?.find(x=>x.points.length>8);if(path){const q=path.points[Math.floor(path.points.length/2)],y=surface.sample(q);if(y!==null)hotspots.push({label:'林间石径',position:[q[0],y+8,q[1]],description:'沿来源登山步道，石阶随模型地形起伏。'});}
  }
  const maxBoats=id==='xixi'?7:id==='westlake'?10:id==='qiandao'?5:0,boatL=id==='xixi'?24:id==='westlake'?82:98,boatCandidates=[];
  for(let i=0;i<1800&&boatCandidates.length<maxBoats;i++){
   const x=west+rand()*(east-west),z=south+rand()*(north-south),w=waterAt([x,z]),yaw=rand()*Math.PI*2;
   if(!w||!available(x,z,boatL*.7))continue;
   const ca=Math.cos(yaw),sa=Math.sin(yaw),ring=[[-boatL*.2,-boatL*.63],[boatL*.2,-boatL*.63],[boatL*.2,boatL*.63],[-boatL*.2,boatL*.63]].map(([xx,zz])=>[x+xx*ca+zz*sa,z-xx*sa+zz*ca]);
   if(!ring.every(q=>inside(q,w.rings))||coastDistance([x,z])<boatL*.38)continue;
   const boat=visitorBoat({length:boatL,cruise:id==='qiandao',name:id==='xixi'?'摇橹船':id==='qiandao'?'湖上游船':'西湖游船'});boat.position.set(x,Y(w.level)+.6,z);boat.rotation.y=yaw;root.add(boat);reserve(x,z,boatL*1.9);boatCandidates.push([x,z,Y(w.level),ring]);diagnostics.boats++;
  }
  if(id==='xixi'&&boatCandidates.length){const q=boatCandidates[0];hotspots.push({label:'摇橹入芦',position:[q[0],q[2]+22,q[1]],description:'摇橹小舟与芦苇水巷是西溪的代表景物。游船为游览情景表达，不标定固定航线。'});}
  if(id==='qiandao'&&boatCandidates.length){const q=boatCandidates[0];hotspots.push({label:'岛间行舟',position:[q[0],q[2]+30,q[1]],description:'游船作为尺度参照，保留周围真实岛岸与水道。'});}
  const waves=id==='westlake'?160:id==='qiandao'?140:id==='xixi'?80:0,waveL=id==='xixi'?8:22;
  for(let i=0;i<waves;i++){
   const x=west+rand()*(east-west),z=south+rand()*(north-south),w=waterAt([x,z]);if(!w||coastDistance([x,z])<waveL||!available(x,z,waveL))continue;
   b.rod([x-waveL/2,Y(w.level)+.12,z],[x+waveL/2,Y(w.level)+.12,z+waveL*.15],id==='xixi'?.09:.35,id==='qiandao'?'#55979a':'#74aaa0',4);
  }
  b.finish('景物构件');b=null;surface.dispose();surface=null;signal?.throwIfAborted();
  const result=fitSubject(root,hotspots,{span:25,direction:id==='tianmu'?[.60,.62,1]:id==='xixi'?[.35,.90,1]:[.48,1.08,1],name:NAME[id]+' · 独立景物模型'});
  result.viewer={fitSubject:true,minDistance:12,maxDistance:70,groundY:-.006};
  result.group.userData={sceneId:id,presentation:'standalone-subject',subjectKind:'natural-subject',source:d.source,scope:d.scope,identity:d.identity,attribution:'© OpenStreetMap contributors · Mapzen DEM',vegetation:'Representative plant types and scale; not measured individual plants.',boats:'Visitor context only; not surveyed moorings or routes.'};
  result.diagnostics=diagnostics;result.contactAudit={supports,boatFootprints:boatCandidates.map(q=>({ring:q[3],level:q[2]})),coordinateSpace:'raw subject metres before fit',sourceY0:y0,heightScale:d.heightScale};return result;
 }catch(e){b?.dispose();surface?.dispose?.();disposeSubject(root);throw e;}
}
