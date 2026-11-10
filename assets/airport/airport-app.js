// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 공항 이착륙 페이지: 2D 캔버스 위의 원근(pseudo-3D) 공항, 도착·출발 안내판, 지표·그래프
//
// 입체감을 내는 방법
//  - 원근 투영: 지면을 비스듬히 내려다보는 카메라. 멀수록 작고 좁게
//  - 고도 = 그림자와의 거리: 항공기 아래 땅에 그림자를 그리고, 높을수록 그림자가 멀어지고 옅어짐
//  - 먼 것부터 그리기, 거리에 따라 대기색으로 흐려짐, 시간에 따라 낮·노을·밤 조명
import { Airport, GEO, CATS, AIRLINES, PROFILE } from './airport.js?v=cda93957';

const $ = (id) => document.getElementById(id);
const t = (o) => (window.t ? window.t(o) : o.ko);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const rgb = (c, al = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const AL = Object.fromEntries(AIRLINES.map(a => [a.code, a]));
const RWY_COL = ['#2a78d6', '#d95926'];                     // 활주로별 색 (그래프)

const SPEEDS = [1, 5, 15, 30, 60, 120, 'max'];
let sim, running = false, speedIdx = 3, acc = 0, lastT = 0;
let prevView = new Map(), curView = [];
let selected = null, showLabels = true;

// ---- 카메라 ------------------------------------------------------------------------
const cam = { tx: 0, ty: 0, tz: 0, yaw: 0.42, pitch: 0.33, dist: 2500, fov: 0.85 };
const PRESETS = {
  all: () => ({ tx: 0, ty: 0, tz: 0, yaw: 0.42, pitch: 0.33, dist: 2500 }),
  north: () => ({ tx: 0, ty: 430, tz: 0, yaw: 0.12, pitch: 0.3, dist: 1700 }),
  south: () => ({ tx: 0, ty: -430, tz: 0, yaw: Math.PI - 0.12, pitch: 0.3, dist: 1700 }),
  terminal: () => ({ tx: 0, ty: 0, tz: 0, yaw: 0.65, pitch: 0.42, dist: 1000 }),
  approach: () => ({ tx: sim.sx * (GEO.thrX - 700), ty: GEO.rwyY, tz: 40, yaw: sim.sx > 0 ? Math.PI / 2 - 0.34 : -Math.PI / 2 - 0.34, pitch: 0.1, dist: 2000 })   // 최종 접근 경로 옆 뒤에서 활주로 쪽으로
};
let camGoal = null;                                          // 시점 바꿀 때 부드럽게 이동
let C;                                                       // 이번 프레임의 카메라

function makeCamera(W, H) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const f = [sy * cp, cy * cp, -sp], r = [cy, -sy, 0], u = [sy * sp, cy * sp, cp];
  const pos = [cam.tx - f[0] * cam.dist, cam.ty - f[1] * cam.dist, cam.tz - f[2] * cam.dist];
  return { f, r, u, pos, W, H, F: H / (2 * Math.tan(cam.fov / 2)) };
}
const NEAR = 8;
function toCam(x, y, z) {
  const dx = x - C.pos[0], dy = y - C.pos[1], dz = z - C.pos[2];
  return [dx * C.r[0] + dy * C.r[1], dx * C.u[0] + dy * C.u[1] + dz * C.u[2], dx * C.f[0] + dy * C.f[1] + dz * C.f[2]];
}
const scr = (c) => [C.W / 2 + C.F * c[0] / c[2], C.H / 2 - C.F * c[1] / c[2]];
function project(x, y, z) { const c = toCam(x, y, z); return c[2] < NEAR ? null : scr(c); }
// 다각형: 카메라 앞쪽(near 평면)으로 잘라서 화면 좌표로
function projPoly(pts) {
  const cs = pts.map(p => toCam(p[0], p[1], p[2] || 0)), out = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = cs[(i + 1) % cs.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) { const k = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]); }
  }
  return out.length >= 3 ? { s: out.map(scr), depth: out.reduce((m, c) => m + c[2], 0) / out.length } : null;
}
function fillPoly(ctx, pts, color, stroke) {
  const P = projPoly(pts); if (!P) return null;
  ctx.beginPath(); ctx.moveTo(P.s[0][0], P.s[0][1]); for (let i = 1; i < P.s.length; i++) ctx.lineTo(P.s[i][0], P.s[i][1]); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  return P;
}

// ---- 조명 (시각에 따라) ----------------------------------------------------------------
function lighting(time) {
  const h = (time / 3600) % 24;
  const day = smooth(5.6, 7.2, h) * (1 - smooth(18.6, 20.2, h));
  const dusk = Math.max(smooth(5.6, 6.6, h) * (1 - smooth(6.6, 7.8, h)), smooth(18.2, 19.3, h) * (1 - smooth(19.3, 20.4, h)));
  const n = (dayC, nightC) => mix(nightC, dayC, day);
  return {
    day, dusk, night: day < 0.45,
    skyTop: mix(n([96, 150, 210], [8, 13, 30]), [70, 80, 140], dusk * 0.5),
    skyLow: mix(n([200, 222, 240], [26, 36, 60]), [244, 168, 112], dusk * 0.8),
    grass: n([126, 160, 104], [20, 30, 25]),
    apron: n([196, 196, 190], [46, 48, 54]),
    asphalt: n([74, 78, 84], [26, 28, 32]),
    taxi: n([112, 115, 120], [34, 36, 40]),
    mark: n([240, 240, 236], [120, 122, 126]),
    yellow: n([236, 190, 40], [130, 105, 30]),
    body: n([238, 240, 244], [86, 90, 98]),
    wing: n([200, 206, 214], [62, 66, 74]),
    roof: n([172, 176, 182], [40, 42, 48]),
    wall: n([128, 156, 184], [36, 44, 58]),
    fog: mix(n([200, 222, 240], [26, 36, 60]), [244, 168, 112], dusk * 0.6)
  };
}
let LT;
const fogged = (c, depth) => mix(c, LT.fog, clamp((depth - 2500) / 16000, 0, 0.7));

