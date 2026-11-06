// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 세계 항공 교통 페이지: 메르카토르 세계 지도 위의 국내선·국제선 항공기, 낮·밤 경계, 편 정보
import { buildSchedule, airborne, stateAt, routePoints, subsolar, AIRPORTS, BY_CODE, KINDS } from './flights.js?v=20261106a';

const $ = (id) => document.getElementById(id);
const t = (o) => (window.t ? window.t(o) : o.ko);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const RAD = Math.PI / 180;
const COL = { dom: '#f5b301', intl: '#3fb4f0' };
const SPEEDS = [1, 10, 60, 300, 1200];
const REGIONS = {
  world: { label: { ko: '세계', en: 'World' }, lon: 15, lat: 28, z: null },
  eastasia: { label: { ko: '동아시아', en: 'East Asia' }, lon: 125, lat: 33, z: 3.4 },
  korea: { label: { ko: '한국', en: 'Korea' }, lon: 127.6, lat: 35.9, z: 6.2 },
  sea: { label: { ko: '동남아시아', en: 'Southeast Asia' }, lon: 110, lat: 9, z: 3.5 },
  europe: { label: { ko: '유럽', en: 'Europe' }, lon: 10, lat: 49, z: 3.7 },
  namerica: { label: { ko: '북아메리카', en: 'North America' }, lon: -98, lat: 40, z: 3.2 },
  samerica: { label: { ko: '남아메리카', en: 'South America' }, lon: -62, lat: -18, z: 2.9 },
  oceania: { label: { ko: '오세아니아', en: 'Oceania' }, lon: 150, lat: -28, z: 3.3 }
};

let S, simT = Date.now() / 1000, running = true, speedIdx = 2, lastT = 0;
let view = { lon: 127, lat: 33, z: 3.4 }, goal = null;
let selected = null, hoverF = null, focusAp = null, shown = [];
let map = null;                                              // 세계 지도 데이터 (Path2D)

// ---- 메르카토르 ----------------------------------------------------------------------
const MAXLAT = 85;
const mx = (lon) => (lon + 180) / 360;
const my = (lat) => { const s = Math.sin(clamp(lat, -MAXLAT, MAXLAT) * RAD); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD);
let V;                                                        // 이번 프레임의 화면 변환
function makeView(cw, ch) {
  const Wp = 256 * 2 ** view.z;
  return { cw, ch, Wp, cx: mx(view.lon), cy: my(view.lat) };
}
const sx = (x, k = 0) => (x - V.cx + k) * V.Wp + V.cw / 2;
const sy = (y) => (y - V.cy) * V.Wp + V.ch / 2;
// 화면을 덮는 세계 복사본 오프셋 (날짜변경선 넘어 이어 그리기)
function copies() {
  const out = [];
  for (let k = -2; k <= 2; k++) { const x0 = sx(0, k), x1 = sx(1, k); if (x1 >= 0 && x0 <= V.cw) out.push(k); }
  return out;
}
const minZ = (cw) => Math.log2(cw / 256);

// ---- 지도 데이터 ---------------------------------------------------------------------
// 날짜변경선(±180°)을 넘는 고리: 면은 경도를 이어 붙여(181°, 182°…) 그리고 (세계 복사본이 나머지를 채움),
// 선은 넘는 곳에서 끊는다. 그대로 그리면 지도를 가로지르는 띠가 생긴다.
function decode(lines, s, close) {
  const p = new Path2D();
  for (const L of lines) {
    let lon = L[0] / s, lat = L[1] / s, ulon = lon;
    p.moveTo(mx(ulon), my(lat));
    for (let i = 2; i < L.length; i += 2) {
      const prev = lon; lon += L[i] / s; lat += L[i + 1] / s;
      const d = lon - prev;
      if (Math.abs(d) > 180) {
        if (!close) { ulon = lon; p.moveTo(mx(ulon), my(lat)); continue; }
        ulon += d > 0 ? d - 360 : d + 360;
      } else ulon += d;
      p.lineTo(mx(ulon), my(lat));
    }
    if (close) p.closePath();
  }
  return p;
}
async function loadMap() {
  const res = await fetch('assets/data/world-map.json?v=20261106a');
  const d = await res.json();
  map = { land110: decode(d.land110, d.s, true), land50: decode(d.land50, d.s, true), borders: decode(d.borders50, d.s, false) };
  bgKey = '';
}
// 지구본 격자
function graticule() {
  const p = new Path2D();
  for (let lon = -180; lon <= 180; lon += 30) { p.moveTo(mx(lon), my(MAXLAT)); p.lineTo(mx(lon), my(-MAXLAT)); }
  for (let lat = -60; lat <= 60; lat += 30) { p.moveTo(0, my(lat)); p.lineTo(1, my(lat)); }
  return p;
}
const GRAT = graticule();

