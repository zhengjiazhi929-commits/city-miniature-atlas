import * as THREE from 'three';
import {SubjectBuilder,templeHall,shopHouse,glassRetail,fitSubject,disposeSubject} from './subject-kit.js';
import {createSignatureBuilding} from '../hangzhou-signature-buildings.js';
const ROOT=new URL('../../data/scenes/hangzhou-subjects/',import.meta.url);
const NAMES={lingyin:'灵隐寺',faxi:'法喜寺',xiaohe:'小河直街',longmen:'龙门古镇',olympic:'杭州奥体中心','hubin-yintai':'湖滨银泰',zshc:'萧山国际机场',leifeng:'雷峰塔'};
const read=async(url,signal)=>{const r=await fetch(url,{signal});if(!r.ok)throw new Error('景点主体资料加载失败');return r.json();};

export async function createHangzhouSubject(id,signal) {
 signal?.throwIfAborted();const group=new THREE.Group();group.name=NAMES[id]+' · 主体模型';const hotspots=[];let builder;
 try {
  if(id==='olympic'){
   const data=await read(new URL('../../data/hangzhou-atlas/signature-buildings.json',import.meta.url),signal),items=data.buildings.filter(b=>['big-lotus','small-lotus'].includes(b.id)),origin=items[0].coordinates,unitX=111320*Math.cos(origin[1]*Math.PI/180);
   for(const item of items){const result=createSignatureBuilding(item),x=(item.coordinates[0]-origin[0])*unitX,z=(origin[1]-item.coordinates[1])*111320;result.group.position.set(x,0,z);group.add(result.group);hotspots.push({label:item.name,position:[x,result.diagnostics.sizeMeters[1]+9,z],description:result.diagnostics.form});}
   group.userData.subjectKind='stadium-complex';
  }else if(id==='leifeng'){
   const {loadLeifengSubject}=await import('./leifeng-subject.js');signal?.throwIfAborted();const tower=await loadLeifengSubject(signal);group.add(tower);group.userData.subjectKind='pagoda';
  }else if(id==='zshc'){
   const data=await read(new URL('../../data/airports/hangzhou.json',import.meta.url),signal),origin=data.coordinates,mx=111320*Math.cos(origin[1]*Math.PI/180),point=p=>[(p[0]-origin[0])*mx,(origin[1]-p[1])*111320];
   // Airport details present the terminal complex; full airport geography belongs
   // to the city view. Every retained wing/connector is from the source outline.
   for(const item of data.terminals){if(item.name==='迎宾楼')continue;const rings=item.rings.map(r=>r.map(point)),model=glassRetail(rings,(item.heightMeters||18)*1.3,item.name);group.add(model);if(!item.name.includes('附属')&&!item.name.includes('连廊')){const box=new THREE.Box3().setFromObject(model),c=box.getCenter(new THREE.Vector3());hotspots.push({label:item.name,position:[c.x,box.max.y+15,c.z],description:'航站楼轮廓与连廊按来源资料组织，立面和屋面为概括表达。'});}}
   group.userData.subjectKind='terminal-complex';
  }else{
   const data=await read(new URL(id+'.json',ROOT),signal);builder=new SubjectBuilder(group);const temple=id==='lingyin'||id==='faxi';
   for(const rings of data.supports)builder.solid(rings,-.9,0,'stone');
   for(const rings of data.water)builder.solid(rings,-1.1,-.12,'#397f85');
   for(const p of data.paths){
    if(temple){const[a,c]=p.points,dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz),yaw=-Math.atan2(dz,dx),steps=Math.max(1,Math.ceil(Math.abs(p.endGrade-p.startGrade)/.16));
     for(let j=0;j<steps;j++){const t=(j+.5)/steps,h=p.startGrade+(p.endGrade-p.startGrade)*(j+1)/steps+.04;builder.box(a[0]+dx*t,h/2,a[1]+dz*t,len/steps+.015,h,p.width,'stone',yaw);}
    }else for(let j=1;j<p.points.length;j++){const a=p.points[j-1],c=p.points[j],len=Math.hypot(c[0]-a[0],c[1]-a[1]);builder.box((a[0]+c[0])/2,.08,(a[1]+c[1])/2,len,.16,4,'stone',-Math.atan2(c[1]-a[1],c[0]-a[0]));}
   }
   for(const item of data.buildings){
    if(id!=='hubin-yintai')builder.solid(item.rings,0,item.grade+.08,'edge');
    for(const f of (id!=='hubin-yintai'&&item.parts?.length?item.parts:[item.frame])){let model;
    if(temple)model=templeHall({width:f.width*.94,depth:f.depth*.94,height:Math.min(item.displayHeight,Math.min(f.width,f.depth)*(item.eaves>1?1.12:.62)),eaves:Math.min(f.width,f.depth)<12?1:item.eaves,name:item.name,warm:id==='faxi',main:item.role==='main-hall',supportDepth:item.grade});
    else if(id==='hubin-yintai'){model=glassRetail(item.rings,item.displayHeight,item.name);group.add(model);const box=new THREE.Box3().setFromObject(model),c=box.getCenter(new THREE.Vector3());if(item.name)hotspots.push({label:item.name,position:[c.x,box.max.y+3,c.z],description:'独立商业建筑；来源轮廓，概括立面。'});continue;}
    else model=shopHouse({width:f.width*.95,depth:f.depth*.95,height:item.displayHeight,courtyard:id==='longmen',name:item.name});
    model.position.set(f.x,item.grade,f.z);model.rotation.y=f.yaw;model.userData.sourceId=item.id;model.userData.sourceFrame=f;model.userData.representative=!!item.representative;group.add(model);
    if(temple&&item.role==='main-hall'&&item.name&&!hotspots.some(h=>h.label===item.name))hotspots.push({label:item.name,position:[f.x,item.grade+item.displayHeight+3,f.z],description:'主要殿堂的来源位置与朝向；屋檐、柱廊和台阶为建筑外观概括。'});
   }
   }
   builder.finish('院落与建筑台基');builder=null;group.userData={...group.userData,subjectKind:temple?'temple-complex':id==='xiaohe'?'historic-street':id==='longmen'?'courtyard-typology':'retail-complex',sourceData:data.source,buildingCount:data.buildings.length,representation:data.representation};
  }
  signal?.throwIfAborted();
  const result=fitSubject(group,hotspots,{span:id==='leifeng'?17:24,direction:id==='leifeng'?[1,.38,1]:id==='lingyin'?[.68,.76,1]:id==='faxi'?[.8,.8,1]:[.8,.74,1],name:NAMES[id]+' · 独立主体'});
  result.group.userData={...group.userData,sceneId:id,presentation:'standalone-subject',source:'docs/hangzhou-subject-models.md',attribution:'© OpenStreetMap contributors · architectural forms interpreted from cited references',rawContextTerrain:false};
  result.diagnostics={id,presentation:'standalone-subject',contextTerrain:0,contextRoads:0,subjectKind:group.userData.subjectKind,buildings:group.userData.buildingCount,displayScale:result.displayScale};
  result.viewer={fitSubject:true,minDistance:id==='leifeng'?12:18,maxDistance:70,groundY:-.006};return result;
 }catch(e){builder?.dispose();disposeSubject(group);throw e;}
}
