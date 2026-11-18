// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 패킷 조립 페이지: 글자를 넣으면 TCP · IP · 이더넷 헤더가 차례로 붙는 모습과 실제 바이트(16진수)를 보여 준다
import { buildPackets, hex, hexs, parseIp } from './packet.js?v=516ddb59';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const LAYER = {
  eth: { c: 'var(--l-eth)', ko: '이더넷 헤더', en: 'Ethernet header' },
  ip: { c: 'var(--l-ip)', ko: 'IP 헤더', en: 'IP header' },
  tcp: { c: 'var(--l-tcp)', ko: 'TCP 헤더', en: 'TCP header' },
  data: { c: 'var(--l-data)', ko: '데이터', en: 'Data' },
  pad: { c: 'var(--l-pad)', ko: '채움(패딩)', en: 'Padding' },
  fcs: { c: 'var(--l-fcs)', ko: 'FCS', en: 'FCS' }
};
const ROWS = [   // 위에서 아래로: 보낼 때는 위에서부터 한 겹씩 감싼다
  { k: 'data', ko: '애플리케이션', en: 'Application', unitKo: '데이터', unitEn: 'data' },
  { k: 'tcp', ko: '전송 (TCP)', en: 'Transport (TCP)', unitKo: '세그먼트', unitEn: 'segment' },
  { k: 'ip', ko: '인터넷 (IP)', en: 'Internet (IP)', unitKo: '패킷', unitEn: 'packet' },
  { k: 'eth', ko: '링크 (이더넷)', en: 'Link (Ethernet)', unitKo: '프레임', unitEn: 'frame' }
];
const CAP = {
  send: [
    { ko: '① 애플리케이션이 보낼 데이터를 만듭니다. TCP는 이것을 한 번에 MSS(= MTU − 40)바이트 이하로 잘라 조각마다 따로 포장합니다.', en: '① The application produces the data. TCP cuts it into pieces of at most MSS (= MTU − 40) bytes and wraps each piece separately.' },
    { ko: '② TCP가 앞에 20바이트 헤더를 붙입니다: 포트(어느 프로그램에게), 순서 번호(몇 번째 바이트부터), 체크섬. 이제 "세그먼트"입니다.', en: '② TCP prepends a 20-byte header: ports (which program), sequence number (from which byte) and a checksum. It is now a "segment".' },
    { ko: '③ IP가 앞에 20바이트 헤더를 붙입니다: 출발·도착 IP 주소와 TTL. 이제 "패킷"입니다. 라우터는 이 헤더만 보고 길을 찾습니다.', en: '③ IP prepends a 20-byte header: source and destination IP addresses and TTL. It is now a "packet". Routers read only this header to pick a path.' },
    { ko: '④ 이더넷이 앞에 14바이트 헤더(MAC 주소)를, 뒤에 4바이트 FCS(오류 검사)를 붙입니다. 이 "프레임"이 비로소 전기·빛 신호(비트)로 선에 실립니다.', en: '④ Ethernet prepends a 14-byte header (MAC addresses) and appends a 4-byte FCS (error check). This "frame" is finally sent on the wire as electrical or light signals.' }
  ],
  recv: [
    { ko: '① 마지막: TCP가 조각들을 순서 번호대로 이어 붙여 원래 데이터를 만들어 애플리케이션에 줍니다.', en: '① Last: TCP joins the pieces in sequence-number order and hands the original data to the application.' },
    { ko: '② TCP 체크섬을 확인하고, 목적지 포트로 "어느 소켓(프로그램)에게 줄지" 찾습니다. 순서가 뒤바뀌었으면 여기서 바로잡습니다.', en: '② TCP verifies its checksum and uses the destination port to find the right socket. Out-of-order pieces are put back in order here.' },
    { ko: '③ IP가 헤더 체크섬과 목적지 주소가 내 것인지 확인하고, Protocol 칸이 6이면 안쪽을 TCP로 넘깁니다.', en: '③ IP checks the header checksum and that the destination is its own; if Protocol is 6, the inside goes to TCP.' },
    { ko: '④ 프레임이 도착합니다. 이더넷이 FCS로 오류를 확인하고, 목적지 MAC이 내 것이면 14바이트 헤더와 FCS를 벗겨 IP에 올려 보냅니다.', en: '④ The frame arrives. Ethernet checks the FCS, and if the destination MAC is its own, strips the 14-byte header and the FCS and passes the rest up to IP.' }
  ]
};
const PRESETS = [
  { id: 'http', ko: 'HTTP 요청', en: 'HTTP request', text: 'GET /index.html HTTP/1.1\nHost: example.com\nConnection: close\n\n', crlf: true, mtu: 1500, dstPort: 80 },
  { id: 'short', ko: '짧은 글자 "Hi"', en: 'A short "Hi"', text: 'Hi', crlf: false, mtu: 1500, dstPort: 80 },
  { id: 'long', ko: '긴 데이터 (여러 조각)', en: 'Long data (several pieces)', text: 'Packets travel in pieces. '.repeat(24), crlf: false, mtu: 200, dstPort: 80 }
];

