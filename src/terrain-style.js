import * as THREE from 'three';

/** Cartographic relief derived only from measured surface height and normals.
 * Shared by the main DEM and its vector surface patches. No geometry displacement.
 */
export function applyTerrainStyle(material,{metersToUnits,heightScale=1,contours=false,surfaceOffsetUnits=0,vivid=false}={}){
  if(material.userData.demSurfaceStyle)return material;
  material.userData.demSurfaceStyle={metersToUnits,heightScale,contours,surfaceOffsetUnits,vivid};
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    previous?.call(material,shader);
    shader.uniforms.reliefMeters={value:1/(metersToUnits*heightScale)};
    shader.uniforms.reliefOffset={value:surfaceOffsetUnits};
    shader.uniforms.reliefContours={value:contours?1:0};
    shader.uniforms.reliefVivid={value:vivid?1:0};
    shader.uniforms.reliefInk={value:new THREE.Color('#667149')};
    shader.vertexShader='varying float vReliefMeters;\nvarying float vReliefSlope;\nuniform float reliefMeters;\nuniform float reliefOffset;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvReliefMeters=(position.y-reliefOffset)*reliefMeters;\nvReliefSlope=1.0-clamp(normal.y,0.0,1.0);');
    shader.fragmentShader='varying float vReliefMeters;\nvarying float vReliefSlope;\nuniform float reliefContours;\nuniform float reliefVivid;\nuniform vec3 reliefInk;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float luminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      vec3 saturated=mix(vec3(luminance),diffuseColor.rgb,1.32);
      diffuseColor.rgb=mix(diffuseColor.rgb,clamp((saturated-.22)*1.12+.22,0.0,1.0),reliefVivid);
      // Light elevation tint, preserving the real landcover map and road colours.
      float reliefHigh=smoothstep(120.0,1750.0,vReliefMeters);
      float reliefWater=step(diffuseColor.r*1.22,diffuseColor.b)*step(diffuseColor.g*.94,diffuseColor.b);
      float reliefLand=1.0-reliefWater;
      diffuseColor.rgb*=mix(vec3(1.0),mix(vec3(.95,1.01,.91),vec3(1.13,1.05,.89),reliefHigh),reliefLand*.58);
      diffuseColor.rgb*=1.0-reliefLand*min(vReliefSlope,.65)*.13;
      float reliefContourPos=vReliefMeters/100.0;
      float reliefDerivative=max(fwidth(reliefContourPos),.0005);
      float reliefDistance=abs(fract(reliefContourPos+.5)-.5)/reliefDerivative;
      float reliefMajorDistance=abs(fract(reliefContourPos/5.0+.5)-.5)/max(reliefDerivative/5.0,.0005);
      float reliefLine=max(1.0-smoothstep(.18,.8,reliefDistance),(1.0-smoothstep(.3,1.05,reliefMajorDistance))*.9);
      float reliefReadable=1.0-smoothstep(.32,.75,reliefDerivative);
      float reliefContourAlpha=reliefContours*reliefLand*step(25.0,vReliefMeters)*reliefReadable*reliefLine*.20;
      diffuseColor.rgb=mix(diffuseColor.rgb,reliefInk,reliefContourAlpha);
    `);
  };
  material.customProgramCacheKey=()=> 'measured-relief-v06-'+String(vivid);material.needsUpdate=true;
  return material;
}
