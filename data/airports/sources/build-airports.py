"""Rebuild compact visual airport footprints from frozen public OSM snapshots.
No network requests; airport/runway status is independently source-checked below.
"""
import json, math, pathlib, datetime, hashlib, sys

HERE=pathlib.Path(__file__).resolve().parent
OUT=HERE.parent
CONFIG={
 'hangzhou':{
  'name':'杭州萧山国际机场','icao':'ZSHC','iata':'HGH','files':['hangzhou-osm-map-central.json'],
  'dimensions':{'06/24':[3400,60],'07/25':[3600,45]},
  'statusSource':'https://www.hzairport.com/party/detail/id/6369.html',
  'dimensionSource':'https://hznews.hangzhou.com.cn/chengshi/content/2012-11/07/content_4464282_2.htm',
  'officialSources':[
   {'url':'https://www.hzairport.com/party/detail/id/6369.html','role':'机场2025年运行资料确认双跑道；24号跑道验证试飞。'},
   {'url':'https://www.hzairport.com/mobile/tender/detail/id/5752.html','role':'第三条跑道属于四期扩建可研，不作为现役跑道。'},
   {'url':'https://www.hzairport.com/en/tender/detail/id/6037.html','role':'2026航站楼状态：目前在用T3（原T3、T1）与T4；T4南区预计2026-12-01投运，非截至本快照日期已开放。'},
   {'url':'https://www.hzairport.com/upload/file/2022-08/1661252661462927.pdf','role':'机场官方T4平面图，核对指廊形态；不作为测量坐标。'},
  ],
  'notes':['仅两条现役跑道；四期规划新增跑道未加入。','OSM保留原T1命名，其实体属于当前T3（原T3、T1）综合区域；T2建筑保留，不能由建筑存在推断正在处理客运。','T4实际建筑外轮廓存在，但南区并非本快照日期已开放；首版只画建筑，不模拟航司/登机口运营。'],
 },
 'hong-kong':{
  'name':'香港国际机场','icao':'VHHH','iata':'HKG','files':['hong-kong-west-osm-map.json','hong-kong-east-osm-map.json','hong-kong-northeast-osm-map.json','hong-kong-southwest-osm-map.json'],
  'dimensions':{'07L/25R':[3800,60],'07C/25C':[3800,60],'07R/25L':[3800,60]},
  'statusSource':'https://threerunwaysystem.hongkongairport.com/en/three-runway-system/project-updates/hong-kong-international-airport-commissions-three-runway-system/',
  'dimensionSource':'https://www.ais.gov.hk/eaip_20260903/2026-09-03-000000/html/eAIP/VH-AD-2-VHHH-en-US.html',
  'officialSources':[
   {'url':'https://www.ais.gov.hk/eaip_20260903/2026-09-03-000000/html/eAIP/VH-AD-2-VHHH-en-US.html','role':'当前2026-09-03 eAIP AD2.12/2.13，跑道编号、宽度、公布长度与内移阈值。'},
   {'url':'https://www.ais.gov.hk/eaip_20260903/2026-09-03-000000/pdf/VH-AD-2-VHHH-ADC-1.pdf','role':'当前官方机场总平面航图。'},
   {'url':'https://www.hongkongairport.com/en/media-centre/press-release/2026/pr_1868','role':'T2出发设施2026-05-27启用；T2C新登机廊为后续阶段。'},
   {'url':'https://www.hongkongairport.com/en/map/','role':'机场官方旅客地图。'},
  ],
  'notes':['2024-11-28起三条跑道同时运行。','航图THR是阈值而非全部物理铺装端点，本文件points取OSM中心线端点，不把THR坐标当跑道物理端点。','T2出发设施已于2026-05-27启用；不把规划/后续T2C登机廊误作已全面启用。'],
 },
 'wuhan':{
  'name':'武汉天河国际机场','icao':'ZHHH','iata':'WUH','files':['wuhan-central-osm-map.json'],
  'dimensions':{'04/22':[3400,45],'05L/23R':[3600,60],'05R/23L':[3200,45]},
  'statusSource':'https://www.wuhan.gov.cn/sy/whyw/202501/t20250123_2524244.shtml',
  'dimensionSource':'https://www.wuhan.gov.cn/sy/whyw/202206/t20220627_1994221.shtml',
  'officialSources':[
   {'url':'https://www.wuhan.gov.cn/sy/whyw/202501/t20250123_2524244.shtml','role':'2025-01-23三跑道正式运行及现行编号04/22、05L/23R、05R/23L。'},
   {'url':'https://www.wuhan.gov.cn/sy/whyw/202206/t20220627_1994221.shtml','role':'西/第一3400×45米、东内/第二3600×60米。'},
   {'url':'https://www.caac.gov.cn/PHONE/XWZX/HYDT/202308/t20230815_221002.html','role':'东外/第三3200×45米。'},
   {'url':'https://www.csair.com/sg/zh/tourguide/airport_service/airports_info/domestic/18h97q3mp508j.shtml','role':'南航官方机场指南及T3交通平面图；无版本日期，不单独作为三跑道现状来源。'},
   {'url':'https://www.hbbidcloud.cn/hubei/jyxx/004002/004002006/20260717/554db677-096f-4a09-8c12-986b9f880017.html','role':'2026机场采购公告：T2/T3客运使用，T1公务机/贵宾及联合运控用途。'},
  ],
  'notes':['包含2025-01-23已投入运行的第三跑道，不能继续使用两跑道旧版。','三座航站楼不等于三个普通客运航站楼；公务机楼作为已建基础设施保留并单独标识用途。'],
 },
}

