// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// AI × 온톨로지 시연 페이지 (ai.html)
//  - GraphRAG: 질문 → 온톨로지에서 꺼낸 스키마 → Cypher → 실행(실제) → 결과로 만든 답 → 근거 그래프
//  - 에이전트: 생각 → 도구 호출(Cypher, 실제 실행) → 관찰 → … → 보고서
// ⚠ AI가 쓰는 부분(Cypher · 생각 · 도구 선택)은 미리 작성한 시연용 예시. 실행 · 결과 · 답의 숫자는 매번 그래프에서 계산
import init, { parse } from '../vendor/oxigraph/web.js';
import { buildGraph, localName, relType } from '../cypher/graph.js';
import { runCypher, show } from '../cypher/cypher.js';
import { GRAPHRAG, AGENT, TOOLS, GRAPHRAG_FILES, AGENT_FILES, toEn } from './ai-scenarios.js?v=20261110a';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = (o) => window.t(o);
const en = () => document.documentElement.lang === 'en';
const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const PAL = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'] };
const pal = (i) => (i < 0 ? (dark() ? '#8b93a1' : '#8a8f99') : PAL[dark() ? 'dark' : 'light'][i]);

let G1 = null, G2 = null, DEFS = new Map();
let gq = 0, gStep = 1, aStep = 0, timer = null;

