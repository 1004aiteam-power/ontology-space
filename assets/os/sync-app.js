// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 동기화 페이지: 두 스레드의 count++ 를 한 명령씩 끼워 실행하고, 식사하는 철학자의 교착상태를 재생한다 (계산은 sync.js)
import { MODES, CODE, program, makeRace, stepRace, runnable, histogram, STRATS, dining } from './sync.js?v=481814b6';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

// ---- ① 경쟁 상태 ----
const MN = { none: { ko: '잠금 없음', en: 'No lock' }, mutex: { ko: '뮤텍스 (잠금)', en: 'Mutex (lock)' }, atomic: { ko: '원자적 명령', en: 'Atomic instruction' } };
const LOST = [0, 1, 0, 0, 1, 1];
let mode = 'none', iters = 1, S = makeRace(mode, iters), timer = null;
const TC = ['#2a78d6', '#d95926'];

function opText(op) {
  return { load: T('count를 레지스터로 읽기', 'read count into the register'), add: T('레지스터에 1 더하기', 'add 1 to the register'), store: T('레지스터를 count에 쓰기', 'write the register to count'),
    lock: T('잠금 얻기', 'acquire the lock'), unlock: T('잠금 풀기', 'release the lock'), xadd: T('읽고 더하고 쓰기를 한 번에 (끼어들 수 없음)', 'read, add and write in one go (cannot be interleaved)') }[op];
}
function renderRace() {
  const prog = program(mode), exp = 2 * iters;
  $('rcModes').innerHTML = MODES.map(m => `<button type="button" data-m="${m}" aria-pressed="${m === mode}">${esc(t(MN[m]))}</button>`).join('');
  $('rcItOut').textContent = iters;
  const col = (tid) => {
    const th = S.th[tid], blocked = !th.done && !runnable(S, tid);
    return `<div class="rc-th" style="--c:${TC[tid]}"><h4>${T('스레드', 'Thread')} ${tid + 1} <small>${th.done ? T('끝', 'done') : blocked ? T('잠금을 기다리며 잠듦', 'asleep, waiting for the lock') : T(`${th.it + 1}번째 반복`, `iteration ${th.it + 1}`)}</small></h4>
      <ol class="rc-code">${prog.map((op, i) => `<li class="${!th.done && i === th.pc ? (blocked ? 'blk' : 'pc') : ''}"><code>${esc(CODE[op])}</code></li>`).join('')}</ol>
      <p class="rc-reg">eax = <b>${th.reg}</b></p>
      <button type="button" data-t="${tid}" ${th.done ? 'disabled' : ''}>${T(`스레드 ${tid + 1} 한 단계 ▶`, `Step thread ${tid + 1} ▶`)}</button></div>`;
  };
  const done = S.th.every(x => x.done);
  $('rcBoard').innerHTML = `${col(0)}<div class="rc-mem"><p class="meta">${T('공유 메모리', 'Shared memory')}</p><p class="rc-count">count = <b>${S.count}</b></p>${mode === 'mutex' ? `<p class="meta">${T('잠금', 'lock')}: ${S.owner === null ? T('비어 있음', 'free') : T(`스레드 ${S.owner + 1}가 쥠`, `held by thread ${S.owner + 1}`)}</p>` : ''}
    <p class="${done ? (S.count === exp ? 'rc-ok' : 'rc-bad') : 'meta'}">${done ? (S.count === exp ? T(`기대값 ${exp}과 같음`, `Matches the expected ${exp}`) : T(`기대값은 ${exp}인데 ${S.count}: 갱신 ${exp - S.count}번을 잃어버림`, `Expected ${exp} but got ${S.count}: ${exp - S.count} update(s) lost`)) : T(`두 스레드가 ${iters}번씩 더하면 기대값 ${exp}`, `Two threads adding ${iters} time(s) each should give ${exp}`)}</p></div>${col(1)}`;
  $('rcLog').innerHTML = S.log.length ? S.log.map((e, i) => `<li style="--c:${TC[e.tid]}"><b>${i + 1}.</b> T${e.tid + 1}: ${e.blocked ? `<span class="rc-blk">${T('잠금을 기다림 (진행 못 함)', 'waits for the lock (no progress)')}</span>` : esc(opText(e.op))} <span class="meta">→ eax ${e.reg}, count ${e.count}</span></li>`).join('') : `<li class="meta">${T('아직 실행한 명령이 없습니다', 'No instruction run yet')}</li>`;
}
function renderHist() {
  const o = [];
  for (const m of MODES) {
    const h = histogram(m, iters, 1000, 1), keys = Array.from({ length: 2 * iters }, (_, i) => i + 1), max = Math.max(...Object.values(h));
    o.push(`<div class="rc-h"><h4>${esc(t(MN[m]))}</h4><div class="rc-bars">${keys.map(k => `<div class="${k === 2 * iters ? 'good' : ''}"><i style="height:${((h[k] || 0) / max * 100).toFixed(1)}%"></i><b>${h[k] || 0}</b><span>${k}</span></div>`).join('')}</div></div>`);
  }
  $('rcHist').innerHTML = o.join('');
}
function resetRace() { if (timer) { clearInterval(timer); timer = null; } S = makeRace(mode, iters); renderRace(); }
function playLost() {
  mode = 'none'; iters = 1; $('rcIt').value = 1; resetRace(); renderHist();
  let k = 0;
  timer = setInterval(() => { if (k >= LOST.length) { clearInterval(timer); timer = null; return; } stepRace(S, LOST[k++]); renderRace(); }, 650);
}

