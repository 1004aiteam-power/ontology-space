// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// VPP 가상 전력시장 페이지: 시장 계산(vpp-graph.js) → 트리플 + 스키마 · 디지털 트윈 Turtle → 속성 그래프(그래프 DB)
// → Cytoscape 그래프 · 노드 상세(그래프 DB 노드 ↔ 원본 Turtle) · 시간대별 입찰/실적 · Cypher 질의.
// 화면에 보이는 숫자는 모두 그래프에 Cypher를 실행해 얻습니다. Turtle은 cypher/turtle.js(N3.js)로 읽음
import { parse } from '../cypher/turtle.js';
import { buildGraph } from '../cypher/graph.js';
import { runCypher, show } from '../cypher/cypher.js';
import { triples, toQuads, turtleBlock, qname, VPPS, VPP_CYPHER, VPP_SCHEMA, LINKED_FILES, RULE } from './vpp-graph.js?v=20261109a';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = (o) => window.t(o);
const en = () => document.documentElement.lang === 'en';
const L = () => (en() ? '_en' : '');
const nf = (v, d = 0) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
let G = null, LIST = null, cy = null, sel = 'VPP02', preset = 0, picked = null;

// 그래프에 보이는 종류 (색은 검증한 범주형 팔레트의 고정 순서, 모양을 함께 달리해 색만으로 구분하지 않게)
const KINDS = [
  { label: 'VirtualPowerPlant', slot: 0, shape: 'round-rectangle', size: 30, ko: 'VPP', en: 'VPP' },
  { label: 'CurtailmentInstruction', slot: 1, shape: 'diamond', size: 18, ko: '출력제한 지시', en: 'Curtailment' },
  { label: 'WindSystem', slot: 2, shape: 'triangle', size: 16, ko: '풍력', en: 'Wind' },
  { label: 'PVSystem', slot: 3, shape: 'ellipse', size: 14, ko: '태양광', en: 'Solar PV' },
  { label: 'DemandResponseResource', slot: 4, shape: 'hexagon', size: 15, ko: '수요반응', en: 'Demand response' },
  { label: 'BatterySystem', slot: 5, shape: 'rectangle', size: 15, ko: 'ESS', en: 'Battery' },
  { label: 'EVChargingSite', slot: 6, shape: 'pentagon', size: 15, ko: '전기차 충전소', en: 'EV charging' },
  { label: 'Feeder', slot: -1, shape: 'round-rectangle', size: 18, ko: '배전선로 22.9kV', en: 'Feeder 22.9 kV' },
  { label: 'Substation', slot: -2, shape: 'barrel', size: 30, ko: '변전소 154kV (디지털 트윈)', en: 'Substation 154 kV (twin)' },
  { label: 'Aggregator', slot: -3, shape: 'tag', size: 16, ko: '중개사업자', en: 'Aggregator' }
];
const PAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9']
};
const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function colorOf(k) {
  if (k.slot >= 0) return PAL[dark() ? 'dark' : 'light'][k.slot];
  return k.slot === -1 ? (dark() ? '#8b93a1' : '#5d6370') : k.slot === -2 ? (dark() ? '#c7ccd4' : '#2b2f36') : (dark() ? '#6b717c' : '#a3a8b1');
}
const kindOf = (n) => KINDS.find(k => n.labelSet.has(k.label));

