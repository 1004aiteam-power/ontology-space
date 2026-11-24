// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 언어 페이지 시연의 공통 틀: 시나리오 버튼 · 코드 줄 강조 · ⏮ ◀ 다음 ▶ · 언어 전환.
// 페이지는 오른쪽 상태 화면을 그리는 render 만 준다. 요소 id 는 접두어 + Scn · Src · Reset · Prev · Next (예: pyScn).
//
//   stepper({ prefix: 'py', scenarios: SCENARIOS, prepare: simulate, steps: (sim) => sim.snaps.length - 1,
//             lines: snapLines, render: ({ cur, state, i, last }) => { … } });
import { highlight } from './hl.js?v=5ac4dd32';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

// simulate() 결과(snaps 배열)에서 i 단계의 강조 줄과 이미 지난 줄
export const snapLines = (sim, i) => ({ on: sim.snaps[i].line, done: new Set(sim.snaps.slice(1, i + 1).map(s => s.line)) });

export function stepper({ prefix, scenarios, prepare, steps, lines, render, label = (x) => esc(t(x)) }) {
  const el = (name) => $(prefix + name);
  let cur = scenarios[0], state = prepare(cur), i = 0;

  function draw() {
    const { on, done } = lines(state, i), last = i === steps(state);
    el('Src').innerHTML = cur.program.split('\n').map((l, n) => `<li class="${on === n ? 'on' : done.has(n) ? 'done' : ''}">${esc(l) || ' '}</li>`).join('');
    render({ cur, state, i, last });
    el('Prev').disabled = i === 0; el('Reset').disabled = i === 0; el('Next').disabled = last;
    el('Next').textContent = last ? T('끝', 'Done') : T('다음 ▶', 'Next ▶');
  }
  function buttons() { el('Scn').innerHTML = scenarios.map(x => `<button type="button" data-id="${x.id}" aria-pressed="${x.id === cur.id}">${label(x)}</button>`).join(''); }

  el('Scn').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    cur = scenarios.find(x => x.id === b.dataset.id); state = prepare(cur); i = 0; buttons(); draw();
  });
  el('Next').addEventListener('click', () => { if (i < steps(state)) { i++; draw(); } });
  el('Prev').addEventListener('click', () => { if (i > 0) { i--; draw(); } });
  el('Reset').addEventListener('click', () => { i = 0; draw(); });
  document.addEventListener('langchange', () => { buttons(); draw(); });
  buttons(); draw(); highlight();
}