// ---- 바탕 지도 (화면이 바뀔 때만 다시 그림) ------------------------------------------------
const bg = document.createElement('canvas');
let bgKey = '';
function palette() {
  return dark()
    ? { sea: '#081320', land: '#26374b', border: 'rgba(150,175,200,.38)', coast: 'rgba(130,160,190,.55)', grat: 'rgba(255,255,255,.05)', apt: '#9fb3c8', aptLabel: '#cfd8e3', label: 'rgba(10,16,24,.8)' }
    : { sea: '#c9dcea', land: '#f3f0e8', border: 'rgba(120,110,95,.45)', coast: 'rgba(110,130,150,.55)', grat: 'rgba(30,60,90,.07)', apt: '#5b6b7c', aptLabel: '#2c3440', label: 'rgba(255,255,255,.9)' };
}
function drawBackground(dpr) {
  const key = [V.cw, V.ch, dpr, view.lon.toFixed(4), view.lat.toFixed(4), view.z.toFixed(3), dark(), !!map].join('|');
  if (key === bgKey) return;
  bgKey = key;
  bg.width = Math.round(V.cw * dpr); bg.height = Math.round(V.ch * dpr);
  const c = bg.getContext('2d'), P = palette();
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = P.sea; c.fillRect(0, 0, V.cw, V.ch);
  if (!map) return;
  const land = view.z >= 3.2 ? map.land50 : map.land110;
  for (const k of copies()) {
    c.save();
    c.setTransform(dpr * V.Wp, 0, 0, dpr * V.Wp, dpr * sx(0, k), dpr * sy(0));
    c.lineWidth = 1 / V.Wp;
    c.strokeStyle = P.grat; c.stroke(GRAT);
    c.fillStyle = P.land; c.fill(land);
    c.strokeStyle = P.coast; c.lineWidth = 0.8 / V.Wp; c.stroke(land);
    if (view.z >= 2.2) { c.strokeStyle = P.border; c.lineWidth = 0.7 / V.Wp; c.stroke(map.borders); }
    c.restore();
  }
}

// ---- 낮·밤 (해의 고도로 칠함: 박명은 옅게) -------------------------------------------------
const night = document.createElement('canvas'); night.width = 360; night.height = 360;
let nightAt = -1e9;
function updateNight() {
  if (Math.abs(simT - nightAt) < 120) return;              // 2분(가상 시각)마다
  nightAt = simT;
  const ss = subsolar(simT), c = night.getContext('2d'), img = c.createImageData(360, 360);
  const sd = Math.sin(ss.lat * RAD), cd = Math.cos(ss.lat * RAD);
  const shade = dark() ? [0, 4, 16] : [10, 20, 60], maxA = dark() ? 105 : 95;
  for (let j = 0; j < 360; j++) {
    const lat = latOf((j + 0.5) / 360), sl = Math.sin(lat * RAD), cl = Math.cos(lat * RAD);
    for (let i = 0; i < 360; i++) {
      const lon = (i + 0.5) / 360 * 360 - 180;
      const alt = Math.asin(sl * sd + cl * cd * Math.cos((lon - ss.lon) * RAD)) / RAD;   // 해의 고도 (도)
      const a = clamp(-alt / 12, 0, 1) ** 0.8 * maxA;                                   // 0°~−12°: 박명
      const o = (j * 360 + i) * 4; img.data[o] = shade[0]; img.data[o + 1] = shade[1]; img.data[o + 2] = shade[2]; img.data[o + 3] = a;
    }
  }
  c.putImageData(img, 0, 0);
}

