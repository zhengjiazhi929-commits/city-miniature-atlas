import * as THREE from 'three';
import polygonClipping from '../vendor/polygon-clipping.js';
import {installTerrainQualityProtocol} from './terrain-quality.js';
import {regionPolygons, toRegionMercator} from './region-projection.js';
import {applyTerrainStyle} from './terrain-style.js';

const GRID_CELLS = 256;
const TILE_LIMIT = 24;
const TILE_CONCURRENCY = 4;
const rect = (x0,y0,x1,y1) => [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]];
const pause = () => new Promise(resolve => setTimeout(resolve,0));
const cancelled = () => new DOMException('Region terrain cancelled.','AbortError');

function polygonBounds(polygons) {
  let west=Infinity,north=Infinity,east=-Infinity,south=-Infinity;
  for(const polygon of polygons) for(const ring of polygon) for(const [x,y] of ring) {
    west=Math.min(west,x);east=Math.max(east,x);north=Math.min(north,y);south=Math.max(south,y);
  }
  return [west,north,east,south];
}

function chooseTiles(polygons, bounds) {
  const cover = zoom => {
    const n=2**zoom, range=[Math.floor(bounds[0]*n),Math.floor(bounds[1]*n),Math.floor(bounds[2]*n),Math.floor(bounds[3]*n)];
    if((range[2]-range[0]+1)*(range[3]-range[1]+1)>160)return null;
    const tiles=[];
    for(let y=range[1];y<=range[3];y++)for(let x=range[0];x<=range[2];x++) {
      if(polygonClipping.intersection(polygons,rect(x/n,y/n,(x+1)/n,(y+1)/n)).length)tiles.push({x,y,z:zoom,key:`${x}/${y}`});
      if(tiles.length>TILE_LIMIT)return null;
    }
    return tiles;
  };
  for(let z=15;z>=0;z--){const tiles=cover(z);if(tiles?.length)return {z,tiles};}
  throw new Error('No terrain tiles intersect this region.');
}

