import * as THREE from 'three';
import {Batch,material,roundedShape,slab,simpleTree,rng} from './hong-kong-geometry.js';

// An original, compressed architectural miniature of the Castle of Magical Dreams.
export function createHongKongDisneyland(){
  const group=new THREE.Group(),b=new Batch(group),random=rng(1120);
  const m={base:material('#c4b696'),grass:material('#80945b'),hedge:material('#486e49'),bark:material('#766346'),leaves:[material('#567748'),material('#6f8950'),material('#8f9d5f')],path:material('#e2c9b1'),water:material('#70b3b2',.26,.2),ripple:material('#b2d5cd',.3),stone:material('#bab5aa'),cream:material('#f2d7a5'),pink:material('#d59fa0'),rose:material('#c37d83'),trim:material('#fff0cf'),blue:material('#487b94',.55,.12),teal:material('#447c7c',.5,.15),purple:material('#826b9e'),gold:material('#d8b55d',.37,.35),window:material('#455865'),door:material('#715753')};
  slab(b,roundedShape(19,16,.85),-.1,.8,m.base);
  slab(b,roundedShape(18.9,15.9,.8),.02,.1,m.grass);
  b.cylinder(0,.09,.4,6.8,6.8,.12,m.water,72);
  b.cylinder(0,.22,.1,5.35,5.4,.3,m.stone,64);
  b.cylinder(0,.39,.1,5.2,5.2,.08,m.path,64);
  // Forecourt and bridge sit above an actual open moat.
  b.box(0,.28,5.95,2.6,.42,4,m.path);
  for(const x of [-1.28,1.28]){
    b.box(x,.65,5.65,.14,.45,3.1,m.trim);
    for(let z=4.15;z<7.4;z+=.48)b.box(x,.9,z,.22,.18,.24,m.cream);
  }
  for(let z=4.5;z<7.6;z+=.4)b.box(0,.501,z,2.35,.014,.035,m.stone);
  for(let side of [-1,1]){
    b.box(side*5.6,.1,6.1,4.5,.12,2.8,m.path);
    b.box(side*5.6,.25,6.1,3.5,.22,1.8,m.hedge);
    for(let i=0;i<28;i++){const x=side*5.6+(random()-.5)*3.2,z=6.1+(random()-.5)*1.5;b.ball(x,.41,z,.08,.07,.08,i%3?m.pink:m.trim,0);}
  }
  function arch(x,y,z,w,h,mat,depth=.045){
    const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h-w/2);s.absarc(0,h-w/2,w/2,0,Math.PI,false);s.closePath();
    b.add(new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:8}),mat,[x,y,z]);
  }
  function window(x,y,z,w=.25,h=.55){arch(x,y-.06,z,w+.12,h+.15,m.trim);arch(x,y,z+.035,w,h,m.window);b.box(x,y+h*.38,z+.09,.028,h*.73,.04,m.gold);}
  function roof(x,y,z,r,h,mat,bulb=false){
    const profile=bulb?[[0,0],[r*.62,0],[r*.9,h*.18],[r,h*.38],[r*.7,h*.68],[r*.23,h*.88],[0,h]]:[[0,0],[r,0],[r*.92,h*.12],[r*.64,h*.4],[r*.34,h*.7],[.02,h]];
    b.add(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),24),mat,[x,y,z]);
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6,points=profile.slice(1).map(([rr,hh])=>[x+Math.cos(a)*(rr+.012),y+hh,z+Math.sin(a)*(rr+.012)]);b.curve(points,.014,m.gold,12,4);
    }
    b.cylinder(x,y+h+.14,z,.018,.024,.3,m.gold,6);b.ball(x,y+h+.32,z,.06,.07,.06,m.gold,1);
  }
  function tower(x,z,r,height,color,roofmat,roofheight,bulb=false){
    const floor=.47;
    b.cylinder(x,floor+height/2,z,r*.94,r,height,color,24);
    b.cylinder(x,floor+.22,z,r+ .07,r+.12,.4,m.stone,24);
    for(let y=1.4;y<height;y+=1.25){b.cylinder(x,floor+y,z,r+.05,r+.05,.1,m.trim,24);window(x,floor+y+.2,z+r*.96,r*.48,.65);}
    // Vertical stone quoins and raised cornice frame each cylindrical turret.
    for(let a=0;a<Math.PI*2;a+=Math.PI/3)b.box(x+Math.cos(a)*r*.94,floor+height/2,z+Math.sin(a)*r*.94,.08,height,.08,m.trim);
    b.cylinder(x,floor+height-.05,z,r*1.12,r*1.04,.18,m.trim,24);
    roof(x,floor+height+.06,z,r*1.16,roofheight,roofmat,bulb);
  }
  function hall(x,y,z,w,h,d,col){
    b.box(x,y+h/2,z,w,h,d,col);b.box(x,y+h,z,w+.15,.15,d+.12,m.trim);
    for(let xx=x-w/2+.4;xx<x+w/2-.1;xx+=.58)window(xx,y+.55,z+d/2+.02,.24,.65);
    for(let xx=x-w/2+.05;xx<x+w/2;xx+=.46)b.box(xx,y+h+.22,z+d/2,.22,.35,.26,m.trim);
  }
  // Original low castle foundation retained beneath the newer asymmetric towers.
  hall(-2.7,.46,1.5,3.2,1.65,1.8,m.pink);hall(2.8,.46,1.5,3.4,1.65,1.8,m.pink);
  hall(0,.46,-.8,5.6,2.5,2.6,m.cream);hall(-.2,2.8,-.9,2.8,1.7,1.8,m.cream);
  // Central gate: actual hollow arch, with a shadowed passage behind.
  b.box(-.8,1.47,2.25,.58,2.02,1.15,m.cream);b.box(.8,1.47,2.25,.58,2.02,1.15,m.cream);
  b.box(0,2.45,2.25,2.2,.55,1.15,m.cream);
  b.add(new THREE.TorusGeometry(.51,.14,6,24,Math.PI),m.trim,[0,1.68,2.85]);
  for(const x of [-.51,.51])b.box(x,1.07,2.85,.25,1.22,.16,m.trim);
  arch(0,.47,1.66,.9,1.75,m.door);b.box(0,2.88,2.2,2.3,.17,1.35,m.trim);
  for(let x=-.96;x<=1;x+=.32)b.box(x,3.07,2.75,.17,.3,.21,m.trim);
  tower(-4.15,1.75,.55,2.7,m.pink,m.blue,1.55);
  tower(4.28,1.65,.58,3.05,m.pink,m.blue,1.65);
  tower(-2.6,.35,.65,4.1,m.cream,m.teal,1.8);
  tower(2.62,.32,.67,4.5,m.cream,m.blue,1.5);
  tower(-1.45,-1.4,.54,5.55,m.cream,m.blue,2.15);
  tower(.35,-1.52,.63,6.9,m.cream,m.gold,2.1);
  tower(1.55,-2.04,.47,5.4,m.cream,m.teal,1.65,true);
  tower(-3.2,-1.9,.53,3.9,m.rose,m.purple,1.7);
  tower(3.55,-1.55,.49,4.2,m.cream,m.gold,1.25,true);
  tower(-.1,.6,.46,4.8,m.pink,m.blue,1.8);
  tower(-2.22,-3.3,.38,4.45,m.cream,m.teal,1.5);
  tower(1,-3.35,.43,4.75,m.cream,m.purple,1.5);
  tower(3.6,-3.1,.32,3.35,m.cream,m.blue,1.2);
  // Layered steep roofs over connecting halls.
  for(const [x,z,w,d,y] of [[-3,1.2,2.4,1.7,2.2],[3,1.2,2.6,1.7,2.2],[-.3,-2.6,3.2,2.2,3]]){
    const geo=new THREE.CylinderGeometry(0,1,1,4);geo.rotateY(Math.PI/4);b.add(geo,m.blue,[x,y+.6,z],[w*.78,1.2,d*.78]);
  }
  for(let i=0;i<72;i++){
    const x=(random()-.5)*17.6,z=(random()-.5)*14.3;
    if(Math.hypot(x,z-.4)<6.8||z>4.7)continue;
    simpleTree(b,x,.1,z,.8+random()*1.3,m);
  }
  for(let i=0;i<30;i++){const a=i*.37,r=6.15+random()*.35;b.box(Math.cos(a)*r,.166,Math.sin(a)*r+.4,.14+random()*.35,.018,.025,m.ripple);}
  for(const x of [-2.2,2.2])for(const z of [4.7,6.9]){b.cylinder(x,.95,z,.025,.04,1.8,m.gold,6);b.ball(x,1.89,z,.12,.15,.12,m.trim,1);}
  b.finish();
  return{group,camera:{position:[15,13.5,27],target:[0,3.1,0]},hotspots:[
    {label:'奇妙梦想城堡',position:[.35,9.6,-1.52],description:'以多组不同轮廓的尖塔、穹顶与塔楼组成非对称天际线；这方沙盘提炼其建筑特征。'},
    {label:'城门与护城河',position:[0,1,4.2],description:'从桥面进入低层城门，水面、庭院与层层向上的塔楼共同形成纵深。'}],description:'香港迪士尼奇妙梦想城堡的艺术化建筑微缩景观。'};
}
