# Attribution and third-party notices

The root MIT license applies to original application code and original City Kit models. It does not relicense third-party geographic data, derived datasets, fonts or libraries. Preserve the following notices when redistributing this repository or a derivative.

| Material | License / attribution | Local record |
| --- | --- | --- |
| Original application code, procedural model code and City Kit geometry | MIT, Copyright © 2026 Zhengjiazhi | [LICENSE](LICENSE), [City Kit](assets/city-kit/README.md) |
| OpenStreetMap data and derived regional, airport, city and landmark datasets | © OpenStreetMap contributors, ODbL 1.0 | [Regional data](data/regions/DATA_LICENSE.md), [Hangzhou](data/hangzhou-atlas/NOTICE.md), [airports](data/airports/NOTICE.md), [Leifeng](data/scenes/leifeng/NOTICE.md), [West Lake](data/scenes/westlake/NOTICE.md) |
| geoBoundaries / HDX China ADM2 snapshot | CC BY 3.0 IGO; geoBoundaries / HDX, China administrative boundaries (2020) | [Prefecture attribution and processing](data/regions/prefectures/README.md), adjacent provenance.json |
| Natural Earth geographic selection outlines | Public domain; Natural Earth | [Map sources and modifications](docs/map-data.md), data/data-provenance.json |
| Mapzen / AWS terrain tiles and derived DEM | Source-specific terms and attribution; includes USGS GMTED2010 / SRTM and NOAA ETOPO1 | [Terrain sources](docs/geographic-data.md), data/hangzhou-atlas/scene-data.json source metadata, [AWS registry](https://registry.opendata.aws/terrain-tiles/) |
| Three.js, MapLibre and local vector/polygon parsers | Their respective MIT/BSD notices, including bundled helper notices | All LICENSE files and source/version records under vendor/ |
| Noto Serif SC font subsets | SIL Open Font License 1.1 | vendor/NOTO-OFL.txt and vendor/FONTS.md |

The OSM attribution above also covers the raw and derived geographic content under `data/scenes/hangzhou-details/` and `data/scenes/hangzhou-subjects/`. Their manifests and [source notes](docs/hangzhou-subject-models.md) record processing and model limitations. Terrain meshes, scene GLBs and precompiled caches are geographic visualizations; retain source attribution and the applicable data notices. They are not surveyed building models.

Source attribution remains visible in the app. OpenFreeMap is a source delivery service; do not treat its availability as a blanket replacement for the underlying data terms. Generic maps may request upstream tiles at runtime.

## Excluded reference material

Airport PDFs, chart PNGs, eAIP HTML pages and failed HTTP response bodies used for local research are not redistributed. Their public source URLs and factual provenance remain in the airport notice/fetch manifest. The airport builder uses the included OSM JSON, not those excluded documents. User-uploaded style references and local conversation records are excluded.

The repository's geographic snapshots can be simplified or stale. The airport dataset records historical research dates and is a tourism visualization, not operational navigation data. Source licenses and technical geography are independent of whether a particular deployment is appropriate for an audience or jurisdiction.
