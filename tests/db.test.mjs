// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 데이터베이스 접근 페이지(db-*.html)의 계산 점검 (브라우저 없이) — 실행: node tests/db.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tokenize, parse, analyze } from '../assets/db/minisql.js';
import { makeDB, ASSETS, SUBSTATIONS, readings } from '../assets/db/data.js';
import * as S from '../assets/db/storage.js';
import * as W from '../assets/db/wire.js';
import { compareInjection, transfer } from '../assets/db/driver.js';
import { from, compareLoading, loadingCost } from '../assets/db/orm.js';
import { createService } from '../assets/db/service.js';
import { parseQuery, execute, safeExecute, restEquivalent, GqlError } from '../assets/db/gql.js';
import { postgrestToSQL, runPostgrest, guard, nlToSql, NL_PRESETS } from '../assets/db/modern.js';
import { recommend, MATRIX, LAYERS } from '../assets/db/choose.js';
import { ANSWERS, similar, toDocument, toGraph } from '../assets/db/models.js';

const ids = (r) => r.rows.map(x => x.id);

// 1) 작은 SQL 엔진: 질의 · 집계 · 조인 · 바인딩 · 변경 · 되돌리기
{
  const db = makeDB();
  assert.equal(db.exec('SELECT * FROM assets').rowCount, 12);
  assert.deepEqual(ids(db.exec("SELECT id FROM assets WHERE type = 'breaker' AND health >= 70 ORDER BY health DESC")), ['B1', 'B4', 'B5', 'B3']);
  assert.deepEqual(ids(db.exec('SELECT id FROM assets WHERE type IN (?, ?) ORDER BY id LIMIT 2', ['cable', 'relay'])), ['C1', 'C2']);
  assert.deepEqual(ids(db.exec("SELECT id FROM assets WHERE name LIKE 'CB-1%' ORDER BY id")), ['B1', 'B2']);
  assert.deepEqual(ids(db.exec('SELECT id FROM assets WHERE NOT (health >= 60) OR installed < 1996 ORDER BY id')), ['B2', 'T4']);
  const g = db.exec('SELECT s.name, COUNT(*) AS n, AVG(a.health) AS avg FROM assets a JOIN substations s ON a.substation_id = s.id GROUP BY s.name ORDER BY avg DESC');
  assert.deepEqual(g.rows.map(r => [r.name, r.n, r.avg]), [['Sub-B', 4, 79.75], ['Sub-A', 5, 74.4], ['Sub-C', 3, 67.67]]);
  assert.equal(db.exec('SELECT COUNT(*) AS n FROM assets WHERE health > 100').rows[0].n, 0, 'aggregate over zero rows still returns one row');
  const lj = db.exec("SELECT s.id, a.id AS aid FROM substations s LEFT JOIN assets a ON a.substation_id = s.id AND a.type = 'relay' ORDER BY s.id");
  assert.deepEqual(lj.rows.map(r => r.aid), [null, 'R1', null], 'LEFT JOIN keeps unmatched left rows as NULL');
  assert.equal(db.exec("SELECT * FROM assets WHERE name = 'x' OR '1'='1'").rowCount, 12, 'literal comparison in WHERE');
  // 문자열 안의 -- 와 ; 는 SQL이 아니다 / 따옴표 두 개는 따옴표 하나
  assert.equal(tokenize("SELECT 'a--b; c''d'")[1].v, "a--b; c'd");
  assert.throws(() => db.exec("SELECT * FROM assets WHERE name = 'x"), /unterminated/);
  assert.throws(() => db.exec('SELECT nope FROM assets'), /no such column/);
  assert.throws(() => db.exec('SELECT * FROM nothing'), /no such table/);
  assert.throws(() => db.exec('SELECT * FROM assets WHERE id = ?'), /missing value/);
  assert.throws(() => db.exec('SELECT * FROM assets a JOIN substations s ON a.substation_id = s.id WHERE id = 1'), /ambiguous/);
  // 변경
  assert.equal(db.exec("UPDATE assets SET health = 99 WHERE id = 'T4'").rowCount, 1);
  assert.equal(db.exec("SELECT health FROM assets WHERE id = 'T4'").rows[0].health, 99);
  assert.equal(db.exec("DELETE FROM assets WHERE type = 'relay'").rowCount, 1);
  db.exec("INSERT INTO assets (id, type, health) VALUES ('Z1', 'cable', 50)");
  assert.equal(db.exec("SELECT substation_id FROM assets WHERE id = 'Z1'").rows[0].substation_id, null);
  // 트랜잭션 되돌리기와 DB 복사본 독립
  db.begin(); db.exec('DELETE FROM assets'); assert.equal(db.exec('SELECT * FROM assets').rowCount, 0); db.rollback();
  assert.equal(db.exec('SELECT * FROM assets').rowCount, 12 - 1 + 1);
  assert.equal(makeDB().exec('SELECT * FROM assets').rowCount, 12, 'a fresh DB is untouched by earlier changes');
  // 여러 문장과 분석
  assert.equal(parse("SELECT id FROM assets; DROP TABLE assets;").length, 2);
  assert.deepEqual(analyze('SELECT * FROM assets a JOIN substations s ON a.substation_id = s.id LIMIT 5')[0], { kind: 'select', tables: ['assets', 'substations'], limit: 5 });
  assert.throws(() => makeDB().exec('SELECT * FROM assets; SELECT * FROM substations', [], { single: true }), /one statement/);
  assert.equal(makeDB().exec('SELECT * FROM assets; DROP TABLE substations').kind, 'drop');
  console.log('✓ the mini SQL engine: select, join, aggregates, bindings, changes, rollback and error cases');
}

