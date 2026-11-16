// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 도시 교통망 페이지: 위에서 본 도시 · 조절 · 대시보드(숫자, 시간 그래프, 자율주행 비교, 출입구) · 자율주행차 따라가기
import { City, DEFAULTS, GEO, N, PHASES, lanePoint } from './city.js?v=f47a5117';
import { $, t, css, dark, fit } from '../lib/dom.js?v=3b73d59c';

const SPEEDS = [1, 2, 5, 10, 20];
const FRAME_BUDGET = 14;
const PRESETS = {
  normal: { o: { inflow: 2400, bias: 0, av: 0.2, mode: 'fixed' }, label: { ko: '평상시', en: 'Normal day' } },
  rush: { o: { inflow: 4500, bias: 1, av: 0.2, mode: 'fixed' }, label: { ko: '출근 혼잡 (동→서)', en: 'Morning rush (E→W)' } },
  allav: { o: { inflow: 4500, bias: 1, av: 1, mode: 'fixed' }, label: { ko: '출근 혼잡 · 자율주행 100%', en: 'Rush · 100% autonomous' } },
  wave: { o: { inflow: 3000, bias: 0, av: 0.2, mode: 'wave' }, label: { ko: '녹색 물결 신호', en: 'Green wave signals' } },
  act: { o: { inflow: 3000, bias: 0, av: 0.2, mode: 'actuated' }, label: { ko: '감응식 신호', en: 'Actuated signals' } }
};
const HUMAN_COLS = ['#d9dde3', '#b9c0ca', '#f1f3f5', '#9aa3ad', '#c7b9a6', '#e8e0d0'];

let sim, running = false, speedIdx = 1, seed = 1, acc = 0, last = 0, follow = null, picked = null, hover = null;
const view = { cx: 3 * GEO.block, cy: 3 * GEO.block, s: 1, fitted: false };
const num = (id) => +$(id).value;
const flag = (id) => $(id).checked;
const kmh = (v) => (Number.isFinite(v) ? (v * 3.6).toFixed(0) : '–');
const f0 = (v) => (Number.isFinite(v) ? v.toFixed(0) : '–');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');

function settings() {
  return { inflow: num('cvIn'), av: num('cvAv') / 100, bias: num('cvBias') / 100, mode: $('cvMode').value, green: num('cvGreen'), left: num('cvLeft') };
}
function build() {
  sim = new City({ seed, ...settings() });
  follow = null; picked = null; acc = 0;
  labels(); stats(); charts(); compare(); gates();
}

// ---- 위에서 본 도시 ---------------------------------------------------------------------
function fitView(cw, ch) {
  const span = (N - 1) * GEO.block + 2 * GEO.gate + 20;
  view.s = Math.min(cw, ch) / span; view.cx = 3 * GEO.block; view.cy = 3 * GEO.block; view.fitted = true;
}
const toScr = (x, y, cw, ch) => [cw / 2 + (x - view.cx) * view.s, ch / 2 + (y - view.cy) * view.s];

