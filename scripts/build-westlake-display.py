"""Non-rectangular, lake-led derivative of the archived West Lake source bundle."""
import sys,json,math,hashlib
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
from shapely.geometry import Polygon,LineString,Point,box
from shapely.ops import transform
from shapely import constrained_delaunay_triangles
src=APP/'data/scenes/westlake/scene-data.json';d=json.loads(src.read_text());pr=d['projection'];origin=pr['origin'];scale=pr['metresPerMercator']
def merc(x,y):return ((x+180)/360,(1-math.asinh(math.tan(math.radians(y)))/math.pi)/2)
cx,cy=merc(*origin)
def forward(x,y,z=None):
 a,b=merc(x,y);return ((a-cx)*scale,(b-cy)*scale)
def inverse(x,z,y=None):return ((x/scale+cx)*360-180,math.degrees(math.atan(math.sinh(math.pi*(1-2*(z/scale+cy))))))
def geom(r):return transform(forward,Polygon(r[0],r[1:]))
def polys(g):
 if g.is_empty:return []
 return [g] if g.geom_type=='Polygon' else [p for c in g.geoms for p in polys(c)]
def pack(g):return [[list(p) for p in r.coords] for r in [g.exterior,*g.interiors]]
lake=next(w for w in d['water'] if w.get('id')=='westlake-water');foot=Polygon(geom(lake['rings']).exterior)
extent=box(*pr['extentMeters']);outline=foot.buffer(510,quad_segs=12).intersection(extent.buffer(-12)).buffer(-35).buffer(35).intersection(extent)
assert outline.covers(geom(lake['rings']))
d['displayOutline']=pack(outline);d['extentRole']='Lake-led display contour with immediate hills and shoreline; not a scenic administrative boundary.'
for kind in ['water','forest','urban']:
 rows=[]
 for r in d[kind]:
  if kind=='water' and r.get('id')=='westlake-water':rows.append(r);continue
  for p in polys(geom(r['rings']).intersection(outline)):
   if p.area>.001:rows.append({**r,'rings':pack(transform(inverse,p))})
 d[kind]=rows
roads=[]
for r in d['roads']:
 g=transform(forward,LineString(r['points'])).intersection(outline.buffer(-18))
 for line in [g] if g.geom_type=='LineString' else getattr(g,'geoms',[]):
  if not line.is_empty and line.geom_type=='LineString':roads.append({**r,'points':[list(inverse(*p)) for p in line.coords]})
d['roads']=roads
pos=d['terrain']['positions'];idx=d['terrain']['indices'];vertices=[];indices=[];keys={}
def vert(x,y,z):
 p=tuple(round(v,5) for v in [x,y,z])
 if p not in keys:keys[p]=len(vertices)//3;vertices.extend(p)
 return keys[p]
for i in range(0,len(idx),3):
 ps=[pos[j*3:j*3+3] for j in idx[i:i+3]];a,b,c=ps;den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
 if abs(den)<1e-9:continue
 def height(x,z):
  u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den
  return u*a[1]+v*b[1]+(1-u-v)*c[1]
 for p in polys(Polygon([(p[0],p[2]) for p in ps]).intersection(outline)):
  for t in constrained_delaunay_triangles(p).geoms:
   qs=list(t.exterior.coords)[:3];ix=[vert(x,height(x,z),z) for x,z in qs];ar=(qs[1][0]-qs[0][0])*(qs[2][1]-qs[0][1])-(qs[1][1]-qs[0][1])*(qs[2][0]-qs[0][0]);indices.extend(ix if ar<0 else ix[::-1])
edges={}
for i in range(0,len(indices),3):
 for a,b in [(indices[i],indices[i+1]),(indices[i+1],indices[i+2]),(indices[i+2],indices[i])]:
  key=tuple(sorted([a,b]));edges.setdefault(key,[a,b,0]);edges[key][2]+=1
water=geom(lake['rings']);shore=outline.boundary.union(water.boundary)
d['terrain']={**d['terrain'],'positions':vertices,'indices':indices,'cutEdges':[[a,b] for a,b,n in edges.values() if n==1 and shore.distance(Point((vertices[a*3]+vertices[b*3])/2,(vertices[a*3+2]+vertices[b*3+2])/2))<.1]}
d['source']['displayParentSha256']=hashlib.sha256(src.read_bytes()).hexdigest();d['stats'].update(terrainVertices=len(vertices)//3,terrainTriangles=len(indices)//3)
(APP/'data/scenes/westlake/display-scene-data.json').write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')))
print('West Lake display contour',outline.area/extent.area,len(indices)//3)
