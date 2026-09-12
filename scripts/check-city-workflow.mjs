import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import * as workflow from './city-workflow.mjs';
import {buildCityPlan, inspectCityPlan} from '../src/city-build-plan.js';

// All invented geographic and screenshot data in this file are TEST FIXTURES.
// They test the persisted protocol, never claim a real city or browser review.
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'city-workflow-check-')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (file, value) => { await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
const runDir = id => path.join(root, 'work/city-runs', id);
const stateOf = id => read(path.join(runDir(id), 'state.json'));
const metadata = {url: 'https://example.com/synthetic-workflow-test-fixture', license: 'CC0-1.0', attribution: 'Synthetic protocol test only; not geographic evidence'};
const point = ([x, y]) => [114.3 + x / (111320 * Math.cos(30.6 * Math.PI / 180)), 30.6 + y / 111320];
const ring = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(point);
const polygon = (id, rings, properties) => ({type: 'Feature', id, properties, geometry: {type: 'Polygon', coordinates: rings}});
const boundary = polygon('synthetic-boundary', [ring(0, 0, 1000, 1000)], {name: 'Synthetic Test City'});
const buildings = Array.from({length: 6}, (_, i) => polygon(`test-building-${i}`, [ring(60 + i * 45, 60, 30, 24)], {building: i % 2 ? 'office' : 'apartments', height: 18}));
const features = {type: 'FeatureCollection', features: [...buildings,
  polygon('test-water', [ring(700, 700, 100, 100)], {natural: 'water'}),
  polygon('test-park', [ring(400, 100, 180, 180)], {leisure: 'park'}),
  {type: 'Feature', id: 'test-road', properties: {highway: 'primary', width: 12}, geometry: {type: 'LineString', coordinates: [[20, 350], [980, 350]].map(point)}}]};
const brief = {schema: 'city-task-v1', city: {id: 'synthetic-test-city', name: 'Synthetic Test City', coordinates: point([500, 500])},
  boundary: {path: 'data/test-boundary.geojson', source: metadata}, sources: [{id: 'test-source', kind: 'geojson', path: 'data/test-source.geojson', source: metadata}],
  landmarks: [{id: 'test-landmark', name: 'Synthetic Test Anchor', coordinates: point([150, 150]), description: 'Protocol fixture only.', sourceUrl: metadata.url}],
  display: {maxTrees: 20}, coverage: 'Synthetic protocol test extent only; no real-city claims.'};

// Build an actual decodable PNG so file-format/hash checks are exercised.
// Its pixels are synthetic and are never browser rendering evidence.
function pngFixture(width = 1600, height = 1000) {
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3; pixels[offset] = (x * 31 + y * 17) % 256; pixels[offset + 1] = (x * 7 + y * 13) % 256; pixels[offset + 2] = (x + y * 3) % 256;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Comment\0Synthetic workflow protocol fixture, not a browser capture.')), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const png = pngFixture();
const captureOf = async (id, label = 'protocol') => {
  const dir = runDir(id), bytes = await fs.readFile(path.join(dir, 'plan.json')), plan = JSON.parse(bytes);
  const relative = `captures/${label}.png`; await fs.mkdir(path.join(dir, 'captures'), {recursive: true}); await fs.writeFile(path.join(dir, relative), png);
  const counts = {buildings: plan.buildings.length, roads: plan.roads.length, roadSegments: plan.roads.reduce((n, r) => n + r.coordinates.length - 1, 0),
    bridges: plan.roads.filter(r => r.bridge).length, bridgePiers: 0, water: plan.water.length, green: plan.green.length, trees: plan.trees.length, landmarks: plan.landmarks.length};
  return {schema: 'city-capture-v1', capturedAt: new Date().toISOString(), planSha256: hash(bytes), viewport: {width: 1600, height: 1000}, ok: true,
    images: [{pose: 'default', path: relative, sha256: hash(png)}], errors: [], failedRequests: [],
    diagnostics: {ready: true, renderReady: true, state: 'ready', destroyed: false, finite: true, drawCalls: 30, triangles: 10000, counts,
      ...counts, groundedBuildings: counts.buildings, supportSkirts: counts.buildings, renderedObjects: Object.values(counts).reduce((a, b) => a + b, 0), skipped: [], warnings: []},
    scope: 'Synthetic protocol fixture; not browser rendering or visual acceptance evidence.'};
};
const reviewOf = async (id, label = 'protocol-review', verdict = 'pass') => {
  const state = await stateOf(id), relative = `data/${label}.json`, review = {schema: 'city-visual-review-v1', verdict,
    planSha256: state.artifacts['plan.json'], captureSha256: state.artifacts['capture.json'],
    summary: 'Synthetic protocol test verdict only. No human or browser visual acceptance is claimed.', findings: []};
  await write(path.join(root, relative), review); return relative;
};
const createBuiltRun = async id => {
  await workflow.initRun({root, id, briefPath: 'data/test-brief.json'});
  return workflow.runWorkflow({root, id});
};
const assertRebuildRequired = async id => {
  // A read-only status may return a rebuild state or reject a stale fingerprint;
  // either is acceptable, but silently reporting the old approval is not.
  let current;
  try { current = await workflow.statusRun({root, id}); }
  catch (error) { assert.match(error.message, /rebuild|fingerprint|code|asset|changed|stale/i); return; }
  const tellsRebuild = /rebuild|stale/.test(String(current.status)) || current.needsRebuild === true || current.requiresRebuild === true;
  assert.ok(tellsRebuild, `Changed executable/asset inputs must explicitly require rebuild: ${JSON.stringify(current)}`);
  assert.notEqual(current.status, 'ready_for_delivery');
};

try {
  // Copy executable inputs rather than fabricate hashes or stub acquisition.
  for (const relative of ['src', 'scripts', 'examples/city-workflow', 'assets/city-kit/v1', 'vendor', 'regions.css']) {
    await fs.mkdir(path.dirname(path.join(root, relative)), {recursive: true});
    await fs.cp(path.join(sourceRoot, relative), path.join(root, relative), {recursive: true});
  }
  await write(path.join(root, 'data/test-boundary.geojson'), boundary);
  await write(path.join(root, 'data/test-source.geojson'), features);
  await write(path.join(root, 'data/test-brief.json'), brief);

  const initialized = await workflow.initRun({root, id: 'main', briefPath: 'data/test-brief.json'});
  assert.equal(initialized.status, 'created');
  assert.deepEqual(initialized.stages, {collect: 'pending', build: 'pending', check: 'pending', visual: 'pending'});
  await assert.rejects(() => workflow.initRun({root, id: 'main', briefPath: 'data/test-brief.json'}), /exist|overwrite/i);
  const built = await workflow.runWorkflow({root, id: 'main'});
  assert.equal(built.status, 'awaiting_visual_review');
  assert.equal(built.stages.collect, 'done'); assert.equal(built.stages.build, 'done'); assert.equal(built.stages.check, 'done');
  assert.equal(built.check.ok, true);
  const persisted = await stateOf('main'), initialPlanBytes = await fs.readFile(path.join(runDir('main'), 'plan.json'));
  const collected = await read(path.join(runDir('main'), 'collected.json'));
  assert.deepEqual(collected.boundary.geometry, boundary.geometry);
  assert.deepEqual(collected.features.features.map(f => f.geometry), features.features.map(f => f.geometry));
  assert.equal(JSON.parse(initialPlanBytes).buildings.length, 6);
  assert.ok(Object.keys(persisted.artifacts).some(name => /sources\/.*\.geojson$/.test(name)), 'Acquisition must persist the actual source snapshot.');
  for (const [name, digest] of Object.entries(persisted.artifacts)) assert.equal(hash(await fs.readFile(path.join(runDir('main'), name))), digest, `Persisted hash must match ${name}.`);
  const resumed = await workflow.runWorkflow({root, id: 'main'});
  assert.equal(resumed.attempt, built.attempt, 'Resume should not rebuild an unchanged checked run.');
  assert.deepEqual(await fs.readFile(path.join(runDir('main'), 'plan.json')), initialPlanBytes);
  assert.deepEqual(await workflow.statusRun({root, id: 'main'}), resumed);
  const interruptedState = await stateOf('main'); interruptedState.pendingAliases = ['checks.json'];
  await write(path.join(runDir('main'), 'state.json'), interruptedState);
  await fs.unlink(path.join(runDir('main'), 'checks.json'));
  assert.equal((await workflow.statusRun({root, id: 'main'})).status, 'awaiting_visual_review');
  assert.equal(hash(await fs.readFile(path.join(runDir('main'), 'checks.json'))), interruptedState.artifacts['checks.json']);
  assert.deepEqual((await stateOf('main')).pendingAliases, [], 'Committed immutable blobs complete an interrupted alias update.');
  const externalSourceBytes = await fs.readFile(path.join(root, 'data/test-source.geojson'));
  await write(path.join(root, 'data/test-source.geojson'), {type: 'FeatureCollection', features: []});
  assert.equal((await workflow.runWorkflow({root, id: 'main'})).attempt, built.attempt, 'Resume uses its frozen snapshot when the external source file changes.');
  assert.deepEqual(await fs.readFile(path.join(runDir('main'), 'plan.json')), initialPlanBytes);
  await fs.writeFile(path.join(root, 'data/test-source.geojson'), externalSourceBytes);

  // Runtime counters must provide affirmative rendering evidence. A boolean
  // "ok" and a valid PNG cannot substitute for actual finite/count checks.
  const goodCapture = await captureOf('main');
  const emptyRepresentation = buildCityPlan({boundary, features, landmarks: brief.landmarks, display: {maxRoads: 0}});
  assert.ok(emptyRepresentation.stats.sourceBuildings > 0);
  assert.equal(emptyRepresentation.buildings.length, 0, 'An incomplete road budget withholds the building representation.');
  const emptyRuntime = structuredClone(goodCapture);
  Object.assign(emptyRuntime.diagnostics.counts, {buildings: 0, roads: 0, roadSegments: 0, trees: 0,
    water: emptyRepresentation.water.length, green: emptyRepresentation.green.length, landmarks: emptyRepresentation.landmarks.length});
  const emptyRuntimeErrors = workflow.runtimeCaptureErrors(emptyRepresentation, emptyRuntime);
  assert.equal(emptyRuntimeErrors.length, 1, 'Finite rendering counters alone cannot validate a plan that omitted every known source building.');
  assert.match(emptyRuntimeErrors[0], /source buildings|ordinary building/i);
  const runtimeFailures = [];
  const wrongImageHash = structuredClone(goodCapture); wrongImageHash.images[0].sha256 = '0'.repeat(64);
  await assert.rejects(() => workflow.recordCapture({root, id: 'main', capture: wrongImageHash}), /hash|screenshot/i);
  for (const [caseIndex, mutate] of [
    c => { c.diagnostics.finite = false; },
    c => { c.diagnostics.drawCalls = 0; },
    c => { c.diagnostics.drawCalls = NaN; },
    c => { c.diagnostics.drawCalls = Infinity; },
    c => { c.diagnostics.triangles = Infinity; },
    c => { c.diagnostics.counts.buildings = 0; },
    c => { c.diagnostics.counts.buildings = NaN; },
    c => { c.diagnostics.counts.buildings--; },
    c => { c.diagnostics.counts.trees++; },
    c => { c.diagnostics.renderReady = false; },
    c => { c.diagnostics.supportViolations = 1; },
  ].entries()) {
    const bad = structuredClone(goodCapture); mutate(bad);
    await workflow.recordCapture({root, id: 'main', capture: bad});
    const recorded = await read(path.join(runDir('main'), 'capture.json'));
    const badReview = await reviewOf('main', 'bad-runtime-review');
    try {
      assert.equal(recorded.ok, false, 'Invalid runtime evidence must be recorded as failed.');
      assert.ok(recorded.errors.length > 0);
      await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: badReview}), /diagnostic|finite|render|draw|count|ready|building|tree|runtime|capture/i);
    } catch (error) { runtimeFailures.push({caseIndex, message: error.message}); }
  }
  const reviseFailedRuntime = await reviewOf('main', 'runtime-revision', 'revise');
  assert.equal((await workflow.reviewRun({root, id: 'main', reportPath: reviseFailedRuntime})).status, 'needs_revision', 'Failed captures remain available to explain a requested revision.');
  const partialCapture = structuredClone(goodCapture), firstBuilding = JSON.parse(initialPlanBytes).buildings[0];
  partialCapture.diagnostics.counts.buildings--; partialCapture.diagnostics.buildings--;
  partialCapture.diagnostics.groundedBuildings--; partialCapture.diagnostics.supportSkirts--;
  partialCapture.diagnostics.renderedObjects--; partialCapture.diagnostics.state = 'partial';
  partialCapture.diagnostics.skipped = [{kind: 'building', id: firstBuilding.id, sourceId: firstBuilding.sourceId, reason: 'Synthetic protocol fixture: one source building could not be supported.'}];
  await workflow.recordCapture({root, id: 'main', capture: partialCapture});
  assert.equal((await read(path.join(runDir('main'), 'capture.json'))).ok, true, 'A declared bounded skip can retain an honest partial rendering result.');
  const partialReview = await reviewOf('main', 'partial-review');
  assert.equal((await workflow.reviewRun({root, id: 'main', reportPath: partialReview})).status, 'ready_for_delivery');
  await workflow.recordCapture({root, id: 'main', capture: goodCapture});
  const originalReview = await reviewOf('main');
  const unresolvedReview = await read(path.join(root, originalReview));
  unresolvedReview.findings = [{code: 'test-unresolved', severity: 'error', message: 'Synthetic unresolved visual issue.'}];
  await write(path.join(root, 'data/unresolved-review.json'), unresolvedReview);
  await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: 'data/unresolved-review.json'}), /unresolved|error|passing/i);
  assert.equal((await workflow.reviewRun({root, id: 'main', reportPath: originalReview})).status, 'ready_for_delivery');

  assert.equal(typeof workflow.markCaptureAttempt, 'function');
  const startingCapture = await workflow.markCaptureAttempt({root, id: 'main', planSha256: goodCapture.planSha256});
  assert.equal(startingCapture.stages.visual, 'capturing');
  await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: originalReview}), /attempt|capture|succeeded|current/i);
  const failedCapture = await workflow.markCaptureAttempt({root, id: 'main', planSha256: goodCapture.planSha256, error: 'Synthetic protocol fixture: browser capture failed.'});
  assert.equal(failedCapture.stages.visual, 'failed');
  await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: originalReview}), /attempt|capture|succeeded|current/i);
  const failedAttemptRevision = await reviewOf('main', 'failed-attempt-revision', 'revise');
  await workflow.reviewRun({root, id: 'main', reportPath: failedAttemptRevision});
  await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: originalReview}), /attempt|capture|succeeded|current/i,
    'A revise verdict cannot make an old screenshot valid after the newest capture attempt failed.');
  await workflow.recordCapture({root, id: 'main', capture: await captureOf('main', 'recovered-attempt')});
  const recoveredReview = await reviewOf('main', 'recovered-attempt-review');
  assert.equal((await workflow.reviewRun({root, id: 'main', reportPath: recoveredReview})).status, 'ready_for_delivery');

  const beforeRejectedRevision = await stateOf('main');
  await write(path.join(root, 'data/invalid-focus.json'), {focus: [0, 0]});
  await assert.rejects(() => workflow.reviseRun({root, id: 'main', patchPath: 'data/invalid-focus.json'}), /focus|inside.*city|relocat/i);
  await write(path.join(root, 'data/invalid-focus-distance.json'), {focusDistanceMeters: 99});
  await assert.rejects(() => workflow.reviseRun({root, id: 'main', patchPath: 'data/invalid-focus-distance.json'}), /focus|distance|100/i);
  assert.deepEqual(await stateOf('main'), beforeRejectedRevision, 'Rejected camera revisions cannot modify the saved brief, plan state, or approval.');
  await write(path.join(root, 'data/display-patch.json'), {maxHeightMeters: 12, treeSpacingMeters: 40});
  const revised = await workflow.reviseRun({root, id: 'main', patchPath: 'data/display-patch.json'});
  assert.equal(revised.stages.build, 'pending'); assert.equal(revised.stages.check, 'pending'); assert.equal(revised.stages.visual, 'pending');
  assert.notEqual(revised.status, 'ready_for_delivery');
  await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: originalReview}), /pending|build|current|stale|capture|check|stage|review|workflow/i);
  await assert.rejects(() => workflow.recordCapture({root, id: 'main', capture: goodCapture}), /pending|build|current|stale|capture|check|stage|workflow/i);
  const rebuilt = await workflow.runWorkflow({root, id: 'main'});
  assert.equal(rebuilt.attempt, built.attempt + 1);
  assert.notEqual(hash(await fs.readFile(path.join(runDir('main'), 'plan.json'))), hash(initialPlanBytes));
  assert.deepEqual((await read(path.join(runDir('main'), 'collected.json'))).features, collected.features, 'A display revision reuses frozen geographic inputs.');
  await assert.rejects(() => workflow.recordCapture({root, id: 'main', capture: goodCapture}), /stale|another|current/i);
  await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: originalReview}), /stale|another|current/i);

  // Replayed approvals also fail when current executable or asset bytes drift.
  await workflow.recordCapture({root, id: 'main', capture: await captureOf('main', 'after-revision')});
  const currentReview = await reviewOf('main', 'current-review');
  await workflow.reviewRun({root, id: 'main', reportPath: currentReview});
  for (const relative of ['src/city-build-plan.js', 'assets/city-kit/v1/residential-slab.json']) {
    const file = path.join(root, relative), bytes = await fs.readFile(file);
    try {
      await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n ')]));
      await assertRebuildRequired('main');
      await assert.rejects(() => workflow.reviewRun({root, id: 'main', reportPath: currentReview}), /rebuild|fingerprint|code|asset|changed|stale|current/i);
      await assert.rejects(async () => workflow.recordCapture({root, id: 'main', capture: await captureOf('main', 'drift')}), /rebuild|fingerprint|code|asset|changed|stale|current/i);
    } finally { await fs.writeFile(file, bytes); }
  }

  await createBuiltRun('tampered');
  const tamperedFile = path.join(runDir('tampered'), 'plan.json'); await fs.appendFile(tamperedFile, '\n');
  await assert.rejects(() => workflow.statusRun({root, id: 'tampered'}), /integrity|changed|hash/i);
  await assert.rejects(() => workflow.runWorkflow({root, id: 'tampered'}), /integrity|changed|hash/i);

  // Inject a machine-failure checkpoint with valid artifact hashes. This is a
  // protocol fixture for a result the normal conservative builder rarely emits.
  await createBuiltRun('machine-failed');
  await workflow.recordCapture({root, id: 'machine-failed', capture: await captureOf('machine-failed')});
  const failedState = await stateOf('machine-failed'), failedChecks = await read(path.join(runDir('machine-failed'), 'checks.json'));
  failedChecks.ok = false; failedChecks.status = 'failed'; failedChecks.stats.errors = 1;
  failedChecks.issues.push({code: 'synthetic-machine-failure', severity: 'error', message: 'Protocol fixture: unresolved geometry check.'});
  await write(path.join(runDir('machine-failed'), 'checks.json'), failedChecks);
  failedState.artifacts['checks.json'] = hash(await fs.readFile(path.join(runDir('machine-failed'), 'checks.json')));
  failedState.blobs['checks.json'] = `artifacts/${failedState.artifacts['checks.json']}.json`;
  await fs.copyFile(path.join(runDir('machine-failed'), 'checks.json'), path.join(runDir('machine-failed'), failedState.blobs['checks.json']));
  failedState.checkSummary = failedChecks; failedState.status = 'needs_revision';
  await write(path.join(runDir('machine-failed'), 'state.json'), failedState);
  await workflow.recordCapture({root, id: 'machine-failed', capture: await captureOf('machine-failed', 'failed-machine')});
  const latestFailedReview = await reviewOf('machine-failed', 'latest-failed-review');
  await assert.rejects(() => workflow.reviewRun({root, id: 'machine-failed', reportPath: latestFailedReview}), /check|geometry|failed|revision/i);

  const controller = new AbortController(); controller.abort(new DOMException('Synthetic test cancellation', 'AbortError'));
  await workflow.initRun({root, id: 'cancelled', briefPath: 'data/test-brief.json'});
  await assert.rejects(() => workflow.runWorkflow({root, id: 'cancelled', signal: controller.signal}), {name: 'AbortError'});
  assert.equal((await stateOf('cancelled')).status, 'cancelled');
  await assert.rejects(() => fs.access(path.join(runDir('cancelled'), 'run.lock')), {code: 'ENOENT'});
  assert.equal((await workflow.runWorkflow({root, id: 'cancelled'})).status, 'awaiting_visual_review', 'A cancelled run can resume after the caller supplies a live signal.');

  await createBuiltRun('parser-drift');
  const parserFile = path.join(root, 'scripts/city-sources.mjs'), parserBytes = await fs.readFile(parserFile);
  try {
    await fs.appendFile(parserFile, '\n');
    await assertRebuildRequired('parser-drift');
    await assert.rejects(() => workflow.runWorkflow({root, id: 'parser-drift'}), /parser|re-parse|new run|normalized|validation/i);
  } finally { await fs.writeFile(parserFile, parserBytes); }

  assert.equal(typeof workflow.checkAndRepairPlan, 'function', 'Workflow must expose its bounded check/repair loop for direct verification.');
  const many = {type: 'FeatureCollection', features: Array.from({length: 201}, (_, i) => polygon(`repair-${i}`, [ring(20 + i % 20 * 35, 20 + Math.floor(i / 20) * 35, 20, 20)], {building: 'yes', height: 10}))};
  const invalidPlan = buildCityPlan({boundary, features: many, display: {maxTrees: 0}});
  assert.equal(invalidPlan.buildings.length, 201); invalidPlan.buildings.forEach(item => { item.heightMeters = 9999; });
  const sourceLayers = {boundary: invalidPlan.boundary, roads: invalidPlan.roads, water: invalidPlan.water, green: invalidPlan.green};
  for (const maxRepairs of [0, 1, 2]) {
    const repaired = await workflow.checkAndRepairPlan(invalidPlan, {maxRepairs});
    assert.ok(repaired.history.length <= maxRepairs);
    assert.ok(repaired.history.every(pass => pass.changes.length <= 100));
    assert.equal(repaired.result.ok, false, '201 invalid instances require more than two passes of at most 100 changes.');
    assert.deepEqual({boundary: repaired.plan.boundary, roads: repaired.plan.roads, water: repaired.plan.water, green: repaired.plan.green}, sourceLayers);
    assert.equal(invalidPlan.buildings[0].heightMeters, 9999, 'The repair loop must not mutate the supplied plan.');
  }
  const repaired = await workflow.checkAndRepairPlan(invalidPlan, {maxRepairs: 3});
  assert.equal(repaired.result.ok, true); assert.equal(inspectCityPlan(repaired.plan).ok, true); assert.equal(repaired.history.length, 3);
  const brokenSource = structuredClone(invalidPlan); brokenSource.boundary.geometry.coordinates[0].pop();
  const stuck = await workflow.checkAndRepairPlan(brokenSource, {maxRepairs: 3});
  assert.equal(stuck.result.ok, false); assert.ok(stuck.history.length <= 1, 'No-change repairs must stop immediately.');
  assert.deepEqual(stuck.plan.boundary, brokenSource.boundary);
  await assert.rejects(async () => workflow.checkAndRepairPlan(invalidPlan, {maxRepairs: 4}), /maxRepairs|0.3|repair|budget/i);
  await assert.rejects(async () => workflow.checkAndRepairPlan(invalidPlan, {signal: controller.signal}), {name: 'AbortError'});

  assert.deepEqual(runtimeFailures, [], 'Every invalid runtime diagnostic must fail capture and block a passing review.');
  console.log('City workflow protocol checks passed: frozen source snapshots, artifact hashes, resume without rebuild, stale capture/review rejection, executable/asset drift, validated runtime counters, machine-check gating, bounded repairs, and cancellation. Synthetic PNGs test the protocol only; actual browser and visual acceptance remain separate.');
} finally { await fs.rm(root, {recursive: true, force: true}); }
