#!/usr/bin/env node
// Original generic display models. Rebuild all cities' shared kit in one place.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three.module.js';

const APP = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(APP, 'assets/city-kit/v1');
const VERSION = '1.7.0';
const NOTICE = 'Original city-independent cartographic display assets, not surveyed buildings, species, road alignments or geographic evidence. Each compound contains one dominant principal building; edge gardens, plazas and service yards are authored motifs, not measured public land-use claims. Normalized compound footprint is 1 × 1, bottom 0, full height 1. Main-body dimensions identify the actual principal wall volume for renderer-scale calibration, not real architectural measurements.';
const NAMES = {'residential-slab':'宽板住宅楼','residential-twins':'退台公寓楼','residential-gallery':'连续阳台住宅','residential-point':'多翼公寓楼','commercial-office':'切角玻璃办公塔楼','commercial-block':'退台商业综合楼','industrial-sheds':'单体生产厂房','industrial-logistics':'单体仓储厂房','generic-courtyard':'围合庭院公共楼','generic-stepped':'转角退台街坊楼','generic-ribbon':'带状幕墙办公楼','generic-point':'竖向窗格公寓楼','tree-broad-crown':'阔叶树冠','tree-upright-crown':'直立树冠','tree-trunk':'树干组件','road-deck':'道路实体组件','bridge-pier':'桥墩组件'};
const P = {white: '#e0e9ee', warm: '#c4d4df', cream: '#d5e0e7', brick: '#a9bdcc',
  glass: '#96bcd3', glassLight: '#b5d9e9', glassDark: '#749eb9', roof: '#879ba9',
  roofWarm: '#94a6af', plinth: '#91998f', frame: '#e5eff3', darkFrame: '#7797b0',
  garden: '#5e7761', paving: '#b5b9ae'};
// Wide display-calibration ranges are deliberately separate from normal gallery
// preview proportions. They are not claims about surveyed building dimensions.
const COMPOUNDS = {
 'residential-slab':{height:[.5,2.5],primaryHeight:[3.6,5.8],slenderness:6.6,depth:[.65,1.05],previewHeight:1.25,buildingCount:1,sharedSpace:'garden'},
 'residential-gallery':{height:[.5,3],primaryHeight:[3.5,5.6],slenderness:6.6,depth:[.70,1.10],previewHeight:1.55,buildingCount:1,sharedSpace:'garden'},
 'residential-point':{height:[.7,3.5],primaryHeight:[4.0,6.4],slenderness:7.2,depth:[.70,1.1],previewHeight:2.1,buildingCount:1,sharedSpace:'garden'},
 'residential-twins':{height:[.7,3.5],primaryHeight:[4.4,6.6],slenderness:7.2,depth:[.65,1.10],previewHeight:2.15,buildingCount:1,sharedSpace:'garden'},
 'commercial-office':{height:[1,5],primaryHeight:[4.4,6.8],slenderness:7.5,depth:[.65,1.05],previewHeight:3.0,buildingCount:1,sharedSpace:'plaza'},
 'commercial-block':{height:[.3,2.5],primaryHeight:[2.6,4.6],slenderness:5.8,depth:[.65,1.15],previewHeight:1.2,buildingCount:1,sharedSpace:'plaza'},
 'industrial-sheds':{height:[.1,1],primaryHeight:[.55,.90],slenderness:1.4,depth:[.75,1.15],previewHeight:.40,buildingCount:1,sharedSpace:'yard'},
 'industrial-logistics':{height:[.1,1],primaryHeight:[.65,1.05],slenderness:1.5,depth:[.75,1.20],previewHeight:.42,buildingCount:1,sharedSpace:'yard'},
 'generic-courtyard':{height:[.3,2],primaryHeight:[2.4,4.0],slenderness:5.5,depth:[.65,1.05],previewHeight:.8,buildingCount:1,sharedSpace:'garden'},
 'generic-ribbon':{height:[.4,3],primaryHeight:[3.0,4.8],slenderness:6.3,depth:[.65,1.10],previewHeight:1.1,buildingCount:1,sharedSpace:'plaza'},
 'generic-point':{height:[.7,3.5],primaryHeight:[4.2,6.4],slenderness:7.2,depth:[.70,1.12],previewHeight:2.0,buildingCount:1,sharedSpace:'garden'},
 'generic-stepped':{height:[.4,3],primaryHeight:[3.4,5.6],slenderness:6.6,depth:[.65,1.10],previewHeight:1.35,buildingCount:1,sharedSpace:'plaza'},
};
const DEPTH_PROFILES = Object.fromEntries(Object.entries(COMPOUNDS).map(([id,p])=>[id,p.depth]));
const facePalette = (front, side, top = front, back = side, bottom = side) => normal =>
  normal.y > .5 ? top : normal.y < -.5 ? bottom : normal.z > .5 ? front : normal.z < -.5 ? back : side;

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rounded = value => Math.round(value * 1e6) / 1e6;
const uuidFor = id => { const h = digest(VERSION + ':' + id); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };

// Texture-free GLTFExporter needs only these asynchronous FileReader operations
// under Node. The browser runtime has no polyfill and loads geometry JSON only.
if (!globalThis.FileReader) globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }, error => this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }, error => this.onerror?.(error)); }
};
const vendorUrl = new URL('../vendor/three.module.js', import.meta.url).href;
const exporterSource = (await fs.readFile(new URL('../vendor/addons/exporters/GLTFExporter.js', import.meta.url), 'utf8')).replace("from 'three'", `from '${vendorUrl}'`);
const {GLTFExporter} = await import('data:text/javascript;base64,' + Buffer.from(exporterSource).toString('base64'));
const validatorSource = (await fs.readFile(new URL('../src/city-assets.js', import.meta.url), 'utf8'))
  .replace("from 'three'", `from '${vendorUrl}'`)
  .replace("new URL('../assets/city-kit/v1/manifest.json', import.meta.url)", "new URL('file:///unused-city-kit-manifest.json')");
const {validateCityAsset,createCityAssetMaterials} = await import('data:text/javascript;base64,' + Buffer.from(validatorSource).toString('base64'));

function builder(id, family, variant, recommendedHeightToWidth) {
  const positions = [], normals = [], colors = [], parts = [];
  const append = (geometry, name, type, color, role = 'structure', perFace = null, surface = null) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    const materialIndex=surface??(/glazing|curtain-glass|skylight/.test(name)?1:/mullion|metal-fin/.test(name)?2:0);
    const start = positions.length / 9;
    source.computeBoundingBox();
    const bounds = {min: source.boundingBox.min.toArray().map(rounded), max: source.boundingBox.max.toArray().map(rounded)};
    for (let i = 0; i < source.attributes.position.count; i++) {
      const normal = new THREE.Vector3().fromBufferAttribute(source.attributes.normal, i);
      const chosen = perFace?.(normal) ?? color;
      const c = new THREE.Color(chosen);
      if (COMPOUNDS[id] && !['shared-space','ground-plinth'].includes(role)) {
        const grey = c.r*.2126+c.g*.7152+c.b*.0722;
        c.lerp(new THREE.Color().setRGB(grey,grey,grey), materialIndex===1 ? .38 : .65);
      }
      for (const value of new THREE.Vector3().fromBufferAttribute(source.attributes.position, i).toArray()) positions.push(rounded(value));
      for (const value of normal.toArray()) normals.push(rounded(value));
      for (const value of c.toArray()) colors.push(rounded(value));
    }
    parts.push({name, type, role, materialIndex, triangleStart: start, triangleCount: positions.length / 9 - start, bounds});
    source.dispose();
  };
  const box = (name, width, depth, bottom, top, x = 0, z = 0, color = P.white, role = 'structure', perFace = null, surface = null) => {
    if (!(top > bottom && width > 0 && depth > 0)) throw new Error(id + ': invalid box');
    const g = new THREE.BoxGeometry(width, top - bottom, depth);
    g.translate(x, (bottom + top) / 2, z);
    append(g, name, 'box', color, role, perFace, surface);
  };
  const panel = (name, width, bottom, top, x, faceZ, color = P.glass) => box(name, width, 0.003, bottom, top, x, faceZ, color, 'attached-facade');
  const base = (height = 0.012) => box('continuous-ground-plinth', 1, 1, 0, height, 0, 0, P.plinth, 'ground-plinth', facePalette('#8c9289', '#777e75', '#a0a69a'));
  const roof = (name, w, d, bottom, top, x = 0, z = 0, color = P.roof) => box(name, w, d, bottom, top, x, z, color, 'supported-roof', facePalette('#818b8c', '#657375', color));
  const gable = (name, x, z, w, d, bottom, top, color = P.roof, alternate = color) => {
    const v = [[x-w/2,bottom,z-d/2],[x+w/2,bottom,z-d/2],[x+w/2,bottom,z+d/2],[x-w/2,bottom,z+d/2],[x,top,z-d/2],[x,top,z+d/2]];
    const faces = [[0,1,2],[0,2,3],[0,4,1],[3,2,5],[0,3,5],[0,5,4],[1,4,5],[1,5,2]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(face => face.flatMap(i => v[i])), 3));
    g.computeVertexNormals(); append(g, name, 'closed-gable-prism', color, 'supported-roof', normal => normal.x > .1 ? alternate : color);
  };
  const prism=(name,outline,bottom,top,color=P.white,role='structure',surface=0)=>{
    const shape=new THREE.Shape(outline.map(([x,z])=>new THREE.Vector2(x,-z)));
    const g=new THREE.ExtrudeGeometry(shape,{depth:top-bottom,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,bottom,0);append(g,name,'closed-extrusion',color,role,null,surface);
  };
  const finish = (role = 'ordinary-building') => {
    // Pack each material into a single contiguous draw range, retaining exact
    // authored part ranges for closure, principal-solid and support checks.
    const old={positions:positions.slice(),normals:normals.slice(),colors:colors.slice()};positions.length=normals.length=colors.length=0;
    parts.sort((a,b)=>a.materialIndex-b.materialIndex);
    for(const part of parts){const start=part.triangleStart*9,end=start+part.triangleCount*9;part.triangleStart=positions.length/9;positions.push(...old.positions.slice(start,end));normals.push(...old.normals.slice(start,end));colors.push(...old.colors.slice(start,end));}

    const geometry = new THREE.BufferGeometry();
    geometry.name = id; geometry.uuid = uuidFor(id);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if(role==='ordinary-building')for(const slot of[0,1,2]){const rows=parts.filter(p=>p.materialIndex===slot);if(rows.length)geometry.addGroup(rows[0].triangleStart*3,rows.reduce((n,p)=>n+p.triangleCount*3,0),slot);}
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const json = geometry.toJSON();
    for (const attribute of Object.values(json.data.attributes)) attribute.array = attribute.array.map(rounded);
    const primaryPart=parts.find(part=>part.name==='primary-building-body');
    let primaryBody=null;
    if(primaryPart){
      const box=new THREE.Box3();
      for(let i=primaryPart.triangleStart*3;i<(primaryPart.triangleStart+primaryPart.triangleCount)*3;i++)box.expandByPoint(new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i));
      const size=box.getSize(new THREE.Vector3());
      primaryBody={partName:primaryPart.name,triangleStart:primaryPart.triangleStart,triangleCount:primaryPart.triangleCount,bounds:{min:box.min.toArray(),max:box.max.toArray()},width:size.x,depth:size.z,height:size.y};
    }
    const asset = {schema: 'city-kit-geometry-v1', version: VERSION, id, name: NAMES[id], role, family, variant,
      notice: NOTICE, ...(COMPOUNDS[id] ? {displayUnit:'compound',buildingCount:COMPOUNDS[id].buildingCount,sharedSpace:COMPOUNDS[id].sharedSpace,previewHeightToWidth:COMPOUNDS[id].previewHeight,primaryHeightToWidth:COMPOUNDS[id].primaryHeight,maxPrimarySlenderness:COMPOUNDS[id].slenderness,primaryBody} : {}), recommendedHeightToWidth, recommendedDepthToWidth: DEPTH_PROFILES[id] ?? null, colorSpace: 'linear-srgb vertex colors; grouped wall/glass/metal materials for buildings; no building instance tint',
      bounds: {min: geometry.boundingBox.min.toArray().map(rounded), max: geometry.boundingBox.max.toArray().map(rounded)},
      triangles: positions.length / 9, parts, materialSlots:role==='ordinary-building'?['masonry','glazing','aluminium']:['solid'], geometry: json};
    validateCityAsset(asset);
    return {asset, geometry};
  };
  return {id, append, box, panel, base, roof, gable, prism, finish};
}

