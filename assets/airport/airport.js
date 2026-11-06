// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 공항 이착륙 시뮬레이션 코어 (화면 없이도 동작 → 테스트 가능). 단위: 미터, 초. 시각은 자정부터의 초
//
//  - 가상 공항: 평행 활주로 2개(간격 1,200m → 서로 독립 운영), 가운데 여객터미널, 활주로마다 유도로·계류장
//  - 혼합 운영: 두 활주로 모두 착륙과 이륙을 함께 처리
//  - 착륙: 대기 선회(홀딩) → 최종 접근(3° 강하) → 착지 → 감속 → 고속 탈출 유도로 → 게이트
//  - 이륙: 게이트(탑승) → 푸시백 → 지상 이동 → 활주로 앞 대기 → 정렬 → 이륙 활주 → 상승
//  - 안전 규칙 (코드로 강제)
//      · 활주로에는 한 번에 한 대만 (착륙 중이거나 이륙 중인 항공기)
//      · 착륙 간격: 기체 크기에 따른 후류 간격(3~6해리), 이륙 간격: 60초 또는 120초
//      · 이륙은 다음 착륙기가 충분히 멀 때만 정렬, 착륙 직전에 활주로가 비어 있지 않으면 복행
//      · 지상에서는 앞 항공기와 거리를 두고, 서로 막히면 먼저 들어온 항공기가 우선
//  - 모든 무작위는 시드 난수 → 같은 시드면 같은 결과
//
// 좌표: 활주로 쪽마다 같은 모양의 "기준 좌표"로 계산하고 화면용 좌표로 바꿀 때만 뒤집는다.
//  기준 좌표에서 활주로는 y = 600, 착륙·이륙 방향은 +x, 터미널은 y = 0 쪽.
//  북쪽 활주로(0)는 그대로, 남쪽 활주로(1)는 y를 뒤집고, 서쪽 방향 운영이면 x를 뒤집는다.

export const GEO = {
  rwyY: 600, rwyHalf: 1650, rwyW: 45,              // 활주로: 길이 3,300m, 폭 45m, 두 활주로 간격 1,200m
  thrX: -1650, tdz: 300,                           // 착륙 시단, 시단에서 착지점까지
  twyY: 450, laneY: 240, gateY: 140,               // 평행 유도로, 계류장 유도선, 게이트(항공기 중심)
  gates: 16, gateX0: -750, gateDX: 100,            // 쪽마다 게이트 16개
  exits: [-150, 350, 850], exitDX: 260,            // 고속 탈출 유도로 시작점 (착륙 방향 기준)
  laneEntryX: 1250, laneExitX: -1000, holdX: -1720, // 계류장 들어오는 곳 · 나가는 곳 · 이륙 대기 지점
  D0: 18000, glide: Math.tan(3 * Math.PI / 180), tch: 15,   // 최종 접근 시작 거리, 3° 강하각, 시단 통과 높이
  holdR: 2500,                                     // 대기 선회 반지름
  term: { x: 820, y: 70, h: 24 }                   // 여객터미널 (|x| ≤ 820, |y| ≤ 70, 높이 24m)
};
GEO.z0 = GEO.tch + GEO.D0 * GEO.glide;             // 최종 접근 시작 고도 (~958m)

// 기체 크기 (후류 등급). 속도 m/s, 가속도 m/s²
export const CATS = {
  L: { label: { ko: '소형', en: 'Small' }, len: 20, span: 18, vApp: 60, vr: 55, aTo: 2.3, grad: 0.08, share: 0.1 },
  M: { label: { ko: '중형', en: 'Medium' }, len: 38, span: 36, vApp: 70, vr: 75, aTo: 2.0, grad: 0.085, share: 0.7 },
  H: { label: { ko: '대형', en: 'Heavy' }, len: 66, span: 62, vApp: 76, vr: 82, aTo: 1.7, grad: 0.07, share: 0.2 }
};

// 가상 항공사 (실제 항공사와 관계없음)
export const AIRLINES = [
  { code: 'NR', name: { ko: '누리항공', en: 'Nuri Air' }, color: '#2a78d6' },
  { code: 'BD', name: { ko: '바다항공', en: 'Bada Air' }, color: '#199e70' },
  { code: 'SL', name: { ko: '솔항공', en: 'Sol Air' }, color: '#d95926' },
  { code: 'HB', name: { ko: '한빛항공', en: 'Hanbit Air' }, color: '#9085e9' },
  { code: 'GR', name: { ko: '구름항공', en: 'Gureum Air' }, color: '#d4a106' }
];
const CITIES = {
  dom: [['제주', 'Jeju'], ['부산', 'Busan'], ['광주', 'Gwangju'], ['여수', 'Yeosu'], ['울산', 'Ulsan']],
  short: [['도쿄', 'Tokyo'], ['오사카', 'Osaka'], ['후쿠오카', 'Fukuoka'], ['상하이', 'Shanghai'], ['베이징', 'Beijing'], ['타이베이', 'Taipei'],
    ['홍콩', 'Hong Kong'], ['방콕', 'Bangkok'], ['하노이', 'Hanoi'], ['마닐라', 'Manila'], ['싱가포르', 'Singapore'], ['다낭', 'Da Nang']],
  long: [['로스앤젤레스', 'Los Angeles'], ['뉴욕', 'New York'], ['런던', 'London'], ['파리', 'Paris'], ['프랑크푸르트', 'Frankfurt'], ['두바이', 'Dubai'], ['시드니', 'Sydney']]
};

