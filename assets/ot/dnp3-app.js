// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// DNP3 페이지: 같은 60초 사건을 주기 폴링 · 이벤트 폴링 · 무응답 보고로 받아 시간축 · 비교표 · 사건 기록(SOE)으로 보여 준다 (계산은 dnp3.js)
import { POINTS, simulate, linkFrame, classPollUser, USER_PARTS } from './dnp3.js?v=efa49bb5';
import { hex } from './modbus.js?v=276bea9d';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const MODES = ['poll', 'class', 'unsol'];
const MN = { poll: { ko: '① 주기 폴링 (현재 값만)', en: '① Periodic polling (current values only)' }, class: { ko: '② DNP3 이벤트 폴링', en: '② DNP3 event polling' }, unsol: { ko: '③ DNP3 무응답 보고', en: '③ DNP3 unsolicited reporting' } };
const MD = {
  poll: { ko: '주장치가 몇 초마다 "지금 값"을 묻습니다. Modbus로 읽는 방식과 같습니다. 두 번 묻는 사이에 열렸다 닫힌 차단기는 <b>보이지 않고</b>, 바뀐 값의 시각도 "읽은 때"로 기록됩니다.', en: 'The master asks for "current values" every few seconds, as with Modbus. A breaker that opened and closed between two polls is <b>invisible</b>, and changes are stamped with the time they were read.' },
  class: { ko: '장치가 사건을 <b>생긴 시각(ms)과 함께</b> 버퍼에 쌓아 두고, 주장치가 "클래스 1 · 2 · 3 사건을 달라"고 물을 때 몰아서 줍니다. 놓치는 것은 없지만 다음 폴링까지 늦게 압니다.', en: 'The outstation queues each event <b>with the millisecond it happened</b> and hands them all over when the master asks for "class 1, 2, 3 events". Nothing is missed, but the master learns late, at the next poll.' },
  unsol: { ko: '사건이 생기면 장치가 <b>먼저</b> 보내고 주장치가 확인(confirm)합니다. 거의 바로 알지만, 확인을 못 받으면 다시 보내야 하므로 메시지가 늘어납니다.', en: 'When an event occurs the outstation sends it <b>first</b> and the master confirms. The master knows almost at once, but missing confirmations mean resends, so more messages.' }
};
const PC = { CB101: '#d33', CB102: '#e8912d', MW: '#2a78d6', kV: '#8a63d2' };
let V = { mode: 'class', period: 5000, down: false, buf: 50 }, res = {};

const opt = (m) => ({ mode: m, period: V.period, down: V.down ? [20000, 40000] : null, buf: V.buf });
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 1 : 2) + ' s' : Math.round(ms) + ' ms');
const pname = (id) => t(POINTS.find(p => p.id === id));

function timeline(r) {
  const W = 760, L = 120, top = 18, RH = 22, rows = [...POINTS.map(p => p.id), 'msg', 'got'], H = top + rows.length * RH + 10;
  const sx = (ms) => L + ms / 60000 * (W - L - 10);
  const o = [`<svg class="dn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('60초 동안의 사건과 메시지', 'Events and messages over 60 seconds'))}">`];
  if (V.down) o.push(`<rect x="${sx(20000)}" y="${top - 4}" width="${sx(40000) - sx(20000)}" height="${H - top}" class="dn-down"/><text x="${sx(30000)}" y="${top + 4}" text-anchor="middle" class="dn-dl">${esc(T('통신 끊김', 'link down'))}</text>`);
  for (let s = 0; s <= 60; s += 10) o.push(`<line x1="${sx(s * 1000)}" y1="12" x2="${sx(s * 1000)}" y2="${H - 6}" class="gx"/><text x="${sx(s * 1000)}" y="9" text-anchor="middle">${s}s</text>`);
  const ry = (k) => top + rows.indexOf(k) * RH;
  const lab = { msg: T('메시지 (위 ↑ 주장치, 아래 ↓ 장치)', 'Messages (↑ master, ↓ outstation)'), got: T('주장치가 기록한 사건', 'Events as the master recorded them') };
  rows.forEach(k => o.push(`<text x="4" y="${ry(k) + 13}" class="rl">${esc(lab[k] || pname(k))}</text><line x1="${L}" y1="${ry(k) + 10}" x2="${W - 10}" y2="${ry(k) + 10}" class="dn-ax"/>`));
  for (const e of r.truth) o.push(`<rect x="${(sx(e.t) - 1.5).toFixed(1)}" y="${ry(e.p) + 3}" width="3" height="14" fill="${PC[e.p]}"${r.missed.includes(e) ? ' class="dn-miss"' : ''}><title>${e.t} ms · ${e.v}</title></rect>`);
  for (const m of r.msgs) {
    const x = sx(m.t).toFixed(1), y = ry('msg');
    o.push(m.lost ? `<text x="${x}" y="${y + 15}" text-anchor="middle" class="dn-x">✕</text>` : `<line x1="${x}" x2="${x}" y1="${m.dir === 'MO' ? y + 10 : y + 2}" y2="${m.dir === 'MO' ? y + 2 : y + 18}" class="dn-m ${m.dir}"/>`);
  }
  for (const g of r.got) o.push(`<circle cx="${sx(g.t).toFixed(1)}" cy="${ry('got') + 10}" r="3" fill="${PC[g.p]}"><title>${pname(g.p)} = ${g.v} @ ${g.t} ms (${T('받은 때', 'received')} ${g.rx} ms)</title></circle>`);
  o.push('</svg>');
  return o.join('');
}

