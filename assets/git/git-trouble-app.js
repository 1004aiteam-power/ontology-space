// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 장애 사례집 페이지: 사례를 고르면 "문제가 일어난 상태"의 터미널이 열리고, 해결 여부를 매번 확인한다 (사례는 scenarios.js)
import { Session } from './cmds.js?v=478b631d';
import { LABS, GUIDES, CATS } from './scenarios.js?v=ea32b874';
import { createTerminal } from './terminal.js?v=bb7b666f';
import { graphSvg, areasHtml } from './viz.js?v=6f9fac9c';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const ALL = [...LABS.map(l => ({ ...l, kind: 'lab' })), ...GUIDES.map(g => ({ ...g, kind: 'guide' }))];
const solved = new Set();
try { for (const id of JSON.parse(sessionStorage.getItem('git-solved') || '[]')) solved.add(id); } catch { /* 저장소를 못 쓰는 환경 */ }
const save = () => { try { sessionStorage.setItem('git-solved', JSON.stringify([...solved])); } catch { /* 무시 */ } };
let cur = null, st = null;

function picker() {
  $('csCats').innerHTML = CATS.map(c => {
    const items = ALL.filter(x => x.cat === c.id);
    return `<div class="cs-cat"><h3>${t(c)}</h3><div class="cs-list">${items.map(x => `<button type="button" class="cs-btn ${x.kind === 'guide' ? 'guide' : ''} ${solved.has(x.id) ? 'solved' : ''}" data-id="${x.id}" aria-pressed="${cur === x.id}">${x.kind === 'guide' ? '📖' : x.icon} ${esc(t(x.title))}</button>`).join('')}</div></div>`;
  }).join('');
}

const card = (title, html) => `<div class="card"><h4>${title}</h4><p>${html}</p></div>`;
function explain(c) {
  return `<div class="cs-explain">${card(T('🔎 원인', '🔎 Cause'), t(c.cause))}${card(T('🛠 해결', '🛠 Fix'), t(c.fix))}${card(T('🛡 예방', '🛡 Prevention'), t(c.prevent))}</div>`;
}

function texts() {
  const c = cur && ALL.find(x => x.id === cur);
  if (!c) return;
  $('csHead').innerHTML = `<h3>${c.kind === 'guide' ? '📖' : c.icon} ${esc(t(c.title))}</h3>` + (c.kind === 'lab' ? `<p>${t(c.symptom)}</p><p class="meta">🎯 ${t(c.goalText)}</p>` : '');
  if (c.kind === 'guide') {
    $('csBody').innerHTML = `<pre class="m-pre cs-trans">${esc(c.transcript)}</pre>${card(T('🔎 원인', '🔎 Cause'), t(c.cause))}<h4>${T('🛠 해결 순서', '🛠 Steps to fix')}</h4><ol class="flow-list">${c.steps.map(s => `<li>${t(s)}</li>`).join('')}</ol>${card(T('🛡 예방', '🛡 Prevention'), t(c.prevent))}`;
    return;
  }
  const ok = solved.has(c.id);
  const hs = c.hints.slice(0, st.hints).map((h, i) => `<p><b>${T('힌트', 'Hint')} ${i + 1}.</b> ${t(h)}</p>`).join('');
  $('csHints').innerHTML = hs + (st.showSol ? `<p><b>${T('정답', 'Answer')}</b> <span class="cs-sol">${esc(c.solution.join('\n'))}</span></p>` : '');
  $('csStatus').className = 'cs-status' + (ok ? ' ok' : '');
  $('csStatus').textContent = ok ? T('✓ 해결했습니다! 아래 설명을 읽어 보세요.', '✓ Solved! Read the explanation below.') : T('아직 해결되지 않았습니다. 터미널에서 명령을 쳐 보세요.', 'Not solved yet. Try commands in the terminal.');
  $('csExplain').innerHTML = ok || st.showExplain ? explain(c) : '';
  $('bHint').textContent = T(`💡 힌트 (${st.hints}/${c.hints.length})`, `💡 Hint (${st.hints}/${c.hints.length})`);
}
function side() {
  if (!st) return;
  const r = st.s.repo;
  $('csGraph').innerHTML = graphSvg(r);
  $('csAreas').innerHTML = areasHtml(r);
  const h = [...st.s.hub.values()][0];
  $('csRemoteBox').hidden = !h;
  if (h) $('csRemote').innerHTML = graphSvg(h);
}
function check() {
  const c = ALL.find(x => x.id === cur);
  if (!c || c.kind !== 'lab') return;
  let ok = false;
  try { ok = !!c.goal(st.s); } catch { ok = false; }
  if (ok && !solved.has(c.id)) { solved.add(c.id); save(); picker(); }
  side(); texts();
}

