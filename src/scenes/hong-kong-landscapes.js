import * as THREE from 'three';
import { Batch, material, slab, roundedShape, simpleTree, rng } from './hong-kong-geometry.js';

export { Batch, material, simpleTree, rng };

// Shared only by the Hong Kong mountain scenes. Heights are authored scenic
// compositions, not elevation data. The same function grounds all props.
export function landscape(heightFunction, options = {}) {
  const width = options.width || 18.6, depth = options.depth || 17.8;
  const group = new THREE.Group(), batch = new Batch(group);
  const mats = {
    stone: material('#c5c4b0'), path: material('#d8d1b8'), earth: material('#a3a682'),
    water: material(options.waterColor || '#78a8a2', .34, .08), foam: material('#c5d9c7'),
    bark: material('#6b6550'), leaves: ['#416650', '#5a7856', '#71855a', '#8b9868'].map(c => material(c)),
    silver: material('#c5ccc6', .48, .3), dark: material('#3b5050', .55, .12), cream: material('#e6e1cc'),
  };
  slab(batch, roundedShape(width, depth, .6), -.04, .8, mats.stone, .06);
  slab(batch, roundedShape(width-.06, depth-.06, .59), .018, .065, mats.water, .025);
  const height = (x, z) => {
    const edge = Math.max(0, Math.min(1, (width/2-Math.abs(x))/.65, (depth/2-Math.abs(z))/.65));
    return Math.max(0, heightFunction(x,z) * edge);
  };
  const resolution = 88, positions = [], colors = [], indices = [];
  const green = new THREE.Color('#6d865b'), low = new THREE.Color('#a2ac7c'), high = new THREE.Color('#8f9871');
  for (let iz=0;iz<=resolution;iz++) for(let ix=0;ix<=resolution;ix++) {
    const x=(ix/resolution-.5)*(width-.12), z=(iz/resolution-.5)*(depth-.12), h=height(x,z);
    // Keep submerged triangles: the water plane cuts the terrain continuously,
    // instead of removing whole triangles and producing a staircase coastline.
    positions.push(x, h-.04, z);
    const c=low.clone().lerp(green, Math.min(1,h/2)).lerp(high,Math.max(0,(h-3.7)/2));
    c.multiplyScalar(.94+.06*Math.sin(x*2.4+z*.8)*Math.cos(z*2.1)); colors.push(c.r,c.g,c.b);
  }
  for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++) {
    const a=z*(resolution+1)+x,b=a+resolution+1;
    indices.push(a,b,a+1,a+1,b,b+1);
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  terrainGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrainGeo.setIndex(indices);terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo,new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:1}));
  terrain.name='Authored mountain terrain';terrain.castShadow=terrain.receiveShadow=true;group.add(terrain);
  return {group,batch,mats,height};
}

export const hill=(x,z,cx,cz,rx,rz,h)=>h*Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2));

export function scatterTrees(batch,height,mats,{seed=862,count=125,exclude=()=>false,minHeight=.2,size=.7}={}) {
  const random=rng(seed);
  for(let n=0;n<count;n++) {
    const x=(random()-.5)*17.1,z=(random()-.5)*16.2,h=height(x,z);
    if(h<minHeight||exclude(x,z))continue;
    simpleTree(batch,x,h-.055,z,size*(.65+random()*.65),mats);
  }
}

export function pathOnTerrain(batch,height,points,mat,width=.3) {
  const curve=new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,0,z)));
  let prev=null;
  for(let n=0;n<=80;n++) {
    const p=curve.getPoint(n/80);p.y=height(p.x,p.z)+.08;
    if(height(p.x,p.z)<.16){prev=null;continue;}
    if(prev)batch.rod(prev.toArray(),p.toArray(),width/2,mat,8);
    prev=p;
  }
}

export function deckRails(batch,center,width,depth,y,mats) {
  const [cx,cz]=center;
  for(const side of [-1,1]) {
    for(let i=0;i<=Math.ceil(width/.32);i++) {
      const x=cx-width/2+i*width/Math.ceil(width/.32);
      batch.rod([x,y,cz+side*depth/2],[x,y+.3,cz+side*depth/2],.017,mats.silver);
    }
    batch.rod([cx-width/2,y+.3,cz+side*depth/2],[cx+width/2,y+.3,cz+side*depth/2],.023,mats.silver);
    batch.rod([cx+side*width/2,y+.3,cz-depth/2],[cx+side*width/2,y+.3,cz+depth/2],.023,mats.silver);
    for(let i=0;i<=Math.ceil(depth/.32);i++) {
      const z=cz-depth/2+i*depth/Math.ceil(depth/.32);
      batch.rod([cx+side*width/2,y,z],[cx+side*width/2,y+.3,z],.017,mats.silver);
    }
  }
}