// 2) 데이터: 설비는 모두 실제 변전소에 속하고, 시계열은 결정적이다
{
  assert.ok(ASSETS.every(a => SUBSTATIONS.some(s => s.id === a.substation_id)));
  assert.equal(new Set(ASSETS.map(a => a.id)).size, ASSETS.length);
  assert.deepEqual(readings('T1'), readings('T1'));
  assert.equal(readings('T1').at(-1).health, 82, 'the latest reading is the current health');
  assert.deepEqual(readings('nope'), []);
  console.log('✓ the sample data is consistent and the time series is deterministic');
}

// 3) 직접 접근: 레코드 바이트 · 페이지 · 인덱스 · 쓰기 전 기록
{
  for (const a of ASSETS) assert.deepEqual(S.decodeRow(S.encodeRow(a)), a, 'a row survives encode → decode');
  const file = S.buildFile(ASSETS);
  assert.ok(file.pages.length >= 2 && file.pages.every(p => p.length === S.PAGE));
  assert.deepEqual(file.pages.flatMap((_, n) => S.readPage(file, n)), ASSETS, 'reading every page returns every row in order');
  for (const p of file.pages) assert.ok(4 + S.slotCount(p) * 4 <= S.PAGE, 'slots never run past the page');
  assert.deepEqual(S.fullScan(file, r => r.health >= 90).rows.map(r => r.id), ['B1', 'T3']);
  assert.equal(S.fullScan(file, () => false).pagesRead, file.pages.length, 'a full scan always reads every page');
  const tree = S.buildBTree(file);
  for (const a of ASSETS) { const r = S.lookupById(file, tree, a.id); assert.deepEqual(r.row, a); assert.equal(r.nodesRead, tree.height); assert.equal(r.pagesRead, 1); }
  const miss = S.lookupById(file, tree, 'X9');
  assert.equal(miss.row, null); assert.equal(miss.pagesRead, 0);
  assert.ok(tree.nodes.filter(n => n.leaf).every(n => n.keys.length <= 3), 'no node holds more than maxKeys keys');
  assert.deepEqual(tree.nodes.filter(n => n.leaf).flatMap(n => n.keys), ASSETS.map(a => a.id).sort(), 'leaves hold all keys in sorted order');
  const c1 = S.costModel(1e3), c2 = S.costModel(1e9);
  assert.ok(c2.scan > c1.scan * 1e5 && c2.index <= 6, 'a scan grows with rows, the index only logarithmically');
  // WAL: 로그 없이 중간에 끊기면 유실, 로그가 있으면 어느 시점에 끊겨도 정확히 한 곳
  assert.equal(S.walDemo({ wal: false, crashAfter: 1 }).lost, true);
  assert.equal(S.walDemo({ wal: false, crashAfter: 3 }).consistent, true);
  for (let c = 0; c <= 3; c++) assert.ok(S.walDemo({ wal: true, crashAfter: c }).consistent, `with a WAL, a crash after step ${c} leaves the asset in exactly one place`);
  assert.deepEqual(S.walDemo({ wal: true, crashAfter: 2 }).after.replay, ['redo']);
  assert.deepEqual(S.walDemo({ wal: true, crashAfter: 0 }).after.replay, ['ignore']);
  console.log('✓ pages, the B+tree index, the cost model and WAL recovery behave as described');
}

