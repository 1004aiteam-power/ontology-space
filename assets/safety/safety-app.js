// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전 공사현장 안전 시뮬레이션 화면: 2D 캔버스 원근(pseudo-3D) 현장, 단계 목록·설명, 훈련(순서 맞히기) 모드
//
// 입체감: 비스듬히 내려다보는 원근 투영 · 면마다 햇빛 방향으로 명암 · 땅 위 그림자 · 먼 것부터 그리기 · 멀수록 대기색
import { SafetySim, SCENARIOS, ROLES, RULES, GEO, boomFK, bucketPos, hookXY, quizOptions, gasOK, GAS_LIMIT, TX, TW, towerLeg, PULLEY } from './safety.js?v=a96c9949';

const $ = (id) => document.getElementById(id);
const t = (o) => (o == null ? '' : window.t ? window.t(o) : o.ko);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const rgb = (c, al = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SPEEDS = [1, 2, 4, 8];
let sim, scenario = 'pole', scene = 'pole', mode = 'watch', running = false, speedIdx = 1, acc = 0, lastT = 0, hold = 0;
let showLabels = true, showPower = true, camMode = 'auto';
let quiz = null, score = { first: 0, total: 0, mistakes: [] }, flash = null;

// ---- 카메라 ------------------------------------------------------------------------
const cam = { tx: -1, ty: 3, tz: 3.5, yaw: 0.45, pitch: 0.3, dist: 34, fov: 0.9 };
const CAMS = {
  site: { tx: -1, ty: 3, tz: 3.5, yaw: 0.45, pitch: 0.3, dist: 34 },
  board: { tx: -18.5, ty: 5, tz: 1, yaw: 0.3, pitch: 0.3, dist: 15 },
  zone: { tx: 0, ty: 3, tz: 1, yaw: 0.22, pitch: 0.62, dist: 44 },
  reverse: { tx: -3, ty: 2, tz: 1, yaw: -0.55, pitch: 0.42, dist: 34 },
  truck: { tx: 0.5, ty: 2, tz: 1.4, yaw: 0.75, pitch: 0.42, dist: 20 },
  sw: { tx: -68, ty: 5, tz: 6, yaw: 0.42, pitch: 0.16, dist: 26 },
  gnd: { tx: -33.5, ty: 5, tz: 6, yaw: 0.38, pitch: 0.16, dist: 25 },
  bucket: { tx: -0.8, ty: 4.4, tz: 9.4, yaw: 0.55, pitch: 0.14, dist: 15 },
  lift: { tx: -1, ty: 3.5, tz: 5, yaw: 0.5, pitch: 0.2, dist: 25 },
  wide: { tx: -32, ty: 3, tz: 4, yaw: 0.25, pitch: 0.26, dist: 92 },
  mboard: { tx: -1.5, ty: -5.4, tz: 1, yaw: 0.3, pitch: 0.3, dist: 15 },
  mzone: { tx: 7.5, ty: -2, tz: 0.5, yaw: 0.12, pitch: 0.62, dist: 38 },
  mh: { tx: 13, ty: -2.2, tz: 0.6, yaw: 0.45, pitch: 0.42, dist: 12 },
  mvent: { tx: 12, ty: -1.8, tz: 0.6, yaw: 0.35, pitch: 0.45, dist: 16 },
  cosv: { tx: 0, ty: 4.6, tz: 9.4, yaw: 0.35, pitch: 0.1, dist: 14 },
  txv: { tx: -0.5, ty: 4.5, tz: 8.6, yaw: 0.62, pitch: 0.08, dist: 11 },
  tboard: { tx: -11.5, ty: 5.4, tz: 1, yaw: 0.3, pitch: 0.3, dist: 15 },
  tzone: { tx: 0, ty: 17, tz: 2, yaw: 0.2, pitch: 0.55, dist: 48 },
  tbase: { tx: -4, ty: 14.5, tz: 2.5, yaw: 0.4, pitch: 0.28, dist: 22 },
  tclimb: { tx: -2, ty: 17, tz: 17, yaw: 0.4, pitch: 0.1, dist: 54 },
  ttop: { tx: -3.2, ty: 16.8, tz: 22.5, yaw: 0.55, pitch: 0.1, dist: 12 }
};
const STEP_CAM = {
  tbm: 'board', ppe: 'board', zone: 'zone', reverse: 'reverse', chocks: 'truck', outrig: 'truck', switch: 'sw', earth: 'gnd',
  harness: 'lift', test: 'bucket', cover: 'bucket', lift: 'lift', finish: 'wide',
  permit: 'mboard', mppe: 'mboard', mzone: 'mzone', lid: 'mh', gas1: 'mh', vent: 'mvent', watch: 'mh', enter: 'mh', mfinish: 'mzone',
  cos: 'cosv', txearth: 'txv', hvcover: 'txv', txlift: 'lift', txfinish: 'zone',
  ttbm: 'tboard', tppe: 'tboard', tzone: 'tzone', lifeline: 'tbase', climb: 'tclimb', tieoff: 'ttop', hoist: 'tclimb', twork: 'ttop', tdown: 'tclimb'
};
const CAM_LIST = {
  pole: [['auto', { ko: '시점: 자동 (단계 따라가기)', en: 'View: auto (follow steps)' }], ['site', { ko: '시점: 작업 현장', en: 'View: work site' }], ['bucket', { ko: '시점: 버킷', en: 'View: bucket' }],
    ['truck', { ko: '시점: 작업차', en: 'View: truck' }], ['gnd', { ko: '시점: 접지 전주 (-35)', en: 'View: earthing pole (-35)' }], ['sw', { ko: '시점: 개폐기 전주 (-70)', en: 'View: switch pole (-70)' }], ['wide', { ko: '시점: 거리 전체', en: 'View: whole street' }]],
  tx: [['auto', { ko: '시점: 자동 (단계 따라가기)', en: 'View: auto (follow steps)' }], ['site', { ko: '시점: 작업 현장', en: 'View: work site' }], ['txv', { ko: '시점: 변압기', en: 'View: transformer' }],
    ['cosv', { ko: '시점: COS · 전주 위', en: 'View: cut-out · pole top' }], ['truck', { ko: '시점: 작업차', en: 'View: truck' }]],
  tower: [['auto', { ko: '시점: 자동 (단계 따라가기)', en: 'View: auto (follow steps)' }], ['tclimb', { ko: '시점: 철탑 전체', en: 'View: whole tower' }], ['ttop', { ko: '시점: 작업 위치', en: 'View: work position' }],
    ['tbase', { ko: '시점: 철탑 아래', en: 'View: tower foot' }], ['tzone', { ko: '시점: 출입금지 구역', en: 'View: keep-out zone' }]],
  manhole: [['auto', { ko: '시점: 자동 (단계 따라가기)', en: 'View: auto (follow steps)' }], ['mzone', { ko: '시점: 작업 구역', en: 'View: work zone' }], ['mh', { ko: '시점: 맨홀', en: 'View: manhole' }], ['mboard', { ko: '시점: 작업 준비', en: 'View: briefing' }]]
};
const EYE_VIEWS = [['eyeA', { ko: '시점: 현장 — 작업책임자(공사담당자) 옆 눈높이', en: 'View: on site — beside the supervisor, eye level' }],
  ['eyeW', { ko: '시점: 현장 — 지금 일하는 작업자 옆', en: 'View: on site — beside the worker on the job' }]];
for (const k of Object.keys(CAM_LIST)) CAM_LIST[k].splice(1, 0, ...EYE_VIEWS);
let camGoal = null, C;

function makeCamera(W, H) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const f = [sy * cp, cy * cp, -sp], r = [cy, -sy, 0], u = [sy * sp, cy * sp, cp];
  const pos = [cam.tx - f[0] * cam.dist, cam.ty - f[1] * cam.dist, cam.tz - f[2] * cam.dist];
  return { f, r, u, pos, W, H, F: H / (2 * Math.tan(cam.fov / 2)) };
}
const NEAR = 0.4;
function toCam(x, y, z) {
  const dx = x - C.pos[0], dy = y - C.pos[1], dz = z - C.pos[2];
  return [dx * C.r[0] + dy * C.r[1], dx * C.u[0] + dy * C.u[1] + dz * C.u[2], dx * C.f[0] + dy * C.f[1] + dz * C.f[2]];
}
const scr = (c) => [C.W / 2 + C.F * c[0] / c[2], C.H / 2 - C.F * c[1] / c[2]];
function project(x, y, z) { const c = toCam(x, y, z); return c[2] < NEAR ? null : scr(c); }
const depth = (x, y, z) => toCam(x, y, z)[2];
function projPoly(pts) {
  const cs = pts.map(p => toCam(p[0], p[1], p[2] || 0)), out = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = cs[(i + 1) % cs.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) { const k = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]); }
  }
  return out.length >= 3 ? out.map(scr) : null;
}
function fillPoly(ctx, pts, color, stroke, lw = 1) {
  const S = projPoly(pts); if (!S) return;
  ctx.beginPath(); ctx.moveTo(S[0][0], S[0][1]); for (let i = 1; i < S.length; i++) ctx.lineTo(S[i][0], S[i][1]); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function line3(ctx, pts, color, width, dash, off = 0) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = off; }
  ctx.beginPath(); let on = false;
  for (const p of pts) { const s = project(p[0], p[1], p[2] || 0); if (!s) { on = false; continue; } on ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); on = true; }
  ctx.stroke(); if (dash) ctx.setLineDash([]);
}
const pxPerM = (x, y, z) => { const d = depth(x, y, z); return d > NEAR ? C.F / d : 0; };
// 굵기가 거리에 따라 변하는 선 (붐·전주·막대)
function rod(ctx, a, b, wM, color, cap = 'round') {
  const sa = project(...a), sb = project(...b); if (!sa || !sb) return;
  if (camMode.startsWith('eye')) {                      // 현장 시점: 눈앞을 크게 가리는 붐·전주는 반투명 (화면에 그려지는 굵기 기준)
    const lw = wM * (pxPerM(...a) + pxPerM(...b)) / 2;
    if (lw > 12) { ctx.save(); ctx.globalAlpha = clamp(12 / lw, 0.12, 1); rodDraw(ctx, a, b, sa, sb, wM, color, cap); ctx.restore(); return; }
  }
  rodDraw(ctx, a, b, sa, sb, wM, color, cap);
}
function rodDraw(ctx, a, b, sa, sb, wM, color, cap) {
  ctx.strokeStyle = color; ctx.lineCap = cap; ctx.lineWidth = Math.max(1, wM * (pxPerM(...a) + pxPerM(...b)) / 2);
  ctx.beginPath(); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]); ctx.stroke();
}

// ---- 빛과 색 -----------------------------------------------------------------------
const SUN = (() => { const v = [-0.45, -0.55, 0.7], n = Math.hypot(...v); return v.map(x => x / n); })();
const SKY_TOP = [118, 168, 222], SKY_LOW = [214, 230, 242], FOG = [206, 222, 236];
const shade = (c, n) => mix([0, 0, 0], c, 0.6 + 0.4 * Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]));
const fog = (c, d) => mix(c, FOG, clamp((d - 55) / 220, 0, 0.6));
const COL = {
  grass: [134, 168, 108], walk: [204, 200, 190], walk2: [190, 186, 176], asphalt: [84, 88, 94], curb: [222, 220, 214],
  yellow: [236, 190, 40], white: [244, 244, 240], concrete: [196, 196, 192], steel: [150, 156, 162], red: [200, 52, 44],
  cone: [244, 110, 30], chock: [240, 194, 40], hv: [58, 62, 70]
};

// ---- 상자 (면마다 명암, 보이는 면만) ---------------------------------------------------------
// o: { x, y, hx, hy, yaw, z0, z1, col, faces: { top, px, nx, py, ny } } — faces는 면별 색 덮어쓰기
function box(ctx, o) {
  const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), P = (a, b, z) => [o.x + a * c - b * s, o.y + a * s + b * c, z];
  const { hx, hy, z0, z1 } = o, F = o.faces || {};
  const faces = [
    ['top', [0, 0, 1], [P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1)]],
    ['px', [c, s, 0], [P(hx, -hy, z0), P(hx, hy, z0), P(hx, hy, z1), P(hx, -hy, z1)]],
    ['nx', [-c, -s, 0], [P(-hx, hy, z0), P(-hx, -hy, z0), P(-hx, -hy, z1), P(-hx, hy, z1)]],
    ['py', [-s, c, 0], [P(hx, hy, z0), P(-hx, hy, z0), P(-hx, hy, z1), P(hx, hy, z1)]],
    ['ny', [s, -c, 0], [P(-hx, -hy, z0), P(hx, -hy, z0), P(hx, -hy, z1), P(-hx, -hy, z1)]]
  ];
  const d0 = depth(o.x, o.y, (z0 + z1) / 2);
  for (const [k, n, pts] of faces) {
    const m = pts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
    if (n[0] * (C.pos[0] - m[0]) + n[1] * (C.pos[1] - m[1]) + n[2] * (C.pos[2] - m[2]) <= 0) continue;
    const col = F[k] || o.col;
    fillPoly(ctx, pts, rgb(fog(shade(col, n), d0)), o.edge ? rgb(mix(col, [0, 0, 0], 0.45), 0.5) : null, 0.6);
  }
}
function disc(ctx, cx, cy, cz, r, axis, color, n = 14) {          // 세로 원판 (바퀴): axis 'y' = xz 평면
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push(axis === 'y' ? [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r] : [cx, cy + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  fillPoly(ctx, pts, color);
}
function groundCircle(ctx, x, y, r, fill, stroke, dash) {
  const pts = []; for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r, 0.02]); }
  if (fill) fillPoly(ctx, pts, fill);
  if (stroke) line3(ctx, [...pts, pts[0]], stroke, 2, dash);
}

