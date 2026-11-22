// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 최근 흐름 페이지: (1) 주소 → SQL → JSON 자동 생성 API (2) 자연어 → SQL 초안 → 안전 점검 → 실행 (계산은 modern.js)
import { makeDB } from './data.js?v=b680931a';
import { runPostgrest, guard, nlToSql, NL_PRESETS } from './modern.js?v=336b2673';
import { SqlError } from './minisql.js?v=7ebfcdc8';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';
import { sqlHtml, tableHtml, tag } from './ui.js?v=2ed6a6af';

const db = makeDB();
const URLS = [
  { ko: '변압기만 건전도순 2개', en: 'Top 2 transformers by health', u: '/assets?select=name,health&type=eq.transformer&order=health.desc&limit=2' },
  { ko: '소속 변전소를 함께 (포함)', en: 'With its substation (embedding)', u: '/assets?select=name,health,substations(name)&health=lt.60' },
  { ko: '변전소 + 설비 목록', en: 'Substations + their assets', u: '/substations?select=name,assets(name,health)&limit=2' },
  { ko: '여러 값 (in)', en: 'Several values (in)', u: '/assets?type=in.(cable,relay)&select=id,type' },
  { ko: '없는 열', en: 'A missing column', u: '/assets?foo=eq.1' },
  { ko: '없는 표', en: 'A missing table', u: '/users' }
];
const STATUS = { 200: 'OK', 400: 'Bad Request', 404: 'Not Found' };

function auto() {
  const url = $('pUrl').value.trim();
  const r = runPostgrest(db, url);
  $('pSql').innerHTML = r.sql ? sqlHtml(r.sql) + (r.params.length ? `\n<span class="cm">-- ${T('바인딩 값', 'bound values')}: ${esc(JSON.stringify(r.params))}</span>` : '') : `<span class="cm">${T('-- SQL을 만들지 않음 (주소를 거절)', '-- no SQL built (address rejected)')}</span>`;
  $('pStatus').innerHTML = `HTTP ${r.status} ${STATUS[r.status] || ''}`;
  $('pRes').textContent = JSON.stringify(r.body, null, 2);
  $('pNote').textContent = r.status === 200
    ? T('서비스 코드는 한 줄도 쓰지 않았습니다. 표 구조(스키마)가 곧 API의 계약이 되었고, 값은 바인딩되어 인젝션도 막혔습니다. 반대로 표 구조를 바꾸면 API도 같이 바뀐다는 뜻입니다.',
      'Not a line of service code was written. The table structure (schema) became the API contract, and values are bound so injection is blocked too. The flip side: change the table structure and the API changes with it.')
    : T('열과 표 이름을 스키마와 대조해 모르는 이름이면 SQL을 만들기 전에 거절합니다.', 'Column and table names are checked against the schema and unknown ones are rejected before any SQL is built.');
}

function agent() {
  const q = $('aQ').value.trim();
  const draft = nlToSql(q);
  if (!draft) {
    $('aDraft').textContent = T('(이 대역은 이 질문을 SQL로 바꾸지 못했습니다. 위 예시를 눌러 보세요.)', '(This stand-in could not turn that question into SQL. Try the examples above.)');
    $('aGuard').innerHTML = ''; $('aFinal').textContent = ''; $('aRes').innerHTML = '';
    return;
  }
  $('aDraft').innerHTML = sqlHtml(draft);
  const g = guard(draft);
  const probs = g.problems.map(p => `<li>${tag(false, p.ko, p.en)}</li>`).join('');
  const notes = (g.notes || []).map(n => `<li>${tag(true, n.ko, n.en)}</li>`).join('');
  $('aGuard').innerHTML = g.ok
    ? `<ul class="ag-list"><li>${tag(true, '통과: 문장 하나 · SELECT · 허용된 표', 'Passed: one statement, SELECT, allow-listed tables')}</li>${notes}</ul>`
    : `<ul class="ag-list">${probs}</ul><p class="meta">${T('→ 실행하지 않고 에이전트에게 거절 사유를 돌려줍니다.', '→ Not executed; the reasons for refusal go back to the agent.')}</p>`;
  if (!g.ok) { $('aFinal').innerHTML = `<span class="cm">${T('-- 실행 안 함', '-- not run')}</span>`; $('aRes').innerHTML = ''; return; }
  $('aFinal').innerHTML = sqlHtml(g.sql);
  try { const r = makeDB().exec(g.sql); $('aRes').innerHTML = tableHtml(r.columns, r.rows); }
  catch (e) { if (!(e instanceof SqlError)) throw e; $('aRes').innerHTML = tag(false, '실행 오류: ' + e.message, 'Execution error: ' + e.message); }
}

