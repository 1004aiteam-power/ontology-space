// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// C++ 페이지: 실제 g++ 실행 기록(cppruns.js)을 한 줄씩 재생하며, 그 출력을 낸 소스 줄을 강조한다
import { RUNS } from './cppruns.js?v=b5a36134';
import { stepper } from './stepper.js?v=2be80765';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';


// 단계 k = 지금까지 보여 준 출력 줄 수. 강조 줄 = 마지막 출력을 낸 소스 줄
const runLines = (run, k) => ({ on: k > 0 ? run.events[k - 1].line : -1, done: new Set(run.events.slice(0, k).map(e => e.line)) });

function render({ cur, i: k }) {
  const shown = cur.events.slice(0, k);
  $('xOut').innerHTML = shown.map((e, n) => `<span style="${n === k - 1 ? 'color:#7ee787;font-weight:700' : ''}">${esc(e.text)}</span>`).join('\n') || ' ';
  const note = k > 0 ? cur.notes[k - 1] : null;
  $('xNote').className = 'note-box' + (k === cur.events.length ? ' good' : '');
  $('xNote').innerHTML = note && note[0] ? t({ ko: note[0], en: note[1] }) : k === 0 ? T('▶ 를 눌러 출력을 한 줄씩 보세요.', 'Press ▶ to see the output one line at a time.') : '&nbsp;';
}

stepper({ prefix: 'x', scenarios: RUNS, prepare: (run) => run, steps: (run) => run.events.length, lines: runLines, render });
