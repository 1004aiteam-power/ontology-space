// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 운영체제 페이지의 계산 점검 (브라우저 없이) — 실행: node tests/os.test.mjs
import assert from 'node:assert/strict';
import { ALGOS, simulate, compareAll, randomJobs, weight } from '../assets/os/sched.js';

const J = (name, arrive, cpu, n = 1, io = 0, nice = 0) => ({ name, arrive, cpu, n, io, nice });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

// 1) 교과서 예제와 같은 값 (Silberschatz, Operating System Concepts 의 CPU 스케줄링 예)
const book = [J('P1', 0, 24), J('P2', 0, 3), J('P3', 0, 3)];
close(simulate('fcfs', book).stats.wait, 17, 'FCFS average wait');
close(simulate('sjf', book).stats.wait, 3, 'SJF average wait');
close(simulate('rr', book, { q: 4 }).stats.wait, 17 / 3, 'RR (q = 4) average wait');
close(simulate('srtf', [J('P1', 0, 8), J('P2', 1, 4), J('P3', 2, 9), J('P4', 3, 5)]).stats.wait, 6.5, 'SRTF average wait');
console.log('✓ FCFS 17 · SJF 3 · RR 5.67 · SRTF 6.5 match the textbook');

// 2) 어떤 방식 · 어떤 묶음에서도: 모두 끝나고, CPU 는 한 번에 하나만, 일한 양이 요청한 양과 같다
for (let seed = 1; seed <= 25; seed++) {
  const jobs = randomJobs(seed, 5);
  for (const cs of [0, 2]) for (const r of compareAll(jobs, { q: 3, cs })) {
    assert.ok(r.stats.finished, `${r.algo} seed ${seed}: every process finishes`);
    for (let i = 1; i < r.cpu.length; i++) assert.ok(r.cpu[i].from >= r.cpu[i - 1].to, 'CPU timeline does not overlap');
    r.procs.forEach((p, i) => {
      const ran = r.cpu.filter(g => g.s === 'run' && g.p === i).reduce((s, g) => s + g.to - g.from, 0);
      assert.equal(ran, jobs[i].cpu * jobs[i].n, `${r.algo}: ${p.name} gets exactly its CPU time`);
      assert.ok(p.first >= jobs[i].arrive, 'nothing runs before it arrives');
      const segRun = p.segs.filter(g => g.s === 'run').reduce((s, g) => s + g.to - g.from, 0);
      assert.equal(segRun, ran, 'per-process timeline agrees with the CPU timeline');
    });
    if (cs === 0) assert.equal(r.stats.overhead, 0);
    assert.equal(r.snaps.length, r.stats.end, 'one snapshot per time unit');
  }
}
console.log('✓ all seven schedulers finish every job, never overlap, and give each process exactly its CPU time');

// 3) 성질: 비선점은 버스트 중간에 끊지 않고, 문맥 전환 비용은 CPU 이용률을 깎는다
for (const a of ['fcfs', 'sjf']) {
  const r = simulate(a, randomJobs(7, 5), { cs: 0 });
  const runs = r.cpu.filter(g => g.s === 'run');
  for (let i = 1; i < runs.length; i++) if (runs[i].p !== runs[i - 1].p && runs[i - 1].to === runs[i].from) {
    const p = runs[i - 1].p, done = r.cpu.filter(g => g.s === 'run' && g.p === p && g.to <= runs[i - 1].to).reduce((s, g) => s + g.to - g.from, 0);
    assert.equal(done % randomJobs(7, 5)[p].cpu, 0, `${a}: a switch happens only at the end of a burst`);
  }
}
const lo = simulate('rr', randomJobs(3, 5), { q: 1, cs: 0 }), hi = simulate('rr', randomJobs(3, 5), { q: 1, cs: 3 });
assert.ok(hi.stats.util < lo.stats.util && hi.stats.overhead > 0, 'context switches cost CPU time');
console.log('✓ non-preemptive schedulers switch only at burst ends; switch cost lowers CPU utilisation');

// 4) 대화형 작업: RR · MLFQ · CFS 의 응답이 FCFS 보다 빠르다. 우선순위는 낮은 쪽을 굶긴다
const mix = [J('P1', 0, 40), J('P2', 0, 40), J('P3', 2, 1, 8, 4), J('P4', 3, 2, 6, 6)];
const R = Object.fromEntries(compareAll(mix, { q: 4, cs: 0 }).map(r => [r.algo, r.stats]));
for (const a of ['rr', 'mlfq', 'cfs']) assert.ok(R[a].maxResp < R.fcfs.maxResp, `${a} responds faster than FCFS`);
const st = [J('P1', 0, 10, 1, 0, 10), J('P2', 1, 6, 5, 2, -5), J('P3', 2, 6, 5, 2, -5)];
const pr = simulate('prio', st), fc = simulate('fcfs', st);
assert.ok(pr.procs[0].end > fc.procs[0].end && pr.procs[0].end === pr.stats.end, 'priority scheduling makes the low-priority job finish last');
console.log('✓ RR, MLFQ and CFS answer interactive jobs faster than FCFS; priority starves the low-priority job');

