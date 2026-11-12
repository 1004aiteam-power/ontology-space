// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 전력망 페이지: D/L #1 배전선로 상세 — 개폐기를 눌러 가압 범위·공급 선로·부하율·루프를 다시 계산 (⚠ 가상 데이터)
// 데이터: assets/data/feeder.json (examples/feeder/build_feeder.py 가 pycim 모델에서 생성)
import { $, esc, T } from './lib/dom.js?v=3b73d59c';
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const FCOL = { DL1: 'var(--fd-1)', DL2: 'var(--fd-2)', DL3: 'var(--fd-3)', C11: 'var(--fd-4)' };

  let D, open = {}, sel = null, fault = null, scen = 'normal';
  const node = (k) => D.alias[k] || k;                                      // 그림용 모선 연장점 → 실제 접속 노드

  function reset(s) {
    open = {};
    for (const e of D.eq) if (e.kind) open[e.id] = !!e.normalOpen;
    fault = null;
    if (s) { s.open.forEach(k => (open[k] = true)); s.close.forEach(k => (open[k] = false)); fault = s.fault || null; scen = s.id; }
  }

  // 각 인출 차단기에서 닫힌 설비를 따라 퍼진다. 다른 차단기·전원은 건너지 않는다 (= pycim topology.energized 와 같은 규칙)
  function trace() {
    const at = {};
    for (const e of D.eq) for (const t of e.t) (at[node(t)] ||= []).push(e);
    const reach = {};                                                       // 설비 id → 공급 선로 집합
    const nodesBy = {};
    for (const [fid, f] of Object.entries(D.feeders)) {
      const cb = D.eq.find(e => e.id === f.cb);
      if (open[cb.id]) continue;
      (reach[cb.id] ||= new Set()).add(fid);
      const seen = new Set(), stack = [node(cb.t[1])];
      while (stack.length) {
        const n = stack.pop();
        if (seen.has(n)) continue;
        seen.add(n); (nodesBy[n] ||= new Set()).add(fid);
        for (const e of at[n] || []) {
          if (e.id === cb.id || e.source || e.cls === 'Breaker') continue;
          if (e.id === fault) continue;                                     // 고장 구간은 전기가 통하지 않는 것으로 본다
          (reach[e.id] ||= new Set()).add(fid);
          if (e.kind && open[e.id]) continue;                               // 열린 개폐기 너머로는 가지 않는다
          for (const t of e.t) stack.push(node(t));
        }
      }
    }
    return { reach, nodesBy };
  }

  function build() {
    const svg = el('svg', { viewBox: '0 0 1000 500', role: 'img', 'aria-label': 'distribution feeder diagram' });
    $('fdMap').appendChild(svg);
    const P = D.pos;
    el('rect', { x: 34, y: 76, width: 12, height: 388, rx: 2, class: 'fd-bus' }, svg);
    el('rect', { x: 969, y: 236, width: 12, height: 68, rx: 2, class: 'fd-bus' }, svg);
    el('text', { x: 30, y: 486, class: 'fd-cap', 'data-l': 'busA' }, svg);
    el('text', { x: 996, y: 326, 'text-anchor': 'end', class: 'fd-cap', 'data-l': 'busC' }, svg);
    const gl = el('g', {}, svg), gs = el('g', {}, svg), gt = el('g', {}, svg);
    for (const e of D.eq) {
      if (e.cls === 'ACLineSegment') {
        const [a, b] = e.t.map(k => P[k]);
        e.g = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'fd-ln' }, gl);
        e.hit = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'fd-hit' }, gl);
        e.hit.addEventListener('click', () => { sel = e.id; render(); });
      } else if (e.kind) {
        const [a, b] = e.t.map(k => P[k]), x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
        const g = el('g', { class: `fd-sw ${e.kind}`, tabindex: 0, role: 'button' }, gs);
        el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'fd-stub' }, g);
        e.shape = e.kind === 'breaker' ? el('rect', { x: x - 8, y: y - 8, width: 16, height: 16, class: 'sym' }, g)
                                       : el('circle', { cx: x, cy: y, r: 8, class: 'sym' }, g);
        const vertical = Math.abs(a[0] - b[0]) < 1;
        const lbl = e.id.startsWith('CB') ? (e.id === 'CB_C11' ? '#11' : e.id.replace('CB_DL', 'D/L #')) : e.id;
        el('text', vertical ? { x: x + 13, y: y + 4, class: 'fd-lbl' } : { x, y: y - 14, 'text-anchor': 'middle', class: 'fd-lbl' }, g).textContent = lbl;
        g.setAttribute('aria-label', e.ko);
        const act = () => { open[e.id] = !open[e.id]; sel = e.id; scen = 'custom'; render(); };
        g.addEventListener('click', act);
        g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(); } });
        e.g = g;
      } else if (e.cls === 'EnergyConsumer') {
        const [x, y] = e.at;
        const g = el('g', { class: 'fd-ld' }, gt);
        e.shape = el('path', { d: `M${x - 6},${y - 5}L${x + 6},${y - 5}L${x},${y + 6}Z`, class: 'sym' }, g);
        e.txt = el('text', { x: x + 9, y: y + 4, class: 'fd-mw' }, g);
        e.txt.textContent = e.p + 'MW';
        g.addEventListener('click', () => { sel = e.id; render(); });
        e.g = g;
      }
    }
    D.fx = el('text', { class: 'fd-fault', 'text-anchor': 'middle' }, svg);
    D.fx.textContent = '⚡';
  }

  function render() {
    const { reach } = trace();
    const col = (id) => { const s = reach[id]; return !s || !s.size ? null : s.size > 1 && !open[id] ? 'loop' : [...s][0]; };   // 열린 개폐기는 양쪽에서 닿아도 루프가 아니다
    for (const e of D.eq) {
      const c = col(e.id);
      if (e.cls === 'ACLineSegment') {
        e.g.setAttribute('class', `fd-ln${c ? '' : ' dead'}${c === 'loop' ? ' loop' : ''}${e.id === fault ? ' faulted' : ''}${sel === e.id ? ' sel' : ''}`);
        e.g.style.stroke = c && c !== 'loop' ? FCOL[c] : '';
      } else if (e.kind) {
        e.g.classList.toggle('open', !!open[e.id]);
        e.g.classList.toggle('sel', sel === e.id);
        e.g.classList.toggle('moved', !!open[e.id] !== !!e.normalOpen);
        e.shape.style.fill = open[e.id] ? '' : c && c !== 'loop' ? FCOL[c] : '';
      } else if (e.cls === 'EnergyConsumer') {
        e.g.classList.toggle('dead', !c);
        e.shape.style.fill = c && c !== 'loop' ? FCOL[c] : '';
      }
    }
    if (fault) {
      const e = D.eq.find(x => x.id === fault), [a, b] = e.t.map(k => D.pos[k]);
      D.fx.setAttribute('x', (a[0] + b[0]) / 2); D.fx.setAttribute('y', (a[1] + b[1]) / 2 - 10); D.fx.style.display = '';
    } else D.fx.style.display = 'none';
    document.querySelectorAll('#feeder [data-l]').forEach(x => (x.textContent = { busA: T('A변전소 22.9kV 모선', 'Sub. A 22.9 kV bus'), busC: T('C변전소', 'Sub. C') }[x.dataset.l]));
    side(reach);
  }

  function side(reach) {
    const loads = D.eq.filter(e => e.cls === 'EnergyConsumer');
    const mw = { DL1: 0, DL2: 0, DL3: 0, C11: 0 };
    let dead = 0, deadN = 0, loop = false;
    for (const l of loads) {
      const s = reach[l.id];
      if (!s || !s.size) { dead += l.p; deadN++; continue; }
      if (s.size > 1) loop = true;
      for (const f of s) mw[f] += l.p / s.size;
    }
    for (const e of D.eq) if (reach[e.id] && reach[e.id].size > 1 && !open[e.id]) loop = true;
    const over = Object.entries(mw).filter(([, v]) => v > D.limitMW + 1e-9);
    $('fdBars').innerHTML = Object.entries(D.feeders).map(([k, f]) => {
      const v = mw[k], pct = Math.min(100, v / D.limitMW * 100);
      return `<div class="fd-bar${v > D.limitMW + 1e-9 ? ' over' : ''}"><span><i style="background:${FCOL[k]}"></i>${esc(T(f.ko, f.ko.replace('C변전소', 'Sub. C')))}</span>
        <b>${v.toFixed(1)} / ${D.limitMW} MW</b><div class="track"><div style="width:${pct}%;background:${FCOL[k]}"></div></div></div>`;
    }).join('');
    const msgs = [];
    msgs.push(dead > 0.001 ? `<span class="bad">⚠ ${T('정전', 'Outage')} ${dead.toFixed(1)} MW · ${T('부하', 'loads')} ${deadN}${T('곳', '')}</span>`
                           : `<span class="ok">✓ ${T('모든 부하 가압', 'All loads energized')}</span>`);
    if (loop) msgs.push(`<span class="bad">⚠ ${T('루프(병렬) 운전: 두 선로가 이어졌습니다. 배전선로는 방사형으로 운전하므로, 절체가 끝나면 한쪽 개폐기를 열어야 합니다.', 'Loop (parallel) operation: two feeders are tied. Distribution runs radially, so open one switch once the transfer is done.')}</span>`);
    if (over.length) msgs.push(`<span class="bad">⚠ ${T('과부하', 'Overload')}: ${over.map(([k]) => esc(D.feeders[k].ko)).join(', ')} (${T('한도', 'limit')} ${D.limitMW} MW)</span>`);
    $('fdStatus').innerHTML = msgs.join('<br>');
    document.querySelectorAll('[data-fd-scen]').forEach(b => b.setAttribute('aria-pressed', b.dataset.fdScen === scen));
    info(reach);
  }

  function info(reach) {
    const box = $('fdInfo');
    if (!sel) { box.innerHTML = T('개폐기(●·○)를 누르면 열리고 닫힙니다. 선로·부하를 누르면 CIM 표현이 나옵니다.', 'Click a switch (●·○) to open or close it. Click a line or load to see its CIM form.'); return; }
    const e = D.eq.find(x => x.id === sel), s = reach[sel], who = s && s.size ? [...s].map(k => D.feeders[k].ko).join(' + ') : T('없음 (정전)', 'none (dead)');
    let extra = '';
    if (e.kind) extra = ` · <b>${open[e.id] ? T('열림', 'OPEN') : T('닫힘', 'CLOSED')}</b> (<code>cim:Switch.open ${!!open[e.id]}</code>, <code>normalOpen ${!!e.normalOpen}</code>)<br><small>mRID ${D.mrid[e.id] || ''}</small>`;
    if (e.cls === 'ACLineSegment') extra = ` · ${e.km} km`;
    if (e.cls === 'EnergyConsumer') extra = ` · P = ${e.p} MW`;
    box.innerHTML = `<code>cim:${e.cls}</code> <b>${esc(T(e.ko, e.en))}</b>${extra}<br>${T('공급 선로', 'Supplied by')}: ${esc(who)}`;
  }

  async function main() {
    if (!$('feeder')) return;
    try { D = await (await fetch('assets/data/feeder.json')).json(); } catch (err) { $('fdMap').textContent = 'feeder.json?'; return; }
    reset(); build();
    $('fdScen').innerHTML = D.scenarios.map(s => `<button type="button" data-fd-scen="${s.id}" aria-pressed="false"><span lang="ko">${esc(s.ko)}</span><span lang="en">${esc(s.en)}</span></button>`).join('');
    document.querySelectorAll('[data-fd-scen]').forEach(b => b.addEventListener('click', () => { reset(D.scenarios.find(s => s.id === b.dataset.fdScen)); sel = null; render(); }));
    document.addEventListener('langchange', render);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
