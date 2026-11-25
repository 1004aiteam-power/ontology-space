// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// DNP3 모형: 변전소 원격 단말(outstation)에서 생긴 사건을 주장치(master)가 어떻게 알게 되나.
//   poll   : 정해진 주기로 현재 값만 읽기 (Modbus 식) → 짧은 변화는 놓치고, 시각은 "읽은 때"
//   class  : DNP3 이벤트 폴링 → 장치가 사건을 시각과 함께 쌓아 두었다가 다음 폴링 때 몰아서 줌
//   unsol  : 무응답 보고(unsolicited) → 사건이 생기면 장치가 먼저 보냄, 주장치가 확인(confirm)
// 통신 끊김 구간과 사건 버퍼 크기를 넣을 수 있다. 바이트 수는 자릿수 감각용 모형값. 테스트: tests/ot.test.mjs

/** CRC-16/DNP (다항식 0x3D65 를 뒤집은 0xA6BC, 초깃값 0, 마지막에 반전). 낮은 바이트가 먼저 실린다 */
export function crcDnp(bytes) {
  let c = 0;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa6bc : c >>> 1; }
  return (~c) & 0xffff;
}
/**
 * 링크 계층 프레임: 05 64 | 길이 | 제어 | 목적지(2) | 출발지(2) | CRC(2) | 데이터 16바이트마다 CRC(2)
 * 반환: { bytes, parts: [{ k, from, to, ko, en }] }
 */
export function linkFrame(dest, src, user, ctrl = 0xc4) {
  const head = [0x05, 0x64, 5 + user.length, ctrl, dest & 0xff, dest >> 8, src & 0xff, src >> 8];
  const hc = crcDnp(head);
  const bytes = [...head, hc & 0xff, hc >> 8], parts = [
    { k: 'start', from: 0, to: 2, ko: '시작 표시 05 64', en: 'Start bytes 05 64' },
    { k: 'len', from: 2, to: 3, ko: '길이 (제어 ~ 데이터, CRC 제외)', en: 'Length (control to data, CRCs excluded)' },
    { k: 'ctrl', from: 3, to: 4, ko: '제어: 주장치 → 장치, 확인 필요 없는 데이터', en: 'Control: master → outstation, unconfirmed user data' },
    { k: 'dest', from: 4, to: 6, ko: `목적지 주소 ${dest} (낮은 바이트 먼저)`, en: `Destination address ${dest} (low byte first)` },
    { k: 'src', from: 6, to: 8, ko: `출발지 주소 ${src}`, en: `Source address ${src}` },
    { k: 'crc', from: 8, to: 10, ko: '머리말 CRC', en: 'Header CRC' }];
  for (let i = 0; i < user.length; i += 16) {
    const blk = user.slice(i, i + 16), c = crcDnp(blk), at = bytes.length;
    bytes.push(...blk, c & 0xff, c >> 8);
    parts.push({ k: 'data', from: at, to: at + blk.length, ko: `데이터 블록 ${i / 16 + 1}`, en: `Data block ${i / 16 + 1}` }, { k: 'crc', from: at + blk.length, to: at + blk.length + 2, ko: '블록 CRC (16바이트마다)', en: 'Block CRC (every 16 bytes)' });
  }
  return { bytes, parts };
}
/** "클래스 1 · 2 · 3 사건을 달라" 읽기 요청의 사용자 데이터: 전송 머리말 + 응용 머리말 + 객체 머리말 3개 */
export const classPollUser = (seq = 0) => [0xc0 | (seq & 0x3f), 0xc0 | (seq & 0x0f), 0x01, 0x3c, 0x02, 0x06, 0x3c, 0x03, 0x06, 0x3c, 0x04, 0x06];
export const USER_PARTS = [
  { ko: '전송 머리말 (처음 · 끝 조각, 순번)', en: 'Transport header (first and final fragment, sequence)' },
  { ko: '응용 제어 (처음 · 끝, 순번)', en: 'Application control (first, final, sequence)' },
  { ko: '기능 코드 1 = READ', en: 'Function code 1 = READ' },
  { ko: '객체 60 변형 2 = 클래스 1 사건', en: 'Object group 60 var 2 = class 1 events' }, { ko: '한정자 06 = 전부', en: 'Qualifier 06 = all' },
  { ko: '객체 60 변형 3 = 클래스 2 사건', en: 'Group 60 var 3 = class 2 events' }, { ko: '한정자 06', en: 'Qualifier 06' },
  { ko: '객체 60 변형 4 = 클래스 3 사건', en: 'Group 60 var 4 = class 3 events' }, { ko: '한정자 06', en: 'Qualifier 06' }
];