// 5) MLFQ: CPU 를 오래 쓰면 아래로 내려가고, 끌어올림이 있으면 다시 위로
const ml = simulate('mlfq', [J('P1', 0, 50), J('P2', 0, 1, 10, 3)], { q: 2, boost: 0 });
assert.equal(Math.max(...ml.snaps.map(s => s.lv[0])), 2, 'a CPU hog sinks to the bottom level');
assert.equal(Math.max(...ml.snaps.map(s => s.lv[1])), 0, 'an interactive job that yields early stays on top');
const mb = simulate('mlfq', [J('P1', 0, 50), J('P2', 0, 1, 10, 3)], { q: 2, boost: 20 });
assert.ok(mb.snaps.some((s, i) => i > 0 && s.lv[0] === 0 && mb.snaps[i - 1].lv[0] === 2), 'the periodic boost lifts it back to the top');
console.log('✓ MLFQ demotes CPU hogs, keeps interactive jobs on top, and the boost lifts everyone back');

// 6) CFS: 리눅스 nice 가중치 표, 같은 nice 는 반반, nice 0 vs 5 는 약 1024 : 335
assert.deepEqual([weight(-20), weight(0), weight(5), weight(19)], [88761, 1024, 335, 15]);
const share = (r, until) => r.procs.map((_, i) => r.cpu.filter(g => g.s === 'run' && g.p === i && g.to <= until).reduce((s, g) => s + g.to - g.from, 0));
const eq = share(simulate('cfs', [J('A', 0, 60), J('B', 0, 60)]), 60);
assert.ok(Math.abs(eq[0] - eq[1]) <= 4, `equal nice → equal share (${eq})`);
const ns = share(simulate('cfs', [J('A', 0, 60, 1, 0, 0), J('B', 0, 60, 1, 0, 5)]), 60);
assert.ok(Math.abs(ns[0] / ns[1] - 1024 / 335) < 0.6, `nice 0 vs 5 ≈ 3 : 1 (${ns})`);
console.log('✓ CFS shares the CPU by the kernel nice weights');
assert.equal(ALGOS.length, 7);

// ---- 가상 메모리 (os-memory.html) ----
import { makeMem, access, replay, ALGOS as RALGOS } from '../assets/os/vm.js';
{
  const T = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1];
  assert.deepEqual([replay(T, 3, 'fifo').faults, replay(T, 3, 'lru').faults, replay(T, 3, 'opt').faults], [15, 12, 9], 'textbook FIFO 15 · LRU 12 · OPT 9');
  const B = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
  assert.deepEqual([replay(B, 3, 'fifo').faults, replay(B, 4, 'fifo').faults], [9, 10], "Belady's anomaly");
  for (let seed = 1; seed <= 30; seed++) {
    let x = seed; const refs = Array.from({ length: 30 }, () => (x = (x * 1103515245 + 12345) % 2147483648) % 7);
    for (let n = 1; n <= 6; n++) {
      const opt = replay(refs, n, 'opt').faults;
      for (const a of RALGOS) { const r = replay(refs, n, a); assert.ok(r.faults >= opt, `OPT is a lower bound (${a})`); assert.ok(r.steps.every(s => s.slots.includes(s.ref) && new Set(s.slots.filter(v => v !== null)).size === s.slots.filter(v => v !== null).length), 'the page is resident after each access, no duplicates'); }
      if (n < 6) assert.ok(replay(refs, n + 1, 'lru').faults <= replay(refs, n, 'lru').faults, 'LRU never gets worse with more frames (stack property)');
    }
  }
  const S = makeMem({ nFrames: 6 });
  assert.equal(access(S, 0x0123).pa, 0x0123, 'code page 0 sits in frame 0');
  assert.ok(access(S, 0x0123).tlbHit, 'second access hits the TLB');
  const f = access(S, 0x4010, true); assert.equal(f.result, 'fault'); assert.equal(f.pa, 0x5010, 'heap page faults into the free frame 5');
  assert.equal(access(S, 0x5000, true).victim, 1, 'memory full → evict the least recently used page');
  assert.equal(access(S, 0x0040, true).result, 'protect', 'writing code → protection fault');
  assert.equal(access(S, 0x9000).result, 'segv', 'unmapped page → SIGSEGV');
  assert.ok(S.pt.every(e => !e.present || S.frames[e.frame] !== undefined) && S.frames.every((v, i) => v === null || S.pt[v].frame === i), 'page table and frame list agree');
  console.log('✓ virtual memory: textbook fault counts, Belady, OPT lower bound, TLB, faults, protection, segfault');
}