async function build() {
  const t0 = performance.now();
  try {
    const texts = await Promise.all([VPP_SCHEMA, ...LINKED_FILES].map(async f => {
      const r = await fetch(new URL('../../' + f, import.meta.url));
      if (!r.ok) throw new Error(f + ': ' + r.status);
      return r.text();
    }));
    LIST = triples();
    const quads = toQuads(LIST);
    for (const t of texts) quads.push(...parse(t, { format: 'text/turtle', base_iri: 'http://example.org/base' }));
    G = buildGraph(quads);
    $('vpStatus').textContent = T({ ko: `그래프 준비: VPP 온톨로지 트리플 ${LIST.length.toLocaleString()}개 + 스키마 + 디지털 트윈 → 노드 ${G.nodes.length.toLocaleString()} · 관계 ${G.rels.length.toLocaleString()} (${Math.round(performance.now() - t0)} ms)`,
      en: `Graph ready: ${LIST.length.toLocaleString()} VPP triples + schema + digital twin → ${G.nodes.length.toLocaleString()} nodes · ${G.rels.length.toLocaleString()} relationships (${Math.round(performance.now() - t0)} ms)` });
    render();
  } catch (e) {
    $('vpStatus').textContent = '⚠ ' + (e.message || e);
  }
}

const one = (q) => runCypher(G, q).rows[0]?.[0] ?? 0;
function stats() {
  const items = [
    [one('MATCH (n:VirtualPowerPlant) RETURN count(n)'), { ko: '가상발전소 (VPP)', en: 'virtual power plants' }],
    [one('MATCH (n:DER) RETURN count(n)'), { ko: '분산에너지자원 (DER)', en: 'DER' }],
    [one('MATCH (n:Feeder) RETURN count(n)'), { ko: '배전선로', en: 'feeders' }],
    [one('MATCH (:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation) RETURN count(DISTINCT s)'), { ko: '변전소 (디지털 트윈)', en: 'substations (twin)' }],
    [one('MATCH (n:Bid) RETURN count(n)'), { ko: '입찰 · 정산', en: 'bids · settlements' }],
    [one('MATCH (n:CurtailmentInstruction) RETURN count(n)'), { ko: '출력제한 지시', en: 'curtailments' }]
  ];
  $('vpStats').innerHTML = items.map(([v, l]) => `<div><b>${v.toLocaleString()}</b><span>${esc(T(l))}</span></div>`).join('');
}

