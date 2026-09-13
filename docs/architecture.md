# Architecture and extension boundaries

## Runtime

`src/app.js` owns navigation. A city change destroys the previous viewer and cancels its loading work. Scene-owned geometry, materials, textures, instances and WebGL resources have explicit release paths. Only the current region is retained.

- `src/regional-viewer.js`: generic independent geographic region; `region-boundaries`, `region-terrain`, `region-vectors` load boundaries, online DEM and vector features. This is the starter path for another city. It uses Three.js directly.
- `src/hangzhou-sandtable.js`: dedicated Hangzhou reference. Loads bundled city data, compiled terrain/fabric, source-based street blocks, display palettes, vegetation and custom landmarks.
- `src/city-assets.js`: fixed, verified City Kit geometry and wall/glass/metal material slots. The loading/ownership contract is reusable; placing assets is each city's responsibility.
- `src/scenes/`: individual attraction subjects. Natural landmarks and temple groups use purpose-built composition; an attraction name alone does not supply a model.
- `src/city-airports.js` and `airport-model.js`: sourced airport registry and geometry. Generic cities need their own verified airport coverage.

The old MapLibre module remains as historical source compatibility; it is not the current generic viewer or Hangzhou rendering engine.

## Geographic and display layers

Boundary, water polygons, major roads, terrain and landmark anchors are source data. Tree counts, ordinary building dimensions, model colours, vertical exaggeration and camera framing are display choices. Keep these layers explicit. Never silently alter source coordinates to make a screenshot prettier.

The generic viewer supports the current projection/latitude and data-coverage limits. A city outside China can use its own boundary in the standalone starter; that does not add a global country/province navigation database.

## Hangzhou-specific dependencies

`hangzhou-catalog`, `hangzhou-district-massing`, signature-building datasets, display envelopes, terrain/fabric caches and attraction subject files contain local assumptions. Copying these with a different city name does not produce a correct new city. See [add-a-city](add-a-city.md) before adapting them.

`hangzhou-fabric-cache.js` fingerprints builder sources, inputs and the City Kit manifest. A matching cache is parsed into real BufferGeometry/materials. A mismatch rebuilds from the active inputs. Cache files must not be reused across cities by changing only an ID.

## Build versus run

The website can run from the checked-in assets without rebuilding GIS datasets. Optional construction tools require the exact raw inputs named in their provenance and sometimes Python libraries or Playwright. Those large historical working archives are not all included. [Tooling requirements](../scripts/README.md).

## Codex-driven production workflow (0.0.3)

The repository skill at `.agents/skills/build-city/SKILL.md` directs Codex to research sources, call the tools, inspect actual screenshots and revise. This is an agent workflow executed by Codex, not an embedded model runtime in the website.

- `scripts/city-sources.mjs`: bounded local/explicit HTTPS source acquisition, Overpass/GeoJSON normalization and raw source provenance.
- `src/city-build-plan.js`: city-independent, deterministic source-footprint planning, geometric inspection and bounded display repair. It does not call Hangzhou placement logic.
- `scripts/city-workflow.mjs`: per-run lock, persistent stages, immutable artifact blobs, fingerprint invalidation, bounded repair loop and plan/capture-bound review.
- `src/city-plan-viewer.js`: shared City Kit on real DEM, physical roads/water, ground support, geographic labels and disposal. The viewer reports skipped objects rather than claiming a complete city.
- `scripts/city-workflow/capture.mjs`: optional local Playwright capture with actual rendered-count and lifecycle evidence.

Research decisions and visual judgment belong to Codex. Arbitrary landmark architecture, data completeness and user visual acceptance are not automatic. A reviewed partial task remains limited to its declared coverage. See [workflow contract](city-workflow.md).
