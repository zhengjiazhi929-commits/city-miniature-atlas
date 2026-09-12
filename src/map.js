import * as THREE from 'three';
import {citiesInProvince} from './catalog.js';

export const project=([lon,lat])=>new THREE.Vector3((lon-104)*.82,0,35-lat);

export function createChinaMap(geojson){
  const group=new THREE.Group();group.name='China province atlas';
  const meshes=[];const byId=new Map();
  const side=new THREE.MeshStandardMaterial({color:'#b1bf9e',roughness:.94});
  const colors=['#94a582','#b2bd9b','#99ad87','#b0bd9a','#8c9f7a','#acb992'];
  const lineMat=new THREE.LineBasicMaterial({color:'#6e8262',transparent:true,opacity:.55});
  geojson.features.forEach((feature,i)=>{
    const p=feature.properties,available=citiesInProvince(p.id).length>0;
    const material=new THREE.MeshStandardMaterial({color:available?'#6f977d':colors[i%colors.length],roughness:.86,metalness:0});
    const polyGroup=new THREE.Group();polyGroup.name=p.name;polyGroup.userData.province=p.id;
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    for(const rings of polygons){
      if(rings[0].length<4)continue;
      const ringPoints=ring=>ring.map(c=>{const v=project(c);return new THREE.Vector2(v.x,-v.z);});
      const shape=new THREE.Shape(ringPoints(rings[0]));
      for(const hole of rings.slice(1))shape.holes.push(new THREE.Path(ringPoints(hole)));
      const geometry=new THREE.ExtrudeGeometry(shape,{depth:.55,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.025,bevelThickness:.035,curveSegments:1});
      geometry.rotateX(-Math.PI/2);
      const mesh=new THREE.Mesh(geometry,[material,side]);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.province=p.id;
      polyGroup.add(mesh);meshes.push(mesh);
      const points=rings[0].map(c=>{const v=project(c);v.y=.602;return v;});
      polyGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),lineMat));
    }
    group.add(polyGroup);
    const box=new THREE.Box3().setFromObject(polyGroup);
    byId.set(p.id,{feature,group:polyGroup,material,baseColor:material.color.clone(),box});
  });
  let hovered=null;
  function highlight(id){
    hovered=id;
    for(const [key,value]of byId){
      value.material.color.copy(value.baseColor);
      if(key===id)value.material.color.set('#467f68');
    }
  }
  function select(id){
    for(const[key,value]of byId){
      value.group.visible=!id||key===id;
      value.group.position.y=0;
    }
    highlight(id);
  }
  return {group,meshes,byId,highlight,select,get hovered(){return hovered;}};
}
