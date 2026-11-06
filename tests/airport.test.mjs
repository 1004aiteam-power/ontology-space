// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 공항 이착륙 시뮬레이션 테스트 — 실행: node tests/airport.test.mjs
import assert from 'node:assert/strict';
import { Airport, CATS, GEO, arrSepNM, depSepS, buildPath, sample } from '../assets/airport/airport.js';

const RUNWAY_STATES = new Set(['final', 'roll', 'lineup', 'takeoff']);
const GROUND = new Set(['roll', 'taxiIn', 'waitGate', 'push', 'start', 'taxiOut', 'hold', 'lineup', 'parked', 'gate']);

// 하루 전체를 돌리며 안전 규칙을 매 틱 확인
function runDay(opts, until = 27 * 3600) {
  const a = new Airport(opts);
  let rwyBoth = 0, groundClose = 0, steps = 0;
  while (a.t < until && !a.done()) {
    a.step(); steps++;
    // 1) 활주로 위(시단~끝, 30m 아래)에 두 대가 동시에 있지 않다
    for (const r of [0, 1]) {
      const on = a.planes.filter(p => p.r === r && RUNWAY_STATES.has(p.state) && Math.abs(p.y - GEO.rwyY) < 30 && p.x > GEO.thrX - 5 && p.x < GEO.rwyHalf && p.z < 30);
      if (on.length > 1) rwyBoth++;
    }
    // 2) 지상 항공기끼리 겹치지 않는다 (중심 간 거리 > 두 기체 길이 평균)
    if (steps % 4 === 0) {
      const g = a.planes.filter(p => GROUND.has(p.state));
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        if (g[i].r !== g[j].r) continue;
        if (Math.hypot(g[i].x - g[j].x, g[i].y - g[j].y) < (CATS[g[i].cat].len + CATS[g[j].cat].len) / 2) groundClose++;
      }
    }
  }
  return { a, rwyBoth, groundClose };
}
function sepViolations(a) {
  let arr = 0, dep = 0;
  for (const R of a.rwy) {
    for (let i = 1; i < R.thrLog.length; i++) {
      const A = R.thrLog[i - 1], B = R.thrLog[i];
      const need = arrSepNM(A.cat, B.cat) * (a.cfg.lowVis ? 1.4 : 1) * 1852 / CATS[B.cat].vApp;
      if (B.t - A.t < need - 1) arr++;
    }
    for (let i = 1; i < R.rollLog.length; i++) {
      const A = R.rollLog[i - 1], B = R.rollLog[i];
      if (B.t - A.t < depSepS(A.cat, B.cat, a.cfg) - 1e-6) dep++;
    }
  }
  return { arr, dep };
}

// 1) 하루 전체: 모든 편이 끝나고, 안전 규칙이 지켜진다
const day = {};
for (const opts of [{ seed: 1 }, { seed: 5, ops: 'west' }, { seed: 4, lowVis: true }]) {
  const { a, rwyBoth, groundClose } = runDay(opts);
  const s = a.summary(), v = sepViolations(a);
  assert.ok(a.done(), `${JSON.stringify(opts)}: every flight finished (${s.landed}+${s.departed}/${s.total})`);
  assert.equal(s.landed + s.departed, s.total);
  assert.ok(a.flights.every(f => f.status === 'arrived' || f.status === 'departed'), 'every flight ends arrived or departed');
  assert.equal(rwyBoth, 0, 'never two aircraft on one runway');
  assert.equal(v.arr, 0, 'arrival wake separation');
  assert.equal(v.dep, 0, 'departure separation');
  assert.equal(groundClose, 0, 'no ground overlaps');
  assert.ok(a.rwy.every(R => R.thrLog.length > 50 && R.rollLog.length > 50), 'mixed mode: both runways land and take off');
  day[JSON.stringify(opts)] = s;
  console.log(`✓ full day ${JSON.stringify(opts)}: ${s.total} flights, ${s.goArounds} go-arounds, avg delay arr ${s.arrDelay.toFixed(1)} / dep ${s.depDelay.toFixed(1)} min, ends ${(a.t / 3600).toFixed(2)} h`);
}

