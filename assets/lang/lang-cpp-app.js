// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// C++ 페이지: 실제 g++ 실행 기록(cppruns.js)을 한 줄씩 재생하며, 그 출력을 낸 소스 줄을 강조한다
import { RUNS } from './cppruns.js?v=b5a36134';
import { highlight } from './hl.js?v=5ac4dd32';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

let cur = RUNS[0], k = 0;     // k = 지금까지 보여 준 출력 줄 수

function render() {
  const shown = cur.events.slice(0, k), last = k > 0 ? cur.events[k - 1] : null;
  const done = new Set(shown.map(e => e.line));
  $('xSrc').innerHTML = cur.program.split('\n').map((l, n) => `<li class="${last && last.line === n ? 'on' : done.has(n) ? 'done' : ''}">${esc(l) || ' '}</li>`).join('');
  $('xOut').innerHTML = shown.map((e, n) => `<span style="${n === k - 1 ? 'color:#7ee787;font-weight:700' : ''}">${esc(e.text)}</span>`).join('\n') || ' ';
  const note = k > 0 ? cur.notes[k - 1] : null;
  $('xNote').className = 'note-box' + (k === cur.events.length ? ' good' : '');
  $('xNote').innerHTML = note && note[0] ? t({ ko: note[0], en: note[1] }) : k === 0 ? T('▶ 를 눌러 출력을 한 줄씩 보세요.', 'Press ▶ to see the output one line at a time.') : '&nbsp;';
  $('xPrev').disabled = k === 0; $('xReset').disabled = k === 0; $('xNext').disabled = k === cur.events.length;
  $('xNext').textContent = k === cur.events.length ? T('끝', 'Done') : T('다음 ▶', 'Next ▶');
}
function scn() { $('xScn').innerHTML = RUNS.map(x => `<button type="button" data-id="${x.id}" aria-pressed="${x.id === cur.id}">${esc(t(x))}</button>`).join(''); }
$('xScn').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { cur = RUNS.find(x => x.id === b.dataset.id); k = 0; scn(); render(); } });
$('xNext').addEventListener('click', () => { if (k < cur.events.length) { k++; render(); } });
$('xPrev').addEventListener('click', () => { if (k > 0) { k--; render(); } });
$('xReset').addEventListener('click', () => { k = 0; render(); });
document.addEventListener('langchange', () => { scn(); render(); });
scn(); render(); highlight();
