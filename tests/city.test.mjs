// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 도시 교통망 시뮬레이션 테스트 — 실행: node tests/city.test.mjs
import assert from 'node:assert/strict';
import { City, PHASES, N, turnOf, DIRS } from '../assets/city/city.js';

// 1) 도로망: 교차로 49개, 출입구 28개, 교차로마다 4갈래, 유턴 없음
{
  const c = new City();
  assert.equal(c.nodes.length, N * N); assert.equal(c.gates.length, 4 * N);
  assert.ok(c.nodes.every(n => n.in.length === 4 && n.out.length === 4), 'every intersection has 4 arms');
  assert.ok(c.links.every(l => l.next.every(m => turnOf(l.d, m.d) !== 'U')), 'no U-turns');
  assert.deepEqual(['T', 'L', 'R'].map(m => m), [turnOf(DIRS.E, DIRS.E), turnOf(DIRS.E, DIRS.N), turnOf(DIRS.E, DIRS.S)], 'eastbound: north is left, south is right');
  console.log(`✓ network: ${c.nodes.length} intersections, ${c.gates.length} gates, ${c.links.length} directed roads`);
}

// 2) 신호 · 차량 안전: 교차하는 방향이 동시에 녹색이 아님, 적신호 진입 0, 차로 안에서 겹침 없음, 목적지 출구로만 나감, 차량 수 보존
for (const mode of ['fixed', 'wave', 'actuated']) {
  const c = new City({ mode, inflow: 4000, seed: 3 });
  let conflicts = 0, overlaps = 0;
  for (let k = 0; k < 4800; k++) {                                   // 20분
    c.step();
    if (k % 4) continue;
    for (const n of c.nodes) {
      const open = (axis) => n.in.some(l => (l.d[0] === 0 ? 'NS' : 'EW') === axis && ['T', 'L', 'R'].some(m => c.signal(n, l, m) !== 'R'));
      if (open('NS') && open('EW')) conflicts++;
    }
    for (const l of c.links) for (const lane of l.lanes) for (let i = 1; i < lane.cars.length; i++) if (lane.cars[i - 1].s - lane.cars[i].s < c.o.len - 0.05) overlaps++;
  }
  assert.equal(conflicts, 0, `${mode}: crossing axes never open together`);
  assert.equal(c.redRuns, 0, `${mode}: nobody enters on red`);
  assert.equal(overlaps, 0, `${mode}: no overlapping cars`);
  assert.equal(c.wrongExit, 0, `${mode}: every car leaves by its own destination gate`);
  assert.equal(c.spawned, c.exited + c.count(), `${mode}: in = out + still inside`);
  assert.ok(c.exited > 800, `${mode}: traffic flows (${c.exited} trips)`);
  console.log(`✓ ${mode.padEnd(8)}: ${c.spawned} in, ${c.exited} out, ${c.count()} inside; no conflicting greens, red-running, overlaps or wrong exits`);
}

// 3) 같은 씨드 → 같은 결과
{
  const a = new City({ seed: 9 }), b = new City({ seed: 9 });
  a.run(300); b.run(300);
  assert.deepEqual([a.spawned, a.exited, a.count()], [b.spawned, b.exited, b.count()]);
  console.log('✓ same seed, same run');
}

// 4) 유입량은 설정대로 (무작위 도착), 출근 쏠림이면 동쪽 출입구로 더 많이 들어옴
{
  const c = new City({ inflow: 3000, seed: 5 }); c.run(1800);
  const perHour = c.spawned * 2;
  assert.ok(Math.abs(perHour - 3000) / 3000 < 0.08, `arrivals ≈ setting (${perHour}/h)`);
  const r = new City({ bias: 1, inflow: 3000, seed: 5 }); r.run(1200);
  const side = (s, k) => r.gates.filter(g => g.side === s).reduce((t, g) => t + g[k], 0);
  assert.ok(side('E', 'inCount') > 2 * side('W', 'inCount') && side('W', 'outCount') > side('E', 'outCount'), 'rush hour: in from the east, out to the west');
  console.log(`✓ arrivals ${perHour}/h for 3000/h set; rush-hour bias: east in ${side('E', 'inCount')} vs west in ${side('W', 'inCount')}`);
}

// 5) 자율주행차가 많을수록 지연과 정지가 줄어듦 (같은 수요, 같은 씨드)
{
  const res = [0, 1].map(av => { const c = new City({ av, inflow: 5000, seed: 2 }); c.run(1800); return c.stats(900); });
  assert.ok(res[1].delay < res[0].delay * 0.95, `delay: all-AV ${res[1].delay.toFixed(0)} s < human ${res[0].delay.toFixed(0)} s`);
  assert.ok(res[1].stops < res[0].stops, `stops: all-AV ${res[1].stops.toFixed(2)} < human ${res[0].stops.toFixed(2)}`);
  console.log(`✓ 0% → 100% AV: delay ${res[0].delay.toFixed(0)} → ${res[1].delay.toFixed(0)} s, stops ${res[0].stops.toFixed(2)} → ${res[1].stops.toFixed(2)}`);
}

// 6) 감응식 신호는 수요가 적을 때 고정 주기보다 지연이 적음 (수요 없는 현시를 건너뜀)
{
  const d = ['fixed', 'actuated'].map(mode => { const c = new City({ mode, inflow: 1500, seed: 4 }); c.run(1500); return c.stats(900).delay; });
  assert.ok(d[1] < d[0] * 0.8, `actuated ${d[1].toFixed(0)} s < fixed ${d[0].toFixed(0)} s`);
  console.log(`✓ light traffic: actuated delay ${d[1].toFixed(0)} s vs fixed ${d[0].toFixed(0)} s`);
}

// 7) 자율주행차의 V2I: 고정 신호에서 녹색까지 남은 시간이 실제 녹색 시작과 맞음
{
  const c = new City({ mode: 'fixed' }), n = c.nodes[24], l = n.in.find(x => x.d[0] !== 0);
  c.run(7);
  const tg = c.timeToGreen(n, l, 'T');
  c.run(Math.max(0, tg - 0.5)); assert.equal(c.signal(n, l, 'T'), 'R', 'still red just before');
  c.run(1); assert.equal(c.signal(n, l, 'T'), 'G', 'green right after');
  console.log(`✓ V2I time-to-green (${tg.toFixed(1)} s) matches the signal`);
}