// ---- 세계 좌표 도우미 ---------------------------------------------------------------
const W = (r, x, y) => { const w = sim.toWorld(r, x, y); return [w.x, w.y]; };
function rectW(r, x0, x1, y0, y1, z = 0) { return [W(r, x0, y0), W(r, x1, y0), W(r, x1, y1), W(r, x0, y1)].map(p => [p[0], p[1], z]); }
// 굵은 선(유도로) → 사각형들
function band(ctx, r, pts, w, color) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L * w / 2, ny = (bx - ax) / L * w / 2;
    const ext = w / 2, ux = (bx - ax) / L * ext, uy = (by - ay) / L * ext;
    fillPoly(ctx, [[ax - ux + nx, ay - uy + ny], [bx + ux + nx, by + uy + ny], [bx + ux - nx, by + uy - ny], [ax - ux - nx, ay - uy - ny]].map(p => [...W(r, p[0], p[1]), 0]), color);
  }
}
function line3(ctx, pts, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  let on = false;
  for (const p of pts) { const s = project(p[0], p[1], p[2] || 0); if (!s) { on = false; continue; } on ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); on = true; }
  ctx.stroke();
}
// 땅 위에 글자 쓰기 (세 점으로 기울어진 평면에 맞춤)
function groundText(ctx, text, x, y, ang, size, color) {
  const o = project(x, y, 0), a = project(x + Math.cos(ang) * size, y + Math.sin(ang) * size, 0), b = project(x - Math.sin(ang) * size, y + Math.cos(ang) * size, 0);
  if (!o || !a || !b) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(devicePixelRatio || 1, devicePixelRatio || 1);
  ctx.transform((a[0] - o[0]) / size, (a[1] - o[1]) / size, -(b[0] - o[0]) / size, -(b[1] - o[1]) / size, o[0], o[1]);
  ctx.fillStyle = color; ctx.font = `700 ${size}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0); ctx.restore();
}

// ---- 정적 장면 -----------------------------------------------------------------------
const TWY = 23;
function taxiPaths(r) {
  const out = [[[GEO.holdX, GEO.twyY], [GEO.laneEntryX, GEO.twyY]], [[GEO.laneEntryX, GEO.twyY], [GEO.laneEntryX, GEO.laneY]], [[GEO.laneExitX, GEO.laneY], [GEO.laneExitX, GEO.twyY]],
    [[GEO.laneExitX - 20, GEO.laneY], [GEO.laneEntryX, GEO.laneY]], [[GEO.holdX, GEO.twyY], [GEO.holdX, GEO.rwyY - 40], [GEO.thrX + 10, GEO.rwyY]]];
  for (const e of GEO.exits) out.push([[e - 40, GEO.rwyY], [e + GEO.exitDX, GEO.twyY]]);
  void r; return out;
}
function drawGround(ctx) {
  const { W: w, H: h } = C;
  // 하늘과 땅: 지평선 위치를 구해 그라데이션으로
  const fh = [Math.sin(cam.yaw), Math.cos(cam.yaw)];
  const far = project(C.pos[0] + fh[0] * 1e6, C.pos[1] + fh[1] * 1e6, 0);
  const hy = far ? clamp(far[1], -h, h * 2) : -h;
  let g = ctx.createLinearGradient(0, 0, 0, Math.max(1, hy));
  g.addColorStop(0, rgb(LT.skyTop)); g.addColorStop(1, rgb(LT.skyLow));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  g = ctx.createLinearGradient(0, hy, 0, h);
  g.addColorStop(0, rgb(LT.fog)); g.addColorStop(Math.min(1, 0.25), rgb(mix(LT.grass, LT.fog, 0.45))); g.addColorStop(1, rgb(LT.grass));
  ctx.fillStyle = g; ctx.fillRect(0, Math.max(0, hy), w, h - Math.max(0, hy));
  if (LT.night && far) { ctx.fillStyle = 'rgba(255,190,110,.10)'; ctx.fillRect(0, hy - 2, w, 6); }   // 먼 도시 불빛

  for (const r of [0, 1]) {
    // 계류장
    fillPoly(ctx, rectW(r, -900, 900, GEO.term.y, GEO.laneY + 45), rgb(LT.apron));
    // 유도로
    for (const p of taxiPaths(r)) band(ctx, r, p, TWY, rgb(LT.taxi));
    // 활주로
    fillPoly(ctx, rectW(r, GEO.thrX - 60, GEO.rwyHalf + 60, GEO.rwyY - GEO.rwyW / 2, GEO.rwyY + GEO.rwyW / 2), rgb(LT.asphalt));
  }
  // 터미널 앞 도로·주차장 (가운데) 생략: 터미널 건물이 덮음
}
function drawMarkings(ctx) {
  const mk = rgb(LT.mark), ye = rgb(LT.yellow);
  for (const r of [0, 1]) {
    const Y = GEO.rwyY;
    // 시단 줄무늬 (양쪽 끝)
    for (const [x0, dir] of [[GEO.thrX + 6, 1], [GEO.rwyHalf - 6, -1]]) {
      for (let k = -7; k <= 7; k++) { if (k === 0) continue; const y = Y + k * 2.6; fillPoly(ctx, rectW(r, x0, x0 + dir * 30, y - 0.8, y + 0.8), mk); }
      // 착지 구역 표시
      for (const d of [150, 300, 450]) for (const s of [-1, 1]) {
        const big = d === 300, x = x0 + dir * d, yy = Y + s * (big ? 9 : 7.5);
        fillPoly(ctx, rectW(r, x, x + dir * (big ? 45 : 22), yy - (big ? 3 : 1), yy + (big ? 3 : 1)), mk);
      }
    }
    // 중앙선 점선
    for (let x = GEO.thrX + 100; x < GEO.rwyHalf - 100; x += 50) fillPoly(ctx, rectW(r, x, x + 30, Y - 0.5, Y + 0.5), mk);
    // 활주로 이름 (착륙 방향에서 읽히게)
    const name = sim.rwyName(r), other = { '09L': '27R', '09R': '27L', '27R': '09L', '27L': '09R' }[name];
    const a = W(r, GEO.thrX + 70, Y), b = W(r, GEO.rwyHalf - 70, Y), head = Math.atan2(b[1] - a[1], b[0] - a[0]);
    groundText(ctx, name, a[0], a[1], head - Math.PI / 2, 14, mk);
    groundText(ctx, other, b[0], b[1], head + Math.PI / 2, 14, mk);
    // 유도로 중앙선 (노란색)
    for (const p of taxiPaths(r)) line3(ctx, p.map(q => W(r, q[0], q[1])), ye, Math.max(0.6, 900 / cam.dist));
    // 이륙 대기선
    line3(ctx, [W(r, GEO.holdX - 14, GEO.rwyY - 90), W(r, GEO.holdX + 14, GEO.rwyY - 90)], ye, Math.max(1, 1600 / cam.dist));
    // 게이트 정지선
    for (let i = 0; i < GEO.gates; i++) { const x = GEO.gateX0 + GEO.gateDX * i; line3(ctx, [W(r, x, GEO.gateY + 40), W(r, x, GEO.laneY)], ye, Math.max(0.5, 600 / cam.dist)); }
  }
}
// 불빛: 활주로 가장자리, 접근등 (밤에 밝게)
function drawLights(ctx, now) {
  const k = 1 - LT.day;
  if (k < 0.15) return;
  const dot = (x, y, z, col, sz) => { const s = project(x, y, z); if (!s) return; const d = toCam(x, y, z)[2], rr = Math.max(0.8, sz * C.F / d); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s[0], s[1], rr, 0, 7); ctx.fill(); };
  for (const r of [0, 1]) {
    for (let x = GEO.thrX; x <= GEO.rwyHalf; x += 60) for (const s of [-1, 1]) { const p = W(r, x, GEO.rwyY + s * (GEO.rwyW / 2 + 1)); dot(p[0], p[1], 0.5, `rgba(255,236,190,${0.9 * k})`, 1.2); }
    for (const x of [GEO.thrX - 1, GEO.rwyHalf + 1]) for (let s = -9; s <= 9; s++) { const p = W(r, x, GEO.rwyY + s * 2.4); dot(p[0], p[1], 0.5, x < 0 ? `rgba(80,230,120,${k})` : `rgba(255,70,60,${k})`, 1.1); }
    // 접근등: 시단 앞 900m, 연속 섬광
    const seq = Math.floor(now / 70) % 30;
    for (let i = 1; i <= 30; i++) {
      const p = W(r, GEO.thrX - i * 30, GEO.rwyY), on = i === 30 - seq;
      dot(p[0], p[1], 1, on ? `rgba(255,255,255,${k})` : `rgba(255,244,214,${0.65 * k})`, on ? 4 : 1.6);
    }
    for (let x = GEO.holdX; x <= GEO.laneEntryX; x += 60) { const p = W(r, x, GEO.twyY); dot(p[0], p[1], 0.3, `rgba(80,200,255,${0.55 * k})`, 0.9); }
  }
}

// ---- 3D 물체: 터미널·관제탑·탑승교·항공기 ---------------------------------------------------
function box(x0, x1, y0, y1, z0, z1, top, side, side2, windows, ends = [true, true]) {
  return { depth: toCam((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)[2], draw(ctx) {
    const faces = [
      { n: [0, -1], pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], col: side },
      { n: [0, 1], pts: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], col: side },
      ends[0] && { n: [-1, 0], pts: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], col: side2 },
      ends[1] && { n: [1, 0], pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], col: side2 }
    ].filter(Boolean);
    for (const f of faces) {
      const cx = f.pts.reduce((s, p) => s + p[0], 0) / 4, cy = f.pts.reduce((s, p) => s + p[1], 0) / 4;
      if ((C.pos[0] - cx) * f.n[0] + (C.pos[1] - cy) * f.n[1] <= 0) continue;
      const P = fillPoly(ctx, f.pts, rgb(fogged(f.col, toCam(cx, cy, z0)[2])));
      if (P && windows && z1 - z0 > 10 && f.n[0] === 0) {                                       // 유리창 띠
        const wc = LT.night ? 'rgba(255,214,140,.75)' : 'rgba(255,255,255,.28)';
        for (const zz of [z0 + (z1 - z0) * 0.35, z0 + (z1 - z0) * 0.7]) line3(ctx, [[f.pts[0][0], f.pts[0][1], zz], [f.pts[1][0], f.pts[1][1], zz]], wc, Math.max(1, C.F * 2.2 / toCam(cx, cy, zz)[2]));
      }
    }
    fillPoly(ctx, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], rgb(fogged(top, this.depth)));
  } };
}
function staticObjects() {
  const T = GEO.term, objs = [];
  // 터미널: 가운데 본관 + 양쪽 탑승동 (긴 상자를 몇 조각으로 나눠 앞뒤 순서를 자연스럽게)
  for (let i = 0; i < 6; i++) {
    const x0 = -T.x + i * (2 * T.x / 6), x1 = x0 + 2 * T.x / 6;
    objs.push(box(x0, x1, -T.y, T.y, 0, T.h, LT.roof, LT.wall, mix(LT.wall, [0, 0, 0], 0.15), true, [i === 0, i === 5]));
  }
  objs.push(box(-160, 160, -T.y - 10, T.y + 10, T.h, T.h + 10, mix(LT.roof, [255, 255, 255], 0.1), LT.wall, LT.wall, false));
  // 관제탑
  objs.push(box(1000, 1012, -6, 6, 0, 62, LT.roof, mix(LT.wall, [255, 255, 255], 0.2), LT.wall, false));
  objs.push(box(992, 1020, -14, 14, 62, 74, LT.roof, LT.night ? [230, 200, 140] : [70, 120, 150], LT.night ? [200, 170, 120] : [60, 105, 135], false));
  // 탑승교
  for (const r of [0, 1]) for (let i = 0; i < GEO.gates; i++) {
    const x = GEO.gateX0 + GEO.gateDX * i, a = W(r, x + 14, T.y), b = W(r, x + 20, T.y + 34);
    objs.push(box(Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), 3, 7, LT.roof, LT.wing, LT.wing, false));
  }
  return objs;
}

// 항공기: 기체 좌표(앞 +x, 왼쪽 +y, 위 +z) → 세계 좌표
function planeXf(a) {
  const ch = Math.cos(a.hd), sh = Math.sin(a.hd), cp = Math.cos(a.pitch), sp = Math.sin(a.pitch), cr = Math.cos(a.bank), sr = Math.sin(a.bank);
  const gear = a.z < 1 ? CATS[a.cat].len * 0.06 : 0;
  return (lx, ly, lz) => {
    const y1 = ly * cr + lz * sr, z1 = -ly * sr + lz * cr;
    const x2 = lx * cp - z1 * sp, z2 = lx * sp + z1 * cp;
    return [a.x + x2 * ch - y1 * sh, a.y + x2 * sh + y1 * ch, a.z + gear + z2];
  };
}
function planeParts(a) {
  const L = CATS[a.cat].len, B = CATS[a.cat].span, X = planeXf(a);
  const wing = (s) => [[0.1 * L, s * 0.05 * L, 0.03 * L], [-0.13 * L, s * B / 2, 0.05 * L], [-0.21 * L, s * B / 2, 0.05 * L], [-0.15 * L, s * 0.05 * L, 0.03 * L]].map(p => X(...p));
  const stab = (s) => [[-0.36 * L, s * 0.04 * L, 0.1 * L], [-0.46 * L, s * 0.17 * B, 0.11 * L], [-0.5 * L, s * 0.17 * B, 0.11 * L], [-0.47 * L, s * 0.04 * L, 0.1 * L]].map(p => X(...p));
  return {
    L, B, X,
    nose: X(0.5 * L, 0, 0.06 * L), tail: X(-0.5 * L, 0, 0.1 * L), d: 0.11 * L,
    wings: [wing(1), wing(-1)], stabs: [stab(1), stab(-1)],
    fin: [[-0.33 * L, 0, 0.11 * L], [-0.5 * L, 0, 0.11 * L], [-0.54 * L, 0, 0.32 * L], [-0.45 * L, 0, 0.32 * L]].map(p => X(...p)),
    engines: [1, -1].map(s => [X(0.07 * L, s * 0.17 * B, -0.0 * L), X(-0.04 * L, s * 0.17 * B, 0.0 * L)]),
    tips: [X(-0.15 * L, B / 2, 0.05 * L), X(-0.15 * L, -B / 2, 0.05 * L)],
    top: X(0, 0, 0.13 * L)
  };
}
function drawShadow(ctx, a) {
  const alpha = 0.34 * LT.day * Math.exp(-a.z / 450);
  if (alpha < 0.02) return;
  const P = planeParts(a), sh = (p) => [p[0] - p[2] * 0.55, p[1] - p[2] * 0.35, 0];   // 해가 남동쪽에 있다고 보고 북서쪽으로 그림자
  const col = `rgba(0,0,0,${alpha})`;
  for (const w of [...P.wings, ...P.stabs]) fillPoly(ctx, w.map(sh), col);
  const n = sh(P.nose), tl = sh(P.tail), nx = -(tl[1] - n[1]), ny = tl[0] - n[0], l = Math.hypot(nx, ny) || 1, k = P.d / 2 / l;
  fillPoly(ctx, [[n[0] + nx * k, n[1] + ny * k], [tl[0] + nx * k, tl[1] + ny * k], [tl[0] - nx * k, tl[1] - ny * k], [n[0] - nx * k, n[1] - ny * k]].map(p => [p[0], p[1], 0]), col);
}
function planeObject(a, now) {
  const center = toCam(a.x, a.y, a.z);
  return { depth: center[2], plane: a, draw(ctx) {
    if (center[2] < NEAR) return;
    const P = planeParts(a), dep = center[2];
    const body = rgb(fogged(LT.body, dep)), wingc = rgb(fogged(LT.wing, dep)), tailc = AL[a.f.airline]?.color || '#888';
    const tube = (p, q, d, col) => { const s1 = project(...p), s2 = project(...q); if (!s1 || !s2) return; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, C.F * d / dep); ctx.beginPath(); ctx.moveTo(...s1); ctx.lineTo(...s2); ctx.stroke(); };
    for (const e of P.engines) tube(e[0], e[1], P.d * 0.42, rgb(fogged([70, 74, 82], dep)));
    for (const w of P.wings) fillPoly(ctx, w, wingc);
    tube(P.nose, P.tail, P.d, body);
    tube(P.X(0.46 * P.L, 0, 0.085 * P.L), P.X(0.4 * P.L, 0, 0.085 * P.L), P.d * 0.35, rgb(fogged([40, 55, 75], dep)));   // 조종석 창
    for (const w of P.stabs) fillPoly(ctx, w, wingc);
    fillPoly(ctx, P.fin, tailc);
    // 밤: 항법등·충돌방지등·착륙등
    if (LT.day < 0.6) {
      const lamp = (p, col, r) => { const s = project(...p); if (!s) return; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, 7); ctx.fill(); };
      lamp(P.tips[0], '#ff3b30', 2.2); lamp(P.tips[1], '#34c759', 2.2);
      if (Math.floor(now / 600) % 2) lamp(P.top, '#ff2d20', 2.6);
      if (Math.floor(now / 1100) % 6 === 0) { lamp(P.tips[0], '#fff', 3); lamp(P.tips[1], '#fff', 3); }
      if (['final', 'roll', 'takeoff', 'lineup'].includes(a.state)) {
        const s = project(...P.nose); if (s) { const g = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], 26); g.addColorStop(0, 'rgba(255,250,225,.9)'); g.addColorStop(1, 'rgba(255,250,225,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s[0], s[1], 26, 0, 7); ctx.fill(); }
      }
    }
  } };
}
function drawLabels(ctx, planes) {
  ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  for (const a of planes) {
    const sel = selected === a.f.id;
    if (!sel && (!showLabels || (a.z < 1 && toCam(a.x, a.y, 0)[2] > 2200))) continue;   // 지상 항공기는 가까울 때만
    const s = project(a.x, a.y, a.z + CATS[a.cat].len * 0.45 + 6); if (!s) continue;
    const txt = a.z > 5 ? `${a.f.no} · ${Math.round(a.z)}m` : a.f.no, w = ctx.measureText(txt).width + 10;
    ctx.fillStyle = sel ? '#f5c518' : 'rgba(15,20,28,.72)'; ctx.beginPath(); ctx.roundRect(s[0] - w / 2, s[1] - 18, w, 15, 7); ctx.fill();
    ctx.fillStyle = sel ? '#111' : '#f3f4f6'; ctx.fillText(txt, s[0], s[1] - 10.5);
    if (a.z > 5) {                                                      // 고도선: 그림자 자리까지 점선
      const g = project(a.x, a.y, 0), p = project(a.x, a.y, a.z);
      if (g && p) { ctx.strokeStyle = sel ? 'rgba(245,197,24,.8)' : 'rgba(255,255,255,.35)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...g); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  if (selected) {
    const a = planes.find(p => p.f.id === selected);
    if (a) {                                                            // 선택 표시: 땅 위 원
      const R = CATS[a.cat].span * 0.7, pts = [];
      for (let k = 0; k <= 32; k++) pts.push([a.x + R * Math.cos(k / 32 * 6.283), a.y + R * Math.sin(k / 32 * 6.283), 0]);
      line3(ctx, pts, '#f5c518', 2);
    }
  }
}

// ---- 화면 한 장 ----------------------------------------------------------------------
function fit(canvas, aspect) {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth, ch = aspect ? cw * aspect : canvas.clientHeight;
  if (aspect) canvas.style.height = ch + 'px';
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cw, ch };
}
const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 6.283185; while (d < -Math.PI) d += 6.283185; return a + d * k; };
function interpolated(alpha) {
  return curView.map(c => {
    const p = prevView.get(c.id);
    if (!p || Math.hypot(c.x - p.x, c.y - p.y) > 500) return c;
    return { ...c, x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, z: p.z + (c.z - p.z) * alpha, hd: lerpAng(p.hd, c.hd, alpha), bank: p.bank + (c.bank - p.bank) * alpha };
  });
}
function drawScene(now) {
  const canvas = $('apView'), { ctx, cw, ch } = fit(canvas, innerWidth < 700 ? 0.8 : 0.5);
  // 따라가기 · 시점 이동
  const planes = interpolated(SPEEDS[speedIdx] === 'max' ? 1 : clamp(acc / sim.cfg.dt, 0, 1));
  if ($('camSel').value === 'follow' && selected) {
    const a = planes.find(p => p.f.id === selected);
    if (a) { cam.tx = a.x; cam.ty = a.y; cam.tz = a.z; }          // 보간된 위치에 바로 맞춤 (빠른 배속에서도 화면 가운데)
  }
  if (camGoal) {
    let done = true;
    for (const k of Object.keys(camGoal)) { const d = k === 'yaw' ? lerpAng(cam[k], camGoal[k], 0.12) - cam[k] : (camGoal[k] - cam[k]) * 0.12; cam[k] += d; if (Math.abs(d) > (k === 'dist' || k === 'tx' || k === 'ty' ? 0.5 : 0.0005)) done = false; }
    if (done) camGoal = null;
  }
  C = makeCamera(cw, ch); LT = lighting(sim.t);
  drawGround(ctx); drawMarkings(ctx); drawLights(ctx, now);
  for (const a of planes) if (a.z < 900) drawShadow(ctx, a);
  const objs = [...staticObjects(), ...planes.map(a => planeObject(a, now))].sort((a, b) => b.depth - a.depth);
  for (const o of objs) o.draw(ctx);
  drawLabels(ctx, planes);
  // 왼쪽 위: 시각 · 운영 방향 · 공중 대기
  const q0 = sim.queue(0), q1 = sim.queue(1);
  const lines = [
    `${clock(sim.t)} · ${t({ ko: '운영', en: 'Ops' })} ${sim.rwyName(0)} / ${sim.rwyName(1)}${sim.cfg.lowVis ? ' · ' + t({ ko: '저시정', en: 'low vis' }) : ''}`,
    t({ ko: `공중 대기 ${sim.rwyName(0)} ${q0.hold} · ${sim.rwyName(1)} ${q1.hold}  |  이륙 대기 ${q0.dep} · ${q1.dep}`, en: `Holding ${sim.rwyName(0)} ${q0.hold} · ${sim.rwyName(1)} ${q1.hold}  |  Departure queue ${q0.dep} · ${q1.dep}` })
  ];
  ctx.font = `600 ${cw < 520 ? 11 : 13}px system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  lines.forEach((s, i) => {
    const w = ctx.measureText(s).width + 20, y = 8 + i * 30;
    ctx.fillStyle = 'rgba(15,20,28,.72)'; ctx.beginPath(); ctx.roundRect(8, y, w, 24, 12); ctx.fill();
    ctx.fillStyle = '#f3f4f6'; ctx.fillText(s, 18, y + 12);
  });
  if (sim.done()) {
    const s = t({ ko: '오늘 운항 종료 · 처음부터 다시 볼 수 있습니다', en: 'All flights done for today · press Restart' });
    ctx.font = '600 14px system-ui, sans-serif'; const w = ctx.measureText(s).width + 28;
    ctx.fillStyle = 'rgba(15,20,28,.8)'; ctx.beginPath(); ctx.roundRect(cw / 2 - w / 2, ch / 2 - 18, w, 36, 18); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(s, cw / 2, ch / 2);
  }
  drawScene.lastPlanes = planes;
}
const clock = (s) => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;

