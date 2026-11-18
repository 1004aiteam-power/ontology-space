// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 네트워크 스택 페이지의 계산 점검 (브라우저 없이) — 실행: node tests/net.test.mjs
import assert from 'node:assert/strict';
import { checksum16, crc32, buildPackets, utf8 } from '../assets/net/packet.js';
import { simulate, ISN_C, SEG } from '../assets/net/tcp.js';

// 1) 체크섬 · CRC: 알려진 값과 맞는다
const ipHead = [0x45, 0, 0, 0x73, 0, 0, 0x40, 0, 0x40, 0x11, 0, 0, 0xc0, 0xa8, 0, 0x01, 0xc0, 0xa8, 0, 0xc7];
assert.equal(checksum16(ipHead), 0xb861, 'IPv4 header checksum (well-known example)');
assert.equal(crc32(utf8('123456789')), 0xcbf43926, 'CRC-32 check value');
console.log('✓ internet checksum and CRC-32 match the known values');

// 2) 패킷 조립: 길이 · 분할 · 검증이 맞는다
const one = buildPackets({ text: 'Hi', mtu: 1500 });
assert.equal(one.packets.length, 1);
const p = one.packets[0];
assert.equal(p.frame.length, 14 + 20 + 20 + 6 + 4 + 0, 'Ethernet frame = 14 + 20 + 20 + data(padded to 46 payload) + 4');
assert.equal(p.frame.length, 14 + 46 + 4, 'short data is padded up to the 46-byte minimum payload');
assert.deepEqual([p.ok.ip, p.ok.tcp, p.ok.fcs], [true, true, true]);
assert.equal(p.layer.length, p.frame.length);
const big = buildPackets({ text: 'x'.repeat(1000), mtu: 200 });
assert.equal(big.mss, 160);
assert.equal(big.packets.length, Math.ceil(1000 / 160));
assert.equal(big.packets.reduce((s, k) => s + k.payload.length, 0), 1000, 'the pieces add up to the original data');
assert.equal(big.packets[1].seq - big.packets[0].seq, 160, 'sequence number advances by the bytes sent');
assert.ok(big.packets.every(k => k.ok.ip && k.ok.tcp && k.ok.fcs && k.frame.length <= 200 + 18), 'every frame verifies and fits the MTU');
assert.deepEqual(big.packets.map(k => k.tcp.flags.includes('PSH')), big.packets.map((_, i) => i === big.packets.length - 1), 'PSH only on the last piece');
const crlf = buildPackets({ text: 'a\nb', crlf: true });
assert.deepEqual(crlf.data, [97, 13, 10, 98]);
assert.equal(buildPackets({ text: 'x', srcIp: '999.1.1.1' }).error, 'ip');
console.log('✓ packets are assembled with correct lengths, splitting and verified checksums');

// 3) TCP 모의 실험: 어떤 상황에서도 데이터가 순서대로 다 가고 양쪽이 닫힌다
const clean = simulate({ segments: 6, loss: 0, window: 3 });
assert.equal(clean.packets.length, 2 * 6 + 7, 'SYN · SYN-ACK · ACK + 6 data + 6 ACK + FIN · ACK · FIN · ACK');
assert.ok(clean.packets.every(k => !k.lost && !k.retx) && clean.delivered);
assert.deepEqual(clean.packets.slice(0, 3).map(k => k.flags.join('+')), ['SYN', 'SYN+ACK', 'ACK'], '3-way handshake first');
assert.equal(clean.packets[0].seq, ISN_C);
const finals = (r) => Object.fromEntries(['client', 'server'].map(s => [s, r.states.filter(x => x.side === s).pop().state]));
assert.deepEqual(finals(clean), { client: 'CLOSED', server: 'CLOSED' });
for (const loss of [0.1, 0.2, 0.3]) {
  for (let seed = 1; seed <= 150; seed++) {
    const r = simulate({ segments: 8, loss, seed, window: 1 + (seed % 4) });
    assert.ok(r.delivered && !r.aborted, `loss ${loss} seed ${seed}: all data delivered`);
    assert.deepEqual(finals(r), { client: 'CLOSED', server: 'CLOSED' }, `loss ${loss} seed ${seed}: both sides closed`);
    const firstArrivals = r.packets.filter(k => k.kind === 'data' && !k.lost).map(k => k.idx);
    for (let i = 0; i < 8; i++) assert.ok(firstArrivals.includes(i), `loss ${loss} seed ${seed}: segment ${i} arrived`);
    assert.ok(r.stats.retx >= r.stats.lost - r.packets.filter(k => k.lost && k.kind === 'ack').length - 6, 'lost packets are resent');
  }
}
const syn = simulate({ drops: ['SYN#1'] });
assert.ok(syn.packets[0].lost && syn.packets[1].retx && syn.packets[1].flags.join() === 'SYN' && syn.delivered, 'a lost SYN is resent after the timeout');
assert.equal(syn.packets[1].t - syn.packets[0].t, 300);
const d1 = simulate({ drops: ['D1#1'], window: 4, segments: 6 });
assert.ok(d1.packets.some(k => k.reason === 'fast') && d1.delivered, 'three duplicate ACKs trigger a fast retransmit');
assert.deepEqual(simulate({ loss: 0.2, seed: 7 }).packets, simulate({ loss: 0.2, seed: 7 }).packets, 'same seed, same run');
console.log('✓ the TCP model delivers everything in order, recovers from loss, and closes both ends');

