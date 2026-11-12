// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 디지털 트윈: 가상 대한민국 전력망 24시간 상태를 지도 위에 재생
// 데이터: assets/data/twin.json (examples/twin/build_korea_twin.py 가 pycim → pandapower 로 계산)
import { $, esc, css, dark } from '../lib/dom.js?v=3b73d59c';
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

// 발전원 색: dataviz 팔레트 1~4번 슬롯 (라이트/다크 각각 검증)
const TYPES = ['nuclear', 'coal', 'lng', 'wind', 'solar'];          // 누적 순서 (색은 아래 고정 슬롯)
const TYPE_NAME = { nuclear: { ko: '원전', en: 'Nuclear' }, coal: { ko: '석탄', en: 'Coal' }, lng: { ko: 'LNG', en: 'LNG' },
                    solar: { ko: '태양광', en: 'Solar' }, wind: { ko: '풍력', en: 'Wind' } };
const typeColor = (k) => (dark() ? { nuclear: '#3987e5', coal: '#d95926', lng: '#199e70', solar: '#c98500', wind: '#d55181' }
                                  : { nuclear: '#2a78d6', coal: '#eb6834', lng: '#1baf7a', solar: '#eda100', wind: '#e87ba4' })[k];
// 상태 색 (선로 부하율, 변전소 전압): 정상 / 주의 / 위험 — 색만으로 구분하지 않도록 툴팁·목록에 글자로도 표시
const STATUS = { warn: '#f59e0b', crit: '#dc2626' };
const KV_WIDTH = { 765: 5, 345: 2.6, 154: 1.3 };

let D, tod = 14, playing = false, speed = 1, last = 0, svg, proj, layer = {}, hover = null;