// ---- 안내판 ----------------------------------------------------------------------
const ST = {
  sched: { ko: '예정', en: 'Scheduled', c: 'sched' }, hold: { ko: '공중 대기', en: 'Holding', c: 'warn' }, final: { ko: '접근 중', en: 'Approach', c: 'go' },
  goaround: { ko: '복행', en: 'Go-around', c: 'bad' }, landed: { ko: '착륙', en: 'Landed', c: 'go' }, arrived: { ko: '도착', en: 'Arrived', c: 'done' },
  boarding: { ko: '탑승 중', en: 'Boarding', c: 'go' }, taxi: { ko: '지상 이동', en: 'Taxiing', c: 'go' }, queue: { ko: '이륙 대기', en: 'Holding short', c: 'warn' },
  lineup: { ko: '활주로 진입', en: 'Lining up', c: 'go' }, departed: { ko: '이륙', en: 'Departed', c: 'done' }
};
function boardRows(kind) {
  const now = sim.t, done = (f) => f.status === 'arrived' || f.status === 'departed';
  return sim.flights.filter(f => f.kind === kind && !(done(f) && (f.inBlock ?? f.act ?? 0) < now - 900) && f.sched < now + 3 * 3600)
    .sort((a, b) => a.sched - b.sched || a.id - b.id).slice(0, 11);
}
function drawBoards() {
  for (const kind of ['arr', 'dep']) {
    const rows = boardRows(kind);
    $(kind === 'arr' ? 'arrBody' : 'depBody').innerHTML = rows.map(f => {
      const s = ST[f.status], doneF = f.status === 'arrived' || f.status === 'departed';
      const base = kind === 'arr' ? f.sched : f.sched + (f.plane?.nominal ?? 600);
      const late = !doneF && f.est - base > 900;
      const tm = (doneF || f.status === 'landed') ? f.act : f.est;
      const changed = tm != null && Math.abs(tm - base) >= 300;
      const al = AL[f.airline];
      return `<tr data-f="${f.id}" class="${selected === f.id ? 'sel' : ''}${doneF ? ' done' : ''}">
        <td>${clock(f.sched)}</td>
        <td class="${changed ? 'chg' : ''}">${tm != null && f.status !== 'sched' ? clock(tm) : ''}</td>
        <td><i style="background:${al.color}"></i>${f.no}</td>
        <td>${t(f.city)}</td>
        <td>${f.rwy != null ? sim.rwyName(f.rwy) : ''}</td>
        <td>${f.gate ?? ''}</td>
        <td><span class="st ${late ? 'bad' : s.c}">${t(s)}${late ? ' · ' + t({ ko: '지연', en: 'Delayed' }) : ''}${f.goArounds && !doneF ? ' ↺' : ''}</span></td></tr>`;
    }).join('');
  }
}