// 4) 와이어 프로토콜: 실제 PostgreSQL 바이트 형식
{
  const hex = (m) => Buffer.from(m.bytes).toString('hex');
  assert.equal(hex(W.query('SELECT 1')), '510000000d53454c4543542031' + '00', 'Q + length 13 + "SELECT 1" + NUL');
  assert.equal(hex(W.sync()), '5300000004'); assert.equal(hex(W.terminate()), '5800000004');
  assert.equal(hex(W.ready()), '5a0000000549');
  const st = W.startup({ user: 'app', database: 'grid' });
  assert.equal((st.bytes[0] << 24 | st.bytes[1] << 16 | st.bytes[2] << 8 | st.bytes[3]), st.bytes.length, 'startup length covers the whole message');
  assert.equal(st.bytes.slice(4, 8).join(), [0, 3, 0, 0].join(), 'protocol 3.0');
  assert.equal(st.bytes.at(-1), 0);
  const m = W.query('SELECT id FROM assets');
  assert.equal(new DataView(m.bytes.buffer).getUint32(1), m.bytes.length - 1, 'length excludes the type byte');
  assert.equal(m.fields.at(-1).to, m.bytes.length, 'the fields tile the message');
  // 바인딩: 값은 SQL 글자와 다른 칸으로 간다
  const p = W.parseMsg('', 'SELECT * FROM assets WHERE name = $1', 1), b = W.bind('', '', ["x'; DROP TABLE assets; --"]);
  assert.ok(!Buffer.from(p.bytes).toString().includes('DROP'));
  assert.ok(Buffer.from(b.bytes).toString().includes('DROP TABLE'), 'the value travels in Bind, not inside the SQL template');
  // 서버 응답 → 다시 메시지로 나누기 → 행 읽기
  const db = makeDB();
  const reply = W.simpleReply(db, 'SELECT id, health FROM assets WHERE health >= 90 ORDER BY id');
  assert.deepEqual(reply.map(x => x.type), ['T', 'D', 'D', 'C', 'Z']);
  const parts = W.splitMessages(W.concat(reply));
  assert.deepEqual(parts.map(x => x.type), ['T', 'D', 'D', 'C', 'Z']);
  assert.deepEqual(parts.filter(x => x.type === 'D').map(x => W.readDataRow(x.body)), [['B1', '91'], ['T3', '95']]);
  assert.equal(new TextDecoder().decode(parts[3].body), 'SELECT 2\0');
  assert.deepEqual(W.splitMessages(new Uint8Array([...W.concat(reply)].slice(0, 20))).length < 5, true, 'a partial stream yields only complete messages');
  assert.equal(W.simpleReply(db, 'SELECT * FROM nothing')[0].type, 'E');
  assert.ok(Buffer.from(W.simpleReply(db, 'SELECT * FROM nothing')[0].bytes).toString().includes('42P01'));
  assert.deepEqual(W.extendedReply(db, 'SELECT id FROM assets WHERE health >= ?', [90]).map(x => x.type), ['1', '2', 'T', 'D', 'D', 'C', 'Z']);
  assert.deepEqual(W.connectReply().map(x => x.type), ['R', 'S', 'S', 'K', 'Z']);
  // 커넥션 풀
  const noPool = W.poolSim({ n: 30, gap: 6, queryMs: 20, connectMs: 50, pool: 0 }), pool = W.poolSim({ n: 30, gap: 6, queryMs: 20, connectMs: 50, pool: 4 });
  assert.equal(noPool.avg, 70); assert.ok(pool.avg < noPool.avg && pool.maxOpen <= 4);
  assert.ok(W.poolSim({ n: 30, gap: 2, queryMs: 20, connectMs: 50, pool: 1 }).avg > 20, 'too small a pool makes requests queue');
  console.log('✓ PostgreSQL wire messages have the real byte format and the connection pool behaves');
}

