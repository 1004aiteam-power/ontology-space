// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Java 페이지: HashMap 버킷 시연 (모형은 jmap.js)
import { SCENARIOS, simulate } from './jmap.js?v=6d705ded';
import { highlight } from './hl.js?v=5ac4dd32';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

let cur = SCENARIOS[0], sim = simulate(cur), i = 0;

function render() {
  const s = sim.snaps[i], prog = cur.program.split('\n');
  $('jSrc').innerHTML = prog.map((l, n) => `<li class="${s.line === n ? 'on' : sim.snaps.slice(1, i + 1).some(x => x.line === n) ? 'done' : ''}">${esc(l) || ' '}</li>`).join('');
  $('jHead').textContent = T(`버킷 표 (칸 ${s.n}개, 항목 ${s.size}개 — ${Math.round(s.size / s.n * 100)}% 찼음, 75% 를 넘으면 두 배로 늘림)`, `Bucket table (${s.n} slots, ${s.size} entries, ${Math.round(s.size / s.n * 100)}% full; doubles past 75%)`);
  const hit = s.look ? s.look.index : -1;
  $('jBuckets').innerHTML = s.buckets.map((b, n) => `<div class="jb ${n === hit ? 'hit' : ''} ${b.length > 1 ? 'chain' : ''}"><small>${n}</small>${b.map(e => `<span class="jn ${s.look && s.look.checked.some(c => c.id === e.id) ? 'chk' : ''}" title="hash ${e.hash}">${esc(e.id)}</span>`).join('') || '<span class="jn empty">·</span>'}</div>`).join('');
  const L = s.look;
  $('jLook').innerHTML = L ? `<div class="note-box ${L.found === null ? 'bad' : 'good'}"><b>get</b> → ${T('버킷', 'bucket')} <b>${L.index}</b>, ${T('equals 호출', 'equals calls')} <b>${L.equalsCalls}</b>${T('번', '')} → <b>${L.found === null ? 'null' : esc(String(L.found))}</b></div>` : '';
  $('jNote').className = 'note-box';
  $('jNote').textContent = s.note ? t({ ko: s.note[0], en: s.note[1] }) : T('▶ 를 눌러 한 줄씩 실행하세요.', 'Press ▶ to run one line at a time.');
  const last = i === sim.snaps.length - 1;
  $('jPrev').disabled = i === 0; $('jReset').disabled = i === 0; $('jNext').disabled = last;
  $('jNext').textContent = last ? T('끝', 'Done') : T('다음 ▶', 'Next ▶');
}
function scn() { $('jScn').innerHTML = SCENARIOS.map(x => `<button type="button" data-id="${x.id}" aria-pressed="${x.id === cur.id}">${esc(t(x))}</button>`).join(''); }
$('jScn').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { cur = SCENARIOS.find(x => x.id === b.dataset.id); sim = simulate(cur); i = 0; scn(); render(); } });
$('jNext').addEventListener('click', () => { if (i < sim.snaps.length - 1) { i++; render(); } });
$('jPrev').addEventListener('click', () => { if (i > 0) { i--; render(); } });
$('jReset').addEventListener('click', () => { i = 0; render(); });
document.addEventListener('langchange', () => { scn(); render(); });
scn(); render(); highlight();
