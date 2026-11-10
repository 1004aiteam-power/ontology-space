// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Turtle 파일들을 읽어 Neo4j식 속성 그래프로 (Turtle 해석은 assets/cypher/turtle.js). 테스트와 tools/cypher.mjs에서 씀
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { parse } from '../assets/cypher/turtle.js';
import { buildGraph } from '../assets/cypher/graph.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export async function loadGraph(...files) {
  const quads = [];
  for (const f of files) quads.push(...parse(readFileSync(isAbsolute(f) ? f : ROOT + f, 'utf8'), { format: 'text/turtle', base_iri: 'http://example.org/base' }));
  return buildGraph(quads);
}