// 시간대별 교통량 비율 (6시~23시). 아침·저녁에 몰림
export const PROFILE = [0.55, 0.9, 1.0, 0.9, 0.75, 0.7, 0.75, 0.8, 0.8, 0.75, 0.8, 0.9, 1.0, 1.0, 0.9, 0.75, 0.55, 0.4];

export const DEFAULTS = {
  seed: 1,
  dt: 0.5,
  ops: 'east',            // 'east': 09L/09R (동쪽으로 착륙·이륙) | 'west': 27R/27L
  peak: 60,               // 가장 붐비는 시간의 시간당 운항 수 (두 활주로 착륙+이륙 합)
  lowVis: false,          // 저시정: 착륙 간격 1.4배, 이륙 간격 +30초
  start: 5.5 * 3600,      // 05:30 시작
  firstHour: 6, lastHour: 23,
  schedule: true,         // false 면 일정 없이 빈 공항 (테스트용)
  sep: { lineupMargin: 12, mixedGap: 190, depShort: 60, depLong: 120 },   // 정렬 여유(초), 혼합 운영 착륙 간격(초), 이륙 간격(초)
  taxi: { v: 10, turn: 5, exit: 15, push: 1.2, lineup: 8, acc: 0.6, brake: 1.2 },
  parkArrival: 600        // 도착기는 게이트에 10분 머문 뒤 사라짐
};

// 시드 난수 (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const NM = 1852;
const TAU = Math.PI * 2;
function mergeCfg(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? mergeCfg(base[k], v) : v;
  }
  return out;
}

// 착륙 간격 (해리): 앞 기체가 클수록 뒤 기체가 멀리 떨어져야 함 (후류)
export function arrSepNM(lead, fol) {
  if (lead === 'H') return fol === 'H' ? 4 : fol === 'M' ? 5 : 6;
  if (lead === 'M' && fol === 'L') return 5;
  return 3;
}
// 이륙 간격 (초)
export function depSepS(lead, fol, cfg = DEFAULTS) {
  const long = (lead === 'H' && fol !== 'H') || (lead === 'M' && fol === 'L');
  return (long ? cfg.sep.depLong : cfg.sep.depShort) + (cfg.lowVis ? 30 : 0);
}

// ---- 경로: 꺾인 선의 모서리를 원호로 둥글게 ---------------------------------------------
export function buildPath(pts, r = 50, turnV = 5) {
  const out = [{ x: pts[0][0], y: pts[0][1], v: Infinity }];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    let ux = ax - bx, uy = ay - by; const lu = Math.hypot(ux, uy); ux /= lu; uy /= lu;
    let wx = cx - bx, wy = cy - by; const lw = Math.hypot(wx, wy); wx /= lw; wy /= lw;
    const ang = Math.acos(clamp(ux * wx + uy * wy, -1, 1));             // 모서리 안쪽 각
    if (Math.PI - ang < 1e-3) { out.push({ x: bx, y: by, v: Infinity }); continue; }
    let rr = r, tl = rr / Math.tan(ang / 2);
    const tmax = Math.min(lu, lw) * 0.5;
    if (tl > tmax) { tl = tmax; rr = tl * Math.tan(ang / 2); }
    let qx = ux + wx, qy = uy + wy; const lq = Math.hypot(qx, qy); qx /= lq; qy /= lq;
    const dc = rr / Math.sin(ang / 2), ccx = bx + qx * dc, ccy = by + qy * dc;
    const a1 = Math.atan2(by + uy * tl - ccy, bx + ux * tl - ccx), a2 = Math.atan2(by + wy * tl - ccy, bx + wx * tl - ccx);
    let da = a2 - a1; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    const n = Math.max(3, Math.ceil(Math.abs(da) / 0.12)), v = turnV * Math.sqrt(clamp(rr / 50, 0.3, 4));
    for (let k = 0; k <= n; k++) out.push({ x: ccx + rr * Math.cos(a1 + da * k / n), y: ccy + rr * Math.sin(a1 + da * k / n), v });
  }
  const L = pts[pts.length - 1]; out.push({ x: L[0], y: L[1], v: Infinity });
  const cum = [0];
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
  return { p: out, cum, len: cum[cum.length - 1] };
}
export function sample(path, s) {
  const { p, cum } = path;
  s = clamp(s, 0, path.len);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, f = (s - cum[lo]) / seg;
  const x = p[lo].x + (p[hi].x - p[lo].x) * f, y = p[lo].y + (p[hi].y - p[lo].y) * f;
  return { x, y, hd: Math.atan2(p[hi].y - p[lo].y, p[hi].x - p[lo].x), i: hi, z: p[lo].z != null ? p[lo].z + (p[hi].z - p[lo].z) * f : 0 };
}
// 앞으로 남은 경로의 굽은 곳·끝에서 멈출 수 있는 속도
function speedAhead(path, s, i0, brake, stopAtEnd) {
  let v = stopAtEnd ? Math.sqrt(2 * brake * Math.max(0, path.len - s)) : Infinity;
  for (let i = i0; i < path.p.length && path.cum[i] - s < 160; i++) {
    const d = Math.max(0, path.cum[i] - s);
    if (path.p[i].v < Infinity) v = Math.min(v, Math.sqrt(path.p[i].v ** 2 + 2 * brake * d));
  }
  return v;
}