// ---- 지표 ------------------------------------------------------------------------
function stats() {
  const s = sim.summary(), q0 = sim.queue(0), q1 = sim.queue(1);
  const air = sim.planes.filter(p => ['holding', 'final', 'goaround', 'takeoff'].includes(p.state)).length;
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
  const cells = [
    [t({ ko: '처리한 운항', en: 'Movements done' }), `${s.landed + s.departed} / ${s.total}`, t({ ko: `착륙 ${s.landed} · 이륙 ${s.departed}`, en: `${s.landed} landed · ${s.departed} departed` })],
    [t({ ko: '평균 착륙 지연', en: 'Avg arrival delay' }), `${f1(s.arrDelay)}${t({ ko: '분', en: ' min' })}`, t({ ko: '예정 착륙 시각 대비', en: 'vs scheduled landing' })],
    [t({ ko: '평균 이륙 지연', en: 'Avg departure delay' }), `${f1(s.depDelay)}${t({ ko: '분', en: ' min' })}`, t({ ko: '막힘 없을 때 이륙 시각 대비', en: 'vs unimpeded take-off' })],
    [t({ ko: '복행', en: 'Go-arounds' }), `${s.goArounds}${t({ ko: '회', en: '' })}`, t({ ko: '착륙 직전 활주로가 비지 않음', en: 'runway not clear at minimums' })],
    [t({ ko: '대기 중', en: 'Waiting' }), `${q0.hold + q1.hold} / ${q0.dep + q1.dep}`, t({ ko: '공중 대기 / 이륙 대기', en: 'holding / departure queue' })],
    [t({ ko: '지금 항공기', en: 'Aircraft now' }), `${sim.planes.length}`, t({ ko: `공중 ${air} · 지상 ${sim.planes.length - air}`, en: `${air} airborne · ${sim.planes.length - air} on ground` })]
  ];
  $('apStats').innerHTML = cells.map(([k, v, sub]) => `<div><span>${k}</span><b>${v}</b><small>${sub}</small></div>`).join('');
}