// ---- ② 식사하는 철학자 ----
const SN = { naive: { ko: '모두 왼쪽부터', en: 'Everyone takes left first' }, ordered: { ko: '번호 작은 포크부터 (순서 정하기)', en: 'Lower-numbered fork first (ordering)' }, waiter: { ko: '웨이터: 4명까지만 앉기', en: 'Waiter: at most 4 seated' } };
let strat = 'naive', seed = 1, D = null, ti = 0, dtimer = null;
const STC = { think: 'var(--os-wait)', hungry: 'var(--os-ready)', eat: '#1f9d6b' };
function runDining() { D = dining({ strat, seed, steps: 300 }); ti = 0; $('dpT').max = D.frames.length - 1; }
function renderDining() {
  $('dpStrats').innerHTML = STRATS.map(s => `<button type="button" data-s="${s}" aria-pressed="${s === strat}">${esc(t(SN[s]))}</button>`).join('');
  const f = D.frames[ti], n = f.st.length, cx = 170, cy = 150, R = 105, Rf = 62;
  const ang = (k) => -Math.PI / 2 + k * 2 * Math.PI / n;
  const pos = (k, r) => [cx + r * Math.cos(ang(k)), cy + r * Math.sin(ang(k))];
  const o = [`<svg class="dp-svg" viewBox="0 0 340 300" role="img" aria-label="${esc(T('식탁: 철학자 5명과 포크 5개', 'The table: five philosophers and five forks'))}"><defs><marker id="dpA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#d33"/></marker></defs><circle cx="${cx}" cy="${cy}" r="78" class="dp-tab"/>`];
  f.wf.forEach((j, i) => { if (j === null) return; const [x1, y1] = pos(i, R - 22), [x2, y2] = pos(j, R - 22); const inCyc = f.cycle && f.cycle.includes(i); o.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="dp-wf${inCyc ? ' cyc' : ''}" marker-end="url(#dpA)"/>`); });
  for (let k = 0; k < n; k++) {
    const h = f.fork[k];
    const [x, y] = h === null ? pos(k - 0.5, Rf) : pos(h + (k === h ? -0.28 : 0.28), R - 34);   // 포크 k 는 P(k-1) 과 P(k) 사이. 쥐면 그 사람 앞으로
    o.push(`<g class="dp-fork${h === null ? '' : ' held'}"><rect x="${(x - 4).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="8" height="22" rx="3"/><text x="${x.toFixed(1)}" y="${(y + 24).toFixed(1)}" text-anchor="middle">F${k}</text></g>`);
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = pos(i, R + 22);
    o.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="20" fill="${STC[f.st[i]]}" class="dp-p${f.cycle && f.cycle.includes(i) ? ' cyc' : ''}"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" class="dp-pl">P${i}</text>`);
  }
  o.push('</svg>');
  $('dpSvg').innerHTML = o.join('');
  const stName = { think: T('생각', 'thinking'), hungry: T('배고픔 (포크 기다림)', 'hungry (waiting for a fork)'), eat: T('먹는 중', 'eating') };
  const dl = D.deadlock;
  $('dpInfo').innerHTML = `<p class="os-now"><b>t = ${f.t}</b> / ${D.frames.length - 1}</p>
    ${f.cycle ? `<p class="os-warn rc-bad">${T(`교착상태: ${f.cycle.map(i => 'P' + i).join(' → ')} → P${f.cycle[0]} 순환. 모두가 포크 하나를 쥐고 옆 사람의 포크를 기다리므로 아무도 먹을 수 없습니다.`, `Deadlock: cycle ${f.cycle.map(i => 'P' + i).join(' → ')} → P${f.cycle[0]}. Each holds one fork and waits for the neighbour's, so nobody can ever eat.`)}</p>` : dl ? `<p class="meta">${T(`이 실행은 t = ${dl.t}에 교착상태가 됩니다.`, `This run deadlocks at t = ${dl.t}.`)}</p>` : `<p class="rc-ok">${T(`${D.frames.length - 1}단계 동안 교착상태 없음`, `No deadlock in ${D.frames.length - 1} steps`)}</p>`}
    <table class="net-tab os-regs"><thead><tr><th></th><th>${T('상태', 'State')}</th><th>${T('쥔 포크', 'Holding')}</th><th>${T('식사 횟수', 'Meals')}</th></tr></thead><tbody>${f.st.map((s, i) => `<tr><td><b>P${i}</b></td><td>${stName[s]}</td><td>${f.held[i].map(k => 'F' + k).join(', ')}</td><td>${f.meals[i]}</td></tr>`).join('')}</tbody></table>`;
  $('dpT').value = ti; $('dpTOut').textContent = `${ti} / ${D.frames.length - 1}`;
}
function dplay() {
  if (dtimer) { clearInterval(dtimer); dtimer = null; $('dpPlay').textContent = '▶'; return; }
  if (ti >= D.frames.length - 1) ti = 0;
  $('dpPlay').textContent = '⏸';
  dtimer = setInterval(() => { if (ti >= D.frames.length - 1) return dplay(); ti++; renderDining(); }, 120);
}

function render() { renderRace(); renderHist(); renderDining(); }
function init() {
  $('rcModes').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; resetRace(); });
  $('rcBoard').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (!b) return; stepRace(S, +b.dataset.t); renderRace(); });
  $('rcReset').addEventListener('click', resetRace);
  $('rcLost').addEventListener('click', playLost);
  $('rcIt').addEventListener('input', () => { iters = +$('rcIt').value; resetRace(); renderHist(); });
  $('dpStrats').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; strat = b.dataset.s; runDining(); renderDining(); });
  $('dpSeed').addEventListener('click', () => { seed = seed % 999 + 1; runDining(); renderDining(); });
  $('dpT').addEventListener('input', () => { ti = +$('dpT').value; renderDining(); });
  $('dpEnd').addEventListener('click', () => { ti = D.deadlock ? D.deadlock.t : D.frames.length - 1; renderDining(); });
  $('dpPlay').addEventListener('click', dplay);
  document.addEventListener('langchange', render);
  runDining(); render();
}
init();
