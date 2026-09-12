import * as THREE from 'three';
import {landscape,hill,scatterTrees,pathOnTerrain,cableSystem,deckRails,Batch,material} from './hong-kong-landscapes.js';

export function createOceanPark(){
  const {group,batch,mats,height}=landscape((x,z)=>{
    const natural=hill(x,z,2.7,-2,4.4,4.3,3.65)+hill(x,z,-4.5,-2.8,2.7,3.5,2.1)+hill(x,z,-4,3.2,2.7,2.3,.93)-.1;
    const edge=Math.max(Math.abs(x-3.45)-3.08,Math.abs(z+2.9)-2.32);
    const plateau=1-THREE.MathUtils.smoothstep(edge,0,1.1);
    return Math.max(0,THREE.MathUtils.lerp(natural,3.2,plateau));
  },{waterColor:'#76aba7'});
  group.name='Ocean Park · 香港海洋公园';
  const blue=material('#368eae',.45,.15),blueTrim=material('#70b2c2',.47,.1),yellow=material('#e4c356',.56),coral=material('#b85368'),glass=material('#385e6c',.32,.2);
  // Grand Aquarium: an egg-shaped blue shell, wrapped in broad yellow fins.
  // This is a compact exterior study, not the aquarium's interior or floor plan.
  const ax=-4.3,az=3.15,ay=height(ax,az)+.16;
  batch.box(ax,ay-.09,az,4.3,.28,3.45,mats.path);
  batch.box(ax+.12,ay+.24,az,3.5,.48,2.66,mats.cream);
  batch.add(new THREE.SphereGeometry(1,48,32),blue,[ax,ay+1.53,az],[1.47,1.99,1.22]);
  const shell=(lat,theta,extra=.035)=>new THREE.Vector3(ax+(1.47+extra)*Math.sin(lat)*Math.cos(theta),ay+1.53+(1.99+extra)*Math.cos(lat),az+(1.22+extra)*Math.sin(lat)*Math.sin(theta));
  for(let n=0;n<20;n++){
    const points=Array.from({length:30},(_,i)=>shell(.23+i/29*2.64,n*Math.PI/10,.047).toArray());
    batch.curve(points,.012,blueTrim,36,4);
  }
  for(const lat of [.65,1.0,1.36,1.75,2.14])batch.curve(Array.from({length:65},(_,n)=>shell(lat,n/64*Math.PI*2,.05).toArray()),.01,blueTrim,80,4);
  for(const phase of [0,2.7]){
    const vertices=[],indices=[];
    for(let i=0;i<=96;i++)for(const side of [-1,1]){
      const t=i/96,lat=.4+t*2.13+side*.075,theta=phase-.25+t*5.8;
      vertices.push(...shell(lat,theta,.12).toArray());
    }
    for(let i=0;i<96;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    const ribbon=new THREE.BufferGeometry();ribbon.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));ribbon.setIndex(indices);ribbon.computeVertexNormals();
    const ribbonMaterial=yellow.clone();ribbonMaterial.side=THREE.DoubleSide;batch.add(ribbon,ribbonMaterial);
  }
  batch.box(ax+.12,ay+.39,az+1.39,2.15,.72,.14,glass);
  for(let n=0;n<9;n++)batch.box(ax-.87+n*.25,ay+.39,az+1.48,.023,.73,.025,mats.silver);
  batch.box(ax+.1,ay+.82,az+1.44,2.5,.1,.67,yellow);
  batch.box(ax+1.9,ay+.32,az-.3,1.3,.62,2.5,mats.cream);
  batch.box(ax+1.9,ay+.67,az-.3,1.42,.12,2.6,mats.silver);
  const lagoon=material('#599fab',.29,.18);
  batch.add(new THREE.CylinderGeometry(1,1,.1,48),lagoon,[ax+.4,ay+.055,az+2.62],[1.89,1,1.0]);
  for(let n=0;n<=30;n++){
    const t=n/30*Math.PI,x=ax+.4+1.98*Math.cos(t),z=az+2.62+1.08*Math.sin(t);
    batch.rod([x,ay+.03,z],[x,ay+.34,z],.015,blueTrim);
    if(n<30){const nt=(n+1)/30*Math.PI;batch.rod([x,ay+.34,z],[ax+.4+1.98*Math.cos(nt),ay+.34,az+2.62+1.08*Math.sin(nt)],.02,blueTrim);}
  }
  for(let n=0;n<9;n++)batch.ball(ax-1.8+n*.44,ay+.13,az+2.3+(n%3)*.16,.24,.21,.19,mats.stone,0);

  // A visible supported yellow loop evokes Hair Raiser; its route is composed
  // for the miniature and must not be interpreted as a ride engineering model.
  const cx=3.45,cz=-2.9,cy=height(cx,cz)+.12;
  batch.box(cx,cy-.12,cz,5.9,.25,4.5,mats.path);
  const trackPoints=[];
  for(let i=0;i<=32;i++){
    const a=-Math.PI/2+i/32*Math.PI*2;
    trackPoints.push(new THREE.Vector3(cx+Math.cos(a)*1.73,cy+2.22+Math.sin(a)*1.73,cz+Math.sin(i/32*Math.PI)*.11));
  }
  trackPoints.push(new THREE.Vector3(cx+1.8,cy+.75,cz+.45),new THREE.Vector3(cx+2.65,cy+1.35,cz+1.7),new THREE.Vector3(cx+1.5,cy+1.77,cz+2.45),new THREE.Vector3(cx-.5,cy+.84,cz+1.9),new THREE.Vector3(cx-2.6,cy+.55,cz+1.0),new THREE.Vector3(cx-2.4,cy+.8,cz-.95),new THREE.Vector3(cx-1.15,cy+.67,cz-1.2));
  const track=new THREE.CatmullRomCurve3(trackPoints,true,'centripetal',.15);
  for(const offset of [-.105,.105]){
    const points=Array.from({length:300},(_,n)=>track.getPoint(n/299).add(new THREE.Vector3(0,0,offset)));
    batch.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),420,.039,6,false),yellow);
  }
  for(let n=0;n<138;n++){
    const p=track.getPoint(n/138);batch.rod([p.x,p.y,p.z-.14],[p.x,p.y,p.z+.14],.025,yellow);
  }
  for(const t of [.04,.22,.3,.45,.54,.64,.72,.78,.86,.94]){
    const p=track.getPoint(t),z=p.z+.3,g=height(p.x,z)+.05;
    batch.cylinder(p.x,g+.11,z,.14,.2,.22,mats.stone,8);
    batch.rod([p.x,g,z],[p.x,p.y-.08,p.z],.067,coral,8);
  }
  for(const s of [-1,1])batch.rod([cx+s*2.35,cy,cz-.38],[cx+s*.96,cy+3.62,cz-.09],.067,coral,8);
  const train=new THREE.Group(),trainBatch=new Batch(train);
  for(let i=0;i<3;i++){
    trainBatch.box(-.16+i*.16,.13,0,.14,.1,.3,coral);
    for(const z of [-.075,.075]){trainBatch.box(-.16+i*.16,.24,z,.075,.16,.07,blue);trainBatch.rod([-.16+i*.16,.27,z-.032],[-.16+i*.16,.27,z+.032],.018,yellow);}
  }
  trainBatch.finish();const trainPosition=track.getPoint(.69);train.position.copy(trainPosition);const tangent=track.getTangent(.69);train.rotation.z=Math.atan2(tangent.y,tangent.x);group.add(train);
  // Low colourful pavilions and striped canopies define the summit forecourt.
  for(let n=0;n<5;n++){
    const x=.9+n*.93,z=.35,y=height(x,z)+.1;
    batch.box(x,y+.3,z,.73,.6,.72,n%2?mats.cream:blueTrim);
    for(let s=0;s<5;s++)batch.box(x-.42+s*.21,y+.65,z,.2,.07,.95,s%2?mats.cream:coral,[0,0,-.1]);
  }
  const lookout=[5.85,3.35],lookoutY=height(...lookout)+.15;
  batch.box(lookout[0],lookoutY,lookout[1],2.0,.16,1.35,mats.path);deckRails(batch,lookout,2,1.35,lookoutY+.08,mats);
  pathOnTerrain(batch,height,[[-6.9,4.0],[-6.8,.7],[-4.8,-1.5],[-1.7,-.2],[1.6,1.8],[5.8,3.4]],mats.path,.34);
  const route=[[-6.35,0,-1.05],[-2.0,0,-4.6],[4.65,0,-5.75]].map(([x,,z])=>[x,height(x,z)+2.52,z]);
  const cable=cableSystem(batch,group,route,height,{color:'#dfbe58',roof:'#d2e1dc',count:3,sag:.37,speed:.013});
  for(const [x,y,z] of [route[0],route[route.length-1]]){
    batch.box(x,y-1.53,z,1.6,.5,1.5,mats.cream);batch.box(x,y-.7,z,1.7,.15,1.65,blueTrim);
    for(const dx of [-.65,.65])for(const dz of [-.6,.6]){
      batch.rod([x+dx,y-1.8,z+dz],[x+dx,y-.7,z+dz],.05,mats.silver);
      const ground=height(x+dx,z+dz)-.04;
      if(ground<y-1.8)batch.rod([x+dx,ground,z+dz],[x+dx,y-1.77,z+dz],.09,mats.stone,8);
    }
  }
  scatterTrees(batch,height,mats,{seed:300,count:300,size:.7,exclude:(x,z)=>(Math.abs(x-ax)<2.6&&Math.abs(z-az)<3)||(Math.abs(x-cx)<3.25&&Math.abs(z-cz)<2.6)||(z>-.3&&z<1.2&&x>0)||(Math.abs(z+4.7)<.65&&x>-3)});
  for(let n=0;n<52;n++){
    const a=n/52*Math.PI*2,x=Math.cos(a)*7.65,z=Math.sin(a)*7.1,h=height(x,z);
    if(h>.08)batch.ball(x,h*.67,z,.3+(n%3)*.09,h*.42+.08,.27+(n%4)*.06,mats.stone,1);
  }
  for(let n=0;n<25;n++)batch.box(-7.8+n*.64,.044,7.25+(n%3)*.32,.34,.006,.022,mats.foam);
  batch.finish();
  return {group,update:cable.update,camera:{position:[20.4,17.3,22.7],target:[0,.7,0]},description:'海岬上的乐园：蓝色蛋形水族馆、黄色过山车与越过山脊的高空缆车。',hotspots:[{label:'海洋奇观',position:[ax,ay+3.25,az+.55],description:'蓝色蛋形外壳与流动的黄色外饰，参考水族馆项目参与方公布的外观照片。'},{label:'山顶动感天地',position:[cx,cy+3.7,cz+.4],description:'以动感快车的黄轨、红色支架为识别线索；轨迹与设施位置采用艺术压缩，不是游乐设施工程模型。'},{label:'登山缆车',position:[-1.9,route[1][1]-.4,-4.4],description:'借海岸山地上的悬空缆车，表现公园低地与高峰之间的空间关系。'}]};
}
