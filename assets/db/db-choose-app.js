// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 정리 페이지: 네 가지 질문 → 일곱 접근 방식의 점수와 이유, 비교표, 한 줄 요약 (규칙은 choose.js)
import { LAYERS, QUESTIONS, recommend, MATRIX } from './choose.js?v=6ecf28d7';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const answers = { caller: 'browser', shape: 'flexible', priority: 'speed', scale: 'small' };
const L = Object.fromEntries(LAYERS.map(l => [l.id, l]));

function questions() {
  $('cQs').innerHTML = QUESTIONS.map(q => `<label>${t(q)}<select data-q="${q.id}">${q.options.map(o => `<option value="${o.id}" ${answers[q.id] === o.id ? 'selected' : ''}>${esc(t(o))}</option>`).join('')}</select></label>`).join('');
}
function result() {
  const rows = recommend(answers), top = rows.find(r => !r.blocked);
  const max = Math.max(1, ...rows.map(r => Math.abs(r.score)));
  $('cOut').innerHTML = rows.map(r => {
    const l = L[r.id], w = Math.max(2, Math.abs(r.score) / max * 100);
    const reasons = r.reasons.slice().sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 3).map(x => `<li class="${x.pts < 0 ? 'neg' : 'pos'}"><b>${x.pts > 0 ? '+' : ''}${x.pts}</b> ${t(x)}</li>`).join('');
    return `<div class="ch-row ${r.blocked ? 'blocked' : ''} ${top && top.id === r.id ? 'top' : ''}"><div class="ch-head"><a href="${l.page}"><b>${t(l)}</b></a>${top && top.id === r.id ? `<span class="db-tag ok">${T('가장 잘 맞음', 'Best fit')}</span>` : ''}${r.blocked ? `<span class="db-tag bad">${T('쓰면 안 됨', 'Do not use')}</span>` : ''}</div>` +
      `<div class="cmp-bar"><i class="${r.score < 0 ? 'h10' : 'h3'}" style="width:${w}%"></i><b>${r.score > 0 ? '+' : ''}${r.score}</b></div>` +
      (r.blocked ? `<p class="ch-block">⛔ ${t(r.blocked)}</p>` : '') + `<ul class="ch-why">${reasons}</ul></div>`;
  }).join('');
}
function matrix() {
  const C = [['resilience', '변화에 강함', 'Resilience', '--db-c'], ['security', '보안 경계', 'Security', '--db-a'], ['speed', '속도', 'Speed', '--db-b'], ['ease', '만들기 쉬움', 'Ease', '--db-d'], ['freedom', '질문의 자유', 'Freedom', '--db-e']];
  $('cMatrix').innerHTML = `<thead><tr><th>${T('방식', 'Approach')}</th>${C.map(c => `<th>${T(c[1], c[2])}</th>`).join('')}</tr></thead><tbody>` +
    MATRIX.map(m => `<tr><td><a href="${L[m.id].page}">${t(L[m.id])}</a></td>${C.map(c => `<td><span class="dots" style="--c:var(${c[3]})" aria-label="${m[c[0]]}/5">${'●'.repeat(m[c[0]])}<span class="off">${'●'.repeat(5 - m[c[0]])}</span></span></td>`).join('')}</tr>`).join('') + '</tbody>';
}
function recap() {
  const R = [
    ['db-modern.html#agent', 'AI 에이전트 · 자동 생성 API', 'AI agents and auto-generated APIs', '도구가 API를 만들고, 에이전트는 점검된 좁은 도구로만 접근', 'Tools generate the API; agents reach data only through narrow checked tools'],
    ['db-graphql.html', 'GraphQL', 'GraphQL', '클라이언트가 응답의 모양을 정함 · 리졸버의 N+1 주의', 'The client decides the response shape; beware resolver N+1'],
    ['db-service.html', '서비스 계층 (REST)', 'Service layer (REST)', 'DB 계정은 서비스만 · 인증 · 권한 · 검증은 서비스의 일', 'Only the service holds the account; authN, authZ and validation are its job'],
    ['db-orm.html', '쿼리 빌더 · ORM', 'Query builder / ORM', 'SQL을 코드로 · 편한 만큼 보이지 않는 질의(N+1)', 'SQL as code; as comfortable as it is invisible (N+1)'],
    ['db-driver.html', '드라이버 · 표준 API', 'Drivers and standard APIs', 'SQL 글자 + 값 따로(바인딩) · 트랜잭션 경계', 'SQL text + values apart (binding); transaction boundaries'],
    ['db-wire.html', '와이어 프로토콜', 'Wire protocol', '소켓 위의 길이 붙은 메시지 · 연결은 비싸니 풀', 'Length-prefixed messages on a socket; connections are costly, so pool'],
    ['db-file.html', '파일 · 임베디드', 'Files and embedded', '페이지 · 인덱스 · WAL · 쓰는 쪽은 하나', 'Pages, indexes, WAL; one writer']
  ];
  $('recapList').innerHTML = R.map(r => `<li><a href="${r[0]}"><b>${T(r[1], r[2])}</b><small>${T(r[3], r[4])}</small></a></li>`).join('');
}
$('cQs').addEventListener('change', e => { const s = e.target.closest('select'); if (s) { answers[s.dataset.q] = s.value; result(); } });
function render() { questions(); result(); matrix(); recap(); }
document.addEventListener('langchange', render);
render();