// ---- 동기화 (os-sync.html) ----
import { runSchedule, histogram, dining, STRATS } from '../assets/os/sync.js';
{
  assert.equal(runSchedule('none', 1, [0, 1, 0, 0, 1, 1]).count, 1, 'the classic interleaving loses one update');
  const h = histogram('none', 3, 500, 1);
  assert.ok(Object.keys(h).some(k => +k < 6) && h[2] > 0, 'without a lock values are lost, down to 2');
  for (const m of ['mutex', 'atomic']) assert.deepEqual(histogram(m, 3, 300, 2), { 6: 300 }, `${m} never loses an update`);
  let naive = 0;
  for (let seed = 1; seed <= 100; seed++) {
    if (dining({ strat: 'naive', seed, steps: 600 }).deadlock) naive++;
    for (const s of ['ordered', 'waiter']) { const d = dining({ strat: s, seed, steps: 600 }); assert.equal(d.deadlock, null, `${s} never deadlocks (seed ${seed})`); assert.ok(d.meals.every(m => m > 0), `${s}: everyone eats`); }
  }
  assert.ok(naive > 50, 'left-first deadlocks in most runs');
  const d = dining({ strat: 'naive', seed: 1, steps: 600 }), last = d.frames[d.frames.length - 1];
  assert.equal(last.cycle.length, 5, 'the deadlock is a cycle through all five philosophers');
  assert.ok(last.held.every(h => h.length === 1), 'each holds exactly one fork');
  assert.equal(STRATS.length, 3);
  console.log('✓ synchronisation: lost updates without a lock, none with mutex/atomic; only left-first dining deadlocks');
}

// ---- 파일시스템 (os-file.html) ----
import { mkfs, steps as fsSteps, crashAt, fsck, readFile, MODES as FSMODES } from '../assets/os/fs.js';
{
  const S0 = mkfs(), ops = [{ kind: 'create', name: 'report.txt', text: 'Q3 sales up 12 percent' }, { kind: 'append', name: 'notes.txt', text: ' + bring slides' }, { kind: 'delete', name: 'notes.txt' }];
  const view = (D) => JSON.stringify(Object.keys(D.dir).sort().map(n => [n, readFile(D, n)?.text]));
  assert.equal(fsck(S0).length, 0, 'a fresh file system is clean');
  let noneProblems = 0;
  for (const op of ops) for (const m of FSMODES) {
    const st = fsSteps(S0, op, m), n = (m === 'none' ? st : st.list).length;
    const after = crashAt(S0, op, m, n).disk;
    assert.equal(fsck(after).length, 0, `${op.kind}/${m}: clean when it completes`);
    for (let c = 0; c <= n; c++) {
      const D = crashAt(S0, op, m, c).disk;
      if (m === 'none') { if (fsck(D).length) noneProblems++; continue; }
      assert.equal(fsck(D).length, 0, `${op.kind}/${m}: clean after a crash at step ${c}`);
      assert.ok([view(S0), view(after)].includes(view(D)), `${op.kind}/${m}: crash at ${c} leaves "before" or "after", nothing in between`);
    }
  }
  assert.ok(noneProblems >= 4, 'without a journal, some crash points leave inconsistencies');
  assert.equal(readFile(crashAt(S0, ops[1], 'none', 3).disk, 'notes.txt').text, 'meet at 3pm + bring slides');
  console.log('✓ file system: with a journal every crash point recovers to before-or-after; without one fsck finds damage');
}

// ---- 시스템 호출 (os-map.html) ----
import { SCENARIOS, BOXES, NR } from '../assets/os/syscall.js';
{
  assert.deepEqual(NR, { read: 0, write: 1, getpid: 39 }, 'Linux x86-64 syscall numbers');
  for (const sc of SCENARIOS) {
    assert.equal(sc.steps[0].mode, 'user', `${sc.id}: starts in user mode`);
    assert.equal(sc.steps[sc.steps.length - 1].mode, 'user', `${sc.id}: ends in user mode`);
    sc.steps.forEach((s, i) => {
      assert.ok(BOXES[s.at], `${sc.id}: box ${s.at} exists`);
      if (i && s.mode !== sc.steps[i - 1].mode) assert.ok(s.gate, `${sc.id} step ${i + 1}: mode changes only through a gate`);
      if (BOXES[s.at].space === 'user') assert.equal(s.mode, 'user', `${sc.id}: user-space code runs in user mode`);
      if (BOXES[s.at].space === 'kernel') assert.equal(s.mode, 'kernel', `${sc.id}: kernel code runs in kernel mode`);
    });
  }
  const nr = (id) => SCENARIOS.find(s => s.id === id).steps.find(s => s.regs && s.regs.rax !== undefined).regs.rax;
  assert.deepEqual([nr('write'), nr('read'), nr('getpid')], [NR.write, NR.read, NR.getpid], 'scenarios load the right syscall number into rax');
  console.log('✓ syscalls: modes change only at syscall/sysret/interrupt/exception gates; numbers match the kernel table');
}
