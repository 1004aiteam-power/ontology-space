// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// GraphQL 맛보기: 질의 글자를 읽어(파싱) 리졸버로 실행한다. 클라이언트가 필요한 필드만 골라 한 번에 받고, 서버 안에서는 DB 질의 횟수가 관건이다.
// 지원: { 필드(인자: 값) { 하위 필드 } } · 별칭 없음 · 변수 없음. 브라우저 없이 테스트: tests/db.test.mjs
import { makeDB } from './data.js?v=b680931a';

export class GqlError extends Error {}

export function parseQuery(src) {
  const t = [...src.replace(/#.*$/gm, '').matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|[A-Za-z_]\w*|[{}():,]/g)].map(m => m[0]);
  let i = 0;
  const peek = () => t[i];
  const next = () => t[i++];
  const need = (x) => { if (next() !== x) throw new GqlError(`Syntax error: expected "${x}"`); };
  const value = () => {
    const v = next();
    if (v === undefined) throw new GqlError('Syntax error: unexpected end');
    if (v[0] === '"') return JSON.parse(v);
    if (/^-?\d/.test(v)) return Number(v);
    return v;                          // true · false · 열거형 이름
  };
  function selection() {
    need('{');
    const out = [];
    while (peek() !== '}') {
      if (peek() === undefined) throw new GqlError('Syntax error: unexpected end');
      const name = next();
      if (!/^[A-Za-z_]/.test(name)) throw new GqlError(`Syntax error: unexpected "${name}"`);
      const args = {};
      if (peek() === '(') {
        next();
        while (peek() !== ')') { const k = next(); need(':'); args[k] = value(); if (peek() === ',') next(); }
        next();
      }
      out.push({ name, args, sub: peek() === '{' ? selection() : null });
      if (peek() === ',') next();
    }
    next();
    return out;
  }
  if (peek() === 'query') { next(); if (peek() !== '{') next(); }
  const sel = selection();
  if (i < t.length) throw new GqlError(`Syntax error: unexpected "${peek()}"`);
  return sel;
}

// 스키마: 타입마다 필드 → 리졸버. 객체 필드는 type 이름을 가진다
const SCALARS = { Substation: ['id', 'name', 'region'], Asset: ['id', 'type', 'name', 'health', 'installed'] };

// loader=true 면 같은 틱 안의 요청을 모아 한 번에 묻는다(DataLoader). 아니면 부모마다 따로 묻는다
export function execute(src, { loader = false, db = makeDB() } = {}) {
  const ast = parseQuery(src);
  const cache = new Map();
  const assetsOf = (s) => {
    if (!loader) return db.exec('SELECT * FROM assets WHERE substation_id = ?', [s.id]).rows;
    if (!cache.has('assets')) cache.set('assets', db.exec('SELECT * FROM assets WHERE substation_id IN (' + parents.map(p => `'${p.id}'`).join(', ') + ')').rows);
    return cache.get('assets').filter(a => a.substation_id === s.id);
  };
  const subOf = (a) => {
    if (!loader) return db.exec('SELECT * FROM substations WHERE id = ?', [a.substation_id]).rows[0];
    if (!cache.has('subs')) cache.set('subs', db.exec('SELECT * FROM substations').rows);
    return cache.get('subs').find(s => s.id === a.substation_id);
  };
  let parents = [];
  const ROOT = {
    substations: () => ({ type: 'Substation', list: true, rows: db.exec('SELECT * FROM substations').rows }),
    substation: (a) => ({ type: 'Substation', list: false, rows: db.exec('SELECT * FROM substations WHERE id = ?', [a.id]).rows }),
    assets: (a) => {
      const w = [], p = [];
      if (a.type !== undefined) { w.push('type = ?'); p.push(a.type); }
      if (a.minHealth !== undefined) { w.push('health >= ?'); p.push(a.minHealth); }
      return { type: 'Asset', list: true, rows: db.exec(`SELECT * FROM assets${w.length ? ' WHERE ' + w.join(' AND ') : ''}`, p).rows };
    }
  };
  const REL = { Substation: { assets: (s) => ({ type: 'Asset', list: true, rows: assetsOf(s) }) }, Asset: { substation: (a) => ({ type: 'Substation', list: false, rows: [subOf(a)] }) } };

  function resolve(type, row, sel) {
    const o = {};
    for (const f of sel) {
      if (SCALARS[type].includes(f.name)) { if (f.sub) throw new GqlError(`Field "${f.name}" must not have a selection (it is a scalar)`); o[f.name] = row[f.name]; continue; }
      const rel = REL[type][f.name];
      if (!rel) throw new GqlError(`Cannot query field "${f.name}" on type "${type}"`);
      if (!f.sub) throw new GqlError(`Field "${f.name}" must have a selection of subfields`);
      const r = rel(row);
      o[f.name] = r.list ? r.rows.map(x => resolve(r.type, x, f.sub)) : (r.rows[0] ? resolve(r.type, r.rows[0], f.sub) : null);
    }
    return o;
  }
  const data = {};
  for (const f of ast) {
    const root = ROOT[f.name];
    if (!root) throw new GqlError(`Cannot query field "${f.name}" on type "Query"`);
    if (!f.sub) throw new GqlError(`Field "${f.name}" must have a selection of subfields`);
    const r = root(f.args);
    parents = r.rows;
    data[f.name] = r.list ? r.rows.map(x => resolve(r.type, x, f.sub)) : (r.rows[0] ? resolve(r.type, r.rows[0], f.sub) : null);
  }
  return { data, queries: db.log.map(l => l.sql), count: db.queryCount };
}

export function safeExecute(src, opt) {
  try { return { ...execute(src, opt), error: null }; } catch (e) { if (e instanceof GqlError) return { data: null, queries: [], count: 0, error: e.message }; throw e; }
}

// 같은 정보를 REST 로 받는다면: 객체마다 "전체 필드"를 돌려주는 자원 주소를 따라간다. 부모 하나당 관계 하나가 호출 한 번.
// 반환: 호출 목록과 응답 글자 수(바이트 근사)
export function restEquivalent(src) {
  const ast = parseQuery(src);
  const db = makeDB();
  const calls = [];
  let bytes = 0;
  const size = (v) => JSON.stringify(v).length;
  const rootUrl = { substations: () => '/substations', substation: (a) => `/substations/${a.id}`, assets: (a) => '/assets' + (Object.keys(a).length ? '?' + new URLSearchParams(Object.entries(a).map(([k, v]) => [k === 'minHealth' ? 'min_health' : k, v])) : '') };
  const walk = (type, rows, sel) => {
    for (const row of rows) for (const f of sel) {
      if (!f.sub) continue;
      if (type === 'Substation' && f.name === 'assets') { const r = db.exec('SELECT * FROM assets WHERE substation_id = ?', [row.id]).rows; calls.push(`GET /substations/${row.id}/assets`); bytes += size(r); walk('Asset', r, f.sub); }
      if (type === 'Asset' && f.name === 'substation') { const r = db.exec('SELECT * FROM substations WHERE id = ?', [row.substation_id]).rows[0]; calls.push(`GET /substations/${row.substation_id}`); bytes += size(r); }
    }
  };
  for (const f of ast) {
    const type = f.name === 'assets' ? 'Asset' : 'Substation';
    const rows = f.name === 'substations' ? db.exec('SELECT * FROM substations').rows : f.name === 'substation' ? db.exec('SELECT * FROM substations WHERE id = ?', [f.args.id]).rows :
      db.exec(`SELECT * FROM assets${f.args.type !== undefined ? ' WHERE type = ?' : ''}${f.args.minHealth !== undefined ? (f.args.type !== undefined ? ' AND' : ' WHERE') + ' health >= ?' : ''}`, [f.args.type, f.args.minHealth].filter(x => x !== undefined)).rows;
    calls.push(`GET ${rootUrl[f.name](f.args)}`); bytes += size(rows);
    walk(type, rows, f.sub);
  }
  return { calls, bytes };
}
