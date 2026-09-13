import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {buildCityPlan, inspectCityPlan, repairCityPlan} from '../src/city-build-plan.js';

// Synthetic geometry is confined to these tests. Production never invents
// source land, buildings, water, roads, or landmark coordinates.
const M = 111320, origin = [114.3, 30.6], longitudeM = M * Math.cos(origin[1] * Math.PI / 180);
const geo = ([x, y]) => [origin[0] + x / longitudeM, origin[1] + y / M];
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(geo);
const polygon = (id, rings, tags = {}) => ({type: 'Feature', id, properties: tags, geometry: {type: 'Polygon', coordinates: rings}});
const line = (id, points, tags = {}) => ({type: 'Feature', id, properties: tags, geometry: {type: 'LineString', coordinates: points.map(geo)}});
const collection = features => ({type: 'FeatureCollection', features});
const boundary = polygon('boundary', [rect(0, 0, 1200, 1200), rect(900, 900, 100, 100)]);
const source = collection([
  polygon('b-residential', [rect(70, 70, 40, 30)], {building: 'apartments', height: '32 m'}),
  polygon('b-commercial', [rect(160, 70, 40, 30)], {tags: {building: 'office', 'building:levels': '7'}}),
  polygon('b-industrial', [rect(250, 70, 60, 45)], {building: 'warehouse', height: '30 ft'}),
  polygon('b-generic', [rect(350, 70, 40, 30)], {building: 'yes'}),
  polygon('b-water', [rect(450, 450, 40, 30)], {building: 'yes'}),
  polygon('b-road', [rect(600, 270, 40, 60)], {building: 'yes'}),
  polygon('b-hole', [rect(920, 920, 40, 30)], {building: 'yes'}),
  polygon('b-outside', [rect(1300, 70, 40, 30)], {building: 'yes'}),
  polygon('b-with-hole', [rect(650, 60, 100, 100), rect(695, 105, 10, 10)], {building: 'yes', height: 20}),
  polygon('lake', [rect(400, 400, 200, 200), rect(470, 470, 30, 30)], {natural: 'water'}),
  polygon('park', [rect(30, 30, 800, 800), rect(700, 650, 50, 50)], {leisure: 'park'}),
  line('primary', [[10, 300], [500, 300], [1190, 300]], {highway: 'primary', width: '12', bridge: 'no'}),
  line('bridge', [[450, 350], [450, 650]], {highway: 'secondary_link', bridge: 'yes', lanes: '2'}),
  line('minor-omitted', [[30, 250], [900, 250]], {highway: 'residential'}),
]);
const original = structuredClone({boundary, source});
const display = {maxTrees: 90};
const landmarks = [{id: 'real-test-anchor', coordinates: geo([200, 200]), sourceUrl: 'https://example.com/test-only-source'}];
const plan = buildCityPlan({boundary, features: source, display, landmarks});
assert.equal(plan.schema, 'city-build-plan-v1');
assert.deepEqual({boundary, source}, original, 'Planner must not mutate source data.');
assert.deepEqual(plan.boundary, boundary, 'All boundary vertices and holes stay exact.');
assert.deepEqual(plan.landmarks, landmarks);
assert.deepEqual(plan.display, display);
assert.deepEqual(plan.water[0].rings, source.features.find(f => f.id === 'lake').geometry.coordinates);
assert.deepEqual(plan.roads.find(r => r.sourceId === 'primary').coordinates, source.features.find(f => f.id === 'primary').geometry.coordinates, 'Road source vertices are never simplified or relocated.');
assert.equal(plan.roads.length, 2, 'Only configured major road classes are included.');
assert.equal(plan.roads.find(r => r.sourceId === 'bridge').bridge, true);
assert.equal(plan.roads.find(r => r.sourceId === 'bridge').widthMeters, 6.6);
assert.deepEqual(plan.buildings.map(b => b.sourceId).sort(), ['b-commercial', 'b-generic', 'b-industrial', 'b-residential', 'b-with-hole']);
assert.equal(plan.buildings.find(b => b.sourceId === 'b-residential').family, 'residential');
assert.equal(plan.buildings.find(b => b.sourceId === 'b-commercial').family, 'commercial');
assert.equal(plan.buildings.find(b => b.sourceId === 'b-industrial').family, 'industrial');
assert.equal(plan.buildings.find(b => b.sourceId === 'b-generic').family, 'generic');
assert.equal(plan.buildings.find(b => b.sourceId === 'b-residential').heightMeters, 32);
assert.equal(plan.buildings.find(b => b.sourceId === 'b-commercial').heightSource, 'source-levels-estimate');
assert.ok(Math.abs(plan.buildings.find(b => b.sourceId === 'b-industrial').heightMeters - 9.144) < 1e-9);
assert.ok(plan.trees.length > 0 && plan.trees.length <= 90);
assert.ok(plan.sourceIssues.some(i => i.code === 'source-building-over-water'));
assert.ok(plan.sourceIssues.some(i => i.code === 'source-building-over-road'));
assert.ok(plan.sourceIssues.some(i => i.code === 'source-building-outside-boundary'));
assert.equal(inspectCityPlan(plan).ok, true);
assert.equal(inspectCityPlan(plan).status, 'partial', 'Source coverage never becomes verified by a geometry pass.');
assert.deepEqual(buildCityPlan({boundary, features: source, display, landmarks}), plan, 'Repeated runs must be byte-serializable deterministically.');
assert.deepEqual(buildCityPlan({boundary, features: collection([...source.features].reverse()), display, landmarks}), plan, 'Stable source ids make accepted geometry independent of feature order.');