// 4) 소켓 모형: 호출 순서 · 오류 · 바이트 스트림 성질
import { Net, Runner, scenario } from '../assets/net/socket.js';
{
  const n = new Net();
  const bad = n.connect('A', n.socket('A').fd, 'S', 8080);
  assert.equal(bad.errno, 'ECONNREFUSED', 'connect without a listener is refused');
  const s = n.socket('S').fd;
  assert.equal(n.listen('S', s, 5).errno, 'EINVAL', 'listen before bind');
  assert.ok(n.bind('S', s, 8080).ok);
  assert.equal(n.bind('S', n.socket('S').fd, 8080).errno, 'EADDRINUSE', 'port already taken');
  assert.equal(n.accept('S', s).errno, 'EINVAL', 'accept before listen');
  assert.ok(n.listen('S', s, 1).ok);
  assert.ok(n.accept('S', s).blocked, 'accept blocks with an empty queue');
  const c1 = n.socket('A').fd, c2 = n.socket('A').fd, c3 = n.socket('A').fd;
  const r1 = n.connect('A', c1, 'S', 8080);
  assert.ok(r1.ok && r1.woke && r1.woke.fd > s, 'the blocked accept wakes up with a NEW fd');
  const cs = r1.woke.fd;
  assert.notEqual(r1.woke.fd, s, 'listening socket and connection socket are different');
  assert.ok(n.connect('A', c2, 'S', 8080).ok);
  assert.equal(n.connect('A', c3, 'S', 8080).errno, 'ETIMEDOUT', 'queue (backlog 1) is full');
  assert.equal(n.get('A', c1).local.port, 49153, 'the refused attempt already used 49152'); assert.equal(n.get('A', c2).local.port, 49154, 'OS hands out ephemeral ports one after another');
  n.send('A', c1, 'ab'); n.send('A', c1, 'cd');
  assert.deepEqual(n.recv('S', cs, 3), { ok: true, data: 'abc', left: 1 }, 'a stream: message boundaries are lost, reads can be partial');
  assert.equal(n.recv('S', cs, 9).data, 'd');
  assert.ok(n.recv('S', cs, 9).blocked, 'nothing left: blocks');
  n.close('A', c1);
  assert.equal(n.recv('S', cs, 9).eof, true, 'peer closed: recv returns 0 bytes (EOF)');
  assert.equal(n.send('S', cs, 'x').errno, 'EPIPE');
}
for (const [id, opts] of [['echo', { recv: 1024 }], ['echo', { recv: 5 }], ['two', {}], ['errors', {}]]) {
  const r = new Runner(scenario(id, opts)); while (!r.done) r.next();
  assert.ok(r.out.every(o => o && (id === 'errors' || !o.error)), `${id}: no unexpected error`);
  if (id === 'echo') {
    const got = r.out.filter((o, i) => r.steps[i].kind === 'recv' && r.steps[i].code.includes('conn') && o.r.data).map(o => o.r.data).join('');
    assert.equal(got, 'Hello, socket!', `echo (recv ${opts.recv}): both send() calls arrive as one byte stream`);
    assert.ok(r.out[3].woke, 'the accept row is annotated when it wakes');
    if (opts.recv === 5) assert.ok(r.steps.some(s => s.again), 'a small recv buffer needs more than one recv');
  }
  if (id === 'two') assert.notEqual(r.ctx.conn1, r.ctx.conn2, 'two clients, two connection sockets, one listening port');
  if (id === 'errors') assert.deepEqual(r.out.map(o => o.error || ''), ['ECONNREFUSED', '', '', 'EADDRINUSE', 'EINVAL', '', '', 'ETIMEDOUT', ''].slice(0, r.out.length), 'each failure shows its errno');
}
{ const a = new Runner(scenario('echo')); for (let i = 0; i < 6; i++) a.next(); const b = a.goto(3); assert.equal(b.i, 3); assert.equal(b.net.snapshot('S').length, 1, 'goto replays deterministically'); }
console.log('✓ the socket model follows socket/bind/listen/accept/connect, reports the real errors, and behaves as a byte stream');

