#!/usr/bin/env python3
"""Subject-led, nonrectangular natural models from unchanged water and terrain."""
from pathlib import Path
import sys,json,math,hashlib
APP=Path(__file__).resolve().parents[1]
from shapely.geometry import Polygon,Point,GeometryCollection,LineString
from shapely.ops import unary_union,nearest_points
from shapely import make_valid,concave_hull,constrained_delaunay_triangles,STRtree
from shapely.affinity import scale
from subject_geography import osm_geometry,LocalDEM,terrain_grid
OUT=APP/'data/scenes/hangzhou-subjects'
def polys(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 return [p for c in getattr(g,'geoms',[]) for p in polys(c)]
def poly(rs):return make_valid(Polygon(rs[0],rs[1:]))
def pack(p):return [[[round(x,4),round(y,4)] for x,y in r.coords] for r in [p.exterior,*p.interiors]]
def merc(p):return [(p[0]+180)/360,(1-math.asinh(math.tan(math.radians(p[1])))/math.pi)/2]
for id in ['westlake','xixi','qiandao','tianmu']:
 if len(sys.argv)>1 and id not in sys.argv[1:]:continue
 print('preparing',id,flush=True)
 path=APP/('data/scenes/westlake/display-scene-data.json' if id=='westlake' else f'data/scenes/hangzhou-details/{id}.json');d=json.loads(path.read_text());positions=d['terrain']['positions'];indices=d['terrain']['indices']
 if id=='westlake':
  pr=d['projection'];origin=merc(pr['origin']);project=lambda p:tuple((v-origin[i])*pr['metresPerMercator'] for i,v in enumerate(merc(p)))
  water=[poly([[project(p) for p in r] for r in w['rings']]) for w in d['water']];waterLevels=[w['levelMeters'] for w in d['water']]
  lake=next(w for w in d['water'] if w.get('id')=='westlake-water');main=poly([[project(p) for p in r] for r in lake['rings']]);main,_,rawSource=osm_geometry(OUT/'sources/westlake-osm.json',project,2308774)
  if main.is_empty:raise RuntimeError('West Lake relation is incomplete')
  water=polys(main);waterLevels=[lake['levelMeters']]*len(water);keep=unary_union([Polygon(p.exterior) for p in water]).buffer(65,join_style=1).union(unary_union([Point(project(l['coordinates'])).buffer(90) for l in d['landmarks'] if l['id']!='santan']));role='Complete OSM West Lake relation, islands and causeways, with a narrow 65 m shoreline margin.'
  inverse=lambda p:((origin[0]+p[0]/pr['metresPerMercator'])*360-180,math.degrees(math.atan(math.sinh(math.pi*(1-2*(origin[1]+p[1]/pr['metresPerMercator']))))))
  for item in d['landmarks']:
   if item['id']!='leifeng':continue
   anchor=Point(project(item['coordinates']));coast=nearest_points(anchor,main)[1];keep=keep.union(LineString([anchor,coast]).buffer(65))
 else:
  water=[poly(w['rings']) for w in d['water']];waterLevels=[w['level'] for w in d['water']];frame=poly(d['displayOutline'])
  if id=='xixi':
   ox,oz=d['origin'];mx,mz=d['metersPerDegree'];center=((120.0590028-ox)*mx,(oz-30.2681448)*mz)
   focus=Point(center[0]-65,center[1]+150)
   selected=sorted([p for p in water if 300<p.area<12000 and p.centroid.distance(focus)<190],key=lambda p:p.centroid.distance(focus))[:10]
   keep=concave_hull(unary_union(selected),ratio=.65).buffer(20).intersection(frame);role='Wetland water lanes south of the sourced Qiu Xue An vicinity; shoreline-led crop, not the scenic-area boundary. No unsourced temple footprint is invented.'
  elif id=='qiandao':
   ox,oz=d['origin'];mx,mz=d['metersPerDegree'];project=lambda p:((p[0]-ox)*mx,(oz-p[1])*mz);inverse=lambda p:(ox+p[0]/mx,oz-p[1]/mz)
   _,islands,rawSource=osm_geometry(OUT/'sources/qiandao-osm.json',project,162908);landPieces=polys(islands);selected=sorted([p for p in landPieces if p.area>5000 and p.centroid.distance(Point(3300,2200))<1300],key=lambda p:p.distance(Point(3300,2200)))[:10]
   if len(selected)<3:raise RuntimeError('No interior island cluster')
   keep=concave_hull(unary_union(selected),ratio=.65).buffer(150).intersection(frame);water=polys(keep.difference(islands));waterLevels=[109.0]*len(water);role='Complete inner-ring islands from OSM lake relation 162908 and immediately surrounding water; not the complete lake.'
  else:
   window=Point(-405,-385).buffer(245,quad_segs=48);walks=unary_union([LineString(r['points']).intersection(window) for r in d['roads'] if r['class'] in ['path','steps']]);keep=walks.buffer(65,quad_segs=16).intersection(frame);keep=max(polys(keep),key=lambda p:p.area);role='West Tianmu forest along a sourced walking-trail segment; a close forest subject, not the whole mountain or an individually surveyed ancient tree.'
 if id in ['westlake','qiandao']:
  dem=LocalDEM(APP/'data/scenes/hangzhou-details/sources/dem');positions,indices=terrain_grid(keep.bounds,inverse,dem,80 if id=='westlake' else 65)
 keep=make_valid(keep);waterUnion=unary_union(water);land=keep.difference(waterUnion);outPos=[];outIdx=[];keyMap={};waterTree=STRtree(water) if water else None;shoreAdjustments=0
 def vertex(p):
  key=tuple(round(v,4) for v in p)
  if key not in keyMap:keyMap[key]=len(outPos)//3;outPos.extend(key)
  return keyMap[key]
 for i in range(0,len(indices),3):
  p=[positions[k*3:k*3+3] for k in indices[i:i+3]];tri=Polygon([(q[0],q[2]) for q in p]);part=tri.intersection(land)
  if part.is_empty:continue
  ax,ay,az=p[0];bx,by,bz=p[1];cx,cy,cz=p[2];den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz)
  if abs(den)<1e-10:continue
  def height(x,z):
   u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den;v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;return ay*u+by*v+cy*(1-u-v)
  for piece in polys(part):
   for t in constrained_delaunay_triangles(piece).geoms:
    ps=list(t.exterior.coords)[:3];vs=[]
    for x,z in ps:
     h=height(x,z)
     # The DEM and polygon water levels differ near banks. Keep the sourced
     # horizontal shoreline; lift only submerged land to the adjacent water
     # level, rather than letting the water's inner wall hide the island.
     if waterTree is not None:
      floor=waterLevels[int(waterTree.nearest(Point(x,z)))]+.65
      if h<floor:shoreAdjustments+=1;h=floor
     vs.append(vertex([x,h,z]))
    a,b,c=[outPos[k*3:k*3+3] for k in vs];normal=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);outIdx.extend(vs if normal>0 else vs[::-1])
 edges={}
 for i in range(0,len(outIdx),3):
  t=outIdx[i:i+3]
  for a,b in zip(t,t[1:]+t[:1]):
   key=tuple(sorted([a,b]));edges[key]=None if key in edges else [a,b]
 w,s,e,n=keep.bounds;waters=[]
 for p,l in zip(water,waterLevels):
  for q in polys(p.intersection(keep)):
   if q.area>2:waters.append({'rings':pack(q),'level':l})
 buildings=[] if id!='xixi' else [b for b in d['buildings'] if keep.buffer(-4).covers(poly(b['rings']))][:36]
 result={'version':2,'id':id,'kind':'natural-subject','extent':[w,s,e,n],'unit':24/max(e-w,n-s),'heightScale':1.6 if id=='westlake' else 1.15 if id=='tianmu' else 2.0,'terrain':{'positions':outPos,'indices':outIdx,'edges':[edge for edge in edges.values() if edge]},'water':waters,'outline':[pack(p) for p in polys(keep)],'buildings':buildings,'landmarks':[{**l,'local':list(project(l['coordinates']))} for l in d['landmarks']] if id=='westlake' else [],'source':{'file':str(path.relative_to(APP)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()},'scope':role}
 result['shorePolicy']={'method':'Clamp submerged land to nearest sourced water level plus 0.65 m; no horizontal deformation.','adjustedTriangleCorners':shoreAdjustments}
 if id in ['westlake','qiandao']:result['source']['preciseWater']=rawSource;result['source']['demTiles']=list(dem.sources.values());result['source']['demProcessing']='Archived z12 Terrarium, native 3x3 median and bilinear interpolation; isolated positive grid spikes bounded to eight-neighbour median plus 35 m.'
 (OUT/(id+'.json')).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));print(id,len(outPos)//3,'vertices',len(outIdx)//3,'triangles',len(waters),'water',len(buildings),'buildings',flush=True)
