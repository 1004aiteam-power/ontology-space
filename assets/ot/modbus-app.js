// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Modbus 페이지: 요청을 고르면 바이트 프레임을 만들어 가상 인버터에 보내고, 장치의 검사 과정 · 응답 프레임 · 해석 · 레지스터 표를 보여 준다 (계산은 modbus.js)
import { FC, EXC, ST, MAP, COILS, requestPdu, frame, handle, makeInverter, scaled, hex, rtuMs, gapMs } from './modbus.js?v=276bea9d';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const PRESETS = [
  { id: 'read', ko: '측정값 읽기 (FC 3)', en: 'Read measurements (FC 3)', v: { mode: 'rtu', unit: 1, fc: 3, addr: 0, qty: 13, vals: '' } },
  { id: 'limit', ko: '출력 50%로 제한 (FC 16)', en: 'Limit output to 50% (FC 16)', v: { mode: 'rtu', unit: 1, fc: 16, addr: 13, qty: 2, vals: '50, 1' } },
  { id: 'unlimit', ko: '제한 해제 (FC 6)', en: 'Remove the limit (FC 6)', v: { mode: 'rtu', unit: 1, fc: 6, addr: 14, qty: 1, vals: '0' } },
  { id: 'stop', ko: '운전 정지 (FC 5)', en: 'Stop the inverter (FC 5)', v: { mode: 'rtu', unit: 1, fc: 5, addr: 0, qty: 1, vals: '0' } },
  { id: 'coils', ko: '코일 읽기 (FC 1)', en: 'Read coils (FC 1)', v: { mode: 'rtu', unit: 1, fc: 1, addr: 0, qty: 2, vals: '' } },
  { id: 'tcp', ko: '같은 읽기를 TCP로', en: 'The same read over TCP', v: { mode: 'tcp', unit: 1, fc: 3, addr: 0, qty: 13, vals: '' } },
  { id: 'bad', ko: '없는 주소 → 예외 2', en: 'Missing address → exception 2', v: { mode: 'rtu', unit: 1, fc: 3, addr: 20, qty: 2, vals: '' } },
  { id: 'ro', ko: '읽기 전용에 쓰기 → 예외 2', en: 'Write to read-only → exception 2', v: { mode: 'rtu', unit: 1, fc: 6, addr: 5, qty: 1, vals: '9999' } },
  { id: 'range', ko: '범위 밖 값 → 예외 3', en: 'Out-of-range value → exception 3', v: { mode: 'rtu', unit: 1, fc: 6, addr: 13, qty: 1, vals: '150' } },
  { id: 'fc4', ko: '지원 안 하는 기능 → 예외 1', en: 'Unsupported function → exception 1', v: { mode: 'rtu', unit: 1, fc: 4, addr: 0, qty: 2, vals: '' } },
  { id: 'other', ko: '다른 장치 주소 → 무응답', en: 'Another device address → silence', v: { mode: 'rtu', unit: 2, fc: 3, addr: 0, qty: 2, vals: '' } },
  { id: 'noise', ko: '잡음으로 비트가 뒤집힘 → 무응답', en: 'Noise flips a bit → silence', v: { mode: 'rtu', unit: 1, fc: 3, addr: 0, qty: 2, vals: '', noise: true } }
];
const CLS = { unit: 'hd', tid: 'hd', pid: 'hd', len: 'hd', fc: 'fc', crc: 'ck', exc: 'ex' };
const inv = makeInverter();
let V = { ...PRESETS[0].v, noise: false }, preset = 'read', tid = 0, last = null, touched = { regs: [], coils: [] }, hist = [];

const readForm = () => {
  V = { mode: $('mbMode').value, unit: +$('mbUnit').value, fc: +$('mbFc').value, addr: +$('mbAddr').value, qty: +$('mbQty').value, vals: $('mbVals').value, noise: $('mbNoise').checked };
};
const writeForm = () => {
  $('mbMode').value = V.mode; $('mbUnit').value = V.unit; $('mbFc').value = V.fc; $('mbAddr').value = V.addr; $('mbQty').value = V.qty; $('mbVals').value = V.vals; $('mbNoise').checked = !!V.noise;
  formState();
};
function formState() {
  const fc = +$('mbFc').value, w = fc === 5 || fc === 6 || fc === 16;
  $('mbQtyL').hidden = w; $('mbValsL').hidden = !w;
  $('mbNoiseL').hidden = $('mbMode').value !== 'rtu'; $('mbBaudL').hidden = $('mbMode').value !== 'rtu';
}

