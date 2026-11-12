// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 온톨로지 페이지: 시뮬레이션 코드(safety.js) → 트리플 + 스키마 · 업무 · 자산관리 · 배전선로 · 고장 영향 Turtle
// → 한 속성 그래프 → 현장별 단계 표 · Cypher 질의. Turtle은 cypher/turtle.js(N3.js)로 읽음
import { parse } from '../cypher/turtle.js?v=dd7711a6';
import { buildGraph } from '../cypher/graph.js?v=3901bd2d';
import { runCypher, show } from '../cypher/cypher.js?v=429e52a6';
import { toQuads, SAFETY_CYPHER, SAFETY_SCHEMA, LINKED_FILES } from './safety-graph.js?v=ffc76238';
import { SCENARIOS } from './safety.js?v=a96c9949';
import { $, esc } from '../lib/dom.js?v=3b73d59c';

const T = (o) => window.t(o);
const en = () => document.documentElement.lang === 'en';
let G = null, preset = 0, scn = 'pole';

async function build() {
  const t0 = performance.now();
  try {
    const texts = await Promise.all([SAFETY_SCHEMA, ...LINKED_FILES].map(async f => {
      const r = await fetch(new URL('../../' + f, import.meta.url));
      if (!r.ok) throw new Error(f + ': ' + r.status);
      return r.text();
    }));
    const own = toQuads(), quads = [...own];
    for (const t of texts) quads.push(...parse(t, { format: 'text/turtle', base_iri: 'http://example.org/base' }));
    G = buildGraph(quads);
    $('soStatus').textContent = T({ ko: `그래프 준비: 안전 온톨로지 트리플 ${own.length.toLocaleString()}개 + 연결 온톨로지 5개 → 노드 ${G.nodes.length.toLocaleString()} · 관계 ${G.rels.length.toLocaleString()} (${Math.round(performance.now() - t0)} ms)`,
      en: `Graph ready: ${own.length.toLocaleString()} safety triples + 5 linked ontologies → ${G.nodes.length.toLocaleString()} nodes · ${G.rels.length.toLocaleString()} relationships (${Math.round(performance.now() - t0)} ms)` });
    render();
  } catch (e) {
    $('soStatus').textContent = '⚠ ' + (e.message || e);
  }
}

const one = (q) => runCypher(G, q).rows[0]?.[0] ?? 0;
function stats() {
  const items = [
    [one('MATCH (n:WorkScenario) RETURN count(n)'), { ko: '현장 (시나리오)', en: 'sites (scenarios)' }],
    [one('MATCH (n:WorkStep) RETURN count(n)'), { ko: '작업 단계', en: 'work steps' }],
    [one('MATCH (n:SafetyRule) RETURN count(n)'), { ko: '안전수칙', en: 'safety rules' }],
    [one('MATCH (n:Hazard) RETURN count(n)'), { ko: '위험요인', en: 'hazards' }],
    [one('MATCH (n:CrewRole) RETURN count(n)'), { ko: '작업 역할', en: 'crew roles' }],
    [one('MATCH (n:UnsafeChoice) RETURN count(n)'), { ko: '잘못된 선택', en: 'unsafe choices' }]
  ];
  $('soStats').innerHTML = items.map(([v, l]) => `<div><b>${v.toLocaleString()}</b><span>${esc(T(l))}</span></div>`).join('');
}

