// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 드라이버 · 표준 API: 같은 입력을 (가) 글자 이어붙이기와 (나) 바인딩으로 DB에 보내 결과를 비교하고, 트랜잭션 경계(자동 커밋 vs 묶음)를 본다.
// 브라우저 없이 테스트: tests/db.test.mjs
import { SqlError } from './minisql.js?v=7ebfcdc8';
import { makeDB } from './data.js?v=b680931a';

// 업무 규칙: 건전도 60 이상인 설비만 이름으로 조회할 수 있다 (낮은 설비는 정밀 점검 대상이라 이 화면에서는 숨김)
export const naiveSql = (name) => "SELECT id, name, health FROM assets WHERE name = '" + name + "' AND health >= 60";
export const boundSql = 'SELECT id, name, health FROM assets WHERE name = ? AND health >= 60';

function attempt(db, sql, params, opts) {
  try { const r = db.exec(sql, params, opts); return { sql, params, rows: r.rows, columns: r.columns, error: null }; }
  catch (e) { if (e instanceof SqlError) return { sql, params, rows: [], columns: [], error: e.message }; throw e; }
}

// 두 방식을 각자 새 DB에서 실행: 입력이 "데이터"로 남는지 "SQL"이 되는지
export function compareInjection(input, { multi = true } = {}) {
  const a = makeDB(), b = makeDB();
  const naive = attempt(a, naiveSql(input), [], { single: !multi });
  const bound = attempt(b, boundSql, [input], { single: !multi });
  naive.tables = a.tableNames(); bound.tables = b.tableNames();
  naive.leaked = naive.rows.filter(r => r.health < 60).length;       // 업무 규칙을 뚫고 나온 행
  return { naive, bound };
}

// 트랜잭션: 설비 T2를 B변전소로 옮기고(1) 이력에 기록(2)하는 두 단계. failAt 단계에서 오류가 난다.
// transaction=true 면 BEGIN … COMMIT/ROLLBACK, false(자동 커밋)면 문장마다 바로 확정된다.
export function transfer({ transaction, failAt }) {
  const db = makeDB();
  const steps = [
    { sql: "UPDATE assets SET substation_id = 'S2' WHERE id = 'T2'", label: 'move' },
    { sql: "INSERT INTO history (asset_id, note) VALUES ('T2', 'moved to S2')", label: 'log' }
  ];
  const log = [];
  if (transaction) { db.begin(); log.push('BEGIN'); }
  let failed = false;
  steps.forEach((s, i) => {
    if (failed) return;
    if (failAt === i + 1) { failed = true; log.push(`✗ ${s.label}: ${failAt === 2 ? 'no such table: history' : 'connection lost'}`); return; }
    try { db.exec(s.sql); log.push(`✓ ${s.label}`); } catch (e) { failed = true; log.push(`✗ ${s.label}: ${e.message}`); }
  });
  if (transaction) { if (failed) { db.rollback(); log.push('ROLLBACK'); } else { db.commit(); log.push('COMMIT'); } }
  const where = db.exec("SELECT substation_id FROM assets WHERE id = 'T2'").rows[0].substation_id;
  return { log, failed, substation: where, consistent: !failed || where === 'S1' };
}
