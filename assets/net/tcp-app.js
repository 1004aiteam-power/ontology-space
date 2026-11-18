// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// TCP 페이지: 연결 · 전송 · 종료를 순서도로 재생한다 (계산은 tcp.js)
import { simulate } from './tcp.js?v=b2a9f85f';
import { $, T, t } from '../lib/dom.js?v=3b73d59c';

const W = 760, XC = 190, XS = 570, TOP = 30;
const SPEEDS = [0.5, 1, 2, 4], BASE = 0.3;          // 1× = 실제 1ms 에 모의 시간 0.3ms
const PRESETS = [
  { id: 'clean', ko: '손실 없음', en: 'No loss', set: { loss: 0, drops: [], window: 3 } },
  { id: 'syn', ko: '첫 SYN 분실', en: 'First SYN lost', set: { loss: 0, drops: ['SYN#1'], window: 3 } },
  { id: 'data', ko: '데이터 하나 분실 (빠른 재전송)', en: 'One data segment lost (fast retransmit)', set: { loss: 0, drops: ['D1#1'], window: 4, segments: 6 } },
  { id: 'tail', ko: '마지막 데이터 분실 (타임아웃)', en: 'Last data lost (timeout)', set: { loss: 0, drops: ['D5#1'], window: 3, segments: 6 } },
  { id: 'ack', ko: '마지막 ACK 분실', en: 'Final ACK lost', set: { loss: 0, drops: ['LASTACK#1'], window: 3 } },
  { id: 'lossy', ko: '손실 20%', en: '20% loss', set: { loss: 0.2, drops: [], window: 3, seed: 7 } }
];
let P = { segments: 6, window: 3, loss: 0, owd: 50, rto: 300, seed: 1, drops: [] };
let res, now = 0, playing = false, speedIdx = 1, last = 0, k = 1, preset = 'clean';

const KIND = (p) => (p.kind === 'data' ? 'pk-data' : p.kind === 'ack' ? 'pk-ack' : 'pk-ctl');
const label = (p) => {
  const tag = p.reason === 'fast' ? ' ⚡' : p.retx ? ' ↻' : '';
  if (p.kind === 'data') return `DATA #${p.idx + 1} seq=${p.seq}${tag}`;
  if (p.kind === 'ack') return `ACK ack=${p.ack}${tag}`;
  return `${p.flags.join('+')} seq=${p.seq}${p.ack ? ' ack=' + p.ack : ''}${tag}`;
};
const y = (ms) => TOP + ms * k;

function run() {
  res = simulate({ ...P, segments: P.segments });
  k = Math.max(0.35, 48 / P.owd);
  now = res.end;
  playing = false;
}