// 5) 드라이버: 인젝션과 트랜잭션
{
  const normal = compareInjection('MTr-1');
  assert.deepEqual(ids(normal.naive), ['T1']); assert.deepEqual(ids(normal.bound), ['T1']);
  const bypass = compareInjection("MTr-4' --");
  assert.deepEqual(ids(bypass.naive), ['T4']); assert.equal(bypass.naive.leaked, 1, 'the -- drops the health rule');
  assert.deepEqual(bypass.bound.rows, [], 'bound: the input is just a name that matches nothing');
  assert.equal(compareInjection("' OR '1'='1").naive.rows.length, 10, 'AND binds tighter, so every row with health >= 60 comes out'); assert.equal(compareInjection("' OR '1'='1").bound.rows.length, 0);
  const drop = compareInjection("x'; DROP TABLE assets; --");
  assert.ok(!drop.naive.tables.includes('assets') && drop.bound.tables.includes('assets'));
  const one = compareInjection("x'; DROP TABLE assets; --", { multi: false });
  assert.match(one.naive.error, /one statement/); assert.ok(one.naive.tables.includes('assets'));
  assert.ok(compareInjection("O'Neil").naive.error && !compareInjection("O'Neil").bound.error, 'a quote alone breaks concatenation but not binding');
  const auto = transfer({ transaction: false, failAt: 2 }), tx = transfer({ transaction: true, failAt: 2 });
  assert.equal(auto.substation, 'S2'); assert.equal(auto.consistent, false);
  assert.equal(tx.substation, 'S1'); assert.equal(tx.consistent, true); assert.deepEqual(tx.log.slice(-1), ['ROLLBACK']);
  assert.equal(transfer({ transaction: true, failAt: 0 }).log.at(-1), 'ROLLBACK', 'the demo has no history table, so step 2 fails even with no injected failure');
  console.log('✓ binding stops injection that concatenation allows; a transaction undoes half-done work');
}

// 6) 쿼리 빌더 · ORM
{
  const q = from('assets').select('id').where('type', '=', 'breaker').where('health', '>=', 70).orderBy('health', 'DESC').limit(3).toSQL();
  assert.equal(q.sql, 'SELECT id FROM assets WHERE type = ? AND health >= ? ORDER BY health DESC LIMIT 3');
  assert.deepEqual(q.params, ['breaker', 70]);
  assert.ok(!from('assets').where('name', '=', "x'; DROP").toSQL().sql.includes('DROP'), 'values never enter the SQL text');
  assert.deepEqual(ids(from('assets').where('health', '>=', 90).orderBy('id').run(makeDB())), ['B1', 'T3']);
  const c = compareLoading();
  assert.deepEqual([c.lazy.count, c.batch.count, c.join.count], [1 + SUBSTATIONS.length, 2, 1], 'N+1, 2, 1 queries');
  assert.deepEqual(c.batch.tree, c.lazy.tree); assert.deepEqual(c.join.tree, c.lazy.tree);
  assert.equal(c.lazy.tree.reduce((s, x) => s + x.assets.length, 0), ASSETS.length);
  assert.deepEqual(loadingCost(100, 2).map(x => x.queries), [101, 2, 1]);
  console.log('✓ the query builder keeps values apart, and three loading styles give one result with N+1, 2 and 1 queries');
}

