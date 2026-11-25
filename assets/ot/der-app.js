// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// DER · VPP 통신 페이지: 수요반응 하루의 메시지 순서도와 현장 전력 그래프 (계산은 der.js)
import { ACTORS, PROTO, EVENT, messages, series } from './der.js?v=d5470553';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const PCOL = { openadr: '#c2549d', '2030.5': '#2a78d6', ocpp: '#e8912d', modbus: '#1f9d6b' };
let O = { evseOffline: false, lowSoc: false }, sel = 0, showAll = false, L = [];
const clock = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}${s % 60 ? ':' + String(s % 60).padStart(2, '0') : ''}`;

function seq() {
  L = messages(O).filter(m => showAll || !m.quiet);
  sel = Math.min(sel, L.length - 1);
  const W = 760, top = 44, RH = 30, colW = (W - 70) / ACTORS.length, cx = (id) => 70 + colW * (ACTORS.findIndex(a => a.id === id) + 0.5), H = top + L.length * RH + 10;
  const o = [`<svg class="dn-svg de-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('메시지 순서도', 'Message sequence diagram'))}"><defs>${Object.entries(PCOL).map(([k, c]) => `<marker id="deA${k.replace('.', '')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')}</defs>`];
  ACTORS.forEach(a => {
    const x = cx(a.id);
    o.push(`<line x1="${x}" y1="${top - 6}" x2="${x}" y2="${H - 4}" class="de-life"/><foreignObject x="${x - colW / 2 + 2}" y="0" width="${colW - 4}" height="40"><div xmlns="http://www.w3.org/1999/xhtml" class="de-actor">${esc(t(a))}</div></foreignObject>`);
  });
  L.forEach((m, i) => {
    const y = top + i * RH + 16, x1 = cx(m.from), x2 = cx(m.to), dir = x2 > x1 ? 1 : -1;
    o.push(`<g class="de-row${i === sel ? ' on' : ''}" data-i="${i}" tabindex="0"><rect x="0" y="${y - 15}" width="${W}" height="${RH}" class="de-hit"/><text x="4" y="${y + 4}" class="de-t">${clock(m.t)}</text>
      <line x1="${x1 + dir * 4}" y1="${y}" x2="${x2 - dir * 6}" y2="${y}" stroke="${PCOL[m.proto]}" stroke-width="2"${m.lost ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#deA${m.proto.replace('.', '')})"/>
      <text x="${(x1 + x2) / 2}" y="${y - 5}" text-anchor="middle" class="de-n">${esc(m.name)}${m.lost ? ' ✕' : ''}</text></g>`);
  });
  o.push('</svg>');
  $('deSeq').innerHTML = o.join('');
  detail();
}
function detail() {
  const m = L[sel], p = PROTO[m.proto];
  $('deMsg').innerHTML = `<p class="os-now"><b>${clock(m.t)}</b> · ${esc(t(ACTORS.find(a => a.id === m.from)))} → ${esc(t(ACTORS.find(a => a.id === m.to)))}</p>
    <p><span class="de-pr" style="--c:${PCOL[m.proto]}">${p.name}</span> <b>${esc(m.name)}</b>${m.lost ? ` <span class="dn-bad">${T('전달 안 됨', 'not delivered')}</span>` : ''}</p><p>${esc(t(m))}</p>
    <pre class="cn-code de-body"><code>${esc(m.body)}</code></pre>`;
  for (const g of document.querySelectorAll('.de-row')) g.classList.toggle('on', +g.dataset.i === sel);
}

function chart() {
  const { rows, perf } = series(O), W = 760, H = 260, L0 = 42, B = 26, top = 12, x0 = rows[0].m, x1 = rows[rows.length - 1].m;
  const ymax = Math.ceil(Math.max(...rows.map(r => r.base)) / 50) * 50;
  const sx = (m) => L0 + (m - x0) / (x1 - x0) * (W - L0 - 10), sy = (v) => H - B - v / ymax * (H - B - top);
  const line = (f, cls) => `<polyline class="${cls}" points="${rows.filter(r => f(r) !== null).map(r => `${sx(r.m).toFixed(1)},${sy(f(r)).toFixed(1)}`).join(' ')}"/>`;
  const o = [`<svg class="dn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('현장 전력 그래프', 'Site power chart'))}">`,
    `<rect x="${sx(EVENT.start)}" y="${top}" width="${sx(EVENT.end) - sx(EVENT.start)}" height="${H - B - top}" class="de-ev"/><text x="${(sx(EVENT.start) + sx(EVENT.end)) / 2}" y="${top + 12}" text-anchor="middle" class="de-evl">${esc(T('수요반응 이벤트', 'DR event'))}</text>`];
  for (let v = 0; v <= ymax; v += 100) o.push(`<line x1="${L0}" x2="${W - 10}" y1="${sy(v)}" y2="${sy(v)}" class="gx"/><text x="${L0 - 4}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`);
  for (let m = x0; m <= x1 + 1; m += 30) o.push(`<text x="${sx(m)}" y="${H - 8}" text-anchor="middle">${clock(m * 60)}</text>`);
  o.push(`<text x="4" y="10">kW</text>`, line(r => r.base, 'de-base'), line(r => r.target, 'de-target'), line(r => r.ev, 'de-evl2'), line(r => r.ess, 'de-ess'), line(r => r.pv, 'de-pv'), line(r => r.grid, 'de-grid'), '</svg>');
  $('deChart').innerHTML = o.join('') + `<div class="lg"><span><i class="de-k-grid"></i>${T('계통에서 받는 전력', 'Grid import')}</span><span><i class="de-k-base"></i>${T('평소대로였다면 (기준선)', 'Business as usual (baseline)')}</span><span><i class="de-k-target"></i>${T('목표 (기준선 − 150 kW)', 'Target (baseline − 150 kW)')}</span><span><i class="de-k-ev"></i>${T('전기차 충전', 'EV charging')}</span><span><i class="de-k-ess"></i>${T('ESS 방전', 'Battery discharge')}</span><span><i class="de-k-pv"></i>${T('태양광', 'PV')}</span></div>`;
  $('dePerf').innerHTML = `<dl class="vm-dl"><dt>${T('평균 감축량', 'Average reduction')}</dt><dd>${perf.avgShed.toFixed(0)} kW / ${EVENT.shed} kW</dd><dt>${T('이행률', 'Delivery')}</dt><dd class="${perf.pct >= 0.95 ? 'gs-ok' : 'dn-bad'}">${Math.round(perf.pct * 100)}%</dd><dt>${T('가장 적게 줄인 1분', 'Worst minute')}</dt><dd>${perf.minShed.toFixed(0)} kW</dd><dt>${T('ESS가 낸 에너지', 'Energy from the battery')}</dt><dd>${perf.essKwh.toFixed(0)} kWh</dd></dl>`;
}

function render() { seq(); chart(); }
function init() {
  $('deSeq').addEventListener('click', e => { const g = e.target.closest('.de-row'); if (g) { sel = +g.dataset.i; detail(); } });
  $('deSeq').addEventListener('keydown', e => { const g = e.target.closest('.de-row'); if (g && e.key === 'Enter') { sel = +g.dataset.i; detail(); } });
  $('deEvse').addEventListener('input', () => { O.evseOffline = $('deEvse').checked; render(); });
  $('deSoc').addEventListener('input', () => { O.lowSoc = $('deSoc').checked; render(); });
  $('deAll').addEventListener('input', () => { showAll = $('deAll').checked; seq(); });
  document.addEventListener('langchange', render);
  render();
}
init();
