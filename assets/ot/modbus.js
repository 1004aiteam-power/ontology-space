// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Modbus 요청 · 응답 프레임을 바이트로 만들고 해석하는 모형과, 그 요청을 받아 처리하는 가상 태양광 인버터.
// 프레임 규칙(RTU: 주소 + PDU + CRC-16, TCP: MBAP 머리말 7바이트 + PDU)과 CRC-16/MODBUS 는 실제 규격 그대로이고,
// 인버터의 레지스터 배치는 SunSpec 모델(103 인버터 · 123 제어)을 본떠 줄인 가상의 것이다. 브라우저 없이 테스트: tests/ot.test.mjs

/** CRC-16/MODBUS (다항식 0xA001 역순, 초깃값 0xFFFF). 프레임에는 낮은 바이트가 먼저 실린다 */
export function crc16(bytes) {
  let c = 0xffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  }
  return c;
}
export const hex = (b) => b.toString(16).toUpperCase().padStart(2, '0');
const u16 = (v) => [(v >> 8) & 0xff, v & 0xff];
const s16 = (v) => (v < 0 ? v + 0x10000 : v) & 0xffff;
const toS16 = (v) => (v & 0x8000 ? v - 0x10000 : v);

export const FC = {
  1: { ko: '코일 읽기', en: 'Read coils' },
  3: { ko: '보유 레지스터 읽기', en: 'Read holding registers' },
  4: { ko: '입력 레지스터 읽기', en: 'Read input registers' },
  5: { ko: '코일 하나 쓰기', en: 'Write single coil' },
  6: { ko: '레지스터 하나 쓰기', en: 'Write single register' },
  16: { ko: '레지스터 여러 개 쓰기', en: 'Write multiple registers' }
};
export const EXC = {
  1: { ko: '지원하지 않는 기능 코드', en: 'Illegal function' },
  2: { ko: '없는 주소 (또는 쓸 수 없는 주소)', en: 'Illegal data address' },
  3: { ko: '허용 범위를 벗어난 값', en: 'Illegal data value' },
  4: { ko: '장치 내부 고장', en: 'Server device failure' }
};
// SunSpec 모델 103 의 운전 상태 값 (St)
export const ST = { 1: { ko: '꺼짐', en: 'Off' }, 2: { ko: '잠듦 (밤)', en: 'Sleeping (night)' }, 3: { ko: '시작 중', en: 'Starting' }, 4: { ko: '발전 중 (MPPT)', en: 'Producing (MPPT)' },
  5: { ko: '출력 제한 중', en: 'Throttled' }, 6: { ko: '정지 중', en: 'Shutting down' }, 7: { ko: '고장', en: 'Fault' }, 8: { ko: '대기', en: 'Standby' } };

/**
 * 요청 PDU(기능 코드 + 데이터) 를 만든다. req: { fc, addr, qty, value, values }
 * 반환: { pdu: [...], fields: [{ k, n(바이트 수), ko, en, v }] }  — fields 는 화면에서 칸마다 설명하는 데 쓴다
 */
