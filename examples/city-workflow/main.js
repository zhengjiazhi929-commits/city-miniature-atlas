import {createCityPlanViewer} from '../../src/city-plan-viewer.js';

const appRoot = new URL('../../', import.meta.url), $ = id => document.getElementById(id);
let controller = null, viewer = null, plan = null, labels = true, generation = 0;
const diagnostic = {state: 'idle', error: null};
window.__cityWorkflow = {get viewer() { return viewer; }, get plan() { return plan; }, get ready() { return !!viewer?.diagnostics.ready; }, get error() { return diagnostic.error; }, diagnostics: diagnostic};

// Only local generated runs or packaged samples may be loaded. Never accept
// arbitrary URLs, traversal segments, HTML endpoints, or cross-origin data.
function resolvePlanUrl() {
  const parameters = new URL(location.href).searchParams, selected = parameters.get('plan');
  if (selected !== null) {
    const path = selected.replace(/^\.\//, '').replace(/^\//, '');
    if (!/^data\/city-workflow-samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(path)) throw new Error('plan 仅允许 data/city-workflow-samples/ 下的 JSON 方案');
    return new URL(path, appRoot);
  }
  const run = parameters.get('run') || 'wuhan-demo';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(run)) throw new Error('run 只能使用小写字母、数字和连接号');
  return new URL(`work/city-runs/${run}/plan.json`, appRoot);
}
async function readJson(url, signal) {
  const response = await fetch(url, {signal, cache: 'no-cache'});
  if (!response.ok) throw new Error(`方案读取失败（HTTP ${response.status}）。先生成此 run 的 plan.json，再打开预览。`);
  const limit = 48 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) throw new Error('方案超过 48 MiB 限制');
  const reader = response.body.getReader(), parts = []; let size = 0;
  try { while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('方案超过 48 MiB 限制'); } parts.push(value); } } finally { reader.releaseLock(); }
  signal.throwIfAborted(); const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value?.schema !== 'city-build-plan-v1') throw new Error('不支持的方案格式，预期 city-build-plan-v1');
  for (const key of ['buildings', 'roads', 'water', 'green', 'trees', 'landmarks']) if (value[key] != null && !Array.isArray(value[key])) throw new Error(`${key} 必须是列表`);
  return value;
}
function addIssue(text) { const li = document.createElement('li'); li.textContent = text; $('issues').append(li); }
function coverageText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '当前数据的实际范围由提供的要素决定。没有要素的位置不补画建筑，也不代表当地没有建筑。';
  const label = value.description ?? value.label ?? value.name ?? value.note;
  const bounds = value.bbox ?? value.bounds;
  return [typeof label === 'string' ? label : null, Array.isArray(bounds) ? `WGS84 范围：${bounds.flat().map(v => typeof v === 'number' ? v.toFixed(4) : String(v)).join('，')}` : null].filter(Boolean).join('。') || '资料覆盖范围见方案 JSON 中的 provenance.coverage。';
}
function safeHttps(raw) {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function showProvenance() {
  const inputs = plan.provenance?.inputs ?? [], coverage = inputs.filter(input => input.coverage);
  const notice = plan.display?.coverageNotice ?? plan.display?.coverageLabel;
  const descriptions = coverage.map(input => coverageText(input.coverage));
  $('coverage-text').textContent = [notice, ...descriptions].filter(Boolean).join(' ') || coverageText(plan.provenance?.coverage ?? plan.sourceCoverage ?? plan.coverage);
  $('source-text').textContent = '地形来自在线 DEM；要素来自以下记录的来源。资料仅覆盖局部，未覆盖位置保持未知。';
  $('source-links').replaceChildren();
  for (const input of inputs) {
    const source = input.source ?? {}, row = document.createElement('p'), label = input.id === 'boundary' ? '行政边界' : '局部地理要素';
    const attribution = typeof source.attribution === 'string' ? source.attribution : '来源署名见方案 JSON';
    const sourceUrl = safeHttps(source.url), sourceNode = document.createElement(sourceUrl ? 'a' : 'span');
    sourceNode.textContent = `${label} · ${attribution}${sourceUrl ? ' ↗' : ''}`;
    if (sourceUrl) { sourceNode.href = sourceUrl; sourceNode.target = '_blank'; sourceNode.rel = 'noopener noreferrer'; }
    row.append(sourceNode);
    if (typeof source.license === 'string') {
      const licenseUrl = safeHttps(source.licenseUrl) ?? (source.license === 'ODbL-1.0' ? 'https://opendatacommons.org/licenses/odbl/1-0/' : null);
      const license = document.createElement(licenseUrl ? 'a' : 'span'); license.textContent = source.license;
      if (licenseUrl) { license.href = licenseUrl; license.target = '_blank'; license.rel = 'noopener noreferrer'; }
      row.append(document.createTextNode(' · '), license);
    }
    $('source-links').append(row);
  }
}
function updateReport() {
  const d = viewer?.diagnostics; if (!d) return;
  $('building-count').textContent = d.counts.buildings.toLocaleString('zh-CN'); $('road-count').textContent = d.counts.roads.toLocaleString('zh-CN'); $('tree-count').textContent = d.counts.trees.toLocaleString('zh-CN');
  $('support-report').textContent = `已计算 ${d.supportComputed} 栋建筑的地形支撑，实际绘制 ${d.groundedBuildings} 栋；最大支撑高差 ${d.maxSupportMeters.toFixed(2)} m。坡差超限的对象已跳过。${d.skipped.length ? `跳过 ${d.skipped.length} 个对象。` : ''}`;
  $('layer-report').textContent = `${d.counts.water} 片水域 · ${d.counts.green} 片绿地 · ${d.counts.bridges} 段桥梁 · ${d.counts.bridgePiers} 个桥墩。真实 DEM ${d.regionalTerrain?.loadedTiles ?? 0} 个瓦片；高程保持 1:1。水面采用显示地形岸线高程，岸线高差超过 2 m 的水域暂不绘制。`;
  $('issues').replaceChildren();
  for (const warning of d.warnings) addIssue(warning);
  for (const issue of (plan.issues || []).slice(0, 12)) addIssue(typeof issue === 'string' ? issue : issue.message ?? issue.reason ?? JSON.stringify(issue));
  for (const item of d.skipped.slice(0, 8)) addIssue(`${item.id ?? item.kind}：${item.reason}`);
  if (d.skipped.length > 8) addIssue(`其余 ${d.skipped.length - 8} 项见控制台 window.__cityWorkflow.viewer.diagnostics.skipped。`);
}
function selectPlace(place) {
  viewer?.focusAttraction(place.id); $('view-label').textContent = `${place.name ?? place.id} · 位置`;
  for (const button of $('places').children) button.classList.toggle('selected', button.dataset.id === place.id);
  const card = $('place-detail'); card.hidden = false; card.querySelector('h3').textContent = place.name ?? place.id;
  card.querySelector('p').textContent = `独立景点模型尚未制作，此处只标记位置。${place.description ?? ''}`;
  const link = card.querySelector('a'), raw = place.sourceUrl ?? place.source?.url, url = safeHttps(raw);
  link.hidden = !url; if (url) link.href = url; else link.removeAttribute('href');
}
function release() { generation++; controller?.abort(); viewer?.destroy(); viewer = null; }
async function start() {
  release(); const current = generation; controller = new AbortController(); const active = controller.signal;
  plan = null; diagnostic.state = 'loading'; diagnostic.error = null;
  $('status').hidden = false; $('status').classList.remove('error'); $('status').textContent = '读取城市生成方案…'; $('retry').hidden = true;
  for (const id of ['full-view', 'focus-view', 'labels']) $(id).disabled = true;
  $('places').replaceChildren(); $('issues').replaceChildren(); $('place-detail').hidden = true;
  try {
    const url = resolvePlanUrl(), value = await readJson(url, active); active.throwIfAborted(); if (current !== generation) return; plan = value;
    const name = plan.display?.title ?? plan.city?.name ?? plan.name ?? plan.cityName ?? plan.boundary?.properties?.name ?? '城市方案';
    $('city-name').textContent = name; document.title = `${name} · 城市生成方案`;
    $('plan-path').textContent = `方案：${url.pathname}`; $('plan-download').href = url.href;
    showProvenance();
    const result = await createCityPlanViewer({container: $('viewer'), plan, signal: active, onStatus: info => {
      if (active.aborted || current !== generation) return;
      diagnostic.state = info.state; $('status').textContent = info.message; $('status').hidden = ['ready', 'partial'].includes(info.state); $('status').classList.toggle('error', info.state === 'failed');
    }});
    if (active.aborted || current !== generation) { result.destroy(); return; }
    viewer = result; viewer.setLabels(labels); $('labels').setAttribute('aria-pressed', String(labels)); updateReport();
    for (const place of plan.landmarks || []) { const button = document.createElement('button'); button.type = 'button'; button.textContent = place.name ?? place.id; button.dataset.id = place.id; button.addEventListener('click', () => selectPlace(place)); $('places').append(button); }
    if (!plan.landmarks?.length) { const p = document.createElement('p'); p.textContent = '当前方案未提供地点定位。'; $('places').append(p); }
    for (const id of ['full-view', 'labels']) $(id).disabled = false;
    $('focus-view').disabled = !Array.isArray(plan.display?.focus);
    $('view-label').textContent = plan.display?.focus ? '资料覆盖区' : '完整市域';
  } catch (error) {
    if (active.aborted || current !== generation) return;
    viewer?.destroy(); viewer = null; diagnostic.state = 'failed'; diagnostic.error = error.message;
    $('status').hidden = false; $('status').classList.add('error'); $('status').textContent = `无法展开：${error.message}`; $('retry').hidden = false; console.error(error);
  }
}
$('full-view').addEventListener('click', () => { viewer?.resetView(); $('view-label').textContent = '完整市域 · 地貌范围'; });
$('focus-view').addEventListener('click', () => { viewer?.focusAttraction('focus'); $('view-label').textContent = '资料覆盖区'; });
$('labels').addEventListener('click', () => { labels = !labels; viewer?.setLabels(labels); $('labels').setAttribute('aria-pressed', String(labels)); });
$('retry').addEventListener('click', start);
window.addEventListener('pagehide', release);
window.addEventListener('pageshow', event => { if (event.persisted) start(); });
start();
