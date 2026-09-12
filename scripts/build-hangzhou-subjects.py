#!/usr/bin/env python3
"""Extract subject-only construction data from archived footprints, without city mutation."""
from pathlib import Path
import sys,json,math,hashlib
APP=Path(__file__).resolve().parents[1]
from shapely.geometry import Polygon,LineString,Point,GeometryCollection,box
from shapely.ops import unary_union,transform
from shapely import make_valid,concave_hull
SRC=APP/'data/scenes/hangzhou-details'; OUT=APP/'data/scenes/hangzhou-subjects'; OUT.mkdir(exist_ok=True)
def polygons(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 return [p for q in getattr(g,'geoms',[]) for p in polygons(q)]
def packed(p):return [[[round(x,4),round(z,4)] for x,z in r.coords] for r in [p.exterior,*p.interiors]]
def packmulti(g):return [packed(p) for p in polygons(g)]
def poly(rs):return make_valid(Polygon(rs[0],rs[1:]))
def frame(p):
 r=list(p.minimum_rotated_rectangle.exterior.coords)[:4];edges=[(math.dist(r[i],r[(i+1)%4]),i) for i in range(4)];_,i=max(edges);a=r[i];b=r[(i+1)%4];c=p.minimum_rotated_rectangle.centroid
 return {'x':round(c.x,4),'z':round(c.y,4),'width':round(math.dist(a,b),4),'depth':round(math.dist(b,r[(i+2)%4]),4),'yaw':-math.atan2(b[1]-a[1],b[0]-a[0])}
def fitted_parts(p,f):
 # Split concave buildings into several source-contained rectangular volumes;
 # do not roof over mapped courtyards or fill the gaps between adjacent houses.
 if p.minimum_rotated_rectangle.area/p.area<1.06:return [f]
 co=math.cos(-f['yaw']);si=math.sin(-f['yaw']);cx=f['x'];cz=f['z']
 local=transform(lambda x,z:(co*(x-cx)+si*(z-cz),-si*(x-cx)+co*(z-cz)),p)
 w,s,e,n=local.bounds;nx=28;nz=28;dx=(e-w)/nx;dz=(n-s)/nz
 filled=[[local.buffer(.001).covers(box(w+i*dx,s+j*dz,w+(i+1)*dx,s+(j+1)*dz)) for i in range(nx)] for j in range(nz)];parts=[]
 for iteration in range(7):
  best=(0,None)
  for j in range(nz):
   valid=[True]*nx
   for k in range(j,nz):
    valid=[a and b for a,b in zip(valid,filled[k])];start=0
    for i in range(nx+1):
     if i==nx or not valid[i]:
      area=(i-start)*(k-j+1)
      if area>best[0]:best=(area,(start,i,j,k+1))
      start=i+1
  if best[0]*dx*dz<max(12,p.area*.035):break
  a,b,c,d=best[1];x=w+(a+b)*dx/2;z=s+(c+d)*dz/2
  parts.append({'x':round(cx+x*co-z*si,4),'z':round(cz+x*si+z*co,4),'width':round((b-a)*dx,4),'depth':round((d-c)*dz,4),'yaw':f['yaw']})
  for j in range(c,d):
   for i in range(a,b):filled[j][i]=False
 return parts

def output(id,d,buildings,supports,paths=[],water=[],extra={}):
 footprints=[poly(b['rings']) for b in buildings]; shape=unary_union([*footprints,*[poly(r) for r in supports],*[poly(r) for r in water]])
 w,s,e,n=shape.bounds
 result={'version':1,'id':id,'kind':'architecture','origin':d['origin'],'metersPerDegree':d['metersPerDegree'],'extent':[w,s,e,n],'unit':22/max(e-w,n-s),'buildings':buildings,'supports':supports,'paths':paths,'water':water,'source':{'file':f'data/scenes/hangzhou-details/{id}.json','sha256':hashlib.sha256((SRC/(id+'.json')).read_bytes()).hexdigest(),'coordinatePolicy':'Source footprint centres and orientations retained; local grades and facade construction are illustrative.'},**extra}
 (OUT/(id+'.json')).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
 print(id,len(buildings),'buildings',len(supports),'support pieces',len(water),'water pieces',flush=True)
for id in ['lingyin','faxi','xiaohe','hubin-yintai']:
 d=json.loads((SRC/(id+'.json')).read_text());bs=[]
 for b in d['buildings']:
  p=poly(b['rings']); c=p.centroid
  if id=='lingyin' and (not b['name'] or b['name'] in ['翠微亭','灵隐寺','禅堂','方丈楼'] or c.x>80):continue
  if id=='faxi' and not (b['id'].startswith('way/75339088') or b['id'] in ['way/753390879','way/753390878','way/753390890']):continue
  if id=='xiaohe':
   axis=unary_union([LineString(r['points']) for r in d['roads'] if r['name']=='小河直街'])
   if p.distance(axis)>48:continue
  if id=='hubin-yintai' and not ('in77' in b['name'] or b['name']=='Apple Store' or b['id']=='way/109882470'):continue
  f=frame(p); role='side-hall' if id in ['lingyin','faxi'] else 'shop-house' if id=='xiaohe' else 'retail'
  if id=='lingyin' and b['name'] in ['天王殿','大雄宝殿','药师殿','灵隐寺文物展厅','华严殿']:role='main-hall'
  if id=='faxi' and b['id'] in ['way/753390878','way/753390879','way/753390881','way/753390884']:role='main-hall'
  if id in ['lingyin','faxi']:
   level=max(0,round((110-f['z'])/52))*1.8 if id=='lingyin' else max(0,round((90-f['z'])/33))*2.4
   tiers=3 if b['name']=='大雄宝殿' else 2 if role=='main-hall' else 1
   height=33.6 if b['name']=='大雄宝殿' else min(22 if tiers==2 else 12, f['depth']*(.59 if tiers==2 else .43))
  else:level=0;tiers=1;height=15 if b['name']=='Apple Store' else 18 if role=='retail' else 8.2
  # Never assign unverified hall names to Faxi's unnamed footprints.
  bs.append({**b,'frame':f,'parts':fitted_parts(p,f),'role':role,'grade':round(level*.35,2),'eaves':tiers,'displayHeight':height})
 if id=='xiaohe':
  # Keep the continuous historic street-house core. Remote mapped houses
  # stretching the camera across the neighbourhood are not this subject.
  core=max(polygons(unary_union([poly(b['rings']).buffer(6) for b in bs])),key=lambda p:p.area)
  bs=[b for b in bs if core.intersects(poly(b['rings']))]
 roofs=unary_union([poly(b['rings']) for b in bs]); supports=[];paths=[];water=[]
 if id in ['lingyin','faxi']:
  # The plinth hugs buildings and the essential axial court. It is not terrain.
  core=[b for b in bs if b['role']=='main-hall']; core.sort(key=lambda b:-b['frame']['z'])
  connections=[LineString([(a['frame']['x'],a['frame']['z']),(b['frame']['x'],b['frame']['z'])]).buffer(min(a['frame']['width'],b['frame']['width'])*.43,cap_style=2) for a,b in zip(core,core[1:])]
  plate=concave_hull(unary_union([roofs,*connections]),ratio=.44,allow_holes=False).buffer(3.5,join_style=2); supports=packmulti(plate)
  for a,b in zip(core,core[1:]):paths.append({'points':[[a['frame']['x'],a['frame']['z']],[b['frame']['x'],b['frame']['z']]],'startGrade':a['grade'],'endGrade':b['grade'],'width':min(a['frame']['width'],b['frame']['width'])*.28})
 elif id=='xiaohe':
  crop=roofs.envelope.buffer(5);mainPath=axis.intersection(crop);keep=roofs.buffer(3,join_style=2).union(mainPath.buffer(5));waterGeom=unary_union([poly(w['rings']) for w in d['water']]);water=packmulti(waterGeom.intersection(crop).intersection(roofs.buffer(22)).simplify(.2));supports=packmulti(keep.difference(waterGeom));segments=[mainPath] if mainPath.geom_type=='LineString' else [p for p in mainPath.geoms if p.geom_type=='LineString'];paths=[{'name':'小河直街','points':list(p.coords)} for p in segments]
 else:
  # Separate commercial volumes with their own entrance aprons, no neighbourhood.
  supports=packmulti(roofs.buffer(2.5,join_style=2));
 output(id,d,bs,supports,paths,water)
# A clearly disclosed representative Longmen courtyard subject. These are NOT
# fabricated mapped houses: the source has no individual building footprints.
# Its two/three-court typology is attested by Hangzhou's heritage inventory.
id='longmen';d=json.loads((SRC/(id+'.json')).read_text());bs=[];supports=[]
for cluster,(cx,cz,turn) in enumerate([(0,0,0)]):
 for j,(x,z,w,dep,h) in enumerate([(0,-22,21,9,8.4),(0,0,21,8,9.6),(0,22,21,8,7.7),(-9.3,-11,4,14,5.8),(9.3,-11,4,14,5.8),(-9.3,11,4,14,5.8),(9.3,11,4,14,5.8)]):
  x+=cx;z+=cz;p=box(x-w/2,z-dep/2,x+w/2,z+dep/2);bs.append({'id':f'representative-{cluster}-{j}','name':'','rings':packed(p),'frame':frame(p),'role':'courtyard-house','grade':0,'eaves':1,'displayHeight':h,'representative':True})
 supports.extend(packmulti(box(cx-11.5,cz-27.5,cx+11.5,cz+27.5)))
output(id,d,bs,supports,extra={'representation':'Typological courtyard study, not a measured layout or a model of a named individual hall.','typologySource':'https://wbdl.hzwbzx.cn/house?id=160','geographicPlacement':False})
