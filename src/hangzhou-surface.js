/** Nonlinear cartographic expansion can reverse tiny curved-edge slivers.
 * Orient the actual Float32 triangles and discard only collapsed faces.
 */
export function orientHangzhouSurface(positions,source){
  const indices=[];let flipped=0,degenerate=0;
  for(let i=0;i<source.length;i+=3){const a=source[i],b=source[i+1],c=source[i+2],ax=positions[a*3],az=positions[a*3+2],bx=positions[b*3],bz=positions[b*3+2],cx=positions[c*3],cz=positions[c*3+2],area=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);if(Math.abs(area)<1e-10){degenerate++;continue;}if(area>0){indices.push(a,c,b);flipped++;}else indices.push(a,b,c);}
  return{indices,flipped,degenerate};
}

/** Spatially indexed barycentric sampling of the actual rendered mesh.
 * Roads and instance bases must use this, not a second DEM interpolation.
 */
export function createHangzhouSurfaceSampler(positions,indices,projection,heightFactor){
  const step=.5,bins=new Map(),key=(x,z)=>`${x},${z}`;
  for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,minX=Math.floor(Math.min(positions[a],positions[b],positions[c])/step),maxX=Math.floor(Math.max(positions[a],positions[b],positions[c])/step),minZ=Math.floor(Math.min(positions[a+2],positions[b+2],positions[c+2])/step),maxZ=Math.floor(Math.max(positions[a+2],positions[b+2],positions[c+2])/step);for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const k=key(x,z);if(!bins.has(k))bins.set(k,[]);bins.get(k).push(i);}}
  function sample(coord){const p=projection.project(coord),list=bins.get(key(Math.floor(p.x/step),Math.floor(p.z/step)));if(!list)return null;let highest=null;for(const i of list){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2],den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-12)continue;const u=((bz-cz)*(p.x-cx)+(cx-bx)*(p.z-cz))/den,v=((cz-az)*(p.x-cx)+(ax-cx)*(p.z-cz))/den,w=1-u-v;if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6){const height=(u*positions[a+1]+v*positions[b+1]+w*positions[c+1])/heightFactor;highest=highest===null?height:Math.max(highest,height);}}return highest;}
  // Exact extrema of rendered terrain clipped to a convex footprint. A
  // finite grid can miss a small valley between its samples; a solid foundation
  // underside needs a lower bound over the complete area, not just its nodes.
  function heightRange(coordinates){
    const ring=coordinates.map(q=>{const p=projection.project(q);return[p.x,p.z];});
    if(ring.length<3)return null;
    const area=ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0),sign=Math.sign(area);
    if(!sign)return null;
    const bounds=[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))],candidates=new Set();
    for(let x=Math.floor(bounds[0]/step);x<=Math.floor(bounds[2]/step);x++)for(let z=Math.floor(bounds[1]/step);z<=Math.floor(bounds[3]/step);z++)for(const i of bins.get(key(x,z))||[])candidates.add(i);
    let min=Infinity,max=-Infinity,triangles=0;
    for(const i of candidates){
      let face=[0,1,2].map(k=>{const j=indices[i+k]*3;return[positions[j],positions[j+1],positions[j+2]];});
      if(Math.max(...face.map(p=>p[0]))<bounds[0]||Math.min(...face.map(p=>p[0]))>bounds[2]||Math.max(...face.map(p=>p[2]))<bounds[1]||Math.min(...face.map(p=>p[2]))>bounds[3])continue;
      for(let edge=0;edge<ring.length&&face.length;edge++){
        const a=ring[edge],b=ring[(edge+1)%ring.length],distance=p=>sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
        const clipped=[];let previous=face.at(-1),pd=distance(previous);
        for(const current of face){const cd=distance(current);if((pd>=0)!==(cd>=0)){const t=pd/(pd-cd);clipped.push(previous.map((v,k)=>v+(current[k]-v)*t));}if(cd>=0)clipped.push(current);previous=current;pd=cd;}face=clipped;
      }
      if(face.length<3)continue;
      const footprintArea=face.reduce((sum,a,k)=>{const b=face[(k+1)%face.length];return sum+a[0]*b[2]-b[0]*a[2];},0);
      if(Math.abs(footprintArea)<1e-14)continue;
      triangles++;for(const p of face){min=Math.min(min,p[1]/heightFactor);max=Math.max(max,p[1]/heightFactor);}
    }
    return triangles?{min,max,triangles}:null;
  }
  return{sample,heightRange,dispose(){bins.clear();positions=indices=null;},bins:bins.size};
}
