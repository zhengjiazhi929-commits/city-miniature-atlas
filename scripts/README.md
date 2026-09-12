# Scripts: running, verifying and rebuilding

The website and shared City Kit run from the files in this checkout. You do not
need the original developer workspace, Codex, Python or GIS build tools to open
the website. Commands below are run from the repository root with Node.js 18+.

## Local checks and shared assets

```sh
node scripts/serve.mjs
# In another terminal:
node scripts/check.mjs
node scripts/check-city-assets.mjs
node scripts/check-hangzhou-details.mjs
node scripts/check-westlake.mjs --report docs/qa/westlake-local.json
node scripts/check-hangzhou-atlas.mjs --report docs/qa/hangzhou-local.json
```

Checks use packaged sources. The atlas check reports missing *original full-city
archives* as skipped, while checking bundled data and mesh contracts. It does
not report missing raw archives as verified. Add `--require-source-archive` and
set `ATLAS_SOURCE_ROOT` below when you actually have those frozen inputs.

The shared asset generator is independent of any city or external archive:

```sh
node scripts/build-city-assets.mjs
node scripts/check-city-assets.mjs
```

It writes `assets/city-kit/v1/` in this checkout. This is an intentional rebuild,
not a required installation step. Changed asset/source hashes require a new
derived city cache. Keep a clean commit before rebuilding. Existing data files
and their recorded hashes remain the reference until a rebuild is requested.

## Optional Python GIS tools

Use your own Python 3.10+ environment (the original preparation used 3.12).
Shapely 2.1+ is required by constrained triangulation. No script searches an
ancestor directory for hidden `python-deps` or a Codex-managed Node runtime.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements-gis.txt
.venv/bin/python scripts/check-hangzhou-subjects.py
```

The following rebuilds use inputs already bundled with the repository and
write derived data inside this checkout. They do not need `ATLAS_SOURCE_ROOT`.
They can be expensive and are not needed to start the website.

| Script | Input and output |
| --- | --- |
| `build-hangzhou-neighbourhoods.py` | Packaged city, land classes, ground cover and building clusters → neighbourhood placement plans |
| `build-hangzhou-display-envelopes.py` | Packaged source masks/plans → bounded representative-building display footprints |
| `build-westlake-display.py` | Packaged city/West Lake data → local West Lake display mesh |
| `build-hangzhou-place-details.py` | Packaged OSM snapshots and DEM PNGs → local attraction context bundles |
| `build-hangzhou-subjects.py` | Attraction context bundles → independent architectural subjects |
| `build-hangzhou-natural-subjects.py` | Context bundles and archived water/DEM → independent nature subjects |
| `build-natural-features.py` | Archived OSM features → nature-subject paths and recognizable features |
| `extract-leifeng-subject.py` | Packaged Leifeng GLB → tower-only GLB; standard-library Python only |
| `bake-hangzhou-terrain.mjs` | Packaged city boundary, water and terrain → triangulated terrain; Node only |

Run context generation before subject generation; run `build-natural-features.py`
after `build-hangzhou-natural-subjects.py`. Restore a missing frozen DEM tile
from its recorded source archive: the offline detail builder fails clearly
instead of downloading a newer tile. These are Hangzhou preparation scripts,
not an automatic arbitrary-city data pipeline. For a new city, follow the
repository's city-extension guide and replace source-specific assumptions.

## Rebuilds that need the original full-city archives

These inputs are not all included in a normal clone. Set `ATLAS_SOURCE_ROOT`
to a directory **containing** `work/`; do not point it directly at `work/`.
The environment variable controls archived *inputs*, while final generated
application files default to this checkout's `data/`.

```sh
export ATLAS_SOURCE_ROOT=/absolute/path/to/source-archive
.venv/bin/python scripts/build-hangzhou-classifications.py
node scripts/check-hangzhou-atlas.mjs --require-source-archive
```

| Script | Required path beneath `ATLAS_SOURCE_ROOT` |
| --- | --- |
| `build-hangzhou-atlas.py` | `work/hangzhou-concept-v3/supports/full-city/` (extent, boundary, land/water/road/anchor GeoJSON and frozen `dem/*.png`), plus `work/hangzhou-concept-v3/supports/missing-landmarks/four-landmark-anchors.geojson` |
| `build-hangzhou-classifications.py` | `work/hangzhou-concept-v3/supports/full-city/landuse.geojson`; its hash must match the packaged city manifest |
| `build-hangzhou-urban-clusters.py` | `work/hangzhou-unified-v013/source/` (provenance plus building, water, road, land-use/cover and park GeoJSON) |
| `build-hangzhou-ground-cover.py` | `work/hangzhou-unified-v013/source/` (provenance plus landcover, landuse and park GeoJSON) |
| `build-hangzhou-east-context.py` | `work/hangzhou-five-v020/east-source/` (landuse, landcover and park GeoJSON) |

Missing root/files stop the script with an explanation. No synthetic geography,
live snapshot substitute or writes into an assumed `../../outputs/china-atlas`
directory are allowed. If using the `--source` option of the ground-cover or
cluster builder, keep that input beneath the explicit archive root. Their
optional `--output` is an intentional user-selected destination; default output
always stays in this checkout. The full-city builder uses Node from `PATH`, or
an explicit `NODE_BINARY` executable path.

An edited script or different GIS package version may produce different hashes
or floating-point triangulation. Re-run source/geometry checks and rebuild
affected derived caches; do not relabel fresh results as the old frozen files.

## Explicit network retrieval and browser cache baking

`fetch-hangzhou-urban-sources.mjs` and `fetch-hangzhou-east-sources.mjs` are
explicit network commands. They can reuse an archive selected through
`ATLAS_SOURCE_ROOT`, but write fetched/extracted sources to this checkout's
`work/` directory. They request the exact recorded OpenFreeMap snapshot
`20260830_080001_pt`; an unavailable snapshot is not replaced with `latest`.
To build from their output, set `ATLAS_SOURCE_ROOT` to this repository root.

`fetch-hangzhou-place-sources.py` retrieves current public OSM responses into
`data/scenes/hangzhou-details/sources/` only where files are absent. This is
source acquisition with new timestamps/hashes, not reproduction of a missing
historical snapshot. Review resulting manifests before rebuilding.

`bake-hangzhou-fabric.mjs` needs Playwright and a browser; it writes the city's
derived gzip cache and manifest. Start a preview **from this same checkout** and
provide its URL, so a preview of another version is never mistaken for this one:

```sh
PORT=4176 node scripts/serve.mjs
# In another terminal, with Playwright installed in your environment:
ATLAS_URL=http://127.0.0.1:4176/ node scripts/bake-hangzhou-fabric.mjs
```

`PLAYWRIGHT_MODULE` may name an absolute Playwright module path, and `CHROME_PATH`
may select an installed browser executable. Browser baking, rendering and GIS
preparation are optional development activities; none runs during `npm start`.
