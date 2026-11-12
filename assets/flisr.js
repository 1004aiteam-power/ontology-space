// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 전력망 페이지: D/L #1 고장 복구(FLISR) 시뮬레이션 — 고장 구간을 누르면 트립 → 분리 → 상위 복구 → 하위 절체 → 수리를 재생 (⚠ 가상 데이터)
// 복구 순서는 examples/feeder/build_feeder.py 의 flisr_plan() 이 계산해 assets/data/feeder.json 의 flisr 에 넣는다. 여기서는 재생만 한다.
import { $, esc, T } from './lib/dom.js?v=3b73d59c';
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const FCOL = { DL1: 'var(--fd-1)', DL2: 'var(--fd-2)', DL3: 'var(--fd-3)', C11: 'var(--fd-4)' };
  const fmt = (n) => Math.round(n).toLocaleString();

  const STEP = {
    trip: { ko: 'CB 트립', en: 'Breaker trips', dko: 'D/L #1 CB가 고장 전류를 끊습니다. D/L #1 전체가 정전됩니다.', den: 'The feeder #1 breaker clears the fault current; all of feeder #1 goes dark.' },
    isolate: { ko: '고장 구간 분리', en: 'Isolate the fault', dko: '고장 구간 양쪽의 개폐기를 열어 고장 난 부분만 떼어 냅니다.', den: 'Open the switches on both sides of the faulted section to cut out just that part.' },
    upstream: { ko: '상위 복구', en: 'Restore upstream', dko: 'CB를 다시 닫아 고장 구간 앞쪽(변전소 쪽)에 전기를 보냅니다.', den: 'Re-close the breaker to feed everything in front of the fault (substation side).' },
    transfer: { ko: '하위 절체', en: 'Transfer downstream', dko: '고장 구간 뒤쪽은 연계 개폐기를 닫아 이웃 선로에서 받습니다. 이웃 선로가 한도(10MW)를 넘지 않는 조합만 고릅니다.', den: 'Close tie switches so neighbouring feeders pick up the part behind the fault, only in combinations that keep them under the 10 MW limit.' },
    repair: { ko: '수리 완료 · 평상시 복귀', en: 'Repaired · back to normal', dko: '고장 구간을 고친 뒤 개폐기를 평상시 상태로 되돌립니다.', den: 'After repair, switches return to their normal state.' },
  };

  let D, seg = null, k = 0, mode = 'auto', timer = null;
  const node = (n) => D.alias[n] || n;
  const plan = () => (seg ? D.flisr[seg] : null);

  function trace(openSet, fault) {
    const at = {};
    for (const e of D.eq) for (const t of e.t) (at[node(t)] ||= []).push(e);
    const reach = {};
    for (const [fid, f] of Object.entries(D.feeders)) {
      const cb = D.eq.find(e => e.id === f.cb);
      if (openSet.has(cb.id)) continue;
      (reach[cb.id] ||= new Set()).add(fid);
      const seen = new Set(), stack = [node(cb.t[1])];
      while (stack.length) {
        const n = stack.pop();
        if (seen.has(n)) continue;
        seen.add(n);
        for (const e of at[n] || []) {
          if (e.id === cb.id || e.source || e.cls === 'Breaker' || e.id === fault) continue;
          (reach[e.id] ||= new Set()).add(fid);
          if (e.kind && openSet.has(e.id)) continue;
          for (const t of e.t) stack.push(node(t));
        }
      }
    }
    return reach;
  }

  function build() {
    const svg = el('svg', { viewBox: '0 0 1000 500', role: 'img', 'aria-label': 'fault restoration diagram' });
    $('flMap').appendChild(svg);
    const P = D.pos;
    el('rect', { x: 34, y: 76, width: 12, height: 388, rx: 2, class: 'fd-bus' }, svg);
    el('rect', { x: 969, y: 236, width: 12, height: 68, rx: 2, class: 'fd-bus' }, svg);
    D.zoneG = el('g', {}, svg);
    const gl = el('g', {}, svg), gs = el('g', {}, svg), gt = el('g', {}, svg);
    D.v = {};
    for (const e of D.eq) {
      const v = D.v[e.id] = {};
      if (e.cls === 'ACLineSegment') {
        const [a, b] = e.t.map(n => P[n]);
        v.g = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'fd-ln' }, gl);
        if (e.line === 'DL1') {
          const hit = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'fd-hit fl-hit', tabindex: 0, role: 'button' }, gl);
          hit.setAttribute('aria-label', e.ko);
          const go = () => start(e.id);
          hit.addEventListener('click', go);
          hit.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
        }
      } else if (e.kind) {
        const [a, b] = e.t.map(n => P[n]), x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
        const g = el('g', { class: `fd-sw ${e.kind}` }, gs);
        el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'fd-stub' }, g);
        v.shape = e.kind === 'breaker' ? el('rect', { x: x - 8, y: y - 8, width: 16, height: 16, class: 'sym' }, g)
                                       : el('circle', { cx: x, cy: y, r: 8, class: 'sym' }, g);
        const vertical = Math.abs(a[0] - b[0]) < 1;
        const lbl = e.id.startsWith('CB') ? (e.id === 'CB_C11' ? '#11' : e.id.replace('CB_DL', 'D/L #')) : e.id;
        el('text', vertical ? { x: x + 13, y: y + 4, class: 'fd-lbl' } : { x, y: y - 14, 'text-anchor': 'middle', class: 'fd-lbl' }, g).textContent = lbl;
        v.ring = el('circle', { cx: x, cy: y, r: 15, class: 'fl-ring' }, g);
        v.g = g;
      } else if (e.cls === 'EnergyConsumer') {
        const [x, y] = e.at;
        const g = el('g', { class: 'fd-ld' }, gt);
        v.shape = el('path', { d: `M${x - 6},${y - 5}L${x + 6},${y - 5}L${x},${y + 6}Z`, class: 'sym' }, g);
        v.txt = el('text', { x: x + 9, y: y + 4, class: 'fd-mw' }, g);
        v.title = el('title', {}, g);
        if (e.critical) el('text', { x: x - 20, y: y + 5, class: 'fl-crit' }, g).textContent = '✚';
        v.g = g;
      }
    }
    D.fx = el('text', { class: 'fd-fault', 'text-anchor': 'middle' }, svg);
    D.fx.textContent = '⚡';
  }

  function zoneBox(p) {
    D.zoneG.innerHTML = '';
    if (!p) return;
    const pts = [];
    for (const id of p.zone) { const e = D.eq.find(x => x.id === id); if (e.cls === 'ACLineSegment') e.t.forEach(n => pts.push(D.pos[n])); }
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 12, y1 = Math.max(...ys) + 12;
    el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 8, class: 'fl-zone' }, D.zoneG);
  }

  function render() {
    const p = plan(), s = p ? p.steps[k] : null;
    const openSet = new Set(s ? s.open : D.eq.filter(e => e.kind && e.normalOpen).map(e => e.id));
    const fault = s && s.id !== 'repair' ? seg : null;
    const reach = trace(openSet, fault);
    const ops = new Set(s ? s.ops.map(o => o[0]) : []);
    for (const e of D.eq) {
      const v = D.v[e.id], r = reach[e.id], c = r && r.size ? [...r][0] : null;
      if (e.cls === 'ACLineSegment') {
        v.g.setAttribute('class', `fd-ln${c ? '' : ' dead'}${e.id === fault ? ' faulted' : ''}`);
        v.g.style.stroke = c ? FCOL[c] : '';
      } else if (e.kind) {
        const o = openSet.has(e.id);
        v.g.classList.toggle('open', o);
        v.g.classList.toggle('moved', o !== !!e.normalOpen);
        v.shape.style.fill = o ? '' : c ? FCOL[c] : '';
        v.ring.classList.toggle('on', ops.has(e.id));
      } else if (e.cls === 'EnergyConsumer') {
        v.g.classList.toggle('dead', !c);
        v.shape.style.fill = c ? FCOL[c] : '';
        v.txt.textContent = e.cust != null ? e.cust.toLocaleString() + T('호', '') : '';
        v.title.textContent = `${T(e.area, e.areaEn)} · ${e.p} MW`;
      }
    }
    if (fault) {
      const e = D.eq.find(x => x.id === fault), [a, b] = e.t.map(n => D.pos[n]);
      D.fx.setAttribute('x', (a[0] + b[0]) / 2); D.fx.setAttribute('y', (a[1] + b[1]) / 2 - 10); D.fx.style.display = '';
    } else D.fx.style.display = 'none';
    zoneBox(p && s.id !== 'repair' ? p : null);
    side(p, s);
    chart(p);
  }

  function opText(o) {
    const e = D.eq.find(x => x.id === o[0]);
    const name = e.kind === 'breaker' ? 'D/L #1 CB' : o[0];
    return `${esc(name)} ${o[1] ? T('열기', 'open') : T('닫기', 'close')} <code>cim:Switch.open ${o[1]}</code>`;
  }

  function side(p, s) {
    const t = D.flisrTimes[mode];
    if (!p) {
      $('flSteps').innerHTML = `<p class="muted">${T('D/L #1의 선로(파란 선)를 하나 누르면 그곳에 고장을 냅니다.', 'Click any feeder #1 line (blue) to put a fault there.')}</p>`;
      $('flNow').innerHTML = `<b>${T('D/L #1 고객', 'Feeder #1 customers')}</b> ${fmt(D.dl1Cust)}${T('호', '')}`;
      return;
    }
    const segE = D.eq.find(x => x.id === seg);
    $('flSteps').innerHTML = `<p class="fl-where">⚡ <b>${esc(T(segE.ko, segE.en))}</b></p><ol class="fl-list">` + p.steps.map((x, i) => {
      const m = STEP[x.id];
      return `<li class="${i === k ? 'cur' : i < k ? 'done' : ''}"><button type="button" data-fl-step="${i}"><span class="tm">${t[x.id]}${T('분', ' min')}</span><b>${T(m.ko, m.en)}</b>
        <span class="dc">${T('정전', 'out')} ${fmt(x.deadCust)}${T('호', '')}</span></button>
        ${i === k ? `<div class="fl-desc">${T(m.dko, m.den)}${x.ops.length ? '<br>' + x.ops.map(opText).join('<br>') : ''}</div>` : ''}</li>`;
    }).join('') + '</ol>';
    $('flSteps').querySelectorAll('[data-fl-step]').forEach(b => b.addEventListener('click', () => { stop(); k = +b.dataset.flStep; render(); }));
    const dead = s.dead.map(id => D.eq.find(e => e.id === id));
    const crit = dead.filter(e => e.critical);
    const over = Object.entries(s.feederMW).filter(([f, v]) => v > D.limitMW + 1e-9);
    $('flNow').innerHTML = `<div class="fl-big${s.deadCust ? ' bad' : ' ok'}">${fmt(s.deadCust)}<small>${T('호 정전', ' customers out')}</small></div>
      <div class="muted">${s.deadMW} MW · ${dead.length ? dead.map(e => esc(T(e.area, e.areaEn))).join(', ') : T('정전 없음', 'no outage')}</div>
      ${crit.length ? `<div class="fl-alert">✚ ${T('중요 고객 정전', 'Critical customer out')}: ${crit.map(e => esc(T(e.area, e.areaEn))).join(', ')}</div>` : ''}
      <div class="fl-feed">${Object.entries(s.feederMW).map(([f, v]) => `<span><i style="background:${FCOL[f]}"></i>${esc(f === 'C11' ? T('C #11', 'C #11') : D.feeders[f].ko)} ${v.toFixed(1)}MW</span>`).join('')}</div>
      ${over.length ? `<div class="fl-alert">⚠ ${T('과부하', 'Overload')}</div>` : ''}`;
  }

  // 정전 고객 수를 시간축(0~수리 완료)에 계단 그래프로: 자동·수동 두 방식을 겹쳐 그린다
  function chart(p) {
    const box = $('flChart');
    if (!p) { box.innerHTML = ''; $('flCmi').innerHTML = ''; return; }
    const W = 640, H = 200, L = 52, R = 12, Tp = 14, B = 34;
    const tEnd = D.flisrTimes.auto.repair, yMax = D.dl1Cust;
    // 앞의 10분(자동 조작이 일어나는 구간)을 30% 폭으로 넓혀 그린다
    const fx = (t) => t <= 10 ? 0.3 * t / 10 : 0.3 + 0.7 * (t - 10) / (tEnd - 10);
    const X = (t) => L + (W - L - R) * fx(t), Y = (v) => Tp + (H - Tp - B) * (1 - v / yMax);
    let h = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="customers out over time">`;
    for (const v of [0, 0.5, 1]) h += `<line x1="${L}" x2="${W - R}" y1="${Y(v * yMax)}" y2="${Y(v * yMax)}" class="fl-grid"/><text x="${L - 6}" y="${Y(v * yMax) + 4}" text-anchor="end" class="fl-ax">${fmt(v * yMax)}</text>`;
    for (const t of [0, 2, 5, 10, 60, 120, 180, 240]) h += `<text x="${X(t)}" y="${H - B + 16}" text-anchor="middle" class="fl-ax">${t}</text>`;
    h += `<line x1="${X(10)}" x2="${X(10)}" y1="${Tp}" y2="${H - B}" class="fl-grid" stroke-dasharray="2 3"/>`;
    h += `<text x="${W - R}" y="${H - 4}" text-anchor="end" class="fl-ax">${T('고장 후 경과 시간(분) · 앞 10분 확대', 'minutes after the fault · first 10 min enlarged')}</text>`;
    for (const m of ['manual', 'auto']) {
      const t = D.flisrTimes[m];
      let d = '', area = `M${X(0)},${Y(0)}`;
      p.steps.forEach((s, i) => {
        const x0 = X(t[s.id]), x1 = i + 1 < p.steps.length ? X(t[p.steps[i + 1].id]) : X(tEnd);
        d += `${i ? 'L' : 'M'}${x0},${Y(s.deadCust)}L${x1},${Y(s.deadCust)}`;
        area += `L${x0},${Y(s.deadCust)}L${x1},${Y(s.deadCust)}`;
      });
      area += `L${X(tEnd)},${Y(0)}Z`;
      h += `<path d="${area}" class="fl-area ${m}${m === mode ? ' cur' : ''}"/><path d="${d}" class="fl-step ${m}${m === mode ? ' cur' : ''}"/>`;
    }
    const s = p.steps[k], tx = X(D.flisrTimes[mode][s.id]);
    h += `<line x1="${tx}" x2="${tx}" y1="${Tp}" y2="${H - B}" class="fl-now"/></svg>`;
    box.innerHTML = h;
    const a = p.cmi.auto, mn = p.cmi.manual;
    $('flCmi').innerHTML = `<div><span class="sw auto"></span>${T('배전자동화', 'Automated')} <b>${fmt(a)}</b> ${T('고객·분', 'customer-min')} <small>(${T('고객 1호당', 'per customer')} ${(a / D.dl1Cust).toFixed(1)}${T('분', ' min')})</small></div>
      <div><span class="sw manual"></span>${T('현장 수동 조작', 'Manual switching')} <b>${fmt(mn)}</b> ${T('고객·분', 'customer-min')} <small>(${(mn / D.dl1Cust).toFixed(1)}${T('분', ' min')})</small></div>
      <div class="muted">${T('자동화로 줄어드는 정전', 'Saved by automation')}: <b>${Math.round((1 - a / mn) * 100)}%</b></div>`;
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } $('flPlay').textContent = '▶'; }
  function play() {
    if (!plan()) return;
    if (timer) return stop();
    if (k >= plan().steps.length - 1) k = 0;
    $('flPlay').textContent = '❚❚';
    render();
    timer = setInterval(() => { if (k >= plan().steps.length - 1) return stop(); k++; render(); }, 1400);
  }
  function start(id) { stop(); seg = id; k = 0; render(); play(); }

  async function main() {
    if (!$('flisr')) return;
    try { D = await (await fetch('assets/data/feeder.json')).json(); } catch (err) { $('flMap').textContent = 'feeder.json?'; return; }
    build();
    $('flPlay').addEventListener('click', play);
    $('flPrev').addEventListener('click', () => { stop(); if (plan() && k > 0) { k--; render(); } });
    $('flNext').addEventListener('click', () => { stop(); if (plan() && k < plan().steps.length - 1) { k++; render(); } });
    document.querySelectorAll('[data-fl-mode]').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.flMode;
      document.querySelectorAll('[data-fl-mode]').forEach(x => x.setAttribute('aria-pressed', x === b));
      render();
    }));
    document.querySelectorAll('[data-fl-seg]').forEach(b => b.addEventListener('click', () => start(b.dataset.flSeg)));
    document.addEventListener('langchange', render);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
