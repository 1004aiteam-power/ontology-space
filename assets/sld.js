// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 전력망 페이지의 인터랙티브 단선도 (예전에는 grid.html 안의 <script>)
// ---- 인터랙티브 단선도: pycim.topology.energized()와 같은 알고리즘 ----
const EQ = {
  SRC:      { t: ['N1'],       cls: 'ExternalNetworkInjection', ko: 'B변전소 계통 · 상위 계통 등가 전원', en: 'Grid at Substation B · upstream network equivalent' },
  ACLS_1:   { t: ['N1', 'N2'], cls: 'ACLineSegment', ko: 'B-A 1회선 · 12.5 km · r = 0.98 Ω, x = 4.20 Ω', en: 'B-A circuit 1 · 12.5 km · r = 0.98 Ω, x = 4.20 Ω' },
  CB_154_1: { t: ['N2', 'N3'], cls: 'Breaker', sw: true, ko: '154kV 선로 CB', en: '154 kV line breaker' },
  BUS_154:  { t: ['N3'],       cls: 'BusbarSection', ko: '154kV 모선 · VoltageLevel "A변전소 154kV"에 포함', en: '154 kV busbar · in VoltageLevel "Substation A 154 kV"' },
  TR_1:     { t: ['N3', 'N4'], cls: 'PowerTransformer', ko: 'M.Tr #1 · 154/22.9 kV, 60 MVA, %Z ≈ 12% · PowerTransformerEnd 2개', en: 'M.Tr #1 · 154/22.9 kV, 60 MVA, %Z ≈ 12% · two PowerTransformerEnds' },
  BUS_22:   { t: ['N4'],       cls: 'BusbarSection', ko: '22.9kV 모선', en: '22.9 kV busbar' },
  CB_22_1:  { t: ['N4', 'N5'], cls: 'Breaker', sw: true, ko: 'D/L #1 CB · 배전선로 인출 차단기', en: 'Feeder #1 breaker' },
  LOAD_1:   { t: ['N5'],       cls: 'EnergyConsumer', ko: 'D/L #1 부하 · P = 8.5 MW, Q = 2.1 MVAr', en: 'Feeder #1 load · P = 8.5 MW, Q = 2.1 MVAr' }
};
const LABELS = {
  ss: { ko: 'A변전소', en: 'Substation A' }, src: { ko: 'B변전소 계통', en: 'Grid (Sub. B)' },
  line: { ko: 'B-A 1회선', en: 'B-A line' }, bus154: { ko: '154kV 모선', en: '154 kV bus' },
  bus22: { ko: '22.9kV 모선', en: '22.9 kV bus' }, load: { ko: '부하', en: 'Load' }
};
// pycim → pandapower 조류계산 결과 [N1..N5], 키 = (154kV CB 열림)(D/L CB 열림)
const VOLT = { '00': [1.0, 0.9992, 0.9992, 0.9945, 0.9945], '01': [1.0, 1.0, 1.0, 1.0, null],
               '10': [1.0, 1.0, null, null, null], '11': [1.0, 1.0, null, null, null] };
const open = { CB_154_1: false, CB_22_1: false };
let selected = null;

function energized() {
  const nodeTerms = {};
  for (const [id, e] of Object.entries(EQ)) e.t.forEach(n => (nodeTerms[n] ||= []).push(id));
  const seenEq = new Set(), seenCn = new Set(), stack = ['SRC'];
  while (stack.length) {
    const id = stack.pop();
    if (seenEq.has(id)) continue;
    seenEq.add(id);
    if (EQ[id].sw && open[id]) continue;          // 열린 차단기 너머로는 진행하지 않음
    for (const n of EQ[id].t) {
      if (seenCn.has(n)) continue;
      seenCn.add(n);
      stack.push(...nodeTerms[n]);
    }
  }
  return { eq: seenEq, cn: seenCn };
}

function render() {
  const live = energized();
  document.querySelectorAll('.sld [data-dep]').forEach(el => {
    const d = el.dataset.dep;
    el.classList.toggle('off', !(live.eq.has(d) || live.cn.has(d)));
  });
  document.querySelectorAll('.sld .cb').forEach(g => g.classList.toggle('open', open[g.dataset.id]));
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(LABELS[el.dataset.i18n]));
  const v = VOLT[`${+open.CB_154_1}${+open.CB_22_1}`];
  document.querySelectorAll('.sld .volt').forEach(el => {
    const x = v[+el.dataset.v];
    el.textContent = x == null ? t({ ko: '정전', en: 'dead' }) : x.toFixed(4) + ' pu';
    el.classList.toggle('out', x == null);
  });
  const dead = Object.keys(EQ).filter(id => EQ[id].cls === 'EnergyConsumer' && !live.eq.has(id));
  const out = document.getElementById('outage');
  out.textContent = dead.length ? t({ ko: '⚠ 정전 부하: ', en: '⚠ De-energized load: ' }) + dead.map(id => t(EQ[id]).split(' · ')[0]).join(', ')
                                : t({ ko: '✓ 모든 부하 가압', en: '✓ All loads energized' });
  out.classList.toggle('bad', dead.length > 0);
  const info = document.getElementById('info');
  if (!selected) { info.textContent = t({ ko: '설비를 눌러 보세요.', en: 'Click any equipment.' }); return; }
  const e = EQ[selected];
  const state = e.sw ? ` · <b>${open[selected] ? t({ ko: '열림', en: 'OPEN' }) : t({ ko: '닫힘', en: 'CLOSED' })}</b> (<code>cim:Switch.open ${open[selected]}</code>)` : '';
  info.innerHTML = `<code>ex:${selected}</code> a <code>cim:${e.cls}</code>${state}<br>${t(e)} · Terminal ${e.t.length}`;
}

document.querySelectorAll('.sld .eq').forEach(g => g.addEventListener('click', () => {
  const id = g.dataset.id;
  if (EQ[id].sw) open[id] = !open[id];
  selected = id;
  document.querySelectorAll('.sld .eq.sel').forEach(x => x.classList.remove('sel'));
  g.classList.add('sel');
  render();
}));
document.getElementById('sldReset').addEventListener('click', () => {
  open.CB_154_1 = open.CB_22_1 = false; selected = null;
  document.querySelectorAll('.sld .eq.sel').forEach(x => x.classList.remove('sel'));
  render();
});
document.addEventListener('langchange', render);
document.addEventListener('DOMContentLoaded', render);
