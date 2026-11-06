// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// .cypher 파일 나누기: 문장(;) 단위 + 문장 앞의 // 주석
//
// 검사(형상검증) 파일 규칙 — 문장 하나가 규칙 하나, 결과 행 하나가 위반 하나:
//   // [규칙ID] Violation|Warning | 한국어 설명 / English description
//   MATCH … WHERE (규칙을 어긴 조건) RETURN … AS focus, …

export function splitStatements(text) {
  const out = [];
  let buf = '', comments = [], q = null;
  const flush = () => { const query = buf.trim(); if (query) out.push({ comments, query }); buf = ''; comments = []; };
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!q && !buf.trim() && t.startsWith('//')) { comments.push(t.replace(/^\/\/\s?/, '')); continue; }
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { buf += c; if (c === '\\') { buf += line[++i] ?? ''; } else if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; buf += c; continue; }
      if (c === '/' && line[i + 1] === '/') { buf += line.slice(i); break; }
      if (c === ';') { flush(); continue; }
      buf += c;
    }
    buf += '\n';
  }
  flush();
  return out;
}

const HEAD = /^\[([A-Za-z0-9_-]+)\]\s*(Violation|Warning)\s*\|\s*(.+?)\s+\/\s+(.+)$/;
export function parseChecks(text) {
  return splitStatements(text).map(({ comments, query }) => {
    const h = comments.map(c => HEAD.exec(c)).find(Boolean);
    if (!h) throw new Error('검사 규칙 머리글(// [ID] Violation|Warning | 한국어 / English)이 없습니다: ' + query.slice(0, 60));
    return { id: h[1], severity: h[2], ko: h[3], en: h[4], query };
  });
}
