import * as THREE from 'three';
import {clipLandscapeMesh} from './clip-landscape.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const ASSETS=new URL('../../data/scenes/leifeng/',import.meta.url);

// Only used if a completed parse loses its navigation before ownership transfers.
// Ready scenes are owned exclusively by the app's reference-counted resourcePool.
function disposeUnowned(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of [object.material].flat().filter(Boolean)){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
  for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures)texture.dispose();root.clear();
}
function releaseBitmapWithLastTexture(root){
  const images=new Map(),seen=new Set();root.traverse(object=>{for(const material of [object.material].flat().filter(Boolean))for(const texture of Object.values(material)){if(!texture?.isTexture||seen.has(texture))continue;seen.add(texture);const image=texture.image;if(typeof image?.close!=='function')continue;if(!images.has(image))images.set(image,new Set());images.get(image).add(texture);}});
  for(const [image,textures]of images)for(const texture of textures){const release=()=>{texture.removeEventListener('dispose',release);textures.delete(texture);if(!textures.size)image.close();};texture.addEventListener('dispose',release);}
}

/** Offline, source-aligned West Lake landscape. No active DEM controller or worker. */
export async function createLeifengReal(signal){
  signal?.throwIfAborted();const lifetime=new AbortController(),abort=()=>lifetime.abort();signal?.addEventListener('abort',abort,{once:true});let group=null;
  try{
    const [modelResponse,metadataResponse]=await Promise.all([fetch(new URL('scene.glb',ASSETS),{signal:lifetime.signal}),fetch(new URL('scene.json',ASSETS),{signal:lifetime.signal})]);
    if(!modelResponse.ok||!metadataResponse.ok)throw new Error('雷峰塔本地地理模型加载失败');
    const [buffer,metadata]=await Promise.all([modelResponse.arrayBuffer(),metadataResponse.json()]);signal?.throwIfAborted();
    const gltf=await new GLTFLoader().parseAsync(buffer,ASSETS.href);group=gltf.scene;releaseBitmapWithLastTexture(group);signal?.throwIfAborted();
    group.name='Leifeng Pagoda · measured landscape';group.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
    // The tower and its measured podium remain untouched. Only the old
    // rectangular landscape frame becomes a compact shoreline/hillside piece.
    const outline=[[-12,-4],[-10,-14],[-2,-17],[10,-11],[14,-2],[11,10],[2,12],[-10,9]];
    const landscapeRoot=group.children[0];
    const wallMaterial=new THREE.MeshStandardMaterial({color:'#b7ab91',roughness:1,side:THREE.DoubleSide});
    let clippedMeshes=0,removedFrameMeshes=0;
    const landscape=[];group.traverse(child=>{if(child.isMesh)landscape.push(child);});
    for(const child of landscape){
      if(/Decorative[_ ]rectangular|Closed[_ ]display[_ ]underside/.test(child.name)){
        child.removeFromParent();removedFrameMeshes++;child.geometry.dispose();for(const m of[child.material].flat())m.dispose();
      }else if(child.isMesh&&/Real[_ ]DEM|Source[_ ]water/.test(child.name)){
        const wall=clipLandscapeMesh(child,outline,-.8517,wallMaterial);clippedMeshes++;if(wall)child.parent.add(wall);
      }
    }
    if(clippedMeshes<2||removedFrameMeshes!==2)throw new Error('雷峰塔旧取景框未完整替换');
    metadata.diagnostics.independentFrame={clippedMeshes,removedFrameMeshes};
    const shape=new THREE.Shape(outline.map(([x,z])=>new THREE.Vector2(x,-z))),baseGeometry=new THREE.ExtrudeGeometry(shape,{depth:.25,bevelEnabled:false});baseGeometry.rotateX(-Math.PI/2);baseGeometry.translate(0,-1.1017,0);
    const base=new THREE.Mesh(baseGeometry,new THREE.MeshStandardMaterial({color:'#988b72',roughness:1}));base.name='雷峰塔山坡与水岸独立底座';base.castShadow=base.receiveShadow=true;landscapeRoot.add(base);
    const camera={position:[12,14,-18],target:[0,.9,-1]};
    metadata.diagnostics.frameRole='Compact authored shoreline/hillside display outline; not a scenic administrative boundary.';
    group.userData={...group.userData,source:'docs/leifeng-real-sources.md',geographicBounds:metadata.diagnostics.bounds,coordinateSystem:'WGS84',realMetreScale:true,displayOutline:outline,outlineRole:'Authored compact shore and hillside frame, not a legal site boundary.'};
    return {group,camera,overviewCamera:camera,hotspots:metadata.hotspots,description:metadata.description,diagnostics:metadata.diagnostics,update(){}};
  }catch(error){lifetime.abort();if(group)disposeUnowned(group);throw error;}
  finally{signal?.removeEventListener('abort',abort);}
}
