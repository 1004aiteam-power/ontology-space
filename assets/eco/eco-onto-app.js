// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 단세포 생태계 온톨로지 페이지: 시뮬레이션 실행 → 기록 → RDF → 속성 그래프 → 혈통 그림 · Cypher 질의
// Oxigraph(WebAssembly)는 스키마 Turtle을 읽는 데에만 씀. 세포 트리플은 eco-graph.js가 바로 만듦
import init, { parse } from '../vendor/oxigraph/web.js';
import { buildGraph } from '../cypher/graph.js';
import { runCypher, show } from '../cypher/cypher.js';
import { Recorder, ECO_CYPHER } from './eco-graph.js?v=20261107a';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = (o) => window.t(o);
const lang = () => document.documentElement.lang;
let G = null, tbox = null, rec = null, preset = 0, busy = false;

async function loadSchema() {
  await init({ module_or_path: new URL('../vendor/oxigraph/web_bg.wasm', import.meta.url) });
  const r = await fetch(new URL('../../examples/ecosystem/eco-ontology.ttl', import.meta.url));
  if (!r.ok) throw new Error('eco-ontology.ttl: ' + r.status);
  tbox = parse(await r.text(), { format: 'text/turtle' });
}

async function build() {
  if (busy) return;
  busy = true; $('eoRun').disabled = true;
  try {
    if (!tbox) { $('eoStatus').textContent = T({ ko: '스키마 불러오는 중…', en: 'Loading schema…' }); await loadSchema(); }
    const seed = Math.max(1, Math.min(9999, parseInt($('eoSeed').value, 10) || 1)), years = Number($('eoYears').value);
    rec = new Recorder({ seed, years });
    const prog = $('eoProg'); prog.hidden = false; prog.max = rec.ticks;
    const t0 = performance.now();
    while (!rec.advance(300)) {                          // 300틱마다 화면에 숨 돌릴 틈
      prog.value = rec.eco.t;
      $('eoStatus').textContent = T({ ko: `시뮬레이션 ${rec.eco.t.toLocaleString()} / ${rec.ticks.toLocaleString()}틱`, en: `Simulating ${rec.eco.t.toLocaleString()} / ${rec.ticks.toLocaleString()} ticks` });
      await new Promise(r => setTimeout(r));
    }
    prog.hidden = true;
    const quads = rec.toQuads();
    G = buildGraph([...tbox, ...quads]);
    const ms = Math.round(performance.now() - t0);
    $('eoStatus').textContent = T({ ko: `완료: 트리플 ${quads.length.toLocaleString()}개 → 노드 ${G.nodes.length.toLocaleString()} · 관계 ${G.rels.length.toLocaleString()} (${ms} ms)`,
      en: `Done: ${quads.length.toLocaleString()} triples → ${G.nodes.length.toLocaleString()} nodes · ${G.rels.length.toLocaleString()} relationships (${ms} ms)` });
    stats(); tree(); runQuery();
  } catch (e) {
    $('eoStatus').textContent = '⚠ ' + (e.message || e);
  } finally { busy = false; $('eoRun').disabled = false; }
}

function stats() {
  const s = rec.summary();
  const items = [
    [s.cells, { ko: '세포 (모두)', en: 'cells in total' }], [s.herb, { ko: '초식 세포', en: 'herbivores' }], [s.carn, { ko: '육식 세포', en: 'carnivores' }],
    [s.predations, { ko: '포식 (preysOn)', en: 'predations (preysOn)' }], [s.maxGen, { ko: '최대 세대', en: 'max generation' }], [s.alive, { ko: '끝까지 생존', en: 'alive at the end' }]
  ];
  $('eoStats').innerHTML = items.map(([v, l]) => `<div><b>${v.toLocaleString()}</b><span>${esc(T(l))}</span></div>`).join('');
}