// Architectural families differ in plan, roof silhouette and facade rhythm.
// They remain reusable display archetypes, never surveyed city buildings.
const rect=(w,d,x=0,z=0)=>[[-w/2+x,-d/2+z],[w/2+x,-d/2+z],[w/2+x,d/2+z],[-w/2+x,d/2+z]];
const chamfer=(w,d,c=.09)=>[[-w/2+c,-d/2],[w/2-c,-d/2],[w/2,-d/2+c],[w/2,d/2-c],[w/2-c,d/2],[-w/2+c,d/2],[-w/2,d/2-c],[-w/2,-d/2+c]];
function wallPiece(b,name,a,c,bottom,top,width,color,role='attached-facade',slot=0,along=0,depth=.003){
 const dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz),g=new THREE.BoxGeometry(width,top-bottom,depth);
 g.rotateY(-Math.atan2(dz,dx));g.translate((a[0]+c[0])/2+dx/len*along+dz/len*.0011,(bottom+top)/2,(a[1]+c[1])/2+dz/len*along-dx/len*.0011);
 b.append(g,name,'box',color,role,null,slot);
}
function facade(b,name,outline,bottom,top,{mode='curtain',floors=12,columns=4,glass='#a2b5bf',wall='#d4d7d4'}={}){
 const height=top-bottom;
 for(let e=0;e<outline.length;e++){
  const a=outline[e],c=outline[(e+1)%outline.length],len=Math.hypot(c[0]-a[0],c[1]-a[1]);if(len<.075)continue;
  const cols=Math.max(1,Math.round(columns*len/.9));
  if(mode==='curtain'){
   wallPiece(b,`${name}-curtain-glass-${e}`,a,c,bottom+.007,top-.006,len-.007,glass,'attached-facade',1);
   for(let col=1;col<cols;col++)wallPiece(b,`${name}-metal-fin-${e}-${col}`,a,c,bottom+.006,top-.003,.003,'#bfccd1','attached-facade',2,(col/cols-.5)*len,.008);
   for(let row=1;row<floors&&len>.30;row++){
    const y=bottom+height*row/floors;
    wallPiece(b,`${name}-metal-spandrel-${e}-${row}`,a,c,y,y+.003,len-.004,'#9baeb6','attached-facade',2,0,.006);
   }
  }else{
   // Vertical glass bays crossed by real solid spandrels form discrete windows.
   for(let col=0;col<cols;col++)wallPiece(b,`${name}-glazing-bay-${e}-${col}`,a,c,bottom+.012,top-.01,len/cols*.50,glass,'attached-facade',1,((col+.5)/cols-.5)*len);
   for(let row=1;row<floors&&len>.30;row++){
    const y=bottom+height*row/floors;
    wallPiece(b,`${name}-solid-spandrel-${e}-${row}`,a,c,y,y+height/floors*.29,len-.004,wall,'attached-facade',0,0,.008);
   }
  }
 }
}
function roofCap(b,name,outline,y,color='#bac2c2'){
 b.prism(name,outline,y,Math.min(1,y+.012),color,'supported-roof');
}
function groundPatch(b,name,w,d,x,z,color=P.garden){b.box(name,w,d,.012,.017,x,z,color,'shared-space',facePalette('#7f8d7d','#697b6a',color));}
const models=[];
{
 const id='residential-slab',b=builder(id,'residential','slab',COMPOUNDS[id].height);b.base();
 const plan=rect(.94,.73,0,-.055);b.prism('primary-building-body',plan,.012,.94,'#dcded8');
 facade(b,'residential-window',plan,.04,.928,{mode:'punched',floors:11,columns:6,glass:'#8599a2',wall:'#dde0db'});
 for(const x of[-.33,-.11,.11,.33])for(let k=1;k<7;k++){
  const y=.05+k*.122;b.box(`supported-balcony-slab-${x}-${k}`,.166,.048,y,y+.009,x,.323,'#d0d7d6','attached-facade');
  b.box(`balcony-glazing-${x}-${k}`,.166,.003,y+.009,y+.027,x,.345,'#91adb6','attached-facade',null,1);
 }
 roofCap(b,'white-roof-edge',plan,.94,'#dadeda');
 b.box('supported-stair-core-west',.16,.22,.952,1,-.29,-.09,'#bac2c2','supported-roof');
 b.box('supported-stair-core-east',.16,.22,.952,1,.29,-.09,'#bac2c2','supported-roof');
 groundPatch(b,'front-residential-garden',.83,.064,0,.448);models.push(b.finish());
}
{
 const id='residential-twins',b=builder(id,'residential','twins',COMPOUNDS[id].height);b.base();
 const plan=rect(.91,.86,0,-.025);b.prism('primary-building-body',plan,.012,.73,'#d8dad3');
 facade(b,'apartment-base',plan,.03,.716,{mode:'punched',floors:8,columns:4,glass:'#8198a3',wall:'#d8dad3'});roofCap(b,'lower-terrace',plan,.73);
 const upper=rect(.65,.66,-.085,-.09);b.prism('supported-apartment-upper',upper,.742,.96,'#d8dad3','supported-roof');facade(b,'apartment-upper',upper,.746,.946,{mode:'punched',floors:3,columns:3,glass:'#95aeb7',wall:'#d8dad3'});roofCap(b,'upper-terrace',upper,.96);
 b.box('supported-roof-room',.25,.30,.972,1,-.07,-.14,'#b5c1c4','supported-roof');groundPatch(b,'east-garden',.027,.78,.477,0);models.push(b.finish());
}
{
 const id='commercial-office',b=builder(id,'commercial','office',COMPOUNDS[id].height);b.base();
 const podium=rect(.96,.94);b.prism('integrated-retail-podium',podium,.012,.085,'#d3d7d4');facade(b,'podium',podium,.025,.078,{floors:1,columns:4,glass:'#8b9fa9'});
 const plan=chamfer(.88,.84,.115);b.prism('primary-building-body',plan,.085,.977,'#a2b6c1','structure',1);
 // Floor lines and vertical aluminium fins wrap the cut-corner glass envelope.
 facade(b,'office-envelope',plan,.089,.967,{floors:15,columns:6,glass:'#9ab3c0'});roofCap(b,'chamfered-metal-crown',plan,.977,'#ccd4d6');
 b.prism('supported-crown-inset',chamfer(.67,.63,.08),.989,1,'#889ea9','supported-roof');models.push(b.finish());
}
{
 const id='commercial-block',b=builder(id,'commercial','block',COMPOUNDS[id].height);b.base();
 const plan=rect(.95,.92);b.prism('primary-building-body',plan,.012,.59,'#d7d9d5');
 facade(b,'retail-streetwall',plan,.035,.575,{floors:6,columns:7,glass:'#a8bac2'});roofCap(b,'retail-roof-terrace',plan,.59,'#c2c8c1');
 const mid=rect(.73,.72,-.06,-.07);b.prism('supported-second-tier',mid,.602,.824,'#adbfc7','supported-roof',1);facade(b,'second-tier',mid,.61,.817,{floors:4,columns:5,glass:'#adc1c8'});roofCap(b,'second-roof-terrace',mid,.824);
 const upper=rect(.51,.51,-.13,-.13);b.prism('supported-third-tier',upper,.836,.988,'#bdcbd1','supported-roof',1);facade(b,'third-tier',upper,.842,.981,{floors:3,columns:4,glass:'#acbec6'});roofCap(b,'third-roof-terrace',upper,.988);
 models.push(b.finish());
}
{
 const id='industrial-sheds',b=builder(id,'industrial','sheds',COMPOUNDS[id].height);b.base();
 b.box('primary-building-body',.92,.88,.012,.83,0,-.025,'#d6dad8','structure',facePalette('#d9dfdc','#aebdc4','#b7c4c8'));
 for(let k=0;k<3;k++)b.gable(`supported-sawtooth-roof-${k}`,(k-1)*.306,-.025,.306,.888,.83,1,'#bbc9ce','#95aeb9');
 facade(b,'clerestory',rect(.92,.88,0,-.025),.57,.78,{mode:'punched',floors:2,columns:7,glass:'#8aa5b0',wall:'#d6dad8'});
 for(const x of[-.33,-.165,0,.165,.33])b.panel(`loading-bay-${x}`,.105,.025,.34,x,.416,'#91a2ab');
 groundPatch(b,'delivery-apron',.92,.055,0,.458,'#b7c1be');models.push(b.finish());
}
{
 const id='industrial-logistics',b=builder(id,'industrial','logistics',COMPOUNDS[id].height);b.base();
 b.box('primary-building-body',.92,.90,.012,.94,0,-.025,'#d9e1e1','structure',facePalette('#d6e1e5','#b0c0c8','#dee5e4'));
 b.box('supported-flat-roof',.93,.91,.94,.97,0,-.025,'#d5dedc','supported-roof');
 for(const x of[-.28,0,.28])b.box(`roof-skylight-${x}`,.11,.70,.97,1,x,-.025,'#8eabb8','supported-roof',null,1);
 facade(b,'warehouse-ribbon',rect(.92,.90,0,-.025),.62,.78,{floors:1,columns:5,glass:'#a5b8c0'});
 for(const x of[-.34,-.17,0,.17,.34])b.panel(`loading-bay-${x}`,.11,.02,.40,x,.426,'#839ba8');models.push(b.finish());
}
{
 const id='generic-courtyard',b=builder(id,'generic','courtyard',COMPOUNDS[id].height);b.base();
 const plan=[[-.47,-.44],[.47,-.44],[.47,.44],[.22,.44],[.22,-.10],[-.22,-.10],[-.22,.44],[-.47,.44]];
 b.prism('primary-building-body',plan,.012,.946,'#dddcd3');facade(b,'courtyard-colonnade',plan,.035,.926,{mode:'punched',floors:8,columns:5,glass:'#829da9',wall:'#dedfd8'});roofCap(b,'continuous-U-roof',plan,.946,'#c0c7c5');
 b.box('supported-roof-service',.22,.16,.958,1,-.20,-.29,'#b3bdbe','supported-roof');groundPatch(b,'courtyard-garden',.38,.37,0,.16);models.push(b.finish());
}
{
 const id='generic-stepped',b=builder(id,'generic','stepped',COMPOUNDS[id].height);b.base();
 const plan=[[-.47,-.44],[.47,-.44],[.47,-.08],[.09,-.08],[.09,.44],[-.47,.44]];
 b.prism('primary-building-body',plan,.012,.80,'#d3d8d5');facade(b,'corner-windows',plan,.04,.784,{mode:'punched',floors:9,columns:4,glass:'#8da6b1',wall:'#d3d8d5'});roofCap(b,'corner-lower-terrace',plan,.80,'#bdc9c5');
 const top=rect(.49,.69,-.19,-.05);b.prism('supported-corner-upper',top,.812,.988,'#9bb2bd','supported-roof',1);facade(b,'corner-upper',top,.82,.981,{floors:3,columns:4,glass:'#a4bac3'});roofCap(b,'corner-upper-roof',top,.988);
 groundPatch(b,'sunken-corner-garden',.29,.40,.295,.225);models.push(b.finish());
}
{
 const id='generic-ribbon',b=builder(id,'generic','ribbon',COMPOUNDS[id].height);b.base();
 const plan=chamfer(.94,.80,.07);b.prism('primary-building-body',plan,.012,.964,'#b3c3cb','structure',1);facade(b,'horizontal-office',plan,.035,.95,{floors:12,columns:2,glass:'#aebfc7'});
 for(let row=1;row<6;row++)roofCap(b,`continuous-stone-ribbon-${row}`,chamfer(.948,.808,.07),row*.153,'#d9dfdd');
 roofCap(b,'setback-roof',plan,.964,'#c6d0d1');b.box('supported-roof-service',.26,.23,.976,1,0,-.06,'#9cafb7','supported-roof');groundPatch(b,'front-plaza',.75,.035,0,.46,P.paving);models.push(b.finish());
}
{
 const id='generic-point',b=builder(id,'generic','point',COMPOUNDS[id].height);b.base();
 const plan=chamfer(.86,.86,.10);b.prism('primary-building-body',plan,.012,.954,'#dfe3dc');
 facade(b,'vertical-apartment',plan,.038,.938,{mode:'punched',floors:13,columns:3,glass:'#94adb7',wall:'#dfe3dc'});roofCap(b,'point-tower-parapet',plan,.954,'#c9d1cf');
 b.prism('supported-point-crown',chamfer(.61,.61,.10),.966,1,'#bac7cb','supported-roof');groundPatch(b,'tower-entry-garden',.73,.035,0,.466);models.push(b.finish());
}

