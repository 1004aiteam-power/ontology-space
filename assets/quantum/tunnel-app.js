// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 양자 터널 효과 페이지: 파동 묶음 화면 · 확률 나눔 · 이론 곡선 두 개
import { Tunnel, transmission, packetTransmission, HBAR2_2M, FS_PER_T } from './tunnel.js?v=6e639ca8';
import { $, t, css, dark, fit } from '../lib/dom.js?v=3b73d59c';

const VIEW = { x0: -15, x1: 15, eMax: 12 };            // 보여 줄 범위: −15 ~ 15 nm, 0 ~ 12 eV
const SPEEDS = [[0.5, 10], [1, 20], [2, 40], [4, 80]]; // [배속, 한 프레임에 몇 단계] — 1× 에서 한 번 쏘는 데 약 4초
const PRESETS = {
  tunnel: { E: 5, V0: 6, a: 0.25, label: { ko: '벽보다 낮은 에너지 (터널)', en: 'Below the wall (tunnelling)' } },
  thick: { E: 5, V0: 6, a: 0.6, label: { ko: '두꺼운 벽', en: 'Thick wall' } },
  above: { E: 8, V0: 6, a: 0.3, label: { ko: '벽보다 높은 에너지 (일부 반사)', en: 'Above the wall (partly reflected)' } },
  resonance: { E: 8, V0: 6, a: Math.round(Math.PI / Math.sqrt(2 / HBAR2_2M) * 100) / 100, label: { ko: '공명 (거의 다 통과)', en: 'Resonance (almost all through)' } },
  none: { E: 5, V0: 0, a: 0.25, label: { ko: '벽 없음', en: 'No wall' } }
};
const COL = { packet: '#2a78d6', packetDark: '#5b9cf0', wall: '#d95926', re: '#8a63d2', ball: '#8a8f98' };

let sim, running = false, speedIdx = 1, done = false, ball;
const num = (id) => +$(id).value;
const pct = (v) => (v >= 0.9995 ? '100' : v < 1e-4 && v > 0 ? '< 0.01' : (v * 100).toFixed(v < 0.1 ? 2 : 1));

// 고전 입자: 같은 에너지 · 같은 출발점의 공. 벽보다 에너지가 낮으면 벽 앞에서 튕겨 나온다
function moveBall(dt) {
  const { E, V0, a } = sim.opts, v = 2 * Math.sqrt(HBAR2_2M * E);
  if (ball.x < -a / 2 || ball.x > a / 2) ball.x += ball.dir * v * dt;
  else ball.x += ball.dir * 2 * Math.sqrt(HBAR2_2M * Math.max(1e-6, E - V0)) * dt;     // 벽 위에서는 느려짐
  if (E < V0 && ball.dir > 0 && ball.x >= -a / 2) { ball.x = -a / 2 - (ball.x + a / 2); ball.dir = -1; ball.bounced = true; }
}

function build(keepRunning = running) {
  const o = { E: num('tnE'), V0: num('tnV'), a: num('tnA'), sigma: num('tnS') };
  if (!sim) sim = new Tunnel(o); else sim.set(o);
  ball = { x: sim.opts.x0, dir: 1, bounced: false };
  done = false; running = keepRunning;
  labels(); charts(); draw(); stats();
}

// 통과한 쪽 확대 배율: 통과한 언덕이 처음 언덕의 1/3쯤 높이로 보이게 (1 · 2 · 5 · 10 · 20 · 50 · 100 가운데)
function zoomFactor() {
  if (!$('tnZoom').checked) return 1;
  const want = 0.35 / Math.max(1e-6, sim.theory().packet);
  return [100, 50, 20, 10, 5, 2, 1].find(z => z <= want) || 1;
}

