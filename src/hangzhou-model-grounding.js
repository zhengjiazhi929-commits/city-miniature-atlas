import * as THREE from 'three';

// A flat architectural model cannot touch an uneven hillside just by moving
// its origin. Close the space below each actual structural underside instead.
// The terrain is never modified. These small foundations are display geometry,
// not claims about surveyed retaining walls at the attraction.
export function groundModelOnTerrain(group,{project,projection,clearance=.001,step=.04,tolerance=.00025,bottomFraction=.005}={}) {
  group.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(group),height=box.max.y-box.min.y;
  const threshold=box.min.y+height*bottomFraction+1e-6,triangles=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  group.traverse(mesh=>{
    if(!mesh.isMesh||mesh.userData.terrainFoundation)return;
    const position=mesh.geometry.attributes.position,index=mesh.geometry.index,count=index?.count??position.count;
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      normal.crossVectors(b.clone().sub(a),c.clone().sub(a));
      if(normal.y>=-1e-12||Math.abs(normal.y)/normal.length()<.98||Math.max(a.y,b.y,c.y)>threshold)continue;
      triangles.push([a.toArray(),b.toArray(),c.toArray()]);
    }
  });
  const diagnostics={policy:'Small solid foundations follow actual rendered terrain under low structural undersides; terrain and model plan remain unchanged.',undersideTriangles:triangles.length,foundationTriangles:0,terrainContactSamples:0,maxFoundationDepth:0,maxInterpolationError:0,bodyLift:0};
  if(!triangles.length){diagnostics.supported=false;diagnostics.reason='No horizontal structural underside found; caller must provide a suitable physical base.';group.userData.grounding=diagnostics;return diagnostics;}
  const cache=new Map();
  const ground=(x,z)=>{const key=`${x.toFixed(8)},${z.toFixed(8)}`;if(!cache.has(key)){const y=project(projection.unproject(x,z)).y;if(!Number.isFinite(y))throw new Error('Nonfinite displayed terrain beneath landmark.');cache.set(key,y);}return cache.get(key);};
  const midpoint=(p,q)=>p.map((v,i)=>(v+q[i])/2);
  const cells=[];
  function subdivide(v,depth=0){
    const [p,q,r]=v,ends=v.map(p=>ground(p[0],p[2])),m=[midpoint(p,q),midpoint(q,r),midpoint(r,p)],center=p.map((n,i)=>(n+q[i]+r[i])/3);
    const errors=[...m.map((p,i)=>Math.abs(ground(p[0],p[2])-(ends[i]+ends[(i+1)%3])/2)),Math.abs(ground(center[0],center[2])-ends.reduce((s,y)=>s+y,0)/3)];
    const length=Math.max(...v.map((p,i)=>Math.hypot(p[0]-v[(i+1)%3][0],p[2]-v[(i+1)%3][2]))),error=Math.max(...errors);
    if(depth<9&&(length>step||error>tolerance)){
      subdivide([p,m[0],m[2]],depth+1);subdivide([m[0],q,m[1]],depth+1);subdivide([m[2],m[1],r],depth+1);subdivide([m[0],m[1],m[2]],depth+1);return;
    }
    diagnostics.maxInterpolationError=Math.max(diagnostics.maxInterpolationError,error);cells.push(v);
  }
  triangles.forEach(t=>subdivide(t));
  let lift=-Infinity;
  for(const triangle of cells)for(const p of triangle)lift=Math.max(lift,ground(p[0],p[2])-p[1]+clearance);
  // Exactly align the lowest viable support plane; an old blanket max-height
  // placement is also lowered again, rather than becoming a permanent offset.
  const before=group.getWorldPosition(new THREE.Vector3()),after=before.clone().add(new THREE.Vector3(0,lift,0));
  if(group.parent){group.parent.worldToLocal(before);group.parent.worldToLocal(after);}group.position.add(after.sub(before));
  diagnostics.bodyLift=lift;group.updateWorldMatrix(true,true);
  const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert(),vertices=[],point=new THREE.Vector3();
  const emit=(...points)=>{for(const p of points){point.fromArray(p).applyMatrix4(inverse);vertices.push(...point.toArray());}diagnostics.foundationTriangles++;};
  const sides=new Map(),edgeKey=p=>p.map(n=>n.toFixed(8)).join(',');
  for(const v of cells){
    const top=v.map(p=>[p[0],p[1]+lift,p[2]]),bottom=v.map(p=>[p[0],ground(p[0],p[2])-clearance,p[2]]);
    for(let i=0;i<3;i++)diagnostics.maxFoundationDepth=Math.max(diagnostics.maxFoundationDepth,top[i][1]-bottom[i][1]);
    emit(bottom[0],bottom[1],bottom[2]);
    // Give the foundation its own closed upper shell, directly against the
    // original model underside. Contact inspection must not depend on a cap
    // belonging to another mesh or on triangulation vertices along its walls.
    emit(top[0],top[2],top[1]);
    for(let i=0;i<3;i++){const j=(i+1)%3,key=[edgeKey(top[i]),edgeKey(top[j])].sort().join('|');if(sides.has(key))sides.get(key).count++;else sides.set(key,{count:1,points:[bottom[i],top[i],top[j],bottom[j]]});}
  }
  // Shared subdivided interior edges are not exterior walls. Keeping only the
  // boundary also avoids thousands of hidden, coincident vertical triangles.
  for(const side of sides.values())if(side.count===1){const [a,b,c,d]=side.points;emit(a,b,c);emit(a,c,d);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({color:'#939078',roughness:1,side:THREE.DoubleSide});
  const foundation=new THREE.Mesh(geometry,material);foundation.name='贴合真实地面的浅基础';foundation.castShadow=true;foundation.receiveShadow=true;foundation.userData.terrainFoundation=true;group.add(foundation);
  diagnostics.terrainContactSamples=cache.size;diagnostics.supported=diagnostics.maxInterpolationError<=tolerance*1.1;diagnostics.foundationBottomInset=clearance;
  group.userData.grounding=diagnostics;
  // Signature models have an explicit owner; register these extra resources
  // via this hook if that owner disposes only its authored material buckets.
  return {...diagnostics,dispose(){geometry.dispose();material.dispose();foundation.removeFromParent();}};
}