export function requestPdu(req) {
  const { fc, addr = 0, qty = 1, value = 0, values = [] } = req;
  const F = [{ k: 'fc', n: 1, ko: '기능 코드', en: 'Function code', v: `${fc} = ${FC[fc] ? FC[fc].en : '?'}` }];
  let data = [];
  if (fc === 1 || fc === 3 || fc === 4) {
    data = [...u16(addr), ...u16(qty)];
    F.push({ k: 'addr', n: 2, ko: '시작 주소', en: 'Start address', v: addr }, { k: 'qty', n: 2, ko: '개수', en: 'Quantity', v: qty });
  } else if (fc === 5) {
    data = [...u16(addr), ...(value ? [0xff, 0x00] : [0x00, 0x00])];
    F.push({ k: 'addr', n: 2, ko: '코일 주소', en: 'Coil address', v: addr }, { k: 'val', n: 2, ko: '값 (FF00 = 켜기, 0000 = 끄기)', en: 'Value (FF00 = on, 0000 = off)', v: value ? 'ON' : 'OFF' });
  } else if (fc === 6) {
    data = [...u16(addr), ...u16(s16(value))];
    F.push({ k: 'addr', n: 2, ko: '레지스터 주소', en: 'Register address', v: addr }, { k: 'val', n: 2, ko: '쓸 값', en: 'Value', v: value });
  } else if (fc === 16) {
    const vs = values.length ? values : [value];
    data = [...u16(addr), ...u16(vs.length), vs.length * 2, ...vs.flatMap(v => u16(s16(v)))];
    F.push({ k: 'addr', n: 2, ko: '시작 주소', en: 'Start address', v: addr }, { k: 'qty', n: 2, ko: '레지스터 개수', en: 'Register count', v: vs.length },
      { k: 'bc', n: 1, ko: '뒤따르는 바이트 수', en: 'Byte count', v: vs.length * 2 }, { k: 'val', n: vs.length * 2, ko: '쓸 값들', en: 'Values', v: vs.join(', ') });
  }
  return { pdu: [fc, ...data], fields: F };
}

/** PDU 를 전송 방식에 맞춰 감싼다. mode: 'rtu' | 'tcp'. 반환: { bytes, parts: [{ k, from, to, ko, en, v }] } */
export function frame(mode, unit, pdu, fields, tid = 1) {
  const parts = [];
  let bytes, off;
  if (mode === 'rtu') {
    bytes = [unit, ...pdu];
    const c = crc16(bytes);
    bytes.push(c & 0xff, c >> 8);
    parts.push({ k: 'unit', from: 0, to: 1, ko: '장치 주소 (슬레이브 ID)', en: 'Device address (slave ID)', v: unit });
    off = 1;
  } else {
    const len = pdu.length + 1;
    bytes = [...u16(tid), 0, 0, ...u16(len), unit, ...pdu];
    parts.push({ k: 'tid', from: 0, to: 2, ko: '트랜잭션 ID (요청 · 응답 짝 맞추기)', en: 'Transaction ID (pairs request and reply)', v: tid },
      { k: 'pid', from: 2, to: 4, ko: '프로토콜 ID (Modbus = 0)', en: 'Protocol ID (Modbus = 0)', v: 0 },
      { k: 'len', from: 4, to: 6, ko: '길이 (뒤따르는 바이트 수)', en: 'Length (bytes that follow)', v: len },
      { k: 'unit', from: 6, to: 7, ko: '유닛 ID', en: 'Unit ID', v: unit });
    off = 7;
  }
  for (const f of fields) { parts.push({ ...f, from: off, to: off + f.n }); off += f.n; }
  if (mode === 'rtu') parts.push({ k: 'crc', from: off, to: off + 2, ko: 'CRC-16 (낮은 바이트 먼저)', en: 'CRC-16 (low byte first)', v: hex(bytes[off + 1]) + hex(bytes[off]) });
  return { bytes, parts };
}

/** 받은 RTU 프레임의 CRC 를 확인 */
export const crcOk = (bytes) => bytes.length >= 4 && crc16(bytes.slice(0, -2)) === (bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8));

