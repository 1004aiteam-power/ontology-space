// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 전력시장 페이지의 메리트 오더 체험 (예전에는 bidding.html 안의 <script>)
// 메리트 오더 체험 (가상 값). 막대 = 발전기 묶음 (폭 GW, 높이 원/kWh), 수요선에 걸린 마지막 묶음의 변동비 = SMP
(function () {
  const $ = (id) => document.getElementById(id);
  const T = (o) => window.t(o);
  const FUEL = [
    { k: 'nuc', slot: 0, ko: '원자력', en: 'Nuclear' }, { k: 'coal', slot: 1, ko: '석탄', en: 'Coal' },
    { k: 'lng', slot: 2, ko: 'LNG', en: 'LNG' }, { k: 'oil', slot: 3, ko: '유류 · 첨두', en: 'Oil · peakers' }
  ];
  // [연료, 용량 GW, 변동비 원/kWh] — 가상
  const BLOCKS = [['nuc', 12, 6], ['nuc', 12, 8], ['coal', 10, 58], ['coal', 10, 66], ['coal', 10, 74], ['lng', 8, 118], ['lng', 8, 132], ['lng', 8, 146], ['lng', 8, 162], ['lng', 6, 185], ['oil', 4, 240], ['oil', 3, 300]];
  const PAL = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500'] };
  const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const color = (k) => PAL[dark() ? 'dark' : 'light'][FUEL.find(f => f.k === k).slot];
  const total = BLOCKS.reduce((a, b) => a + b[1], 0);

  function draw() {
    const dem = +$('moDem').value, solar = $('moSolar').checked ? 15 : 0, net = Math.max(0, dem - solar);
    $('moDemV').textContent = dem + ' GW';
    let x = 0, smp = null, marg = null;
    for (const b of BLOCKS) { if (smp == null && x + b[1] >= net) { smp = b[2]; marg = b; } x += b[1]; }
    const short = smp == null;
    const W = 760, H = 300, pL = 46, pR = 12, pT = 16, pB = 34, maxY = 320;
    const sx = (g) => pL + (W - pL - pR) * g / total, sy = (v) => pT + (H - pT - pB) * (1 - v / maxY);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="merit order">`;
    for (const v of [0, 100, 200, 300]) s += `<line class="grid" x1="${pL}" x2="${W - pR}" y1="${sy(v)}" y2="${sy(v)}"/><text class="ax" x="${pL - 6}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
    x = 0;
    BLOCKS.forEach((b, i) => {
      const on = x < net, x0 = sx(x), x1 = sx(x + b[1]), y = sy(b[2]);
      s += `<path class="blk${on ? '' : ' off'}" data-i="${i}" fill="${color(b[0])}" d="M${x0},${sy(0)} V${y + 4} q0,-4 4,-4 H${x1 - 4} q4,0 4,4 V${sy(0)} Z"/>`;
      x += b[1];
    });
    for (const g of [0, 25, 50, 75, 100]) if (g <= total) s += `<text class="ax" x="${sx(g)}" y="${H - pB + 16}" text-anchor="middle">${g}</text>`;
    s += `<text class="ax" x="${W - pR}" y="${H - 4}" text-anchor="end">GW</text><text class="ax" x="${pL - 6}" y="${pT - 4}" text-anchor="end">${T({ ko: '원/kWh', en: 'KRW/kWh' })}</text>`;
    s += `<line class="base" x1="${pL}" x2="${W - pR}" y1="${sy(0)}" y2="${sy(0)}"/>`;
    const dx = sx(Math.min(net, total));
    s += `<line class="dem" x1="${dx}" x2="${dx}" y1="${pT}" y2="${sy(0)}"/><text class="lbl" x="${dx + 6}" y="${pT + 12}">${T({ ko: '수요', en: 'Demand' })} ${net} GW</text>`;
    if (!short) s += `<line class="smp" x1="${pL}" x2="${dx}" y1="${sy(smp)}" y2="${sy(smp)}"/><text class="lbl" x="${pL + 6}" y="${sy(smp) - 6}">SMP ${smp}</text>`;
    s += '</svg><div class="mo-tip" id="moTip" hidden></div>';
    $('moChart').innerHTML = s;
    const dispatched = BLOCKS.reduce((a, b, i) => { let c = 0; for (let j = 0; j <= i; j++) c += BLOCKS[j][1]; return a + (c - b[1] < net ? 1 : 0); }, 0);
    const marginalFuel = marg ? T(FUEL.find(f => f.k === marg[0])) : '—';
    $('moOut').innerHTML = [
      [short ? T({ ko: '공급 부족!', en: 'Short!' }) : smp + ' ' + T({ ko: '원/kWh', en: 'KRW/kWh' }), 'SMP'],
      [marginalFuel, T({ ko: '가격을 정한 발전기 (한계 발전기)', en: 'Price-setting (marginal) plant' })],
      [dispatched + ' / ' + BLOCKS.length, T({ ko: '돌아가는 발전기 묶음', en: 'Plant groups running' })],
      [short ? '—' : (smp - 6) + ' ' + T({ ko: '원/kWh', en: 'KRW/kWh' }), T({ ko: '원자력 묶음의 kWh당 마진 (SMP − 변동비)', en: 'Nuclear margin per kWh (SMP − cost)' })]
    ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    $('moLegend').innerHTML = FUEL.map(f => `<span><i style="background:${color(f.k)}"></i>${T(f)}</span>`).join('') + `<span>${T({ ko: '흐린 막대 = 이 수요에서는 돌지 않음', en: 'Faded bars = not needed at this demand' })}</span>`;
    const tip = $('moTip'), box = $('moChart');
    box.querySelectorAll('.blk').forEach(p => {
      p.addEventListener('mouseenter', () => {
        const b = BLOCKS[+p.dataset.i];
        tip.innerHTML = `<b>${T(FUEL.find(f => f.k === b[0]))}</b><br>${T({ ko: '용량', en: 'Capacity' })} ${b[1]} GW · ${T({ ko: '변동비', en: 'Cost' })} ${b[2]} ${T({ ko: '원/kWh', en: 'KRW/kWh' })}<br>${p.classList.contains('off') ? T({ ko: '이번 시간엔 쉼', en: 'Idle this hour' }) : T({ ko: `받는 가격 = SMP ${smp ?? '—'}`, en: `Paid SMP ${smp ?? '—'}` })}`;
        const bb = box.getBoundingClientRect(), pb = p.getBoundingClientRect();
        tip.hidden = false; tip.style.left = Math.min(bb.width - 200, Math.max(0, pb.left - bb.left)) + 'px'; tip.style.top = '4px';
      });
      p.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }
  $('moDem').addEventListener('input', draw);
  $('moSolar').addEventListener('change', draw);
  document.addEventListener('langchange', draw);
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  draw();
})();
