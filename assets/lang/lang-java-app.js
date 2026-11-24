// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Java 페이지: HashMap 버킷 시연 (모형은 jmap.js)
import { SCENARIOS, simulate } from './jmap.js?v=6d705ded';
import { stepper, snapLines } from './stepper.js?v=2be80765';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';


function render({ state: sim, i }) {
  const s = sim.snaps[i];
  $('jHead').textContent = T(`버킷 표 (칸 ${s.n}개, 항목 ${s.size}개 — ${Math.round(s.size / s.n * 100)}% 찼음, 75% 를 넘으면 두 배로 늘림)`, `Bucket table (${s.n} slots, ${s.size} entries, ${Math.round(s.size / s.n * 100)}% full; doubles past 75%)`);
  const hit = s.look ? s.look.index : -1;
  $('jBuckets').innerHTML = s.buckets.map((b, n) => `<div class="jb ${n === hit ? 'hit' : ''} ${b.length > 1 ? 'chain' : ''}"><small>${n}</small>${b.map(e => `<span class="jn ${s.look && s.look.checked.some(c => c.id === e.id) ? 'chk' : ''}" title="hash ${e.hash}">${esc(e.id)}</span>`).join('') || '<span class="jn empty">·</span>'}</div>`).join('');
  const L = s.look;
  $('jLook').innerHTML = L ? `<div class="note-box ${L.found === null ? 'bad' : 'good'}"><b>get</b> → ${T('버킷', 'bucket')} <b>${L.index}</b>, ${T('equals 호출', 'equals calls')} <b>${L.equalsCalls}</b>${T('번', '')} → <b>${L.found === null ? 'null' : esc(String(L.found))}</b></div>` : '';
  $('jNote').className = 'note-box';
  $('jNote').textContent = s.note ? t({ ko: s.note[0], en: s.note[1] }) : T('▶ 를 눌러 한 줄씩 실행하세요.', 'Press ▶ to run one line at a time.');
}

stepper({ prefix: 'j', scenarios: SCENARIOS, prepare: simulate, steps: (sim) => sim.snaps.length - 1, lines: snapLines, render });
