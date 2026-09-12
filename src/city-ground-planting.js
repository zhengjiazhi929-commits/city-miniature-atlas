import * as THREE from 'three';
import {createLandFootprintGuard} from './hangzhou-footprint-guard.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const active = signal => { if (signal?.aborted) throw signal.reason ?? new DOMException('Planting cancelled.', 'AbortError'); };
const hash = (x, y, salt=0) => { const n = Math.sin(x * 127.1 + y * 311.7 + salt) * 43758.5453; return n - Math.floor(n); };
const overlaps = (a,b) => a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];

// One fixed, closed low-shrub asset shared by every planting instance. The
// lobed outline and rounded crown give it volume without adding branch meshes.
function shrubGeometry() {
  const positions=[],indices=[],segments=12,rings=[[1,0],[.96,.38],[.68,.77]];
  for (const [radius,y] of rings) for(let i=0;i<segments;i++) {
    const a=i/segments*Math.PI*2,r=radius*(.95+.035*Math.cos(a*3));
    positions.push(Math.cos(a)*r,y,Math.sin(a)*r);
  }
  const top=positions.length/3;positions.push(0,1,0);const bottom=positions.length/3;positions.push(0,0,0);
  for(let r=0;r<rings.length-1;r++)for(let i=0;i<segments;i++){
    const j=(i+1)%segments,a=r*segments+i,b=(r+1)*segments+i,c=r*segments+j,d=(r+1)*segments+j;
    indices.push(a,b,c,b,d,c);
  }
  for(let i=0;i<segments;i++){const j=(i+1)%segments;indices.push(24+i,top,24+j,i,j,bottom);}
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();
  geometry.name='city-shrub-mound-v1';return geometry;
}

function triangleTouchesBox(points,box) {
  const cx=(box[0]+box[3])/2,cz=(box[2]+box[5])/2,rx=(box[3]-box[0])/2,rz=(box[5]-box[2])/2;
  for(let i=0;i<3;i++){
    const a=points[i],b=points[(i+1)%3],nx=-(b[2]-a[2]),nz=b[0]-a[0];
    const projected=points.map(p=>p[0]*nx+p[2]*nz),centre=cx*nx+cz*nz,extent=rx*Math.abs(nx)+rz*Math.abs(nz);
    if(Math.max(...projected)<centre-extent||Math.min(...projected)>centre+extent)return false;
  }
  return true;
}

// Use actual displayed buildings, trees and road triangles, including their
// exaggerated widths. Source centre lines alone would allow road collisions.
async function obstacleIndex(fabric,cell,signal) {
  const bins=new Map(),matrix=new THREE.Matrix4(),world=new THREE.Matrix4(),box=new THREE.Box3(),p=new THREE.Vector3();let count=0;
  const eachCell=(b,visit)=>{for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[3]/cell);x++)for(let z=Math.floor(b[2]/cell);z<=Math.floor(b[5]/cell);z++)visit(`${x},${z}`);};
  const add=(bounds,points=null)=>{const row={bounds,points};eachCell(bounds,key=>{if(!bins.has(key))bins.set(key,[]);bins.get(key).push(row)});count++;};
  fabric.updateWorldMatrix(true,true);const meshes=[];fabric.traverse(o=>{if(o.isMesh)meshes.push(o)});
  for(const mesh of meshes){
    active(signal);
    if(mesh.isInstancedMesh){
      mesh.geometry.computeBoundingBox();
      for(let i=0;i<mesh.count;i++){
        if(i%512===0){active(signal);await pause();}
        mesh.getMatrixAt(i,matrix);world.multiplyMatrices(mesh.matrixWorld,matrix);box.copy(mesh.geometry.boundingBox).applyMatrix4(world);
        add([box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z]);
      }
    }else if(/major road/i.test(mesh.name)){
      const attribute=mesh.geometry.attributes.position,index=mesh.geometry.index,total=index?.count??attribute.count;
      for(let i=0;i<total;i+=3){
        if(i%6144===0){active(signal);await pause();}
        const points=[0,1,2].map(k=>p.fromBufferAttribute(attribute,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld).toArray());
        add([0,1,2].map(k=>Math.min(...points.map(v=>v[k]))).concat([0,1,2].map(k=>Math.max(...points.map(v=>v[k])))),points);
      }
    }
  }
  return {count,clear:bounds=>{
    let clear=true;const seen=new Set();eachCell(bounds,key=>{if(!clear)return;for(const row of bins.get(key)||[]){if(seen.has(row))continue;seen.add(row);if(overlaps(bounds,row.bounds)&&(!row.points||triangleTouchesBox(row.points,bounds))){clear=false;break;}}});return clear;
  },dispose:()=>bins.clear()};
}

/** A display planting layer, independently owned and reusable across cities.
 * Ground colouring supplies a distant green read; these rooted shrub volumes
 * supply near-view detail. The actual city fabric is never rebuilt or moved.
 */
