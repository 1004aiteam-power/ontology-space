// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 서버 접속 페이지: PostgreSQL 메시지를 바이트로 보여 주고(가짜 서버가 응답), 커넥션 풀 효과를 비교한다 (계산은 wire.js)
import { makeDB } from './data.js?v=b680931a';
import * as W from './wire.js?v=2b8a172b';
import { $, esc, T } from '../lib/dom.js?v=3b73d59c';

const db = makeDB();
let mode = 'simple', msgs = [], sel = 0;
const hex2 = (b) => b.toString(16).padStart(2, '0');
const asc = (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·');

// 이 방식의 값 자리표시자 ? → $1, $2 (PostgreSQL 표기)
const toDollar = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };

function build() {
  $('wErr').textContent = '';
  const out = [W.startup({ user: 'app', database: 'grid' }), ...W.connectReply()];
  const sql = $('wSql').value.trim();
  if (!sql) { $('wErr').textContent = T('SQL을 입력하세요', 'Enter some SQL'); return out; }
  db.resetLog();
  if (mode === 'simple') {
    out.push(W.query(sql), ...W.simpleReply(db, sql));
  } else {
    const params = $('wParams').value.split(',').map(s => s.trim()).filter(s => s !== '').map(s => (!isNaN(s) ? Number(s) : s));
    const n = (sql.match(/\?/g) || []).length;
    if (n !== params.length) $('wErr').textContent = T(`SQL의 ? 가 ${n}개인데 값이 ${params.length}개입니다.`, `The SQL has ${n} "?" but ${params.length} values were given.`);
    out.push(W.parseMsg('', toDollar(sql), n), W.bind('', '', params), W.execute('', 0), W.sync(), ...W.extendedReply(db, sql, params));
  }
  out.push(W.terminate());
  return out;
}
function summary(m) {
  const body = m.bytes.slice(m.type === '(none)' ? 8 : 5);
  if (m.name === 'Query') return esc(new TextDecoder().decode(body.slice(0, -1)));
  if (m.name === 'Parse') return esc(new TextDecoder().decode(body).split('\0')[1] || '');
  if (m.name === 'DataRow') return esc(W.readDataRow(body).join(', '));
  if (m.name === 'CommandComplete' || m.name === 'ErrorResponse') return esc(new TextDecoder().decode(body).replace(/\0/g, ' ').trim());
  return '';
}
function list() {
  $('wList').innerHTML = `<thead><tr><th></th><th>${T('메시지', 'Message')}</th><th>${T('종류', 'Type')}</th><th>${T('바이트', 'Bytes')}</th><th>${T('내용', 'Content')}</th></tr></thead><tbody>` +
    msgs.map((m, i) => `<tr data-i="${i}" tabindex="0" class="${i === sel ? 'sel' : ''}"><td class="dir ${m.dir === 'C→S' ? 'c' : 's'}">${m.dir}</td><td>${m.name}</td><td>${esc(m.type)}</td><td>${m.bytes.length}</td><td class="sm">${summary(m)}</td></tr>`).join('') + '</tbody>';
}
function detail() {
  const m = msgs[sel];
  if (!m) return;
  $('wSelTitle').textContent = `${m.dir} ${m.name} — ${m.bytes.length} ${T('바이트', 'bytes')}`;
  const own = new Array(m.bytes.length).fill(-1);
  m.fields.forEach((f, k) => { for (let i = f.from; i < f.to; i++) own[i] = k; });
  let rows = '';
  for (let r = 0; r < m.bytes.length; r += 16) {
    let h = '', a = '';
    for (let i = r; i < Math.min(r + 16, m.bytes.length); i++) { const c = own[i] < 0 ? 'w-x' : `w${own[i] % 6}`; h += `<span class="${c}">${hex2(m.bytes[i])}</span>`; a += `<span class="${c}">${esc(asc(m.bytes[i]))}</span>`; }
    rows += `<div class="hexrow"><span class="off">${hex2(r)}</span><span class="hx">${h}</span><span class="as">${a}</span></div>`;
  }
  $('wHex').innerHTML = rows;
  $('wLegend').innerHTML = m.fields.slice(0, 14).map((f, k) => {
    const raw = m.bytes.slice(f.from, f.to);
    const txt = f.label === 'type' ? `'${asc(raw[0])}'` : f.label === 'length' ? `${m.bytes.length - (m.type === '(none)' ? 0 : 1)}` : '';
    return `<li><i class="sw w${k % 6}"></i>${esc(f.label)} <small>${txt || hexShort(raw)}</small></li>`;
  }).join('') + (m.fields.length > 14 ? `<li><small>… +${m.fields.length - 14}</small></li>` : '');
}
const hexShort = (raw) => { const h = Array.from(raw.slice(0, 6), hex2).join(' '); return raw.length > 6 ? h + ' …' : h; };

