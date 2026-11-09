#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// VPP 10개가 참여하는 가상 전력시장 (assets/vpp/vpp-graph.js) → 온톨로지 개체 데이터(Turtle) → 속성 그래프 → Neo4j 적재 스크립트
//
//   node examples/vpp/build_vpp.mjs
//
// 결과: examples/vpp/vpp-market.ttl         개체 데이터 (스키마 vpp-schema.ttl과 함께 읽음)
//       examples/vpp/neo4j/import.cypher    Neo4j에 그대로 붙여 넣는 적재 스크립트 (브라우저 그래프와 같은 라벨 · 속성 · 관계)
// 역량 질문(VPP_CYPHER)을 실행해 결과도 출력합니다. vpp-graph.js를 고치면 다시 실행하세요 (tests/vpp-graph.test.mjs가 확인)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { triples, toTurtle, VPP, SUBSTATIONS, VPP_CYPHER, VPP_SCHEMA, VPP_DATA, LINKED_FILES } from '../../assets/vpp/vpp-graph.js';
import { loadGraph } from '../../tools/load.mjs';
import { runCypher, show } from '../../assets/cypher/cypher.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const NEO4J_FILE = 'examples/vpp/neo4j/import.cypher';

// 속성 그래프 → Neo4j Cypher (라벨 조합마다 UNWIND로 노드를 만들고, 관계 타입마다 UNWIND로 잇는다)
export function neo4jScript(G) {
  const subs = new Set(Object.values(SUBSTATIONS).map(s => s.iri));
  const keep = (n) => n.props.uri.startsWith(VPP) || subs.has(n.props.uri);
  const nodes = G.nodes.filter(keep), ids = new Set(nodes.map(n => n.id));
  const lit = (v) => (Array.isArray(v) ? '[' + v.map(lit).join(', ') + ']' : typeof v === 'string' ? "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'" : String(v));
  const map = (o) => '{' + Object.entries(o).map(([k, v]) => `${/^[A-Za-z_]\w*$/.test(k) ? k : '`' + k + '`'}: ${lit(v)}`).join(', ') + '}';
  const out = [
    '// VPP 가상 전력시장 — Neo4j 적재 (⚠ 가상 데이터)',
    '// 생성: examples/vpp/build_vpp.mjs  ← 이 파일을 직접 고치지 말 것',
    '// 온톨로지(vpp-schema.ttl + vpp-market.ttl)를 이 사이트의 규칙(rdf:type → 라벨 + 상위 클래스 라벨, 값 → 속성, 개체 연결 → 관계)으로 바꾼 결과입니다.',
    '// Neo4j Browser나 cypher-shell에 그대로 붙여 넣으면 웹페이지(vpp-market.html)의 그래프와 같은 노드 · 관계가 만들어집니다.',
    '// 변전소 5곳은 디지털 트윈(korea_virtual_grid.ttl)의 개체라 이름과 uri만 가져왔습니다.',
    'CREATE CONSTRAINT resource_uri IF NOT EXISTS FOR (r:Resource) REQUIRE r.uri IS UNIQUE;', ''
  ];
  const groups = new Map();
  for (const n of nodes) {
    const labels = subs.has(n.props.uri) ? ['Substation'] : n.labels;
    const props = subs.has(n.props.uri) ? { uri: n.props.uri, name: n.props.name } : n.props;
    const k = labels.join(':');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(props);
  }
  for (const [labels, rows] of groups) {
    out.push(`// ${labels} (${rows.length})`);
    out.push('UNWIND [\n  ' + rows.map(map).join(',\n  ') + '\n] AS p');
    out.push(`MERGE (n:Resource {uri: p.uri}) SET n += p, n:${labels.split(':').map(l => '`' + l + '`').join(':')};`, '');
  }
  const byType = new Map();
  for (const r of G.rels) if (ids.has(r.start.id) && ids.has(r.end.id)) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push([r.start.props.uri, r.end.props.uri]);
  }
  for (const [t, pairs] of byType) {
    out.push(`// ${t} (${pairs.length})`);
    out.push('UNWIND [\n  ' + pairs.map(([a, b]) => `[${lit(a)}, ${lit(b)}]`).join(',\n  ') + '\n] AS e');
    out.push(`MATCH (a:Resource {uri: e[0]}), (b:Resource {uri: e[1]}) MERGE (a)-[:${t}]->(b);`, '');
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = triples();
  writeFileSync(ROOT + VPP_DATA, toTurtle(list));
  console.log(`트리플 ${list.length}개 → ${VPP_DATA}`);
  const G = await loadGraph(VPP_SCHEMA, VPP_DATA, ...LINKED_FILES);
  mkdirSync(ROOT + 'examples/vpp/neo4j', { recursive: true });
  writeFileSync(ROOT + NEO4J_FILE, neo4jScript(G));
  console.log(`Neo4j 적재 스크립트 → ${NEO4J_FILE}`);
  for (const c of VPP_CYPHER) {
    const r = runCypher(G, c.q);
    console.log(`\n# ${c.ko}\n${r.columns.join(' | ')}`);
    for (const row of r.rows) console.log(row.map(v => show(v)).join(' | '));
  }
}
