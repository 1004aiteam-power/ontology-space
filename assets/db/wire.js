// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 서버 접속: PostgreSQL 와이어 프로토콜(v3)의 실제 메시지를 바이트로 조립하고 읽는다. 소켓 위에서 DB 클라이언트와 서버가 주고받는 것이 이것이다.
// 모든 메시지: [종류 1글자][길이 4바이트(길이 칸 자신 포함)][내용]. (시작 메시지만 종류 글자가 없다.) 정수는 빅엔디언.
// 브라우저 없이 테스트: tests/db.test.mjs
import { SqlError } from './minisql.js?v=7ebfcdc8';

const enc = new TextEncoder(), dec = new TextDecoder();

class W {
  constructor() { this.b = []; this.seg = []; }
  mark(label, fn) { const s = this.b.length; fn(); this.seg.push({ label, from: s, to: this.b.length }); }
  i32(v) { this.b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  i16(v) { this.b.push((v >> 8) & 255, v & 255); }
  byte(v) { this.b.push(v); }
  raw(a) { this.b.push(...a); }
  cstr(s) { this.b.push(...enc.encode(s), 0); }
}

// 종류 글자 + 내용을 만드는 함수 → 길이를 채워 완성. body 는 W 를 받아 내용을 쓴다
function msg(type, name, dir, body) {
  const w = new W();
  body(w);
  const len = w.b.length + 4;
  const head = type ? [type.charCodeAt(0)] : [];
  const bytes = Uint8Array.from([...head, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...w.b]);
  const off = head.length + 4;
  const fields = [];
  if (type) fields.push({ label: 'type', from: 0, to: 1 });
  fields.push({ label: 'length', from: head.length, to: head.length + 4 });
  for (const s of w.seg) fields.push({ label: s.label, from: s.from + off, to: s.to + off });
  return { type: type || '(none)', name, dir, bytes, fields };
}

// ---- 클라이언트 → 서버 ----
export const startup = ({ user, database }) => msg('', 'StartupMessage', 'C→S', w => {
  w.mark('protocol 3.0', () => w.i32(196608));
  w.mark('user', () => { w.cstr('user'); w.cstr(user); });
  w.mark('database', () => { w.cstr('database'); w.cstr(database); });
  w.mark('end', () => w.byte(0));
});
export const query = (sql) => msg('Q', 'Query', 'C→S', w => w.mark('sql', () => w.cstr(sql)));
export const parseMsg = (stmt, sql, nParams) => msg('P', 'Parse', 'C→S', w => {
  w.mark('statement', () => w.cstr(stmt)); w.mark('sql', () => w.cstr(sql)); w.mark('param types', () => w.i16(nParams)); for (let i = 0; i < nParams; i++) w.i32(0);
});
// 값은 SQL 글자와 따로, 길이를 붙여 보낸다 — 이 점이 바인딩이 인젝션을 막는 이유다
export const bind = (portal, stmt, params) => msg('B', 'Bind', 'C→S', w => {
  w.mark('portal', () => w.cstr(portal)); w.mark('statement', () => w.cstr(stmt));
  w.mark('formats', () => w.i16(0));
  w.mark('param count', () => w.i16(params.length));
  params.forEach((p, i) => w.mark(`$${i + 1}`, () => { const b = enc.encode(String(p)); w.i32(b.length); w.raw(b); }));
  w.mark('result formats', () => w.i16(0));
});
export const execute = (portal = '', maxRows = 0) => msg('E', 'Execute', 'C→S', w => { w.mark('portal', () => w.cstr(portal)); w.mark('max rows', () => w.i32(maxRows)); });
export const sync = () => msg('S', 'Sync', 'C→S', () => {});
export const terminate = () => msg('X', 'Terminate', 'C→S', () => {});

// ---- 서버 → 클라이언트 ----
export const authOk = () => msg('R', 'AuthenticationOk', 'S→C', w => w.mark('auth=0 (ok)', () => w.i32(0)));
export const paramStatus = (k, v) => msg('S', 'ParameterStatus', 'S→C', w => { w.mark('name', () => w.cstr(k)); w.mark('value', () => w.cstr(v)); });
export const backendKey = (pid, key) => msg('K', 'BackendKeyData', 'S→C', w => { w.mark('pid', () => w.i32(pid)); w.mark('secret', () => w.i32(key)); });
export const ready = (st = 'I') => msg('Z', 'ReadyForQuery', 'S→C', w => w.mark(st === 'I' ? 'status I (idle)' : `status ${st}`, () => w.byte(st.charCodeAt(0))));
export const parseComplete = () => msg('1', 'ParseComplete', 'S→C', () => {});
export const bindComplete = () => msg('2', 'BindComplete', 'S→C', () => {});
const OID = { int: 23, text: 25 };
export const rowDesc = (cols, types) => msg('T', 'RowDescription', 'S→C', w => {
  w.mark('column count', () => w.i16(cols.length));
  cols.forEach((c, i) => w.mark(`"${c}"`, () => { w.cstr(c); w.i32(0); w.i16(0); w.i32(OID[types[i]]); w.i16(types[i] === 'int' ? 4 : -1); w.i32(-1); w.i16(0); }));
});
export const dataRow = (vals) => msg('D', 'DataRow', 'S→C', w => {
  w.mark('column count', () => w.i16(vals.length));
  vals.forEach((v, i) => w.mark(`col ${i + 1}`, () => { if (v == null) w.i32(-1); else { const b = enc.encode(String(v)); w.i32(b.length); w.raw(b); } }));
});
export const complete = (tag) => msg('C', 'CommandComplete', 'S→C', w => w.mark('tag', () => w.cstr(tag)));
export const error = (code, text) => msg('E', 'ErrorResponse', 'S→C', w => {
  w.mark('severity', () => { w.byte(83); w.cstr('ERROR'); }); w.mark('code', () => { w.byte(67); w.cstr(code); }); w.mark('message', () => { w.byte(77); w.cstr(text); }); w.mark('end', () => w.byte(0));
});

// 결과 → 서버가 돌려줄 메시지들 (간단한 질의 · 확장 질의 공통)
function replyFor(db, sql, params) {
  const out = [];
  try {
    const r = db.exec(sql, params);
    if (r.kind === 'select') {
      const types = r.columns.map(c => (r.rows.length && typeof r.rows[0][c] === 'number') ? 'int' : 'text');
      out.push(rowDesc(r.columns, types));
      for (const row of r.rows) out.push(dataRow(r.columns.map(c => row[c])));
      out.push(complete(`SELECT ${r.rowCount}`));
    } else out.push(complete(r.kind === 'insert' ? 'INSERT 0 1' : `${r.kind.toUpperCase()}${r.kind === 'drop' ? ' TABLE' : ` ${r.rowCount}`}`));
  } catch (e) {
    if (!(e instanceof SqlError)) throw e;
    out.push(error(/no such table/.test(e.message) ? '42P01' : '42601', e.message));
  }
  return out;
}
export const connectReply = () => [authOk(), paramStatus('server_version', '16.2'), paramStatus('client_encoding', 'UTF8'), backendKey(4242, 0x1badbeef), ready()];
export const simpleReply = (db, sql) => [...replyFor(db, sql, []), ready()];
export const extendedReply = (db, sql, params) => [parseComplete(), bindComplete(), ...replyFor(db, sql, params), ready()];

// 바이트 → 메시지 나누기 (서버 → 클라이언트 흐름). 길이 칸을 읽고 그만큼 잘라 낸다 — 소켓 페이지에서 본 "메시지 경계" 문제의 해법
export function splitMessages(bytes) {
  const out = [];
  let i = 0;
  while (i + 5 <= bytes.length) {
    const len = (bytes[i + 1] << 24 | bytes[i + 2] << 16 | bytes[i + 3] << 8 | bytes[i + 4]) >>> 0;
    if (i + 1 + len > bytes.length) break;
    out.push({ type: String.fromCharCode(bytes[i]), len, body: bytes.slice(i + 5, i + 1 + len) });
    i += 1 + len;
  }
  return out;
}
export function readDataRow(body) {
  const n = (body[0] << 8) | body[1];
  let i = 2;
  const vals = [];
  for (let k = 0; k < n; k++) {
    const l = (body[i] << 24 | body[i + 1] << 16 | body[i + 2] << 8 | body[i + 3]) | 0; i += 4;
    if (l < 0) vals.push(null); else { vals.push(dec.decode(body.slice(i, i + l))); i += l; }
  }
  return vals;
}
export const concat = (msgs) => Uint8Array.from(msgs.flatMap(m => Array.from(m.bytes)));

// ---- 커넥션 풀 ----
// 요청 n개가 gap ms 간격으로 오고, 질의 하나는 queryMs 걸린다. 연결을 새로 맺는 데 connectMs.
// pool=0: 요청마다 새로 연결(맺기 + 질의 + 닫기). pool=k: 연결 k개를 미리 열어 두고 돌려 쓴다 (모두 쓰는 중이면 기다림)
export function poolSim({ n = 20, gap = 5, queryMs = 20, connectMs = 30, pool = 0 }) {
  const lat = [];
  const free = pool > 0 ? new Array(pool).fill(0) : null;
  let open = 0, maxOpen = 0;
  const ends = [];
  for (let i = 0; i < n; i++) {
    const at = i * gap;
    let start = at, dur = queryMs;
    if (free) {
      const k = free.indexOf(Math.min(...free));
      start = Math.max(at, free[k]);
      free[k] = start + dur;
    } else dur = connectMs + queryMs;
    const end = start + dur;
    ends.push(end);
    lat.push(end - at);
    open = ends.filter(e => e > at).length;
    maxOpen = Math.max(maxOpen, free ? Math.min(pool, open) : open);
  }
  const avg = lat.reduce((a, b) => a + b, 0) / n;
  return { avg: Math.round(avg), max: Math.max(...lat), done: Math.max(...ends), maxOpen, lat };
}

export function hexLines(bytes, per = 16) {
  const out = [];
  for (let i = 0; i < bytes.length; i += per) out.push(bytes.slice(i, i + per));
  return out;
}
