"""Extract place-specific details from archived source ways/nodes.

Source coordinates are retained. Named buildings are never invented from POIs.
Boats, reeds and individual trees are illustrative populations at runtime.
"""
from pathlib import Path
import sys,json,math,hashlib
APP=Path(__file__).resolve().parents[1]
from shapely.geometry import Polygon,LineString,Point
from shapely.ops import unary_union
OUT=APP/'data/scenes/hangzhou-subjects'
def merc(p):return [(p[0]+180)/360,(1-math.asinh(math.tan(math.radians(p[1])))/math.pi)/2]
def lines(g):
 if g.is_empty:return []
 if g.geom_type=='LineString':return [g]
 return [p for q in getattr(g,'geoms',[]) for p in lines(q)]
for id in ['westlake','xixi','qiandao','tianmu']:
 p=OUT/(id+'.json');d=json.loads(p.read_text())
 upstream=json.loads((APP/d['source']['file']).read_text())
 if id=='westlake':
  pr=upstream['projection'];origin=merc(pr['origin'])
  project=lambda p:tuple((v-origin[i])*pr['metresPerMercator'] for i,v in enumerate(merc(p)))
  src=OUT/'sources/westlake-osm.json'
 else:
  ox,oz=upstream['origin'];mx,mz=upstream['metersPerDegree']
  project=lambda p:((p[0]-ox)*mx,(oz-p[1])*mz)
  src=APP/f'data/scenes/hangzhou-details/sources/{id}-osm.json'
 if id=='qiandao':src=OUT/'sources/qiandao-osm.json'
 raw=json.loads(src.read_text());elements=raw['elements']
 nodes={e['id']:e for e in elements if e['type']=='node'}
 outline=unary_union([Polygon(r[0],r[1:]) for r in d['outline']])
 water=unary_union([Polygon(w['rings'][0],w['rings'][1:]) for w in d['water']])
 land=outline.difference(water)
 d['paths']=[];d['features']=[]
 for e in elements:
  tags=e.get('tags',{});name=tags.get('name','')
  if e['type']=='way':
   ns=e.get('nodes',[])
   if len(ns)<2 or any(n not in nodes for n in ns):continue
   coords=[project([nodes[n]['lon'],nodes[n]['lat']]) for n in ns]
   if tags.get('highway') in ['pedestrian','path','footway','steps','unclassified']:
    wanted=(id=='westlake' and (name in ['苏堤','白堤','映波桥','锁澜桥','望山桥','压堤桥','东浦桥','跨虹桥','断桥','锦带桥'] or (tags.get('highway') in ['path','footway','steps'] and 120.138<sum(nodes[n]['lon'] for n in ns)/len(ns)<120.1425 and 30.240<sum(nodes[n]['lat'] for n in ns)/len(ns)<30.243))) or (id=='tianmu' and tags.get('highway') in ['path','steps']) or (id=='xixi' and tags.get('highway') in ['path','footway','steps'])
    if wanted:
     for segment in lines(LineString(coords).intersection(outline.buffer(-2))):
      if segment.length>5:d['paths'].append({'id':f"way/{e['id']}",'name':name,'points':[[round(x,4),round(z,4)] for x,z in segment.coords],'bridge':tags.get('bridge')=='yes','class':tags['highway']})
   if id=='westlake' and tags.get('building') and name=='湖心亭':
    shape=Polygon(coords);center=shape.centroid
    d['features'].append({'id':f"way/{e['id']}",'name':name,'kind':'pavilion','local':[center.x,center.y],'width':44,'height':42,'basis':'Source building center; enlarged exterior pavilion study.'})
  if e['type']=='node' and id=='westlake':
   kinds={'三潭石塔':'stone-pagodas','我心相印亭':'pavilion','开网亭':'pavilion','南舒亭':'pavilion'}
   if name in kinds:
    x,z=project([e['lon'],e['lat']])
    if outline.covers(Point(x,z)):
     d['features'].append({'id':f"node/{e['id']}",'name':name,'kind':kinds[name],'local':[x,z],'width':34,'height':25,'basis':'Source POI anchor; representative enlarged structure, not surveyed dimensions.'})
 d['source']['featureOSM']={'file':str(src.relative_to(APP)),'sha256':hashlib.sha256(src.read_bytes()).hexdigest()}
 d['identity']={
  'westlake':{'title':'两堤三岛 · 烟柳石桥','basis':'Mapped Sudi/Baidi and six named Sudi bridges; mapped island pavilions; stone-pagoda group around source tower POI.'},
  'xixi':{'title':'秋芦水巷 · 摇橹入画','basis':'Mapped wetland around Qiu Xue An. Reed and boat types from Hangzhou 2022 official scenic description. No invented Qiu Xue An footprint.'},
  'qiandao':{'title':'青峰成岛 · 碧水金岸','basis':'OSM relation 162908 island shores and local DEM; visitor cruise boats and exposed-bank appearance illustrative, not a recorded water level or route.'},
  'tianmu':{'title':'古柳杉林 · 石径入山','basis':'Mapped West Tianmu terrain and paths. Cryptomeria, broadleaf canopy and understory are representative vegetation types, not individually located protected trees.'},
 }[id]
 # Store compact oriented frames for the existing mapped wetland houses.
 for item in d['buildings']:
  shape=Polygon(item['rings'][0],item['rings'][1:]);r=list(shape.minimum_rotated_rectangle.exterior.coords);a,c=r[:2];w=math.dist(a,c);depth=math.dist(r[1],r[2]);center=shape.minimum_rotated_rectangle.centroid
  item['frame']={'x':center.x,'z':center.y,'width':w,'depth':depth,'yaw':-math.atan2(c[1]-a[1],c[0]-a[0])}
 p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')))
 print(id,'paths',len(d['paths']),'features',len(d['features']),'buildings',len(d['buildings']))
