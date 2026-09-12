import * as THREE from 'three';
import {curvedHipRoof} from './detail-roof.js';

/** Shared physical construction kit. All dimensions are in local model metres.
 * Each builder owns its batches; completed groups transfer to the view lease. */
export class SubjectBuilder {
  constructor(root,palette={}) {this.root=root;this.buckets=new Map();this.materials=new Map();this.palette={stone:'#bcb4a1',edge:'#958b78',wall:'#c9b78f',wood:'#603c31',door:'#45362c',roof:'#454e49',tile:'#65706a',trim:'#aba58b',bronze:'#877b53',glass:'#8ba4ae',metal:'#c9cdca',leaf:'#457449',...palette};this.count=0;}
  material(key){if(!this.materials.has(key)){const color=this.palette[key]||key;this.materials.set(key,new THREE.MeshStandardMaterial({color,roughness:key==='glass'?.2:key==='metal'?.36:.81,metalness:key==='glass'?.36:key==='metal'?.48:0}));}return this.materials.get(key);}
  add(g,key,position=[0,0,0],rotation=[0,0,0]) {const q=rotation.isQuaternion?rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));const full=g.index?g.toNonIndexed():g;if(full!==g)g.dispose();full.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),q,new THREE.Vector3(1,1,1)));if(!this.buckets.has(key))this.buckets.set(key,[]);this.buckets.get(key).push(full);this.count++;}
  box(x,y,z,w,h,d,key='stone',yaw=0){if(w>0&&h>0&&d>0)this.add(new THREE.BoxGeometry(w,h,d),key,[x,y,z],[0,yaw,0]);}
  rod(a,b,r,key='wood',segments=8){const d=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));if(d.length()<1e-6)return;this.add(new THREE.CylinderGeometry(r,r,d.length(),segments),key,a.map((v,i)=>(v+b[i])/2),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));}
  solid(rings,bottom,top,key='stone'){if(top<=bottom)return;const s=new THREE.Shape(rings[0].map(([x,z])=>new THREE.Vector2(x,-z)));s.holes=rings.slice(1).map(r=>new THREE.Path(r.map(([x,z])=>new THREE.Vector2(x,-z))));const g=new THREE.ExtrudeGeometry(s,{depth:top-bottom,steps:1,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);this.add(g,key,[0,bottom,0]);}
  finish(name='architectural components'){for(const [key,gs]of this.buckets){const length=gs.reduce((n,g)=>n+g.attributes.position.array.length,0),p=new Float32Array(length),normals=new Float32Array(length);let offset=0;for(const g of gs){p.set(g.attributes.position.array,offset);normals.set(g.attributes.normal.array,offset);offset+=g.attributes.position.array.length;g.dispose();}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.computeBoundingBox();geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,this.material(key));mesh.castShadow=mesh.receiveShadow=true;mesh.name=name+' · '+key;this.root.add(mesh);}this.buckets.clear();return this.root;}
  dispose(){for(const gs of this.buckets.values())for(const g of gs)g.dispose();for(const m of this.materials.values())m.dispose();this.buckets.clear();}
}

export function tiledRoof(b,w,d,h,y,{hip=true,detail=true}={}) {
  b.add(curvedHipRoof(w,d,h,Math.min(.25,h*.12)),'roof',[0,y,0]);
  const roofY=(x,z)=>{const t=Math.min(1,Math.max(Math.abs(z)/(d*.5),Math.max(0,(Math.abs(x)-w*.28)/(w*.22))));return y+h*(Math.pow(1-t,1.65)+.07*Math.pow(t,8));};
  // Raised tile courses and ridge caps belong to the geometry, not a ground image.
  const count=Math.max(10,Math.min(90,Math.ceil(w/.7)));
  if(detail)for(let i=1;i<count;i++){
    const x=(i/count-.5)*w;
    for(const side of [-1,1]){let prev=[x,roofY(x,0)+.07,0];for(let k=1;k<=8;k++){const z=side*d*.5*k/8,p=[x,roofY(x,z)+.07,z];b.rod(prev,p,.075,'tile',5);prev=p;}}
  }
  for(const side of [-1,1]){let prev=null;for(let i=0;i<=18;i++){const x=(i/18-.5)*w,p=[x,roofY(x,side*d*.5),side*d*.5];if(prev)b.rod(prev,p,.17,'trim');prev=p;}}
  b.rod([-w*.28,y+h+.1,0],[w*.28,y+h+.1,0],.22,'trim');
  for(const side of [-1,1]){const a=[side*w*.28,y+h+.1,0],c=[side*w*.34,y+h+.85,0];b.rod(a,c,.17,'trim');}
  for(const sx of [-1,1])for(const sz of [-1,1]){const start=[sx*w*.28,y+h,0];let prev=start;for(let k=1;k<=10;k++){const x=sx*(w*.28+w*.22*k/10),z=sz*d*.5*k/10,p=[x,roofY(x,z)+.12,z];b.rod(prev,p,.14,'trim');prev=p;}}
}