// 육식 세포 혈통 그림: 그래프에서 Cypher로 읽어 그림 (eco:descendsFrom · bornAt · diedAt)
function tree() {
  const box = $('eoTree');
  const res = runCypher(G, `MATCH (c:Carnivore) OPTIONAL MATCH (c)-[:DESCENDS_FROM]->(p)
RETURN c.cellId AS id, p.cellId AS parent, c.bornAt AS born, c.diedAt AS died, c.deathCause AS cause ORDER BY born, id`);
  const cells = res.rows.map(([id, parent, born, died, cause]) => ({ id, parent, born, died, cause, kids: [] }));
  if (!cells.length) { box.innerHTML = `<p class="meta" style="padding:12px">${T({ ko: '육식 세포가 없습니다.', en: 'No carnivores.' })}</p>`; return; }
  const by = new Map(cells.map(c => [c.id, c])), roots = [];
  for (const c of cells) (c.parent != null && by.has(c.parent) ? by.get(c.parent).kids : roots).push(c);
  const anc = new Set();                                   // 살아남은 세포와 그 조상
  for (const c of cells) if (c.died == null) for (let x = c; x && !anc.has(x.id); x = by.get(x.parent)) anc.add(x.id);
  let row = 0;
  const place = (c) => { c.row = row++; for (const k of c.kids) place(k); };
  for (const r of roots) place(r);
  const T_END = rec.ticks, year = rec.eco.cfg.season.year;
  const W = 960, L = 8, R = 16, TOP = 8, rh = Math.max(3, Math.min(8, 520 / row)), H = TOP + row * rh + 26;
  const x = (t) => L + (t / T_END) * (W - L - R), y = (r) => TOP + r * rh + rh / 2;
  const out = [];
  for (let s = year * 0.75; s < T_END; s += year) out.push(`<rect class="win" x="${x(s)}" y="0" width="${x(Math.min(s + year / 4, T_END)) - x(s)}" height="${H - 20}"/>`);
  for (let k = 0; k <= T_END; k += year / 2) out.push(`<line class="grid" x1="${x(k)}" x2="${x(k)}" y1="${H - 20}" y2="${H - 16}"/><text class="ax" x="${x(k)}" y="${H - 4}" text-anchor="${k === 0 ? 'start' : k === T_END ? 'end' : 'middle'}">${k % year ? '' : T({ ko: `${k / year}년`, en: `yr ${k / year}` })}</text>`);
  for (const c of cells) {
    const a = anc.has(c.id) ? ' anc' : '', end = c.died ?? T_END, yy = y(c.row);
    if (c.parent != null && by.has(c.parent)) out.push(`<line class="split${a}" x1="${x(c.born)}" x2="${x(c.born)}" y1="${y(by.get(c.parent).row)}" y2="${yy}"/>`);
    out.push(`<line class="life${a}" x1="${x(c.born)}" x2="${Math.max(x(end), x(c.born) + 1)}" y1="${yy}" y2="${yy}"><title>#${c.id} · ${c.born}–${c.died ?? '…'}${c.cause ? ' · ' + c.cause : ''}</title></line>`);
    if (c.died == null) out.push(`<circle class="alive" cx="${x(end)}" cy="${yy}" r="3"/>`);
    else if (c.cause === 'starve') { const d = Math.min(2.5, rh / 2); out.push(`<path class="x" d="M${x(end) - d} ${yy - d}L${x(end) + d} ${yy + d}M${x(end) - d} ${yy + d}L${x(end) + d} ${yy - d}"/>`); }
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T({ ko: '육식 세포 혈통 그림', en: 'Carnivore family tree' }))}">${out.join('')}</svg>`;
}

function presets() {
  $('eoPresets').innerHTML = ECO_CYPHER.map((c, i) => `<button type="button" data-i="${i}" aria-pressed="${i === preset}">Q${i + 1}. ${esc(T(c))}</button>`).join('');
}
function fill(i) {
  preset = i; const c = ECO_CYPHER[i];
  $('query').value = (lang() === 'en' && c.qEn) || c.q;
  presets();
}

function runQuery() {
  const out = $('results');
  if (!G) { out.innerHTML = `<p class="meta">${T({ ko: '먼저 위에서 그래프를 만드세요.', en: 'Build the graph above first.' })}</p>`; return; }
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

$('eoPresets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fill(Number(b.dataset.i)); runQuery(); } });
$('eoQuery').addEventListener('click', runQuery);
$('query').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery(); });
$('eoRun').addEventListener('click', build);
document.addEventListener('langchange', () => { fill(preset); if (G) { stats(); tree(); runQuery(); } });
fill(0);
build();