{
 const id='residential-gallery',b=builder(id,'residential','gallery',COMPOUNDS[id].height);b.base();
 const plan=rect(.88,.77,0,-.035);b.prism('primary-building-body',plan,.012,.946,'#cbd5d6');facade(b,'balcony-glass-envelope',plan,.036,.93,{floors:10,columns:3,glass:'#9bafb7'});
 for(let k=1;k<9;k++)b.prism(`supported-balcony-edge-${k}`,rect(.945,.82,0,-.035),k*.105,k*.105+.013,'#d6dcd8','attached-facade');
 roofCap(b,'gallery-roof',plan,.946,'#c5cecd');b.box('supported-roof-core',.18,.34,.958,1,-.23,-.11,'#b5c3c7','supported-roof');groundPatch(b,'apartment-front-garden',.76,.045,0,.454);models.push(b.finish());
}
{
 const id='residential-point',b=builder(id,'residential','point',COMPOUNDS[id].height);b.base();
 const plan=[[-.20,-.44],[.20,-.44],[.20,-.20],[.44,-.20],[.44,.20],[.20,.20],[.20,.44],[-.20,.44],[-.20,.20],[-.44,.20],[-.44,-.20],[-.20,-.20]];
 b.prism('primary-building-body',plan,.012,.958,'#d2d9d8');facade(b,'winged-apartment-windows',plan,.034,.946,{mode:'punched',floors:12,columns:5,glass:'#8fa7b3',wall:'#d2d9d8'});roofCap(b,'winged-roof-parapet',plan,.958,'#c2cdce');b.box('supported-central-roof-core',.27,.27,.970,1,0,0,'#a9bec7','supported-roof');groundPatch(b,'entry-garden-corner',.12,.13,.32,.34);models.push(b.finish());
}

