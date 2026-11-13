// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 별과 행성의 탄생 테스트 — 실행: node tests/nbody.test.mjs
import assert from 'node:assert/strict';
import { Nbody, G, M_IGNITE, M_EARTH } from '../assets/nbody/nbody.js';

const total = (s, f) => { let v = 0; for (let i = 0; i < s.n; i++) v += f(i); return v; };
const L = (s) => total(s, i => s.m[i] * (s.x[i] * s.vy[i] - s.y[i] * s.vx[i]));
const mass = (s) => total(s, i => s.m[i]);

// 같은 씨드는 같은 결과, 다른 씨드는 다른 결과
const a = new Nbody({ seed: 7, N: 150 }), b = new Nbody({ seed: 7, N: 150 }), c = new Nbody({ seed: 8, N: 150 });
a.step(2000); b.step(2000); c.step(2000);
assert.deepEqual([...a.x.slice(0, a.n)], [...b.x.slice(0, b.n)]);
assert.notDeepEqual([...a.x.slice(0, 20)], [...c.x.slice(0, 20)]);
console.log('✓ same seed → same run, different seed → different run');

// 가스 · 항력 없이 짧게 돌리면 질량과 각운동량이 보존된다 (합쳐질 때도)
const k = new Nbody({ N: 300, drag: 0, gasFrac: 0 });
const m0 = mass(k), L0 = L(k);
k.step(3000);                                                      // 30년
assert.ok(k.mergeCount > 5, `some bodies merged (${k.mergeCount})`);
assert.equal(k.ejected, 0);
assert.ok(Math.abs(mass(k) - m0) / m0 < 1e-12, 'mass conserved through mergers');
assert.ok(Math.abs(L(k) - L0) / Math.abs(L0) < 2e-3, `angular momentum conserved (${L(k) / L0})`);
console.log(`✓ ${k.mergeCount} mergers in 30 yr: mass conserved, angular momentum within 0.2%`);

// 구름이 별로 떨어짐: 처음엔 보이는 질량이 거의 없고(원시별), 점화 질량을 넘으면 별이 된다. 중력은 처음부터 그대로
const p = new Nbody({ N: 100 });
assert.equal(p.classify(0), 'protostar');
assert.ok(p.starMass() < 0.02 && Math.abs(p.starDyn() - 1) < 1e-12, 'little visible mass, full gravity');
p.step(2500);
assert.ok(p.starMass() > M_IGNITE && p.classify(0) === 'star');
assert.ok(p.events.some(e => e.type === 'ignite'), 'ignition logged');
const ig = p.events.find(e => e.type === 'ignite').t;
assert.ok(ig > 2 && ig < 20, `ignites after a few years (${ig})`);
console.log(`✓ protostar → star: ignites at ${ig.toFixed(1)} yr, gravity constant throughout`);

// 구름이 거의 돌지 않으면 원반이 안 생기고 물질은 별로 떨어진다. 잘 돌면 행성이 남는다
const slow = new Nbody({ spin: 0.3 }), fast = new Nbody({ spin: 1 });
slow.step(30000); fast.step(30000);
assert.ok(slow.stats().planets <= 2 && slow.swallowed > 200, `no spin: almost no planets, ${slow.swallowed} swallowed`);
assert.ok(fast.stats().planets >= 5 && fast.swallowed < slow.swallowed / 4, `full spin: ${fast.stats().planets} planets, ${fast.swallowed} swallowed`);
console.log(`✓ spin 0.3: ${slow.swallowed} bodies fall into the star, ${slow.stats().planets} planets · spin 1: ${fast.stats().planets} planets`);

// 얼음선: 안쪽이면 암석 행성이 적고, 바깥이면 많다 (얼음선 밖에서만 얼음이 얼어 고체가 늘고 거대 행성이 자란다)
const near = new Nbody({ frost: 0.8 }), far = new Nbody({ frost: 8 });
near.step(30000); far.step(30000);
const rock = (s) => s.stats().counts.rock, giants = (s) => s.stats().counts.gas;
assert.ok(rock(far) > rock(near) + 5, `frost line outside: more rocky planets (${rock(far)} vs ${rock(near)})`);
assert.ok(giants(near) >= giants(far) - 10 || giants(near) > 5, 'giants form either way');
console.log(`✓ frost line 0.8 AU: ${rock(near)} rocky · 8 AU: ${rock(far)} rocky`);

// 쌍성: 별이 둘 · 질량 비율
const bin = new Nbody({ stars: 2 });
assert.equal(bin.stats().counts.protostar, 2);
bin.step(20000);
assert.equal(bin.stats().counts.star, 2);
console.log('✓ binary: two stars ignite');

// 반장축: 중심 별 둘레 원 궤도 속도로 도는 알갱이의 a 는 그 반지름
const o = new Nbody({ N: 50, drag: 0, gasFrac: 0, spin: 1 });
for (let i = 1; i < o.n; i++) {
  const { a, r } = o.orbit(i);
  assert.ok(a !== null && Math.abs(a - r) / r < 0.12, `body ${i}: a ${a} vs r ${r}`);                 // 2% 무작위 속도 → 이심률 작음
}
console.log('✓ semi-major axis of near-circular bodies ≈ radius');
