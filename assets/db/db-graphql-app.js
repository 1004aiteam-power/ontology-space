// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// GraphQL 페이지: 질의를 실행해 결과 · 리졸버가 DB에 보낸 SQL · REST로 받을 때의 호출 수를 비교한다 (계산은 gql.js)
import { safeExecute, restEquivalent } from './gql.js?v=682c9e07';
import { $, T, t } from '../lib/dom.js?v=3b73d59c';
import { sqlHtml } from './ui.js?v=2ed6a6af';

const PRESETS = [
  { ko: '변전소와 설비 (중첩)', en: 'Substations with assets (nested)', q: '{\n  substations {\n    name\n    assets {\n      name\n      health\n    }\n  }\n}' },
  { ko: '설비 → 소속 변전소', en: 'Assets → their substation', q: '{\n  assets(type: "breaker", minHealth: 70) {\n    name\n    health\n    substation {\n      name\n    }\n  }\n}' },
  { ko: '하나만 골라서', en: 'Pick just one', q: '{\n  substation(id: "S1") {\n    name\n    region\n  }\n}' },
  { ko: '잘못된 질의', en: 'Invalid query', q: '{\n  assets {\n    name\n    voltage\n  }\n}' }
];
const bytes = (o) => JSON.stringify(o).length;

function run() {
  const q = $('gQ').value, loader = $('gLoader').checked;
  const r = safeExecute(q, { loader });
  if (r.error) {
    $('gOut').textContent = JSON.stringify({ errors: [{ message: r.error }] }, null, 2);
    $('gSqlTitle').textContent = T('DB에 보낸 SQL', 'SQL sent to the DB');
    $('gSql').textContent = T('-- 실행 전에 거절됨 (스키마에 맞지 않음)', '-- rejected before execution (does not fit the schema)');
    $('gRestTitle').textContent = 'REST'; $('gRest').textContent = ''; $('gBars').innerHTML = ''; $('gNote').textContent = '';
    return;
  }
  $('gOut').textContent = JSON.stringify({ data: r.data }, null, 2);
  $('gSqlTitle').innerHTML = T(`서버가 DB에 보낸 SQL: <b>${r.count}번</b>`, `SQL the server sent to the DB: <b>${r.count}</b> queries`);
  $('gSql').innerHTML = r.queries.map(sqlHtml).join('\n');
  const rest = restEquivalent(q);
  $('gRestTitle').innerHTML = T(`같은 정보를 REST로: <b>${rest.calls.length}번</b> 호출`, `Same information via REST: <b>${rest.calls.length}</b> calls`);
  $('gRest').textContent = rest.calls.join('\n');
  const gb = bytes({ data: r.data }), rb = rest.bytes, mx = Math.max(gb, rb);
  $('gBars').innerHTML = `<div class="cmp-row"><div class="cmp-name">${T('GraphQL: 1번 요청, 고른 필드만', 'GraphQL: 1 request, chosen fields only')}</div><div class="cmp-bar"><i class="h3" style="width:${Math.max(2, gb / mx * 100)}%"></i><b>${gb} ${T('글자', 'chars')}</b></div></div>` +
    `<div class="cmp-row"><div class="cmp-name">${T(`REST: ${rest.calls.length}번 요청, 객체마다 전체 필드`, `REST: ${rest.calls.length} requests, every field of each object`)}</div><div class="cmp-bar"><i class="h10" style="width:${Math.max(2, rb / mx * 100)}%"></i><b>${rb} ${T('글자', 'chars')}</b></div></div>`;
  const ratio = rb / gb;
  $('gNote').innerHTML = T(`요청 횟수 ${rest.calls.length}번 → 1번, 응답 크기 약 ${ratio.toFixed(1)}배 차이. ` + (loader ? 'DataLoader 덕분에 서버 안의 DB 질의도 줄었습니다.' : '서버 안에서는 여전히 부모마다 DB에 따로 묻는지 위 SQL 칸을 보세요. 체크박스를 켜면 줄어듭니다.'),
    `Requests ${rest.calls.length} → 1, response size about ${ratio.toFixed(1)}× different. ` + (loader ? 'The DataLoader also cut the DB queries inside the server.' : 'Look at the SQL box above: does the server still ask the DB once per parent? Tick the checkbox to cut it.'));
}
function render() {
  $('gPresets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-i="${i}">${t(p)}</button>`).join('');
  run();
}
$('gPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('gQ').value = PRESETS[+b.dataset.i].q; run(); } });
$('gQ').addEventListener('input', run); $('gLoader').addEventListener('change', run);
document.addEventListener('langchange', render);
$('gQ').value = PRESETS[0].q;
render();
