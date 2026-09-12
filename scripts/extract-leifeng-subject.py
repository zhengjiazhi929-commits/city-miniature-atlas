#!/usr/bin/env python3
"""Lossless GLB subtree extraction: retain the tower, remove terrain and textures."""
from pathlib import Path
import json,struct,copy,hashlib
APP=Path(__file__).resolve().parents[1];src=APP/'data/scenes/leifeng/scene.glb';raw=src.read_bytes();jn=struct.unpack_from('<I',raw,12)[0];old=json.loads(raw[20:20+jn]);bn=struct.unpack_from('<I',raw,20+jn)[0];binary=raw[28+jn:28+jn+bn]
tower=next(i for i,n in enumerate(old['nodes']) if n.get('name','').startswith('Leifeng Pagoda'))
ids=[]
def visit(i):
 ids.append(i)
 for c in old['nodes'][i].get('children',[]):visit(c)
visit(tower);root=old['scenes'][old.get('scene',0)]['nodes'][0];ids=[root]+ids
nodeMap={v:i for i,v in enumerate(ids)};meshes=sorted({old['nodes'][i]['mesh'] for i in ids if 'mesh' in old['nodes'][i]});meshMap={v:i for i,v in enumerate(meshes)};materials=sorted({p['material'] for i in meshes for p in old['meshes'][i]['primitives'] if 'material' in p});matMap={v:i for i,v in enumerate(materials)}
accessors=sorted({v for i in meshes for p in old['meshes'][i]['primitives'] for v in [*p['attributes'].values(),*([p['indices']] if 'indices' in p else [])]});amap={v:i for i,v in enumerate(accessors)};views=sorted({old['accessors'][i]['bufferView'] for i in accessors});vmap={v:i for i,v in enumerate(views)}
new={'asset':old['asset'],'scene':0,'scenes':[{'nodes':[0]}],'nodes':[],'meshes':[],'materials':[old['materials'][i] for i in materials],'accessors':[],'bufferViews':[]};out=bytearray()
for i in ids:
 n=copy.deepcopy(old['nodes'][i]);n['children']=[nodeMap[c] for c in n.get('children',[]) if c in nodeMap]
 if 'mesh' in n:n['mesh']=meshMap[n['mesh']]
 new['nodes'].append(n)
for i in meshes:
 m=copy.deepcopy(old['meshes'][i])
 for p in m['primitives']:
  p['attributes']={k:amap[v] for k,v in p['attributes'].items()}
  if 'indices' in p:p['indices']=amap[p['indices']]
  if 'material' in p:p['material']=matMap[p['material']]
 new['meshes'].append(m)
for i in views:
 v=copy.deepcopy(old['bufferViews'][i]);b=v.get('byteOffset',0);chunk=binary[b:b+v['byteLength']];out.extend(b'\0'*((-len(out))%4));v['byteOffset']=len(out);v['buffer']=0;out.extend(chunk);new['bufferViews'].append(v)
for i in accessors:
 a=copy.deepcopy(old['accessors'][i]);a['bufferView']=vmap[a['bufferView']];new['accessors'].append(a)
# The tower's materials are untextured. Fail rather than silently break a future asset.
assert all('Texture' not in json.dumps(m) for m in new['materials'])
new['buffers']=[{'byteLength':len(out)}];new['extras']={'sourceFile':'data/scenes/leifeng/scene.glb','sha256':hashlib.sha256(raw).hexdigest(),'policy':'Lossless tower and preservation podium subtree; source transforms and geometry retained.'}
j=json.dumps(new,ensure_ascii=False,separators=(',',':')).encode();j+=b' '*((-len(j))%4);out.extend(b'\0'*((-len(out))%4));payload=struct.pack('<III',0x46546c67,2,28+len(j)+len(out))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(out),0x004e4942)+out;target=APP/'data/scenes/hangzhou-subjects/leifeng.glb';target.write_bytes(payload);print('tower only',len(payload),'bytes',len(new['meshes']),'meshes')
