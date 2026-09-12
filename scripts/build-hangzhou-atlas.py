#!/usr/bin/env python3
"""Compile the checked local Hangzhou sources into a compact offline scene bundle.

Requires numpy and Pillow, and the repository's existing polygon-clipping + Node.
No network requests, generated geography, or application edits.
"""
from __future__ import annotations
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import os
import shutil
import subprocess
import sys

APP = Path(__file__).resolve().parents[1]
from archive_paths import archive_root, require_files, source_label
ROOT = archive_root()

import numpy as np
from PIL import Image
SOURCE = ROOT / 'work/hangzhou-concept-v3/supports/full-city'
EXTRA = ROOT / 'work/hangzhou-concept-v3/supports/missing-landmarks/four-landmark-anchors.geojson'
OUT = APP / 'data/hangzhou-atlas'
RUNTIME = os.environ.get('NODE_BINARY') or shutil.which('node')
LON_METERS = 111320 * math.cos(math.radians(30))
LAT_METERS = 111320


def read(path):
    return json.loads(path.read_text())


def features(name):
    data = read(SOURCE / f'{name}.geojson')
    return data.get('features', [data])


def polygons(geometry):
    if geometry['type'] == 'Polygon':
        return [geometry['coordinates']]
    if geometry['type'] == 'MultiPolygon':
        return geometry['coordinates']
    return []


def rdp(points, tolerance):
    if len(points) <= 2:
        return points
    pts = np.asarray(points, dtype=float)
    scaled = pts * [LON_METERS, LAT_METERS]
    keep = np.zeros(len(pts), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts)-1)]
    while stack:
        a, b = stack.pop()
        if b-a < 2:
            continue
        delta = scaled[b]-scaled[a]
        length = float(delta @ delta)
        segment = scaled[a+1:b]
        if length:
            t = np.clip(((segment-scaled[a]) @ delta)/length, 0, 1)
            distance = np.linalg.norm(segment-scaled[a]-t[:, None]*delta, axis=1)
        else:
            distance = np.linalg.norm(segment-scaled[a], axis=1)
        i = int(np.argmax(distance))
        if distance[i] > tolerance:
            k = a+1+i
            keep[k] = True
            stack.extend([(a,k), (k,b)])
    return pts[keep].tolist()


def ring(points, tolerance):
    # Split a closed ring at its farthest point before line simplification.
    pts = points[:-1] if points[0] == points[-1] else points
    if len(pts) < 3:
        return None
    values = np.asarray(pts)
    k = int(np.argmax(np.linalg.norm((values-values[0])*[LON_METERS,LAT_METERS],axis=1)))
    result = rdp(pts[:k+1], tolerance)[:-1] + rdp(pts[k:]+[pts[0]], tolerance)
    result = [[round(x,7),round(y,7)] for x,y in result]
    result = [p for i,p in enumerate(result) if i == 0 or p != result[i-1]]
    if result and result[0] != result[-1]:
        result.append(result[0])
    return result if len(result) >= 4 else None


def simplified(poly, tolerance):
    exterior = ring(poly[0], tolerance)
    return [exterior] + [r for r in (ring(p,tolerance) for p in poly[1:]) if r] if exterior else None


def polygon_area(poly):
    def area(r):
        a = np.asarray(r)
        return abs(float(np.sum(a[:-1,0]*a[1:,1]-a[1:,0]*a[:-1,1])))*.5*LON_METERS*LAT_METERS
    return max(0, area(poly[0])-sum(area(r) for r in poly[1:]))