// ---- 시뮬레이션 --------------------------------------------------------------------
export class Airport {
  constructor(opts = {}) {
    this.cfg = mergeCfg(DEFAULTS, opts);
    this.rand = rng(this.cfg.seed);
    this.t = this.cfg.start;
    this.sx = this.cfg.ops === 'west' ? -1 : 1;
    this.planes = [];
    this.flights = [];
    this.nextId = 1;
    this.rwy = [0, 1].map(r => ({ r, occ: new Set(), lastThr: -1e9, lastCat: 'M', lastRoll: -1e9, lastRollCat: 'M', holdQ: [], thrLog: [], rollLog: [] }));
    this.gates = [0, 1].map(() => new Array(GEO.gates).fill(null));
    this.stats = { goArounds: 0, landed: 0, departed: 0, moves: [new Array(24).fill(0), new Array(24).fill(0)], arrDelay: [], depDelay: [], minGround: Infinity };
    this.history = [];
    this.events = [];
    if (this.cfg.schedule) this.makeSchedule();
    this.pending = this.flights.slice();       // 아직 나타나지 않은 편 (시각순)
    this.record();
  }

  // 활주로 이름: 진행 방향(09/27)과 좌우(L/R)
  rwyName(r) {
    if (this.sx > 0) return r === 0 ? '09L' : '09R';
    return r === 0 ? '27R' : '27L';
  }
  // 기준 좌표 → 화면 좌표
  toWorld(r, x, y) { return { x: this.sx * x, y: (r === 0 ? 1 : -1) * y }; }
  hdWorld(r, hd) { return Math.atan2((r === 0 ? 1 : -1) * Math.sin(hd), this.sx * Math.cos(hd)); }

  // ---- 일정 ----
  makeSchedule() {
    const { firstHour, lastHour, peak } = this.cfg;
    const used = new Set();
    for (let h = firstHour; h <= lastHour; h++) {
      const n = Math.round(peak * PROFILE[h - firstHour]);
      for (let k = 0; k < n; k++) {
        const kind = this.rand() < 0.5 ? 'arr' : 'dep';
        const u = this.rand(), cat = u < CATS.L.share ? 'L' : u < CATS.L.share + CATS.H.share ? 'H' : 'M';
        const list = cat === 'L' ? CITIES.dom : cat === 'H' ? CITIES.long : (this.rand() < 0.3 ? CITIES.dom : CITIES.short);
        const city = list[(this.rand() * list.length) | 0];
        const al = AIRLINES[(this.rand() * AIRLINES.length) | 0];
        let no; do { no = al.code + (100 + ((this.rand() * 900) | 0)); } while (used.has(no)); used.add(no);
        const sched = Math.round((h * 3600 + this.rand() * 3600) / 300) * 300;   // 5분 단위
        this.flights.push({ id: this.flights.length + 1, no, airline: al.code, kind, cat, city: { ko: city[0], en: city[1] }, sched, est: sched, act: null, rwy: null, status: 'sched', plane: null });
      }
    }
    this.flights.sort((a, b) => a.sched - b.sched || a.id - b.id);
    for (const f of this.flights) {
      if (f.kind === 'arr') f.appear = f.sched - GEO.D0 / CATS[f.cat].vApp + (this.rand() - 0.4) * 600;    // 대체로 정시, ±5분
      else f.appear = f.sched - 1800;                                                                   // 출발 30분 전 탑승 시작
    }
    this.flights.sort((a, b) => a.appear - b.appear || a.id - b.id);
  }

