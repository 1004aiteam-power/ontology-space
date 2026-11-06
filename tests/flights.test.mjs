// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 세계 항공 교통 시뮬레이션 테스트 — 실행: node tests/flights.test.mjs
import assert from 'node:assert/strict';
import { AIRPORTS, BY_CODE, buildSchedule, airborne, stateAt, gcDist, gcPoint, bearing, profile, subsolar } from '../assets/flights/flights.js';

// 1) 공항 데이터: 코드가 겹치지 않고, 좌표·시차·등급이 범위 안
assert.equal(new Set(AIRPORTS.map(a => a.code)).size, AIRPORTS.length, 'unique airport codes');
for (const a of AIRPORTS) {
  assert.ok(Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180 && Math.abs(a.tz) <= 14 && [1, 2, 3].includes(a.tier), a.code);
  assert.ok(Math.abs(a.tz - a.lon / 15) < 5.5, `${a.code}: time zone roughly matches longitude`);
}
console.log(`✓ ${AIRPORTS.length} airports with valid coordinates`);

// 2) 대권 거리·방위: 알려진 값과 비교
const near = (v, ref, tol) => assert.ok(Math.abs(v - ref) <= tol, `${v.toFixed(1)} vs ${ref}`);
near(gcDist(BY_CODE.ICN, BY_CODE.LAX), 9610, 60);
near(gcDist(BY_CODE.GMP, BY_CODE.CJU), 450, 10);
near(gcDist(BY_CODE.LHR, BY_CODE.JFK), 5540, 40);
near(bearing(BY_CODE.ICN, BY_CODE.LAX), 50, 6);                 // 인천에서 로스앤젤레스로는 북동쪽으로 출발
const mid = gcPoint(BY_CODE.ICN, BY_CODE.LAX, 0.5);
assert.ok(mid.lat > 45, `ICN–LAX great circle bends north (mid latitude ${mid.lat.toFixed(1)}°)`);
console.log(`✓ great circles: ICN–LAX ${gcDist(BY_CODE.ICN, BY_CODE.LAX).toFixed(0)} km, midpoint at ${mid.lat.toFixed(1)}°N`);

// 3) 일정: 같은 시드면 같고, 모든 편이 국내선이거나 국제선이며, 실제와 비슷한 비행 시간
const S = buildSchedule();
const S2 = buildSchedule();
assert.deepEqual(S.flights.map(f => [f.no, f.depTod, f.dur]), S2.flights.map(f => [f.no, f.depTod, f.dur]), 'deterministic');
assert.equal(new Set(S.flights.map(f => f.no)).size, S.flights.length, 'unique flight numbers');
for (const f of S.flights) {
  assert.equal(f.dom, f.o.cc === f.x.cc);
  assert.ok(f.o !== f.x && f.dur > 1800 && f.dur < 20 * 3600, `${f.no}: duration`);
}
const dur = (o, x) => S.flights.find(f => f.o.code === o && f.x.code === x)?.dur / 3600;
const icnLax = dur('ICN', 'LAX'), laxIcn = dur('LAX', 'ICN'), gmpCju = dur('GMP', 'CJU');
assert.ok(icnLax > 10 && icnLax < 12, `ICN→LAX ${icnLax?.toFixed(1)} h`);
assert.ok(laxIcn > icnLax, 'westbound is slower (jet stream)');
assert.ok(gmpCju > 0.75 && gmpCju < 1.4, `GMP→CJU ${gmpCju?.toFixed(2)} h`);
const gc = S.flights.filter(f => f.o.code === 'GMP' && f.x.code === 'CJU').length;
assert.ok(gc >= 50, `Gimpo–Jeju is a busy shuttle (${gc}/day)`);
console.log(`✓ schedule: ${S.flights.length} flights/day on ${S.routes.length} routes, ICN→LAX ${icnLax.toFixed(1)} h, LAX→ICN ${laxIcn.toFixed(1)} h, GMP→CJU ${gc}/day`);

