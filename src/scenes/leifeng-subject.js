import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {disposeSubject} from './subject-kit.js';
/** Offline tower-only GLB: no surrounding terrain, images or city data loaded. */
export async function loadLeifengSubject(signal){
 const url=new URL('../../data/scenes/hangzhou-subjects/leifeng.glb',import.meta.url),response=await fetch(url,{signal});if(!response.ok)throw new Error('雷峰塔模型加载失败');const buffer=await response.arrayBuffer();signal?.throwIfAborted();const group=(await new GLTFLoader().parseAsync(buffer,url.href)).scene;
 try{signal?.throwIfAborted();group.name='雷峰塔 · 五层八面塔体与遗址保护台基';group.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});return group;}catch(e){disposeSubject(group);throw e;}
}