// 7) 서비스 계층 (REST)
{
  const db = makeDB(), h = createService(db);
  const V = { Authorization: 'Bearer tok-viewer' }, E = { Authorization: 'Bearer tok-editor' };
  assert.equal(h({ method: 'GET', path: '/api/assets' }).status, 401);
  assert.equal(h({ method: 'GET', path: '/api/assets', headers: { Authorization: 'Bearer nope' } }).status, 401);
  const list = h({ method: 'GET', path: '/api/assets', query: { type: 'breaker', min_health: '70' }, headers: V });
  assert.equal(list.status, 200); assert.deepEqual(list.body.map(x => x.id), ['B1', 'B3', 'B4', 'B5']);
  assert.ok(list.body.every(x => !('installed' in x)), 'viewers do not see installed');
  assert.ok('installed' in h({ method: 'GET', path: '/api/assets/T1', headers: E }).body);
  assert.equal(h({ method: 'GET', path: '/api/assets', query: { min_health: 'abc' }, headers: V }).status, 400);
  assert.equal(h({ method: 'GET', path: '/api/assets/ZZ', headers: V }).status, 404);
  assert.equal(h({ method: 'GET', path: "/api/assets/T1' OR '1'='1", headers: E }).status, 404, 'an injection in the path is just a missing id');
  assert.equal(h({ method: 'POST', path: '/api/assets', headers: V, body: { id: 'T9', type: 'cable', health: 5 } }).status, 403);
  assert.equal(h({ method: 'POST', path: '/api/assets', headers: V, body: {} }).sql.length, 0, 'a forbidden request never reaches the DB');
  const bad = h({ method: 'POST', path: '/api/assets', headers: E, body: { id: 'x', type: 'toaster', health: 150 } });
  assert.equal(bad.status, 422); assert.equal(bad.body.errors.length, 3);
  const ok = h({ method: 'POST', path: '/api/assets', headers: E, body: { id: 'T9', type: 'transformer', health: 90 } });
  assert.equal(ok.status, 201); assert.equal(ok.headers.Location, '/api/assets/T9');
  assert.equal(h({ method: 'POST', path: '/api/assets', headers: E, body: { id: 'T9', type: 'transformer', health: 90 } }).status, 409);
  assert.equal(h({ method: 'PATCH', path: '/api/assets/T9', headers: E, body: { health: 40 } }).body.health, 40);
  assert.equal(h({ method: 'DELETE', path: '/api/assets/T9', headers: E }).status, 204);
  assert.equal(h({ method: 'DELETE', path: '/api/assets/T9', headers: E }).status, 404);
  assert.equal(h({ method: 'PUT', path: '/api/assets/T1', headers: E }).status, 405);
  assert.ok(list.sql.every(s => !/health >= 70|breaker/.test(s.sql)), 'every value in the executed SQL was bound');
  console.log('✓ the REST service checks identity, permission and values, and binds every value');
}