function open(id, { hash = true } = {}) {
  const c = ALL.find(x => x.id === id);
  if (!c) return;
  cur = id;
  picker();
  if (hash) { try { history.replaceState(null, '', `#case=${id}`); } catch { /* 무시 */ } }
  const panel = $('csPanel');
  if (c.kind === 'guide') {
    st = null;
    panel.innerHTML = '<div id="csHead"></div><div id="csBody"></div>';
    texts();
    return;
  }
  st = { s: new Session(), hints: 0, showSol: false, showExplain: false };
  c.setup(st.s);
  panel.innerHTML = `<div id="csHead"></div>
    <div class="gt-grid"><div><div id="csTerm" class="tall"></div>
      <div class="ctrl"><button type="button" id="bHint"></button><button type="button" id="bSol">${T('✅ 정답 보기 (실행)', '✅ Show the answer (runs it)')}</button><button type="button" id="bExp">${T('📘 설명 보기', '📘 Show explanation')}</button><button type="button" id="bReset">${T('↺ 처음 상태로', '↺ Reset')}</button></div></div>
      <div class="gt-side"><div class="panel"><h4>${T('커밋 그래프', 'Commit graph')}</h4><div id="csGraph"></div></div><div class="panel" id="csRemoteBox"><h4>GitHub (origin)</h4><div id="csRemote"></div></div><div class="panel"><h4>${T('세 영역', 'Three areas')}</h4><div id="csAreas"></div></div></div></div>
    <div class="cs-status" id="csStatus"></div><div class="cs-hints" id="csHints"></div><div id="csExplain"></div>`;
  const term = createTerminal($('csTerm'), { session: st.s, onRun: () => check() });
  st.term = term;
  $('bHint').addEventListener('click', () => { if (st.hints < c.hints.length) st.hints++; texts(); });
  $('bSol').addEventListener('click', () => { st.showSol = true; for (const cmd of c.solution) term.run(cmd); texts(); });
  $('bExp').addEventListener('click', () => { st.showExplain = !st.showExplain; texts(); });
  $('bReset').addEventListener('click', () => open(id, { hash: false }));
  term.print(T('— 문제가 일어난 상태입니다. 증상을 보여 주는 명령을 먼저 실행합니다 —', '— The problem has already happened. First, the command that shows the symptom —'), 'h');
  term.run(c.trigger);
  side(); texts();
}

$('csCats').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) { open(b.dataset.id); $('csPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
document.addEventListener('langchange', () => { picker(); texts(); if (st) { $('bSol').textContent = T('✅ 정답 보기 (실행)', '✅ Show the answer (runs it)'); $('bExp').textContent = T('📘 설명 보기', '📘 Show explanation'); $('bReset').textContent = T('↺ 처음 상태로', '↺ Reset'); side(); } });
const fromHash = () => { const m = /case=([a-z-]+)/.exec(location.hash); return m && ALL.some(x => x.id === m[1]) ? m[1] : null; };
window.addEventListener('hashchange', () => { const id = fromHash(); if (id && id !== cur) open(id, { hash: false }); });
picker();
open(fromHash() || 'push-rejected', { hash: false });