function drawSvg() {
  const H = Math.round(y(res.end) + 50);
  const o = [`<svg class="tcp-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('TCP 패킷 순서도', 'TCP packet sequence diagram')}">`,
    `<line class="life" x1="${XC}" y1="0" x2="${XC}" y2="${H}"/><line class="life" x1="${XS}" y1="0" x2="${XS}" y2="${H}"/>`];
  for (const s of res.states) {
    if (s.t > now) continue;
    o.push(s.side === 'client' ? `<text class="st" x="${XC - 10}" y="${y(s.t) + 4}" text-anchor="end">${s.state}</text>` : `<text class="st st-s" x="${XS + 10}" y="${y(s.t) + 4}">${s.state}</text>`);
  }
  for (const p of res.packets) {
    if (p.t > now) continue;
    const c2s = p.dir === 'c2s', x1 = c2s ? XC : XS, x2 = c2s ? XS : XC;
    const f = Math.min(1, (now - p.t) / P.owd), end = p.lost ? Math.min(f, 0.6) : f;
    const hx = x1 + (x2 - x1) * end, hy = y(p.t) + (y(p.t + P.owd) - y(p.t)) * end;
    const cls = `pk ${p.lost ? 'pk-lost' : KIND(p)}${p.retx ? ' pk-retx' : ''}`;
    o.push(`<path class="${cls}" d="M${x1} ${y(p.t)}L${hx.toFixed(1)} ${hy.toFixed(1)}"/>`);
    const mx = (x1 + x2) / 2, my = (y(p.t) + y(p.t + P.owd)) / 2, ang = Math.atan2(c2s ? y(p.t + P.owd) - y(p.t) : y(p.t) - y(p.t + P.owd), Math.abs(x2 - x1)) * 180 / Math.PI;   // 글자는 늘 왼쪽에서 오른쪽으로 읽히게
    o.push(`<text class="lb" transform="translate(${mx} ${my - 5}) rotate(${ang.toFixed(1)})" text-anchor="middle">${label(p)}</text>`);
    if (p.lost && f >= 0.6) o.push(`<path class="x" d="M${hx - 6} ${hy - 6}l12 12M${hx + 6} ${hy - 6}l-12 12"/>`);
    else if (f >= 1) { const d = c2s ? -1 : 1; o.push(`<path class="head ${KIND(p)}" d="M${x2} ${hy.toFixed(1)}l${10 * d} -5l0 10z"/>`); }
    else o.push(`<circle class="head ${KIND(p)}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="3.5"/>`);
  }
  o.push(`<line class="cursor" x1="0" y1="${y(now)}" x2="${W}" y2="${y(now)}"/></svg>`);
  return o.join('');
}

function stateAt(side) { let s = ''; for (const e of res.states) if (e.side === side && e.t <= now) s = e.state; return s; }

function side() {
  const seen = res.packets.filter(p => p.t <= now);
  let rcv = 0; const got = new Set(res.packets.filter(p => p.kind === 'data' && p.arrive !== null && p.arrive <= now).map(p => p.idx));
  while (got.has(rcv)) rcv++;
  $('tcpState').innerHTML = `<dl><dt>${T('클라이언트', 'Client')}</dt><dd><span class="tcp-tag">${stateAt('client')}</span></dd><dt>${T('서버', 'Server')}</dt><dd><span class="tcp-tag">${stateAt('server')}</span></dd></dl>`;
  $('tcpStats').innerHTML = `<dl><dt>${T('시각', 'Time')}</dt><dd>${Math.round(now)} ms</dd><dt>${T('보낸 패킷', 'Packets sent')}</dt><dd>${seen.length}</dd><dt>${T('분실', 'Lost')}</dt><dd>${seen.filter(p => p.lost && now >= p.t + P.owd * 0.6).length}</dd><dt>${T('재전송', 'Retransmitted')}</dt><dd>${seen.filter(p => p.retx).length}</dd><dt>${T('빠른 재전송', 'Fast retransmits')}</dt><dd>${seen.filter(p => p.reason === 'fast').length}</dd><dt>${T('순서대로 받은 데이터', 'Data received in order')}</dt><dd>${rcv} / ${P.segments}</dd></dl>`;
  $('tcpTime').textContent = Math.round(now) + ' ms';
}

