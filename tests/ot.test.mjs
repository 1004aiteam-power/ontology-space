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

// ---- DNP3 (ot-dnp3.html) ----
import { crcDnp, linkFrame, classPollUser, simulate as dnp } from '../assets/ot/dnp3.js';
{
  assert.equal(crcDnp([...'123456789'].map(c => c.charCodeAt(0))), 0xea82, 'CRC-16/DNP check value');
  const f = linkFrame(10, 1, classPollUser(0));
  assert.deepEqual(f.bytes.slice(0, 8), [0x05, 0x64, 17, 0xc4, 10, 0, 1, 0], 'start bytes, length = 5 + user data, addresses low byte first');
  assert.equal(f.bytes.length, 10 + 12 + 2, 'header + CRC, then one data block + CRC');
  assert.equal(f.parts[f.parts.length - 1].to, f.bytes.length);
  const big = linkFrame(10, 1, Array.from({ length: 20 }, (_, i) => i));
  assert.equal(big.bytes.length, 10 + 16 + 2 + 4 + 2, 'a CRC after every 16 data bytes');
  const P = dnp({ mode: 'poll' }), C = dnp({ mode: 'class' }), U = dnp({ mode: 'unsol' });
  const cb = (r) => r.missed.filter(e => e.p.startsWith('CB')).length;
  assert.ok(cb(P) >= 2, 'periodic polling misses the 0.4 s trip-and-reclose');
  assert.equal(dnp({ mode: 'poll', period: 1000 }).missed.filter(e => e.t === 12300 && e.p === 'CB101').length, 1, 'even 1 s polling misses it');
  for (const r of [C, U]) { assert.equal(r.stats.missed, 0, 'event reporting misses nothing'); assert.equal(r.stats.tsErrMax, 0, 'with the original timestamps'); }
  assert.ok(U.stats.latAvg < C.stats.latAvg / 5, 'unsolicited reporting is much faster than event polling');
  assert.ok(P.stats.tsErrMax > 0, 'polling stamps changes with the poll time');
  const D = dnp({ mode: 'class', down: [20000, 40000] });
  assert.equal(D.stats.missed, 0, 'events survive a 20 s outage in the buffer');
  assert.ok(D.stats.latMax > 15000, '…but arrive late');
  const O = dnp({ mode: 'class', down: [20000, 40000], buf: 3 });
  assert.ok(O.overflow && O.stats.missed > 0, 'a small buffer overflows and loses events, and says so');
  assert.ok(!D.overflow);
  console.log('✓ DNP3: CRC-16/DNP, link frames, polling misses short events, event reporting keeps them with exact times');
}

// ---- IEC 61850 (ot-61850.html) ----
import { leaves, ref, mms, goose } from '../assets/ot/iec61850.js';
{
  assert.equal(ref('CTRL', 'XCBR1', 'Pos', 'stVal'), 'E1Q1SB1CTRL/XCBR1.Pos.stVal');
  assert.equal(mms('MEAS', 'MMXU1', 'A', 'phsA.cVal.mag.f', 'MX'), 'E1Q1SB1MEAS/MMXU1$MX$A$phsA$cVal$mag$f');
  const L = leaves();
  assert.ok(L.every(l => /^[A-Z]{4}\d$/.test(l.ln) && ['ST', 'MX', 'CO', 'SG'].includes(l.da.fc)), 'logical node names and functional constraints are well formed');
  assert.equal(new Set(L.map(l => l.ref)).size, L.length, 'every object reference is unique');
  const g = goose();
  const after = g.msgs.filter(m => m.st === g.st), gaps = after.slice(1).map((m, i) => m.t - after[i].t);
  assert.equal(after[0].t, g.tOp, 'GOOSE goes out the moment the trip happens'); assert.equal(after[0].sq, 0);
  assert.ok(after.every((m, i) => m.sq === i), 'sqNum counts the repeats of the new state');
  assert.deepEqual(gaps.slice(0, 5), [2, 4, 8, 16, 32], 'repeat intervals double from Tmin');
  assert.ok(gaps.every(x => x <= 1000) && gaps[gaps.length - 1] === 1000, '…up to the steady interval T0');
  assert.ok(g.msgs.filter(m => m.st === g.st - 1).every(m => !m.val), 'before the trip, the old state (no trip) is repeated');
  assert.equal(g.transfer, 0.2); assert.equal(g.alarm, null);
  let late = 0, never = 0;
  for (let seed = 1; seed <= 200; seed++) { const r = goose({ loss: 0.5, seed }); if (r.transfer === null) never++; else if (r.transfer > 3) late++; else assert.ok(r.transfer === 0.2 || r.transfer === 2.2, 'within 3 ms only if the first or second copy arrives'); }
  assert.ok(late > 0 && never === 0, 'with heavy loss some trips are late, but repetition eventually delivers');
  const cut = goose({ cut: true });
  assert.equal(cut.tRx, null, 'a cut cable delivers nothing'); assert.ok(cut.alarm !== null, '…and the subscriber raises an alarm when TAL expires');
  console.log('✓ IEC 61850: object references and MMS names, GOOSE stNum/sqNum and doubling repeats, loss and supervision');
}