// ---- 장면 그리기 ---------------------------------------------------------------------
let D;                                                       // 이번 프레임의 그릴 것 목록 [{d, f}]
const push = (x, y, z, f) => { const d = depth(x, y, z); if (d > NEAR) D.push({ d, f }); };

function drawGround(ctx) {
  const { W: w, H: h } = C;
  const far = project(C.pos[0] + Math.sin(cam.yaw) * 1e5, C.pos[1] + Math.cos(cam.yaw) * 1e5, 0);
  const hy = far ? clamp(far[1], -h, h * 2) : -h;
  let g = ctx.createLinearGradient(0, 0, 0, Math.max(1, hy));
  g.addColorStop(0, rgb(SKY_TOP)); g.addColorStop(1, rgb(SKY_LOW));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  g = ctx.createLinearGradient(0, hy, 0, h); g.addColorStop(0, rgb(FOG)); g.addColorStop(0.2, rgb(mix(COL.grass, FOG, 0.4))); g.addColorStop(1, rgb(COL.grass));
  ctx.fillStyle = g; ctx.fillRect(0, hy, w, h - hy);
  const X0 = -140, X1 = 110, G = GEO;
  fillPoly(ctx, [[X0, -G.walkOut - 1.5], [X1, -G.walkOut - 1.5], [X1, G.walkOut + 1.5], [X0, G.walkOut + 1.5]].map(p => [...p, 0]), rgb(mix(COL.walk2, FOG, 0.15)));
  for (const s of [1, -1]) fillPoly(ctx, [[X0, s * G.roadHalf], [X1, s * G.roadHalf], [X1, s * G.walkOut], [X0, s * G.walkOut]].map(p => [...p, 0.01]), rgb(COL.walk));
  // 보도 블록 줄눈
  for (let x = -120; x <= 100; x += 2) for (const s of [1, -1]) line3(ctx, [[x, s * G.roadHalf, 0.02], [x, s * G.walkOut, 0.02]], 'rgba(0,0,0,.06)', 1);
  fillPoly(ctx, [[X0, -G.roadHalf], [X1, -G.roadHalf], [X1, G.roadHalf], [X0, G.roadHalf]].map(p => [...p, 0.02]), rgb(COL.asphalt));
  for (const s of [1, -1]) line3(ctx, [[X0, s * G.roadHalf, 0.03], [X1, s * G.roadHalf, 0.03]], rgb(COL.curb), 2);
  for (const dy of [-0.12, 0.12]) line3(ctx, [[X0, dy, 0.03], [X1, dy, 0.03]], rgb(COL.yellow), 1.6);   // 중앙선 (황색 실선 2줄)
  for (const s of [1, -1]) line3(ctx, [[X0, s * 3.6, 0.03], [X1, s * 3.6, 0.03]], 'rgba(240,240,236,.75)', 1.2, [10, 14]);
}

// 작업구역 바닥 표시 · 낙하 반경
const hookZ = (tr) => { const jz = bucketPos(tr)[2] + 1.7; return jz - 0.4 - tr.hookDrop * (jz - 0.4 - 1.0); };
function dangerCircle(ctx, x, y, r) {
  const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 180);
  groundCircle(ctx, x, y, r, `rgba(230,40,40,${0.12 + 0.08 * pulse})`, `rgba(220,30,30,${pulse})`, [8, 6]);
}
function drawZoneFloor(ctx) {
  const W = sim.w;
  if (scene === 'tower') {
    if (W.cones.every(c => c.placed)) groundCircle(ctx, TW.x, TW.y, 9, 'rgba(255,140,40,.13)', null);
    const foot = towerLeg(0);
    if (W.people.B.z > 2) dangerCircle(ctx, foot[0], foot[1], 3);
    if (W.bag.state === 'up' || W.bag.state === 'down') dangerCircle(ctx, PULLEY[0], PULLEY[1], GEO.fallR);
    return;
  }
  if (scene === 'pole') {
    const all = W.cones.filter(c => c.side !== 4).every(c => c.placed);
    if (all) fillPoly(ctx, GEO.zone.map(p => [...p, 0.035]), 'rgba(255,140,40,.13)');
    const tr = W.truck;
    if ((W.load.state === 'hook' || W.txOld?.state === 'hook') && tr.hookDrop < 0.97) { const h = hookXY(tr); dangerCircle(ctx, h[0], h[1], GEO.fallR); }
    if (W.ground.earth) {                                    // 접지봉
      const g = [GEO.gndX + 0.6, 4.2];
      push(g[0], g[1], 0.3, ctx2 => { rod(ctx2, [g[0], g[1], 0], [g[0], g[1], 0.35], 0.05, '#8a6d3b'); });
    }
  } else {
    if (W.cones.every(c => c.placed)) fillPoly(ctx, GEO.mhZone.map(p => [...p, 0.035]), 'rgba(255,140,40,.13)');
    const [mx, my] = GEO.mh;
    if (W.mh.lid === 'closed') {
      groundCircle(ctx, mx, my, 0.42, 'rgb(70,72,76)', 'rgb(40,40,44)');
      groundCircle(ctx, mx, my, 0.3, null, 'rgba(255,255,255,.18)');
    } else {
      groundCircle(ctx, mx, my, 0.46, 'rgb(12,12,14)', 'rgb(60,60,64)');
      groundCircle(ctx, mx + 1.25, my - 0.55, 0.42, 'rgb(70,72,76)', 'rgb(40,40,44)');
    }
  }
}

function drawShadow(ctx, x, y, r, al = 0.22) {
  const pts = []; for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; pts.push([x + 0.25 + Math.cos(a) * r, y + 0.3 + Math.sin(a) * r * 0.7, 0.04]); }
  fillPoly(ctx, pts, `rgba(0,0,0,${al})`);
}

