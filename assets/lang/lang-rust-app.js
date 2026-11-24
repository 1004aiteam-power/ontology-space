// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Rust 페이지: 소유권 · 빌림 시연 (모형은 rown.js)
import { SCENARIOS, simulate } from './rown.js?v=e2c40e24';
import { stepper, snapLines } from './stepper.js?v=2be80765';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const COLORS = ['#2a78d6', '#d95926', '#1f9d6b', '#8a63d2', '#b8860b', '#0891b2'];
const col = (id) => COLORS[(id - 1) % COLORS.length];
const bid = (id) => `<span class="oid" style="background:${col(id)}">#${id}</span>`;

function varBody(v) {
  if (v.kind === 'int') return esc(String(v.val));
  if (v.kind === 'ref') return v.to === null ? `<span class="meta">${T('(아직 값 없음)', '(not set yet)')}</span>` : `→ <b>${esc(v.to)}</b> <span class="meta">${v.mode === 'mut' ? T('쓰기 빌림', 'mutable borrow') : T('읽기 빌림', 'shared borrow')}</span>`;
  return v.moved ? `<span class="meta" style="text-decoration:line-through">${bid(v.block)}</span> <b style="color:var(--warm)">${T('이동됨 · 사용 불가', 'moved · unusable')}</b>` : `${T('주인', 'owns')} ${bid(v.block)}`;
}
const TYPE = { string: 'String', vec: 'Vec<i32>', int: 'i32', ref: '&' };

function render({ state: sim, i, last }) {
  const s = sim.snaps[i];
  $('rStack').innerHTML = s.vars.length ? s.vars.map(v => `<div class="var-row"><b>${esc(v.name)}</b> <span class="meta">${esc(TYPE[v.kind])}</span> ${varBody(v)}</div>`).join('')
    : `<p class="meta">${T('(아직 변수가 없습니다)', '(no variables yet)')}</p>`;
  $('rHeap').innerHTML = s.heap.length ? s.heap.map(b => `<div class="obj-row"><span style="${b.freed ? 'text-decoration:line-through;opacity:.6' : ''}">${bid(b.id)} <span class="body">${esc(b.val)}</span></span> <span class="meta">${b.freed ? T('drop 되어 해제됨', 'dropped, freed') : T('주인', 'owner') + ': ' + esc(b.owner)}</span></div>`).join('')
    : `<p class="meta">${T('(힙이 비어 있습니다)', '(the heap is empty)')}</p>`;
  $('rOut').textContent = s.out.join('\n') || ' ';
  $('rNote').className = 'note-box';
  $('rNote').textContent = s.note ? t({ ko: s.note[0], en: s.note[1] }) : T('▶ 를 눌러 한 줄씩 따라가세요.', 'Press ▶ to step through line by line.');
  const v = s.verdict;
  $('rVerdict').hidden = !v;
  if (v) $('rVerdict').innerHTML = `⛔ ${esc(t(v))}<br><small>${T('실제 rustc 도 같은 오류 코드로 컴파일을 거부합니다. 프로그램은 만들어지지도 않습니다.', 'Real rustc rejects it with the same error code: no program is even produced.')}</small>`;
  else if (last) $('rNote').className = 'note-box good';
}

stepper({ prefix: 'r', scenarios: SCENARIOS, prepare: simulate, steps: (sim) => sim.snaps.length - 1, lines: snapLines, render,
  label: (x) => `${esc(t(x))}${x.error ? ' ⛔' : ' ✓'}` });