def haversine(a,b):
 p1,p2=map(math.radians,[a[1],b[1]]);dp=p2-p1;dl=math.radians(b[0]-a[0]);return 6371008.8*2*math.asin(min(1,math.sqrt(math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2)))
def bearing(a,b):
 p1,p2=map(math.radians,[a[1],b[1]]);d=math.radians(b[0]-a[0]);return(math.degrees(math.atan2(math.sin(d)*math.cos(p2),math.cos(p1)*math.sin(p2)-math.sin(p1)*math.cos(p2)*math.cos(d)))+360)%360
def destination(point,heading,distance):
 # Short great-circle extrapolation from official WGS84 THR coordinates.
 # At 174m the spherical-vs-ellipsoidal difference is below visual-map scale.
 lng,lat=map(math.radians,point);a=math.radians(heading);d=distance/6371008.8
 p=math.asin(math.sin(lat)*math.cos(d)+math.cos(lat)*math.sin(d)*math.cos(a))
 l=lng+math.atan2(math.sin(a)*math.sin(d)*math.cos(lat),math.cos(d)-math.sin(lat)*math.sin(p))
 return [round(math.degrees(l),8),round(math.degrees(p),8)]
def source(e):
 return {'url':f"https://www.openstreetmap.org/{e['type']}/{e['id']}",'osmType':e['type'],'osmId':e['id'],'osmVersion':e.get('version'),'sourceTimestamp':e.get('timestamp'),'role':'OSM WGS84 mapped geometry; visual reference, not a surveyed airport operational dataset'}
def inside(p,r):
 yes=False
 for a,b in zip(r,r[1:]+r[:1]):
  if(a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:yes=not yes
 return yes
def signed_area(r):return .5*sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(r,r[1:]))
def valid_ring(r):
 if len(r)<4 or r[0]!=r[-1]:raise ValueError('Unclosed source ring')
 if abs(signed_area(r))<1e-12:raise ValueError('Degenerate source ring')
 return r
def number(v):
 if v is None:return None
 try:return float(str(v).split()[0])
 except ValueError:return None

