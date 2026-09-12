import * as THREE from 'three';
import {SubjectBuilder,tiledRoof} from './subject-kit.js';

const TAU=Math.PI*2;
const leafColours=['#234e36','#366440','#537c46','#769251'];
export function lobed(b,x,y,z,rx,ry,rz,key,detail=1){
 const g=new THREE.IcosahedronGeometry(1,detail);g.scale(rx,ry,rz);b.add(g,key,[x,y,z]);
}
export function broadleaf(b,x,y,z,h,seed=0){
 const r=h*.24,colour=leafColours[seed%4];
 b.add(new THREE.CylinderGeometry(h*.018,h*.042,h*.55,7),'#6c6047',[x,y+h*.26,z]);
 for(let i=0;i<5;i++){
  const a=TAU*i/5+seed,xx=x+Math.cos(a)*r*.52,zz=z+Math.sin(a)*r*.52,yy=y+h*(.62+.08*Math.sin(i*1.7));
  b.rod([x,y+h*.34,z],[xx,yy,zz],h*.015,'#6c6047',5);
  lobed(b,xx,yy,zz,r*.76,h*.20,r*.72,colour,1);
 }
 lobed(b,x,y+h*.81,z,r*.77,h*.21,r*.77,leafColours[(seed+1)%4],1);
}
export function willow(b,x,y,z,h,seed=0){
 const r=h*.32;const c=['#668444','#819a50','#5e7e3e'][seed%3];
 b.rod([x,y-.7,z],[x+r*.13,y+h*.66,z],h*.035,'#6f654c',7);
 for(let i=0;i<8;i++){
  const a=i*TAU/8+seed*.2,dx=Math.cos(a),dz=Math.sin(a);
  b.rod([x,y+h*.5,z],[x+dx*r*.8,y+h*.72,z+dz*r*.8],h*.015,'#6f654c',5);
  lobed(b,x+dx*r*.56,y+h*.73,z+dz*r*.56,r*.6,h*.15,r*.57,c,1);
  for(let k=0;k<3;k++){
   const aa=a+(k-1)*.21,rr=r*(.82+k*.08);
   const points=[[x+Math.cos(aa)*rr*.62,y+h*.8,z+Math.sin(aa)*rr*.62],[x+Math.cos(aa)*rr,y+h*.60,z+Math.sin(aa)*rr],[x+Math.cos(aa)*rr*.96,y+h*(.22+.045*k),z+Math.sin(aa)*rr*.96]];
   b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),5,h*.025,3,false),c);
  }
 }
}
export function cedar(b,x,y,z,h,seed=0){
 const r=h*(.21+(seed%3)*.012),colour=['#254d3c','#315b41','#3f6c46'][seed%3];
 b.add(new THREE.CylinderGeometry(h*.009,h*.04,h*.96,9),'#7a6250',[x,y+h*.46,z]);
 // Visible spreading branches and layered uneven sprays distinguish old
 // Cryptomeria from spherical ornamental trees and uniform pine cones.
 for(let tier=0;tier<5;tier++){
  const t=tier/4,yy=y+h*(.56+t*.37),spread=r*(.65+.30*Math.sin(t*Math.PI))*(1+.12*Math.sin(seed+tier));
  for(let k=0;k<5;k++){
   const a=k*TAU/5+tier*.69+seed,xx=x+Math.cos(a)*spread,zz=z+Math.sin(a)*spread;
   b.rod([x,yy-.04*h,z],[xx,yy+.035*h,zz],h*.009,'#75614b',5);
   lobed(b,xx,yy+.035*h,zz,spread*.62,h*(.07-.018*t),spread*.56,colour,1);
  }
 }
 lobed(b,x,y+h*.96,z,r*.30,h*.07,r*.28,'#507a4c',1);
}
export function fern(b,x,y,z,h,seed=0){
 b.rod([x,y-.35,z],[x,y+h*.18,z],h*.025,'#607542',4);
 const vs=[];for(let k=0;k<7;k++){
  const a=k*TAU/7+seed,dx=Math.cos(a),dz=Math.sin(a),len=h*(.75+.15*(k%3));
  for(let i=1;i<=5;i++){
   const t=i/5,xx=x+dx*len*t,zz=z+dz*len*t,yy=y+h*Math.sin(t*Math.PI)*.40;
   const r=h*(1-t*.75)*.17;
   vs.push(x+dx*len*(t-.18),yy,z+dz*len*(t-.18),xx-dz*r,yy+.07*h,zz+dx*r,xx+dx*h*.12,yy,zz+dz*h*.12);
   vs.push(x+dx*len*(t-.18),yy,z+dz*len*(t-.18),xx+dx*h*.12,yy,zz+dz*h*.12,xx+dz*r,yy+.07*h,zz-dx*r);
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vs,3));g.computeVertexNormals();b.add(g,seed%2?'#709447':'#557d3b');
}
export function reedClump(b,x,y,z,h,seed=0){
 for(let k=0;k<7;k++){
  const a=k*2.4+seed,r=h*.3*Math.sqrt((k+1)/7),px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,hh=h*(.75+.08*(k%4)),dx=Math.cos(a)*hh*.13,dz=Math.sin(a)*hh*.13;
  b.rod([px,y-.3,pz],[px+dx,y+hh,pz+dz],h*.024,'#868356',4);
  for(let j=1;j<=2;j++)lobed(b,px+dx*j*.6,y+hh*j*.27,pz+dz*j*.6,h*.045,h*.21,h*.1,'#76854e',0);
  lobed(b,px+dx,y+hh,pz+dz,h*.075,h*.20,h*.075,['#d8cfa5','#dce0bc','#c2bf90'][k%3],1);
 }
}
export function pavilion(width=30,height=27,name='亭'){
 const root=new THREE.Group();root.name=name;const b=new SubjectBuilder(root,{wood:'#804b39',roof:'#414d4b',tile:'#76847a',stone:'#d7ccae'});
 const w=width,d=width*.8;b.box(0,height*.04,0,w,height*.08,d,'stone');
 for(const x of [-.38,0,.38])for(const z of [-.33,.33])b.rod([x*w,height*.08,z*width],[x*w,height*.69,z*width],width*.025,'wood');
 for(const z of [-1,1])b.box(0,height*.2,z*d*.46,w*.93,height*.045,width*.035,'wood');
 tiledRoof(b,w*1.2,d*1.2,height*.27,height*.66,{detail:false});
 b.finish(name);return root;
}
export function stonePagodas(b,x,y,z,height=48){
 const positions=[[-36,-20],[36,-20],[0,42]],profile=[[.14,0],[.20,.055],[.12,.15],[.1,.24],[.20,.32],[.23,.44],[.2,.55],[.09,.61],[.06,.70],[.19,.73],[.09,.79],[.06,.82],[.055,.93],[0,1]];
 for(const[dx,dz]of positions){
  const cx=x+dx,cz=z+dz;
  b.add(new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r*height,h*height)),24),'#c7b98d',[cx,y-1,cz]);
  for(let i=0;i<5;i++){
   const a=i*TAU/5;
   lobed(b,cx+Math.cos(a)*height*.22,y+height*.43,cz+Math.sin(a)*height*.22,height*.047,height*.064,height*.047,'#514b3d',1);
  }
 }
}
export function visitorBoat({length=32,cruise=false,name='游船'}={}){
 const root=new THREE.Group();root.name=name;const b=new SubjectBuilder(root),w=length*(cruise?.26:.24),h=length*.065;
 const hull=[[-w*.1,-length*.5],[-w*.48,-length*.35],[-w*.5,length*.26],[-w*.27,length*.47],[w*.27,length*.47],[w*.5,length*.26],[w*.48,-length*.35],[w*.1,-length*.5]];
 b.solid([hull],-h*.6,h*.48,cruise?'#e5e2ce':'#705c42');
 b.solid([hull.map(([x,z])=>[x*.83,z*.90])],h*.48,h*.6,'#ba9c68');
 if(cruise){
  for(let f=0;f<2;f++){
   b.box(0,h*(1.12+f),length*.04,w*.78,h*.85,length*.60,'#547c86');
   b.box(0,h*(1.59+f),length*.04,w*.87,h*.13,length*.67,'#dfdfd0');
   for(let i=-4;i<=4;i++)for(const side of [-1,1])b.box(side*w*.4,h*(1.12+f),i*length*.063,w*.025,h*.85,length*.015,'#cdd3cd');
  }
  b.box(0,h*2.82,0,w*.54,h*.2,length*.45,'#d2aa73');
 }else{
  const len=length*.51,ry=w*.45;
  const canopy=new THREE.CylinderGeometry(ry,ry,len,14,1,true,0,Math.PI);canopy.rotateZ(Math.PI/2);canopy.rotateY(Math.PI/2);b.add(canopy,'#b99762',[0,h*2,length*.06]);
  for(let i=-2;i<=2;i++){b.box(0,h*.7,i*length*.12,w*.8,h*.17,length*.035,'#9c7a4b');}
  for(const side of [-1,1])b.rod([side*w*.44,h*.5,-len/2],[side*w*.44,h*2,-len/2],w*.025,'#6d513d');
  b.rod([0,h*.9,length*.30],[w*.85,h*.1,length*.72],length*.018,'#746047');
 }
 b.finish(name);return root;
}