function stream() {
  const s2c = msgs.filter(m => m.dir === 'S→C').slice(5);          // 질의 응답 부분 (접속 응답 5개 뒤)
  if (!s2c.length) { $('wStream').textContent = ''; return; }
  const all = W.concat(s2c), parts = W.splitMessages(all);
  const rows = parts.filter(p => p.type === 'D').length;
  $('wStream').innerHTML = T(`질의 응답은 TCP 바이트 흐름으로 <b>${all.length}바이트</b>가 한꺼번에 오지만, 받는 쪽은 각 메시지 앞의 길이 칸을 읽어 <b>${parts.length}개 메시지</b>(${parts.map(p => p.type).join(' ')})로 나눕니다. 그중 DataRow(D)가 ${rows}개 = 결과 ${rows}행.`,
    `The reply arrives from TCP as <b>${all.length} bytes</b> in one stream, and the receiver reads each message's length field to split it into <b>${parts.length} messages</b> (${parts.map(p => p.type).join(' ')}). ${rows} of them are DataRow (D) = ${rows} result rows.`);
}
function run() { msgs = build(); sel = Math.min(sel, msgs.length - 1); list(); detail(); stream(); }

function setMode(m) {
  mode = m;
  document.querySelectorAll('#wMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
  $('wPLabel').hidden = m !== 'ext';
  if (m === 'ext') { $('wSql').value = 'SELECT id, health FROM assets WHERE health >= ?'; $('wParams').value = '90'; }
  else $('wSql').value = 'SELECT id, health FROM assets WHERE health >= 90';
  sel = msgs.findIndex(x => x.name === (m === 'ext' ? 'Bind' : 'Query'));
  run();
  sel = msgs.findIndex(x => x.name === (m === 'ext' ? 'Bind' : 'Query'));
  list(); detail();
}

function pool() {
  const v = (id) => +$(id).value;
  const p = { n: v('pN'), gap: v('pGap'), queryMs: v('pQ'), connectMs: v('pC') };
  $('pNOut').textContent = p.n; $('pGapOut').textContent = p.gap + ' ms'; $('pQOut').textContent = p.queryMs + ' ms'; $('pCOut').textContent = p.connectMs + ' ms';
  const a = W.poolSim({ ...p, pool: 0 }), b = W.poolSim({ ...p, pool: +$('pSize').value });
  const mx = Math.max(a.avg, b.avg, 1);
  const row = (name, r, cls, extra) => `<div class="cmp-row"><div class="cmp-name">${name}</div><div class="cmp-bar"><i class="${cls}" style="width:${Math.max(2, r.avg / mx * 100)}%"></i><b>${T('평균', 'avg')} ${r.avg} ms</b></div><small>${T('가장 느린 요청', 'slowest')} ${r.max} ms · ${T('동시에 열린 연결', 'peak open connections')} ${r.maxOpen} · ${T('전부 끝난 시각', 'all done at')} ${r.done} ms${extra}</small></div>`;
  $('pBars').innerHTML = row(T('풀 없음: 요청마다 연결 맺고 → 질의 → 닫기', 'No pool: connect → query → close per request'), a, 'h10', '') +
    row(T(`풀 ${$('pSize').value}개: 미리 열어 둔 연결을 돌려 씀`, `Pool of ${$('pSize').value}: reuse connections opened beforehand`), b, 'h3', '');
  const waiting = b.avg > p.queryMs;
  $('pNote').innerHTML = waiting
    ? T(`풀의 연결이 모자라 요청이 줄을 섭니다 (평균이 질의 시간 ${p.queryMs} ms보다 큼). 풀을 키우거나, 요청 간격이 넓어지면 해소됩니다.`, `The pool has too few connections so requests queue (average exceeds the ${p.queryMs} ms query time). A bigger pool or wider gaps would clear it.`)
    : T(`풀 덕분에 연결 맺는 시간 ${p.connectMs} ms가 사라져 평균 ${a.avg} ms → ${b.avg} ms. 서버가 동시에 받는 연결도 ${a.maxOpen}개에서 ${b.maxOpen}개로 줄었습니다.`, `The pool removes the ${p.connectMs} ms connect time: average ${a.avg} ms → ${b.avg} ms, and the server's simultaneous connections drop from ${a.maxOpen} to ${b.maxOpen}.`);
}

$('wMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
$('wSql').addEventListener('input', run); $('wParams').addEventListener('input', run);
$('wList').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) { sel = +tr.dataset.i; list(); detail(); } });
$('wList').addEventListener('keydown', e => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-i]'); if (tr) { sel = +tr.dataset.i; list(); detail(); } } });
for (const id of ['pN', 'pGap', 'pQ', 'pC', 'pSize']) $(id).addEventListener('input', pool);
document.addEventListener('langchange', () => { list(); detail(); stream(); pool(); });
run(); sel = msgs.findIndex(x => x.name === 'Query'); list(); detail(); pool();
