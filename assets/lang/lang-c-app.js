// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// C 페이지: 스택과 힙 시연 (모형은 cmem.js)
import { SCENARIOS, simulate } from './cmem.js?v=49743593';
import { highlight } from './hl.js?v=5ac4dd32';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const COLORS = ['#2a78d6', '#d95926', '#1f9d6b', '#8a63d2', '#b8860b', '#0891b2'];
const col = (id) => COLORS[(id - 1) % COLORS.length];
const bid = (id) => `<span class="oid" style="background:${col(id)}">#${id}</span>`;
let cur = SCENARIOS[0], sim = simulate(cur), i = 0;

function render() {
  const s = sim.snaps[i], prog = cur.program.split('\n');
  $('cSrc').innerHTML = prog.map((l, n) => `<li class="${s.line === n ? 'on' : sim.snaps.slice(1, i + 1).some(x => x.line === n) ? 'done' : ''}">${esc(l) || ' '}</li>`).join('');
  $('cStack').innerHTML = s.vars.length ? s.vars.map(v => {
    const body = v.kind === 'ptr' ? (v.ptr === null ? '<span class="meta">NULL</span>' : `→ ${bid(v.ptr)}`) : v.kind === 'int' ? esc(String(v.val)) : `[ ${v.items.map(esc).join(', ')} ]`;
    return `<div class="var-row"><b>${esc(v.name)}</b> <span class="meta">${v.kind === 'ptr' ? 'pointer' : v.kind === 'arr' ? 'int[' + v.items.length + ']' : 'int'}</span> ${body}</div>`;
  }).join('') : `<p class="meta">${T('(아직 변수가 없습니다)', '(no variables yet)')}</p>`;
  $('cHeap').innerHTML = s.heap.length ? s.heap.map(b => {
    const st = b.freed ? `<span class="meta">${T('해제됨 (free)', 'freed')}</span>` : b.lost && i === sim.snaps.length - 1 && s.verdict?.kind === 'leak' ? `<b style="color:#d33">${T('누수!', 'LEAKED!')}</b>` : b.lost ? `<span class="meta" style="color:var(--warm)">${T('가리키는 포인터가 없음', 'no pointer points here')}</span>` : `<span class="meta">${T('사용 중', 'in use')}</span>`;
    return `<div class="obj-row"><span style="${b.freed ? 'text-decoration:line-through;opacity:.6' : ''}">${bid(b.id)} <span class="body">${b.size} bytes${b.val !== null ? ` = ${esc(String(b.val))}` : ''}</span></span> ${st}</div>`;
  }).join('') : `<p class="meta">${T('(힙이 비어 있습니다)', '(the heap is empty)')}</p>`;
  $('cOut').textContent = s.out.join('\n') || ' ';
  const last = i === sim.snaps.length - 1;
  $('cNote').className = 'note-box';
  $('cNote').textContent = s.note ? t({ ko: s.note[0], en: s.note[1] }) : T('▶ 를 눌러 한 줄씩 실행하세요.', 'Press ▶ to run one line at a time.');
  const v = s.verdict;
  $('cVerdict').hidden = !v;
  if (v) $('cVerdict').innerHTML = `⛔ ${esc(t(v))}<br><small>${T('실제 도구의 보고', 'What the real tool reports')}: <code>${esc(cur.asan || '')}</code> (AddressSanitizer)</small>`;
  else if (last && cur.id === 'ok') { $('cNote').className = 'note-box good'; }
  $('cPrev').disabled = i === 0; $('cReset').disabled = i === 0; $('cNext').disabled = last;
  $('cNext').textContent = last ? T('끝', 'Done') : T('다음 ▶', 'Next ▶');
}
function scn() { $('cScn').innerHTML = SCENARIOS.map(x => `<button type="button" data-id="${x.id}" aria-pressed="${x.id === cur.id}">${esc(t(x))}</button>`).join(''); }
function pick(id) { cur = SCENARIOS.find(x => x.id === id); sim = simulate(cur); i = 0; scn(); render(); }
$('cScn').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pick(b.dataset.id); });
$('cNext').addEventListener('click', () => { if (i < sim.snaps.length - 1) { i++; render(); } });
$('cPrev').addEventListener('click', () => { if (i > 0) { i--; render(); } });
$('cReset').addEventListener('click', () => { i = 0; render(); });
document.addEventListener('langchange', () => { scn(); render(); });
scn(); render(); highlight();