let step = 4, mode = 'send', sel = 0, cur = null, hl = null;

function inputs() {
  return { text: $('pkText').value, crlf: $('pkCrlf').checked, srcIp: $('pkSrcIp').value, dstIp: $('pkDstIp').value,
    srcPort: Math.min(65535, Math.max(1, +$('pkSrcPort').value || 1)), dstPort: Math.min(65535, Math.max(1, +$('pkDstPort').value || 1)), mtu: +$('pkMtu').value };
}

function stackHtml(p, dataLen) {
  const w = (n, min) => Math.max(min, Math.min(n, 90));
  const cell = (k, label, bytes, weight) => `<div class="st-cell" style="--c:${LAYER[k].c};--w:${weight}">${esc(label)}<small>${bytes} B</small></div>`;
  const D = cell('data', T('데이터', 'Data'), dataLen, w(dataLen, 20));
  const TCP = cell('tcp', 'TCP', 20, 20), IP = cell('ip', 'IP', 20, 20), ETH = cell('eth', 'Ethernet', 14, 14), FCS = cell('fcs', 'FCS', 4, 6);
  const bars = [D, TCP + D, IP + TCP + D, ETH + IP + TCP + D + (p.eth.pad ? cell('pad', T('채움', 'Pad'), p.eth.pad, 8) : '') + FCS];
  const sizes = [dataLen, dataLen + 20, dataLen + 40, p.frame.length];
  return ROWS.map((r, i) => `<div class="st-row${i + 1 > step ? ' off' : ''}"><div class="st-name"><b>${t({ ko: r.ko, en: r.en })}</b><span>${t({ ko: r.unitKo, en: r.unitEn })} · ${sizes[i]} B</span></div><div class="st-bar">${bars[i]}</div></div>`).join('');
}

