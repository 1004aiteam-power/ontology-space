// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 사이트 전체 온톨로지 지도: assets/data/ontology-map.json (tools/build_ontology_map.mjs가 Turtle 파일에서 셈)을 그림으로
import { $, esc } from './lib/dom.js?v=3b73d59c';
(() => {
  const T = (o) => window.t(o);
  const L = (x) => T({ ko: x.ko, en: x.en });
  // 자리 (viewBox 1200 × 610). VPP 가상 전력시장은 오른쪽 끝(디지털 트윈 위 오른쪽). 배전공사 안전이 가운데에서 업무 · 자산관리 · 배전선로 · 변전소 · 고장 영향과 잇고, 교통은 오른쪽, 자연은 왼쪽 아래
  // (상자를 지나가는 화살표가 없도록 고른 배치)
  const POS = {
    substation: [300, 90], impact: [700, 90],
    asset: [100, 255], safety: [500, 255],
    eco: [100, 420], work: [300, 420], feeder: [700, 420],
    highway: [900, 90], ev: [900, 255], twin: [900, 420], vpp: [1100, 255],
    obo: [120, 580], dct: [330, 580], cim: [560, 580], skos: [745, 580], geo: [900, 580]
  };
  const LABEL_AT = { 'vpp>twin': 0.22 };   // 다른 이름표와 겹치는 선만 가운데가 아닌 곳에
  const W = 176, H = 70, SW = 150, SH = 34;
  const GROUP = { power: { ko: '전력', en: 'Power' }, traffic: { ko: '교통', en: 'Traffic' }, work: { ko: '업무', en: 'Work' }, nature: { ko: '자연', en: 'Nature' } };
  let D = null, sel = null;

  const size = (id) => (D.standards.some(s => s.id === id) ? [SW, SH] : [W, H]);
  // 상자 a 가운데에서 b 가운데로 가는 선이 상자 테두리와 만나는 점
  function edgePt(id, toward) {
    const [x, y] = POS[id], [w, h] = size(id), [tx, ty] = POS[toward];
    const dx = tx - x, dy = ty - y, k = Math.min(Math.abs((w / 2) / (dx || 1e-9)), Math.abs((h / 2) / (dy || 1e-9)));
    return [x + dx * k, y + dy * k];
  }

  function nodeLine(n) {
    if (n.classes) return T({ ko: `클래스 ${n.classes} · 관계 ${n.objectProps} · 개체 ${n.individuals.toLocaleString()}`, en: `${n.classes} classes · ${n.objectProps} relations · ${n.individuals.toLocaleString()} individuals` });
    return T({ ko: `CIM 클래스 ${n.classesUsed}종 · 개체 ${n.individuals.toLocaleString()}`, en: `${n.classesUsed} CIM classes · ${n.individuals.toLocaleString()} individuals` });
  }

  function draw() {
    const out = [`<defs><marker id="omA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 10,5 0,10z" class="om-ah"/></marker>
      <marker id="omA2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 10,5 0,10z" class="om-ah hot"/></marker></defs>`];
    out.push(`<text class="om-band" x="8" y="555">${esc(T({ ko: '외부 표준', en: 'External standards' }))}</text><line class="om-sep" x1="0" x2="1200" y1="530" y2="530"/>`);
    const hot = (l) => sel && (l.from === sel || l.to === sel);
    for (const l of D.standardLinks) {
      const [x1, y1] = edgePt(l.from, l.to), [x2, y2] = edgePt(l.to, l.from);
      out.push(`<line class="om-std${hot(l) ? ' hot' : sel ? ' dim' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><title>${esc(l.from)} ⇢ ${esc(l.to)}: ${l.n}</title></line>`);
    }
    for (const l of D.links) {
      const [x1, y1] = edgePt(l.from, l.to), [x2, y2] = edgePt(l.to, l.from);
      const k = LABEL_AT[l.from + '>' + l.to] ?? 0.5, h = hot(l), my = y1 + (y2 - y1) * k;   // 이름표 자리 (선을 따라 비율)
      const lab = `${l.via[0].p.split('.').pop()}${l.via.length > 1 ? ' …' : ''} ×${l.n}`, lw = lab.length * 7 + 18;   // 이름표 폭은 글자 수만큼 (CIM의 Class.prop은 prop만)
      const mx = Math.min(1200 - lw / 2 - 2, Math.max(lw / 2 + 2, x1 + (x2 - x1) * k));                                        // 이름표가 그림 밖으로 나가지 않게
      out.push(`<g class="om-link${h ? ' hot' : sel ? ' dim' : ''}" data-link="${l.from}>${l.to}" tabindex="0" role="button">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${h ? 'omA2' : 'omA'})" style="stroke-width:${Math.min(5, 1.4 + Math.log2(l.n))}"/>
        <line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <rect x="${mx - lw / 2}" y="${my - 11}" width="${lw}" height="22" rx="11"/><text x="${mx}" y="${my + 4}">${esc(lab)}</text></g>`);
    }
    for (const n of D.nodes) {
      const [x, y] = POS[n.id], on = sel === n.id;
      out.push(`<g class="om-n ${n.group}${on ? ' sel' : ''}${sel && !on && !linked(n.id) ? ' dim' : ''}" data-node="${n.id}" tabindex="0" role="button">
        <rect x="${x - W / 2}" y="${y - H / 2}" width="${W}" height="${H}" rx="10"/>
        <text class="t1" x="${x}" y="${y - 6}">${esc(L(n))}</text><text class="t2" x="${x}" y="${y + 16}">${esc(nodeLine(n))}</text></g>`);
    }
    for (const s of D.standards) {
      const [x, y] = POS[s.id];
      out.push(`<g class="om-s${sel === s.id ? ' sel' : ''}${sel && sel !== s.id && !linked(s.id) ? ' dim' : ''}" data-node="${s.id}" tabindex="0" role="button">
        <rect x="${x - SW / 2}" y="${y - SH / 2}" width="${SW}" height="${SH}" rx="17"/><text x="${x}" y="${y + 5}">${esc(L(s))}</text></g>`);
    }
    $('omSvg').innerHTML = out.join('');
    for (const t of $('omSvg').querySelectorAll('.om-n text')) {    // 상자보다 긴 글은 상자 폭에 맞게 줄임 (영어 설명 등)
      if (t.getComputedTextLength() > W - 14) { t.setAttribute('textLength', W - 14); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    }
  }
  const linked = (id) => [...D.links, ...D.standardLinks].some(l => (l.from === sel && l.to === id) || (l.to === sel && l.from === id));
  const name = (id) => L(D.nodes.find(n => n.id === id) || D.standards.find(s => s.id === id));
  const via = (l, k = 6) => l.via.slice(0, k).map(v => `<code>${esc(v.p)}</code> ×${v.n}`).join(', ') + (l.via.length > k ? ' …' : '');

  function side() {
    const box = $('omSide');
    if (!sel) {
      box.innerHTML = `<h3>${esc(T({ ko: '읽는 법', en: 'How to read it' }))}</h3>
        <p>${T({ ko: '상자 하나가 온톨로지(또는 데이터 모델) 하나입니다. <b>실선 화살표</b>는 A의 트리플이 B에서 정의한 개체·클래스·속성을 직접 가리킨다는 뜻이고, 숫자는 그런 트리플의 수입니다. <b>점선</b>은 외부 표준의 용어를 쓰는 곳입니다.', en: 'Each box is one ontology (or data model). A <b>solid arrow</b> means A\'s triples point directly at individuals, classes or properties defined in B; the number counts those triples. <b>Dashed lines</b> show where external standards are used.' })}</p>
        <p>${T({ ko: '상자나 화살표를 누르면 자세한 내용이 여기에 나옵니다.', en: 'Click a box or an arrow for details here.' })}</p>`;
      return;
    }
    const n = D.nodes.find(x => x.id === sel), s = D.standards.find(x => x.id === sel);
    const outL = D.links.filter(l => l.from === sel), inL = D.links.filter(l => l.to === sel);
    const stdL = D.standardLinks.filter(l => l.from === sel || l.to === sel);
    const li = (l, dir) => `<li><a href="#" data-pick="${dir === 'out' ? l.to : l.from}">${esc(name(dir === 'out' ? l.to : l.from))}</a> · ${l.n}<br><small>${via(l)}</small></li>`;
    let h = `<h3>${esc(name(sel))}${n ? ` <small class="muted">${esc(T(GROUP[n.group]))}</small>` : ''}</h3>`;
    if (n) {
      h += `<table class="om-kv"><tr><td>${T({ ko: '정의한 클래스', en: 'Classes defined' })}</td><td>${n.classes}</td></tr>
        <tr><td>${T({ ko: '관계 · 값 속성', en: 'Object · data properties' })}</td><td>${n.objectProps} · ${n.dataProps}</td></tr>
        <tr><td>${T({ ko: '개체', en: 'Individuals' })}</td><td>${n.individuals.toLocaleString()}</td></tr>
        <tr><td>${T({ ko: '쓰는 클래스', en: 'Classes in use' })}</td><td>${n.classesUsed}</td></tr>
        <tr><td>${T({ ko: '트리플', en: 'Triples' })}</td><td>${n.triples.toLocaleString()}</td></tr></table>
        <p class="muted">${n.files.map(f => `<a href="https://github.com/1004aiteam-power/ontology-space/blob/main/${f}"><code>${esc(f.split('/').pop())}</code></a>`).join(' · ')}</p>
        <p><a href="${esc(n.page)}">${T({ ko: '이 온톨로지 페이지 →', en: 'Open its page →' })}</a></p>`;
    } else if (s.page) h += `<p><a href="${esc(s.page)}">${T({ ko: '관련 페이지 →', en: 'Related page →' })}</a></p>`;
    if (outL.length) h += `<h4>${T({ ko: '가리키는 곳', en: 'Points to' })}</h4><ul>${outL.map(l => li(l, 'out')).join('')}</ul>`;
    if (inL.length) h += `<h4>${T({ ko: '가리켜지는 곳', en: 'Pointed to by' })}</h4><ul>${inL.map(l => li(l, 'in')).join('')}</ul>`;
    if (n && !outL.length && !inL.length) h += `<p class="muted">${T({ ko: '다른 온톨로지와 직접 잇지 않고, 표준만 공유합니다.', en: 'Not linked to the other ontologies directly; it only shares standards.' })}</p>`;
    if (stdL.length) h += `<h4>${T({ ko: n ? '쓰는 표준' : '이 표준을 쓰는 곳', en: n ? 'Standards used' : 'Used by' })}</h4><ul>${stdL.map(l => `<li><a href="#" data-pick="${n ? l.to : l.from}">${esc(name(n ? l.to : l.from))}</a> · ${l.n.toLocaleString()}<br><small>${via(l, 4)}</small></li>`).join('')}</ul>`;
    box.innerHTML = h;
  }

  function table() {
    $('omTable').innerHTML = `<table><tr><th>${T({ ko: '가리키는 쪽', en: 'From' })}</th><th>${T({ ko: '가리켜지는 쪽', en: 'To' })}</th><th>${T({ ko: '트리플', en: 'Triples' })}</th><th>${T({ ko: '무엇으로 (술어 · 건수)', en: 'Via (predicate · count)' })}</th></tr>` +
      D.links.map(l => `<tr><td>${esc(name(l.from))}</td><td>${esc(name(l.to))}</td><td class="num">${l.n}</td><td>${via(l, 8)}</td></tr>`).join('') + '</table>';
    const tot = D.nodes.reduce((a, n) => ({ c: a.c + n.classes, i: a.i + n.individuals, t: a.t + n.triples }), { c: 0, i: 0, t: 0 });
    $('omStats').innerHTML = [[D.nodes.length, { ko: '온톨로지·모델', en: 'ontologies & models' }], [tot.c, { ko: '정의한 클래스', en: 'classes defined' }], [tot.i, { ko: '개체', en: 'individuals' }],
      [tot.t, { ko: '트리플', en: 'triples' }], [D.links.length, { ko: '서로 잇는 연결', en: 'links between them' }], [D.standards.length, { ko: '외부 표준', en: 'external standards' }]]
      .map(([v, l]) => `<div><b>${v.toLocaleString()}</b><span>${esc(T(l))}</span></div>`).join('');
  }

  const pick = (id) => { sel = sel === id ? null : id; draw(); side(); };
  function render() { draw(); side(); table(); }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const r = await fetch('assets/data/ontology-map.json?v=542849d7');
      D = await r.json();
    } catch (e) { $('omSide').textContent = '⚠ ' + e.message; return; }
    const svg = $('omSvg');
    const act = (e) => {
      const g = e.target.closest('[data-node],[data-link]'); if (!g) { if (sel) pick(sel); return; }
      if (g.dataset.node) pick(g.dataset.node); else { sel = g.dataset.link.split('>')[0]; draw(); side(); }
    };
    svg.addEventListener('click', act);
    svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e); } });
    $('omSide').addEventListener('click', (e) => { const a = e.target.closest('[data-pick]'); if (a) { e.preventDefault(); sel = a.dataset.pick; draw(); side(); } });
    document.addEventListener('langchange', render);
    render();
  });
})();
