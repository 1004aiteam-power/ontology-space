// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// IEC 61850 페이지: 데이터 모델 트리(객체 참조 · MMS 이름 · CIM 대응)와 GOOSE 트립 시간축 (계산은 iec61850.js)
import { IED, FCS, ref, mms, goose } from './iec61850.js?v=1fd39ed6';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const LNG = { P: { ko: 'P = 보호 (Protection)', en: 'P = protection' }, X: { ko: 'X = 개폐 장치 (switchgear)', en: 'X = switchgear' }, C: { ko: 'C = 제어 (Control)', en: 'C = control' }, M: { ko: 'M = 계측 (Metering)', en: 'M = metering and measurement' } };
let sel = { ld: 'CTRL', ln: 'XCBR1', dO: 'Pos', da: 'stVal' };

function tree() {
  const o = [`<ul class="td-tree"><li><b>${IED.name}</b> <small>${esc(t(IED))} · IED</small><ul>`];
  for (const l of IED.lds) {
    o.push(`<li><b>${l.inst}</b> <small>${esc(t(l))} · ${T('논리 장치', 'logical device')}</small><ul>`);
    for (const n of l.lns) {
      o.push(`<li><b class="td-ln">${n.ln}</b> <small>${esc(t(n))}</small><ul>`);
      for (const d of n.dos) o.push(`<li><span class="td-do">${d.name}</span> <small>${esc(t(d))}</small> ${d.das.map(a => `<button type="button" class="td-da${sel.ld === l.inst && sel.ln === n.ln && sel.dO === d.name && sel.da === a.name ? ' on' : ''}" data-k="${l.inst}|${n.ln}|${d.name}|${a.name}">.${a.name} <i>[${a.fc}]</i></button>`).join(' ')}</li>`);
      o.push('</ul></li>');
    }
    o.push('</ul></li>');
  }
  $('tdTree').innerHTML = o.join('') + '</ul></li></ul>';
}
function detail() {
  const l = IED.lds.find(x => x.inst === sel.ld), n = l.lns.find(x => x.ln === sel.ln), d = n.dos.find(x => x.name === sel.dO), a = d.das.find(x => x.name === sel.da);
  const r = ref(sel.ld, sel.ln, sel.dO, sel.da), m = mms(sel.ld, sel.ln, sel.dO, sel.da, a.fc);
  const parts = [[IED.name, 'IED'], [sel.ld, T('논리 장치', 'logical device')], [sel.ln, T('논리 노드', 'logical node')], [sel.dO, T('데이터 객체', 'data object')], [sel.da, T('데이터 속성', 'data attribute')]];
  $('tdDetail').innerHTML = `<h4>${T('객체 참조', 'Object reference')}</h4><p class="td-ref">${parts.map(([v, k], i) => `<span class="td-p p${i}" title="${esc(k)}">${esc(v)}</span>${i === 1 ? '<b>/</b>' : i > 1 && i < 4 ? '<b>.</b>' : ''}`).join('')}</p>
    <p class="lg">${parts.map(([, k], i) => `<span><i class="td-sw p${i}"></i>${esc(k)}</span>`).join('')}</p>
    <dl class="td-dl"><dt>${T('전체 이름', 'Full reference')}</dt><dd><code>${esc(r)}</code></dd>
    <dt>${T('MMS로 읽을 때 이름', 'Name when read via MMS')}</dt><dd><code>${esc(m)}</code></dd>
    <dt>${T('기능 제약 (FC)', 'Functional constraint (FC)')}</dt><dd>${a.fc} = ${esc(t(FCS[a.fc]))}</dd>
    <dt>${T('형식', 'Type')}</dt><dd>${a.type}</dd>
    <dt>${T('뜻', 'Meaning')}</dt><dd>${esc(t(a))}${a.val !== null ? ` · ${T('지금 값', 'current value')} <b>${a.val}</b>` : ''}</dd>
    <dt>${T('논리 노드 종류', 'Logical node class')}</dt><dd>${n.cls} · ${esc(t(LNG[n.cls[0]]))}</dd>
    <dt>${T('CIM에서는', 'In CIM')}</dt><dd>${a.cim ? `<code>${esc(a.cim)}</code>` : n.cim ? `<code>${esc(n.cim)}</code> ${T('(노드 전체)', '(the node as a whole)')}` : `<span class="meta">${T('대응하는 설비 클래스 없음 (기능 · 신호)', 'no equipment class (a function or signal)')}</span>`}</dd></dl>`;
}