class Boundary:
    def __init__(self, shapes):
        self.shapes = shapes
        self.ring_arrays = [[np.asarray(r) for r in p] for p in shapes]
        rings = [r for p in shapes for r in p]
        self.a = np.concatenate([np.asarray(r[:-1]) for r in rings])
        self.b = np.concatenate([np.asarray(r[1:]) for r in rings])
        self.lo = np.minimum(self.a,self.b)
        self.hi = np.maximum(self.a,self.b)

    @staticmethod
    def inside_ring(point, values):
        x,y=point
        a=np.asarray(values)
        x0,y0=a[:-1,0],a[:-1,1]
        x1,y1=a[1:,0],a[1:,1]
        crossing=(y0>y)!=(y1>y)
        denominator=np.where(y1==y0,1,y1-y0)
        return bool(np.count_nonzero(crossing & (x<(x1-x0)*(y-y0)/denominator+x0))%2)

    def contains(self, point):
        return any(self.inside_ring(point,p[0]) and not any(self.inside_ring(point,h) for h in p[1:]) for p in self.ring_arrays)

    def clip_line(self, points):
        result=[]
        current=[]
        for aa,bb in zip(points[:-1],points[1:]):
            a,b=np.asarray(aa),np.asarray(bb)
            d=b-a
            lo,hi=np.minimum(a,b),np.maximum(a,b)
            candidate=np.all(self.hi>=lo,axis=1)&np.all(self.lo<=hi,axis=1)
            edge_a,edge_b=self.a[candidate],self.b[candidate]
            e=edge_b-edge_a
            denom=d[0]*e[:,1]-d[1]*e[:,0]
            usable=np.abs(denom)>1e-16
            diff=edge_a-a
            denom=np.where(usable,denom,1)
            t=(diff[:,0]*e[:,1]-diff[:,1]*e[:,0])/denom
            u=(diff[:,0]*d[1]-diff[:,1]*d[0])/denom
            cuts=sorted(set([0.,1.]+t[usable&(t>0)&(t<1)&(u>=0)&(u<=1)].tolist()))
            for start,end in zip(cuts[:-1],cuts[1:]):
                p=(a+d*start).tolist();q=(a+d*end).tolist()
                if self.contains(a+d*((start+end)/2)):
                    if current and np.linalg.norm(np.asarray(current[-1])-p)<1e-8:
                        current.append(q)
                    else:
                        if len(current)>1: result.append(current)
                        current=[p,q]
                else:
                    if len(current)>1: result.append(current)
                    current=[]
        if len(current)>1: result.append(current)
        return result


class Dem:
    def __init__(self):
        self.tiles={}
        for path in sorted((SOURCE/'dem').glob('*.png')):
            z,x,y=map(int,path.stem.split('-'))
            rgb=np.asarray(Image.open(path).convert('RGB'),dtype=float)
            self.tiles[(z,x,y)]=rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
        self.zoom=next(iter(self.tiles))[0]

    def sample(self, coordinates):
        lng,lat=coordinates
        n=2**self.zoom
        x=(lng+180)/360*n
        y=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
        tx,ty=math.floor(x),math.floor(y)
        px,py=(x-tx)*256-.5,(y-ty)*256-.5
        ix,iy=math.floor(px),math.floor(py)
        fx,fy=px-ix,py-iy
        def value(i,j):
            xx,yy=tx+i//256,ty+j//256
            tile=self.tiles.get((self.zoom,xx,yy))
            if tile is None:
                tile=self.tiles[(self.zoom,tx,ty)]
                return tile[min(255,max(0,j)),min(255,max(0,i))]
            return tile[j%256,i%256]
        return float(value(ix,iy)*(1-fx)*(1-fy)+value(ix+1,iy)*fx*(1-fy)+value(ix,iy+1)*(1-fx)*fy+value(ix+1,iy+1)*fx*fy)


def union_clip(layers, boundary):
    if not RUNTIME:
        raise SystemExit('Node.js is required; install Node 18+ or set NODE_BINARY to its executable.')
    node=str(RUNTIME)
    script="""import fs from 'node:fs';
import pc from __POLYGON_MODULE__;
const input=JSON.parse(fs.readFileSync(0,'utf8')),output={};
function unionBatch(shapes){
  let groups=[];
  for(let i=0;i<shapes.length;i+=48)groups.push(pc.union(...shapes.slice(i,i+48)));
  while(groups.length>1){let next=[];for(let i=0;i<groups.length;i+=12)next.push(pc.union(...groups.slice(i,i+12)));groups=next;}
  return groups[0]||[];
}
for(const [name,shapes] of Object.entries(input.layers)){
  process.stderr.write(name+': '+shapes.length+' source polygons\\n');
  const merged=unionBatch(shapes.map(p=>[p]));
  output[name]=merged.length?pc.intersection(merged,input.boundary):[];
}
process.stdout.write(JSON.stringify(output));
""".replace('__POLYGON_MODULE__',json.dumps((APP/'vendor/polygon-clipping.js').as_uri()))
    payload=json.dumps({'boundary':boundary,'layers':layers},separators=(',',':'))
    output=subprocess.run([node,'--input-type=module','-e',script],input=payload,text=True,capture_output=True)
    print(output.stderr,file=sys.stderr,end='')
    output.check_returncode()
    return json.loads(output.stdout)


