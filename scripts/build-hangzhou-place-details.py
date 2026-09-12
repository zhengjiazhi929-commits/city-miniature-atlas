#!/usr/bin/env python3
"""Build independent, source-aligned close views. No city data is mutated."""
from pathlib import Path
import sys,json,math,hashlib
APP=Path(__file__).resolve().parents[1]
from PIL import Image
from shapely.geometry import Polygon,LineString,Point,shape,box,mapping,GeometryCollection
from shapely.ops import unary_union,polygonize,transform
from shapely import make_valid,constrained_delaunay_triangles
from shapely.strtree import STRtree
from hangzhou_detail_outline import display_outline

OUT=APP/'data/scenes/hangzhou-details';SOURCE=OUT/'sources'
manifest=json.loads((SOURCE/'manifest.json').read_text())
city=json.loads((APP/'data/hangzhou-atlas/scene-data.json').read_text())
areas={r['id']:r for r in manifest['records'] if 'file' in r}
areas['qiandao']={'id':'qiandao','bbox':[118.994,29.545,119.140,29.650]}
areas.setdefault('zshc',{'id':'zshc','bbox':[120.394,30.212,120.463,30.269]})
dem_cache={};dem_sources={};dem_dir=SOURCE/'dem';dem_dir.mkdir(exist_ok=True)
def elevation(lng,lat,z=12):
 n=2**z;fx=(lng+180)/360*n;fy=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
 tx,ty=math.floor(fx),math.floor(fy);key=f'{z}-{tx}-{ty}'
 if key not in dem_cache:
  p=dem_dir/(key+'.png');url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png'
  if not p.exists():
   raise SystemExit(f'Missing frozen DEM tile: {p}. Restore the tile recorded in sources/dem-manifest.json; this offline rebuild does not download replacements.')
  dem_cache[key]=Image.open(p).convert('RGB');dem_sources[key]={'file':str(p.relative_to(OUT)),'url':url,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 im=dem_cache[key];xx=min(255,(fx-tx)*256);yy=min(255,(fy-ty)*256);x=int(xx);y=int(yy)
 def median(ix,iy):
  values=[]
  for dy in [-1,0,1]:
   for dx in [-1,0,1]:
    r,g,b=im.getpixel((max(0,min(255,ix+dx)),max(0,min(255,iy+dy))));values.append(r*256+g+b/256-32768)
  return sorted(values)[4]
 u=xx-x;v=yy-y
 return max(0,(median(x,y)*(1-u)+median(x+1,y)*u)*(1-v)+(median(x,y+1)*(1-u)+median(x+1,y+1)*u)*v)
def polygons(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 return [p for child in getattr(g,'geoms',[]) for p in polygons(child)]
def lines(g):
 if g.is_empty:return []
 if g.geom_type=='LineString':return [g]
 return [p for child in getattr(g,'geoms',[]) for p in lines(child)]
def union(gs):return make_valid(unary_union(gs)) if gs else GeometryCollection()
def osm_features(raw):
 elements=raw['elements'];nodes={e['id']:[e['lon'],e['lat']] for e in elements if e['type']=='node'}
 ways={e['id']:e for e in elements if e['type']=='way'};result=[]
 for e in ways.values():
  tags=e.get('tags',{});coords=[nodes[n] for n in e['nodes'] if n in nodes]
  if len(coords)!=len(e['nodes']) or len(coords)<2:continue
  g=make_valid(Polygon(coords)) if len(coords)>3 and coords[0]==coords[-1] else LineString(coords)
  result.append((f'way/{e["id"]}',tags,g))
 for e in elements:
  if e['type']!='relation' or e.get('tags',{}).get('type')!='multipolygon':continue
  parts={'outer':[],'inner':[]}
  for m in e.get('members',[]):
   w=ways.get(m['ref']) if m['type']=='way' else None
   if not w:continue
   cs=[nodes[n] for n in w['nodes'] if n in nodes]
   if len(cs)==len(w['nodes']) and len(cs)>1:parts['inner' if m.get('role')=='inner' else 'outer'].append(LineString(cs))
  outer=union(list(polygonize(parts['outer'])));inner=union(list(polygonize(parts['inner'])))
  if not outer.is_empty:result.append((f'relation/{e["id"]}',e.get('tags',{}),make_valid(outer.difference(inner))))
 return result
def packed(g):return [[[round(x,3),round(y,3)] for x,y in ring.coords] for ring in [g.exterior,*g.interiors]]
def number(v,default):
 try:return float(str(v).split(';')[0].replace('m','').strip())
 except:return default

for id,meta in areas.items():
 if len(sys.argv)>1 and id not in sys.argv[1:]:continue
 print('building',id,flush=True)
 bbox=meta['bbox'];origin=[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2];mx=111320*math.cos(math.radians(origin[1]));my=111320
 project=lambda g:transform(lambda x,y,z=None:((x-origin[0])*mx,(origin[1]-y)*my),g)
 coord=lambda p:[origin[0]+p[0]/mx,origin[1]-p[1]/my]
 extent=project(box(*bbox));w,s,e,n=extent.bounds;width=e-w;depth=n-s
 raw=json.loads((SOURCE/meta['file']).read_text()) if 'file' in meta else {'elements':[]}
 features=osm_features(raw)
 extent,outline_method=display_outline(id,features,extent,project);w,s,e,n=extent.bounds;width=e-w;depth=n-s
 local=[(fid,t,make_valid(project(g).intersection(extent))) for fid,t,g in features if g.intersects(box(*bbox))]
 waters=[];greens=[];roads=[];buildings=[]
 for fid,t,g in local:
  if g.is_empty:continue
  if t.get('natural')=='water' or t.get('waterway')=='riverbank' or t.get('landuse')=='reservoir':waters.extend(polygons(g))
  if t.get('landuse') in ['forest','grass','village_green','meadow','orchard'] or t.get('natural') in ['wood','scrub'] or t.get('leisure') in ['park','garden','nature_reserve']:greens.extend(polygons(g))
  if 'highway' in t and t['highway'] not in ['construction','proposed'] and t.get('tunnel')!='yes':
   for line in lines(g):roads.append({'id':fid,'class':t['highway'],'name':t.get('name',''),'bridge':t.get('bridge')=='yes','points':[[round(x,3),round(z,3)] for x,z in line.simplify(.65).coords]})
  if t.get('aeroway')=='taxiway':
   for line in lines(g):roads.append({'id':fid,'class':'taxiway','name':t.get('ref',''),'bridge':False,'points':[[round(x,3),round(z,3)] for x,z in line.simplify(.65).coords]})
  if (t.get('building') not in [None,'no'] or 'building:part' in t):
   for p in polygons(g):
    if p.area<18:continue
    buildings.append({'id':fid,'name':t.get('name',''),'rings':packed(p.simplify(.25,preserve_topology=True)),'height':number(t.get('height'),number(t.get('building:levels'),2)*3.3),'heightMeasured':'height' in t or 'building:levels' in t,'tags':{k:v for k,v in t.items() if k in ['building','building:levels','roof:shape','name','building:part']}})
 # Source city water fills missing large relation extracts, never a new lake.
 if True: # Large relation boundaries can extend beyond an OSM map API crop.
  for row in city['water']:
   g=Polygon(row['rings'][0],row['rings'][1:])
   if g.intersects(box(*bbox)):waters.extend(polygons(make_valid(project(make_valid(g)).intersection(extent))))
 if True: # Merge local detail with verified wider forest, even for partial OSM coverage.
  for row in city['forest']:
   g=Polygon(row['rings'][0],row['rings'][1:])
   if g.intersects(box(*bbox)):greens.extend(polygons(make_valid(project(make_valid(g)).intersection(extent))))
 water=union(waters);green=union(greens).difference(water)
 # Longmen lacks mapped individual houses. Use sourced developed polygons for
 # later representative courtyard placement, preserving actual streets/water.
 urban=[]
 for row in city['urban']:
  g=Polygon(row['rings'][0],row['rings'][1:])
  if g.intersects(box(*bbox)):urban.extend(polygons(make_valid(project(make_valid(g)).intersection(extent)).difference(water)))
 # Remove duplicate whole-building overlaps; parts only fill otherwise empty sites.
 chosen=[];occupied=GeometryCollection()
 for row in sorted(buildings,key=lambda r:('building:part' in r['tags'], -Polygon(r['rings'][0],r['rings'][1:]).area)):
  p=Polygon(row['rings'][0],row['rings'][1:])
  if not extent.buffer(-.02).covers(p):continue
  # 2 cm inward shoreline clearance absorbs the independent millimetre rounding
  # of terrain and footprint vertices. Never move the source water or add land.
  keep=make_valid(p.intersection(extent.buffer(-.02)).difference(water.buffer(.02)).difference(occupied))
  for piece in polygons(keep):
   if piece.area>18:chosen.append({**row,'rings':packed(piece)});occupied=union([occupied,piece])
 buildings=chosen
 nx=100;nz=max(65,round(nx*depth/width));grid=[]
 for iz in range(nz+1):
  for ix in range(nx+1):
   x=w+width*ix/nx;z=s+depth*iz/nz;grid.append([x,elevation(*coord([x,z])),z])
 vertices=[];indices=[];keys={}
 def vert(p):
  k=tuple(round(v,3) for v in p)
  if k not in keys:keys[k]=len(vertices)//3;vertices.extend(k)
  return keys[k]
 for iz in range(nz):
  for ix in range(nx):
   a=iz*(nx+1)+ix;b=a+1;c=a+nx+1;d=c+1
   for ids in [(a,c,b),(b,c,d)]:
    pa,pb,pc=[grid[i] for i in ids];tri=Polygon([(p[0],p[2]) for p in [pa,pb,pc]])
    land=tri.intersection(extent).difference(water)
    den=(pb[2]-pc[2])*(pa[0]-pc[0])+(pc[0]-pb[0])*(pa[2]-pc[2])
    def ht(x,z):
     u=((pb[2]-pc[2])*(x-pc[0])+(pc[0]-pb[0])*(z-pc[2]))/den
     v=((pc[2]-pa[2])*(x-pc[0])+(pa[0]-pc[0])*(z-pc[2]))/den
     return u*pa[1]+v*pb[1]+(1-u-v)*pc[1]
    for poly in polygons(land):
     for t in constrained_delaunay_triangles(poly).geoms:
      ps=list(t.exterior.coords)[:3];vv=[vert([x,ht(x,z),z]) for x,z in ps]
      cross=(ps[1][0]-ps[0][0])*(ps[2][1]-ps[0][1])-(ps[1][1]-ps[0][1])*(ps[2][0]-ps[0][0])
      indices.extend(vv if cross<0 else vv[::-1])
 edges={}
 for i in range(0,len(indices),3):
  for a,b in [(indices[i],indices[i+1]),(indices[i+1],indices[i+2]),(indices[i+2],indices[i])]:
   key=tuple(sorted([a,b]));edges.setdefault(key,{'count':0,'directed':[a,b]});edges[key]['count']+=1
 shore_boundary=extent.difference(water).boundary
 water_rows=[]
 for p in polygons(water):
  samples=list(p.exterior.coords);hs=sorted(elevation(*coord(q)) for q in samples[::max(1,len(samples)//24)])
  level=hs[max(0,len(hs)//5)] if hs else 0
  water_rows.append({'rings':packed(p),'level':round(level,2)})
 output={'version':2,'id':id,'displayOutline':packed(extent),'outlineMethod':outline_method,'bbox':bbox,'origin':origin,'metersPerDegree':[mx,my],'extent':[w,s,e,n],'unit':24/max(width,depth),'heightScale':1.4 if id in ['tianmu','qiandao'] else 1,
  'terrain':{'positions':vertices,'indices':indices,'edges':[v['directed'] for k,v in edges.items() if v['count']==1 and shore_boundary.distance(Point((vertices[k[0]*3]+vertices[k[1]*3])/2,(vertices[k[0]*3+2]+vertices[k[1]*3+2])/2))<.02]},'water':water_rows,'green':[packed(p) for p in polygons(green)],'urban':[packed(p) for p in urban],
  'roads':roads,'buildings':buildings,'source':{'osm':meta,'dem':'sources/dem-manifest.json','cityFallbackSha256':hashlib.sha256((APP/'data/hangzhou-atlas/scene-data.json').read_bytes()).hexdigest()},
  'policy':'Independent content-led display outline, not administrative boundary. Source footprints, water and paths retained; roof/window forms, missing heights and representative vegetation are artistic detail. Longmen houses are representative within sourced urban land.'}
 (OUT/(id+'.json')).write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')))
 print(id,'buildings',len(buildings),'roads',len(roads),'water',len(water_rows),'triangles',len(indices)//3,flush=True)
prior={r['file']:r for r in json.loads((SOURCE/'dem-manifest.json').read_text()).get('tiles',[])} if (SOURCE/'dem-manifest.json').exists() else {}
prior.update({r['file']:r for r in dem_sources.values()})
(SOURCE/'dem-manifest.json').write_text(json.dumps({'provider':'AWS Terrain Tiles / Mapzen Terrarium','zoom':12,'nativeResolutionApproxMeters':30,'processing':'Median of 3x3 decoded heights followed by bilinear resampling; removes isolated DEM spikes without moving horizontal features' ,'tiles':list(prior.values())},indent=2))
