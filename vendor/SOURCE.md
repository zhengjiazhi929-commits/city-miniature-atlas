# Dependency and map resource provenance · v0.4.0

Checked 2026-09-08. Application code and original procedural miniatures use the project MIT license. The following bundled software, fonts, derived styles and online data retain their own licenses.

The active v0.4 viewer uses Three.js, direct PBF decoding and polygon-clipped meshes. MapLibre and the Liberty style below are retained historical files; the app no longer requests their engine, fonts, sprites or raster basemap.

## Bundled runtime software

| Dependency | Version | Source | Local license |
| --- | --- | --- | --- |
| Three.js | 0.180.0 | [npm source package](https://registry.npmjs.org/three/-/three-0.180.0.tgz) | [THREE-LICENSE.txt](THREE-LICENSE.txt), MIT |
| MapLibre GL JS | 5.12.0 | [npm source package](https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-5.12.0.tgz) | [MAPLIBRE-LICENSE.txt](MAPLIBRE-LICENSE.txt), BSD-3-Clause and included notices |

The direct vector parser dependencies are pinned in [VECTOR-SOURCES.json](VECTOR-SOURCES.json), with original license files and hashes. Polygon clipping uses polygon-clipping 0.15.7 (MIT), the original UMD build wrapped as a local ES module: [upstream package](https://registry.npmjs.org/polygon-clipping/-/polygon-clipping-0.15.7.tgz), [local license](POLYGON-CLIPPING-LICENSE.txt). Embedded splaytree notices remain in the module.

Three.js includes its core modules and the same-version OrbitControls, GLTFExporter and BufferGeometryUtils addons. GLTFLoader is included for interoperability verification; its source is the [r180 loader](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/loaders/GLTFLoader.js).

MapLibre is bundled as `maplibre-gl.js` and `maplibre-gl.css`. Package source metadata and the registry SHA-1 are recorded in [MAPLIBRE-SOURCE.json](MAPLIBRE-SOURCE.json). Retain the full license file, including notices for embedded third-party portions.

The local Noto Serif SC interface subset uses SIL Open Font License 1.1. See [FONTS.md](FONTS.md) and [NOTO-OFL.txt](NOTO-OFL.txt). The interface's sans-serif family uses device font fallbacks.

## Geographic style and online resources

The upstream notices are retained locally in [OPENFREEMAP-LICENSE.md](OPENFREEMAP-LICENSE.md) and [OSM-LIBERTY-LICENSE.md](OSM-LIBERTY-LICENSE.md).

[../data/geographic-style.json](../data/geographic-style.json) is derived from [OpenFreeMap Liberty](https://tiles.openfreemap.org/styles/liberty). Changes include the project's paper/green palette, Chinese-preferred labels, label density, geographic building extrusion and removal of upstream administrative boundary layers. It retains external map resource references; copying this JSON does not make the map offline.

| Resource | Current endpoint / source | License and attribution |
| --- | --- | --- |
| Vector maps | `https://tiles.openfreemap.org/planet` | OSM contributors, [ODbL](https://www.openstreetmap.org/copyright); OpenMapTiles schema and OpenFreeMap delivery |
| Liberty style | OpenFreeMap → OSM Liberty → OSM Bright / Mapbox Open Styles | [Upstream license inventory](https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md): style code BSD-3-Clause; design CC BY 4.0 |
| Map glyphs | `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` | Noto Sans, SIL OFL 1.1; online map glyphs are separate from the local interface subset |
| Map sprites | `https://tiles.openfreemap.org/sprites/ofm_f384/ofm` | Maki icons CC0; full resource provenance follows the upstream license inventory |
| Low-zoom raster basemap | `https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png` | Natural Earth, public domain |
| Terrain DEM | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), with [source-specific attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) for USGS, NOAA and other contributors |

The project requests map tiles and terrain at runtime rather than bundling the worldwide datasets. The local DEM quality module may adjust isolated elevation outliers for display; it does not change the original dataset's license or establish better survey accuracy. Preserve the treatment and source disclosures when reusing that module.

OpenFreeMap currently requires no API key; the site's static architecture does not guarantee network availability or an offline experience. Keep applicable map attribution visible and retain source acknowledgements in geographic screenshots or recordings. Review upstream conditions before caching or redistributing map data.

## Local geographic records

- Four refined OSM region polygons: [region provenance](../data/regions/provenance.json), [ODbL and processing](../data/regions/DATA_LICENSE.md).
- Offline regional city shards: [geoBoundaries / HDX 2020](../data/regions/prefectures/README.md), CC BY 3.0 IGO. They are not licensed under the application MIT terms.

- Simplified Natural Earth province outlines: [map-data.md](../docs/map-data.md).
- Hong Kong attraction anchors: [hong-kong-landmarks.json](../data/hong-kong-landmarks.json), with per-entry official identity and coordinate sources. Coordinate storage precision is not a survey-accuracy claim.
- Dataset limits, building height estimation and replacement guidance: [geographic-data.md](../docs/geographic-data.md).

Original scene source documents are under `docs/`. Reference photos were consulted for form and layout; they are not bundled map textures or redistributed scenic assets.
