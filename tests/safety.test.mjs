// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 테스트 — 실행: node tests/safety.test.mjs
import assert from 'node:assert/strict';
import { SafetySim, SCENARIOS, RULES, quizOptions, gasOK, boomFK, boomIK, STOW } from '../assets/safety/safety.js';

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
console.log('✓ skipping chocks, outriggers, earthing, testing, covers, tripod or the zone is caught');

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
