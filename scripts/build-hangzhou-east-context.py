#!/usr/bin/env python3
"""Append frozen-snapshot eastern land cover; preserve all previous source files."""
from pathlib import Path
import json,sys,math,hashlib
APP=Path(__file__).resolve().parents[1]
from archive_paths import archive_root, require_files, source_label
ROOT = archive_root()
from shapely.geometry import shape,Polygon,box,mapping
from shapely.ops import unary_union,transform
from shapely import make_valid
src=ROOT/'work/hangzhou-five-v020/east-source'
require_files([src / name for name in ['landuse.geojson', 'landcover.geojson', 'park.geojson']])
scene=json.loads((APP/'data/hangzhou-atlas/scene-data.json').read_text())
boundary=unary_union([make_valid(Polygon(p[0],p[1:])) for p in scene['boundary']]);clip=boundary.intersection(box(120.4598,30.12,120.66,30.46))
urbanClasses={'residential','commercial','retail','industrial','school','university','college','hospital'}
groups={};files=[]
for layer in ['landuse','landcover','park']:
 f=src/(layer+'.geojson');files.append({'path':str(f.relative_to(ROOT)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
 for row in json.loads(f.read_text())['features']:
  p=row['properties'];cls=p.get('class','')
  if layer=='landcover':cls={'wood':'forest','farmland':'farmland','grass':'grass','scrub':'scrub','wetland':'wetland'}.get(cls,'')
  if layer=='park':cls='park'
  if cls not in urbanClasses|{'forest','park','grass','farmland','scrub','wetland'}:continue
  g=make_valid(shape(row['geometry'])).intersection(clip)
  if not g.is_empty:groups.setdefault(cls,[]).append(g)
def polys(g):
 if g.geom_type=='Polygon':return[g]
 return [p for c in getattr(g,'geoms',[]) for p in polys(c)]
urban=[];cover=[]
for cls,gs in groups.items():
 for p in polys(make_valid(unary_union(gs)).simplify(.00003,preserve_topology=True)):
  if p.area<.0000002:continue
  entry={'class':cls,'rings':[[[round(x,8),round(y,8)] for x,y in r.coords] for r in [p.exterior,*p.interiors]],'source':'fixed MVT 20260830_080001_pt, z13'}
  (urban if cls in urbanClasses else cover).append(entry)
out={'version':1,'bbox':[120.4598,30.12,120.66,30.46],'urban':urban,'cover':cover,'sources':files,'snapshot':'20260830_080001_pt','policy':'Source land-use supplement east of the previous detailed frame; missing coverage is unknown. No modified boundary, road or DEM.'}
(APP/'data/hangzhou-atlas/east-context.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
print('east urban',len(urban),'cover',len(cover))
