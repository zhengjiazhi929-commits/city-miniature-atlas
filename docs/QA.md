# Public source verification — 0.0.2

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
