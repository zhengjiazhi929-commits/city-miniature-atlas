#!/usr/bin/env python3
"""Bounded cartographic footprint envelopes; never edits geographic source land.

A model may extend up to 80 m beyond its original source-developed block. Its
anchor remains in that original block. Known natural land, other classified
land uses, water, airport, city boundary and major roads remain hard barriers.
These envelopes are display-only and are not new mapped urban/land-use data.
"""
from pathlib import Path
import hashlib,json,sys,math
APP=Path(__file__).resolve().parents[1]
from shapely.geometry import Polygon,LineString,GeometryCollection
from shapely.ops import unary_union
from shapely.validation import make_valid
from shapely.strtree import STRtree
DATA=APP/'data/hangzhou-atlas';DISTANCE=80.
files={}
def read(p):
 b=p.read_bytes();files[str(p.relative_to(APP))]=hashlib.sha256(b).hexdigest();return json.loads(b)
scene=read(DATA/'scene-data.json');plan=read(DATA/'urban-neighbourhoods.json');cover=read(DATA/'urban-ground-cover.json');classes=read(DATA/'source-classifications.json');airport=read(APP/'data/airports/hangzhou.json')
origin=scene['bbox'][:2];mx=111320*math.cos((scene['bbox'][1]+scene['bbox'][3])*math.pi/360);my=111320
xy=lambda q:((q[0]-origin[0])*mx,(q[1]-origin[1])*my)
ll=lambda q:[round(q[0]/mx+origin[0],9),round(q[1]/my+origin[1],9)]
def geom(row):
 rs=row['rings'] if isinstance(row,dict) else row
 p=Polygon([xy(q) for q in rs[0]],[[xy(q) for q in r] for r in rs[1:]])
 return p if p.is_valid else make_valid(p)
def polys(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 return [p for a in getattr(g,'geoms',[]) for p in polys(a)]
def rings(g):return [[ll(q) for q in r.coords] for r in [g.exterior,*g.interiors]]
land=unary_union([geom(p) for p in scene['boundary']])
blocked=[geom(p) for p in scene['water']+scene['forest']]+[geom(p) for p in cover['classes'] if p['class'] in {'forest','park','grass','farmland','scrub','wetland'}]+[geom(p) for p in airport['boundary']]
widths={'motorway':110,'trunk':90,'primary':65}
for road in scene['roads']:
 if road['class'] not in widths or road.get('tunnel') or len(road.get('points',[]))<2:continue
 blocked.append(LineString([xy(q) for q in road['points']]).buffer(widths[road['class']]/2+12,cap_style=2,join_style=2))
blocktree=STRtree(blocked)
class_shapes=[geom(p) for p in classes['urban']];classtree=STRtree(class_shapes)
out=[];max_extra=0
for i,row in enumerate(plan['groups']):
 source=geom(row['sourceRings']);expanded=source.buffer(DISTANCE,quad_segs=8).intersection(land)
 nearby=[blocked[int(j)] for j in blocktree.query(expanded)]
 for j in classtree.query(expanded):
  j=int(j);other=classes['urban'][j]['class']
  if other!=row['sourceClass'] and other in {'residential','commercial','retail','industrial','school','university','college','hospital'}:nearby.append(class_shapes[j].difference(source))
 if nearby:expanded=expanded.difference(unary_union(nearby))
 # Retain only connected pieces meeting the original sourced block; no new
 # detached islands or invented placement anchors are created.
 expanded=unary_union([p for p in polys(expanded) if p.intersection(source).area>1]).buffer(-.5,join_style=2)
 serialized=[rings(p) for p in polys(expanded)]
 replay=unary_union([geom(p) for p in serialized]);extra=replay.difference(source.buffer(DISTANCE+.001,quad_segs=16)).area;max_extra=max(max_extra,extra)
 if extra>.01:raise RuntimeError('Envelope exceeds 80 m bounded expansion')
 out.append({'id':row['id'],'sourceClass':row['sourceClass'],'polygons':serialized})
 if i%600==0:print('Display envelopes',i+1,'/',len(plan['groups']),flush=True)
result={'version':1,'crs':'EPSG:4326','role':'cartographic-display-footprint-only','maximumSourceEdgeExtensionMeters':DISTANCE,'sourcePlanSha256':files['data/hangzhou-atlas/urban-neighbourhoods.json'],'groups':out,'sources':files,'processing':{'script':'scripts/build-hangzhou-display-envelopes.py','scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'barriers':'Original city, water, forest, explicit natural cover, airport, original major roads with 12 m side clearance, other known source land-use classes. No new anchors.','maximumOutsideAllowedEnvelopeMeters2':max_extra},'limitations':['Not a geographic urban/land-use mask or real building footprint. Source datasets are unchanged.','Only schematic ordinary model footprints may extend up to 80 m from their original developed source region, while anchors, roads, water, terrain and landmarks retain geographic positions.','Original-source overlap and the bounded display envelope must be audited separately; do not claim zero original-source overhang.']}
(DATA/'urban-display-envelopes.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');print('Saved',len(out),'display envelopes',flush=True)
