#!/usr/bin/env python3
"""Derive display neighbourhood masks from the checked, offline z13 buildings.

Run with Python 3.12 + Shapely 2.1.2. Install Shapely into your own environment; select archived inputs explicitly
with ATLAS_SOURCE_ROOT (see scripts/README.md). No network access.
This is morphological display generalisation, not cadastral/land-use inference.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
from collections import Counter

APP = Path(__file__).resolve().parents[1]
from archive_paths import archive_root, require_files, source_label
ROOT = archive_root()

import shapely
from shapely.geometry import GeometryCollection, LineString, Point, Polygon, box, shape
from shapely.ops import transform, unary_union
from shapely.validation import make_valid

SOURCE = ROOT / "work/hangzhou-unified-v013/source"
SCENE = APP / "data/hangzhou-atlas/scene-data.json"
AIRPORT = APP / "data/airports/hangzhou.json"
OUT = APP / "data/hangzhou-atlas/urban-building-clusters.json"
LON0, LAT0 = 120.15, 30.265
MX = 111320 * math.cos(math.radians(LAT0))
MY = 111320.0
EXPANSION = 80.0
EROSION = 50.0
MIN_AREA = 2000.0
SIMPLIFY = 3.0
ROAD_WIDTH = {"motorway": 110, "trunk": 90, "primary": 65, "secondary": 42}


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project(geom):
    return transform(lambda x, y, z=None: ((x-LON0)*MX, (y-LAT0)*MY), geom)


def unproject(geom):
    return transform(lambda x, y, z=None: (x/MX+LON0, y/MY+LAT0), geom)


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    return [p for g in getattr(geom, "geoms", []) for p in polygons(g)]


def union(items):
    items = [make_valid(g) for g in items if not g.is_empty]
    return make_valid(unary_union(items)) if items else GeometryCollection()


def rings(poly):
    return [[[round(x, 8), round(y, 8)] for x, y in ring.coords]
            for ring in [poly.exterior, *poly.interiors]]


def main():
    require_files([SOURCE / name for name in ["provenance.json", "building.geojson", "landuse.geojson", "landcover.geojson", "water.geojson", "transportation.geojson", "park.geojson"]] + [SCENE, AIRPORT])
    provenance = read(SOURCE / "provenance.json")
    extent = box(*provenance["bbox"])
    extent_m = project(extent)
    scene = read(SCENE)
    municipality = union([project(Polygon(p[0], p[1:])) for p in scene["boundary"]])
    limit = extent_m.intersection(municipality)
    source_files = [SOURCE / (name + ".geojson") for name in
                    ["building", "water", "transportation", "landcover", "landuse", "park"]]
    source_files += [SOURCE / "provenance.json", SCENE, AIRPORT]

    def features(name):
        return read(SOURCE / (name + ".geojson"))["features"]

    def local(geom):
        geom = make_valid(geom)
        if geom.is_empty or not geom.intersects(extent):
            return GeometryCollection()
        return project(geom.intersection(extent)).intersection(limit)

    original_features = features("building")
    raw_pieces = [g for f in original_features for g in polygons(shape(f["geometry"]))]
    building_parts = [local(g) for g in raw_pieces]
    buildings = union(building_parts)
    print(f"Source: {len(raw_pieces)} fragments, {len(polygons(buildings))} merged in-bbox components", flush=True)

    # Keep both the finer local source and the unchanged displayed city's source
    # as exclusions; absence in either dataset must not erase a known barrier.
    water = union([local(shape(f["geometry"])) for f in features("water")] +
                  [local(Polygon(p["rings"][0], p["rings"][1:])) for p in scene["water"]])
    forest = union([local(shape(f["geometry"])) for f in features("landcover")
                    if f["properties"].get("class") == "wood"] +
                   [local(Polygon(p["rings"][0], p["rings"][1:])) for p in scene["forest"]])
    open_space = union([local(shape(f["geometry"])) for f in features("park")] +
                      [local(shape(f["geometry"])) for f in features("landcover")
                       if f["properties"].get("class") in ["wetland", "farmland"] or
                       f["properties"].get("subclass") in ["park", "grassland", "garden"]] +
                      [local(shape(f["geometry"])) for f in features("landuse")
                       if f["properties"].get("class") in ["pitch", "track", "stadium", "cemetery", "park"]])
    airport = union([local(Polygon(p[0], p[1:])) for p in read(AIRPORT)["boundary"]])

    road_pieces = []
    road_counts = Counter()
    for f in features("transportation"):
        props = f["properties"]
        cls = props.get("class")
        if cls not in ROAD_WIDTH or props.get("brunnel") == "tunnel":
            continue
        geom = local(shape(f["geometry"]))
        if not geom.is_empty:
            road_pieces.append(geom.buffer(ROAD_WIDTH[cls]/2 + 10, cap_style=2, join_style=2))
            road_counts[cls] += 1
    for road in scene["roads"]:
        cls = road.get("class")
        if cls not in ROAD_WIDTH or road.get("tunnel") or len(road["points"]) < 2:
            continue
        geom = local(LineString(road["points"]))
        if not geom.is_empty:
            road_pieces.append(geom.buffer(ROAD_WIDTH[cls]/2 + 10, cap_style=2, join_style=2))
    roads = union(road_pieces).intersection(limit)
    exclusions = {"water": water, "forest": forest, "mappedOpenSpace": open_space,
                  "airport": airport, "majorRoadCorridors": roads}
    blocked = union(list(exclusions.values())).buffer(.25)
    seed = buildings.difference(blocked)
    print("Barrier layers ready; closing locally adjacent source footprints", flush=True)

    # An 80 m outward and 50 m inward morphology connects close courtyard
    # buildings (at most 160 m edge gap), leaving at most 30 m net edge pad.
    # This does not bridge distant missing-data neighbourhoods. A second
    # subtraction splits the result at every protected surface/corridor.
    closed = seed.buffer(EXPANSION, quad_segs=3, join_style=1).buffer(
        -EROSION, quad_segs=3, join_style=1)
    generalized = union([closed, seed]).intersection(limit).difference(blocked)
    # Simplification is followed by clipping once more so it cannot cut across
    # water, roads, forest edges, airport, or the recorded extraction boundary.
    generalized = generalized.simplify(SIMPLIFY, preserve_topology=True).intersection(limit).difference(blocked)
    candidates = polygons(make_valid(generalized))
    accepted = [p for p in candidates if p.area >= MIN_AREA and p.intersects(seed)]
    accepted.sort(key=lambda p: (-p.area, p.centroid.x, p.centroid.y))
    urban = [{"rings": rings(unproject(p)), "class": "mixed", "areaMeters": round(p.area, 2)}
             for p in accepted]

    # Validate the rounded coordinates consumers actually load, not just the
    # pre-serialization geometry. The 25 cm inset absorbs sub-mm rounding.
    final = union([project(Polygon(p["rings"][0], p["rings"][1:])) for p in urban])
    overlap = {key: round(final.intersection(g).area, 6) for key, g in exclusions.items()}
    outside = final.difference(limit).area
    beyond_source_support = final.difference(seed.buffer(EXPANSION+SIMPLIFY+.1)).area
    if any(a > .01 for a in overlap.values()) or outside > .1 or beyond_source_support > .1:
        raise RuntimeError(f"Derived polygons violate source barriers: {overlap}, outside={outside}, unsupported={beyond_source_support}")
    existing = union([local(Polygon(p["rings"][0], p["rings"][1:])) for p in scene["urban"]])
    samples = []
    sample_points = [("original-central-1", [120.17, 30.27]), ("original-central-2", [120.18, 30.28]),
                     ("original-central-3", [120.18, 30.25]), ("north", [120.16, 30.45]),
                     ("northeast", [120.31, 30.36]), ("east", [120.32, 30.29]),
                     ("south", [120.23, 30.14]), ("west", [119.99, 30.30]),
                     ("northwest-visible-edge", [119.85, 30.45]), ("north-visible-edge", [120.15, 30.53])]
    for name, coordinate in sample_points:
        point = project(Point(coordinate))
        neighbourhood = point.buffer(200)
        samples.append({"name": name, "coordinate": coordinate,
                        "nearestMappedBuildingMeters": round(point.distance(buildings), 2),
                        "existingUrbanAtPoint": existing.covers(point),
                        "derivedUrbanAtPoint": final.covers(point),
                        "barriersAtPoint": [key for key, g in exclusions.items() if g.covers(point)],
                        "derivedCoverageWithin200Meters": round(final.intersection(neighbourhood).area / neighbourhood.area, 4),
                        "existingCoverageWithin200Meters": round(existing.intersection(neighbourhood).area / neighbourhood.area, 4)})
    # Report the old centre and its surrounding sectors separately, so one
    # strong centre cannot hide missing coverage elsewhere in the new extent.
    sectors = {"previous-centre": [120.02, 30.17, 120.28, 30.36],
               "west": [119.78, 30.06, 120.02, 30.58],
               "east": [120.28, 30.06, 120.46, 30.58],
               "north": [120.02, 30.36, 120.28, 30.58],
               "south": [120.02, 30.06, 120.28, 30.17]}
    sector_stats = []
    for name, sector_bbox in sectors.items():
        region = project(box(*sector_bbox)).intersection(limit)
        sector_stats.append({"name": name, "bbox": sector_bbox,
                             "clippedAreaKm2": round(region.area/1e6, 6),
                             "sourceBuildingAreaKm2": round(buildings.intersection(region).area/1e6, 6),
                             "derivedMaskAreaKm2": round(final.intersection(region).area/1e6, 6),
                             "existingUrbanAreaKm2": round(existing.intersection(region).area/1e6, 6)})
    stats = {"sourceFeatures": len(original_features), "rawBuildingPolygonFragments": len(raw_pieces),
             "inExtentUnionBuildingComponents": len(polygons(buildings)),
             "inExtentSourceBuildingAreaKm2": round(buildings.area/1e6, 6),
             "sourceSeedAreaAfterExclusionsKm2": round(seed.area/1e6, 6),
             "urbanClusters": len(urban), "derivedAreaKm2": round(final.area/1e6, 6),
             "newAreaOutsideExistingUrbanKm2": round(final.difference(existing).area/1e6, 6),
             "coordinatePairs": sum(len(r) for p in urban for r in p["rings"]),
             "clustersAtLeast50000SquareMeters": sum(p.area >= 50000 for p in accepted),
             "largestClusterSquareMeters": round(max([p.area for p in accepted], default=0), 2),
             "barrierOverlapAreaSquareMeters": overlap, "outsideSourceExtentAreaSquareMeters": round(outside, 6),
             "outside83MeterSourceSupportAreaSquareMeters": round(beyond_source_support, 6),
             "sampleCoverage": samples, "sourceSectors": sector_stats}
    result = {"version": 1, "crs": "EPSG:4326", "bbox": provenance["bbox"], "urban": urban,
              "sources": {"attribution": provenance["attribution"], "retrievedAt": provenance["retrievedAt"],
                          "zoom": provenance["zoom"], "snapshot": provenance.get("snapshot", "20260830_080001_pt"),
                          "tilejson": provenance.get("tilejson"), "template": provenance.get("template"),
                          "tiles": [t["url"] for t in provenance["tiles"]],
                          "inputs": [{"path": source_label(p, ROOT), "sha256": digest(p)} for p in source_files]},
              "processing": {"script": "scripts/build-hangzhou-urban-clusters.py", "scriptSha256": digest(Path(__file__)),
                             "python": sys.version.split()[0], "shapely": shapely.__version__,
                             "projection": {"kind": "local equirectangular", "origin": [LON0, LAT0], "metersPerLongitudeDegree": MX, "metersPerLatitudeDegree": MY},
                             "expansionMeters": EXPANSION, "erosionMeters": EROSION,
                             "maximumMorphologicalJoinGapMeters": EXPANSION*2,
                             "netExteriorPadMeters": EXPANSION-EROSION,
                             "simplificationMeters": SIMPLIFY, "minimumClusterAreaSquareMeters": MIN_AREA,
                             "roadCorridorFullWidthsMeters": ROAD_WIDTH, "roadAdditionalSideClearanceMeters": 10,
                             "barrierInsetMeters": .25,
                             "policy": "One uniformly rebuilt offline display mask across the entire declared bbox, anchored to fixed-snapshot z13 mapped building footprints; no overlay of a separately styled old centre. Morphological closing generalizes courtyards and spacing; it is not measured building massing, official parcel boundaries, complete land-use coverage, or evidence that unmapped land is empty. Water, mapped forests/open space, major surface roads and mapped airport are subtracted after closing. Conservative exclusions additionally retain the existing runtime z11 source geometry, which is separately hashed; z13 source tiles themselves never mix snapshots. Tunnel roads do not exclude buildings. Existing city source files and all geographic anchors remain unchanged. The class mixed is a display grouping, not surveyed land use."},
              "stats": stats}
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps(stats, ensure_ascii=False, indent=2), flush=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE, help="Source folder containing provenance.json and extracted GeoJSON layers")
    parser.add_argument("--output", type=Path, default=OUT, help="Derived JSON output path")
    args = parser.parse_args()
    SOURCE, OUT = args.source.resolve(), args.output.resolve()
    main()
