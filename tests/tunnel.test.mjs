// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 양자 터널 효과 테스트 — 실행: node tests/tunnel.test.mjs
import assert from 'node:assert/strict';
import { Tunnel, makeFFT, transmission, packetTransmission, HBAR2_2M } from '../assets/quantum/tunnel.js';

// FFT: 변환 후 역변환하면 제자리, 단일 주파수는 한 칸에만
const fft = makeFFT(64), re = Float64Array.from({ length: 64 }, (_, i) => Math.cos(2 * Math.PI * 5 * i / 64)), im = new Float64Array(64), r0 = [...re];
fft(re, im);
assert.ok(Math.abs(re[5] - 32) < 1e-9 && Math.abs(re[59] - 32) < 1e-9 && Math.abs(re[6]) < 1e-9);
fft(re, im, true);
assert.ok(re.every((v, i) => Math.abs(v - r0[i]) < 1e-12) && im.every(v => Math.abs(v) < 1e-12));
console.log('✓ FFT: one frequency lands in one bin, inverse restores the signal');

// 이론 공식: 경계값과 경향
assert.equal(transmission(5, 0, 0.5), 1);
assert.ok(transmission(4, 6, 0.4) > transmission(4, 6, 0.8), 'thicker wall → less tunnelling');
assert.ok(transmission(4, 6, 0.4) > transmission(4, 8, 0.4), 'higher wall → less tunnelling');
assert.ok(transmission(5, 6, 0.4) > transmission(4, 6, 0.4), 'more energy → more tunnelling');
const big = transmission(2, 6, 1.0), k = Math.sqrt(4 / HBAR2_2M);
assert.ok(Math.abs(Math.log(big) - Math.log(16 * 2 * 4 / 36 * Math.exp(-2 * k * 1.0))) < 0.05, 'thick wall: T ≈ 16E(V−E)/V² · e^(−2κa)');
const q = Math.sqrt(2 / HBAR2_2M), res = Math.PI / q;                                             // E − V₀ = 2 eV, 공명 두께 qa = π
assert.ok(transmission(8, 6, res) > 0.999 && transmission(8, 6, res / 2) < 0.95, 'above the wall: resonance gives 100%, otherwise some reflection');
assert.ok(Math.abs(transmission(6 - 1e-7, 6, 0.4) - transmission(6, 6, 0.4)) < 1e-4 && Math.abs(transmission(6 + 1e-7, 6, 0.4) - transmission(6, 6, 0.4)) < 1e-4, 'continuous at E = V₀');
console.log('✓ plane-wave formula: limits, trends, thick-wall exponential, resonance above the wall, continuity at E = V₀');

// 시뮬레이션: 확률 보존, 이론과 일치, 고전 입자와 다름
for (const [E, V0, a, label] of [[4, 6, 0.4, 'below the wall'], [4, 6, 0.8, 'thicker wall'], [5.5, 6, 0.3, 'just below'], [8, 6, 0.4, 'above the wall'], [4, 0, 0.4, 'no wall'], [2, 6, 0.3, 'low energy']]) {
  const s = new Tunnel({ E, V0, a });
  const r0 = s.regions(); assert.ok(Math.abs(r0.total - 1) < 1e-9 && r0.left > 0.999, 'starts normalised, left of the wall');
  s.step(Math.floor(s.stepsToSettle() / 2)); assert.ok(Math.abs(s.regions().total - 1) < 1e-9, 'probability conserved (absorbed part counted)');
  s.step(Math.ceil(s.stepsToSettle() / 2));
  const r = s.regions(), th = s.theory();
  assert.ok(Math.abs(r.total - 1) < 1e-9, `${label}: total ${r.total}`);
  assert.ok(r.inside < 1e-3, `${label}: nothing left inside the wall (${r.inside})`);
  assert.ok(Math.abs(r.right - th.packet) < Math.max(5e-4, 0.03 * th.packet), `${label}: simulated ${r.right.toFixed(5)} vs packet theory ${th.packet.toFixed(5)} (within 3%)`);
  console.log(`✓ ${label.padEnd(14)} E ${E} eV, wall ${V0} eV × ${a} nm: through ${(r.right * 100).toFixed(2)}% (theory ${(th.packet * 100).toFixed(2)}%, plane wave ${(th.plane * 100).toFixed(2)}%, classical ${th.classical * 100}%)`);
}
const below = new Tunnel({ E: 5, V0: 6, a: 0.25 }); below.step(below.stepsToSettle());
assert.ok(below.theory().classical === 0 && below.regions().right > 0.05, 'a classical particle would bounce back; the electron partly gets through');
const above = new Tunnel({ E: 8, V0: 6, a: 0.4 }); above.step(above.stepsToSettle());
assert.ok(above.theory().classical === 1 && above.regions().left > 0.01, 'a classical particle would pass; the electron is partly reflected');
console.log('✓ unlike a classical particle: tunnels through when it has too little energy, and is partly reflected when it has enough');
