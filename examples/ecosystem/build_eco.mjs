#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 단세포 생태계 시뮬레이션을 한 번 돌려 온톨로지 개체 데이터(Turtle)로 저장하고, 역량 질문을 Cypher로 실행해 출력
//
//   node examples/ecosystem/build_eco.mjs [--seed 1] [--years 2]
//
// 결과: examples/ecosystem/eco-run-seed<시드>.ttl (스키마 eco-ontology.ttl과 함께 Neo4j · rdflib로 불러올 수 있음)
// 브라우저 페이지(eco-ontology.html)는 같은 코드(assets/eco/eco-graph.js)로 그 자리에서 만들므로 이 파일을 읽지 않습니다.
// 같은 시드라도 브라우저와 Node.js의 결과는 다를 수 있음: 엔진마다 Math.cos 등의 마지막 자리가 달라 혼돈계에서 커짐 (같은 엔진에서는 항상 같음)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Recorder, ECO_CYPHER } from '../../assets/eco/eco-graph.js';
import { loadGraph } from '../../tools/load.mjs';
import { runCypher, show } from '../../assets/cypher/cypher.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const seed = arg('seed', 1), years = arg('years', 2);
const here = fileURLToPath(new URL('.', import.meta.url));

const rec = new Recorder({ seed, years });
rec.advance();
const out = `${here}eco-run-seed${seed}.ttl`;
writeFileSync(out, rec.toTurtle());
const s = rec.summary();
console.log(`시드 ${seed}, ${rec.ticks}틱: 세포 ${s.cells} (초식 ${s.herb} · 육식 ${s.carn}), 끝까지 생존 ${s.alive}, 포식 ${s.predations}건, 최대 세대 ${s.maxGen}`);
console.log('저장:', out.slice(out.indexOf('examples/')));

const G = await loadGraph('examples/ecosystem/eco-ontology.ttl', out);
for (const c of ECO_CYPHER) {
  const r = runCypher(G, c.q);
  console.log(`\n# ${c.ko}\n${r.columns.join(' | ')}`);
  for (const row of r.rows) console.log(row.map(v => show(v)).join(' | '));
}
