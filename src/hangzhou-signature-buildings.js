import * as THREE from 'three';

// Authored in metres. +X east, +Y up, +Z south. The viewer owns geographic
// placement, display exaggeration, source-footprint clearance and projection.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const vector = p => new THREE.Vector3(...p);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const positive = v => Number.isFinite(v) && v > 0;

function palette() {
  const values = {glass: ['#73949d', .53, .20], dark: ['#395865', .58, .12], metal: ['#c5d0ca', .66, .17], stone: ['#cecbbd', .83, 0], gold: ['#ba9958', .61, .30], field: ['#708a68', .91, 0], track: ['#a4745e', .88, 0]};
  return Object.fromEntries(Object.entries(values).map(([key, [color, roughness, metalness]]) => [key, new THREE.MeshStandardMaterial({color, roughness, metalness})]));
}

class Builder {
  constructor(group) { this.group = group; this.m = palette(); this.buckets = new Map(); }
  add(source, mat, position = [0, 0, 0], scale = [1, 1, 1], rotation = null) {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    const quaternion = rotation?.isQuaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0])));
    geometry.applyMatrix4(new THREE.Matrix4().compose(vector(position), quaternion, vector(scale)));
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(geometry);
  }
  box(x, y, z, width, height, depth, mat, yaw = 0) { this.add(new THREE.BoxGeometry(width, height, depth), mat, [x, y, z], [1, 1, 1], [0, yaw, 0]); }
  rod(a, b, radius, mat, sides = 4) {
    const start = vector(a), end = vector(b), delta = end.clone().sub(start), length = delta.length();
    if (length < .00001) return;
    this.add(new THREE.CylinderGeometry(radius, radius, length, sides), mat, start.add(end).multiplyScalar(.5).toArray(), [1, 1, 1], new THREE.Quaternion().setFromUnitVectors(UP, delta.normalize()));
  }
  cylinder(x, y, z, top, bottom, height, mat, sides = 24, scale = [1, 1, 1]) { this.add(new THREE.CylinderGeometry(top, bottom, height, sides), mat, [x, y, z], scale); }
  loft(rings, mat, close = true) {
    const n = rings[0].length, positions = rings.flat(2), indices = [];
    for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = row * n + i, b = row * n + j, c = (row + 1) * n + i, d = (row + 1) * n + j;
      indices.push(a, b, c, b, d, c);
    }
    if (close) for (let i = 1; i < n - 1; i++) { indices.push(0, i + 1, i); const p = (rings.length - 1) * n; indices.push(p, p + i, p + i + 1); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); this.add(geometry, mat);
  }
  surface(points, faces, mat) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3)); geometry.setIndex(faces.flat()); geometry.computeVertexNormals(); this.add(geometry, mat); }
  finish() {
    let triangles = 0;
    for (const [mat, list] of this.buckets) {
      const count = list.reduce((sum, g) => sum + g.attributes.position.count, 0), positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
      let offset = 0;
      for (const geometry of list) { positions.set(geometry.attributes.position.array, offset); normals.set(geometry.attributes.normal.array, offset); offset += geometry.attributes.position.array.length; geometry.dispose(); }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, mat); mesh.name = `Signature ${Object.keys(this.m).find(k => this.m[k] === mat)} geometry`; mesh.castShadow = mesh.receiveShadow = true; this.group.add(mesh); triangles += count / 3;
    }
    for (const material of Object.values(this.m)) if (!this.buckets.has(material)) material.dispose();
    this.buckets.clear(); return triangles;
  }
}

