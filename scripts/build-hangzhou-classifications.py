#!/usr/bin/env python3
"""Offline, class-preserving sidecar from the frozen Hangzhou land-use archive.

Uses the same checked clipping/simplification helpers as the original scene
builder. Does not rebuild or modify the existing scene, terrain or boundary.
"""
from pathlib import Path
from collections import Counter
import hashlib
import importlib.util
import json

APP = Path(__file__).resolve().parents[1]
from archive_paths import archive_root, require_files, source_label
ROOT = archive_root()
SOURCE = ROOT / 'work/hangzhou-concept-v3/supports/full-city/landuse.geojson'
SCENE = APP / 'data/hangzhou-atlas/scene-data.json'
OUT = APP / 'data/hangzhou-atlas/source-classifications.json'
require_files([SOURCE, SCENE])
spec = importlib.util.spec_from_file_location('atlas_builder', APP / 'scripts/build-hangzhou-atlas.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

scene = json.loads(SCENE.read_text())
raw = json.loads(SOURCE.read_text())
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
expected = next(x['sha256'] for x in scene['sources']['files'] if x['path'] == str(SOURCE.relative_to(ROOT)))
assert source_hash == expected, 'Frozen source hash must match the runtime scene manifest.'
classes = ['residential', 'commercial', 'industrial', 'retail', 'school', 'university', 'hospital', 'college', 'neighbourhood', 'quarter', 'suburb']
layers = {k: [] for k in classes}
source_counts = Counter()
for feature in raw['features']:
    cls = feature.get('properties', {}).get('class')
    if cls not in layers:
        continue
    source_counts[cls] += 1
    for polygon in builder.polygons(feature['geometry']):
        simplified = builder.simplified(polygon, 30)
        if simplified:
            layers[cls].append(simplified)
merged = builder.union_clip(layers, scene['boundary'])
urban = []
for cls in classes:
    for polygon in merged[cls]:
        area = builder.polygon_area(polygon)
        if area >= 6000:
            urban.append({'class': cls, 'rings': polygon, 'areaMeters': round(area)})

def rounded(value):
    if isinstance(value, float): return round(value, 7)
    if isinstance(value, list): return [rounded(v) for v in value]
    if isinstance(value, dict): return {k: rounded(v) for k, v in value.items()}
    return value

result = {
    'version': 1,
    'crs': 'EPSG:4326',
    'urban': urban,
    'fallback': 'unknown-developed',
    'sources': {
        'attribution': '© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap; ODbL 1.0',
        'vectorProvider': 'https://openfreemap.org/',
        'sourceSnapshot': '20260906_080001_pt',
        'sourceZoom': 11,
        'files': [
            {'path': str(SOURCE.relative_to(ROOT)), 'sha256': source_hash},
            {'path': source_label(SCENE, ROOT), 'sha256': hashlib.sha256(SCENE.read_bytes()).hexdigest(), 'role': 'Existing authoritative display boundary only; file was not modified.'}
        ],
        'rawProvenance': 'work/hangzhou-concept-v3/supports/full-city/provenance.json'
    },
    'processing': {
        'script': source_label(Path(__file__), ROOT),
        'network': False,
        'simplificationMeters': 30,
        'minimumPolygonAreaMeters': 6000,
        'clip': 'The existing scene-data.boundary, derived from OSM relation 3221112, without modification.',
        'merge': 'Union separately within each source class. Preserve holes. Never merge different classes into one declared use.',
        'roundingDecimals': 7,
        'selectionPolicy': 'Use only unambiguous source spatial matches. Conflicting overlapping specific classes must fall back to mixed/unknown. Neighbourhood, quarter and suburb are general settlement areas and do not establish residential building use.',
        'limits': 'Mapped land-use areas only; not individual building footprints, measured heights, roof shapes, construction ages, ground materials or shoreline engineering types. Missing coverage is unknown, not wilderness. Representative buildings remain cartographic symbols.'
    },
    'stats': {
        'sourceFeatureFragmentsByClass': dict(source_counts),
        'outputPolygonsByClass': dict(Counter(p['class'] for p in urban)),
        'outputPolygons': len(urban),
        'outputVertices': sum(len(r) for p in urban for r in p['rings']),
        'countsMeaning': 'Counts are class-preserved generalized polygon components, not buildings or complete real land parcels.'
    }
}
OUT.write_text(json.dumps(rounded(result), ensure_ascii=False, separators=(',', ':')) + '\n')
print(json.dumps({'path': source_label(OUT, ROOT), 'bytes': OUT.stat().st_size, **result['stats']}, ensure_ascii=False))
