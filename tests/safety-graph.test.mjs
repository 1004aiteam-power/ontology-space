// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 온톨로지 테스트 — 실행: node tests/safety-graph.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIOS, RULES } from '../assets/safety/safety.js';
import { triples, toTurtle, SF, SITES, SAFETY_CYPHER, SAFETY_SCHEMA, SAFETY_DATA, LINKED_FILES, violatedRules } from '../assets/safety/safety-graph.js';
import { loadGraph } from '../tools/load.mjs';
import { runCypher } from '../assets/cypher/cypher.js';

const ROOT = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const list = triples();

// 1) 저장된 Turtle이 시뮬레이션 코드와 같은지 (단계·수칙·오답을 고치면 build_safety.mjs를 다시 실행)
assert.equal(read(SAFETY_DATA), toTurtle(list), `${SAFETY_DATA} is out of date: run node examples/safety/build_safety.mjs`);
console.log('✓ safety-steps.ttl matches safety.js');

// 2) 시뮬레이션의 모든 것이 옮겨졌는지
const G = await loadGraph(SAFETY_SCHEMA, SAFETY_DATA, ...LINKED_FILES);
const q = (s) => runCypher(G, s).rows;
const nSteps = Object.values(SCENARIOS).reduce((a, S) => a + S.steps().length, 0);
const nWrong = Object.values(SCENARIOS).reduce((a, S) => a + S.steps().reduce((b, st) => b + st.wrong.length, 0), 0);
assert.equal(q('MATCH (s:WorkStep) RETURN count(s)')[0][0], nSteps);
assert.equal(q('MATCH (s:WorkScenario) RETURN count(s)')[0][0], Object.keys(SCENARIOS).length);
assert.equal(q('MATCH (r:SafetyRule) RETURN count(r)')[0][0], RULES.length - 1);
assert.equal(q('MATCH (x:UnsafeChoice) RETURN count(x)')[0][0], nWrong);
console.log(`✓ ${nSteps} steps, ${nWrong} unsafe choices, ${RULES.length - 1} rules carried over`);

// 3) 단계마다 수칙 · 위험요인 · 역할 · 정비 흐름 · 생애주기가 있고, 순서는 현장마다 한 줄
assert.deepEqual(q(`MATCH (s:WorkStep) WHERE NOT EXISTS { (s)-[:APPLIES_RULE]->() } OR NOT EXISTS { (s)-[:HAS_RISK]->(:Hazard) }
  OR NOT EXISTS { (s)-[:INVOLVES]->(:CrewRole) } OR NOT EXISTS { (s)-[:IN_WORKFLOW]->(:WorkflowStep) } OR NOT EXISTS { (s)-[:IN_STAGE]->(:LifecycleStage) }
  RETURN s.uri`), []);
for (const [k, S] of Object.entries(SCENARIOS)) {
  const n = S.steps().length;
  const r = q(`MATCH (sc:WorkScenario {scenarioId: '${k}'})-[:FIRST_STEP]->(a), p = (a)-[:PRECEDES*]->(z) WHERE NOT EXISTS { (z)-[:PRECEDES]->() } RETURN length(p), z.stepNo`);
  assert.deepEqual(r, [[n - 1, n]], `${k}: one chain of ${n} steps`);
}
console.log('✓ every step has rules, hazards, crew, workflow and stage; aipd:precedes is one chain per site');

// 4) 오답이 어기는 수칙: 설명의 "(수칙 n)"을 읽음
{
  const st = SCENARIOS.pole.steps().find(s => s.id === 'ppe');
  assert.deepEqual(violatedRules(st.wrong[1], st), [1, 8]);
  const z = SCENARIOS.pole.steps().find(s => s.id === 'zone');
  assert.deepEqual(violatedRules(z.wrong[1], z), z.rules, 'no number → the step\'s rules');
  assert.deepEqual(q('MATCH (x:UnsafeChoice) WHERE NOT EXISTS { (x)-[:VIOLATES]->(:SafetyRule) } RETURN x.uri'), []);
}
console.log('✓ unsafe choices point at the rules they break');

// 5) 다른 온톨로지의 대상이 실제로 있는지 (오타 난 IRI는 빈 노드가 되어 질의가 조용히 비게 됨)
{
  const typed = (file) => new Set([...read(file).matchAll(/^(\S+) a /gm)].map(m => m[1]));
  const feeder = typed('examples/feeder/feeder.ttl'), asset = typed('examples/asset/asset-ontology.ttl'), work = typed('examples/work/work-ontology.ttl');
  const sub = typed('examples/power-grid-sample.ttl'), impact = read('examples/impact/impact-links.ttl');
  const short = (iri) => iri.replace('http://example.org/grid#', 'ex:').replace('https://1004aiteam-power.github.io/ontology-space/asset#', 'pam:').replace('https://example.org/ai-promotion-dept/ontology#', 'aipd:');
  let n = 0;
  for (const [, p, o] of list) {
    if (typeof o !== 'string' || p.endsWith('#type') || o.startsWith(SF)) continue;
    const s = short(o);
    const ok = s.startsWith('ex:_') ? feeder.has(s) : s.startsWith('ex:') ? sub.has(s) : s.startsWith('pam:') ? asset.has(s) : s.startsWith('aipd:') ? work.has(s) : false;
    assert.ok(ok, `${s} (${p}) exists in its ontology`);
    n++;
  }
  assert.ok(impact.includes(short(SITES.tx.load) + ' a cim:EnergyConsumer'), 'interrupted load has customers in impact-links.ttl');
  assert.ok(n > 100);
  console.log(`✓ ${n} links to work · asset · feeder · substation resolve`);
}

// 6) 역량 질문: 모두 답이 있고, 다른 온톨로지를 거친 답이 맞는지
for (const c of SAFETY_CYPHER) {
  assert.ok(q(c.q).length, c.ko);
  if (c.qEn) assert.equal(runCypher(G, c.qEn).rows.length, q(c.q).length, c.en);
}
{
  const [q1, q2, q3, q4] = SAFETY_CYPHER.map(c => q(c.q));
  assert.deepEqual(q1.map(r => r[0]), [1, 2, 3, 4, 5, 6, 7, 8], 'harness comes after the 8 set-up steps');
  assert.deepEqual(q2.map(r => [r[1], r[3], r[4]]), [['D/L #1 Z6 (S5 뒤)', 290, '연계 개폐기 T3 (D/L #2)'], ['D/L #1 Z7 (S6 뒤)', 230, '연계 개폐기 T4 (C변전소)']]);
  assert.equal(q3.length, 5);
  assert.deepEqual(q3.find(r => r[1] === 'AS-WR-0602').slice(3, 5), ['도체 보수', []], 'wire replacement links to the conductor repair task');
  assert.equal(q3.find(r => r[1] === 'AS-TW-0017')[5], 'B-A 154kV 가공도체');
  assert.deepEqual(q4[0].slice(1, 4), ['아라 병원', 3, true]);
}
console.log('✓ competency questions answered across work · asset · feeder · impact');
