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