// 건물·나무 (배경)
const BUILD = (() => {
  const out = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const side of [1, -1]) for (let x = -135; x < 105;) {
    const w = 8 + rnd() * 10, h = 5 + rnd() * 13, d = 8 + rnd() * 6, hue = [[226, 214, 196], [200, 210, 222], [214, 200, 190], [196, 206, 196], [230, 226, 214]][(rnd() * 5) | 0];
    out.push({ x: x + w / 2, y: side * (GEO.walkOut + 3.5 + d / 2), hx: w / 2 - 0.4, hy: d / 2, h, col: hue });
    x += w + rnd() * 3;
  }
  return out;
})();
function drawStatic(ctx) {
  const camSide = Math.abs(C.pos[1]) > GEO.walkOut + 0.5 ? Math.sign(C.pos[1]) : 0;   // 카메라 쪽 건물은 잘라 내고 보여 줌
  for (const b of BUILD) if (Math.sign(b.y) !== camSide && !(scene === 'tower' && b.y > 0)) push(b.x, b.y, b.h / 2, c => {
    box(c, { x: b.x, y: b.y, hx: b.hx, hy: b.hy, z0: 0, z1: b.h, col: b.col, faces: { top: mix(b.col, [120, 120, 120], 0.3) } });
    // 창문 줄
    const face = b.y > 0 ? -1 : 1, yy = b.y + face * b.hy + face * 0.02;
    for (let z = 2; z < b.h - 1; z += 3) line3(c, [[b.x - b.hx + 1, yy, z], [b.x + b.hx - 1, yy, z]], 'rgba(70,96,130,.35)', Math.max(1, pxPerM(b.x, yy, z) * 0.55), [8, 6]);
  });
  for (let x = -128; x < 100; x += 13) {                       // 남쪽 보도 가로수
    const y = -GEO.walkOut + 0.9;
    if (camSide < 0 || depth(x, y, 2.5) < 6) continue;
    push(x, y, 2.5, c => {
      rod(c, [x, y, 0], [x, y, 2.4], 0.22, '#6b5236');
      const s = project(x, y, 3.6), k = pxPerM(x, y, 3.6); if (!s) return;
      c.fillStyle = rgb(fog([88, 140, 76], depth(x, y, 3))); c.beginPath(); c.arc(s[0], s[1], 1.6 * k, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(s[0] - 0.5 * k, s[1] - 0.5 * k, 0.8 * k, 0, 7); c.fill();
    });
  }
}

// ---- 전주 · 전선 ----------------------------------------------------------------------
const WIRE_POLES = [-105, -70, -35, 0, 35, 70];
function drawPoles(ctx, now) {
  const G = GEO, W = sim.w;
  if (scene === 'tower') return;
  for (const px of WIRE_POLES) {
    const y = G.poleY;
    push(px, y, 6, c => {
      drawShadow(c, px, y, 0.35, 0.18);
      rod(c, [px, y, 0], [px, y, G.poleH], 0.36, rgb(fog(COL.concrete, depth(px, y, 6))), 'butt');
      rod(c, [px + 0.07, y - 0.07, 0], [px + 0.07, y - 0.07, G.poleH], 0.1, 'rgba(255,255,255,.25)', 'butt');
      for (let z = 0.2; z < 2; z += 0.36) rod(c, [px, y, z], [px, y, z + 0.18], 0.39, '#222', 'butt');     // 황·흑 띠
      for (let z = 0.38; z < 2; z += 0.36) rod(c, [px, y, z], [px, y, z + 0.18], 0.39, '#f1c40f', 'butt');
      // 완금 · 애자
      box(c, { x: px, y, hx: 0.06, hy: 1.3, z0: G.armZ - 0.12, z1: G.armZ, col: COL.steel });
      const work = px === G.workX && scenario === 'pole', old = work && W.insul === 'old';
      for (const py of G.phaseY) {
        const a = [px, py, G.armZ], b = [px, py, G.armZ + 0.26];
        rod(c, a, b, 0.16, old ? '#8b5a2b' : '#9aa3ad', 'butt');
        for (let k = 0.05; k < 0.26; k += 0.07) rod(c, [px, py, G.armZ + k], [px, py, G.armZ + k + 0.02], 0.24, old ? '#7a4a20' : '#b7bec6', 'butt');
        if (old) { const s = project(px, py, G.armZ + 0.13); if (s) { c.fillStyle = '#e03131'; c.font = `700 ${Math.max(9, pxPerM(px, py, G.armZ) * 0.35)}px system-ui`; c.textAlign = 'center'; c.fillText('!', s[0] + pxPerM(px, py, G.armZ) * 0.25, s[1]); } }
      }
      rod(c, [px, G.neutralY, G.neutralZ - 0.15], [px, G.neutralY, G.neutralZ], 0.12, '#9aa3ad', 'butt');   // 중성선 애자
      if (px === G.swX) {                                       // 개폐기
        const on = W.sw.closed, sy = y - 0.45;
        box(c, { x: px, y: sy, hx: 0.32, hy: 0.25, z0: G.swZ - 0.3, z1: G.swZ + 0.25, col: [120, 130, 140], edge: true });
        const s = project(px, sy - 0.3, G.swZ), k = pxPerM(px, sy, G.swZ);
        if (s) { c.fillStyle = on ? '#e03131' : '#2f9e44'; c.beginPath(); c.arc(s[0], s[1], Math.max(2.5, 0.12 * k), 0, 7); c.fill(); }
        if (W.sw.tag) { const s2 = project(px, sy - 0.27, G.swZ - 0.55); if (s2) { c.fillStyle = '#ffd43b'; c.fillRect(s2[0] - 0.14 * k, s2[1], 0.28 * k, 0.36 * k); c.fillStyle = '#e03131'; c.fillRect(s2[0] - 0.14 * k, s2[1], 0.28 * k, 0.1 * k); } }
      }
    });
  }
  // 전선: 경간마다 여러 토막으로 나눠 그리기 순서에 섞음
  const hvLive = (xb) => xb <= G.swX || W.sw.closed;
  const wires = [];
  for (let i = 0; i < WIRE_POLES.length - 1; i++) {
    const xa = WIRE_POLES[i], xb = WIRE_POLES[i + 1], live = hvLive(xb);
    for (const py of G.phaseY) wires.push({ xa, xb, y: py, z: G.armZ + 0.26, sag: 0.55, kind: 'hv', live });
    wires.push({ xa, xb, y: G.neutralY, z: G.neutralZ, sag: 0.5, kind: 'n', live: false });
  }
  const N = 8;
  for (const wr of wires) for (let k = 0; k < N; k++) {
    const p = (j) => { const u = j / N; return [wr.xa + (wr.xb - wr.xa) * u, wr.y, wr.z - wr.sag * 4 * u * (1 - u)]; };
    const a = p(k), b = p(k + 1), m = p(k + 0.5);
    push(m[0], m[1], m[2], c => {
      const base = COL.hv;
      line3(c, [a, b], rgb(fog(base, depth(...m))), Math.max(1, 0.035 * pxPerM(...m)));
      if (showPower && wr.kind !== 'n') {
        if (wr.live) { line3(c, [a, b], 'rgba(255,90,40,.55)', Math.max(1.6, 0.07 * pxPerM(...m))); line3(c, [a, b], 'rgba(255,230,140,.95)', Math.max(1, 0.035 * pxPerM(...m)), [4, 10], -now / 30); }
        else line3(c, [a, b], 'rgba(60,140,255,.55)', Math.max(1.4, 0.06 * pxPerM(...m)));
      }
    });
  }
  // 방호관: 중성선 · 도로 쪽 인접 상
  if (scenario === 'pole' && W.covers > 0.001) {
    const L = 3.2 * W.covers, sagAt = (sag, x) => sag * 4 * (Math.abs(x) / 35) * (1 - Math.abs(x) / 35);
    for (const [py, z, sag] of [[G.neutralY, G.neutralZ, 0.5], [G.phaseY[0], G.armZ + 0.26, 0.55]]) push(0, py, z, c => {
      for (const s of [-1, 1]) { const pts = [0, 0.5, 1].map(u => [s * L * u, py, z - sagAt(sag, s * L * u) - 0.01]); line3(c, pts, '#ff7a1a', Math.max(2, 0.13 * pxPerM(0, py, z))); }
    });
  }
  // 접지 클램프 · 접지선
  if (scenario === 'pole' && W.ground.line > 0) {
    const x = G.gndX + 0.8, z = G.armZ + 0.24, rodP = [G.gndX + 0.6, 4.2, 0.3];
    push(x, 5, 6, c => {
      const pts = G.phaseY.slice(0, W.ground.line).map(py => [x, py, z]);
      if (pts.length > 1) line3(c, pts, '#2b8a3e', Math.max(1.5, 0.04 * pxPerM(x, 5, z)));
      const mid = [x - 0.4, 4.0, 5];
      line3(c, [pts[0], [x - 0.3, 4.3, 8], mid, rodP], '#2b8a3e', Math.max(1.5, 0.04 * pxPerM(...mid)));
      line3(c, [pts[0], [x - 0.3, 4.3, 8], mid, rodP], 'rgba(240,220,40,.8)', Math.max(1, 0.02 * pxPerM(...mid)), [4, 4]);
      for (const p of pts) { const s = project(...p); if (s) { c.fillStyle = '#c0c6cc'; c.beginPath(); c.arc(s[0], s[1], Math.max(2.5, 0.09 * pxPerM(...p)), 0, 7); c.fill(); c.strokeStyle = '#2b8a3e'; c.stroke(); } }
    });
  }
}

// ---- 변압기 교체: 주상변압기 · COS · 리드선 · 방호 커버 · 접지 ----------------------------------
function drawTransformer(c, x, y, z0, old) {
  const body = old ? [128, 116, 100] : [168, 178, 186];
  box(c, { x, y, hx: 0.36, hy: 0.36, z0, z1: z0 + 1.15, col: body, edge: true });
  box(c, { x, y, hx: 0.4, hy: 0.4, z0: z0 + 1.15, z1: z0 + 1.25, col: mix(body, [60, 60, 60], 0.3) });
  for (const dy of [-0.15, 0.15]) rod(c, [x, y + dy, z0 + 1.25], [x, y + dy, z0 + 1.5], 0.09, old ? '#7a4a20' : '#9aa3ad', 'butt');
  if (old) { const s = project(x - 0.37, y, z0 + 0.6), k = pxPerM(x, y, z0); if (s) { c.fillStyle = '#e03131'; c.font = `700 ${Math.max(9, 0.4 * k)}px system-ui`; c.textAlign = 'center'; c.fillText('!', s[0], s[1]); } }
}
function drawTxGear(ctx, now) {
  if (scenario !== 'tx') return;
  const W = sim.w, G = GEO, [cx, cy, cz] = TX.cos, tr = W.truck;
  const live = 'rgba(255,90,40,.6)', dead = 'rgba(60,140,255,.6)';
  push(cx, cy, cz, c => {
    rod(c, [0, G.poleY, cz + 0.4], [0, cy - 0.15, cz + 0.4], 0.07, '#868e96');                        // COS 받침대
    rod(c, [cx, cy, cz - 0.35], [cx, cy, cz + 0.35], 0.13, '#8b5a2b', 'butt');                         // 애자
    if (W.cos.closed) rod(c, [cx, cy - 0.14, cz - 0.32], [cx, cy - 0.14, cz + 0.32], 0.07, '#495057');  // 퓨즈홀더 (닫힘)
    else rod(c, [cx, cy - 0.14, cz - 0.32], [cx, cy - 0.6, cz - 0.75], 0.07, '#495057');                // 열려서 아래로 늘어짐
    const jump = [[0, G.phaseY[0], G.armZ + 0.26], [cx, cy, cz + 0.36]];
    line3(c, jump, '#343a40', Math.max(1.5, 0.03 * pxPerM(cx, cy, cz)));                              // 인하선 (전원측)
    if (showPower) line3(c, jump, live, Math.max(2, 0.06 * pxPerM(cx, cy, cz)));
    const lead = [[cx, cy, cz - 0.36], [TX.x, TX.y + 0.15, TX.z1 + 0.35]];
    if (W.txOld.state === 'pole' || W.load.state === 'pole') {
      line3(c, lead, '#343a40', Math.max(1.5, 0.03 * pxPerM(cx, cy, cz)));
      if (showPower) line3(c, lead, W.cos.closed ? live : dead, Math.max(2, 0.06 * pxPerM(cx, cy, cz)));
    }
    if (W.hvCover > 0.01) {                                                                            // 방호 커버
      box(c, { x: cx, y: cy, hx: 0.16, hy: 0.16, z0: cz + 0.2, z1: cz + 0.2 + 0.4 * Math.min(1, W.hvCover * 2), col: [255, 122, 26] });
      if (W.hvCover > 0.5) { const k = (W.hvCover - 0.5) * 2; line3(c, [jump[1], [jump[1][0] + (jump[0][0] - jump[1][0]) * k, jump[1][1] + (jump[0][1] - jump[1][1]) * k, jump[1][2] + (jump[0][2] - jump[1][2]) * k]], '#ff7a1a', Math.max(3, 0.14 * pxPerM(cx, cy, cz))); }
    }
    if (W.cos.tag) { const s = project(cx, cy - 0.2, cz - 0.6), k = pxPerM(cx, cy, cz); if (s) { c.fillStyle = '#ffd43b'; c.fillRect(s[0] - 0.12 * k, s[1], 0.24 * k, 0.3 * k); c.fillStyle = '#e03131'; c.fillRect(s[0] - 0.12 * k, s[1], 0.24 * k, 0.08 * k); } }
  });
  push(0, G.poleY - 0.3, TX.z0, c => box(c, { x: 0, y: G.poleY - 0.32, hx: 0.06, hy: 0.32, z0: TX.z0 + 0.4, z1: TX.z0 + 0.52, col: COL.steel }));   // 변압기 받침 브래킷
  const h = tr.present ? hookXY(tr) : [TX.x, TX.y], hz = tr.present ? hookZ(tr) : 0;
  const place = (st, kind, aside) => {
    if (st === 'pole') return [TX.x, TX.y, TX.z0];
    if (st === 'hook') return [h[0], h[1], hz - 1.55];
    if (st === 'down') return [h[0], h[1], 0];
    if (st === 'aside' || st === 'ground') return [h[0] + aside[0], h[1] + aside[1], 0];
    return null;
  };
  for (const [st, kind, aside] of [[W.txOld.state, 'txold', [-1.6, -0.5]], [W.load.state, 'txnew', [1.4, -0.5]]]) {
    const p = place(st, kind, aside); if (!p) continue;
    push(p[0], p[1], p[2] + 0.6, c => { if (p[2] < 0.1) drawShadow(c, p[0], p[1], 0.5); drawTransformer(c, p[0], p[1], p[2], kind === 'txold'); });
  }
  if (W.txEarth) push(TX.rod[0], TX.rod[1], 0.3, c => rod(c, [TX.rod[0], TX.rod[1], 0], [TX.rod[0], TX.rod[1], 0.35], 0.05, '#8a6d3b'));
  if (W.txGround) push(TX.x, TX.y, 4, c => {
    const pts = [[TX.x, TX.y + 0.15, TX.z1 + 0.35], [0.15, G.poleY - 0.25, 6], [0.2, G.poleY - 0.25, 2], [TX.rod[0], TX.rod[1], 0.3]];
    line3(c, pts, '#2b8a3e', Math.max(1.5, 0.04 * pxPerM(0, 5, 5))); line3(c, pts, 'rgba(240,220,40,.8)', Math.max(1, 0.02 * pxPerM(0, 5, 5)), [4, 4]);
  });
}

// ---- 송전 철탑 ------------------------------------------------------------------------
const corners = (z, out = 0) => { const h = TW.base - (TW.base - TW.topHalf) * Math.min(z, TW.top) / TW.top + out; return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([dx, dy]) => [TW.x + dx, TW.y + dy, z]); };
function drawTower(ctx, now) {
  if (scene !== 'tower') return;
  const W = sim.w, steel = (d) => rgb(fog([128, 136, 146], d)), levels = [];
  for (let z = 0; z < TW.top; z += 4) levels.push(z);
  levels.push(TW.top);
  const seg = (a, b, w) => push((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, c => rod(c, a, b, w, steel(depth(...a))));
  for (let i = 0; i < levels.length; i++) {
    const A = corners(levels[i]);
    for (let k = 0; k < 4; k++) seg(A[k], A[(k + 1) % 4], 0.07);                                    // 수평재
    if (i === levels.length - 1) break;
    const B = corners(levels[i + 1]);
    for (let k = 0; k < 4; k++) { seg(A[k], B[k], 0.2); seg(A[k], B[(k + 1) % 4], 0.05); seg(A[(k + 1) % 4], B[k], 0.05); }   // 주주재 · 사재
  }
  const wires = [];
  for (const z of TW.armZ) {
    const A = corners(z), h = A[1][0] - TW.x;
    for (const s of [-1, 1]) {                                                                      // 완금 (선로 방향 x에 직각인 y 방향)
      const tip = [TW.x, TW.y + s * (h + TW.armLen), z + 0.3], i1 = s < 0 ? 0 : 3, i2 = s < 0 ? 1 : 2;
      seg(A[i1], tip, 0.12); seg(A[i2], tip, 0.12); seg([A[i1][0], A[i1][1], z + 1], tip, 0.08); seg([A[i2][0], A[i2][1], z + 1], tip, 0.08);
      push(tip[0], tip[1], tip[2] - 1.1, c => { for (let q = 0; q < 10; q++) rod(c, [tip[0], tip[1], tip[2] - 0.15 - q * 0.21], [tip[0], tip[1], tip[2] - 0.25 - q * 0.21], 0.26, q % 2 ? '#8b5a2b' : '#a0522d', 'butt'); });   // 애자련
      wires.push({ y: tip[1], z: tip[2] - 2.3, w: 0.045, live: true });
    }
  }
  wires.push({ y: TW.y, z: TW.top + 0.4, w: 0.03, live: false });                                    // 가공지선
  const N = 16, X = 160;
  for (const wr of wires) for (let k = 0; k < N; k++) {
    const P = (u) => { const x = -X + 2 * X * u; return [x, wr.y, wr.z - 9 * (x / X) ** 2]; };
    const a = P(k / N), b = P((k + 1) / N), m = P((k + 0.5) / N);
    push(m[0], m[1], m[2], c => {
      line3(c, [a, b], rgb(fog(COL.hv, depth(...m))), Math.max(1, wr.w * pxPerM(...m)));
      if (showPower && wr.live) { line3(c, [a, b], 'rgba(255,90,40,.5)', Math.max(1.4, 0.08 * pxPerM(...m))); line3(c, [a, b], 'rgba(255,230,140,.95)', Math.max(1, 0.04 * pxPerM(...m)), [4, 10], -now / 30); }
    });
  }
  // 추락방지 와이어 (수직 구명줄) · 추락방지기 · 랜야드
  const ltop = towerLeg(TW.top - 1, 0.3), lbot = towerLeg(0.3, 0.3), B = W.people.B;
  push((ltop[0] + lbot[0]) / 2, (ltop[1] + lbot[1]) / 2, 10, c => line3(c, [ltop, lbot], W.lifelineOK ? '#1971c2' : '#5c7cfa', Math.max(1.5, 0.03 * pxPerM(...lbot))));
  if (W.arrester) { const p = towerLeg(B.z + 1.1, 0.3); push(p[0], p[1], p[2], c => box(c, { x: p[0], y: p[1], hx: 0.07, hy: 0.07, z0: p[2] - 0.12, z1: p[2] + 0.12, col: [250, 176, 5], edge: true })); }
  if (W.lanyard) { const a = [B.x, B.y, B.z + 1.0], b = towerLeg(B.z + 1.7, 0); push(b[0], b[1], b[2], c => line3(c, [a, b], '#e8590c', Math.max(2, 0.04 * pxPerM(...b)))); }
  // 도르래 · 달줄 · 공구 가방
  const [px, py, pz] = PULLEY, bag = [px, py, W.bag.state === 'ground' ? 0.15 : W.bag.z], Cp = W.people.C;
  push(px, py, pz, c => { const s = project(px, py, pz), k = pxPerM(px, py, pz); if (s) { c.strokeStyle = '#495057'; c.lineWidth = Math.max(1.5, 0.05 * k); c.beginPath(); c.arc(s[0], s[1], Math.max(3, 0.18 * k), 0, 7); c.stroke(); } });
  push(px, py, pz / 2, c => {
    line3(c, [[px, py, pz], [bag[0], bag[1], bag[2] + 0.3]], '#b08968', 1.4);
    if (Cp.tagline || W.bag.state !== 'ground') line3(c, [[px, py, pz], [Cp.x, Cp.y, 1.1]], '#b08968', 1.4);
  });
  if (W.bag.state !== 'top') push(bag[0], bag[1], bag[2], c => { if (bag[2] < 0.3) drawShadow(c, bag[0], bag[1], 0.3); box(c, { x: bag[0], y: bag[1], hx: 0.2, hy: 0.15, z0: bag[2], z1: bag[2] + 0.35, col: [214, 51, 108], edge: true }); });
}

// ---- 작업차 ------------------------------------------------------------------------
function drawTruck(ctx, now) {
  const tr = sim.w.truck; if (!tr.present) return;
  const c0 = tr.c, y = tr.y, G = GEO, half = G.truckLen / 2;
  const red = COL.red, white = [236, 238, 240], glass = [60, 80, 100], dark = [44, 46, 50];
  push(c0, y, 1.4, c => {
    // 그림자
    fillPoly(c, [[c0 - half + 0.3, y - 1.4, 0.03], [c0 + half + 0.4, y - 1.4, 0.03], [c0 + half + 0.4, y + 1.6, 0.03], [c0 - half + 0.3, y + 1.6, 0.03]], 'rgba(0,0,0,.22)');
    // 아웃트리거
    for (const ox of [c0 + 1.7, c0 - 3.4]) for (const s of [-1, 1]) {
      const ext = 1.0 + 1.5 * tr.outrig, footZ = 0.05 + (1 - tr.outrig) * 0.55, fy = y + s * ext;
      if (tr.pads) box(c, { x: ox, y: y + s * 2.5, hx: 0.32, hy: 0.32, z0: 0, z1: 0.06, col: [176, 136, 84] });
      box(c, { x: ox, y: y + s * (ext / 2 + 0.2), hx: 0.14, hy: ext / 2 - 0.15, z0: 0.72, z1: 0.92, col: [230, 190, 40] });
      rod(c, [ox, fy, 0.9], [ox, fy, footZ], 0.16, '#d9a400', 'butt');
      if (tr.outrig > 0.05) box(c, { x: ox, y: fy, hx: 0.18, hy: 0.18, z0: footZ - 0.04, z1: footZ, col: dark });
    }
    // 바퀴
    for (const wx of [c0 + 2.9, c0 - 2.3, c0 - 3.3]) for (const s of [-1, 1]) {
      const wy = y + s * 1.08;
      disc(c, wx, wy + s * 0.12, 0.5, 0.5, 'y', '#1f1f22'); disc(c, wx, wy + s * 0.15, 0.5, 0.22, 'y', '#9aa0a6');
    }
    box(c, { x: c0 - 0.2, y, hx: half - 0.2, hy: 0.95, z0: 0.5, z1: 0.95, col: dark });
    box(c, { x: c0 - 0.9, y, hx: 3.3, hy: 1.25, z0: 0.95, z1: 1.55, col: red, edge: true });            // 적재함
    for (const s of [-1, 1]) box(c, { x: c0 - 0.9, y: y + s * 0.98, hx: 3.2, hy: 0.27, z0: 1.55, z1: 2.25, col: white, edge: true });
    box(c, { x: c0 + 3.4, y, hx: 0.85, hy: 1.22, z0: 0.95, z1: 1.9, col: red, edge: true });            // 운전석
    box(c, { x: c0 + 3.4, y, hx: 0.85, hy: 1.22, z0: 1.9, z1: 3.0, col: white, edge: true, faces: { px: glass, py: mix(white, glass, 0.55), ny: mix(white, glass, 0.55) } });
    // 경광등
    const blink = (Math.floor(now / 350) % 2) === 0;
    const s = project(c0 + 3.4, y, 3.12), k = pxPerM(c0 + 3.4, y, 3.1);
    if (s) { c.fillStyle = blink ? '#ffb000' : '#a86a00'; c.beginPath(); c.arc(s[0], s[1], Math.max(2, 0.16 * k), 0, 7); c.fill(); if (blink) { c.fillStyle = 'rgba(255,190,0,.25)'; c.beginPath(); c.arc(s[0], s[1], 0.6 * k, 0, 7); c.fill(); } }
    // 고임목
    const ch = [[c0 + 2.9 + 0.58, y - 1.08], [c0 - 2.3 - 0.58, y - 1.08], [c0 - 2.3 - 0.58, y + 1.08], [c0 + 2.9 + 0.58, y + 1.08]];
    tr.chocks.forEach((on, i) => { if (on) box(c, { x: ch[i][0], y: ch[i][1], hx: 0.14, hy: 0.16, z0: 0, z1: 0.24, col: COL.chock, edge: true }); });
    // 회전대
    const B = [c0 - G.ttBack, y, G.ttZ];
    box(c, { x: B[0], y, hx: 0.55, hy: 0.55, z0: 1.55, z1: G.ttZ, col: [210, 212, 216], edge: true });
    // 적재된 자재
    if (sim.w.load.state === 'bed') drawLoad(c, c0 - 0.4, y, 1.6, sim.w.load.kind);
  });
  // 붐 · 버킷 (따로 넣어 사람·전선과 섞여 그려지게)
  const { B, E, T } = boomFK(tr);
  const segs = [[B, E], [E, T]];
  segs.forEach(([a, b], i) => push((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, c => {
    const sa = project(...a), sb = project(...b); if (!sa || !sb) return;
    const lw = (i ? 0.3 : 0.38) * (pxPerM(...a) + pxPerM(...b)) / 2, fade = camMode.startsWith('eye') && lw > 12;   // 현장 시점에서 눈앞의 붐은 통째로 반투명
    if (fade) { c.save(); c.globalAlpha = clamp(12 / lw, 0.12, 1); }
    rodDraw(c, a, b, sa, sb, i ? 0.3 : 0.38, i ? '#e9ecef' : '#f1f3f5', 'round');
    rodDraw(c, a, b, sa, sb, i ? 0.08 : 0.1, '#c92a2a', 'round');
    if (fade) c.restore();
  }));
  push(E[0], E[1], E[2], c => { const s = project(...E); if (s) { c.fillStyle = '#868e96'; c.beginPath(); c.arc(s[0], s[1], Math.max(2, 0.25 * pxPerM(...E)), 0, 7); c.fill(); } });
  const slew = tr.boom.slew, B2 = sim.w.people.B;
  push(T[0], T[1], T[2] + 0.5, c => {
    // 버킷 안 작업자 → 버킷 → 지브·훅
    if (B2.inBucket) drawPerson(c, 'B', B2, now);
    box(c, { x: T[0], y: T[1], hx: 0.45, hy: 0.45, yaw: slew, z0: T[2], z1: T[2] + 1.05, col: [244, 244, 244], edge: true, faces: { top: [60, 60, 60] } });
    rod(c, [T[0], T[1], T[2] + 1.05], [T[0], T[1], T[2] + 1.1], 0.95, '#f59f00', 'butt');
    const hx = hookXY(tr), jz = T[2] + 1.7;
    rod(c, [T[0], T[1], T[2] + 1.0], [T[0], T[1], jz], 0.08, '#495057');
    rod(c, [T[0], T[1], jz], [hx[0], hx[1], jz], 0.08, '#495057');
    const hz = jz - 0.4 - tr.hookDrop * (jz - 0.4 - 1.0);
    line3(c, [[hx[0], hx[1], jz], [hx[0], hx[1], hz]], '#343a40', 1);
    const hs = project(hx[0], hx[1], hz); if (hs) { c.strokeStyle = '#212529'; c.lineWidth = Math.max(1.5, 0.05 * pxPerM(hx[0], hx[1], hz)); c.beginPath(); c.arc(hs[0], hs[1] + 0.06 * pxPerM(hx[0], hx[1], hz), 0.08 * pxPerM(hx[0], hx[1], hz), 0, Math.PI * 1.4); c.stroke(); }
    if (sim.w.load.state === 'hook' && scenario !== 'tx') drawLoad(c, hx[0], hx[1], hz - 0.55, sim.w.load.kind);
  });
  if (sim.w.load.state === 'down' && scenario !== 'tx') { const h = hookXY(tr); push(h[0], h[1], 0.2, c => drawLoad(c, h[0], h[1], 0.02, sim.w.load.kind)); }
}
function drawLoad(c, x, y, z, kind) {
  if (kind === 'txnew' || kind === 'txold') { drawTransformer(c, x, y, z, kind === 'txold'); return; }
  const col = kind === 'old' ? [140, 100, 70] : [150, 160, 172];
  box(c, { x, y, hx: 0.12, hy: 1.1, z0: z, z1: z + 0.14, col, edge: true });
  for (const dy of [-0.8, 0, 0.8]) rod(c, [x, y + dy, z + 0.14], [x, y + dy, z + 0.4], 0.14, kind === 'old' ? '#7a4a20' : '#b7bec6', 'butt');
}

// ---- 사람 ---------------------------------------------------------------------------
function drawPerson(c, id, p, now, civ) {
  if (p.inCab || p.z < -0.9) return;
  const z0 = p.z || 0, feet = project(p.x, p.y, z0); if (!feet) return;
  const k = pxPerM(p.x, p.y, z0); if (k < 0.6) return;
  const right = project(p.x + 1, p.y, z0), dirX = right ? Math.sign(right[0] - feet[0]) || 1 : 1, face = (p.face || 1) * dirX;
  if (!p.inBucket && z0 > -0.05) { c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(feet[0] + 0.12 * k, feet[1], 0.32 * k, 0.11 * k, 0, 0, 7); c.fill(); }
  const anim = p.anim || 'idle', ph = (p.k || 0) * 6, walk = anim === 'walk';
  const crouch = anim === 'bend' ? 0.35 + 0.08 * Math.sin(ph) : anim === 'hammer' ? 0.25 : 0;
  const role = civ ? null : ROLES[scenario][id];
  const U = (dx, dz) => [feet[0] + dx * k * face, feet[1] - dz * k];
  const hip = U(0, 0.92 - crouch), sh = U(0.02, 1.42 - crouch), head = U(0.03, 1.6 - crouch);
  const clothes = civ ? p.col : '#2b3a55', skin = '#f1c9a5';
  c.lineCap = 'round';
  // 다리
  const sw = walk ? Math.sin(ph) * 0.22 : 0;
  c.strokeStyle = civ ? '#3b4252' : '#1f2a3d'; c.lineWidth = Math.max(1.5, 0.15 * k);
  for (const s of [1, -1]) {
    const knee = U(s * sw * 0.5 + (crouch ? 0.18 : 0), 0.48 - crouch * 0.4), foot = U(s * sw, 0.04);
    c.beginPath(); c.moveTo(...hip); c.lineTo(...knee); c.lineTo(...foot); c.stroke();
    c.fillStyle = '#222'; c.beginPath(); c.ellipse(foot[0] + 0.05 * k * face, foot[1], 0.1 * k, 0.05 * k, 0, 0, 7); c.fill();
  }
  // 몸통
  const tw = 0.21 * k;
  c.fillStyle = clothes; c.beginPath(); c.roundRect(Math.min(sh[0], hip[0]) - tw, sh[1], tw * 2 + Math.abs(sh[0] - hip[0]), hip[1] - sh[1] + 0.04 * k, 0.07 * k); c.fill();
  if (!civ && p.ppe.vest) {
    c.fillStyle = '#c3e63a'; c.fillRect(sh[0] - tw * 0.92, sh[1] + 0.04 * k, tw * 1.84, (hip[1] - sh[1]) * 0.85);
    c.fillStyle = '#e9ecef'; for (const f of [0.35, 0.62]) c.fillRect(sh[0] - tw * 0.92, sh[1] + (hip[1] - sh[1]) * f, tw * 1.84, 0.04 * k);
  }
  if (!civ && p.ppe.harness) { c.strokeStyle = '#212529'; c.lineWidth = Math.max(1, 0.035 * k); c.beginPath(); c.moveTo(sh[0] - tw * 0.6, sh[1]); c.lineTo(hip[0] + tw * 0.6, hip[1]); c.moveTo(sh[0] + tw * 0.6, sh[1]); c.lineTo(hip[0] - tw * 0.6, hip[1]); c.stroke(); }
  if (role) { c.fillStyle = role.col; c.beginPath(); c.arc(sh[0] + tw * 0.45 * face, sh[1] + 0.12 * k, Math.max(1.5, 0.05 * k), 0, 7); c.fill(); }
  // 팔
  const hands = armPose(p, anim, ph, U, crouch, face, k);
  c.strokeStyle = clothes; c.lineWidth = Math.max(1.3, 0.11 * k);
  for (const h of hands) { c.beginPath(); c.moveTo(...sh); c.lineTo(...h); c.stroke(); }
  c.fillStyle = !civ && p.ppe.gloves ? '#f08c00' : skin;
  for (const h of hands) { c.beginPath(); c.arc(h[0], h[1], Math.max(1.2, 0.055 * k), 0, 7); c.fill(); }
  // 들고 있는 것
  if (anim === 'wave') { const h = hands[0]; c.strokeStyle = (Math.floor(now / 250) % 2) ? '#ff3b30' : '#ff8a80'; c.lineWidth = Math.max(2, 0.06 * k); c.beginPath(); c.moveTo(...h); c.lineTo(h[0] + 0.1 * k * face, h[1] - 0.45 * k); c.stroke(); }
  if (anim === 'read') { const h = hands[0]; c.fillStyle = '#fff'; c.fillRect(h[0] - 0.12 * k, h[1] - 0.2 * k, 0.24 * k, 0.28 * k); }
  if (p.carry === 'detector' || anim === 'probe') { const h = hands[0]; c.fillStyle = '#ffd43b'; c.fillRect(h[0] - 0.06 * k, h[1] - 0.12 * k, 0.12 * k, 0.16 * k); }
  if (p.carry === 'load') drawLoadScreen(c, hands[0], k, sim.w.load.kind);
  // 머리 · 안전모
  c.fillStyle = skin; c.beginPath(); c.arc(head[0], head[1], 0.115 * k, 0, 7); c.fill();
  if (!civ && p.ppe.helmet) {
    c.fillStyle = '#fafafa'; c.beginPath(); c.arc(head[0], head[1] - 0.03 * k, 0.14 * k, Math.PI, 0); c.fill();
    c.fillRect(head[0] - 0.17 * k, head[1] - 0.04 * k, 0.34 * k, 0.04 * k);
    c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1; c.beginPath(); c.arc(head[0], head[1] - 0.03 * k, 0.14 * k, Math.PI, 0); c.stroke();
    if (role) { c.fillStyle = role.col; c.fillRect(head[0] - 0.05 * k, head[1] - 0.15 * k, 0.1 * k, 0.05 * k); }
  } else if (!civ) { c.fillStyle = '#2b2b2b'; c.beginPath(); c.arc(head[0], head[1] - 0.04 * k, 0.12 * k, Math.PI, 0); c.fill(); }
  else { c.fillStyle = p.hair || '#3a2a1a'; c.beginPath(); c.arc(head[0], head[1] - 0.04 * k, 0.12 * k, Math.PI, 0); c.fill(); }
  // 막대 (조작봉 · 검전기 · 접지 클램프)
  if (p.stick) {
    const h = hands[0], to = project(...p.stick.to);
    if (to) {
      c.strokeStyle = '#f2c230'; c.lineWidth = Math.max(1.5, 0.045 * k); c.beginPath(); c.moveTo(...h); c.lineTo(...to); c.stroke();
      c.strokeStyle = '#c92a2a'; c.lineWidth = Math.max(1, 0.03 * k); c.beginPath(); c.moveTo(...h); c.lineTo(h[0] + (to[0] - h[0]) * 0.12, h[1] + (to[1] - h[1]) * 0.12); c.stroke();
      const kk = pxPerM(...p.stick.to);
      if (p.stick.tool === 'detector') { c.fillStyle = '#ffd43b'; c.fillRect(to[0] - 0.08 * kk, to[1], 0.16 * kk, 0.22 * kk); c.fillStyle = (Math.floor(now / 200) % 2) ? '#40c057' : '#b2f2bb'; c.beginPath(); c.arc(to[0], to[1] + 0.06 * kk, Math.max(2, 0.05 * kk), 0, 7); c.fill(); }
      else { c.fillStyle = p.stick.tool === 'clamp' ? '#adb5bd' : '#495057'; c.beginPath(); c.arc(to[0], to[1], Math.max(2, 0.07 * kk), 0, 7); c.fill(); }
    }
  }
  p._head = [head[0], head[1] - 0.2 * k];
}
function armPose(p, anim, ph, U, crouch, face, k) {
  const sz = 1.42 - crouch, A = (dx, dz) => U(dx, dz);
  switch (anim) {
    case 'walk': return [A(Math.sin(ph) * 0.25, sz - 0.6), A(-Math.sin(ph) * 0.25, sz - 0.6)];
    case 'work': return [A(0.38, sz - 0.1 + Math.sin(ph * 1.3) * 0.08), A(0.32, sz - 0.2 - Math.sin(ph * 1.3) * 0.08)];
    case 'reach': return [A(0.32, sz + 0.42 + Math.sin(ph) * 0.06), A(0.36, sz + 0.25 - Math.sin(ph) * 0.06)];
    case 'climb': return [A(0.2, sz + 0.45), A(0.25, sz + 0.3)];
    case 'wave': { const a = Math.sin(ph * 1.6) * 0.18; return [A(0.3 + a, sz + 0.35), A(0.05, sz - 0.6)]; }
    case 'bend': return [A(0.38, 0.25), A(0.3, 0.3)];
    case 'read': return [A(0.3, sz - 0.25), A(0.28, sz - 0.3)];
    case 'talk': return [A(0.32, sz - 0.15 + Math.sin(ph * 1.5) * 0.08), A(0.05, sz - 0.6)];
    case 'dress': return [A(0.12, sz + 0.25 + Math.sin(ph * 2) * 0.05), A(-0.1, sz + 0.22 - Math.sin(ph * 2) * 0.05)];
    case 'hammer': return [A(0.32, sz - 0.3 + Math.abs(Math.sin(ph * 2)) * 0.5), A(0.28, sz - 0.4 + Math.abs(Math.sin(ph * 2)) * 0.5)];
    case 'probe': return [A(0.42, sz - 0.45), A(0.25, sz - 0.3)];
    case 'watch': return [A(0.16, sz - 0.5), A(-0.16, sz - 0.5)];
    case 'hold': return [A(0.4, sz - 0.25), A(0.3, sz - 0.35)];
    case 'stick': {
      if (p.stick) { const to = project(...p.stick.to), sh = A(0.02, sz); if (to) { const dx = to[0] - sh[0], dy = to[1] - sh[1], L = Math.hypot(dx, dy) || 1; return [[sh[0] + dx / L * 0.55 * k, sh[1] + dy / L * 0.55 * k], [sh[0] + dx / L * 0.32 * k, sh[1] + dy / L * 0.32 * k]]; } }
      return [A(0.25, sz + 0.4), A(0.2, sz + 0.2)];
    }
    default: return [A(0.1, sz - 0.62), A(-0.08, sz - 0.62)];
  }
}
function drawLoadScreen(c, h, k, kind) {
  c.fillStyle = kind === 'old' ? '#8c6446' : '#96a0ac'; c.fillRect(h[0] - 0.55 * k, h[1] - 0.06 * k, 1.1 * k, 0.12 * k);
}

const PED_COLS = [{ col: '#6c5ce7', hair: '#2d1e12' }, { col: '#e17055', hair: '#5a3b1f' }];
function drawPeople(ctx, now) {
  const W = sim.w;
  for (const [id, p] of Object.entries(W.people)) { if (p.inBucket) continue; push(p.x, p.y, (p.z || 0) + 0.9, c => drawPerson(c, id, p, now)); }
  sim.peds.forEach((q, i) => push(q.x, q.y, 0.9, c => drawPerson(c, 'ped', { ...q, z: 0, face: q.dir, anim: 'walk', ...PED_COLS[i % 2] }, now, true)));
  // 유도 로프
  const C2 = W.people.C;
  if (C2.tagline && (W.load.state === 'hook' || W.txOld?.state === 'hook') && W.truck.present) {
    const h = hookXY(W.truck), hz = hookZ(W.truck) - (scenario === 'tx' ? 1.0 : 0.5);
    push((h[0] + C2.x) / 2, (h[1] + C2.y) / 2, 2, c => line3(c, [[h[0], h[1], hz], [C2.x, C2.y, 1.1]], '#e8590c', 1.4));
  }
}

// ---- 고깔 · 안전띠 · 안내판 ------------------------------------------------------------
function cone(c, x, y) {
  const b = project(x, y, 0), tp = project(x, y, 0.75); if (!b || !tp) return;
  const k = pxPerM(x, y, 0), w = 0.2 * k;
  c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(b[0] + 0.1 * k, b[1], 0.26 * k, 0.09 * k, 0, 0, 7); c.fill();
  c.fillStyle = '#222'; c.fillRect(b[0] - 0.25 * k, b[1] - 0.05 * k, 0.5 * k, 0.06 * k);
  c.fillStyle = rgb(COL.cone); c.beginPath(); c.moveTo(b[0] - w, b[1] - 0.04 * k); c.lineTo(tp[0] - 0.03 * k, tp[1]); c.lineTo(tp[0] + 0.03 * k, tp[1]); c.lineTo(b[0] + w, b[1] - 0.04 * k); c.fill();
  c.fillStyle = '#f8f9fa'; const m = (b[1] + tp[1]) / 2; c.fillRect(b[0] - w * 0.6, m - 0.06 * k, w * 1.2, 0.1 * k);
}
function drawCones(ctx) {
  const W = sim.w;
  for (const cn of W.cones) if (cn.placed) push(cn.x, cn.y, 0.4, c => cone(c, cn.x, cn.y));
  const chains = scene === 'pole'
    ? [W.cones.filter(c => c.side === 0), [...W.cones.filter(c => c.side === 3).reverse(), ...W.cones.filter(c => c.side === 2), ...W.cones.filter(c => c.side === 1)], W.cones.filter(c => c.side === 4)]
    : [[...W.cones, W.cones[0]]];
  for (const ch of chains) for (let i = 0; i < ch.length - 1; i++) {
    const a = ch[i], b = ch[i + 1]; if (!a.placed || !b.placed) continue;
    push((a.x + b.x) / 2, (a.y + b.y) / 2, 0.7, c => { line3(c, [[a.x, a.y, 0.68], [b.x, b.y, 0.68]], '#f8f9fa', 2.4); line3(c, [[a.x, a.y, 0.68], [b.x, b.y, 0.68]], '#e03131', 2.4, [7, 7]); });
  }
  const bd = W.board;
  if (bd.present) push(bd.x, bd.y, 0.6, c => {
    const a = project(bd.x - 0.38, bd.y, 0.25), b = project(bd.x + 0.38, bd.y, 1.25); if (!a || !b) return;
    const k = pxPerM(bd.x, bd.y, 0.6);
    c.strokeStyle = '#555'; c.lineWidth = Math.max(1, 0.04 * k);
    const f1 = project(bd.x - 0.3, bd.y, 0), f2 = project(bd.x + 0.3, bd.y, 0); if (f1 && f2) { c.beginPath(); c.moveTo(f1[0], f1[1]); c.lineTo(a[0], a[1]); c.moveTo(f2[0], f2[1]); c.lineTo(b[0], a[1]); c.stroke(); }
    c.fillStyle = '#ffd43b'; c.fillRect(a[0], b[1], b[0] - a[0], a[1] - b[1]);
    c.fillStyle = '#2f9e44'; c.fillRect(a[0] + 0.05 * k, b[1] + 0.05 * k, b[0] - a[0] - 0.1 * k, 0.16 * k);
    c.fillStyle = '#fff'; for (let i = 0; i < 5; i++) c.fillRect(a[0] + 0.07 * k, b[1] + (0.3 + i * 0.13) * k, (b[0] - a[0]) * (i % 2 ? 0.55 : 0.75), 0.06 * k);
  });
}

// ---- 맨홀 장비 · 작업 차량 ---------------------------------------------------------------
function drawVan(ctx, now) {
  const v = sim.w.van; if (!v) return;
  push(v.c, v.y, 1.2, c => {
    fillPoly(c, [[v.c - 2.6, v.y - 1.2, 0.03], [v.c + 3.0, v.y - 1.2, 0.03], [v.c + 3.0, v.y + 1.3, 0.03], [v.c - 2.6, v.y + 1.3, 0.03]], 'rgba(0,0,0,.22)');
    for (const wx of [v.c + 1.8, v.c - 1.7]) for (const s of [-1, 1]) disc(c, wx, v.y + s * 0.98, 0.4, 0.4, 'y', '#1f1f22');
    box(c, { x: v.c - 0.7, y: v.y, hx: 2.0, hy: 1.0, z0: 0.45, z1: 2.4, col: [240, 240, 240], edge: true, faces: { py: [236, 236, 236] } });
    box(c, { x: v.c + 2.05, y: v.y, hx: 0.75, hy: 0.98, z0: 0.45, z1: 1.95, col: [240, 240, 240], edge: true, faces: { px: [60, 80, 100] } });
    box(c, { x: v.c - 0.7, y: v.y - 1.0, hx: 2.0, hy: 0.01, z0: 1.0, z1: 1.2, col: COL.red });
    const blink = (Math.floor(now / 350) % 2) === 0, s = project(v.c + 2.05, v.y, 2.05), k = pxPerM(v.c, v.y, 2);
    if (s) { c.fillStyle = blink ? '#ffb000' : '#a86a00'; c.beginPath(); c.arc(s[0], s[1], Math.max(2, 0.14 * k), 0, 7); c.fill(); }
  });
}
function drawManhole(ctx, now) {
  if (scene !== 'manhole') return;
  const W = sim.w, M = W.mh, [mx, my] = GEO.mh;
  if (M.guard) push(mx, my, 0.5, c => {
    const r = 0.95, P = [[mx - r, my - r], [mx + r, my - r], [mx + r, my + r], [mx - r, my + r]];
    for (const p of P) rod(c, [p[0], p[1], 0], [p[0], p[1], 1.0], 0.05, '#adb5bd');
    for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; for (const z of [0.55, 0.98]) { line3(c, [[a[0], a[1], z], [b[0], b[1], z]], '#f8f9fa', 2.2); line3(c, [[a[0], a[1], z], [b[0], b[1], z]], '#e03131', 2.2, [6, 6]); } }
  });
  if (M.vent) {
    const [bx, by] = GEO.blower;
    push(bx, by, 0.4, c => {
      box(c, { x: bx, y: by, hx: 0.35, hy: 0.3, z0: 0, z1: 0.6, col: [250, 200, 40], edge: true });
      const pts = []; for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push([bx + (mx - bx) * u, by + (my - by) * u, 0.45 * Math.sin(Math.PI * u) + 0.3 * (1 - u) - (u > 0.9 ? (u - 0.9) * 8 : 0)]); }
      line3(c, pts, '#868e96', Math.max(2, 0.22 * pxPerM(bx, by, 0.3)));
      line3(c, pts, 'rgba(255,255,255,.35)', 1, [3, 5]);
    });
  }
  if (M.tripod) push(mx, my, 1.1, c => {
    const apex = [mx, my, 2.3];
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.4; rod(c, apex, [mx + Math.cos(a) * 1.05, my + Math.sin(a) * 1.05, 0], 0.07, '#e8590c'); }
    box(c, { x: mx + 0.3, y: my - 0.3, hx: 0.12, hy: 0.12, z0: 1.1, z1: 1.35, col: [80, 80, 90] });
    const B = W.people.B;
    line3(c, [apex, B.hooked ? [B.x, B.y, (B.z || 0) + 1.3] : [mx, my, 0.4]], '#1971c2', 1.6);
  });
  const D2 = W.people.D;
  if (D2.anim === 'probe') push(mx, my, 0.6, c => {
    const h = project(D2.x + 0.4, D2.y + 0.3, (D2.z || 0) + 1.0), end = project(mx, my, -0.6);
    if (h && end) { c.strokeStyle = '#212529'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(...h); c.quadraticCurveTo((h[0] + end[0]) / 2, Math.max(h[1], end[1]) + 10, end[0], end[1]); c.stroke(); }
  });
}

