// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 데이터베이스 접근 페이지들이 함께 쓰는 화면 도우미 (결과 표 · SQL 색칠 · 막대)
import { esc, T } from '../lib/dom.js?v=3b73d59c';

const KWS = 'SELECT|FROM|WHERE|AND|OR|NOT|ORDER BY|GROUP BY|LIMIT|JOIN|LEFT|INNER|ON|AS|IN|LIKE|IS|NULL|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|DROP TABLE|BEGIN|COMMIT|ROLLBACK|COUNT|AVG|MIN|MAX|SUM|DESC|ASC';
const RE = new RegExp(`(--[^\\n]*)|('(?:[^']|'')*')|\\b(${KWS})\\b`, 'g');
export const sqlHtml = (sql) => esc(sql).replace(RE, (m, c, s, k) => (c ? `<span class="cm">${c}</span>` : s ? `<span class="str">${s}</span>` : `<b class="kw">${k}</b>`));

export function tableHtml(cols, rows, { max = 30 } = {}) {
  if (!rows.length) return `<p class="meta">${T('(결과 없음 — 0행)', '(no result — 0 rows)')}</p>`;
  const shown = rows.slice(0, max);
  const head = cols.map(c => `<th>${esc(c)}</th>`).join('');
  const body = shown.map(r => `<tr>${cols.map(c => `<td>${r[c] === null || r[c] === undefined ? '<i class="nul">NULL</i>' : esc(r[c])}</td>`).join('')}</tr>`).join('');
  return `<div class="net-scroll"><table class="net-tab db-res"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` +
    (rows.length > max ? `<p class="meta">… ${rows.length - max} ${T('행 더', 'more rows')}</p>` : '');
}

export const tag = (ok, ko, en) => `<span class="db-tag ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${T(ko, en)}</span>`;
export const jsonHtml = (v) => esc(JSON.stringify(v, null, 2));
export const kb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
