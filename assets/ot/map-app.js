// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 산업·전력 통신 개요 페이지: 퍼듀 모델 층 그림과 규약 비교표. 규약을 고르면 쓰이는 층이, 층을 고르면 그 층의 규약이 강조된다 (데이터는 protocols.js)
import { LEVELS, PROTOCOLS, STYLE, TIME, SEC, atLevel } from './protocols.js?v=78a5b933';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

let selP = 'dnp3', selL = null;
function render() {
  const p = PROTOCOLS.find(x => x.id === selP), onL = selL !== null ? [selL] : p ? p.levels : [];
  const onP = selL !== null ? atLevel(selL).map(x => x.id) : [selP];
  $('omLevels').innerHTML = LEVELS.map(l => `<button type="button" class="om-l${onL.includes(l.n) ? ' on' : ''}${l.n === 3.5 ? ' dmz' : ''}" data-l="${l.n}"><b>${esc(t(l))}</b><small>${esc(t(l.ex))}</small><span class="om-chips">${atLevel(l.n).map(x => `<i class="${onP.includes(x.id) ? 'on' : ''}">${esc(x.name.split(' (')[0].split(' / ')[0])}</i>`).join('')}</span></button>`).join('');
  $('omInfo').innerHTML = selL !== null
    ? `<h4>${esc(t(LEVELS.find(l => l.n === selL)))}</h4><p>${esc(t(LEVELS.find(l => l.n === selL).ex))}</p><p>${selL === 3.5 ? T('규약이 그대로 지나가지 않는 경계입니다. 아래 층의 데이터는 중계 서버에 복사되고, 위에서 아래로의 연결은 막거나 엄격히 제한합니다.', 'A boundary no protocol passes straight through. Data from below is copied to relay servers, and connections from above are blocked or tightly restricted.') : T(`이 층에서 쓰는 규약 ${atLevel(selL).length}개가 표에 강조되었습니다.`, `${atLevel(selL).length} protocols used at this level are highlighted in the table.`)}</p>`
    : `<h4>${esc(p.name)}</h4><p>${esc(t(p))}</p><dl class="td-dl"><dt>${T('처음 나온 해 (대략)', 'First published (approx.)')}</dt><dd>${p.year}</dd><dt>${T('전송', 'Transport')}</dt><dd>${esc(p.transport)}</dd><dt>${T('주고받는 방식', 'Interaction')}</dt><dd>${esc(t(STYLE[p.style]))}</dd><dt>${T('시간 규모', 'Time scale')}</dt><dd>${esc(t(TIME[p.time]))}</dd><dt>${T('보안', 'Security')}</dt><dd>${esc(t(SEC[p.security]))}</dd></dl>${p.page ? `<p><a href="${p.page}">${T('자세히 보기 →', 'Read more →')}</a></p>` : ''}`;
  $('omTable').innerHTML = `<table class="net-tab cn-tab"><thead><tr><th>${T('규약', 'Protocol')}</th><th>${T('연도', 'Year')}</th><th>${T('층', 'Levels')}</th><th>${T('전송', 'Transport')}</th><th>${T('방식', 'Interaction')}</th><th>${T('시간 규모', 'Time scale')}</th><th>${T('보안', 'Security')}</th></tr></thead><tbody>${PROTOCOLS.map(x => `<tr tabindex="0" data-p="${x.id}" class="${onP.includes(x.id) ? 'sel' : ''}"><td>${x.page ? `<a href="${x.page}">${esc(x.name)}</a>` : esc(x.name)}</td><td>${x.year}</td><td>${x.levels.join(' · ')}</td><td>${esc(x.transport)}</td><td>${esc(t(STYLE[x.style]))}</td><td>${esc(t(TIME[x.time]))}</td><td class="${x.security === 'none' ? 'dn-bad' : ''}">${esc(t(SEC[x.security]))}</td></tr>`).join('')}</tbody></table>`;
}
function init() {
  $('omLevels').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (!b) return; const n = +b.dataset.l; selL = selL === n ? null : n; render(); });
  const pick = (e) => { if (e.target.closest('a')) return; const tr = e.target.closest('tr[data-p]'); if (!tr) return; selP = tr.dataset.p; selL = null; render(); };
  $('omTable').addEventListener('click', pick); $('omTable').addEventListener('keydown', e => { if (e.key === 'Enter') pick(e); });
  document.addEventListener('langchange', render);
  render();
}
init();
