# Shared City Kit 1.7.0

Twelve reusable building types, three tree components, two road components and two complete-tree GLB presets. The [interactive gallery](../../docs/city-kit.html) uses the same geometry and materials as Hangzhou and offers individual GLB downloads. Geometry is original and follows this project's MIT license; Three.js retains its bundled license.

These are representative architectural forms, not surveyed buildings. Real boundaries, roads, water, terrain, land use and landmark locations belong to each city's source data. An asset's courtyard or facade is a display choice, not evidence of a real development.

## Building library

There are four residential, four generic, two commercial and two industrial types. Their differences are geometric: slab and multi-wing plans, balconies, U-shaped courtyards, L-shaped corners, setbacks, chamfered curtain walls, roof ribbons and sawtooth factories. Stable legacy IDs such as `residential-twins` do not imply two detached towers; every asset has one dominant principal building.

| ID | Gallery name | Family | Triangles |
| --- | --- | --- | ---: |
| `residential-slab` | 宽板住宅楼 | residential | 1,392 |
| `residential-twins` | 退台公寓楼 | residential | 804 |
| `commercial-office` | 切角玻璃办公塔楼 | commercial | 1,212 |
| `commercial-block` | 退台商业综合楼 | commercial | 1,188 |
| `industrial-sheds` | 单体生产厂房 | industrial | 504 |
| `industrial-logistics` | 单体仓储厂房 | industrial | 372 |
| `generic-courtyard` | 围合庭院公共楼 | generic | 896 |
| `generic-stepped` | 转角退台街坊楼 | generic | 1,072 |
| `generic-ribbon` | 带状幕墙办公楼 | generic | 880 |
| `generic-point` | 竖向窗格公寓楼 | generic | 828 |
| `residential-gallery` | 连续阳台住宅 | residential | 732 |
| `residential-point` | 多翼公寓楼 | residential | 844 |

Building JSON totals **1,954,081 bytes**; all seventeen runtime geometry JSON files total **2,069,489 bytes**. The largest asset has **1,392 triangles**. There are nineteen GLB files, including the complete-tree presets. GLBs are optional downloads; the city loader requests JSON geometry.

## Geometry and material contract

The `v1` directory denotes schema version 1; the semantic asset version is 1.7.0. `manifest.json` records filenames, SHA-256, byte sizes, triangle counts, profiles, actual bounds and the generator hash. JSON contains Float32 positions, normals, linear-sRGB vertex colours, triangle indices and material groups. GLB primitives preserve the same buffers and group index ranges. No external texture is needed for the assets.

Buildings have a closed foundation covering X/Z −0.5…+0.5 with bottom Y=0 and top Y=0.012; the highest roof reaches Y=1. Whole-footprint bounds include roof projections and balconies. `primaryBody` comes from actual principal-solid vertices, excluding facade strips and roofs. The principal solid can be concave or chamfered: its bounding-box volume is **not** its actual enclosed volume. Use actual footprint polygons and cap triangles for contact checks.

`parts` lists complete component triangle ranges, and `materialSlots` describes wall, glass and metal slots. Every runtime building uses this array:

| Slot | Surface | Material | Roughness | Metalness |
| --- | --- | --- | ---: | ---: |
| 0 | Masonry, opaque bands and roof | MeshStandardMaterial | 0.78 | 0.035 |
| 1 | Backed reflective glazing | MeshPhysicalMaterial | 0.085 | 0.65 |
| 2 | Aluminium mullions | MeshStandardMaterial | 0.34 | 0.65 |

Glass also uses clearcoat 0.55. Some punched-window buildings need only slots 0 and 1; unused metal groups are omitted. Call **`createCityAssetMaterials()`**, not the legacy singular factory. One opaque material across all groups loses the wall/glass distinction. Runtime colours remain neutral silver and grey with restrained blue-grey glazing; do not multiply every surface with a saturated instance colour.

