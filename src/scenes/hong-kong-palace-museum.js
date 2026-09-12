import * as THREE from 'three';
import {Batch,material,roundedShape,polygonShape,slab,simpleTree,rng} from './hong-kong-geometry.js';

export function createHongKongPalaceMuseum(){
  const group=new THREE.Group(),b=new Batch(group),random=rng(703);
  const m={base:material('#bab5a0'),water:material('#6b9998',.3,.18),ripple:material('#b1c9c4'),paving:material('#d4cfc0'),seam:material('#b4b4a8'),grass:material('#94a46f'),bark:material('#79674e'),leaves:[material('#5c7954'),material('#789263')],bronze:material('#b09a71',.65,.16),gold:material('#c8b28b',.62,.12),light:material('#ded0af'),shadow:material('#86795f'),glass:material('#586f70',.35,.2),frame:material('#b0b4a4',.48,.2),red:material('#8f4339'),dark:material('#5c6057')};
  slab(b,roundedShape(19,16,.8),-.12,.8,m.base);
  slab(b,roundedShape(18.94,15.94,.75),.01,.12,m.water);
  slab(b,polygonShape([[-9,-7.8],[9,-7.8],[9,4.1],[5.5,4.1],[3.5,5.1],[-9,5.1]]),.2,.24,m.paving);
  b.box(-.4,.23,4.85,16.8,.08,.35,m.light);
  for(let x=-8.7;x<8.7;x+=.65)for(let z=-7.4;z<4.7;z+=.65){if(z>4&&x>3.5)continue;b.box(x,.246,z,.61,.012,.012,m.seam);b.box(x,.246,z,.012,.012,.61,m.seam);}
  b.box(5.9,.3,-2,4.2,.14,8,m.grass);
  for(let z=-5.5;z<3;z+=1.9){simpleTree(b,6.2,.36,z,1.25,m);b.box(7.8,.54,z,1,.14,.32,m.bronze);}
  for(let x=-7.8;x<3.5;x+=1.3){b.cylinder(x,.52,5.03,.023,.023,.62,m.frame,6);if(x<2.5)b.rod([x,.8,5.03],[x+1.3,.8,5.03],.022,m.frame);}
  // A tapered volume is constructed from its four independently sloping walls.
  // The broad roof and compact base, inset glazed atrium, and textured bands are the identifying features.
  function wedge(x,z,bw,bd,tw,td,y,h){
    const positions=[];
    const bottom=[[-bw/2,0,bd/2],[bw/2,0,bd/2],[bw/2,0,-bd/2],[-bw/2,0,-bd/2]],top=[[-tw/2,h,td/2],[tw/2,h,td/2],[tw/2,h,-td/2],[-tw/2,h,-td/2]];
    function triangle(a,c,d){positions.push(...a,...c,...d);}
    for(let i=0;i<4;i++){const j=(i+1)%4;triangle(bottom[i],bottom[j],top[j]);triangle(bottom[i],top[j],top[i]);}
    triangle(top[0],top[1],top[2]);triangle(top[0],top[2],top[3]);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();b.add(geo,m.bronze,[x,y,z]);
    // Alternating shallow battens follow the true taper, including the visible side faces.
    for(let yy=.07;yy<h;yy+=.092){const t=yy/h,w=bw+(tw-bw)*t,d=bd+(td-bd)*t;
      b.box(x,y+yy,z+d/2+.025,w,.043,.06,m.gold);b.box(x,y+yy,z-d/2-.025,w,.043,.06,m.gold);
      b.box(x-w/2-.025,y+yy,z,.06,.043,d,m.gold);b.box(x+w/2+.025,y+yy,z,.06,.043,d,m.gold);
    }
    // Slightly uneven vertical joints break the long horizontal bands into facade panels.
    for(let xx=-tw/2+.35;xx<tw/2;xx+=.42){
      const start=Math.max(0,(Math.abs(xx)-bw/2)/(tw-bw)*2*h);
      if(start<h)b.rod([x+xx,y+start,z+(bd+(td-bd)*start/h)/2+.065],[x+xx,y+h,z+td/2+.065],.014,m.shadow,4);
    }
    b.box(x,y+h+.04,z,tw+.12,.1,td+.12,m.light);
  }
  // Two solid wings leave a recessed central glazed vertical axis.
  wedge(-4.15,-1.4,3,4.5,4.4,5.8,1.08,4.85);
  wedge(1.15,-1.4,3,4.5,4.4,5.8,1.08,4.85);
  b.box(-1.5,2.85,-2.05,1.55,5.15,3.2,m.glass);
  b.box(-1.5,2.94,-.43,1.58,4.68,.04,m.glass);
  for(let y=.7;y<5.9;y+=.4)b.box(-1.5,y,-.38,1.56,.045,.08,m.frame);
  for(let x=-2.2;x<- .6;x+=.25)b.box(x,3.1,-.36,.028,5.2,.08,m.frame);
  b.box(-1.5,5.98,-2.1,1.7,.12,3.35,m.light);
  for(const x of [-4,.9]){b.box(x,.7,-1.4,2.7,.92,4.15,m.red);for(let xx=x-1.1;xx<x+1.2;xx+=.4)b.box(xx,.67,.7,.28,.72,.04,m.dark);}
  b.box(-1.5,.77,-.1,1.3,.95,.15,m.red);
  b.box(-1.5,1.24,.12,1.65,.1,.85,m.bronze);
  for(let i=0;i<4;i++)b.box(-1.5,.28+i*.075,1.8-i*.3,2.8-i*.13,.12,.4,m.light);
  // Plaza pergola and planting give the large building a readable human scale.
  for(const z of [1.9,3.7])for(const x of [-7.5,-5,-2.5,0,2.5])b.box(x,1.06,z,.06,1.6,.06,m.bronze);
  for(let x=-7.7;x<2.8;x+=.24)b.box(x,1.92,2.8,.08,.1,2.18,m.bronze);
  for(const z of [1.8,3.8])b.box(-2.5,1.86,z,10.8,.13,.09,m.dark);
  for(let i=0;i<18;i++){const x=-8.6+random()*15.4,z=-6.5+random()*1.2;simpleTree(b,x,.27,z,.75+random()*.6,m);}
  for(let i=0;i<45;i++)b.box(-8.5+random()*17,.07,5.6+random()*2,.15+random()*.5,.012,.025,m.ripple);
  for(const [x,z]of[[-6,4.2],[-3,4.2],[0,4.2],[4.9,2.9]]){b.cylinder(x,.92,z,.022,.04,1.4,m.dark,6);b.box(x,1.65,z,.27,.045,.09,m.light);}
  b.finish();
  return{group,camera:{position:[19.5,14,25.5],target:[-.7,2,0]},hotspots:[
    {label:'上宽下收的馆舍',position:[-3.7,6.05,-.5],description:'建筑外轮廓上宽下窄，东西立面倾斜，给地面广场留出空间。模型保留斜面、细密条带与内凹玻璃中庭。'},
    {label:'西九海滨',position:[2,.3,5.6],description:'海面、滨海步道和绿地衬托博物馆体量；这方沙盘对周围场地进行了艺术化压缩。'}],description:'香港故宫文化博物馆与西九海滨的艺术化建筑微缩景观。'};
}