def main():
    require_files([SOURCE / name for name in ['extent.json', 'administrative-boundary.geojson', 'water.geojson', 'main-river-spine.geojson', 'landcover.geojson', 'landuse.geojson', 'transportation.geojson', 'landmark-anchors.geojson', 'place-anchors.geojson']] + [EXTRA])
    if not list((SOURCE / 'dem').glob('*.png')):
        raise SystemExit(f'Missing frozen DEM PNG inputs: {SOURCE / "dem"}; no data was downloaded.')
    OUT.mkdir(parents=True,exist_ok=True)
    bbox=read(SOURCE/'extent.json')['bbox']
    boundary=[simplified(p,35) for p in polygons(features('administrative-boundary')[0]['geometry'])]
    boundary=[p for p in boundary if p]
    mask=Boundary(boundary)
    dem=Dem()
    west,south,east,north=bbox
    width=257
    height=round((north-south)*LAT_METERS/((east-west)*LON_METERS)*(width-1))+1
    values=[];valid=[]
    for y in range(height):
        lat=north-y/(height-1)*(north-south)
        for x in range(width):
            lon=west+x/(width-1)*(east-west)
            inside=mask.contains([lon,lat])
            valid.append(int(inside));values.append(round(dem.sample([lon,lat])))
    layers={'water':[],'forest':[],'urban':[]}
    urban_classes={'residential','neighbourhood','quarter','suburb','commercial','industrial','retail','school','university','hospital','college'}
    for filename,layer,tolerance in [('water','water',22),('landcover','forest',50),('landuse','urban',30)]:
        for f in features(filename):
            cls=f['properties'].get('class')
            if layer=='forest' and cls!='wood': continue
            if layer=='urban' and cls not in urban_classes: continue
            if layer=='water' and cls=='ocean': continue
            for p in polygons(f['geometry']):
                simple=simplified(p,tolerance)
                if simple: layers[layer].append(simple)
    merged=union_clip(layers,boundary)
    water=[]
    for p in merged['water']:
        if polygon_area(p)<4000: continue
        shore=p[0][::max(1,len(p[0])//30)]
        # A display-only estimate, not an asserted measured water level.
        level=round(float(np.percentile([dem.sample(c) for c in shore],15)),1)
        water.append({'class':'water','rings':p,'levelMeters':max(0,level),'areaMeters':round(polygon_area(p))})
    forest=[{'rings':p,'areaMeters':round(polygon_area(p))} for p in merged['forest'] if polygon_area(p)>=20000]
    urban=[{'class':'developed','rings':p,'areaMeters':round(polygon_area(p))} for p in merged['urban'] if polygon_area(p)>=6000]
    roads=[];seen=set()
    for f in features('transportation'):
        prop=f['properties'];geometry=f['geometry']
        if prop.get('class') not in {'motorway','trunk','primary','secondary'}: continue
        lines=[geometry['coordinates']] if geometry['type']=='LineString' else geometry['coordinates'] if geometry['type']=='MultiLineString' else []
        for line in lines:
            for clipped in mask.clip_line(rdp(line,30)):
                points=[[round(a,7),round(b,7)] for a,b in clipped]
                key=(prop.get('class'),tuple(tuple(p) for p in points))
                if key in seen: continue
                seen.add(key)
                roads.append({'class':prop['class'],'name':prop.get('name:zh',prop.get('name','')),'bridge':prop.get('brunnel')=='bridge','tunnel':prop.get('brunnel')=='tunnel','points':points})
    identities={
        '灵隐寺':('lingyin','temple'),'法喜寺':('faxi','temple'),'小河直街':('xiaohe','historic-street'),
        '六和塔':('liuhe','pagoda'),'拱宸桥':('gongchen','bridge'),'河坊街':('hefang','historic-street'),
        '断桥':('broken-bridge','bridge'),'雷峰塔':('leifeng','pagoda'),'三潭印月':('santan','island-pagodas'),
        '西溪国家湿地公园':('xixi','wetland'),'良渚古城遗址·城址区':('liangzhu','archaeological-site'),
        '湘湖':('xianghu','lake'),'杭州市国际会议中心':('qianjiang','conference-center'),
        '杭州奥林匹克体育博览中心体育场':('olympic','stadium'),'千岛湖':('qiandao','reservoir'),
        '严子陵钓台':('yanziling','riverside-pavilion'),'龙门古镇':('longmen','historic-town'),
        '天目山景区':('tianmu','mountain'),'新叶古村':('xinye','historic-village'),'瑶琳仙境':('yaolin','cave')}
    anchors={f['properties']['name']:f for f in features('landmark-anchors')}
    for f in read(EXTRA)['features']: anchors[f['properties']['name']]=f
    landmarks=[]
    for name,f in anchors.items():
        prop=f['properties'];ident,kind=identities[name]
        landmarks.append({'id':ident,'name':name,'type':kind,'coordinates':f['geometry']['coordinates'],'source':prop.get('source'),'role':prop.get('role',''),'terrainMeters':round(dem.sample(f['geometry']['coordinates']),1)})
    places=[{'name':f['properties'].get('displayName',f['properties']['name']),'coordinates':f['geometry']['coordinates'],'role':f['properties'].get('role','')} for f in features('place-anchors')]
    rivers=[]
    for f in features('main-river-spine'):
        p=f['properties'];geometry=f['geometry']
        for line in [geometry['coordinates']] if geometry['type']=='LineString' else geometry['coordinates']:
            for part in mask.clip_line(rdp(line,25)):
                rivers.append({'name':p.get('name:zh',p.get('name','')),'points':[[round(x,7),round(y,7)] for x,y in part]})
    source_files=[SOURCE/f'{n}.geojson' for n in ['administrative-boundary','water','main-river-spine','landcover','landuse','transportation','landmark-anchors','place-anchors']]+[EXTRA]+sorted((SOURCE/'dem').glob('*.png'))
    sources={'boundary':'https://www.openstreetmap.org/relation/3221112','vectors':'https://openfreemap.org/','dem':'https://registry.opendata.aws/terrain-tiles/','coordinateReference':'WGS84 longitude latitude','sourceRoot':str(SOURCE.relative_to(ROOT)),'files':[{ 'path':source_label(p, ROOT), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in source_files]}
    inside_heights=[v for v,m in zip(values,valid) if m]
    below_zero=[(v,i) for i,v in enumerate(values) if valid[i] and v<0]
    lowest=[{'meters':v,'coordinates':[west+(i%width)/(width-1)*(east-west),north-(i//width)/(height-1)*(north-south)]} for v,i in sorted(below_zero)[:6]]
    stats={'terrainRangeMeters':[min(inside_heights),max(inside_heights)],'terrainP1P99Meters':[round(float(v),1) for v in np.percentile(inside_heights,[1,99])],'insideSamples':sum(valid),'belowZeroSamples':len(below_zero),'lowestTerrainSamples':lowest,'roadClasses':dict(Counter(r['class'] for r in roads)),'bridges':sum(r['bridge'] for r in roads),'tunnels':sum(r['tunnel'] for r in roads),'roadVertices':sum(len(r['points']) for r in roads),'forestVertices':sum(len(r) for p in forest for r in p['rings']),'urbanVertices':sum(len(r) for p in urban for r in p['rings']),'waterVertices':sum(len(r) for p in water for r in p['rings'])}
    result={'version':1,'crs':'EPSG:4326','bbox':bbox,'boundary':boundary,'terrain':{'width':width,'height':height,'bbox':bbox,'rowOrder':'north-to-south','values':values,'mask':valid,'units':'meters','sourceZoom':dem.zoom},'water':water,'roads':roads,'forest':forest,'urban':urban,'rivers':rivers,'landmarks':landmarks,'places':places,'sources':sources,'stats':stats}
    output=OUT/'scene-data.json'
    # Round geometry only after clipping, retaining enough precision for the scene.
    def rounded(value):
        if isinstance(value,float): return round(value,7)
        if isinstance(value,list): return [rounded(v) for v in value]
        if isinstance(value,dict): return {k:rounded(v) for k,v in value.items()}
        return value
    pending=OUT/'.scene-data.pending'
    pending.write_text(json.dumps(rounded(result),ensure_ascii=False,separators=(',',':'))+'\n')
    pending.replace(output)
    counts={key:len(result[key]) for key in ['water','roads','forest','urban','rivers','landmarks','places']}
    notice=f'''# Hangzhou offline tourism-atlas scene data

Generated by `scripts/build-hangzhou-atlas.py` from checked local source files; no network or invented geographic features.

## Interface

- Coordinates: WGS84 `[longitude, latitude]`; bbox `[west,south,east,north]` = `{bbox}`.
- `boundary`: MultiPolygon nesting, i.e. array of polygons, each polygon an exterior ring followed by holes. Simplified within 35 metres before clipping.
- `terrain`: {width} × {height} row-major vertex samples, **north to south**, longitude increasing west to east. Values are integer elevation metres including the full bounding rectangle; `mask` marks inside the municipality as 1 and outside as 0. Keep outside values available for boundary interpolation, but clip displayed geometry to `boundary`. DEM is bilinearly sampled from the locally saved z9 Terrarium tiles, not a surveyed city mesh.
- Source-quality limitation: the sampled interior includes {len(below_zero)} below-zero elevations; the lowest is {min(inside_heights)} m, including inland points that require verification. These are retained raw rather than silently declared real pits or corrected heights. `stats.lowestTerrainSamples` gives review coordinates. If the visual renderer applies a sea-level floor or outlier repair, document it as a display/quality choice. The grid's range is the sampled DEM range, not the city's measured minimum or maximum elevation.
- `water`: clipped and merged real source water polygons, preserving island holes; `rings` is one Polygon. `levelMeters` is the 15th percentile of source DEM samples around that polygon's shore, used only as a display estimate. It is not measured water level, and connected river surfaces can require sloped rendering. Ponds under 4,000 m² are omitted at this overview scale. Ocean features are excluded.
- `roads`: true source motorway/trunk/primary/secondary lines simplified within 30 metres and clipped to the municipal boundary. Preserve `bridge` and `tunnel`; an overland road ribbon must not render a tunnel above ground. Tile-buffer overlap may remain in partially duplicated line segments. No invented connections.
- `forest`: source `wood` polygons, merged and clipped; area threshold 20,000 m². `urban`: merged mapped residential/commercial/industrial and institutional land-use areas, threshold 6,000 m². **These are land-use regions, not building footprints or measured building heights.** Coverage is incomplete; absent polygons do not prove wilderness. Generated representative tree/building symbols must stay inside the appropriate source masks and outside water/roads.
- `rivers`: named source fragments for 新安江/富春江/钱塘江; do not join them with invented straight segments. Render water using `water` polygons.
- `landmarks`: 20 checked location anchors with semantic model types, source URL and anchor role. Model size may be exaggerated, but coordinates remain authoritative. 三潭印月's point is a scenic representative point, not the measured positions of its three stone pagodas.
- `places`: five genuine source settlement label points, not district centroids.

Counts: `{json.dumps(counts,ensure_ascii=False)}`. Bundle size: {output.stat().st_size:,} bytes. Statistics: `{json.dumps(stats,ensure_ascii=False)}`.

## Attribution and reproducibility

Boundary and vectors: © OpenStreetMap contributors, ODbL. Source delivery: OpenFreeMap / OpenMapTiles. See https://www.openstreetmap.org/copyright and https://openfreemap.org/ . Boundary source https://www.openstreetmap.org/relation/3221112 . Terrain: AWS Terrain Tiles / Mapzen, https://registry.opendata.aws/terrain-tiles/ . Existing raw source provenance is stored under `{SOURCE.relative_to(ROOT)}` including the per-tile URLs and original source snapshot metadata.

`scene-data.json.sources.files` contains SHA-256 hashes for the exact local sources used. The output is derived data and must retain this notice and OSM attribution in redistributed products. The renderer should label landmark dimensions, symbolic tree/building counts and water-level estimates as artistic/cartographic display choices rather than surveyed facts.

Run using Python with NumPy/Pillow installed; Node uses this repository's existing `vendor/polygon-clipping.js`. No extra package download is needed.
'''
    (OUT/'NOTICE.md').write_text(notice)
    print(json.dumps({'path':str(output),'bytes':output.stat().st_size,'terrain':[width,height],'counts':counts},ensure_ascii=False))
    if output.stat().st_size>10_000_000:
        raise RuntimeError('Bundle exceeds 10 MB target')


if __name__=='__main__':
    main()