// ---- GOOSE ----
let G = { loss: 0, delay: 0, tmin: 2, cut: false, seed: 1 };
function gooseView() {
  const r = goose(G), show = Math.max(140, (r.tOpen ?? r.tOp) + 30), W = 760, L = 130, H = 170;
  const sx = (ms) => L + (ms + 20) / (show + 20) * (W - L - 12);
  const step = [10, 20, 50, 100].find(s => show / s <= 10);
  const o = [`<svg class="dn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('GOOSE 트립 시간축', 'GOOSE trip timeline'))}">`];
  for (let x = 0; x <= show; x += step) o.push(`<line x1="${sx(x)}" y1="12" x2="${sx(x)}" y2="${H - 6}" class="gx"/><text x="${sx(x)}" y="9" text-anchor="middle">${x} ms</text>`);
  const rows = [[T('보호 IED (PTOC)', 'Protection IED (PTOC)'), 30], [T('네트워크: GOOSE', 'Network: GOOSE'), 70], [T('차단기 IED (XCBR)', 'Breaker IED (XCBR)'), 110], [T('비교: 구리선 배선', 'Compare: hard wiring'), 148]];
  for (const [lab, y] of rows) o.push(`<text x="4" y="${y + 4}" class="rl">${esc(lab)}</text><line x1="${L}" y1="${y}" x2="${W - 10}" y2="${y}" class="dn-ax"/>`);
  const mark = (x, y, cls, lab, up = true) => { if (x === null || x > show) return; o.push(`<circle cx="${sx(x).toFixed(1)}" cy="${y}" r="5" class="gs-${cls}"/><text x="${sx(x).toFixed(1)}" y="${up ? y - 9 : y + 17}" text-anchor="middle" class="gs-l">${esc(lab)}</text>`); };
  mark(0, 30, 'f', T('고장', 'fault')); mark(r.tOp - G.delay, 30, 's', T('기동', 'pickup'), false); mark(r.tOp, 30, 'o', T('트립', 'trip'));
  for (const m of r.msgs) if (m.t >= -20 && m.t <= show) o.push(m.lost ? `<text x="${sx(m.t).toFixed(1)}" y="75" text-anchor="middle" class="dn-x">✕</text>` : `<line x1="${sx(m.t).toFixed(1)}" x2="${sx(m.t).toFixed(1)}" y1="62" y2="78" class="gs-m${m.st === r.st ? ' new' : ''}"/>`);
  mark(r.tRx, 110, 'o', T('받음', 'received')); mark(r.tOpen, 110, 'k', T('차단기 열림', 'contacts open'), false);
  mark(r.wire.tRx, 148, 'o', T('접점 신호', 'contact signal')); mark(r.wire.tOpen, 148, 'k', T('열림', 'open'), false);
  o.push('</svg>');
  $('gsTl').innerHTML = o.join('');
  const ok = r.transfer !== null && r.transfer <= 3;
  $('gsRes').innerHTML = `<dl class="vm-dl"><dt>${T('트립 신호 전달 시간', 'Trip transfer time')}</dt><dd class="${ok ? 'gs-ok' : 'dn-bad'}">${r.transfer === null ? T('전달 안 됨', 'not delivered') : r.transfer + ' ms'} ${ok ? T('(기준 3 ms 이내)', '(within the 3 ms requirement)') : T('(기준 3 ms 넘음)', '(exceeds the 3 ms requirement)')}</dd>
    <dt>${T('차단기가 열린 시각', 'Breaker open at')}</dt><dd>${r.tOpen === null ? '—' : r.tOpen.toFixed(1) + ' ms'}</dd>
    <dt>${T('구리선이었다면', 'With hard wiring')}</dt><dd>${r.wire.tOpen.toFixed(1)} ms</dd>
    <dt>${T('수신 감시 경보', 'Subscriber supervision alarm')}</dt><dd class="${r.alarm !== null ? 'dn-bad' : ''}">${r.alarm === null ? T('없음', 'none') : T(`${r.alarm} ms에 "GOOSE 끊김" 경보`, `"GOOSE lost" alarm at ${r.alarm} ms`)}</dd></dl>`;
  $('gsMsgs').innerHTML = `<table class="net-tab mb-regs"><thead><tr><th>${T('보낸 시각', 'Sent at')}</th><th>stNum</th><th>sqNum</th><th>${T('트립 값', 'Trip value')}</th><th>${T('유효 시간 (TAL)', 'Time allowed to live')}</th><th></th></tr></thead><tbody>${r.msgs.map(m => `<tr class="${m.st === r.st && m.sq === 0 ? 'hit' : ''}"><td>${m.t} ms</td><td>${m.st}</td><td>${m.sq}</td><td>${m.val}</td><td>${m.ttl} ms</td><td>${m.lost ? `<span class="dn-bad">${T('손실', 'lost')}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  $('gsLossOut').textContent = Math.round(G.loss * 100) + '%'; $('gsDelayOut').textContent = G.delay + ' ms'; $('gsTminOut').textContent = G.tmin + ' ms';
}

function render() { tree(); detail(); gooseView(); }
function init() {
  $('tdTree').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; const [ld, ln, dO, da] = b.dataset.k.split('|'); sel = { ld, ln, dO, da }; tree(); detail(); });
  $('gsLoss').addEventListener('input', () => { G.loss = +$('gsLoss').value / 100; gooseView(); });
  $('gsDelay').addEventListener('input', () => { G.delay = +$('gsDelay').value; gooseView(); });
  $('gsTmin').addEventListener('input', () => { G.tmin = +$('gsTmin').value; gooseView(); });
  $('gsCut').addEventListener('input', () => { G.cut = $('gsCut').checked; gooseView(); });
  $('gsSeed').addEventListener('click', () => { G.seed = G.seed % 999 + 1; gooseView(); });
  document.addEventListener('langchange', render);
  render();
}
init();
