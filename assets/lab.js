// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 실습 페이지: RDF(Turtle) 데이터를 Neo4j식 속성 그래프로 불러와 브라우저 안에서 Cypher 실행 + Cytoscape로 지식 그래프 표시
// Turtle 파일은 cypher/turtle.js(N3.js)로 읽습니다. 질의는 assets/cypher/cypher.js (Cypher 부분집합 엔진)
import { parse } from './cypher/turtle.js';
import { buildGraph } from './cypher/graph.js';
import { runCypher, show } from './cypher/cypher.js';
import { DATASETS, QUERIES } from './cypher/presets.js';
import { parseChecks } from './cypher/script.js';

const SHORT = [['http://iec.ch/TC57/CIM100#', 'cim:'], ['http://example.org/grid#', 'ex:']];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let G, cy, current = 'full', ready = false, CHECKS = null;

function short(v) {
  for (const [ns, p] of SHORT) if (String(v).startsWith(ns)) return p + v.slice(ns.length);
  return v;
}

async function fetchText(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.text();
}

async function loadDataset(key) {
  current = key;
  $('status').textContent = t({ ko: '데이터 불러오는 중…', en: 'Loading data…' });
  const [data, tbox] = await Promise.all([fetchText(DATASETS[key].file), fetchText('shapes/cim-classes.ttl')]);
  const quads = [...parse(data, { format: 'text/turtle', base_iri: location.href }), ...parse(tbox, { format: 'text/turtle' })];
  G = buildGraph(quads);
  $('status').textContent = t({ ko: `불러옴: 노드 ${G.nodes.length}개 · 관계 ${G.rels.length}개`, en: `Loaded: ${G.nodes.length} nodes · ${G.rels.length} relationships` });
  runQuery();
  runChecks();
  drawGraph();
}

// ---- 데이터 검증: shapes/cim-checks.cypher의 규칙을 모두 실행 -----------------------------
async function runChecks() {
  const box = $('checks');
  try {
    CHECKS ??= parseChecks(await fetchText('shapes/cim-checks.cypher'));
    const res = CHECKS.map(c => ({ c, r: runCypher(G, c.query) }));
    const bad = res.filter(x => x.r.rows.length);
    $('checkSummary').innerHTML = bad.length
      ? t({ ko: `규칙 ${res.length}개 중 <b>${bad.length}개 위반</b> (모두 ${bad.reduce((s, x) => s + x.r.rows.length, 0)}건)`, en: `<b>${bad.length} of ${res.length} rules violated</b> (${bad.reduce((s, x) => s + x.r.rows.length, 0)} findings)` })
      : t({ ko: `규칙 ${res.length}개 모두 통과 ✓`, en: `All ${res.length} rules pass ✓` });
    box.innerHTML = res.map(({ c, r }, i) => `<details class="chk ${r.rows.length ? 'bad' : 'ok'}"${r.rows.length ? ' open' : ''}><summary>${r.rows.length ? '✗' : '✓'} <b>${esc(c.id)}</b> ${esc(t(c))}${r.rows.length ? ` — ${r.rows.length}${t({ ko: '건', en: '' })}` : ''}</summary>` +
      (r.rows.length ? `<div class="tbl"><table><tr>${r.columns.map(k => `<th>${esc(k)}</th>`).join('')}</tr>${r.rows.map(row => `<tr>${row.map(v => `<td>${esc(show(v, short))}</td>`).join('')}</tr>`).join('')}</table></div>` : '') +
      `<pre><code>${esc(c.query)}</code></pre><button class="lab-try" data-i="${i}">${t({ ko: '실습 칸에서 열기 ↑', en: 'Open in the playground ↑' })}</button></details>`).join('');
    box.querySelectorAll('.lab-try').forEach(b => b.addEventListener('click', () => { $('query').value = CHECKS[b.dataset.i].query; runQuery(); $('cypher').scrollIntoView({ behavior: 'smooth' }); }));
  } catch (e) { box.innerHTML = `<p class="err">⚠ ${esc(e.message || e)}</p>`; }
}