// 5) HTTP: 메시지 조립 · 해석 · 가짜 서버 · 시간 모형
import { buildRequest, parseRequest, parseResponse, serve, compare, timeline, segmentsFor, byteLen } from '../assets/net/http.js';
{
  const q = buildRequest({ method: 'POST', target: '/api/items', headers: [{ name: 'Host', value: 'example.com' }, { name: 'Content-Type', value: 'application/json' }], body: '{"a":"한"}' });
  assert.equal(q.raw, 'POST /api/items HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{"a":"한"}', 'Content-Length counts BYTES, not characters');
  assert.equal(byteLen('한'), 3);
  const back = parseRequest(q.raw);
  assert.deepEqual([back.method, back.target, back.version, back.body], ['POST', '/api/items', 'HTTP/1.1', '{"a":"한"}']);
  assert.equal(parseRequest('GET / HTTP/1.1\r\nHost: x').error, 'incomplete', 'headers not finished: not a request yet');
  assert.equal(parseRequest('GARBAGE\r\n\r\n').error, 'start-line');
  const get = (m, t, hs = [{ name: 'Host', value: 'e.com' }], body = '', v = 'HTTP/1.1') => parseResponse(serve(parseRequest(buildRequest({ method: m, target: t, version: v, headers: hs, body }).raw)).raw);
  assert.equal(get('GET', '/').status, 200);
  assert.equal(get('GET', '/api/hello?name=Ann').body, '{"message":"Hello, Ann!"}');
  assert.equal(get('GET', '/', [{ name: 'Host', value: 'e.com' }, { name: 'If-None-Match', value: '"v1"' }]).status, 304);
  assert.equal(get('GET', '/', []).status, 400, 'HTTP/1.1 without Host is refused');
  assert.equal(get('GET', '/', [], '', 'HTTP/1.0').status, 200, 'HTTP/1.0 needs no Host');
  const red = get('GET', '/old'); assert.deepEqual([red.status, red.headers.find(h => h.name === 'Location').value], [301, '/new']);
  assert.equal(get('GET', '/nope').status, 404);
  assert.equal(get('POST', '/').status, 405);
  assert.equal(get('GET', '/secret').status, 401);
  assert.equal(get('GET', '/secret', [{ name: 'Host', value: 'e' }, { name: 'Authorization', value: 'Basic eDp5' }]).status, 200);
  assert.equal(get('GET', '/error').status, 500);
  const json = [{ name: 'Host', value: 'e' }, { name: 'Content-Type', value: 'application/json' }];
  assert.equal(get('POST', '/api/items', json, '{"name":"a"}').status, 201);
  assert.equal(get('POST', '/api/items', [{ name: 'Host', value: 'e' }], '{"name":"a"}').status, 415);
  assert.equal(get('POST', '/api/items', json, '').status, 400);
  assert.equal(get('POST', '/api/items', json, '{oops').status, 400);
  assert.equal(get('DELETE', '/api/items/1').status, 204);
  const h = get('HEAD', '/'), g = get('GET', '/');
  assert.equal(h.body, '', 'HEAD has no body'); assert.equal(h.headers.find(x => x.name === 'Content-Length').value, g.headers.find(x => x.name === 'Content-Length').value, 'but reports the length GET would send');
  assert.equal(g.headers.find(x => x.name === 'Content-Length').value, String(byteLen(g.body)));
  assert.equal(segmentsFor(1460), 1); assert.equal(segmentsFor(1461), 2);
  console.log('✓ HTTP messages are built and parsed correctly, and the demo server answers with the right status codes');
  const c = Object.fromEntries(compare({ n: 12, rtt: 100, parallel: 6, tls: '1.3', think: 10 }).map(r => [r.id, r]));
  assert.ok(c.h10.ms >= c.h11.ms && c.h11.ms >= c.h2.ms && c.h2.ms >= c.h3.ms && c.h3.ms >= c.h3z.ms, 'each newer version is no slower');
  assert.equal(c.h10.setup, 4, '12 resources over 6 connections = 2 rounds, each with TCP + TLS 1.3 setup');
  assert.equal(compare({ n: 1 }).find(r => r.id === 'h10').ms, compare({ n: 1 }).find(r => r.id === 'h11').ms, 'one resource: reuse cannot help');
  assert.equal(timeline({ rtt: 50, tls: '1.2', think: 5, dns: true }).reduce((s, x) => s + x.ms, 0), 50 + 50 + 100 + 55);
  console.log('✓ the version comparison and the request timeline follow their formulas');
}

