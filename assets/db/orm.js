// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 쿼리 빌더와 ORM: 코드 → SQL 만들기, 그리고 N+1 문제를 세 가지 불러오기 방식으로 비교한다. 브라우저 없이 테스트: tests/db.test.mjs
import { makeDB } from './data.js?v=b680931a';

// 쿼리 빌더: 메서드를 이어 붙이면 SQL 글자와 바인딩 값이 나온다
export class Query {
  constructor(table) { this.table = table; this.w = []; this.p = []; this.o = null; this.l = null; this.cols = ['*']; }
  select(...c) { this.cols = c; return this; }
  where(col, op, val) { this.w.push(`${col} ${op} ?`); this.p.push(val); return this; }
  orderBy(col, dir = 'ASC') { this.o = `${col} ${dir}`; return this; }
  limit(n) { this.l = n; return this; }
  toSQL() {
    let sql = `SELECT ${this.cols.join(', ')} FROM ${this.table}`;
    if (this.w.length) sql += ` WHERE ${this.w.join(' AND ')}`;
    if (this.o) sql += ` ORDER BY ${this.o}`;
    if (this.l != null) sql += ` LIMIT ${Number(this.l)}`;
    return { sql, params: [...this.p] };
  }
  run(db) { const { sql, params } = this.toSQL(); return db.exec(sql, params); }
}
export const from = (t) => new Query(t);

// 변전소 목록과 각 변전소의 설비를 함께 가져오는 세 방식. 결과 구조는 같고 질의 횟수만 다르다.
export function loadLazy(db) {            // ORM 기본값: 관계를 쓰는 순간 질의 (N+1)
  const subs = db.exec('SELECT * FROM substations').rows;
  return subs.map(s => ({ ...s, assets: db.exec('SELECT * FROM assets WHERE substation_id = ?', [s.id]).rows }));
}
export function loadBatch(db) {           // 미리 모아서 IN 으로 한 번 (selectinload / preload)
  const subs = db.exec('SELECT * FROM substations').rows;
  const ids = subs.map(s => `'${s.id}'`).join(', ');
  const assets = db.exec(`SELECT * FROM assets WHERE substation_id IN (${ids})`).rows;
  return subs.map(s => ({ ...s, assets: assets.filter(a => a.substation_id === s.id) }));
}
export function loadJoin(db) {            // JOIN 한 번 (joinedload) — 부모 행이 자식 수만큼 반복되어 오므로 메모리에서 다시 묶는다
  const r = db.exec('SELECT s.id, s.name, s.region, a.id AS asset_id, a.type, a.name AS asset_name, a.health, a.installed FROM substations s LEFT JOIN assets a ON a.substation_id = s.id').rows;
  const map = new Map();
  for (const x of r) {
    if (!map.has(x.id)) map.set(x.id, { id: x.id, name: x.name, region: x.region, assets: [] });
    if (x.asset_id != null) map.get(x.id).assets.push({ id: x.asset_id, substation_id: x.id, type: x.type, name: x.asset_name, health: x.health, installed: x.installed });
  }
  return [...map.values()];
}
export function compareLoading() {
  const out = {};
  for (const [k, fn] of Object.entries({ lazy: loadLazy, batch: loadBatch, join: loadJoin })) {
    const db = makeDB(); const tree = fn(db);
    out[k] = { tree, queries: db.log.map(l => l.sql), count: db.queryCount };
  }
  return out;
}
// 변전소가 n개일 때: 질의 횟수와 (왕복 rtt ms 만 따진) 대기 시간
export function loadingCost(n, rtt) {
  return [['lazy', 1 + n], ['batch', 2], ['join', 1]].map(([k, q]) => ({ k, queries: q, ms: q * rtt }));
}
