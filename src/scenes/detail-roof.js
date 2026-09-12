import * as THREE from 'three';

// A closed hip roof. Footprint is supplied by the caller after containment in
// the source building; the curved profile is an illustrative architectural form.
export function curvedHipRoof(width, depth, height, thickness=.025){
  const nx=16,nz=12,positions=[],indices=[];
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const x=(ix/nx-.5)*width,z=(iz/nz-.5)*depth;
    const t=Math.min(1,Math.max(Math.abs(z)/(depth*.5),Math.max(0,(Math.abs(x)-width*.28)/(width*.22))));
    const y=height*(Math.pow(1-t,1.65)+.07*Math.pow(t,8));
    positions.push(x,y,z);
  }
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1;indices.push(a,c,b,b,c,d);
  }
  const rim=[];for(let x=0;x<=nx;x++)rim.push(x);for(let z=1;z<=nz;z++)rim.push(z*(nx+1)+nx);for(let x=nx-1;x>=0;x--)rim.push(nz*(nx+1)+x);for(let z=nz-1;z>0;z--)rim.push(z*(nx+1));
  const bottom=positions.length/3;for(const i of rim)positions.push(positions[i*3],-thickness,positions[i*3+2]);
  const center=positions.length/3;positions.push(0,-thickness,0);
  for(let i=0;i<rim.length;i++){const j=(i+1)%rim.length;indices.push(rim[i],rim[j],bottom+i,rim[j],bottom+j,bottom+i,center,bottom+i,bottom+j);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