// ---- 가상 인버터 ------------------------------------------------------------------------------------------
// 보유 레지스터 배치 (프로토콜 주소 0 부터. 문서 표기로는 40001 부터). sf = 배율 레지스터 주소 (값 × 10^sf)
export const MAP = [
  { a: 0, id: 'St', ko: '운전 상태', en: 'Operating state', enum: true },
  { a: 1, id: 'A', ko: 'AC 전류', en: 'AC current', unit: 'A', sf: 2 },
  { a: 2, id: 'A_SF', ko: '전류 배율', en: 'Current scale factor', isSf: true },
  { a: 3, id: 'PhVphA', ko: 'AC 전압', en: 'AC voltage', unit: 'V', sf: 4 },
  { a: 4, id: 'V_SF', ko: '전압 배율', en: 'Voltage scale factor', isSf: true },
  { a: 5, id: 'W', ko: 'AC 유효전력', en: 'AC active power', unit: 'W', sf: 6 },
  { a: 6, id: 'W_SF', ko: '전력 배율', en: 'Power scale factor', isSf: true },
  { a: 7, id: 'Hz', ko: '주파수', en: 'Frequency', unit: 'Hz', sf: 8 },
  { a: 8, id: 'Hz_SF', ko: '주파수 배율', en: 'Frequency scale factor', isSf: true },
  { a: 9, id: 'WH_hi', ko: '누적 발전량 (상위 16비트)', en: 'Lifetime energy (high 16 bits)', pair: 10 },
  { a: 10, id: 'WH_lo', ko: '누적 발전량 (하위 16비트)', en: 'Lifetime energy (low 16 bits)', pairLo: true },
  { a: 11, id: 'TmpCab', ko: '함체 온도', en: 'Cabinet temperature', unit: '°C', sf: 12 },
  { a: 12, id: 'Tmp_SF', ko: '온도 배율', en: 'Temperature scale factor', isSf: true },
  { a: 13, id: 'WMaxLimPct', ko: '출력 제한 (%)', en: 'Output limit (%)', unit: '%', rw: true, min: 0, max: 100 },
  { a: 14, id: 'WMaxLim_Ena', ko: '출력 제한 사용 (0/1)', en: 'Output limit enable (0/1)', rw: true, min: 0, max: 1 }
];
export const COILS = [{ a: 0, id: 'Run', ko: '운전 (켜기 · 끄기)', en: 'Run (on/off)' }, { a: 1, id: 'Reset', ko: '고장 초기화', en: 'Fault reset' }];
export const WMAX = 10000;          // 정격 출력 10 kW

/** 가상 인버터: 햇빛으로 낼 수 있는 출력(avail, W)과 제어 상태에서 레지스터 값을 계산 */
export function makeInverter(o = {}) {
  const d = { unit: 1, avail: 7200, run: true, fault: false, limPct: 100, limEna: 0, wh: 12345678, ...o };
  const regs = () => {
    let st, w;
    if (d.fault) { st = 7; w = 0; } else if (!d.run) { st = 8; w = 0; } else if (d.avail <= 0) { st = 2; w = 0; } else {
      const cap = d.limEna ? WMAX * d.limPct / 100 : WMAX;
      w = Math.round(Math.min(d.avail, cap)); st = d.limEna && d.avail > cap ? 5 : 4;
    }
    const v = 2301, a = Math.round(w / 230.1 * 10);
    return [st, a, s16(-1), v, s16(-1), w, 0, 6000, s16(-2), (d.wh >>> 16) & 0xffff, d.wh & 0xffff, 412, s16(-1), d.limPct, d.limEna];
  };
  return { d, regs, coils: () => [d.run ? 1 : 0, 0] };
}
/** 레지스터 하나의 사람이 읽는 값 (배율 적용) */
export function scaled(regs, m) {
  if (m.isSf) return toS16(regs[m.a]);
  if (m.pair) return ((regs[m.a] << 16) | regs[m.pair]) >>> 0;
  if (m.sf !== undefined) { const sf = toS16(regs[m.sf]); return +(toS16(regs[m.a]) * 10 ** sf).toFixed(Math.max(0, -sf)); }
  return regs[m.a];
}

/**
 * 장치가 요청 프레임을 받아 처리한다 (RTU 는 주소 · CRC 확인부터).
 * 반환: { reply: null | { pdu, fields }, log: [{ ok, ko, en }], touched: { regs: [], coils: [] } }
 */