// ---- 항공기 -----------------------------------------------------------------------
const PLANE = new Path2D('M0 -0.5 L0.06 -0.38 L0.06 -0.1 L0.48 0.08 L0.48 0.17 L0.06 0.06 L0.05 0.31 L0.2 0.41 L0.2 0.48 L0 0.43 L-0.2 0.48 L-0.2 0.41 L-0.05 0.31 L-0.06 0.06 L-0.48 0.17 L-0.48 0.08 L-0.06 -0.1 L-0.06 -0.38 Z');
function altColor(alt) {                                      // 낮음(주황) → 높음(남색)
  const k = clamp(alt / 11500, 0, 1), stops = [[232, 120, 40], [235, 200, 60], [90, 200, 130], [70, 160, 230], [140, 110, 230]];
  const x = k * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return `rgb(${stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f)).join(',')})`;
}
function planeColor(f, s) { return $('colorSel').value === 'alt' ? altColor(s.alt) : f.dom ? COL.dom : COL.intl; }
function filterFn() {
  const d = $('fDom').checked, i = $('fIntl').checked;
  return (f) => (f.dom ? d : i);
}

// ---- 한 장 그리기 ------------------------------------------------------------------
function fit(canvas, aspect) {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth, ch = Math.round(cw * aspect);
  canvas.style.height = ch + 'px';
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cw, ch, dpr };
}
function draw() {
  const canvas = $('flMap'), { ctx, cw, ch, dpr } = fit(canvas, innerWidth < 700 ? 0.95 : 0.56);
  view.z = Math.max(view.z, minZ(cw) - 0.05);
  if (goal) {
    let done = true;
    for (const k of ['lon', 'lat', 'z']) { const d = (goal[k] - view[k]) * 0.14; view[k] += d; if (Math.abs(d) > 1e-4) done = false; }
    if (done) goal = null;
  }
  view.lat = clamp(view.lat, -75, 78); view.lon = ((view.lon + 540) % 360) - 180;
  V = makeView(cw, ch);
  const P = palette();
  drawBackground(dpr);
  ctx.drawImage(bg, 0, 0, cw, ch);
  // 낮·밤
  updateNight();
  ctx.save(); ctx.imageSmoothingEnabled = true;
  for (const k of copies()) ctx.drawImage(night, sx(0, k), sy(0), V.Wp, V.Wp);
  ctx.restore();
  // 공항
  const showAp = (a) => view.z >= (a.tier === 1 ? 2.6 : a.tier === 2 ? 3.6 : 4.8);
  ctx.font = '600 10.5px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const k of copies()) for (const a of AIRPORTS) {
    const x = sx(mx(a.lon), k), y = sy(my(a.lat));
    if (x < -40 || x > cw + 40 || y < -20 || y > ch + 20) continue;
    const r = a.tier === 1 ? 2.6 : a.tier === 2 ? 2 : 1.5, foc = focusAp === a.code;
    ctx.fillStyle = foc ? '#f5c518' : P.apt; ctx.beginPath(); ctx.arc(x, y, foc ? 4.5 : r, 0, 7); ctx.fill();
    if (showAp(a) || foc) { ctx.fillStyle = P.aptLabel; ctx.textAlign = 'left'; ctx.fillText(view.z >= 5.2 ? `${a.code} ${t(a.name)}` : a.code, x + 5, y - 6); }
  }
  // 선택한 편의 항로
  const sel = selected != null ? S.flights[selected] : null, selState = sel && stateAt(sel, simT);
  if (sel && !selState) selected = null;
  if (sel && selState) drawRoute(ctx, sel, selState);
  // 항공기
  const filt = filterFn(), list = airborne(S.flights, simT, filt);
  const size = clamp(5 + view.z * 1.7, 7, 20);
  shown = [];
  ctx.lineWidth = 0.8; ctx.lineJoin = 'round';
  for (const { f, s } of list) {
    const dim = focusAp && f.o.code !== focusAp && f.x.code !== focusAp;
    const m = size * (f.kind === 'wide' ? 1.2 : f.kind === 'prop' ? 0.8 : 1);
    for (const k of copies()) {
      const x = sx(mx(s.lon), k), y = sy(my(s.lat));
      if (x < -m || x > cw + m || y < -m || y > ch + m) continue;
      shown.push({ f, s, x, y });
      ctx.setTransform(dpr * m, 0, 0, dpr * m, dpr * x, dpr * y); ctx.rotate(s.hd * RAD);
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fillStyle = planeColor(f, s); ctx.fill(PLANE);
      ctx.lineWidth = 0.9 / m; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke(PLANE);
    }
  }
  ctx.globalAlpha = 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 선택·마우스 올림 표시
  for (const [fid, colr] of [[hoverF, 'rgba(255,255,255,.85)'], [selected, '#f5c518']]) {
    if (fid == null) continue;
    for (const p of shown) if (p.f.id === fid) {
      ctx.strokeStyle = colr; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, size * 0.85, 0, 7); ctx.stroke();
      const lbl = `${p.f.no} ${p.f.o.code}→${p.f.x.code}`;
      ctx.font = '600 11px system-ui, sans-serif'; const w = ctx.measureText(lbl).width + 10;
      ctx.fillStyle = 'rgba(15,20,28,.85)'; ctx.beginPath(); ctx.roundRect(p.x + size * 0.9, p.y - 9, w, 18, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(lbl, p.x + size * 0.9 + 5, p.y);
    }
  }
  // 왼쪽 위: 시각
  const kst = simT + 9 * 3600, diff = Math.round((simT - Date.now() / 1000) / 60);
  const line = `UTC ${fmtTime(simT)} · ${t({ ko: '한국', en: 'KST' })} ${fmtTime(kst)}${Math.abs(diff) > 1 ? ' · ' + t({ ko: `실제보다 ${diff > 0 ? '+' : ''}${fmtDur(diff * 60)}`, en: `${diff > 0 ? '+' : '−'}${fmtDur(Math.abs(diff) * 60)} vs now` }) : ''}`;
  ctx.font = `600 ${cw < 520 ? 11 : 13}px system-ui, sans-serif`; ctx.textAlign = 'left';
  const w = ctx.measureText(line).width + 20;
  ctx.fillStyle = 'rgba(15,20,28,.75)'; ctx.beginPath(); ctx.roundRect(8, 8, w, 26, 13); ctx.fill();
  ctx.fillStyle = '#f3f4f6'; ctx.fillText(line, 18, 21);
  draw.count = { all: list.length, dom: list.filter(x => x.f.dom).length, view: new Set(shown.map(p => p.f.id)).size };
}
function drawRoute(ctx, f, s) {
  const pts = routePoints(f, 96);
  // 경도를 이어 붙여 날짜변경선에서 끊기지 않게
  let prev = pts[0].lon; const un = pts.map(p => { let lon = p.lon; while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; prev = lon; return { lon, lat: p.lat }; });
  const cut = Math.round(s.p * 96);
  for (const k of copies()) {
    const X = (p) => sx(mx(p.lon), k), Y = (p) => sy(my(p.lat));
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#f5c518'; ctx.setLineDash([]); ctx.beginPath();
    un.slice(0, cut + 1).forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.stroke();
    ctx.strokeStyle = 'rgba(245,197,24,.6)'; ctx.setLineDash([6, 5]); ctx.beginPath();
    un.slice(cut).forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.stroke();
    ctx.setLineDash([]);
    for (const a of [f.o, f.x]) { const p = un[a === f.o ? 0 : 96]; ctx.fillStyle = '#f5c518'; ctx.beginPath(); ctx.arc(X(p), Y(p), 4.5, 0, 7); ctx.fill(); }
  }
}
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (s) => { const d = new Date(s * 1000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const fmtDur = (s) => { s = Math.max(0, Math.round(s / 60)); return s >= 60 ? `${Math.floor(s / 60)}${t({ ko: '시간 ', en: 'h ' })}${s % 60}${t({ ko: '분', en: 'm' })}` : `${s}${t({ ko: '분', en: ' min' })}`; };
const local = (s, ap) => fmtTime(s + ap.tz * 3600);

// ---- 옆 패널 ----------------------------------------------------------------------
function panel() {
  const el = $('flPanel');
  const f = selected != null ? S.flights[selected] : null, s = f && stateAt(f, simT);
  if (f && s) {
    const remain = (1 - s.p) * f.d;
    el.innerHTML = `
      <div class="fl-card">
        <div class="fl-head"><b>${f.no}</b><span class="fl-tag ${f.dom ? 'dom' : 'intl'}">${f.dom ? t({ ko: '국내선', en: 'Domestic' }) : t({ ko: '국제선', en: 'International' })}</span></div>
        <div class="meta">${t(f.al.name)} · ${t(KINDS[f.kind])}</div>
        <div class="fl-route">
          <div><b>${f.o.code}</b><span>${t(f.o.name)}</span><small>${t({ ko: '출발', en: 'Dep' })} ${local(s.dep, f.o)} ${t({ ko: '현지', en: 'local' })}</small></div>
          <div class="fl-arrow">✈</div>
          <div><b>${f.x.code}</b><span>${t(f.x.name)}</span><small>${t({ ko: '도착', en: 'Arr' })} ${local(s.arr, f.x)} ${t({ ko: '현지', en: 'local' })}</small></div>
        </div>
        <div class="fl-bar"><i style="width:${(s.p * 100).toFixed(1)}%"></i></div>
        <div class="fl-grid">
          <div><span>${t({ ko: '고도', en: 'Altitude' })}</span><b>${Math.round(s.alt).toLocaleString()} m</b><small>${Math.round(s.alt * 3.281 / 100) * 100} ft</small></div>
          <div><span>${t({ ko: '속도', en: 'Ground speed' })}</span><b>${Math.round(s.kmh)} km/h</b><small>${Math.round(s.kmh / 1.852)} kt</small></div>
          <div><span>${t({ ko: '방향', en: 'Heading' })}</span><b>${Math.round(s.hd)}°</b><small>${compass(s.hd)}</small></div>
          <div><span>${t({ ko: '남은 거리', en: 'Remaining' })}</span><b>${Math.round(remain).toLocaleString()} km</b><small>${t({ ko: '전체', en: 'of' })} ${Math.round(f.d).toLocaleString()} km</small></div>
          <div><span>${t({ ko: '비행 시간', en: 'Elapsed' })}</span><b>${fmtDur(simT - s.dep)}</b><small>${t({ ko: '남은 시간', en: 'left' })} ${fmtDur(s.arr - simT)}</small></div>
          <div><span>${t({ ko: '위치', en: 'Position' })}</span><b>${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}</b><small>${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}</small></div>
        </div>
        <button id="followBtn" type="button">${following ? t({ ko: '따라가기 끄기', en: 'Stop following' }) : t({ ko: '지도에서 따라가기', en: 'Follow on map' })}</button>
        <button id="closeBtn" type="button">${t({ ko: '닫기', en: 'Close' })}</button>
      </div>`;
    $('followBtn').onclick = () => { following = !following; panel(); };
    $('closeBtn').onclick = () => { selected = null; following = false; panel(); };
    return;
  }
  const c = draw.count || { all: 0, dom: 0, view: 0 };
  // 지금 붐비는 공항: 이 공항을 출발했거나 이 공항으로 가는 하늘 위의 편 수
  const cnt = {};
  for (const { f } of airborne(S.flights, simT)) { cnt[f.o.code] = (cnt[f.o.code] || 0) + 1; cnt[f.x.code] = (cnt[f.x.code] || 0) + 1; }
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6);
  el.innerHTML = `
    <div class="fl-stats">
      <div><span>${t({ ko: '지금 하늘의 항공기', en: 'Aircraft airborne' })}</span><b>${c.all.toLocaleString()}</b><small>${t({ ko: `국내선 ${c.dom} · 국제선 ${c.all - c.dom}`, en: `${c.dom} domestic · ${c.all - c.dom} international` })}</small></div>
      <div><span>${t({ ko: '화면 안', en: 'In view' })}</span><b>${c.view.toLocaleString()}</b><small>${t({ ko: '필터 적용', en: 'after filters' })}</small></div>
      <div><span>${t({ ko: '하루 운항', en: 'Flights per day' })}</span><b>${S.flights.length.toLocaleString()}</b><small>${t({ ko: `노선 ${S.routes.length.toLocaleString()}개 · 공항 ${AIRPORTS.length}곳`, en: `${S.routes.length.toLocaleString()} routes · ${AIRPORTS.length} airports` })}</small></div>
    </div>
    <h4>${t({ ko: '지금 붐비는 공항', en: 'Busiest airports now' })}</h4>
    <ol class="fl-top">${top.map(([code, n]) => `<li data-ap="${code}"><b>${code}</b> ${t(BY_CODE[code].name)}<span>${n}</span></li>`).join('')}</ol>
    <p class="meta">${t({ ko: '숫자 = 이 공항에서 떠났거나 이 공항으로 가는 중인 항공기. 누르면 그 공항으로 이동합니다.', en: 'Number = aircraft airborne from or to the airport. Click to go there.' })}</p>`;
  el.querySelectorAll('li[data-ap]').forEach(li => li.onclick = () => focusAirport(li.dataset.ap));
}
let following = false;
const compass = (h) => [t({ ko: '북', en: 'N' }), t({ ko: '북동', en: 'NE' }), t({ ko: '동', en: 'E' }), t({ ko: '남동', en: 'SE' }), t({ ko: '남', en: 'S' }), t({ ko: '남서', en: 'SW' }), t({ ko: '서', en: 'W' }), t({ ko: '북서', en: 'NW' })][Math.round(h / 45) % 8];
function focusAirport(code) {
  const a = BY_CODE[code]; if (!a) return;
  focusAp = code; selected = null; following = false;
  goal = { lon: a.lon, lat: a.lat, z: Math.max(view.z, 4.6) };
  $('flSearch').value = code; panel();
}

// ---- 루프 ------------------------------------------------------------------------
let lastPanel = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  if (running) simT += dt * SPEEDS[speedIdx];
  if (following && selected != null) {
    const s = stateAt(S.flights[selected], simT);
    if (s) { let dl = s.lon - view.lon; while (dl > 180) dl -= 360; while (dl < -180) dl += 360; view.lon += dl * 0.2; view.lat += (s.lat - view.lat) * 0.2; }
  }
  draw();
  if (now - lastPanel > 500) { panel(); lastPanel = now; }
  requestAnimationFrame(frame);
}