function rectangle(width, depth, y, x = 0, z = 0, angle = 0, bevel = .12) {
  const w = width / 2, d = depth / 2, bx = width * bevel, bz = depth * bevel, c = Math.cos(angle), s = Math.sin(angle);
  return [[-w + bx,-d],[-w,-d + bz],[-w,d - bz],[-w + bx,d],[w - bx,d],[w,d - bz],[w,-d + bz],[w - bx,-d]].map(([a,b]) => [x + a*c - b*s, y, z + a*s + b*c]);
}
function ellipse(rx, rz, y, count = 48, x = 0, z = 0) { return Array.from({length: count}, (_, i) => { const a = -TAU * i / count; return [x + Math.cos(a)*rx, y, z + Math.sin(a)*rz]; }); }
function outline(b, ring, radius, mat) { for (let i=0;i<ring.length;i++) b.rod(ring[i],ring[(i+1)%ring.length],radius,mat); }
function curtainTower(b, {x=0,z=0,width,depth,height,base=0,profile=null,horizontal=8,vertical=2}) {
  const stages = 12, rings = Array.from({length: stages+1}, (_,i) => {
    const t=i/stages, shape=profile?profile(t):{};
    return rectangle(width*(shape.sx??1),depth*(shape.sz??1),base+height*t,x+(shape.x??0),z+(shape.z??0),shape.angle??0);
  });
  b.loft(rings,b.m.glass);
  // Real small solid fins follow the authored silhouette, merged per material.
  for(let edge=0;edge<8;edge++) for(let section=0;section<vertical;section++) {
    const t=section/vertical;
    for(let row=0;row<stages;row++) b.rod(rings[row][edge].map((v,k)=>mix(v,rings[row][(edge+1)%8][k],t)),rings[row+1][edge].map((v,k)=>mix(v,rings[row+1][(edge+1)%8][k],t)),.32,b.m.metal);
  }
  for(let i=1;i<=horizontal;i++) { const t=i/(horizontal+1),shape=profile?profile(t):{}; outline(b,rectangle(width*(shape.sx??1)+.6,depth*(shape.sz??1)+.6,base+height*t,x+(shape.x??0),z+(shape.z??0),shape.angle??0),.28,b.m.metal); }
  outline(b,rings.at(-1),.65,b.m.metal);
  return rings;
}
function ringVolume(b, outer, inner, mat, bottomY) {
  const n=outer.length, points=[...outer,...inner,...outer.map(p=>[p[0],bottomY,p[2]]),...inner.map(p=>[p[0],bottomY,p[2]])],faces=[];
  for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([i,j,n+i],[j,n+j,n+i],[i,2*n+i,j],[j,2*n+i,2*n+j],[n+i,n+j,3*n+i],[n+j,3*n+j,3*n+i],[2*n+i,3*n+i,2*n+j],[2*n+j,3*n+i,3*n+j]);}
  b.surface(points,faces,mat);
}

