// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 교차로 신호 페이지: 위에서 내려다본 교차로, 신호 현시, 대기열·지체 그래프
import { Intersection, PHASES, GEO, ARMS, AXIS, pointAt } from './traffic.js?v=3897f5af';

const $ = (id) => document.getElementById(id);
const t = (o) => (window.t ? window.t(o) : o.ko);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// 출발 방향별 차량 색 (dataviz 검증: 밝은·어두운 배경 모두 통과)
const ARM_COL = () => ({ N: dark() ? '#3987e5' : '#2a78d6', E: '#d95926', S: '#199e70', W: '#9085e9' });
const ARM_NAME = { N: { ko: '북쪽', en: 'North' }, E: { ko: '동쪽', en: 'East' }, S: { ko: '남쪽', en: 'South' }, W: { ko: '서쪽', en: 'West' } };
const SIG = { G: '#22c55e', Y: '#f5b301', R: '#ef4444' };

const SCENARIOS = {
  normal: { label: { ko: '평상시', en: 'Normal' }, demand: { NS: 450, EW: 350 }, left: 0.2, ped: 120 },
  rush: { label: { ko: '출근 시간 (남북 몰림)', en: 'Rush hour (N–S heavy)' }, demand: { NS: 750, EW: 300 }, left: 0.15, ped: 200 },
  night: { label: { ko: '한산한 밤', en: 'Quiet night' }, demand: { NS: 120, EW: 80 }, left: 0.2, ped: 20 }
};
const SPEEDS = [1, 2, 4, 8, 'max'];         // 실제 시간 대비 배속

let sim, running = false, speedIdx = 1, acc = 0, lastT = 0;
const VIEW = 48;                            // 화면 가운데에서 ±48m

// ---- 캔버스 공통 -------------------------------------------------------------------
function fit(canvas, aspect) {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth;
  const ch = aspect ? cw * aspect : canvas.clientHeight;
  if (aspect) canvas.style.height = ch + 'px';
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cw, ch };
}

