#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 명령줄에서 Cypher 실행 (Neo4j 없이, 브라우저 실습과 같은 엔진: assets/cypher/cypher.js)
//
//   node tools/cypher.mjs [--ttl a.ttl,b.ttl] [--load import.cypher] [--queries q.cypher] [--checks c.cypher] [--query "MATCH …"] [--json]
//
//   --ttl      Turtle 파일을 Neo4j식 속성 그래프로 불러옴 (클래스 → 라벨, 값 → 속성, 개체 연결 → 관계)
//   --load     쓰기 Cypher 스크립트 실행 (CREATE · MERGE · SET · FOREACH · CREATE CONSTRAINT)
//   --queries  읽기 질의 파일. 문장마다 결과를 출력 (문장 앞 // 주석 = 제목)
//   --checks   형상검증 규칙 파일. 규칙마다 위반 행을 출력 (머리글: // [ID] Violation|Warning | 한국어 / English)
//   --json     사람이 읽는 표 대신 JSON (빌드 스크립트용)
// 여러 번 쓸 수 있고, 지정한 순서대로 실행합니다. 위반(Violation)이 하나라도 있으면 종료 코드 1
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { loadGraph } from './load.mjs';
import { runCypher, show } from '../assets/cypher/cypher.js';
import { splitStatements, parseChecks } from '../assets/cypher/script.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (f) => (isAbsolute(f) ? f : ROOT + f);

// 결과 값 → JSON (노드는 이름, 관계는 타입)
export function plain(v) {
  if (v == null || typeof v !== 'object') return v ?? null;
  if (Array.isArray(v)) return v.map(plain);
  if (v.kind === 'node') return v.props.name ?? v.props.label ?? v.props.id ?? v.props.code ?? v.props.uri ?? null;
  if (v.kind === 'rel') return v.type;
  if (v.kind === 'path') return v.nodes.map(plain);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
}

export async function run(steps) {
  const ttl = steps.filter(s => s[0] === 'ttl').flatMap(s => s[1].split(',')).map(abs);
  const G = ttl.length ? await loadGraph(...ttl) : { nodes: [], rels: [], byLabel: new Map(), byUri: new Map() };
  const out = { queries: [], checks: [] };
  for (const [kind, arg] of steps) {
    if (kind === 'load') runCypher(G, readFileSync(abs(arg), 'utf8'), { write: true });
    if (kind === 'query') { const r = runCypher(G, arg); out.queries.push({ title: '', columns: r.columns, rows: r.rows.map(row => row.map(plain)) }); }
    if (kind === 'queries') for (const { comments, query } of splitStatements(readFileSync(abs(arg), 'utf8'))) {
      const r = runCypher(G, query);
      out.queries.push({ title: (comments[comments.length - 1] || '').trim(), columns: r.columns, rows: r.rows.map(row => row.map(plain)) });
    }
    if (kind === 'checks') for (const c of parseChecks(readFileSync(abs(arg), 'utf8'))) {
      const r = runCypher(G, c.query);
      out.checks.push({ id: c.id, severity: c.severity, ko: c.ko, en: c.en, columns: r.columns, rows: r.rows.map(row => row.map(plain)) });
    }
  }
  out.graph = { nodes: G.nodes.length, relationships: G.rels.length };
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2), steps = [];
  let json = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--json') { json = true; continue; }
    const m = /^--(ttl|load|queries|checks|query)$/.exec(a[i]);
    if (!m || a[i + 1] == null) { console.error(`알 수 없는 옵션: ${a[i]}\n사용법은 파일 맨 위 주석을 보세요`); process.exit(2); }
    steps.push([m[1], a[++i]]);
  }
  try {
    const out = await run(steps);
    if (json) process.stdout.write(JSON.stringify(out));
    else {
      console.log(`그래프: 노드 ${out.graph.nodes}개 · 관계 ${out.graph.relationships}개`);
      for (const q of out.queries) { console.log(`\n# ${q.title}`); console.log(q.columns.join(' | ')); for (const r of q.rows) console.log(r.map(v => show(v)).join(' | ')); }
      for (const c of out.checks) {
        console.log(`${c.rows.length ? (c.severity === 'Warning' ? '⚠' : '✗') : '✓'} [${c.id}] ${c.ko}${c.rows.length ? ` — ${c.rows.length}건` : ''}`);
        for (const r of c.rows) console.log('    ' + c.columns.map((k, i) => `${k}=${show(r[i])}`).join(', '));
      }
    }
    process.exit(out.checks.some(c => c.severity === 'Violation' && c.rows.length) ? 1 : 0);
  } catch (e) { console.error('⚠ ' + (e.message || e)); process.exit(2); }
}
