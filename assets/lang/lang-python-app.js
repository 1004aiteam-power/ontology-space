// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Python 페이지: 참조 시연 (모형은 pyref.js). 같은 색의 #번호는 같은 객체
import { SCENARIOS, simulate, reprIn } from './pyref.js?v=fe0f9856';
import { highlight } from './hl.js?v=5ac4dd32';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const COLORS = ['#2a78d6', '#d95926', '#1f9d6b', '#8a63d2', '#b8860b', '#d33', '#0891b2', '#7c8794'];
const col = (id) => COLORS[(id - 1) % COLORS.length];
const oid = (id) => `<span class="oid" style="background:${col(id)}">#${id}</span>`;
let cur = SCENARIOS[0], sim = simulate(cur), i = 0;

function render() {
  const s = sim.snaps[i], prog = cur.program.split('\n');
  $('pySrc').innerHTML = prog.map((l, n) => `<li class="${s.line === n ? 'on' : sim.snaps.slice(1, i + 1).some(x => x.line === n) ? 'done' : ''}">${esc(l) || ' '}</li>`).join('');
  const names = Object.keys(s.vars);
  $('pyVars').innerHTML = names.length ? names.map(n => `<div class="var-row"><b>${esc(n)}</b> → ${oid(s.vars[n])}</div>`).join('') : `<p class="meta">${T('(아직 변수가 없습니다)', '(no variables yet)')}</p>`;
  $('pyObjs').innerHTML = Object.keys(s.objs).length ? Object.keys(s.objs).map(Number).map(id => {
    const o = s.objs[id];
    const body = o.items.map(it => (it.ref ? `<span class="oid" style="background:${col(it.ref)}">#${it.ref}</span>` : esc(String(it.v)))).join(', ');
    const holders = names.filter(n => s.vars[n] === id);
    return `<div class="obj-row">${oid(id)} <span class="body">[ ${body} ]</span>${holders.length ? `<small class="meta">← ${holders.map(esc).join(', ')}</small>` : `<small class="meta">${T('이름 없음 (안쪽 객체)', 'unnamed (inner object)')}</small>`}</div>`;
  }).join('') : `<p class="meta">${T('(아직 객체가 없습니다)', '(no objects yet)')}</p>`;
  $('pyOut').textContent = s.out.join('\n') || ' ';
  $('pyNote').className = 'note-box' + (i === sim.snaps.length - 1 ? ' good' : '');
  $('pyNote').textContent = s.note ? t({ ko: s.note[0], en: s.note[1] }) : T('▶ 를 눌러 한 줄씩 실행하세요.', 'Press ▶ to run one line at a time.');
  $('pyPrev').disabled = i === 0; $('pyReset').disabled = i === 0;
  $('pyNext').disabled = i === sim.snaps.length - 1;
  $('pyNext').textContent = i === sim.snaps.length - 1 ? T('끝', 'Done') : T('다음 ▶', 'Next ▶');
}
function pick(id) { cur = SCENARIOS.find(x => x.id === id); sim = simulate(cur); i = 0; scn(); render(); }
function scn() { $('pyScn').innerHTML = SCENARIOS.map(x => `<button type="button" data-id="${x.id}" aria-pressed="${x.id === cur.id}">${esc(t(x))}</button>`).join(''); }
$('pyScn').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pick(b.dataset.id); });
$('pyNext').addEventListener('click', () => { if (i < sim.snaps.length - 1) { i++; render(); } });
$('pyPrev').addEventListener('click', () => { if (i > 0) { i--; render(); } });
$('pyReset').addEventListener('click', () => { i = 0; render(); });
document.addEventListener('langchange', () => { scn(); render(); });
void reprIn;
scn(); render();
highlight();