  // 테스트·사용자용: 편 하나 추가
  addFlight({ kind, cat = 'M', sched = this.t, no, rwy = null, appear }) {
    const f = { id: this.flights.length + 1, no: no || `T${this.flights.length + 1}`, airline: AIRLINES[0].code, kind, cat, city: { ko: '시험', en: 'Test' }, sched, est: sched, act: null, rwy: null, status: 'sched', plane: null, forceRwy: rwy };
    f.appear = appear ?? (kind === 'arr' ? sched - GEO.D0 / CATS[cat].vApp : this.t);
    this.flights.push(f);
    this.pending.push(f); this.pending.sort((a, b) => a.appear - b.appear);
    return f;
  }

  freeGates(r) { return this.gates[r].filter(g => g === null).length; }
  pickGate(r) {
    const free = this.gates[r].map((g, i) => (g === null ? i : -1)).filter(i => i >= 0);
    return free.length ? free[(this.rand() * free.length) | 0] : -1;
  }
  gateX(i) { return GEO.gateX0 + GEO.gateDX * i; }
  gateName(r, i) { return r === 0 ? i + 1 : GEO.gates + i + 1; }   // 북쪽 1~16, 남쪽 17~32

  // ---- 착륙기 ----
  spawnArrival(f) {
    const C = CATS[f.cat];
    let r = f.forceRwy;
    if (r == null) {                                     // 더 일찍 내릴 수 있는 활주로 (같으면 빈 게이트가 많은 쪽)
      const score = (k) => Math.max(this.t + GEO.D0 / C.vApp, this.rwy[k].lastThr + 90) + this.rwy[k].holdQ.length * 150 - this.freeGates(k) * 5;
      r = score(0) <= score(1) ? 0 : 1;
    }
    const p = { id: this.nextId++, f, cat: f.cat, kind: 'arr', r, state: 'holding', th: -Math.PI / 2, x: GEO.thrX - GEO.D0, y: GEO.rwyY, z: GEO.z0, hd: 0, v: C.vApp * 1.15, bank: 0, stack: this.rwy[r].holdQ.length };
    this.rwy[r].holdQ.push(p);
    this.planes.push(p);
    f.plane = p; f.rwy = r; f.status = 'hold';
    this.tryRelease(p, true);
  }
  arrSepS(lead, fol) {
    const nm = arrSepNM(lead, fol) * (this.cfg.lowVis ? 1.4 : 1);
    return nm * NM / CATS[fol].vApp;
  }
  depWaiting(r) { return this.planes.some(p => p.kind === 'dep' && p.r === r && (p.state === 'hold' || p.state === 'taxiOut' || p.state === 'lineup')); }
  // 홀딩 맨 앞 항공기가 진입점을 지날 때: 간격이 확보되면 최종 접근 시작
  tryRelease(p, atEntry) {
    const R = this.rwy[p.r];
    if (!atEntry || R.holdQ[0] !== p) return false;
    const C = CATS[p.cat], thr = this.t + GEO.D0 / C.vApp;
    let need = this.arrSepS(R.lastCat, p.cat);
    if (this.depWaiting(p.r)) need = Math.max(need, this.cfg.sep.mixedGap + (this.cfg.lowVis ? 30 : 0));   // 혼합 운영: 사이에 이륙 한 대
    if (thr < R.lastThr + need) return false;
    R.holdQ.shift(); R.holdQ.forEach((q, i) => { q.stack = i; });
    R.lastThr = thr; R.lastCat = p.cat;
    Object.assign(p, { state: 'final', x: GEO.thrX - GEO.D0, y: GEO.rwyY, z: GEO.z0, hd: 0, v: C.vApp });
    p.f.status = 'final'; p.f.est = thr;
    return true;
  }
  stepHolding(p, dt) {
    const R = GEO.holdR, cx = GEO.thrX - GEO.D0, cy = GEO.rwyY + R;
    const before = p.th;
    p.th += p.v / R * dt;
    const crossed = Math.floor((before + Math.PI / 2) / TAU) !== Math.floor((p.th + Math.PI / 2) / TAU);
    p.x = cx + R * Math.cos(p.th); p.y = cy + R * Math.sin(p.th); p.hd = p.th + Math.PI / 2;
    p.z += ((GEO.z0 + 300 * p.stack) - p.z) * Math.min(1, dt / 20);
    if (crossed && this.tryRelease(p, true)) return;
    const k = this.rwy[p.r].holdQ.indexOf(p);
    p.f.est = Math.max(p.f.sched, this.t + GEO.D0 / CATS[p.cat].vApp + 150 * (k + 1));
  }
  stepFinal(p, dt) {
    const R = this.rwy[p.r];
    const toThr = GEO.thrX - p.x;
    if (toThr <= 400 && toThr > 0 && !p.cleared) {                // 결심 지점: 활주로가 비어 있어야 착륙
      if (R.occ.size > 0) return this.goAround(p);
      p.cleared = true;
    }
    p.x += p.v * dt;
    if (p.x < GEO.thrX) p.z = GEO.tch + (GEO.thrX - p.x) * GEO.glide;
    else {
      if (!R.occ.has(p.id)) { R.occ.add(p.id); R.thrLog.push({ t: this.t, cat: p.cat, id: p.id }); }
      p.z = Math.max(0, GEO.tch * (1 - (p.x - GEO.thrX) / GEO.tdz));
    }
    p.f.est = this.t + Math.max(0, toThr) / p.v;
    if (p.x >= GEO.thrX + GEO.tdz) this.touchdown(p);
  }
  goAround(p) {
    this.stats.goArounds++; p.f.goArounds = (p.f.goArounds || 0) + 1;
    this.events.push({ type: 'goaround', id: p.id, t: this.t });
    const R = GEO.holdR, x1 = GEO.rwyHalf + 3000, pts = [[p.x, p.y], [x1, GEO.rwyY]];
    for (let k = 1; k <= 24; k++) { const a = -Math.PI / 2 + Math.PI * k / 24; pts.push([x1 + R * Math.cos(a), GEO.rwyY + R + R * Math.sin(a)]); }
    pts.push([GEO.thrX - GEO.D0, GEO.rwyY + 2 * R]);
    const path = buildPath(pts, 1, 999);
    const z0 = p.z;
    path.p.forEach((q, i) => { q.z = Math.min(GEO.z0, z0 + path.cum[i] * 0.07); q.v = Infinity; });
    Object.assign(p, { state: 'goaround', path, s: 0, v: CATS[p.cat].vApp * 1.2, cleared: false });
    p.f.status = 'goaround';
  }
  stepGoAround(p, dt) {
    p.s += p.v * dt;
    const q = sample(p.path, p.s);
    p.x = q.x; p.y = q.y; p.z = q.z; p.hd = q.hd;
    if (p.s >= p.path.len) {                                      // 대기 선회로 합류 (맨 위 지점, 맨 뒤 순서)
      const R = this.rwy[p.r];
      Object.assign(p, { state: 'holding', th: Math.PI / 2, v: CATS[p.cat].vApp * 1.15, stack: R.holdQ.length });
      R.holdQ.push(p);
      p.f.status = 'hold';
    }
  }
  touchdown(p) {
    const C = CATS[p.cat];
    p.aLand = this.rand() < 0.04 ? 1.1 : 1.5 + this.rand() * 0.8;   // 감속 1.5~2.3 m/s², 가끔(4%) 길게 미끄러짐 → 뒤 착륙기 복행 원인
    const reach = p.x + (p.v ** 2 - this.cfg.taxi.exit ** 2) / (2 * p.aLand);
    const ex = GEO.exits.find(e => e >= reach - 30) ?? GEO.exits[GEO.exits.length - 1];
    p.exit = ex; p.z = 0; p.state = 'roll';
    p.f.act = this.t; p.f.status = 'landed'; p.f.est = this.t;
    this.stats.landed++; this.stats.moves[p.r][Math.floor(this.t / 3600) % 24]++;
    this.stats.arrDelay.push((this.t - p.f.sched) / 60);
    const gi = this.pickGate(p.r);
    const pts = [[p.x, GEO.rwyY], [ex, GEO.rwyY], [ex + GEO.exitDX, GEO.twyY], [GEO.laneEntryX, GEO.twyY]];
    if (gi >= 0) { this.gates[p.r][gi] = p.id; p.gate = gi; p.f.gate = this.gateName(p.r, gi); pts.push([GEO.laneEntryX, GEO.laneY], [this.gateX(gi), GEO.laneY], [this.gateX(gi), GEO.gateY]); }
    else pts.push([GEO.laneEntryX, GEO.laneY + 90]);              // 빈 게이트가 없으면 계류장 입구에서 대기
    p.path = buildPath(pts, 70, this.cfg.taxi.turn);
    p.s = 0; p.vTop = Infinity;                                   // 활주로 위에서는 착륙 감속으로만 줄임
    void C;
  }

