// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 동기화 모형: ① 두 스레드가 같은 변수에 count++ 를 할 때의 경쟁 상태 (잠금 없음 · 뮤텍스 · 원자적 명령)
//              ② 식사하는 철학자: 교착상태가 생기는 방식과 막는 방식, 대기 그래프의 순환 찾기
// 테스트: tests/os.test.mjs
import { mulberry32 } from '../lib/rng.js?v=73d9551d';

// ---- ① 경쟁 상태 ----
export const MODES = ['none', 'mutex', 'atomic'];
const PROG = {
  none: ['load', 'add', 'store'],
  mutex: ['lock', 'load', 'add', 'store', 'unlock'],
  atomic: ['xadd']
};
export const CODE = {
  load: 'mov  eax, [count]', add: 'add  eax, 1', store: 'mov  [count], eax',
  lock: 'call lock(&m)', unlock: 'call unlock(&m)', xadd: 'lock xadd [count], 1'
};
export const program = (mode) => PROG[mode];

/** 두 스레드(0, 1)가 각자 iters 번 count++ 하는 상태 */
export function makeRace(mode, iters = 1) {
  return { mode, iters, count: 0, owner: null, th: [0, 1].map(() => ({ pc: 0, it: 0, reg: 0, done: false })), log: [] };
}
/** 스레드 tid 가 지금 진행할 수 있나 (끝났거나, 남이 쥔 잠금을 기다리면 못 함) */
export const runnable = (S, tid) => {
  const th = S.th[tid];
  if (th.done) return false;
  return !(PROG[S.mode][th.pc] === 'lock' && S.owner !== null && S.owner !== tid);
};
/** 스레드 tid 의 명령 하나를 실행 (상태를 바꿈). 반환: 기록 한 줄 { tid, op, ok, count, reg, blocked } */
export function stepRace(S, tid) {
  const th = S.th[tid], prog = PROG[S.mode];
  if (th.done) return null;
  const op = prog[th.pc];
  if (!runnable(S, tid)) { const e = { tid, op, blocked: true, count: S.count, reg: th.reg }; S.log.push(e); return e; }
  if (op === 'load') th.reg = S.count;
  else if (op === 'add') th.reg += 1;
  else if (op === 'store') S.count = th.reg;
  else if (op === 'lock') S.owner = tid;
  else if (op === 'unlock') S.owner = null;
  else if (op === 'xadd') { th.reg = S.count; S.count += 1; }
  th.pc++;
  if (th.pc >= prog.length) { th.pc = 0; th.it++; if (th.it >= S.iters) th.done = true; }
  const e = { tid, op, count: S.count, reg: th.reg }; S.log.push(e); return e;
}
/** 정해진 순서(스레드 번호 목록)대로 실행. 막힌 스레드 차례는 기다림으로 기록 */
export function runSchedule(mode, iters, order) {
  const S = makeRace(mode, iters);
  for (const tid of order) stepRace(S, tid);
  return S;
}
/** 무작위 끼어들기로 끝까지 실행 → 최종 count */
export function runRandom(mode, iters, rand) {
  const S = makeRace(mode, iters);
  for (let k = 0; k < 10000; k++) {
    const can = [0, 1].filter(t => runnable(S, t));
    if (!can.length) break;
    stepRace(S, can[Math.floor(rand() * can.length)]);
  }
  return S.count;
}
/** runs 번 돌려 최종 count 분포 */
export function histogram(mode, iters, runs = 1000, seed = 1) {
  const rand = mulberry32(seed), h = {};
  for (let i = 0; i < runs; i++) { const c = runRandom(mode, iters, rand); h[c] = (h[c] || 0) + 1; }
  return h;
}

// ---- ② 식사하는 철학자 ----
// 철학자 i 의 왼쪽 포크 = i, 오른쪽 포크 = (i + 1) % n
export const STRATS = ['naive', 'ordered', 'waiter'];
export function dining({ n = 5, strat = 'naive', steps = 400, seed = 1, eatFor = 3, hungerP = 0.5 } = {}) {
  const rand = mulberry32(seed);
  const fork = Array(n).fill(null);
  const P = Array.from({ length: n }, (_, i) => {
    const L = i, R = (i + 1) % n;
    const order = strat === 'ordered' ? [Math.min(L, R), Math.max(L, R)] : [L, R];
    return { st: 'think', order, held: [], eat: 0, meals: 0, waits: 0 };
  });
  const frames = [];
  let deadlock = null;
  const seated = () => P.filter(p => p.st !== 'think').length;
  const want = (p) => (p.st === 'hungry' ? p.order[p.held.length] : null);
  // 대기 그래프: i 가 기다리는 포크를 쥔 철학자 j 로 화살표. 순환이 있으면 교착상태
  const waitFor = () => P.map((p, i) => { const f = want(p); return f !== null && fork[f] !== null && fork[f] !== i ? fork[f] : null; });
  const cycle = () => {
    const wf = waitFor();
    for (let s = 0; s < n; s++) {
      const seen = new Set(); let v = s;
      while (v !== null && !seen.has(v)) { seen.add(v); v = wf[v]; }
      if (v !== null) { const cyc = [v]; let u = wf[v]; while (u !== v) { cyc.push(u); u = wf[u]; } return cyc; }
    }
    return null;
  };
  const can = (i) => {
    const p = P[i];
    if (p.st === 'think') return !(strat === 'waiter' && seated() >= n - 1);    // 웨이터: 동시에 n-1 명까지만 식탁에
    if (p.st === 'eat') return true;
    return fork[want(p)] === null;
  };
  for (let t = 0; t < steps; t++) {
    const ready = P.map((_, i) => i).filter(can);
    const cyc = cycle();
    if (cyc && !deadlock) deadlock = { t, cycle: cyc };
    frames.push({ t, st: P.map(p => p.st), held: P.map(p => [...p.held]), fork: [...fork], wf: waitFor(), cycle: cyc, meals: P.map(p => p.meals) });
    if (!ready.length) break;
    const i = ready[Math.floor(rand() * ready.length)], p = P[i];
    if (p.st === 'think') { if (rand() < hungerP) p.st = 'hungry'; }
    else if (p.st === 'hungry') { const f = want(p); fork[f] = i; p.held.push(f); if (p.held.length === 2) { p.st = 'eat'; p.eat = eatFor; } }
    else if (p.st === 'eat') { if (--p.eat <= 0) { for (const f of p.held) fork[f] = null; p.held = []; p.st = 'think'; p.meals++; } }
    for (let j = 0; j < n; j++) if (P[j].st === 'hungry' && !can(j)) P[j].waits++;
  }
  return { frames, deadlock, meals: P.map(p => p.meals), waits: P.map(p => p.waits) };
}
