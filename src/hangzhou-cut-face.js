import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

/** Display materials on the existing cut plane, never displacement or new land.
 * The texture is illustrative rock/soil, not a geological survey of strata.
 */
function styleCutMaterial(material,rock){
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vCutPosition;\nvarying float vCutTop;\nattribute float cutTop;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCutPosition=position;\nvCutTop=cutTop;');
    shader.fragmentShader=`varying vec3 vCutPosition;
      varying float vCutTop;
      float cutHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float cutNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(mix(cutHash(i),cutHash(i+vec3(1,0,0)),f.x),mix(cutHash(i+vec3(0,1,0)),cutHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(cutHash(i+vec3(0,0,1)),cutHash(i+vec3(1,0,1)),f.x),mix(cutHash(i+vec3(0,1,1)),cutHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',rock?`
      // Continuous across administrative vertices: no random per-edge stripes.
      float coarse=cutNoise(vCutPosition*vec3(5.0,9.0,5.0));
      float grain=cutNoise(vCutPosition*48.0);
      float soil=sin(vCutPosition.y*25.0+coarse*3.0)*.035;
      diffuseColor.rgb*=.83+coarse*.27+grain*.10+soil;
      float rim=1.0-smoothstep(.015,.14,max(0.0,vCutTop-vCutPosition.y));
      diffuseColor.rgb=mix(diffuseColor.rgb,vColor,rim*.82);
      float contact=1.0-smoothstep(.0,.045,vCutPosition.y);
      diffuseColor.rgb*=1.0-contact*.18;
    `:`#include <color_fragment>
      // One level, constant-width edge around the entire plinth.
      float upper=1.0-smoothstep(.0,.045,-vCutPosition.y);
      float lower=1.0-smoothstep(.0,.055,vCutPosition.y+.85);
      diffuseColor.rgb*=1.0+upper*.24-lower*.16;
    `);
  };
  material.customProgramCacheKey=()=>rock?'hangzhou-rock-cut-v1':'hangzhou-level-plinth-v1';
}

export function createHangzhouCutFace({polygons,heightAt,rimColorAt}){
  const group=new THREE.Group();group.name='杭州等厚底座与山体断面';
  const base=-.85,top=0,rockColor=new THREE.Color('#a59a82');
  const diagnostics={baseY:base,baseTopY:top,baseThickness:top-base,horizontalDisplacement:0,heightDisplacement:0,texture:'illustrative rock and soil; no measured strata',segments:0};
  const layers=[{name:'等厚水平底座',rock:false,positions:[],tops:[],colors:[]},{name:'随地形起伏的岩土断面',rock:true,positions:[],tops:[],colors:[]}];
  for(const polygon of polygons)for(const ring of polygon)for(let j=1;j<ring.length;j++){
    const a=ring[j-1],b=ring[j],ha=heightAt(a),hb=heightAt(b),ca=rimColorAt(a,ha),cb=rimColorAt(b,hb);
    diagnostics.segments++;
    for(const layer of layers){
      const low=layer.rock?top:base,ya=layer.rock?ha:top,yb=layer.rock?hb:top;
      for(const[p,y,h,c]of[[a,low,ha,ca],[b,low,hb,cb],[a,ya,ha,ca],[b,low,hb,cb],[b,yb,hb,cb],[a,ya,ha,ca]]){
        layer.positions.push(p[0],y,p[1]);layer.tops.push(h);c.toArray(layer.colors,layer.colors.length);
      }
    }
  }
  for(const layer of layers){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(layer.positions,3));
    geometry.setAttribute('cutTop',new THREE.Float32BufferAttribute(layer.tops,1));
    if(layer.rock)geometry.setAttribute('color',new THREE.Float32BufferAttribute(layer.colors,3));
    const smooth=mergeVertices(geometry,.0001);geometry.dispose();smooth.computeVertexNormals();smooth.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({color:layer.rock?rockColor:'#746b5a',vertexColors:layer.rock,roughness:1,side:THREE.DoubleSide});
    // Keep the rock's main colour independent of the narrow source-colour rim.
    styleCutMaterial(material,layer.rock);
    const mesh=new THREE.Mesh(smooth,material);mesh.name=layer.name;mesh.receiveShadow=true;group.add(mesh);
  }
  group.userData.cutFace=diagnostics;
  return{group,diagnostics};
}
