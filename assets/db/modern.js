// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 최근 흐름 두 가지를 작게 만들어 본다. (1) 표에서 REST API를 자동으로 만드는 방식(PostgREST · Supabase 스타일): 주소 → SQL.
// (2) AI 에이전트가 DB를 쓰는 방식: 자연어 → SQL 초안 → 안전 점검(guardrail) 뒤에 실행. 자연어를 SQL로 바꾸는 부분은 LLM이 아니라 규칙으로 흉내 낸 대역이다.
// 브라우저 없이 테스트: tests/db.test.mjs
import { analyze, SqlError } from './minisql.js?v=7ebfcdc8';
import { SCHEMA } from './data.js?v=b680931a';

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const OPS = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE' };
const REL = {
  assets: { substations: { one: true, on: (m, e) => `${e}.id = ${m}.substation_id` } },
  substations: { assets: { one: false, on: (m, e) => `${e}.substation_id = ${m}.id` } }
};

const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; } if (cur) out.push(cur); return out; };

// 주소(경로 + 질의)를 SQL 로. 예: /assets?select=name,health&type=eq.transformer&order=health.desc&limit=3
export function postgrestToSQL(url) {
  const u = new URL(url, 'http://x');
  const table = u.pathname.replace(/^\//, '');
  if (!SCHEMA[table]) throw new ApiError(404, `relation "${table}" does not exist`);
  const cols = SCHEMA[table];
  const col = (c) => { if (!cols.includes(c)) throw new ApiError(400, `column ${table}.${c} does not exist`); return c; };
  const sel = u.searchParams.get('select');
  const items = sel ? splitTop(sel) : cols;
  const own = [], embeds = [];
  for (const it of items) {
    const m = /^(\w+)\((.*)\)$/.exec(it);
    if (!m) { own.push(col(it === '*' ? '*' : it)); continue; }
    const rel = REL[table][m[1]];
    if (!rel) throw new ApiError(400, `no relationship between ${table} and ${m[1]}`);
    const ecols = m[2].split(',').filter(Boolean);
    for (const c of ecols) if (!SCHEMA[m[1]].includes(c)) throw new ApiError(400, `column ${m[1]}.${c} does not exist`);
    embeds.push({ name: m[1], cols: ecols.length ? ecols : SCHEMA[m[1]], rel });
  }
  const ownCols = own.includes('*') ? cols : own;
  const emb = embeds[0];
  const q = (c) => (emb ? `m.${c}` : c);
  const params = [], where = [];
  const RESERVED = ['select', 'order', 'limit'];
  for (const [k, v] of u.searchParams) {
    if (RESERVED.includes(k)) continue;
    const m = /^([a-z]+)\.(.*)$/.exec(v);
    if (!m) throw new ApiError(400, `bad filter on ${k}: use operator.value, for example eq.5`);
    col(k);
    const [, op, val] = m;
    if (op === 'is' && val === 'null') where.push(`${q(k)} IS NULL`);
    else if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(','); where.push(`${q(k)} IN (${list.map(() => '?').join(', ')})`); params.push(...list.map(x => (x !== '' && !isNaN(x) ? Number(x) : x))); }
    else if (OPS[op]) { where.push(`${q(k)} ${OPS[op]} ?`); params.push(op === 'like' ? val.replace(/\*/g, '%') : (val !== '' && !isNaN(val) ? Number(val) : val)); }
    else throw new ApiError(400, `unknown operator "${op}"`);
  }
  const order = u.searchParams.get('order');
  const orderBy = order ? order.split(',').map(x => { const [c, d] = x.split('.'); col(c); return `${q(c)} ${d === 'desc' ? 'DESC' : 'ASC'}`; }) : [];
  const limit = u.searchParams.get('limit');
  if (limit !== null && !/^\d+$/.test(limit)) throw new ApiError(400, 'limit must be a non-negative integer');
  const selectSql = emb ? [...ownCols.map(c => `m.${c}`), ...emb.cols.map(c => `e.${c} AS ${emb.name}__${c}`)] : ownCols;
  let sql = `SELECT ${selectSql.join(', ')} FROM ${table}${emb ? ' m LEFT JOIN ' + emb.name + ' e ON ' + emb.rel.on('m', 'e') : ''}`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  if (orderBy.length) sql += ` ORDER BY ${orderBy.join(', ')}`;
  const sqlLimit = limit !== null && !(emb && !emb.rel.one);          // 하위 목록을 품은 조회는 상위 행 수로 자르므로 SQL 에는 안 붙임
  if (sqlLimit) sql += ` LIMIT ${limit}`;
  return { table, sql, params, ownCols, emb, limit: limit === null ? null : Number(limit) };
}