// 8) GraphQL
{
  const q = '{ substations { name assets { name health } } }';
  assert.deepEqual(parseQuery('query Q { substation(id: "S1") { name } }'), [{ name: 'substation', args: { id: 'S1' }, sub: [{ name: 'name', args: {}, sub: null }] }]);
  const a = execute(q), b = execute(q, { loader: true });
  assert.deepEqual(a.data, b.data, 'a DataLoader changes the cost, not the result');
  assert.equal(a.count, 1 + SUBSTATIONS.length); assert.equal(b.count, 2);
  assert.deepEqual(Object.keys(a.data.substations[0]), ['name', 'assets']); assert.deepEqual(Object.keys(a.data.substations[0].assets[0]), ['name', 'health'], 'only the requested fields come back');
  const r = execute('{ assets(type: "cable") { id substation { name } } }', { loader: true });
  assert.deepEqual(r.data.assets, [{ id: 'C1', substation: { name: 'Sub-A' } }, { id: 'C2', substation: { name: 'Sub-C' } }]);
  assert.equal(execute('{ substation(id: "S9") { name } }').data.substation, null);
  assert.match(safeExecute('{ assets { voltage } }').error, /Cannot query field "voltage" on type "Asset"/);
  assert.match(safeExecute('{ assets }').error, /must have a selection/);
  assert.match(safeExecute('{ assets { name { x } } }').error, /scalar/);
  assert.match(safeExecute('{ assets { name }').error, /Syntax error/);
  assert.match(safeExecute('{ users { id } }').error, /on type "Query"/);
  assert.throws(() => execute('{ nope { id } }'), GqlError);
  const rest = restEquivalent(q), gb = JSON.stringify({ data: a.data }).length;
  assert.equal(rest.calls.length, 1 + SUBSTATIONS.length); assert.ok(rest.bytes > gb, 'REST returns whole objects, GraphQL only the chosen fields');
  console.log('✓ GraphQL returns exactly the requested shape; a DataLoader cuts N+1; bad queries are rejected');
}

// 9) 최근 흐름: 자동 생성 API · 에이전트 점검
{
  const p = postgrestToSQL('/assets?select=name,health&type=eq.transformer&order=health.desc&limit=2');
  assert.equal(p.sql, 'SELECT name, health FROM assets WHERE type = ? ORDER BY health DESC LIMIT 2'); assert.deepEqual(p.params, ['transformer']);
  const r = runPostgrest(makeDB(), '/assets?select=name,health&type=eq.transformer&order=health.desc&limit=2');
  assert.deepEqual(r.body, [{ name: 'MTr-3', health: 95 }, { name: 'MTr-1', health: 82 }]);
  assert.deepEqual(runPostgrest(makeDB(), '/assets?select=name,substations(name)&health=lt.60').body, [{ name: 'CB-102', substations: { name: 'Sub-A' } }, { name: 'MTr-4', substations: { name: 'Sub-C' } }]);
  const sub = runPostgrest(makeDB(), '/substations?select=name,assets(name)&limit=2').body;
  assert.equal(sub.length, 2); assert.equal(sub[0].assets.length, 5);
  assert.equal(runPostgrest(makeDB(), '/assets?type=in.(cable,relay)&select=id').body.length, 3);
  assert.equal(runPostgrest(makeDB(), '/assets?foo=eq.1').status, 400); assert.equal(runPostgrest(makeDB(), '/users').status, 404);
  assert.equal(runPostgrest(makeDB(), '/assets?health=between.1').status, 400);
  const inj = runPostgrest(makeDB(), "/assets?name=eq.x'%20OR%20'1'='1");
  assert.equal(inj.status, 200); assert.deepEqual(inj.body, [], 'filter values are bound');
  // 안전 점검
  assert.equal(guard('SELECT * FROM assets').sql, 'SELECT * FROM assets LIMIT 50', 'a row cap is added');
  assert.match(guard('SELECT * FROM assets LIMIT 500').sql, /LIMIT 50$/); assert.equal(guard('SELECT * FROM assets LIMIT 5').sql, 'SELECT * FROM assets LIMIT 5');
  assert.equal(guard('DELETE FROM assets WHERE health < 60').ok, false);
  assert.equal(guard('SELECT * FROM users').problems[0].code, 'table');
  assert.equal(guard('SELECT * FROM assets; DROP TABLE assets').ok, false);
  assert.equal(guard('SELEKT').problems[0].code, 'parse');
  assert.equal(guard('SELECT * FROM assets a JOIN substations s ON a.substation_id = s.id').ok, true);
  const verdict = NL_PRESETS.map(x => guard(nlToSql(x.en)).ok);
  assert.deepEqual(verdict, [true, true, true, true, false, false], 'safe questions pass, deletion and an unknown table are refused');
  for (const x of NL_PRESETS.filter((_, i) => i < 4)) { const g = guard(nlToSql(x.en)); assert.ok(makeDB().exec(g.sql).rowCount > 0, x.en); }
  assert.equal(nlToSql('hello'), null);
  console.log('✓ the auto-generated API translates addresses safely and the agent guard blocks unsafe SQL');
}