function lattice(b,x,y,z,w,h,front=true) {
  b.box(x,y,z,w,h,.12,'door');
  for(let i=1;i<=5;i++)b.box(x-w/2+w*i/6,y,z+.09,.055,h,.07,'wood');
  for(let i=1;i<=4;i++)b.box(x,y-h/2+h*i/5,z+.09,w,.055,.07,'wood');
}
function colonnade(b,w,d,floor,height,bays=7) {
  const r=Math.min(.36,w/70),bw=w/bays;
  for(const side of [-1,1])for(let i=0;i<=bays;i++){
    const x=-w/2+i*bw,z=side*d/2;
    b.add(new THREE.CylinderGeometry(r*1.45,r*1.65,.42,10),'stone',[x,floor+.21,z]);
    b.rod([x,floor+.38,z],[x,floor+height-.35,z],r,'wood');
    // Three stepped bracket arms under the eave, with a visible cross direction.
    for(let j=0;j<3;j++){b.box(x,floor+height-.7+j*.22,z,bw*(.30+j*.12),.20,.6+j*.35,'wood');b.box(x,floor+height-.62+j*.22,z,.46,.18,1.1+j*.4,'trim');}
  }
  for(const side of [-1,1]){b.box(0,floor+height-.3,side*d/2,w+.5,.5,.5,'wood');for(let j=1;j<4;j++)b.rod([side*w/2,floor,d*(j/4-.5)],[side*w/2,floor+height,d*(j/4-.5)],r,'wood');}
}

/** Tier counts describe eaves, never invented interior storeys. */
export function templeHall({width:w,depth:d,height:h,eaves=1,name='',warm=false,main=false,supportDepth=0}) {
  const root=new THREE.Group();root.name=name||'寺院配殿';const b=new SubjectBuilder(root,warm?{wall:'#dab153',wood:'#833e2d',roof:'#464b40',tile:'#69715e'}:{});
  const plinth=.8; b.box(0,plinth/2,0,w,plinth,d,'stone');b.box(0,plinth+.15,0,w+.4,.3,d+.4,'edge');
  const roofHeight=Math.max(1.3,Math.min(d*.25,h*.22));
  const lower=eaves===3?h*.38:eaves===2?h*.52:h-roofHeight;
  b.box(0,plinth+lower/2,0,w*.85,lower,d*.77,'wall');
  colonnade(b,w*.93,d*.88,plinth,lower,main?7:Math.max(3,Math.min(7,Math.round(w/5))));
  for(const side of [-1,1])for(let k=0;k<(main?7:5);k++){const n=main?7:5,x=(k/(n-1)-.5)*w*.70;lattice(b,x,plinth+lower*.40,side*d*.388,w/n*.62,lower*.63);}
  const eaveYs=eaves===3?[lower,h*.64,h-roofHeight]:eaves===2?[lower,h-roofHeight]:[lower];
  eaveYs.forEach((ey,i)=>{
    const scale=1-i*(eaves===3?.105:.16),rw=w*1.06*scale,rd=d*1.05*scale;
    if(i){const bottom=eaveYs[i-1]-.1,upperH=ey-bottom;b.box(0,plinth+bottom+upperH/2,0,rw*.80,upperH,rd*.70,'wall');colonnade(b,rw*.88,rd*.79,plinth+bottom,upperH,main?7:5);}
    tiledRoof(b,rw,rd,i===eaveYs.length-1?roofHeight:roofHeight*.55,plinth+ey);
  });
  const stepW=w*.37,stepN=5;for(let i=0;i<stepN;i++){const sh=(plinth+.3)*(stepN-i)/stepN;b.box(0,(sh-supportDepth)/2,d/2+.3+(i+.5)*.5,stepW,sh+supportDepth,.53,'stone');}
  b.finish(name||'殿堂');root.userData={component:'temple-hall',eaves,width:w,depth:d,height:h,sourceName:name,representation:'Exterior architectural study; not measured joinery or interior reconstruction.'};return root;
}

