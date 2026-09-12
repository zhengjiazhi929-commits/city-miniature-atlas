#!/usr/bin/env python3
"""Derive optional, source-constrained city-block display placements offline.

Python 3.12 + Shapely 2.1.2. All inputs ship with the app; no network/imaginary land.
Same-class source regions are split by water, natural/open land, airport and main
roads, then packed with complete, source-aligned rectangular compound footprints.
These are representative scene layouts, not surveyed parcels or real compounds.
"""
from __future__ import annotations
import argparse, hashlib, json, math, sys, time
from collections import Counter, defaultdict
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
import shapely
from shapely.geometry import Polygon,LineString,Point,box,GeometryCollection
from shapely.ops import unary_union
from shapely.affinity import translate
from shapely.strtree import STRtree
from shapely.prepared import prep
from shapely.validation import make_valid

DEFAULT_BOUNDS=[119.78,30.06,120.46,30.58]
ORIGIN=(120.15,30.265)
MX=111320*math.cos(math.radians(ORIGIN[1]));MY=111320.
SPECIFIC=['residential','commercial','retail','industrial','school','university','college','hospital']
NATURAL={'forest','park','grass','farmland','scrub','wetland'}
ROAD_WIDTH={'motorway':110.,'trunk':90.,'primary':65.}
WIDTHS=[1000.,850.,650.,520.,430.,350.,280.,220.,200.]
DEPTH_RATIOS=[1.,.85,.65]
SOURCE_FILES=['scene-data.json','source-classifications.json','urban-building-clusters.json','urban-ground-cover.json']


def project(p):return ((p[0]-ORIGIN[0])*MX,(p[1]-ORIGIN[1])*MY)
def unproject(p):return [round(p[0]/MX+ORIGIN[0],9),round(p[1]/MY+ORIGIN[1],9)]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def polygons(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    return [p for q in getattr(g,'geoms',[]) for p in polygons(q)]
def rings(p):return [[unproject(q) for q in r.coords] for r in [p.exterior,*p.interiors]]
def join(gs):
    gs=[g for g in gs if not g.is_empty]
    return make_valid(unary_union(gs)) if gs else GeometryCollection()
def oriented_rect(x,y,w,d,angle):
    c,s=math.cos(angle),math.sin(angle)
    return Polygon([(x+u*c-v*s,y+u*s+v*c) for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]])
def normal_angle(a):return (a+math.pi/2)%math.pi-math.pi/2

