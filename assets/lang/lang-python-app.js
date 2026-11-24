// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Python 페이지: 참조 시연 (모형은 pyref.js). 같은 색의 #번호는 같은 객체
import { SCENARIOS, simulate, reprIn } from './pyref.js?v=fe0f9856';
import { stepper, snapLines } from './stepper.js?v=2be80765';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const COLORS = ['#2a78d6', '#d95926', '#1f9d6b', '#8a63d2', '#b8860b', '#d33', '#0891b2', '#7c8794'];
const col = (id) => COLORS[(id - 1) % COLORS.length];
const oid = (id) => `<span class="oid" style="background:${col(id)}">#${id}</span>`;

function render({ state: sim, i, last }) {
  const s = sim.snaps[i];
  const names = Object.keys(s.vars);
  $('pyVars').innerHTML = names.length ? names.map(n => `<div class="var-row"><b>${esc(n)}</b> → ${oid(s.vars[n])}</div>`).join('') : `<p class="meta">${T('(아직 변수가 없습니다)', '(no variables yet)')}</p>`;
  $('pyObjs').innerHTML = Object.keys(s.objs).length ? Object.keys(s.objs).map(Number).map(id => {
    const o = s.objs[id];
    const body = o.items.map(it => (it.ref ? `<span class="oid" style="background:${col(it.ref)}">#${it.ref}</span>` : esc(String(it.v)))).join(', ');
    const holders = names.filter(n => s.vars[n] === id);
    return `<div class="obj-row">${oid(id)} <span class="body">[ ${body} ]</span>${holders.length ? `<small class="meta">← ${holders.map(esc).join(', ')}</small>` : `<small class="meta">${T('이름 없음 (안쪽 객체)', 'unnamed (inner object)')}</small>`}</div>`;
  }).join('') : `<p class="meta">${T('(아직 객체가 없습니다)', '(no objects yet)')}</p>`;
  $('pyOut').textContent = s.out.join('\n') || ' ';
  $('pyNote').className = 'note-box' + (last ? ' good' : '');
  $('pyNote').textContent = s.note ? t({ ko: s.note[0], en: s.note[1] }) : T('▶ 를 눌러 한 줄씩 실행하세요.', 'Press ▶ to run one line at a time.');
}

void reprIn;
stepper({ prefix: 'py', scenarios: SCENARIOS, prepare: simulate, steps: (sim) => sim.snaps.length - 1, lines: snapLines, render });