// 6) 동시 접속 처리 모형: 방식마다 달라지는 성질
import { makeLoad, simulate as sim, compareAll, MODELS } from '../assets/net/concurrency.js';
{
  const by = (load, opt) => Object.fromEntries(compareAll(load, opt).map(r => [r.model, r]));
  const load = makeLoad({ n: 24 });
  for (const m of MODELS) {
    const r = sim(m, load, {});
    assert.ok(r.stats.finished, `${m}: every connection is served`);
    r.reqs.forEach((q, i) => assert.ok(q.end - q.arrive >= load[i].cpu + load[i].io - 1e-9, `${m}: no request finishes faster than its own work`));
  }
  assert.deepEqual(compareAll(load, {}).map(r => r.stats), compareAll(load, {}).map(r => r.stats), 'deterministic');
  const slow = by(makeLoad({ n: 40, slowRatio: 0.5, slowIo: 1500 }), {});
  assert.ok(slow.iter.stats.avg > 5 * slow.thread.stats.avg, 'one-at-a-time collapses when clients are slow');
  assert.ok(slow.pool.stats.avg > 2 * slow.async.stats.avg, 'a thread pool is exhausted by slow I/O: workers sit blocked');
  assert.ok(slow.event.stats.avg < slow.pool.stats.avg && Math.abs(slow.async.stats.avg - slow.thread.stats.avg) / slow.thread.stats.avg < 0.05, 'waiting costs nothing in event-driven / async models');
  const heavy = by(makeLoad({ n: 24, cpu: 80, io: 0, slowRatio: 0 }), {});
  assert.ok(Math.abs(heavy.event.stats.avg - heavy.iter.stats.avg) < 1, 'one event loop is one core: CPU-heavy work blocks everyone');
  assert.ok(heavy.multi.stats.avg < heavy.event.stats.avg / 3 && heavy.async.stats.avg < heavy.event.stats.avg / 2, 'more loops / cores spread CPU work');
  const flood = by(makeLoad({ n: 60, spread: 100, io: 200, slowRatio: 0 }), { limit: 20 });
  assert.ok(flood.thread.stats.peak <= 20 && flood.fork.stats.peak <= 20 && flood.pool.stats.peak <= 8, 'worker limits are respected');
  assert.ok(flood.async.stats.memKB < flood.event.stats.memKB && flood.event.stats.memKB < flood.thread.stats.memKB && flood.thread.stats.memKB < flood.fork.stats.memKB, 'memory: coroutine < event connection < thread < process');
  assert.ok(flood.async.stats.avg < flood.thread.stats.avg, 'with a cap, connections beyond it wait in the queue');
  assert.ok(by(makeLoad({ n: 60, spread: 100, io: 200, slowRatio: 0 }), { limit: 1000 }).thread.stats.avg <= flood.thread.stats.avg, 'raising the cap removes that queue');
}
console.log('✓ the concurrency model shows each design\'s strengths and limits (blocking, CPU-bound, many connections, memory)');
