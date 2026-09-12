# Public source verification

## Codex workflow — 0.0.3

Checked 2026-09-13 on the feature source, Node.js 24.19.0 and desktop Chrome (1600 × 1000).
The Hangzhou source/data/assets/cache are unchanged from the public 0.0.2 baseline.

- Source acquisition: 48 groups covering the real OSM sample, frozen bytes/hashes, geometry, unsafe relation rejection, paths/symlinks, network limits, timeout and cancellation.
- Generic builder: real-source footprint containment and holes, road/water exclusions, deterministic planting, exact landmark source IDs, bounded repairs, and 2,000-feature processing.
- Workflow: resume/checkpoint recovery, source snapshots, locks, code/asset invalidation, stale review rejection, failed-capture invalidation, finite/count checks, empty-building rejection, bounded repair and cancellation.
- Existing package, City Kit, city-starter and Hangzhou independent-detail checks passed. These checks did not rebuild their assets.
- Actual preview rendered **559 ordinary buildings, 126 roads, 5 water polygons, 49 green polygons and 988 trees**. One steep-support building was skipped with its source ID; support diagnostics reported zero violations. Three screenshots and a pagehide release check completed without page errors or failed requests.
- Ten additional actual browser interaction checks passed: labels, landmark location/description, full extent/source focus, source attribution, release, simulated persisted-page restoration, intentional failed load and successful retry.
- Repository skill format validation passed; an independent Codex skill trial reached `awaiting_visual_review` and resumed without rebuilding. That trial intentionally did not claim browser or visual acceptance.

**City visual result: needs revision.** The complete Wuhan boundary is shown, but the supplied OSM extract is only a small neighbourhood. It lacks full river/urban coverage and a bespoke Yellow Crane Tower model. The actual visual report records those gaps and the run remains `needs_revision`; this is a working-tool demonstration, not a completed Wuhan city or an accepted replacement for Hangzhou.

[Runtime and actual review](qa/city-workflow-runtime.json) · [Browser interaction checks](qa/city-workflow-browser.json) · [Default capture](media/city-workflow/default.png) · [Full extent](media/city-workflow/full.png) · [Landmark location](media/city-workflow/landmark.png)

The protocol test's synthetic PNGs are labelled fixtures for state/hash testing and are not counted as actual screenshots. Runtime diagnostics cannot prove engineering-grade collision freedom, visual correctness, complete coverage or user acceptance. Remote DEM availability remains an external dependency.

## Earlier public distribution — 0.0.2

Checked 2026-09-13 from the curated source checkout. Runtime checks used desktop Chrome, WebGL 2 and a 1600 × 1050 viewport. Screenshots are actual browser renders.

## Checks

- `npm run check`: catalogue references, local data/source contracts and JavaScript syntax.
- `npm run check:city-assets`: fixed asset structure, GLB files, unchanged asset hashes and abort/disposal paths. Twelve building assets, three tree components and two road components form sixteen assembled gallery entries.
- `npm run check:city-starter`: sourced Wuhan boundary hash, configuration and geometry validation, CLI byte-preserving output, refusal to overwrite, unsafe paths and aborted loads.
- Browser: Hangzhou loads its matching local fabric cache with 3,380 representative buildings; the independent West Lake entry opens. The new-city example loads the Wuhan boundary, terrain and nearby buildings, supports attraction selection and labels, releases its viewer on exit, and rebuilds after a simulated persisted `pageshow`. The City Kit gallery renders. Eleven checks passed, with no page errors or failed requests during this sample.

Report: [browser checks](qa/public-browser.json). Source-preservation evidence from the preceding height/colour work remains available as [geometry](qa/0.0.2-colour-geometry.json) and [runtime](qa/0.0.2-colour-runtime.json) records; those are historical checks, not additional browser runs for this publication.

## Inspect before extending

Run the three commands above, then inspect default and distant views, major roads, water, source-based building placement, contact with terrain, landmark names and switching away from the scene. Source hash checks do not establish current administrative accuracy or real building heights.

The standalone starter is a generic online geography example. Its Wuhan building coverage is visibly sparse and depends on upstream vector data; it does not reproduce the density or authored assets of the Hangzhou reference. Fill data gaps with verified sources rather than randomly scattering buildings.

## Limits

This is not a whole-country visual audit, long-duration GPU/memory benchmark, measured collision proof or mobile/Safari acceptance. The persisted-page test dispatches browser lifecycle events; it does not prove every browser will store the page in its back/forward cache. External DEM/vector availability can change. No full-city GLB export or public website hosting is included.