function render() {
  for (const m of MODES) res[m] = simulate(opt(m));
  const r = res[V.mode];
  $('dnModes').innerHTML = MODES.map(m => `<button type="button" data-m="${m}" aria-pressed="${m === V.mode}">${esc(t(MN[m]))}</button>`).join('');
  $('dnPerOut').textContent = V.period / 1000 + ' s'; $('dnBufOut').textContent = V.buf;
  $('dnDesc').innerHTML = t(MD[V.mode]);
  $('dnTl').innerHTML = timeline(r);
  $('dnTable').innerHTML = `<table class="net-tab cn-tab"><thead><tr><th>${T('방식', 'Method')}</th><th>${T('받은 사건', 'Events received')}</th><th>${T('놓친 사건', 'Missed')}</th><th>${T('평균 지연', 'Avg delay')}</th><th>${T('최대 지연', 'Max delay')}</th><th>${T('시각 오차', 'Timestamp error')}</th><th>${T('메시지 · 바이트', 'Messages · bytes')}</th></tr></thead><tbody>${MODES.map(m => { const s = res[m].stats; return `<tr tabindex="0" data-m="${m}" class="${m === V.mode ? 'sel' : ''}"><td>${esc(t(MN[m]))}</td><td>${s.received} / ${s.events}</td><td class="${s.missed ? 'dn-bad' : ''}">${s.missed}${s.overflow ? ` <small>(${T('버퍼 넘침', 'overflow')})</small>` : ''}</td><td>${fmt(s.latAvg)}</td><td>${fmt(s.latMax)}</td><td>${s.tsErrMax ? T(`최대 ${fmt(s.tsErrMax)}`, `up to ${fmt(s.tsErrMax)}`) : T('없음 (ms 단위 원래 시각)', 'none (original ms time)')}</td><td>${s.messages} · ${s.bytes} B</td></tr>`; }).join('')}</tbody></table>`;
  // 차단기 사건 기록 (SOE)
  const cb = r.truth.filter(e => e.p.startsWith('CB'));
  $('dnSoe').innerHTML = `<table class="net-tab mb-regs"><thead><tr><th>${T('실제로 일어난 일', 'What actually happened')}</th><th>${T('주장치 기록', 'Master\'s record')}</th><th>${T('안 때', 'Known at')}</th></tr></thead><tbody>${cb.map(e => {
    const g = r.got.find(x => x.p === e.p && x.v === e.v && (x.src === 'event' ? x.t === e.t : x.t >= e.t && !r.missed.includes(e)));
    return `<tr><td><b>${(e.t / 1000).toFixed(3)} s</b> ${esc(pname(e.p))} ${e.v}</td><td>${g ? `${(g.t / 1000).toFixed(3)} s ${e.v}` : `<span class="dn-bad">${T('기록 없음 (놓침)', 'nothing (missed)')}</span>`}</td><td>${g ? `${(g.rx / 1000).toFixed(2)} s` : '—'}</td></tr>`;
  }).join('')}</tbody></table>${r.overflow ? `<p class="mb-warn">${T('통신이 끊긴 동안 쌓인 사건이 버퍼보다 많아 가장 오래된 것부터 버려졌습니다. 장치는 응답에 "버퍼 넘침"(IIN2.3) 표시를 붙여 알리고, 주장치는 전체 값을 다시 읽습니다(무결성 폴링).', 'More events piled up during the outage than the buffer holds, so the oldest were dropped. The outstation flags "buffer overflow" (IIN2.3) in its reply and the master re-reads everything (an integrity poll).')}</p>` : ''}`;
}

function frame() {
  const user = classPollUser(0), f = linkFrame(10, 1, user);
  const cls = (i) => { const p = f.parts.find(p => i >= p.from && i < p.to); return { start: 'hd', len: 'hd', ctrl: 'fc', dest: 'hd', src: 'hd', crc: 'ck', data: 'dt' }[p.k]; };
  const userRows = [[0, 1], [1, 2], [2, 3], [3, 5], [5, 6], [6, 8], [8, 9], [9, 11], [11, 12]];
  $('dnFrame').innerHTML = `<div class="mb-hex">${f.bytes.map((b, i) => `<span class="${cls(i)}">${hex(b)}</span>`).join('')}</div>
    <div class="net-scroll"><table class="net-tab mb-f"><thead><tr><th>${T('바이트', 'Bytes')}</th><th>${T('칸', 'Field')}</th></tr></thead><tbody>${f.parts.filter(p => p.k !== 'data').map(p => `<tr><td>${f.bytes.slice(p.from, p.to).map(hex).join(' ')}</td><td>${esc(t(p))}</td></tr>`).join('')}
    ${userRows.map(([a, b], k) => `<tr><td>${user.slice(a, b).map(hex).join(' ')}</td><td>${esc(t(USER_PARTS[k]))}</td></tr>`).join('')}</tbody></table></div>`;
}

function init() {
  $('dnModes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { V.mode = b.dataset.m; render(); } });
  const pick = (e) => { const tr = e.target.closest('tr[data-m]'); if (tr) { V.mode = tr.dataset.m; render(); } };
  $('dnTable').addEventListener('click', pick); $('dnTable').addEventListener('keydown', e => { if (e.key === 'Enter') pick(e); });
  $('dnPer').addEventListener('input', () => { V.period = +$('dnPer').value * 1000; render(); });
  $('dnBuf').addEventListener('input', () => { V.buf = +$('dnBuf').value; render(); });
  $('dnDown').addEventListener('input', () => { V.down = $('dnDown').checked; render(); });
  document.addEventListener('langchange', () => { render(); frame(); });
  render(); frame();
}
init();