// ---- 그래프 그리기: 위에 계통(변전소 → 선로 → DER), 아래에 VPP · 중개사업자 ----------------------------------
const SHOWN = ['Substation', 'Feeder', 'DER', 'VirtualPowerPlant', 'Aggregator', 'CurtailmentInstruction'];
function layout() {
  const pos = new Map(), subs = runCypher(G, 'MATCH (f:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation) RETURN DISTINCT s ORDER BY s.name').rows.map(r => r[0]);
  let x = 0;
  for (const s of subs) {
    const feeders = s.in.filter(r => r.type === 'NORMAL_ENERGIZING_SUBSTATION').map(r => r.start).sort((a, b) => a.props.uri.localeCompare(b.props.uri));
    const fx = [];
    for (const f of feeders) {
      const ders = f.in.filter(r => r.type === 'EQUIPMENT_CONTAINER').map(r => r.start).sort((a, b) => a.props.uri.localeCompare(b.props.uri));
      const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(ders.length)))), w = Math.max(cols, 1) * 26;
      const cx = x + w / 2; fx.push(cx);
      pos.set(f.props.uri, { x: cx, y: 150 });
      ders.forEach((d, i) => pos.set(d.props.uri, { x: cx - (cols - 1) * 13 + (i % cols) * 26, y: 220 + Math.floor(i / cols) * 30 }));
      f.in.filter(r => r.type === 'ON_FEEDER').map(r => r.start).forEach((c, i) => pos.set(c.props.uri, { x: cx + 22 + (i % 3) * 14, y: 105 - Math.floor(i / 3) * 14 }));
      x += w + 14;
    }
    pos.set(s.props.uri, { x: (fx[0] + fx[fx.length - 1]) / 2, y: 30 });
    x += 26;
  }
  // VPP는 묶은 DER들의 가운데 x에 (겹치지 않게 간격 유지), 중개사업자는 그 아래
  const vpps = (G.byLabel.get('VirtualPowerPlant') || []).map(v => {
    const xs = v.out.filter(r => r.type === 'AGGREGATES').map(r => pos.get(r.end.props.uri)?.x ?? 0);
    return { v, x: xs.reduce((a, b) => a + b, 0) / (xs.length || 1) };
  }).sort((a, b) => a.x - b.x);
  const span = x - 40, gap = span / vpps.length;
  vpps.forEach((o, i) => {
    const vx = gap * (i + 0.5);
    pos.set(o.v.props.uri, { x: vx, y: 640 });
    const ag = o.v.out.find(r => r.type === 'OPERATED_BY')?.end;
    if (ag) pos.set(ag.props.uri, { x: vx, y: 700 + (i % 2) * 24 });
  });
  return pos;
}
function shortName(n) {
  const p = n.props, k = kindOf(n);
  if (n.labelSet.has('Substation')) return String(p.name || '').replace(' (가상)', '');
  if (n.labelSet.has('Feeder')) return 'D/L ' + String(p.label || '').split('D/L ')[1];
  if (n.labelSet.has('VirtualPowerPlant')) return (en() ? p.label_en : p.label) || p.vppId;
  if (n.labelSet.has('Aggregator')) return (en() ? p.label_en : p.label) || '';
  return k ? '' : '';
}
function drawGraph() {
  if (!window.cytoscape || !G) return;
  const keep = (n) => SHOWN.some(l => n.labelSet.has(l)) && (!n.labelSet.has('Substation') || n.in.some(r => r.type === 'NORMAL_ENERGIZING_SUBSTATION'));
  const pos = layout(), els = [];
  for (const n of G.nodes) {
    if (!keep(n)) continue;
    const k = kindOf(n); if (!k) continue;
    const size = n.labelSet.has('DER') ? Math.max(11, Math.min(22, Math.sqrt(n.props.capacityKW || 200) * 0.6)) : k.size;
    els.push({ data: { id: n.props.uri, label: shortName(n), color: colorOf(k), shape: k.shape, size }, position: pos.get(n.props.uri) || { x: 0, y: 0 } });
  }
  const ids = new Set(els.map(e => e.data.id));
  for (const r of G.rels) {
    if (!ids.has(r.start.props.uri) || !ids.has(r.end.props.uri)) continue;
    if (r.type === 'AFFECTS') continue;   // 출력제한 지시 → DER은 선택했을 때만 강조 (선이 너무 많아짐)
    els.push({ data: { id: 'r' + r.id, source: r.start.props.uri, target: r.end.props.uri, label: r.type, t: r.type } });
  }
  const text = css('--text'), muted = css('--muted'), bg = css('--surface'), line = dark() ? '#4a505b' : '#c9c6bf';
  if (cy) cy.destroy();
  cy = cytoscape({
    container: $('graph'), elements: els, wheelSensitivity: 0.3, minZoom: 0.2, maxZoom: 3,
    style: [
      { selector: 'node', style: { 'background-color': 'data(color)', shape: 'data(shape)', width: 'data(size)', height: 'data(size)', label: 'data(label)',
          color: text, 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 4, 'text-outline-color': bg, 'text-outline-width': 2.5, 'border-width': 2, 'border-color': bg } },
      { selector: 'edge', style: { width: 1, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.6, 'curve-style': 'straight', opacity: 0.55,
          label: 'data(label)', 'font-size': 8, color: muted, 'text-rotation': 'autorotate', 'text-opacity': 0, 'text-background-color': bg, 'text-background-opacity': 1, 'text-background-padding': 1 } },
      { selector: 'edge[t = "AGGREGATES"]', style: { 'line-color': PAL[dark() ? 'dark' : 'light'][0], 'target-arrow-color': PAL[dark() ? 'dark' : 'light'][0], opacity: 0.25 } },
      { selector: '.dim', style: { opacity: 0.12 } },
      { selector: 'edge.dim', style: { opacity: 0.05 } },
      { selector: '.hl', style: { opacity: 1 } },
      { selector: 'edge.hl', style: { width: 2, opacity: 0.95 } },
      { selector: 'edge.lbl', style: { 'text-opacity': 1 } },
      { selector: 'node.pick', style: { 'border-color': '#f59e0b', 'border-width': 4 } }
    ],
    layout: { name: 'preset', fit: true, padding: 24 }
  });
  cy.on('tap', 'node', e => pick(e.target.id()));
  cy.on('tap', e => { if (e.target === cy) { picked = null; highlight(selQuery().nodes); detail(null); } });
  highlight(selQuery().nodes);
  legend();
}
function legend() {
  $('vpLegend').innerHTML = KINDS.map(k => `<span><i style="background:${colorOf(k)}" class="sh-${k.shape}"></i>${esc(T(k))}</span>`).join('');
}
// 강조할 노드 uri 집합 → 나머지는 흐리게
function highlight(uris) {
  if (!cy) return;
  cy.elements().removeClass('hl dim pick lbl');
  if (!uris) return;
  const on = cy.nodes().filter(n => uris.has(n.id()));
  cy.elements().addClass('dim');
  on.removeClass('dim').addClass('hl');
  on.edgesWith(on).removeClass('dim').addClass('hl');
  if (picked) { const pn = cy.getElementById(picked); pn.addClass('pick'); pn.connectedEdges().addClass('lbl'); }
}

