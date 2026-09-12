// A view owns its resources; an in-progress export can hold a second lease.
// Shared geometries/materials/textures are disposed only after the last lease.
export function createResourcePool(){
  const references=new Map();
  function retain(root){
    const resources=new Set();
    const texture=value=>{if(value?.isTexture)resources.add(value);};
    root.traverse(object=>{
      if(object.geometry)resources.add(object.geometry);
      for(const material of [object.material].flat().filter(Boolean)){
        resources.add(material);
        Object.values(material).forEach(texture);
        for(const uniform of Object.values(material.uniforms||{})){
          texture(uniform.value);
          if(Array.isArray(uniform.value))uniform.value.forEach(texture);
        }
      }
      if(object.isInstancedMesh)resources.add(object);
      if(object.skeleton)resources.add(object.skeleton);
      if(object.shadow)resources.add(object.shadow);
    });
    for(const resource of resources)references.set(resource,(references.get(resource)||0)+1);
    let released=false;
    return {release(){
      if(released)return;released=true;
      for(const resource of resources){
        const count=references.get(resource)-1;
        if(count){references.set(resource,count);continue;}
        references.delete(resource);resource.dispose?.();
      }
      resources.clear();
    }};
  }
  return {retain,stats(){
    const result={geometries:0,materials:0,textures:0,instances:0,other:0};
    for(const resource of references.keys()){
      const key=resource.isBufferGeometry?'geometries':resource.isMaterial?'materials':resource.isTexture?'textures':resource.isInstancedMesh?'instances':'other';
      result[key]++;
    }
    return result;
  }};
}