export function shopHouse({width:w,depth:d,height:h,courtyard=false,name=''}) {
 const root=new THREE.Group();root.name=name||'白墙黛瓦街屋';const b=new SubjectBuilder(root,{wall:'#dfd9c7',roof:'#414b48',tile:'#606b65',wood:'#655042'});
 const rh=Math.min(d*.28,h*.28),wallH=h-rh;b.box(0,.22,0,w,.44,d,'edge');b.box(0,.44+wallH/2,0,w,wallH,d,'wall');
 const bays=Math.max(2,Math.min(7,Math.round(w/3.8))),floors=h>7?2:1;
 for(let k=0;k<bays;k++)for(let j=0;j<floors;j++){const x=(k+.5)/bays*w-w/2;lattice(b,x,.44+wallH*(j+.47)/floors,d/2+.08,w/bays*.63,wallH/floors*.69);}
 tiledRoof(b,w*1.05,d*1.08,rh,.44+wallH);
 if(courtyard){for(const side of [-1,1]){b.box(side*w*.485,.44+wallH*.7,0,.45,wallH*1.40,d*.55,'wall');b.box(side*w*.485,.44+wallH*1.02,0,.49,wallH*.70,d*.32,'wall');}}
 if(floors===2)b.box(0,.44+wallH*.53,d*.51,w,.24,.55,'wood');
 b.finish();root.userData={component:'street-house',representation:'Schematic facade and roof fitted to a sourced volume or explicitly identified courtyard typology.'};return root;
}

export function glassRetail(rings,height=18,name='') {
 const root=new THREE.Group();root.name=name||'商业建筑';const b=new SubjectBuilder(root,{stone:'#d9d7cf',glass:'#79919a',metal:'#cbd1d0'});b.solid(rings,0,.65,'edge');b.solid(rings,.65,height,'glass');b.solid(rings,height,height+.5,'stone');
 for(const r of rings)for(let i=1;i<r.length;i++){
  const a=r[i-1],c=r[i],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);if(len<.5)continue;const yaw=-Math.atan2(dz,dx),floorN=Math.max(2,Math.round(height/4));
  for(let j=1;j<floorN;j++)b.box((a[0]+c[0])/2,j*height/floorN,(a[1]+c[1])/2,len,.28,.4,'stone',yaw);
  for(let j=0;j<=Math.ceil(len/3.3);j++){const t=j/Math.ceil(len/3.3),x=a[0]+dx*t,z=a[1]+dz*t;b.box(x,height/2,z,.17,height,.23,'metal',yaw);}
 }
 b.finish();root.userData={component:'retail-volume',representation:'Source footprint with representative curtain wall.'};return root;
}

export function fitSubject(root,hotspots=[],{span=24,direction=[.65,.67,1],name=''}={}) {
 root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),scale=span/Math.max(size.x,size.y,size.z);
 const display=new THREE.Group();display.name=name||root.name;root.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));root.scale.multiplyScalar(scale);root.position.multiplyScalar(scale);display.add(root);
 const points=hotspots.map(h=>({...h,position:[(h.position[0]-center.x)*scale,(h.position[1]-bounds.min.y)*scale,(h.position[2]-center.z)*scale]}));
 const s=size.multiplyScalar(scale),target=[0,s.y*.43,0],dist=Math.max(s.x,s.z)*1.44+s.y*.30,d=new THREE.Vector3(...direction).normalize().multiplyScalar(dist);
 return {group:display,hotspots:points,camera:{position:[d.x,target[1]+d.y,d.z],target},displayScale:scale,modelBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},update(){}};
}
export function disposeSubject(root){const all=new Set();root.traverse(o=>{if(o.geometry)all.add(o.geometry);for(const m of[o.material].flat().filter(Boolean)){all.add(m);for(const t of Object.values(m))if(t?.isTexture)all.add(t);}if(o.isInstancedMesh)all.add(o);});for(const r of all)r.dispose?.();root.clear();}