// ---- 교차로 그리기 (위에서 내려다본 모습) ------------------------------------------------
function drawRoad(ctx) {
  const H = GEO.half, L = VIEW + 2, W = GEO.laneW;
  ctx.fillStyle = dark() ? '#1b2a22' : '#cfe3c8'; ctx.fillRect(-L, -L, 2 * L, 2 * L);             // 잔디
  ctx.fillStyle = dark() ? '#3b3f44' : '#d9d6cf';                                                      // 인도
  ctx.fillRect(-H - 4, -L, 2 * H + 8, 2 * L); ctx.fillRect(-L, -H - 4, 2 * L, 2 * H + 8);
  ctx.fillStyle = dark() ? '#2a2d31' : '#4a4e54';                                                      // 아스팔트
  ctx.fillRect(-H, -L, 2 * H, 2 * L); ctx.fillRect(-L, -H, 2 * L, 2 * H);
  // 차선: 가운데 노란 겹선, 차로 경계 흰 점선 (교차로 안과 횡단보도 구간은 비움)
  for (const a of ARMS) {
    const u = a === 'N' ? [0, -1] : a === 'S' ? [0, 1] : a === 'E' ? [1, 0] : [-1, 0], side = [-u[1], u[0]];
    const seg = (off, from, to, color, dash, w) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(u[0] * from + side[0] * off, u[1] * from + side[1] * off); ctx.lineTo(u[0] * to + side[0] * off, u[1] * to + side[1] * off); ctx.stroke();
    };
    seg(-0.12, GEO.stop, L, '#f5c518', [], 0.15); seg(0.12, GEO.stop, L, '#f5c518', [], 0.15);
    for (const off of [-W, W]) seg(off, GEO.stop, L, 'rgba(255,255,255,.75)', [3, 3], 0.15);
    ctx.setLineDash([]);
    // 정지선 (들어오는 쪽 절반)
    const inSide = [u[1], -u[0]];   // 들어오는 차로는 갈래 바깥 방향 기준 오른쪽의 반대편
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.45;
    ctx.beginPath(); ctx.moveTo(u[0] * GEO.stop, u[1] * GEO.stop); ctx.lineTo(u[0] * GEO.stop + inSide[0] * H, u[1] * GEO.stop + inSide[1] * H); ctx.stroke();
    // 횡단보도 줄무늬
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let k = -H + 0.4; k < H; k += 1.1) {
      const cx = u[0] * (GEO.cwNear + GEO.cwFar) / 2 + side[0] * k, cy = u[1] * (GEO.cwNear + GEO.cwFar) / 2 + side[1] * k;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(u[1], u[0]));
      ctx.fillRect(-(GEO.cwFar - GEO.cwNear) / 2, -0.28, GEO.cwFar - GEO.cwNear, 0.56); ctx.restore();
    }
    // 노면 화살표: 안쪽 차로 ←(좌회전), 바깥 차로 ↑↱(직진·우회전)
    drawArrow(ctx, a, 0, 'L'); drawArrow(ctx, a, 1, 'TR');
  }
}
function drawArrow(ctx, arm, lane, kind) {
  const u = arm === 'N' ? [0, -1] : arm === 'S' ? [0, 1] : arm === 'E' ? [1, 0] : [-1, 0];
  const d = [-u[0], -u[1]], r = [-d[1], d[0]], off = GEO.laneW * (lane + 0.5);
  const p = [u[0] * 20 + r[0] * off, u[1] * 20 + r[1] * off];
  ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.atan2(d[1], d[0]));
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 0.3;
  const head = (x, y, ang) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0.8, 0); ctx.lineTo(-0.3, -0.6); ctx.lineTo(-0.3, 0.6); ctx.fill(); ctx.restore(); };
  ctx.beginPath(); ctx.moveTo(-2.2, 0); ctx.lineTo(0.6, 0);
  if (kind === 'L') { ctx.quadraticCurveTo(1.6, 0, 1.6, -1.1); ctx.stroke(); head(1.6, -1.3, -Math.PI / 2); }
  else { ctx.lineTo(1.6, 0); ctx.stroke(); head(1.8, 0, 0); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0.6, 0, 0.6, 1); ctx.stroke(); head(0.6, 1.2, Math.PI / 2); }
  ctx.restore();
}
// 신호등: 정지선 오른쪽 길가에 차로별 두 개 (직진 원 · 좌회전 화살표)
function drawSignals(ctx) {
  for (const a of ARMS) {
    const u = a === 'N' ? [0, -1] : a === 'S' ? [0, 1] : a === 'E' ? [1, 0] : [-1, 0];
    const d = [-u[0], -u[1]], r = [-d[1], d[0]];
    const base = [u[0] * (GEO.stop + 1.5) + r[0] * (GEO.half + 2.2), u[1] * (GEO.stop + 1.5) + r[1] * (GEO.half + 2.2)];
    ctx.save(); ctx.translate(base[0], base[1]); ctx.rotate(Math.atan2(d[1], d[0]) + Math.PI / 2);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.roundRect(-2.4, -0.9, 4.8, 1.8, 0.4); ctx.fill();
    const sT = sim.laneSignal(a, 1), sL = sim.laneSignal(a, 0);
    ctx.fillStyle = SIG[sT]; ctx.beginPath(); ctx.arc(1.1, 0, 0.62, 0, 7); ctx.fill();
    ctx.fillStyle = SIG[sL];                                    // 좌회전 화살표
    ctx.beginPath(); ctx.moveTo(-1.8, 0); ctx.lineTo(-1.1, -0.6); ctx.lineTo(-1.1, -0.22); ctx.lineTo(-0.4, -0.22); ctx.lineTo(-0.4, 0.22); ctx.lineTo(-1.1, 0.22); ctx.lineTo(-1.1, 0.6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // 보행 신호: 횡단보도 양 끝
  const blink = Math.floor(performance.now() / 400) % 2;
  for (const a of ARMS) {
    const cw = sim.cws[a], ps = sim.pedSignal(a);
    const col = ps === 'W' ? SIG.G : ps === 'F' ? (blink ? SIG.G : 'rgba(34,197,94,.25)') : SIG.R;
    for (const p of [cw.a, cw.b]) {
      const n = Math.hypot(p[0], p[1]), q = [p[0] + p[0] / n * 1.6, p[1] + p[1] / n * 1.6];
      ctx.fillStyle = '#111'; ctx.fillRect(q[0] - 0.7, q[1] - 0.7, 1.4, 1.4);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q[0], q[1], 0.45, 0, 7); ctx.fill();
    }
  }
}
function drawCars(ctx) {
  const C = sim.cfg.car, col = ARM_COL(), blink = Math.floor(performance.now() / 350) % 2;
  for (const c of sim.cars) {
    const p = pointAt(c.path, c.s);
    if (Math.abs(p.x) > VIEW + 5 || Math.abs(p.y) > VIEW + 5) continue;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
    ctx.fillStyle = col[c.path.from]; ctx.beginPath(); ctx.roundRect(-C.len / 2, -C.wid / 2, C.len, C.wid, 0.5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0.5, -C.wid / 2 + 0.2, 0.9, C.wid - 0.4);                 // 앞유리
    if (c.acc < -0.6 || c.v < 0.3) { ctx.fillStyle = '#ff2b2b'; ctx.fillRect(-C.len / 2, -C.wid / 2 + 0.1, 0.35, 0.45); ctx.fillRect(-C.len / 2, C.wid / 2 - 0.55, 0.35, 0.45); }   // 브레이크등
    if (c.path.move !== 'T' && blink && c.s < c.path.boxOut) {                                                // 방향지시등
      ctx.fillStyle = '#ffb000'; const y = c.path.move === 'L' ? -C.wid / 2 : C.wid / 2 - 0.4;
      ctx.fillRect(C.len / 2 - 0.5, y, 0.5, 0.4); ctx.fillRect(-C.len / 2, y, 0.5, 0.4);
    }
    ctx.restore();
  }
}
function drawPeds(ctx) {
  for (const p of sim.peds) {
    let q;
    if (p.state === 'wait') {                                   // 출발 모서리에서 대기
      const cw = sim.cws[p.cw], e = p.dir > 0 ? cw.a : cw.b, n = Math.hypot(e[0], e[1]);
      q = { x: e[0] + e[0] / n * 0.9 + p.lat * 0.4, y: e[1] + e[1] / n * 0.9 - p.lat * 0.4 };
    } else q = sim.pedPos(p);
    ctx.fillStyle = dark() ? '#f3f4f6' : '#1f2937'; ctx.beginPath(); ctx.arc(q.x, q.y, 0.45, 0, 7); ctx.fill();
    ctx.strokeStyle = p.state === 'wait' ? '#ef4444' : '#22c55e'; ctx.lineWidth = 0.18; ctx.stroke();
  }
}
function drawScene() {
  const { ctx, cw } = fit($('view'), 1);
  const k = cw / (2 * VIEW);
  ctx.save(); ctx.translate(cw / 2, cw / 2); ctx.scale(k, k);
  drawRoad(ctx); drawPeds(ctx); drawCars(ctx); drawSignals(ctx);
  ctx.restore();
  // 왼쪽 위: 시계와 현재 현시
  const P = PHASES[sim.phase], stage = { green: t({ ko: '녹색', en: 'green' }), yellow: t({ ko: '황색', en: 'yellow' }), allred: t({ ko: '전적색', en: 'all red' }) }[sim.stage];
  const left = sim.stage === 'green' ? Math.ceil(Math.max(0, (sim.greenTarget ?? 0) - sim.stageT)) : '';
  const text = `${clock(sim.t)} · ${t(P.label)} ${stage}${left !== '' ? ` ${left}${t({ ko: '초', en: 's' })}` : ''}`;
  ctx.font = `600 ${cw < 480 ? 11 : 13}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = dark() ? 'rgba(18,20,23,.85)' : 'rgba(255,255,255,.92)';
  ctx.beginPath(); ctx.roundRect(8, 8, w, 26, 13); ctx.fill();
  ctx.fillStyle = css('--text'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, 18, 21);
}
const clock = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

// ---- 현시 표시 -------------------------------------------------------------------
function drawPhases() {
  $('phaseBar').innerHTML = PHASES.map((P, i) => {
    const on = i === sim.phase, pct = on && sim.stage === 'green' ? Math.min(100, 100 * sim.stageT / Math.max(1, sim.greenTarget ?? 1)) : on ? 100 : 0;
    const st = on ? sim.stage : '';
    return `<div class="ph ${on ? 'on ' + st : ''}"><b>${i + 1}</b><span>${t(P.label)}</span>${P.move === 'T' ? `<small>${t({ ko: '+ 우회전 · 보행', en: '+ right · walk' })}</small>` : `<small>${t({ ko: '좌회전 전용', en: 'protected left' })}</small>`}<i style="width:${pct}%"></i></div>`;
  }).join('');
}

// ---- 지표 -------------------------------------------------------------------------
function stats() {
  const s = sim.stats(300), q = ARMS.reduce((a, k) => a + sim.queue(k), 0);
  const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '–');
  const fu = (v, u) => (Number.isFinite(v) ? v.toFixed(0) + t(u) : '–');
  const cells = [
    [t({ ko: '차량 평균 지체', en: 'Avg vehicle delay' }), fu(s.delay, { ko: '초', en: ' s' }), t({ ko: '최근 5분', en: 'last 5 min' })],
    [t({ ko: '평균 정지 횟수', en: 'Avg stops' }), f(s.stops, 2), t({ ko: '대당', en: 'per vehicle' })],
    [t({ ko: '통과 교통량', en: 'Throughput' }), `${f(s.flow)}${t({ ko: '대/시', en: ' veh/h' })}`, t({ ko: `수요 ${ARMS.reduce((a, k) => a + sim.cfg.demand[k], 0)}대/시`, en: `demand ${ARMS.reduce((a, k) => a + sim.cfg.demand[k], 0)} veh/h` })],
    [t({ ko: '보행자 평균 대기', en: 'Avg pedestrian wait' }), fu(s.pedWait, { ko: '초', en: ' s' }), t({ ko: `건너는 중 ${sim.peds.filter(p => p.state === 'walk').length}명`, en: `${sim.peds.filter(p => p.state === 'walk').length} crossing` })],
    [t({ ko: '대기열 합계', en: 'Total queue' }), `${q}${t({ ko: '대', en: '' })}`, ARMS.map(a => `${t(ARM_NAME[a])[0]}${sim.queue(a)}`).join(' · ')],
    [t({ ko: '신호 방식', en: 'Control' }), sim.cfg.mode === 'fixed' ? t({ ko: '고정 주기', en: 'Fixed-time' }) : t({ ko: '감응식', en: 'Actuated' }),
      sim.cfg.mode === 'fixed' ? t({ ko: `주기 ${cycle()}초`, en: `cycle ${cycle()} s` }) : t({ ko: '녹색 10~50초', en: 'green 10–50 s' })]
  ];
  $('trStats').innerHTML = cells.map(([k, v, sub]) => `<div><span>${k}</span><b>${v}</b><small>${sub}</small></div>`).join('');
}
const cycle = () => 2 * (sim.cfg.fixed.through + sim.cfg.fixed.left) + 4 * (sim.cfg.yellow + sim.cfg.allRed);

// ---- 그래프 (최근 30분) --------------------------------------------------------------
function niceStep(max) { const r = max / 4, p = 10 ** Math.floor(Math.log10(r)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= r); }
const hover = {};
function lineChart(id, rows, series, unit) {
  const canvas = $(id), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  const pad = { l: 40, r: 96, t: 10, b: 24 }, W = cw - pad.l - pad.r, H = ch - pad.t - pad.b;
  const vals = rows.flatMap(r => series.map(s => r[s.key])).filter(Number.isFinite);
  const ymax = Math.max(5, ...vals) * 1.1, t0 = rows[0]?.t ?? 0, t1 = Math.max(t0 + 60, rows.at(-1)?.t ?? 60);
  const X = v => pad.l + W * (v - t0) / (t1 - t0), Y = v => pad.t + H * (1 - v / ymax);
  ctx.font = '11px system-ui, sans-serif'; ctx.strokeStyle = css('--line'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
  for (let v = 0, st = niceStep(ymax); v <= ymax; v += st) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + W, Y(v)); ctx.stroke(); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(Math.round(v), pad.l - 6, Y(v)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let v = Math.ceil(t0 / 300) * 300; v <= t1; v += 300) ctx.fillText(clock(v).slice(0, 5), X(v), pad.t + H + 6);
  if (rows.length < 2) return;
  const ends = [];
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    let on = false;
    for (const r of rows) { const v = r[s.key]; if (!Number.isFinite(v)) { on = false; continue; } on ? ctx.lineTo(X(r.t), Y(v)) : ctx.moveTo(X(r.t), Y(v)); on = true; }
    ctx.stroke();
    const last = [...rows].reverse().find(r => Number.isFinite(r[s.key]));
    if (last) ends.push({ s, x: X(last.t), y: Y(last[s.key]), v: last[s.key] });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if ((ends[i].ly ?? ends[i].y) - (ends[i - 1].ly ?? ends[i - 1].y) < 13) ends[i].ly = (ends[i - 1].ly ?? ends[i - 1].y) + 13;
  for (const e of ends) {
    ctx.fillStyle = e.s.color; ctx.beginPath(); ctx.arc(e.x, e.y, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`${t(e.s.label)} ${Math.round(e.v)}`, e.x + 7, e.ly ?? e.y);
  }
  const tip = $(id + 'Tip'), hx = hover[id];
  if (hx == null || hx < pad.l || hx > pad.l + W) { tip.hidden = true; return; }
  const tt = t0 + (hx - pad.l) / W * (t1 - t0);
  let r = rows[0]; for (const q of rows) if (Math.abs(q.t - tt) < Math.abs(r.t - tt)) r = q;
  const x = X(r.t);
  ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke(); ctx.setLineDash([]);
  for (const s of series) if (Number.isFinite(r[s.key])) { ctx.fillStyle = s.color; ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, Y(r[s.key]), 5, 0, 7); ctx.fill(); ctx.stroke(); }
  tip.hidden = false;
  tip.innerHTML = `<b>${clock(r.t)}</b>` + series.map(s => `<br><i style="background:${s.color}"></i>${t(s.label)} ${Number.isFinite(r[s.key]) ? Math.round(r[s.key]) + t(unit) : '–'}`).join('');
  tip.style.left = canvas.offsetLeft + Math.min(cw - 160, x + 10) + 'px'; tip.style.top = canvas.offsetTop + pad.t + 'px';
}
function drawCharts() {
  const rows = sim.history.slice(-360), col = ARM_COL();      // 5초 간격 × 360 = 30분
  lineChart('queueChart', rows, ARMS.map(a => ({ key: a, color: col[a], label: ARM_NAME[a] })), { ko: '대', en: '' });
  lineChart('delayChart', rows, [{ key: 'delay', color: col.N, label: { ko: '차량', en: 'Cars' } }, { key: 'pedWait', color: col.E, label: { ko: '보행자', en: 'People' } }], { ko: '초', en: ' s' });
}

// ---- 루프 ------------------------------------------------------------------------
let lastSlow = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  if (running) {
    const sp = SPEEDS[speedIdx];
    if (sp === 'max') { const t0 = performance.now(); while (performance.now() - t0 < 14) sim.step(); }
    else { acc += dt * sp; while (acc >= sim.cfg.dt) { sim.step(); acc -= sim.cfg.dt; } }
  }
  drawScene();
  if (now - lastSlow > 200) { drawPhases(); stats(); drawCharts(); lastSlow = now; }
  requestAnimationFrame(frame);
}

// ---- 조작부 ----------------------------------------------------------------------
function readOpts() {
  const ns = +$('demNS').value, ew = +$('demEW').value, L = +$('left').value;
  return {
    mode: $('mode').value, demand: { N: ns, S: ns, E: ew, W: ew }, turn: { L, R: 0.15 }, ped: +$('ped').value,
    fixed: { through: +$('gT').value, left: +$('gL').value }
  };
}
function restart() { sim = new Intersection({ ...readOpts(), seed: (Math.random() * 1e9) | 0 }); acc = 0; label(); drawCharts(); }
function applyLive() {                                         // 실행 중에도 바로 반영
  const o = readOpts();
  Object.assign(sim.cfg, { mode: o.mode, demand: o.demand, turn: o.turn, ped: o.ped, fixed: o.fixed });
  label();
}
function label() {
  $('playBtn').innerHTML = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 시작', en: '▶ Start' });
  const sp = SPEEDS[speedIdx];
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Speed ' }) + (sp === 'max' ? t({ ko: '최대', en: 'max' }) : sp + '×');
  const sel = $('scenario'), v = sel.value || 'normal';
  sel.innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${t(s.label)}</option>`).join('');
  sel.value = v;
  const m = $('mode'), mv = m.value || 'fixed';
  m.innerHTML = `<option value="fixed">${t({ ko: '고정 주기 신호', en: 'Fixed-time signals' })}</option><option value="actuated">${t({ ko: '감응식 신호', en: 'Actuated signals' })}</option>`;
  m.value = mv;
  for (const [id, f] of [['demNS', v => v + t({ ko: '대/시', en: ' veh/h' })], ['demEW', v => v + t({ ko: '대/시', en: ' veh/h' })], ['left', v => Math.round(v * 100) + '%'],
    ['ped', v => v + t({ ko: '명/시', en: '/h' })], ['gT', v => v + t({ ko: '초', en: ' s' })], ['gL', v => v + t({ ko: '초', en: ' s' })]]) $(id + 'Out').textContent = f(+$(id).value);
  document.querySelectorAll('.fixed-only').forEach(el => el.classList.toggle('dim', $('mode').value !== 'fixed'));
}
function setScenario() {
  const s = SCENARIOS[$('scenario').value];
  $('demNS').value = s.demand.NS; $('demEW').value = s.demand.EW; $('left').value = s.left; $('ped').value = s.ped;
  applyLive();
}
function bind() {
  $('playBtn').addEventListener('click', () => { running = !running; label(); });
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; label(); });
  $('resetBtn').addEventListener('click', restart);
  $('scenario').addEventListener('change', setScenario);
  $('mode').addEventListener('change', applyLive);
  for (const id of ['demNS', 'demEW', 'left', 'ped', 'gT', 'gL']) $(id).addEventListener('input', applyLive);
  for (const id of ['queueChart', 'delayChart']) {
    $(id).addEventListener('mousemove', e => { hover[id] = e.clientX - $(id).getBoundingClientRect().left; drawCharts(); });
    $(id).addEventListener('mouseleave', () => { hover[id] = null; drawCharts(); });
  }
  document.addEventListener('langchange', () => { label(); drawPhases(); stats(); drawCharts(); });
  window.addEventListener('resize', drawCharts);
}
function main() { label(); bind(); restart(); requestAnimationFrame(frame); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