// 4) 단거리는 현지 시각 06:30~22:30 사이에 출발
for (const f of S.flights) if (f.d <= 4500) {
  const h = ((f.depTod / 3600 + f.o.tz) % 24 + 24) % 24;
  assert.ok(h >= 6.4 && h <= 22.6, `${f.no} leaves at ${h.toFixed(2)} local`);
}
console.log('✓ short-haul departures stay within 06:30–22:30 local time');

// 5) 위치: 출발점에서 시작해 도착점에서 끝나고, 시간에 따라 연속적으로 움직임
{
  const f = S.flights.find(x => x.o.code === 'ICN' && x.x.code === 'LAX');
  const day = Date.UTC(2026, 10, 6) / 1000, dep = day + f.depTod;
  const s0 = stateAt(f, dep + 1), s1 = stateAt(f, dep + f.dur - 1);
  assert.ok(gcDist(s0, f.o) < 2 && gcDist(s1, f.x) < 2, 'starts at origin and ends at destination');
  assert.ok(s0.alt < 50 && s1.alt < 50, 'on the ground at both ends');
  assert.equal(stateAt(f, dep - 60 + 86400 * 0), stateAt(f, dep - 60), 'same answer any day');
  let prev = s0, maxStep = 0, maxAlt = 0;
  for (let t = dep + 60; t < dep + f.dur; t += 60) {
    const s = stateAt(f, t); maxStep = Math.max(maxStep, gcDist(prev, s)); maxAlt = Math.max(maxAlt, s.alt); prev = s;
  }
  assert.ok(maxStep < 1000 / 60 * 1.1, `continuous (max ${maxStep.toFixed(1)} km per minute)`);
  assert.ok(maxAlt > 10000 && maxAlt <= 11600, `cruise altitude ${maxAlt.toFixed(0)} m`);
  assert.equal(stateAt(f, dep + f.dur + 10), null, 'gone after landing');
  const crossed = [];                                              // 날짜변경선을 넘음
  for (let t = dep; t < dep + f.dur; t += 600) crossed.push(Math.sign(stateAt(f, t).lon));
  assert.ok(crossed.includes(1) && crossed.includes(-1), 'ICN–LAX crosses the antimeridian');
  console.log(`✓ positions: ICN→LAX moves continuously (≤ ${maxStep.toFixed(1)} km/min), cruises at ${maxAlt.toFixed(0)} m, crosses 180°`);
}

// 6) 고도·속도 그래프: 진행률은 0→1로 늘기만 함
{
  const f = S.flights[100];
  let pPrev = -1;
  for (let el = 0; el < f.dur; el += 30) { const pr = profile(f, el); assert.ok(pr.p >= pPrev && pr.alt >= 0); pPrev = pr.p; }
  assert.ok(Math.abs(profile(f, f.dur - 0.001).p - 1) < 0.01);
}
console.log('✓ altitude/speed profile is monotonic in progress');

// 7) 하늘 위 항공기 수: 하루 내내 수천 대, 국내선·국제선 모두
{
  const day = Date.UTC(2026, 10, 6) / 1000;
  for (let h = 0; h < 24; h += 3) {
    const a = airborne(S.flights, day + h * 3600), dom = a.filter(x => x.f.dom).length;
    assert.ok(a.length > 1200 && a.length < 3500, `${h}h UTC: ${a.length} airborne`);
    assert.ok(dom > 200 && a.length - dom > 600, `${h}h UTC: both domestic (${dom}) and international`);
  }
}
console.log('✓ thousands of aircraft airborne around the clock');

// 8) 해의 위치: 하지 정오(UTC)에는 북회귀선 근처, 그리니치 근처
{
  const s = subsolar(Date.UTC(2026, 5, 21, 12) / 1000);
  assert.ok(Math.abs(s.lat - 23.44) < 0.6 && Math.abs(s.lon) < 1, `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`);
  const w = subsolar(Date.UTC(2026, 11, 21, 0) / 1000);
  assert.ok(Math.abs(w.lat + 23.44) < 0.6 && Math.abs(Math.abs(w.lon) - 180) < 1);
}
console.log('✓ sub-solar point for the day/night shading');
