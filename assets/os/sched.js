// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// CPU 스케줄링 모형: 코어 하나를 여러 프로세스가 나눠 쓰는 일곱 가지 방식을 같은 작업 묶음으로 돌려 비교한다 (1 단위 시간씩 진행).
// 프로세스 하나 = [CPU 버스트 → I/O 대기 → CPU 버스트 → … ] (cpu 를 n 번, 사이사이 io 만큼 기다림).
// 문맥 전환: CPU 가 다른 프로세스로 바뀔 때마다 cs 만큼 아무도 일하지 못하는 시간이 든다.
// 학습용 모형이며 실제 커널의 측정값이 아니다. 브라우저 없이 node 로 테스트: tests/os.test.mjs
import { mulberry32 as rng } from '../lib/rng.js?v=73d9551d';

export const ALGOS = ['fcfs', 'sjf', 'srtf', 'rr', 'prio', 'mlfq', 'cfs'];
export const STATES = ['new', 'ready', 'run', 'wait', 'done'];
const MAX_T = 20000;

// 리눅스 nice → 가중치 (kernel/sched/core.c 의 sched_prio_to_weight 표, nice -20 ~ 19)
const WEIGHTS = [88761, 71755, 56483, 46273, 36291, 29154, 23254, 18705, 14949, 11916, 9548, 7620, 6100, 4904, 3906, 3121, 2501, 1991, 1586, 1277,
  1024, 820, 655, 526, 423, 335, 272, 215, 172, 137, 110, 87, 70, 56, 45, 36, 29, 23, 18, 15];
export const weight = (nice) => WEIGHTS[Math.max(-20, Math.min(19, Math.round(nice))) + 20];

/** 작업 묶음 하나를 만든다: 무작위 seed 로 대화형(짧은 CPU · 잦은 I/O)과 일괄(긴 CPU) 프로세스를 섞음 */
export function randomJobs(seed = 1, n = 5) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const inter = r() < 0.5;
    out.push(inter
      ? { name: 'P' + (i + 1), arrive: Math.floor(r() * 20), cpu: 1 + Math.floor(r() * 3), n: 3 + Math.floor(r() * 4), io: 4 + Math.floor(r() * 8), nice: 0 }
      : { name: 'P' + (i + 1), arrive: Math.floor(r() * 20), cpu: 10 + Math.floor(r() * 25), n: 1 + Math.floor(r() * 2), io: 3 + Math.floor(r() * 5), nice: 0 });
  }
  return out.sort((a, b) => a.arrive - b.arrive).map((j, i) => ({ ...j, name: 'P' + (i + 1) }));
}

/**
 * 한 방식으로 작업 묶음을 돌린다.
 * jobs: [{ name, arrive, cpu, n, io, nice }]  opt: { q: 시간 할당량, cs: 문맥 전환 비용, boost: MLFQ 끌어올림 주기, latency: CFS 목표 지연 }
 * 반환: { algo, cpu: [{ s: 'run'|'cs'|'idle', p, from, to }], procs: [{ name, segs, arrive, end, first, wait, resp }], snaps, stats }
 */