function runQuery() {
  const out = $('results');
  const t0 = performance.now();
  try {
    const res = runCypher(G, $('query').value);
    const ms = (performance.now() - t0).toFixed(1);
    if (!res.rows.length) { out.innerHTML = `<p>${t({ ko: '결과 없음', en: 'No results' })} (${ms} ms)</p>`; return; }
    const cell = (v) => {
      if (v && v.kind === 'node') return `<a href="#" class="iri" data-iri="${esc(v.props.uri)}">${esc(show(v, short))}</a>`;
      return esc(show(v, short));
    };
    out.innerHTML = `<p class="meta">${res.rows.length} ${t({ ko: '행', en: 'rows' })} · ${ms} ms</p><div class="tbl"><table><tr>${res.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>` +
      res.rows.slice(0, 500).map(r => `<tr>${r.map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('') + '</table></div>';
    out.querySelectorAll('.iri').forEach(a => a.addEventListener('click', e => { e.preventDefault(); focusNode(a.dataset.iri); }));
  } catch (e) {
    out.innerHTML = `<p class="err">⚠ ${esc(e.message || e)}</p>`;
  }
}

// ---- 지식 그래프 --------------------------------------------------------------
const GROUPS = [
  { key: 'container', classes: ['Substation', 'VoltageLevel', 'Bay', 'Line'], color: '#8b5cf6', ko: '컨테이너', en: 'Container' },
  { key: 'equipment', classes: ['ACLineSegment', 'PowerTransformer', 'Breaker', 'Disconnector', 'LoadBreakSwitch', 'Switch', 'BusbarSection',
      'EnergyConsumer', 'ConformLoad', 'NonConformLoad', 'ExternalNetworkInjection', 'SynchronousMachine'], color: '#b42318', ko: '설비', en: 'Equipment' },
  { key: 'node', classes: ['ConnectivityNode', 'TopologicalNode'], color: '#1f6feb', ko: '노드', en: 'Node' },
  { key: 'terminal', classes: ['Terminal', 'PowerTransformerEnd'], color: '#c2410c', ko: '단자 · 권선단', en: 'Terminal · End' },
  { key: 'naming', classes: ['Name', 'NameType', 'NameTypeAuthority'], color: '#15803d', ko: '매핑 (Name)', en: 'Mapping (Name)' },
  { key: 'sv', classes: ['SvVoltage', 'SvPowerFlow'], color: '#0891b2', ko: 'SV 결과', en: 'SV results' },
  { key: 'other', classes: ['BaseVoltage'], color: '#6b7280', ko: '기타', en: 'Other' }
];
const groupOf = cls => GROUPS.find(g => g.classes.includes(cls)) || GROUPS[GROUPS.length - 1];

function drawGraph() {
  if (!window.cytoscape) return;
  const show2 = new Set([...document.querySelectorAll('#layers input:checked')].map(i => i.value));
  const cls = (n) => n.labels[0];
  const visible = (n) => n.labels.length && show2.has(groupOf(cls(n)).key);
  const label = (n) => n.props.name ?? n.props.label ?? cls(n);
  const nodes = new Map(), edges = [];
  const addNode = (n) => { if (!nodes.has(n.props.uri)) nodes.set(n.props.uri, { data: { id: n.props.uri, label: String(label(n)), cls: cls(n), color: groupOf(cls(n)).color } }); };
  for (const r of G.rels) {
    if (!visible(r.start) || !visible(r.end)) continue;
    addNode(r.start); addNode(r.end);
    edges.push({ data: { id: 'r' + r.id, source: r.start.props.uri, target: r.end.props.uri, label: r.type } });
  }
  // Terminal을 숨기면 설비 —(Terminal)— 노드를 점선으로 바로 연결
  if (!show2.has('terminal')) for (const term of G.byLabel.get('Terminal') || []) {
    const eq = term.out.find(r => r.type === 'CONDUCTING_EQUIPMENT')?.end, cn = term.out.find(r => r.type === 'CONNECTIVITY_NODE')?.end;
    if (!eq || !cn || !visible(eq) || !visible(cn)) continue;
    addNode(eq); addNode(cn);
    edges.push({ data: { id: 't' + term.id, source: eq.props.uri, target: cn.props.uri, label: 'Terminal', dashed: 1 } });
  }
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--text').trim(), line = css.getPropertyValue('--muted').trim(), bg = css.getPropertyValue('--surface').trim();
  if (cy) cy.destroy();
  cy = cytoscape({
    container: $('graph'),
    elements: [...nodes.values(), ...edges],
    wheelSensitivity: 0.3,
    style: [
      { selector: 'node', style: { 'background-color': 'data(color)', label: 'data(label)', color: text, 'font-size': 9,
          'text-valign': 'bottom', 'text-margin-y': 3, width: 14, height: 14, 'text-outline-color': bg, 'text-outline-width': 2,
          'min-zoomed-font-size': nodes.size > 60 ? 9 : 0 } },   // 노드가 많으면 확대했을 때만 이름 표시
      { selector: 'edge', style: { width: 1, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle',
          'arrow-scale': 0.6, 'curve-style': 'bezier', opacity: 0.6, label: 'data(label)', 'font-size': 7, color: line,
          'text-rotation': 'autorotate', 'text-opacity': 0 } },
      { selector: 'edge[dashed]', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none' } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#f59e0b', width: 20, height: 20 } },
      { selector: '.hl', style: { opacity: 1, width: 2, 'text-opacity': 1 } }
    ],
    layout: { name: 'cose', animate: false, nodeRepulsion: 9000, idealEdgeLength: 50, randomize: true, padding: 20 }
  });
  cy.on('tap', 'node', e => showNode(e.target.id()));
  $('graphInfo').textContent = t({ ko: `노드 ${nodes.size}개 · 관계 ${edges.length}개. 노드를 누르면 속성과 관계를 볼 수 있습니다.`,
                                   en: `${nodes.size} nodes · ${edges.length} relationships. Click a node to see its properties and relationships.` });
}

function focusNode(iri) {
  if (!cy) return;
  const n = cy.getElementById(iri);
  document.getElementById('graph').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (n.nonempty()) { cy.elements().unselect(); n.select(); cy.animate({ center: { eles: n }, zoom: 1.6 }, { duration: 300 }); }
  showNode(iri);
}

function showNode(iri) {
  cy.edges().removeClass('hl');
  const c = cy.getElementById(iri);
  if (c.nonempty()) c.connectedEdges().addClass('hl');
  const n = G.byUri.get(iri); if (!n) return;
  const name = (m) => esc(m.props.name ?? m.props.label ?? short(m.props.uri));
  $('nodeInfo').innerHTML = `<p><code>(${esc(n.labels.map(l => ':' + l).join(''))})</code> <code>${esc(short(iri))}</code></p><div class="tbl"><table>` +
    Object.entries(n.props).filter(([k]) => k !== 'uri').map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(show(v))}</td></tr>`).join('') +
    n.out.map(r => `<tr><td>-[:${esc(r.type)}]→</td><td>${name(r.end)}</td></tr>`).join('') +
    n.in.map(r => `<tr><td>←[:${esc(r.type)}]-</td><td>${name(r.start)}</td></tr>`).join('') + '</table></div>';
}

// ---- 초기화 ---------------------------------------------------------------------
function fillControls() {
  const ds = $('dataset'), qs = $('presets');
  ds.innerHTML = Object.entries(DATASETS).map(([k, d]) => `<option value="${k}"${k === current ? ' selected' : ''}>${t(d)}</option>`).join('');
  qs.innerHTML = QUERIES.map((q, i) => `<button data-i="${i}">${t(q)}</button>`).join('');
  qs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { $('query').value = QUERIES[b.dataset.i].q; if (ready) runQuery(); }));
  $('legend').innerHTML = GROUPS.map(g => `<label><input type="checkbox" value="${g.key}"${['terminal', 'sv', 'naming'].includes(g.key) ? '' : ' checked'}> <i style="background:${g.color}"></i>${t(g)}</label>`).join('');
}

async function main() {
  fillControls();
  $('query').value = QUERIES[0].q;
  document.addEventListener('langchange', () => {
    const checked = new Set([...document.querySelectorAll('#layers input:checked')].map(i => i.value));
    fillControls();
    document.querySelectorAll('#layers input').forEach(i => i.checked = checked.has(i.value));
    if (ready) runChecks();
  });
  $('dataset').addEventListener('change', e => loadDataset(e.target.value));
  $('run').addEventListener('click', runQuery);
  $('query').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery(); });
  $('layers').addEventListener('change', () => ready && drawGraph());
  $('relayout').addEventListener('click', () => ready && drawGraph());
  try {
    ready = true;
    await loadDataset(current);
  } catch (e) {
    $('status').textContent = '⚠ ' + (e.message || e);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
