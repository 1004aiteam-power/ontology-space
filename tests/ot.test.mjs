// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 산업·전력 통신 페이지의 계산 점검 (브라우저 없이) — 실행: node tests/ot.test.mjs
import assert from 'node:assert/strict';
import { crc16, crcOk, requestPdu, frame, handle, makeInverter, scaled, MAP, rtuMs, gapMs, hex } from '../assets/ot/modbus.js';

const bytesOf = (s) => s.split(' ').map(h => parseInt(h, 16));
const req = (mode, unit, r) => { const q = requestPdu(r); return frame(mode, unit, q.pdu, q.fields, 1); };

// 1) CRC-16/MODBUS: 표준 확인값과 규격서 · 흔히 쓰는 예제 프레임
assert.equal(crc16([...'123456789'].map(c => c.charCodeAt(0))), 0x4b37, 'CRC-16/MODBUS check value');
assert.deepEqual(req('rtu', 1, { fc: 3, addr: 0, qty: 10 }).bytes, bytesOf('01 03 00 00 00 0A C5 CD'));
assert.deepEqual(req('rtu', 1, { fc: 3, addr: 0, qty: 1 }).bytes, bytesOf('01 03 00 00 00 01 84 0A'));
assert.deepEqual(req('rtu', 17, { fc: 3, addr: 107, qty: 3 }).bytes, bytesOf('11 03 00 6B 00 03 76 87'), 'Modbus over serial line spec example');
assert.ok(crcOk(bytesOf('11 03 00 6B 00 03 76 87')) && !crcOk(bytesOf('11 03 00 6B 00 07 76 87')));
console.log('✓ CRC-16/MODBUS and RTU frames match the known examples');

// 2) TCP: MBAP 머리말 7바이트 + 같은 PDU, CRC 없음
const tcp = req('tcp', 1, { fc: 3, addr: 0, qty: 10 });
assert.deepEqual(tcp.bytes, bytesOf('00 01 00 00 00 06 01 03 00 00 00 0A'));
assert.equal(tcp.parts.find(p => p.k === 'len').v, 6, 'length = unit ID + PDU');
const w16 = req('rtu', 1, { fc: 16, addr: 13, values: [50, 1] });
assert.deepEqual(w16.bytes.slice(0, 11), bytesOf('01 10 00 0D 00 02 04 00 32 00 01'));
for (const f of [tcp, w16]) assert.equal(f.parts[f.parts.length - 1].to, f.bytes.length, 'field map covers every byte');
console.log('✓ Modbus TCP adds a 7-byte MBAP header; FC 16 frames are laid out as the spec says');

// 3) 가상 인버터: 읽기 · 배율 해석 · 출력 제한 · 예외 · 무응답
const inv = makeInverter({ avail: 7200 });
const send = (mode, unit, r) => handle(inv, mode, req(mode, unit, r).bytes);
let r = send('rtu', 1, { fc: 3, addr: 0, qty: 13 });
assert.equal(r.reply.pdu[0], 3); assert.equal(r.reply.pdu[1], 26, '13 registers = 26 bytes');
const regs = inv.regs(), get = (id) => scaled(regs, MAP.find(m => m.id === id));
assert.equal(get('PhVphA'), 230.1); assert.equal(get('Hz'), 60); assert.equal(get('W'), 7200); assert.equal(get('WH_hi'), 12345678); assert.equal(regs[0], 4, 'producing (MPPT)');
r = send('tcp', 1, { fc: 16, addr: 13, values: [50, 1] });
assert.deepEqual(r.reply.pdu, [16, 0, 13, 0, 2], 'FC 16 reply echoes address and count');
assert.equal(inv.regs()[5], 5000, 'output limited to 50% of 10 kW'); assert.equal(inv.regs()[0], 5, 'state = throttled');
inv.d.avail = 4000; assert.equal(inv.regs()[5], 4000); assert.equal(inv.regs()[0], 4, 'below the limit it produces normally');
const exc = (rr) => [rr.reply.pdu[0], rr.reply.pdu[1]];
assert.deepEqual(exc(send('rtu', 1, { fc: 3, addr: 20, qty: 2 })), [0x83, 2], 'missing address → exception 2');
assert.deepEqual(exc(send('rtu', 1, { fc: 6, addr: 5, value: 9999 })), [0x86, 2], 'read-only register → exception 2');
assert.deepEqual(exc(send('rtu', 1, { fc: 6, addr: 13, value: 150 })), [0x86, 3], 'out of range → exception 3');
assert.deepEqual(exc(send('rtu', 1, { fc: 4, addr: 0, qty: 2 })), [0x84, 1], 'unsupported function → exception 1');
assert.equal(send('rtu', 2, { fc: 3, addr: 0, qty: 2 }).reply, null, 'another address → no reply');
const noisy = req('rtu', 1, { fc: 3, addr: 0, qty: 2 }).bytes; noisy[3] ^= 4;
assert.equal(handle(inv, 'rtu', noisy).reply, null, 'CRC error → silently dropped');
r = send('rtu', 1, { fc: 5, addr: 0, value: 0 });
assert.equal(inv.regs()[5], 0); assert.equal(inv.regs()[0], 8, 'run coil off → standby, no output');
r = send('rtu', 1, { fc: 1, addr: 0, qty: 2 }); assert.deepEqual(r.reply.pdu, [1, 1, 0]);
send('rtu', 1, { fc: 5, addr: 0, value: 1 }); r = send('rtu', 1, { fc: 1, addr: 0, qty: 2 }); assert.deepEqual(r.reply.pdu, [1, 1, 1], 'coil bits packed lowest-first');
assert.equal(send('rtu', 0, { fc: 6, addr: 13, value: 80 }).reply, null, 'broadcast executes without reply'); assert.equal(inv.d.limPct, 80);
console.log('✓ the virtual inverter answers reads, applies writes, and returns the right exceptions or silence');

// 4) RS-485 선로 시간: 9600 bps 에서 8바이트 = 9.17 ms, 프레임 끝 쉼 3.5글자 = 4.01 ms, 19200 넘으면 1.75 ms
assert.equal(rtuMs(8, 9600).toFixed(2), '9.17'); assert.equal(gapMs(9600).toFixed(2), '4.01'); assert.equal(gapMs(115200), 1.75);
assert.equal(hex(10), '0A');
console.log('✓ RS-485 character and silence times');