// 10) 선택 도우미 · 데이터 모델 지도
{
  const base = { caller: 'backend', shape: 'fixed', priority: 'control', scale: 'small' };
  for (const caller of ['browser', 'partner']) {
    const r = recommend({ ...base, caller });
    assert.ok(['embedded', 'driver', 'orm'].every(id => r.find(x => x.id === id).blocked), `${caller}: handing out DB credentials is blocked`);
    assert.ok(!r[0].blocked && !['embedded', 'driver', 'orm'].includes(r[0].id));
    assert.ok(r.slice(-3).every(x => x.blocked), 'blocked approaches sink to the bottom');
  }
  assert.equal(recommend({ ...base, caller: 'local', priority: 'speed' })[0].id, 'embedded');
  assert.equal(recommend({ ...base, caller: 'agent', shape: 'adhoc' })[0].id, 'agent');
  assert.equal(recommend({ ...base, caller: 'partner' })[0].id, 'rest');
  assert.equal(recommend({ ...base, caller: 'analyst', shape: 'adhoc' })[0].id, 'driver');
  assert.ok(['rest', 'graphql'].includes(recommend({ caller: 'browser', shape: 'flexible', priority: 'control', scale: 'large' })[0].id));
  assert.equal(recommend({ ...base, scale: 'large', caller: 'local' }).find(x => x.id === 'embedded').score < recommend({ ...base, scale: 'small', caller: 'local' }).find(x => x.id === 'embedded').score, true);
  assert.deepEqual(MATRIX.map(m => m.id).sort(), LAYERS.map(l => l.id).sort());
  assert.ok(MATRIX.every(m => Object.values(m).filter(v => typeof v === 'number').every(v => v >= 1 && v <= 5)));
  assert.ok(!MATRIX.some(m => ['resilience', 'security', 'speed', 'ease', 'freedom'].every(k => m[k] === 5)), 'no approach wins on every criterion');
  const same = Object.entries(ANSWERS).map(([k, f]) => [k, f().join()]);
  assert.ok(same.every(([, v]) => v === 'B1,C1,T1'), 'five data models give the same answer to the same question');
  assert.equal(toDocument().reduce((s, d) => s + d.assets.length, 0), ASSETS.length); assert.equal(toGraph().edges.length, ASSETS.length);
  assert.equal(similar('T4')[0].id, 'T2'); assert.ok(similar('T4').every(x => x.sim <= 1));
  console.log('✓ the chooser blocks credentials for browsers, ranks sensibly, and the data models agree');
}

// 11) 페이지: 새 메뉴의 아홉 페이지가 모두 있고 한국어 · 영어 본문을 갖는다
{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pages = ['db-map', 'db-file', 'db-wire', 'db-driver', 'db-orm', 'db-service', 'db-graphql', 'db-modern', 'db-choose'];
  for (const p of pages) {
    const s = readFileSync(join(root, `${p}.html`), 'utf8');
    assert.ok(s.includes('id="dbMenu"'), `${p}: menu present`);
    assert.ok(/<meta name="title-en"/.test(s), `${p}: has an English title`);
    const ko = (s.match(/lang="ko"/g) || []).length, en = (s.match(/lang="en"/g) || []).length;
    assert.ok(ko > 10 && Math.abs(ko - en) <= 6, `${p}: Korean (${ko}) and English (${en}) texts are paired`);
    const ids = [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${p}: duplicate ids ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
    for (const a of s.matchAll(/href="(db-[a-z]+\.html)#?[^"]*"/g)) assert.ok(pages.includes(a[1].replace('.html', '')), `${p}: link to ${a[1]}`);
  }
  console.log(`✓ all ${pages.length} database-access pages exist with the menu, paired texts and unique ids`);
}