function gate(b, d, shape) {
  const width=d.width,depth=d.depth,height=d.height;
  const parts=d.parts.length===2?d.parts:[{x:-width*.31,z:0,width:width*.36,depth:depth*.91},{x:width*.31,z:0,width:width*.36,depth:depth*.91}];
  const centers=[];
  for(let i=0;i<parts.length;i++){
    const p=parts[i],sign=i?1:-1,tw=p.width,td=p.depth;
    centers.push([p.x,p.z]);b.box(p.x,4,p.z,tw,8,td,b.m.stone);
    curtainTower(b,{x:p.x,z:p.z,width:tw,depth:td,height:height-8,base:8,horizontal:14,vertical:3,profile:t=>({sx:1-.10*t,sz:1-.12*t,x:-sign*width*.075*Math.sin(t*Math.PI),angle:sign*.23*t})});
  }
  // SOM confirms a sweeping connection at mid-height, not a top crossbar.
  const a=parts[0],c=parts[1],sections=18,bridgeDepth=Math.min(a.depth,c.depth)*.48,bridgeThickness=height*.045,bridge=[];
  for(let i=0;i<=sections;i++){const t=i/sections,x=mix(a.x,c.x,t),z=mix(a.z,c.z,t),y=height*(.48+.12*Math.sin(Math.PI*t));bridge.push([[x,y-bridgeThickness/2,z-bridgeDepth/2],[x,y+bridgeThickness/2,z-bridgeDepth/2],[x,y+bridgeThickness/2,z+bridgeDepth/2],[x,y-bridgeThickness/2,z+bridgeDepth/2]]);}
  b.loft(bridge,b.m.glass);
  for(const side of [1,2])for(let i=1;i<bridge.length;i++)b.rod(bridge[i-1][side],bridge[i][side],.7,b.m.metal);
  return {towers:2,componentCentersCanonicalMeters:centers,componentPlacementPolicy:d.parts.length===2?'source component centres':'nominal pair',skyBridge:true,bridgeLocation:'sweeping midsection; not tower-top',form:'paired twisting towers with curved mid-height skybridge',sourceShape:shape.description};
}
function civic(b,d,shape) {
  const radiusX=d.width*.30,radiusZ=d.depth*.30,tw=Math.min(d.width,d.depth)*.17,td=tw*.84;
  // Six towers encircle a genuine open civic courtyard. Connections are only
  // authored when specifically confirmed by the source component description.
  for(let i=0;i<6;i++){const a=i*TAU/6-Math.PI/6,x=Math.cos(a)*radiusX,z=Math.sin(a)*radiusZ;curtainTower(b,{x,z,width:tw,depth:td,height:d.height,horizontal:8,vertical:2});}
  const ring=Array.from({length:6},(_,i)=>{const a=i*TAU/6-Math.PI/6;return [Math.cos(a)*radiusX,d.height*.70,Math.sin(a)*radiusZ];});for(let i=0;i<6;i++){const a=ring[i],c=ring[(i+1)%6],mid=a.map((v,k)=>(v+c[k])/2),length=Math.hypot(c[0]-a[0],c[2]-a[2]);b.box(mid[0],mid[1],mid[2],length,d.height*.12,tw*.70,b.m.glass,-Math.atan2(c[2]-a[2],c[0]-a[0]));}
  return {towers:6,elevatedConnections:6,openCentralCourtyard:true,form:'six-tower civic ring with elevated connections',sourceShape:shape.description};
}
function conference(b,d,shape) {
  const [cx,cz]=d.parts.length?[d.parts[0].x,d.parts[0].z]:[0,0];
  const base=d.height*.13,radius=d.height*.50,centerY=d.height-radius,rx=Math.min(d.width*.47,radius),rz=Math.min(d.depth*.47,radius);
  b.cylinder(0,base/2,0,1,1,base,b.m.stone,48,[d.width*.48,1,d.depth*.48]);
  const phiEnd=Math.acos(clamp((base-centerY)/radius,-1,1));
  b.add(new THREE.SphereGeometry(1,40,22,0,TAU,0,phiEnd),b.m.gold,[cx,centerY,cz],[rx,radius,rz]);
  for(let i=1;i<10;i++){const theta=phiEnd*i/10,y=centerY+radius*Math.cos(theta),r=Math.sin(theta);outline(b,ellipse(rx*r+.3,rz*r+.3,y,40,cx,cz),.23,b.m.metal);}
  for(let i=0;i<20;i++){const a=i*TAU/20;for(let j=0;j<12;j++){const p=j/12*phiEnd,q=(j+1)/12*phiEnd;b.rod([cx+rx*Math.sin(p)*Math.cos(a),centerY+radius*Math.cos(p),cz+rz*Math.sin(p)*Math.sin(a)],[cx+rx*Math.sin(q)*Math.cos(a),centerY+radius*Math.cos(q),cz+rz*Math.sin(q)*Math.sin(a)],.25,b.m.metal);}}
  return {form:'golden truncated spherical conference volume',globeCenterCanonicalMeters:[cx,cz],sourceShape:shape.description};
}
function lotus(b,d,shape,small=false) {
  const rx=d.width*.48,rz=d.depth*.48,innerX=rx*(small?.47:.52),innerZ=rz*(small?.47:.41),height=d.height;
  const petals=small?24:28,secondaryPetals=small?8:27;
  ringVolume(b,ellipse(rx*.91,rz*.91,height*.44),ellipse(innerX,innerZ,height*.30),b.m.dark,0);
  b.cylinder(0,1,0,1,1,2,b.m.field,48,[innerX*.92,1,innerZ*.92]);
  if(!small){
    ringVolume(b,ellipse(innerX*.97,innerZ*.97,2.35,48),ellipse(innerX*.78,innerZ*.70,2.35,48),b.m.track,2);
    for(const f of [.80,.86,.92])outline(b,ellipse(innerX*f,innerZ*(f+.03),2.52,48),.16,b.m.metal);
  }
  const pitchWidth=innerX*(small?1.22:1.31),pitchDepth=innerZ*(small?.82:1.10),line=.24;
  for(const sign of [-1,1]){b.box(0,2.6,sign*pitchDepth/2,pitchWidth,.25,line,b.m.metal);b.box(sign*pitchWidth/2,2.6,0,line,.25,pitchDepth,b.m.metal);}
  b.box(0,2.6,0,line,.25,pitchDepth,b.m.metal);
  if(small){b.box(0,3.1,0,.32,1.2,pitchDepth*1.08,b.m.dark);for(const sign of [-1,1])b.box(sign*pitchWidth*.23,2.6,0,line,.25,pitchDepth,b.m.metal);}
  else outline(b,ellipse(innerZ*.19,innerZ*.19,2.62,24),.18,b.m.metal);

  // Curved solid petals rise from the external skirt, arc over the seating and
  // leave the central opening legible. No opaque disk closes the playing field.
  const bands=small?[{count:24,scale:1,height:.57,base:0,phase:0},{count:8,scale:.77,height:.75,base:.28,phase:TAU/16}]:[{count:28,scale:1,height:1,base:0,phase:0},{count:27,scale:.98,height:.67,base:0,phase:TAU/54}];
  for(const band of bands)for(let petal=0;petal<band.count;petal++){
    const a=petal*TAU/band.count+band.phase,half=TAU/band.count*.53,points=[],radial=6,across=4;
    for(let u=0;u<=radial;u++)for(let v=0;v<=across;v++){
      const t=u/radial,q=(v/across-.5)*2,angle=a+q*half*(.3+.7*Math.sin(Math.PI*t/2)),r=1-t*.46;
      const y=height*(band.base+band.height*(.08+.68*Math.sin(Math.PI*t*.77)+.18*(1-q*q)*Math.sin(Math.PI*t)));
      points.push([Math.cos(angle)*rx*r*band.scale,y,Math.sin(angle)*rz*r*band.scale]);
    }
    const n=points.length,thickness=Math.max(1.2,height*.018);points.push(...points.map(p=>[p[0],p[1]-thickness,p[2]]));const faces=[];
    for(let u=0;u<radial;u++)for(let v=0;v<across;v++){const i=u*(across+1)+v,j=i+across+1;faces.push([i,j,i+1],[i+1,j,j+1],[n+i,n+i+1,n+j],[n+i+1,n+j+1,n+j]);}
    const boundary=[];for(let v=0;v<=across;v++)boundary.push(v);for(let u=1;u<=radial;u++)boundary.push(u*(across+1)+across);for(let v=across-1;v>=0;v--)boundary.push(radial*(across+1)+v);for(let u=radial-1;u>0;u--)boundary.push(u*(across+1));
    for(let j=0;j<boundary.length;j++){const a=boundary[j],c=boundary[(j+1)%boundary.length];faces.push([a,n+a,c],[c,n+a,n+c]);}
    b.surface(points,faces,b.m.metal);
    const ridge=Array.from({length:radial+1},(_,i)=>points[i*(across+1)+across/2]);for(let i=1;i<ridge.length;i++)b.rod(ridge[i-1],ridge[i],.30,b.m.stone);
  }
  return {form:small?'small-lotus opening petal arena':'large-lotus open stadium',petals,secondaryPetals,petalCountPolicy:'source-confirmed: big 28 large + 27 small; small 24 fixed + 8 opening roof petals',roofDisplayState:small?'partially open representative state':'permanent open-center stadium',openCenter:true};
}
function hangzhouCenter(b,d,shape) {
  const podiumHeight=d.height*.23;
  b.box(0,podiumHeight/2,0,d.width,podiumHeight,d.depth,b.m.stone);
  b.box(d.width*.12,podiumHeight*.62,-d.depth*.13,d.width*.73,podiumHeight*.76,d.depth*.61,b.m.glass);
  for(const sign of [-1,1]){
    const x=sign*d.width*.225,z=sign*d.depth*.035,h=d.height*(sign<0?.93:1)-podiumHeight;
    curtainTower(b,{x,z,width:d.width*.29,depth:d.depth*.45,base:podiumHeight,height:h,horizontal:9,vertical:4});
    // Offset narrow corner blades describe the pinwheel facade rather than
    // adding a false pointed crown to these two flat-topped built towers.
    for(const corner of [-1,1])b.box(x+corner*d.width*.148,podiumHeight+h/2,z-corner*d.depth*.07,d.width*.025,h,d.depth*.33,b.m.metal);
  }
  b.box(0,podiumHeight+.55,d.depth*.23,d.width*.74,1.1,d.depth*.24,b.m.field);
  for(let i=0;i<12;i++)b.box(-d.width*.46+d.width*.92*i/11,podiumHeight*.45,d.depth*.502,.55,podiumHeight*.9,.7,b.m.metal);
  return {form:'two rectangular pinwheel glass towers with retail podium and elevated garden',towers:2,top:'flat',sourceShape:shape.description};
}
function efc(b,d,shape) {
  const podiumHeight=d.height*.065,parts=d.parts.length===2?d.parts:[{x:-d.width*.34,z:0,width:d.width*.24,depth:d.depth*.84},{x:d.width*.34,z:0,width:d.width*.23,depth:d.depth*.87}];
  for(let i=0;i<parts.length;i++){
    const p=parts[i],x=p.x,z=p.z,width=p.width,depth=p.depth,h=d.height*(i?.96:1);
    b.box(x,podiumHeight/2,z,width,podiumHeight,depth,b.m.stone);
    curtainTower(b,{x,z,width,depth,base:podiumHeight,height:h-podiumHeight,horizontal:18,vertical:2});
    for(const sx of [-1,1])for(const sz of [-1,1])b.box(x+sx*width*.48,h/2,z+sz*depth*.49,1.8,h,1.8,b.m.metal);
    b.box(x,h-6,z,width*.985,12,depth*.985,b.m.dark);
    for(let j=0;j<7;j++)b.box(x-width*.46+width*.92*j/6,h-6,z+depth*.50,.8,12,.8,b.m.metal);
  }
  return {form:'independently positioned framed slender landmark pair',principalTowers:2,componentCentersCanonicalMeters:parts.map(p=>[p.x,p.z]),componentPlacementPolicy:d.parts.length===2?'source component centres':'nominal pair',unsourcedCompanionSlabsOmitted:true,heightScope:'unverified nominal display heights; reported T6 height is not assigned as a measurement to either ambiguously labelled source tower',sourceShape:shape.description};
}
function alibaba(b,d,shape) {
  // Six mid-rise office blocks surround an open court; the campus must never
  // become a tall downtown tower symbol. Outline proportions remain schematic.
  const w=d.width*.25,zDepth=d.depth*.23,positions=[[-.33,-.31],[0,-.34],[.33,-.31],[-.33,.31],[0,.34],[.33,.31]];
  for(let i=0;i<positions.length;i++){
    const [x,z]=positions[i],h=d.height*(i===1?1:i%2?.83:.91);
    curtainTower(b,{x:x*d.width,z:z*d.depth,width:w,depth:zDepth,height:h,horizontal:6,vertical:3});
    b.box(x*d.width,h+.6,z*d.depth,w*.83,1.2,zDepth*.76,b.m.field);
  }
  // Low shared circulation ring and Ali Roof; the middle remains open.
  const outer=[[-d.width*.34,0,-d.depth*.19],[-d.width*.34,0,d.depth*.19],[d.width*.34,0,d.depth*.19],[d.width*.34,0,-d.depth*.19]],inner=outer.map(([x,y,z])=>[x*.91,y,z*.87]);
  ringVolume(b,outer.map(([x,y,z])=>[x,9,z]),inner.map(([x,y,z])=>[x,9,z]),b.m.stone,6);
  b.box(0,.6,0,d.width*.52,1.2,d.depth*.24,b.m.field);
  b.box(-d.width*.43,6.5,0,d.width*.14,13,d.depth*.26,b.m.glass);
  b.box(-d.width*.41,14,0,d.width*.20,2,d.depth*.30,b.m.metal);
  return {form:'six mid-rise courtyard offices, low circulation ring and entrance roof',officeBlocks:6,openCentralCourt:true,heightScope:'project maximum, individual office heights are representative proportions',sourceShape:shape.description};
}

