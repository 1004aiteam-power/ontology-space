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

// 6) 육식은 무에서 생기지 않는다: 시작 이후 새로 나타난 육식은 모두 분열로 생긴 것
{
  for (const opts of [{ seed: 2 }, { seed: 3, refuge: { on: false }, immigration: { herb: 0.01 } }]) {
    const e = new Ecosystem(opts);
    const known = new Set(e.cells.filter(c => c.kind === 'carn').map(c => c.id));
    for (let t = 0; t < 8000; t++) {
      e.step();
      const splits = e.events.filter(v => v.type === 'split' && v.kind === 'carn').length;
      const fresh = e.cells.filter(c => c.kind === 'carn' && !known.has(c.id));
      assert.equal(fresh.length, splits, `tick ${e.t}: ${fresh.length} new carnivores but ${splits} divisions`);
      assert.ok(fresh.every(c => c.gen > 0), 'new carnivores are children');
      for (const c of fresh) known.add(c.id);
    }
  }
}
console.log('✓ carnivores appear only by division (no spontaneous spawning, no carnivore immigration)');

// 7) 계절: 여름 한가운데 배율 1, 겨울 한가운데 1 − amp, 먹이 공급이 계절 따라 크게 오르내림 (세포 없는 접시로 확인)
{
  const e = new Ecosystem({ seed: 4, herb: { init: 0 }, carn: { init: 0 } });
  const Y = e.cfg.season.year;
  assert.ok(Math.abs(e.seasonFactor(Y * 0.375) - 1) < 1e-9);
  assert.ok(Math.abs(e.seasonFactor(Y * 0.875) - (1 - e.cfg.season.amp)) < 1e-9);
  assert.deepEqual([0, 0.3, 0.6, 0.9].map(p => e.season(Y * p)), [0, 1, 2, 3]);
  const summer = [], winter = [];
  for (let t = 0; t < Y * 3; t++) { e.step(); const s = e.season(); if (s === 1) summer.push(e.food.length); if (s === 3) winter.push(e.food.length); }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(summer) > avg(winter) * 2, `summer food ${avg(summer).toFixed(0)} vs winter ${avg(winter).toFixed(0)}`);
  console.log(`✓ seasons: average food summer ${avg(summer).toFixed(0)} vs winter ${avg(winter).toFixed(0)}`);
}

// 8) 먹지 못한 육식은 멈추지 않고 굶어 소멸한다
{
  const e = new Ecosystem({ food: { init: 0, regrow: 0 }, herb: { init: 0 }, carn: { init: 0 }, refuge: { on: false }, season: { on: false } });
  const c = e.spawn('carn', 300, 300); c.energy = 130; c.age = 0;
  let t = 0, moved = 0, last = { x: c.x, y: c.y };
  while (e.counts().carn > 0 && t < 5000) {
    e.step(); t++;
    if (c.x !== last.x || c.y !== last.y) moved++;
    last = { x: c.x, y: c.y };
  }
  assert.equal(e.counts().carn, 0, 'starving carnivore dies');
  assert.ok(moved >= t - 1, 'it keeps moving until it dies (no dormancy)');
  assert.ok(e.events.some(v => v.type === 'die' && v.cause === 'starve'), 'cause is starvation');
  console.log(`✓ a carnivore with no prey keeps moving and starves to death after ${t} ticks`);
}

// 9) 수명: 육식이 초식보다 짧고, 분열하지 못하면 수명이 다해 죽는다
{
  assert.ok(DEFAULTS.carn.maxAge < DEFAULTS.herb.maxAge, 'carnivores live shorter than herbivores');
  for (const kind of ['carn', 'herb']) {
    const e = new Ecosystem({ food: { init: 0, regrow: 0 }, herb: { init: 0 }, carn: { init: 0, split: 1e9 }, refuge: { on: false }, season: { on: false } });
    const c = e.spawn(kind, 300, 300); c.age = 0; c.energy = 1e6; c.full = 0;
    if (kind === 'herb') e.cfg.herb.split = 1e9;
    let t = 0;
    while (!c.dead && t < 20000) { e.step(); t++; }
    assert.ok(c.dead && Math.abs(t - DEFAULTS[kind].maxAge) <= 2, `${kind} dies of old age at ${t}`);
  }
  console.log(`✓ lifespan: carnivore ${DEFAULTS.carn.maxAge} < herbivore ${DEFAULTS.herb.maxAge} ticks, and cells die of old age`);
}
