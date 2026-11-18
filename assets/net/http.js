// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// HTTP 메시지: 요청 조립 · 요청/응답 해석(파싱) · 데모용 가짜 서버 · 버전별 왕복 시간 비교.
// HTTP/1.x 메시지는 "시작 줄 + 헤더 줄들 + 빈 줄 + 본문"으로 된 글자다. 줄 끝은 CRLF(\r\n). 브라우저 없이 node 로 테스트: tests/net.test.mjs

export const CRLF = '\r\n';
export const byteLen = (s) => new TextEncoder().encode(s).length;
export const hget = (headers, name) => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value;

export const REASON = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 405: 'Method Not Allowed', 415: 'Unsupported Media Type', 500: 'Internal Server Error' };

export function buildRequest({ method = 'GET', target = '/', version = 'HTTP/1.1', headers = [], body = '', autoLength = true }) {
  const hs = headers.filter(h => h.name.trim()).map(h => ({ name: h.name.trim(), value: h.value.trim() }));
  if (body && autoLength && hget(hs, 'content-length') === undefined) hs.push({ name: 'Content-Length', value: String(byteLen(body)) });
  const start = `${method} ${target} ${version}`;
  return { start, headers: hs, body, raw: start + CRLF + hs.map(h => `${h.name}: ${h.value}${CRLF}`).join('') + CRLF + body };
}

// 글자 → { start, headers, body } (헤더가 아직 다 안 왔으면 incomplete)
export function parseMessage(raw) {
  const end = raw.indexOf(CRLF + CRLF);
  if (end < 0) return { incomplete: true };
  const lines = raw.slice(0, end).split(CRLF);
  const headers = [];
  for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i <= 0) return { error: 'header' }; headers.push({ name: l.slice(0, i), value: l.slice(i + 1).trim() }); }
  return { start: lines[0], headers, body: raw.slice(end + 4) };
}
export function parseRequest(raw) {
  const m = parseMessage(raw);
  if (!m.start) return { error: m.error || 'incomplete' };
  const p = m.start.split(' ');
  if (p.length !== 3 || !/^HTTP\/\d\.\d$/.test(p[2]) || !/^[A-Z]+$/.test(p[0])) return { error: 'start-line', ...m };
  return { method: p[0], target: p[1], version: p[2], headers: m.headers, body: m.body };
}
export function parseResponse(raw) {
  const m = parseMessage(raw);
  if (!m.start) return { error: m.error || 'incomplete' };
  const x = /^(HTTP\/\d\.\d) (\d{3}) ?(.*)$/.exec(m.start);
  return x ? { version: x[1], status: +x[2], reason: x[3], headers: m.headers, body: m.body } : { error: 'status-line' };
}

const DATE = 'Wed, 18 Nov 2026 09:00:00 GMT';
export function buildResponse({ version = 'HTTP/1.1', status, headers = [], body = '', noBody = false }) {
  const hs = [...headers];
  const bodyless = status === 204 || status === 304 || status < 200;
  if (!bodyless && hget(hs, 'content-length') === undefined) hs.push({ name: 'Content-Length', value: String(byteLen(body)) });
  const shown = noBody || bodyless ? '' : body;
  return { start: `${version} ${status} ${REASON[status] || ''}`.trim(), headers: hs, body: shown, raw: `${version} ${status} ${REASON[status] || ''}`.trim() + CRLF + hs.map(h => `${h.name}: ${h.value}${CRLF}`).join('') + CRLF + shown };
}