const AUTHORS={
  'hangzhou-gate':gate,'civic-center':civic,'conference-center':conference,
  'big-lotus':(b,d,s)=>lotus(b,d,s,false),'small-lotus':(b,d,s)=>lotus(b,d,s,true),
  'hangzhou-center':hangzhouCenter,'efc':efc,'alibaba-campus':alibaba,
};
const NOMINAL={
  'hangzhou-gate':[180,65,310],'civic-center':[197,197,110],'conference-center':[171,162,85],
  'big-lotus':[331,277,65],'small-lotus':[146,141,48],'hangzhou-center':[125,100,130],'efc':[280,220,220],'alibaba-campus':[400,330,80],
};
export const HANGZHOU_SIGNATURE_TYPES=Object.freeze(Object.keys(AUTHORS));

function dimensions(item,type) {
  const nominal=NOMINAL[type],shape=item.shape||{},width=item.dimensions?.widthMeters??shape.widthMeters,depth=item.dimensions?.depthMeters??shape.depthMeters;
  const bearing=item.orientation?.degreesFromNorth??90,angle=bearing*Math.PI/180,s=Math.sin(angle),c=Math.cos(angle),origin=item.coordinates||[0,0],longitudeMetres=111320*Math.cos(origin[1]*Math.PI/180);
  const local=coordinate=>{const east=(coordinate[0]-origin[0])*longitudeMetres,north=(coordinate[1]-origin[1])*111320;return [east*s+north*c,east*c-north*s];};
  const parts=(shape.components||[]).filter(p=>Array.isArray(p.offsetMetersCanonicalXZ)).map(p=>{
    const geometry=p.footprint,rings=geometry?.type==='Polygon'?geometry.coordinates:geometry?.type==='MultiPolygon'?geometry.coordinates.flat(1):[],points=rings.flat(1).map(local);
    const extent=points.length?[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]:null;
    return {id:p.id,x:p.offsetMetersCanonicalXZ[0],z:p.offsetMetersCanonicalXZ[1],width:extent?extent[2]-extent[0]:nominal[0]*.27,depth:extent?extent[3]-extent[1]:nominal[1]*.84};
  });
  return {parts,width:positive(width)?width:nominal[0],depth:positive(depth)?depth:nominal[1],height:positive(item.verifiedHeightMeters)?item.verifiedHeightMeters:positive(shape.nominalHeightMeters)?shape.nominalHeightMeters:nominal[2],heightPolicy:positive(item.verifiedHeightMeters)?'source-verified project height; see component height scope':'nominal illustrative height; not a surveyed dimension',horizontalPolicy:positive(width)&&positive(depth)?'source-specified envelope; representative authored silhouette':'nominal illustrative envelope; viewer must validate footprint'};
}

