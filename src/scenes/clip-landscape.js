import * as THREE from 'three';

// Clip a source landscape against a convex presentation outline. Position, UV,
// colour and normal values at intersections are barycentric edge interpolants.
// It crops existing terrain; it never changes its height or moves the landmark.
export function clipLandscapeMesh(mesh,outline,bottom,wallMaterial){
  const old=mesh.geometry,source=old.index?old.toNonIndexed():old;
  const names=Object.keys(source.attributes).filter(n=>!n.startsWith('skin')),out=Object.fromEntries(names.map(n=>[n,[]])),walls=[];
  const side=(p,a,b)=>(b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  const boundary=(a,b)=>outline.some((p,i)=>{const q=outline[(i+1)%outline.length],len=Math.hypot(q[0]-p[0],q[1]-p[1]);return Math.abs(side(a,p,q))/len<1e-5&&Math.abs(side(b,p,q))/len<1e-5;});
  for(let i=0;i<source.attributes.position.count;i+=3){
    let poly=[0,1,2].map(k=>Object.fromEntries(names.map(n=>{const a=source.attributes[n];return[n,Array.from(a.array.slice((i+k)*a.itemSize,(i+k+1)*a.itemSize))];})));
    for(let edge=0;edge<outline.length&&poly.length;edge++){
      const a=outline[edge],b=outline[(edge+1)%outline.length],next=[];
      for(let k=0;k<poly.length;k++){
        const p=poly[k],q=poly[(k+1)%poly.length],pa=side(p.position,a,b),pb=side(q.position,a,b),inside=pa>=-1e-7;
        if(inside)next.push(p);
        if(inside!==(pb>=-1e-7)){const t=pa/(pa-pb);next.push(Object.fromEntries(names.map(n=>[n,p[n].map((v,j)=>v+(q[n][j]-v)*t)])));}
      }
      poly=next;
    }
    if(poly.length<3)continue;
    for(let k=1;k<poly.length-1;k++)for(const p of[poly[0],poly[k],poly[k+1]])for(const n of names)out[n].push(...p[n]);
    if(wallMaterial)for(let k=0;k<poly.length;k++){
      const a=poly[k].position,b=poly[(k+1)%poly.length].position;
      if(boundary(a,b)&&Math.hypot(a[0]-b[0],a[2]-b[2])>1e-6)walls.push(...a,b[0],bottom,b[2],...b,...a,a[0],bottom,a[2],b[0],bottom,b[2]);
    }
  }
  const geometry=new THREE.BufferGeometry();for(const n of names)geometry.setAttribute(n,new THREE.Float32BufferAttribute(out[n],source.attributes[n].itemSize));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  mesh.geometry=geometry;if(source!==old)source.dispose();old.dispose();
  if(!walls.length)return null;
  const wallGeometry=new THREE.BufferGeometry();wallGeometry.setAttribute('position',new THREE.Float32BufferAttribute(walls,3));wallGeometry.computeVertexNormals();const wall=new THREE.Mesh(wallGeometry,wallMaterial);wall.name='独立景观周边封口';wall.castShadow=wall.receiveShadow=true;return wall;
}
