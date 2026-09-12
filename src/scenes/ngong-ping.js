import * as THREE from 'three';
import {landscape,hill,scatterTrees,pathOnTerrain,deckRails,cableSystem,villageBuilding,material} from './hong-kong-landscapes.js';

export function createNgongPing(){
  const view=landscape((x,z)=>hill(x,z,-5.3,.6,3.0,4.5,3.25)+hill(x,z,5,-3.6,3.7,3.8,3.5)+hill(x,z,6.5,4,2.4,2.5,1.45)+hill(x,z,-1.3,-5.5,2.6,1.8,1.75)-hill(x,z,.2,1,2.1,3.2,.34));
  const {group,batch,mats,height}=view;group.name='Ngong Ping 360 · 昂坪360';
  const blue=material('#2c82a0',.42,.12),roof=material('#677f78'),tile=material('#697c70'),stone=material('#b6b49b');
  const rawSupports=[[-6.55,5.85],[-4.95,.8],[1.2,-.75],[6.25,-4.55]];
  const supports=rawSupports.map(([x,z])=>[x,height(x,z)+2.65,z]);
  const ropeway=cableSystem(batch,group,supports,height,{color:'#288aae',roof:'#d8e0d2',count:4,sag:.39,speed:.013});
  // Cylindrical roof shells echo the terminal roofs while retaining the
  // cable's visible entrance, platform and support machinery.
  for(const [i,sign] of [[0,1],[supports.length-1,-1]]){
    const [x,y,z]=supports[i],floor=y-1.88;
    batch.box(x,floor-.13,z,2.3,.26,1.78,mats.path);
    batch.box(x,floor+.28,z,2.0,.58,1.45,mats.cream);
    for(const side of [-1,1])batch.box(x+side*.86,floor+.83,z,.15,.58,1.4,mats.silver);
    batch.box(x,floor+.83,z+sign*.735,1.54,.44,.03,mats.dark);
    const cross=new THREE.Shape();cross.moveTo(-1.18,0);for(let n=0;n<=24;n++){const xx=-1.18+n/24*2.36;cross.lineTo(xx,.56*Math.sqrt(Math.max(0,1-(xx/1.18)**2)));}cross.lineTo(1.18,-.075);cross.lineTo(-1.18,-.075);cross.closePath();
    batch.add(new THREE.ExtrudeGeometry(cross,{depth:1.79,bevelEnabled:false}),roof,[x,floor+1.06,z-.895]);
    for(let n=0;n<9;n++){const zz=z-.82+n*.2;batch.curve([[-1.17,.05],[-.8,.43],[0,.58],[.8,.43],[1.17,.05]].map(([xx,yy])=>[x+xx,floor+1.06+yy,zz]),.018,mats.silver,24,4);}
    deckRails(batch,[x,z],2.3,1.78,floor,mats);
    for(const side of [-1,1])batch.rod([x+side*.9,height(x+side*.9,z),z],[x+side*.9,floor,z],.1,stone,8);
    batch.box(x,floor+.4,z+sign*.89,.7,.21,.03,blue);
  }
  // Ngong Ping village sits beyond the arrival terminal. It is deliberately
  // a small contextual cluster; the suspended span remains the central view.
  const villages=[[3.7,-4.5,1.05,.72],[4.4,-5.65,1.15,.78],[5.65,-6.25,.98,.82],[3.25,-6.2,.92,.68],[6.8,-6.1,.85,.8]];
  for(const [x,z,w,d]of villages)villageBuilding(batch,x,height(x,z)+.07,z,w,d,.48,mats,tile);
  pathOnTerrain(batch,height,[[6.2,-4.9],[5,-5],[4,-5.5],[3.4,-6.2]],mats.path,.32);
  pathOnTerrain(batch,height,[[-6.3,5.7],[-5.7,3.7],[-3.8,2.1],[-2.6,3.9],[-.8,4.5],[1.8,3.7],[3.5,2.1]],mats.path,.16);
  scatterTrees(batch,height,mats,{seed:368,count:310,size:.63,exclude:(x,z)=>(Math.abs(x-6.25)<1.45&&Math.abs(z+4.55)<1.4)||(x>2.8&&z< -4.2)||(Math.abs(x+6.55)<1.2&&z>4.7)});
  // Exposed rock ribs punctuate the green slopes and make the cable's
  // clearance over the valley legible from low orbit angles.
  for(const [x,z,s]of [[-6.6,-1.7,.5],[-5.9,2,.43],[-4.2,1.6,.56],[4.9,-.8,.55],[6.8,-2.1,.42],[5.5,2.4,.47]])batch.ball(x,height(x,z)+.12,z,s,.32,s*.7,stone,1);
  for(let n=0;n<24;n++)batch.box(-6.7+n*.58,.044,7.4+(n%3)*.21,.32,.005,.017,mats.foam);
  batch.finish();
  return {group,update:ropeway.update,camera:{position:[20.4,15.5,22.7],target:[0,.7,0]},description:'蓝色吊厢越过山谷，索道在林海与村落之间缓缓延伸。',hotspots:[{label:'悬索越山谷',position:[-1.6,4.35,.1],description:'保留昂坪360跨越山谷的索道意象，缆绳具有下垂曲线，吊厢保持竖直悬挂。'},{label:'昂坪方向',position:[5.5,4.4,-5.7],description:'终点站旁的村落为艺术化微缩配景；建筑布局、索道支点与距离不代表真实线路图。'},{label:'蓝色吊厢',position:[-4.7,4.1,2.1],description:'吊厢在两条索道上往返，运动由时间确定；导出模型保存当时的位置。'}]};
}