Reflective glazing needs an environment. Hangzhou and the gallery each own a small procedural PMREM environment (`src/city-reflection-environment.js`), with diffuse sky, bright strips and anonymous skyline silhouettes. It responds to view direction; it does not reflect the actual nearby buildings. This environment is separate from the asset and is not embedded in GLB. Other viewers provide their own lighting. Glazing is a backed opaque facade surface, not a transparent building interior.

## Loading and ownership

Use the project's Three.js import map or your bundler's matching Three.js module:

```js
import * as THREE from 'three';
import {loadCityAssets, createCityAssetMaterials} from './src/city-assets.js';

const kit = await loadCityAssets({signal});
const asset = kit.buildings.residential[0];
const materials = createCityAssetMaterials();
const mesh = new THREE.InstancedMesh(asset.geometry, materials, count);
// Populate matrices using verified geographic footprints and actual asset bounds.
// Set the consuming scene's reflection environment and own its lifecycle.

// After all instances using this invocation have stopped:
mesh.dispose();
materials.forEach(material => material.dispose());
kit.dispose();
```

One load owns seventeen shared geometries with no permanent global cache. Abort or failure releases partially loaded resources; `kit.dispose()` is idempotent. The kit does not own caller meshes, materials or environments. A fresh invocation owns a separate set. Dispose the caller's resources when leaving a city, then release the kit and environment.

`buildings` exposes the four families above. Each item includes `id`, `name`, `family`, `variant`, `geometry`, `parts`, `primaryBody`, `bounds`, `triangles`, preview/profile ratios and absolute `downloads.json` / `downloads.glb` URLs. `displayUnit: compound` includes its base and edge space; `buildingCount: 1` describes the dominant representative building.

`previewHeightToWidth` is the gallery proportion, separate from a city's display exaggeration. `primaryHeightToWidth` and `maxPrimarySlenderness` guide the city's actual body dimensions; `recommendedDepthToWidth` guides footprint ratios. None are measured local floors or dimensions.

## Source placement and reuse

Choose a compatible family from real source land use. Establish footprint, orientation and scale before placement, then validate the complete transformed geometry against terrain, road, water, natural-area and neighbouring-building exclusions. A larger display scale does not authorize moving the real road or deforming the lake. Bounded display envelopes, where permitted by a city, must remain separately documented; never treat them as new geographic source data.

Variation should cover the dominant local category as well as a few prominent office towers. Hangzhou selects residential/generic variants deterministically by neighbourhood, retaining coherent style within blocks instead of randomly recolouring every house. Its city-specific size reference and geographic placement are not encoded into the reusable kit.

## Trees and roads

`kit.trees.broadCrown`, `uprightCrown` and `trunk` retain their original component buffers. White crown vertices accept the consuming city's tree palette. Crown and trunk transforms remain independent for terrain support and collision checks. Two complete-tree GLB presets reuse these components and overlap crowns with grounded trunks.

`kit.roads.deck` and `pier` are closed unit-box primitives; `roadProfile` supplies class colours and relative widths. They do not replace real road alignment, curved meshes, junctions, bridge tags or terrain support. Do not assemble a fictitious road network from straight pieces.

## Rebuild and verify

```sh
node scripts/build-city-assets.mjs
node scripts/check-city-assets.mjs --report docs/qa/city-assets-local.json
```

Run from `outputs/china-atlas` with Node.js 18+. The bundled Three.js and GLTFExporter are sufficient; no network, Blender or package installation is required. The generator checks component closure, maximum triangle counts and a 2.4 MB building-JSON budget before replacing assets. Rebuild city caches after changing the kit: `manifest.source.sha256` and the runtime manifest fingerprint bind cache inputs to their source.

The portable check verifies buffers, positive closed solids, GLB group/buffer parity, hashes, cancellation and complete independent disposal. Actual non-box contact and final city support/source/lifetime checks are recorded in v0.22 QA（历史记录未随公开包分发）. Technical checks do not establish visual acceptance or surveyed architectural accuracy.