function send() {
  readForm();
  const nums = V.vals.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  const req = { fc: V.fc, addr: V.addr, qty: V.qty, value: nums[0] ?? 0, values: V.fc === 16 ? nums : [] };
  const q = requestPdu(req);
  tid = (tid + 1) & 0xffff;
  const out = frame(V.mode, V.unit, q.pdu, q.fields, tid);
  let wire = out.bytes, flipped = null;
  if (V.mode === 'rtu' && V.noise) { wire = [...wire]; flipped = Math.min(3, wire.length - 3); wire[flipped] ^= 0x04; }
  const r = handle(inv, V.mode, wire);
  touched = r.touched;
  const back = r.reply ? frame(V.mode, V.unit, r.reply.pdu, r.reply.fields, tid) : null;
  last = { req, out, wire, flipped, r, back, mode: V.mode, fc: V.fc };
  hist.unshift({ mode: V.mode, req: out.bytes, rep: back ? back.bytes : null, exc: back && back.bytes[V.mode === 'rtu' ? 1 : 7] & 0x80 });
  hist = hist.slice(0, 8);
  render();
}

function hexLine(bytes, parts, id, flipped) {
  const cls = (i) => { const p = parts.find(p => i >= p.from && i < p.to); return p ? CLS[p.k] || 'dt' : 'dt'; };
  const pi = (i) => parts.findIndex(p => i >= p.from && i < p.to);
  return `<div class="mb-hex" id="${id}">${bytes.map((b, i) => `<span class="${cls(i)}${i === flipped ? ' flip' : ''}" data-p="${pi(i)}">${hex(b)}</span>`).join('')}</div>`;
}
function fieldTable(bytes, parts, id) {
  return `<div class="net-scroll"><table class="net-tab mb-f" data-hex="${id}"><thead><tr><th>${T('바이트', 'Bytes')}</th><th>${T('칸', 'Field')}</th><th>${T('값', 'Value')}</th></tr></thead><tbody>${parts.map((p, i) =>
    `<tr tabindex="0" data-a="${i}"><td><i class="mb-sw ${CLS[p.k] || 'dt'}"></i>${bytes.slice(p.from, p.to).map(hex).join(' ')}</td><td>${esc(t(p))}</td><td>${esc(String(p.v))}</td></tr>`).join('')}</tbody></table></div>`;
}