// ---- VPP 선택: 강조도 Cypher의 결과 ---------------------------------------------------------------------------
function selQuery() {
  if (!G) return { q: '', nodes: null };
  if (sel === 'ALL') return { q: '', nodes: null };
  const q = `MATCH (v:VirtualPowerPlant {vppId: '${sel}'})-[:OPERATED_BY]->(a:Aggregator),
      (v)-[:AGGREGATES]->(d:DER)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
      -[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
OPTIONAL MATCH (ci:CurtailmentInstruction)-[:AFFECTS]->(d)
RETURN v, a, d, f, s, ci`;
  const res = runCypher(G, q), nodes = new Set();
  for (const row of res.rows) for (const n of row) if (n?.props) nodes.add(n.props.uri);
  return { q, nodes };
}
function chips() {
  const items = [['ALL', { ko: '전체', en: 'All' }], ...VPPS.map(v => [v.id, v])];
  $('vpChips').innerHTML = items.map(([id, v]) => `<button type="button" data-id="${id}" aria-pressed="${id === sel}">${id === 'ALL' ? '' : `<small>${id.replace('VPP', '')}</small> `}${esc(T(v))}</button>`).join('');
  const { q } = selQuery();
  $('vpSelQuery').innerHTML = q ? `<summary>${esc(T({ ko: '이 강조는 아래 Cypher의 결과입니다', en: 'This highlight is the result of the Cypher below' }))}</summary><pre><code>${esc(q)}</code></pre>` : '';
  $('vpSelQuery').hidden = !q;
  const v = VPPS.find(x => x.id === sel);
  $('vpSelInfo').innerHTML = v ? `<b>${esc(T(v))}</b> · ${esc(T(v.agg))} · ${esc(T(v.strategy))}` : esc(T({ ko: 'VPP 10개 전체. 노드를 누르면 그래프 DB의 노드와 원본 온톨로지를 나란히 봅니다.', en: 'All ten VPPs. Click a node to see the graph-DB node next to its source ontology.' }));
}

