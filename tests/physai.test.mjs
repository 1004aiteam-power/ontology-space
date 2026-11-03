// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Physical AI 시뮬레이션 테스트 — 실행: node tests/physai.test.mjs
import assert from 'node:assert/strict';
import { Population } from '../assets/physai/neat.js';
import { makeTrack, Trainer, testRun, project } from '../assets/physai/sim.js';

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
for (const type of ['blob', 'mm']) {
  for (let i = 0; i < 10; i++) {
    const tr = makeTrack(type);
    assert.equal(tr.kind, type);
    assert.ok(tr.center.every(q => q.x > 0 && q.x < 1000 && q.y > 0 && q.y < 700));
    const pr = project(tr, tr.start.x, tr.start.y, 0);
    assert.ok(pr.dist < 1e-6);
  }
}
console.log('✓ tracks: blob and M-M generated within bounds');

// 3) 학습: 둥근 트랙에서 15세대 안에 완주하는 차가 나온다
const T = new Trainer(Population, { trackType: 'blob', popSize: 100 });
let finished = 0;
for (let g = 0; g < 15 && !finished; g++) { while (!T.tick()); finished = T.pop.history.at(-1).finished; }
assert.ok(finished > 0, 'no car finished');
const r = testRun(T.pop.best, T.track, T.opts);
assert.ok(r.progress > 0.5, 'champion should drive most of its own track');
console.log(`✓ training: a car finished by generation ${T.pop.generation - 1}`);
