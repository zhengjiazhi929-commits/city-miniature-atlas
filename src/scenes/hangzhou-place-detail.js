import * as THREE from 'three';
import {createHangzhouSurfaceSampler} from '../hangzhou-surface.js';
import {createSignatureBuilding} from '../hangzhou-signature-buildings.js';
import {createAirportModel} from '../airport-model.js';
import {curvedHipRoof} from './detail-roof.js';

const NAMES={xiaohe:'小河直街',faxi:'法喜寺',lingyin:'灵隐寺',longmen:'龙门古镇',tianmu:'天目山',xixi:'西溪湿地',olympic:'杭州奥体中心','hubin-yintai':'湖滨银泰',qiandao:'千岛湖',zshc:'杭州萧山国际机场'};
const inRing=(p,r)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
const inside=(p,r)=>inRing(p,r[0])&&!r.slice(1).some(h=>inRing(p,h));
const segmentDistance=(p,a,b)=>{const x=b[0]-a[0],z=b[1]-a[1],t=THREE.MathUtils.clamp(((p[0]-a[0])*x+(p[1]-a[1])*z)/(x*x+z*z||1),0,1);return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*z);};
const ringsShape=rings=>{const shape=new THREE.Shape(rings[0].map(([x,z])=>new THREE.Vector2(x,-z)));shape.holes=rings.slice(1).map(r=>new THREE.Path(r.map(([x,z])=>new THREE.Vector2(x,-z))));return shape;};
function disposeRoot(root){const all=new Set();root.traverse(o=>{if(o.geometry)all.add(o.geometry);for(const m of[o.material].flat().filter(Boolean)){all.add(m);for(const v of Object.values(m))if(v?.isTexture)all.add(v);}if(o.isInstancedMesh)all.add(o);});for(const r of all)r.dispose?.();root.clear();}