// ---- 노드 상세: 그래프 DB 노드 ↔ 원본 Turtle ------------------------------------------------------------------
function pick(uri) {
  picked = uri;
  const n = G.byUri.get(uri);
  const near = new Set([uri]);
  for (const r of [...n.out, ...n.in]) near.add(r.end.props.uri === uri ? r.start.props.uri : r.end.props.uri);
  highlight(near);
  // 출력제한 지시는 영향받은 DER까지 선으로
  if (n.labelSet.has('CurtailmentInstruction') && cy) for (const r of n.out.filter(r => r.type === 'AFFECTS')) cy.add({ data: { id: 'tmp' + r.id, source: uri, target: r.end.props.uri, label: 'AFFECTS', t: 'AFFECTS' }, classes: 'hl tmp lbl' });
  else if (cy) cy.remove('.tmp');
  detail(n);
}
function detail(n) {
  const box = $('vpDetail');
  if (!n) { box.innerHTML = `<p class="meta">${esc(T({ ko: '그래프에서 노드를 누르세요. 예: 아래쪽 파란 VPP, 위쪽 변전소, 주황 마름모(출력제한 지시).', en: 'Click a node in the graph: a blue VPP at the bottom, a substation at the top, or an orange diamond (curtailment).' }))}</p>`; return; }
  const name = (m) => esc(m.props.label ?? m.props.name ?? m.props.vppId ?? qname(m.props.uri));
  const props = Object.entries(n.props).filter(([k]) => k !== 'uri');
  const rels = [...n.out.map(r => [`-[:${r.type}]→`, r.end]), ...n.in.map(r => [`←[:${r.type}]-`, r.start])];
  const MAXR = 14;
  const graphSide = `<p><code>(:${esc(n.labels.join(':'))})</code></p><div class="tbl"><table>
    <tr><td>uri</td><td><code>${esc(qname(n.props.uri))}</code></td></tr>
    ${props.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(show(v))}</td></tr>`).join('')}
    ${rels.slice(0, MAXR).map(([t, m]) => `<tr><td><code>${esc(t)}</code></td><td>${name(m)}</td></tr>`).join('')}
    ${rels.length > MAXR ? `<tr><td colspan="2" class="meta">… ${T({ ko: `관계 ${rels.length - MAXR}개 더`, en: `${rels.length - MAXR} more relationships` })}</td></tr>` : ''}
  </table></div>`;
  let ttl = turtleBlock(n.props.uri, LIST);
  const incoming = LIST.filter(([, , o]) => o === n.props.uri).length;
  if (!ttl) ttl = T({ ko: `# 이 개체는 디지털 트윈(korea_virtual_grid.ttl)에 정의돼 있습니다.\n# VPP 데이터는 이 IRI를 가리키기만 합니다 (트리플 ${incoming}개).`, en: `# Defined in the digital twin (korea_virtual_grid.ttl).\n# The VPP data only points at this IRI (${incoming} triples).` });
  else if (incoming) ttl += '\n# ' + T({ ko: `+ 이 개체를 목적어로 가리키는 트리플 ${incoming}개 (관계의 ← 방향)`, en: `+ ${incoming} triples point at this individual (the ← relationships)` });
  box.innerHTML = `<div class="vp-two"><div><h4>${esc(T({ ko: '① 원본 온톨로지 (Turtle)', en: '① Source ontology (Turtle)' }))}</h4><pre><code>${esc(ttl)}</code></pre></div>
    <div><h4>${esc(T({ ko: '② 그래프 DB 노드 (라벨 · 속성 · 관계)', en: '② Graph-DB node (labels, properties, relationships)' }))}</h4>${graphSide}</div></div>`;
}

