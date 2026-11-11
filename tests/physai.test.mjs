// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Physical AI 시뮬레이션 테스트 — 실행: node tests/physai.test.mjs
import assert from 'node:assert/strict';
import { Population } from '../assets/physai/neat.js';
import { makeTrack, Trainer, testRun, project } from '../assets/physai/sim.js';
import { Snake, move, sense, playGame, Trainer as SnakeTrainer, GRID, SNAKE } from '../assets/physai/snake-sim.js';
import { Drone, Course, step as droneStep, sense as droneSense, fly, flightFitness, Trainer as DroneTrainer, WORLD, DRONE } from '../assets/physai/drone-sim.js';

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

// 6) 드론: 중력 · 추력 · 기울기 · 경유점 · 끝나는 조건 · 시드 코스
{
  const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
  const mk = () => new Drone(new Course(7));
  const fall = mk(); for (let i = 0; i < 30; i++) droneStep(fall, 0, 0);            // 추력이 없으면 떨어진다 (기울지는 않음)
  assert.ok(fall.y < WORLD.h / 2 - 3 && fall.vy < 0 && fall.th === 0 && near(fall.x, WORLD.w / 2));
  const hover = mk(); for (let i = 0; i < 90; i++) droneStep(hover, 0.5, 0.5);        // 둘 다 50%면 제자리
  assert.ok(near(hover.y, WORLD.h / 2, 1e-6) && near(hover.x, WORLD.w / 2) && hover.th === 0);
  const up = mk(); for (let i = 0; i < 30; i++) droneStep(up, 1, 1);                   // 같은 세기로 더 세게 → 기울지 않고 올라감
  assert.ok(up.y > WORLD.h / 2 + 3 && up.th === 0);
  const right = mk(); for (let i = 0; i < 30; i++) droneStep(right, 0.6, 0.4);         // 왼쪽이 세면 오른쪽으로 기울고 오른쪽으로 간다
  assert.ok(right.th > 0 && right.x > WORLD.w / 2 && right.vx > 0);
  const left = mk(); for (let i = 0; i < 30; i++) droneStep(left, 0.4, 0.6);
  assert.ok(near(left.th, -right.th) && near(left.x - WORLD.w / 2, -(right.x - WORLD.w / 2)), 'left/right are mirror images');
  const flip = mk(); while (flip.alive) droneStep(flip, 1, 0);                         // 한쪽만 최대 → 뒤집히거나 밖으로
  assert.ok(['flip', 'out'].includes(flip.cause));
  const out = mk(); while (out.alive) droneStep(out, 0, 0);
  assert.equal(out.cause, 'out');
  const idle = mk(); while (idle.alive) droneStep(idle, 0.5, 0.5);                     // 떠 있기만 하면 15초 뒤 끝
  assert.equal(idle.cause, 'starve'); assert.ok(near(idle.t, DRONE.starve, WORLD.dt));
  assert.ok(flightFitness(idle) < 100, 'hovering alone earns less than one waypoint');

  const d = mk(), p = d.target;                                                        // 경유점에 닿으면 점수가 오르고 다음 경유점으로
  d.x = p.x - 1; d.y = p.y; droneStep(d, 0.5, 0.5);
  assert.equal(d.score, 1); assert.notDeepEqual(d.target, p); assert.equal(d.since, 0);
  const s = droneSense(mk());
  assert.equal(s.length, 7); assert.ok(s.every(v => v >= -1 && v <= 1)); assert.deepEqual(s.slice(2), [0, 0, 0, 1, 0]);
  const c1 = new Course(42), c2 = new Course(42), c3 = new Course(43);
  assert.deepEqual([0, 1, 2, 3].map(i => c1.point(i)), [0, 1, 2, 3].map(i => c2.point(i)));
  assert.notDeepEqual(c1.point(0), c3.point(0));
  for (let i = 0; i < 20; i++) { const a = i ? c1.point(i - 1) : c1.start, b = c1.point(i); assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 18, 'waypoints are not too close'); }
  const windy = new Drone(new Course(7), null, 2); for (let i = 0; i < 30; i++) droneStep(windy, 0.5, 0.5);   // 옆바람은 오른쪽으로 민다
  assert.ok(windy.x > WORLD.w / 2 + 0.5);
}
console.log('✓ drone: gravity, hover, tilt, flip, starvation, waypoints, seeded course, wind');

// 7) 드론 학습: 40세대 안에 한 번의 비행에서 경유점 5개 이상 통과하는 개체가 나온다
{
  const DT = new DroneTrainer(Population, { popSize: 150, seed: 5 });
  for (let g = 0; g < 40 && DT.bestScore < 5; g++) DT.runGeneration();
  assert.ok(DT.bestScore >= 5, `drone best score ${DT.bestScore}`);
  const again = fly(DT.bestFlight.genome, DT.bestFlight.seed);
  assert.equal(again.score, DT.bestFlight.score, 'replay is deterministic');
  console.log(`✓ drone training: ${DT.bestScore} waypoints by generation ${DT.pop.generation}`);
}