  // ---- 출발기 ----
  spawnDeparture(f) {
    let r = f.forceRwy;
    if (r == null) {
      const load = (k) => this.planes.filter(q => q.kind === 'dep' && q.r === k && q.state !== 'gate').length - this.freeGates(k) * 0.3;
      r = load(0) <= load(1) ? 0 : 1;
      if (this.freeGates(r) === 0) r = 1 - r;
    }
    const gi = this.pickGate(r);
    if (gi < 0) return false;                                      // 게이트가 다 차 있으면 나중에
    const p = { id: this.nextId++, f, cat: f.cat, kind: 'dep', r, state: 'gate', gate: gi, x: this.gateX(gi), y: GEO.gateY, z: 0, hd: -Math.PI / 2, v: 0, bank: 0 };
    this.gates[r][gi] = p.id;
    this.planes.push(p);
    f.plane = p; f.rwy = r; f.status = 'boarding'; f.gate = this.gateName(r, gi);
    f.est = Math.max(f.sched, this.t + 1200) + this.nominalTaxi(gi);
    return true;
  }
  nominalTaxi(gi) { return 130 + (this.gateX(gi) + 70 - GEO.laneExitX + (GEO.twyY - GEO.laneY) + (GEO.laneExitX - GEO.holdX)) / 9 + 35; }
  laneClearForPush(p) {
    const gx = this.gateX(p.gate);
    return !this.planes.some(q => q !== p && q.r === p.r && GROUND_SET.has(q.state) && q.y > GEO.gateY - 10 && q.y < GEO.laneY + 120 && q.x > gx - 140 && q.x < gx + 520);
  }
  startPush(p) {
    const gx = this.gateX(p.gate);
    p.path = buildPath([[gx, GEO.gateY], [gx, GEO.laneY], [gx + 70, GEO.laneY]], 60, this.cfg.taxi.push);
    p.s = 0; p.rev = true; p.state = 'push'; p.vTop = this.cfg.taxi.push;
    p.f.status = 'taxi'; p.offBlock = this.t;
  }
  endPush(p) {
    this.gates[p.r][p.gate] = null; p.gate = null; p.rev = false;
    p.state = 'start'; p.wait = 20;                                // 엔진 시동
  }
  startTaxiOut(p) {
    p.path = buildPath([[p.x, p.y], [GEO.laneExitX, GEO.laneY], [GEO.laneExitX, GEO.twyY], [GEO.holdX, GEO.twyY]], 55, this.cfg.taxi.turn);
    p.s = 0; p.state = 'taxiOut'; p.vTop = this.cfg.taxi.v;
  }
  // 이륙기가 정렬부터 활주로 끝을 지날 때까지 활주로를 쓰는 시간 (추정)
  depOccupancy(cat) {
    const C = CATS[cat], T = this.cfg.taxi;
    const line = 230 / T.lineup + T.lineup / T.acc;                 // 대기 지점 → 활주로 (약 230m)
    const d1 = C.vr ** 2 / (2 * C.aTo), d2 = Math.max(0, GEO.rwyHalf - GEO.thrX - 10 - d1);
    return line + C.vr / C.aTo + d2 / (C.vr * 1.15);
  }
  canLineUp(p) {
    const R = this.rwy[p.r];
    if (R.occ.size > 0) return false;
    if (this.t - R.lastRoll < depSepS(R.lastRollCat, p.cat, this.cfg)) return false;
    const need = this.depOccupancy(p.cat) + this.cfg.sep.lineupMargin + (this.cfg.lowVis ? 20 : 0);   // 다음 착륙기가 결심 지점에 오기 전에 비워야 함
    for (const q of this.planes) if (q.r === p.r && q.state === 'final' && (GEO.thrX - q.x) / q.v < need) return false;
    return true;
  }
  startLineUp(p) {
    const R = this.rwy[p.r];
    R.occ.add(p.id);
    p.path = buildPath([[p.x, p.y], [GEO.holdX, GEO.rwyY - 40], [GEO.thrX + 10, GEO.rwyY]], 45, this.cfg.taxi.lineup);
    p.s = 0; p.state = 'lineup'; p.vTop = this.cfg.taxi.lineup;
    p.f.status = 'lineup';
  }
  startRoll(p) {
    const R = this.rwy[p.r];
    R.lastRoll = this.t; R.lastRollCat = p.cat; R.rollLog.push({ t: this.t, cat: p.cat, id: p.id });
    Object.assign(p, { state: 'takeoff', x: GEO.thrX + 10, y: GEO.rwyY, hd: 0, v: 0, airborne: false });
  }
  stepTakeoff(p, dt) {
    const C = CATS[p.cat];
    p.v = p.airborne ? Math.min(C.vr * 1.6, p.v + 1.0 * dt) : p.v + C.aTo * dt;
    p.x += p.v * dt;
    if (!p.airborne && p.v >= C.vr) {
      p.airborne = true; p.xLift = p.x;
      p.f.act = this.t; p.f.status = 'departed'; p.f.est = this.t;
      this.stats.departed++; this.stats.moves[p.r][Math.floor(this.t / 3600) % 24]++;
      this.stats.depDelay.push((this.t - p.f.sched - p.nominal) / 60);
    }
    if (p.airborne) p.z = Math.min(2500, (p.x - p.xLift) * C.grad);
    if (p.x > GEO.rwyHalf) this.rwy[p.r].occ.delete(p.id);
    if (p.x > 16000) p.gone = true;
  }

