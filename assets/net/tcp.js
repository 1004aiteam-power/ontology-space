// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// TCP 연결 · 전송 · 종료를 가상으로 돌려 패킷 기록을 만든다: 3-way handshake, 번호(seq/ack), 윈도우, 분실과 재전송, 4-way 종료.
// 같은 입력(난수 씨앗 포함)이면 항상 같은 결과다. 실제 네트워크가 아니라 학습용 모형이다 (혼잡 제어 · 지연 ACK · 옵션은 생략)

import { mulberry32 as rng } from '../lib/rng.js?v=73d9551d';

export const ISN_C = 1000, ISN_S = 5000, SEG = 1000;      // 시작 번호와 세그먼트 크기 (읽기 쉽게 고정)

export { rng };

/**
 * simulate({ segments, loss, owd, rto, window, seed, drops })
 *   segments 보낼 세그먼트 수, loss 패킷마다 잃을 확률(0~1), owd 한쪽 방향 지연(ms), rto 재전송 대기(ms),
 *   window 한 번에 보낼 수 있는 세그먼트 수, drops 일부러 버릴 패킷 이름 ['SYN#1', 'D1#1', …] (이름#몇 번째 전송)
 * → { packets, states, stats, end, delivered, aborted }
 */
export function simulate(opts = {}) {
  const P = { segments: 6, loss: 0, owd: 50, rto: 300, window: 3, seed: 1, drops: [], gap: 24, maxTries: 16, ...opts };
  const rand = rng(P.seed);
  const packets = [], states = [], q = [];
  const stats = { sent: 0, lost: 0, retx: 0, fast: 0 };
  const cur = { client: 'CLOSED', server: 'LISTEN' };
  let now = 0, n = 0, aborted = false;
  states.push({ t: 0, side: 'client', state: 'CLOSED' }, { t: 0, side: 'server', state: 'LISTEN' });
  const at = (t, fn) => q.push({ t, n: n++, fn });
  const setState = (side, s) => { if (cur[side] !== s) { cur[side] = s; states.push({ t: now, side, state: s }); } };

  const tok = {}, tries = {};
  const timer = (name, delay, fn) => { const k = tok[name] = (tok[name] || 0) + 1; at(now + delay, () => { if (tok[name] === k) fn(); }); };
  const stop = (name) => { tok[name] = (tok[name] || 0) + 1; };
  const retry = (name) => { tries[name] = (tries[name] || 0) + 1; if (tries[name] > P.maxTries) { aborted = true; return false; } return true; };

  const free = { client: 0, server: 0 }, count = {};
  function emit(from, p) {
    const k = p.key; count[k] = (count[k] || 0) + 1;
    const nth = count[k];
    const forced = P.drops.includes(`${k}#${nth}`);
    const lost = forced || rand() < P.loss;
    const rec = { id: packets.length, dir: from === 'client' ? 'c2s' : 's2c', t: now, arrive: lost ? null : now + P.owd, lost, forced, retx: nth > 1, reason: p.reason || (nth > 1 ? 'timeout' : ''), ...p };
    packets.push(rec);
    stats.sent++; if (lost) stats.lost++; if (rec.retx) stats.retx++; if (p.reason === 'fast') stats.fast++;
    if (!lost) at(now + P.owd, () => receive(from === 'client' ? 'server' : 'client', rec));
  }
  function send(from, p) {                                 // 한 장비가 한꺼번에 여러 개를 보내면 gap(ms) 간격으로 줄 세움
    const t = Math.max(now, free[from]);
    free[from] = t + P.gap;
    if (t > now) at(t, () => emit(from, p)); else emit(from, p);
  }

  // ---- 클라이언트 (보내는 쪽) ----
  const C = { base: 0, next: 0, dup: 0, timerOn: false, finSeq: ISN_C + 1 + P.segments * SEG };
  const sendData = (i, reason) => send('client', { kind: 'data', key: 'D' + i, flags: ['ACK', 'PSH'], seq: ISN_C + 1 + i * SEG, ack: ISN_S + 1, len: SEG, idx: i, reason });
  const sendSyn = () => send('client', { kind: 'ctl', key: 'SYN', flags: ['SYN'], seq: ISN_C, ack: 0, len: 0 });
  const sendFin = () => send('client', { kind: 'ctl', key: 'FIN', flags: ['FIN', 'ACK'], seq: C.finSeq, ack: ISN_S + 1, len: 0 });
  const armData = () => {
    C.timerOn = true;
    timer('cdata', P.rto, () => {
      C.timerOn = false;
      if (!retry('cdata:' + C.base)) return;
      sendData(C.base, 'timeout'); C.dup = 0; armData();
    });
  };
  const pump = () => {
    while (C.next < P.segments && C.next < C.base + P.window) sendData(C.next++);
    if (!C.timerOn && C.base < C.next) armData();
  };
  const armSyn = () => timer('csyn', P.rto, () => { if (retry('csyn')) { sendSyn(); armSyn(); } });
  const armFin = () => timer('cfin', P.rto, () => { if (retry('cfin')) { sendFin(); armFin(); } });
  const closeClient = () => { setState('client', 'FIN_WAIT_1'); sendFin(); armFin(); };

  // ---- 서버 (받는 쪽) ----
  const S = { got: new Set(), rcv: 0, finSeq: ISN_S + 1 };
  const sendSynAck = () => send('server', { kind: 'ctl', key: 'SYNACK', flags: ['SYN', 'ACK'], seq: ISN_S, ack: ISN_C + 1, len: 0 });
  const sendAck = (key, ack) => send('server', { kind: 'ack', key, flags: ['ACK'], seq: ISN_S + 1, ack, len: 0 });
  const sendSFin = () => send('server', { kind: 'ctl', key: 'SFIN', flags: ['FIN', 'ACK'], seq: S.finSeq, ack: C.finSeq + 1, len: 0 });
  const armSynAck = () => timer('ssyn', P.rto, () => { if (retry('ssyn')) { sendSynAck(); armSynAck(); } });
  const armSFin = () => timer('sfin', P.rto, () => {                    // 마지막 ACK가 끝내 안 오면 포기하고 닫음 (실제 TCP도 재시도 한도가 있음)
    tries.sfin = (tries.sfin || 0) + 1;
    if (tries.sfin > P.maxTries) setState('server', 'CLOSED'); else { sendSFin(); armSFin(); }
  });

  function receive(side, p) {
    const f = (x) => p.flags.includes(x);
    if (side === 'server') {
      if (f('SYN')) {                                                    // 연결 요청 (재전송된 것도)
        if (cur.server === 'LISTEN' || cur.server === 'SYN_RCVD') { setState('server', 'SYN_RCVD'); sendSynAck(); armSynAck(); }
        return;
      }
      if (cur.server === 'SYN_RCVD' && f('ACK')) { stop('ssyn'); setState('server', 'ESTABLISHED'); }
      if (p.kind === 'data') {
        if (cur.server !== 'ESTABLISHED') return;
        S.got.add(p.idx);
        while (S.got.has(S.rcv)) S.rcv++;
        sendAck('A' + S.rcv, ISN_C + 1 + S.rcv * SEG);                  // 누적 확인: 연속으로 받은 곳까지
      } else if (f('FIN')) {
        if (cur.server === 'ESTABLISHED') {
          setState('server', 'CLOSE_WAIT'); sendAck('FINACK', C.finSeq + 1);
          at(now + 20, () => { setState('server', 'LAST_ACK'); sendSFin(); armSFin(); });
        } else if (cur.server === 'CLOSE_WAIT' || cur.server === 'LAST_ACK') sendAck('FINACK', C.finSeq + 1);
      } else if (cur.server === 'LAST_ACK' && f('ACK') && p.ack === S.finSeq + 1) { stop('sfin'); setState('server', 'CLOSED'); }
      return;
    }
    // 클라이언트가 받은 것 (TIME_WAIT: 마지막 ACK가 잃어져 서버가 FIN을 다시 보내도 답할 수 있게 한동안 남아 있음)
    if (f('SYN') && f('ACK')) {
      if (cur.client === 'SYN_SENT') {
        stop('csyn'); setState('client', 'ESTABLISHED');
        send('client', { kind: 'ctl', key: 'HSACK', flags: ['ACK'], seq: ISN_C + 1, ack: ISN_S + 1, len: 0 });
        at(now + P.gap, pump);
      } else if (cur.client === 'ESTABLISHED') send('client', { kind: 'ctl', key: 'HSACK', flags: ['ACK'], seq: ISN_C + 1, ack: ISN_S + 1, len: 0 });
      return;
    }
    if (f('FIN')) {                                                      // 서버도 닫겠다
      if (cur.client === 'FIN_WAIT_1' || cur.client === 'FIN_WAIT_2') {
        stop('cfin'); setState('client', 'TIME_WAIT');
        send('client', { kind: 'ctl', key: 'LASTACK', flags: ['ACK'], seq: C.finSeq + 1, ack: S.finSeq + 1, len: 0 });
        timer('ctw', 3 * P.rto, () => setState('client', 'CLOSED'));
      } else if (cur.client === 'TIME_WAIT') {
        send('client', { kind: 'ctl', key: 'LASTACK', flags: ['ACK'], seq: C.finSeq + 1, ack: S.finSeq + 1, len: 0 });
        timer('ctw', 3 * P.rto, () => setState('client', 'CLOSED'));
      }
      return;
    }
    if (cur.client === 'FIN_WAIT_1' && p.ack === C.finSeq + 1) { stop('cfin'); setState('client', 'FIN_WAIT_2'); return; }
    if (cur.client !== 'ESTABLISHED' || !f('ACK')) return;
    const a = Math.round((p.ack - (ISN_C + 1)) / SEG);                  // 지금까지 몇 개를 확인받았나
    if (a > C.base) {
      C.base = a; C.dup = 0; stop('cdata'); C.timerOn = false;
      if (C.base < C.next) armData();
      pump();
      if (C.base >= P.segments) closeClient();
    } else if (a === C.base && C.base < C.next) {
      C.dup++;
      if (C.dup === 3) { sendData(C.base, 'fast'); stop('cdata'); armData(); }   // 같은 확인이 3번 → 타이머를 기다리지 않고 바로 다시 보냄
    }
  }

  at(0, () => { setState('client', 'SYN_SENT'); sendSyn(); armSyn(); });
  while (q.length && packets.length < 3000) {
    q.sort((a, b) => a.t - b.t || a.n - b.n);
    const e = q.shift(); now = e.t; e.fn();
    if (aborted) break;
  }
  return { packets, states, stats, end: now, delivered: S.rcv === P.segments, aborted, params: P };
}
