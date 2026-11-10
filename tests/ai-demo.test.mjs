// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// AI × 온톨로지 시연 테스트 — 실행: node tests/ai-demo.test.mjs
// 시연의 Cypher가 모두 실제 그래프에서 실행되고, 답 · 보고서가 결과의 사실을 담는지 확인
import assert from 'node:assert/strict';
import { GRAPHRAG, AGENT, GRAPHRAG_FILES, AGENT_FILES, toEn } from '../assets/ai/ai-scenarios.js';
import { loadGraph } from '../tools/load.mjs';
import { runCypher } from '../assets/cypher/cypher.js';

const G1 = await loadGraph(...GRAPHRAG_FILES), G2 = await loadGraph(...AGENT_FILES);
const rows = (G, q) => runCypher(G, q).rows;

// 1) GraphRAG: 질의 · 보조 질의 · 근거 질의가 결과를 내고, 답(한 · 영)이 만들어짐
const ans = {};
for (const s of GRAPHRAG) {
  const r = rows(G1, s.cypher), x = rows(G1, s.extra), f = rows(G1, s.focus);
  assert.ok(r.length && x.length && f.length, `${s.id}: every query returns rows`);
  assert.deepEqual(rows(G1, toEn(s.cypher)).length, r.length, `${s.id}: English query returns the same rows`);
  ans[s.id] = s.answer(r, x, false);
  assert.ok(s.answer(r, x, true).length > 40);
}
assert.match(ans.curtail, /VPP01/); assert.match(ans.curtail, /VPP02/); assert.doesNotMatch(ans.curtail, /VPP03/);
assert.match(ans.shared, /4개 VPP/);
assert.match(ans.why14, /VPP01/); assert.match(ans.why14, /그래프에 없습니다/);
assert.match(ans.best, /VPP04/);
console.log(`✓ ${GRAPHRAG.length} GraphRAG questions run on the VPP graph and their answers carry the result facts`);

// 2) 에이전트: 모든 도구가 결과를 내고, 보고서의 숫자가 결과와 같음
const R = AGENT.steps.map(st => { const r = rows(G2, st.cypher); assert.ok(r.length, st.tool); assert.ok(rows(G2, st.focus).length, st.tool + ' focus'); st.observe(r, false); st.observe(r, true); return r; });
const rep = AGENT.report(R, false).join('\n');
const customers = R[2].reduce((a, r) => a + r[2], 0);
assert.equal(R[0][0][0], 'AS-TR-0007');
assert.match(rep, new RegExp(customers.toLocaleString('en-US')));
assert.match(rep, /아라 병원/);
assert.equal(AGENT.report(R, true).length, 6);
console.log(`✓ agent: ${AGENT.steps.length} tool calls run on the asset/feeder graph; report says ${customers} customers, critical load named`);