function result() {
  if (!last) { $('mbOut').innerHTML = `<p class="meta">${T('위에서 요청을 고르고 "보내기"를 누르세요.', 'Pick a request above and press "Send".')}</p>`; return; }
  const { out, wire, flipped, r, back, mode, fc } = last, baud = +$('mbBaud').value;
  const o = [];
  o.push(`<h3>${T('1. 마스터가 보내는 요청', '1. The request the master sends')}</h3>`);
  o.push(hexLine(wire, out.parts, 'mbHexQ', flipped));
  if (flipped !== null) o.push(`<p class="mb-warn">${T(`선로 잡음으로 ${flipped}번 바이트의 비트 하나가 뒤집혔습니다 (${hex(out.bytes[flipped])} → ${hex(wire[flipped])}). 보낸 쪽이 계산한 CRC는 원래 바이트 기준입니다.`, `Line noise flipped one bit in byte ${flipped} (${hex(out.bytes[flipped])} → ${hex(wire[flipped])}). The CRC was computed by the sender over the original bytes.`)}</p>`);
  o.push(fieldTable(wire, out.parts, 'mbHexQ'));
  o.push(`<h3>${T('2. 인버터가 하는 일', '2. What the inverter does')}</h3><ol class="mb-log">${r.log.map(l => `<li class="${l.ok ? 'ok' : 'no'}">${esc(t(l))}</li>`).join('')}</ol>`);
  o.push(`<h3>${T('3. 돌아오는 응답', '3. The reply')}</h3>`);
  if (!back) o.push(`<p class="mb-warn">${T('응답이 없습니다. 마스터는 정해 둔 시간(보통 수백 ms~1초)만큼 기다리다가 <b>타임아웃</b>으로 처리하고, 다시 보내거나 다음 장치로 넘어갑니다. Modbus에는 "받았다"는 별도 신호가 없습니다.', 'No reply. The master waits for its configured time (typically a few hundred ms to 1 s), records a <b>timeout</b>, and retries or moves on to the next device. Modbus has no separate acknowledgement.')}</p>`);
  else {
    o.push(hexLine(back.bytes, back.parts, 'mbHexR', null));
    o.push(fieldTable(back.bytes, back.parts, 'mbHexR'));
    if (fc === 3 && !(back.bytes[mode === 'rtu' ? 1 : 7] & 0x80)) {
      const regs = inv.regs(), a = last.req.addr, n = last.req.qty, rows = MAP.filter(m => m.a >= a && m.a < a + n && !m.isSf && !m.pairLo);
      o.push(`<h3>${T('4. 마스터가 숫자를 해석하기', '4. The master interprets the numbers')}</h3><p class="meta">${T('레지스터는 단위도 소수점도 없는 16비트 정수일 뿐입니다. 배율(SF) 레지스터와 레지스터 지도(문서)가 있어야 뜻을 압니다.', 'A register is only a 16-bit integer with no unit or decimal point. You need the scale-factor (SF) registers and the register map (a document) to know what it means.')}</p>`);
      o.push(`<div class="net-scroll"><table class="net-tab mb-dec"><thead><tr><th>${T('레지스터', 'Register')}</th><th>${T('받은 값', 'Raw')}</th><th>${T('계산', 'Computation')}</th><th>${T('뜻', 'Meaning')}</th></tr></thead><tbody>${rows.map(m => {
        const raw = regs[m.a], v = scaled(regs, m);
        const how = m.enum ? T('상태 번호표', 'state table') : m.pair ? (m.pair < a + n ? `${raw} × 65536 + ${regs[m.pair]}` : T('하위 16비트도 읽어야 함', 'need the low 16 bits too')) : m.sf !== undefined ? (m.sf < a + n ? `${raw >= 32768 ? raw - 65536 : raw} × 10^${scaled(regs, MAP[m.sf])}` : T('배율 레지스터도 읽어야 함', 'need the SF register too')) : '—';
        const mean = m.enum ? `${raw} = ${t(ST[raw] || { ko: '?', en: '?' })}` : m.pair ? (m.pair < a + n ? `${v.toLocaleString()} Wh` : '?') : m.sf !== undefined ? (m.sf < a + n ? `${v} ${m.unit}` : '?') : `${v}${m.unit ? ' ' + m.unit : ''}`;
        return `<tr><td>${m.a} <small>${m.id}</small></td><td>${raw}</td><td>${how}</td><td><b>${esc(mean)}</b></td></tr>`;
      }).join('')}</tbody></table></div>`);
    }
  }
  if (mode === 'rtu') {
    const q = rtuMs(wire.length, baud), g = gapMs(baud), p = 5, rp = back ? rtuMs(back.bytes.length, baud) : 0, total = q + g + p + rp + (back ? g : 0);
    const seg = (k, ms, lab) => `<i class="${k}" style="flex:${ms.toFixed(2)} 0 0" title="${esc(lab)} ${ms.toFixed(1)} ms"></i>`;
    o.push(`<h3>${T('선로 위의 시간 (RS-485)', 'Time on the line (RS-485)')}</h3><div class="mb-tl">${seg('q', q, T('요청', 'request'))}${seg('g', g, T('쉼', 'gap'))}${seg('p', p, T('처리', 'processing'))}${back ? seg('r', rp, T('응답', 'reply')) + seg('g', g, T('쉼', 'gap')) : ''}</div>
      <p class="meta">${T(`${baud} bps에서 한 글자(11비트) = ${(11000 / baud).toFixed(2)} ms. 요청 ${wire.length}바이트 ${q.toFixed(1)} ms + 프레임 끝을 알리는 쉼 ${g.toFixed(1)} ms + 장치 처리(가정) ${p} ms${back ? ` + 응답 ${back.bytes.length}바이트 ${rp.toFixed(1)} ms + 쉼 ${g.toFixed(1)} ms` : ''} ≈ <b>${total.toFixed(1)} ms</b>. 한 선에 장치가 30대면 한 바퀴 도는 데 이것의 30배가 걸립니다.`, `At ${baud} bps one character (11 bits) = ${(11000 / baud).toFixed(2)} ms. Request ${wire.length} bytes ${q.toFixed(1)} ms + end-of-frame silence ${g.toFixed(1)} ms + device processing (assumed) ${p} ms${back ? ` + reply ${back.bytes.length} bytes ${rp.toFixed(1)} ms + silence ${g.toFixed(1)} ms` : ''} ≈ <b>${total.toFixed(1)} ms</b>. With 30 devices on one line, a full polling round takes 30 times this.`)}</p>`);
  } else o.push(`<p class="meta">${T('Modbus TCP는 TCP 포트 502 위에서 오갑니다. CRC 대신 MBAP 머리말이 붙고, 오류 검사 · 재전송 · 순서는 <a href="tcp.html">TCP</a>가 맡습니다. 트랜잭션 ID 덕분에 응답을 기다리지 않고 여러 요청을 연달아 보낼 수도 있습니다.', 'Modbus TCP runs over TCP port 502. An MBAP header replaces the CRC, and <a href="tcp.html">TCP</a> takes care of error checking, retransmission and ordering. Thanks to the transaction ID, several requests can be sent without waiting for each reply.')}</p>`);
  $('mbOut').innerHTML = o.join('');
}

