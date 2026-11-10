// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Turtle 해석: 글 → quad 배열 (RDF/JS 모양: termType, value, language, datatype). 브라우저와 Node가 같은 코드를 씀.
// N3.js(약 0.2MB)만 사용. 예전의 Oxigraph WebAssembly(4.3MB)는 Turtle 해석에만 쓰였기 때문에 바꿈.
import { Parser } from '../vendor/n3/n3.esm.min.js';

export function parse(text, { base_iri } = {}) {
  return new Parser({ format: 'text/turtle', baseIRI: base_iri }).parse(text);
}
