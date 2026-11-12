// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// pycim 프로젝트 페이지의 스크립트 (예전에는 project.html 안의 <script>)
// 프로젝트 페이지: 스크립트가 만든 결과(JSON)를 표로 표시
(async () => {
  let d;
  try { d = await (await fetch('assets/data/cigre-compare.json')).json(); } catch (e) { return; }
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const table = (head, rows) => `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
  const render = () => {
    const cols = Object.keys(d.sample_mapping[0] || {});
    document.getElementById('mappingTable').innerHTML = table(cols.map(esc),
      d.sample_mapping.map(r => cols.map(c => c === 'mRID' ? `<code>${esc(r[c]).slice(0, 8)}…</code>` : esc(r[c]))));
    const r = d.report;
    document.getElementById('importReport').innerHTML = `<div class="grid">
      <div class="card"><h4>${t({ ko: '읽은 객체', en: 'Objects read' })}</h4><p>${Object.entries(r.read).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</p></div>
      <div class="card"><h4>${t({ ko: '건너뛴 클래스', en: 'Skipped classes' })}</h4><p>${Object.entries(r.skipped).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</p></div>
      <div class="card"><h4>${t({ ko: '변환', en: 'Conversions' })}</h4><p>${t({ ko: `UUID가 아닌 ID ${r.renamed_ids}개 → v5 mRID<br>ConnectivityNode ${r.created_connectivity_nodes}개 생성<br>부하 ${r.loads_from_sv}개 SV에서 입력`,
        en: `${r.renamed_ids} non-UUID IDs → v5 mRIDs<br>${r.created_connectivity_nodes} ConnectivityNodes created<br>${r.loads_from_sv} loads taken from SV` })}</p></div></div>`;
    document.getElementById('maxDiff').innerHTML = t({ ko: `최대 차이 <b>${d.max_diff} pu</b> (노드 ${d.voltages.length}개)`, en: `Max difference <b>${d.max_diff} pu</b> (${d.voltages.length} nodes)` });
    document.getElementById('cigreTable').innerHTML = table([t({ ko: '노드', en: 'Node' }), 'NEPLAN [pu]', 'pycim → pandapower [pu]', t({ ko: '차이', en: 'Diff' })],
      d.voltages.map(v => [esc(v.node), `<span class="num">${v.neplan.toFixed(5)}</span>`, v.pycim.toFixed(5), v.diff.toFixed(5)]));
    document.getElementById('svTable').innerHTML = table([t({ ko: 'SV 클래스', en: 'SV class' }), t({ ko: '대상', en: 'Target' }), t({ ko: '값', en: 'Value' })],
      d.sample_sv.map(s => [s.class, esc(s.target), s.class === 'SvVoltage' ? `${s.v} kV ∠ ${s.angle}°` : `P ${s.p} MW · Q ${s.q} MVAr`]));
  };
  render();
  document.addEventListener('langchange', render);
})();
