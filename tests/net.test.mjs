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
