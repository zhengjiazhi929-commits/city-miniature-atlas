import * as THREE from 'three';

// Recover the authored symbol placement from the old v0.8 display coordinates.
// This transforms symbols only; the current terrain uses unwarped geography.
export function createTourismDisplay({baseProjection,projection,project}) {
  const center=baseProjection.project([120.16,30.26]);
  const sigma=baseProjection.metersToUnits*21000;
  function legacyProject(coord) {
    const p=baseProjection.project(coord),dx=p.x-center.x,dz=p.z-center.z;
    const f=1+1.2*Math.exp(-(dx*dx+dz*dz)/(2*sigma*sigma));
    return [center.x+dx*f,center.z+dz*f];
  }
  function legacyUnproject(x,z) {
    const dx=x-center.x,dz=z-center.z,rd=Math.hypot(dx,dz);
    if(rd<1e-9)return baseProjection.unproject(x,z);
    let lo=0,hi=rd;
    for(let i=0;i<34;i++){const r=(lo+hi)/2,d=r*(1+1.2*Math.exp(-r*r/(2*sigma*sigma)));if(d<rd)lo=r;else hi=r;}
    const f=(lo+hi)/2/rd;
    return baseProjection.unproject(center.x+dx*f,center.z+dz*f);
  }
  return function transport(group,item,layout) {
    const source=legacyProject(item.coordinates);
    const legacyAnchor=[source[0]+(layout?.offset?.[0]||0),source[1]+(layout?.offset?.[1]||0)];
    const displayCoordinates=legacyUnproject(...legacyAnchor),anchor=project(displayCoordinates);
    const growth=['leifeng','liuhe'].includes(item.id)?1.55:['faxi','lingyin'].includes(item.id)?1.12:item.id==='xiaohe'?1.3:item.id==='santan'?1.65:1.22;
    const scale=group.scale.clone();
    // Compact land architecture retains its authored plan proportions.
    // Transporting each vertex anisotropically can turn a courtyard into a
    // skinny tower. Its new complete envelope is fitted separately on land.
    const rigid=!['santan','gongchen','broken-bridge'].includes(item.id);
    const epsilon=.001,dx=projection.project(legacyUnproject(legacyAnchor[0]+epsilon,legacyAnchor[1])),dz=projection.project(legacyUnproject(legacyAnchor[0],legacyAnchor[1]+epsilon));
    const areaScale=Math.sqrt(Math.abs((dx.x-anchor.x)*(dz.z-anchor.z)-(dx.z-anchor.z)*(dz.x-anchor.x)))/epsilon;
    // Respect the global map scale, including removing the legacy urban lens.
    // A minimum near one would secretly retain oversized old footprints.
    const isotropic=Math.max(.25,Math.min(3,areaScale));
    const coords=[],worldPoints=[];
    group.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const pos=mesh.geometry.attributes.position;
      for(let i=0;i<pos.count;i++) {
        const x=legacyAnchor[0]+pos.getX(i)*scale.x,z=legacyAnchor[1]+pos.getZ(i)*scale.z;
        const coord=legacyUnproject(x,z),mapped=rigid?new THREE.Vector3(anchor.x+pos.getX(i)*scale.x*isotropic,0,anchor.z+pos.getZ(i)*scale.z*isotropic):projection.project(coord);
        pos.setXYZ(i,mapped.x-anchor.x,pos.getY(i)*scale.y*growth,mapped.z-anchor.z);
        worldPoints.push([mapped.x,mapped.z]);
        // Sample representative model bottoms, including elevated courtyard
        // terraces. The returned hull is also used to clear ordinary fabric.
        if(i%18===0)coords.push(coord);
      }
      pos.needsUpdate=true;mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    });
    group.scale.setScalar(1);group.position.copy(anchor);
    // Ground contact is resolved after the complete footprint is fitted. Do
    // not lift the whole object to the highest sampled tree crown footprint.
    group.position.y=anchor.y;
    const unique=[...new Map(worldPoints.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const lower=[],upper=[];
    for(const p of unique){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=1e-10)lower.pop();lower.push(p);}
    for(const p of unique.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=1e-10)upper.pop();upper.push(p);}
    lower.pop();upper.pop();const hull=lower.concat(upper),footprint=hull.map(p=>projection.unproject(...p));
    group.userData.tourismDisplay={sourceAnchor:[...item.coordinates],displayCoordinates,heightGrowth:growth,policy:rigid?'authored plan proportions preserved; terrain-aware dry envelope fit on unchanged geography':'legacy symbol footprint recovered on unchanged geography',footprintWorld:hull};
    return {footprint,metadata:group.userData.tourismDisplay};
  };
}
