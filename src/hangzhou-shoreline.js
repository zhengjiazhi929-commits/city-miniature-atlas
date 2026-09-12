import * as THREE from 'three';

function indexPolygons(polygons,cell=.025,rowStep=.002){
  const bins=new Map();
  // A shoreline has many adjacent tests against the same large municipal or
  // lake ring. Index crossing segments by latitude instead of rescanning it.
  const indexedRing=ring=>{const rows=new Map();for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];if(a[1]===b[1])continue;for(let y=Math.floor(Math.min(a[1],b[1])/rowStep);y<=Math.floor(Math.max(a[1],b[1])/rowStep);y++){if(!rows.has(y))rows.set(y,[]);rows.get(y).push([a,b]);}}return p=>{let yes=false;for(const[a,b]of rows.get(Math.floor(p[1]/rowStep))||[])if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;return yes;};};
  for(const rings of polygons){const p=rings[0],b=[Infinity,Infinity,-Infinity,-Infinity],tests=rings.map(indexedRing),test=c=>tests[0](c)&&!tests.slice(1).some(f=>f(c));for(const c of p){b[0]=Math.min(b[0],c[0]);b[1]=Math.min(b[1],c[1]);b[2]=Math.max(b[2],c[0]);b[3]=Math.max(b[3],c[1]);}for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let y=Math.floor(b[1]/cell);y<=Math.floor(b[3]/cell);y++){const key=x+','+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(test);}}
  return {has:p=>(bins.get(Math.floor(p[0]/cell)+','+Math.floor(p[1]/cell))||[]).some(test=>test(p)),clear:()=>bins.clear()};
}

// Exact local edge tests complement point-in-polygon: endpoints on land do not
// prove that the face between them stays out of a bay, pond or island channel.
function createLandGuard(boundary,waterPolygons,cell,rowStep){
  const land=indexPolygons(boundary,cell*12,rowStep),water=indexPolygons(waterPolygons,cell*12,rowStep),bins=new Map();
  const extent=points=>{const b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of points){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}return b;};
  const eachCell=(b,visit)=>{for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let y=Math.floor(b[1]/cell);y<=Math.floor(b[3]/cell);y++)visit(x+','+y);};
  const epsilon=cell*1e-8,cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function onSegment(p,a,b){return Math.abs(cross(a,b,p))<=epsilon*Math.hypot(b[0]-a[0],b[1]-a[1])&&p[0]>=Math.min(a[0],b[0])-epsilon&&p[0]<=Math.max(a[0],b[0])+epsilon&&p[1]>=Math.min(a[1],b[1])-epsilon&&p[1]<=Math.max(a[1],b[1])+epsilon;}
  function intersects(a,b,c,d){
    const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
    if(((abC>0&&abD<0)||(abC<0&&abD>0))&&((cdA>0&&cdB<0)||(cdA<0&&cdB>0)))return true;
    return onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b);
  }
  function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(onSegment(p,a,b))return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  for(const polygon of [...boundary,...waterPolygons])for(const ring of polygon)for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i];if(a[0]===b[0]&&a[1]===b[1])continue;
    const edge={a,b,bounds:extent([a,b])};eachCell(edge.bounds,key=>{if(!bins.has(key))bins.set(key,[]);bins.get(key).push(edge);});
  }
  function containsFace(face){
    if(!face.every(p=>land.has(p)&&!water.has(p)))return false;
    const bounds=extent(face),seen=new Set();let safe=true;
    eachCell(bounds,key=>{if(!safe)return;for(const edge of bins.get(key)||[]){
      if(seen.has(edge))continue;seen.add(edge);const b=edge.bounds;
      if(b[2]<bounds[0]||b[0]>bounds[2]||b[3]<bounds[1]||b[1]>bounds[3])continue;
      // Reject a boundary entirely enclosed by the face, not just crossings.
      // This also catches a small complete water polygon inside a broad strip.
      if(inside(edge.a,face)||inside(edge.b,face)){safe=false;break;}
      for(let i=0;i<face.length;i++)if(intersects(face[i],face[(i+1)%face.length],edge.a,edge.b)){safe=false;break;}
      if(!safe)break;
    }});
    return safe;
  }
  return {containsFace,dispose(){land.clear();water.clear();bins.clear();}};
}

