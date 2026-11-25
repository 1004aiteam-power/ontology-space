// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 운영체제란 페이지: 시스템 호출 · 인터럽트 · 예외 시나리오를 사용자 공간 / 커널 / 하드웨어 그림 위에서 한 단계씩 재생 (시나리오는 syscall.js)
import { BOXES, SCENARIOS } from './syscall.js?v=7c3707f3';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const ROWS = [['user', ['app', 'lib']], ['kernel', ['entry', 'fs', 'sched', 'drv', 'sig']], ['hw', ['cpu', 'timer', 'kbd', 'disk']]];
const RN = { user: { ko: '사용자 공간 (ring 3)', en: 'User space (ring 3)' }, kernel: { ko: '커널 공간 (ring 0)', en: 'Kernel space (ring 0)' }, hw: { ko: '하드웨어', en: 'Hardware' } };
const GATE = { syscall: { ko: 'syscall: 사용자 → 커널', en: 'syscall: user → kernel' }, sysret: { ko: 'sysret: 커널 → 사용자', en: 'sysret: kernel → user' }, irq: { ko: '인터럽트', en: 'interrupt' }, iret: { ko: '인터럽트에서 돌아감', en: 'return from interrupt' }, fault: { ko: '예외 (CPU가 거부)', en: 'exception (CPU refuses)' } };
const PS = { run: { ko: '실행', en: 'running' }, wait: { ko: '대기 (잠듦)', en: 'waiting (asleep)' }, ready: { ko: '준비', en: 'ready' }, done: { ko: '종료됨', en: 'terminated' } };
let sc = SCENARIOS[0], i = 0, timer = null;

function state(upto) {                                        // 지금 단계까지의 레지스터 · 프로세스 상태 누적
  const regs = {}; let ps = 'run';
  for (let k = 0; k <= upto; k++) { Object.assign(regs, sc.steps[k].regs || {}); if (sc.steps[k].ps) ps = sc.steps[k].ps; }
  return { regs, ps };
}
function render() {
  const st = sc.steps[i], prev = sc.steps[i - 1], { regs, ps } = state(i);
  $('smScen').innerHTML = SCENARIOS.map(x => `<button type="button" data-id="${x.id}" aria-pressed="${x === sc}">${esc(t(x))}</button>`).join('');
  $('smCode').textContent = sc.code;
  $('smLayers').innerHTML = ROWS.map(([space, ids]) => `<div class="sm-row sm-${space}"><div class="sm-rl">${esc(t(RN[space]))}</div><div class="sm-boxes">${ids.map(id => `<div class="sm-box${st.at === id ? ' on' : ''}${prev && prev.at === id && st.at !== id ? ' was' : ''}">${esc(t(BOXES[id]))}</div>`).join('')}</div></div>`).join('') +
    `<p class="sm-mode">${T('CPU 모드', 'CPU mode')}: <b class="sm-m-${st.mode}">${st.mode === 'user' ? T('사용자 모드', 'user mode') : T('커널 모드', 'kernel mode')}</b>${st.gate ? ` · <span class="sm-gate">⇅ ${esc(t(GATE[st.gate]))}</span>` : ''}${st.bg ? ` · <span class="meta">${T('(프로그램과 따로 진행)', '(runs apart from the program)')}</span>` : ''}</p>`;
  $('smCap').innerHTML = `<b>${i + 1} / ${sc.steps.length}</b> · ${t(st)}`;
  $('smRegs').innerHTML = `<dl class="vm-dl">${['rax', 'rdi', 'rsi', 'rdx'].map(r => `<dt>${r}</dt><dd>${regs[r] ?? '—'}</dd>`).join('')}<dt>${T('프로세스', 'Process')}</dt><dd>${esc(t(PS[ps]))}</dd></dl>`;
  $('smList').innerHTML = sc.steps.map((x, k) => `<li class="${k === i ? 'cur' : k < i ? 'past' : ''}" data-k="${k}"><span class="sm-m-${x.mode}">${x.mode === 'user' ? 'U' : 'K'}</span> ${esc(t(BOXES[x.at]))}${x.gate ? ` <small>⇅ ${x.gate}</small>` : ''}</li>`).join('');
  $('smPrev').disabled = i === 0; $('smNext').disabled = i === sc.steps.length - 1;
}
function go(k) { i = Math.max(0, Math.min(sc.steps.length - 1, k)); render(); }
function play() {
  if (timer) { clearInterval(timer); timer = null; $('smPlay').textContent = '▶'; return; }
  if (i >= sc.steps.length - 1) i = 0;
  $('smPlay').textContent = '⏸'; render();
  timer = setInterval(() => { if (i >= sc.steps.length - 1) return play(); go(i + 1); }, 2200);
}
function init() {
  $('smScen').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; sc = SCENARIOS.find(x => x.id === b.dataset.id); i = 0; render(); });
  $('smPrev').addEventListener('click', () => go(i - 1));
  $('smNext').addEventListener('click', () => go(i + 1));
  $('smFirst').addEventListener('click', () => go(0));
  $('smPlay').addEventListener('click', play);
  $('smList').addEventListener('click', e => { const li = e.target.closest('li[data-k]'); if (li) go(+li.dataset.k); });
  document.addEventListener('langchange', render);
  render();
}
init();