// ---- 사건 만들기 ----
export const POINTS = [
  { id: 'CB101', ko: '차단기 CB-101', en: 'Breaker CB-101', kind: 'bi', cls: 1 },
  { id: 'CB102', ko: '차단기 CB-102', en: 'Breaker CB-102', kind: 'bi', cls: 1 },
  { id: 'MW', ko: 'T1 유효전력 (MW)', en: 'T1 active power (MW)', kind: 'ai', cls: 2, db: 2 },
  { id: 'kV', ko: '22.9 kV 모선 전압', en: '22.9 kV bus voltage', kind: 'ai', cls: 2, db: 0.3 }
];
/** 60초 동안의 실제 사건 (시각 ms). 차단기 CB-101 은 낙뢰로 트립됐다가 0.4초 만에 재폐로 */
export function truth() {
  const ev = [];
  const add = (t, p, v) => ev.push({ t, p, v });
  add(12300, 'CB101', 'OPEN'); add(12700, 'CB101', 'CLOSED');
  add(31050, 'CB102', 'OPEN'); add(31080, 'CB101', 'OPEN'); add(48200, 'CB102', 'CLOSED'); add(48900, 'CB101', 'CLOSED');
  add(12300, 'kV', 21.8); add(12700, 'kV', 22.9); add(31050, 'kV', 22.1); add(31600, 'kV', 22.8);      // 고장 순간 전압이 잠깐 내려감
  let mw = 40, lastMw = mw;
  for (let t = 1000; t < 60000; t += 1000) {
    mw += Math.sin(t / 7000) * 1.5 + (t > 31000 && t < 48000 ? -1.2 : 0.4);
    if (Math.abs(mw - lastMw) >= 2) { add(t, 'MW', +mw.toFixed(1)); lastMw = mw; }                 // 2 MW 넘게 변하면 사건 (불감대)
  }
  return ev.sort((a, b) => a.t - b.t);
}
const valueAt = (ev, p, t, init) => { let v = init; for (const e of ev) if (e.p === p && e.t <= t) v = e.v; return v; };
const INIT = { CB101: 'CLOSED', CB102: 'CLOSED', MW: 40, kV: 22.9 };

/**
 * opt: { mode: 'poll' | 'class' | 'unsol', period (ms), down: [from, to] | null, buf (사건 버퍼 칸 수), delay (ms) }
 * 반환: { msgs: [{ t, dir: 'MO' | 'OM', kind, n (사건 수), bytes, lost }], got: [{ p, v, t (주장치가 기록한 시각), rx (받은 때), src }], missed, stats }
 */
export function simulate({ mode = 'class', period = 5000, down = null, buf = 50, delay = 40 } = {}) {
  const ev = truth(), END = 60000;
  const isDown = (t) => down && t >= down[0] && t < down[1];
  const msgs = [], got = [];
  let overflow = false, queue = [];
  const send = (t, dir, kind, n, bytes) => { const lost = isDown(t); msgs.push({ t, dir, kind, n, bytes, lost }); return !lost; };
  if (mode === 'poll') {
    const last = { ...INIT };
    for (let t = 0; t <= END; t += period) {
      if (!send(t, 'MO', 'read', 0, 17)) continue;
      const changed = POINTS.filter(p => valueAt(ev, p.id, t, INIT[p.id]) !== last[p.id]);
      send(t + delay, 'OM', 'resp', changed.length, 15 + POINTS.length * 5);
      for (const p of changed) { last[p.id] = valueAt(ev, p.id, t, INIT[p.id]); got.push({ p: p.id, v: last[p.id], t, rx: t + delay, src: 'poll' }); }
    }
  } else {
    let ei = 0;
    const push = (until) => {                                   // 장치 안에 사건을 쌓음 (넘치면 가장 오래된 것을 버리고 표시)
      while (ei < ev.length && ev[ei].t <= until) { queue.push(ev[ei++]); if (queue.length > buf) { queue.shift(); overflow = true; } }
    };
    send(0, 'MO', 'integrity', 0, 20); send(delay, 'OM', 'resp', POINTS.length, 15 + POINTS.length * 5);
    if (mode === 'class') {
      for (let t = period; t <= END; t += period) {
        push(t);
        if (!send(t, 'MO', 'class', 0, 20)) continue;
        const n = queue.length;
        if (!send(t + delay, 'OM', 'resp', n, 15 + n * 11)) continue;
        for (const e of queue) got.push({ p: e.p, v: e.v, t: e.t, rx: t + delay, src: 'event' });
        queue = [];
      }
    } else {
      // 무응답 보고: 사건이 생기면 조금 모았다가(hold 100ms) 보냄. 확인을 못 받으면 2초 뒤 다시
      let next = null;
      const pending = () => queue.length > 0;
      for (let t = 0; t <= END; t += 10) {
        const before = queue.length; push(t);
        if (queue.length > before && next === null) next = t + 100;
        if (next !== null && t >= next && pending()) {
          const n = queue.length;
          const ok = send(t, 'OM', 'unsol', n, 15 + n * 11) && send(t + delay, 'MO', 'confirm', 0, 15);
          if (ok) { for (const e of queue) got.push({ p: e.p, v: e.v, t: e.t, rx: t + delay, src: 'event' }); queue = []; next = null; }
          else next = t + 2000;
        }
      }
    }
  }
  // 놓친 사건: 받은 목록에 같은 점 · 같은 값 · 같은 시각(이벤트 방식) 또는 그 뒤 첫 폴링(폴링 방식)이 없으면 놓친 것
  const missed = ev.filter(e => !got.some(g => g.p === e.p && g.v === e.v && (g.src === 'event' ? g.t === e.t : g.t >= e.t && !ev.some(x => x.p === e.p && x.t > e.t && x.t <= g.t))));
  const lat = got.map(g => g.rx - (g.src === 'event' ? g.t : (ev.filter(e => e.p === g.p && e.v === g.v && e.t <= g.t).pop() || { t: g.t }).t));
  const tsErr = got.map(g => (g.src === 'event' ? 0 : g.t - (ev.filter(e => e.p === g.p && e.v === g.v && e.t <= g.t).pop() || { t: g.t }).t));
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const ok = msgs.filter(m => !m.lost);
  return {
    truth: ev, msgs, got, missed, overflow,
    stats: { events: ev.length, received: got.length, missed: missed.length, latAvg: avg(lat), latMax: Math.max(0, ...lat), tsErrMax: Math.max(0, ...tsErr), messages: ok.length, bytes: ok.reduce((s, m) => s + m.bytes, 0), overflow }
  };
}
