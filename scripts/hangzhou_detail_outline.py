"""Content-led display outlines. These are presentation cuts, never site boundaries."""
from shapely.geometry import Point,Polygon,LineString
from shapely.ops import unary_union
from shapely import concave_hull,make_valid

ANCHORS={'xiaohe':(120.1303856,30.3101367),'faxi':(120.089317,30.2301139),'lingyin':(120.0967987,30.2427953),'longmen':(119.9474116,29.9020636),'olympic':(120.2254884,30.2317101),'hubin-yintai':(120.157724,30.2556862)}

def display_outline(id,features,extent,project):
    # Authored buffers retain immediate context around known source features.
    # Buffer distances describe composition, not surveyed attraction limits.
    pad={'xiaohe':95,'faxi':60,'lingyin':85,'longmen':35,'olympic':125,'hubin-yintai':55,'zshc':12}
    selected=[]
    for fid,t,g in features:
        name=t.get('name','')
        accept=(id=='xiaohe' and name=='小河直街' or id=='faxi' and '法喜' in name or id=='lingyin' and name=='灵隐寺' or id=='longmen' and name=='龙门古镇' or id=='hubin-yintai' and ('in77' in name.lower() or '银泰' in name) or id=='zshc' and t.get('aeroway')=='aerodrome')
        if id=='lingyin':
            center=project(Point(*ANCHORS[id]));accept=accept or (t.get('amenity')=='place_of_worship' and project(g).centroid.distance(center)<265)
        if id=='olympic':
            center=project(Point(*ANCHORS[id]));accept=(t.get('leisure') in ['stadium','sports_centre','pitch'] or t.get('building') in ['stadium','sports_hall']) and project(g).centroid.distance(center)<470
        if accept and not g.is_empty:selected.append(project(g))
    inner=extent.buffer(-max(6,min(extent.bounds[2]-extent.bounds[0],extent.bounds[3]-extent.bounds[1])*.02))
    if selected:
        footprint=unary_union(selected)
        if id in ['hubin-yintai','olympic','lingyin']:footprint=concave_hull(footprint,ratio=.38,allow_holes=False)
        outline=footprint.buffer(pad[id],join_style='round')
        if id=='xiaohe':outline=outline.buffer(45).buffer(-45)
        # Avoid disconnected display islands for the adjoining buildings.
        if outline.geom_type!='Polygon':outline=concave_hull(outline,ratio=.45,allow_holes=False).buffer(10)
        outline=outline.intersection(inner)
        method='Source named attraction/site geometry with an authored immediate-context buffer.'
    else:
        # Landscape scenes retain a representative source-aligned environment.
        # Rounded, irregular perimeter removes the rectangular acquisition crop.
        w,s,e,n=inner.bounds;dx=e-w;dz=n-s
        controls=[(.11,.24),(.26,.04),(.55,.08),(.73,.04),(.94,.28),(.87,.56),(.97,.78),(.70,.95),(.48,.88),(.24,.97),(.06,.72),(.12,.50)]
        outline=Polygon([(w+x*dx,s+z*dz) for x,z in controls]).buffer(min(dx,dz)*.035).buffer(-min(dx,dz)*.035).intersection(inner)
        method='Authored irregular landscape display frame over unchanged source terrain and water.'
    outline=make_valid(outline)
    if outline.geom_type!='Polygon':outline=max((g for g in outline.geoms if g.geom_type=='Polygon'),key=lambda p:p.area)
    # Display perimeter has no inner holes; actual lakes keep their own topology.
    outline=Polygon(outline.exterior).simplify(.6,preserve_topology=True)
    return outline,method