function device() {
  const R = inv.regs(), st = R[0];
  $('mbDevState').innerHTML = `<b>${T('가상 인버터', 'Virtual inverter')}</b> · ${T('주소', 'address')} ${inv.d.unit} · ${T('정격', 'rated')} 10 kW · <span class="mb-st s${st}">${esc(t(ST[st]))}</span> · ${T('출력', 'output')} <b>${R[5].toLocaleString()} W</b>`;
  $('mbRegs').innerHTML = `<table class="net-tab mb-regs"><thead><tr><th>${T('주소', 'Addr')}</th><th>${T('문서 표기', 'Doc. no.')}</th><th>${T('이름', 'Name')}</th><th>${T('원시값', 'Raw')}</th><th>${T('뜻', 'Meaning')}</th><th>${T('쓰기', 'Write')}</th></tr></thead><tbody>${MAP.map(m => {
    const v = scaled(R, m);
    const mean = m.enum ? t(ST[R[m.a]]) : m.isSf ? `10^${v}` : m.pair ? `${v.toLocaleString()} Wh` : m.pairLo ? '↑' : `${v}${m.unit ? ' ' + m.unit : ''}`;
    return `<tr class="${touched.regs.includes(m.a) ? 'hit' : ''}"><td>${m.a}</td><td>${40001 + m.a}</td><td>${esc(t(m))} <small>${m.id}</small></td><td>${R[m.a]}</td><td>${esc(mean)}</td><td>${m.rw ? '✎' : ''}</td></tr>`;
  }).join('')}</tbody></table><table class="net-tab mb-regs"><thead><tr><th>${T('코일', 'Coil')}</th><th>${T('문서 표기', 'Doc. no.')}</th><th>${T('이름', 'Name')}</th><th>${T('값', 'Value')}</th></tr></thead><tbody>${COILS.map((c, i) => `<tr class="${touched.coils.includes(c.a) ? 'hit' : ''}"><td>${c.a}</td><td>${String(c.a + 1).padStart(5, '0')}</td><td>${esc(t(c))} <small>${c.id}</small></td><td>${inv.coils()[i] ? 'ON' : 'OFF'}</td></tr>`).join('')}</tbody></table>`;
  $('mbSunOut').textContent = (inv.d.avail / 1000).toFixed(1) + ' kW';
}

function history() {
  $('mbHist').innerHTML = hist.length ? hist.map(h => `<li><span class="meta">${h.mode.toUpperCase()}</span> → <code>${h.req.map(hex).join(' ')}</code><br>← ${h.rep ? `<code class="${h.exc ? 'bad' : ''}">${h.rep.map(hex).join(' ')}</code>` : `<span class="bad">${T('(무응답 · 타임아웃)', '(no reply · timeout)')}</span>`}</li>`).join('') : `<li class="meta">${T('아직 없음', 'Nothing yet')}</li>`;
}

function labels() {
  $('mbPresets').innerHTML = PRESETS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${p.id === preset}">${t(p)}</button>`).join('');
  $('mbFc').innerHTML = Object.entries(FC).map(([k, v]) => `<option value="${k}">${k} · ${esc(t(v))}</option>`).join('');
  $('mbFc').value = V.fc;
}
function render() { labels(); result(); device(); history(); }

function init() {
  $('mbPresets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const p = PRESETS.find(x => x.id === b.dataset.id); V = { noise: false, ...p.v }; preset = p.id; labels(); writeForm(); send();
  });
  for (const id of ['mbMode', 'mbUnit', 'mbFc', 'mbAddr', 'mbQty', 'mbVals', 'mbNoise']) $(id).addEventListener('input', () => { preset = ''; labels(); formState(); });
  $('mbSend').addEventListener('click', send);
  $('mbBaud').addEventListener('input', result);
  $('mbSun').addEventListener('input', () => { inv.d.avail = +$('mbSun').value; touched = { regs: [], coils: [] }; device(); });
  $('mbFix').addEventListener('click', () => { inv.d.run = true; inv.d.limEna = 0; inv.d.limPct = 100; touched = { regs: [13, 14], coils: [0] }; device(); });
  // 칸 줄에 마우스를 올리면 16진수에서 그 바이트를 강조
  const hl = (e, on) => {
    const tr = e.target.closest('tr[data-a]'); if (!tr) return;
    const box = $(tr.closest('table').dataset.hex); if (!box) return;
    for (const s of box.querySelectorAll(`span[data-p="${tr.dataset.a}"]`)) s.classList.toggle('hl', on);
  };
  for (const ev of ['mouseover', 'focusin']) $('mbOut').addEventListener(ev, e => hl(e, true));
  for (const ev of ['mouseout', 'focusout']) $('mbOut').addEventListener(ev, e => hl(e, false));
  document.addEventListener('langchange', render);
  labels(); writeForm(); send();
}
init();
