import * as THREE from 'three';
import {landscape,hill,scatterTrees,pathOnTerrain,deckRails,Batch,material,rng} from './hong-kong-landscapes.js';

export function createVictoriaPeak(){
  const view=landscape((x,z)=>hill(x,z,-2,1.2,4.7,3.7,3.55)+hill(x,z,-6.1,1.5,2,4.8,1.7)+hill(x,z,5,1.7,2.2,3.3,1.3)+(z< -4.9&&z> -6.9?.24:0));
  const {group,batch,mats,height}=view;group.name='Victoria Peak · 太平山顶';
  const silver=material('#c9cfc9',.48,.26), glass=material('#3d6770',.35,.18), red=material('#a73f31'),white=material('#e1e0d2');
  const tx=-2,tz=1.05,base=height(tx,tz)+.13;
  batch.box(tx,base-.14,tz,4.7,.28,3.9,mats.path);
  // The broad white base and central glass atrium support the crescent bowl.
  batch.box(tx,base+.57,tz,3.1,1.14,2.45,white);
  batch.box(tx,base+.62,tz+1.25,.93,1.13,.035,glass);
  for(const s of [-1,1])for(let x=0;x<3;x++)for(let y=0;y<3;y++)batch.box(tx+s*(.7+x*.36),base+.23+y*.28,tz+1.24,.1,.095,.055,silver);
  for(let n=0;n<4;n++)batch.box(tx,base+.3+n*.29,tz+1.284,.9,.029,.035,silver);
  batch.box(tx,base+1.13,tz,3.6,.13,2.9,silver);
  batch.box(tx,base+1.67,tz,1.65,1.06,1.9,glass);
  for(const s of [-1,1])batch.box(tx+s*.94,base+1.74,tz,.28,1.23,1.94,silver);
  for(let n=0;n<5;n++)batch.box(tx,base+1.24+n*.22,tz+1.0,1.68,.033,.033,silver);
  batch.rod([tx-.65,base+1.2,tz+1.025],[tx+.65,base+2.2,tz+1.025],.035,silver);
  const bottom=x=>2.05+1.48*(x/3.23)**2;
  const crescent=new THREE.Shape();crescent.moveTo(-3.23,3.73);crescent.lineTo(3.23,3.73);
  for(let n=64;n>=0;n--){const x=-3.23+n/64*6.46;crescent.lineTo(x,bottom(x));}crescent.closePath();
  const bowl=new THREE.ExtrudeGeometry(crescent,{depth:2.75,steps:1,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:2});
  batch.add(bowl,silver,[tx,base,tz-1.375]);
  // Glazed crescent panels follow the curved lower edge, leaving metal ribs.
  for(const face of [-1,1])for(let n=0;n<24;n++){
    const x0=-2.99+n*.249,x1=x0+.221;
    const p=new THREE.Shape();p.moveTo(x0,3.49);p.lineTo(x1,3.49);p.lineTo(x1,bottom(x1)+.2);p.lineTo(x0,bottom(x0)+.2);p.closePath();
    batch.add(new THREE.ShapeGeometry(p),glass,[tx,base,tz+face*1.416],[1,1,1],face<0?[0,Math.PI,0]:[0,0,0]);
  }
  for(const side of [-1,1]){
    batch.rod([tx+side*.68,base+2.46,tz+1.46],[tx+side*1.42,base+3.52,tz+1.46],.07,silver);
    batch.rod([tx+side*2.05,base+3.03,tz+1.45],[tx+side*1.72,base+3.52,tz+1.45],.055,silver);
  }
  for(let n=0;n<=16;n++){
    const x=-3.2+n*.4;batch.rod([tx+x,base+bottom(x),tz-1.38],[tx+x,base+bottom(x),tz+1.38],.018,mats.dark);
  }
  batch.box(tx,base+3.77,tz,6.45,.085,2.77,mats.path);
  deckRails(batch,[tx,tz],6.42,2.75,base+3.81,mats);
  // Telescope and small visitor figures establish terrace scale.
  for(const x of [-1.65,.3,1.7]){
    batch.cylinder(tx+x,base+4.04,tz+1.03,.04,.07,.46,silver,8);
    batch.rod([tx+x-.13,base+4.25,tz+1.1],[tx+x+.13,base+4.25,tz+1.1],.065,mats.dark);
  }
  for(let n=0;n<9;n++){const x=tx-2.7+n*.61;batch.cylinder(x,base+3.99,tz-.91,.046,.058,.27,n%3?mats.dark:red,6);batch.ball(x,base+4.17,tz-.91,.055,.06,.055,mats.path,0);}
  batch.box(tx-2.0,base+.3,tz-1.68,1.75,.65,1.2,mats.cream);batch.box(tx-2.0,base+.69,tz-1.68,1.93,.14,1.37,silver);

  pathOnTerrain(batch,height,[[-7,5],[-5,3.9],[-4.8,-.3],[-2.7,-2.4],[.4,-1.8],[1.7,.3],[3.3,2.0]],mats.path,.3);
  scatterTrees(batch,height,mats,{seed:461,count:235,size:.83,exclude:(x,z)=>(Math.abs(x-tx)<3.45&&Math.abs(z-tz)<2.13)||(x>-.6&&z>2&&Math.abs(x-(z-1.3))<.7)||z< -4.7});
  const tramPath=new THREE.CatmullRomCurve3([[4.65,.53,6.85],[3.18,1.39,5.04],[1.2,2.6,3.35],[-.75,base+.04,2.15]].map(p=>new THREE.Vector3(...p)));
  for(let n=0;n<65;n++){
    const t=n/64,p=tramPath.getPoint(t),tangent=tramPath.getTangent(t),side=new THREE.Vector3(tangent.z,0,-tangent.x).normalize();
    const left=p.clone().addScaledVector(side,.24),right=p.clone().addScaledVector(side,-.24);
    batch.rod(left.toArray(),right.toArray(),.045,mats.stone);
    for(const s of [-1,1]){const next=tramPath.getPoint(Math.min(1,t+1/64)).addScaledVector(side,s*.16);batch.rod(p.clone().addScaledVector(side,s*.16).toArray(),next.toArray(),.025,mats.dark);}
    if(n%6===0&&p.y>height(p.x,p.z)+.15){batch.rod([p.x,height(p.x,p.z),p.z],p.toArray(),.06,silver);}
  }
  const tram=new THREE.Group(),tb=new Batch(tram),green=material('#256e58',.48),roof=material('#dbd8c2');
  tb.box(0,.25,0,.48,.4,1.3,green);tb.box(0,.52,0,.46,.16,1.23,glass);tb.box(0,.65,0,.53,.11,1.38,roof);
  for(const s of [-1,1])for(let n=0;n<6;n++)tb.box(s*.242,.5,-.51+n*.2,.028,.2,.026,silver);
  for(const z of [-.4,.4])tb.rod([-.25,.065,z],[.25,.065,z],.075,mats.dark,8);
  tb.box(0,.32,.656,.36,.23,.023,glass);tb.finish();group.add(tram);
  const random=rng(117);const urban=[material('#b7c2b5'),material('#97b0b0'),material('#8b9da1'),material('#d1d1bf')];
  for(let n=0;n<93;n++){
    const x=-7.5+random()*15,z=-6.65+random()*1.7,w=.18+random()*.26,d=.2+random()*.24,h=.35+random()*1.35;
    const y=height(x,z)+.06;batch.box(x,y+h/2,z,w,h,d,urban[n%4]);
    for(let f=.22;f<h;f+=.19)batch.box(x,y+f,z+d/2+.009,w*.88,.016,.012,silver);
  }
  // Distant city silhouettes convey the view, not a surveyed skyline model.
  const bx=2.7,bz=-5.65,by=height(bx,bz)+.06;
  batch.box(bx,by+1.18,bz,.47,2.36,.47,glass);
  for(const s of [-1,1])batch.rod([bx+s*.23,by,bz+.25],[bx-s*.23,by+2.36,bz+.25],.025,silver);
  batch.rod([bx,by+2.36,bz],[bx,by+2.85,bz],.028,silver);
  for(let n=0;n<5;n++)batch.box(5.0, .62+n*.44,-5.9,.73-n*.1,.45,.68-n*.06,urban[0]);
  for(let n=0;n<16;n++)batch.box(-6.8+n*.88,.044,-7.5+(n%3)*.14,.46,.006,.017,mats.foam);
  batch.finish();
  const update=time=>{const t=.04+.92*(.5-.5*Math.cos(time*.17));const p=tramPath.getPoint(t),v=tramPath.getTangent(t);tram.position.copy(p);tram.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),v);};update(0);
  return {group,update,camera:{position:[20.4,16.8,22.7],target:[0,1.15,0]},description:'从林间山顶缆车到凌霄阁的弯月形天台，俯瞰层叠山坡与远处海港。',hotspots:[{label:'凌霄阁',position:[tx,base+3.5,tz+1.6],description:'以设计者资料和官方照片为参考，重绘弯月形上部、玻璃中庭与屋顶观景平台。'},{label:'山顶缆车',position:[2,2.8,4.1],description:'山顶缆车沿有轨坡道往返；这里将林间路线压缩为可观察的微缩片段。'},{label:'从山顶望维港',position:[3.9,1.6,-5.8],description:'以山坡、城市和水面表现远眺层次；楼群密度、距离与地形经过艺术重组。'}]};
}
