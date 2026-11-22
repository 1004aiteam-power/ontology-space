// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 서비스 계층 페이지: HTTP 요청을 만들어 데모 서비스에 보내고, 응답과 서비스가 DB에 보낸 SQL을 함께 보여 준다 (계산은 service.js)
import { makeDB } from './data.js?v=b680931a';
import { createService } from './service.js?v=75f95531';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';
import { sqlHtml } from './ui.js?v=2ed6a6af';

let db = makeDB(), handle = createService(db);
const REASON = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity' };
const EXPLAIN = {
  200: ['성공. 조회자에게는 installed(설치 연도) 필드가 빠져 있습니다 — 서비스가 보여 줄 필드를 정합니다.', 'Success. The installed field is missing for viewers: the service decides which fields to show.'],
  201: ['만들어졌습니다. Location이 새 자원의 주소이고, 서비스가 INSERT 한 번을 DB에 보냈습니다.', 'Created. Location is the new resource\'s address, and the service sent one INSERT to the DB.'],
  204: ['삭제됨. 돌려줄 본문이 없습니다.', 'Deleted; nothing to return.'],
  400: ['요청이 잘못됐습니다 (예: 숫자여야 할 값이 글자).', 'Bad request (for example a number expected but text given).'],
  401: ['누군지 모르는 요청입니다. 이 경우 서비스는 DB에 아무것도 묻지 않았습니다 (SQL 칸이 비어 있음).', 'The caller is unknown. The service asked the DB nothing (the SQL box is empty).'],
  403: ['누군지는 알지만 이 일을 할 권한이 없습니다(편집자 필요). DB에는 아무것도 묻지 않았습니다.', 'Known caller without permission (editor needed). The DB was not asked anything.'],
  404: ['없는 주소 또는 자원입니다. 경로의 따옴표 같은 글자도 바인딩 덕분에 그냥 "없는 id"로 처리됩니다.', 'No such address or resource. Even quote characters in the path are just a "missing id" thanks to binding.'],
  405: ['그 주소에 허용되지 않는 메서드입니다. Allow 헤더가 허용되는 것을 알려 줍니다.', 'Method not allowed at that address; the Allow header lists what is.'],
  409: ['이미 있는 id입니다. 같은 POST를 다시 보내면 이렇게 중복이 막힙니다.', 'That id already exists. This is how a repeated POST is stopped from duplicating.'],
  422: ['형식은 맞지만 값이 규칙에 어긋납니다. 이유가 errors에 적혀 있고, DB에는 아무것도 쓰지 않았습니다.', 'Well-formed but the values break the rules. Reasons are in errors, and nothing was written to the DB.']
};
const J = (o) => JSON.stringify(o);
const PRESETS = [
  { ko: '목록 (조회자)', en: 'List (viewer)', m: 'GET', p: '/api/assets?type=breaker&min_health=70', tok: 'tok-viewer', b: '' },
  { ko: '하나 (조회자)', en: 'One (viewer)', m: 'GET', p: '/api/assets/T1', tok: 'tok-viewer', b: '' },
  { ko: '하나 (편집자)', en: 'One (editor)', m: 'GET', p: '/api/assets/T1', tok: 'tok-editor', b: '' },
  { ko: '토큰 없음', en: 'No token', m: 'GET', p: '/api/assets/T1', tok: '', b: '' },
  { ko: '만들기 (조회자)', en: 'Create (viewer)', m: 'POST', p: '/api/assets', tok: 'tok-viewer', b: J({ id: 'T9', type: 'transformer', name: 'MTr-9', health: 90 }) },
  { ko: '잘못된 값으로 만들기', en: 'Create, bad values', m: 'POST', p: '/api/assets', tok: 'tok-editor', b: J({ id: 'x', type: 'toaster', health: 150 }) },
  { ko: '만들기 (편집자)', en: 'Create (editor)', m: 'POST', p: '/api/assets', tok: 'tok-editor', b: J({ id: 'T9', type: 'transformer', name: 'MTr-9', health: 90, substation_id: 'S2' }) },
  { ko: '건전도 수정', en: 'Update health', m: 'PATCH', p: '/api/assets/T4', tok: 'tok-editor', b: J({ health: 55 }) },
  { ko: '삭제', en: 'Delete', m: 'DELETE', p: '/api/assets/T9', tok: 'tok-editor', b: '' },
  { ko: "경로에 인젝션", en: 'Injection in the path', m: 'GET', p: "/api/assets/T1' OR '1'='1", tok: 'tok-editor', b: '' },
  { ko: '허용 안 된 메서드', en: 'Disallowed method', m: 'PUT', p: '/api/assets/T1', tok: 'tok-editor', b: '' }
];

function send() {
  const method = $('sMethod').value, full = $('sPath').value, tok = $('sTok').value;
  const [path, qs] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
  let body = null, bodyErr = '';
  const raw = $('sBody').value.trim();
  if (raw) { try { body = JSON.parse(raw); } catch { bodyErr = T('본문이 올바른 JSON이 아닙니다 (보내지 않음)', 'The body is not valid JSON (not sent)'); } }
  $('sReq').textContent = `${method} ${full} HTTP/1.1\nHost: api.example.com\n${tok ? `Authorization: Bearer ${tok}\n` : ''}${raw ? `Content-Type: application/json\nContent-Length: ${new TextEncoder().encode(raw).length}\n\n${raw}` : ''}`;
  if (bodyErr) { $('sRes').textContent = ''; $('sSql').textContent = ''; $('sWhy').textContent = bodyErr; return; }
  const r = handle({ method, path, query, headers, body });
  const hd = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  $('sRes').textContent = `HTTP/1.1 ${r.status} ${REASON[r.status] || ''}\n${hd}\n\n${r.body === null ? '' : JSON.stringify(r.body, null, 2)}`;
  $('sSql').innerHTML = r.sql.length ? r.sql.map(q => sqlHtml(q.sql) + (q.params.length ? `  <span class="cm">-- ${esc(JSON.stringify(q.params))}</span>` : '')).join('\n') : `<span class="cm">${T('-- DB에 보낸 SQL 없음', '-- no SQL sent to the DB')}</span>`;
  $('sWhy').textContent = t({ ko: EXPLAIN[r.status]?.[0] || '', en: EXPLAIN[r.status]?.[1] || '' });
}
function setPreset(i) {
  const p = PRESETS[i];
  $('sMethod').value = p.m; $('sPath').value = p.p; $('sTok').value = p.tok; $('sBody').value = p.b ? JSON.stringify(JSON.parse(p.b), null, 2) : '';
  send();
}
function render() {
  $('sPresets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-i="${i}">${t(p)}</button>`).join('');
  send();
}
$('sPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setPreset(+b.dataset.i); });
$('sSend').addEventListener('click', send);
$('sReset').addEventListener('click', () => { db = makeDB(); handle = createService(db); send(); });
document.addEventListener('langchange', render);
render();
setPreset(0);