/** Each result owns its geometry/materials; no generated texture, loader or
 * renderer. Unsupported identities throw instead of becoming a generic box.
 * A verified orientation rotates canonical +X to the source long-axis bearing;
 * caller must not apply that rotation for a second time.
 */
export function createSignatureBuilding(item) {
  if(!item||typeof item!=='object')throw new TypeError('A sourced signature-building item is required.');
  const type=item.shape?.type||item.type;
  if(!AUTHORS[type])throw new RangeError(`Unsupported Hangzhou signature shape: ${type}`);
  const d=dimensions(item,type),group=new THREE.Group();group.name=item.name||item.id||type;
  const builder=new Builder(group),semantics=AUTHORS[type](builder,d,item.shape||{}),triangles=builder.finish();
  const authoredBounds=new THREE.Box3().setFromObject(group),heightFit=d.height/(authoredBounds.max.y-authoredBounds.min.y);
  for(const mesh of group.children){mesh.geometry.translate(0,-authoredBounds.min.y,0);mesh.geometry.scale(1,heightFit,1);}
  const bearing=item.orientation?.degreesFromNorth,hasBearing=Number.isFinite(bearing),yaw=hasBearing?(90-bearing)*Math.PI/180:0;
  if(yaw)for(const mesh of group.children){mesh.geometry.rotateY(yaw);mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
  const bounds=new THREE.Box3().setFromObject(group),diagnostics={id:item.id,name:item.name,type,localAxes:'+X east; +Y up; +Z south',unit:'metres',coordinatesOwnedByViewer:true,representative:true,sourceFootprintNotMutated:true,heightPolicy:d.heightPolicy,horizontalPolicy:d.horizontalPolicy,authoredHeightMeters:d.height,orientationPolicy:hasBearing?'source-confirmed long-axis bearing':'unverified; canonical orientation only',authoredBearing:hasBearing?bearing:null,triangles,drawCalls:group.children.length,sizeMeters:bounds.getSize(new THREE.Vector3()).toArray(),boundsMeters:{min:bounds.min.toArray(),max:bounds.max.toArray()},disposed:false,...semantics};
  group.userData={...diagnostics};
  const dispose=()=>{if(diagnostics.disposed)return;diagnostics.disposed=true;group.removeFromParent();const materials=new Set();for(const mesh of group.children){mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material);}for(const material of materials)material.dispose();group.clear();};
  return {group,diagnostics,dispose};
}
