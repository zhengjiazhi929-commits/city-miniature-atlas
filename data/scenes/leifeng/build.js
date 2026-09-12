// Reproducible browser-side bake. Serve the repository, import this module, then
// export its returned group using the bundled GLTFExporter (binary:true).
// All geographic inputs are local; the build does not query live map services.
import * as THREE from 'three';
import clipping from '../../../vendor/polygon-clipping.js';
import {createRegionProjection,toRegionMercator} from '../../../src/region-projection.js';
import {filterTerrariumRgba} from '../../../src/terrain-quality.js';
import {Batch,material} from '../../../src/scenes/hong-kong-geometry.js';
const BASE=new URL('./',import.meta.url),TAU=Math.PI*2;
const polys=g=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
function insideRing(ring,x,z){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
const inside=(shape,x,z)=>shape.some(p=>insideRing(p[0],x,z)&&!p.slice(1).some(r=>insideRing(r,x,z)));
function polygonMesh(shape,height,mat,name){const positions=[];for(const p of shape){const rings=p.map(r=>r.slice(0,-1).map(c=>new THREE.Vector2(...c))),flat=rings.flat();for(const face of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1)))for(const i of [face[0],face[2],face[1]])positions.push(flat[i].x,height,flat[i].y);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.name=name;m.receiveShadow=true;return m;}
function roof(batch,y,radius,rise,mat,trim){
 const n=8,rows=8,cols=8,pos=[],idx=[];
 const point=(f,u,t)=>{const a=f/n*TAU+Math.PI/8,b=a+TAU/n,r=radius*(.18+.82*t);return [(Math.cos(a)*(1-u)+Math.cos(b)*u)*r,y+rise*Math.pow(1-t,1.7)+radius*.06*Math.pow(t,5)*Math.pow(Math.abs(u*2-1),6),(Math.sin(a)*(1-u)+Math.sin(b)*u)*r];};
 for(let f=0;f<n;f++){const start=pos.length/3;for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++)pos.push(...point(f,col/cols,row/rows));for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){const a=start+row*(cols+1)+col,b=a+1,c=a+cols+1;idx.push(a,b,c,b,c+1,c);}batch.curve(Array.from({length:9},(_,i)=>point(f,i/8,1)),.1,trim,8);batch.curve(Array.from({length:9},(_,i)=>point(f,0,i/8)),.09,trim,8);for(let i=1;i<8;i++)batch.curve(Array.from({length:7},(_,j)=>point(f,i/8,j/6)),.045,trim,6);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();let sum=0;for(let i=1;i<g.attributes.normal.array.length;i+=3)sum+=g.attributes.normal.array[i];if(sum<0){for(let i=0;i<idx.length;i+=3)[idx[i+1],idx[i+2]]=[idx[i+2],idx[i+1]];g.setIndex(idx);g.computeVertexNormals();}batch.add(g,mat);g.dispose();batch.cylinder(0,y+rise,0,radius*.185,radius*.185,.15,mat,8);
}
function rail(batch,y,radius,mat,height=1.2){for(let i=0;i<8;i++){const a=i*TAU/8+Math.PI/8,b=a+TAU/8,p=[Math.cos(a)*radius,y,Math.sin(a)*radius],q=[Math.cos(b)*radius,y,Math.sin(b)*radius];for(const h of [.45,height])batch.rod([p[0],y+h,p[2]],[q[0],y+h,q[2]],.085,mat,6);for(let j=0;j<=7;j++){const t=j/7,x=p[0]*(1-t)+q[0]*t,z=p[2]*(1-t)+q[2]*t;batch.cylinder(x,y+height/2,z,.12,.13,height,mat,6);}}}
function towerArchitecture(footprint,projection,ground,waterDatum,heightMeters){
 const group=new THREE.Group();group.name='Leifeng Pagoda — source footprint, approximate 71.7m total height';
 const stone=material('#cfc3a9'),dark=material('#262f2e'),copper=material('#814c37'),trim=material('#a88b5f',.82,.08),roofMat=material('#425851',.82,.05);
 const batch=new Batch(group),center=projection.project([120.1450125,30.2338837]);
 // Work in metres around the documented tower centre, then scale uniformly.
 const footprintM=footprint.map(r=>r.map(c=>{const p=projection.project(c);return [(p.x-center.x)/projection.metersToUnits,(p.z-center.z)/projection.metersToUnits];}));
 const foundation=polygonMesh([footprintM],9.7,stone,'Mapped octagonal preservation podium');group.add(foundation);
 const wall=[];for(const ring of footprintM)for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],pa=projection.unproject(center.x+a[0]*projection.metersToUnits,center.z+a[1]*projection.metersToUnits),pb=projection.unproject(center.x+b[0]*projection.metersToUnits,center.z+b[1]*projection.metersToUnits),ya=Math.min(0,ground(pa)-ground([120.1450125,30.2338837]))-.15,yb=Math.min(0,ground(pb)-ground([120.1450125,30.2338837]))-.15;wall.push(a[0],ya,a[1],b[0],yb,b[1],b[0],9.7,b[1],a[0],ya,a[1],b[0],9.7,b[1],a[0],9.7,a[1]);}
 const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(wall,3));wg.computeVertexNormals();batch.add(wg,stone);wg.dispose();rail(batch,9.7,27.5,stone,1.2);
 const bodyStart=9.7,bodyHeight=45.9;
 for(let floor=0;floor<5;floor++){
  const y=bodyStart+floor*bodyHeight/5,r=14*(1-floor*.06),walk=17.625*(1-floor*.06),h=6.8;
  batch.cylinder(0,y+h/2,0,r,r,h,copper,8);batch.cylinder(0,y+.23,0,walk,walk,.46,stone,8);rail(batch,y+.46,walk-.4,stone,1.12);
  for(let face=0;face<8;face++){
   const angle=face*TAU/8,nx=Math.cos(angle),nz=Math.sin(angle),tx=-nz,tz=nx;
   for(let bay=-1;bay<=1;bay++){const t=bay*r*.27,x=nx*r*.923+tx*t,z=nz*r*.923+tz*t;batch.box(x,y+3.5,z,r*.215,4.8,.12,dark,[0,Math.PI/2-angle,0]);for(const offset of [-.45,.45])batch.rod([x+tx*offset,y+1.1,z+tz*offset],[x+tx*offset,y+5.9,z+tz*offset],.055,copper,5);}
   const a=angle+Math.PI/8,x=Math.cos(a)*(walk-.8),z=Math.sin(a)*(walk-.8);batch.cylinder(x,y+h/2,z,.38,.45,h,copper,8);batch.box(x,y+h-.4,z,1.7,.35,1.7,copper,[0,-a,0]);batch.box(x,y+h-.1,z,2.3,.26,1.9,trim,[0,-a,0]);
  }
  roof(batch,y+h,walk+2.4,2.25,roofMat,trim);
 }
 const spireBase=bodyStart+bodyHeight,spireHeight=heightMeters-spireBase;
 batch.cylinder(0,spireBase+.8,0,1.25,2.6,1.6,trim,16);
 batch.cylinder(0,spireBase+spireHeight/2,0,.15,.8,spireHeight,trim,16);
 for(let i=0;i<10;i++){const y=spireBase+2+i*.83,r=1.6-i*.1;batch.cylinder(0,y,0,r,r,.27,trim,16);}
 batch.ball(0,heightMeters-.8,0,.48,.8,.48,trim,2);batch.finish();
 group.scale.setScalar(projection.metersToUnits);group.position.set(center.x,(ground([120.1450125,30.2338837])-waterDatum)*projection.metersToUnits,center.z);group.userData={anchor:[120.1450125,30.2338837],osmWay:229726934,nominalHeightMeters:heightMeters,geometryMeaning:'Source-aligned schematic exterior; ornament and floor ratios are visual interpretation, not surveyed architecture.'};return group;
}

