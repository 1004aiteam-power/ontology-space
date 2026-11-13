// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 테스트 — 실행: node tests/safety.test.mjs
import assert from 'node:assert/strict';
import { SafetySim, SCENARIOS, RULES, quizOptions, gasOK, boomFK, boomIK, STOW, WIRE, targetSag } from '../assets/safety/safety.js';

// 단계를 차례로 돌림 (skip: 건너뛸 단계 id)
function run(scenario, skip = []) {
  const s = new SafetySim({ scenario });
  const order = [];
  for (let i = 0; i < s.steps.length; i++) {
    if (skip.includes(s.steps[i].id)) { s.stepIdx = i; continue; }
    s.lanes = null; s.begin(i);
    let n = 0; while (!s.stepDone() && n++ < 40000) s.update();
    order.push({ id: s.steps[i].id, ok: n < 40000 });
  }
  return { s, order };
}

// 1) 두 시나리오 모두 끝까지 진행, 안전 규칙 위반 0, 현장 원상 복구
for (const sc of Object.keys(SCENARIOS)) {
  const { s, order } = run(sc);
  assert.ok(order.every(o => o.ok), `${sc}: every step finishes (${order.filter(o => !o.ok).map(o => o.id)})`);
  assert.ok(s.done(), `${sc}: done`);
  assert.deepEqual(s.violations, [], `${sc}: zero safety-rule violations`);
  assert.ok(s.w.cones.every(c => !c.placed), `${sc}: all cones collected`);
  assert.ok(s.w.sw.closed && !s.w.sw.tag, `${sc}: switch closed again, tag removed`);
  assert.equal(s.w.ground.line, 0); assert.equal(s.w.ground.earth, false);
  if (sc === 'pole') {
    assert.equal(s.w.insul, 'new', 'insulators replaced');
    assert.equal(s.w.covers, 0, 'line hoses removed');
    assert.equal(s.w.truck.present, false, 'truck left');
    assert.ok(Object.values(s.w.people).every(p => !p.inBucket && p.ppe.helmet), 'nobody left in the bucket, everyone in PPE');
  } else if (sc === 'tx') {
    assert.deepEqual([s.w.cos.closed, s.w.cos.tag, s.w.txGround, s.w.txEarth, s.w.hvCover], [true, false, false, false, 0], 'cut-out closed, earth and covers removed');
    assert.deepEqual([s.w.txOld.state, s.w.load.state], ['aside', 'pole'], 'old transformer down, new one mounted');
    assert.equal(s.w.truck.present, false, 'truck left');
  } else if (sc === 'wire') {
    const w = s.w;
    assert.deepEqual([w.wr.pulley, w.wr.drum, w.wr.winch, w.wr.oldTied, w.wr.newTied, w.wr.jumper, w.wr.locked, w.wr.pull, w.wr.linked], [[false, false], false, false, false, true, true, true, 1, true], 'new wire tied in and jumpered, blocks drum and winch removed');
    assert.ok(Math.abs(w.wr.sag - w.wr.target) <= w.wr.tol, `sag ${w.wr.sag.toFixed(3)} within ${w.wr.tol} of the target ${w.wr.target.toFixed(3)}`);
    assert.deepEqual([w.wg, w.tested.gnd], [[false, false], true], 'span earths removed');
    assert.deepEqual([w.truck.present, w.truck2.present], [false, false], 'both trucks left');
    assert.ok(Object.values(w.people).every(p => !p.inBucket && p.ppe.helmet), 'nobody left in a bucket, everyone in PPE');
  } else if (sc === 'tower') {
    assert.deepEqual([s.w.people.B.z, s.w.arrester, s.w.lanyard, s.w.bag.state], [0, false, false, 'ground'], 'climber down, unclipped on the ground, bag down');
  } else {
    assert.equal(s.w.mh.lid, 'closed'); assert.equal(s.w.mh.inside, false); assert.equal(s.w.mh.vent, false);
  }
  console.log(`✓ ${sc}: ${order.length} steps, ${s.t.toFixed(0)} s simulated, 0 violations`);
}

// 2) 단계마다 적힌 수칙 번호가 유효하고, 수칙 1~10과 11(분야별)이 모두 어딘가에서 다뤄짐
const covered = new Set();
for (const sc of Object.keys(SCENARIOS)) for (const st of new SafetySim({ scenario: sc }).steps) {
  for (const r of st.rules) { assert.ok(RULES[r], `${st.id}: rule ${r} exists`); covered.add(r); }
  assert.ok(st.title.ko && st.title.en && st.what.ko && st.what.en && st.why.ko && st.why.en, `${st.id}: bilingual text`);
  assert.equal(st.wrong.length, 2, `${st.id}: two wrong options`);
  for (const w of st.wrong) assert.ok(w.text.ko && w.text.en && w.why.ko && w.why.en, `${st.id}: wrong option explained`);
}
for (let r = 1; r <= 11; r++) assert.ok(covered.has(r), `rule ${r} covered`);
console.log('✓ all 11 golden rules appear in the steps, all text bilingual');