// ---- DER · VPP (ot-der.html) ----
import { ACTORS, PROTO, EVENT, ESS, messages, series } from '../assets/ot/der.js';
{
  const ids = new Set(ACTORS.map(a => a.id));
  for (const o of [{}, { evseOffline: true }, { lowSoc: true }]) {
    const L = messages(o);
    assert.ok(L.every(m => ids.has(m.from) && ids.has(m.to) && m.from !== m.to && PROTO[m.proto]), 'every message has a real sender, receiver and protocol');
    assert.ok(L.every((m, i) => !i || m.t >= L[i - 1].t), 'messages are in time order');
    for (const m of L.filter(x => x.req && !x.lost)) assert.ok(L.some(r => r.res === m.req && r.t >= m.t), `request ${m.name} gets a response`);
  }
  assert.ok(messages({ evseOffline: true }).some(m => m.proto === 'ocpp' && m.lost), 'offline chargers: OCPP messages are lost');
  const N = series(), F = series({ evseOffline: true }), S = series({ lowSoc: true });
  assert.ok(N.perf.pct > 0.95, `normally the target is met (${N.perf.pct})`);
  assert.ok(F.perf.pct < 0.8 && Math.abs(F.perf.minShed - ESS.pmax) < 1e-6, 'without the chargers only the battery maximum is shed');
  assert.ok(S.perf.pct < N.perf.pct && S.perf.essKwh <= 0.2 * ESS.kwh + 1e-6, 'a low battery runs out and cannot exceed its energy');
  for (const r of [N, F, S]) assert.ok(r.rows.every(x => x.ess >= 0 && x.ess <= ESS.pmax + 1e-9 && x.soc >= 0.05 - 1e-9 && (x.target === null ? x.ess === 0 : true)), 'battery limits respected and idle outside the event');
  assert.ok(N.rows.filter(r => r.target !== null).length === EVENT.end - EVENT.start);
  console.log('✓ DER · VPP: message chain is consistent; the event is met normally and falls short on failures');
}

// ---- 개요 (ot-map.html) ----
import { LEVELS, PROTOCOLS } from '../assets/ot/protocols.js';
import { existsSync } from 'node:fs';
{
  const lv = new Set(LEVELS.map(l => l.n));
  for (const p of PROTOCOLS) {
    assert.ok(p.levels.length && p.levels.every(n => lv.has(n) && n !== 3.5), `${p.id}: levels exist and none crosses the DMZ as its home`);
    if (p.page) assert.ok(existsSync(new URL('../' + p.page, import.meta.url)), `${p.id}: ${p.page} exists`);
  }
  assert.equal(new Set(PROTOCOLS.map(p => p.id)).size, PROTOCOLS.length);
  console.log('✓ protocol map: levels valid, linked pages exist');
}