// 현장별 단계 표: 모두 그래프에서 Cypher로 읽음
function steps() {
  $('soScn').innerHTML = Object.entries(SCENARIOS).map(([k, S]) => `<button type="button" data-k="${k}" aria-pressed="${k === scn}">${esc(T(S.title))}</button>`).join('');
  const L = en() ? '_en' : '';
  const site = runCypher(G, `MATCH (sc:WorkScenario {scenarioId: '${scn}'})-[:TARGET_ASSET]->(a)-[:INSTALLED_AT]->(loc)
OPTIONAL MATCH (sc)-[:MAINTENANCE_TASK]->(t)
OPTIONAL MATCH (sc)-[:ISOLATED_BY]->(sw)
OPTIONAL MATCH (sc)-[:LIVE_NEARBY]->(live)
OPTIONAL MATCH (sc)-[:INTERRUPTS_LOAD]->(ld)
RETURN a.label${L} AS asset, a.code AS code, loc.name AS loc, t.label AS task, sw.name AS sw, live.name AS live, ld.area AS load, ld.critical AS critical`).rows[0];
  const [asset, code, loc, task, sw, live, load, critical] = site;
  const kv = [[{ ko: '작업 대상 설비 (자산관리)', en: 'Target asset (asset mgmt)' }, `${esc(asset)} <code>${esc(code)}</code>`],
    [{ ko: '설치 위치 (선로 모델)', en: 'Installed at (grid model)' }, esc(loc)],
    [{ ko: '정비 업무 유형', en: 'Maintenance task' }, esc(task)]];
  if (sw) kv.push([{ ko: '개방하는 개폐기', en: 'Switch opened' }, esc(sw)]);
  if (live) kv.push([{ ko: '옆에서 살아 있는 선로', en: 'Stays live nearby' }, esc(live)]);
  if (load) kv.push([{ ko: '끊기는 부하', en: 'Load interrupted' }, esc(load) + (critical ? ` <b class="crit">${esc(T({ ko: '중요 고객', en: 'critical' }))}</b>` : '')]);
  $('soSite').innerHTML = kv.map(([k, v]) => `<div><span>${esc(T(k))}</span><b>${v}</b></div>`).join('');

  const res = runCypher(G, `MATCH (s:WorkStep)-[:IN_SCENARIO]->(:WorkScenario {scenarioId: '${scn}'})
OPTIONAL MATCH (s)-[:APPLIES_RULE]->(r:SafetyRule)
WITH s, collect(r.ruleNo) AS rules
OPTIONAL MATCH (s)-[:HAS_RISK]->(h:Hazard)
WITH s, rules, collect(h.label${L}) AS hazards
OPTIONAL MATCH (s)-[:INVOLVES]->(c:CrewRole)
WITH s, rules, hazards, collect(c.label${L}) AS crew
MATCH (s)-[:IN_WORKFLOW]->(wf:WorkflowStep), (s)-[:IN_STAGE]->(st:LifecycleStage)
OPTIONAL MATCH (x:UnsafeChoice)-[:MISTAKE_AT]->(s)
RETURN s.stepNo AS no, s.label${L} AS step, rules, hazards, crew, wf.code AS wf, wf.label AS wfLabel, st.label AS stage, count(x) AS wrong
ORDER BY no`);
  const head = [{ ko: '#', en: '#' }, { ko: '작업 단계 (aipd:Task)', en: 'Work step (aipd:Task)' }, { ko: '수칙', en: 'Rules' }, { ko: '위험요인 (aipd:hasRisk)', en: 'Hazards (aipd:hasRisk)' },
    { ko: '참여 역할', en: 'Crew' }, { ko: '정비 흐름 (pam:WF)', en: 'Workflow (pam:WF)' }, { ko: '생애주기', en: 'Stage' }];
  $('soSteps').innerHTML = `<table><tr>${head.map(h => `<th>${esc(T(h))}</th>`).join('')}</tr>` + res.rows.map(([no, step, rules, hz, crew, wf, wfl, stage]) =>
    `<tr><td class="num">${no}</td><td>${esc(step)}</td><td>${rules.map(r => `<span class="rn">${r}</span>`).join(' ')}</td><td>${esc(hz.join(' · '))}</td><td class="meta">${esc(crew.join(' · '))}</td><td><code>${esc(wf)}</code> <span class="meta">${esc(wfl)}</span></td><td>${esc(stage)}</td></tr>`).join('') + '</table>';
}

function presets() {
  $('soPresets').innerHTML = SAFETY_CYPHER.map((c, i) => `<button type="button" data-i="${i}" aria-pressed="${i === preset}">Q${i + 1}. ${esc(T(c))}</button>`).join('');
}
function fill(i) {
  preset = i; const c = SAFETY_CYPHER[i];
  $('query').value = (en() && c.qEn) || c.q;
  presets();
}
function runQuery() {
  const out = $('results');
  if (!G) { out.innerHTML = `<p class="meta">${T({ ko: '그래프를 불러오는 중입니다…', en: 'Loading the graph…' })}</p>`; return; }
  const t0 = performance.now();
  try {
    const res = runCypher(G, $('query').value);
    const ms = (performance.now() - t0).toFixed(1);
    if (!res.rows.length) { out.innerHTML = `<p>${T({ ko: '결과 없음', en: 'No results' })} (${ms} ms)</p>`; return; }
    out.innerHTML = `<p class="meta">${res.rows.length} ${T({ ko: '행', en: 'rows' })} · ${ms} ms</p><div class="tbl"><table><tr>${res.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>` +
      res.rows.slice(0, 500).map(r => `<tr>${r.map(v => `<td>${esc(show(v))}</td>`).join('')}</tr>`).join('') + '</table></div>';
  } catch (e) {
    out.innerHTML = `<p class="err">⚠ ${esc(e.message || e)}</p>`;
  }
}
function render() { stats(); steps(); runQuery(); }

$('soScn').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && G) { scn = b.dataset.k; steps(); } });
$('soPresets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fill(Number(b.dataset.i)); runQuery(); } });
$('soQuery').addEventListener('click', runQuery);
$('query').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery(); });
document.addEventListener('langchange', () => { fill(preset); if (G) render(); });
fill(0);
build();