function draw() {
  const cv = $('cvView'), { ctx, cw, ch } = fit(cv, Math.min(0.78, (innerHeight - 140) / Math.max(320, cv.clientWidth)));
  if (!view.fitted) fitView(cw, ch);
  if (follow) {
    const p = sim.carPos(follow); view.cx += (p[0] - view.cx) * 0.15; view.cy += (p[1] - view.cy) * 0.15;
  }
  const S = view.s, X = (x) => cw / 2 + (x - view.cx) * S, Y = (y) => ch / 2 + (y - view.cy) * S;
  const B = GEO.block, half = 2 * GEO.laneW, dk = dark();
  ctx.fillStyle = dk ? '#1d2620' : '#cfd8c4'; ctx.fillRect(0, 0, cw, ch);
  // 블록 (보도 + 건물)
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const x0 = i * B + half, y0 = j * B + half, w = B - 2 * half;
    ctx.fillStyle = dk ? '#3a3d42' : '#e4e1da'; ctx.fillRect(X(x0), Y(y0), w * S, w * S);
    const inset = 4, bw = (w - 2 * inset - 4) / 2;
    for (let q = 0; q < 4; q++) {
      const bx = x0 + inset + (q % 2) * (bw + 4), by = y0 + inset + Math.floor(q / 2) * (bw + 4), h = ((i * 7 + j * 3 + q * 5) % 5) / 5;
      ctx.fillStyle = dk ? `rgb(${52 + h * 26},${56 + h * 26},${64 + h * 26})` : `rgb(${196 - h * 40},${198 - h * 38},${204 - h * 34})`;
      ctx.fillRect(X(bx), Y(by), bw * S, bw * S);
    }
  }
  // 도로 (출입구 도로 포함)
  ctx.fillStyle = dk ? '#2b2e33' : '#5a5f67';
  const lo = -GEO.gate, hi = (N - 1) * B + GEO.gate;
  for (let k = 0; k < N; k++) {
    ctx.fillRect(X(lo), Y(k * B - half), (hi - lo) * S, 2 * half * S);
    ctx.fillRect(X(k * B - half), Y(lo), 2 * half * S, (hi - lo) * S);
  }
  // 차선: 중앙선(황색) · 차로 경계(흰 점선) · 정지선 (가까이 볼 때만)
  if (S > 0.55) {
    ctx.lineWidth = Math.max(1, 0.15 * S);
    for (const l of sim.links) {
      const r = [-l.d[1], l.d[0]], a = l.a, b = l.b, at = (p, off) => [X(p[0] + r[0] * off), Y(p[1] + r[1] * off)];
      ctx.strokeStyle = '#e8b931'; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(...at(a, 0.12)); ctx.lineTo(...at(b, 0.12)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.setLineDash([3 * S, 4 * S]);
      ctx.beginPath(); ctx.moveTo(...at(a, GEO.laneW)); ctx.lineTo(...at(b, GEO.laneW)); ctx.stroke();
      ctx.setLineDash([]);
      if (l.to >= 0) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, 0.4 * S); ctx.beginPath(); ctx.moveTo(...at(b, 0.2)); ctx.lineTo(...at(b, 2 * GEO.laneW)); ctx.stroke(); ctx.lineWidth = Math.max(1, 0.15 * S); }
    }
  }
  // 혼잡 지도: 교차로마다 멈춘 차 수
  if (flag('cvHeat')) for (const n of sim.nodes) {
    const q = sim.nodeQueue(n); if (!q) continue;
    const k = Math.min(1, q / 24), r = (14 + 30 * k) * Math.max(S, 0.6);
    const g = ctx.createRadialGradient(X(n.x), Y(n.y), 0, X(n.x), Y(n.y), r);
    g.addColorStop(0, `rgba(217,72,15,${0.25 + 0.45 * k})`); g.addColorStop(1, 'rgba(217,72,15,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r, 0, 7); ctx.fill();
  }
  // 따라가는 차의 남은 경로
  if (follow) {
    const route = sim.routeAhead(follow);
    ctx.strokeStyle = 'rgba(27,175,122,.55)'; ctx.lineWidth = Math.max(2, 1.2 * S); ctx.setLineDash([]);
    ctx.beginPath();
    route.forEach((l, i) => { const k = i === 0 && !follow.box ? follow.lane.k : 1, p0 = lanePoint(l.lanes[k], i === 0 && !follow.box ? follow.s : 0), p1 = lanePoint(l.lanes[k], l.len); if (i === 0) ctx.moveTo(X(p0[0]), Y(p0[1])); else ctx.lineTo(X(p0[0]), Y(p0[1])); ctx.lineTo(X(p1[0]), Y(p1[1])); });
    ctx.stroke();
  }
  // 신호등: 정지선 옆 점 두 개 (안쪽 = 좌회전, 바깥 = 직진·우회전)
  if (flag('cvSig') && S > 0.45) for (const n of sim.nodes) for (const l of n.in) {
    for (const [k, mv] of [[0, 'L'], [1, 'T']]) {
      const sig = sim.signal(n, l, mv), p = lanePoint(l.lanes[k], l.len + 1.2);
      ctx.fillStyle = sig === 'G' ? '#2f9e44' : sig === 'Y' ? '#f59f00' : '#e03131';
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), Math.max(1.6, 0.9 * S), 0, 7); ctx.fill();
    }
  }
  // 차량
  const cl = Math.max(3.6, 4.5 * S), cwid = Math.max(2.2, 1.9 * S);
  for (const car of sim.cars()) {
    const [x, y, a] = sim.carPos(car), sx = X(x), sy = Y(y);
    if (sx < -10 || sy < -10 || sx > cw + 10 || sy > ch + 10) continue;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
    ctx.fillStyle = car.av ? '#1baf7a' : HUMAN_COLS[car.id % HUMAN_COLS.length];
    ctx.fillRect(-cl / 2, -cwid / 2, cl, cwid);
    if (S > 1.5) { ctx.fillStyle = 'rgba(20,30,40,.55)'; ctx.fillRect(cl * 0.08, -cwid / 2 + 0.25 * S, cl * 0.22, cwid - 0.5 * S); }
    if (car === follow) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(-cl / 2 - 1.5, -cwid / 2 - 1.5, cl + 3, cwid + 3); }
    ctx.restore();
  }
  // 자율주행차 센서 · 인식
  if (follow) sensor(ctx, X, Y, S);
  // 선택한 교차로
  if (picked != null) { const n = sim.nodes[picked]; ctx.strokeStyle = css('--accent') || '#1f6feb'; ctx.lineWidth = 2; ctx.strokeRect(X(n.x - 9), Y(n.y - 9), 18 * S, 18 * S); }
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const tm = Math.floor(sim.t), hh = String(Math.floor(tm / 60)).padStart(2, '0'), ss = String(tm % 60).padStart(2, '0');
  ctx.fillStyle = dk ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.8)'; ctx.fillRect(8, 8, 116, 20);
  ctx.fillStyle = dk ? '#e7e8ea' : '#1d1f24'; ctx.fillText(`${t({ ko: '경과', en: 'elapsed' })} ${hh}:${ss}`, 14, 12);
}
function sensor(ctx, X, Y, S) {
  const car = follow, [x, y] = sim.carPos(car), R = 40;
  ctx.strokeStyle = 'rgba(27,175,122,.8)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(X(x), Y(y), R * S, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(27,175,122,.08)'; ctx.fill();
  const notes = [];
  if (!car.box) {
    const lane = car.lane, i = lane.cars.indexOf(car), lead = i > 0 ? lane.cars[i - 1] : null;
    if (lead) { const p = sim.carPos(lead), gap = lead.s - car.s - sim.o.len; ctx.strokeStyle = '#1baf7a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(p[0]), Y(p[1])); ctx.stroke(); notes.push(t({ ko: `앞차 ${gap.toFixed(0)} m`, en: `lead car ${gap.toFixed(0)} m` })); }
    if (car.link.to >= 0) {
      const n = sim.nodes[car.link.to], sig = sim.signal(n, car.link, car.move), d = car.link.len - car.s, sp = lanePoint(lane, car.link.len);
      if (d < 160) {
        ctx.strokeStyle = sig === 'G' ? '#2f9e44' : sig === 'Y' ? '#f59f00' : '#e03131'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(sp[0]), Y(sp[1])); ctx.stroke(); ctx.setLineDash([]);
        const tg = sig === 'G' ? null : sim.timeToGreen(n, car.link, car.move);
        notes.push(t({ ko: `신호 ${sig === 'G' ? '녹색' : sig === 'Y' ? '황색' : '적색'} · ${d.toFixed(0)} m`, en: `signal ${sig === 'G' ? 'green' : sig === 'Y' ? 'amber' : 'red'} · ${d.toFixed(0)} m` }) +
          (tg != null ? t({ ko: ` · 녹색까지 ${tg.toFixed(0)}초 (V2I)`, en: ` · green in ${tg.toFixed(0)} s (V2I)` }) : ''));
      }
      notes.push(t({ ko: `다음 교차로: ${car.move === 'L' ? '좌회전' : car.move === 'R' ? '우회전' : '직진'}`, en: `next junction: ${car.move === 'L' ? 'left' : car.move === 'R' ? 'right' : 'straight'}` }));
    } else notes.push(t({ ko: '도시를 빠져나가는 중', en: 'leaving the city' }));
  } else notes.push(t({ ko: '교차로 통과 중', en: 'crossing the junction' }));
  notes.unshift(t({ ko: `자율주행차 #${car.id} · ${kmh(car.v)} km/h`, en: `Autonomous car #${car.id} · ${kmh(car.v)} km/h` }));
  ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const w = Math.max(...notes.map(s => ctx.measureText(s).width)) + 16, h = notes.length * 17 + 10, bx = 8, by = 34;
  ctx.fillStyle = 'rgba(10,30,24,.82)'; ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = '#e6fcf5'; notes.forEach((s, i) => ctx.fillText(s, bx + 8, by + 6 + i * 17));
}