// ---- 값 보간 (정시 사이를 부드럽게) ----------------------------------------------------
const at = (arr) => { const h = Math.floor(tod) % 24, f = tod - Math.floor(tod); return arr[h] + (arr[(h + 1) % 24] - arr[h]) * f; };
const clock = () => { const m = Math.round(tod * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const lineStatus = (pct) => (pct >= 100 ? 'crit' : pct >= 80 ? 'warn' : 'ok');
const voltStatus = (pu) => (pu < 0.95 || pu > 1.05 ? 'crit' : pu < 0.97 || pu > 1.04 ? 'warn' : 'ok');

// ---- 지도 -----------------------------------------------------------------------
function buildMap() {
  const lat0 = 36.3 * Math.PI / 180, k = 100;
  proj = (lon, lat) => [(lon - 124.4) * k * Math.cos(lat0), (38.75 - lat) * k];
  const [W] = proj(131.0, 0), H = (38.75 - 32.9) * k;
  svg = el('svg', { viewBox: `0 0 ${W.toFixed(0)} ${H}`, role: 'img', 'aria-label': 'virtual Korean power grid map' });
  $('map').appendChild(svg);
  const land = el('g', { class: 'land' }, svg);
  for (const poly of D.outline) {
    el('path', { d: 'M' + poly.map(([lon, lat]) => proj(lon, lat).map(v => v.toFixed(1)).join(',')).join('L') + 'Z' }, land);
  }
  layer.lines = el('g', {}, svg); layer.flow = el('g', { class: 'flow' }, svg);
  layer.stations = el('g', {}, svg); layer.plants = el('g', {}, svg); layer.labels = el('g', { class: 'maplabel' }, svg);
  const st = Object.fromEntries(D.stations.map(s => [s.id, s]));
  // 선로 (765 → 154 순서로 그려 굵은 선이 아래)
  D.lines.slice().sort((a, b) => b.kv - a.kv).forEach(l => {
    const [x1, y1] = proj(st[l.a].lon, st[l.a].lat), [x2, y2] = proj(st[l.b].lon, st[l.b].lat);
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`;
    l.path = el('path', { d, class: `ln kv${l.kv}`, 'stroke-width': KV_WIDTH[l.kv] }, layer.lines);
    l.hit = el('path', { d, class: 'hit', 'stroke-width': Math.max(10, KV_WIDTH[l.kv] + 8) }, layer.lines);
    l.dots = el('path', { d, class: 'dots', 'stroke-width': Math.max(2, KV_WIDTH[l.kv] * 0.9), 'stroke-dasharray': `0.1 ${l.kv === 154 ? 9 : 14}` }, layer.flow);
    l.len = Math.hypot(x2 - x1, y2 - y1); l.off = 0;
    l.hit.addEventListener('pointerenter', e => showTip(e, 'line', l));
    l.hit.addEventListener('pointermove', moveTip); l.hit.addEventListener('pointerleave', hideTip);
    l.hit.addEventListener('click', e => showTip(e, 'line', l));
  });
  // 제주 HVDC 해저 케이블: 바다 위로 살짝 휜 곡선
  for (const hv of D.hvdc || []) {
    const [x1, y1] = proj(st[hv.a].lon, st[hv.a].lat), [x2, y2] = proj(st[hv.b].lon, st[hv.b].lat);
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)}Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    hv.path = el('path', { d, class: 'hvdc' }, layer.lines);
    hv.hit = el('path', { d, class: 'hit', 'stroke-width': 12 }, layer.lines);
    hv.dots = el('path', { d, class: 'dots hv', 'stroke-width': 3, 'stroke-dasharray': '0.1 12' }, layer.flow);
    hv.off = 0;
    // 이름표: 곡선의 30% 지점, 서쪽 케이블은 왼쪽·동쪽 케이블은 오른쪽에 붙여 겹치지 않게
    const tt = 0.3, qx = (1 - tt) ** 2 * x1 + 2 * (1 - tt) * tt * mx + tt ** 2 * x2, qy = (1 - tt) ** 2 * y1 + 2 * (1 - tt) * tt * my + tt ** 2 * y2;
    const west = st[hv.a].lon === Math.min(...D.hvdc.map(h => st[h.a].lon));   // 가장 서쪽 케이블만 왼쪽에
    hv.label = el('text', { x: (qx + (west ? -7 : 7)).toFixed(1), y: qy.toFixed(1), 'text-anchor': west ? 'end' : 'start' }, layer.labels);
    hv.label.textContent = hv.id.replace('HVDC', 'HVDC #');
    hv.hit.addEventListener('pointerenter', e => showTip(e, 'hvdc', hv));
    hv.hit.addEventListener('pointermove', moveTip); hv.hit.addEventListener('pointerleave', hideTip);
    hv.hit.addEventListener('click', e => showTip(e, 'hvdc', hv));
  }
  // 변전소
  const maxLoad = Math.max(...D.stations.map(s => s.loadMW));
  for (const s of D.stations) {
    const [x, y] = proj(s.lon, s.lat);
    s.xy = [x, y];
    s.r = s.loadMW ? 2.6 + 6 * Math.sqrt(s.loadMW / maxLoad) : 2.6;
    s.dot = el('circle', { cx: x, cy: y, r: s.r, class: 'st' + (s.levels.includes(765) ? ' hub' : '') }, layer.stations);
    s.dot.addEventListener('pointerenter', e => showTip(e, 'station', s));
    s.dot.addEventListener('pointermove', moveTip); s.dot.addEventListener('pointerleave', hideTip);
    s.dot.addEventListener('click', e => showTip(e, 'station', s));
    if (s.loadMW >= 1400 || s.levels.includes(765) || s.id === 'JEJU') {
      s.label = el('text', { x: x + s.r + 2, y: y + 3 }, layer.labels);
    }
  }
  // 발전소: 변전소 옆에 조금 떨어뜨려 표시 (바깥 원 = 용량, 안쪽 = 현재 출력)
  const maxCap = Math.max(...D.plants.map(p => p.capMW));
  const placed = {};
  for (const p of D.plants) {
    const s = st[p.station], n = placed[p.station] = (placed[p.station] || 0) + 1;
    const ang = (-40 + (n - 1) * 70) * Math.PI / 180, dist = 16 + s.r;
    const x = s.xy[0] + Math.cos(ang) * dist * (s.lon > 128.5 ? 1 : -1), y = s.xy[1] + Math.sin(ang) * dist;
    p.R = 4 + 9 * Math.sqrt(p.capMW / maxCap);
    const g = el('g', { class: 'plant', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` }, layer.plants);
    el('line', { x1: 0, y1: 0, x2: (s.xy[0] - x).toFixed(1), y2: (s.xy[1] - y).toFixed(1), class: 'tie' }, g);
    p.ring = el('circle', { r: p.R, class: 'ring' }, g);
    p.core = el('circle', { r: p.R * 0.6 }, g);
    p.g = g;
    g.addEventListener('pointerenter', e => showTip(e, 'plant', p));
    g.addEventListener('pointermove', moveTip); g.addEventListener('pointerleave', hideTip);
    g.addEventListener('click', e => showTip(e, 'plant', p));
  }
}

// ---- 상태 갱신 --------------------------------------------------------------------
function update() {
  const S = D.series, lang = window.currentLang?.() || 'ko';
  const showStatus = $('colorMode').checked;
  for (const l of D.lines) {
    const pct = at(S.lineLoading[l.id]), st = lineStatus(pct);
    l.pct = pct; l.flow = at(S.lineFlow[l.id]);
    l.path.style.stroke = showStatus && st !== 'ok' ? STATUS[st] : '';
    l.path.classList.toggle('alarm', showStatus && st === 'crit');
    l.dots.style.display = $('showFlow').checked && $(`kv${l.kv}`).checked ? '' : 'none';
    for (const e of [l.path, l.hit]) e.style.display = $(`kv${l.kv}`).checked ? '' : 'none';
  }
  for (const s of D.stations) {
    const pu = at(S.stationV[s.id]), st = voltStatus(pu);
    s.pu = pu;
    s.dot.style.fill = showStatus && st !== 'ok' ? STATUS[st] : '';
    s.dot.style.display = $('showStations').checked ? '' : 'none';
    if (s.label) { s.label.textContent = s[lang]; s.label.style.display = $('showLabels').checked ? '' : 'none'; }
  }
  for (const hv of D.hvdc || []) {
    hv.flow = at(S.hvdcFlow[hv.id]);
    hv.dots.style.display = $('showFlow').checked && $('showHvdc').checked ? '' : 'none';
    for (const e of [hv.path, hv.hit, hv.label]) e.style.display = $('showHvdc').checked ? '' : 'none';
    hv.path.classList.toggle('rev', hv.flow < -1);
  }
  for (const p of D.plants) {
    const mw = at(S.plantP[p.id]); p.mw = mw;
    p.ring.style.stroke = typeColor(p.type);
    p.core.setAttribute('r', (p.R * Math.sqrt(Math.max(0, mw) / p.capMW)).toFixed(2));
    p.core.style.fill = typeColor(p.type);
    p.g.style.display = $('showPlants').checked ? '' : 'none';
  }
  // 지표
  const load = at(S.load), solar = at(S.solar), loss = at(S.losses);
  const gen = Object.fromEntries(TYPES.map(k => [k, at(S[k])])), total = TYPES.reduce((a, k) => a + gen[k], 0);
  const worstV = D.stations.reduce((a, b) => (b.pu < a.pu ? b : a)), worstL = D.lines.reduce((a, b) => (b.pct > a.pct ? b : a));
  const alarms = D.lines.filter(l => lineStatus(l.pct) !== 'ok').length + D.stations.filter(s => voltStatus(s.pu) !== 'ok').length;
  const fmt = (v) => Math.round(v).toLocaleString();
  $('clock').textContent = clock();
  $('slider').value = tod;
  $('kpi').innerHTML = [
    [t1({ ko: '전국 수요', en: 'Demand' }), `${fmt(load)} MW`],
    [t1({ ko: '태양광 비중', en: 'Solar share' }), `${(100 * solar / total).toFixed(1)} %`],
    [t1({ ko: '송전 손실', en: 'Losses' }), `${fmt(loss)} MW (${(100 * loss / total).toFixed(1)}%)`],
    [t1({ ko: '최저 전압', en: 'Lowest voltage' }), `${worstV.pu.toFixed(3)} pu · ${esc(worstV[lang])}`],
    [t1({ ko: '최대 부하율', en: 'Most loaded line' }), `${worstL.pct.toFixed(0)} % · ${esc(lineName(worstL, lang))}`],
    [t1({ ko: '제주 ↔ 육지 (HVDC)', en: 'Jeju ↔ mainland (HVDC)' }), hvdcText()],
    [t1({ ko: '제주 출력제한', en: 'Jeju curtailment' }), at(S.curtail) >= 1 ? `⚠ ${fmt(at(S.curtail))} MW` : t1({ ko: '없음', en: 'none' })],
    [t1({ ko: '주의·위험', en: 'Alerts' }), alarms ? `⚠ ${alarms}` : t1({ ko: '✓ 없음', en: '✓ none' })]
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('mix').innerHTML = TYPES.map(k => `<div class="mixrow"><i style="background:${typeColor(k)}"></i><span>${t1(TYPE_NAME[k])}</span>
    <span class="bar"><b style="width:${(100 * gen[k] / total).toFixed(1)}%;background:${typeColor(k)}"></b></span><span class="num">${fmt(gen[k])} MW</span></div>`).join('');
  drawChart();
  if (hover) refreshTip();
}
const t1 = (o) => window.t(o);
function hvdcText() {                                 // + 육지→제주(정송), − 제주→육지(역송)
  const f = (D.hvdc || []).reduce((a, h) => a + at(D.series.hvdcFlow[h.id]), 0), v = Math.round(Math.abs(f)).toLocaleString();
  if (Math.abs(f) < 5) return t1({ ko: '거의 0', en: '≈ 0' });
  return f > 0 ? t1({ ko: `육지 → 제주 ${v} MW`, en: `Mainland → Jeju ${v} MW` }) : t1({ ko: `제주 → 육지 ${v} MW (역송)`, en: `Jeju → mainland ${v} MW (reverse)` });
}
// 지명이 서로 겹치면 오른쪽 → 왼쪽 → 위 → 아래 순으로 옮겨 본다
function placeLabels() {
  const boxes = [];
  const hit = (a) => boxes.some(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  for (const s of D.stations.filter(s => s.label).sort((a, b) => b.loadMW - a.loadMW)) {
    const [x, y] = s.xy, w = s.label.getComputedTextLength(), h = 11;
    const opts = [[x + s.r + 2, y + 4], [x - s.r - 2 - w, y + 4], [x - w / 2, y - s.r - 3], [x - w / 2, y + s.r + 11]];
    let pick = opts[0];
    for (const o of opts) { if (!hit({ x: o[0], y: o[1] - h, w, h })) { pick = o; break; } }
    s.label.setAttribute('x', pick[0].toFixed(1)); s.label.setAttribute('y', pick[1].toFixed(1));
    boxes.push({ x: pick[0], y: pick[1] - h, w, h });
  }
}
const lineName = (l, lang) => { const st = Object.fromEntries(D.stations.map(s => [s.id, s])); return `${st[l.a][lang]}–${st[l.b][lang]} ${l.kv}kV`; };

// ---- 흐름 애니메이션 (점이 전력이 흐르는 방향으로 이동) --------------------------------
function animateFlow(dt) {
  for (const hv of D.hvdc || []) {
    if (hv.dots.style.display === 'none' || Math.abs(hv.flow) < 1) { hv.dots.style.opacity = Math.abs(hv.flow) < 1 ? 0 : ''; continue; }
    hv.dots.style.opacity = '';
    hv.off = (hv.off + Math.max(0.2, Math.abs(hv.flow) / hv.capMW) * 22 * (hv.flow >= 0 ? -1 : 1) * dt) % 1000;
    hv.dots.setAttribute('stroke-dashoffset', hv.off.toFixed(1));
  }
  for (const l of D.lines) {
    if (l.dots.style.display === 'none') continue;
    const v = Math.min(1.4, Math.max(0.15, l.pct / 100)) * 22 * (l.flow >= 0 ? -1 : 1);
    l.off = (l.off + v * dt) % 1000;
    l.dots.setAttribute('stroke-dashoffset', l.off.toFixed(1));
  }
}

// ---- 툴팁 ----------------------------------------------------------------------
function showTip(e, kind, obj) { hover = { kind, obj }; refreshTip(); moveTip(e); }
function moveTip(e) {
  const tip = $('tip'), box = $('map').getBoundingClientRect();
  const x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
  tip.style.left = Math.min(x, box.width - 230) + 'px'; tip.style.top = Math.min(y, box.height - 120) + 'px';
}
function hideTip() { hover = null; $('tip').hidden = true; }
function refreshTip() {
  const { kind, obj } = hover, lang = window.currentLang?.() || 'ko', tip = $('tip');
  const label = (st) => ({ ok: t1({ ko: '정상', en: 'normal' }), warn: t1({ ko: '⚠ 주의', en: '⚠ caution' }), crit: t1({ ko: '⛔ 위험', en: '⛔ critical' }) }[st]);
  if (kind === 'line') {
    const st = Object.fromEntries(D.stations.map(s => [s.id, s]));
    const from = obj.flow >= 0 ? st[obj.a] : st[obj.b], to = obj.flow >= 0 ? st[obj.b] : st[obj.a];
    tip.innerHTML = `<b>${esc(lineName(obj, lang))}</b><br>${obj.km} km · ${obj.routes > 1 ? obj.routes + t1({ ko: '루트', en: ' routes' }) + ' · ' : ''}${t1({ ko: '용량', en: 'rating' })} ${obj.ratingMVA.toLocaleString()} MVA
      <br>${t1({ ko: '부하율', en: 'Loading' })} <b>${obj.pct.toFixed(0)}%</b> (${label(lineStatus(obj.pct))})<br>${t1({ ko: '흐름', en: 'Flow' })} ${Math.abs(Math.round(obj.flow)).toLocaleString()} MW · ${esc(from[lang])} → ${esc(to[lang])}`;
  } else if (kind === 'hvdc') {
    const st = Object.fromEntries(D.stations.map(s => [s.id, s]));
    const f = obj.flow, dir = f > 1 ? `${esc(st[obj.a][lang])} → ${esc(st[obj.b][lang])}` : f < -1 ? `${esc(st[obj.b][lang])} → ${esc(st[obj.a][lang])} (${t1({ ko: '역송', en: 'reverse' })})` : t1({ ko: '정지', en: 'idle' });
    tip.innerHTML = `<b>${esc(obj[lang])}</b><br>${t1({ ko: '해저 케이블 · 용량', en: 'Subsea cable · rating' })} ${obj.capMW} MW · ${obj.reverse ? t1({ ko: '역송 가능', en: 'reversible' }) : t1({ ko: '정송 전용', en: 'forward only' })}
      <br>${t1({ ko: '흐름', en: 'Flow' })} <b>${Math.abs(Math.round(f))} MW</b> · ${dir}`;
  } else if (kind === 'station') {
    tip.innerHTML = `<b>${esc(obj[lang])}</b> <span class="muted">(${t1({ ko: '가상', en: 'virtual' })})</span><br>${obj.levels.join(' / ')} kV
      ${obj.loadMW ? `<br>${t1({ ko: '최대 부하', en: 'Peak load' })} ${obj.loadMW.toLocaleString()} MW` : ''}
      <br>${t1({ ko: '전압', en: 'Voltage' })} <b>${obj.pu.toFixed(3)} pu</b> (${label(voltStatus(obj.pu))})`;
  } else {
    tip.innerHTML = `<b>${esc(obj[lang])}</b><br>${t1(TYPE_NAME[obj.type])} · ${obj.kv} kV<br>${t1({ ko: '출력', en: 'Output' })} <b>${Math.round(obj.mw).toLocaleString()} MW</b> / ${obj.capMW.toLocaleString()} MW (${(100 * obj.mw / obj.capMW).toFixed(0)}%)`;
  }
  tip.hidden = false;
}

// ---- 24시간 발전 구성 차트 (누적 영역 + 수요선 + 현재 시각) -------------------------------
let chartHover = null;
function drawChart() {
  const c = $('mixChart'), dpr = devicePixelRatio || 1, cw = c.clientWidth, ch = c.clientHeight;
  if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  const S = D.series, pad = { l: 46, r: 12, t: 16, b: 24 }, W = cw - pad.l - pad.r, H = ch - pad.t - pad.b;
  const ymax = Math.ceil(Math.max(...S.load.map((v, i) => Math.max(v, TYPES.reduce((a, k) => a + S[k][i], 0)))) / 10000) * 10000;
  const X = (h) => pad.l + W * h / 23, Y = (v) => pad.t + H * (1 - v / ymax);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
  for (let v = 0; v <= ymax; v += 10000) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + W, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(v / 1000 + 'GW', pad.l - 6, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let h = 0; h < 24; h += 3) ctx.fillText(h + t1({ ko: '시', en: 'h' }), X(h), pad.t + H + 6);
  const base = new Array(24).fill(0);
  for (const k of TYPES) {                                   // 누적 영역, 층 사이 2px 표면색 간격
    ctx.beginPath();
    for (let h = 0; h < 24; h++) (h ? ctx.lineTo : ctx.moveTo).call(ctx, X(h), Y(base[h] + S[k][h]));
    for (let h = 23; h >= 0; h--) ctx.lineTo(X(h), Y(base[h]));
    ctx.closePath(); ctx.fillStyle = typeColor(k); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2; ctx.stroke();
    for (let h = 0; h < 24; h++) base[h] += S[k][h];
  }
  ctx.strokeStyle = css('--text'); ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();   // 수요
  S.load.forEach((v, h) => (h ? ctx.lineTo(X(h), Y(v)) : ctx.moveTo(X(h), Y(v)))); ctx.stroke(); ctx.setLineDash([]);
  const xt = pad.l + W * Math.min(tod, 23) / 23;                // 현재 시각
  ctx.strokeStyle = css('--text'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xt, pad.t); ctx.lineTo(xt, pad.t + H); ctx.stroke();
  ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lx = Math.min(Math.max(xt, pad.l + 20), pad.l + W - 20), lw = ctx.measureText(clock()).width + 10;
  ctx.fillStyle = css('--text'); ctx.beginPath(); ctx.roundRect(lx - lw / 2, 0, lw, 15, 4); ctx.fill();
  ctx.fillStyle = css('--surface'); ctx.fillText(clock(), lx, 8);
  if (chartHover != null) {
    const h = chartHover, tip = $('chartTip');
    ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(h), pad.t); ctx.lineTo(X(h), pad.t + H); ctx.stroke(); ctx.setLineDash([]);
    tip.hidden = false;
    tip.innerHTML = `<b>${h}${t1({ ko: '시', en: ':00' })}</b><br>${t1({ ko: '수요', en: 'Demand' })} ${S.load[h].toLocaleString()} MW<br>` +
      TYPES.slice().reverse().map(k => `<i style="background:${typeColor(k)}"></i>${t1(TYPE_NAME[k])} ${S[k][h].toLocaleString()} MW`).join('<br>');
    tip.style.left = Math.min(cw - 170, X(h) + 10) + 'px'; tip.style.top = '8px';
  } else $('chartTip').hidden = true;
}

function renderTable() {
  const S = D.series;
  $('twinTable').innerHTML = `<tr><th>${t1({ ko: '시각', en: 'Hour' })}</th><th>${t1({ ko: '수요', en: 'Demand' })}</th>${TYPES.map(k => `<th>${t1(TYPE_NAME[k])}</th>`).join('')}<th>${t1({ ko: '손실', en: 'Losses' })}</th><th>HVDC</th><th>${t1({ ko: '출력제한', en: 'Curtail' })}</th><th>${t1({ ko: '최저 전압', en: 'Min V' })}</th><th>${t1({ ko: '최대 부하율', en: 'Max loading' })}</th></tr>` +
    S.load.map((v, h) => `<tr><td>${h}:00</td><td class="num">${v.toLocaleString()}</td>${TYPES.map(k => `<td class="num">${S[k][h].toLocaleString()}</td>`).join('')}<td class="num">${S.losses[h]}</td><td class="num">${(D.hvdc || []).reduce((a, x) => a + S.hvdcFlow[x.id][h], 0)}</td><td class="num">${S.curtail[h]}</td><td class="num">${S.minV[h].toFixed(3)}</td><td class="num">${S.maxLoading[h].toFixed(0)}%</td></tr>`).join('');
}

// ---- 재생 ----------------------------------------------------------------------
function frame(ts) {
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
  if (playing) { tod = (tod + dt * speed * 0.5) % 24; update(); }   // 1배속 = 2초에 1시간
  animateFlow(dt);
  requestAnimationFrame(frame);
}
function label() {
  $('playBtn').innerHTML = playing ? t1({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t1({ ko: '▶ 24시간 재생', en: '▶ Play 24 h' });
  $('speedBtn').textContent = t1({ ko: '배속 ', en: 'Speed ' }) + speed + '×';
}

async function main() {
  try { D = await (await fetch('assets/data/twin.json')).json(); }
  catch (e) { $('map').textContent = 'twin.json을 불러오지 못했습니다 / could not load twin.json'; return; }
  buildMap(); renderTable();
  $('playBtn').addEventListener('click', () => { playing = !playing; label(); });
  $('speedBtn').addEventListener('click', () => { speed = { 1: 2, 2: 4, 4: 1 }[speed]; label(); });
  $('slider').addEventListener('input', e => { tod = +e.target.value; update(); });
  document.querySelectorAll('.twin-ctrl input[type=checkbox]').forEach(c => c.addEventListener('change', update));
  document.querySelectorAll('[data-hour]').forEach(b => b.addEventListener('click', () => { tod = +b.dataset.hour; playing = false; label(); update(); }));
  const c = $('mixChart');
  c.addEventListener('mousemove', e => { const r = c.getBoundingClientRect(); const h = Math.round((e.clientX - r.left - 46) / (r.width - 58) * 23); chartHover = h >= 0 && h < 24 ? h : null; drawChart(); });
  c.addEventListener('mouseleave', () => { chartHover = null; drawChart(); });
  c.addEventListener('click', () => { if (chartHover != null) { tod = chartHover; playing = false; label(); update(); } });
  $('map').addEventListener('click', e => { if (e.target === svg) hideTip(); });
  document.addEventListener('langchange', () => { label(); renderTable(); update(); placeLabels(); });
  window.addEventListener('resize', drawChart);
  label(); update(); placeLabels(); requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