function fieldTable(title, fields, base) {
  const rows = fields.map(f => {
    const a = base + f.off, b = a + f.len - 1;
    return `<tr tabindex="0" data-a="${a}" data-b="${b}"><td>${esc(f.name)}</td><td>${hexs(f.bytes)}</td><td>${esc(f.value)}</td><td>${esc(t(f.note))}</td></tr>`;
  }).join('');
  return `<div class="net-scroll"><table class="net-tab"><caption>${title}</caption><thead><tr><th>${T('필드', 'Field')}</th><th>${T('바이트 (16진수)', 'Bytes (hex)')}</th><th>${T('값', 'Value')}</th><th>${T('뜻', 'Meaning')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function hexHtml(p) {
  const rows = [];
  for (let o = 0; o < p.frame.length; o += 16) {
    const part = p.frame.slice(o, o + 16);
    const hx = part.map((b, i) => `<span class="${p.layer[o + i]}" data-i="${o + i}">${hex(b)}</span>`).join('');
    const as = part.map((b, i) => `<span class="${p.layer[o + i]}" data-i="${o + i}">${b >= 32 && b < 127 ? esc(String.fromCharCode(b)) : '·'}</span>`).join('');
    rows.push(`<div class="hexrow"><span class="off">${hex(o, 4)}</span><span class="hx">${hx}</span><span class="as">${as}</span></div>`);
  }
  return rows.join('');
}

function render() {
  const i = inputs(), msg = $('pkMsg');
  if (!parseIp(i.srcIp) || !parseIp(i.dstIp)) { msg.textContent = T('IP 주소는 0~255 숫자 네 개를 점으로 이어 적어 주세요 (예: 192.168.0.10).', 'Write the IP address as four numbers 0–255 separated by dots (e.g. 192.168.0.10).'); return; }
  const r = buildPackets(i);
  if (!r.packets.length) { msg.textContent = T('보낼 글자를 적어 주세요.', 'Type something to send.'); $('pkOut').hidden = true; return; }
  msg.textContent = ''; $('pkOut').hidden = false;
  cur = r; sel = Math.min(sel, r.packets.length - 1);
  const p = r.packets[sel], n = r.packets.length;
  $('pkMtuOut').textContent = i.mtu + ' B';
  $('pkSummary').innerHTML = T(
    `데이터 <b>${r.data.length} 바이트</b> · MTU <b>${i.mtu}</b> → MSS(= MTU − 40) <b>${r.mss}</b> 바이트 → TCP 세그먼트 <b>${n}개</b>`,
    `Data <b>${r.data.length} bytes</b> · MTU <b>${i.mtu}</b> → MSS (= MTU − 40) <b>${r.mss}</b> bytes → <b>${n}</b> TCP segment${n > 1 ? 's' : ''}`);
  $('pkSel').innerHTML = r.packets.map((k, j) => `<option value="${j}"${j === sel ? ' selected' : ''}>${T(`조각 ${j + 1} / ${n}`, `Piece ${j + 1} / ${n}`)} · seq ${k.seq} · ${k.payload.length} B</option>`).join('');
  $('pkPrevPiece').disabled = sel === 0; $('pkNextPiece').disabled = sel === n - 1;
  $('pkStack').innerHTML = stackHtml(p, p.payload.length);
  $('pkCap').textContent = t(CAP[mode][step - 1]);
  $('pkStepOut').textContent = mode === 'send' ? `${step} / 4` : `${5 - step} / 4`;
  $('pkPrev').disabled = mode === 'send' ? step <= 1 : step >= 4;
  $('pkNext').disabled = mode === 'send' ? step >= 4 : step <= 1;
  $('pkModeBtn').textContent = mode === 'send' ? T('받는 쪽에서 벗기기 ▶', 'Switch to receiving ▶') : T('◀ 보내는 쪽으로', '◀ Back to sending');
  const fcsHex = hexs(p.eth.fcs);
  $('pkFields').innerHTML =
    fieldTable(T('TCP 헤더 (20 바이트)', 'TCP header (20 bytes)'), p.tcp.fields, 34) +
    fieldTable(T('IP 헤더 (20 바이트)', 'IP header (20 bytes)'), p.ip.fields, 14) +
    fieldTable(T('이더넷 헤더 (14 바이트)', 'Ethernet header (14 bytes)'), p.eth.fields, 0) +
    `<div class="net-scroll"><table class="net-tab"><caption>${T('꼬리', 'Trailer')}</caption><tbody><tr tabindex="0" data-a="${p.frame.length - 4}" data-b="${p.frame.length - 1}"><td>FCS (CRC-32)</td><td>${fcsHex}</td><td>0x${hex(p.eth.crc, 8)}</td><td>${T('프레임 전체의 오류 검사. 낮은 바이트부터 보냄', 'Error check of the whole frame; low byte first')}</td></tr>${p.eth.pad ? `<tr tabindex="0" data-a="${54 + p.payload.length}" data-b="${54 + p.payload.length + p.eth.pad - 1}"><td>Padding</td><td>00 …</td><td>${p.eth.pad} B</td><td>${T('이더넷은 안쪽이 46바이트 미만이면 0으로 채움', 'Ethernet pads the inside with zeros up to 46 bytes')}</td></tr>` : ''}</tbody></table></div>`;
  $('pkOk').innerHTML = T(
    `받는 쪽 검증: IP 체크섬 ${p.ok.ip ? '✔' : '✘'} · TCP 체크섬 ${p.ok.tcp ? '✔' : '✘'} · FCS ${p.ok.fcs ? '✔' : '✘'} — 각 계층이 자기 몫의 계산을 다시 해서 보낸 값과 맞는지 봅니다.`,
    `Receiver check: IP checksum ${p.ok.ip ? '✔' : '✘'} · TCP checksum ${p.ok.tcp ? '✔' : '✘'} · FCS ${p.ok.fcs ? '✔' : '✘'} — each layer recomputes its own value and compares it with what was sent.`);
  $('pkHex').innerHTML = hexHtml(p);
  $('pkLegend').innerHTML = Object.entries(LAYER).filter(([k]) => k !== 'pad' || p.eth.pad).map(([k, v]) => `<span><i style="--c:${v.c}"></i>${t(v)}</span>`).join('');
}

function setHl(row) {
  for (const s of document.querySelectorAll('#pkHex .hl')) s.classList.remove('hl');
  if (!row) return;
  const a = +row.dataset.a, b = +row.dataset.b;
  for (let k = a; k <= b; k++) for (const s of document.querySelectorAll(`#pkHex [data-i="${k}"]`)) s.classList.add('hl');
}

function applyPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  $('pkText').value = p.text; $('pkCrlf').checked = p.crlf; $('pkMtu').value = p.mtu; $('pkDstPort').value = p.dstPort;
  for (const b of document.querySelectorAll('#pkPresets button')) b.setAttribute('aria-pressed', b.dataset.id === id);
  sel = 0; step = mode === 'send' ? 1 : 4; render();
}

function init() {
  $('pkPresets').innerHTML = PRESETS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="false">${t(p)}</button>`).join('');
  $('pkPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) applyPreset(b.dataset.id); });
  for (const id of ['pkText', 'pkCrlf', 'pkSrcIp', 'pkDstIp', 'pkSrcPort', 'pkDstPort', 'pkMtu']) $(id).addEventListener('input', () => { sel = 0; for (const b of document.querySelectorAll('#pkPresets button')) b.setAttribute('aria-pressed', 'false'); render(); });
  $('pkSel').addEventListener('change', e => { sel = +e.target.value; render(); });
  $('pkPrevPiece').addEventListener('click', () => { sel--; render(); });
  $('pkNextPiece').addEventListener('click', () => { sel++; render(); });
  $('pkNext').addEventListener('click', () => { step += mode === 'send' ? 1 : -1; render(); });
  $('pkPrev').addEventListener('click', () => { step -= mode === 'send' ? 1 : -1; render(); });
  $('pkModeBtn').addEventListener('click', () => { mode = mode === 'send' ? 'recv' : 'send'; step = mode === 'send' ? 1 : 4; render(); });
  $('pkReplay').addEventListener('click', () => { step = mode === 'send' ? 1 : 4; render(); });
  $('pkFields').addEventListener('mouseover', e => setHl(e.target.closest('tr[data-a]')));
  $('pkFields').addEventListener('mouseleave', () => setHl(null));
  $('pkFields').addEventListener('focusin', e => setHl(e.target.closest('tr[data-a]')));
  $('pkFields').addEventListener('focusout', () => setHl(null));
  document.addEventListener('langchange', () => { $('pkPresets').innerHTML = PRESETS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="false">${t(p)}</button>`).join(''); render(); });
  applyPreset('http'); step = 4;
  render();
}
init();
