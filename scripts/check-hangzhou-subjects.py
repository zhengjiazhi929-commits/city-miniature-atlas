"""Independent source/shoreline integrity checks for the rendered subject bundles."""
from pathlib import Path
import sys,json,hashlib,math
APP=Path(__file__).resolve().parents[1]
from shapely.geometry import Polygon,LineString
from shapely.ops import unary_union
bundle=APP/'data/scenes/hangzhou-subjects';report={'sources':[],'landWater':[]}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def polygon(r):return Polygon(r[0],r[1:])
for path in sorted(bundle.glob('*.json')):
 d=json.loads(path.read_text());source=APP/d['source']['file'];assert digest(source)==d['source']['sha256'],path.name+' upstream changed'
 report['sources'].append({'id':d['id'],'sha256':digest(path),'upstream':d['source']['sha256']})
 if d['kind']=='architecture':
  if d['id']=='longmen':assert d['geographicPlacement'] is False and all(b['representative'] for b in d['buildings'])
  else:
   originals={b['id']:b for b in json.loads(source.read_text())['buildings']}
   for b in d['buildings']:assert b['rings']==originals[b['id']]['rings'],b['id']+' moved source footprint'
  continue
 p=d['terrain']['positions'];ix=d['terrain']['indices'];assert all(math.isfinite(v) for v in p)
 actual=unary_union([Polygon([(p[k*3],p[k*3+2]) for k in ix[i:i+3]]) for i in range(0,len(ix),3)])
 water=unary_union([polygon(w['rings']) for w in d['water']]);outline=unary_union([polygon(r) for r in d['outline']]);land=outline.difference(water);overlap=actual.intersection(water).area;missing=land.difference(actual).area
 # Independent 0.1% area tolerance accommodates sub-mm serialized coordinates.
 assert missing/land.area<.001 and overlap/land.area<.001,(d['id'],missing,overlap)
 precise=d['source'].get('preciseWater')
 if precise:
  assert digest(bundle/'sources'/precise['file'])==precise['sha256']
  for tile in d['source']['demTiles']:assert digest(APP/'data/scenes/hangzhou-details/sources/dem'/tile['file'])==tile['sha256']
  if d['id']=='westlake':assert len(precise['completeMemberWays'])==precise['totalRelationMembers']
 featureSource=d['source'].get('featureOSM')
 if featureSource:
  archived=APP/featureSource['file'];assert digest(archived)==featureSource['sha256']
  elements=json.loads(archived.read_text())['elements'];nodes={e['id']:e for e in elements if e['type']=='node'};ways={e['id']:e for e in elements if e['type']=='way'}
  upstream=json.loads(source.read_text())
  if d['id']=='westlake':
   pr=upstream['projection']
   def merc(p):return [(p[0]+180)/360,(1-math.asinh(math.tan(math.radians(p[1])))/math.pi)/2]
   origin=merc(pr['origin']);project=lambda p:tuple((v-origin[i])*pr['metresPerMercator'] for i,v in enumerate(merc(p)))
  else:
   ox,oz=upstream['origin'];mx,mz=upstream['metersPerDegree'];project=lambda p:((p[0]-ox)*mx,(oz-p[1])*mz)
  for path in d.get('paths',[]):
   way=ways[int(path['id'].split('/')[1])];original=LineString([project([nodes[n]['lon'],nodes[n]['lat']]) for n in way['nodes']])
   assert LineString(path['points']).difference(original.buffer(.001)).length<.001,(d['id'],path['id'],'source path moved')
  if d['id']=='westlake':
   names={p['name'] for p in d['paths']}
   assert {'映波桥','锁澜桥','望山桥','压堤桥','东浦桥','跨虹桥'}<=names
  if d['id']=='xixi':assert max(d['extent'][2]-d['extent'][0],d['extent'][3]-d['extent'][1])<650,'Wetland crop expanded too far'
 report['landWater'].append({'id':d['id'],'landAreaM2':land.area,'missingM2':missing,'overlapM2':overlap,'sourceWaterRelation':precise['relation'] if precise else None})
report['passed']=True
print(json.dumps(report,ensure_ascii=False,indent=2))