// ---- 대시보드 ---------------------------------------------------------------------------
function stats() {
  const s = sim.stats(), cell = (k, v, sub = '') => `<div><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  $('cvStats').innerHTML =
    cell(t({ ko: '도시 안 차량', en: 'Cars in the city' }), String(s.inCity), t({ ko: `멈춘 차 ${s.stopped}`, en: `${s.stopped} stopped` })) +
    cell(t({ ko: '평균 속도', en: 'Average speed' }), `${kmh(s.speed)} km/h`) +
    cell(t({ ko: '유입 (최근 1분)', en: 'Inflow (last min)' }), `${s.inflow} ${t({ ko: '대', en: 'cars' })}`, t({ ko: `도시 밖 대기 ${s.waiting}대`, en: `${s.waiting} waiting outside` })) +
    cell(t({ ko: '유출 (최근 1분)', en: 'Outflow (last min)' }), `${s.outflow} ${t({ ko: '대', en: 'cars' })}`) +
    cell(t({ ko: '평균 통행시간', en: 'Average trip time' }), `${f0(s.time)} ${t({ ko: '초', en: 's' })}`, t({ ko: `지연 ${f0(s.delay)}초 (최근 5분)`, en: `delay ${f0(s.delay)} s (last 5 min)` })) +
    cell(t({ ko: '평균 정지 횟수', en: 'Stops per trip' }), f1(s.stops), t({ ko: `완료 ${s.trips}대`, en: `${s.trips} trips` }));
  if (picked != null) nodeInfo();
}
function nodeInfo() {
  const n = sim.nodes[picked], P = PHASES[n.phase], arms = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const q = (dk) => { const l = n.in.find(x => x.dk === dk); return l ? l.lanes.reduce((s, ln) => s + ln.cars.filter(c => c.v < 1 && l.len - c.s < 80).length, 0) : 0; };
  const st = n.stage === 'green' ? t({ ko: '녹색', en: 'green' }) : n.stage === 'yellow' ? t({ ko: '황색', en: 'amber' }) : t({ ko: '전적색', en: 'all red' });
  const from = { N: t({ ko: '북쪽에서', en: 'from N' }), S: t({ ko: '남쪽에서', en: 'from S' }), E: t({ ko: '동쪽에서', en: 'from E' }), W: t({ ko: '서쪽에서', en: 'from W' }) };
  $('cvNode').innerHTML = `<b>${t({ ko: '교차로', en: 'Junction' })} (${n.i + 1}, ${n.j + 1})</b> · ${t(P.label)} ${st} · ${t({ ko: '남은', en: 'left' })} ${f0(n.left)}${t({ ko: '초', en: ' s' })}<br>` +
    Object.entries(arms).map(([side, dk]) => `${from[side]} ${q(dk)}`).join(' · ') + ` ${t({ ko: '대 대기', en: 'cars queued' })}`;
}
// 시간 그래프: 같은 단위끼리만 한 그림에 (축 하나)
const CHARTS = [
  { id: 'cvFlow', unit: { ko: '대/분', en: 'cars/min' }, series: [{ key: 'inflow', col: '--cv-in', label: { ko: '유입', en: 'Inflow' } }, { key: 'outflow', col: '--cv-out', label: { ko: '유출', en: 'Outflow' } }] },
  { id: 'cvCount', unit: { ko: '대', en: 'cars' }, series: [{ key: 'inCity', col: '--cv-in', label: { ko: '도시 안 차량', en: 'Cars in the city' } }] },
  { id: 'cvSpeed', unit: { ko: 'km/h', en: 'km/h' }, series: [{ key: 'speed', col: '--cv-in', label: { ko: '평균 속도', en: 'Average speed' }, f: v => v * 3.6 }] }
];
function charts() {
  const H = sim.history;
  for (const C of CHARTS) {
    const cv = $(C.id), { ctx, cw, ch } = fit(cv), padL = 38, padR = 64, padT = 10, padB = 22;
    ctx.clearRect(0, 0, cw, ch);
    const val = (h, s) => { const v = h[s.key]; return Number.isFinite(v) ? (s.f ? s.f(v) : v) : null; };
    let max = 1; for (const h of H) for (const s of C.series) { const v = val(h, s); if (v != null) max = Math.max(max, v); }
    max = niceMax(max);
    const t0 = H.length ? H[0].t : 0, t1 = Math.max(t0 + 60, H.length ? H[H.length - 1].t : 60);
    const X = (tt) => padL + (cw - padL - padR) * (tt - t0) / (t1 - t0), Y = (v) => ch - padB - (ch - padB - padT) * v / max;
    ctx.font = '11px system-ui, sans-serif'; ctx.strokeStyle = css('--line'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) { const v = max * k / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cw - padR, y); ctx.stroke(); ctx.fillText(fmtTick(v), padL - 6, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const span = (t1 - t0) / 5, step = [30, 60, 120, 300, 600, 1200, 1800, 3600].find(v => v >= span) || 7200;   // 30초 · 1분 · 2분 … 단위
    const lab = (tt) => (step < 60 ? `${Math.floor(tt / 60)}:${String(tt % 60).padStart(2, '0')}` : `${Math.round(tt / 60)}${t({ ko: '분', en: ' min' })}`);
    for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) ctx.fillText(lab(tt), X(tt), ch - padB + 5);
    for (const s of C.series) {
      ctx.strokeStyle = css(s.col); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false, lastP = null;
      for (const h of H) { const v = val(h, s); if (v == null) continue; const p = [X(h.t), Y(v)]; started ? ctx.lineTo(...p) : ctx.moveTo(...p); started = true; lastP = [p, v]; }
      ctx.stroke();
      if (lastP) {                                                   // 끝에 이름 · 값 (글자는 본문 색, 옆에 점이 색을 맡음)
        ctx.fillStyle = css(s.col); ctx.beginPath(); ctx.arc(lastP[0][0], lastP[0][1], 3, 0, 7); ctx.fill();
        ctx.fillStyle = css('--text'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(C.series.length > 1 ? `${t(s.label)} ${fmtTick(lastP[1])}` : fmtTick(lastP[1]), lastP[0][0] + 6, lastP[0][1] + (C.series.length > 1 && s === C.series[1] ? 10 : 0));
      }
    }
    // 마우스를 올린 시각: 세로선 + 값
    if (hover && hover.id === C.id && H.length) {
      const tt = t0 + (hover.x - padL) / (cw - padL - padR) * (t1 - t0);
      let best = H[0]; for (const h of H) if (Math.abs(h.t - tt) < Math.abs(best.t - tt)) best = h;
      const x = X(best.t); ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, ch - padB); ctx.stroke(); ctx.setLineDash([]);
      for (const s of C.series) { const v = val(best, s); if (v == null) continue; ctx.fillStyle = css('--surface'); ctx.beginPath(); ctx.arc(x, Y(v), 5, 0, 7); ctx.fill(); ctx.fillStyle = css(s.col); ctx.beginPath(); ctx.arc(x, Y(v), 3.5, 0, 7); ctx.fill(); }
      const tip = $('cvTip'), mm = Math.floor(best.t / 60), sc = String(best.t % 60).padStart(2, '0');
      tip.innerHTML = `<b>${mm}:${sc}</b><br>` + C.series.map(s => `<i style="background:${css(s.col)}"></i>${t(s.label)} ${fmtTick(val(best, s) ?? NaN)} ${t(C.unit)}`).join('<br>');
      const box = cv.getBoundingClientRect(), host = cv.parentElement.getBoundingClientRect();
      tip.hidden = false; tip.style.left = Math.min(box.left - host.left + x + 12, host.width - 170) + 'px'; tip.style.top = (box.top - host.top + 8) + 'px';
    }
  }
  if (!hover) $('cvTip').hidden = true;
}
const niceStep = (r) => { const p = 10 ** Math.floor(Math.log10(Math.max(1, r))), m = r / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(Math.max(1e-9, v / 4))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p * 4 >= v) return m * p * 4; return 40 * p; };   // 눈금 4칸이 깔끔한 수가 되게
const fmtTick = (v) => (!Number.isFinite(v) ? '–' : v === 0 || v >= 10 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));

// 자율주행차 vs 일반차 (최근 5분 완료 통행)
function compare() {
  const s = sim.stats(), rows = [
    { k: t({ ko: '평균 통행시간 (초)', en: 'Average trip time (s)' }), a: s.avTime, h: s.huTime },
    { k: t({ ko: '평균 지연 (초)', en: 'Average delay (s)' }), a: s.avDelay, h: s.huDelay },
    { k: t({ ko: '평균 정지 횟수', en: 'Stops per trip' }), a: s.avStops, h: s.huStops }
  ];
  $('cvCompare').innerHTML = rows.map(r => {
    const mx = Math.max(r.a || 0, r.h || 0) || 1, bar = (v, cls, lab) => `<div class="cv-bar"><span>${lab}</span><i class="${cls}" style="width:${Number.isFinite(v) ? Math.max(2, 100 * v / mx) : 0}%"></i><b>${r.k.includes('정지') || r.k.includes('Stops') ? f1(v) : f0(v)}</b></div>`;
    return `<div class="cv-cmp"><p>${r.k}</p>${bar(r.a, 'av', t({ ko: '자율주행', en: 'Autonomous' }))}${bar(r.h, 'hu', t({ ko: '일반', en: 'Human' }))}</div>`;
  }).join('');
}
function gates() {
  const sides = ['N', 'E', 'S', 'W'], name = { N: t({ ko: '북쪽', en: 'North' }), E: t({ ko: '동쪽', en: 'East' }), S: t({ ko: '남쪽', en: 'South' }), W: t({ ko: '서쪽', en: 'West' }) };
  const sum = (s, k) => sim.gates.filter(g => g.side === s).reduce((a, g) => a + g[k], 0);
  $('cvGates').innerHTML = `<tr><th>${t({ ko: '출입구', en: 'Gates' })}</th><th>${t({ ko: '들어옴', en: 'In' })}</th><th>${t({ ko: '나감', en: 'Out' })}</th><th>${t({ ko: '밖에서 대기', en: 'Waiting' })}</th></tr>` +
    sides.map(s => `<tr><td>${name[s]} (${N})</td><td>${sum(s, 'inCount')}</td><td>${sum(s, 'outCount')}</td><td>${sum(s, 'queue')}</td></tr>`).join('') +
    `<tr><td><b>${t({ ko: '합계', en: 'Total' })}</b></td><td><b>${sim.spawned}</b></td><td><b>${sim.exited}</b></td><td><b>${sim.gates.reduce((a, g) => a + g.queue, 0)}</b></td></tr>`;
}

// ---- 조작 ------------------------------------------------------------------------------
function labels() {
  $('playBtn').textContent = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 시작', en: '▶ Start' });
  $('speedBtn').textContent = t({ ko: '배속', en: 'Speed' }) + ` ${SPEEDS[speedIdx]}×`;
  $('seedBtn').textContent = t({ ko: '🎲 다른 도시', en: '🎲 Another city' }) + ` #${seed}`;
  $('followBtn').textContent = follow ? t({ ko: '따라가기 멈춤', en: 'Stop following' }) : t({ ko: '🚘 자율주행차 따라가기', en: '🚘 Follow an autonomous car' });
  $('cvInOut').textContent = `${num('cvIn')} ${t({ ko: '대/시', en: 'cars/h' })}`;
  $('cvAvOut').textContent = `${num('cvAv')}%`;
  $('cvBiasOut').textContent = `${num('cvBias')}%`;
  $('cvGreenOut').textContent = `${num('cvGreen')}${t({ ko: '초', en: ' s' })}`;
  $('cvLeftOut').textContent = `${num('cvLeft')}${t({ ko: '초', en: ' s' })}`;
  $('cvTiming').hidden = $('cvMode').value === 'actuated';
  const cur = Object.entries(PRESETS).find(([, p]) => Object.entries(p.o).every(([k, v]) => (k === 'mode' ? $('cvMode').value === v : Math.abs(settings()[k] - v) < 1e-9)))?.[0] || '';
  $('cvPresets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}" aria-pressed="${k === cur}">${t(p.label)}</button>`).join('');
  $('cvLegend').innerHTML = `<span><i style="background:#1baf7a"></i>${t({ ko: '자율주행차', en: 'Autonomous car' })}</span><span><i style="background:#b9c0ca"></i>${t({ ko: '일반차', en: 'Human-driven car' })}</span>` +
    `<span><i class="dot" style="background:#2f9e44"></i><i class="dot" style="background:#e03131"></i>${t({ ko: '신호 (안쪽 = 좌회전, 바깥 = 직진·우회전)', en: 'Signals (inner = left, outer = through/right)' })}</span>`;
}
function startFollow() {
  const avs = [...sim.cars()].filter(c => c.av && !c.box && c.link.from < 0 && c.s < 40);
  const pool = avs.length ? avs : [...sim.cars()].filter(c => c.av);
  if (!pool.length) { $('cvNote').textContent = t({ ko: '지금 도시에 자율주행차가 없습니다. 자율주행 비율을 올려 보세요.', en: 'No autonomous cars right now. Raise the autonomous share.' }); return; }
  follow = pool[Math.floor(Math.random() * pool.length)];
  view.s = Math.max(view.s, 3.2); $('cvNote').textContent = '';
}
function frame(now) {
  const dtReal = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  if (running) {
    acc += dtReal * SPEEDS[speedIdx];
    const t0 = performance.now();
    while (acc >= sim.o.dt) { sim.step(); acc -= sim.o.dt; if (performance.now() - t0 > FRAME_BUDGET) { acc = 0; break; } }
    if (follow && ![...sim.cars()].includes(follow)) { $('cvNote').textContent = t({ ko: `자율주행차 #${follow.id}가 도시를 빠져나갔습니다.`, en: `Autonomous car #${follow.id} has left the city.` }); follow = null; labels(); }
    frame.n = (frame.n || 0) + 1;
    if (frame.n % 15 === 0) { stats(); charts(); compare(); gates(); }
  }
  draw();
  requestAnimationFrame(frame);
}
function main() {
  if (!$('cvView')) return;
  build();
  $('playBtn').addEventListener('click', () => { running = !running; labels(); });
  $('resetBtn').addEventListener('click', () => { build(); });
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; labels(); });
  $('seedBtn').addEventListener('click', () => { seed = seed % 99 + 1; build(); running = true; labels(); });
  $('followBtn').addEventListener('click', () => { if (follow) follow = null; else startFollow(); labels(); });
  for (const id of ['cvIn', 'cvAv', 'cvBias', 'cvGreen', 'cvLeft']) $(id).addEventListener('input', () => { sim.configure(settings()); labels(); });
  $('cvMode').addEventListener('change', () => { sim.configure(settings()); labels(); });
  for (const id of ['cvHeat', 'cvSig']) $(id).addEventListener('change', draw);
  $('cvPresets').addEventListener('click', e => {
    const b = e.target.closest('button[data-preset]'); if (!b) return;
    const o = { ...DEFAULTS, ...PRESETS[b.dataset.preset].o };
    $('cvIn').value = o.inflow; $('cvAv').value = Math.round(o.av * 100); $('cvBias').value = Math.round(o.bias * 100); $('cvMode').value = o.mode;
    $('cvGreen').value = o.green; $('cvLeft').value = o.left;
    build(); running = true; labels();
  });
  // 확대 · 이동 · 교차로 고르기
  const cv = $('cvView'); let drag = null;
  cv.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0015); view.s = Math.min(12, Math.max(0.3, view.s * k)); }, { passive: false });
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { follow = null; view.cx -= dx / view.s; view.cy -= dy / view.s; drag.x = e.clientX; drag.y = e.clientY; }
  });
  cv.addEventListener('pointerup', e => {
    if (drag && !drag.moved) {
      const r = cv.getBoundingClientRect(), x = view.cx + (e.clientX - r.left - r.width / 2) / view.s, y = view.cy + (e.clientY - r.top - r.height / 2) / view.s;
      let best = null, bd = 20; for (const n of sim.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n.id; } }
      picked = best; if (picked == null) $('cvNode').textContent = t({ ko: '교차로를 누르면 그 교차로의 신호와 대기 차량이 보입니다.', en: 'Click a junction to see its signal and queues.' }); else nodeInfo();
    }
    drag = null; labels();
  });
  cv.addEventListener('dblclick', () => { follow = null; view.fitted = false; labels(); });
  for (const C of CHARTS) {
    const el = $(C.id);
    el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); hover = { id: C.id, x: e.clientX - r.left }; charts(); });
    el.addEventListener('pointerleave', () => { hover = null; charts(); });
  }
  document.addEventListener('langchange', () => { labels(); stats(); charts(); compare(); gates(); });
  addEventListener('resize', () => { view.fitted = false; charts(); });
  $('themeBtn')?.addEventListener('click', () => setTimeout(charts, 0));
  requestAnimationFrame(frame);
}
main();