export function simulate(algo, jobs, opt = {}) {
  const O = { q: 4, cs: 0, boost: 60, latency: 12, minGran: 2, ...opt };
  const MLQ = [O.q, O.q * 2, Infinity];                                     // MLFQ 단계별 할당량 (맨 아래는 끝까지)
  const P = jobs.map((j, id) => ({
    id, name: j.name, arrive: j.arrive, nice: j.nice || 0, w: weight(j.nice || 0),
    bursts: Array.from({ length: Math.max(1, j.n || 1) }, () => Math.max(1, j.cpu)), io: Math.max(0, j.io || 0),
    bi: 0, rem: Math.max(1, j.cpu), state: 'new', readyAt: 0, readySince: 0, wakeAt: 0, end: null, first: null,
    wait: 0, resp: [], level: 0, used: 0, vr: 0, seq: 0, segs: []
  }));
  const ready = [];                                                         // 준비 상태 프로세스 (각 방식이 여기서 고름)
  let cur = null, last = null, slice = 0, csLeft = 0, csFor = null, t = 0, seq = 0, switches = 0, lastBoost = 0;
  const cpu = [], snaps = [];
  const minVr = () => Math.min(...[...ready, ...(cur ? [cur] : [])].map(p => p.vr), Infinity);
  const mark = (arr, s, p) => { const g = arr[arr.length - 1]; if (g && g.s === s && g.p === p && g.to === t) g.to = t + 1; else arr.push({ s, p, from: t, to: t + 1 }); };
  const enqueue = (p, fresh) => {                                           // 준비 줄에 넣기 (도착 · I/O 끝 · 선점)
    p.state = 'ready'; p.readySince = t; p.seq = ++seq;
    if (fresh) { p.readyAt = t; p.used = 0; }                               // MLFQ: 할당량을 다 쓰기 전에 I/O 로 비켜 준 프로세스는 단계를 유지
    if (algo === 'cfs' && fresh) {
      const m = minVr();
      if (isFinite(m)) p.vr = p.started ? Math.max(p.vr, m - O.latency / 2) : Math.max(p.vr, m);   // 새로 온 · 깨어난 프로세스가 너무 앞서지 않게
    }
    ready.push(p);
  };
  // 다음에 실행할 프로세스 고르기 (준비 줄에서 빼서 돌려줌)
  const pick = () => {
    if (!ready.length) return null;
    let best;
    const by = (f) => ready.reduce((a, b) => (f(b, a) < 0 ? b : a));
    if (algo === 'fcfs' || algo === 'rr') best = by((a, b) => a.seq - b.seq);
    else if (algo === 'sjf' || algo === 'srtf') best = by((a, b) => a.rem - b.rem || a.seq - b.seq);
    else if (algo === 'prio') best = by((a, b) => a.nice - b.nice || a.seq - b.seq);
    else if (algo === 'mlfq') best = by((a, b) => a.level - b.level || a.seq - b.seq);
    else best = by((a, b) => a.vr - b.vr || a.seq - b.seq);
    ready.splice(ready.indexOf(best), 1);
    return best;
  };
  // 지금 돌고 있는 프로세스를 내려야 하나 (선점)
  const preempt = () => {
    if (!cur || !ready.length) return false;
    if (algo === 'srtf') return ready.some(p => p.rem < cur.rem);
    if (algo === 'prio') return ready.some(p => p.nice < cur.nice);
    if (algo === 'mlfq') return ready.some(p => p.level < cur.level);
    if (algo === 'cfs') return ready.some(p => p.vr + 1 < cur.vr && p.readySince === t);   // 깨어난 프로세스가 확실히 뒤처졌으면 바로 자리를 내줌
    return false;
  };
  const sliceOf = (p) => {
    if (algo === 'rr') return O.q;
    if (algo === 'mlfq') return MLQ[p.level] - p.used;                     // 선점당했다 돌아와도 이 단계에서 쓴 만큼은 빼고 (할당량을 나눠 쓰기)
    if (algo === 'cfs') { const sw = [...ready, p].reduce((s, x) => s + x.w, 0); return Math.max(O.minGran, Math.round(O.latency * p.w / sw)); }
    return Infinity;
  };
  const dispatch = (p) => {
    cur = p; slice = sliceOf(p);
    if (p !== last && last !== null && O.cs > 0) { csLeft = O.cs; csFor = p; }
    if (p !== last && last !== null) switches++;
    last = p; p.state = 'run';
  };
  let left = P.length;
  for (; left > 0 && t < MAX_T; t++) {
    // 1) 도착 · I/O 끝남 → 준비 줄로
    for (const p of P) {
      if (p.state === 'new' && p.arrive <= t) enqueue(p, true);
      else if (p.state === 'wait' && p.wakeAt <= t) enqueue(p, true);
    }
    // MLFQ: 일정 시간마다 모두 맨 위 단계로 (오래 밀린 프로세스가 굶지 않게)
    if (algo === 'mlfq' && O.boost > 0 && t - lastBoost >= O.boost) { lastBoost = t; for (const p of P) if (p.state === 'ready' || p.state === 'run') { p.level = 0; p.used = 0; } if (cur) slice = MLQ[0]; }
    // 2) 선점 · 고르기 (문맥 전환 중에는 바꾸지 않음)
    if (!csLeft) {
      if (cur && preempt()) { const p = cur; cur = null; enqueue(p, false); }
      if (!cur) { const p = pick(); if (p) dispatch(p); }
    }
    // 3) 이번 단위 시간에 CPU 가 한 일
    if (csLeft) { mark(cpu, 'cs', csFor.id); csLeft--; }
    else if (cur) {
      const p = cur;
      if (p.first === null) p.first = t;
      if (p.used === 0 && p.respDone !== p.bi) { p.resp.push(t - p.readyAt); p.respDone = p.bi; }
      mark(cpu, 'run', p.id); p.rem--; p.used++; slice--;
      if (algo === 'cfs') p.vr += 1024 / p.w;
      p.started = true;
    } else mark(cpu, 'idle', -1);
    // 4) 프로세스별 상태 기록 (이번 단위 시간 동안의 상태)
    for (const p of P) {
      const s = p === cur && !csLeft && cpu[cpu.length - 1].s === 'run' ? 'run' : p.state === 'run' ? 'ready' : p.state;
      if (s === 'ready') p.wait++;
      if (s !== 'new' && s !== 'done') mark(p.segs, s, p.id);
    }
    // 5) 버스트 · 할당량이 끝났으면 정리
    if (cur && !csLeft && cpu[cpu.length - 1].s === 'run') {
      const p = cur;
      if (p.rem <= 0) {
        if (algo === 'mlfq' && p.used >= MLQ[p.level] && p.level < 2) p.level++;
        p.bi++; cur = null; p.used = 0;
        if (p.bi >= p.bursts.length) { p.state = 'done'; p.end = t + 1; left--; }
        else { p.rem = p.bursts[p.bi]; p.state = 'wait'; p.wakeAt = t + 1 + p.io; if (p.io === 0) p.wakeAt = t + 1; }
      } else if (slice <= 0) {
        if (algo === 'mlfq' && p.level < 2) p.level++;
        p.used = algo === 'mlfq' ? 0 : p.used;
        cur = null; enqueue(p, false);
      }
    }
    snaps.push({
      t, cur: cpu[cpu.length - 1].s === 'run' ? cpu[cpu.length - 1].p : -1, cs: cpu[cpu.length - 1].s === 'cs',
      st: P.map(p => (p.segs.length && p.segs[p.segs.length - 1].to === t + 1 ? p.segs[p.segs.length - 1].s : p.state === 'done' ? 'done' : 'new')),
      q: [...ready].sort(orderOf(algo)).map(p => p.id),
      lv: P.map(p => p.level), vr: P.map(p => +p.vr.toFixed(1)), rm: P.map(p => p.rem)
    });
  }
  const done = P.filter(p => p.end !== null), span = t;
  const busy = cpu.filter(g => g.s === 'run').reduce((s, g) => s + g.to - g.from, 0);
  const over = cpu.filter(g => g.s === 'cs').reduce((s, g) => s + g.to - g.from, 0);
  const allResp = P.flatMap(p => p.resp), avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return {
    algo, cpu, snaps,
    procs: P.map(p => ({ id: p.id, name: p.name, arrive: p.arrive, end: p.end, first: p.first, wait: p.wait, resp: p.resp, turnaround: p.end === null ? null : p.end - p.arrive, segs: p.segs, cpuTotal: p.bursts.reduce((s, x) => s + x, 0) })),
    stats: {
      turnaround: avg(done.map(p => p.end - p.arrive)), wait: avg(P.map(p => p.wait)), resp: avg(allResp), maxResp: Math.max(0, ...allResp),
      switches, overhead: over, util: span ? busy / span : 0, end: span, finished: done.length === P.length
    }
  };
}
// 준비 줄을 "다음에 뽑힐 순서"로 보여 주기 위한 정렬
const orderOf = (algo) => (a, b) => (
  algo === 'sjf' || algo === 'srtf' ? a.rem - b.rem || a.seq - b.seq
    : algo === 'prio' ? a.nice - b.nice || a.seq - b.seq
      : algo === 'mlfq' ? a.level - b.level || a.seq - b.seq
        : algo === 'cfs' ? a.vr - b.vr || a.seq - b.seq
          : a.seq - b.seq);

export const compareAll = (jobs, opt) => ALGOS.map(a => simulate(a, jobs, opt));
