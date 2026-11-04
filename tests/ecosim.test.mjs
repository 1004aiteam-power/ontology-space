// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 단세포 생태계 시뮬레이션 테스트 — 실행: node tests/ecosim.test.mjs
import assert from 'node:assert/strict';
import { Ecosystem, DEFAULTS } from '../assets/eco/ecosim.js';

const empty = (opts = {}) => new Ecosystem({ food: { init: 0, regrow: 0 }, herb: { init: 0 }, carn: { init: 0 }, refuge: { on: false }, ...opts });

// 1) 초식이 먹이를 먹으면 에너지가 늘고 먹이는 사라진다
{
  const e = empty();
  const h = e.spawn('herb', 100, 100); h.a = 0; h.energy = 30;
  e.addFood(101, 100);
  e.step();
  assert.equal(e.food.length, 0);
  assert.ok(h.energy > 30 + DEFAULTS.food.energy - 1, 'herb gained food energy');
}
console.log('✓ herbivore eats food');

// 2) 분열: 에너지 절반씩, 형질은 한계 안에서 변이
{
  const e = empty();
  const h = e.spawn('herb', 300, 300); h.energy = DEFAULTS.herb.split + 10;
  e.step();
  const hs = e.cells.filter(c => c.kind === 'herb');
  assert.equal(hs.length, 2);
  assert.ok(Math.abs(hs[0].energy - hs[1].energy) < 1, 'energy split in half');
  assert.equal(hs[1].gen, 1);
  const L = DEFAULTS.limits.herb;
  for (const c of hs) assert.ok(c.speed >= L.speed[0] && c.speed <= L.speed[1] && c.sense >= L.sense[0] && c.sense <= L.sense[1]);
}
console.log('✓ division halves energy and keeps traits in limits');

// 3) 육식은 초식을 잡아먹지만, 피난처 안의 초식은 잡지 못한다
{
  const e = empty();
  const c = e.spawn('carn', 200, 200); c.energy = 100;
  const h = e.spawn('herb', 204, 200); h.energy = 50; h.speed = 0.01;
  e.step();
  assert.equal(e.counts().herb, 0, 'herb eaten');
  assert.ok(c.energy > 100, 'carn gained energy');

  const z = { x: 500, y: 300, r: 60 };
  const r = empty({ refuge: { on: true, zones: [z], stay: 1, slow: 0.5, food: 0 } });
  const c2 = r.spawn('carn', 500, 300); c2.energy = 100;
  const h2 = r.spawn('herb', 503, 300); h2.energy = 50; h2.speed = 0.01;
  for (let i = 0; i < 20; i++) r.step();
  assert.equal(r.counts().herb, 1, 'herb in refuge survives');
}
console.log('✓ predation, and refuges hide prey');

// 4) 같은 시드 → 같은 결과
{
  const a = new Ecosystem({ seed: 7 }), b = new Ecosystem({ seed: 7 });
  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.deepEqual(a.counts(), b.counts());
}
console.log('✓ seeded runs are reproducible');

// 5) 가우스 실험: 피난처가 있으면 두 종이 공존, 없으면 초식이 멸종
{
  const e = new Ecosystem({ seed: 1 });
  let minH = Infinity, minC = Infinity;
  for (let t = 0; t < 15000; t++) { e.step(); const c = e.counts(); minH = Math.min(minH, c.herb); minC = Math.min(minC, c.carn); }
  assert.ok(minH > 0 && minC > 0, `coexistence with refuges (min herb ${minH}, min carn ${minC})`);

  const n = new Ecosystem({ seed: 1, refuge: { on: false } });
  let t = 0;
  while (n.counts().herb > 0 && t < 15000) { n.step(); t++; }
  assert.ok(n.counts().herb === 0, 'without refuges the prey is wiped out');
  console.log(`✓ Gause: coexist with refuges (15000 ticks), prey extinct at tick ${t} without`);
}
