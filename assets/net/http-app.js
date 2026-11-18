// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// HTTP 페이지: 요청을 만들어 보내면 가짜 서버가 응답하고, 두 메시지를 글자 그대로(줄 끝 CRLF까지) 보여 준다. 버전별 왕복 시간 비교도 함께
import { buildRequest, parseRequest, parseResponse, serve, segmentsFor, byteLen, hget, compare, timeline } from './http.js?v=b49792cc';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const JSON_BODY = '{"name":"충전기 #1"}';
const H = (...l) => l.join('\n');
const PRESETS = [
  { id: 'get', ko: '페이지 가져오기', en: 'Fetch a page', method: 'GET', target: '/', version: 'HTTP/1.1', headers: H('Host: example.com', 'User-Agent: demo-browser/1.0', 'Accept: text/html'), body: '' },
  { id: 'json', ko: 'JSON 가져오기', en: 'Fetch JSON', method: 'GET', target: '/api/hello?name=Ann', version: 'HTTP/1.1', headers: H('Host: example.com', 'Accept: application/json'), body: '' },
  { id: 'post', ko: 'POST로 만들기', en: 'Create with POST', method: 'POST', target: '/api/items', version: 'HTTP/1.1', headers: H('Host: example.com', 'Content-Type: application/json'), body: JSON_BODY },
  { id: 'redir', ko: '리다이렉트', en: 'Redirect', method: 'GET', target: '/old', version: 'HTTP/1.1', headers: H('Host: example.com'), body: '' },
  { id: 'cond', ko: '조건부 요청 (캐시)', en: 'Conditional (cache)', method: 'GET', target: '/', version: 'HTTP/1.1', headers: H('Host: example.com', 'If-None-Match: "v1"'), body: '' },
  { id: 'auth', ko: '인증 필요', en: 'Needs auth', method: 'GET', target: '/secret', version: 'HTTP/1.1', headers: H('Host: example.com'), body: '' },
  { id: 'nohost', ko: 'Host 빠짐', en: 'Missing Host', method: 'GET', target: '/', version: 'HTTP/1.1', headers: '', body: '' },
  { id: 'head', ko: 'HEAD', en: 'HEAD', method: 'HEAD', target: '/', version: 'HTTP/1.1', headers: H('Host: example.com'), body: '' },
  { id: 'missing', ko: '없는 주소', en: 'Unknown address', method: 'GET', target: '/missing', version: 'HTTP/1.1', headers: H('Host: example.com'), body: '' }
];
const EXPLAIN = {
  200: ['성공. 요청한 것을 본문에 담아 돌려줍니다.', 'Success: the requested thing is in the body.'],
  201: ['만들어졌습니다. Location 헤더가 새 자원의 주소입니다.', 'Created. The Location header is the new resource\'s address.'],
  204: ['성공했지만 돌려줄 본문이 없습니다 (보통 DELETE).', 'Success with nothing to return (typically DELETE).'],
  301: ['영구 이동. Location의 새 주소로 다시 요청하라는 뜻입니다. 아래 버튼으로 따라가 보세요.', 'Moved permanently: ask again at the address in Location. Follow it with the button below.'],
  304: ['바뀐 것 없음. 본문을 다시 보내지 않으니 가지고 있는 사본을 쓰라는 뜻입니다 (If-None-Match와 ETag가 같았음).', 'Not modified: no body is sent again, use your own copy (If-None-Match matched the ETag).'],
  400: ['요청이 잘못됐습니다. 서버가 읽을 수 없거나, 필수 헤더(HTTP/1.1의 Host 등)가 빠졌거나, 본문이 틀렸습니다.', 'Bad request: unreadable, a required header (like Host in HTTP/1.1) is missing, or the body is wrong.'],
  401: ['인증이 필요합니다. Authorization 헤더로 신원을 증명해야 합니다. (권한이 없는 것은 403)', 'Authentication needed: prove who you are with an Authorization header. (Having no permission is 403.)'],
  404: ['그 주소에는 아무것도 없습니다.', 'Nothing lives at that address.'],
  405: ['그 주소는 이 메서드를 허용하지 않습니다. Allow 헤더가 허용되는 메서드입니다.', 'That address does not allow this method; the Allow header lists what it does.'],
  415: ['본문의 형식(Content-Type)을 서버가 받지 않습니다.', 'The server does not accept the body\'s format (Content-Type).'],
  500: ['서버 안에서 문제가 생겼습니다. 요청 탓이 아닙니다.', 'Something broke inside the server; the request is not at fault.']
};
const NAMES = {
  h10: ['HTTP/1.0 — 요청마다 새 연결', 'HTTP/1.0 — a new connection per request'],
  h11: ['HTTP/1.1 — 연결 재사용 (연결당 한 번에 하나)', 'HTTP/1.1 — reuse connections (one at a time each)'],
  h2: ['HTTP/2 — 한 연결에 다중화', 'HTTP/2 — multiplexed on one connection'],
  h3: ['HTTP/3 — QUIC (UDP 위)', 'HTTP/3 — QUIC (over UDP)'],
  h3z: ['HTTP/3 — 재접속 0-RTT', 'HTTP/3 — resumed 0-RTT']
};
const STEP = { dns: ['DNS 조회', 'DNS lookup'], tcp: ['TCP 연결 (3-way handshake)', 'TCP connect (3-way handshake)'], tls: ['TLS 암호화 협상', 'TLS negotiation'], req: ['요청 → 응답', 'Request → response'] };
let last = null, preset = 'get';

