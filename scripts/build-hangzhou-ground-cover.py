#!/usr/bin/env python3
"""Offline source-only ground-colour areas for the unified urban viewing frame.

Requires Python 3.12 + Shapely 2.1.2. Never generates buildings or trees and
never assigns a class to land that has no selected source area.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys

APP = Path(__file__).resolve().parents[1]
from archive_paths import archive_root, require_files, source_label
ROOT = archive_root()
import shapely
from shapely.geometry import Polygon, shape, box, GeometryCollection
from shapely.ops import transform, unary_union
from shapely.validation import make_valid

SOURCE = ROOT / "work/hangzhou-unified-v013/source"
SCENE = APP / "data/hangzhou-atlas/scene-data.json"
OUT = APP / "data/hangzhou-atlas/urban-ground-cover.json"
DRAW_ORDER = ["park", "grass", "farmland", "scrub", "forest", "wetland"]
LON0, LAT0 = 120.15, 30.265
MX, MY = 111320*math.cos(math.radians(LAT0)), 111320.0


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project(g):
    return transform(lambda x,y,z=None: ((x-LON0)*MX, (y-LAT0)*MY), g)


def unproject(g):
    return transform(lambda x,y,z=None: (x/MX+LON0, y/MY+LAT0), g)


def polygons(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for item in getattr(g, "geoms", []) for p in polygons(item)]


def union(items):
    values = [make_valid(g) for g in items if not g.is_empty]
    return make_valid(unary_union(values)) if values else GeometryCollection()


def target_class(layer, props):
    cls, sub = props.get("class"), props.get("subclass")
    if layer == "landcover":
        if cls == "wood":
            return "forest"
        if cls == "grass":
            return sub if sub in ["scrub", "park"] else "grass"
        if cls in ["farmland", "wetland"]:
            return cls
    if layer == "landuse" and cls == "park":
        return "park"
    if layer == "park" and cls == "national_park":
        return "park"
    return None


def ring_coordinates(p):
    return [[[round(x,8), round(y,8)] for x,y in ring.coords]
            for ring in [p.exterior, *p.interiors]]


def main(source=SOURCE, output=OUT, tolerance=10.0):
    require_files([source / name for name in ["provenance.json", "landcover.geojson", "landuse.geojson", "park.geojson"]] + [SCENE])
    provenance = read(source / "provenance.json")
    scene = read(SCENE)
    extent = box(*provenance["bbox"])
    municipal = union([project(Polygon(p[0],p[1:])) for p in scene["boundary"]])
    true_limit = project(extent).intersection(municipal)
    # Keep serialized eight-decimal coordinates on the inside of the true edge.
    # This is only a paint-mask inset; the city mesh/boundary is never altered.
    limit = true_limit.buffer(-.25)
    grouped = {k: [] for k in DRAW_ORDER}
    source_counts, selected_counts, ignored_counts = Counter(), Counter(), Counter()
    paths = [source / f"{layer}.geojson" for layer in ["landcover", "landuse", "park"]]
    for layer, file in zip(["landcover", "landuse", "park"], paths):
        for feature in read(file)["features"]:
            props = feature.get("properties", {})
            tag = f"{layer}:{props.get('class')}:{props.get('subclass')}"
            source_counts[tag] += 1
            target = target_class(layer, props)
            if feature["geometry"]["type"] not in ["Polygon", "MultiPolygon"]:
                ignored_counts["non-area-features"] += 1
                continue
            if target is None:
                ignored_counts["outside-explicit-class-whitelist"] += 1
                continue
            geom = make_valid(shape(feature["geometry"]))
            if not geom.intersects(extent):
                ignored_counts["outside-bbox"] += 1
                continue
            local = project(geom.intersection(extent)).intersection(limit)
            if local.is_empty:
                ignored_counts["outside-municipality"] += 1
                continue
            grouped[target].append(local)
            selected_counts[tag] += 1
    rows, statistics = [], {}
    for cls in DRAW_ORDER:
        raw = union(grouped[cls])
        simplified = make_valid(raw.simplify(tolerance, preserve_topology=True)).intersection(limit)
        # A topology-preserving simplifier can still span an acute concavity.
        # Clip back to the actual source's tolerance envelope, rather than
        # loosening the validation or assigning new land beyond that envelope.
        simplified = simplified.intersection(raw.buffer(tolerance))
        parts = [p for p in polygons(simplified) if p.area >= 1]
        parts.sort(key=lambda p: (-p.area,p.centroid.x,p.centroid.y))
        current = [{"class": cls, "rings": ring_coordinates(unproject(p))} for p in parts]
        realized = union([project(Polygon(p["rings"][0],p["rings"][1:])) for p in current])
        outside = realized.difference(true_limit).area
        unsupported = realized.difference(raw.buffer(tolerance+.1)).area
        if outside > .001 or unsupported > .001:
            raise RuntimeError(f"{cls}: unsupported simplification/boundary area {unsupported}/{outside}")
        statistics[cls] = {"sourceFeatureFragments": len(grouped[cls]),
                           "outputPolygons": len(parts),
                           "sourceAreaKm2": round(raw.area/1e6,6),
                           "outputAreaKm2": round(realized.area/1e6,6),
                           "holes": sum(len(p.interiors) for p in parts),
                           "outsideBoundaryAreaMeters2": round(outside,8),
                           "outsideSimplificationSupportAreaMeters2": round(unsupported,8)}
        rows.extend(current)
        print(json.dumps({"class": cls, **statistics[cls]}), flush=True)
    paths += [source / "provenance.json", SCENE]
    result = {"version":1, "crs":"EPSG:4326", "bbox":provenance["bbox"], "classes":rows,
              "sources":{"attribution":provenance["attribution"], "snapshot":provenance["snapshot"],
                         "zoom":provenance["zoom"], "provenance":str((source/"provenance.json").relative_to(ROOT)),
                         "files":[{"path":source_label(p, ROOT),"sha256":digest(p)} for p in paths]},
              "processing":{"script":source_label(Path(__file__), ROOT), "scriptSha256":digest(Path(__file__)),
                            "network":False, "python":sys.version.split()[0], "shapely":shapely.__version__,
                            "projection":{"type":"local equirectangular","origin":[LON0,LAT0],"metersPerLongitudeDegree":MX,"metersPerLatitudeDegree":MY},
                            "simplificationMeters":tolerance,"sourceEnvelopeClipMeters":tolerance,"boundaryPaintInsetMeters":.25,"roundingDecimals":8,
                            "minimumPolygonAreaMeters2":1,"drawOrderLowToHigh":DRAW_ORDER,
                            "classMapping":["landcover:wood -> forest", "landcover:grass + subclass:scrub -> scrub",
                                            "landcover:grass + subclass:park -> park", "other landcover:grass -> grass",
                                            "landcover:farmland -> farmland (including source orchard/nursery subclasses)",
                                            "landcover:wetland -> wetland", "landuse:park -> park", "park:national_park Polygon/MultiPolygon -> park"],
                            "policy":"Ground colour only. Union each explicit class separately, preserve polygon holes and clip to existing municipal boundary and source bbox. Different source classes can genuinely overlap and remain separate: suggested paint order is listed from low to high; actual water surfaces remain above ground colours. Non-area labels, nature_reserve/protected_area/historic designations, rock/sand and all unclassified land are omitted, never inferred as park/forest. Existing urban colour may be a lower-priority base, not a replacement for mapped natural classes. Park describes mapped use, not measured grass coverage. Simplification changes only display boundaries within the recorded tolerance. No runtime mesh, terrain, buildings or urban-building-clusters is modified."},
              "stats":{"sourceClassCounts":dict(source_counts),"selectedSourceClassCounts":dict(selected_counts),
                       "ignoredCounts":dict(ignored_counts),"byClass":statistics,"outputPolygons":len(rows),
                       "coordinatePairs":sum(len(r) for p in rows for r in p["rings"])}}
    payload=json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n"
    output.write_text(payload)
    print(json.dumps({"output":str(output),"bytes":len(payload.encode()),"polygons":len(rows),"sha256":digest(output)}),flush=True)


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",type=Path,default=SOURCE)
    parser.add_argument("--output",type=Path,default=OUT)
    parser.add_argument("--tolerance",type=float,default=10.0)
    args=parser.parse_args()
    main(args.source.resolve(),args.output.resolve(),args.tolerance)