  // ---- 지상 이동 공통 ----
  stepGround(p, dt, blk) {
    const T = this.cfg.taxi;
    const q0 = sample(p.path, p.s);
    const braking = p.state === 'roll' && p.x < p.exit;            // 활주로 위 착륙 감속 구간
    let vmax = Math.min(p.vTop, speedAhead(p.path, p.s, q0.i, braking ? p.aLand : T.brake, true));
    if (braking) vmax = Math.min(vmax, Math.max(T.exit, p.v - p.aLand * dt));
    if (blk) vmax = Math.min(vmax, Math.sqrt(2 * T.brake * Math.max(0, blk.gap)));
    if (p.v < vmax) p.v = Math.min(vmax, p.v + T.acc * dt);
    else p.v = Math.max(vmax, p.v - (braking ? p.aLand : 3) * dt);
    p.s = Math.min(p.path.len, p.s + p.v * dt);
    const q = sample(p.path, p.s);
    p.x = q.x; p.y = q.y; p.hd = p.rev ? q.hd + Math.PI : q.hd;
    return p.s >= p.path.len - 0.01 && p.v < 0.05;
  }
  // 앞을 막는 항공기 찾기 (같은 쪽 지상 항공기 중 진행 방향 앞)
  blockers() {
    const out = new Map();
    const ground = this.planes.filter(p => GROUND_SET.has(p.state) && !(p.state === 'roll' && p.y > GEO.rwyY - 5));
    // 푸시백 중인 항공기는 유도선에 들어오기 전부터 들어올 자리(모서리·끝)를 차지한 것으로 본다
    const obstacles = ground.slice();
    for (const p of ground) if (p.state === 'push') {
      const end = p.path.p[p.path.p.length - 1], gx = this.gateX(p.gate);
      obstacles.push({ x: end.x, y: end.y, cat: p.cat, r: p.r, owner: p }, { x: gx, y: GEO.laneY, cat: p.cat, r: p.r, owner: p });
    }
    for (const a of ground) {
      if (!GROUND_MOVING.has(a.state)) continue;
      const mh = a.rev ? a.hd + Math.PI : a.hd, mx = Math.cos(mh), my = Math.sin(mh);
      let best = null;
      for (const ob of obstacles) {
        const b = ob.owner || ob;
        if (b === a || ob.r !== a.r) continue;
        const dx = ob.x - a.x, dy = ob.y - a.y, ahead = dx * mx + dy * my, lat = Math.abs(-dx * my + dy * mx);
        const need = (CATS[a.cat].len + CATS[b.cat].len) / 2 + 25;
        if (ahead <= 0 || ahead > need + 140 || lat > (CATS[a.cat].span + CATS[b.cat].span) / 2 * 0.7 + 6) continue;
        const gap = ahead - need;
        if (!best || gap < best.gap) best = { b, gap };
      }
      if (best) out.set(a, best);
    }
    // 서로 막으면: 푸시백 중인 항공기가 먼저(이미 움직이기 시작함), 그 밖에는 먼저 생긴(번호 작은) 항공기가 먼저
    const first = (a, b) => (a.state === 'push') !== (b.state === 'push') ? a.state === 'push' : a.id < b.id;
    for (const [a, ba] of [...out]) {
      const bb = out.get(ba.b);
      if (bb && bb.b === a && first(a, ba.b)) out.delete(a);
    }
    return out;
  }

