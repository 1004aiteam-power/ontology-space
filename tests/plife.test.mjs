// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 입자 생명 시뮬레이션 테스트 — 실행: node tests/plife.test.mjs
import assert from 'node:assert/strict';
import { ParticleLife, PRESETS, WORLD, BETA, force, rng } from '../assets/plife/plife.js';

// 힘 곡선: 가까우면 규칙과 상관없이 밀침, 중간에서 규칙 값, 작용 거리 끝에서 0
assert.equal(force(0, 1), -1);
assert.ok(Math.abs(force(BETA, 1)) < 1e-9 && force(BETA / 2, 1) < 0 && force(BETA / 2, -1) < 0);
assert.ok(Math.abs(force((1 + BETA) / 2, 0.6) - 0.6) < 1e-9, 'peak equals the matrix value');
assert.ok(Math.abs(force((1 + BETA) / 2, -0.6) + 0.6) < 1e-9);
assert.equal(force(1, 1), 0); assert.equal(force(1.5, 1), 0);
console.log('✓ force curve: repulsion up close, the rule value in the middle, zero at the edge');

// 규칙 표: 크기와 범위, 시드가 같으면 같은 표
for (const [name, make] of Object.entries(PRESETS)) for (const k of [2, 4, 6]) {
  const m = make(k, rng(3));
  assert.ok(m.length === k && m.every(r => r.length === k && r.every(v => v >= -1 && v <= 1)), `${name} ${k}`);
}
assert.deepEqual(PRESETS.random(5, rng(9)), PRESETS.random(5, rng(9)));
assert.notDeepEqual(PRESETS.random(5, rng(9)), PRESETS.random(5, rng(10)));
const chase = PRESETS.chase(4);
assert.ok(chase[0][1] > 0 && chase[1][0] < 0, 'chase is asymmetric: 0 follows 1, 1 flees 0');
console.log('✓ rule tables: right size and range, reproducible from the seed, chase is asymmetric');

// 같은 시드면 같은 결과, 입자는 늘 세계 안에
const run = (opts, steps) => { const s = new ParticleLife(opts); for (let i = 0; i < steps; i++) s.step(); return s; };
const a = run({ n: 300, seed: 5 }, 200), b = run({ n: 300, seed: 5 }, 200);
assert.deepEqual([...a.x.slice(0, 50)], [...b.x.slice(0, 50)]);
assert.ok(a.x.every(v => v >= 0 && v < WORLD.w) && a.y.every(v => v >= 0 && v < WORLD.h) && a.vx.every(Number.isFinite));
assert.equal(a.tick, 200);
console.log('✓ deterministic for a seed; particles stay inside the wrapped world');

// 규칙 없음: 가까이에서 밀어내는 힘만 → 무리 없이 퍼지고, 마찰로 거의 멈춘다
const gas = run({ n: 600, preset: 'none', seed: 2 }, 600);
assert.ok(gas.last.neighbours < gas.uniformNeighbours() * 1.05, `no clumping without rules: ${gas.last.neighbours.toFixed(2)} vs ${gas.uniformNeighbours().toFixed(2)}`);
assert.ok(gas.last.speed < 1.5, `almost at rest: ${gas.last.speed.toFixed(2)}`);
// 끼리끼리: 같은 종류끼리 모인다 → 이웃이 훨씬 많아지고, 이웃 대부분이 같은 종류
const cl = run({ n: 600, preset: 'clusters', seed: 2 }, 1000);
assert.ok(cl.last.sameShare > 0.4, `single-coloured clumps: ${cl.last.sameShare.toFixed(2)} of neighbours share the type (0.20 if mixed)`);
assert.ok(cl.last.speed < 1.5, `clumps come to rest: ${cl.last.speed.toFixed(2)}`);
// 바람개비: 여러 색이 한 덩어리로 뭉쳐(이웃이 훨씬 많음) 계속 돈다
const pw = run({ n: 600, preset: 'pinwheels', seed: 2 }, 1000);
assert.ok(pw.last.neighbours > pw.uniformNeighbours() * 2 && pw.last.speed > 2, `pinwheels: ${pw.last.neighbours.toFixed(1)} neighbours, speed ${pw.last.speed.toFixed(1)}`);
// 쫓고 쫓기기: 비대칭 규칙이라 가만히 있지 못한다
const ch = run({ n: 600, preset: 'chase', seed: 2 }, 600);
assert.ok(ch.last.speed > 1.5, `asymmetric rules keep things moving: ${ch.last.speed.toFixed(2)} vs ${gas.last.speed.toFixed(2)}`);
console.log(`✓ no rules → even gas at rest; like-attracts-like → clumps (${(cl.last.sameShare * 100).toFixed(0)}% same-type neighbours); pinwheels spin; chase keeps moving (speed ${ch.last.speed.toFixed(1)})`);