function table() {
  const R = [
    ['자동 생성 API', 'Auto-generated API', 'PostgREST · Hasura · Supabase', '서비스 도구가 계정 보유', 'the tool holds the account', '빠른 개발 · 단순 CRUD', 'Fast builds, plain CRUD', '표 구조가 계약이 됨, RLS 필수', 'Table layout becomes the contract; RLS essential'],
    ['BaaS', 'BaaS', 'Supabase · Firebase', '플랫폼이 계정 보유', 'the platform holds the account', '작은 팀의 앱 전체', 'A small team\'s whole app', '벤더 종속, 규칙이 복잡하면 한계', 'Vendor lock-in; limits as rules grow complex'],
    ['서버리스 + HTTP 드라이버', 'Serverless + HTTP driver', 'Neon · Turso · D1 · Aurora Data API', '함수가 계정 보유', 'functions hold the account', '요청마다 잠깐 뜨는 환경', 'Short-lived per-request environments', '요청당 지연 · 연결 중계 필요', 'Per-request latency; needs a connection proxy'],
    ['변경 구독 (CDC)', 'Change subscription (CDC)', 'Debezium · 논리 복제', '구독 도구가 읽기 권한 보유', 'the subscriber holds read access', '동기화 · 실시간 · 감사', 'Sync, real time, audit', '순서 · 중복 처리, 스키마 변경 대응', 'Ordering, duplicates, schema changes'],
    ['AI 에이전트 도구', 'AI agent tools', 'MCP 서버 · Text-to-SQL', '도구(서버)가 계정 보유, 에이전트는 못 봄', 'the tool (server) holds it; the agent never sees it', '그때그때 묻는 탐색', 'Ad hoc exploration', '프롬프트 인젝션 · 틀린 SQL, 점검 필수', 'Prompt injection and wrong SQL; checks essential']
  ];
  $('mapTab').innerHTML = `<thead><tr><th>${T('방식', 'Approach')}</th><th>${T('예', 'Examples')}</th><th>${T('DB 계정은 누가', 'Who holds the DB account')}</th><th>${T('잘 맞는 곳', 'Fits')}</th><th>${T('조심할 점', 'Watch out for')}</th></tr></thead><tbody>` +
    R.map(r => `<tr><td><b>${T(r[0], r[1])}</b></td><td>${esc(r[2])}</td><td>${T(r[3], r[4])}</td><td>${T(r[5], r[6])}</td><td>${T(r[7], r[8])}</td></tr>`).join('') + '</tbody>';
}
function render() {
  $('pPresets').innerHTML = URLS.map((p, i) => `<button type="button" data-i="${i}">${t(p)}</button>`).join('');
  $('aPresets').innerHTML = NL_PRESETS.map((p, i) => `<button type="button" data-i="${i}">${t(p)}</button>`).join('');
  auto(); agent(); table();
}
$('pPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('pUrl').value = URLS[+b.dataset.i].u; auto(); } });
$('aPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('aQ').value = t(NL_PRESETS[+b.dataset.i]); agent(); } });
$('pUrl').addEventListener('input', auto); $('aQ').addEventListener('input', agent);
document.addEventListener('langchange', render);
$('pUrl').value = URLS[0].u; $('aQ').value = t(NL_PRESETS[0]);
render();