export function handle(inv, mode, bytes) {
  const log = [], ok = (b, ko, en) => log.push({ ok: b, ko, en }), touched = { regs: [], coils: [] };
  let unit, pdu;
  if (mode === 'rtu') {
    unit = bytes[0];
    if (!crcOk(bytes)) { ok(false, 'CRC가 맞지 않음 → 깨진 프레임으로 보고 조용히 버림 (응답하지 않음)', 'CRC mismatch → treated as a corrupted frame and silently dropped (no reply)'); return { reply: null, log, touched }; }
    ok(true, 'CRC 일치: 전송 중 깨지지 않음', 'CRC matches: not corrupted in transit');
    pdu = bytes.slice(1, -2);
  } else {
    unit = bytes[6]; pdu = bytes.slice(7);
    ok(true, 'TCP가 이미 오류 검사를 했으므로 CRC 없음 (MBAP 길이만 확인)', 'No CRC: TCP already checked for errors (only the MBAP length is checked)');
  }
  if (unit === 0) { ok(true, '주소 0 = 방송(broadcast): 모든 장치가 실행하되 아무도 응답하지 않음', 'Address 0 = broadcast: every device executes it but none replies'); }
  else if (unit !== inv.d.unit) { ok(false, `주소 ${unit}는 내 주소(${inv.d.unit})가 아님 → 무시 (같은 선의 다른 장치 몫)`, `Address ${unit} is not mine (${inv.d.unit}) → ignored (meant for another device on the line)`); return { reply: null, log, touched }; }
  else ok(true, `주소 ${unit}: 내 주소`, `Address ${unit}: that's me`);
  const fc = pdu[0], w = (i) => (pdu[i] << 8) | pdu[i + 1];
  const exc = (code) => { ok(false, `예외 응답 ${code}: ${EXC[code].ko}`, `Exception ${code}: ${EXC[code].en}`); return { pdu: [fc | 0x80, code], fields: [{ k: 'fc', n: 1, ko: '기능 코드 + 0x80 (예외 표시)', en: 'Function code + 0x80 (exception flag)', v: `${fc} + 128 = ${fc | 0x80}` }, { k: 'exc', n: 1, ko: '예외 코드', en: 'Exception code', v: `${code} = ${EXC[code].en}` }] }; };
  let reply;
  const R = inv.regs();
  if (fc === 3) {
    const a = w(1), n = w(3);
    if (n < 1 || n > 125) reply = exc(3);
    else if (a + n > R.length) reply = exc(2);
    else {
      const vals = R.slice(a, a + n); touched.regs = vals.map((_, i) => a + i);
      ok(true, `레지스터 ${a}~${a + n - 1} (${n}개 = ${n * 2}바이트)를 읽어 돌려줌`, `Read registers ${a}–${a + n - 1} (${n} = ${n * 2} bytes) and send them back`);
      reply = { pdu: [3, n * 2, ...vals.flatMap(u16)], fields: [{ k: 'fc', n: 1, ko: '기능 코드', en: 'Function code', v: 3 }, { k: 'bc', n: 1, ko: '뒤따르는 바이트 수', en: 'Byte count', v: n * 2 }, ...vals.map((v, i) => ({ k: 'reg', n: 2, ko: `레지스터 ${a + i} (${MAP[a + i].id})`, en: `Register ${a + i} (${MAP[a + i].id})`, v, reg: a + i }))] };
    }
  } else if (fc === 1) {
    const a = w(1), n = w(3), C = inv.coils();
    if (n < 1 || n > 2000) reply = exc(3);
    else if (a + n > C.length) reply = exc(2);
    else {
      const bits = C.slice(a, a + n), nb = Math.ceil(n / 8), out = Array(nb).fill(0);
      bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7); });
      touched.coils = bits.map((_, i) => a + i);
      ok(true, `코일 ${n}개를 비트로 묶어 돌려줌 (첫 코일이 가장 낮은 비트)`, `Pack ${n} coils into bits (first coil = lowest bit)`);
      reply = { pdu: [1, nb, ...out], fields: [{ k: 'fc', n: 1, ko: '기능 코드', en: 'Function code', v: 1 }, { k: 'bc', n: 1, ko: '뒤따르는 바이트 수', en: 'Byte count', v: nb }, { k: 'bits', n: nb, ko: '코일 상태 비트', en: 'Coil status bits', v: bits.join(' ') }] };
    }
  } else if (fc === 6 || fc === 16) {
    const a = w(1), vals = fc === 6 ? [w(3)] : Array.from({ length: w(3) }, (_, i) => w(6 + i * 2));
    const bad = vals.findIndex((_, i) => !MAP[a + i] || !MAP[a + i].rw);
    if (bad >= 0) reply = exc(2);
    else if (vals.some((v, i) => toS16(v) < MAP[a + i].min || toS16(v) > MAP[a + i].max)) reply = exc(3);
    else {
      vals.forEach((v, i) => { if (MAP[a + i].id === 'WMaxLimPct') inv.d.limPct = toS16(v); if (MAP[a + i].id === 'WMaxLim_Ena') inv.d.limEna = toS16(v); });
      touched.regs = vals.map((_, i) => a + i);
      ok(true, `레지스터 ${a}${vals.length > 1 ? `~${a + vals.length - 1}` : ''}에 ${vals.map(toS16).join(', ')}을(를) 씀 → 제어에 반영`, `Wrote ${vals.map(toS16).join(', ')} to register ${a}${vals.length > 1 ? `–${a + vals.length - 1}` : ''} → applied to control`);
      reply = fc === 6
        ? { pdu: pdu.slice(0, 5), fields: [{ k: 'fc', n: 1, ko: '기능 코드', en: 'Function code', v: 6 }, { k: 'addr', n: 2, ko: '레지스터 주소 (요청을 그대로 되돌려 줌)', en: 'Register address (echoed)', v: a }, { k: 'val', n: 2, ko: '쓴 값 (그대로 되돌려 줌)', en: 'Value written (echoed)', v: toS16(vals[0]) }] }
        : { pdu: pdu.slice(0, 5), fields: [{ k: 'fc', n: 1, ko: '기능 코드', en: 'Function code', v: 16 }, { k: 'addr', n: 2, ko: '시작 주소', en: 'Start address', v: a }, { k: 'qty', n: 2, ko: '쓴 개수', en: 'Registers written', v: vals.length }] };
    }
  } else if (fc === 5) {
    const a = w(1), v = w(3);
    if (a >= COILS.length) reply = exc(2);
    else if (v !== 0xff00 && v !== 0) reply = exc(3);
    else {
      if (a === 0) inv.d.run = v === 0xff00;
      if (a === 1 && v === 0xff00) inv.d.fault = false;
      touched.coils = [a];
      ok(true, `코일 ${a} (${COILS[a].id})를 ${v ? '켬' : '끔'}`, `Coil ${a} (${COILS[a].id}) set ${v ? 'on' : 'off'}`);
      reply = { pdu: pdu.slice(0, 5), fields: [{ k: 'fc', n: 1, ko: '기능 코드', en: 'Function code', v: 5 }, { k: 'addr', n: 2, ko: '코일 주소 (그대로 되돌려 줌)', en: 'Coil address (echoed)', v: a }, { k: 'val', n: 2, ko: '값 (그대로 되돌려 줌)', en: 'Value (echoed)', v: v ? 'ON' : 'OFF' }] };
    }
  } else reply = exc(1);
  if (unit === 0) return { reply: null, log, touched };
  return { reply, log, touched };
}

/** RTU 선로 시간: 한 글자 = 11비트(시작 1 + 데이터 8 + 패리티 1 + 정지 1), 프레임 사이에 3.5글자 이상 쉼 */
export const rtuMs = (nBytes, baud) => (nBytes * 11 * 1000) / baud;
export const gapMs = (baud) => (baud > 19200 ? 1.75 : (3.5 * 11 * 1000) / baud);   // 19200 bps 넘으면 규격이 1.75 ms 로 고정