// Detailed close views own their resources and load only the selected place.
export async function createHangzhouPlaceDetail(id,signal){
  if(!NAMES[id])throw new Error('未知杭州景点');signal?.throwIfAborted();
  const group=new THREE.Group();group.name=NAMES[id]+' · 独立景观';
  const materials=new Map(),buckets=new Map();
  const mat=(color)=>{if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.82}));return materials.get(color);};
  function add(g,color,position=[0,0,0],rotation=null){
    const solidHeight=g.userData?.solidHeight;
    const full=g.index?g.toNonIndexed():g; if(full!==g)g.dispose();
    const q=rotation?.isQuaternion?rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation||[0,0,0])));
    full.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),q,new THREE.Vector3(1,1,1)));
    // Quantizing very thin extruded triangles after translation can reverse
    // their winding. Preserve the authored top/bottom orientation in the actual
    // Float32 buffer, instead of treating a reversed top as a floating bottom.
    const p=full.attributes.position.array,n=full.attributes.normal?.array;
    if(n)for(let i=0;i<p.length;i+=9){
      let authoredY=(n[i+1]+n[i+4]+n[i+7])/3;
      if(solidHeight&&Math.abs(p[i+1]-p[i+4])<1e-8&&Math.abs(p[i+1]-p[i+7])<1e-8)authoredY=p[i+1]>position[1]+solidHeight*.5?1:-1;
      if(Math.abs(authoredY)<.999)continue;
      const actualY=(p[i+5]-p[i+2])*(p[i+6]-p[i])-(p[i+3]-p[i])*(p[i+8]-p[i+2]);
      if(actualY*authoredY<0)for(let j=0;j<3;j++){const v=p[i+3+j];p[i+3+j]=p[i+6+j];p[i+6+j]=v;}
    }
    if(!buckets.has(color))buckets.set(color,[]);buckets.get(color).push(full);
  }
  const box=(x,y,z,w,h,d,c,yaw=0)=>{if(w>0&&h>0&&d>0)add(new THREE.BoxGeometry(w,h,d),c,[x,y,z],[0,yaw,0]);};
  const rod=(a,b,r,c)=>{const delta=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));if(delta.length()<1e-6)return;add(new THREE.CylinderGeometry(r,r,delta.length(),5),c,a.map((v,i)=>(v+b[i])/2),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));};
  const solid=(rings,top,bottom,c)=>{if(top<=bottom)return;const g=new THREE.ExtrudeGeometry(ringsShape(rings),{depth:top-bottom,bevelEnabled:false,steps:1,curveSegments:1});g.userData={solidHeight:top-bottom};g.rotateX(-Math.PI/2);add(g,c,[0,bottom,0]);};
  function finish(){for(const [color,gs]of buckets){const size=gs.reduce((sum,g)=>sum+g.attributes.position.array.length,0),positions=new Float32Array(size);let at=0;for(const g of gs){positions.set(g.attributes.position.array,at);at+=g.attributes.position.array.length;g.dispose();}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.computeVertexNormals();const m=new THREE.Mesh(geometry,mat(color));m.castShadow=m.receiveShadow=true;m.name='景观构件 '+color;group.add(m);}buckets.clear();}
  try{
    const response=await fetch(new URL(`../../data/scenes/hangzhou-details/${id}.json`,import.meta.url),{signal});if(!response.ok)throw new Error('景点地理数据加载失败');const data=await response.json();signal?.throwIfAborted();
    const unit=data.unit,ys=unit*data.heightScale,[minX,minZ,maxX,maxZ]=data.extent;
    const baseline=Math.min(...data.terrain.positions.filter((_,i)=>i%3===1));
    const Y=h=>(h-baseline)*ys;
    const world=(x,z)=>[x*unit,z*unit];
    const local=coord=>[(coord[0]-data.origin[0])*data.metersPerDegree[0],(data.origin[1]-coord[1])*data.metersPerDegree[1]];
    const worldRings=rs=>rs.map(r=>r.map(p=>world(...p)));
    const positions=new Float32Array(data.terrain.positions.map((v,i)=>i%3===1?Y(v):v*unit));
    const surface=createHangzhouSurfaceSampler(positions,data.terrain.indices,{project:p=>({x:p[0],z:p[1]})},1);
    const waterAt=p=>data.water.find(w=>inside(p,w.rings));
    const land=(x,z)=>surface.sample([x*unit,z*unit]);
    const ground=(x,z)=>land(x,z)??Y(waterAt([x,z])?.level??baseline);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(data.terrain.indices);geometry.computeVertexNormals();
    const colours=new Float32Array(positions.length),c=new THREE.Color();
    for(let i=0;i<positions.length;i+=3){const p=[positions[i]/unit,positions[i+2]/unit];c.set(data.green.some(r=>inside(p,r))?'#607e4b':data.urban.some(r=>inside(p,r))?'#b2ad9d':id==='qiandao'||id==='tianmu'?'#728655':'#b8b597');c.multiplyScalar(1+Math.sin(p[0]*.004+p[1]*.005)*.035);c.toArray(colours,i);}
    geometry.setAttribute('color',new THREE.BufferAttribute(colours,3));const terrainMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});const terrain=new THREE.Mesh(geometry,terrainMaterial);terrain.name='来源高程与水岸';terrain.castShadow=terrain.receiveShadow=true;group.add(terrain);
    const bottom=Math.min(-.48,...data.water.map(w=>Y(w.level)-.3));
    solid(worldRings(data.displayOutline),bottom,bottom-.22,'#a79374');
    const cut=[];for(const [a,b]of data.terrain.edges){const p=Array.from(positions.slice(a*3,a*3+3)),q=Array.from(positions.slice(b*3,b*3+3));cut.push(...p,q[0],bottom,q[2],...q,...p,p[0],bottom,p[2],q[0],bottom,q[2]);}
    const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(cut,3));add(cg,'#9e9276');
    for(const w of data.water)solid(worldRings(w.rings),Y(w.level)+.002,bottom+.008,'#216c77');
    const obstacles=[],roadSegments=[],buildingBoxes=[],hotspots=[];const stats={sceneId:id,sourceBuildings:0,representativeBuildings:0,roads:0,trees:0,geometryFootprints:[],skippedSteepBuildings:0};
    const roadWidths={motorway:18,trunk:16,primary:13,secondary:10,tertiary:8,residential:6,unclassified:6,service:4,footway:2.4,path:2,steps:2,pedestrian:4,cycleway:2.5,taxiway:23};
    for(const r of data.roads){
      const width=(roadWidths[r.class]||3)*unit;
      for(let j=1;j<r.points.length;j++){
        const a=r.points[j-1],b=r.points[j],len=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(len/8));
        for(let k=0;k<steps;k++){
          const p=a.map((v,i)=>v+(b[i]-v)*k/steps),q=a.map((v,i)=>v+(b[i]-v)*(k+1)/steps),mid=p.map((v,i)=>(v+q[i])/2);
          if(![p,q,mid].every(p=>inside(p,data.displayOutline))||!r.bridge&&[p,q,mid].some(p=>waterAt(p)))continue;const dx=(q[0]-p[0])*unit,dz=(q[1]-p[1])*unit,l=Math.hypot(dx,dz);if(l<1e-6)continue;
          const side=[-dz/l*width*.5,dx/l*width*.5],pw=world(...p),qw=world(...q);
          const corners=[[pw[0]+side[0],pw[1]+side[1]],[qw[0]+side[0],qw[1]+side[1]],[qw[0]-side[0],qw[1]-side[1]],[pw[0]-side[0],pw[1]-side[1]]];
          if(!corners.every(p=>inside(p.map(v=>v/unit),data.displayOutline)))continue;
          if(data.buildings.some(b=>[p,q,mid,...corners.map(p=>p.map(v=>v/unit))].some(p=>inside(p,b.rings))))continue;
          const range=surface.heightRange(corners),top=Math.max(range?.max??ground(...mid),...(r.bridge?[Y(waterAt(mid)?.level??baseline)+unit*2]:[]))+.018;
          solid([corners],top,(range?.min??top-.2)-.015,r.class==='taxiway'?'#5c6866':['footway','steps','path','pedestrian'].includes(r.class)?'#d0c4a8':'#77817e');
          if(r.class==='taxiway'&&k%4===0)rod([pw[0],top+.006,pw[1]],[qw[0],top+.006,qw[1]],unit*.20,'#bfa64b');
          roadSegments.push([p,q,width/unit]);stats.roads++;
        }
      }
    }
    const roadClear=(p,r)=>!roadSegments.some(([a,b,w])=>segmentDistance(p,a,b)<r+w/2);
    function placeBuilding(item,representative=false){
      const rings=item.rings,p=rings[0],xs=p.map(p=>p[0]),zs=p.map(p=>p[1]);const box2=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
      const wr=worldRings(rings);let min=Infinity,max=-Infinity;
      const range=surface.heightRange([[box2[0]*unit,box2[1]*unit],[box2[2]*unit,box2[1]*unit],[box2[2]*unit,box2[3]*unit],[box2[0]*unit,box2[3]*unit]]);
      if(!range)return;min=range.min;max=range.max;const floor=max+.016;
      const temple=['faxi','lingyin'].includes(id),traditional=temple||['xiaohe','longmen','tianmu','xixi'].includes(id);
      let h=(item.height||8)*unit*(traditional?1.2:1.05);h=Math.max(.10,Math.min(h,3.3));
      if(temple&&!item.heightMeasured)h=Math.max(h,Math.min(15,Math.min(box2[2]-box2[0],box2[3]-box2[1])*.50)*unit);
      const doubleEave=id==='lingyin'&&/大雄宝殿|药师殿|天王殿/.test(item.name||'');
      // Official Lingyin temple description records the main hall's total
      // 33.6 m height; reserve part of that volume for the roof, not extra floors.
      if(id==='lingyin'&&item.name==='大雄宝殿')h=33.6*unit*.75;
      // A steep bounding envelope is not a licence to suspend an entire house.
      if(max-min>Math.max(h*.60,.2)){stats.skippedSteepBuildings++;return;}
      const hash=[...item.id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,17),wall=temple?(id==='faxi'?'#d4aa52':'#caba8d'):traditional?['#dfd6be','#c8c8bb','#e9dfc7'][hash%3]:['#a6c7dc','#cbdde9','#8baccc','#bacfdc'][hash%4];
      const bodyHeight=doubleEave?h*.64:h;
      solid(wr,floor,min-.025,'#a89c82');solid(wr,floor+bodyHeight,floor,wall);solid(wr,floor+bodyHeight+.035,floor+bodyHeight,'#6e7872');
      obstacles.push(rings);buildingBoxes.push(box2);stats.geometryFootprints.push({id:item.id,bottom:floor,terrainMin:min,terrainMax:max,representative});
      const edges=p.slice(1).map((b,i)=>[p[i],b]).filter(([a,b])=>Math.hypot(b[0]-a[0],b[1]-a[1])>4);
      for(const [a,b]of edges){
        const len=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.min(16,Math.max(1,Math.floor(len/4))),angle=-Math.atan2(b[1]-a[1],b[0]-a[0]);
        const floors=temple?1:traditional?Math.min(3,Math.max(1,Math.round(h/(unit*3.3)))):Math.min(12,Math.max(2,Math.round(h/(unit*3.6))));
        for(let k=0;k<count;k++)for(let level=0;level<floors;level++){
          const t=(k+.5)/count,x=(a[0]+(b[0]-a[0])*t)*unit,z=(a[1]+(b[1]-a[1])*t)*unit;
          box(x,floor+bodyHeight*(level+.50)/floors,z,Math.min(len/count*.62*unit,.24),bodyHeight/floors*.49,.016,traditional?'#5c5646':'#8bb6d1',angle);
          if(temple){rod([x,floor,z],[x,floor+bodyHeight,z],Math.max(.015,unit*.25),'#803e2e');}
        }
      }
      if(traditional){
        // Individual roof planes are fitted inside the actual roof footprint.
        const edge=edges.slice().sort((a,b)=>Math.hypot(...b[1].map((v,i)=>v-b[0][i]))-Math.hypot(...a[1].map((v,i)=>v-a[0][i])))[0];
        if(edge){const angle=Math.atan2(edge[1][1]-edge[0][1],edge[1][0]-edge[0][0]),cx=(box2[0]+box2[2])/2,cz=(box2[1]+box2[3])/2,co=Math.cos(angle),si=Math.sin(angle);
          let local=p.map(([x,z])=>[(x-cx)*co+(z-cz)*si,-(x-cx)*si+(z-cz)*co]);let w=(Math.max(...local.map(p=>p[0]))-Math.min(...local.map(p=>p[0])))*.88,d=(Math.max(...local.map(p=>p[1]))-Math.min(...local.map(p=>p[1])))*.88;
          for(let scale=1;scale>=.45;scale-=.1){const corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,z])=>[cx+(x*co-z*si)*scale,cz+(x*si+z*co)*scale]);if(!corners.every(q=>inside(q,rings)))continue;
            const roofH=Math.min(h*.38,d*unit*.26),baseY=floor+h+.025,ww=w*scale*unit,dd=d*scale*unit;
            const roofColor=id==='faxi'?'#38433a':'#293b33';
            if(doubleEave){
              const upper=corners.map(([x,z])=>[(x-cx)*.66+cx,(z-cz)*.66+cz]);
              solid([upper.map(p=>world(...p))],floor+h+.02,floor+bodyHeight,'#af9a69');
              add(curvedHipRoof(ww,dd,roofH*.72),roofColor,[cx*unit,floor+bodyHeight+.035,cz*unit],[0,-angle,0]);
            }
            add(curvedHipRoof(ww*(doubleEave?.76:1),dd*(doubleEave?.76:1),roofH),roofColor,[cx*unit,baseY,cz*unit],[0,-angle,0]);
            rod([cx*unit-ww*.29*co,baseY+roofH,cz*unit-ww*.29*si],[cx*unit+ww*.29*co,baseY+roofH,cz*unit+ww*.29*si],.025,'#9c9981');break;
          }
        }
      }
      if(item.name&&/法喜寺|大雄宝殿|天王殿|药师殿|五百罗汉|湖滨银泰|小河直街|深潭口|周家村/.test(item.name)&&hotspots.length<4)hotspots.push({label:item.name,position:[(box2[0]+box2[2])*.5*unit,floor+h+.28,(box2[1]+box2[3])*.5*unit],description:'依据公开地图中的建筑轮廓与名称定位；楼高、屋顶和立面作微缩表达。'});
      stats[representative?'representativeBuildings':'sourceBuildings']++;
    }
    const airportData=id==='zshc'?await (await fetch(new URL('../../data/airports/hangzhou.json',import.meta.url),{signal})).json():null;
    const airportTerminalRings=airportData?.terminals.map(t=>t.rings.map(r=>r.map(local)))||[];
    const airportBoundary=airportData?.boundary.map(rs=>rs.map(r=>r.map(local)))||[];
    const signatures=id==='olympic'?await (await fetch(new URL('../../data/hangzhou-atlas/signature-buildings.json',import.meta.url),{signal})).json():null;
    const signatureItems=signatures?.buildings.filter(b=>['big-lotus','small-lotus'].includes(b.id))||[];
    const signatureCenters=signatureItems.map(b=>local(b.coordinates));
    for(const item of data.buildings){
      const p=item.rings[0],cx=p.reduce((s,p)=>s+p[0],0)/p.length,cz=p.reduce((s,p)=>s+p[1],0)/p.length;
      if(signatureCenters.some(c=>Math.hypot(cx-c[0],cz-c[1])<230))continue;
      if(airportTerminalRings.some(r=>inside([cx,cz],r)))continue;
      placeBuilding(item);
    }
    if(id==='longmen'){
      let n=0;for(let z=minZ+20;z<maxZ-20&&n<360;z+=35)for(let x=minX+20;x<maxX-20&&n<360;x+=39){
        const w=12+(n%3)*2,d=11+(n%2)*3,r=[[[x-w,z-d],[x+w,z-d],[x+w,z+d],[x-w,z+d],[x-w,z-d]]];
        if(!r[0].every(p=>data.urban.some(q=>inside(p,q))&&!waterAt(p))||!roadClear([x,z],Math.hypot(w,d)))continue;
        placeBuilding({id:'representative-courtyard-'+n++,rings:r,height:6+(n%3),name:''},true);
      }
    }
    for(const item of signatureItems){
      const result=createSignatureBuilding(item),p=local(item.coordinates),b=new THREE.Box3().setFromObject(result.group);result.group.scale.setScalar(unit);
      result.group.position.set(p[0]*unit,ground(...p)-b.min.y*unit+.015,p[1]*unit);group.add(result.group);
      const bounds=new THREE.Box3().setFromObject(result.group);buildingBoxes.push([bounds.min.x/unit,bounds.min.z/unit,bounds.max.x/unit,bounds.max.z/unit]);
      hotspots.push({label:item.name,position:[p[0]*unit,ground(...p)+b.max.y*unit+.3,p[1]*unit],description:item.id==='big-lotus'?'以交叠花瓣、开放看台和中央田径场表现大莲花的建筑形制。':'以近圆形场馆与花瓣屋盖表现小莲花的建筑形制。'});
    }
    if(id==='zshc'){
      const airport=airportData,terminalGrades=airportTerminalRings.map(r=>{
        // heightRange clips against a convex probe. A terminal can have many
        // concave piers, so its enclosing rectangle must bound every underside.
        const p=worldRings(r)[0],xs=p.map(v=>v[0]),zs=p.map(v=>v[1]),a=Math.min(...xs),b=Math.min(...zs),c=Math.max(...xs),d=Math.max(...zs);
        return {rings:r,range:surface.heightRange([[a,b],[c,b],[c,d],[a,d]])};
      });
      for(const t of terminalGrades)if(t.range)solid(worldRings(t.rings),t.range.max+.015,t.range.min-.02,'#a89c82');
      const airportGround=p=>terminalGrades.find(t=>t.range&&inside(p,t.rings))?.range.max??ground(...p);
      const model=createAirportModel({airport,project:coord=>{const p=local(coord);return new THREE.Vector3(p[0]*unit,airportGround(p),p[1]*unit);},metersToUnits:unit,heightExaggeration:4,foundationInsetMeters:2});group.add(model.group);
      stats.airport=model.diagnostics;
      // Window bands follow the existing terminal edge; neither gates nor
      // aircraft stands are invented. The internal facade pattern is schematic.
      for(let ti=0;ti<airport.terminals.length;ti++){
        const t=airport.terminals[ti],rings=airportTerminalRings[ti],floor=(terminalGrades[ti].range?.max??ground(...rings[0][0])),h=(t.heightMeters||18)*unit*4;
        for(let i=1;i<rings[0].length;i++){
          const a=rings[0][i-1],b=rings[0][i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.floor(len/16),angle=-Math.atan2(b[1]-a[1],b[0]-a[0]);
          for(let k=0;k<n;k++){const f=(k+.5)/n,x=(a[0]+(b[0]-a[0])*f)*unit,z=(a[1]+(b[1]-a[1])*f)*unit;box(x,floor+h*.58,z,len/n*.78*unit,h*.42,.012,'#315867',angle);}
        }
      }
      for(const runway of airport.runways){const p=local(runway.points[0]);hotspots.push({label:runway.designators.join(' / ')+' 跑道',position:[p[0]*unit,ground(...p)+.25,p[1]*unit],description:'保留来源中的现役跑道走向与位置。'});}
      for(const t of airport.terminals.slice(0,5)){const rs=t.rings.map(r=>r.map(local));obstacles.push(rs);}
    }
    let seed=3991;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const nature=['tianmu','qiandao','xixi'].includes(id),step=Math.max(12,(maxX-minX)/(nature?42:37));
    for(let z=minZ+step;z<maxZ-step;z+=step)for(let x=minX+step;x<maxX-step;x+=step){
      const p=[x+(rand()-.5)*step*.55,z+(rand()-.5)*step*.55],forested=data.green.some(r=>inside(p,r));if(!forested&&!(id!=='zshc'&&data.urban.some(r=>inside(p,r))&&rand()<.22))continue;
      if(airportBoundary.some(r=>inside(p,r)))continue;
      const radius=Math.max(2,step*(nature?.28:.24));if(waterAt(p)||!roadClear(p,radius+1)||buildingBoxes.some(b=>p[0]>b[0]-radius&&p[0]<b[2]+radius&&p[1]>b[1]-radius&&p[1]<b[3]+radius))continue;
      if([[-radius,-radius],[radius,-radius],[radius,radius],[-radius,radius]].some(([dx,dz])=>waterAt([p[0]+dx,p[1]+dz])||land(p[0]+dx,p[1]+dz)==null))continue;
      const sr=radius*.15;const foot=surface.heightRange([[p[0]-sr,p[1]-sr],[p[0]+sr,p[1]-sr],[p[0]+sr,p[1]+sr],[p[0]-sr,p[1]+sr]].map(p=>world(...p)));if(!foot)continue;
      const h=radius*unit*(2.2+rand()*.8);const crownRange=surface.heightRange([[p[0]-radius,p[1]-radius],[p[0]+radius,p[1]-radius],[p[0]+radius,p[1]+radius],[p[0]-radius,p[1]+radius]].map(p=>world(...p)));if(!crownRange||crownRange.max>foot.max+h*.29)continue;const gx=p[0]*unit,gz=p[1]*unit,top=foot.max+h*.52;
      add(new THREE.CylinderGeometry(radius*unit*.1,radius*unit*.15,top-foot.min+.02,6),'#795f43',[gx,(top+foot.min-.02)/2,gz]);
      const leaf=['#365f42','#547b48','#6c8b51'][Math.floor(rand()*3)];const g=new THREE.IcosahedronGeometry(1,1);g.scale(radius*unit,h*.43,radius*unit*.85);add(g,leaf,[gx,foot.max+h*.75,gz]);stats.trees++;
    }
    finish();signal?.throwIfAborted();
    const bounds=new THREE.Box3().setFromObject(group),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const distance=Math.max(size.x,size.z)*1.32;
    if(!hotspots.length)hotspots.push({label:NAMES[id],position:[0,ground(0,0)+.4,0],description:id==='qiandao'?'湖岸、岛屿和山地来自地理数据，选择这一段湖区展示千岛的层次。':id==='tianmu'?'以来源高程与林地表现山脊和林冠，树木数量与大小按沙盘尺度概括。':'保留来源中的街巷、水岸与聚落范围。'});
    group.userData={sceneId:id,bbox:data.bbox,displayOutline:data.displayOutline,outlineMethod:data.outlineMethod,source:'docs/hangzhou-place-details-sources.md',attribution:'© OpenStreetMap contributors (ODbL 1.0) · Mapzen Terrain Tiles',sourceURLs:[data.source.osm.url||'https://www.openstreetmap.org/copyright','https://registry.opendata.aws/terrain-tiles/'],representation:'Source terrain, water and building footprints; illustrative roofs, heights, facades and vegetation. Longmen houses are representative within source urban polygons.',sourceBuildingCount:stats.sourceBuildings,representativeBuildingCount:stats.representativeBuildings};
    surface.dispose?.();return {group,camera:{position:[center.x+distance*.35,center.y+distance*.80,center.z+distance*.95],target:[center.x,center.y*.7,center.z]},hotspots:hotspots.slice(0,5),diagnostics:stats,update(){}};
  }catch(error){for(const gs of buckets.values())for(const g of gs)g.dispose();buckets.clear();for(const m of materials.values())m.dispose();disposeRoot(group);throw error;}
}
