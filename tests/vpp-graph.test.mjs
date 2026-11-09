// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// VPP 가상 전력시장 온톨로지 테스트 — 실행: node tests/vpp-graph.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { triples, toTurtle, simulate, VPPS, SMP, RULE, SUBSTATIONS, VPP_CYPHER, VPP_SCHEMA, VPP_DATA, LINKED_FILES } from '../assets/vpp/vpp-graph.js';
import { neo4jScript, NEO4J_FILE } from '../examples/vpp/build_vpp.mjs';
import { loadGraph } from '../tools/load.mjs';
import { runCypher } from '../assets/cypher/cypher.js';

const ROOT = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const sim = simulate();

// 1) 저장된 Turtle · Neo4j 스크립트가 코드와 같은지 (vpp-graph.js를 고치면 build_vpp.mjs를 다시 실행)
assert.equal(read(VPP_DATA), toTurtle(triples(sim)), `${VPP_DATA} is out of date: run node examples/vpp/build_vpp.mjs`);
const G = await loadGraph(VPP_SCHEMA, VPP_DATA, ...LINKED_FILES);
assert.equal(read(NEO4J_FILE), neo4jScript(G), `${NEO4J_FILE} is out of date: run node examples/vpp/build_vpp.mjs`);
console.log('✓ vpp-market.ttl and neo4j/import.cypher match vpp-graph.js');

const q = (s) => runCypher(G, s).rows;
// 2) 구조: VPP 10개, DER마다 VPP 하나 · 선로 하나, 선로마다 디지털 트윈의 변전소
assert.equal(q('MATCH (v:VirtualPowerPlant) RETURN count(v)')[0][0], 10);
assert.equal(q('MATCH (d:DER) RETURN count(d)')[0][0], sim.ders.length);
assert.deepEqual(q(`MATCH (d:DER) OPTIONAL MATCH (v:VirtualPowerPlant)-[:AGGREGATES]->(d)
  WITH d, count(v) AS nv OPTIONAL MATCH (d)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
  WITH d, nv, count(f) AS nf WHERE nv <> 1 OR nf <> 1 RETURN d.derId`), []);
assert.deepEqual(q('MATCH (f:Feeder) WHERE NOT EXISTS { (f)-[:NORMAL_ENERGIZING_SUBSTATION]->(:Substation) } RETURN f.uri'), []);
const twin = read('examples/twin/korea_virtual_grid.ttl');
for (const s of Object.values(SUBSTATIONS)) assert.ok(twin.includes(s.iri.replace('http://example.org/kr-twin#', 'ex:') + ' a cim:Substation'), `${s.ko}: not a twin substation`);
assert.equal(q(`MATCH (:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation) WHERE s.name ENDS WITH '(가상)' RETURN count(DISTINCT s)`)[0][0], 5);
// DER 노드는 VPP 라벨과 CIM 상위 클래스 라벨을 함께 가짐
assert.deepEqual(q('MATCH (d:BatterySystem) WHERE NOT d:BatteryUnit OR NOT d:DER RETURN d.derId'), []);
assert.ok(q('MATCH (d:PhotoVoltaicUnit) RETURN count(d)')[0][0] > 0);
console.log('✓ every DER has one VPP and one feeder; every feeder reaches a digital-twin substation; CIM labels present');

// 3) 정산 계산: 수익 = 실적 × SMP, 오차 범위 안이면 벌칙 0 · 밖이면 벌칙 > 0
for (const v of VPPS) for (const s of sim.settle[v.id]) {
  assert.equal(s.revenue, Math.round(s.actual * 1000 * SMP[s.h]));
  if (s.bid > 0) {
    const out = Math.abs(s.actual - s.bid) > RULE.tolerance * s.bid + 1e-9;
    assert.equal(s.penalty > 0, out && Math.round((Math.abs(s.actual - s.bid) - RULE.tolerance * s.bid) * 1000 * SMP[s.h] * RULE.penaltyRate) > 0, `${v.id} ${s.h}h`);
    if (!out) assert.ok(s.incentive > 0 || s.actual === 0);
  }
}
// 출력제한 지시는 역송이 한도를 넘은 선로에만, 영향받은 DER은 그 선로의 태양광 · 풍력
assert.ok(sim.curtail.length > 0);
assert.deepEqual(q(`MATCH (ci:CurtailmentInstruction)-[:ON_FEEDER]->(f:Feeder) WHERE ci.reverseFlowMW <= f.hostingCapacityMW RETURN ci.uri`), []);
assert.deepEqual(q(`MATCH (ci:CurtailmentInstruction)-[:AFFECTS]->(d), (ci)-[:ON_FEEDER]->(f)
  WHERE NOT (d:PVSystem OR d:WindSystem) OR NOT EXISTS { (d)-[:EQUIPMENT_CONTAINER]->(f) } RETURN d.derId`), []);
console.log(`✓ settlement arithmetic; ${sim.curtail.length} curtailments only where reverse flow exceeds the feeder limit`);

// 4) 이야기가 맞는지: ESS가 있는 VPP가 오차 범위를 더 잘 지킴, 전주 오후 구름으로 VPP01이 14시에 크게 모자람
const band = Object.fromEntries(q(VPP_CYPHER[6].q).map(r => [String(r[0]), r[3]]));
assert.ok(band.true > band.false, 'VPPs with a battery stay in band more often');
const at14 = Object.fromEntries(q(VPP_CYPHER[4].q).map(r => [r[0], r[4]]));
assert.ok(at14.VPP01 < -RULE.tolerance * 100);
console.log('✓ battery VPPs stay in band more often; VPP01 misses at 14:00');

// 5) 역량 질문이 모두 실행되고 결과가 있음 (영어 질의도)
for (const c of VPP_CYPHER) { assert.ok(q(c.q).length > 0, c.ko); assert.ok(q(c.qEn).length > 0, c.en); }
console.log(`✓ ${VPP_CYPHER.length} competency questions return rows (ko · en)`);

// 6) Cypher 엔진: 앞의 OPTIONAL MATCH에서 null이 된 변수는 다음 OPTIONAL MATCH에서 아무것과도 매칭되지 않음
{
  const r = q(`MATCH (h:MarketInterval {hour: 0})
OPTIONAL MATCH (b:Bid)-[:FOR_INTERVAL]->(h), (b)-[:SUBMITTED_BY]->(:VirtualPowerPlant {vppId: 'VPP01'})
OPTIONAL MATCH (s:Settlement)-[:SETTLES]->(b)
RETURN b, s`);
  assert.deepEqual(r, [[null, null]]);
}
console.log('✓ a null variable from OPTIONAL MATCH does not re-bind in a later pattern');
