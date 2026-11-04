// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 교차로 신호 시뮬레이션 테스트 — 실행: node tests/traffic.test.mjs
import assert from 'node:assert/strict';
import { Intersection, PHASES, ARMS, AXIS, pointAt } from '../assets/traffic/traffic.js';

// 30분 동안 돌리며 안전 규칙을 매 틱 확인
function run(opts, seconds = 1800) {
  const x = new Intersection(opts);
  const seen = new Set();
  let redRun = 0, pedHit = 0, overlap = 0, conflictGreen = 0;
  for (let i = 0; i < seconds * 10; i++) {
    x.step();
    // 1) 서로 부딪히는 움직임에 동시에 녹색이 켜지지 않는다 (직진 축과 좌회전, 다른 축)
    const greens = [];
    for (const a of ARMS) for (const l of [0, 1]) if (x.laneSignal(a, l) !== 'R') greens.push(AXIS[a] + l);
    if (new Set(greens).size > 1) conflictGreen++;
    // 보행 신호는 같은 축 직진 녹색일 때만, 그때 그 횡단보도를 지나는 차 신호는 꺼져 있다
    for (const a of ARMS) if (x.pedSignal(a) !== 'D' && (x.laneSignal(a, 0) !== 'R' || x.laneSignal(a, 1) !== 'R')) conflictGreen++;
    // 2) 빨간불에 정지선을 넘는 차가 없다
    for (const c of x.cars) if (c.passed && !seen.has(c.id)) { seen.add(c.id); if (x.laneSignal(c.path.from, c.path.lane) === 'R') redRun++; }
    // 3) 같은 차로의 차끼리 겹치지 않는다
    for (const a of x.cars) for (const b of x.cars) if (a !== b && a.path.inLane === b.path.inLane && a.s < a.path.boxIn && b.s < b.path.boxIn && b.s > a.s && b.s - a.s < x.cfg.car.len) overlap++;
    // 4) 건너는 사람과 차가 부딪히지 않는다
    for (const p of x.peds) if (p.state === 'walk') { const q = x.pedPos(p); for (const c of x.cars) { const r = pointAt(c.path, c.s); if (Math.hypot(r.x - q.x, r.y - q.y) < 1.2) pedHit++; } }
  }
  return { x, redRun, pedHit, overlap, conflictGreen };
}

for (const mode of ['fixed', 'actuated']) {
  const r = run({ seed: 3, mode, ped: 300 });
  assert.equal(r.conflictGreen, 0, `${mode}: conflicting greens`);
  assert.equal(r.redRun, 0, `${mode}: red-light running`);
  assert.equal(r.overlap, 0, `${mode}: cars overlapping`);
  assert.equal(r.pedHit, 0, `${mode}: pedestrian hit`);
  const s = r.x.stats(1200);
  assert.ok(s.n > 300 && r.x.pedDone.length > 50, `${mode}: traffic flows (${s.n} cars, ${r.x.pedDone.length} people)`);
  console.log(`✓ ${mode}: 30 min, no conflicting greens, no red running, no overlaps, no pedestrian conflicts (${s.n} cars in 20 min, delay ${s.delay.toFixed(0)} s)`);
}

// 5) 현시 순서와 황색·전적색
{
  const x = new Intersection({ seed: 1 });
  const seq = [];
  for (let i = 0; i < 2200; i++) { x.step(); for (const e of x.events) if (e.type === 'signal') seq.push(PHASES[e.phase].id + ':' + e.stage); }
  assert.deepEqual(seq.slice(0, 8), ['NS:yellow', 'NS:allred', 'NSL:green', 'NSL:yellow', 'NSL:allred', 'EW:green', 'EW:yellow', 'EW:allred']);
  console.log('✓ phases cycle N–S through → N–S left → E–W through → E–W left with yellow and all-red');
}

// 6) 감응식: 좌회전 차가 없으면 좌회전 현시를 건너뛴다
{
  const x = new Intersection({ seed: 1, mode: 'actuated', turn: { L: 0, R: 0.15 } });
  const seen = new Set();
  for (let i = 0; i < 6000; i++) { x.step(); for (const e of x.events) if (e.type === 'signal' && e.stage === 'green') seen.add(PHASES[e.phase].move); }
  assert.ok(!seen.has('L'), 'left phases skipped with no left-turners');
  console.log('✓ actuated control skips left-turn phases when nobody turns left');
}

// 7) 감응식이 고정 주기보다 차량 지체를 줄인다 (평상시 교통량)
{
  const f = run({ seed: 5, mode: 'fixed' }, 2400).x.stats(1800), a = run({ seed: 5, mode: 'actuated' }, 2400).x.stats(1800);
  assert.ok(a.delay < f.delay, `actuated ${a.delay.toFixed(0)} s < fixed ${f.delay.toFixed(0)} s`);
  console.log(`✓ actuated cuts average car delay: ${f.delay.toFixed(0)} s → ${a.delay.toFixed(0)} s`);
}
