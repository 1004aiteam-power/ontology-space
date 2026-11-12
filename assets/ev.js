// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 고속도로 × 전력망: 휴게소 전기차 충전 수요를 24시간 교통량에서 계산해 배전선로·변전소 부하로 보여 준다 (⚠ 가상 데이터)
// 데이터: assets/data/ev.json (examples/ev/build_ev.py). simulate() 는 build_ev.py 의 simulate() 와 같은 식이다.
import { $, esc, T } from './lib/dom.js?v=3b73d59c';
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const L = (o, k = 'ko', e = 'en') => T(o[k], o[e]);
  const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);

  let D, P, hour = 17, sel = 'RA01', traffic = 'BASE', timer = null, sims = {};
  const ST = {};

  function simulate(ra) {
    const vol = traffic === 'INCIDENT' ? ra.volIncident : ra.vol;
    const capKw = ra.chargers * P.chargerScale * ra.kw;
    const base = D.loadCurve.map(c => ra.baseMW * c);
    let q = 0;
    const o = { demand: [], served: [], queue: [], feeder: [], base, capMW: capKw / 1000 };
    for (let day = 0; day < 2; day++) for (let h = 0; h < 24; h++) {
      const dem = vol[h] * P.evShare * P.stopRate * P.kwh;
      let cap = capKw;
      if (P.smart) cap = Math.min(cap, Math.max(0, (P.feederLimitMW - base[h]) * 1000));
      const served = Math.min(dem + q, cap);
      q = dem + q - served;
      if (day === 1) { o.demand.push(dem / 1000); o.served.push(served / 1000); o.queue.push(q / P.kwh); o.feeder.push(base[h] + served / 1000); }
    }
    o.sessions = Math.round(o.served.reduce((a, b) => a + b, 0) * 1000 / P.kwh);
    o.peak = Math.max(...o.served);
    o.feederPeak = Math.max(...o.feeder);
    o.over = o.feeder.map((v, h) => v > P.feederLimitMW + 1e-9 ? h : -1).filter(h => h >= 0);
    o.maxQueue = Math.max(...o.queue);
    return o;
  }

  // ---- 지도 ------------------------------------------------------------------------------------
  let proj;
  function buildMap() {
    const lat0 = 36.3 * Math.PI / 180, k = 100;
    proj = (lon, lat) => [(lon - 124.4) * k * Math.cos(lat0), (38.75 - lat) * k];
    const W = proj(130.0, 0)[0], H = (38.75 - 34.3) * k;
    const svg = el('svg', { viewBox: `0 0 ${W.toFixed(0)} ${H}`, role: 'img', 'aria-label': 'rest-area charging map' });
    $('evMap').appendChild(svg);
    const land = el('g', { class: 'land' }, svg);
    for (const poly of D.outline) el('path', { d: 'M' + poly.map(([lo, la]) => proj(lo, la).map(v => v.toFixed(1)).join(',')).join('L') + 'Z' }, land);
    const gr = el('g', {}, svg);
    for (const [a, b, c, d] of D.roads) { const [x1, y1] = proj(a, b), [x2, y2] = proj(c, d); el('line', { x1, y1, x2, y2, class: 'ev-road' }, gr); }
    const gtie = el('g', {}, svg), gst = el('g', {}, svg), gra = el('g', {}, svg), glb = el('g', {}, svg);
    for (const s of D.stations) {
      const [x, y] = proj(s.lon, s.lat);
      ST[s.id] = s;
      s.box = el('rect', { x: x - 5, y: y - 5, width: 10, height: 10, class: 'ev-st' }, gst);
      el('text', { x: x + 8, y: y + 4, class: 'ev-st-lbl' }, glb).dataset.st = s.id;
    }
    for (const ra of D.restAreas) {
      const [x, y] = proj(ra.lon, ra.lat), s = ST[ra.station], [sx, sy] = proj(s.lon, s.lat);
      ra.tie = el('line', { x1: x, y1: y, x2: sx, y2: sy, class: 'ev-tie' }, gtie);
      const g = el('g', { class: 'ev-ra', tabindex: 0, role: 'button' }, gra);
      ra.q = el('circle', { cx: x, cy: y, r: 10, class: 'ev-q' }, g);
      ra.dot = el('circle', { cx: x, cy: y, r: 5, class: 'ev-dot' }, g);
      ra.title = el('title', {}, g);
      const pick = () => { sel = ra.id; render(); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      ra.g = g;
    }
  }

  const loadCls = (r) => r > 1 + 1e-9 ? 'over' : r > 0.85 ? 'warn' : 'ok';

  function render() {
    sims = {};
    for (const ra of D.restAreas) sims[ra.id] = simulate(ra);
    const h = Math.floor(hour);
    $('evClock').textContent = String(h).padStart(2, '0') + ':00';
    $('evHour').value = h;
    for (const ra of D.restAreas) {
      const s = sims[ra.id], mw = s.served[h], ratio = s.feeder[h] / P.feederLimitMW;
      ra.dot.setAttribute('r', (3.5 + 10 * Math.sqrt(mw / 2.5)).toFixed(1));
      ra.dot.setAttribute('class', 'ev-dot ' + loadCls(ratio));
      ra.q.setAttribute('r', (6 + 10 * Math.sqrt(mw / 2.5) + Math.min(10, s.queue[h] / 4)).toFixed(1));
      ra.q.style.display = s.queue[h] >= 1 ? '' : 'none';
      ra.g.classList.toggle('sel', ra.id === sel);
      ra.tie.classList.toggle('sel', ra.id === sel);
      ra.title.textContent = `${L(ra)} · ${f2(mw)} MW`;
    }
    document.querySelectorAll('[data-st]').forEach(t => { const s = ST[t.dataset.st]; t.textContent = L(s); });
    for (const s of D.stations) s.box.classList.toggle('sel', D.restAreas.find(r => r.id === sel).station === s.id);
    facts(); side(h); charts(h); table(); stations(h);
    document.querySelectorAll('[data-ev-preset]').forEach(b => b.setAttribute('aria-pressed', b.dataset.evPreset === presetNow()));
    $('evShareV').textContent = Math.round(P.evShare * 100) + '%';
    $('evShare').value = Math.round(P.evShare * 100);
    document.querySelectorAll('[data-ev-scale]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.evScale === P.chargerScale));
    $('evSmart').checked = P.smart;
    document.querySelectorAll('[data-ev-traffic]').forEach(b => b.setAttribute('aria-pressed', b.dataset.evTraffic === traffic));
  }

  function facts() {
    const all = Object.values(sims);
    const sess = all.reduce((a, s) => a + s.sessions, 0);
    const peakSum = Math.max(...D.loadCurve.map((_, h) => all.reduce((a, s) => a + s.served[h], 0)));
    const over = all.filter(s => s.over.length).length, q = Math.max(...all.map(s => s.maxQueue));
    $('evFacts').innerHTML = `<div><b>${sess.toLocaleString()}</b><span>${T('하루 충전 횟수', 'charging sessions / day')}</span></div>
      <div><b>${f1(peakSum)} MW</b><span>${T('휴게소 충전 동시 첨두', 'combined charging peak')}</span></div>
      <div class="${q >= 1 ? 'bad' : ''}"><b>${Math.round(q)}${T('대', '')}</b><span>${T('가장 긴 대기 (차)', 'longest queue (cars)')}</span></div>
      <div class="${over ? 'bad' : ''}"><b>${over}/${D.restAreas.length}</b><span>${T('한도(10MW)를 넘는 배전선로', 'feeders over 10 MW')}</span></div>`;
  }

  function side(h) {
    const ra = D.restAreas.find(r => r.id === sel), s = sims[sel], st = ST[ra.station];
    const vol = (traffic === 'INCIDENT' ? ra.volIncident : ra.vol)[h];
    const evs = vol * P.evShare;
    $('evSide').innerHTML = `<h3>${esc(L(ra))}</h3>
      <div class="ev-path">
        <div><small>${T('교통 온톨로지', 'Traffic ontology')}</small><code>hw:${ra.link}</code> ${esc(T(ra.routeKo, ra.routeEn))}</div>
        <div class="arr">↓ <code>ev:onLink</code></div>
        <div><small>${T('충전소 (= 전력망의 부하)', 'Charging station (= a grid load)')}</small><code>ev:CS_${ra.id}</code> ${ra.chargers * P.chargerScale}${T('대', '')} × ${ra.kw}kW</div>
        <div class="arr">↓ <code>cim:Equipment.EquipmentContainer</code></div>
        <div><small>${T('22.9kV 배전선로', '22.9 kV feeder')}</small><code>ev:FD_${ra.id}</code> ${T('한도', 'limit')} ${P.feederLimitMW} MW</div>
        <div class="arr">↓ <code>cim:Feeder.NormalEnergizingSubstation</code></div>
        <div><small>${T('디지털 트윈 154kV 변전소', 'Digital twin 154 kV substation')}</small>${esc(L(st))} · ${ra.distKm} km</div>
      </div>
      <table class="ev-now"><tbody>
        <tr><th>${T('교통량', 'Traffic')}</th><td>${Math.round(vol).toLocaleString()} ${T('대/시', 'veh/h')}</td></tr>
        <tr><th>${T('지나가는 전기차', 'EVs passing')}</th><td>${Math.round(evs).toLocaleString()} ${T('대/시', 'veh/h')}</td></tr>
        <tr><th>${T('충전 수요', 'Charging demand')}</th><td>${f2(s.demand[h])} MW</td></tr>
        <tr><th>${T('충전 공급', 'Charging served')}</th><td><b>${f2(s.served[h])}</b> / ${f2(s.capMW)} MW</td></tr>
        <tr class="${s.queue[h] >= 1 ? 'bad' : ''}"><th>${T('대기', 'Queue')}</th><td>${Math.round(s.queue[h])} ${T('대', 'cars')}</td></tr>
        <tr class="${s.feeder[h] > P.feederLimitMW + 1e-9 ? 'bad' : ''}"><th>${T('배전선로 부하', 'Feeder load')}</th><td><b>${f2(s.feeder[h])}</b> / ${P.feederLimitMW} MW</td></tr>
      </tbody></table>`;
  }

  // 24시간 작은 그래프 두 개: 충전(수요·공급·설비 용량), 배전선로(다른 부하 + 충전, 한도)
  function chart(box, series, yMax, h, opts) {
    const W = 420, H = 170, Lp = 38, R = 8, Tp = 10, B = 24;
    const X = (i) => Lp + (W - Lp - R) * i / 23, Y = (v) => Tp + (H - Tp - B) * (1 - v / yMax);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    for (const f of [0, 0.5, 1]) s += `<line x1="${Lp}" x2="${W - R}" y1="${Y(f * yMax)}" y2="${Y(f * yMax)}" class="ev-grid"/><text x="${Lp - 5}" y="${Y(f * yMax) + 4}" text-anchor="end" class="ev-ax">${(f * yMax).toFixed(yMax < 5 ? 1 : 0)}</text>`;
    for (const i of [0, 6, 12, 18, 23]) s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="ev-ax">${i}${T('시', 'h')}</text>`;
    for (const ser of series) {
      const pts = ser.v.map((v, i) => `${X(i).toFixed(1)},${Y(Math.min(v, yMax * 1.05)).toFixed(1)}`);
      if (ser.area) {
        const lo = ser.lo ? ser.lo.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).reverse() : [`${X(23)},${Y(0)}`, `${X(0)},${Y(0)}`];
        s += `<path d="M${pts.join('L')}L${lo.join('L')}Z" class="${ser.cls}"/>`;
      } else s += `<path d="M${pts.join('L')}" class="${ser.cls}"/>`;
    }
    if (opts && opts.limit != null) s += `<line x1="${Lp}" x2="${W - R}" y1="${Y(opts.limit)}" y2="${Y(opts.limit)}" class="ev-limit"/>`;
    s += `<line x1="${X(h)}" x2="${X(h)}" y1="${Tp}" y2="${H - B}" class="ev-hr"/></svg>`;
    box.innerHTML = s;
  }

  function charts(h) {
    const s = sims[sel];
    const y1 = Math.max(0.5, s.capMW, ...s.demand) * 1.15;
    chart($('evChartA'), [
      { v: s.served, area: true, cls: 'ev-a-served' },
      { v: s.demand, cls: 'ev-l-demand' },
      { v: s.served, cls: 'ev-l-served' },
      { v: s.demand.map(() => s.capMW), cls: 'ev-l-cap' },
    ], y1, h);
    const tot = s.feeder, y2 = Math.max(P.feederLimitMW, ...tot) * 1.1;
    chart($('evChartB'), [
      { v: s.base, area: true, cls: 'ev-a-base' },
      { v: tot, lo: s.base, area: true, cls: 'ev-a-ev' },
      { v: tot, cls: 'ev-l-tot' },
    ], y2, h, { limit: P.feederLimitMW });
    const qmax = Math.max(1, ...s.queue);
    $('evQueue').innerHTML = s.queue.map((q, i) => `<i style="height:${(q / qmax * 100).toFixed(0)}%" class="${i === h ? 'cur' : ''}" title="${i}h · ${Math.round(q)}"></i>`).join('');
    $('evQueueMax').textContent = s.maxQueue >= 1 ? `${T('최대', 'max')} ${Math.round(s.maxQueue)}${T('대', ' cars')}` : T('대기 없음', 'no queue');
  }

  function table() {
    $('evTable').innerHTML = D.restAreas.map(ra => {
      const s = sims[ra.id], ph = s.served.indexOf(s.peak);
      return `<tr class="${ra.id === sel ? 'sel' : ''}" data-ra="${ra.id}" tabindex="0">
        <td>${esc(L(ra))}</td><td>${esc(L(ST[ra.station]))}</td><td class="n">${s.sessions.toLocaleString()}</td>
        <td class="n">${f2(s.peak)} <small>@${ph}${T('시', 'h')}</small></td>
        <td class="n ${s.maxQueue >= 1 ? 'bad' : ''}">${Math.round(s.maxQueue)}</td>
        <td class="n ${s.over.length ? 'bad' : ''}">${f1(s.feederPeak)}${s.over.length ? ` <small>(${s.over.length}${T('시간 초과', 'h over')})</small>` : ''}</td></tr>`;
    }).join('');
    $('evTable').querySelectorAll('tr').forEach(tr => {
      const go = () => { sel = tr.dataset.ra; render(); $('evMap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  }

  function stations(h) {
    const by = {};
    for (const ra of D.restAreas) (by[ra.station] ||= []).push(ra);
    $('evStations').innerHTML = D.stations.slice().sort((a, b) => b.loadMW - a.loadMW).map(s => {
      const ras = by[s.id] || [], ev = ras.reduce((a, r) => a + sims[r.id].served[h], 0), load = s.loadMW * D.loadCurve[h];
      const fd = Math.max(...ras.map(r => sims[r.id].served[h] / sims[r.id].feeder[h] || 0));
      return `<tr><td>${esc(L(s))}</td><td class="n">${ras.length}</td><td class="n">${f2(ev)}</td><td class="n">${Math.round(load).toLocaleString()}</td>
        <td class="n">${load ? (ev / load * 100).toFixed(2) : '–'}%</td><td class="n">${(fd * 100).toFixed(0)}%</td></tr>`;
    }).join('');
  }

  const PRESETS = {
    today: { evShare: 0.10, chargerScale: 1, smart: false },
    ev30: { evShare: 0.30, chargerScale: 1, smart: false },
    ev30x3: { evShare: 0.30, chargerScale: 3, smart: false },
    ev30x3smart: { evShare: 0.30, chargerScale: 3, smart: true },
  };
  const presetNow = () => Object.keys(PRESETS).find(k => Object.entries(PRESETS[k]).every(([a, b]) => Math.abs(P[a] - b) < 1e-9 || P[a] === b)) || '';

  function cq() {
    $('evCq').innerHTML = D.cq.map((c, i) => `<details${i === 0 ? ' open' : ''}><summary><b>Q${i + 1}.</b> ${esc(T(c.q, c.en))} <small class="muted">(${c.rows.length}${T('행', ' rows')})</small></summary>
      <pre><code class="language-cypher">${esc(c.cypher)}</code></pre>
      <div class="tbl"><table><tbody>${c.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td>${T('(결과 없음)', '(no rows)')}</td></tr>`}</tbody></table></div></details>`).join('');
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } $('evPlay').textContent = '▶'; }

  async function main() {
    if (!$('evMap')) return;
    try { D = await (await fetch('assets/data/ev.json')).json(); } catch (e) { $('evMap').textContent = 'ev.json?'; return; }
    P = Object.assign({}, D.params);
    buildMap();
    $('evHour').addEventListener('input', e => { stop(); hour = +e.target.value; render(); });
    $('evPlay').addEventListener('click', () => {
      if (timer) return stop();
      $('evPlay').textContent = '❚❚';
      timer = setInterval(() => { hour = (Math.floor(hour) + 1) % 24; render(); }, 700);
    });
    $('evShare').addEventListener('input', e => { P.evShare = +e.target.value / 100; render(); });
    document.querySelectorAll('[data-ev-scale]').forEach(b => b.addEventListener('click', () => { P.chargerScale = +b.dataset.evScale; render(); }));
    $('evSmart').addEventListener('change', e => { P.smart = e.target.checked; render(); });
    document.querySelectorAll('[data-ev-preset]').forEach(b => b.addEventListener('click', () => { Object.assign(P, PRESETS[b.dataset.evPreset]); if (b.dataset.evPreset === 'ev30x3') sel = 'RA01'; render(); }));
    document.querySelectorAll('[data-ev-traffic]').forEach(b => b.addEventListener('click', () => { traffic = b.dataset.evTraffic; if (traffic === 'INCIDENT') { sel = 'RA15'; hour = 18; } render(); }));
    document.addEventListener('langchange', () => { render(); cq(); });
    cq();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