// ---- 파동 화면 -----------------------------------------------------------------------
function draw() {
  const { ctx, cw, ch } = fit($('tnView'), 0.42), padL = 40, padB = 26, padT = 10, padR = 10;
  const X = (x) => padL + (cw - padL - padR) * (x - VIEW.x0) / (VIEW.x1 - VIEW.x0), Y = (e) => ch - padB - (ch - padB - padT) * e / VIEW.eMax;
  ctx.clearRect(0, 0, cw, ch);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let e = 0; e <= VIEW.eMax; e += 2) { ctx.beginPath(); ctx.moveTo(padL, Y(e)); ctx.lineTo(cw - padR, Y(e)); ctx.stroke(); ctx.fillText(e + ' eV', padL - 4, Y(e)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = -15; x <= 15; x += 5) ctx.fillText(x + ' nm', X(x), ch - padB + 6);
  const { E, V0, a } = sim.opts;
  // 벽
  ctx.fillStyle = dark() ? 'rgba(217,89,38,.45)' : 'rgba(217,89,38,.3)'; ctx.strokeStyle = COL.wall; ctx.lineWidth = 1.5;
  const wx = X(-a / 2), ww = Math.max(2, X(a / 2) - X(-a / 2));
  if (V0 > 0) { ctx.fillRect(wx, Y(V0), ww, Y(0) - Y(V0)); ctx.strokeRect(wx, Y(V0), ww, Y(0) - Y(V0)); }
  // 전자의 에너지 (점선) — 확률 밀도는 이 선을 바닥으로 그린다 (교과서의 흔한 그림)
  ctx.setLineDash([5, 4]); ctx.strokeStyle = css('--muted'); ctx.beginPath(); ctx.moveTo(padL, Y(E)); ctx.lineTo(cw - padR, Y(E)); ctx.stroke(); ctx.setLineDash([]);
  // |ψ|²: 통과한 쪽은 투과 확률에 맞춰 확대 (작게 통과할수록 크게)
  const zoom = zoomFactor(), scale = 3.2 / (1 / (Math.sqrt(2 * Math.PI) * sim.opts.sigma));   // 처음 봉우리 높이 = 3.2 eV
  const { re, im, x } = sim, N = sim.opts.N;
  ctx.beginPath(); ctx.moveTo(X(VIEW.x0), Y(E));
  for (let i = 0; i < N; i++) {
    if (x[i] < VIEW.x0 || x[i] > VIEW.x1) continue;
    const p = re[i] * re[i] + im[i] * im[i], z = x[i] > a / 2 ? zoom : 1;
    ctx.lineTo(X(x[i]), Y(E + Math.min(VIEW.eMax - E, p * scale * z)));
  }
  ctx.lineTo(X(VIEW.x1), Y(E)); ctx.closePath();
  ctx.fillStyle = dark() ? 'rgba(91,156,240,.45)' : 'rgba(42,120,214,.35)'; ctx.fill();
  ctx.strokeStyle = dark() ? COL.packetDark : COL.packet; ctx.lineWidth = 1.6; ctx.stroke();
  // 실수부 Re ψ: 파동이라는 것이 보인다
  if ($('tnRe').checked) {
    const rs = Math.sqrt(scale) * 0.9;
    ctx.strokeStyle = COL.re; ctx.lineWidth = 1; ctx.globalAlpha = 0.85; ctx.beginPath(); let first = true;
    for (let i = 0; i < N; i++) {
      if (x[i] < VIEW.x0 || x[i] > VIEW.x1) continue;
      const z = x[i] > a / 2 ? Math.sqrt(zoom) : 1, y = Y(E + re[i] * rs * z);
      if (first) { ctx.moveTo(X(x[i]), y); first = false; } else ctx.lineTo(X(x[i]), y);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (zoom > 1) { ctx.fillStyle = css('--muted'); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(t({ ko: `벽 오른쪽 ×${zoom} 확대`, en: `right of the wall ×${zoom}` }), X(a / 2) + 8, padT + 4); }
  // 고전 입자
  if ($('tnBall').checked && ball.x > VIEW.x0 && ball.x < VIEW.x1) {
    ctx.fillStyle = COL.ball; ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(ball.x), Y(E), 6, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(t({ ko: '고전 입자', en: 'classical' }), X(ball.x), Y(E) - 9);
  }
  ctx.fillStyle = css('--muted'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(t({ ko: '벽 ', en: 'wall ' }) + V0 + ' eV × ' + a + ' nm', X(a / 2) + 8, Y(V0) + 2);
}

// ---- 숫자 -----------------------------------------------------------------------------
function stats() {
  const r = sim.regions(), th = sim.theory(), fs = sim.t * FS_PER_T;
  const items = [
    [t({ ko: '지난 시간', en: 'Time' }), fs.toFixed(1) + ' fs', done ? t({ ko: '끝: 묶음이 다 나뉨', en: 'done: the packet has split' }) : t({ ko: '1 fs = 1000조분의 1초', en: '1 fs = 10⁻¹⁵ s' })],
    [t({ ko: '튕겨 나옴 (반사)', en: 'Reflected' }), pct(r.left) + '%', t({ ko: '벽 왼쪽', en: 'left of the wall' })],
    [t({ ko: '벽 안', en: 'Inside the wall' }), pct(r.inside) + '%', t({ ko: '지나가는 중', en: 'passing through' })],
    [t({ ko: '뚫고 지나감 (투과)', en: 'Transmitted' }), pct(r.right) + '%', t({ ko: '벽 오른쪽', en: 'right of the wall' })],
    [t({ ko: '이론값 (파동 묶음)', en: 'Theory (packet)' }), pct(th.packet) + '%', t({ ko: `평면파 공식 ${pct(th.plane)}%`, en: `plane-wave formula ${pct(th.plane)}%` })],
    [t({ ko: '고전 입자라면', en: 'A classical particle' }), (th.classical ? '100' : '0') + '%', th.classical ? t({ ko: '벽을 넘어감', en: 'goes over' }) : t({ ko: '모두 튕겨 나옴', en: 'always bounces back' })]
  ];
  $('tnStats').innerHTML = items.map(([a, b, c], i) => `<div${i === 3 ? ' class="hi"' : ''}><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('');
}

// ---- 이론 곡선: 두께에 따라 (로그 눈금), 에너지에 따라 ---------------------------------------------
function curve(canvas, xs, f, cur, { xLabel, log, vline, xTicks }) {
  const { ctx, cw, ch } = fit(canvas), padL = 56, padR = 10, padT = 10, padB = 30;
  ctx.clearRect(0, 0, cw, ch);
  const lo = log ? -6 : 0, hi = log ? 0 : 1, yv = (v) => (log ? Math.log10(Math.max(1e-6, v)) : v);
  const x0 = xTicks[0], x1 = xTicks[xTicks.length - 1], X = (x) => padL + (cw - padL - padR) * (x - x0) / (x1 - x0), Y = (v) => padT + (ch - padT - padB) * (1 - (yv(v) - lo) / (hi - lo));
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const tick = { 1: '100%', 0.01: '1%', 0.0001: '0.01%', 0.000001: '0.0001%', 0: '0%', 0.5: '50%' };
  for (const v of log ? [1, 1e-2, 1e-4, 1e-6] : [0, 0.5, 1]) { ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(cw - padR, Y(v)); ctx.stroke(); ctx.fillText(tick[v], padL - 4, Y(v)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const x of xTicks) ctx.fillText(String(x), X(x), ch - padB + 4);
  ctx.fillText(xLabel, (padL + cw - padR) / 2, ch - 13);
  if (vline != null) { ctx.setLineDash([4, 4]); ctx.strokeStyle = COL.wall; ctx.beginPath(); ctx.moveTo(X(vline), padT); ctx.lineTo(X(vline), ch - padB); ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle = dark() ? COL.packetDark : COL.packet; ctx.lineWidth = 2; ctx.beginPath();
  xs.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(f(x))) : ctx.moveTo(X(x), Y(f(x))))); ctx.stroke();
  ctx.fillStyle = COL.wall; ctx.beginPath(); ctx.arc(X(cur), Y(f(cur)), 5, 0, 7); ctx.fill();
}
function charts() {
  const { E, V0, a, sigma } = sim.opts, span = (a0, a1, n) => Array.from({ length: n }, (_, i) => a0 + (a1 - a0) * i / (n - 1));
  curve($('tnWidth'), span(0, 1.2, 80), (w) => packetTransmission(E, V0, w, sigma), Math.min(1.2, a), { xLabel: t({ ko: '벽 두께 (nm)', en: 'wall thickness (nm)' }), log: true, xTicks: [0, 0.3, 0.6, 0.9, 1.2] });
  curve($('tnEnergy'), span(0.05, 12, 160), (e) => transmission(e, V0, a), E, { xLabel: t({ ko: '전자 에너지 (eV) · 점선 = 벽 높이', en: 'electron energy (eV) · dashed = wall height' }), log: false, vline: V0 > 0 ? V0 : null, xTicks: [0, 3, 6, 9, 12] });
}

function labels() {
  $('playBtn').textContent = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : done ? t({ ko: '▶ 다시 쏘기', en: '▶ Fire again' }) : t({ ko: '▶ 전자 쏘기', en: '▶ Fire the electron' });
  $('speedBtn').textContent = t({ ko: '배속', en: 'Speed' }) + ` ${SPEEDS[speedIdx][0]}×`;
  for (const [id, unit, d] of [['tnE', ' eV', 1], ['tnV', ' eV', 1], ['tnA', ' nm', 2], ['tnS', ' nm', 1]]) $(id + 'Out').textContent = (+$(id).value).toFixed(d) + unit;
  const lam = 2 * Math.PI / Math.sqrt(num('tnE') / HBAR2_2M);
  $('tnLambda').textContent = t({ ko: `전자의 파장 ≈ ${lam.toFixed(2)} nm`, en: `electron wavelength ≈ ${lam.toFixed(2)} nm` });
  const cur = Object.entries(PRESETS).find(([, p]) => Math.abs(p.E - num('tnE')) < 1e-9 && Math.abs(p.V0 - num('tnV')) < 1e-9 && Math.abs(p.a - num('tnA')) < 1e-9)?.[0] || '';
  $('tnPresets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}" aria-pressed="${k === cur}">${t(p.label)}</button>`).join('');
}

// 끝났나: 벽 근처(±4 nm)에 남은 확률이 거의 없으면 반사 · 투과가 다 나뉜 것 (두 묶음이 아직 화면 안에 있을 때 멈춤)
function settled() {
  if (sim.t < 2) return false;
  let near = 0;
  for (let i = 0; i < sim.opts.N; i++) if (Math.abs(sim.x[i]) < 4) near += (sim.re[i] ** 2 + sim.im[i] ** 2) * sim.dx;
  return near < 2e-4 || sim.t >= sim.stepsToSettle() * sim.opts.dt;
}

function frame() {
  if (running) {
    const n = SPEEDS[speedIdx][1];
    sim.step(n); moveBall(n * sim.opts.dt);
    if (settled()) { running = false; done = true; labels(); }
    stats();
  }
  draw();
  requestAnimationFrame(frame);
}

function main() {
  if (!$('tnView')) return;
  build(false);
  $('playBtn').addEventListener('click', () => { if (done) build(true); else { running = !running; labels(); } });
  $('resetBtn').addEventListener('click', () => build(false));
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; labels(); });
  for (const id of ['tnE', 'tnV', 'tnA', 'tnS']) $(id).addEventListener('input', () => build(false));      // 설정을 바꾸면 처음 자리에서 다시
  $('tnPresets').addEventListener('click', e => {
    const b = e.target.closest('button[data-preset]'); if (!b) return;
    const p = PRESETS[b.dataset.preset];
    $('tnE').value = p.E; $('tnV').value = p.V0; $('tnA').value = p.a;
    build(true);
  });
  for (const id of ['tnZoom', 'tnRe', 'tnBall']) $(id).addEventListener('change', draw);
  document.addEventListener('langchange', () => { labels(); stats(); charts(); });
  addEventListener('resize', charts);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', charts);
  $('themeBtn')?.addEventListener('click', () => setTimeout(charts, 0));                                  // 테마를 바꾸면 곡선 색도 다시
  requestAnimationFrame(frame);
}
main();
