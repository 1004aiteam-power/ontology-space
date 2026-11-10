// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 설비 고장 영향 분석: 자산 → 기능 위치 → D/L #1 구간 → 지역·고객, 연계 개폐기 절체 후 위험도 다시 매기기 (⚠ 가상 데이터)
// 데이터: assets/data/impact.json (examples/impact/build_impact.py)
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = (ko, en) => (window.t ? window.t({ ko, en }) : ko);
  const FCOL = { DL2: 'var(--fd-2)', DL3: 'var(--fd-3)', C11: 'var(--fd-4)', DL1: 'var(--fd-1)' };
  const LV = { '높음': ['hi', 'High'], '중간': ['mid', 'Medium'], '낮음': ['lo', 'Low'] };
  const lvText = (l) => T(l, LV[l][1]);
  const fmt = (n) => Math.round(n).toLocaleString();

  let D, sel = { kind: 'chain', id: 'TR_1' }, phase = 'normal', mode = 'auto', hour = 18;
  let anim = null, stepSec = 2;                                    // 개폐기 조작 과정 애니메이션: { steps, k, timer }
  const POS = {};

  // ---- 그래프 배치 -------------------------------------------------------------------------------
  function layout() {
    const W = 960;
    D.chain.forEach((n, i) => (POS[n.id] = { x: 20, y: 30 + i * 80, w: 190, h: 54 }));
    D.zones.forEach((z, i) => (POS[z.id] = { x: 300, y: 24 + i * 70, w: 150, h: 46 }));
    let y = 20;
    D.zones.forEach(z => z.loads.forEach(id => { POS[id] = { x: 540, y, w: 190, h: 34 }; y += 46; }));
    const nb = Object.keys(D.neighbours);
    const zy = (zid) => POS[zid].y;
    POS.DL2 = { x: 810, y: zy('Z4') + 20, w: 130, h: 44 };
    POS.DL3 = { x: 810, y: zy('Z2') - 10, w: 130, h: 44 };
    POS.C11 = { x: 810, y: zy('Z7') - 10, w: 130, h: 44 };
    return { W, H: Math.max(y, 30 + D.chain.length * 80, POS.C11.y + 60) + 10, nb };
  }

  const mid = (p, side) => side === 'r' ? [p.x + p.w, p.y + p.h / 2] : side === 'l' ? [p.x, p.y + p.h / 2] : side === 'b' ? [p.x + p.w / 2, p.y + p.h] : [p.x + p.w / 2, p.y];
  const curve = ([x1, y1], [x2, y2]) => `M${x1},${y1}C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;

  // 선택에 따라 각 구간·부하·연계의 상태를 정한다
  // ---- 개폐기 조작 과정: 한 동작씩 단계로 나눈다 -------------------------------------------------------
  const TIES = ['T1', 'T2', 'T3', 'T4'];
  const swName = (k) => k === 'CB_DL1' ? 'D/L #1 CB' : k;
  function buildSteps() {
    const steps = [], open = new Set(TIES);
    const push = (cat, ko, en, op, fault) => steps.push({ cat, ko, en, op, fault, open: new Set(open) });
    push('normal', '평상시: D/L #1이 모든 구간 공급, 연계 개폐기 T1~T4 열림', 'Normal: feeder #1 supplies every zone, ties T1–T4 open', null, false);
    const act = (k, o) => { if (o) open.add(k); else open.delete(k); };
    const opText = (k, o) => [`${swName(k)} ${o ? '열기' : '닫기'}`, `${o ? 'open' : 'close'} ${swName(k)}`];
    if (sel.kind === 'chain') {
      const n = D.chain.find(x => x.id === sel.id);
      push('fault', `고장 발생: ${n.ko} → D/L #1 전원 상실`, `Failure: ${n.ko} → feeder #1 loses its source`, null, true);
      act('CB_DL1', true);
      push('isolate', '고장 구간 차단: D/L #1 CB 열기 (고장 난 상위 설비와 분리)', 'Isolate: open the feeder #1 CB (cut off the failed upstream)', 'CB_DL1', true);
      for (const [k, o] of D.sourceLoss.ops) {
        act(k, o);
        const [ko, en] = opText(k, o);
        if (o) push('prep', `나눌 곳 열기: ${ko} (한 선로로는 다 못 받아 둘로 나눔)`, `Split: ${en} (no single neighbour can take it all)`, k, true);
        else push('transfer', `다른 D/L에서 공급: ${ko} → ${D.neighbours[D.tieFeeder[k]].ko}`, `Supply from another feeder: ${en} → ${D.neighbours[D.tieFeeder[k]].ko}`, k, true);
      }
    } else {
      const zf = D.zoneFault[sel.id];
      for (const stp of zf.steps.filter(x => x.id !== 'repair')) {
        for (const [k, o] of stp.ops) {
          act(k, o);
          const [ko, en] = opText(k, o);
          if (stp.id === 'trip') push('fault', `고장 발생: ${sel.id} 지락 고장 → D/L #1 CB 트립`, `Ground fault in ${sel.id} → feeder #1 CB trips`, k, true);
          else if (stp.id === 'isolate') push('isolate', `고장 구간 차단: ${ko}`, `Isolate the faulted zone: ${en}`, k, true);
          else if (stp.id === 'upstream') push('upstream', `앞쪽 복구: ${ko} (변전소 쪽 다시 공급)`, `Restore upstream: ${en}`, k, true);
          else push('transfer', `다른 D/L에서 공급: ${ko} → ${D.neighbours[D.tieFeeder[k]].ko}`, `Supply from another feeder: ${en} → ${D.neighbours[D.tieFeeder[k]].ko}`, k, true);
        }
      }
    }
    return steps;
  }

  // 개폐 상태에서 구간별 공급 선로를 다시 계산: D/L #1 CB → Z1, 닫힌 구간 개폐기로 이웃 구간, 닫힌 연계 개폐기로 이웃 선로
  function animState(stp) {
    const st = { dead: new Set(), supply: {}, used: new Set(), opened: new Set(), affectedChain: new Set(), fault: stp.fault, op: stp.op, nbMW: {} };
    const zoneFault = sel.kind === 'zone' && stp.fault ? sel.id : null, srcLost = sel.kind === 'chain' && stp.fault;
    if (srcLost) { const i = D.chain.findIndex(n => n.id === sel.id); D.chain.forEach((n, j) => { if (j >= i) st.affectedChain.add(n.id); }); }
    for (const k of stp.open) if (!TIES.includes(k)) st.opened.add(k);
    for (const t of TIES) if (!stp.open.has(t)) st.used.add(t);
    const q = [];
    if (!stp.open.has('CB_DL1') && !srcLost) q.push(['Z1', 'DL1']);
    for (const z of D.zones) for (const t of z.ties) if (!stp.open.has(t)) q.push([z.id, D.tieFeeder[t]]);
    while (q.length) {
      const [zid, f] = q.shift();
      if (zid === zoneFault || st.supply[zid]) continue;
      st.supply[zid] = f;
      const z = D.zones.find(x => x.id === zid);
      for (const d of z.down) if (!stp.open.has(d)) q.push([D.zones.find(y => y.up === d).id, f]);
      if (!stp.open.has(z.up) && z.up !== 'CB_DL1') q.push([D.zones.find(y => y.down.includes(z.up)).id, f]);
    }
    for (const z of D.zones) { if (!st.supply[z.id]) { st.supply[z.id] = null; z.loads.forEach(l => st.dead.add(l)); } }
    for (const [k, v] of Object.entries(D.neighbours)) st.nbMW[k] = v.mw + D.zones.filter(z => st.supply[z.id] === k).reduce((a, z) => a + z.mw, 0);
    return st;
  }

  function state() {
    if (anim) return animState(anim.steps[anim.k]);
    const st = { dead: new Set(), supply: {}, used: new Set(), opened: new Set(), affectedChain: new Set(), fault: null };
    if (phase === 'normal') {                                        // 평상시: D/L #1 이 모든 구간을 공급하고, 연계 개폐기 T1~T4 는 모두 열림
      D.zones.forEach(z => (st.supply[z.id] = 'DL1'));
      return st;
    }
    if (sel.kind === 'chain') {
      const i = D.chain.findIndex(n => n.id === sel.id);
      D.chain.forEach((n, j) => { if (j >= i) st.affectedChain.add(n.id); });
      st.fault = sel.id;
      if (phase === 'before') { D.zones.forEach(z => { st.supply[z.id] = null; z.loads.forEach(l => st.dead.add(l)); }); }
      else {
        const s = D.sourceLoss;
        Object.assign(st.supply, s.supply);
        s.after.dead.forEach(l => st.dead.add(l));
        s.ops.forEach(([k, open]) => (open ? st.opened : st.used).add(k));
        st.opened.add('CB_DL1');
      }
    } else {
      const zf = D.zoneFault[sel.id];
      st.fault = sel.id;
      if (phase === 'before') { D.zones.forEach(z => { st.supply[z.id] = null; z.loads.forEach(l => st.dead.add(l)); }); }
      else {
        Object.assign(st.supply, zf.supply);
        zf.after.dead.forEach(l => st.dead.add(l));
        zf.steps.filter(s => s.id !== 'repair').forEach(s => s.ops.forEach(([k, open]) => { if (open) st.opened.add(k); else if (k.startsWith('T')) st.used.add(k); }));
      }
    }
    return st;
  }

  // 개폐기 기호. 닫힘 = 채운 ●(차단기 ■, 공급 선로 색), 열림 = 빈 ○. 조작 중인 개폐기는 주황 고리가 퍼진다.
  function swSym(x, y, id, open, kind, color, st) {
    const op = st.op === id, r = 7;
    let h = `<g class="im-swg${open ? ' open' : ' closed'}${op ? ' op' : ''}">`;
    if (op) h += `<circle cx="${x}" cy="${y}" r="${r + 2}" class="ring"/><circle cx="${x}" cy="${y}" r="${r + 2}" class="ring r2"/>`;
    h += kind === 'cb' ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="2" class="sym" style="${!open && color ? `fill:${color}` : ''}"/>`
                       : `<circle cx="${x}" cy="${y}" r="${r}" class="sym" style="${!open && color ? `fill:${color}` : ''}"/>`;
    return h + '</g>';
  }

  function draw() {
    const { W, H } = layout.cache || (layout.cache = layout());
    const st = state();
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="impact graph" style="min-width:820px">
      <defs><marker id="imA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--muted)"/></marker></defs>`;
    // 열 제목
    s += `<text x="20" y="18" class="im-col">${T('자산 · 기능 위치 (자산관리)', 'Assets · functional locations')}</text>
      <text x="300" y="12" class="im-col">${T('D/L #1 구간 (배전선로 모델)', 'Feeder #1 zones')}</text>
      <text x="540" y="10" class="im-col">${T('지역 · 고객', 'Areas · customers')}</text>
      <text x="810" y="${POS.DL3.y - 14}" class="im-col">${T('이웃 선로', 'Neighbours')}</text>`;
    // 간선
    for (let i = 0; i + 1 < D.chain.length; i++) {
      const a = POS[D.chain[i].id], b = POS[D.chain[i + 1].id], hot = st.affectedChain.has(D.chain[i + 1].id);
      s += `<path d="M${a.x + 30},${a.y + a.h}V${b.y}" class="im-e${hot ? ' hot' : ''}" marker-end="url(#imA)"/>`;
    }
    const cb = POS[D.chain[D.chain.length - 1].id], z1 = POS.Z1;
    s += `<path d="${curve(mid(cb, 'r'), mid(z1, 'l'))}" class="im-e${st.affectedChain.size ? ' hot' : ''}${st.opened.has('CB_DL1') ? ' cut' : ''}" marker-end="url(#imA)"/>
      <text x="${(cb.x + cb.w + z1.x) / 2 - 30}" y="${(cb.y + cb.h / 2 + z1.y + z1.h / 2) / 2 - 14}" class="im-sw${st.op === 'CB_DL1' ? ' op' : ''}">≡ CB_DL1</text>`;
    { const [x1, y1] = mid(cb, 'r'), [x2, y2] = mid(z1, 'l');
      s += swSym((x1 + x2) / 2, (y1 + y2) / 2, 'CB_DL1', st.opened.has('CB_DL1'), 'cb', st.supply.Z1 === 'DL1' ? FCOL.DL1 : null, st); }
    D.zones.forEach((z, i) => {
      const a = POS[z.id];
      for (const d of z.down) {
        const nx = D.zones.find(y => y.up === d), b = POS[nx.id], open = st.opened.has(d);
        s += `<path d="M${a.x + 20},${a.y + a.h}V${b.y}" class="im-e${open ? ' cut' : ''}" marker-end="url(#imA)"/>
          <text x="${a.x + 32}" y="${(a.y + a.h + b.y) / 2 + 4}" class="im-sw${st.op === d ? ' op' : ''}">${d}</text>`;
        s += swSym(a.x + 20, (a.y + a.h + b.y) / 2, d, open, 'sw', st.supply[z.id] && st.supply[z.id] === st.supply[nx.id] ? FCOL[st.supply[z.id]] : null, st);
      }
      for (const l of z.loads) s += `<path d="${curve(mid(a, 'r'), mid(POS[l], 'l'))}" class="im-e${st.dead.has(l) ? ' hot' : ''}"/>`;
      for (const t of z.ties) {
        const f = D.tieFeeder[t], b = POS[f], used = st.used.has(t);
        const p1 = [a.x + a.w + 23, a.y + 8], p2 = mid(b, 'l');
        s += `<path d="M${a.x + a.w},${a.y + 8}H${a.x + a.w + 9}" class="im-tie${used ? ' used' : ''}" style="${used ? `stroke:${FCOL[f]}` : ''}"/>`;
        s += `<path d="${curve(p1, p2)}" class="im-tie${used ? ' used' : ''}" style="${used ? `stroke:${FCOL[f]}` : ''}"/>
          <text x="${a.x + a.w + 8}" y="${a.y - 2}" class="im-sw${used ? ' on' : ''}${st.op === t ? ' op' : ''}">${t}</text>`;
        s += swSym(a.x + a.w + 16, a.y + 8, t, !used, 'sw', used ? FCOL[f] : null, st);
      }
    });
    // 노드: 자산·기능 위치
    for (const n of D.chain) {
      const p = POS[n.id], a = n.asset, hot = st.affectedChain.has(n.id), isSel = sel.kind === 'chain' && sel.id === n.id;
      const lv = a ? LV[a.base.level][0] : 'gap';
      s += `<g class="im-n chain${hot ? ' hot' : ''}${isSel ? ' sel' : ''}" data-chain="${n.id}" tabindex="0" role="button" aria-label="${esc(n.ko)}">
        <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8"/>
        <rect x="${p.x}" y="${p.y}" width="6" height="${p.h}" rx="3" class="lv ${lv}"/>
        <text x="${p.x + 14}" y="${p.y + 20}" class="t1">${esc(n.ko)}</text>
        <text x="${p.x + 14}" y="${p.y + 40}" class="t2">${a ? `${a.id} · ${T('위험도', 'risk')} ${a.base.risk}` : T('자산 미등록', 'no asset recorded')}</text>
        ${isSel && (anim ? st.fault : phase !== 'normal') ? `<text x="${p.x + p.w - 10}" y="${p.y + 20}" text-anchor="end" class="fx">⚡</text>` : ''}</g>`;
    }
    // 노드: 구간
    for (const z of D.zones) {
      const p = POS[z.id], sup = st.supply[z.id], isSel = sel.kind === 'zone' && sel.id === z.id;
      s += `<g class="im-n zone${sup ? '' : ' dead'}${isSel ? ' sel' : ''}" data-zone="${z.id}" tabindex="0" role="button" aria-label="${z.id}">
        <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" style="${sup ? `stroke:${FCOL[sup]};stroke-width:2.5` : ''}"/>
        <text x="${p.x + 10}" y="${p.y + 19}" class="t1">${z.id} <tspan class="t2">${T(z.up + ' 뒤', 'after ' + z.up)}</tspan></text>
        <text x="${p.x + 10}" y="${p.y + 37}" class="t2">${fmt(z.cust)}${T('호', ' cust.')} · ${z.mw} MW${sup ? ` · <tspan style="fill:${FCOL[sup]};font-weight:600">${sup === 'C11' ? 'C #11' : sup.replace('DL', 'D/L #')}</tspan>` : ''}</text>
        ${isSel && (anim ? st.fault : phase !== 'normal') ? `<text x="${p.x + p.w - 10}" y="${p.y + 19}" text-anchor="end" class="fx">⚡</text>` : ''}</g>`;
    }
    // 노드: 부하
    for (const l of D.loads) {
      const p = POS[l.id], dead = st.dead.has(l.id), sup = st.supply[l.zone];
      s += `<g class="im-n load${dead ? ' dead' : ''}">
        <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6" style="${!dead && sup ? `stroke:${FCOL[sup]}` : ''}"/>
        <text x="${p.x + 10}" y="${p.y + 22}" class="t1">${l.critical ? '<tspan class="crit">✚ </tspan>' : ''}${esc(T(l.area, l.areaEn))}</text>
        <text x="${p.x + p.w - 8}" y="${p.y + 22}" text-anchor="end" class="t2">${fmt(l.cust)}${T('호', '')}</text></g>`;
    }
    // 노드: 이웃 선로
    const after = sel.kind === 'chain' ? D.sourceLoss.after.feederMW : D.zoneFault[sel.id].after.feederMW;
    for (const [k, v] of Object.entries(D.neighbours)) {
      const p = POS[k], mw = anim ? st.nbMW[k] : phase === 'after' ? after[k] : v.mw, over = mw > D.limitMW - 1;
      s += `<g class="im-n nb"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" style="stroke:${FCOL[k]};stroke-width:2"/>
        <text x="${p.x + 10}" y="${p.y + 19}" class="t1">${esc(k === 'C11' ? T('C변전소 #11', 'Sub. C #11') : v.ko)}</text>
        <text x="${p.x + 10}" y="${p.y + 37}" class="t2${over ? ' warn' : ''}">${mw.toFixed(1)} / ${D.limitMW} MW</text></g>`;
    }
    $('imGraph').innerHTML = s + '</svg>';
    const pick = (v) => { stopAnim(); sel = v; if (phase === 'normal') phase = 'before'; render(); };   // 평상시에 누르면 그 설비에 고장을 낸다
    $('imGraph').querySelectorAll('[data-chain]').forEach(g => bind(g, () => pick({ kind: 'chain', id: g.dataset.chain })));
    $('imGraph').querySelectorAll('[data-zone]').forEach(g => bind(g, () => pick({ kind: 'zone', id: g.dataset.zone })));
    return st;
  }
  function bind(g, fn) { g.addEventListener('click', fn); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }); }

  // 작은 위험도 지도: 기존 위치 → 연계 절체를 반영한 위치
  function miniMatrix(a) {
    const S = 26, X0 = 26, Y0 = 6;
    const lv = (r) => r >= 15 ? 'hi' : r >= 8 ? 'mid' : 'lo';
    let h = `<svg viewBox="0 0 ${X0 + 5 * S + 6} ${Y0 + 5 * S + 26}" class="im-mx" role="img" aria-label="risk matrix">`;
    for (let p = 1; p <= 5; p++) for (let c = 1; c <= 5; c++) h += `<rect x="${X0 + (c - 1) * S}" y="${Y0 + (5 - p) * S}" width="${S}" height="${S}" class="mx-cell mx-${lv(p * c)}"/>`;
    h += `<text x="${X0 + 2.5 * S}" y="${Y0 + 5 * S + 18}" text-anchor="middle" class="ax">CoF →</text><text transform="translate(12 ${Y0 + 2.5 * S}) rotate(-90)" text-anchor="middle" class="ax">PoF →</text>`;
    const pt = (pof, cof) => [X0 + (cof - 0.5) * S, Y0 + (5 - pof + 0.5) * S];
    const [x1, y1] = pt(a.pof, a.base.cof), [x2, y2] = pt(a.pof, a.withTie[mode].cof);
    if (x1 !== x2) h += `<path d="M${x1 - 8},${y1}L${x2 + 9},${y2}" class="mv" marker-end="url(#imA2)"/>`;
    h += `<defs><marker id="imA2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--text)"/></marker></defs>
      <circle cx="${x1}" cy="${y1}" r="7" class="d0"/><circle cx="${x2}" cy="${y2}" r="7" class="d1"/></svg>`;
    return h;
  }

  function side(st) {
    const box = $('imSide');
    const deadCust = D.loads.filter(l => st.dead.has(l.id)).reduce((a, l) => a + l.cust, 0);
    const deadMW = D.loads.filter(l => st.dead.has(l.id)).reduce((a, l) => a + l.p, 0);
    const crit = D.loads.filter(l => l.critical && st.dead.has(l.id));
    const nowMW = deadMW * D.curve[hour];
    let h = '';
    if (anim) {
      const CAT = { normal: ['평상시', 'Normal'], fault: ['고장 발생', 'Failure'], isolate: ['고장 구간 차단', 'Isolate'], upstream: ['앞쪽 복구', 'Restore upstream'], prep: ['절체 준비', 'Prepare transfer'], transfer: ['다른 D/L에서 공급', 'Supply from another feeder'] };
      box.innerHTML = `<h3>${T('개폐기 조작 과정', 'Switching sequence')} <small>${anim.k + 1} / ${anim.steps.length}</small></h3>
        <div class="im-big ${deadCust ? 'bad' : 'ok'}">${fmt(deadCust)}<small>${T('호 정전', ' customers out')}</small></div>
        ${crit.length ? `<div class="im-alert">✚ ${T('중요 고객', 'Critical')}: ${crit.map(l => esc(T(l.area, l.areaEn))).join(', ')}</div>` : ''}
        <ol class="im-steps">${anim.steps.map((x, i) => `<li class="${i === anim.k ? 'cur' : i < anim.k ? 'done' : ''} c-${x.cat}"><b>${T(...CAT[x.cat])}</b><span>${esc(T(x.ko, x.en).replace(/^[^:]+: /, ''))}</span></li>`).join('')}</ol>`;
      return;
    }
    if (phase === 'normal') {
      const nb = Object.entries(D.neighbours);
      box.innerHTML = `<h3>${T('평상시', 'Normal state')}</h3>
        <div class="im-big ok">${fmt(D.dl1Cust)}<small>${T('호 공급 중', ' customers supplied')}</small></div>
        <div class="muted">D/L #1 ${D.dl1MW} MW ${T('(피크 기준)', '(peak)')} · ${hour}${T('시', ' h')} ${(D.dl1MW * D.curve[hour]).toFixed(1)} MW</div>
        <div class="im-ops"><b>${T('개폐 상태', 'Switch states')}</b>: CB_DL1 · S1~S6 ${T('닫힘', 'closed')} ●, ${T('연계 개폐기', 'tie switches')} T1~T4 ${T('열림', 'open')} ○<br>
        <span class="muted">${T('배전선로는 방사형으로 운전하므로 연계 개폐기는 평상시 열어 둡니다. 고장이 나면 닫아서 이웃 선로에서 받습니다.', 'Distribution runs radially, so ties stay open in normal operation and close only to pick up load after a failure.')}</span></div>
        <div class="im-ops"><b>${T('이웃 선로 여유', 'Neighbour headroom')}</b><br>${nb.map(([k, v]) => `${esc(k === 'C11' ? T('C변전소 #11', 'Sub. C #11') : v.ko)}: ${v.mw.toFixed(1)} / ${D.limitMW} MW (${T('여유', 'spare')} ${(D.limitMW - v.mw).toFixed(1)})`).join('<br>')}</div>
        <p class="muted" style="margin-top:10px">${T('왼쪽 자산이나 가운데 구간을 누르면 그곳에 고장을 냅니다.', 'Click an asset on the left or a zone in the middle to fail it.')}</p>`;
      return;
    }
    if (sel.kind === 'chain') {
      const n = D.chain.find(x => x.id === sel.id), a = n.asset, s = D.sourceLoss;
      h += `<h3>⚡ ${esc(n.ko)} <small><code>cim:${n.cls}</code></small></h3>`;
      if (!a) h += `<p class="im-gap">${T('이 기능 위치에는 등록된 자산이 없습니다. 고장 영향은 아래처럼 계산되지만, 건전도·고장 가능성을 모르므로 위험도를 매길 수 없습니다. 온톨로지가 "모르는 것"을 드러낸 경우입니다.', 'No asset is recorded at this functional location. The impact below can be computed, but with no health or probability of failure the risk cannot be rated: the ontology is showing what it does not know.')}</p>`;
      else h += `<p class="muted">${esc(a.name)} · <code>${a.id}</code> · ${T('복구', 'restore')} ${fmt(a.restoreH)}${T('시간', ' h')} (${T('예비품', 'with spare')} ${fmt(a.restoreSpareH)}${T('시간', ' h')})</p>`;
      h += `<div class="im-big ${deadCust ? 'bad' : 'ok'}">${fmt(deadCust)}<small>${T('호 정전', ' customers out')}</small></div>
        <div class="muted">${deadMW.toFixed(1)} MW ${T('(피크 기준)', '(peak)')} · ${hour}${T('시 고장이면', ' h failure:')} ${nowMW.toFixed(1)} MW</div>
        ${crit.length ? `<div class="im-alert">✚ ${T('중요 고객', 'Critical')}: ${crit.map(l => esc(T(l.area, l.areaEn))).join(', ')}</div>` : ''}`;
      if (phase === 'after') h += `<div class="im-ops"><b>${T('절체 조작', 'Transfer')}</b> (${D.switchMin[mode]}${T('분 안', ' min')}): CB_DL1 ${T('열기', 'open')} · ${s.ops.map(([k, o]) => `${k} ${o ? T('열기', 'open') : T('닫기', 'close')}`).join(' · ')}<br>
        <span class="${s.margin < 1 ? 'warn' : ''}">${T('이웃 선로 최소 여유', 'Smallest neighbour headroom')} ${s.margin} MW${s.margin < 1 ? T(' — 자산을 고치는 동안 이웃 선로에 또 고장이 나면 넘길 곳이 없습니다.', ' — while the asset is repaired, another fault on a neighbour has nowhere to go.') : ''}</span></div>`;
      if (a) {
        const w = a.withTie[mode];
        h += `<h4>${T('위험도 다시 매기기', 'Risk, re-rated')}</h4><div class="im-risk">${miniMatrix(a)}
          <table class="im-rt"><thead><tr><th></th><th>MWh</th><th>CoF</th><th>${T('위험도', 'Risk')}</th></tr></thead><tbody>
          <tr><th>${T('자산관리 (전량 정전 × 복구 시간)', 'Asset view (all load × repair)')}</th><td>${fmt(a.base.mwh)}</td><td>${a.base.cof}</td><td><span class="lv-t ${LV[a.base.level][0]}">${a.base.risk} ${lvText(a.base.level)}</span></td></tr>
          <tr><th>${T('+ 예비품', '+ spare')}</th><td>${fmt(a.spare.mwh)}</td><td>${a.spare.cof}</td><td><span class="lv-t ${LV[a.spare.level][0]}">${a.spare.risk} ${lvText(a.spare.level)}</span></td></tr>
          <tr class="now"><th>${T('+ 연계 절체', '+ tie transfer')} (${mode === 'auto' ? T('자동', 'auto') : T('수동', 'manual')})</th><td>${w.mwh}</td><td>${w.cof}</td><td><span class="lv-t ${LV[w.level][0]}">${w.risk} ${lvText(w.level)}</span></td></tr>
          </tbody></table></div>`;
      }
    } else {
      const z = D.zones.find(x => x.id === sel.id), zf = D.zoneFault[sel.id];
      h += `<h3>⚡ D/L #1 ${z.id} ${T('지락 고장', 'ground fault')} <small>${T(z.up + ' ~ ' + (z.down[0] || '끝'), z.up + ' – ' + (z.down[0] || 'end'))}</small></h3>
        <p class="muted">${T('배전선로 구간 고장은 고장 복구 시뮬레이션과 같은 계획을 씁니다.', 'A feeder-zone fault uses the same plan as the fault-restoration simulation.')} <a href="grid.html#flisr">${T('재생해 보기 →', 'Replay it →')}</a></p>
        <div class="im-big ${deadCust ? 'bad' : 'ok'}">${fmt(deadCust)}<small>${T('호 정전', ' customers out')}</small></div>
        <div class="muted">${deadMW.toFixed(1)} MW · ${phase === 'after' ? T('수리 때까지 남는 정전', 'left until repair') : T('CB 트립 직후', 'right after the trip')}</div>
        ${crit.length ? `<div class="im-alert">✚ ${T('중요 고객', 'Critical')}: ${crit.map(l => esc(T(l.area, l.areaEn))).join(', ')} — ${T('비상 발전기·우선 복구 대상', 'needs backup generation / priority restoration')}</div>` : ''}
        <div class="im-ops">${T('고객 정전 시간', 'Customer minutes')}: ${T('자동', 'auto')} <b>${fmt(zf.cmi.auto)}</b> · ${T('수동', 'manual')} <b>${fmt(zf.cmi.manual)}</b></div>`;
    }
    box.innerHTML = h;
  }

  function table() {
    $('imTable').innerHTML = D.chain.map(n => {
      const a = n.asset;
      if (!a) return `<tr><td>${esc(n.ko)}</td><td colspan="5" class="muted">${T('자산 미등록 — 위험도 없음', 'no asset — no risk rating')}</td></tr>`;
      const c = (r) => `<span class="lv-t ${LV[r.level][0]}">${r.risk} ${lvText(r.level)}</span>`;
      return `<tr><td>${esc(n.ko)}<br><small>${a.id}</small></td><td class="n">${a.pof}</td><td class="n">${fmt(a.restoreH)}</td><td>${c(a.base)}</td><td>${c(a.spare)}</td><td>${c(a.withTie.auto)} / ${c(a.withTie.manual)}</td></tr>`;
    }).join('');
  }

  function cq() {
    $('imCq').innerHTML = D.cq.map((c, i) => `<details${i === 0 ? ' open' : ''}><summary><b>Q${i + 1}.</b> ${esc(T(c.q, c.en))}</summary>
      <pre><code class="language-cypher">${esc(c.cypher)}</code></pre>
      <div class="tbl"><table><tbody>${c.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`).join('');
  }

  function render() {
    const st = draw();
    side(st);
    document.querySelectorAll('[data-im-phase]').forEach(b => b.setAttribute('aria-pressed', !anim && b.dataset.imPhase === phase));
    document.querySelectorAll('[data-im-scen]').forEach(b => b.setAttribute('aria-pressed', !anim && phase === 'before' && b.dataset.imScen === sel.kind + ':' + sel.id));
    document.querySelectorAll('[data-im-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.imMode === mode));
    const pb = $('imPlay');
    pb.setAttribute('aria-pressed', !!anim);
    pb.innerHTML = anim && anim.timer ? T('■ 멈춤', '■ Stop') : T('▶ 개폐기 조작 과정 보기', '▶ Show switching sequence');
    $('imSpeedV').textContent = stepSec.toFixed(1) + T('초', ' s');
    $('imHourV').textContent = String(hour).padStart(2, '0') + ':00';
  }

  function tick() {
    if (anim.k >= anim.steps.length - 1) { clearInterval(anim.timer); anim.timer = null; render(); return; }
    anim.k++;
    render();
    if (anim.k >= anim.steps.length - 1) { clearInterval(anim.timer); anim.timer = null; render(); }
  }
  function playAnim() {
    if (anim && anim.timer) return;
    anim = { steps: buildSteps(), k: 0, timer: null };          // 평상시부터 다시
    anim.timer = setInterval(tick, stepSec * 1000);
    render();
  }
  // clear=true 면 애니메이션 화면을 닫고 일반 보기로, 아니면 현재 단계에 멈춘 채로 둔다
  function stopAnim(clear) {
    if (!anim) return;
    if (anim.timer) clearInterval(anim.timer);
    anim.timer = null;
    if (clear) anim = null;
    if (!clear) render();
  }

  async function main() {
    if (!$('imGraph')) return;
    try { D = await (await fetch('assets/data/impact.json?v=96a4c5a3')).json(); } catch (e) { $('imGraph').textContent = 'impact.json?'; return; }
    document.querySelectorAll('[data-im-phase]').forEach(b => b.addEventListener('click', () => { phase = b.dataset.imPhase; render(); }));
    document.querySelectorAll('[data-im-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.imMode; render(); }));
    document.querySelectorAll('[data-im-phase]').forEach(b => b.addEventListener('click', () => { stopAnim(true); }, true));
    // 고장 직후 ①: 주변압기 고장 (전원 상실) / ②: Z5 지락 고장 (배전선로 구간 고장)
    document.querySelectorAll('[data-im-scen]').forEach(b => b.addEventListener('click', () => {
      stopAnim(true);
      const [kind, id] = b.dataset.imScen.split(':');
      sel = { kind, id }; phase = 'before'; render();
    }));
    $('imPlay').addEventListener('click', () => (anim && anim.timer ? stopAnim() : playAnim()));
    $('imSpeed').addEventListener('input', e => {
      stepSec = +e.target.value;
      $('imSpeedV').textContent = stepSec.toFixed(1) + T('초', ' s');
      if (anim && anim.timer) { clearInterval(anim.timer); anim.timer = setInterval(tick, stepSec * 1000); }
    });
    $('imHour').addEventListener('input', e => { hour = +e.target.value; render(); });
    document.addEventListener('langchange', () => { render(); table(); cq(); });
    table(); cq(); render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