// 2) 같은 시드 → 같은 결과
{
  const a = new Airport({ seed: 9 }), b = new Airport({ seed: 9 });
  for (let i = 0; i < 20000; i++) { a.step(); b.step(); }
  assert.deepEqual(a.planes.map(p => [p.id, p.state, p.x.toFixed(3), p.y.toFixed(3)]), b.planes.map(p => [p.id, p.state, p.x.toFixed(3), p.y.toFixed(3)]));
}
console.log('✓ seeded runs are reproducible');

// 3) 교통량이 늘면 지연이 늘어난다
{
  const low = runDay({ seed: 7, peak: 30 }).a.summary(), high = runDay({ seed: 7, peak: 75 }).a.summary();
  assert.ok(high.arrDelay + high.depDelay > low.arrDelay + low.depDelay + 5, `delay grows with traffic (${(low.arrDelay + low.depDelay).toFixed(1)} → ${(high.arrDelay + high.depDelay).toFixed(1)} min)`);
  console.log(`✓ more traffic, more delay: arr+dep ${(low.arrDelay + low.depDelay).toFixed(1)} min (peak 30/h) → ${(high.arrDelay + high.depDelay).toFixed(1)} min (peak 75/h)`);
}

// 4) 착륙 직전에 활주로가 막혀 있으면 복행하고, 다시 돌아와 착륙한다
{
  const a = new Airport({ seed: 1, schedule: false, start: 8 * 3600 });
  const f = a.addFlight({ kind: 'arr', cat: 'M', sched: a.t + GEO.D0 / CATS.M.vApp, rwy: 0 });
  a.step();
  assert.equal(f.plane.state, 'final');
  a.rwy[0].occ.add(999);                                        // 활주로를 막아 둠
  let sawGA = false;
  while (a.t < 8 * 3600 + 300 && !sawGA) { a.step(); sawGA = f.status === 'goaround'; }
  assert.ok(sawGA, 'goes around when the runway is occupied');
  assert.equal(a.stats.goArounds, 1);
  a.rwy[0].occ.delete(999);
  while (a.t < 10 * 3600 && f.status !== 'arrived') a.step();
  assert.equal(f.status, 'arrived', 'lands after the go-around and reaches a gate');
  assert.ok(f.act - f.sched > 300, 'the go-around costs time');
  console.log(`✓ go-around when the runway is blocked, lands ${((f.act - f.sched) / 60).toFixed(1)} min late`);
}

// 5) 혼합 운영: 착륙기가 가까우면 이륙기는 정렬하지 않는다
{
  const a = new Airport({ seed: 1, schedule: false, start: 8 * 3600 });
  const d = a.addFlight({ kind: 'dep', cat: 'M', sched: a.t, rwy: 0 });
  while (!(d.plane?.state === 'taxiOut' && d.plane.path.len - d.plane.s < 150) && a.t < 9 * 3600) a.step();   // 대기 지점 바로 앞
  const arr = a.addFlight({ kind: 'arr', cat: 'M', sched: a.t + 60, rwy: 0, appear: a.t });
  a.step();
  Object.assign(arr.plane, { state: 'final', x: GEO.thrX - 70 * 60, v: 70 });     // 착륙 60초 전
  a.rwy[0].holdQ.length = 0;
  while (d.plane.state !== 'hold' && a.t < 9 * 3600) a.step();
  assert.equal(d.plane.state, 'hold', 'departure reaches the holding point');
  let linedUpEarly = false;
  while (arr.status !== 'landed' && a.t < 9 * 3600) { a.step(); if (d.plane && d.plane.state !== 'hold' && arr.status !== 'landed') linedUpEarly = true; }
  assert.ok(!linedUpEarly, 'departure waits while an arrival is close');
  while (d.status !== 'departed' && a.t < 9 * 3600) a.step();
  assert.equal(d.status, 'departed', 'then it takes off after the arrival');
  console.log('✓ mixed mode: departure holds for a close arrival, then takes off');
}

// 6) 경로: 모서리가 둥글고 길이가 맞다
{
  const p = buildPath([[0, 0], [100, 0], [100, 100]], 30);
  assert.ok(p.len < 200 && p.len > 180, `rounded corner shortens the path (${p.len.toFixed(1)})`);
  const q = sample(p, p.len);
  assert.ok(Math.abs(q.x - 100) < 1e-6 && Math.abs(q.y - 100) < 1e-6);
  assert.ok(p.p.some(pt => pt.v < Infinity), 'turns carry a speed limit');
}
console.log('✓ paths with rounded corners');