// 3) 안전조치를 빼먹으면 규칙 위반이 잡힌다
const caught = (sc, skip, rule) => {
  const { s } = run(sc, skip);
  assert.ok(s.violations.some(v => v.rule === rule), `${sc} without ${skip}: rule ${rule} violation detected (${JSON.stringify(s.violations.slice(0, 3))})`);
};
caught('pole', ['chocks'], 2);
caught('pole', ['outrig'], 2);
caught('pole', ['earth'], 8);
caught('pole', ['test'], 8);
caught('pole', ['cover'], 8);
caught('manhole', ['watch'], 9);
caught('manhole', ['mzone'], 10);
caught('tx', ['cos'], 8);          // COS를 열지 않으면 버킷이 올라갈 때부터 위반
caught('tx', ['txearth'], 8);      // 검전·접지 없이 변압기에 손
caught('tx', ['hvcover'], 8);      // 충전부 방호 없이 변압기에 손
caught('tower', ['lifeline'], 11); // 점검하지 않은 추락방지 와이어로 승탑
caught('tower', ['tieoff'], 7);    // 작업 위치에서 랜야드 없이 작업
caught('wire', ['chocks'], 2);     // 두 작업차 모두 고임목
caught('wire', ['outrig'], 2);
caught('wire', ['earth'], 8);      // 원방 접지 없이 양단 접지 · 작업
caught('wire', ['wground'], 8);    // 양단 검전 · 접지 없이 전선에 손
caught('wire', ['pulley'], 3);     // 활차 없이 전선을 풀고 견인
caught('wire', ['link'], 3);       // 연결 · 윈치 · 드럼 없이 견인
caught('wire', ['sag'], 11);       // 이도를 맞추지 않고 결속
caught('wire', ['remove'], 8);     // 활차 · 드럼 · 윈치를 둔 채 송전
console.log('✓ skipping chocks, outriggers, earthing, testing, covers, tripod, zone, cut-out, wire check, tie-off, blocks, joint, sag or rigging removal is caught');

// 3b) 전선 교체: 이도 계산
{
  assert.ok(Math.abs(targetSag(15) - 0.5) < 1e-12, 'reference sag at 15 °C');
  assert.ok(targetSag(35) > targetSag(15) && targetSag(15) > targetSag(-5), 'warmer → more sag');
  const per = (targetSag(25) - targetSag(15)) / 10;
  assert.ok(per > 0.005 && per < 0.012, `about 9 mm per °C for a 35 m span (${(per * 1000).toFixed(1)} mm)`);
  assert.ok(targetSag(15, 70) > targetSag(15, 35) - 1e-12, 'a longer span sags at least as much per degree');
  const L = (D, S) => S + 8 * D * D / (3 * S);                           // 길이 = 경간 + 8D²/3S
  const dL = L(targetSag(30), 35) - L(targetSag(0), 35);
  assert.ok(Math.abs(dL / L(0.5, 35) / 30 - 19e-6) < 4e-6, 'sag change matches thermal expansion 19e-6 /°C');
  console.log('✓ wire: sag target follows temperature and the thermal-expansion relation');
}

// 4) 맨홀: 처음 공기는 부적정, 환기 뒤 적정
{
  const s = SafetySim.jumpTo({ scenario: 'manhole' }, 5);
  assert.equal(gasOK(s.w.mh.measured), false, 'first test: unsafe air');
  s.begin(5); while (!s.stepDone()) s.update();
  assert.equal(gasOK(s.w.mh.measured), true, 'after ventilation: safe air');
  console.log('✓ manhole: first reading unsafe, safe after ventilation');
}

// 5) 붐 역기구학 · 훈련 보기
{
  const tr = { c: 0.5, y: 1.9, boom: { ...STOW } };
  for (const P of [[-0.9, 3.35, 10.5], [-1.7, 2.5, 9.4], [-0.7, 3.7, 7.5]]) {
    const { T } = boomFK(tr, boomIK(tr, P));
    assert.ok(Math.hypot(T[0] - P[0], T[1] - P[1], T[2] - P[2]) < 1e-6, 'boom IK reaches the target');
  }
  const s = new SafetySim();
  for (let i = 0; i < s.steps.length; i++) {
    const o = quizOptions(s, i);
    assert.equal(o.length, 3); assert.equal(o.filter(x => x.correct).length, 1);
    assert.ok(o.filter(x => !x.correct).every(x => x.why), 'wrong options carry a reason');
  }
  console.log('✓ boom IK, quiz options (3 options, exactly one correct)');
}
