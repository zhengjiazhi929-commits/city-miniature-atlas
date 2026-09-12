#!/usr/bin/env python3
"""Read-only public OSM details, stored once with exact URL/time/hash."""
import json, hashlib, urllib.request, time
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
OUT=APP/'data/scenes/hangzhou-details/sources'
OUT.mkdir(parents=True,exist_ok=True)
BOXES={
 'xiaohe':[120.1268,30.3075,120.1339,30.3140],
 'faxi':[120.0856,30.2268,120.0930,30.2336],
 'lingyin':[120.0928,30.2394,120.1008,30.2470],
 'longmen':[119.9400,29.8950,119.9550,29.9090],
 'tianmu':[119.417,30.319,119.454,30.359],
 'xixi':[120.049,30.255,120.078,30.281],
 'olympic':[120.216,30.222,120.239,30.244],
 'hubin-yintai':[120.1538,30.2520,120.1613,30.2595],
 'zshc':[120.394,30.212,120.463,30.269],
}
previous={r['id']:r for r in json.loads((OUT/'manifest.json').read_text()).get('records',[])} if (OUT/'manifest.json').exists() else {}
records=[]
for key,box in BOXES.items():
 f=OUT/(key+'-osm.json');url='https://api.openstreetmap.org/api/0.6/map.json?bbox='+','.join(map(str,box))
 if not f.exists():
  error=None
  for attempt in range(2):
   try:
    req=urllib.request.Request(url,headers={'User-Agent':'ChinaMiniatureAtlas/0.20 (source-backed local visualization)'})
    raw=urllib.request.urlopen(req,timeout=45).read();d=json.loads(raw)
    assert 'elements' in d
    f.write_bytes(raw);error=None;break
   except Exception as e:error=str(e)
  if error:records.append({'id':key,'bbox':box,'url':url,'error':error});print(key,'FAILED',error,flush=True);continue
 raw=f.read_bytes();d=json.loads(raw)
 digest=hashlib.sha256(raw).hexdigest()
 fetchedAt=previous[key]['fetchedAt'] if key in previous and previous[key].get('sha256')==digest else time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
 records.append({'id':key,'bbox':box,'url':url,'file':f.name,'sha256':digest,'bytes':len(raw),'fetchedAt':fetchedAt,'elements':len(d['elements'])})
 print(key,len(d['elements']),len(raw),flush=True)
(OUT/'manifest.json').write_text(json.dumps({'attribution':'© OpenStreetMap contributors · ODbL 1.0','policy':'Live source snapshots for independent close views only. Not a measured architectural survey. No replacements for the frozen city terrain/boundary.','records':records},ensure_ascii=False,indent=2))
if any('error' in r for r in records):raise RuntimeError('Incomplete sources; inspect manifest rather than invent missing features.')