export function cableSystem(batch,group,supports,groundHeight,options={}) {
  const steel=options.steel||material('#d0d3c7',.5,.22), dark=material('#405451',.55,.12);
  const blue=material(options.color||'#287fa0',.46,.12), glass=material('#385d65',.38,.18);
  const roof=material(options.roof||'#e5e2ca',.62), sag=options.sag??.48;
  const tracks=[-.3,.3], spanCount=supports.length-1;
  function point(t,line=0) {
    const segment=Math.min(spanCount-1,Math.floor(t*spanCount)),u=Math.min(1,t*spanCount-segment);
    const a=supports[segment],b=supports[segment+1];
    return new THREE.Vector3(THREE.MathUtils.lerp(a[0],b[0],u)+tracks[line],THREE.MathUtils.lerp(a[1],b[1],u)-4*sag*u*(1-u),THREE.MathUtils.lerp(a[2],b[2],u));
  }
  supports.forEach(([x,y,z],i)=>{
    const ground=groundHeight(x,z)+.05;
    batch.box(x,ground+.13,z,.58,.26,.62,steel);
    for(const side of [-1,1])batch.rod([x+side*.2,ground,z],[x+side*.06,y-.18,z],.065,steel,8);
    batch.box(x,y-.12,z,1.15,.14,.38,steel);
    for(const dx of tracks)for(const dz of [-.14,.14])batch.cylinder(x+dx,y-.045,z+dz,.09,.09,.06,dark,8);
    if(i>0&&i<supports.length-1)for(let h=ground+.5;h<y-.35;h+=.45)batch.rod([x-.17,h,z],[x+.17,h+.35,z],.025,steel);
  });
  for(let line=0;line<2;line++)for(let span=0;span<spanCount;span++) {
    const points=Array.from({length:25},(_,i)=>point((span+i/24)/spanCount,line).toArray());
    batch.curve(points,.022,dark,48,5);
  }
  const template=new THREE.Group(),cab=new Batch(template);
  cab.cylinder(0,.19,0,.31,.24,.34,blue,8);
  cab.cylinder(0,.49,0,.29,.31,.3,glass,8);
  cab.cylinder(0,.68,0,.29,.31,.07,roof,8);
  cab.cylinder(0,.04,0,.24,.21,.06,dark,8);
  for(let n=0;n<8;n++){const a=n*Math.PI/4;cab.rod([Math.cos(a)*.30,.31,Math.sin(a)*.30],[Math.cos(a)*.29,.66,Math.sin(a)*.29],.017,steel);}
  cab.rod([0,.7,0],[0,1.1,0],.025,steel);cab.rod([0,1.1,0],[.13,1.25,0],.025,steel);cab.box(.12,1.27,0,.19,.07,.12,dark);cab.finish();
  const cabins=[];
  for(let line=0;line<2;line++)for(let n=0;n<(options.count||4);n++) {
    const cabin=template.clone(true);cabin.name='Suspended cable car';group.add(cabin);cabins.push({cabin,line,offset:(n+.35)/(options.count||4)});
  }
  const update=(time)=>cabins.forEach(({cabin,line,offset})=>{
    const phase=(offset+time*(options.speed||.014))%1, t=.012+.976*(line===0?phase:1-phase), p=point(t,line);
    cabin.position.copy(p);cabin.position.y-=1.27;
    const next=point(Math.min(.999,t+.002),line).sub(p);cabin.rotation.y=Math.atan2(next.x,next.z);
  });
  update(0);return {update,point,cabins};
}

export function villageBuilding(batch,x,y,z,width,depth,height,mats,roofMat) {
  batch.box(x,y+height/2,z,width,height,depth,mats.cream);
  batch.box(x,y+.06,z,width+.12,.12,depth+.12,mats.stone);
  const roof=new THREE.Shape();roof.moveTo(-width*.6,0);roof.lineTo(0,width*.25);roof.lineTo(width*.6,0);roof.closePath();
  const g=new THREE.ExtrudeGeometry(roof,{depth:depth*1.18,bevelEnabled:false});
  batch.add(g,roofMat,[x,y+height,z-depth*.59]);
  for(let n=-1;n<=1;n++)batch.box(x+n*width*.26,y+height*.5,z+depth*.505,width*.14,height*.35,.015,mats.dark);
}