export function runPostgrest(db, url) {
  let p;
  try { p = postgrestToSQL(url); } catch (e) { if (e instanceof ApiError) return { status: e.status, body: { message: e.message }, sql: null, params: [] }; throw e; }
  db.resetLog();
  const r = db.exec(p.sql, p.params);
  let body;
  if (!p.emb) body = r.rows;
  else if (p.emb.rel.one) body = r.rows.map(row => { const o = Object.fromEntries(p.ownCols.map(c => [c, row[c]])); o[p.emb.name] = row[`${p.emb.name}__${p.emb.cols[0]}`] === null && p.emb.cols.every(c => row[`${p.emb.name}__${c}`] === null) ? null : Object.fromEntries(p.emb.cols.map(c => [c, row[`${p.emb.name}__${c}`]])); return o; });
  else {
    const map = new Map();
    for (const row of r.rows) {
      const key = JSON.stringify(p.ownCols.map(c => row[c]));
      if (!map.has(key)) { const o = Object.fromEntries(p.ownCols.map(c => [c, row[c]])); o[p.emb.name] = []; map.set(key, o); }
      if (p.emb.cols.some(c => row[`${p.emb.name}__${c}`] !== null)) map.get(key)[p.emb.name].push(Object.fromEntries(p.emb.cols.map(c => [c, row[`${p.emb.name}__${c}`]])));
    }
    body = [...map.values()];
    if (p.limit !== null) body = body.slice(0, p.limit);
  }
  return { status: 200, body, sql: p.sql, params: p.params };
}

// ---- 에이전트용 안전 점검 ----
// SQL 초안이 아래를 모두 지켜야 실행한다: 문장 하나 · SELECT 만 · 허용된 표만 · 행 수 상한(없으면 붙이고, 크면 줄임)
export function guard(sql, { allow = ['assets', 'substations'], maxRows = 50 } = {}) {
  const problems = [];
  let info;
  try { info = analyze(sql); } catch (e) { if (e instanceof SqlError) return { ok: false, problems: [{ code: 'parse', ko: `SQL을 읽을 수 없음: ${e.message}`, en: `Cannot parse the SQL: ${e.message}` }], sql }; throw e; }
  if (info.length !== 1) problems.push({ code: 'multi', ko: '문장은 하나만 허용', en: 'Only one statement is allowed' });
  for (const s of info) {
    if (s.kind !== 'select') problems.push({ code: 'readonly', ko: `${s.kind.toUpperCase()} 문은 막음 (읽기 전용)`, en: `${s.kind.toUpperCase()} is blocked (read-only)` });
    for (const t of s.tables) if (!allow.includes(t)) problems.push({ code: 'table', ko: `허용 목록에 없는 표: ${t}`, en: `Table not on the allow-list: ${t}` });
  }
  let out = sql.trim().replace(/;+\s*$/, '');
  const note = [];
  if (!problems.length) {
    const lim = info[0].limit;
    if (lim === null) { out += ` LIMIT ${maxRows}`; note.push({ ko: `행 수 상한 LIMIT ${maxRows} 추가`, en: `Added a row cap: LIMIT ${maxRows}` }); }
    else if (lim > maxRows) { out = out.replace(/LIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`); note.push({ ko: `LIMIT ${lim} → ${maxRows} 으로 줄임`, en: `Reduced LIMIT ${lim} to ${maxRows}` }); }
  }
  return { ok: problems.length === 0, problems, notes: note, sql: out };
}

// 자연어 → SQL 초안 (규칙으로 흉내 낸 대역: 실제로는 LLM이 스키마 설명을 보고 만든다)
const TYPE_WORDS = { transformer: /transformer|변압기/i, breaker: /breaker|차단기/i, cable: /cable|케이블/i, relay: /relay|계전기/i };
export function nlToSql(q) {
  const type = Object.keys(TYPE_WORDS).find(k => TYPE_WORDS[k].test(q));
  if (/delete|drop|삭제|지워|지우/i.test(q)) return "DELETE FROM assets WHERE health < 60";
  if (/user|password|salary|사용자|비밀번호|급여/i.test(q)) return 'SELECT * FROM users';
  if (/average|avg|평균/i.test(q)) return 'SELECT s.name, AVG(a.health) AS avg_health FROM assets a JOIN substations s ON a.substation_id = s.id GROUP BY s.name ORDER BY avg_health DESC';
  if (/how many|count|몇|개수|수는/i.test(q)) return 'SELECT type, COUNT(*) AS n FROM assets GROUP BY type ORDER BY n DESC';
  if (/worst|lowest|risk|low|낮은|위험|나쁜|취약/i.test(q)) return `SELECT name, type, health FROM assets${type ? ` WHERE type = '${type}'` : ''} ORDER BY health ASC LIMIT 3`;
  if (/all|every|전체|모든/i.test(q)) return 'SELECT * FROM assets';
  return null;
}
export const NL_PRESETS = [
  { ko: '건전도가 가장 낮은 변압기들은?', en: 'Which transformers have the lowest health?' },
  { ko: '변전소별 평균 건전도를 알려 줘', en: 'Average health per substation' },
  { ko: '설비 종류별 개수는?', en: 'How many assets of each type?' },
  { ko: '모든 설비를 보여 줘', en: 'Show me every asset' },
  { ko: '건전도 60 미만 설비를 전부 삭제해', en: 'Delete every asset below health 60' },
  { ko: '사용자 비밀번호 목록을 보여 줘', en: 'List the users and their passwords' }
];
