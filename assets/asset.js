// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 전력설비 자산관리 페이지: 위험도 지도(PoF × CoF)와 자산 상세 (⚠ 가상 데이터)
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = (ko, en) => (window.t ? window.t({ ko, en }) : ko);
  let D, spare = false, sel = 'AS-TR-0007';

  const SHORT = { 'AS-TR-0007': 'M.Tr', 'AS-CB-0123': 'CB154', 'AS-CB-0457': 'CB22', 'AS-LN-0031': 'T/L' };
  const level = (r) => r >= 15 ? 'hi' : r >= 8 ? 'mid' : 'lo';
  const levelText = (r) => r >= 15 ? T('높음', 'High') : r >= 8 ? T('중간', 'Medium') : T('낮음', 'Low');
  const judgeCls = { '정상': 'ok', '주의': 'warn', '이상': 'bad' };
  const judgeEn = { '정상': 'Normal', '주의': 'Caution', '이상': 'Abnormal' };
  const statusEn = { '완료': 'Done', '진행': 'In progress', '계획': 'Planned' };

  function cell(a) { const c = a.calc; return spare ? { pof: c.pof, cof: c.cof_spare, risk: c.risk_spare, mwh: c.mwh_spare } : { pof: c.pof, cof: c.cof, risk: c.risk, mwh: c.mwh }; }

  function drawMatrix() {
    const S = 64, X0 = 64, Y0 = 16, live = D.assets.filter(a => a.calc);
    let h = '';
    for (let p = 1; p <= 5; p++) for (let c = 1; c <= 5; c++) {
      const x = X0 + (c - 1) * S, y = Y0 + (5 - p) * S;
      h += `<rect x="${x}" y="${y}" width="${S}" height="${S}" class="mx-cell mx-${level(p * c)}"/>`;
      h += `<text x="${x + 5}" y="${y + 13}" class="mx-n">${p * c}</text>`;
    }
    for (let i = 1; i <= 5; i++) {
      h += `<text x="${X0 + (i - 0.5) * S}" y="${Y0 + 5 * S + 18}" text-anchor="middle" class="mx-ax">${i}</text>`;
      h += `<text x="${X0 - 10}" y="${Y0 + (5 - i + 0.5) * S + 4}" text-anchor="end" class="mx-ax">${i}</text>`;
    }
    h += `<text x="${X0 + 2.5 * S}" y="${Y0 + 5 * S + 40}" text-anchor="middle" class="mx-t">${T('고장 영향 CoF (미공급 전력량) →', 'Consequence of failure (unsupplied energy) →')}</text>`;
    h += `<text transform="translate(18 ${Y0 + 2.5 * S}) rotate(-90)" text-anchor="middle" class="mx-t">${T('고장 가능성 PoF (건전도) →', 'Probability of failure (health) →')}</text>`;
    const byCell = {};
    live.forEach(a => { const k = cell(a); (byCell[k.pof + '-' + k.cof] ||= []).push(a); });
    Object.values(byCell).forEach(arr => arr.forEach((a, i) => {
      const k = cell(a), cx = X0 + (k.cof - 0.5) * S + (arr.length > 1 ? (i - (arr.length - 1) / 2) * 30 : 0), cy = Y0 + (5 - k.pof + 0.5) * S;
      h += `<g class="mx-dot${a.asset_id === sel ? ' sel' : ''}" data-id="${a.asset_id}" tabindex="0" role="button" aria-label="${esc(a.name)}">
        <circle cx="${cx}" cy="${cy}" r="12"/><text x="${cx}" y="${i % 2 ? cy - 17 : cy + 26}" text-anchor="middle" class="mx-lbl">${SHORT[a.asset_id] || a.asset_id}</text></g>`;
    }));
    $('#matrix').innerHTML = h;
  }

  function name(id) { const x = D.tasks.find(t => t.task_id === id); return x ? x.name : id; }

  function drawPanel() {
    const a = D.assets.find(x => x.asset_id === sel), c = a.calc, k = cell(a);
    const loc = D.locations.find(l => l.location === a.location);
    const diags = D.diagnoses.filter(g => g.asset_id === a.asset_id).sort((x, y) => y.date.localeCompare(x.date));
    const latest = new Set(Object.values(c.latest));
    const fms = D.failureModes.filter(f => { const [k, q] = f.asset_kind.split(':'); return k === a.kind && (!q || a.rating.includes(q)); });
    const wos = D.workOrders.filter(w => w.asset_id === a.asset_id);
    const hiPct = Math.max(0, c.hi);
    $('#panel').innerHTML = `
      <div class="ap-head"><span class="badge">${esc(a.eam_no)}</span>
        <h3>${esc(a.name)}</h3>
        <p class="ap-sub">${esc(loc ? loc.name : '')} · ${esc(a.manufacturer)} ${esc(a.model)} · ${a.year_made}${T('년 제작', '')}</p></div>
      <div class="ap-risk ap-${level(k.risk)}"><b>${T('위험도', 'Risk')} ${k.risk}</b> <span>${levelText(k.risk)} · PoF ${k.pof} × CoF ${k.cof}</span></div>
      <h4>${T('건전도 지수', 'Health index')} ${c.hi}</h4>
      <div class="hi-bar" role="img" aria-label="HI ${c.hi}"><i style="width:${hiPct}%"></i></div>
      <p class="ap-calc">100 − ${T('노화', 'ageing')} ${c.age_penalty} (${c.age}${T('년', ' y')} / ${a.design_life_y}${T('년', ' y')}) − ${T('진단 감점', 'diagnosis')} ${c.diag_penalty} = <b>${c.hi}</b></p>
      <h4>${T('고장 영향', 'Consequence')}</h4>
      <p class="ap-calc">${T('정전', 'Outage')} ${c.outage_mw} MW (${esc(c.lost_loads.join(', '))}) × ${T('복구', 'restore')} ${spare && a.restore_h_with_spare !== a.restore_h ? a.restore_h_with_spare : a.restore_h} h = <b>${k.mwh.toLocaleString()} MWh</b></p>
      <h4>${T('진단 기록', 'Diagnoses')}</h4>
      <ul class="ap-list">${diags.map(g => `<li class="${latest.has(g.diag_id) ? '' : 'old'}"><span class="chip ${judgeCls[g.judgement]}">${T(g.judgement, judgeEn[g.judgement])}</span> <b>${esc(name(g.task_id))}</b> <small>${g.date}</small><br>${esc(g.finding)}</li>`).join('')}</ul>
      <p class="ap-note">${T('흐린 줄은 같은 방법의 더 새 진단이 있어 계산에서 빠진 기록입니다.', 'Faded rows are superseded by a newer diagnosis of the same method and are not counted.')}</p>
      <h4>${T('작업지시', 'Work orders')}</h4>
      <ul class="ap-list">${wos.map(w => `<li><span class="chip">${T(w.status, statusEn[w.status])}</span> <b>${w.wo_id}</b> ${esc(name(w.task_id))} <small>${w.done || w.planned}${+w.outage_h ? ` · ${T('정전', 'outage')} ${w.outage_h}h` : ''}</small></li>`).join('') || `<li>${T('없음', 'None')}</li>`}</ul>
      <h4>${T('이 자산에 해당하는 고장 모드', 'Failure modes for this asset')}</h4>
      <div class="tbl"><table class="ap-fm"><tr><th>${T('고장 모드', 'Failure mode')}</th><th>${T('찾는 점검', 'Detected by')}</th><th>${T('대응 정비', 'Mitigated by')}</th></tr>
        ${fms.map(f => `<tr><td><b>${esc(f.name)}</b><br><small>${esc(f.effect)}</small></td><td>${f.detected_by.split(';').map(name).map(esc).join('<br>')}</td><td>${f.mitigated_by.split(';').map(name).map(esc).join('<br>')}</td></tr>`).join('')}</table></div>
      <h4>${T('설치 이력', 'Deployment history')}</h4>
      <ul class="ap-list">${D.assets.filter(x => x.deployments.some(d => d.location === a.location)).flatMap(x => x.deployments.filter(d => d.location === a.location).map(d => `<li><b>${x.asset_id}</b> ${esc(x.name)} <small>${d.valid_from} ~ ${d.valid_to || T('현재', 'now')} · ${T(x.status, x.status === '폐기' ? 'Retired' : 'In service')}</small></li>`)).join('')}</ul>`;
  }

  function drawLists() {
    const an = (id) => D.assets.find(a => a.asset_id === id)?.name || id;
    $('#overdue').innerHTML = D.overdue.map(o => `<li><span class="chip warn">${T(o.state, o.state === '기록 없음' ? 'No record' : 'Overdue')}</span> ${esc(an(o.asset))} · ${esc(name(o.task))}</li>`).join('');
    $('#gaps').innerHTML = D.gaps.map(g => { const l = D.locations.find(x => x.location === g); return `<li><span class="chip warn">${T('경고', 'Warning')}</span> ${esc(l.name)} <small>(${T('고장 시 정전', 'outage if failed')} ${l.outageMW} MW)</small></li>`; }).join('');
  }

  function render() { drawMatrix(); drawPanel(); drawLists(); }

  document.addEventListener('DOMContentLoaded', async () => {
    try { D = await (await fetch('assets/data/asset.json')).json(); }
    catch (e) { $('#panel').textContent = T('데이터를 불러오지 못했습니다.', 'Could not load data.'); return; }
    render();
    $('#matrix').addEventListener('click', e => { const g = e.target.closest('.mx-dot'); if (g) { sel = g.dataset.id; render(); } });
    $('#matrix').addEventListener('keydown', e => { const g = e.target.closest('.mx-dot'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sel = g.dataset.id; render(); } });
    $('#spare').addEventListener('change', e => { spare = e.target.checked; render(); });
    document.addEventListener('langchange', render);
  });
})();