// ---- 시간대별 입찰 · 실적 (한 축: MWh. SMP는 별도 줄과 툴팁으로) ------------------------------------------------
function market() {
  const id = sel === 'ALL' ? 'VPP02' : sel;
  const q = `MATCH (h:MarketInterval)
OPTIONAL MATCH (b:Bid)-[:FOR_INTERVAL]->(h), (b)-[:SUBMITTED_BY]->(:VirtualPowerPlant {vppId: '${id}'})
OPTIONAL MATCH (s:Settlement)-[:SETTLES]->(b)
RETURN h.hour AS hour, h.smp AS smp, b.offeredMWh AS bid, s.actualMWh AS actual, s.deviationPct AS dev,
       s.essAdjustMWh AS ess, s.curtailedMWh AS curtailed, s.penaltyKRW AS penalty
ORDER BY hour`;
  const rows = runCypher(G, q).rows.map(([hour, smp, bid, actual, dev, ess, cut, pen]) => ({ hour, smp, bid: bid || 0, actual: actual || 0, dev, ess, cut, pen }));
  const v = VPPS.find(x => x.id === id);
  $('vpMkTitle').textContent = `${T(v)} — ${T({ ko: '시간대별 입찰량과 계량 실적 (MWh)', en: 'hourly bid and metered output (MWh)' })}`;
  $('vpMkQuery').innerHTML = `<summary>${esc(T({ ko: '이 차트를 만든 Cypher', en: 'The Cypher behind this chart' }))}</summary><pre><code>${esc(q)}</code></pre>`;
  const W = 760, H = 250, padL = 40, padR = 10, padT = 14, padB = 46;
  const max = Math.max(0.5, ...rows.map(r => Math.max(r.bid, r.actual))) * 1.1;
  const step = (W - padL - padR) / 24, bw = Math.max(4, step / 2 - 3);
  const y = (val) => padT + (H - padT - padB) * (1 - val / max);
  const ticks = [0, max / 3, (2 * max) / 3].map(t => Math.round(t * 10) / 10);
  const c = PAL[dark() ? 'dark' : 'light'];
  const bar = (x, v, fill, cls) => v > 0 ? `<path class="${cls}" d="M${x},${y(0)} V${y(v) + 3} q0,-3 3,-3 h${bw - 6} q3,0 3,3 V${y(0)} Z" fill="${fill}"/>` : '';
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc($('vpMkTitle').textContent)}">`;
  for (const t of ticks) svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${t}</text>`;
  rows.forEach((r, i) => {
    const x0 = padL + i * step + 2;
    if (r.cut) svg += `<rect x="${x0 - 2}" y="${padT}" width="${step}" height="${H - padT - padB}" class="cutband"/>`;
    svg += bar(x0, r.bid, css('--muted'), 'bid') + bar(x0 + bw + 2, r.actual, c[0], 'act');
    if (r.dev != null && Math.abs(r.dev) > RULE.tolerance * 100) svg += `<text x="${x0 + bw}" y="${y(Math.max(r.bid, r.actual)) - 4}" text-anchor="middle" class="warn">!</text>`;
    if (i % 3 === 0) svg += `<text x="${x0 + bw}" y="${H - padB + 14}" text-anchor="middle" class="ax">${r.hour}${T({ ko: '시', en: 'h' })}</text>`;
    svg += `<text x="${x0 + bw}" y="${H - padB + 32}" text-anchor="middle" class="smp">${r.smp}</text>`;
    svg += `<rect x="${x0 - 2}" y="${padT}" width="${step}" height="${H - padT - padB + 36}" class="hit" data-i="${i}"/>`;
  });
  svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="base"/><text x="${padL - 6}" y="${H - padB + 32}" text-anchor="end" class="ax">SMP</text></svg>`;
  $('vpChart').innerHTML = svg + '<div class="vp-tip" id="vpTip" hidden></div>';
  $('vpChartLegend').innerHTML = `<span><i style="background:${css('--muted')}"></i>${esc(T({ ko: '입찰량 (하루 전 약속)', en: 'Bid (day-ahead promise)' }))}</span><span><i style="background:${c[0]}"></i>${esc(T({ ko: '계량 실적', en: 'Metered output' }))}</span><span><i class="band"></i>${esc(T({ ko: '자원이 출력제한을 받은 시간', en: 'Hours with curtailment' }))}</span><span><b class="warnb">!</b> ${esc(T({ ko: `오차 ±${RULE.tolerance * 100}% 초과 (벌칙)`, en: `Deviation beyond ±${RULE.tolerance * 100}% (penalty)` }))}</span><span class="meta">SMP = ${esc(T({ ko: '원/kWh (가상)', en: 'KRW/kWh (virtual)' }))}</span>`;
  const tip = $('vpTip'), box = $('vpChart');
  box.querySelectorAll('.hit').forEach(h => {
    h.addEventListener('mouseenter', () => {
      const r = rows[+h.dataset.i];
      tip.innerHTML = `<b>${String(r.hour).padStart(2, '0')}:00–${String(r.hour + 1).padStart(2, '0')}:00</b> · SMP ${r.smp}<br>` + (r.bid > 0 || r.actual > 0
        ? `${T({ ko: '입찰', en: 'Bid' })} ${nf(r.bid, 3)} · ${T({ ko: '실적', en: 'Actual' })} ${nf(r.actual, 3)} MWh<br>${T({ ko: '오차', en: 'Deviation' })} ${r.dev ?? 0}%` +
          (r.ess ? `<br>ESS ${T({ ko: '보정', en: 'correction' })} ${nf(r.ess, 3)} MWh` : '') + (r.cut ? `<br>${T({ ko: '출력제한', en: 'Curtailed' })} ${nf(r.cut, 3)} MWh` : '') + (r.pen ? `<br>${T({ ko: '벌칙', en: 'Penalty' })} ${nf(r.pen)} ${T({ ko: '원', en: 'KRW' })}` : '')
        : T({ ko: '입찰 없음', en: 'No bid' }));
      const bb = box.getBoundingClientRect(), hb = h.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = Math.min(bb.width - 190, Math.max(0, hb.left - bb.left + hb.width / 2 - 90)) + 'px';
      tip.style.top = '4px';
      h.classList.add('on');
    });
    h.addEventListener('mouseleave', () => { tip.hidden = true; h.classList.remove('on'); });
  });
  // 하루 정산 표 (Q6과 같은 질의)
  const st = runCypher(G, VPP_CYPHER[5][en() ? 'qEn' : 'q']);
  $('vpSettle').innerHTML = `<table><tr>${[{ ko: 'VPP', en: 'VPP' }, { ko: '이름', en: 'Name' }, { ko: '입찰 MWh', en: 'Bid MWh' }, { ko: '실적 MWh', en: 'Actual MWh' }, { ko: '오차 범위 안', en: 'In band' }, { ko: '순수익 (원)', en: 'Net (KRW)' }, { ko: '벌칙 (원)', en: 'Penalty (KRW)' }].map(h => `<th>${esc(T(h))}</th>`).join('')}</tr>` +
    st.rows.map(r => `<tr${r[0] === id ? ' class="on"' : ''}><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${nf(r[2], 2)}</td><td class="num">${nf(r[3], 2)}</td><td class="num">${esc(r[4])}</td><td class="num">${nf(r[5])}</td><td class="num">${nf(r[6])}</td></tr>`).join('') + '</table>';
}

// ---- Cypher 질의 ------------------------------------------------------------------------------------------------
function presets() {
  $('vpPresets').innerHTML = VPP_CYPHER.map((c, i) => `<button type="button" data-i="${i}" aria-pressed="${i === preset}">Q${i + 1}. ${esc(T(c))}</button>`).join('');
}
function fill(i) {
  preset = i; const c = VPP_CYPHER[i];
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

function render() { stats(); chips(); drawGraph(); detail(picked ? G.byUri.get(picked) : null); market(); runQuery(); }

$('vpChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !G) return;
  sel = b.dataset.id; picked = null; if (cy) cy.remove('.tmp');
  chips(); highlight(selQuery().nodes); detail(null); market();
});
$('vpFit').addEventListener('click', () => cy && cy.fit(undefined, 24));
$('vpPresets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fill(Number(b.dataset.i)); runQuery(); } });
$('vpQuery').addEventListener('click', runQuery);
$('query').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery(); });
document.addEventListener('langchange', () => { fill(preset); if (G) render(); });
new MutationObserver(() => { if (G) { drawGraph(); market(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
fill(0);
build();
