#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 훈련 시뮬레이션(assets/safety/safety.js) → 안전 온톨로지 개체 데이터(Turtle), 역량 질문을 Cypher로 실행해 출력
//
//   node examples/safety/build_safety.mjs
//
// 결과: examples/safety/safety-steps.ttl (스키마 safety-schema.ttl과 함께 Neo4j · rdflib로 불러올 수 있음)
// 시뮬레이션의 단계 · 수칙 · 오답을 고치면 이 스크립트를 다시 실행하세요 (tests/safety-graph.test.mjs가 확인)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { triples, toTurtle, SAFETY_CYPHER, SAFETY_SCHEMA, SAFETY_DATA, LINKED_FILES } from '../../assets/safety/safety-graph.js';
import { loadGraph } from '../../tools/load.mjs';
import { runCypher, show } from '../../assets/cypher/cypher.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const list = triples();
writeFileSync(ROOT + SAFETY_DATA, toTurtle(list));
console.log(`트리플 ${list.length}개 → ${SAFETY_DATA}`);

const G = await loadGraph(SAFETY_SCHEMA, SAFETY_DATA, ...LINKED_FILES);
for (const c of SAFETY_CYPHER) {
  const r = runCypher(G, c.q);
  console.log(`\n# ${c.ko}\n${r.columns.join(' | ')}`);
  for (const row of r.rows) console.log(row.map(v => show(v)).join(' | '));
}
