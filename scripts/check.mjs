import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cities,attractions} from '../src/catalog.js';
import {provinceBounds,containsCoordinate} from '../src/geographic-bounds.js';
import {cityAirportRegistry} from '../src/city-airports.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const geo=JSON.parse(fs.readFileSync(path.join(root,'data/china-provinces.geojson'),'utf8'));
const ids=new Set(geo.features.map(f=>f.properties.id));
assert.equal(ids.size,geo.features.length,'Province IDs must be unique');
for(const feature of geo.features){
  assert.ok(feature.properties.name&&feature.properties.id,'Province metadata missing');
  assert.ok(['Polygon','MultiPolygon'].includes(feature.geometry.type),'Unsupported geometry');
  const polys=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  const bounds=provinceBounds(feature);
  assert.ok(bounds.flat().every(Number.isFinite),'Province must have finite map bounds');
  assert.ok(bounds[1][0]>bounds[0][0]&&bounds[1][1]>bounds[0][1],'Province must have nonzero map extent');
  for(const rings of polys)for(const ring of rings){
    assert.ok(ring.length>=4,'Ring too short');
    assert.deepEqual(ring[0],ring.at(-1),'Ring must close');
    for(const point of ring)assert.ok(point.length===2&&point.every(Number.isFinite),'Coordinate must be finite');
  }
}
const anchors=JSON.parse(fs.readFileSync(path.join(root,'data/hong-kong-landmarks.json'),'utf8'));
assert.equal(anchors.length,10,'Hong Kong must have ten geographic anchors');
assert.equal(new Set(anchors.map(a=>a.id)).size,10,'Duplicate landmark anchor');
for(const anchor of anchors){
  assert.ok(attractions[anchor.id]?.city==='hong-kong','Anchor must reference a Hong Kong scene');
  assert.deepEqual(anchor.coordinates,attractions[anchor.id].coordinates,'Scene and map coordinates must agree');
  assert.ok(anchor.coordinates.length===2&&anchor.coordinates.every(Number.isFinite),'Invalid landmark coordinates');
  assert.ok(anchor.anchor&&anchor.sourceUrl&&anchor.coordinateSourceUrl,'Anchor provenance missing');
}
const polygon={type:'Polygon',coordinates:[[[0,0],[5,0],[5,5],[0,5],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]]};
assert.equal(containsCoordinate(polygon,[3,3]),true,'Province interior should be selectable');
assert.equal(containsCoordinate(polygon,[1.5,1.5]),false,'Polygon holes must not claim a city');
assert.equal(containsCoordinate(polygon,[6,3]),false,'Outside city must not be selected');
assert.equal(new Set(cities.map(c=>c.id)).size,cities.length,'Duplicate city');
for(const city of cities){assert.ok(ids.has(city.province),'Unknown province');for(const id of city.attractions){assert.ok(attractions[id],'Unknown attraction');assert.equal(attractions[id].city,city.id);}}
for(const city of cities){
  const entry=cityAirportRegistry[city.id];assert.ok(entry,'Curated city must declare airport coverage: '+city.id);
  assert.ok(['inside','external'].includes(entry.status),'Airport coverage must be verified: '+city.id);
  assert.ok(entry.files.length,'Airport coverage needs a source file: '+city.id);
  for(const file of entry.files){const airport=JSON.parse(fs.readFileSync(path.join(root,'data/airports',file+'.json'),'utf8'));assert.ok(airport.id&&airport.name&&airport.coordinates?.every(Number.isFinite),'Invalid airport metadata');assert.ok(airport.runways.length&&airport.terminals.length,'Airport requires source runway and terminal geometry');}
}
for(const [id,a]of Object.entries(attractions)){assert.equal(a.id,id);assert.ok(cities.some(c=>c.id===a.city));if(a.overviewOnly)assert.equal(a.city,'hangzhou');else assert.equal(typeof a.create,'function');assert.ok(fs.existsSync(path.join(root,a.source)),'Missing landmark source note');}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(path.join(root,'src')).filter(f=>f.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
for(const file of ['vendor/three.module.js','vendor/three.core.js','vendor/addons/controls/OrbitControls.js','vendor/addons/exporters/GLTFExporter.js','vendor/THREE-LICENSE.txt','vendor/NOTO-OFL.txt','vendor/maplibre-gl.js','vendor/maplibre-gl.css','vendor/MAPLIBRE-LICENSE.txt','data/geographic-style.json','src/terrain-quality.js','index.html','style.css','fonts.css','LICENSE'])assert.ok(fs.existsSync(path.join(root,file)),`Missing package asset ${file}`);
for(const file of ['src/regional-viewer.js','src/region-terrain.js','src/region-vectors.js','src/region-projection.js','src/region-boundaries.js','regions.css','docs/regions.md','vendor/polygon-clipping.js','vendor/POLYGON-CLIPPING-LICENSE.txt','vendor/vector-tile.js','vendor/VECTOR-TILE-LICENSE.txt','vendor/pbf.js','vendor/PBF-LICENSE.txt','vendor/point-geometry.js','vendor/POINT-GEOMETRY-LICENSE.txt','vendor/VECTOR-SOURCES.json'])assert.ok(fs.existsSync(path.join(root,file)),`Missing regional asset ${file}`);
let regionCount=0;
for(const manifestPath of ['data/regions/index.json','data/regions/prefectures/index.json']){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,manifestPath),'utf8'));
  for(const entry of manifest.regions){
    const bytes=fs.readFileSync(path.resolve(root,entry.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,`Region checksum: ${entry.id}`);
    const feature=JSON.parse(bytes);assert.equal(feature.properties.id,entry.id);
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    for(const rings of polygons)for(const ring of rings){assert.ok(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));assert.ok(ring.every(p=>p.length===2&&p.every(Number.isFinite)));}
    if(entry.id==='hong-kong')for(const anchor of anchors)assert.ok(containsCoordinate(feature,anchor.coordinates),`HK anchor outside: ${anchor.id}`);
    regionCount++;
  }
}
// Geographic exemplar assets must retain their recorded source bytes.
const districtBytes=fs.readFileSync(path.join(root,'data/regions/zhejiang-cities.geojson'));
const districtProvenance=JSON.parse(fs.readFileSync(path.join(root,'data/regions/zhejiang-cities.provenance.json'),'utf8'));
assert.equal(createHash('sha256').update(districtBytes).digest('hex'),districtProvenance.sha256,'Zhejiang city source checksum');
const districtFeatures=JSON.parse(districtBytes).features;
assert.equal(districtFeatures.length,11,'Zhejiang needs eleven city areas');
assert.equal(new Set(districtFeatures.map(f=>f.properties.id)).size,11,'Duplicate Zhejiang city area');
const displayBytes=fs.readFileSync(path.join(root,'data/regions/zhejiang-display.geojson'));
const displayProvenance=JSON.parse(fs.readFileSync(path.join(root,'data/regions/zhejiang-display.provenance.json'),'utf8'));
assert.equal(createHash('sha256').update(displayBytes).digest('hex'),displayProvenance.displaySha256,'Zhejiang display outline checksum');
assert.equal(createHash('sha256').update(districtBytes).digest('hex'),displayProvenance.cityCollectionSha256,'Display and city data must share provenance');
const display=JSON.parse(displayBytes);
assert.equal(display.properties.id,'zhejiang');assert.equal(display.properties.boundaryRole,'prefecture-union-display-outline');
for(const coordinate of [[121.1,30.5],[120.896,27.986]])assert.equal(containsCoordinate(display,coordinate),false,'No exterior sea backdrop');
for(const coordinate of [[120.142,30.244],[118.96,29.61]])assert.equal(containsCoordinate(display,coordinate),true,'Inland water remains inside display');
const leifengDir=path.join(root,'data/scenes/leifeng');
const leifengMetadata=JSON.parse(fs.readFileSync(path.join(leifengDir,'metadata.json'),'utf8'));
assert.deepEqual(attractions.leifeng.coordinates,leifengMetadata.coordinates,'Tower anchor must agree across scales');
for(const entry of [...leifengMetadata.sourceFiles,...leifengMetadata.generatedFiles]){
  const bytes=fs.readFileSync(path.join(leifengDir,entry.file));
  assert.equal(bytes.length,entry.bytes,'Leifeng asset size: '+entry.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,'Leifeng source checksum: '+entry.file);
}
const model=fs.readFileSync(path.join(leifengDir,'scene.glb'));
assert.equal(model.toString('ascii',0,4),'glTF');assert.equal(model.readUInt32LE(4),2);assert.equal(model.readUInt32LE(8),model.length);
for(const file of ['src/province-districts.js','src/terrain-style.js','src/city-abstraction.js','src/scenes/leifeng-real.js','vendor/addons/loaders/GLTFLoader.js','data/scenes/leifeng/NOTICE.md','docs/leifeng-real-sources.md','docs/zhejiang-city-districts.md'])assert.ok(fs.existsSync(path.join(root,file)),`Missing exemplar asset ${file}`);
for(const file of ['src/hangzhou-sandtable.js','src/hangzhou-display-projection.js','src/hangzhou-surface.js','src/hangzhou-fabric.js','src/hangzhou-landmarks.js','src/hangzhou-catalog.js','data/hangzhou-atlas/scene-data.json','data/hangzhou-atlas/terrain-mesh.json','data/hangzhou-atlas/NOTICE.md','data/hangzhou-atlas/landmark-models.md'])assert.ok(fs.existsSync(path.join(root,file)),`Missing Hangzhou atlas asset ${file}`);
for(const file of ['src/airport-model.js','src/city-airports.js','data/airports/NOTICE.md'])assert.ok(fs.existsSync(path.join(root,file)),`Missing airport asset ${file}`);
for(const file of ['src/hangzhou-shoreline.js','src/hangzhou-footprint-guard.js','data/hangzhou-atlas/source-classifications.json','scripts/build-hangzhou-classifications.py'])assert.ok(fs.existsSync(path.join(root,file)),`Missing refinement asset ${file}`);
const classes=JSON.parse(fs.readFileSync(path.join(root,'data/hangzhou-atlas/source-classifications.json'),'utf8'));
assert.equal(classes.crs,'EPSG:4326');assert.ok(classes.urban.length>0&&classes.sources.files.length>0,'Source land-use classes need provenance');
for(const area of classes.urban){assert.ok(area.class&&area.rings.length);for(const ring of area.rings){assert.deepEqual(ring[0],ring.at(-1));assert.ok(ring.every(p=>p.length===2&&p.every(Number.isFinite)));}}
for(const file of ['src/hangzhou-signature-buildings.js','src/hangzhou-signature-layer.js','data/hangzhou-atlas/signature-buildings.json','data/hangzhou-atlas/signature-buildings-NOTICE.md'])assert.ok(fs.existsSync(path.join(root,file)),`Missing signature-building asset ${file}`);
const signatures=JSON.parse(fs.readFileSync(path.join(root,'data/hangzhou-atlas/signature-buildings.json'),'utf8'));
assert.equal(signatures.crs,'EPSG:4326');assert.equal(signatures.buildings.length,8);assert.equal(new Set(signatures.buildings.map(b=>b.id)).size,8);
for(const b of signatures.buildings){assert.ok(b.name&&b.shape?.type&&b.coordinates.length===2&&b.coordinates.every(Number.isFinite)&&b.footprint&&b.officialUrl&&b.mapSourceUrl,`Signature source contract: ${b.id}`);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.ok(html.includes('25b3ef8c'),'Design contract missing');
console.log(`Package check passed: ${ids.size} provinces, ${regionCount} regional data files, ${cities.length} scenic cities, ${Object.keys(attractions).length} attraction entries. Browser rendering must be reviewed separately.`);