// ---- 화면 위 글: 말풍선 · 이름표 · 계기 ------------------------------------------------------
function drawOverlay(ctx) {
  const W = sim.w;
  ctx.textBaseline = 'middle';
  for (const [id, p] of Object.entries(W.people)) {
    if (!p._head || p.inCab || p.z < -0.9) continue;
    const [x, y] = p._head, role = ROLES[scenario][id];
    if (p.say) bubble(ctx, x, y, t(p.say), role.col);
    else if (showLabels) {
      ctx.font = '600 11px system-ui, sans-serif'; const tx = t(role), w = ctx.measureText(tx).width + 10;
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.strokeStyle = role.col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - 18, w, 16, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1d1f24'; ctx.textAlign = 'center'; ctx.fillText(tx, x, y - 10);
    }
    p._head = null;
  }
  if (showLabels) {
    const tag = (x, y, z, text, col) => { const s = project(x, y, z); if (!s) return; ctx.font = '600 11px system-ui, sans-serif'; const w = ctx.measureText(text).width + 10; ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(s[0] - w / 2, s[1] - 9, w, 18, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(text, s[0], s[1]); };
    if (scenario === 'tx') {
      tag(TX.cos[0], TX.cos[1] - 0.6, TX.cos[2] + 0.9, W.cos.closed ? t({ ko: 'COS: 투입 (충전)', en: 'Cut-out: closed (live)' }) : t({ ko: 'COS: 개방', en: 'Cut-out: open' }), W.cos.closed ? '#c92a2a' : '#2f9e44');
      tag(8, GEO.phaseY[0], GEO.armZ + 1.2, t({ ko: '본선 고압선: 계속 충전', en: 'Main HV line: stays live' }), '#c92a2a');
      if ((W.load.state === 'hook' || W.txOld.state === 'hook') && W.truck.hookDrop < 0.97) { const h = hookXY(W.truck); tag(h[0], h[1] - GEO.fallR, 0.1, t({ ko: '낙하 반경 출입금지', en: 'Drop zone — keep out' }), '#c92a2a'); }
      if (W.hvCover > 0.5) tag(TX.cos[0] + 1.6, TX.cos[1], TX.cos[2] + 0.4, t({ ko: '방호 커버 (충전부)', en: 'Covers (live parts)' }), '#e8590c');
    }
    if (scene === 'tower') {
      const lf = towerLeg(10, 0.6), wk = towerLeg(TW.workZ, 1.6);
      tag(lf[0] - 1.2, lf[1], lf[2], t({ ko: '추락방지 와이어', en: 'Fall-arrest wire' }) + (W.lifelineOK ? ' ✓' : ''), '#1971c2');
      tag(wk[0] - 1.6, wk[1], wk[2] + 2.6, W.lanyard ? t({ ko: '고리 2개 체결', en: 'Two hooks on' }) : W.arrester ? t({ ko: '추락방지기 체결', en: 'Arrester on' }) : t({ ko: '작업 위치', en: 'Work position' }), W.lanyard || W.arrester ? '#2b8a3e' : '#495057');
      if (W.people.B.z > 2) { const f = towerLeg(0); tag(f[0], f[1] - 3, 0.1, t({ ko: '승탑 중 하부 출입금지', en: 'Keep clear below the climber' }), '#c92a2a'); }
      tag(TW.x + 9, TW.y, TW.armZ[0] - 1, t({ ko: '154kV 송전선: 충전 (가상)', en: '154 kV lines: live (virtual)' }), '#c92a2a');
    }
    if (scenario === 'pole') {
      tag(GEO.swX, GEO.poleY, GEO.poleH + 1, W.sw.closed ? t({ ko: '개폐기: 투입(ON)', en: 'Switch: closed' }) : t({ ko: '개폐기: 개방(OFF)', en: 'Switch: open' }), W.sw.closed ? '#c92a2a' : '#2f9e44');
      tag(GEO.gndX, GEO.poleY, GEO.poleH + 1, t({ ko: '접지 전주 (-35)', en: 'Earthing pole (-35)' }) + (W.ground.line ? ' ✓' : ''), W.ground.line ? '#2b8a3e' : '#495057');
      tag(GEO.workX, GEO.poleY, GEO.poleH + 1, t({ ko: '작업 전주', en: 'Work pole' }), '#495057');
      if (W.load.state === 'hook' && W.truck.hookDrop < 0.97) { const h = hookXY(W.truck); tag(h[0], h[1] - GEO.fallR, 0.1, t({ ko: '낙하 반경 출입금지', en: 'Drop zone — keep out' }), '#c92a2a'); }
      if (W.covers > 0.5) tag(2.4, GEO.neutralY, GEO.neutralZ - 0.6, t({ ko: '방호관 (중성선·인접 상)', en: 'Covers (neutral · adjacent phase)' }), '#e8590c');
    }
  }
  if (scene === 'manhole' && (W.mh.measured || W.people.D.anim === 'probe')) gasPanel(ctx);
  if (showPower && scene !== 'manhole') {
    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
    const items = [['rgba(255,110,50,1)', t({ ko: '충전 (전기 있음)', en: 'Live' })], ['rgba(60,140,255,1)', t({ ko: '정전', en: 'De-energised' })], ['#2b8a3e', t({ ko: '접지', en: 'Earth' })]].slice(0, scene === 'tower' ? 1 : 3);
    let x = 10; const y = C.H - 14;
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.beginPath(); ctx.roundRect(4, y - 11, items.reduce((s, i) => s + ctx.measureText(i[1]).width + 28, 8), 22, 6); ctx.fill();
    for (const [col, txt] of items) { ctx.fillStyle = col; ctx.fillRect(x + 2, y - 2, 14, 4); ctx.fillStyle = '#1d1f24'; ctx.fillText(txt, x + 20, y); x += ctx.measureText(txt).width + 28; }
  }
  if (flash && performance.now() < flash.until) {
    ctx.fillStyle = flash.ok ? 'rgba(47,158,68,.9)' : 'rgba(201,42,42,.92)'; ctx.font = '700 14px system-ui, sans-serif';
    const w = Math.min(C.W - 20, ctx.measureText(flash.text).width + 26); ctx.beginPath(); ctx.roundRect(C.W / 2 - w / 2, 12, w, 30, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(flash.text, C.W / 2, 27, w - 16);
  }
  if (camMode.startsWith('eye')) {
    const who = camMode === 'eyeA' ? 'A' : drawScene.eyeWho, role = ROLES[scenario][who];
    const txt = t({ ko: '현장 시점 · ', en: 'On site · ' }) + t(role) + t({ ko: ' 옆', en: '' }) + (camMode === 'eyeA' && drawScene.eyeWho && drawScene.eyeWho !== 'A' ? t({ ko: ' → ', en: ' → ' }) + t(ROLES[scenario][drawScene.eyeWho]) : '');
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; const w = ctx.measureText(txt).width + 18;
    ctx.fillStyle = 'rgba(20,24,30,.78)'; ctx.beginPath(); ctx.roundRect(10, C.H - 64, w, 22, 6); ctx.fill();
    ctx.fillStyle = role.col; ctx.fillRect(10, C.H - 64, 4, 22); ctx.fillStyle = '#fff'; ctx.fillText(txt, 20, C.H - 53);
  }
  const vn = sim.violations.length;
  if (vn) { ctx.fillStyle = 'rgba(201,42,42,.9)'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'right'; ctx.fillText(`⚠ ${vn}`, C.W - 10, 16); }
}
function bubble(ctx, x, y, text, col) {
  ctx.font = '600 12.5px system-ui, sans-serif';
  const w = Math.min(260, ctx.measureText(text).width + 16), h = 24, bx = clamp(x - w / 2, 4, C.W - w - 4), by = Math.max(4, y - h - 12);
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(bx, by, w, h, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(clamp(x, bx + 10, bx + w - 10) - 6, by + h); ctx.lineTo(x, by + h + 9); ctx.lineTo(clamp(x, bx + 10, bx + w - 10) + 6, by + h); ctx.fill();
  ctx.fillStyle = '#1d1f24'; ctx.textAlign = 'center'; ctx.fillText(text, bx + w / 2, by + h / 2 + 1, w - 10);
}
function gasPanel(ctx) {
  const M = sim.w.mh, g = sim.w.people.D.anim === 'probe' ? M.gas : M.measured, ok = gasOK(g);
  const rows = [['O₂', g.o2.toFixed(1) + ' %', g.o2 >= GAS_LIMIT.o2min && g.o2 < GAS_LIMIT.o2max, `${GAS_LIMIT.o2min}–${GAS_LIMIT.o2max}`],
    ['H₂S', g.h2s.toFixed(0) + ' ppm', g.h2s < GAS_LIMIT.h2s, `< ${GAS_LIMIT.h2s}`], ['CO', g.co.toFixed(0) + ' ppm', g.co < GAS_LIMIT.co, `< ${GAS_LIMIT.co}`]];
  const x = C.W - 178, y = 34, w = 168, h = 22 + rows.length * 20 + 24;
  ctx.fillStyle = 'rgba(20,24,30,.86)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
  ctx.font = '700 12px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd43b'; ctx.fillText(t({ ko: '가스 측정기', en: 'Gas detector' }), x + 10, y + 13);
  rows.forEach(([n, v, good, lim], i) => {
    const yy = y + 33 + i * 20; ctx.fillStyle = '#ced4da'; ctx.font = '12px system-ui'; ctx.fillText(n, x + 10, yy);
    ctx.fillStyle = good ? '#69db7c' : '#ff6b6b'; ctx.font = '700 13px ui-monospace, monospace'; ctx.fillText(v, x + 50, yy);
    ctx.fillStyle = '#868e96'; ctx.font = '10px system-ui'; ctx.fillText(lim, x + 118, yy);
  });
  ctx.fillStyle = ok ? '#2f9e44' : '#c92a2a'; ctx.beginPath(); ctx.roundRect(x + 8, y + h - 24, w - 16, 18, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '700 11.5px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(ok ? t({ ko: '적정 공기', en: 'Safe air' }) : t({ ko: '위험 — 입조 금지', en: 'Danger — no entry' }), x + w / 2, y + h - 15);
}

// ---- 한 프레임 -----------------------------------------------------------------------
function fit(canvas) {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth, ch = Math.round(cw * (cw < 640 ? 0.78 : 0.58));
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); canvas.style.height = ch + 'px'; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w: cw, h: ch };
}

// ---- 현장 눈높이 시점: 사람 옆에 서서 보기 --------------------------------------------------------
// eyeA: 작업책임자(공사담당자) 옆 1.6m 눈높이에서 지금 일하는 작업자를 봄
// eyeW: 지금 일하는 작업자 바로 옆에서 그 사람이 다루는 곳(조작봉 끝·검전 지점 등)을 봄
// 드래그 = 그 자리에서 고개 돌리기, 휠 = 한두 걸음 물러서기, 더블클릭 = 원래대로
const ACTIVE = new Set(['work', 'reach', 'stick', 'bend', 'hammer', 'climb', 'probe', 'dress', 'wave', 'hold']);
const eye = { yaw: 0, pitch: 0, back: 1.4, who: null, since: 0 };
function activeWorker(now) {
  const P = sim.w.people;
  const cands = Object.entries(P).filter(([, p]) => !p.inCab && (p.stick || ACTIVE.has(p.anim)));
  const pick = (cands.find(([, p]) => p.stick) || cands.find(([k]) => k === 'B' && P.B.inBucket) || cands[0] || [])[0];
  if (pick && pick !== eye.who && (now - eye.since > 1800 || !eye.who || !cands.some(([k]) => k === eye.who))) { eye.who = pick; eye.since = now; }
  return eye.who || 'A';
}
function stepFocus() {
  const c = CAMS[camMode === 'auto' || camMode.startsWith('eye') ? (sim.step ? STEP_CAM[sim.step.id] : ({ pole: 'site', manhole: 'mzone', tower: 'tclimb' }[scene])) : camMode] || CAMS.site;
  return [c.tx, c.ty, c.tz];
}
const chest = (p) => [p.x, p.y, (p.z || 0) + 1.2];
function eyeCamera(now) {
  const P = sim.w.people, wk = activeWorker(now);
  const me = camMode === 'eyeA' ? P.A : P[wk];
  let F;
  const along = (p) => { const h = [p.x, p.y, (p.z || 0) + 1.35], q = p.stick.to; return h.map((v, i) => v + (q[i] - v) * 0.55); };   // 손과 막대 끝 사이 → 막대 전체가 보이게
  if (camMode === 'eyeA') F = wk !== 'A' ? (P[wk].stick ? along(P[wk]) : chest(P[wk])) : (P.A.stick ? along(P.A) : stepFocus());
  else if (me.stick) F = along(me);
  else if (scene === 'tower' && me.z > 1) F = [TW.x, TW.y, me.z + 1.4];   // 철탑 위: 철탑 안쪽, 손 높이
  else if (me.inBucket) { const sl = sim.w.truck.boom.slew; F = [me.x + Math.cos(sl) * 2.2, me.y + Math.sin(sl) * 2.2, me.z + 1.7]; }   // 버킷 안: 손이 향하는 쪽
  else F = stepFocus();
  let ux = F[0] - me.x, uy = F[1] - me.y, L = Math.hypot(ux, uy);
  if (L < 0.3) { ux = 0; uy = 1; L = 1; }
  ux /= L; uy /= L;
  // 옆으로 비켜설 방향: 작업차(붐)에서 먼 쪽
  const back = eye.back * (camMode === 'eyeA' ? 1.4 : 1), tr = sim.w.truck;
  let side = me.inBucket ? 1.1 : 0.9;
  if (tr.present && !me.inBucket) {
    const dTo = (sg) => Math.hypot(me.x - ux * back - uy * side * sg - tr.c, me.y - uy * back + ux * side * sg - tr.y);
    if (dTo(-1) > dTo(1)) side = -side;
  }
  const E = [me.x - ux * back + -uy * side, me.y - uy * back + ux * side, (me.z || 0) + 1.62];
  const dx = F[0] - E[0], dy = F[1] - E[1], dz = F[2] - E[2], dist = Math.max(2, Math.hypot(dx, dy, dz));
  const goal = { yaw: Math.atan2(dx, dy) + eye.yaw, pitch: clamp(-Math.asin(dz / dist) + eye.pitch, -1.2, 1.3), dist };
  // 카메라 위치가 E가 되도록 바라보는 점(tx,ty,tz)을 정함
  const cp = Math.cos(goal.pitch), f = [Math.sin(goal.yaw) * cp, Math.cos(goal.yaw) * cp, -Math.sin(goal.pitch)];
  Object.assign(goal, { tx: E[0] + f[0] * dist, ty: E[1] + f[1] * dist, tz: E[2] + f[2] * dist });
  const k = 0.12;
  for (const key of ['tx', 'ty', 'tz', 'dist', 'pitch']) cam[key] += (goal[key] - cam[key]) * k;
  let d = goal.yaw - cam.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; cam.yaw += d * k;
  return wk;
}
function drawScene(now) {
  const cv = $('sfView'), { ctx, w, h } = fit(cv);
  const eyeMode = camMode.startsWith('eye');
  if (eyeMode) { camGoal = null; drawScene.eyeWho = eyeCamera(now); }
  cam.fov = eyeMode ? 1.05 : 0.9;
  if (camGoal) {
    let close = true;
    for (const k of Object.keys(camGoal)) {
      let d = camGoal[k] - cam[k];
      if (k === 'yaw') { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; }
      cam[k] += d * 0.06; if (Math.abs(d) > (k === 'dist' ? 0.05 : 0.002)) close = false;
    }
    if (close) camGoal = null;
  }
  C = makeCamera(w, h);
  drawGround(ctx);
  drawZoneFloor(ctx);
  D = [];
  drawStatic(ctx); drawPoles(ctx, now); drawTxGear(ctx, now); drawTower(ctx, now); drawTruck(ctx, now); drawVan(ctx, now); drawManhole(ctx, now); drawCones(ctx); drawPeople(ctx, now);
  D.sort((a, b) => b.d - a.d);
  for (const it of D) it.f(ctx);
  drawOverlay(ctx);
}

// ---- 진행 · 훈련 ----------------------------------------------------------------------
function frame(now) {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  if (running && !quiz) {
    if (sim.lanes && !sim.stepDone()) {
      acc += dt * SPEEDS[speedIdx]; let n = 0;
      while (acc >= sim.dt && n++ < 4000) { sim.update(); acc -= sim.dt; if (sim.stepDone()) { acc = 0; break; } }
      if (sim.stepDone()) { panel(); hold = 0; }
    } else if (sim.done()) { running = false; finish(); }
    else {
      hold += dt;
      if (mode === 'quiz') askQuiz();
      else if (sim.stepIdx < 0 || hold > 1.2) startNext();
    }
  }
  if (quiz || !running) sim.movePeds(dt);
  drawScene(now);
  requestAnimationFrame(frame);
}
function startNext() {
  if (!sim.begin()) return;
  hold = 0; if (camMode === 'auto') camGoal = { ...CAMS[STEP_CAM[sim.step.id]] };
  panel(); label();
}
function askQuiz() {
  const i = sim.stepIdx + 1; if (i >= sim.steps.length) return;
  quiz = { i, opts: quizOptions(sim, i), tried: new Set(), wrong: 0 };
  panel(); label();
}
function answer(k) {
  const o = quiz.opts[k];
  if (o.correct) {
    if (quiz.wrong === 0) score.first++;
    score.total++;
    flash = { ok: true, text: t({ ko: '정답! ', en: 'Correct! ' }) + t(o.text), until: performance.now() + 2200 };
    quiz = null; running = true; startNext();
  } else {
    quiz.wrong++; quiz.tried.add(k);
    score.mistakes.push({ step: quiz.i, text: o.text, why: o.why });
    flash = { ok: false, text: t({ ko: '위험한 선택입니다', en: 'Unsafe choice' }), until: performance.now() + 1800 };
    quiz.last = o; panel();
  }
}
function finish() { if (mode === 'quiz' && score.total && !score.saved) { score.saved = true; score.when = new Date(); saveHistory(); } panel(); label(); }

// ---- 훈련 기록 (이 브라우저에만 저장) · 인쇄 ------------------------------------------------
const HKEY = 'sf-history';
function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } }
function saveHistory(name = '') {
  const h = loadHistory(), n = sim.steps.length - (score.from || 0);
  const rec = { when: score.when.toISOString(), scenario, from: score.from || 0, first: score.first, n, wrong: score.mistakes.length, name };
  const i = h.findIndex(x => x.when === rec.when);
  if (i >= 0) h[i] = rec; else h.unshift(rec);
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 30))); } catch (e) { /* 저장 불가 (사생활 보호 모드 등) */ }
}
const fmtTime = (d) => new Date(d).toLocaleString(currentLangTag(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const currentLangTag = () => (window.currentLang && window.currentLang() === 'en' ? 'en-GB' : 'ko-KR');
function historyHtml() {
  const h = loadHistory().slice(0, 5); if (!h.length) return '';
  return `<details class="sf-hist"><summary>${t({ ko: '이 브라우저의 최근 훈련 기록', en: 'Recent training in this browser' })} (${h.length})</summary><ul>${h.map(r =>
    `<li>${fmtTime(r.when)} · ${esc(t(SCENARIOS[r.scenario]?.title || { ko: r.scenario, en: r.scenario }))}${r.from ? ` · ${r.from + 1}${t({ ko: '단계부터', en: '+ ' })}` : ''}${r.name ? ` · ${esc(r.name)}` : ''} — <b>${r.first}/${r.n}</b></li>`).join('')}</ul>
    <button type="button" class="lab-try" id="sfClear">${t({ ko: '기록 지우기', en: 'Clear history' })}</button></details>`;
}
function printRecord() {
  const name = ($('sfName')?.value || '').trim(), steps = sim.steps, from = score.from || 0, n = steps.length - from;
  if (score.saved) saveHistory(name);
  const wrongBy = new Map(); for (const m of score.mistakes) { if (!wrongBy.has(m.step)) wrongBy.set(m.step, []); wrongBy.get(m.step).push(m); }
  const rows = steps.map((st, i) => i < from ? '' : `<tr><td>${i + 1}</td><td>${esc(t(st.title))}</td><td>${st.rules.join(', ')}</td><td>${wrongBy.has(i) ? `✗ ${wrongBy.get(i).length}${t({ ko: '번 틀림', en: ' wrong' })}` : '✓'}</td></tr>`).join('');
  $('sfPrintArea').innerHTML = `<h1>${t({ ko: '배전공사 안전 훈련 결과', en: 'Distribution work safety — training record' })}</h1>
    <table class="pr-meta"><tr><th>${t({ ko: '이름', en: 'Name' })}</th><td>${esc(name) || '&nbsp;'}</td><th>${t({ ko: '일시', en: 'Date' })}</th><td>${fmtTime(score.when || new Date())}</td></tr>
    <tr><th>${t({ ko: '현장', en: 'Scenario' })}</th><td colspan="3">${esc(t(SCENARIOS[scenario].title))}${from ? ` (${from + 1}${t({ ko: '단계부터', en: ': started at step ' + (from + 1) })})` : ''}</td></tr>
    <tr><th>${t({ ko: '첫 시도 정답', en: 'Right first time' })}</th><td colspan="3"><b>${score.first} / ${n}</b> (${Math.round(100 * score.first / n)}%)</td></tr></table>
    <h2>${t({ ko: '단계별 결과', en: 'Steps' })}</h2><table><tr><th>#</th><th>${t({ ko: '안전조치', en: 'Safety action' })}</th><th>${t({ ko: '수칙', en: 'Rule' })}</th><th>${t({ ko: '결과', en: 'Result' })}</th></tr>${rows}</table>
    ${score.mistakes.length ? `<h2>${t({ ko: '틀린 선택과 이유', en: 'Wrong choices and why' })}</h2><ol>${score.mistakes.map(m => `<li><b>${m.step + 1}. ${esc(t(m.text))}</b><br>${esc(t(m.why))}</li>`).join('')}</ol>` : ''}
    <p class="pr-foot">${t({ ko: 'Ontology Space 배전공사 안전 훈련 시뮬레이션 · 교육용 가상 현장이며 공식 교육 이수 기록이 아닙니다.', en: 'Ontology Space distribution work safety simulation · a virtual training site; not an official training certificate.' })}</p>`;
  window.print();
}
function restart(i = 0) {
  scene = SCENARIOS[scenario].scene;
  sim = i > 0 ? SafetySim.jumpTo({ scenario }, i) : new SafetySim({ scenario });
  quiz = null; hold = 0; acc = 0;
  if (i === 0 || mode === 'quiz') score = { first: 0, total: 0, mistakes: [], from: mode === 'quiz' ? i : 0, saved: false };
  if (i > 0 && mode === 'quiz') { running = true; if (camMode === 'auto') camGoal = { ...CAMS[STEP_CAM[sim.steps[i].id]] }; }   // 강사용: i단계부터 문제 시작 (앞 단계는 자동 진행)
  else if (i > 0) { sim.begin(i); running = true; if (camMode === 'auto') camGoal = { ...CAMS[STEP_CAM[sim.step.id]] }; }
  else { running = mode === 'quiz'; camGoal = { ...CAMS[{ pole: 'board', manhole: 'mboard', tower: 'tboard' }[scene]] }; }
  panel(); label();
}

// ---- 오른쪽 패널 -----------------------------------------------------------------------
const ruleChips = (rules) => rules.map(n => `<span class="sf-rule" title="${esc(t(RULES[n]))}">${t({ ko: '수칙', en: 'Rule' })} ${n}</span>`).join('');
function panel() {
  const el = $('sfPanel'), steps = sim.steps, cur = sim.stepIdx, doneCur = sim.stepDone();
  const list = steps.map((s, i) => {
    const st = i < cur || (i === cur && doneCur) ? 'done' : i === cur ? 'now' : 'todo';
    const hidden = mode === 'quiz' && st === 'todo';
    return `<li class="sf-${st}" data-i="${i}"><span class="sf-n">${st === 'done' ? '✓' : i + 1}</span><span class="sf-t">${hidden ? '<span class="sf-hidden">' + t({ ko: '? ? ?', en: '? ? ?' }) + '</span>' : esc(t(s.title))}</span>${hidden ? '' : ruleChips(s.rules)}</li>`;
  }).join('');
  let card = '';
  if (quiz) {
    const q = quiz, last = q.last;
    card = `<div class="sf-card sf-quiz"><div class="sf-eyebrow">${t({ ko: '훈련', en: 'Training' })} · ${q.i + 1} / ${steps.length}</div>
      <h4>${q.i === 0 ? t({ ko: '작업을 시작합니다. 가장 먼저 할 일은?', en: 'The job is starting. What comes first?' }) : t({ ko: '다음으로 해야 할 안전조치는?', en: 'Which safety step comes next?' })}</h4>
      <div class="sf-opts">${q.opts.map((o, k) => `<button type="button" data-k="${k}" ${q.tried.has(k) ? 'disabled class="sf-bad"' : ''}>${esc(t(o.text))}</button>`).join('')}</div>
      ${last ? `<p class="sf-why"><b>⚠ ${t({ ko: '왜 위험한가요?', en: 'Why is it unsafe?' })}</b> ${esc(t(last.why))}</p>` : ''}</div>`;
  } else if (sim.done()) {
    const n = steps.length - (score.from || 0), rate = score.total ? Math.round(100 * score.first / n) : null;
    card = `<div class="sf-card sf-end"><div class="sf-eyebrow">${t({ ko: '작업 완료', en: 'Job complete' })}</div>
      <h4>${t({ ko: '모든 안전조치를 마쳤습니다', en: 'All safety steps completed' })}</h4>
      ${rate !== null ? `<p>${t({ ko: '첫 시도에 맞힌 단계', en: 'Right on the first try' })}: <b>${score.first} / ${n}</b> (${rate}%)</p>` : ''}
      ${score.mistakes.length ? `<details open><summary>${t({ ko: '틀린 선택 다시 보기', en: 'Review wrong choices' })} (${score.mistakes.length})</summary><ul>${score.mistakes.map(m => `<li><b>${m.step + 1}. ${esc(t(m.text))}</b><br><span class="meta">${esc(t(m.why))}</span></li>`).join('')}</ul></details>` : ''}
      <p class="meta">${t({ ko: '안전 규칙 위반', en: 'Safety-rule violations' })}: <b>${sim.violations.length}</b></p>
      ${rate !== null ? `<div class="sf-record"><label>${t({ ko: '이름 (선택)', en: 'Name (optional)' })} <input id="sfName" type="text" maxlength="40" autocomplete="name"></label>
        <button type="button" id="sfPrint">🖨 ${t({ ko: '결과 인쇄 · PDF 저장', en: 'Print · save as PDF' })}</button></div>` : ''}
      <button type="button" class="primary" id="sfAgain">${t({ ko: '처음부터 다시', en: 'Start again' })}</button>${historyHtml()}</div>`;
  } else if (cur < 0) {
    card = `<div class="sf-card"><div class="sf-eyebrow">${t(SCENARIOS[scenario].title)}</div>
      <h4>${mode === 'quiz' ? t({ ko: '순서 맞히기 훈련', en: 'Sequence training' }) : t({ ko: '▶ 시작을 누르세요', en: 'Press ▶ Start' })}</h4>
      <p>${mode === 'quiz' ? t({ ko: '단계마다 보기 3개 중 올바른 안전조치를 고르면 현장이 진행됩니다. 틀리면 왜 위험한지 알려 줍니다.', en: 'At each step pick the right safety action out of three; the site then carries on. A wrong pick explains why it is unsafe.' })
        : t({ ko: '작업자 5명이 안전조치를 순서대로 진행합니다. 왼쪽 목록을 누르면 그 단계로 바로 갈 수 있습니다.', en: 'Five workers carry out the safety steps in order. Click a step in the list to jump to it.' })}</p>${historyHtml()}</div>`;
  } else {
    const s = sim.step;
    card = `<div class="sf-card"><div class="sf-eyebrow">${t({ ko: '단계', en: 'Step' })} ${cur + 1} / ${steps.length} ${doneCur ? '· ✓' : ''}</div>
      <h4>${esc(t(s.title))}</h4><div class="sf-chips">${s.rules.map(n => `<span class="sf-rule big">${t({ ko: '수칙', en: 'Rule' })} ${n} · ${esc(t(RULES[n]))}</span>`).join('')}</div>
      <p><b>${t({ ko: '무엇을', en: 'What' })}</b> ${esc(t(s.what))}</p><p><b>${t({ ko: '왜', en: 'Why' })}</b> ${esc(t(s.why))}</p></div>`;
  }
  const roles = Object.entries(ROLES[scenario]).map(([k, r]) => `<span><i style="background:${r.col}"></i>${esc(t(r))}</span>`).join('');
  el.innerHTML = `${card}<ol class="sf-steps ${mode === 'quiz' ? 'quiz' : ''}">${list}</ol><p class="meta sf-roles">${roles}</p>`;
}
function label() {
  scene = SCENARIOS[scenario].scene;
  $('playBtn').innerHTML = running && !quiz ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 시작', en: '▶ Start' });
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Speed ' }) + SPEEDS[speedIdx] + '×';
  $('labelsBtn').textContent = showLabels ? t({ ko: '이름표 숨기기', en: 'Hide labels' }) : t({ ko: '이름표 보기', en: 'Show labels' });
  $('powerBtn').textContent = showPower ? t({ ko: '전기 흐름 숨기기', en: 'Hide power flow' }) : t({ ko: '전기 흐름 보기', en: 'Show power flow' });
  $('powerBtn').hidden = scene === 'manhole';
  const opts = (id, list, v0) => { const el = $(id), v = v0 ?? (el.value || list[0][0]); el.innerHTML = list.map(([k, o]) => `<option value="${k}">${t(o)}</option>`).join(''); el.value = list.some(l => l[0] === v) ? v : list[0][0]; };
  opts('scnSel', Object.entries(SCENARIOS).map(([k, s]) => [k, s.title]), scenario);
  opts('modeSel', [['watch', { ko: '보기: 자동 진행', en: 'Watch: auto play' }], ['quiz', { ko: '훈련: 다음 조치 고르기', en: 'Train: pick the next step' }]], mode);
  opts('camSel', CAM_LIST[scenario], camMode);
  if (sim) opts('fromSel', sim.steps.map((st, i) => [String(i), i ? { ko: `${i + 1}단계부터: ${st.title.ko}`, en: `From step ${i + 1}: ${st.title.en}` } : { ko: '처음부터 훈련', en: 'Train from the start' }]), String(score.from || 0));
  $('fromSel').hidden = mode !== 'quiz';
}

// ---- 조작 ---------------------------------------------------------------------------
function bindCamera() {
  const cv = $('sfView'), pts = new Map();
  let pinch = 0;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); camGoal = null; });
  cv.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const d1 = Math.hypot(a.x - b.x, a.y - b.y); if (pinch && d0) cam.dist = clamp(cam.dist * d0 / d1, 5, 160); pinch = 1; return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (p.b === 2 || p.sh) {
      const k = cam.dist / C.F, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      cam.tx -= (dx * cy + dy * sy * 1.6) * k; cam.ty -= (-dx * sy + dy * cy * 1.6) * k;
    } else if (camMode.startsWith('eye')) { eye.yaw -= dx * 0.005; eye.pitch = clamp(eye.pitch + dy * 0.004, -0.9, 0.9); }
    else { cam.yaw -= dx * 0.005; cam.pitch = clamp(cam.pitch + dy * 0.004, 0.04, 1.35); }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); camGoal = null; if (camMode.startsWith('eye')) { eye.back = clamp(eye.back * Math.exp(e.deltaY * 0.001), 0.6, 8); return; } cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 5, 160); }, { passive: false });
  cv.addEventListener('dblclick', () => { if (camMode.startsWith('eye')) { Object.assign(eye, { yaw: 0, pitch: 0, back: 1.4 }); return; } camGoal = { ...CAMS[camMode === 'auto' ? (sim.step ? STEP_CAM[sim.step.id] : 'site') : camMode] }; });
}
function bind() {
  $('playBtn').addEventListener('click', () => {
    if (quiz) return;
    if (sim.done()) { restart(); running = true; label(); return; }
    running = !running; label();
  });
  $('nextBtn').addEventListener('click', () => {
    if (quiz) return;
    if (sim.lanes && !sim.stepDone()) { let n = 0; while (!sim.stepDone() && n++ < 40000) sim.update(); panel(); }
    else if (mode === 'watch') { running = true; startNext(); }
    else { running = true; }
    label();
  });
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; label(); });
  $('resetBtn').addEventListener('click', () => restart());
  $('labelsBtn').addEventListener('click', () => { showLabels = !showLabels; label(); });
  $('powerBtn').addEventListener('click', () => { showPower = !showPower; label(); });
  $('scnSel').addEventListener('change', () => { scenario = $('scnSel').value; camMode = 'auto'; restart(); });
  $('modeSel').addEventListener('change', () => { mode = $('modeSel').value; restart(); });
  $('fromSel').addEventListener('change', () => restart(+$('fromSel').value));
  $('camSel').addEventListener('change', () => {
    camMode = $('camSel').value;
    Object.assign(eye, { yaw: 0, pitch: 0, back: 1.4, who: null });
    if (camMode.startsWith('eye')) { camGoal = null; return; }
    camGoal = { ...CAMS[camMode === 'auto' ? (sim.step ? STEP_CAM[sim.step.id] : ({ pole: 'site', manhole: 'mzone', tower: 'tclimb' }[scene])) : camMode] };
  });
  $('sfPanel').addEventListener('click', e => {
    const b = e.target.closest('button[data-k]'); if (b && quiz) { answer(+b.dataset.k); return; }
    if (e.target.closest('#sfAgain')) { restart(mode === 'quiz' ? (score.from || 0) : 0); return; }
    if (e.target.closest('#sfPrint')) { printRecord(); return; }
    if (e.target.closest('#sfClear')) { try { localStorage.removeItem(HKEY); } catch (err) { /* 무시 */ } panel(); return; }
    const li = e.target.closest('li[data-i]'); if (li && mode === 'watch') restart(+li.dataset.i);
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]'); if (!a) return;
    e.preventDefault();
    const [sc, i] = a.dataset.goto.split(':');
    scenario = sc; mode = 'watch'; camMode = 'auto'; label(); restart(+i);
    $('sim').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  bindCamera();
  document.addEventListener('langchange', () => { label(); panel(); });
}
function main() {
  const q = new URLSearchParams(location.search);
  if (SCENARIOS[q.get('s')]) scenario = q.get('s');
  label(); bind(); restart(); requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
