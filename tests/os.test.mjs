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
