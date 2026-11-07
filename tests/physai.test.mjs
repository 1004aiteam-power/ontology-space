// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Physical AI 시뮬레이션 테스트 — 실행: node tests/physai.test.mjs
import assert from 'node:assert/strict';
import { Population } from '../assets/physai/neat.js';
import { makeTrack, Trainer, testRun, project } from '../assets/physai/sim.js';
import { Snake, move, sense, playGame, Trainer as SnakeTrainer, GRID, SNAKE } from '../assets/physai/snake-sim.js';

// 1) NEAT가 은닉 노드가 필요한 XOR을 푼다 (구조 진화가 동작한다는 증거)
const p = new Population({ popSize: 100, nInputs: 2, nOutputs: 1 });
const xor = [[0, 0, -1], [0, 1, 1], [1, 0, 1], [1, 1, -1]];
for (let g = 0; g < 200; g++) {
  for (const ge of p.genomes) {
    const n = ge.network();
    ge.fitness = 4 - xor.reduce((e, [a, b, y]) => e + (n.activate([a, b])[0] - y) ** 2, 0);
  }
  if (Math.max(...p.genomes.map(g => g.fitness)) > 3.9) break;
  p.evolve();
}
const net = p.best ? p.best.network() : p.genomes[0].network();
const ok = xor.every(([a, b, y]) => Math.sign(net.activate([a, b])[0]) === y);
assert.ok(ok, 'XOR not solved');
console.log('✓ NEAT solves XOR');

// 2) 트랙: 종류별 생성, 화면 안, 중심선 투영
for (const type of ['blob', 'mm', 'circuit', 'snake']) {
  for (let i = 0; i < 10; i++) {
    const tr = makeTrack(type);
    assert.equal(tr.kind, type);
    assert.ok(tr.center.every(q => q.x > 0 && q.x < 1000 && q.y > 0 && q.y < 700));
    const pr = project(tr, tr.start.x, tr.start.y, 0);
    assert.ok(pr.dist < 1e-6);
  }
}
console.log('✓ tracks: blob, M-M, circuit and S-curves generated within bounds');

// 3) 학습: 둥근 트랙에서 15세대 안에 완주하는 차가 나온다
const T = new Trainer(Population, { trackType: 'blob', popSize: 100 });
let finished = 0;
for (let g = 0; g < 15 && !finished; g++) { while (!T.tick()); finished = T.pop.history.at(-1).finished; }
assert.ok(finished > 0, 'no car finished');
const r = testRun(T.pop.best, T.track, T.opts);
assert.ok(r.progress > 0.5, 'champion should drive most of its own track');
console.log(`✓ training: a car finished by generation ${T.pop.generation - 1}`);

// 4) Snake 규칙: 벽·몸 충돌, 먹이, 굶주림, 시드 재현성
{
  const s = new Snake(1);
  for (let i = 0; i < GRID.w && s.alive; i++) move(s, 0);            // 오른쪽으로 직진 → 벽
  assert.equal(s.cause, 'wall');

  const b = new Snake(1);
  b.body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }];   // 머리 아래가 몸통
  b.occupied = new Set(b.body.map(p => p.x + ',' + p.y)); b.dir = 1; b.food = { x: 0, y: 0 };
  assert.deepEqual(sense(b).slice(0, 3), [0, 0, 1]);                   // 오른쪽(아래)이 위험
  move(b, 2);
  assert.equal(b.cause, 'self');

  const f = new Snake(1);
  f.food = { x: f.head.x + 1, y: f.head.y };
  move(f, 0);
  assert.equal(f.score, 1); assert.equal(f.body.length, SNAKE.startLen + 1);
  assert.ok(f.food && !f.occupied.has(f.food.x + ',' + f.food.y), 'new food on a free cell');

  const h = new Snake(1);
  for (let i = 0; i < SNAKE.starve * 2 && h.alive; i++) move(h, i % 2 ? 1 : 0);   // 작은 원을 돌기만 → 굶어 죽음
  assert.ok(['starve', 'self'].includes(h.cause));

  const r = new Snake(1); r.food = { x: r.head.x, y: r.head.y - 3 };    // 오른쪽으로 가는 중, 먹이는 위 → 왼쪽
  assert.deepEqual(sense(r).slice(3), [0, 0, 1, 0]);
  assert.deepEqual(new Snake(42).food, new Snake(42).food);
}
console.log('✓ snake: wall/self collision, eating, starvation, seeded food');

// 5) Snake 학습: 30세대 안에 한 판에 먹이 20개 이상 먹는 개체가 나온다
{
  const ST = new SnakeTrainer(Population, { popSize: 150, seed: 3 });
  for (let g = 0; g < 30 && ST.bestScore < 20; g++) ST.runGeneration();
  assert.ok(ST.bestScore >= 20, `snake best score ${ST.bestScore}`);
  const again = playGame(ST.bestGame.genome, ST.bestGame.seed);
  assert.equal(again.score, ST.bestGame.score, 'replay is deterministic');
  console.log(`✓ snake training: ${ST.bestScore} food by generation ${ST.pop.generation}`);
}
