import * as THREE from 'three';

// Neutral daylight with broad bright sky and an anonymous distant skyline.
// This is a reflection-lighting asset, not a claim of ray-traced local buildings.
// Shared by the fixed-asset gallery and city; owned and released per view.
export function createCityReflectionEnvironment(renderer){
  const width=512,height=256,bytes=new Float32Array(width*height*4),c=new THREE.Color();
  const skyTop=new THREE.Color('#d3dde3'),horizon=new THREE.Color('#e6ebec'),ground=new THREE.Color('#8f9898'),tower=new THREE.Color('#56666e');
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const v=y/(height-1),a=x/width*Math.PI*2;
    c.copy(v<.5?skyTop:ground);if(v<.5)c.lerp(horizon,v*2);
    const sector=Math.floor(x/width*30),within=x/width*30-sector;
    const roof=.44-(Math.sin(sector*7.23)*.5+.5)*.145;
    if(v>roof&&v<.95&&within>.11&&within<.81){c.copy(tower).multiplyScalar(.80+.32*(Math.sin(sector*4.17)*.5+.5));if(within>.59)c.multiplyScalar(1.35);}
    const strip=Math.pow(Math.max(0,Math.cos(a-.6)),50)*1.7+Math.pow(Math.max(0,Math.cos(a+1.9)),35)*.9;
    const vertical=Math.max(0,1-Math.abs(v-.55)*1.55);c.addScalar(strip*vertical);
    const cloud=Math.pow(Math.max(0,Math.cos(a*3+.4)),8)*Math.max(0,1-Math.abs(v-.21)*9)*.35;c.addScalar(cloud);
    const i=(y*width+x)*4;bytes[i]=c.r;bytes[i+1]=c.g;bytes[i+2]=c.b;bytes[i+3]=1;
  }
  const source=new THREE.DataTexture(bytes,width,height,THREE.RGBAFormat,THREE.FloatType);source.mapping=THREE.EquirectangularReflectionMapping;source.needsUpdate=true;
  const generator=new THREE.PMREMGenerator(renderer),target=generator.fromEquirectangular(source);source.dispose();generator.dispose();
  return {texture:target.texture,dispose:()=>target.dispose()};
}
