"""Read archived OSM relations and local DEM tiles; never mutate source data."""
from pathlib import Path
import json, math, hashlib
from PIL import Image
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union, polygonize
from shapely import make_valid

def osm_geometry(path, project, relation_id):
 raw=json.loads(path.read_text());nodes={e['id']:[e['lon'],e['lat']] for e in raw['elements'] if e['type']=='node'};ways={e['id']:e for e in raw['elements'] if e['type']=='way'}
 relation=next(e for e in raw['elements'] if e['type']=='relation' and e['id']==relation_id);parts={'inner':[],'outer':[]};complete=[]
 for m in relation['members']:
  way=ways.get(m['ref']) if m['type']=='way' else None
  if not way or any(n not in nodes for n in way['nodes']):continue
  coords=[project(nodes[n]) for n in way['nodes']];role='inner' if m.get('role')=='inner' else 'outer'
  parts[role].append(LineString(coords));complete.append(way['id'])
 inner=make_valid(unary_union(list(polygonize(parts['inner']))));outer=make_valid(unary_union(list(polygonize(parts['outer']))))
 return make_valid(outer.difference(inner)),inner,{'file':str(path.name),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'relation':relation_id,'completeMemberWays':complete,'totalRelationMembers':len(relation['members'])}

class LocalDEM:
 def __init__(self, directory):self.directory=directory;self.images={};self.sources={}
 def sample(self,coord):
  lng,lat=coord;n=4096;fx=(lng+180)/360*n;fy=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n;tx,ty=math.floor(fx),math.floor(fy);key=f'12-{tx}-{ty}';p=self.directory/(key+'.png')
  if key not in self.images:
   self.images[key]=Image.open(p).convert('RGB');self.sources[key]={'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  im=self.images[key];xx=min(255,(fx-tx)*256);yy=min(255,(fy-ty)*256);x,y=int(xx),int(yy);u,v=xx-x,yy-y
  def median(ix,iy):
   values=[]
   for dz in [-1,0,1]:
    for dx in [-1,0,1]:
     r,g,b=im.getpixel((max(0,min(255,ix+dx)),max(0,min(255,iy+dz))));values.append(r*256+g+b/256-32768)
   return sorted(values)[4]
  return max(0,(median(x,y)*(1-u)+median(x+1,y)*u)*(1-v)+(median(x,y+1)*(1-u)+median(x+1,y+1)*u)*v)

def terrain_grid(bounds, inverse, dem, spacing=65):
 w,s,e,n=bounds;nx=math.ceil((e-w)/spacing);nz=math.ceil((n-s)/spacing);positions=[];indices=[]
 for j in range(nz+1):
  for i in range(nx+1):
   x=w+(e-w)*i/nx;z=s+(n-s)*j/nz;positions.extend([x,dem.sample(inverse([x,z])),z])
 # DSM artefacts can survive the native 3x3 median as very narrow towers.
 # Bound only isolated positive spikes against the eight surrounding samples;
 # keep the horizontal geometry and retain normal hill/valley gradients.
 raw=positions[1::3]
 for j in range(1,nz):
  for i in range(1,nx):
   k=j*(nx+1)+i;near=sorted(raw[(j+dj)*(nx+1)+i+di] for dj in [-1,0,1] for di in [-1,0,1] if di or dj);ceiling=(near[3]+near[4])/2+35
   if raw[k]>ceiling:positions[k*3+1]=ceiling
 for j in range(nz):
  for i in range(nx):
   a=j*(nx+1)+i;b=a+1;c=a+nx+1;d=c+1;indices.extend([a,c,b,b,c,d])
 return positions,indices
