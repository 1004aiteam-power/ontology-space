// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 서버가 동시에 들어온 접속을 처리하는 방식 7가지를 같은 부하로 돌려 비교하는 모형 (1ms 단위로 시간을 진행).
// 요청 하나 = [CPU 절반 → I/O 대기(디스크 · DB · 느린 클라이언트) → CPU 절반]. 방식마다 "누가 그 요청을 맡고, 기다리는 동안 무엇을 붙들고 있나"가 다르다.
// 구조의 차이를 보이려는 학습용 모형이며 실제 벤치마크가 아니다. 브라우저 없이 node 로 테스트: tests/net.test.mjs
import { rng } from './tcp.js?v=9c2aa9b6';

export const MODELS = ['iter', 'fork', 'thread', 'pool', 'event', 'async', 'multi'];
export const SPAWN_MS = { fork: 6, thread: 1 };                                            // 프로세스 · 스레드를 만드는 데 드는 CPU 시간 (모형값)
export const UNIT_KB = { process: 8192, thread: 1024, conn: 16, task: 4 };                  // 단위당 메모리 (자릿수 감각용 모형값)
const MAX_T = 200000;

/** 부하: n개의 접속이 spread(ms) 안에 도착. 그중 slowRatio 만큼은 I/O 대기가 slowIo(ms)로 긴 "느린" 접속 */
export function makeLoad({ n = 24, spread = 200, cpu = 10, io = 50, slowRatio = 0.25, slowIo = 800, seed = 1 } = {}) {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, id) => ({ id, arrive: Math.floor(rand() * spread), cpu, io: rand() < slowRatio ? slowIo : io, slow: false }))
    .sort((a, b) => a.arrive - b.arrive || a.id - b.id)
    .map((r, id) => ({ ...r, id, slow: r.io === slowIo && slowIo !== io }));
}

/** 한 방식으로 부하를 처리. 반환: { reqs: [{ id, arrive, end, segs: [{ s, from, to }] }], stats } */
export function simulate(model, load, opt = {}) {
  const P = { cores: 4, pool: 8, limit: 40, ...opt };
  const spawn = SPAWN_MS[model] || 0;
  const loops = model === 'event' ? 1 : model === 'multi' ? Math.max(1, P.cores) : 0;
  const cap = { iter: 1, fork: P.limit, thread: P.limit, pool: P.pool }[model] ?? Infinity;
  const R = load.map(r => {
    const ph = [];
    if (spawn) ph.push({ k: 'cpu', ms: spawn });
    if (r.cpu > 0) ph.push({ k: 'cpu', ms: r.cpu / 2 });
    if (r.io > 0) ph.push({ k: 'io', ms: r.io });
    if (r.cpu > 0) ph.push({ k: 'cpu', ms: r.cpu / 2 });
    return { id: r.id, arrive: r.arrive, ph, pi: 0, rem: ph.length ? ph[0].ms : 0, admitted: false, done: false, end: null, readyAt: r.arrive, loop: loops ? r.id % loops : 0, segs: [] };
  });
  const running = Array(loops).fill(null);
  let left = R.length, peak = 0, t = 0;
  const mark = (r, s) => { const g = r.segs[r.segs.length - 1]; if (g && g.s === s && g.to === t) g.to = t + 1; else r.segs.push({ s, from: t, to: t + 1 }); };
  const finishPhase = (r) => {
    r.pi++;
    if (r.pi >= r.ph.length) { r.done = true; r.end = t + 1; left--; return; }
    r.rem = r.ph[r.pi].ms; if (r.ph[r.pi].k === 'cpu') r.readyAt = t + 1;
  };
  for (; left > 0 && t < MAX_T; t++) {
    let active = R.reduce((n, r) => n + (r.admitted && !r.done ? 1 : 0), 0);
    for (const r of R) {                                                   // 도착한 순서대로 받아들임 (상한이 있으면 대기열)
      if (r.admitted || r.done || r.arrive > t) continue;
      if (active >= cap) break;
      r.admitted = true; active++;
      if (!r.ph.length) { r.done = true; r.end = t; left--; }
    }
    peak = Math.max(peak, R.reduce((n, r) => n + (r.admitted && !r.done ? 1 : 0), 0));
    const cpuNow = R.filter(r => r.admitted && !r.done && r.ph[r.pi].k === 'cpu');
    const progressed = new Set();
    if (loops) {                                                           // 이벤트 루프: 루프 하나는 한 번에 하나만, 끝날 때까지 (끼어들 수 없음)
      for (let l = 0; l < loops; l++) {
        if (!running[l] || running[l].done || running[l].ph[running[l].pi].k !== 'cpu') running[l] = null;
        if (!running[l]) running[l] = cpuNow.filter(r => r.loop === l).sort((a, b) => a.readyAt - b.readyAt || a.id - b.id)[0] || null;
        if (running[l]) { running[l].rem -= 1; progressed.add(running[l]); }
      }
    } else {                                                               // 그 밖: 코어를 나눠 씀 (실행 가능한 것이 코어보다 많으면 시분할)
      const rate = cpuNow.length ? Math.min(1, (model === 'iter' ? 1 : P.cores) / cpuNow.length) : 0;
      for (const r of cpuNow) { r.rem -= rate; progressed.add(r); }
    }
    for (const r of R) {
      if (r.done || r.arrive > t) continue;
      if (!r.admitted) { mark(r, 'queue'); continue; }
      const k = r.ph[r.pi].k;
      if (k === 'io') { r.rem -= 1; mark(r, 'io'); }
      else mark(r, progressed.has(r) ? 'cpu' : 'ready');
      if (r.rem <= 1e-9) finishPhase(r);
    }
  }
  const done = R.filter(r => r.end !== null);
  const lat = done.map(r => r.end - r.arrive).sort((a, b) => a - b);
  const span = Math.max(...done.map(r => r.end)) - Math.min(...done.map(r => r.arrive));
  const kb = { iter: UNIT_KB.process, fork: peak * UNIT_KB.process, thread: peak * UNIT_KB.thread, pool: P.pool * UNIT_KB.thread, event: peak * UNIT_KB.conn, multi: peak * UNIT_KB.conn, async: peak * UNIT_KB.task }[model];
  return {
    model, reqs: R.map(r => ({ id: r.id, arrive: r.arrive, end: r.end, segs: r.segs })),
    stats: { avg: lat.reduce((s, x) => s + x, 0) / lat.length, p95: lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)], max: lat[lat.length - 1], throughput: done.length / (span / 1000), peak, memKB: kb, finished: done.length === R.length, end: t }
  };
}
export const compareAll = (load, opt) => MODELS.map(m => simulate(m, load, opt));