// Tree component centres intentionally remain at the origin for the existing
// crown/terrain footprint checks. White vertices accept per-tree palette colours.
for (const [id, variant, scale] of [['tree-broad-crown','broadCrown',[.98,.94,.98]],['tree-upright-crown','uprightCrown',[.87,.99,.87]]]) {
  const b = builder(id, 'tree', variant, null), sphere = new THREE.SphereGeometry(1,16,10);
  const a = sphere.attributes.position;
  for (let i=0;i<a.count;i++) {
    const x=a.getX(i),y=a.getY(i),z=a.getZ(i),phi=Math.atan2(z,x);
    const radial=.97+.025*Math.sin(phi*4+.7)*Math.max(0,1-y*y)+.005*Math.cos(y*5);
    a.setXYZ(i,x*scale[0]*radial,y*scale[1]*radial,z*scale[2]*radial);
  }
  sphere.computeVertexNormals(); b.append(sphere,'closed-leaf-crown','closed-sphere', '#ffffff','crown'); models.push(b.finish('tree-component'));
}
{
  const b = builder('tree-trunk','tree','trunk',null);
  b.append(new THREE.CylinderGeometry(1,1,1,6,1,false),'closed-trunk','closed-cylinder','#ffffff','trunk');
  models.push(b.finish('tree-component'));
}
{
  const b=builder('road-deck','road','deck',null);
  b.box('closed-unit-road-deck',1,1,0,1,0,0,'#53646b','road-component');models.push(b.finish('road-component'));
}
{
  const b=builder('bridge-pier','road','pier',null);
  b.box('closed-unit-bridge-pier',1,1,0,1,0,0,'#b2a488','road-component');models.push(b.finish('road-component'));
}

