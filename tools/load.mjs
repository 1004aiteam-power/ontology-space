// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Turtle 파일들을 읽어 Neo4j식 속성 그래프로 (Oxigraph는 Turtle 해석에만 사용). 테스트와 tools/cypher.mjs에서 씀
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import init, { parse } from '../assets/vendor/oxigraph/web.js';
import { buildGraph } from '../assets/cypher/graph.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let ready = null;
export async function loadGraph(...files) {
  ready ??= init({ module_or_path: readFileSync(ROOT + 'assets/vendor/oxigraph/web_bg.wasm') });
  await ready;
  const quads = [];
  for (const f of files) quads.push(...parse(readFileSync(isAbsolute(f) ? f : ROOT + f, 'utf8'), { format: 'text/turtle', base_iri: 'http://example.org/base' }));
  return buildGraph(quads);
}