function table() {
  const rows = res.packets.map((p, i) => {
    const r = p.lost ? `<td class="lost">${p.forced ? T('분실 (일부러)', 'Lost (forced)') : T('분실', 'Lost')}</td>` : `<td>${T('도착', 'Arrived')}</td>`;
    const why = p.retx ? `<td class="retx">${p.reason === 'fast' ? T('빠른 재전송', 'Fast retransmit') : T('타임아웃 재전송', 'Timeout retransmit')}</td>` : '<td></td>';
    return `<tr><td>${i + 1}</td><td>${Math.round(p.t)}</td><td>${p.dir === 'c2s' ? '→' : '←'}</td><td>${p.flags.join('+')}${p.kind === 'data' ? ` #${p.idx + 1}` : ''}</td><td>${p.seq}</td><td>${p.ack || ''}</td><td>${p.len || ''}</td>${r}${why}</tr>`;
  }).join('');
  $('tcpTable').innerHTML = `<div class="net-scroll"><table class="net-tab ptab"><thead><tr><th>#</th><th>ms</th><th>${T('방향', 'Dir')}</th><th>${T('종류', 'Type')}</th><th>seq</th><th>ack</th><th>${T('길이', 'Len')}</th><th>${T('결과', 'Result')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function labels() {
  $('tcpPlay').textContent = playing ? T('⏸ 멈춤', '⏸ Pause') : T('▶ 재생', '▶ Play');
  $('tcpSpeed').textContent = SPEEDS[speedIdx] + '×';
  for (const [id, key, f] of [['tcpSegOut', 'segments', v => v], ['tcpWinOut', 'window', v => v], ['tcpLossOut', 'loss', v => Math.round(v * 100) + '%'], ['tcpOwdOut', 'owd', v => v + ' ms'], ['tcpRtoOut', 'rto', v => v + ' ms']]) $(id).textContent = f(P[key]);
  $('tcpPresets').innerHTML = PRESETS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${p.id === preset}">${t(p)}</button>`).join('');
  const r = res;
  $('tcpResult').textContent = r.aborted ? T('재시도 한도를 넘겨 연결을 포기했습니다 (손실이 너무 큼).', 'Gave up after too many retries (loss too high).')
    : T(`총 ${Math.round(r.end)} ms · 패킷 ${r.packets.length}개 중 ${r.stats.lost}개 분실 · 재전송 ${r.stats.retx}회 · 데이터 ${r.delivered ? '모두 순서대로 전달됨' : '일부만 전달됨'}`,
        `${Math.round(r.end)} ms in total · ${r.stats.lost} of ${r.packets.length} packets lost · ${r.stats.retx} retransmissions · data ${r.delivered ? 'all delivered in order' : 'only partly delivered'}`);
}

function draw(follow) {
  const box = $('tcpScroll'), keep = box.scrollTop;
  box.innerHTML = drawSvg();
  box.scrollTop = follow ? Math.max(0, (y(now) / W) * box.clientWidth * 1 - box.clientHeight * 0.65) : keep;
  side();
}

function frame(ts) {
  if (!playing) return;
  now = Math.min(res.end, now + (ts - last) * BASE * SPEEDS[speedIdx]); last = ts;
  draw(true);
  if (now >= res.end) { playing = false; labels(); return; }
  requestAnimationFrame(frame);
}
function play() {
  if (playing) { playing = false; labels(); return; }
  if (now >= res.end) now = 0;
  playing = true; last = performance.now(); labels(); requestAnimationFrame(frame);
}
function reset() { run(); labels(); table(); draw(false); }

function bind(id, key, conv = Number) {
  $(id).addEventListener('input', () => { P[key] = conv($(id).value); preset = ''; reset(); });
}
function init() {
  bind('tcpSeg', 'segments'); bind('tcpWin', 'window'); bind('tcpLoss', 'loss', v => v / 100); bind('tcpOwd', 'owd'); bind('tcpRto', 'rto');
  $('tcpPlay').addEventListener('click', play);
  $('tcpReset').addEventListener('click', () => { playing = false; now = 0; labels(); draw(false); $('tcpScroll').scrollTop = 0; });
  $('tcpSpeed').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; labels(); });
  $('tcpSeed').addEventListener('click', () => { P.seed = P.seed % 9999 + 1; reset(); });
  $('tcpPresets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const p = PRESETS.find(x => x.id === b.dataset.id);
    P = { segments: 6, window: 3, loss: 0, owd: P.owd, rto: P.rto, seed: 1, drops: [], ...p.set }; preset = p.id;
    $('tcpSeg').value = P.segments; $('tcpWin').value = P.window; $('tcpLoss').value = Math.round(P.loss * 100);
    reset();
  });
  document.addEventListener('langchange', () => { labels(); table(); draw(false); });
  reset();
}
init();
