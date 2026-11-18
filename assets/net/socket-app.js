// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 소켓 페이지: 서버와 클라이언트의 호출을 한 줄씩 실행하며 두 장비 커널의 fd 표 · 연결 대기열 · 수신 버퍼가 바뀌는 모습을 보여 준다
import { HOSTS, Runner, scenario } from './socket.js?v=4e868a9b';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const SCEN = [
  { id: 'echo', ko: '기본: 에코 서버', en: 'Basics: an echo server' },
  { id: 'two', ko: '클라이언트 둘이 한 포트로', en: 'Two clients, one port' },
  { id: 'errors', ko: '자주 만나는 오류', en: 'Common errors' }
];
const STATE = { CREATED: '생성됨', BOUND: '포트에 묶임', LISTEN: 'LISTEN', ESTABLISHED: 'ESTABLISHED' };
let id = 'echo', recv = 1024, k = 0, R;

const ep = (s) => (s ? `${s.ip}:${s.port}` : '—');
const build = (n) => { R = new Runner(scenario(id, { recv })); while (R.i < n && !R.done) R.next(); k = R.i; };

function rows() {
  const next = R.steps[R.i];
  return R.steps.map((st, i) => {
    const o = R.out[i], cls = o ? 'done' : st === next ? 'next' : 'todo';
    const side = (s) => (st.side === s ? `<div class="sk-cell sk-${s}"><code>${esc(st.code)}</code>${o ? `<small class="sk-res${o.error ? ' bad' : o.blocked ? ' wait' : ''}">${o.error ? '✕ ' + o.error + ' — ' : o.blocked ? '⏳ ' : o.woke ? '⏰ ' : '→ '}${esc(t(o))}</small>` : ''}</div>` : '<div class="sk-cell sk-empty"></div>');
    return `<div class="sk-row ${cls}"><span class="sk-n">${i + 1}</span>${side('S')}${side('A')}</div>`;
  }).join('');
}

function kernel(h) {
  const snap = R.net.snapshot(h);
  const body = snap.length ? snap.map(s => `<tr><td>${s.fd}</td><td>${STATE[s.state] ? T(STATE[s.state], s.state) : s.state}${s.state === 'LISTEN' ? `<small>${T('대기열', 'queue')} ${s.queue}/${s.backlog}${s.waiting ? T(' · accept() 대기 중', ' · blocked in accept()') : ''}</small>` : ''}</td><td>${ep(s.local)}</td><td>${ep(s.remote)}</td><td>${s.rbuf ? `<code>${esc(JSON.stringify(s.rbuf))}</code> (${s.rbuf.length} B)` : s.eof ? 'EOF' : ''}</td></tr>`).join('')
    : `<tr><td colspan="5" class="meta">${T('열린 소켓 없음', 'no open sockets')}</td></tr>`;
  return `<div class="panel"><h4>${t(HOSTS[h])} · ${HOSTS[h].ip}</h4><div class="net-scroll"><table class="net-tab"><thead><tr><th>fd</th><th>${T('상태', 'State')}</th><th>${T('내 쪽 주소', 'Local')}</th><th>${T('상대 주소', 'Remote')}</th><th>${T('수신 버퍼', 'Recv buffer')}</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

function render() {
  $('skRows').innerHTML = rows();
  $('skKernel').innerHTML = kernel('S') + kernel('A');
  $('skWire').innerHTML = R.net.wire.length ? R.net.wire.map(w => `<li><b>${w.from === 'S' ? T('서버', 'Server') : T('클라이언트', 'Client')} → ${w.to === 'S' ? T('서버', 'Server') : T('클라이언트', 'Client')}</b> ${esc(w.text)}${w.detail ? ` <small>${esc(w.detail.split(' / ')[T(0, 1)] || w.detail)}</small>` : ''}</li>`).join('') : `<li class="meta">${T('아직 오간 것 없음', 'Nothing on the wire yet')}</li>`;
  $('skNext').disabled = R.done; $('skAll').disabled = R.done; $('skPrev').disabled = R.i === 0;
  $('skStep').textContent = `${R.i} / ${R.steps.length}`;
  $('skRecvOut').textContent = recv + ' B';
  $('skRecvBox').hidden = id !== 'echo';
  $('skScen').innerHTML = SCEN.map(s => `<button type="button" data-id="${s.id}" aria-pressed="${s.id === id}">${t(s)}</button>`).join('');
  const nx = R.steps[R.i];
  $('skNote').textContent = nx ? T('다음 호출: ', 'Next call: ') + nx.code : T('끝났습니다. 처음부터 다시 보거나 다른 시나리오를 골라 보세요.', 'Done. Start over or pick another scenario.');
}

function init() {
  $('skScen').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { id = b.dataset.id; build(0); render(); } });
  $('skNext').addEventListener('click', () => { R.next(); k = R.i; render(); });
  $('skPrev').addEventListener('click', () => { build(Math.max(0, R.i - 1)); render(); });
  $('skReset').addEventListener('click', () => { build(0); render(); });
  $('skAll').addEventListener('click', () => { while (!R.done) R.next(); render(); });
  $('skRecv').addEventListener('input', () => { recv = +$('skRecv').value; build(R.i); render(); });
  document.addEventListener('langchange', render);
  build(0); render();
}
init();
