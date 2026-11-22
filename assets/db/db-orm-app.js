// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 쿼리 빌더 · ORM 페이지: 조건 → 코드 → SQL → 결과, 그리고 N+1 비교 (계산은 orm.js)
import { makeDB } from './data.js?v=b680931a';
import { from, compareLoading, loadingCost } from './orm.js?v=b3ad1a92';
import { $, esc, T } from '../lib/dom.js?v=3b73d59c';
import { sqlHtml, tableHtml } from './ui.js?v=2ed6a6af';

function builder() {
  const type = $('bType').value, min = +$('bMin').value, ord = $('bOrd').value, lim = $('bLim').value;
  $('bMinOut').textContent = min;
  const q = from('assets').select('id', 'name', 'type', 'health');
  const code = ['from("assets")', '  .select("id", "name", "type", "health")'];
  const orm = ['Asset.objects'];
  if (type) { q.where('type', '=', type); code.push(`  .where("type", "=", "${type}")`); orm.push(`  .filter(type="${type}")`); }
  if (min > 0) { q.where('health', '>=', min); code.push(`  .where("health", ">=", ${min})`); orm.push(`  .filter(health__gte=${min})`); }
  if (ord) { q.orderBy('health', ord); code.push(`  .orderBy("health", "${ord}")`); orm.push(`  .order_by("${ord === 'DESC' ? '-' : ''}health")`); }
  if (lim) { q.limit(+lim); code.push(`  .limit(${lim})`); orm[orm.length - 1] += `[:${lim}]`; }
  const { sql, params } = q.toSQL();
  $('bCode').textContent = code.join('\n');
  $('bOrm').textContent = orm.join('\n');
  $('bSql').innerHTML = sqlHtml(sql) + (params.length ? `\n<span class="cm">-- ${T('바인딩 값', 'bound values')}: ${esc(JSON.stringify(params))}</span>` : '');
  const r = q.run(makeDB());
  $('bRes').innerHTML = tableHtml(r.columns, r.rows);
}

const NAMES = {
  lazy: [T('① 지연 불러오기 (ORM 기본값)', '① Lazy loading (the ORM default)'), 'h10'],
  batch: [T('② 미리 묶어서 IN으로', '② Gather first, then IN'), 'h2'],
  join: [T('③ JOIN 한 번에', '③ One JOIN'), 'h3']
};
function n1() {
  const c = compareLoading();
  $('n1Real').innerHTML = Object.entries(c).map(([k, v]) => `<div class="card"><h4>${NAMES[k][0]} — <b>${v.count}</b> ${T('번 질의', 'queries')}</h4><pre class="m-pre drv-code">${v.queries.map(s => sqlHtml(s)).join('\n')}</pre></div>`).join('');
  const same = JSON.stringify(c.lazy.tree) === JSON.stringify(c.batch.tree) && JSON.stringify(c.lazy.tree) === JSON.stringify(c.join.tree);
  $('n1Same').innerHTML = same ? T(`✓ 세 방식이 돌려준 결과(변전소 ${c.lazy.tree.length}개, 설비 ${c.lazy.tree.reduce((s, x) => s + x.assets.length, 0)}개)는 완전히 같습니다. 다른 것은 DB에 물은 횟수뿐입니다.`, `✓ All three returned exactly the same result (${c.lazy.tree.length} substations, ${c.lazy.tree.reduce((s, x) => s + x.assets.length, 0)} assets). Only the number of times the DB was asked differs.`) : '✗ results differ';
}
function bars() {
  const N = +$('nN').value, rtt = +$('nRtt').value;
  $('nNOut').textContent = N; $('nRttOut').textContent = rtt + ' ms';
  const c = loadingCost(N, rtt), mx = Math.max(...c.map(x => x.ms));
  $('nBars').innerHTML = c.map(x => `<div class="cmp-row"><div class="cmp-name">${NAMES[x.k][0]}</div><div class="cmp-bar"><i class="${NAMES[x.k][1]}" style="width:${Math.max(1.5, x.ms / mx * 100)}%"></i><b>${x.queries} ${T('번 질의', 'queries')} · ${x.ms} ms</b></div></div>`).join('') +
    `<p class="st-cap">${T(`변전소가 ${N}개면 지연 불러오기는 ${N + 1}번 물어 왕복만 ${c[0].ms} ms를 씁니다. 목록이 100배로 늘면 지연 시간도 100배로 늘지만, ②·③은 거의 그대로입니다.`, `With ${N} substations, lazy loading asks ${N + 1} times, spending ${c[0].ms} ms on round trips alone. A 100× longer list makes it 100× slower, while ② and ③ barely change.`)}</p>`;
}
function render() { builder(); n1(); bars(); }
for (const id of ['bType', 'bMin', 'bOrd', 'bLim']) $(id).addEventListener('input', builder);
$('nN').addEventListener('input', bars); $('nRtt').addEventListener('input', bars);
document.addEventListener('langchange', render);
render();