// Check each authored component's actual triangles form a closed, outward mesh.
function validateClosedParts(asset) {
  const array=asset.geometry.data.attributes.position.array;
  const key=p=>p.map(n=>Math.round(n*1e5)).join(',');
  for (const part of asset.parts) {
    const edges=new Map();let volume=0;
    for(let triangle=part.triangleStart;triangle<part.triangleStart+part.triangleCount;triangle++){
      const p=[0,1,2].map(i=>array.slice(triangle*9+i*3,triangle*9+i*3+3));
      const a=new THREE.Vector3(...p[0]),b=new THREE.Vector3(...p[1]),c=new THREE.Vector3(...p[2]);
      if(b.clone().sub(a).cross(c.clone().sub(a)).length()<1e-10)throw Error(asset.id+': degenerate '+part.name);
      volume+=a.dot(b.clone().cross(c))/6;
      for(const [i,j]of[[0,1],[1,2],[2,0]]){const a=key(p[i]),b=key(p[j]),k=[a,b].sort().join('|'),e=edges.get(k)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(k,e);}
    }
    if([...edges.values()].some(([count,direction])=>count!==2||direction!==0)||!(volume>0))throw Error(asset.id+': non-closed or inward '+part.name);
  }
}

// Reject an invalid kit before replacing any existing versioned output file.
for(const {asset} of models) validateClosedParts(asset);
const plannedBuildingBytes=models.filter(({asset})=>asset.role==='ordinary-building').reduce((sum,{asset})=>sum+Buffer.byteLength(JSON.stringify(asset)+'\n'),0);
if(plannedBuildingBytes>=2400000)throw Error(`Building JSON budget exceeded before output: ${plannedBuildingBytes}`);
await fs.mkdir(OUT,{recursive:true});
const manifest={schema:'city-kit-manifest-v1',version:VERSION,notice:NOTICE,
  source:{generator:'scripts/build-city-assets.mjs',sha256:digest(await fs.readFile(fileURLToPath(import.meta.url))),threeRevision:THREE.REVISION},
  normalizedBuildings:{min:[-.5,0,-.5],max:[.5,1,.5],support:'continuous closed full-footprint base',instanceTint:false},
  roadProfile:{roadColor:'#53646b',sideColor:'#b4b4a7',curbColor:'#e3d7b4',pierColor:'#b2a488',widthRatios:{motorway:1,trunk:.84,primary:.62},
    notice:'Style and primitive components only; source road routes, bridge tags and dimensions are supplied by each city.'},assets:[],presets:[]};