def main():
    global ORIGIN,MX
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,default=APP/'data/hangzhou-atlas')
    parser.add_argument('--airport',type=Path,default=APP/'data/airports/hangzhou.json')
    parser.add_argument('--output',type=Path,default=APP/'data/hangzhou-atlas/urban-neighbourhoods.json')
    parser.add_argument('--bounds',type=float,nargs=4,default=DEFAULT_BOUNDS,metavar=('WEST','SOUTH','EAST','NORTH'))
    parser.add_argument('--max-per-group',type=int,default=32)
    args=parser.parse_args();started=time.monotonic()
    if not(args.bounds[0]<args.bounds[2] and args.bounds[1]<args.bounds[3]):parser.error('Invalid bounds')
    if args.max_per_group<1:parser.error('--max-per-group must be positive')
    paths={n:args.data/n for n in SOURCE_FILES};raw={n:json.loads(p.read_text()) for n,p in paths.items()}
    scene=raw[SOURCE_FILES[0]];classified=raw[SOURCE_FILES[1]];clusters=raw[SOURCE_FILES[2]];cover=raw[SOURCE_FILES[3]]
    # Match createHangzhouFabric exactly; source-sidecar projection is not the
    # scene's placement metric. Consumers may replay dimensions without scaling.
    scene_bbox=scene['bbox'];ORIGIN=(scene_bbox[0],scene_bbox[1]);MX=111320*math.cos((scene_bbox[1]+scene_bbox[3])*math.pi/360)
    limit=box(*project(args.bounds[:2]),*project(args.bounds[2:]))
    invalid=0
    def shape(row):
        nonlocal invalid
        rs=row['rings'] if isinstance(row,dict) else row
        g=Polygon([project(p) for p in rs[0]],[[project(p) for p in r] for r in rs[1:]])
        if not g.is_valid:invalid+=1;g=make_valid(g)
        return g.intersection(limit)
    def union(rows):return join([shape(row) for row in rows])
    municipality=union(scene['boundary']);limit=limit.intersection(municipality)
    urban=union(scene['urban']+clusters['urban']).intersection(limit)
    water=union(scene['water']);forest=union(scene['forest'])
    natural=union([p for p in cover['classes'] if p.get('class') in NATURAL])
    airport=json.loads(args.airport.read_text());airport_shape=union(airport.get('boundary',[]))
    source_masks={c:union([p for p in classified['urban'] if p.get('class')==c]).intersection(urban) for c in SPECIFIC}
    mapped=join(list(source_masks.values()));exclusive={c:g.difference(join([other for k,other in source_masks.items() if k!=c])) for c,g in source_masks.items()}
    source_masks={**exclusive,'mixed':mapped.difference(join(list(exclusive.values()))),'unknown':urban.difference(mapped)}
    road_lines=[];road_rows=[];road_buffers=[]
    for road in scene['roads']:
        if road.get('class') not in ROAD_WIDTH or road.get('tunnel') or len(road.get('points',[]))<2:continue
        line=LineString([project(p) for p in road['points']])
        if not line.intersects(limit):continue
        road_lines.append(line);road_rows.append(road)
        road_buffers.append(line.buffer(ROAD_WIDTH[road['class']]/2+12,cap_style=2,join_style=2))
    road_mask=join(road_buffers);blocked=join([water,forest,natural,airport_shape,road_mask])
    road_tree=STRtree(road_lines)
    source_groups=[];stats_by_class={}
    minimum_area=min(WIDTHS)**2*min(DEPTH_RATIOS)
    for cls,mask in source_masks.items():
        clear=make_valid(mask.difference(blocked)).buffer(-.5,join_style=2)
        components=sorted(polygons(clear),key=lambda p:(round(p.centroid.x,6),round(p.centroid.y,6),-p.area))
        stats_by_class[cls]={'sourceExclusiveAreaMeters2':round(mask.area,3),'usableAreaMeters2':round(clear.area,3),'components':len(components),'componentsAboveMinimumArea':0,'groupsWithPlacement':0,'placements':0,'footprintAreaMeters2':0.,'widthCounts':{},'groupsAtCap':0}
        for index,p in enumerate(components):
            if p.area<minimum_area:continue
            stats_by_class[cls]['componentsAboveMinimumArea']+=1
            source_groups.append({'id':f'hz-block-source-{cls}-{index:05d}','sourceClass':cls,'shape':p})
    print('Sources ready:',len(source_groups),'eligible components;',len(road_lines),'major source paths',flush=True)
    # Every connected source region has an independent packing budget. Sorting
    # by geography, not landmark proximity, avoids a dense core consuming all work.
    source_groups.sort(key=lambda g:(g['sourceClass'],g['id']))
    operations=Counter();out=[];groups=[];accepted_all=[]
    slots=sorted([(w,w*r) for w in WIDTHS for r in DEPTH_RATIOS],key=lambda q:(-q[0]*q[1],-q[0]))
    def orientations(p):
        opts=[];near=[]
        for ri in road_tree.query(p.buffer(180)):
            ri=int(ri);coords=list(road_lines[ri].coords)
            for a,b in zip(coords,coords[1:]):
                length=math.dist(a,b)
                if length<35:continue
                seg=LineString([a,b]);distance=seg.distance(p)
                if distance<=180:near.append((length/(1+distance/80),ri,a,b,distance))
        near.sort(reverse=True,key=lambda e:e[0])
        for _,ri,a,b,distance in near:
            angle=normal_angle(math.atan2(b[1]-a[1],b[0]-a[0]))
            if any(abs(normal_angle(angle-o['angle']))<math.radians(7) for o in opts):continue
            opts.append({'angle':angle,'alignmentBasis':'source-road-frontage','alignmentSegment':[unproject(a),unproject(b)],'roadClass':road_rows[ri]['class'],'roadName':road_rows[ri].get('name',''),'roadDistanceToSourceRegionMeters':round(distance,2)})
            if len(opts)>=3:break
        corners=list(p.minimum_rotated_rectangle.exterior.coords);a,b=max(zip(corners,corners[1:]),key=lambda ab:math.dist(*ab));angle=normal_angle(math.atan2(b[1]-a[1],b[0]-a[0]))
        if not any(abs(normal_angle(angle-o['angle']))<math.radians(4) for o in opts):opts.append({'angle':angle,'alignmentBasis':'source-region-long-axis','alignmentSegment':[unproject(a),unproject(b)]})
        return opts
    def fit(remaining,w,d,orientation):
        operations['sizeOrientationAttempts']+=1
        if remaining.area<w*d:return None
        angle=orientation['angle'];c,s=math.cos(angle),math.sin(angle)
        # Quick valid-centre attempts avoid expensive centre-domain clipping for
        # regular source parcels. Exact whole-polygon containment is always final.
        prepared=prep(remaining)
        for part in sorted(polygons(remaining),key=lambda p:-p.area)[:8]:
            if part.area<w*d:continue
            for point in [part.representative_point(),part.centroid]:
                candidate=oriented_rect(point.x,point.y,w,d,angle);operations['wholeFootprintTests']+=1
                if prepared.covers(candidate):return candidate
        offsets=[(u*c-v*s,u*s+v*c) for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]
        domain=None
        for dx,dy in offsets:
            shifted=translate(remaining,xoff=-dx,yoff=-dy)
            domain=shifted if domain is None else domain.intersection(shifted)
            if domain.is_empty:return None
        # These extra edge-centre constraints reduce concave/hole false starts,
        # without replacing the exact final covers test.
        for dx,dy in [(0,0),(-w*c/2,-w*s/2),(w*c/2,w*s/2),(d*s/2,-d*c/2),(-d*s/2,d*c/2)]:
            domain=domain.intersection(translate(remaining,xoff=-dx,yoff=-dy))
            if domain.is_empty:return None
        for island in sorted(polygons(domain),key=lambda p:-p.area)[:12]:
            points=[island.representative_point(),island.centroid]
            minx,miny,maxx,maxy=island.bounds
            for fx,fy in [(0.2,0.2),(.2,.8),(.8,.2),(.8,.8),(.5,.2),(.5,.8),(.2,.5),(.8,.5)]:
                q=Point(minx+(maxx-minx)*fx,miny+(maxy-miny)*fy)
                if island.covers(q):points.append(q)
            for point in points:
                candidate=oriented_rect(point.x,point.y,w,d,angle);operations['wholeFootprintTests']+=1
                if prepared.covers(candidate):return candidate
        return None
    for gi,group in enumerate(source_groups):
        cls=group['sourceClass'];original=group['shape'];remaining=original;axes=orientations(original);chosen_axis=None;local=[]
        # One chosen source-derived direction per sourceGroup, retained for all
        # of its modules. Each accepted footprint removes a 16m safety gap.
        for _ in range(args.max_per_group):
            found=None
            for w,d in slots:
                if remaining.area<w*d:continue
                for orient in ([chosen_axis] if chosen_axis else axes):
                    footprint=fit(remaining,w,d,orient)
                    if footprint is not None:found=(w,d,orient,footprint);break
                if found:break
            if not found:break
            w,d,orient,footprint=found;chosen_axis=orient
            coordinates=unproject((footprint.centroid.x,footprint.centroid.y));rounded=Polygon([project(q) for q in rings(footprint)[0]])
            # Check exactly the serialized footprint, including holes/barriers,
            # plus decimal width/angle replay, not just pre-rounding geometry.
            source_ring_rounded=Polygon([project(q) for q in rings(original)[0]],[[project(q) for q in r] for r in rings(original)[1:]])
            replay=oriented_rect(*project(coordinates),w,d,orient['angle'])
            if not original.covers(rounded) or not source_ring_rounded.covers(rounded) or not original.buffer(.0003).covers(replay) or blocked.intersects(rounded):
                operations['serializationRejected']+=1;remaining=remaining.difference(footprint.buffer(1));continue
            row={'id':f"{group['id']}-module-{len(local):03d}",'sourceClass':cls,'sourceGroupId':group['id'],'coordinates':coordinates,'widthMeters':w,'depthMeters':round(d,6),'angleRadians':orient['angle'],'alignmentBasis':orient['alignmentBasis'],'alignmentSegment':orient['alignmentSegment'],'footprint':rings(footprint)[0]}
            if 'roadClass' in orient:row['sourceRoad']={k:orient[k] for k in ['roadClass','roadName','roadDistanceToSourceRegionMeters']}
            local.append(row);accepted_all.append(rounded);remaining=remaining.difference(footprint.buffer(16,join_style=2))
        if local:
            out.extend(local);stats=stats_by_class[cls];stats['groupsWithPlacement']+=1;stats['placements']+=len(local);stats['footprintAreaMeters2']+=sum(r['widthMeters']*r['depthMeters'] for r in local)
            for r in local:stats['widthCounts'][str(int(r['widthMeters']))]=stats['widthCounts'].get(str(int(r['widthMeters'])),0)+1
            if len(local)>=args.max_per_group:stats['groupsAtCap']+=1
            groups.append({'id':group['id'],'sourceClass':cls,'sourceRings':rings(original),'areaMeters2':round(original.area,3),'moduleIds':[r['id'] for r in local],'alignmentBasis':chosen_axis['alignmentBasis'],'alignmentSegment':chosen_axis['alignmentSegment']})
        if gi%100==0:print('Packed',gi+1,'/',len(source_groups),'source regions;',len(out),'modules',flush=True)
    if not out:raise RuntimeError('No whole source-supported neighbourhood slots found; do not publish an empty candidate package.')
    accepted_union=join(accepted_all);sum_area=sum(p.area for p in accepted_all)
    overlap=sum_area-accepted_union.area;outside=accepted_union.difference(urban).area;barrier=accepted_union.intersection(blocked).area
    if overlap>.05 or outside>.05 or barrier>.05:raise RuntimeError(f'Final whole-footprint validation failed: overlap={overlap}, outside={outside}, barriers={barrier}')
    sources={'files':[{'file':f'data/hangzhou-atlas/{n}','sha256':digest(p)} for n,p in paths.items()]+[{'file':'data/airports/hangzhou.json','sha256':digest(args.airport)}],'attribution':'© OpenStreetMap contributors; OpenFreeMap / OpenMapTiles source delivery. Underlying and derived geographic data remain subject to ODbL.','network':False}
    report={'version':1,'crs':'EPSG:4326','bbox':args.bounds,'neighbourhoods':out,'groups':groups,'sources':sources,'processing':{'script':'scripts/build-hangzhou-neighbourhoods.py','scriptSha256':digest(Path(__file__)),'python':sys.version.split()[0],'shapely':shapely.__version__,'projection':{'kind':'factory-bbox-local equirectangular','origin':ORIGIN,'latitudeForLongitudeScale':(scene_bbox[1]+scene_bbox[3])/2,'metersPerLongitudeDegree':MX,'metersPerLatitudeDegree':MY},'widthTiersMeters':WIDTHS,'depthRatios':DEPTH_RATIOS,'majorRoadFullWidthsMeters':ROAD_WIDTH,'roadSideClearanceMeters':12,'sourceBoundaryInsetMeters':.5,'moduleSeparationMeters':16,'maxModulesPerSourceGroup':args.max_per_group,'search':'Large area first, one source-road-frontage or source-region-long-axis per connected source group; translated corner/edge centre domains, then exact entire rectangle coverage. No positive buffering or gap closing of source land.'},'stats':{'neighbourhoods':len(out),'sourceGroups':len(groups),'eligibleSourceGroups':len(source_groups),'byClass':stats_by_class,'operations':dict(operations),'repairedInputPolygons':invalid,'finalRoundedFootprintOverlapMeters2':max(0,overlap),'finalRoundedFootprintOutsideUrbanMeters2':outside,'finalRoundedFootprintBarrierIntersectionMeters2':barrier},'limitations':['All placements are optional cartographic compounds, not real surveyed residential estates, legal parcels, planning districts, or measured architecture.','SourceClass is exclusive mapped land use. Conflicting specific classes are mixed; cityUrban with no known specific class is unknown, not commercial/residential inference.','Natural/open areas, forests, water, airport and source major roads split support regions. No source land is expanded, bridged or reassigned to make a compound fit.','Angles are measured east-to-north in the recorded local equirectangular projection. Consumers should derive displayed axes from alignmentSegment and their unchanged base map projection.','The complete footprint is a source-supported candidate, not final model placement approval. Runtime must re-check actual rendered footprint, DEM/support, source road geometry and model/landmark reservations.','Search is bounded and greedy. Regions with no candidate are left unbuilt; this does not prove absence of real buildings or that no other rectangle could fit.']}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'output':str(args.output),'stats':report['stats'],'elapsedSeconds':round(time.monotonic()-started,2)},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