/** Neutral, source-constrained physical banks. No guessed quay, path or bank type. */
export function createHangzhouShoreline({data,project,metersToUnits,uniformDetailBounds=null}){
  const group=new THREE.Group();group.name='Source shoreline relief and land-side transitions';
  const diagnostics={sourceSegments:0,bankSegments:0,transitionSegments:0,mainCityTransitionSegments:0,outerTransitionSegments:0,internalWaterEdgesSkipped:0,sourceFaceRejections:0,displayFaceRejections:0,triangles:0,disposed:false,uniformDetailBounds:uniformDetailBounds?[...uniformDetailBounds]:null,policy:'Source water edge unchanged; inset land-side transitions pass exact edge/containment guards in both source and display spaces; all eligible main-city banks use the same detail rule, without source-order budget starvation; no inferred quay/path/bank type.'};
  const water=indexPolygons(data.water.map(w=>w.rings)),land=indexPolygons(data.boundary);
  const validLand=p=>land.has(p)&&!water.has(p);
  const waterPolygons=data.water.map(w=>w.rings),sourceGuard=createLandGuard(data.boundary,waterPolygons,.002,.002);
  const toDisplay=p=>{const v=project(p,0);return[v.x,v.z];},displayPolygons=polygons=>polygons.map(rings=>rings.map(ring=>ring.map(toDisplay)));
  const displayStep=222.64*metersToUnits,displayGuard=createLandGuard(displayPolygons(data.boundary),displayPolygons(waterPolygons),displayStep,displayStep);
  const faces=[],colors=[],shapes=[],materials=[];
  const dark=new THREE.Color('#687f6c'),middle=new THREE.Color('#aaa98b'),rim=new THREE.Color('#c5c2a2'),ground=new THREE.Color('#b3bd91');
  const groundCache=new Map(),groundAt=c=>{const key=c[0].toFixed(7)+','+c[1].toFixed(7);if(!groundCache.has(key))groundCache.set(key,project(c));return groundCache.get(key).clone();};
  const triangle=(a,b,c,ca,cb,cc)=>{if(![a,b,c].every(p=>[p.x,p.y,p.z].every(Number.isFinite)))return;for(const p of[a,b,c])faces.push(p.x,p.y,p.z);for(const color of[ca,cb,cc])color.toArray(colors,colors.length);};
  const quad=(a,b,c,d,lower,upper)=>{triangle(a,b,d,lower,lower,upper);triangle(b,c,d,lower,upper,upper);};
  for(const feature of data.water){
    const waterY=project(feature.rings[0][0],feature.levelMeters).y+.008;
    for(const ring of feature.rings)for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      const lon=111320*Math.cos(mid[1]*Math.PI/180),dx=(b[0]-a[0])*lon,dz=(b[1]-a[1])*111320,length=Math.hypot(dx,dz);
      if(length<2)continue;diagnostics.sourceSegments++;
      const normal=[-dz/length/lon,dx/length/111320];
      let direction=0;
      for(const probe of[12,4,1]){if(validLand([mid[0]+normal[0]*probe,mid[1]+normal[1]*probe])){direction=1;break;}if(validLand([mid[0]-normal[0]*probe,mid[1]-normal[1]*probe])){direction=-1;break;}}
      if(!direction){diagnostics.internalWaterEdgesSkipped++;continue;}
      // Resampling limits the size of each bank face without changing its edge.
      const inUnifiedArea=uniformDetailBounds&&mid[0]>=uniformDetailBounds[0]&&mid[0]<=uniformDetailBounds[2]&&mid[1]>=uniformDetailBounds[1]&&mid[1]<=uniformDetailBounds[3];
      const detailed=inUnifiedArea?feature.areaMeters>20000:feature.areaMeters>300000&&data.landmarks.some(l=>Math.hypot((mid[0]-l.coordinates[0])*lon,(mid[1]-l.coordinates[1])*111320)<5000);
      const parts=Math.max(1,Math.ceil(length/600));
      for(let step=0;step<parts;step++){
        const at=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
        const ca=at(step/parts),cb=at((step+1)/parts),centre=at((step+.5)/parts);
        const offset=(c,m)=>[c[0]+normal[0]*direction*m,c[1]+normal[1]*direction*m];
        if(!validLand(offset(centre,3)))continue;
        const ga=groundAt(ca),gb=groundAt(cb),frontA=ga.clone(),frontB=gb.clone();
        frontA.y=frontB.y=waterY-.006;
        ga.y=Math.max(ga.y+.0025,waterY+.002);gb.y=Math.max(gb.y+.0025,waterY+.002);
        quad(frontA,frontB,gb,ga,dark,rim);diagnostics.bankSegments++;
        if(!detailed||!inUnifiedArea&&diagnostics.outerTransitionSegments>=7000)continue;
        let width=Math.min(100,Math.max(28,length*.22));
        for(let attempt=0;attempt<5&&width>=12;attempt++,width*=.5){
          // Keep the top transition slightly inside land. The actual shore
          // stays at ca/cb and is represented by the unshifted bank wall above.
          const inset=6,innerA=offset(ca,inset),innerB=offset(cb,inset),outerA=offset(ca,width),outerB=offset(cb,width);
          if(!sourceGuard.containsFace([innerA,innerB,outerB,outerA])){diagnostics.sourceFaceRejections++;continue;}
          const middleA=offset(ca,inset+(width-inset)*.35),middleB=offset(cb,inset+(width-inset)*.35);
          const ia=groundAt(innerA),ib=groundAt(innerB),ma=groundAt(middleA),mb=groundAt(middleB),oa=groundAt(outerA),ob=groundAt(outerB);
          const displayFaces=[[ia,ib,ma],[ib,mb,ma],[ma,mb,oa],[mb,ob,oa]].map(face=>face.map(v=>[v.x,v.z]));
          if(!displayFaces.every(face=>displayGuard.containsFace(face))){diagnostics.displayFaceRejections++;continue;}
          // No broad artificial shelf on a steep cliff: retain the sampled slope.
          if(Math.max(Math.abs(oa.y-ia.y),Math.abs(ob.y-ib.y))>width*metersToUnits*5)break;
          for(const p of [ia,ib,oa,ob])p.y+=.0025;ma.y+=.003;mb.y+=.003;
          quad(ia,ib,mb,ma,rim,middle);quad(ma,mb,ob,oa,middle,ground);diagnostics.transitionSegments++;if(inUnifiedArea)diagnostics.mainCityTransitionSegments++;else diagnostics.outerTransitionSegments++;break;
        }
      }
    }
  }
  water.clear();land.clear();groundCache.clear();sourceGuard.dispose();displayGuard.dispose();
  if(faces.length){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(faces,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,material);mesh.name='Source water bank faces and terrain-following margin';mesh.receiveShadow=true;mesh.userData.role='source-shoreline';group.add(mesh);shapes.push(geometry);materials.push(material);diagnostics.triangles=faces.length/9;
  }
  function dispose(){if(diagnostics.disposed)return;diagnostics.disposed=true;group.removeFromParent();for(const value of shapes)value.dispose();for(const value of materials)value.dispose();shapes.length=materials.length=0;group.clear();}
  return {group,diagnostics,dispose};
}
