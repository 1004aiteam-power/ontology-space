// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 가상 전국 고속도로: 24시간 차량 흐름을 지도 위에 재생 (⚠ 가상 데이터)
// 데이터: assets/data/highway.json (examples/highway/build_highway.py 가 수요 → 이용자 균형 배정으로 계산)
(function () {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = (ko, en) => (window.t ? window.t({ ko, en }) : ko);
  const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'ko');

  let D, tod = 8, playing = false, speed = 1, last = 0, scen = 'BASE', sel = null, od = 'SEOUL-BUSAN', proj;
  const show = { EXPRESSWAY: true, NATIONAL: true }, layers = {};
  const CLS = { EXPRESSWAY: { ko: '고속도로', en: 'Expressway' }, NATIONAL: { ko: '국도', en: 'National road' } };
  const N = {}, RT = {}, LK = {};

  const at = (arr) => { const h = Math.floor(tod) % 24, f = tod - Math.floor(tod); return arr[h] + (arr[(h + 1) % 24] - arr[h]) * f; };
  const clock = () => { const m = Math.round(tod * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const grade = (vc) => { for (const [g, lim] of D.model.los) if (lim === null || (g === 'E' ? vc <= lim : vc < lim)) return g; return 'F'; };
  const R = () => D.results[scen].links;
  const linkName = (l) => `${RT[l.route][lang()]} ${N[l.frm][lang()]} → ${N[l.to][lang()]}`;

  function buildMap() {
    const lat0 = 36.3 * Math.PI / 180, k = 100;
    proj = (lon, lat) => [(lon - 124.4) * k * Math.cos(lat0), (38.75 - lat) * k];
    const W = proj(130.0, 0)[0], H = (38.75 - 34.3) * k;
    const svg = el('svg', { viewBox: `0 0 ${W.toFixed(0)} ${H}`, role: 'img', 'aria-label': 'virtual Korean expressway traffic map' });
    $('hwMap').appendChild(svg);
    const land = el('g', { class: 'land' }, svg);
    for (const poly of D.outline) el('path', { d: 'M' + poly.map(([lo, la]) => proj(lo, la).map(v => v.toFixed(1)).join(',')).join('L') + 'Z' }, land);
    for (const c of ['NATIONAL', 'EXPRESSWAY']) layers[c] = { line: el('g', { class: 'hw-cls-' + c }, svg) };   // 국도를 아래에
    for (const c of ['NATIONAL', 'EXPRESSWAY']) layers[c].dots = el('g', { class: 'hw-dots' }, svg);
    const gn = el('g', {}, svg), gt = el('g', { class: 'hw-lbl' }, svg);
    for (const l of D.links) {
      const gl = layers[l.cls].line, gd = layers[l.cls].dots, nat = l.cls === 'NATIONAL';
      const [x1, y1] = proj(N[l.frm].lon, N[l.frm].lat), [x2, y2] = proj(N[l.to].lon, N[l.to].lat);
      const len = Math.hypot(x2 - x1, y2 - y1), off = nat ? 0.9 + l.lanes * 0.3 : 1.1 + l.lanes * 0.45;   // 우측 통행: 진행 방향 오른쪽에 그린다
      const nx = -(y2 - y1) / len * off, ny = (x2 - x1) / len * off;
      const d = `M${(x1 + nx).toFixed(1)},${(y1 + ny).toFixed(1)}L${(x2 + nx).toFixed(1)},${(y2 + ny).toFixed(1)}`;
      l.path = el('path', { d, class: 'hw-ln', 'stroke-width': (nat ? 0.5 + l.lanes * 0.45 : 0.9 + l.lanes * 0.55).toFixed(2) }, gl);
      l.dots = el('path', { d, class: 'hw-dot', 'stroke-width': nat ? 1 : 1.4, 'stroke-dasharray': nat ? '0.1 6' : '0.1 7' }, gd);
      l.hit = el('path', { d, class: 'hw-hit', 'stroke-width': 9, tabindex: 0, role: 'button', 'aria-label': linkName(l) }, gl);
      l.off = 0;
      l.hit.addEventListener('click', () => { sel = l.id; update(); });
      l.hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = l.id; update(); } });
    }
    const maxW = Math.max(...D.nodes.map(n => n.w));
    for (const n of D.nodes) {
      const [x, y] = proj(n.lon, n.lat), r = 2.2 + 4 * Math.sqrt(n.w / maxW);
      n.onEx = n.routes.some(rid => RT[rid].road_class === 'EXPRESSWAY');
      n.dot = n.onEx ? el('circle', { cx: x, cy: y, r: r.toFixed(1), class: n.routes.length >= 2 ? 'hw-node jc' : 'hw-node' }, gn)
                     : el('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, class: 'hw-node town' }, gn);   // 국도만 닿는 일반 교차점
      const left = ['INCHEON', 'CHANGWON', 'GWANGJU'].includes(n.id);
      n.lbl = el('text', left ? { x: x - 7, y: y - 5, 'text-anchor': 'end' } : { x: x + 6, y: y - 5 }, gt);
    }
  }

  function update() {
    const r = R();
    $('hwClock').textContent = clock();
    $('hwSlider').value = tod;
    for (const l of D.links) {
      const x = r[l.id], vc = at(x.vc), g = grade(vc);
      l.path.setAttribute('class', `hw-ln los-${g}${sel === l.id ? ' sel' : ''}`);
      l.v = at(x.spd);
    }
    for (const c in layers) { layers[c].line.style.display = show[c] ? '' : 'none'; layers[c].dots.style.display = show[c] ? '' : 'none'; }
    for (const n of D.nodes) {
      const vis = n.onEx ? (show.EXPRESSWAY || n.routes.some(rid => RT[rid].road_class === 'NATIONAL') && show.NATIONAL) : show.NATIONAL;
      n.dot.style.display = vis ? '' : 'none';
      n.lbl.textContent = vis && n.w >= 60 ? n[lang()] : '';
    }
    document.querySelectorAll('[data-hw-cls]').forEach(b => b.setAttribute('aria-pressed', show[b.dataset.hwCls]));
    const inc = D.scenarios.find(s => s.scenario_id === scen);
    const active = inc.route_id && tod >= +inc.start_h && tod < +inc.end_h;
    $('hwIncident').hidden = !inc.route_id;
    $('hwIncident').innerHTML = inc.route_id ? `<b>${active ? '⚠ ' + T('사고 진행 중', 'Incident active') : T('사고 시간 아님', 'Incident not active')}</b> · ${esc(T(inc.ko, inc.en))} (${inc.start_h}:00–${inc.end_h}:00)` : '';
    $('hwIncident').classList.toggle('on', !!active);
    summary(); panel(); odChart();
  }

  function summary() {
    const r = R(), h = Math.round(tod) % 24;
    const cnt = { EXPRESSWAY: 0, NATIONAL: 0 }, vk = { EXPRESSWAY: 0, NATIONAL: 0 };
    for (const l of D.links) { if (r[l.id].los[h] === 'F') cnt[l.cls]++; vk[l.cls] += r[l.id].vol[h] * l.km; }
    const veh = vk.EXPRESSWAY + vk.NATIONAL;
    const tt = D.results[scen].od[od][h];
    $('hwSummary').innerHTML = `
      <div><span>${T('혼잡(LOS F) 링크 · 고속도로 / 국도', 'LOS F links · expressway / national')}</span><b>${cnt.EXPRESSWAY} / ${cnt.NATIONAL}</b></div>
      <div><span>${T('국도 분담 (주행거리)', 'National-road share (veh·km)')}</span><b>${veh ? Math.round(vk.NATIONAL / veh * 100) : 0}%</b></div>
      <div><span>${T('시간당 주행거리 합계', 'Vehicle-km this hour')}</span><b>${T(Math.round(veh / 1e4).toLocaleString() + '만 대·km', (veh / 1e6).toFixed(1) + 'M veh·km')}</b></div>
      <div><span>${esc(odName(od))}</span><b>${Math.floor(tt / 60)}${T('시간', 'h')} ${tt % 60}${T('분', 'm')}</b></div>`;
  }
  const odName = (k) => { const [a, b] = k.split('-'); return `${N[a][lang()]} → ${N[b][lang()]}`; };

  function spark(base, inc, hour, fmt, unit, fromMin) {
    const W = 300, H = 90, P = 22, hi = Math.max(...base, ...inc), lo = fromMin ? Math.min(...base, ...inc) * 0.98 : 0, mx = (hi - lo) * 1.1 || 1;
    const X = (i) => P + i * (W - P - 6) / 23, Y = (v) => H - 16 - (v - lo) / mx * (H - 26);
    const path = (a) => 'M' + a.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('L');
    const diff = inc.some((v, i) => v !== base[i]);
    return `<svg viewBox="0 0 ${W} ${H}" class="hw-spark" role="img" aria-label="24h">
      <line x1="${X(hour)}" x2="${X(hour)}" y1="6" y2="${H - 16}" class="sp-now"/>
      <path d="${path(base)}" class="sp-base"/>${diff ? `<path d="${path(inc)}" class="sp-inc"/>` : ''}
      ${[0, 6, 12, 18, 23].map(i => `<text x="${X(i)}" y="${H - 3}" text-anchor="middle">${i}</text>`).join('')}
      <text x="${P}" y="12" class="sp-max">${fromMin ? fmt(lo / 0.98) + ' – ' : ''}${fmt(hi)} ${unit}</text></svg>`;
  }

  function panel() {
    const box = $('hwPanel');
    if (!sel) { box.innerHTML = `<p class="hw-hint">${T('지도에서 도로를 누르면 그 방향 링크의 24시간 교통량이 여기에 나옵니다. 도로는 진행 방향 오른쪽에 그려져 있어, 같은 구간의 상행·하행이 나란히 보입니다.', 'Click a road on the map to see that direction\'s 24-hour traffic here. Each direction is drawn on its right-hand side, so both directions of a section appear side by side.')}</p>`; return; }
    const l = LK[sel], b = D.results.BASE.links[sel], i = D.results.INCIDENT.links[sel], r = R()[sel], h = Math.round(tod) % 24;
    const vc = at(r.vc), g = grade(vc);
    box.innerHTML = `<div class="hw-ph"><span class="badge">${l.id}</span><h3>${esc(linkName(l))}</h3>
        <p>${T(CLS[l.cls].ko, CLS[l.cls].en)} · ${l.km} km · ${T('한 방향', 'per direction')} ${l.lanes}${T('차로', ' lanes')} · ${T('용량', 'capacity')} ${(l.lanes * D.model.capPerLane[l.cls]).toLocaleString()} ${T('대/시', 'veh/h')}</p></div>
      <div class="hw-now los-bg-${g}"><b>LOS ${g}</b> <span>${clock()} · ${Math.round(at(r.vol)).toLocaleString()} ${T('대/시', 'veh/h')} · v/c ${vc.toFixed(2)} · ${Math.round(l.v)} km/h</span></div>
      <h4>${T('시간대별 교통량', 'Hourly volume')}</h4>
      ${spark(b.vol, i.vol, h, v => Math.round(v).toLocaleString(), T('대/시', 'veh/h'))}
      <h4>${T('시간대별 평균 속도', 'Hourly speed')}</h4>
      ${spark(b.spd, i.spd, h, v => Math.round(v), 'km/h')}
      <div class="legend"><span><i class="lg-base"></i>${T('평일 기본', 'Weekday base')}</span>${b.vol.some((v, k) => v !== i.vol[k]) ? `<span><i class="lg-inc"></i>${T('사고 시나리오', 'Incident')}</span>` : ''}</div>
      <p class="hw-hint">${T('하루 교통량', 'Daily volume')} ${b.daily.toLocaleString()} ${T('대 (기본)', 'veh (base)')}${b.daily !== i.daily ? ` → ${i.daily.toLocaleString()} ${T('대 (사고)', 'veh (incident)')}` : ''}</p>`;
  }

  function odChart() {
    const b = D.results.BASE.od[od], i = D.results.INCIDENT.od[od], h = Math.round(tod) % 24;
    $('hwOdChart').innerHTML = spark(b, i, h, v => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`, T('(시:분)', '(h:mm)'), true);
  }

  function animate(dt) {
    for (const l of D.links) {
      l.off = (l.off - (l.v || 0) / 100 * 9 * dt) % 1000;
      l.dots.setAttribute('stroke-dashoffset', l.off.toFixed(2));
    }
  }
  function frame(ts) {
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
    if (playing) { tod = (tod + dt * speed * 0.5) % 24; update(); }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) animate(dt);
    requestAnimationFrame(frame);
  }
  function label() {
    $('hwPlay').textContent = playing ? T('⏸ 일시정지', '⏸ Pause') : T('▶ 24시간 재생', '▶ Play 24 h');
    $('hwSpeed').textContent = T('배속 ', 'Speed ') + speed + '×';
    $('hwOd').innerHTML = D.odWatch.map(k => `<option value="${k}"${k === od ? ' selected' : ''}>${esc(odName(k))}</option>`).join('');
  }

  async function main() {
    try { D = await (await fetch('assets/data/highway.json')).json(); }
    catch (e) { $('hwMap').textContent = T('데이터를 불러오지 못했습니다.', 'Could not load data.'); return; }
    D.nodes.forEach(n => (N[n.id] = n)); D.routes.forEach(r => (RT[r.route_id] = r)); D.links.forEach(l => (LK[l.id] = l));
    buildMap();
    sel = D.links.find(l => l.route === 'GYEONGBU' && l.frm === 'CHEONAN' && l.to === 'CHEONGJU').id;
    $('hwPlay').addEventListener('click', () => { playing = !playing; label(); });
    $('hwSpeed').addEventListener('click', () => { speed = { 1: 2, 2: 4, 4: 1 }[speed]; label(); });
    $('hwSlider').addEventListener('input', e => { tod = +e.target.value; playing = false; label(); update(); });
    document.querySelectorAll('[data-hw-hour]').forEach(b => b.addEventListener('click', () => { tod = +b.dataset.hwHour; playing = false; label(); update(); }));
    document.querySelectorAll('input[name=hwScen]').forEach(r => r.addEventListener('change', e => { scen = e.target.value; update(); }));
    $('hwOd').addEventListener('change', e => { od = e.target.value; update(); });
    document.querySelectorAll('[data-hw-cls]').forEach(b => b.addEventListener('click', () => { show[b.dataset.hwCls] = !show[b.dataset.hwCls]; update(); }));
    document.addEventListener('langchange', () => { label(); update(); });
    label(); update(); requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