// Mountain symbols are a grove plus a small building, not one broad platform.
// Split the authored material batches back into connected tree components so
// every trunk can meet its own terrain elevation while crowns stay rigid.
export function groundScatteredForest(group,options){
  const originals=group.children.filter(o=>o.isMesh),components=[];
  for(const mesh of originals){
    const source=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry,p=source.attributes.position,n=p.count/3,parent=Array.from({length:n},(_,i)=>i),owner=new Map();
    const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>n.toFixed(7)).join(','),triangle=Math.floor(i/3);if(owner.has(key)){const a=find(triangle),b=find(owner.get(key));if(a!==b)parent[a]=b;}else owner.set(key,triangle);}
    const buckets=new Map();for(let i=0;i<n;i++){const root=find(i);if(!buckets.has(root))buckets.set(root,[]);buckets.get(root).push(i);}
    for(const ids of buckets.values()){
      const geometry=new THREE.BufferGeometry();for(const name of ['position','normal']){const attribute=source.attributes[name];if(!attribute)continue;const values=[];for(const i of ids)for(let j=0;j<3;j++){const at=(i*3+j)*attribute.itemSize;for(let k=0;k<attribute.itemSize;k++)values.push(attribute.array[at+k]);}geometry.setAttribute(name,new THREE.Float32BufferAttribute(values,attribute.itemSize));}
      geometry.computeBoundingBox();geometry.computeBoundingSphere();components.push({geometry,material:mesh.material,color:mesh.material.color.getHexString(),bounds:geometry.boundingBox});
    }
    if(source!==mesh.geometry)source.dispose();mesh.geometry.dispose();mesh.removeFromParent();
  }
  const trunks=components.filter(c=>c.color==='735239'),roots=trunks.map(c=>({x:(c.bounds.min.x+c.bounds.max.x)/2,z:(c.bounds.min.z+c.bounds.max.z)/2,group:new THREE.Group()})),architecture=new THREE.Group();
  architecture.name='随山地落地的小型入口建筑';roots.forEach((r,i)=>{r.group.name=`独立落地的树木 ${i+1}`;group.add(r.group);});group.add(architecture);
  const foliage=new Set(['487943','326750','91b958','735239']);
  for(const component of components){
    const mesh=new THREE.Mesh(component.geometry,component.material);mesh.castShadow=true;mesh.receiveShadow=true;
    if(foliage.has(component.color)&&roots.length){const x=(component.bounds.min.x+component.bounds.max.x)/2,z=(component.bounds.min.z+component.bounds.max.z)/2;let nearest=roots[0];for(const r of roots)if(Math.hypot(r.x-x,r.z-z)<Math.hypot(nearest.x-x,nearest.z-z))nearest=r;nearest.group.add(mesh);}else architecture.add(mesh);
  }
  // A mountain reserve anchor may be on a very steep DEM facet. Keep the
  // entrance building compact there rather than growing a tall retaining wall.
  group.updateWorldMatrix(true,true);
  let architectureScale=1;
  for(let attempt=0;attempt<10&&architecture.children.length;attempt++){
    const box=new THREE.Box3().setFromObject(architecture),face=[[box.min.x,box.min.z],[box.max.x,box.min.z],[box.max.x,box.max.z],[box.min.x,box.max.z]];
    if(terrainEnvelopeRelief(face,{...options,step:.015}).relief<=.06)break;
    const localBox=new THREE.Box3();for(const mesh of architecture.children){mesh.geometry.computeBoundingBox();localBox.union(mesh.geometry.boundingBox);}const center=localBox.getCenter(new THREE.Vector3());
    for(const mesh of architecture.children){const position=mesh.geometry.attributes.position;for(let i=0;i<position.count;i++)position.setXYZ(i,center.x+(position.getX(i)-center.x)*.72,localBox.min.y+(position.getY(i)-localBox.min.y)*.72,center.z+(position.getZ(i)-center.z)*.72);position.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
    architectureScale*=.72;
  }
  const results=[architecture,...roots.map(r=>r.group)].filter(g=>g.children.length).map(g=>groundModelOnTerrain(g,options));
  const diagnostics={policy:'Each authored mountain tree and entrance building is rigidly placed on its own terrain-supported foundation; no shared floating grove plate.',independentTrees:roots.length,components:results.length,architectureScale,supported:results.every(r=>r.supported),maxFoundationDepth:Math.max(...results.map(r=>r.maxFoundationDepth)),maxInterpolationError:Math.max(...results.map(r=>r.maxInterpolationError)),foundationTriangles:results.reduce((s,r)=>s+r.foundationTriangles,0),terrainContactSamples:results.reduce((s,r)=>s+r.terrainContactSamples,0),supports:results.map(({dispose,...details})=>details)};
  group.userData.grounding=diagnostics;return diagnostics;
}

// Sample throughout a convex envelope, not only at its corners. A high point
// between corners otherwise produces an invisible terrain/model intersection.
export function terrainEnvelopeRelief(face,{project,projection,step=.08}) {
  const center=[face.reduce((s,p)=>s+p[0],0)/face.length,face.reduce((s,p)=>s+p[1],0)/face.length];
  let min=Infinity,max=-Infinity;
  const sample=p=>{const y=project(projection.unproject(...p)).y;min=Math.min(min,y);max=Math.max(max,y);};
  sample(center);
  for(let i=0;i<face.length;i++){
    const p=face[i],q=face[(i+1)%face.length],n=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/step));
    for(let j=0;j<=n;j++){const t=j/n,r=[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t],count=Math.max(1,Math.ceil(Math.hypot(r[0]-center[0],r[1]-center[1])/step));for(let k=0;k<=count;k++){const u=k/count;sample([center[0]+(r[0]-center[0])*u,center[1]+(r[1]-center[1])*u]);}}
  }
  return {min,max,relief:max-min};
}