def build(city):
 cfg=CONFIG[city];elements={};snapshots=[]
 for filename in cfg['files']:
  path=HERE/filename;raw=json.loads(path.read_text())
  for e in raw['elements']:elements[(e['type'],e['id'])]=e
  snapshots.append({'path':'sources/'+filename,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'generator':raw.get('generator'),'copyright':raw.get('copyright')})
 def way_points(e):
  return [[elements[('node',n)]['lon'],elements[('node',n)]['lat']] for n in e['nodes']]
 def join(parts):
  pending=[part[:] for part in parts];done=[]
  while pending:
   current=pending.pop(0)
   while current[0]!=current[-1]:
    matched=False
    for i,p in enumerate(pending):
     if current[-1]==p[0]:current+=p[1:]
     elif current[-1]==p[-1]:current+=p[-2::-1]
     elif current[0]==p[-1]:current=p[:-1]+current
     elif current[0]==p[0]:current=p[:0:-1]+current
     else:continue
     pending.pop(i);matched=True;break
    if not matched:raise ValueError('Relation ring not complete in snapshot')
   done.append(valid_ring(current))
  return done
 def polygons(e):
  if e['type']=='way':return[[valid_ring(way_points(e))]]
  outer=[];inner=[]
  for m in e.get('members',[]):
   if m['type']!='way':continue
   w=elements[('way',m['ref'])]
   (inner if m.get('role')=='inner' else outer).append(way_points(w))
  outers=join(outer);inners=join(inner);return[[r]+[h for h in inners if inside(h[0],r)] for r in outers]

 nom=json.loads((HERE/(city+'-nominatim.json')).read_text())
 nominated=next(x for x in nom if x.get('type')=='aerodrome')
 airport=elements.get((nominated['osm_type'],nominated['osm_id']))
 if airport is None:raise ValueError('Missing actual airport source element')
 geometry=nominated['geojson'];boundary=geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
 for poly in boundary:
  for ring in poly:valid_ring(ring)
 anchor=[float(nominated['lon']),float(nominated['lat'])]
 runways=[];terminals=[];aprons=[];omitted=[];groups={}
 for e in elements.values():
  tags=e.get('tags',{})
  if tags.get('aeroway')=='runway':groups.setdefault(tags.get('ref',''),[]).append(e)
 for ref,parts in groups.items():
  if ref not in cfg['dimensions']:
   omitted.append({'kind':'runway','ref':ref,'source':[source(x) for x in parts],'reason':'Not in independently verified current-runway designator set'});continue
  points=[p for part in parts for p in way_points(part)]
  # One runway can be split across multiple OSM ways. Consolidate by verified
  # designator; the farthest mapped centreline vertices recover its two ends.
  a,b=max(((a,b) for i,a in enumerate(points) for b in points[i+1:]),key=lambda p:haversine(*p))
  designators=ref.split('/');target=int(designators[0][:2])*10
  if abs((bearing(a,b)-target+180)%360-180)>90:a,b=b,a
  length,width=cfg['dimensions'][ref];mapped=haversine(a,b)
  item={'id':ref.replace('/','-'),'designators':designators,'points':[a,b],'widthMeters':width,'publishedLengthMeters':length,'geometryLengthMeters':round(mapped,2),'bearingTrueDegrees':round(bearing(a,b),3),'status':'operational','statusSource':cfg['statusSource'],'dimensionSource':cfg['dimensionSource'],'source':[source(x) for x in parts],'pointRole':'Endpoints of the mapped physical runway centreline, not automatically displaced landing thresholds','elevationMeters':number(airport.get('tags',{}).get('ele'))}
  if city=='hong-kong' and ref=='07L/25R':
   # OSM's NE displaced-threshold segment extends ~348m beyond 25R THR,
   # versus the current official174m. Keep the discrepancy visible in metadata.
   thr07=[113+52/60+56.26/3600,22+19/60+17.72/3600]
   thr25=[113+54/60+50.24/3600,22+19/60+54.45/3600]
   ends=[destination(thr07,250.90,174),destination(thr25,70.90,174)]
   item.update({'sourceMappedPoints':[a,b],'sourceMappedLengthMeters':round(mapped,2),'points':ends,'geometryLengthMeters':round(haversine(*ends),2),'bearingTrueDegrees':round(bearing(*ends),3),'pointRole':'Derived visual-map physical ends: official current WGS84 THR coordinates extrapolated outward174m along the published true runway bearing; not raw OSM endpoints','pointSource':{'url':cfg['dimensionSource'],'section':'VHHH AD2.12–2.13 and ADC-1','thresholds':{'07L':thr07,'25R':thr25},'outwardDisplacementMeters':[174,174],'trueBearingDegrees':70.90,'derivation':'short great-circle destination, radius6371008.8m; display-map calculation'},'sourceDiscrepancy':'OSM NE displaced-threshold way1034755024 extends~348m beyond25R THR, inconsistent with current official174m. Original mapped ends retained for audit; official end relationship takes precedence.'})
  if city=='hong-kong' and ref=='07C/25C':
   item['pointRole']='Mapped complete paved centreline; the two published3800m directional runway extents have offset start/end locations, shown by current official ADC-1. This is not a4220m TORA claim.'
   item['layoutCrosscheckSource']='https://www.ais.gov.hk/eaip_20260903/2026-09-03-000000/pdf/VH-AD-2-VHHH-ADC-1.pdf'
  if abs(item['geometryLengthMeters']-length)>50:item['geometryLengthNote']='Mapped physical centreline includes an end/pavement extent that differs from published runway length. Do not reinterpret these endpoints as declared landing thresholds; see NOTICE and current official chart.'
  runways.append(item)
 if len(runways)!=len(cfg['dimensions']):raise ValueError(f'{city}: current runway missing: {set(cfg["dimensions"])-set(groups)}')
 relations=[e for e in elements.values() if e['type']=='relation' and e.get('tags',{}).get('aeroway') in ['terminal','apron']]
 member_ids={(m['type'],m['ref']) for e in relations for m in e.get('members',[]) if m['type']=='way'}
 for key,e in elements.items():
  t=e.get('tags',{});kind=t.get('aeroway')
  if kind not in ['terminal','apron'] or key in member_ids:continue
  if t.get('construction') or t.get('disused')=='yes':
   omitted.append({'kind':kind,'source':source(e),'reason':'OSM marks construction/disused'});continue
  try:polys=polygons(e)
  except (KeyError,ValueError) as exc:
   omitted.append({'kind':kind,'source':source(e),'reason':str(exc)});continue
  for n,rings in enumerate(polys):
   f={'id':f"osm-{e['type']}-{e['id']}"+(f'-part-{n+1}' if len(polys)>1 else ''),'name':t.get('name',t.get('ref','航站附属建筑' if kind=='terminal' else '停机坪')),'rings':rings,'heightMeters':number(t.get('height')),'levels':number(t.get('building:levels')),'source':source(e),'status':'mapped-existing-structure'}
   if city=='hangzhou' and e['id']==16330394:f['name']='T3原T1区域';f['operationalNote']='OSM原名1号航站楼；2026机场官方称T3（原T3、T1）。'
   if city=='hangzhou' and e['id']==775893371:f['operationalNote']='T2实体存在；机场2026公告列目前在用T3与T4，未据此声称T2当前客运开放。'
   if city=='hangzhou' and e['id']==776023304:f['operationalNote']='T4南区预计2026-12-01投运；建筑外形不等于所有区域已开放。'
   if city=='hong-kong' and e['id']==1204348925:f['operationalNote']='T2出发设施2026-05-27启用；不代表后续T2C登机廊已开放。'
   if city=='wuhan' and e['id']==478584484:f['operationalNote']='公务机/贵宾用途，不作为普通客运T1。'
   (terminals if kind=='terminal' else aprons).append(f)
 runway_order={'07L/25R':0,'07C/25C':1,'07R/25L':2}
 runways.sort(key=lambda r:runway_order.get('/'.join(r['designators']),r['designators'][0]))
 airport_source=source(airport)
 result={'schemaVersion':1,'id':cfg['icao'].lower(),'cityId':city,'name':cfg['name'],'icao':cfg['icao'],'iata':cfg['iata'],'kind':'civil-passenger-airport','countsAsAttraction':False,'crs':'EPSG:4326','snapshotDate':'2026-09-09','coordinates':anchor,'anchor':{'source':airport_source,'role':'Nominatim representative point of the named OSM aerodrome area; not a surveyed ARP or terminal entrance'},'elevationMeters':number(airport.get('tags',{}).get('ele')),'boundary':boundary,'boundarySource':airport_source,'boundaryRole':'Mapped aerodrome land-use boundary for vegetation/building exclusion; not a security or property survey boundary','runways':runways,'terminals':terminals,'aprons':aprons,'aircraftStands':[],'sources':cfg['officialSources']+[{'url':'https://www.openstreetmap.org/copyright','role':'Geometry © OpenStreetMap contributors, ODbL 1.0'}],'sourceSnapshots':snapshots,'omittedSourceFeatures':omitted,'notes':cfg['notes']+['实体高度缺失时heightMeters为null；渲染器可用明确标注的展示高度，不能冒充实测高度。','不添加未经核实的停机位、飞机、航司运行区域或航空运行设施细节。'],'stats':{'runways':len(runways),'terminalPolygons':len(terminals),'apronPolygons':len(aprons),'boundaryPolygons':len(boundary),'omittedSourceFeatures':len(omitted)}}
 (OUT/(city+'.json')).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
 print(city,json.dumps(result['stats']),[(r['id'],r['points'],r['geometryLengthMeters']) for r in runways])

if __name__=='__main__':
 for city in sys.argv[1:] or CONFIG:build(city)