const identifiedLandmarks = [{...landmarks[0], sourceId: 'b-residential', coordinates: geo([90, 85])}];
const reserved = buildCityPlan({boundary, features: source, display, landmarks: identifiedLandmarks});
assert.deepEqual(reserved.landmarks, identifiedLandmarks, 'Landmark input and coordinates remain exact.');
assert.equal(reserved.buildings.some(b => b.sourceId === 'b-residential'), false, 'An explicitly identified landmark cannot receive a generic asset substitute.');
assert.equal(reserved.landmarkFootprints.length, 1);
assert.deepEqual(reserved.landmarkFootprints[0].rings, source.features.find(f => f.id === 'b-residential').geometry.coordinates);
assert.equal(reserved.sourceIssues.filter(i => i.code === 'LANDMARK_MODEL_REQUIRED').length, 1);
assert.equal(reserved.sourceIssues.find(i => i.code === 'LANDMARK_MODEL_REQUIRED').sourceId, 'b-residential');
assert.equal(inspectCityPlan(reserved).ok, true, 'Trees and other display objects must avoid the reserved source landmark footprint.');
const sourceNotes = structuredClone(reserved.sourceIssues), firstInspection = inspectCityPlan(reserved);
assert.deepEqual(inspectCityPlan(reserved), firstInspection);
assert.deepEqual(reserved.sourceIssues, sourceNotes, 'Repeated inspection cannot append or multiply source warnings.');
assert.ok(plan.buildings.some(b => b.sourceId === 'b-residential'), 'A nearby label without an explicit sourceId does not suppress ordinary geometry.');
const substitutedLandmark = structuredClone(reserved); substitutedLandmark.buildings.push(structuredClone(plan.buildings.find(b => b.sourceId === 'b-residential')));
assert.ok(inspectCityPlan(substitutedLandmark).issues.some(i => i.code === 'LANDMARK_GENERIC_SUBSTITUTE'));
const landmarkRepair = repairCityPlan(substitutedLandmark);
assert.equal(inspectCityPlan(landmarkRepair.plan).ok, true);
assert.deepEqual(landmarkRepair.plan.landmarks, identifiedLandmarks);
assert.deepEqual(landmarkRepair.plan.landmarkFootprints, reserved.landmarkFootprints, 'Repair preserves reserved source landmark footprints.');

// Inspection uses the full transformed footprint, including enclosed holes and
// road buffers; checking the instance anchor alone would pass these examples.
const forged = structuredClone(plan);
const model = forged.buildings[0];
function relocate(item, x, y, width, depth) {
  item.coordinate = geo([x, y]); item.widthMeters = width; item.depthMeters = depth; item.rotation = 0;
  item.footprint = rect(x - width / 2, y - depth / 2, width, depth);
  item.sourceRings = [rect(x - width, y - depth, width * 2, depth * 2)];
}
relocate(model, 430, 430, 80, 80);
assert.ok(inspectCityPlan(forged).issues.some(i => i.code === 'over-water' && i.objectId === model.id));
relocate(model, 590, 280, 60, 32);
assert.ok(inspectCityPlan(forged).issues.some(i => i.code === 'over-road'), 'Road width is an exclusion, not just the line itself.');
relocate(model, 950, 950, 150, 150);
assert.ok(inspectCityPlan(forged).issues.some(i => i.code === 'outside-boundary'), 'An enclosed boundary hole cannot pass four-corner containment.');
relocate(model, 200, 200, 20, 20); model.footprint[1][0] += .001;
assert.ok(inspectCityPlan(forged).issues.some(i => i.code === 'invalid-display-footprint'), 'Saved footprint must agree with render transform.');

const damaged = structuredClone(plan);
damaged.buildings[0].heightMeters = 5000;
const overlap = structuredClone(damaged.buildings[1]); overlap.id = 'building:overlap-copy:0'; damaged.buildings.push(overlap);
damaged.buildings.push(structuredClone(damaged.buildings[2]));
const damagedSources = structuredClone({boundary: damaged.boundary, water: damaged.water, roads: damaged.roads, green: damaged.green});
const zero = repairCityPlan(damaged, {maxChanges: 0});
assert.equal(zero.changes.length, 0);
assert.ok(zero.unresolved.some(i => i.severity === 'error'));
const one = repairCityPlan(damaged, {maxChanges: 1});
assert.equal(one.changes.length, 1);
assert.ok(one.unresolved.some(i => i.severity === 'error'));
const repaired = repairCityPlan(damaged, {maxChanges: 10});
assert.equal(repaired.changes.length, 3, 'One height clamp and two instance removals.');
assert.equal(inspectCityPlan(repaired.plan).ok, true);
assert.deepEqual({boundary: repaired.plan.boundary, water: repaired.plan.water, roads: repaired.plan.roads, green: repaired.plan.green}, damagedSources, 'Repair cannot alter source geometry.');
assert.equal(damaged.buildings[0].heightMeters, 5000, 'Repair cannot mutate its input.');
assert.ok(repaired.unresolved.some(i => i.code === 'coverage-unverified'));
assert.ok(repaired.unresolved.some(i => i.code === 'presentation-repaired'));
assert.equal(inspectCityPlan(repaired.plan).status, 'partial');
assert.throws(() => repairCityPlan(damaged, {maxChanges: -1}), /maxChanges/);