// 데모용 가짜 서버: 파싱된 요청 → 응답 (실제 서버가 하는 일의 아주 작은 흉내)
export function serve(req) {
  const finish = (status, o = {}) => {
    const keep = req.version === 'HTTP/1.1' && (hget(req.headers || [], 'connection') || '').toLowerCase() !== 'close';
    const headers = [{ name: 'Date', value: DATE }, { name: 'Server', value: 'demo/1.0' }, ...(o.headers || []), { name: 'Connection', value: keep ? 'keep-alive' : 'close' }];
    return buildResponse({ version: req.version === 'HTTP/1.0' ? 'HTTP/1.0' : 'HTTP/1.1', status, headers, body: o.body || '', noBody: o.noBody });
  };
  const type = (t) => ({ name: 'Content-Type', value: t });
  if (req.error) return finish(400, { headers: [type('text/plain')], body: 'Bad Request: malformed message' });
  const h = req.headers;
  if (req.version === 'HTTP/1.1' && hget(h, 'host') === undefined) return finish(400, { headers: [type('text/plain')], body: 'Bad Request: HTTP/1.1 requires a Host header' });
  const u = new URL(req.target, 'http://x'), path = u.pathname, m = req.method, head = m === 'HEAD', get = m === 'GET' || head;
  const wrong = (allow) => finish(405, { headers: [{ name: 'Allow', value: allow }, type('text/plain')], body: 'Method Not Allowed' });
  if (path === '/') {
    if (!get) return wrong('GET, HEAD');
    const et = { name: 'ETag', value: '"v1"' };
    if (hget(h, 'if-none-match') === '"v1"') return finish(304, { headers: [et] });
    return finish(200, { headers: [type('text/html; charset=utf-8'), et], body: '<h1>Hello, HTTP!</h1>', noBody: head });
  }
  if (path === '/api/hello') {
    if (!get) return wrong('GET, HEAD');
    return finish(200, { headers: [type('application/json')], body: JSON.stringify({ message: `Hello, ${u.searchParams.get('name') || 'world'}!` }), noBody: head });
  }
  if (path === '/old') return get ? finish(301, { headers: [{ name: 'Location', value: '/new' }, type('text/plain')], body: 'Moved to /new' }) : wrong('GET, HEAD');
  if (path === '/new') return get ? finish(200, { headers: [type('text/plain')], body: 'You arrived at the new address.', noBody: head }) : wrong('GET, HEAD');
  if (path === '/secret') {
    if (!get) return wrong('GET, HEAD');
    return hget(h, 'authorization') === undefined ? finish(401, { headers: [{ name: 'WWW-Authenticate', value: 'Basic realm="demo"' }, type('text/plain')], body: 'Authentication required' }) : finish(200, { headers: [type('text/plain')], body: 'The secret is 42.', noBody: head });
  }
  if (path === '/error') return finish(500, { headers: [type('text/plain')], body: 'Something broke on the server' });
  if (path === '/api/items') {
    if (m === 'POST') {
      if (!(hget(h, 'content-type') || '').includes('application/json')) return finish(415, { headers: [type('text/plain')], body: 'Send application/json' });
      if (!req.body) return finish(400, { headers: [type('text/plain')], body: 'Empty body' });
      let data; try { data = JSON.parse(req.body); } catch { return finish(400, { headers: [type('text/plain')], body: 'Body is not valid JSON' }); }
      return finish(201, { headers: [type('application/json'), { name: 'Location', value: '/api/items/1' }], body: JSON.stringify({ id: 1, ...data }) });
    }
    return get ? finish(200, { headers: [type('application/json')], body: '[{"id":1}]', noBody: head }) : wrong('GET, HEAD, POST');
  }
  if (path === '/api/items/1') {
    if (m === 'DELETE') return finish(204);
    return get ? finish(200, { headers: [type('application/json')], body: '{"id":1}', noBody: head }) : wrong('GET, HEAD, DELETE');
  }
  return finish(404, { headers: [type('text/plain')], body: 'Not Found' });
}

// 한 번에 TCP 세그먼트가 몇 개 나가나 (MTU 1500 → MSS 1460)
export const segmentsFor = (bytes, mss = 1460) => Math.max(1, Math.ceil(bytes / mss));

// ---- 시간 모형 (아주 단순화: 대역폭 · 혼잡 제어 · 서버 병렬성 · 캐시 · DNS 는 넣지 않음) -------------------
const TLS_RTT = { none: 0, '1.3': 1, '1.2': 2 };
/** 같은 자원 n개를 받는 데 걸리는 시간. rtt(ms) 왕복, parallel 브라우저가 한 서버에 여는 연결 수, think 서버 처리 시간(ms) */
export function compare({ n = 10, rtt = 80, parallel = 6, tls = '1.3', think = 10 } = {}) {
  const tr = TLS_RTT[tls], rounds = Math.ceil(n / Math.max(1, parallel)), conn = 1 + tr;     // 연결 준비: TCP 1 + TLS
  const row = (id, setup, exchanges, thinkTotal, extra = {}) => ({ id, setup, exchanges, think: thinkTotal, ms: (setup + exchanges) * rtt + thinkTotal, ...extra });
  return [
    row('h10', conn * rounds, rounds, rounds * think),          // 요청마다 연결을 새로 엶
    row('h11', conn, rounds, rounds * think),                   // 연결 재사용, 연결 하나에서는 한 번에 하나씩
    row('h2', conn, 1, think),                                  // 한 연결에 여러 요청을 동시에 (다중화)
    row('h3', 1, 1, think),                                     // QUIC: 연결 준비와 TLS 1.3 이 한 번에
    row('h3z', 0, 1, think)                                     // 이전에 접속한 적 있으면 0-RTT
  ];
}

/** 첫 요청 하나가 겪는 일 (DNS → TCP → TLS → 요청/응답) */
export function timeline({ rtt = 80, tls = '1.3', think = 10, dns = true } = {}) {
  return [
    ...(dns ? [{ id: 'dns', ms: rtt }] : []),
    { id: 'tcp', ms: rtt },
    ...(TLS_RTT[tls] ? [{ id: 'tls', ms: TLS_RTT[tls] * rtt }] : []),
    { id: 'req', ms: rtt + think }
  ];
}
