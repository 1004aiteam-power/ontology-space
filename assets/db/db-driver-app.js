// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 드라이버 페이지: 같은 입력을 글자 이어붙이기와 바인딩으로 보내 비교하고, 자동 커밋과 트랜잭션을 비교한다 (계산은 driver.js)
import { compareInjection, transfer } from './driver.js?v=b669f4e1';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';
import { sqlHtml, tableHtml, tag } from './ui.js?v=2ed6a6af';

const PRESETS = [
  { ko: '정상 입력', en: 'Normal input', v: 'MTr-1' },
  { ko: '조건 우회 (--)', en: 'Bypass the rule (--)', v: "MTr-4' --" },
  { ko: "항상 참 (' OR '1'='1)", en: "Always true (' OR '1'='1)", v: "' OR '1'='1" },
  { ko: '표 삭제 (DROP)', en: 'Drop a table (DROP)', v: "x'; DROP TABLE assets; --" },
  { ko: "따옴표가 든 이름 (O'Neil)", en: "A name with a quote (O'Neil)", v: "O'Neil" }
];

function side(prefix, r, codeLine) {
  $(`i${prefix}Code`).textContent = codeLine;
  $(`i${prefix}Sql`).innerHTML = sqlHtml(r.sql) + (r.params.length ? `\n<span class="cm">-- ${T('값(따로 전달)', 'values (sent apart)')}: ${esc(JSON.stringify(r.params))}</span>` : '');
  const tabs = r.tables.includes('assets') ? '' : `<p>${tag(false, 'assets 표가 사라졌습니다', 'The assets table is gone')}</p>`;
  $(`i${prefix}`).innerHTML = (r.error ? `<p>${tag(false, '오류: ' + r.error, 'Error: ' + r.error)}</p>` : tableHtml(r.columns, r.rows)) + tabs;
}
function inject() {
  const input = $('iIn').value, multi = $('iMulti').checked;
  const { naive, bound } = compareInjection(input, { multi });
  side('Naive', naive, `"SELECT … WHERE name = '" + name + "' AND health >= 60"`);
  side('Bound', bound, 'execute("SELECT … WHERE name = ? AND health >= 60", [name])');
  const lost = !naive.tables.includes('assets');
  let v;
  if (lost) v = tag(false, '이어붙인 쪽에서 입력이 DROP TABLE 명령이 되어 실행되었습니다', 'In the concatenated version the input became a DROP TABLE command and ran') + ' ' + T('바인딩 쪽은 입력을 이름 글자로만 보고 0행을 돌려줍니다.', 'The bound version treated the input as just a name and returned 0 rows.');
  else if (naive.leaked > 0) v = tag(false, `업무 규칙(건전도 ≥ 60)을 뚫고 건전도 60 미만 ${naive.leaked}행이 나왔습니다`, `The rule (health ≥ 60) was bypassed: ${naive.leaked} row(s) below 60 came out`) + ' ' + T('입력의 -- 가 뒤의 조건을 주석으로 만들었기 때문입니다.', 'The -- in the input turned the rest of the condition into a comment.');
  else if (naive.error && !bound.error) v = tag(false, '이어붙인 쪽은 오류, 바인딩 쪽은 정상', 'The concatenated version failed while the bound one worked') + ' ' + T('입력의 따옴표 하나가 SQL 문법을 깨뜨렸습니다. 이것이 인젝션의 가장 약한 형태입니다.', 'A single quote in the input broke the SQL syntax: the mildest form of injection.');
  else if (naive.rows.length !== bound.rows.length) v = tag(false, `이어붙인 쪽은 ${naive.rows.length}행, 바인딩 쪽은 ${bound.rows.length}행`, `Concatenated: ${naive.rows.length} rows; bound: ${bound.rows.length}`) + ' ' + T('입력이 데이터가 아니라 SQL 조건의 일부가 되어 결과가 달라졌습니다.', 'The input became part of the SQL condition instead of data, changing the result.');
  else v = tag(true, '두 방식의 결과가 같습니다 (이 입력은 무해)', 'Both give the same result (this input is harmless)') + ' ' + T('위의 다른 입력을 눌러 보세요.', 'Try the other inputs above.');
  $('iVerdict').innerHTML = v;
}

function tx() {
  const r = transfer({ transaction: $('tMode').value === 'tx', failAt: +$('tFail').value });
  const sub = r.substation === 'S1' ? 'Sub-A' : 'Sub-B';
  $('tOut').innerHTML = `<div class="http-grid"><div><h4>${T('실행 기록', 'Execution log')}</h4><pre class="m-pre">${esc(r.log.join('\n'))}</pre></div><div><h4>${T('끝난 뒤', 'Afterwards')}</h4><p>T2 ${T('의 소속', 'belongs to')}: <b>${sub}</b></p><p>${r.failed ? (r.consistent ? tag(true, '일부만 반영되지 않고 처음 상태로 돌아갔습니다', 'Nothing half-applied: back to the starting state') : tag(false, '이동만 되고 이력은 없는 반쪽 상태가 남았습니다', 'Half-done: moved, but with no history record')) : tag(true, '두 단계 모두 반영', 'Both steps applied')}</p></div></div>`;
}

function render() {
  $('iPresets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-i="${i}">${t(p)}</button>`).join('');
  inject(); tx();
}
$('iPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('iIn').value = PRESETS[+b.dataset.i].v; inject(); } });
$('iIn').addEventListener('input', inject); $('iMulti').addEventListener('change', inject);
$('tMode').addEventListener('change', tx); $('tFail').addEventListener('change', tx);
document.addEventListener('langchange', render);
render();