// ---- 그래프 불러오기 + 온톨로지 정의(클래스 · 속성의 이름과 설명) 모으기 --------------------------------------------
async function load(files) {
  const quads = [];
  for (const f of files) {
    const r = await fetch(new URL('../../' + f, import.meta.url));
    if (!r.ok) throw new Error(f + ': ' + r.status);
    quads.push(...parse(await r.text(), { format: 'text/turtle', base_iri: 'http://example.org/base' }));
  }
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', LABEL = 'http://www.w3.org/2000/01/rdf-schema#label', COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';
  const kinds = new Map();
  for (const q of quads) if (q.predicate.value === RDF_TYPE && /owl#(Class|ObjectProperty|DatatypeProperty)$/.test(q.object.value)) kinds.set(q.subject.value, localName(q.object.value));
  for (const q of quads) {
    const k = kinds.get(q.subject.value); if (!k) continue;
    const ln = localName(q.subject.value), key = k === 'Class' ? 'L:' + ln : 'R:' + relType(q.subject.value);
    const d = DEFS.get(key) || { kind: k, iri: q.subject.value };
    if (q.predicate.value === LABEL) d[q.object.language === 'en' ? 'en' : 'ko'] = q.object.value;
    if (q.predicate.value === COMMENT && (!q.object.language || q.object.language === 'ko')) d.comment = q.object.value;
    DEFS.set(key, d);
  }
  return buildGraph(quads);
}
async function build() {
  const t0 = performance.now();
  try {
    await init({ module_or_path: new URL('../vendor/oxigraph/web_bg.wasm', import.meta.url) });
    [G1, G2] = await Promise.all([load(GRAPHRAG_FILES), load(AGENT_FILES)]);
    $('aiStatus').textContent = T({ ko: `그래프 준비: VPP 시장 그래프 노드 ${G1.nodes.length.toLocaleString()}개, 설비 · 배전선로 그래프 노드 ${G2.nodes.length.toLocaleString()}개 (${Math.round(performance.now() - t0)} ms)`,
      en: `Graphs ready: VPP market ${G1.nodes.length.toLocaleString()} nodes, assets & feeder ${G2.nodes.length.toLocaleString()} nodes (${Math.round(performance.now() - t0)} ms)` });
    renderGR(); renderAgent();
  } catch (e) { $('aiStatus').textContent = '⚠ ' + (e.message || e); }
}

// ---- 공통: 결과 표 · 근거 그래프 ------------------------------------------------------------------------------------
function table(res, max = 12) {
  if (!res.rows.length) return `<p class="meta">${T({ ko: '결과 없음', en: 'No rows' })}</p>`;
  return `<div class="tbl"><table><tr>${res.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>` +
    res.rows.slice(0, max).map(r => `<tr>${r.map(v => `<td>${esc(show(v))}</td>`).join('')}</tr>`).join('') + '</table></div>' +
    (res.rows.length > max ? `<p class="meta">… ${res.rows.length - max} ${T({ ko: '행 더', en: 'more rows' })}</p>` : '');
}
function run(G, q) { const t0 = performance.now(); const res = runCypher(G, q); res.ms = (performance.now() - t0).toFixed(1); return res; }
const nodesOf = (res) => {   // 결과의 노드 · 노드 목록 · 경로를 모두 모음
  const s = new Map(), add = (v) => { if (!v) return; if (Array.isArray(v)) v.forEach(add); else if (v.kind === 'path') v.nodes.forEach(add); else if (v.kind === 'node') s.set(v.props.uri, v); };
  for (const r of res.rows) r.forEach(add);
  return s;
};

const KIND = [
  ['VirtualPowerPlant', 0, 'round-rectangle', { ko: 'VPP', en: 'VPP' }], ['CurtailmentInstruction', 1, 'diamond', { ko: '출력제한 지시', en: 'Curtailment' }],
  ['WindSystem', 2, 'triangle', { ko: '풍력', en: 'Wind' }], ['PVSystem', 3, 'ellipse', { ko: '태양광', en: 'Solar' }],
  ['DemandResponseResource', 4, 'hexagon', { ko: '수요반응', en: 'Demand response' }], ['BatterySystem', 5, 'rectangle', { ko: 'ESS', en: 'Battery' }],
  ['EVChargingSite', 6, 'pentagon', { ko: '전기차 충전', en: 'EV charging' }],
  ['Asset', 0, 'round-rectangle', { ko: '설비 (자산)', en: 'Asset' }], ['Diagnosis', 3, 'ellipse', { ko: '진단', en: 'Diagnosis' }],
  ['WorkOrder', 6, 'pentagon', { ko: '작업지시', en: 'Work order' }], ['FeederZone', 2, 'round-rectangle', { ko: '배전 구간', en: 'Feeder zone' }],
  ['EnergyConsumer', 4, 'ellipse', { ko: '부하 (고객)', en: 'Load (customers)' }], ['LoadBreakSwitch', 5, 'diamond', { ko: '개폐기', en: 'Switch' }],
  ['Feeder', -1, 'round-rectangle', { ko: '배전선로', en: 'Feeder' }], ['Line', -1, 'round-rectangle', { ko: '배전선로', en: 'Feeder' }],
  ['Substation', -1, 'barrel', { ko: '변전소', en: 'Substation' }], ['Bid', -1, 'tag', { ko: '입찰', en: 'Bid' }], ['Settlement', -1, 'tag', { ko: '정산', en: 'Settlement' }],
  ['MarketInterval', -1, 'tag', { ko: '시장 시간대', en: 'Market hour' }], ['Equipment', -1, 'ellipse', { ko: '설비 · 위치 (공급 경로)', en: 'Equipment / location (supply path)' }]
];
const kindOf = (n) => KIND.find(k => n.labelSet.has(k[0])) || ['Equipment', -1, 'ellipse', { ko: '설비 · 위치 (공급 경로)', en: 'Equipment / location (supply path)' }];
function nodeName(n) {
  const p = n.props, L = en() && p.label_en ? p.label_en : p.label;
  if (n.labelSet.has('Substation')) return String(p.name || '').replace(' (가상)', '');
  if (n.labelSet.has('EnergyConsumer')) return p.area ? `${p.area}${p.critical ? ' ★' : ''}` : (p.name || '');
  return String(L ?? p.name ?? p.code ?? p.date ?? localName(p.uri)).slice(0, 34);
}
function drawGraph(el, legendEl, nodeMap, G, cur = null) {
  if (!window.cytoscape) return null;
  const els = [], ids = new Set(nodeMap.keys());
  for (const [uri, n] of nodeMap) {
    const k = kindOf(n);
    els.push({ data: { id: uri, label: nodeName(n), color: pal(k[1]), shape: k[2], k: k[0] }, classes: cur && cur.has(uri) ? 'cur' : (cur ? 'old' : '') });
  }
  const seen = new Set();
  for (const r of G.rels) {
    if (!ids.has(r.start.props.uri) || !ids.has(r.end.props.uri)) continue;
    const id = r.start.props.uri + '>' + r.type + '>' + r.end.props.uri; if (seen.has(id)) continue; seen.add(id);
    els.push({ data: { id, source: r.start.props.uri, target: r.end.props.uri, label: r.type } });
  }
  const text = css('--text'), muted = css('--muted'), bg = css('--surface'), line = dark() ? '#5a606b' : '#b9b6af';
  const cy = cytoscape({
    container: el, elements: els, wheelSensitivity: 0.3, minZoom: 0.3, maxZoom: 2.5,
    style: [
      { selector: 'node', style: { 'background-color': 'data(color)', shape: 'data(shape)', width: 18, height: 18, label: 'data(label)', color: text, 'font-size': 10,
          'text-valign': 'bottom', 'text-margin-y': 3, 'text-outline-color': bg, 'text-outline-width': 2.5, 'border-width': 2, 'border-color': bg, 'text-wrap': 'ellipsis', 'text-max-width': 120 } },
      { selector: 'edge', style: { width: 1.2, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, 'curve-style': 'bezier',
          label: 'data(label)', 'font-size': 7.5, color: muted, 'text-rotation': 'autorotate', 'text-background-color': bg, 'text-background-opacity': 1, 'text-background-padding': 1, 'text-opacity': cur ? 0 : 1 } },
      { selector: 'edge.lbl', style: { 'text-opacity': 1, width: 1.8 } },
      { selector: 'node.cur', style: { 'border-color': '#f59e0b', 'border-width': 4, width: 22, height: 22 } },
      { selector: 'node.old', style: { opacity: 0.55 } }
    ],
    // 설비 그래프는 나무 모양(위험 설비가 뿌리), VPP 그래프는 힘 배치
    layout: cur ? { name: 'breadthfirst', directed: false, roots: els.filter(e => e.data.k === 'Asset').map(e => '#' + CSS.escape(e.data.id)).join(',') || undefined, spacingFactor: 0.85, padding: 16, animate: false }
                : { name: 'cose', animate: false, randomize: false, nodeRepulsion: 12000, idealEdgeLength: 80, padding: 20 }
  });
  if (cur) cy.nodes('.cur').connectedEdges().addClass('lbl');
  const used = new Map(); for (const n of nodeMap.values()) { const k = kindOf(n); used.set(k[0], k); }
  legendEl.innerHTML = [...used.values()].map(k => `<span><i style="background:${pal(k[1])}"></i>${esc(T(k[3]))}</span>`).join('') +
    (cur ? `<span><i class="ring"></i>${esc(T({ ko: '이번 단계에서 찾은 노드', en: 'Found in this step' }))}</span>` : '');
  return cy;
}

// 질의에 나온 라벨 · 관계 → 온톨로지 정의 (LLM에게 주는 "지도"에 해당)
function schemaSlice(q) {
  const labels = [...new Set([...q.matchAll(/\(\s*\w*\s*:(\w+)/g)].map(m => m[1]))];
  const rels = [...new Set([...q.matchAll(/\[\s*\w*\s*:(\w+)/g)].map(m => m[1]))];
  const row = (kind, name, d) => `<tr><td><code>${kind === 'L' ? ':' + esc(name) : '[:' + esc(name) + ']'}</code></td><td>${d ? esc(T({ ko: d.ko || d.en || '', en: d.en || d.ko || '' })) : `<span class="meta">${esc(T({ ko: 'IEC CIM 표준의 이름', en: 'An IEC CIM standard name' }))}</span>`}</td><td class="meta">${d?.comment ? esc(d.comment) : (d ? '' : 'cim:')}</td></tr>`;
  return `<div class="tbl"><table><tr><th>${T({ ko: '그래프 이름', en: 'Graph name' })}</th><th>${T({ ko: '온톨로지의 뜻', en: 'Meaning in the ontology' })}</th><th>${T({ ko: '설명', en: 'Notes' })}</th></tr>` +
    labels.map(l => row('L', l, DEFS.get('L:' + l))).join('') + rels.map(r => row('R', r, DEFS.get('R:' + r))).join('') + '</table></div>';
}

// ---- GraphRAG -------------------------------------------------------------------------------------------------------
const GR_STEPS = [
  { ko: '질문', en: 'Question' }, { ko: '온톨로지에서 꺼낸 스키마', en: 'Schema from the ontology' }, { ko: 'AI가 쓴 Cypher', en: 'Cypher written by the AI' },
  { ko: '그래프 DB에서 실행', en: 'Run on the graph DB' }, { ko: '결과로만 답하기', en: 'Answer from the results only' }, { ko: '근거 그래프', en: 'Evidence graph' }
];
function renderGR() {
  $('grQs').innerHTML = GRAPHRAG.map((s, i) => `<button type="button" data-i="${i}" aria-pressed="${i === gq}">${esc(T(s.q))}</button>`).join('');
  if (!G1) return;
  const s = GRAPHRAG[gq], q = en() ? toEn(s.cypher) : s.cypher;
  const res = run(G1, q), extra = run(G1, s.extra), focus = run(G1, s.focus);
  const body = [
    `<p class="ai-q">“${esc(T(s.q))}”</p>`,
    `<p>${T({ ko: '질의에 쓰일 라벨 · 관계와 그 뜻을 온톨로지(스키마 파일)에서 꺼냅니다. 실제 시스템에서는 이 표를 질문과 함께 LLM에게 줍니다. AI가 데이터에 없는 관계를 지어내지 않게 하는 <b>지도</b>입니다.', en: 'The labels and relationships the query will use, with their meaning, are pulled from the ontology (schema files). A real system hands this table to the LLM with the question — a <b>map</b> that keeps it from inventing relations that do not exist.' })}</p>${schemaSlice(s.cypher)}`,
    `<p class="meta">${T({ ko: '⚠ 시연용: 이 Cypher는 미리 작성한 예시입니다. 실제 시스템에서는 LLM이 위 스키마를 보고 씁니다.', en: '⚠ Demo: this Cypher is pre-written. In a real system the LLM writes it from the schema above.' })}</p><pre><code>${esc(q)}</code></pre>`,
    `<p class="meta">${T({ ko: `방금 브라우저에서 실제로 실행: ${res.rows.length}행 · ${res.ms} ms`, en: `Just ran for real in your browser: ${res.rows.length} rows · ${res.ms} ms` })}</p>${table(res)}`,
    `<div class="ai-vs"><div class="good"><h4>✅ ${T({ ko: '그래프 결과로 만든 답', en: 'Answer built from the graph result' })}</h4><p>${esc(s.answer(res.rows, extra.rows, en()))}</p><p class="meta">${T({ ko: '이름 · 숫자는 모두 위 실행 결과에서 왔습니다.', en: 'Every name and number comes from the result above.' })}</p></div>
      <div class="bad"><h4>⚠ ${T({ ko: '그래프 없이 LLM만 쓰면 (예시)', en: 'LLM alone, without the graph (example)' })}</h4><p>${esc(T(s.naive))}</p><p class="meta">${T({ ko: '그럴듯하지만 이 데이터의 사실은 하나도 담지 못합니다.', en: 'Plausible, yet holds none of the facts in this data.' })}</p></div></div>`,
    `<p>${T({ ko: `답의 근거가 된 노드 ${nodesOf(focus).size}개와 그 사이 관계입니다. 사람이 답을 검증할 수 있게 경로를 보여 주는 것이 GraphRAG의 장점입니다.`, en: `The ${nodesOf(focus).size} nodes behind the answer and the relations between them. Showing the path so a person can check the answer is GraphRAG's strength.` })}</p><div class="ai-legend" id="grLegend"></div><div class="ai-graph" id="grGraph"></div>`
  ];
  $('grSteps').innerHTML = GR_STEPS.map((t, i) => `<li class="${i < gStep ? 'on' : ''}${i === gStep - 1 ? ' now' : ''}"><div class="n">${i + 1}</div><div class="c"><h4>${esc(T(t))}</h4>${i < gStep ? body[i] : ''}</div></li>`).join('');
  if (gStep >= 6) drawGraph($('grGraph'), $('grLegend'), nodesOf(focus), G1);
  $('grNext').disabled = gStep >= GR_STEPS.length;
}

// ---- 에이전트 -------------------------------------------------------------------------------------------------------
function renderAgent() {
  $('agTask').textContent = T(AGENT.task);
  if (!G2) return;
  const R = [], seen = new Map(); let cur = null;
  const html = AGENT.steps.map((st, i) => {
    if (i >= aStep) return `<li><div class="n">${i + 1}</div><div class="c"><h4 class="meta">${esc(T(TOOLS[st.tool]))}</h4></div></li>`;
    const res = run(G2, st.cypher), f = nodesOf(run(G2, st.focus));
    R.push(res.rows);
    for (const [k, v] of f) seen.set(k, v);
    if (i === aStep - 1) cur = new Set(f.keys());
    return `<li class="on${i === aStep - 1 ? ' now' : ''}"><div class="n">${i + 1}</div><div class="c">
      <p class="think">💭 ${esc(T(st.thought))}</p>
      <p class="call">🛠 <code>${esc(st.tool)}(${esc(st.args)})</code> <span class="meta">${esc(T(TOOLS[st.tool]))}</span></p>
      <details><summary>${T({ ko: `도구가 실행한 Cypher · ${res.rows.length}행 · ${res.ms} ms`, en: `Cypher run by the tool · ${res.rows.length} rows · ${res.ms} ms` })}</summary><pre><code>${esc(st.cypher)}</code></pre>${table(res, 8)}</details>
      <p class="obs">👀 ${esc(st.observe(res.rows, en()))}</p></div></li>`;
  }).join('');
  $('agSteps').innerHTML = html;
  $('agReport').innerHTML = aStep >= AGENT.steps.length
    ? `<h4>📋 ${T({ ko: '에이전트 보고서', en: 'Agent report' })}</h4><ol>${AGENT.report(R, en()).map(l => `<li>${esc(l)}</li>`).join('')}</ol><p class="meta">${T({ ko: '문장 틀은 시연용으로 미리 쓴 것이고, 이름 · 숫자는 모두 위 여섯 번의 실행 결과에서 왔습니다.', en: 'The sentence frames are pre-written for the demo; every name and number comes from the six runs above.' })}</p>`
    : '';
  $('agReport').hidden = aStep < AGENT.steps.length;
  $('agGraphWrap').hidden = aStep === 0;
  if (aStep > 0) drawGraph($('agGraph'), $('agLegend'), seen, G2, cur);
  $('agNext').disabled = aStep >= AGENT.steps.length;
}

// ---- 조작 ------------------------------------------------------------------------------------------------------------
const stop = () => { clearInterval(timer); timer = null; $('grPlay').textContent = T({ ko: '▶ 자동 재생', en: '▶ Auto play' }); $('agPlay').textContent = T({ ko: '▶ 자동 재생', en: '▶ Auto play' }); };
$('grQs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; stop(); gq = +b.dataset.i; gStep = 1; renderGR(); });
$('grNext').addEventListener('click', () => { if (gStep < GR_STEPS.length) { gStep++; renderGR(); } });
$('grAll').addEventListener('click', () => { stop(); gStep = GR_STEPS.length; renderGR(); });
$('grReset').addEventListener('click', () => { stop(); gStep = 1; renderGR(); });
$('grPlay').addEventListener('click', () => {
  if (timer) return stop();
  if (gStep >= GR_STEPS.length) gStep = 1;
  $('grPlay').textContent = T({ ko: '⏸ 멈춤', en: '⏸ Pause' });
  renderGR();
  timer = setInterval(() => { if (gStep >= GR_STEPS.length) return stop(); gStep++; renderGR(); }, 1800);
});
$('agNext').addEventListener('click', () => { if (aStep < AGENT.steps.length) { aStep++; renderAgent(); } });
$('agAll').addEventListener('click', () => { stop(); aStep = AGENT.steps.length; renderAgent(); });
$('agReset').addEventListener('click', () => { stop(); aStep = 0; renderAgent(); });
$('agPlay').addEventListener('click', () => {
  if (timer) return stop();
  if (aStep >= AGENT.steps.length) aStep = 0;
  $('agPlay').textContent = T({ ko: '⏸ 멈춤', en: '⏸ Pause' });
  timer = setInterval(() => { if (aStep >= AGENT.steps.length) return stop(); aStep++; renderAgent(); }, 2200);
});
document.addEventListener('langchange', () => { stop(); renderGR(); renderAgent(); });
new MutationObserver(() => { if (G1) { renderGR(); renderAgent(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
renderGR(); renderAgent();
build();