export async function buildLeifengReal(){
 const metadata=await(await fetch(new URL('metadata.json',BASE))).json(),source=await(await fetch(new URL('source-features.geojson',BASE))).json(),towerSource=await(await fetch(new URL('tower-way.json',BASE))).json();
 const [w,s,e,n]=metadata.bounds,region={type:'Feature',properties:{id:'leifeng-view-frame'},geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}};
 const projection=createRegionProjection(region),group=new THREE.Group();group.name='Leifeng measured landscape — one-kilometre view frame';
 const tileHeights=new Map(),demStats=[];for(const file of metadata.demFiles){const blob=await(await fetch(new URL(file,BASE))).blob(),bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'}),c=new OffscreenCanvas(256,256),ctx=c.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(0,0,256,256).data;const {filterMs,...quality}=filterTerrariumRgba(pixels,256,256);demStats.push({file,...quality});const values=new Float32Array(65536);for(let i=0;i<values.length;i++)values[i]=pixels[i*4]*256+pixels[i*4+1]+pixels[i*4+2]/256-32768;const m=file.match(/dem-(\d+)-(\d+)-(\d+)/);tileHeights.set(`${m[2]}/${m[3]}`,values);}
 const pixelScale=2**metadata.demZoom*256;
 function height(ll){const p=toRegionMercator(ll),x=p[0]*pixelScale-.5,y=p[1]*pixelScale-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const read=(gx,gy)=>{const tx=Math.floor(gx/256),ty=Math.floor(gy/256),tile=tileHeights.get(`${tx}/${ty}`);if(!tile)throw new Error('DEM sampling outside archived coverage');return tile[(gy-ty*256)*256+gx-tx*256];};return (read(ix,iy)*(1-fx)+read(ix+1,iy)*fx)*(1-fy)+(read(ix,iy+1)*(1-fx)+read(ix+1,iy+1)*fx)*fy;}
 const a=projection.project([w,n]),b=projection.project([e,s]),bounds=[a.x,a.z,b.x,b.z],frame=[[[[a.x,a.z],[b.x,a.z],[b.x,b.z],[a.x,b.z],[a.x,a.z]]]],width=b.x-a.x,depth=b.z-a.z;
 const projected=source.features.map(f=>({...f,shape:polys(f.geometry).map(p=>p.map(r=>r.map(ll=>{const p=projection.project(ll);return [p.x,p.z];})))})).filter(f=>f.shape.length||f.geometry.type==='LineString');
 for(const f of projected)if(f.shape.length)f.shape=clipping.intersection(f.shape,frame);
 const water=projected.filter(f=>f.properties.natural==='water'&&f.shape.length);
 for(const f of water){const samples=[];for(let j=0;j<80;j++)for(let i=0;i<80;i++){const x=a.x+(i+.5)/80*width,z=a.z+(j+.5)/80*depth;if(inside(f.shape,x,z))samples.push(height(projection.unproject(x,z)));}if(!samples.length)for(const p of f.shape)for(const c of p[0])samples.push(height(projection.unproject(...c)));samples.sort((x,y)=>x-y);f.level=samples[Math.floor(samples.length/2)];}
 const mainLake=water.find(f=>f.id==='relation/2308774');if(!mainLake)throw new Error('Archived West Lake shoreline missing');const datum=mainLake.level;
 const surface=(x,z)=>{const waterFeature=water.find(f=>inside(f.shape,x,z));return (waterFeature?waterFeature.level:height(projection.unproject(x,z)))-datum;};
 const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const ctx=canvas.getContext('2d');ctx.fillStyle='#c4c5a0';ctx.fillRect(0,0,2048,2048);
 const xy=c=>[(c[0]-a.x)/width*2048,(c[1]-a.z)/depth*2048];
 function path(shape){ctx.beginPath();for(const p of shape)for(const r of p){r.forEach((c,i)=>{const q=xy(c);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();}}
 function paint(f,color){if(!f.shape.length)return;path(f.shape);ctx.fillStyle=color;ctx.fill('evenodd');}
 for(const f of projected){const p=f.properties;if(p.leisure==='park')paint(f,'#a2b184');else if(p.landuse==='religious')paint(f,'#c5b99d');else if(p.landuse==='grass'||p.natural==='grassland')paint(f,'#b5c48a');else if(p.landuse==='residential'||p.landuse==='industrial')paint(f,'#cfc3ab');}
 for(const f of projected)if(f.properties.natural==='wood'||f.properties.landuse==='forest')paint(f,'#6a854f');
 for(const f of water)paint(f,'#719dad');
 const buildings=projected.filter(f=>f.properties.building&&f.properties.osmId!=='229726934');for(const f of buildings)paint(f,'#ab9d85');
 const roadOrder={secondary:3,residential:2,unclassified:2,service:1,footway:0,steps:0,pedestrian:0};
 const roads=projected.filter(f=>f.properties.highway&&f.properties.tunnel!=='yes').sort((a,b)=>(roadOrder[a.properties.highway]||0)-(roadOrder[b.properties.highway]||0));
 for(const f of roads){if(f.shape.length){paint(f,'#daceb2');continue;}const p=f.properties,widthM=Number(p.width)||(p.highway==='secondary'?9:['residential','unclassified'].includes(p.highway)?5.5:p.highway==='service'?3.5:2.2);ctx.beginPath();f.geometry.coordinates.forEach((ll,i)=>{const p=projection.project(ll),q=xy([p.x,p.z]);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.lineWidth=widthM*projection.metersToUnits/width*2048+1.2;ctx.strokeStyle='#a69b80';ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();ctx.lineWidth=widthM*projection.metersToUnits/width*2048;ctx.strokeStyle=['footway','steps','pedestrian'].includes(p.highway)?'#e1d4b2':'#d9c8a3';ctx.stroke();}
 const towerWay=towerSource.elements.find(el=>el.type==='way'),nodes=new Map(towerSource.elements.filter(el=>el.type==='node').map(el=>[el.id,[el.lon,el.lat]])),footprint=[towerWay.nodes.map(id=>nodes.get(id))];
 const landShape=clipping.difference(frame,...water.map(f=>f.shape));
 const waterEdges=water.flatMap(f=>f.shape.flatMap(p=>p.flatMap(r=>r.slice(1).map((b,i)=>({a:r[i],b,level:f.level})))));
 function shoreLevel(x,z){for(const e of waterEdges){const vx=e.b[0]-e.a[0],vz=e.b[1]-e.a[1],t=Math.max(0,Math.min(1,((x-e.a[0])*vx+(z-e.a[1])*vz)/(vx*vx+vz*vz||1)));if(Math.hypot(x-e.a[0]-vx*t,z-e.a[1]-vz*t)<1e-6)return e.level-datum;}return null;}
 const N=256,pos=[],uv=[],indices=[],color=[],vertices=new Map();let min=Infinity,max=-Infinity;const light=new THREE.Vector3(-.5,.8,-.3).normalize();
 function vertex(x,z){const key=`${Math.round(x*1e8)}/${Math.round(z*1e8)}`;if(vertices.has(key))return vertices.get(key);const index=pos.length/3,h=shoreLevel(x,z)??surface(x,z);min=Math.min(min,h);max=Math.max(max,h);pos.push(x,h*projection.metersToUnits,z);uv.push((x-a.x)/width,1-(z-a.z)/depth);const d=12*projection.metersToUnits,xx1=Math.max(a.x,x-d),xx2=Math.min(b.x,x+d),zz1=Math.max(a.z,z-d),zz2=Math.min(b.z,z+d),gx=(surface(xx2,z)-surface(xx1,z))/((xx2-xx1)/projection.metersToUnits),gz=(surface(x,zz2)-surface(x,zz1))/((zz2-zz1)/projection.metersToUnits),normal=new THREE.Vector3(-gx,1,-gz).normalize(),shade=.82+.18*Math.max(0,normal.dot(light));color.push(shade,shade,shade);vertices.set(key,index);return index;}
 const rectangle=(x0,z0,x1,z1)=>[[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]];
 for(let j=0;j<N;j++){const z0=a.z+j/N*depth,z1=a.z+(j+1)/N*depth,strip=clipping.intersection(landShape,rectangle(a.x,z0,b.x,z1));if(!strip.length)continue;for(let i=0;i<N;i++){const x0=a.x+i/N*width,x1=a.x+(i+1)/N*width;for(const p of clipping.intersection(strip,rectangle(x0,z0,x1,z1))){const rings=p.map(r=>r.slice(0,-1).map(c=>new THREE.Vector2(...c))),flat=rings.flat(),local=flat.map(p=>vertex(p.x,p.y));for(const face of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1))){const ids=face.map(i=>local[i]);const [i0,i1,i2]=ids.map(i=>i*3),area=(Math.fround(pos[i1])-Math.fround(pos[i0]))*(Math.fround(pos[i2+2])-Math.fround(pos[i0+2]))-(Math.fround(pos[i1+2])-Math.fround(pos[i0+2]))*(Math.fround(pos[i2])-Math.fround(pos[i0]));if(Math.abs(area)<1e-10)continue;indices.push(...(area>0?[ids[0],ids[2],ids[1]]:ids));}}}}
 const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geom.setAttribute('color',new THREE.Float32BufferAttribute(color,3));geom.setIndex(indices);geom.computeVertexNormals();
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;const top=new THREE.Mesh(geom,new THREE.MeshStandardMaterial({map:texture,vertexColors:true,roughness:1}));top.name='Real DEM and archived OSM landcover and paths';top.receiveShadow=true;group.add(top);
 const waterMat=material('#648c9c',.82,.02);for(const f of water)group.add(polygonMesh(f.shape,(f.level-datum)*projection.metersToUnits+.003,waterMat,`Source water ${f.id}`));
 // The skirt is a display support, not an invented geological section.
 const boundary=[];for(let i=0;i<=N;i++)boundary.push([a.x+i/N*width,a.z]);for(let j=1;j<=N;j++)boundary.push([b.x,a.z+j/N*depth]);for(let i=N-1;i>=0;i--)boundary.push([a.x+i/N*width,b.z]);for(let j=N-1;j>0;j--)boundary.push([a.x,a.z+j/N*depth]);boundary.push(boundary[0]);
 const skirt=[],base=Math.min(0,min*projection.metersToUnits)-.8;for(let i=1;i<boundary.length;i++){const p=boundary[i-1],q=boundary[i],py=surface(...p)*projection.metersToUnits,qy=surface(...q)*projection.metersToUnits;skirt.push(p[0],py,p[1],q[0],qy,q[1],q[0],base,q[1],p[0],py,p[1],q[0],base,q[1],p[0],base,p[1]);}const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(skirt,3));sg.computeVertexNormals();const skirtMat=material('#aa987a'),skirtMesh=new THREE.Mesh(sg,skirtMat);skirtMesh.name='Decorative rectangular view-frame support';group.add(skirtMesh);const underside=polygonMesh(frame,base,skirtMat,'Closed display underside');underside.material.side=THREE.DoubleSide;group.add(underside);
 const tower=towerArchitecture(footprint,projection,height,datum,metadata.towerHeightMeters);group.add(tower);
 group.scale.setScalar(.5);group.updateMatrixWorld(true);
 const coord=(ll,meters=0)=>projection.project(ll,meters-datum).multiplyScalar(.5).toArray(),groundAt=height(metadata.coordinates);
 const target=coord(metadata.coordinates,groundAt+20),camera={position:[target[0]+5.4,target[1]+4.8,target[2]-7],target},overviewCamera={position:[target[0]+17,target[1]+17,target[2]-23],target};
 const nanshan=roads.filter(f=>f.properties.name==='南山路').flatMap(f=>f.geometry.type==='LineString'?f.geometry.coordinates:[]).sort((a,b)=>Math.hypot(a[0]-metadata.coordinates[0],a[1]-metadata.coordinates[1])-Math.hypot(b[0]-metadata.coordinates[0],b[1]-metadata.coordinates[1]))[0];
 const hotspots=[{label:'雷峰塔',position:coord(metadata.coordinates,groundAt+metadata.towerHeightMeters),description:'塔中心取自 OSM 八角塔基，约71.7米通高由来源标注校准。塔檐、窗格与栏杆为简化外观，非建筑测绘模型。'},{label:'西湖南岸',position:coord([120.143,30.237],datum),description:'湖岸与水域依据 OSM 西湖多边形裁切，水面使用本取景框内 DEM 水域采样中位值，非测量水位。'},{label:'南山路',position:coord(nanshan,height(nanshan)+2),description:'道路与步行路径沿已记录的 OSM 线绘制；宽度为制图显示宽度。未添加虚构林间路径。'}];
 const diagnostics={bounds:metadata.bounds,frameRole:metadata.boundaryRole,scale:1,displayMetersToUnits:projection.metersToUnits*.5,demTiles:tileHeights.size,demStats,demGrid:N,terrainTriangles:indices.length/3,terrainMetersRange:[min+datum,max+datum],lakeLevelMetersEstimated:datum,towerGroundMeters:groundAt,towerTopMeters:groundAt+metadata.towerHeightMeters,towerHeightMeters:metadata.towerHeightMeters,sourceFeatures:source.features.length,roads:roads.length,buildingFootprints:buildings.length,waterPolygons:water.length,towerAnchor:metadata.coordinates,nanshanAnchor:nanshan,terrainCoverage:'true land polygons; water removed from terrain top to avoid overlapping surfaces',camera,overviewCamera,hotspots};
 group.userData={attribution:'© OpenStreetMap contributors · Mapzen Terrain Tiles / USGS / NOAA',dataLicenseNotice:'data/scenes/leifeng/NOTICE.md',sourceMetadata:'data/scenes/leifeng/metadata.json',frameBounds:metadata.bounds,scaleMeaning:'same horizontal and vertical metre scale; decorative base excluded',...diagnostics};
 return {group,camera,overviewCamera,hotspots,diagnostics,description:'真实地形与水岸中的雷峰塔。约一公里取景框，非景区边界；塔体为依据照片与已知尺寸的简化外观。'};
}
