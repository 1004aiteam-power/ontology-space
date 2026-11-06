// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 브라우저용 Cypher 엔진 테스트 — 실행: node tests/cypher.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGraph } from './cypher-load.mjs';
import { runCypher, CypherError } from '../assets/cypher/cypher.js';
import { EV_FILES, EV_CYPHER, IMPACT_FILES, IMPACT_CYPHER } from '../assets/cypher/cq.js';
import { DATASETS, QUERIES } from '../assets/cypher/presets.js';

const run = (G, q) => runCypher(G, q);
const cell = (v) => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v));

// 1) 작은 그래프에서 문법 하나하나
{
  const quads = [];
  const nn = (v) => ({ termType: 'NamedNode', value: 'http://x/#' + v });
  const lit = (v, dt = 'string') => ({ termType: 'Literal', value: String(v), datatype: { value: 'http://www.w3.org/2001/XMLSchema#' + dt } });
  const T = (s, p, o) => quads.push({ subject: nn(s), predicate: p === 'a' ? { value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' } : nn(p), object: o });
  T('Breaker', 'http://www.w3.org/2000/01/rdf-schema#subClassOf', nn('Switch'));
  quads[0].predicate = { value: 'http://www.w3.org/2000/01/rdf-schema#subClassOf' };
  for (const [id, cls, name, kv] of [['a', 'Breaker', 'A', 154], ['b', 'Switch', 'B', 22.9], ['c', 'Breaker', 'C', 22.9], ['d', 'Load', 'D', null]]) {
    T(id, 'a', nn(cls)); T(id, 'Thing.name', lit(name)); if (kv != null) T(id, 'kv', lit(kv, 'decimal'));
  }
  T('a', 'feeds', nn('b')); T('b', 'feeds', nn('c')); T('c', 'feeds', nn('d')); T('a', 'tieTo', nn('c'));
  const G = (await import('../assets/cypher/graph.js')).buildGraph(quads);
  const q = (s) => run(G, s).rows.map(r => r.map(cell).join('|'));
  assert.deepEqual(q('MATCH (s:Switch) RETURN s.name ORDER BY s.name'), ['A', 'B', 'C'], 'superclass label from rdfs:subClassOf');
  assert.deepEqual(q('MATCH (a {name: "A"})-[:FEEDS*]->(x) RETURN x.name ORDER BY x.name'), ['B', 'C', 'D'], 'variable length');
  assert.deepEqual(q('MATCH (a {name: "A"})-[:FEEDS*2]->(x) RETURN x.name'), ['C'], 'exact length');
  assert.deepEqual(q('MATCH (x)<-[:FEEDS]-(y) RETURN x.name, y.name ORDER BY x.name'), ['B|A', 'C|B', 'D|C'], 'incoming direction');
  assert.deepEqual(q('MATCH (n) OPTIONAL MATCH (n)-[:TIE_TO]->(t) RETURN n.name, t.name ORDER BY n.name'), ['A|C', 'B|', 'C|', 'D|'], 'optional match');
  assert.deepEqual(q('MATCH (n) WHERE n.kv IS NOT NULL RETURN count(*), sum(n.kv), min(n.kv), max(n.name)'), ['3|199.8|22.9|C'], 'aggregates');
  assert.deepEqual(q('MATCH (n:Switch) RETURN n.kv AS kv, collect(n.name) AS names ORDER BY kv'), ['22.9|B,C', '154|A'], 'grouping + collect');
  assert.deepEqual(q('MATCH (n) WHERE NOT EXISTS { (n)-[:FEEDS]->() } RETURN n.name'), ['D'], 'EXISTS subquery');
  assert.deepEqual(q('MATCH (n) WHERE (n)-[:TIE_TO]->() RETURN n.name'), ['A'], 'pattern predicate');
  assert.deepEqual(q('MATCH p = (a {name: "A"})-[:FEEDS*]->(:Load) RETURN length(p), [x IN nodes(p) | x.name]'), ['3|A,B,C,D'], 'path + list comprehension');
  assert.deepEqual(q('MATCH (n) WITH n.name AS nm WHERE nm IN ["A", "D"] RETURN nm ORDER BY nm DESC'), ['D', 'A'], 'WITH … WHERE, IN, DESC');
  assert.deepEqual(q('MATCH (n) WHERE n.name STARTS WITH "C" OR n.name ENDS WITH "B" RETURN n.name ORDER BY n.name SKIP 1 LIMIT 1'), ['C'], 'string ops, skip/limit');
  assert.deepEqual(q('UNWIND [3, 1, 2] AS x RETURN x * 10 AS y ORDER BY y'), ['10', '20', '30'], 'UNWIND + arithmetic');
  assert.deepEqual(q('MATCH (n) RETURN CASE WHEN n.kv > 100 THEN "HV" ELSE "LV" END AS v, count(*) AS c ORDER BY v'), ['HV|1', 'LV|3'], 'CASE + count');
  assert.deepEqual(q('MATCH (a)-[r]->(b) RETURN type(r) AS t, count(*) ORDER BY t'), ['FEEDS|3', 'TIE_TO|1'], 'type()');
  assert.deepEqual(q('MATCH (a)-[:FEEDS]-(b) WHERE a.name = "B" RETURN b.name ORDER BY b.name'), ['A', 'C'], 'undirected');
  assert.throws(() => run(G, 'CREATE (n:X) RETURN n'), CypherError, 'write clauses rejected');
  assert.throws(() => run(G, 'MATCH (n) RETURN m'), CypherError, 'unknown variable');
  assert.throws(() => run(G, 'MATCH (n RETURN n'), CypherError, 'syntax error');
  console.log('✓ Cypher syntax: labels, paths, optional, aggregates, EXISTS, WITH, UNWIND, CASE, errors');
}

// 2) 실습 페이지 예제 질의가 모든 데이터에서 오류 없이 돌고, 예제 변전소에서는 기대한 답
{
  for (const [key, ds] of Object.entries(DATASETS)) {
    const G = await loadGraph(ds.file, 'shapes/cim-classes.ttl');
    for (const p of QUERIES) {
      const r = run(G, p.q);
      assert.ok(Array.isArray(r.rows), `${key}: ${p.en} runs`);
    }
    if (key === 'full') {
      const rows = (i) => run(G, QUERIES[i].q).rows.map(r => r.map(cell));
      assert.deepEqual(rows(QUERIES.findIndex(p => p.en === 'Total load')), [['1', '8.5', '2.1']]);
      assert.equal(rows(QUERIES.findIndex(p => p.en.startsWith('All conducting'))).length, 8);
      assert.equal(rows(QUERIES.findIndex(p => p.en.startsWith('Adjacent'))).length, 9);
      const path = rows(QUERIES.findIndex(p => p.en.startsWith('Source to load')));
      assert.deepEqual(path[0].slice(0, 3), ['B변전소 계통', 'D/L #1 부하', '20']);
    }
  }
  console.log(`✓ ${QUERIES.length} lab presets run on all ${Object.keys(DATASETS).length} datasets; sample answers as expected`);
}

// 3) 전기차·고장 영향 페이지의 Cypher 질의 = 데이터 파일에 기록된 결과
for (const [name, files, queries] of [['ev', EV_FILES, EV_CYPHER], ['impact', IMPACT_FILES, IMPACT_CYPHER]]) {
  const D = JSON.parse(readFileSync(new URL(`../assets/data/${name}.json`, import.meta.url)));
  const G = await loadGraph(...files);
  assert.equal(D.cq.length, queries.length);
  D.cq.forEach((c, i) => {
    assert.equal(c.cypher, queries[i], `${name} Q${i + 1}: data file carries the same Cypher text`);
    const got = run(G, queries[i]).rows.map(r => r.map(cell));
    const want = c.rows.map(r => r.map(v => cell(isNaN(+v) || v === '' ? v : +v)));
    const sorted = (x) => [...x].map(r => r.join('|')).sort();
    assert.deepEqual(sorted(got), sorted(want), `${name} Q${i + 1}: ${c.en}`);
  });
  console.log(`✓ ${name}: ${queries.length} Cypher questions return the recorded results`);
}

// 4) 다시 빌드해도 같은 Cypher가 나오도록: 빌드 스크립트의 CYPHER 목록 = cq.js
for (const [f, Q] of [['examples/ev/build_ev.py', EV_CYPHER], ['examples/impact/build_impact.py', IMPACT_CYPHER]]) {
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('CYPHER = ['), src.indexOf('\n]\n', src.indexOf('CYPHER = [')));
  assert.deepEqual([...block.matchAll(/"""([\s\S]*?)"""/g)].map(m => m[1]), Q, `${f}: CYPHER matches assets/cypher/cq.js`);
}
console.log('✓ build scripts carry the same Cypher text');