const exporter=new GLTFExporter(),buildingMaterials=createCityAssetMaterials(),material=new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.85});
for(const {asset,geometry}of models){
  const json=JSON.stringify(asset)+'\n',file=asset.id+'.json',glbFile=asset.id+'.glb';
  const object=new THREE.Mesh(geometry,asset.role==='ordinary-building'?buildingMaterials:material);object.name=asset.id;object.userData={cityAssetId:asset.id,role:asset.role,notice:NOTICE};
  const glb=Buffer.from(await exporter.parseAsync(object,{binary:true,onlyVisible:true}));
  if(glb.readUInt32LE(0)!==0x46546c67||glb.readUInt32LE(4)!==2||glb.readUInt32LE(8)!==glb.length)throw Error(asset.id+': invalid GLB header');
  await fs.writeFile(path.join(OUT,file),json);await fs.writeFile(path.join(OUT,glbFile),glb);
  manifest.assets.push({id:asset.id,name:asset.name,family:asset.family,variant:asset.variant,role:asset.role,file,bytes:Buffer.byteLength(json),sha256:digest(json),triangles:asset.triangles,bounds:asset.bounds,...(asset.displayUnit?{displayUnit:asset.displayUnit,buildingCount:asset.buildingCount,sharedSpace:asset.sharedSpace,previewHeightToWidth:asset.previewHeightToWidth,primaryHeightToWidth:asset.primaryHeightToWidth,maxPrimarySlenderness:asset.maxPrimarySlenderness,primaryBody:asset.primaryBody}:{}),recommendedHeightToWidth:asset.recommendedHeightToWidth,recommendedDepthToWidth:asset.recommendedDepthToWidth,
    glb:{file:glbFile,bytes:glb.length,sha256:digest(glb)}});
  geometry.dispose();
}
material.dispose();for(const m of buildingMaterials)m.dispose();
// Portable whole-tree downloads use the same fixed components as runtime.
for (const [id, crownId, crownScale, crownY] of [
  ['tree-broad','tree-broad-crown',[.55,.60,.55],1.10],
  ['tree-upright','tree-upright-crown',[.48,.72,.48],1.22],
]) {
  const group=new THREE.Group();group.name=id;
  const recipe=[{asset:'tree-trunk',position:[0,.325,0],scale:[.06,.65,.06],color:'#776347'},
    {asset:crownId,position:[0,crownY,0],scale:crownScale,color:'#3d7950'}];
  const owned=[];
  for(const part of recipe){const geometry=new THREE.BufferGeometryLoader().parse(models.find(m=>m.asset.id===part.asset).asset.geometry);
    const material=new THREE.MeshStandardMaterial({color:part.color,vertexColors:true,roughness:.86});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=part.asset;mesh.position.fromArray(part.position);mesh.scale.fromArray(part.scale);group.add(mesh);owned.push([geometry,material]);}
  const bytes=Buffer.from(await exporter.parseAsync(group,{binary:true})),file=id+'.glb';await fs.writeFile(path.join(OUT,file),bytes);
  manifest.presets.push({id,name:id==='tree-broad'?'阔叶整树':'直立整树',family:'tree',recipe,glb:{file,bytes:bytes.length,sha256:digest(bytes)}});
  for(const [geometry,material]of owned){geometry.dispose();material.dispose();}
}
const buildingBytes=manifest.assets.filter(a=>a.role==='ordinary-building').reduce((sum,a)=>sum+a.bytes,0);
if(buildingBytes>=2400000)throw Error(`Building JSON budget exceeded: ${buildingBytes}`);
manifest.budgets={buildingAssets:12,buildingJsonBytes:buildingBytes,totalJsonBytes:manifest.assets.reduce((sum,a)=>sum+a.bytes,0),maximumTriangles:Math.max(...manifest.assets.map(a=>a.triangles))};
await fs.writeFile(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({version:VERSION,...manifest.budgets,assets:manifest.assets.map(a=>({id:a.id,triangles:a.triangles,bytes:a.bytes,glbBytes:a.glb.bytes}))},null,2));