const lines = (txt) => txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf(':'); return i > 0 ? { name: l.slice(0, i), value: l.slice(i + 1) } : { name: l, value: '' }; });
const hdrs = (a) => a.map(h => `${h.name}: ${h.value}`).join('\n');

function msgHtml(m, cls = '') {
  const nl = '<span class="crlf">␍␊</span>';
  const o = [`<span class="m-start ${cls}">${esc(m.start)}</span>${nl}`];
  for (const h of m.headers) o.push(`<span class="m-head"><b>${esc(h.name)}</b>: ${esc(h.value)}</span>${nl}`);
  o.push(`${nl} <span class="m-note">← ${T('빈 줄 = 헤더의 끝', 'blank line = end of headers')}</span>`);
  if (m.body) o.push(`<span class="m-body">${esc(m.body)}</span>`);
  return o.join('\n');
}

function run() {
  const req = buildRequest({ method: $('hMethod').value, target: $('hTarget').value || '/', version: $('hVersion').value, headers: lines($('hHeaders').value), body: $('hBody').value.replace(/\r?\n/g, '\n'), autoLength: $('hAuto').checked });
  const res = serve(parseRequest(req.raw));
  const back = parseResponse(res.raw);
  last = { req, res, back };
  $('hReq').innerHTML = msgHtml(req);
  $('hRes').innerHTML = msgHtml(res, 's' + Math.floor(back.status / 100));
  const rb = byteLen(req.raw), sb = byteLen(res.raw);
  $('hSizes').innerHTML = T(
    `요청 <b>${rb} 바이트</b> (TCP 세그먼트 ${segmentsFor(rb)}개) → 응답 <b>${sb} 바이트</b> (세그먼트 ${segmentsFor(sb)}개). 이 글자 그대로가 소켓의 <code>send()</code> · <code>recv()</code>를 오갑니다.`,
    `Request <b>${rb} bytes</b> (${segmentsFor(rb)} TCP segment${segmentsFor(rb) > 1 ? 's' : ''}) → response <b>${sb} bytes</b> (${segmentsFor(sb)} segment${segmentsFor(sb) > 1 ? 's' : ''}). This exact text is what travels through the socket's <code>send()</code> and <code>recv()</code>.`);
  const ex = EXPLAIN[back.status];
  $('hMeaning').innerHTML = `<b class="st s${Math.floor(back.status / 100)}">${back.status} ${esc(back.reason)}</b> — ${ex ? t({ ko: ex[0], en: ex[1] }) : ''}`;
  const loc = hget(back.headers, 'location');
  $('hFollow').hidden = !(back.status >= 300 && back.status < 400 && loc);
  $('hFollow').dataset.loc = loc || '';
}