  // ---- 한 틱 ----
  step() {
    const dt = this.cfg.dt;
    this.t += dt;
    this.events.length = 0;
    // 1) 나타날 시각이 된 편
    while (this.pending.length && this.pending[0].appear <= this.t) {
      const f = this.pending[0];
      const ok = f.kind === 'arr' ? (this.spawnArrival(f), true) : this.spawnDeparture(f);
      if (!ok) { f.appear = this.t + 60; this.pending.sort((a, b) => a.appear - b.appear); break; }
      this.pending.shift();
    }
    // 2) 공중
    for (const p of this.planes) {
      const bank0 = p.hd;
      if (p.state === 'holding') this.stepHolding(p, dt);
      else if (p.state === 'final') this.stepFinal(p, dt);
      else if (p.state === 'goaround') this.stepGoAround(p, dt);
      else if (p.state === 'takeoff') this.stepTakeoff(p, dt);
      else continue;
      let dh = p.hd - bank0; while (dh > Math.PI) dh -= TAU; while (dh < -Math.PI) dh += TAU;
      const target = clamp(Math.atan(p.v * (dh / dt) / 9.81), -0.45, 0.45);
      p.bank += (target - p.bank) * Math.min(1, dt / 3);
    }
    // 3) 지상
    const blk = this.blockers();
    for (const p of this.planes) {
      switch (p.state) {
        case 'roll': case 'taxiIn': {
          const done = this.stepGround(p, dt, blk.get(p));
          if (p.state === 'roll' && p.x > p.exit && p.y < GEO.rwyY - 70) { p.state = 'taxiIn'; p.vTop = this.cfg.taxi.v; this.rwy[p.r].occ.delete(p.id); }
          if (done) {
            if (p.gate != null) { p.state = 'parked'; p.until = this.t + this.cfg.parkArrival; p.f.status = 'arrived'; p.f.inBlock = this.t; }
            else p.state = 'waitGate';
          }
          break;
        }
        case 'waitGate': {
          const gi = this.pickGate(p.r);
          if (gi >= 0) {
            this.gates[p.r][gi] = p.id; p.gate = gi; p.f.gate = this.gateName(p.r, gi);
            p.path = buildPath([[p.x, p.y], [GEO.laneEntryX, GEO.laneY], [this.gateX(gi), GEO.laneY], [this.gateX(gi), GEO.gateY]], 55, this.cfg.taxi.turn);
            p.s = 0; p.state = 'taxiIn';
          }
          break;
        }
        case 'parked': if (this.t >= p.until) { this.gates[p.r][p.gate] = null; p.gone = true; } break;
        case 'gate':
          if (this.t >= Math.max(p.f.sched, p.f.appear + 1200) && this.laneClearForPush(p)) { p.nominal = this.nominalTaxi(p.gate); this.startPush(p); }
          else p.f.est = Math.max(p.f.sched, this.t) + this.nominalTaxi(p.gate);
          break;
        case 'push': if (this.stepGround(p, dt, blk.get(p))) this.endPush(p); break;
        case 'start': if ((p.wait -= dt) <= 0) this.startTaxiOut(p); break;
        case 'taxiOut':
          if (this.stepGround(p, dt, blk.get(p))) { p.state = 'hold'; p.f.status = 'queue'; }
          p.f.est = this.t + (p.path.len - p.s) / 9 + 40 + 75 * this.planes.filter(q => q.r === p.r && q.kind === 'dep' && (q.state === 'hold' || q.state === 'lineup')).length;
          break;
        case 'hold':
          if (this.canLineUp(p)) this.startLineUp(p);
          break;
        case 'lineup': if (this.stepGround(p, dt, null)) this.startRoll(p); break;
      }
    }
    // 4) 지상 최소 간격 (검증용 통계)
    const g = this.planes.filter(p => GROUND_SET.has(p.state) || p.state === 'parked' || p.state === 'gate');
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      if (g[i].r !== g[j].r) continue;
      const d = Math.hypot(g[i].x - g[j].x, g[i].y - g[j].y);
      if (d < this.stats.minGround) this.stats.minGround = d;
    }
    // 5) 정리
    if (this.planes.some(p => p.gone)) this.planes = this.planes.filter(p => !p.gone);
    if (Math.round(this.t) % 60 === 0 && Math.abs(this.t - Math.round(this.t)) < 1e-9) this.record();
  }

  // ---- 조회 ----
  done() { return this.pending.length === 0 && this.planes.length === 0 && this.flights.length > 0; }
  queue(r) {
    const R = this.rwy[r];
    return {
      hold: R.holdQ.length,
      dep: this.planes.filter(p => p.r === r && p.kind === 'dep' && (p.state === 'hold' || (p.state === 'taxiOut' && p.v < 0.5 && p.x < GEO.laneExitX))).length,
      occ: R.occ.size
    };
  }
  record() {
    const q0 = this.queue(0), q1 = this.queue(1);
    this.history.push({ t: this.t, hold: q0.hold + q1.hold, dep: q0.dep + q1.dep, air: this.planes.filter(p => AIR.has(p.state)).length, ground: this.planes.filter(p => GROUND_SET.has(p.state)).length });
  }
  summary() {
    const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    return { landed: this.stats.landed, departed: this.stats.departed, total: this.flights.length, goArounds: this.stats.goArounds, arrDelay: avg(this.stats.arrDelay), depDelay: avg(this.stats.depDelay) };
  }
  // 화면용: 화면 좌표의 항공기 목록
  view() {
    return this.planes.map(p => {
      const w = this.toWorld(p.r, p.x, p.y);
      const pitch = p.state === 'takeoff' && p.airborne ? 0.16 : p.state === 'final' ? 0.04 : p.state === 'goaround' && p.z < GEO.z0 - 5 ? 0.14 : 0;
      return { id: p.id, f: p.f, cat: p.cat, r: p.r, state: p.state, x: w.x, y: w.y, z: p.z, hd: this.hdWorld(p.r, p.hd), bank: p.bank * this.sx * (p.r === 0 ? 1 : -1), pitch, v: p.v };
    });
  }
}
const GROUND_SET = new Set(['roll', 'taxiIn', 'waitGate', 'push', 'start', 'taxiOut', 'hold', 'lineup']);
const GROUND_MOVING = new Set(['roll', 'taxiIn', 'push', 'taxiOut', 'lineup']);
const AIR = new Set(['holding', 'final', 'goaround', 'takeoff']);