// ---- 그래프 ----------------------------------------------------------------------
function chartFrame(id) {
  const canvas = $(id), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  return { ctx, cw, ch, pad: { l: 36, r: 20, t: 12, b: 24 } };
}
function niceStep(max) { const r = max / 4, p = 10 ** Math.floor(Math.log10(r)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= r); }
function axes(ctx, pad, cw, ch, ymax, X) {
  const H = ch - pad.t - pad.b, Y = v => pad.t + H * (1 - v / ymax);
  ctx.font = '11px system-ui, sans-serif'; ctx.strokeStyle = css('--line'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
  for (let v = 0, st = niceStep(ymax); v <= ymax + 1e-9; v += st) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(cw - pad.r, Y(v)); ctx.stroke(); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(Math.round(v), pad.l - 6, Y(v)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let h = 6; h <= 24; h += 3) ctx.fillText(String(h).padStart(2, '0') + ':00', X(h * 3600), pad.t + H + 6);
  return Y;
}
function drawCharts() {
  // 1) 시간대별 운항 수: 활주로별 막대 + 계획 선
  {
    const { ctx, cw, ch, pad } = chartFrame('moveChart');
    const X = s => pad.l + (cw - pad.l - pad.r) * (s - 6 * 3600) / (18 * 3600);
    const plan = PROFILE.map(w => Math.round(sim.cfg.peak * w));
    const ymax = Math.max(10, ...plan, ...[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map(h => sim.stats.moves[0][h] + sim.stats.moves[1][h])) * 1.15;
    const Y = axes(ctx, pad, cw, ch, ymax, X), bw = (X(3600) - X(0)) * 0.36;
    for (let h = 6; h < 24; h++) {
      let base = 0;
      for (const r of [0, 1]) { const v = sim.stats.moves[r][h]; if (!v) continue; ctx.fillStyle = RWY_COL[r]; ctx.fillRect(X(h * 3600 + 1800) - bw, Y(base + v), bw * 2, Y(base) - Y(base + v) - 1); base += v; }
    }
    ctx.strokeStyle = css('--text'); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.beginPath();
    plan.forEach((v, i) => { const x0 = X((6 + i) * 3600), x1 = X((7 + i) * 3600); i ? ctx.lineTo(x0, Y(v)) : ctx.moveTo(x0, Y(v)); ctx.lineTo(x1, Y(v)); });
    ctx.stroke(); ctx.setLineDash([]);
    const nowX = X(sim.t); ctx.strokeStyle = css('--muted'); ctx.beginPath(); ctx.moveTo(nowX, pad.t); ctx.lineTo(nowX, ch - pad.b); ctx.stroke();
  }
  // 2) 대기 중인 항공기: 공중 대기 · 이륙 대기
  {
    const { ctx, cw, ch, pad } = chartFrame('queueChart');
    const X = s => pad.l + (cw - pad.l - pad.r) * (s - 6 * 3600) / (18 * 3600);
    const rows = sim.history.filter(r => r.t >= 6 * 3600);
    const ymax = Math.max(4, ...rows.map(r => Math.max(r.hold, r.dep))) * 1.15;
    const Y = axes(ctx, pad, cw, ch, ymax, X);
    for (const [key, col] of [['hold', RWY_COL[0]], ['dep', RWY_COL[1]]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      rows.forEach((r, i) => (i ? ctx.lineTo(X(r.t), Y(r[key])) : ctx.moveTo(X(r.t), Y(r[key]))));
      ctx.stroke();
    }
  }
}

// ---- 루프 ------------------------------------------------------------------------
const snapshot = () => new Map(sim.view().map(v => [v.id, v]));
let lastSlow = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  if (running && !sim.done()) {
    const sp = SPEEDS[speedIdx];
    if (sp === 'max') { const t0 = performance.now(); while (performance.now() - t0 < 14 && !sim.done()) sim.step(); prevView = snapshot(); curView = sim.view(); }
    else {
      acc += dt * sp;
      while (acc >= sim.cfg.dt) { prevView = new Map(curView.map(v => [v.id, v])); sim.step(); curView = sim.view(); acc -= sim.cfg.dt; }
    }
  }
  drawScene(now);
  if (now - lastSlow > 400) { drawBoards(); stats(); drawCharts(); lastSlow = now; }
  requestAnimationFrame(frame);
}

// ---- 조작부 ----------------------------------------------------------------------
function restart() {
  sim = new Airport({ seed: (Math.random() * 1e9) | 0, peak: +$('peak').value, ops: $('ops').value, lowVis: $('vis').value === 'low' });
  while (sim.t < 6 * 3600 + 40 * 60) sim.step();              // 06:40부터 보여줌 (첫 편들이 이미 움직이는 중)
  curView = sim.view(); prevView = new Map(); acc = 0; selected = null;
  label(); drawBoards(); stats(); drawCharts();
  if ($('camSel').value === 'approach') camGoal = PRESETS.approach();
}
function label() {
  $('playBtn').innerHTML = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 시작', en: '▶ Start' });
  const sp = SPEEDS[speedIdx];
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Speed ' }) + (sp === 'max' ? t({ ko: '최대', en: 'max' }) : sp + '×');
  const opts = (id, list) => { const el = $(id), v = el.value || list[0][0]; el.innerHTML = list.map(([k, o]) => `<option value="${k}">${t(o)}</option>`).join(''); el.value = v; };
  opts('camSel', [['all', { ko: '시점: 공항 전체', en: 'View: whole airport' }], ['north', { ko: '시점: 북쪽 활주로', en: 'View: north runway' }], ['south', { ko: '시점: 남쪽 활주로', en: 'View: south runway' }],
    ['terminal', { ko: '시점: 터미널', en: 'View: terminal' }], ['approach', { ko: '시점: 착륙 접근', en: 'View: final approach' }], ['follow', { ko: '시점: 선택한 편 따라가기', en: 'View: follow selected flight' }]]);
  opts('ops', [['east', { ko: '동쪽으로 운영 (09L/09R)', en: 'East ops (09L/09R)' }], ['west', { ko: '서쪽으로 운영 (27R/27L)', en: 'West ops (27R/27L)' }]]);
  opts('vis', [['good', { ko: '시정 좋음', en: 'Good visibility' }], ['low', { ko: '저시정 (안개)', en: 'Low visibility (fog)' }]]);
  $('peakOut').textContent = $('peak').value + t({ ko: '편/시', en: '/h' });
  $('labelsBtn').textContent = showLabels ? t({ ko: '편명 숨기기', en: 'Hide labels' }) : t({ ko: '편명 보기', en: 'Show labels' });
}
function pick(x, y) {
  let best = null, bd = 26;
  for (const a of drawScene.lastPlanes || []) {
    const s = project(a.x, a.y, a.z + 2); if (!s) continue;
    const d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = a; }
  }
  return best;
}
function bindCamera() {
  const cv = $('apView'), pts = new Map();
  let moved = 0, pinch = 0;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); moved = 0; camGoal = null; });
  cv.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const d1 = Math.hypot(a.x - b.x, a.y - b.y); if (pinch && d0) cam.dist = clamp(cam.dist * d0 / d1, 250, 12000); pinch = 1; return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (p.b === 2 || p.sh) {                                    // 오른쪽 버튼·Shift 드래그: 이동
      const k = cam.dist / C.F, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      cam.tx -= (dx * cy - (-dy) * sy * 1.6) * k; cam.ty -= (-dx * sy - (-dy) * cy * 1.6) * k;
    } else { cam.yaw -= dx * 0.005; cam.pitch = clamp(cam.pitch + dy * 0.004, 0.1, 1.35); }
  });
  const up = e => {
    const p = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
    if (p && moved < 6) {                                       // 클릭: 항공기 선택
      const rect = cv.getBoundingClientRect(), a = pick(e.clientX - rect.left, e.clientY - rect.top);
      selected = a ? a.f.id : null; drawBoards();
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); camGoal = null; cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 250, 12000); }, { passive: false });
  cv.addEventListener('dblclick', () => { camGoal = PRESETS[$('camSel').value === 'follow' ? 'all' : $('camSel').value](); });
}
function bind() {
  $('playBtn').addEventListener('click', () => { running = !running; label(); });
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; label(); });
  $('resetBtn').addEventListener('click', restart);
  $('labelsBtn').addEventListener('click', () => { showLabels = !showLabels; label(); });
  $('camSel').addEventListener('change', () => {
    const v = $('camSel').value;
    if (v === 'follow') { if (!selected) { const f = sim.planes.find(p => p.state === 'final') || sim.planes[0]; if (f) selected = f.f.id; } camGoal = { pitch: 0.3, dist: 650 }; }
    else camGoal = PRESETS[v]();                               // 높이(tz)도 0으로 부드럽게 돌아감
  });
  $('peak').addEventListener('input', label);
  $('peak').addEventListener('change', restart);
  $('ops').addEventListener('change', restart);
  $('vis').addEventListener('change', () => { sim.cfg.lowVis = $('vis').value === 'low'; label(); });
  for (const id of ['arrBody', 'depBody']) $(id).addEventListener('click', e => {
    const tr = e.target.closest('tr[data-f]'); if (!tr) return;
    const id2 = +tr.dataset.f; selected = selected === id2 ? null : id2; drawBoards();
  });
  bindCamera();
  document.addEventListener('langchange', () => { label(); drawBoards(); stats(); drawCharts(); });
  window.addEventListener('resize', drawCharts);
}
function main() { label(); bind(); restart(); requestAnimationFrame(frame); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