// 입자 수 · 종류 수 바꾸기
const s = new ParticleLife({ n: 100, types: 3, seed: 4 });
const first = [...s.x.slice(0, 100)];
s.setCount(250); assert.equal(s.n, 250); assert.deepEqual([...s.x.slice(0, 100)], first, 'existing particles keep their place');
s.setCount(40); assert.equal(s.x.length, 40);
const m = s.matrix.map(r => [...r]);
s.setTypes(5); assert.equal(s.matrix.length, 5); assert.deepEqual(s.matrix[1].slice(0, 3), m[1]); assert.equal(s.matrix[4][4], 0);
assert.ok([...s.type].every(t => t < 5)); s.setTypes(2); assert.ok([...s.type].every(t => t < 2));
for (let i = 0; i < 50; i++) s.step();
assert.ok(s.x.every(Number.isFinite));
console.log('✓ changing the particle count and the number of types keeps the simulation valid');

// ---- 살아 있는 세계: 에너지 · 번식 · 죽음 · 유전 ---------------------------------------------------------------
const { LivingWorld, CAP } = await import('../assets/plife/plife-evo.js');
const live = (opts, steps) => { const w = new LivingWorld(opts); for (let i = 0; i < steps; i++) w.step(); return w; };

// 먹이사슬 고리: 가 → 나 → 다 → 가
const w0 = new LivingWorld({ types: 3 });
assert.deepEqual([0, 1, 2].map(t => w0.prey(t)), [1, 2, 0]);
assert.deepEqual([0, 1, 2].map(t => w0.predator(t)), [2, 0, 1]);
assert.ok(w0.meanMatrix().flat().every(v => v === 0), 'blank genes start at zero');

// 같은 번호면 같은 세계, 입자 수는 상한 안, 태어남 · 죽음이 실제로 일어남
const l1 = live({ seed: 3 }, 3000), l2 = live({ seed: 3 }, 3000);
assert.equal(l1.n, l2.n); assert.deepEqual([...l1.genes.slice(0, 30)], [...l2.genes.slice(0, 30)]);
assert.ok(l1.n > 50 && l1.n <= CAP, `population stays alive and bounded: ${l1.n}`);
assert.ok(l1.births > 300 && l1.deaths > 300, `births ${l1.births}, deaths ${l1.deaths}`);
for (let i = 0; i < l1.n; i++) assert.ok(l1.e[i] > 0 && l1.e[i] < l1.opts.birth + 1e-6 && Number.isFinite(l1.x[i]));
assert.ok([...l1.genes].every(v => v >= -1 && v <= 1));
console.log(`✓ living world: food chain A→B→C→A, deterministic, ${l1.births} births and ${l1.deaths} deaths in 3,000 ticks, energies and genes in range`);

// 진화: 유전자가 모두 0에서 시작해도 선택이 방향을 만든다 — 먹이에게 끌리고, 포식자에게서 밀린다
for (const seed of [1, 2]) {
  const w = live({ seed }, 10000), tr = w.traits();
  assert.ok(tr.chase > 0.2, `seed ${seed}: drawn to prey ${tr.chase.toFixed(2)}`);
  assert.ok(tr.flee < -0.1, `seed ${seed}: pushed from predator ${tr.flee.toFixed(2)}`);
  assert.ok(tr.generation > 5, `seed ${seed}: generations ${tr.generation.toFixed(1)}`);
  console.log(`✓ seed ${seed}: after 10,000 ticks genes evolved from zero — prey ${tr.chase.toFixed(2)}, predator ${tr.flee.toFixed(2)}, own colour ${tr.self.toFixed(2)} (generation ${tr.generation.toFixed(0)})`);
}
// 변이가 없으면 진화도 없다: 돌연변이 0 이면 유전자는 처음 값(0)에서 움직이지 않는다
const still = live({ seed: 1, mutation: 0 }, 4000);
assert.ok(still.meanMatrix().flat().every(v => v === 0) && still.births > 100, 'no mutation → no evolution, even with births');
console.log('✓ with mutation 0 the genes never move (selection alone cannot invent variation)');

// 끼어들기: 표의 칸을 누르면 그 색 입자 모두의 그 유전자가 바뀐다
const nd = new LivingWorld({ seed: 4 });
nd.nudge(0, 1, 0.25);
assert.ok(Math.abs(nd.meanMatrix()[0][1] - 0.25) < 1e-6 && nd.meanMatrix()[1][0] === 0);
console.log('✓ nudging a cell shifts that gene in every particle of the colour');