async function decodeHeights(buffer, assertActive) {
  assertActive();
  const bitmap=await createImageBitmap(new Blob([buffer],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  try {
    assertActive();
    if(bitmap.width!==256||bitmap.height!==256)throw new Error('Terrain source must be 256 × 256 pixels.');
    const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(256,256):Object.assign(document.createElement('canvas'),{width:256,height:256});
    const context=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    if(!context)throw new Error('Unable to read terrain pixels.');
    context.drawImage(bitmap,0,0);
    const rgba=context.getImageData(0,0,256,256).data,heights=new Float32Array(65536);
    for(let i=0;i<heights.length;i++)heights[i]=rgba[i*4]*256+rgba[i*4+1]+rgba[i*4+2]/256-32768;
    canvas.width=canvas.height=1;
    assertActive();return heights;
  } finally { bitmap.close(); }
}

function inRing(ring,x,z) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

/** Measured DEM cut to a true polygon; no MapLibre renderer or synthetic hills. */
export async function createRegionTerrain({region,projection,kind='province',signal,onProgress=()=>{},surfaceStyle,heightExaggeration}) {
  signal?.throwIfAborted();
  const illustrated=surfaceStyle==='illustrated',gridCells=illustrated&&kind==='province'?384:GRID_CELLS;
  const heightScale=Number.isFinite(heightExaggeration)?THREE.MathUtils.clamp(heightExaggeration,1,12):(kind==='city'?1:8),controller=new AbortController(),group=new THREE.Group();
  group.name=`${region.properties?.name||region.id||'Region'} terrain`;
  const diagnostics={kind,heightScale,gridCells,style:illustrated?'measured-relief':'default',contourIntervalMeters:illustrated&&kind==='province'?100:null,demZoom:null,demTiles:0,loadedTiles:0,terrainTriangles:0,boundaryEdges:0,skippedDegenerateTriangles:0,waterAdjustedVertices:0,waterLevels:[],disposed:false};
  const heightsByTile=new Map(),ownedGeometry=new Set(),ownedMaterial=new Set();
  let protocol,quality,topMesh=null,sideMesh=null,bottomMesh=null,topPositions=null,rawHeights=null,terrainIndices=null,boundaryEdges=[],qualityReleased=false,surfaceWaterLookup=null,cutGeometry=null,cutoutGeneration=0;
  const adapter={addProtocol(name,callback){protocol=callback;},removeProtocol(){protocol=null;}};
  const assertActive=()=>{if(controller.signal.aborted||diagnostics.disposed)throw cancelled();};
  const releaseQuality=()=>{if(quality&&!qualityReleased){const before=quality.stats();quality.release();diagnostics.quality={...quality.stats(),recentFallbacks:before.recentFallbacks};qualityReleased=true;}};
  function dispose() {
    if(diagnostics.disposed)return;
    diagnostics.disposed=true;cutoutGeneration++;controller.abort();signal?.removeEventListener('abort',dispose);releaseQuality();
    for(const geometry of ownedGeometry){geometry.dispose();for(const key of Object.keys(geometry.attributes))geometry.deleteAttribute(key);geometry.setIndex(null);}ownedGeometry.clear();
    for(const material of ownedMaterial)material.dispose();ownedMaterial.clear();
    group.clear();heightsByTile.clear();topPositions=rawHeights=terrainIndices=null;boundaryEdges=[];surfaceWaterLookup=null;
    topMesh=sideMesh=bottomMesh=cutGeometry=null;
    diagnostics.retainedDemBytes=0;
  }
  signal?.addEventListener('abort',dispose,{once:true});
  const progress=(phase,completed,total,message)=>{assertActive();onProgress({phase,completed,total,message});};
  const material = options => {const value=new THREE.MeshStandardMaterial(options);ownedMaterial.add(value);return value;};
  const registerGeometry = geometry => {ownedGeometry.add(geometry);return geometry;};
  const makeMesh = (geometry,mat,name) => {const mesh=new THREE.Mesh(geometry,mat);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;};
  try {
    quality=installTerrainQualityProtocol(adapter);
    const mercatorPolygons=regionPolygons(region).map(polygon=>polygon.map(ring=>ring.map(toRegionMercator)));
    const cover=chooseTiles(mercatorPolygons,projection.mercatorBounds);
    diagnostics.demZoom=cover.z;diagnostics.demTiles=cover.tiles.length;
    progress('elevation',0,cover.tiles.length,'正在读取区域真实高程…');
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(TILE_CONCURRENCY,cover.tiles.length)},async()=>{
      while(cursor<cover.tiles.length) {
        assertActive();const tile=cover.tiles[cursor++];
        const response=await protocol({url:`terrain-clean://terrarium/${tile.z}/${tile.x}/${tile.y}.png`},controller);
        const heights=await decodeHeights(response.data,assertActive);assertActive();
        heightsByTile.set(tile.key,heights);diagnostics.loadedTiles++;
        progress('elevation',diagnostics.loadedTiles,cover.tiles.length,'正在读取区域真实高程…');
      }
    }));
    assertActive();releaseQuality();
    diagnostics.retainedDemBytes=heightsByTile.size*256*256*4;
    const pixelScale=2**cover.z*256;
    function sampleHeight(lnglat) {
      assertActive();
      const [mx,my]=toRegionMercator(lnglat),px=mx*pixelScale-.5,py=my*pixelScale-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
      let fallback=null,fallbackX=0,fallbackY=0;
      for(const [gx,gy] of [[x0,y0],[x0+1,y0],[x0,y0+1],[x0+1,y0+1]]) {
        const tx=Math.floor(gx/256),ty=Math.floor(gy/256),tile=heightsByTile.get(`${tx}/${ty}`);
        if(tile){fallback=tile;fallbackX=tx;fallbackY=ty;break;}
      }
      if(!fallback)throw new RangeError('Elevation requested outside loaded region tiles.');
      const read=(gx,gy)=>{
        const tx=Math.floor(gx/256),ty=Math.floor(gy/256),tile=heightsByTile.get(`${tx}/${ty}`);
        if(tile)return tile[(gy-ty*256)*256+gx-tx*256];
        // At the outer coverage edge, hold the nearest measured pixel. Never
        // synthesize a missing interior tile or change a negative elevation.
        return fallback[Math.max(0,Math.min(255,gy-fallbackY*256))*256+Math.max(0,Math.min(255,gx-fallbackX*256))];
      };
      return (read(x0,y0)*(1-fx)+read(x0+1,y0)*fx)*(1-fy)+(read(x0,y0+1)*(1-fx)+read(x0+1,y0+1)*fx)*fy;
    }

    const projected=regionPolygons(region).map(polygon=>polygon.map(ring=>ring.map(point=>{const p=projection.project(point);return[p.x,p.z];})));
    // Normalized ring winding, valid holes, and one consistent clipping space.
    const polygons=polygonClipping.union(projected),bounds=polygonBounds(polygons);
    const width=bounds[2]-bounds[0],depth=bounds[3]-bounds[1],longest=Math.max(width,depth),columns=Math.max(1,Math.ceil(width/longest*gridCells)),rows=Math.max(1,Math.ceil(depth/longest*gridCells));
    const dx=width/columns,dz=depth/rows,positions=[],elevations=[],uvs=[],indices=[],vertexMap=new Map();
    function vertex(x,z) {
      const key=`${Math.round(x*1e8)},${Math.round(z*1e8)}`;
      if(vertexMap.has(key))return vertexMap.get(key);
      const index=positions.length/3,meters=sampleHeight(projection.unproject(x,z));
      if(!Number.isFinite(meters))throw new Error('Terrain contains an unmeasured height.');
      positions.push(x,meters*projection.metersToUnits*heightScale,z);elevations.push(meters);uvs.push((x-bounds[0])/width,1-(z-bounds[1])/depth);vertexMap.set(key,index);return index;
    }
    progress('mesh',0,rows,'正在沿真实边界裁切地形…');
    for(let row=0;row<rows;row++) {
      assertActive();
      const z0=bounds[1]+row*dz,z1=bounds[1]+(row+1)*dz,strip=polygonClipping.intersection(polygons,rect(bounds[0],z0,bounds[2],z1));
      if(strip.length)for(let col=0;col<columns;col++) {
        const x0=bounds[0]+col*dx,x1=bounds[0]+(col+1)*dx;
        for(const polygon of polygonClipping.intersection(strip,rect(x0,z0,x1,z1))) {
          const rings=polygon.map(ring=>ring.slice(0,-1).map(([x,z])=>new THREE.Vector2(x,z)));
          const triangles=THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1)),points=rings.flat(),local=points.map(p=>vertex(p.x,p.y));
          for(const [a,b,c]of triangles){
            const ia=local[a],ib=local[b],ic=local[c];
            const ax=Math.fround(positions[ia*3]),az=Math.fround(positions[ia*3+2]),bx=Math.fround(positions[ib*3]),bz=Math.fround(positions[ib*3+2]),cx=Math.fround(positions[ic*3]),cz=Math.fround(positions[ic*3+2]);
            // A centimeter-scale boundary sliver can collapse or reverse when
            // uploaded as Float32. Orient the actual rendered triangle, and
            // omit only triangles with effectively zero projected area.
            const area=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
            if(ia===ib||ib===ic||ia===ic||Math.abs(area)<1e-10){diagnostics.skippedDegenerateTriangles++;continue;}
            if(area>0)indices.push(ia,ic,ib);else indices.push(ia,ib,ic);
          }
        }
      }
      if(row%8===0){progress('mesh',row+1,rows,'正在沿真实边界裁切地形…');await pause();}
    }
    assertActive();
    vertexMap.clear();
    if(!indices.length)throw new Error('The region boundary produced no terrain surface.');
    topPositions=new Float32Array(positions);rawHeights=new Float32Array(elevations);
    diagnostics.grid=[columns,rows];diagnostics.vertices=elevations.length;diagnostics.terrainTriangles=indices.length/3;
    diagnostics.minimumMeters=Infinity;diagnostics.maximumMeters=-Infinity;
    for(const h of elevations){diagnostics.minimumMeters=Math.min(diagnostics.minimumMeters,h);diagnostics.maximumMeters=Math.max(diagnostics.maximumMeters,h);}
    const topGeometry=registerGeometry(new THREE.BufferGeometry());
    terrainIndices=new Uint32Array(indices);
    topGeometry.setAttribute('position',new THREE.BufferAttribute(topPositions,3));topGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));topGeometry.setIndex(new THREE.BufferAttribute(terrainIndices,1));topGeometry.computeVertexNormals();
    const colors=new Float32Array(elevations.length*3),low=new THREE.Color('#c3ceb1'),high=new THREE.Color('#ded0ad'),color=new THREE.Color();
    for(let i=0;i<elevations.length;i++){color.copy(low).lerp(high,THREE.MathUtils.clamp(elevations[i]/4200,0,1));color.toArray(colors,i*3);}
    topGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    topMesh=makeMesh(topGeometry,material({color:'#ffffff',vertexColors:true,roughness:.94,metalness:0}),'Measured terrain surface');
    if(illustrated)applyTerrainStyle(topMesh.material,{metersToUnits:projection.metersToUnits,heightScale,contours:kind==='province',vivid:kind==='province'&&region.properties?.id==='zhejiang'});
    topMesh.userData.regionSurface=true;

    const edges=new Map();
    for(let i=0;i<indices.length;i+=3)for(const [a,b]of [[indices[i],indices[i+1]],[indices[i+1],indices[i+2]],[indices[i+2],indices[i]]]) {
      const key=a<b?`${a}/${b}`:`${b}/${a}`;
      if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);
    }
    boundaryEdges=[...edges.values()];edges.clear();diagnostics.boundaryEdges=boundaryEdges.length;
    positions.length=elevations.length=uvs.length=indices.length=0;
    const sideGeometry=registerGeometry(new THREE.BufferGeometry()),bottomGeometry=registerGeometry(new THREE.BufferGeometry());
    sideMesh=makeMesh(sideGeometry,material({color:'#b5ac93',roughness:1}),'Cut boundary walls');
    bottomMesh=makeMesh(bottomGeometry,material({color:'#a9a087',roughness:1}),'Closed region underside');
    function rebuildBase() {
      let minimum=0;for(let i=1;i<topPositions.length;i+=3)minimum=Math.min(minimum,topPositions[i]);
      const base=minimum-.65,sidePositions=[],sideIndices=[];
      for(const [a,b]of boundaryEdges){const ai=a*3,bi=b*3,n=sidePositions.length/3;sidePositions.push(topPositions[ai],topPositions[ai+1],topPositions[ai+2],topPositions[bi],topPositions[bi+1],topPositions[bi+2],topPositions[ai],base,topPositions[ai+2],topPositions[bi],base,topPositions[bi+2]);sideIndices.push(n,n+2,n+1,n+1,n+2,n+3);}
      if(sideGeometry.attributes.position){sideGeometry.attributes.position.array.set(sidePositions);sideGeometry.attributes.position.needsUpdate=true;}
      else {sideGeometry.setAttribute('position',new THREE.Float32BufferAttribute(sidePositions,3));sideGeometry.setIndex(sideIndices);}
      sideGeometry.computeVertexNormals();sideGeometry.computeBoundingSphere();
      const bottomPositions=bottomGeometry.attributes.position?.array||topPositions.slice();
      for(let i=1;i<bottomPositions.length;i+=3)bottomPositions[i]=base;
      if(bottomGeometry.attributes.position)bottomGeometry.attributes.position.needsUpdate=true;
      else {
        bottomGeometry.setAttribute('position',new THREE.BufferAttribute(bottomPositions,3));
        const bottomIndices=terrainIndices.slice();for(let i=0;i<bottomIndices.length;i+=3)[bottomIndices[i+1],bottomIndices[i+2]]=[bottomIndices[i+2],bottomIndices[i+1]];
        bottomGeometry.setIndex(new THREE.BufferAttribute(bottomIndices,1));
      }
      bottomGeometry.computeVertexNormals();bottomGeometry.computeBoundingSphere();diagnostics.baseY=base;
    }
    rebuildBase();
    function setSurfaceTexture(texture) {
      assertActive();
      // The vector owner retains/disposes this borrowed texture. Terrain owns
      // only its material; replacing a map must not destroy an external lease.
      topMesh.material.map=texture||null;topMesh.material.vertexColors=!texture;topMesh.material.color.set('#ffffff');topMesh.material.needsUpdate=true;
      if(texture){texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;}
    }
    function getWaterLevel(feature) {
      const p=feature.properties||{};
      if(Number.isFinite(p.waterLevelMeters))return p.waterLevelMeters;
      if(p.ocean===true||p.class==='ocean')return 0;
      const ring=regionPolygons(feature)[0]?.[0]||[],samples=[],step=Math.max(1,Math.floor(ring.length/16));
      for(let i=0;i<ring.length&&samples.length<16;i+=step){try{samples.push(sampleHeight(ring[i]));}catch(error){if(error.name==='AbortError')throw error;}}
      if(!samples.length)throw new Error('Water surface has no measured elevation samples.');
      samples.sort((a,b)=>a-b);return samples[Math.floor(samples.length/2)];
    }
    function setWaterMask(input) {
      assertActive();
      const features=input?.type==='FeatureCollection'?input.features:input?.type==='Feature'?[input]:input?[{type:'Feature',properties:{},geometry:input}]:[];
      const water=[];
      for(const feature of features){const level=getWaterLevel(feature);for(const polygon of regionPolygons(feature)){const rings=polygon.map(ring=>ring.map(p=>{const v=projection.project(p);return[v.x,v.z];}));water.push({rings,level,bounds:polygonBounds([rings])});}}
      const size=32,bins=Array.from({length:size*size},()=>[]),binX=x=>Math.max(0,Math.min(size-1,Math.floor((x-bounds[0])/width*size))),binZ=z=>Math.max(0,Math.min(size-1,Math.floor((z-bounds[1])/depth*size)));
      for(const item of water)for(let z=binZ(item.bounds[1]);z<=binZ(item.bounds[3]);z++)for(let x=binX(item.bounds[0]);x<=binX(item.bounds[2]);x++)bins[z*size+x].push(item);
      surfaceWaterLookup=(x,z)=>{
        for(const item of bins[binZ(z)*size+binX(x)])if(x>=item.bounds[0]&&x<=item.bounds[2]&&z>=item.bounds[1]&&z<=item.bounds[3]&&inRing(item.rings[0],x,z)&&!item.rings.slice(1).some(ring=>inRing(ring,x,z)))return item.level;
        return undefined;
      };
      let adjusted=0;
      for(let i=0;i<rawHeights.length;i++){
        const x=topPositions[i*3],z=topPositions[i*3+2],waterLevel=surfaceWaterLookup(x,z);let meters=rawHeights[i];
        if(waterLevel!==undefined){meters=waterLevel;adjusted++;}
        topPositions[i*3+1]=meters*heightScale*projection.metersToUnits;
      }
      diagnostics.waterAdjustedVertices=adjusted;diagnostics.waterLevels=water.map(item=>item.level);
      topGeometry.attributes.position.needsUpdate=true;topGeometry.computeVertexNormals();topGeometry.computeBoundingSphere();rebuildBase();
    }
    function sampleSurfaceHeight(lnglat) {
      assertActive();
      const p=projection.project(lnglat),waterLevel=surfaceWaterLookup?.(p.x,p.z);
      return waterLevel===undefined?sampleHeight(lnglat):waterLevel;
    }
    /** Replace the coarse top under a ready, finer surface. This removes actual
     * triangles rather than raising the replacement above incompatible terrain.
     * Call after water correction; coverage is WGS84 and must only include ready tiles.
     */
    async function setSurfaceCutout(coverage) {
      assertActive();
      const generation=++cutoutGeneration;
      const assertCurrent=()=>{assertActive();if(generation!==cutoutGeneration)throw cancelled();};
      const features=coverage?.type==='FeatureCollection'?coverage.features:coverage?[coverage]:[];
      if(!features.length){
        topMesh.geometry=topGeometry;if(cutGeometry){ownedGeometry.delete(cutGeometry);cutGeometry.dispose();cutGeometry=null;}
        diagnostics.surfaceCutout=false;diagnostics.renderedTerrainTriangles=terrainIndices.length/3;diagnostics.surfaceCutoutSkippedDegenerateTriangles=0;
        return;
      }
      const clips=features.flatMap(feature=>regionPolygons(feature).map(poly=>poly.map(ring=>ring.map(c=>{const p=projection.project(c);return[p.x,p.z];}))));
      const cutter=polygonClipping.union(clips),cutBounds=polygonBounds(cutter),output=[],normals=[],colors=[],uv=[],outIndices=[],keys=new Map();
      const sourceNormals=topGeometry.attributes.normal.array,sourceColors=topGeometry.attributes.color.array;
      let skippedDegenerateTriangles=0;
      const emit=(x,z,ids)=>{
        const a=ids[0]*3,b=ids[1]*3,c=ids[2]*3;
        const ax=topPositions[a],az=topPositions[a+2],bx=topPositions[b],bz=topPositions[b+2],cx=topPositions[c],cz=topPositions[c+2];
        const denominator=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
        const wa=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/denominator,wb=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/denominator,wc=1-wa-wb;
        const y=wa*topPositions[a+1]+wb*topPositions[b+1]+wc*topPositions[c+1],key=`${Math.round(x*1e7)}/${Math.round(y*1e7)}/${Math.round(z*1e7)}`;
        if(keys.has(key))return keys.get(key);
        const index=output.length/3;keys.set(key,index);output.push(x,y,z);uv.push((x-bounds[0])/width,1-(z-bounds[1])/depth);
        const normal=new THREE.Vector3(),color=new THREE.Vector3();
        for(let i=0;i<3;i++){normal.setComponent(i,wa*sourceNormals[a+i]+wb*sourceNormals[b+i]+wc*sourceNormals[c+i]);color.setComponent(i,wa*sourceColors[a+i]+wb*sourceColors[b+i]+wc*sourceColors[c+i]);}
        normal.normalize().toArray(normals,normals.length);color.toArray(colors,colors.length);return index;
      };
      const face=(points,ids)=>{
        const a=points[0],b=points[1],c=points[2],area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
        if(Math.abs(area)<1e-10){skippedDegenerateTriangles++;return;}
        const vertices=points.map(p=>emit(...p,ids)),[ia,ib,ic]=vertices;
        // Clipping creates narrow slivers that can collapse after vertex
        // deduplication or Float32 upload. Check the actual rendered face.
        const ax=Math.fround(output[ia*3]),az=Math.fround(output[ia*3+2]),bx=Math.fround(output[ib*3]),bz=Math.fround(output[ib*3+2]),cx=Math.fround(output[ic*3]),cz=Math.fround(output[ic*3+2]);
        const renderedArea=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
        if(ia===ib||ib===ic||ia===ic||Math.abs(renderedArea)<1e-10){skippedDegenerateTriangles++;return;}
        outIndices.push(...(renderedArea>0?[ia,ic,ib]:vertices));
      };
      for(let i=0;i<terrainIndices.length;i+=3){
        if(i%12000===0){assertCurrent();await pause();assertCurrent();}
        const ids=[terrainIndices[i],terrainIndices[i+1],terrainIndices[i+2]],points=ids.map(id=>[topPositions[id*3],topPositions[id*3+2]]);
        const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
        if(Math.max(...xs)<cutBounds[0]||Math.min(...xs)>cutBounds[2]||Math.max(...zs)<cutBounds[1]||Math.min(...zs)>cutBounds[3]){face(points,ids);continue;}
        for(const poly of polygonClipping.difference([[...points,points[0]]],cutter)){
          const rings=poly.map(r=>r.slice(0,-1).map(p=>new THREE.Vector2(...p))),vertices=rings.flat();
          for(const tri of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1)))face(tri.map(j=>[vertices[j].x,vertices[j].y]),ids);
        }
      }
      assertCurrent();const geometry=registerGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(output,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(outIndices);geometry.computeBoundingSphere();
      if(cutGeometry){ownedGeometry.delete(cutGeometry);cutGeometry.dispose();}cutGeometry=geometry;topMesh.geometry=geometry;
      diagnostics.surfaceCutout=true;diagnostics.renderedTerrainTriangles=outIndices.length/3;diagnostics.surfaceCutoutSkippedDegenerateTriangles=skippedDegenerateTriangles;
    }
    topGeometry.computeBoundingSphere();
    progress('ready',rows,rows,'区域真实地形已就绪');
    return {group,sampleHeight,sampleSurfaceHeight,heightScale,diagnostics,dispose,setSurfaceTexture,setWaterMask,setSurfaceCutout,getWaterLevel,terrainMesh:topMesh};
  } catch(error) {dispose();throw error;}
}
