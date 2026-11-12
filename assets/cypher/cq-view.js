// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 역량 질문(Cypher) 목록 그리기: 질문마다 접었다 펴는 칸 안에 질의문과 결과 표
// 전기차 충전 · 설비 고장 영향 · 자산관리셸 페이지가 함께 쓴다. 모양은 assets/site.css 의 .cq-list
//
//   renderCq(el, list, { open, count, empty })
//     list   [{ q, en, cypher, rows, columns? }]  빌드 스크립트가 만든 데이터의 cq (columns 가 있으면 머리줄을 그림)
//     open   처음에 펴 둘 질문의 순서 (0부터)
//     count  제목 옆에 결과 행 수를 적을지
//     empty  결과가 없을 때 표에 적을 글. 없으면 빈 표
import { esc, T } from '../lib/dom.js?v=3b73d59c';

export function renderCq(el, list, { open = 0, count = true, empty = null } = {}) {
  el.classList.add('cq-list');
  el.innerHTML = list.map((c, i) => {
    const n = count ? ` <small class="muted">(${c.rows.length}${T('행', ' rows')})</small>` : '';
    const head = c.columns ? `<thead><tr>${c.columns.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead>` : '';
    const rows = c.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') ||
      (empty ? `<tr><td${c.columns ? ` colspan="${c.columns.length}"` : ''}>${esc(empty)}</td></tr>` : '');
    return `<details${i === open ? ' open' : ''}><summary><b>Q${i + 1}.</b> ${esc(T(c.q, c.en))}${n}</summary>
      <pre><code class="language-cypher">${esc(c.cypher)}</code></pre>
      <div class="tbl"><table>${head}<tbody>${rows}</tbody></table></div></details>`;
  }).join('');
}