function bars() {
  const p = { n: +$('cN').value, rtt: +$('cRtt').value, parallel: +$('cPar').value, tls: $('cTls').value, think: +$('cThink').value };
  $('cNOut').textContent = p.n; $('cRttOut').textContent = p.rtt + ' ms'; $('cParOut').textContent = p.parallel; $('cThinkOut').textContent = p.think + ' ms';
  const rows = compare(p), max = Math.max(...rows.map(r => r.ms));
  $('cBars').innerHTML = rows.map(r => `<div class="cmp-row"><div class="cmp-name">${t({ ko: NAMES[r.id][0], en: NAMES[r.id][1] })}</div><div class="cmp-bar"><i class="${r.id}" style="width:${(r.ms / max * 100).toFixed(1)}%"></i><b>${Math.round(r.ms)} ms</b></div><small>${T(`연결 준비 ${r.setup} RTT + 요청·응답 ${r.exchanges} RTT + 서버 ${r.think} ms`, `setup ${r.setup} RTT + request/response ${r.exchanges} RTT + server ${r.think} ms`)}</small></div>`).join('');
  const tl = timeline({ rtt: p.rtt, tls: p.tls, think: p.think, dns: $('cDns').checked }), tot = tl.reduce((s, x) => s + x.ms, 0);
  $('cTime').innerHTML = `<div class="tl-bar">${tl.map(x => `<i class="${x.id}" style="flex:${x.ms}" title="${esc(t({ ko: STEP[x.id][0], en: STEP[x.id][1] }))}">${x.ms >= tot * 0.12 ? Math.round(x.ms) : ''}</i>`).join('')}</div><ul class="lg">${tl.map(x => `<li><i class="sw ${x.id}"></i>${t({ ko: STEP[x.id][0], en: STEP[x.id][1] })} — ${Math.round(x.ms)} ms</li>`).join('')}</ul><p class="meta">${T(`첫 응답이 오기까지 약 ${Math.round(tot)} ms. 같은 서버에 다시 요청하면 연결을 재사용하므로 DNS · TCP · TLS 단계는 사라지고 ${p.rtt + p.think} ms 만 걸립니다.`, `About ${Math.round(tot)} ms before the first response arrives. A second request to the same server reuses the connection, so the DNS, TCP and TLS steps vanish and only ${p.rtt + p.think} ms remain.`)}</p>`;
}

function applyPreset(id) {
  const p = PRESETS.find(x => x.id === id); preset = id;
  $('hMethod').value = p.method; $('hTarget').value = p.target; $('hVersion').value = p.version; $('hHeaders').value = p.headers; $('hBody').value = p.body;
  presetBtns(); run();
}
function presetBtns() { $('hPresets').innerHTML = PRESETS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${p.id === preset}">${t(p)}</button>`).join(''); }

function init() {
  $('hPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) applyPreset(b.dataset.id); });
  for (const id of ['hMethod', 'hTarget', 'hVersion', 'hHeaders', 'hBody', 'hAuto']) $(id).addEventListener('input', () => { preset = ''; presetBtns(); run(); });
  $('hFollow').addEventListener('click', () => { $('hTarget').value = $('hFollow').dataset.loc; preset = ''; presetBtns(); run(); });
  for (const id of ['cN', 'cRtt', 'cPar', 'cTls', 'cThink', 'cDns']) $(id).addEventListener('input', bars);
  document.addEventListener('langchange', () => { presetBtns(); run(); bars(); });
  applyPreset('get'); bars();
}
init();
