import * as THREE from 'three';
import {createHangzhouLandmark} from '../hangzhou-landmarks.js';

const ASSETS=new URL('../../data/scenes/westlake/',import.meta.url);
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const inRing=(p,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
const inPolygon=(p,rings)=>inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r));
const distanceToSegment=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz,t=length?THREE.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length,0,1):0;return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};

/** Complete source lake with immediate surroundings. Each call owns all resources. */
export async function createWestLakeGeographic(signal){
  signal?.throwIfAborted();
  const group=new THREE.Group();group.name='西湖 · 湖山地理沙盘';
  const resources=new Set();
  const assert=()=>signal?.throwIfAborted();
  const own=value=>{resources.add(value);return value;};
  const material=options=>own(new THREE.MeshStandardMaterial({roughness:.86,...options}));
  const geometry=(positions,indices,colors)=>{const g=own(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(indices)g.setIndex(indices);if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();return g;};
  const addMesh=(g,m,name)=>{const mesh=new THREE.Mesh(own(g),m);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;};
  function disposeUnowned(){group.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of[o.material].flat().filter(Boolean)){resources.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.add(v);}if(o.isInstancedMesh)resources.add(o);});for(const r of resources)r.dispose?.();resources.clear();group.clear();}
  try{
    const response=await fetch(new URL('display-scene-data.json',ASSETS),{signal});
    if(!response.ok)throw new Error('西湖本地地理资料加载失败');
    const data=await response.json();assert();
    const {metersToUnits:unit,heightScale,origin,metresPerMercator}=data.projection;
    const merc=([lng,lat])=>[(lng+180)/360,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2];
    const center=merc(origin);
    const project=coord=>{const p=merc(coord);return[(p[0]-center[0])*metresPerMercator*unit,(p[1]-center[1])*metresPerMercator*unit];};
    const worldRings=rings=>rings.map(r=>r.map(project));
    const water=data.water.map(w=>({...w,rings:worldRings(w.rings),y:w.levelMeters*unit*heightScale}));
    const forest=data.forest.map(p=>worldRings(p.rings)),urban=data.urban.map(p=>worldRings(p.rings));
    const lake=water.find(w=>w.id==='westlake-water');
    if(!lake||lake.rings.length!==7)throw new Error('西湖水体资料缺少完整岛屿结构');
    const waterAt=p=>water.find(w=>inPolygon(p,w.rings));
    const raw=data.terrain.positions,indices=data.terrain.indices,positions=raw.map((v,i)=>v*unit*(i%3===1?heightScale:1));
    // Sample the actual clipped source triangles, not a second interpolated DEM.
    const bins=new Map(),binStep=1;
    for(let i=0;i<indices.length;i+=3){const p=indices.slice(i,i+3).map(id=>[positions[id*3],positions[id*3+2]]),xs=p.map(v=>v[0]),zs=p.map(v=>v[1]);for(let x=Math.floor(Math.min(...xs)/binStep);x<=Math.floor(Math.max(...xs)/binStep);x++)for(let z=Math.floor(Math.min(...zs)/binStep);z<=Math.floor(Math.max(...zs)/binStep);z++){const key=`${x},${z}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(i);}}
    function landHeight([x,z]){
      const list=bins.get(`${Math.floor(x/binStep)},${Math.floor(z/binStep)}`)||[];let highest=null;
      for(const i of list){const[a,b,c]=indices.slice(i,i+3).map(id=>id*3),ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2],den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-12)continue;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;if(u>=-1e-5&&v>=-1e-5&&w>=-1e-5){const y=u*positions[a+1]+v*positions[b+1]+w*positions[c+1];highest=highest===null?y:Math.max(highest,y);}}
      return highest;
    }
    const surface=p=>landHeight(p)??waterAt(p)?.y??0;
    const earth=new THREE.Color('#b4be8f'),woods=new THREE.Color('#71966a'),town=new THREE.Color('#cbc7ae'),stone=new THREE.Color('#b5b59c');
    function colorAt(p){const xz=[p[0],p[2]],c=earth.clone();if(forest.some(r=>inPolygon(xz,r)))c.lerp(woods,.88);else if(urban.some(r=>inPolygon(xz,r)))c.copy(town);else c.lerp(woods,THREE.MathUtils.smoothstep(p[1],.6,1.8)*.26);return c.lerp(stone,THREE.MathUtils.smoothstep(p[1],1.5,2.3)*.2);}
    // Subdivision only improves shading/land-cover color; the source planes and
    // elevations stay unchanged. It does not add DEM detail or survey accuracy.
    const displayPositions=[],displayColors=[],displayIndices=[],displayKeys=new Map();
    function displayVertex(p){const key=p.map(v=>v.toFixed(6)).join(',');if(displayKeys.has(key))return displayKeys.get(key);const id=displayPositions.length/3;displayKeys.set(key,id);displayPositions.push(...p);colorAt(p).toArray(displayColors,displayColors.length);return id;}
    function triangle(a,b,c,depth){if(!depth){displayIndices.push(...[a,b,c].map(displayVertex));return;}const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2),ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);triangle(a,ab,ca,depth-1);triangle(ab,b,bc,depth-1);triangle(ca,bc,c,depth-1);triangle(ab,bc,ca,depth-1);}
    for(let i=0;i<indices.length;i+=3)triangle(...indices.slice(i,i+3).map(id=>positions.slice(id*3,id*3+3)),2);
    addMesh(geometry(displayPositions,displayIndices,displayColors),material({vertexColors:true,color:'#ffffff'}),'来源地形 · 2.5 倍高差');
    const [minX,minZ,maxX,maxZ]=data.projection.extentMeters.map(v=>v*unit);
    const outline=data.displayOutline.map(r=>r.map(([x,z])=>[x*unit,z*unit]));
    const outlineShape=new THREE.Shape(outline[0].map(([x,z])=>new THREE.Vector2(x,-z)));
    const baseGeometry=new THREE.ExtrudeGeometry(outlineShape,{depth:.28,bevelEnabled:false});baseGeometry.rotateX(-Math.PI/2);baseGeometry.translate(0,-.42,0);
    addMesh(baseGeometry,material({color:'#8a7960'}),'随湖岸与山林收边的独立底座');

    const cutPositions=[],cutIndices=[],shorePositions=[],shoreIndices=[];
    for(const[a,b]of data.terrain.cutEdges){
      const pa=positions.slice(a*3,a*3+3),pb=positions.slice(b*3,b*3+3),outer=(Math.abs(pa[0]-minX)<.00001&&Math.abs(pb[0]-minX)<.00001)||(Math.abs(pa[0]-maxX)<.00001&&Math.abs(pb[0]-maxX)<.00001)||(Math.abs(pa[2]-minZ)<.00001&&Math.abs(pb[2]-minZ)<.00001)||(Math.abs(pa[2]-maxZ)<.00001&&Math.abs(pb[2]-maxZ)<.00001);
      const list=outer?cutPositions:shorePositions,ix=outer?cutIndices:shoreIndices,n=list.length/3;
      list.push(...pa,...pb,pb[0],-.14,pb[2],pa[0],-.14,pa[2]);ix.push(n,n+2,n+1,n,n+3,n+2);
    }
    addMesh(geometry(cutPositions,cutIndices),material({color:'#c5b291',side:THREE.DoubleSide}),'周边山体断面');
    addMesh(geometry(shorePositions,shoreIndices),material({color:'#a5ad86',side:THREE.DoubleSide}),'真实水陆边缘 · 中性岸壁');
    const waterPositions=[],waterIndices=[],waterColors=[];
    for(const entry of water){const rings=entry.rings.map(r=>r.slice(0,-1).map(p=>new THREE.Vector2(...p))),points=rings.flat(),offset=waterPositions.length/3,c=new THREE.Color(entry.id==='westlake-water'?'#5a9b9b':'#809f96');for(const p of points){waterPositions.push(p.x,entry.y+.004,p.y);c.toArray(waterColors,waterColors.length);}for(const t of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1)))waterIndices.push(...t.map(i=>i+offset));}
    const waterMesh=addMesh(geometry(waterPositions,waterIndices,waterColors),material({vertexColors:true,color:'#ffffff',roughness:.32,metalness:.12,side:THREE.DoubleSide}),'完整西湖水面 · 保留岛屿与堤体孔洞');waterMesh.castShadow=false;
    await pause();assert();

    const roadPositions=[],roadIndices=[],roadSegments=[];let roadSections=0,tunnelsHidden=0,wetNonBridgeSectionsOmitted=0;
    const roadWidths={trunk:24,primary:19,secondary:13};
    function roadQuad(a,b,ya,yb,width){const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.000001)return;const ox=-dz/length*width/2,oz=dx/length*width/2,n=roadPositions.length/3,thickness=.014;roadPositions.push(a[0]+ox,ya,a[1]+oz,b[0]+ox,yb,b[1]+oz,b[0]-ox,yb,b[1]-oz,a[0]-ox,ya,a[1]-oz,a[0]+ox,ya-thickness,a[1]+oz,b[0]+ox,yb-thickness,b[1]+oz,b[0]-ox,yb-thickness,b[1]-oz,a[0]-ox,ya-thickness,a[1]-oz);roadIndices.push(n,n+2,n+1,n,n+3,n+2,n,n+1,n+5,n,n+5,n+4,n+3,n+7,n+6,n+3,n+6,n+2);roadSections++;}
    for(const road of data.roads){
      if(road.tunnel){tunnelsHidden++;continue;}const path=road.points.map(project),width=(roadWidths[road.class]||13)*unit;
      for(let i=1;i<path.length;i++){
        const start=path[i-1],end=path[i],length=Math.hypot(end[0]-start[0],end[1]-start[1]),steps=Math.max(1,Math.ceil(length/(24*unit)));
        for(let j=0;j<steps;j++){
          const at=t=>start.map((v,k)=>v+(end[k]-v)*t),a=at(j/steps),b=at((j+1)/steps),mid=at((j+.5)/steps),waterHere=waterAt(mid);
          if(waterHere&&!road.bridge){wetNonBridgeSectionsOmitted++;continue;}
          const side=[-(b[1]-a[1])/Math.max(length/steps,.000001)*width/2,(b[0]-a[0])/Math.max(length/steps,.000001)*width/2];
          const support=p=>Math.max(surface(p),...[-1,1].map(sign=>surface([p[0]+side[0]*sign,p[1]+side[1]*sign])))+.018;
          let ya=support(a),yb=support(b);
          if(road.bridge){ya=Math.max(ya,(waterAt(a)?.y||0)+.038);yb=Math.max(yb,(waterAt(b)?.y||0)+.038);}
          roadQuad(a,b,ya,yb,width);roadSegments.push([a,b,width]);
        }
      }
    }
    const roadsMesh=addMesh(geometry(roadPositions,roadIndices),material({color:'#d9d2b9',side:THREE.DoubleSide}),'来源主要道路 · 实体薄路面');roadsMesh.castShadow=false;roadsMesh.receiveShadow=false;
    await pause();assert();
    let seed=31010;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const landmarks=data.landmarks.map(l=>({...l,xz:project(l.coordinates)}));
    const roadBins=new Map(),roadBinStep=.5;
    for(const segment of roadSegments){const[a,b]=segment,pad=.24;for(let x=Math.floor((Math.min(a[0],b[0])-pad)/roadBinStep);x<=Math.floor((Math.max(a[0],b[0])+pad)/roadBinStep);x++)for(let z=Math.floor((Math.min(a[1],b[1])-pad)/roadBinStep);z<=Math.floor((Math.max(a[1],b[1])+pad)/roadBinStep);z++){const key=`${x},${z}`;if(!roadBins.has(key))roadBins.set(key,[]);roadBins.get(key).push(segment);}}
    const farFromRoad=(p,radius)=>!(roadBins.get(`${Math.floor(p[0]/roadBinStep)},${Math.floor(p[1]/roadBinStep)}`)||[]).some(([a,b,w])=>distanceToSegment(p,a,b)<radius+w/2+.025);
    const farFromLandmark=(p,radius)=>!landmarks.some(l=>Math.hypot(p[0]-l.xz[0],p[1]-l.xz[1])<radius+(l.id==='leifeng'?.32:.15));
    const treeItems=[],buildingItems=[],forestClearance=r=>[[-r,0],[r,0],[0,-r],[0,r]];
    const grid=.43;
    for(let x=minX+.2;x<maxX-.2;x+=grid)for(let z=minZ+.2;z<maxZ-.2;z+=grid){
      const p=[x+(random()-.5)*.22,z+(random()-.5)*.22],h=landHeight(p);if(h===null||waterAt(p))continue;
      const radius=.070+random()*.055;
      if(forest.some(r=>inPolygon(p,r))&&farFromRoad(p,radius)&&farFromLandmark(p,radius)&&forestClearance(radius).every(d=>!waterAt([p[0]+d[0],p[1]+d[1]])&&forest.some(r=>inPolygon([p[0]+d[0],p[1]+d[1]],r)))){
        treeItems.push({p,h,r:radius,height:.17+random()*.14,color:random()});
      }else if(buildingItems.length<260&&random()<.58&&urban.some(r=>inPolygon(p,r))&&farFromRoad(p,.13)&&farFromLandmark(p,.21)&&forestClearance(.13).every(d=>!waterAt([p[0]+d[0],p[1]+d[1]])&&urban.some(r=>inPolygon([p[0]+d[0],p[1]+d[1]],r)))){
        buildingItems.push({p,h,w:.12+random()*.10,d:.13+random()*.09,height:.13+random()*.23,color:random()});
      }
    }
    const dummy=new THREE.Object3D();
    function instances(items,g,m,name,configure){if(!items.length){g.dispose();m.dispose();resources.delete(m);return null;}const mesh=own(new THREE.InstancedMesh(own(g),m,items.length));mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);items.forEach((item,index)=>{configure(item,index,mesh);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();return mesh;}
    instances(treeItems,new THREE.CylinderGeometry(.22,.28,1,5),material({color:'#806847'}),'来源林地中的树干',item=>{dummy.position.set(item.p[0],item.h+item.height*.23,item.p[1]);dummy.scale.set(item.r*.27,item.height*.46,item.r*.27);});
    instances(treeItems,new THREE.IcosahedronGeometry(1,1),material({color:'#ffffff'}),'来源林地中的代表树群', (item,index,mesh)=>{dummy.position.set(item.p[0],item.h+item.height*.69,item.p[1]);dummy.scale.set(item.r,item.height*.49,item.r*.92);mesh.setColorAt(index,new THREE.Color('#497950').lerp(new THREE.Color('#87a764'),item.color*.8));});
    instances(buildingItems,new THREE.BoxGeometry(1,1,1),material({color:'#ffffff'}),'来源建成用地中的概括楼群',(item,index,mesh)=>{dummy.position.set(item.p[0],item.h+item.height/2,item.p[1]);dummy.scale.set(item.w,item.height,item.d);mesh.setColorAt(index,new THREE.Color('#e0dcc9').lerp(new THREE.Color('#b2b7ad'),item.color*.7));});

    const leifeng=landmarks.find(l=>l.id==='leifeng'),leifengModel=createHangzhouLandmark(leifeng);group.add(leifengModel);leifengModel.scale.setScalar(.55);leifengModel.position.set(leifeng.xz[0],surface(leifeng.xz)+.01,leifeng.xz[1]);leifengModel.userData.coordinates=leifeng.coordinates;
    // The scenic anchor is not a measured three-tower survey. Use only three
    // small stone symbols in source water; never import the generic island mesh.
    const santan=landmarks.find(l=>l.id==='santan'),santanGroup=new THREE.Group();santanGroup.name='三潭印月 · 三座石塔代表符号';group.add(santanGroup);
    const stoneMat=material({color:'#d8d0ba'}),capMat=material({color:'#ece3cb'});
    const towerOffsets=[[-.10,.06],[.10,.06],[0,.20]],santanPlacements=[];
    for(const[dx,dz]of towerOffsets){const p=[santan.xz[0]+dx,santan.xz[1]+dz];if(!waterAt(p))throw new Error('三潭石塔符号必须位于源水面内');const y=waterAt(p).y+.004;santanPlacements.push(p);for(const[g,m,yy]of[[new THREE.CylinderGeometry(.036,.045,.045,8),stoneMat,.0225],[new THREE.SphereGeometry(.046,8,6),capMat,.072],[new THREE.ConeGeometry(.041,.053,8),stoneMat,.12]]){const mesh=new THREE.Mesh(own(g),m);mesh.position.set(p[0],y+yy,p[1]);mesh.castShadow=true;santanGroup.add(mesh);}}
    santanGroup.userData={representative:true,stonePagodas:3,coordinates:santan.coordinates,displayOffsetsWorld:towerOffsets,sourceRole:santan.role,doesNotAddIslandGeometry:true};
    // Existing bridge anchor is reliable; this low stone bridge is a symbol.
    // Its small span is oriented to the local shore, with no new causeway line.
    const bridge=landmarks.find(l=>l.id==='broken-bridge'),bridgeModel=createHangzhouLandmark(bridge);group.add(bridgeModel);bridgeModel.scale.set(.32,.18,.32);bridgeModel.position.set(bridge.xz[0],surface(bridge.xz)+.01,bridge.xz[1]);bridgeModel.rotation.y=-Math.PI*.20;bridgeModel.userData.coordinates=bridge.coordinates;
    await pause();assert();
    const hotspot=(item,description,extra={})=>({label:item.name,position:[item.xz[0],surface(item.xz)+(item.id==='leifeng'?.9:.28),item.xz[1]],description,...extra});
    const hotspots=[
      hotspot(leifeng,'雷峰塔位于西湖南岸夕照山。点击可进入已制作的独立雷峰塔场景。',{sceneId:'leifeng'}),
      hotspot(santan,'保留三潭印月的来源景点锚点；湖中三座石塔为概括符号，岛岸直接来自原始水体孔洞。',{sceneId:'santan'}),
      hotspot(bridge,'断桥位于西湖北侧。低矮桥体用于辨识景点位置，周围岸线由真实水面数据保留。'),
    ];
    const diagnostics={kind:'attraction-geographic',sceneId:'westlake',bounds:data.bbox,extentRole:data.extentRole,horizontalDeformation:false,metersToUnits:unit,heightScale,sourceDemGridMetersApprox:900,waterPolygons:water.length,mainLakeSourceAreaMeters:lake.areaMeters,mainLakeRings:lake.rings.length,mainLakeIslandHoles:lake.rings.length-1,sourceTerrainTriangles:indices.length/3,displayTerrainTriangles:displayIndices.length/3,rawTerrainRangeMeters:data.terrain.rawElevationRange,sourceRoadFragments:data.roads.length,roadSections,tunnelsHidden,wetNonBridgeSectionsOmitted,representativeTrees:treeItems.length,representativeBuildings:buildingItems.length,landmarks:landmarks.map(l=>({id:l.id,coordinates:l.coordinates,source:l.source,anchorRole:l.role,positionXZ:l.xz})),santanSymbolOffsetsWorld:towerOffsets,source:'docs/westlake-geographic-sources.md',offlineDataBytes:response.headers.get('content-length')?Number(response.headers.get('content-length')):null};
    group.userData={source:'docs/westlake-geographic-sources.md',geographicBounds:data.bbox,coordinateSystem:'WGS84',horizontalDeformation:false,representativeLandmarks:true};
    // Resource ownership transfers to the app; no controller, renderer, timer,
    // mutable cache, or source-wide data remains active after this return.
    resources.clear();bins.clear();roadBins.clear();
    return{group,camera:{position:[17,20,22],target:[.3,.45,.2]},overviewCamera:{position:[0,37,24],target:[0,.4,0]},hotspots,description:'沿完整西湖岸线，看湖中岛堤、北岸断桥、南岸雷峰塔与周边山林；真实地理骨架上的微缩表达。',diagnostics,update(){}};
  }catch(error){disposeUnowned();throw error;}
}
