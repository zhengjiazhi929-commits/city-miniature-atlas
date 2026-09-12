# Leifeng geographic scene asset notices

Original loader, bake code and authored simplified tower geometry follow the repository's MIT license. Geographic source data retain their own terms.

- © OpenStreetMap contributors. The archived and adapted geographic database (`source-features.geojson`, `tower-way.json`) is made available under ODbL 1.0: https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/ . The GLB contains a produced visual work derived from this database. Retain attribution and provide the adapted geographic source alongside reuse.
- Terrain Tiles was accessed on 2026-09-08 from https://registry.opendata.aws/terrain-tiles/ . Mapzen Terrain Tiles are a multi-source dataset; source-specific attribution and terms: https://github.com/tilezen/joerd/blob/master/docs/attribution.md . Global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey; global ETOPO1 terrain data from the U.S. National Oceanic and Atmospheric Administration. No claim is made that the PNG payload identifies the exact contributing survey at each pixel.
- The raw archived DEM PNGs are unchanged. The build applies the repository's bounded isolated-outlier filter, hydro-flattens mapped water to locally estimated DEM levels, and clips the terrain to the documented view frame. It does not create synthetic hills.
- Photograph and tourism-page references were inspected for shape only. No external photograph, logo or third-party 3D asset is redistributed.

See ../../../docs/leifeng-real-sources.md and metadata.json for accuracy boundaries and source URLs. The decorative frame is not a legal scenic-area boundary.