// ---- 조작 ------------------------------------------------------------------------
function label() {
  $('playBtn').innerHTML = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 재생', en: '▶ Play' });
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Speed ' }) + SPEEDS[speedIdx] + '×';
  const r = $('regionSel'), v = r.value;
  r.innerHTML = `<option value="">${t({ ko: '지역으로 이동…', en: 'Go to region…' })}</option>` + Object.entries(REGIONS).map(([k, o]) => `<option value="${k}">${t(o.label)}</option>`).join('');
  r.value = v && REGIONS[v] ? v : '';
  const c = $('colorSel'), cv = c.value || 'type';
  c.innerHTML = `<option value="type">${t({ ko: '색: 국내선 / 국제선', en: 'Colour: domestic / international' })}</option><option value="alt">${t({ ko: '색: 고도', en: 'Colour: altitude' })}</option>`;
  c.value = cv;
  $('flSearch').placeholder = t({ ko: '편명 또는 공항 코드 (예: ICN, NR123)', en: 'Flight or airport code (e.g. ICN, NR123)' });
  $('altKey').hidden = c.value !== 'alt'; $('typeKey').hidden = c.value === 'alt';
}
function search() {
  const q = $('flSearch').value.trim().toUpperCase();
  if (!q) { focusAp = null; return; }
  if (BY_CODE[q]) return focusAirport(q);
  const f = S.flights.find(x => x.no === q);
  if (!f) { $('flMsg').textContent = t({ ko: `'${q}'를 찾지 못했습니다`, en: `'${q}' not found` }); return; }
  const s = stateAt(f, simT);
  if (!s) { $('flMsg').textContent = t({ ko: `${q}: 지금은 비행 중이 아닙니다 (${f.o.code}→${f.x.code}, 매일 UTC ${fmtTime(f.depTod)} 출발)`, en: `${q} is not airborne now (${f.o.code}→${f.x.code}, departs daily ${fmtTime(f.depTod)} UTC)` }); return; }
  $('flMsg').textContent = ''; focusAp = null; selected = f.id; following = true;
  goal = { lon: s.lon, lat: s.lat, z: Math.max(view.z, 4.5) }; panel();
}
function nearest(x, y, r = 12) {
  let best = null, bd = r;
  for (const p of shown) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
  return best;
}
function zoomAt(px, py, dz) {
  const before = { x: V.cx + (px - V.cw / 2) / V.Wp, y: V.cy + (py - V.ch / 2) / V.Wp };
  view.z = clamp(view.z + dz, minZ(V.cw) - 0.05, 8.5);
  const Wp = 256 * 2 ** view.z;
  view.lon = (before.x - (px - V.cw / 2) / Wp) * 360 - 180;
  view.lat = latOf(clamp(before.y - (py - V.ch / 2) / Wp, 0.0005, 0.9995));
}
function bind() {
  const cv = $('flMap'), pts = new Map();
  let moved = 0, pinch = 0;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; goal = null; });
  cv.addEventListener('pointermove', e => {
    const rect = cv.getBoundingClientRect(), p = pts.get(e.pointerId);
    if (!p) { const h = nearest(e.clientX - rect.left, e.clientY - rect.top); hoverF = h ? h.f.id : null; cv.style.cursor = h ? 'pointer' : 'grab'; return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y); p.x = e.clientX; p.y = e.clientY;
      const d1 = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch && d0 > 0) zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, Math.log2(d1 / d0));
      pinch = 1; return;
    }
    p.x = e.clientX; p.y = e.clientY; following = false;
    view.lon -= dx / V.Wp * 360;
    view.lat = latOf(clamp(my(view.lat) - dy / V.Wp, 0.0005, 0.9995));
  });
  const up = e => {
    const p = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
    if (p && moved < 6) {
      const rect = cv.getBoundingClientRect(), h = nearest(e.clientX - rect.left, e.clientY - rect.top, 16);
      selected = h ? h.f.id : null; following = false; if (h) focusAp = null; panel();
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hoverF = null; });
  cv.addEventListener('wheel', e => { e.preventDefault(); goal = null; const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, -e.deltaY * 0.0022); }, { passive: false });
  cv.addEventListener('dblclick', e => { const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1); });
  $('playBtn').onclick = () => { running = !running; label(); };
  $('speedBtn').onclick = () => { speedIdx = (speedIdx + 1) % SPEEDS.length; label(); };
  $('nowBtn').onclick = () => { simT = Date.now() / 1000; speedIdx = 0; running = true; nightAt = -1e9; label(); };
  $('regionSel').onchange = () => {
    const r = REGIONS[$('regionSel').value]; if (!r) return;
    goal = { lon: r.lon, lat: r.lat, z: r.z ?? minZ(V.cw) }; following = false; focusAp = null;
  };
  $('colorSel').onchange = label;
  $('flSearch').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  $('flGo').onclick = search;
  $('flClear').onclick = () => { $('flSearch').value = ''; $('flMsg').textContent = ''; focusAp = null; selected = null; following = false; panel(); };
  document.addEventListener('langchange', () => { label(); panel(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { bgKey = ''; nightAt = -1e9; });
  new MutationObserver(() => { bgKey = ''; nightAt = -1e9; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
function main() {
  S = buildSchedule();
  label(); bind(); panel();
  loadMap();
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