export async function createUrbanGroundPlanting({data,projection,texture,textureBounds,greenColours,fabric,exclusions=[],sampleHeightRange,maxClusters=3600,signal}) {
  active(signal);
  const unit=projection.metersToUnits,group=new THREE.Group();group.name='Urban continuous ground planting';
  const diagnostics={asset:'city-shrub-mound-v1',clusters:0,triangles:0,candidates:0,obstacles:0,rejectedFootprint:0,rejectedSlope:0,rejectedCollision:0,disposed:false,policy:'User-requested representative landscaping on the rendered green substrate; not surveyed vegetation or a new land-use classification. Airport, water, roads, buildings and landmark footprints excluded.'};
  let geometry=null,material=null,mesh=null,guard=null,obstacles=null,pixels=null;
  function dispose(){if(diagnostics.disposed)return;diagnostics.disposed=true;group.removeFromParent();mesh?.dispose();geometry?.dispose();material?.dispose();group.clear();guard?.dispose();obstacles?.dispose();pixels=null;}
  try{
    const image=texture.image,size=image.width;pixels=image.getContext('2d').getImageData(0,0,size,size).data;
    const allowed=new Set(greenColours.map(hex=>parseInt(hex.slice(1),16))),[minX,minZ,maxX,maxZ]=textureBounds;
    const greenAt=(x,z)=>{
      // Avoid placing a solid shrub on the outer fade of the green substrate.
      if(Math.min(x-minX,maxX-x,z-minZ,maxZ-z)<3000*unit)return false;
      const i=(Math.floor((z-minZ)/(maxZ-minZ)*size)*size+Math.floor((x-minX)/(maxX-minX)*size))*4;
      return pixels[i+3]===255&&allowed.has((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
    };
    const projectRings=rings=>rings.map(ring=>ring.map(c=>{const p=projection.project(c,0);return[p.x,p.z]}));
    guard=createLandFootprintGuard({boundary:data.boundary.map(projectRings),water:data.water.map(p=>projectRings(p.rings)),exclusions:exclusions.map(projectRings),cellSize:unit*180});
    obstacles=await obstacleIndex(fabric,unit*400,signal);diagnostics.obstacles=obstacles.count;
    const step=unit*175,candidates=[];
    for(let x=minX+step/2,ix=0;x<maxX;x+=step,ix++)for(let z=minZ+step/2,iz=0;z<maxZ;z+=step,iz++){
      const px=x+(hash(ix,iz,1)-.5)*step*.65,pz=z+(hash(ix,iz,2)-.5)*step*.65;
      if(greenAt(px,pz))candidates.push({x:px,z:pz,r:hash(ix,iz,3),order:hash(ix,iz,4)});
    }
    candidates.sort((a,b)=>a.order-b.order);diagnostics.candidates=candidates.length;
    const rows=[];
    for(let i=0;i<candidates.length&&rows.length<maxClusters;i++){
      if(i%256===0){active(signal);await pause();}
      const {x,z,r}=candidates[i],rx=unit*(35+r*25),rz=unit*(24+r*16),corners=[[x-rx,z-rz],[x+rx,z-rz],[x+rx,z+rz],[x-rx,z+rz]];
      if(!corners.every(([a,b])=>greenAt(a,b))||!guard.allows(corners)){diagnostics.rejectedFootprint++;continue;}
      const range=sampleHeightRange(corners);
      if(!range||range.max-range.min>unit*12){diagnostics.rejectedSlope++;continue;}
      const bottom=range.min-unit*2,height=range.max-bottom+unit*(24+r*10),bounds=[x-rx,bottom,z-rz,x+rx,bottom+height,z+rz];
      if(!obstacles.clear(bounds)){diagnostics.rejectedCollision++;continue;}
      rows.push({x,z,rx,rz,bottom,height,colour:['#396c3f','#4b7b43','#558344'][Math.floor(r*3)],coordinate:projection.unproject(x,z)});
    }
    geometry=shrubGeometry();material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.96,metalness:0});
    mesh=new THREE.InstancedMesh(geometry,material,rows.length);mesh.name='Ground-rooted low shrub groups';
    const matrix=new THREE.Matrix4(),colour=new THREE.Color();
    rows.forEach((row,i)=>{matrix.makeScale(row.rx,row.height,row.rz);matrix.setPosition(row.x,row.bottom,row.z);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,colour.set(row.colour));});
    mesh.userData={cityAssetId:diagnostics.asset,cityAssetRole:'ground-shrub',placementRows:rows.map(({x,z,rx,rz,bottom,height,coordinate})=>({x,z,rx,rz,bottom,height,coordinate}))};
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.castShadow=mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
    diagnostics.clusters=rows.length;diagnostics.triangles=geometry.index.count/3*rows.length;
    active(signal);guard.dispose();guard=null;obstacles.dispose();obstacles=null;pixels=null;
    return{group,diagnostics,dispose};
  }catch(error){dispose();throw error;}
}