const allBad = structuredClone(plan);
allBad.buildings.forEach(item => relocate(item, 1300, 1300, 20, 20));
const removed = repairCityPlan(allBad);
assert.equal(removed.plan.buildings.length, 0);
assert.ok(removed.unresolved.some(i => i.code === 'no-building-representation'), 'Deleting every instance cannot claim completed coverage.');

const empty = buildCityPlan({boundary, features: collection([])});
assert.equal(empty.buildings.length + empty.roads.length + empty.water.length + empty.green.length + empty.trees.length, 0, 'Missing geometry never produces invented city fabric.');
for (const code of ['missing-building-data', 'missing-road-data', 'missing-water-data', 'missing-green-data']) assert.ok(empty.issues.some(i => i.code === code));
const grass = buildCityPlan({boundary, features: collection([polygon('grass', [rect(50, 50, 300, 300)], {landuse: 'grass'})])});
assert.equal(grass.green.length, 1);
assert.equal(grass.trees.length, 0, 'A sourced lawn does not establish forest or park tree coverage.');
assert.throws(() => buildCityPlan({boundary, features: []}), /FeatureCollection/);
assert.throws(() => buildCityPlan({boundary: {}, features: source}), /Feature/);
const brokenBoundary = structuredClone(boundary); brokenBoundary.geometry.coordinates[0].pop();
assert.throws(() => buildCityPlan({boundary: brokenBoundary, features: source}), /closed/);
assert.throws(() => buildCityPlan({boundary, features: source, display: {maxTrees: Infinity}}), /finite/);
const invalidSource = structuredClone(source.features[0]); invalidSource.geometry.coordinates[0][1][0] = NaN;
assert.ok(buildCityPlan({boundary, features: collection([invalidSource])}).issues.some(i => i.code === 'invalid-source-geometry'));
assert.equal(inspectCityPlan(null).ok, false);
assert.ok(repairCityPlan(null).unresolved.some(i => i.code === 'invalid-plan-source'));
const malformed = structuredClone(plan); malformed.buildings.push(null);
assert.ok(inspectCityPlan(malformed).issues.some(i => i.code === 'invalid-display-instance'));
assert.equal(inspectCityPlan(repairCityPlan(malformed).plan).ok, true);
const malformedSource = structuredClone(plan); malformedSource.water[0].rings[0].pop();
const unresolvedSource = repairCityPlan(malformedSource);
assert.equal(unresolvedSource.changes.length, 0);
assert.deepEqual(unresolvedSource.plan.water, malformedSource.water);
assert.ok(unresolvedSource.unresolved.some(i => i.code === 'invalid-plan-source'));
const capped = buildCityPlan({boundary, features: source, display: {maxFeatures: 3, maxTrees: 10}});
assert.equal(capped.buildings.length, 0, 'Truncated exclusion inputs cannot support supposedly safe model placement.');
assert.equal(capped.trees.length, 0);
assert.ok(capped.issues.some(i => i.code === 'placement-blocked-incomplete-exclusions'));
const roadCap = buildCityPlan({boundary, features: source, display: {maxRoads: 1}});
assert.equal(roadCap.roads.length, 1);
assert.equal(roadCap.buildings.length, 0);

// Performance guard exercises 2,000 independent real-position-sized polygons.
// Wide timing allowance catches accidental unbounded work without treating a
// shared laptop's transient scheduling as a benchmark failure.
const many = Array.from({length: 2000}, (_, i) => polygon(`source-${String(i).padStart(4, '0')}`, [rect(20 + i % 50 * 20, 20 + Math.floor(i / 50) * 20, 12, 10)], {building: 'yes', height: 10}));
const started = performance.now();
const large = buildCityPlan({boundary, features: collection(many), display: {maxTrees: 0}});
const elapsed = performance.now() - started;
assert.equal(large.buildings.length, 2000);
assert.equal(inspectCityPlan(large).ok, true);
assert.ok(elapsed < 15000, `2,000-building planner exceeded its bounded-work allowance: ${elapsed.toFixed(0)} ms.`);
console.log(`City build plan checks passed: exact source geometry, conservative footprints and holes, physical road buffers, sourced deterministic planting, missing-data disclosure, bounded repair, and 2,000 features in ${elapsed.toFixed(0)} ms. Visual acceptance remains separate.`);
