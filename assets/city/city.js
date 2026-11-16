// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 도시 교통망 시뮬레이션 코어 (화면 없이 동작 → 테스트 가능). 단위: 미터, 초. 화면 좌표(y 아래쪽), 우측통행
//
//  - 6×6 블록 격자 도시: 교차로 7×7 = 49개, 블록 한 변 110 m. 가장자리 28곳에 도시 밖과 이어지는 출입구
//  - 도로: 방향마다 2차로. 안쪽(0) = 좌회전 전용, 바깥쪽(1) = 직진·우회전
//  - 차량: IDM(지능형 운전자 모델). 차로마다 앞에서부터 줄을 세워 앞차를 바로 찾는다
//  - 교차로 통과: 정지선 → 교차로 안 곡선 → 다음 도로의 정해 둔 차로. 들어갈 자리가 없으면 교차로에 들어가지 않음(꼬리 물기 금지)
//  - 경로: 출입구에서 목적지 출입구를 무작위로 정하고, 혼잡을 반영한 '남은 시간' 표로 교차로마다 좌·직·우를 고름
//  - 신호: 4현시(남북 직진 → 남북 좌회전 → 동서 직진 → 동서 좌회전), 황색 3초 + 전적색 2초
//      fixed 고정 주기 · wave 녹색 물결(동서 방향 연동) · actuated 감응식(교차로마다 대기 차량에 맞춰 연장·생략)
//  - 자율주행차(AV): 차간 시간이 짧고 출발 반응이 빠르며, 신호 정보(V2I)로 녹색이 켜질 때에 맞춰 속도를 줄여 다가감
//
// ⚠ 교육용 단순 모델입니다. 실제 교통 설계 · 신호 운영 기준을 대신하지 않습니다.

export const N = 7;                         // 교차로 가로 · 세로 개수 (블록 6×6)
export const GEO = { block: 110, laneW: 3.5, setback: 11, gate: 95 };
export const DIRS = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
const OPP = { E: 'W', W: 'E', N: 'S', S: 'N' };
export const PHASES = [
  { axis: 'NS', move: 'T', label: { ko: '남북 직진', en: 'N–S through' } },
  { axis: 'NS', move: 'L', label: { ko: '남북 좌회전', en: 'N–S left' } },
  { axis: 'EW', move: 'T', label: { ko: '동서 직진', en: 'E–W through' } },
  { axis: 'EW', move: 'L', label: { ko: '동서 좌회전', en: 'E–W left' } }
];
const TURN_PEN = { T: 8, L: 18, R: 4 };     // 경로 고를 때 회전마다 더하는 예상 신호 대기 (초)

export const DEFAULTS = {
  seed: 1,
  inflow: 2400,             // 도시 전체로 들어오는 교통량 (대/시)
  bias: 0,                  // 0 = 고르게, 1 = 출근 쏠림 (동쪽 → 서쪽)
  av: 0.2,                  // 자율주행차 비율
  mode: 'fixed',            // fixed | wave | actuated
  green: 24, left: 10,      // 고정 · 물결 신호의 직진 · 좌회전 녹색 (초)
  yellow: 3, allRed: 2,
  vWave: 12,                // 녹색 물결 진행 속도 (m/s)
  actuated: { minT: 8, maxT: 40, minL: 5, maxL: 16, gap: 3, detect: 35 },
  v0: 13.9, vLeft: 7, vRight: 5.5,
  human: { T: 1.5, a: 1.4, b: 2.0, s0: 2.0, rt: 1.1 },
  auto: { T: 0.8, a: 1.8, b: 2.0, s0: 1.6, rt: 0.2 },
  len: 4.5, bMax: 4.5,
  dt: 0.25
};

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dirKey = (d) => (d[0] === 1 ? 'E' : d[0] === -1 ? 'W' : d[1] === -1 ? 'N' : 'S');
const right = (d) => [-d[1], d[0]];
export function turnOf(dIn, dOut) {
  if (dIn[0] === dOut[0] && dIn[1] === dOut[1]) return 'T';
  if (dOut[0] === dIn[1] && dOut[1] === -dIn[0]) return 'L';
  if (dOut[0] === -dIn[1] && dOut[1] === dIn[0]) return 'R';
  return 'U';
}

// ---- 도로망 ----------------------------------------------------------------------------
export function buildNetwork() {
  const B = GEO.block, SB = GEO.setback, nodes = [], links = [], gates = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) nodes.push({ id: j * N + i, i, j, x: i * B, y: j * B, in: [], out: [] });
  const addLink = (from, to, a, b, d, gate = null) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l = { id: links.length, from, to, a, b, d, dk: dirKey(d), len, gate, lanes: [] };
    l.lanes = [0, 1].map(k => ({ link: l, k, cars: [], res: 0 }));
    links.push(l);
    if (from >= 0) nodes[from].out.push(l);
    if (to >= 0) nodes[to].in.push(l);
    return l;
  };
  for (const n of nodes) for (const [k, d] of Object.entries(DIRS)) {
    const ni = n.i + d[0], nj = n.j + d[1];
    if (ni >= 0 && ni < N && nj >= 0 && nj < N) {
      const m = nodes[nj * N + ni];
      addLink(n.id, m.id, [n.x + d[0] * SB, n.y + d[1] * SB], [m.x - d[0] * SB, m.y - d[1] * SB], d);
    } else {
      const g = { id: gates.length, side: k, node: n.id, x: n.x + d[0] * GEO.gate, y: n.y + d[1] * GEO.gate };
      g.out = addLink(n.id, -1, [n.x + d[0] * SB, n.y + d[1] * SB], [g.x, g.y], d, g);
      g.inn = addLink(-1, n.id, [g.x, g.y], [n.x - d[0] * -SB, n.y - d[1] * -SB], [-d[0], -d[1]], g);
      gates.push(g);
    }
  }
  for (const l of links) l.next = l.to >= 0 ? nodes[l.to].out.filter(m => turnOf(l.d, m.d) !== 'U') : [];
  for (const l of links) l.prev = links.filter(p => p.next.includes(l));
  return { nodes, links, gates };
}
// 차로 중심선 위의 점
export function lanePoint(lane, s) {
  const l = lane.link, r = right(l.d), off = GEO.laneW * (lane.k + 0.5);
  return [l.a[0] + r[0] * off + l.d[0] * s, l.a[1] + r[1] * off + l.d[1] * s];
}
// 교차로 안 경로: 들어오는 차로 끝 → 나가는 차로 시작 (회전은 2차 베지어)
const boxCache = new Map();
export function boxPath(inLane, outLane) {
  const key = inLane.link.id * 2 + inLane.k + ':' + (outLane.link.id * 2 + outLane.k);
  let p = boxCache.get(key);
  if (p) return p;
  const A = lanePoint(inLane, inLane.link.len), Bp = lanePoint(outLane, 0), d1 = inLane.link.d, d2 = outLane.link.d;
  const move = turnOf(d1, d2), pts = [A];
  if (move === 'T') pts.push(Bp);
  else {
    const den = d1[0] * d2[1] - d1[1] * d2[0], t = ((Bp[0] - A[0]) * d2[1] - (Bp[1] - A[1]) * d2[0]) / den, C = [A[0] + d1[0] * t, A[1] + d1[1] * t];
    for (let i = 1; i <= 10; i++) { const s = i / 10, m = 1 - s; pts.push([m * m * A[0] + 2 * m * s * C[0] + s * s * Bp[0], m * m * A[1] + 2 * m * s * C[1] + s * s * Bp[1]]); }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  p = { pts, cum, len: cum[cum.length - 1], move };
  boxCache.set(key, p);
  return p;
}
export function boxPoint(p, s) {
  const { pts, cum } = p; s = Math.max(0, Math.min(p.len, s));
  let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
  const k = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = pts[i - 1], b = pts[i];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])];
}

// ---- 시뮬레이터 -------------------------------------------------------------------------
export class City {
  constructor(opts = {}) {
    const o = this.o = { ...DEFAULTS, ...opts, actuated: { ...DEFAULTS.actuated, ...(opts.actuated || {}) } };
    this.rand = rng(o.seed);
    Object.assign(this, buildNetwork());
    this.t = 0; this.nextId = 1;
    this.inBox = [];                                              // 교차로 안을 지나는 차
    this.spawned = 0; this.exited = 0; this.blocked = 0; this.redRuns = 0; this.wrongExit = 0;
    this.done = [];                                               // 빠져나간 차 { t, time, free, delay, stops, av }
    this.inLog = []; this.outLog = [];                            // 들어온 · 나간 시각 (분당 유입 · 유출)
    this.history = [];
    for (const g of this.gates) { g.rIn = 0.4 + 1.2 * this.rand(); g.rOut = 0.4 + 1.2 * this.rand(); g.queue = 0; g.inCount = 0; g.outCount = 0; g.nextT = Infinity; }
    for (const n of this.nodes) Object.assign(n, { phase: 0, stage: 'green', stageT: 0, target: o.actuated.minT, lastDet: 0, offset: 0 });
    this.configure({});
    this.route();
  }
  expo(rate) { return rate > 0 ? this.t - Math.log(1 - this.rand()) * 3600 / rate : Infinity; }
  // 돌아가는 중에 설정 바꾸기: 유입량 · 쏠림 · 자율주행 비율 · 신호 방식과 시간
  configure(p) {
    const o = Object.assign(this.o, p), prevMode = this.mode;
    // 출입구마다 들어오는 · 나가는 비중 (무작위 바탕 × 출근 쏠림: 동쪽에서 들어와 서쪽으로)
    const w = (side, inbound) => (side === 'E' ? (inbound ? 1 + 3 * o.bias : 1 - 0.7 * o.bias) : side === 'W' ? (inbound ? 1 - 0.7 * o.bias : 1 + 3 * o.bias) : 1);
    for (const g of this.gates) { g.wIn = g.rIn * w(g.side, true); g.wOut = g.rOut * w(g.side, false); }
    const wIn = this.gates.reduce((s, g) => s + g.wIn, 0);
    for (const g of this.gates) { const r = o.inflow * g.wIn / wIn; if (r !== g.rate) { g.rate = r; g.nextT = this.expo(r); } }
    this.cycle = 2 * (o.green + o.left) + 4 * (o.yellow + o.allRed);
    for (const n of this.nodes) n.offset = o.mode === 'wave' ? (n.i * GEO.block / o.vWave) % this.cycle : 0;
    if (o.mode === 'actuated' && prevMode !== 'actuated') for (const n of this.nodes) Object.assign(n, { stageT: 0, target: o.actuated.minT, lastDet: 0, stage: n.stage || 'green' });
    this.mode = o.mode;
    this.updateSignals(0);
  }

  // ---- 신호 ----
  // 고정 · 물결: 주기 안에서 지금 어느 현시 · 단계인가
  schedule(n) {
    const o = this.o, seg = [];
    for (let p = 0; p < 4; p++) { seg.push([p, 'green', PHASES[p].move === 'T' ? o.green : o.left], [p, 'yellow', o.yellow], [p, 'allred', o.allRed]); }
    let tau = ((this.t - n.offset) % this.cycle + this.cycle) % this.cycle;
    for (const [p, st, d] of seg) { if (tau < d) return { phase: p, stage: st, left: d - tau, tau, seg }; tau -= d; }
    return { phase: 0, stage: 'green', left: 0, tau: 0, seg };
  }
  signal(n, link, move) {                                       // 'G' | 'Y' | 'R'
    const P = PHASES[n.phase], axis = link.d[0] === 0 ? 'NS' : 'EW';
    const mine = P.axis === axis && (move === 'L' ? P.move === 'L' : P.move === 'T');
    if (!mine || n.stage === 'allred') return 'R';
    return n.stage === 'green' ? 'G' : 'Y';
  }
  // 고정 · 물결 신호에서 그 움직임의 녹색까지 남은 시간 (자율주행차가 V2I로 받는 정보). 감응식은 알 수 없음(null)
  timeToGreen(n, link, move) {
    if (this.o.mode === 'actuated') return null;
    const axis = link.d[0] === 0 ? 'NS' : 'EW', want = PHASES.findIndex(P => P.axis === axis && P.move === (move === 'L' ? 'L' : 'T'));
    const S = this.schedule(n);
    let t = 0, tau = 0;
    for (const [p, st, d] of S.seg) { if (p === want && st === 'green') break; t += d; }
    tau = S.tau;
    return ((t - tau) % this.cycle + this.cycle) % this.cycle;
  }
  updateSignals(dt) {
    const o = this.o;
    for (const n of this.nodes) {
      if (o.mode !== 'actuated') { const S = this.schedule(n); n.phase = S.phase; n.stage = S.stage; n.left = S.left; continue; }
      const A = o.actuated, P = PHASES[n.phase];
      n.stageT += dt;
      if (n.stage === 'green') {
        const min = P.move === 'T' ? A.minT : A.minL, max = P.move === 'T' ? A.maxT : A.maxL;
        if (n.stageT < min) n.target = min;
        else if (this.demand(n, n.phase, A.detect)) { n.lastDet = n.stageT; n.target = Math.min(max, n.stageT + A.gap); }
        else n.target = Math.min(n.target, Math.max(min, n.lastDet + A.gap));
        n.left = Math.max(0, n.target - n.stageT);
        if (n.stageT >= n.target) { n.stage = 'yellow'; n.stageT = 0; }
      } else if (n.stage === 'yellow') { n.left = o.yellow - n.stageT; if (n.stageT >= o.yellow) { n.stage = 'allred'; n.stageT = 0; } }
      else {
        n.left = o.allRed - n.stageT;
        if (n.stageT >= o.allRed) {
          let next = (n.phase + 1) % 4;
          for (let k = 0; k < 3 && !this.demand(n, next, 120); k++) next = (next + 1) % 4;   // 수요 없는 현시는 건너뜀
          n.phase = next; n.stage = 'green'; n.stageT = 0; n.lastDet = 0; n.target = PHASES[next].move === 'T' ? A.minT : A.minL;
        }
      }
    }
  }
  // 그 현시로 갈 차가 정지선 range m 안에 있나
  demand(n, phaseIdx, range) {
    const P = PHASES[phaseIdx];
    for (const l of n.in) {
      if ((l.d[0] === 0 ? 'NS' : 'EW') !== P.axis) continue;
      const lane = l.lanes[P.move === 'L' ? 0 : 1], c = lane.cars[0];
      if (c && l.len - c.s < range) return true;
    }
    return false;
  }

  // ---- 경로: 목적지 출구마다 '남은 시간' 표 (혼잡 반영, 20초마다 다시 계산) ----
  route() {
    const o = this.o, tt = this.links.map(l => {
      let stopped = 0; for (const ln of l.lanes) for (const c of ln.cars) if (c.v < 1) stopped++;
      return l.len / o.v0 + stopped * 2.2;
    });
    this.cost = this.gates.map(g => {
      const dist = new Float64Array(this.links.length).fill(Infinity), done = new Uint8Array(this.links.length);
      dist[g.out.id] = tt[g.out.id];
      for (;;) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
        if (best < 0) break;
        done[best] = 1;
        const m = this.links[best];
        for (const l of m.prev) {
          const c = tt[l.id] + TURN_PEN[turnOf(l.d, m.d)] + bd;
          if (c < dist[l.id]) dist[l.id] = c;
        }
      }
      return dist;
    });
    this.routedT = this.t;
  }
  // 그 도로의 끝 교차로에서 어디로 갈지 · 어느 차로로 갈지
  plan(car, link) {
    if (link.to < 0) { car.next = null; car.move = null; return link.lanes[link.lanes[0].cars.length <= link.lanes[1].cars.length ? 0 : 1]; }
    const cost = this.cost[car.dest];
    let best = null, bc = Infinity;
    for (const m of link.next) {
      const c = TURN_PEN[turnOf(link.d, m.d)] + cost[m.id] + car.noise * this.rand();
      if (c < bc) { bc = c; best = m; }
    }
    car.next = best; car.move = turnOf(link.d, best.d);
    return link.lanes[car.move === 'L' ? 0 : 1];
  }

  // 따라가기 화면용: 지금 있는 도로부터 출구까지 남은 경로 (지금 계산한 '남은 시간' 표대로)
  routeAhead(car) {
    const out = [];
    let l = car.box ? car.toLane.link : car.link, guard = 0;
    while (l && guard++ < 40) {
      out.push(l);
      if (l.to < 0) break;
      const cost = this.cost[car.dest];
      let best = null, bc = Infinity;
      for (const m of l.next) { const c = TURN_PEN[turnOf(l.d, m.d)] + cost[m.id]; if (c < bc) { bc = c; best = m; } }
      l = best;
    }
    return out;
  }
  carPos(car) {                                                 // [x, y, 각도]
    if (car.box) return boxPoint(car.box, car.bs);
    const p = lanePoint(car.lane, car.s), d = car.link.d;
    return [p[0], p[1], Math.atan2(d[1], d[0])];
  }

  // ---- 차량 ----
  spawn() {
    for (const g of this.gates) {
      while (this.t >= g.nextT) { g.queue++; g.nextT = this.expo(g.rate) + (g.nextT - this.t); }
      if (!g.queue) continue;
      // 목적지: 자기 출입구가 아닌 곳을 비중대로
      const car = { id: this.nextId++, av: this.rand() < this.o.av, s: 0, v: this.o.v0 * 0.6, acc: 0, t0: this.t, dist: 0, stops: 0, stopped: false, hold: 0, noise: 4 };
      let tot = 0; for (const h of this.gates) if (h !== g) tot += h.wOut;
      let r = this.rand() * tot;
      for (const h of this.gates) { if (h === g) continue; r -= h.wOut; if (r <= 0) { car.dest = h.id; break; } }
      car.dest ??= this.gates[(g.id + 1) % this.gates.length].id;
      car.src = g.id;
      const lane = this.plan(car, g.inn), tail = lane.cars[lane.cars.length - 1];
      if (tail && tail.s < this.o.len + 6) { this.blocked++; continue; }      // 입구가 막힘 → 도시 밖에서 대기
      g.queue--;
      car.lane = lane; car.link = g.inn; car.v = tail ? Math.min(car.v, tail.v) : car.v;
      lane.cars.push(car);
      this.spawned++; g.inCount++; this.inLog.push(this.t);
    }
  }
  params(car) { return car.av ? this.o.auto : this.o.human; }
  idm(car, gap, vLead, v0) {
    const P = this.params(car), ss = P.s0 + Math.max(0, car.v * P.T + car.v * (car.v - vLead) / (2 * Math.sqrt(P.a * P.b)));
    const acc = P.a * (1 - (car.v / Math.max(0.1, v0)) ** 4 - (gap < Infinity ? (ss / Math.max(gap, 0.1)) ** 2 : 0));
    return Math.max(-this.o.bMax * 2, acc);
  }
  // 앞이 비어 있으면 정지선에서 교차로로 들어갈 수 있나 (신호 + 나갈 차로에 자리)
  mayEnter(car, link) {
    if (link.to < 0) return true;
    const n = this.nodes[link.to], sig = this.signal(n, link, car.move);
    if (sig === 'R') return false;
    if (sig === 'Y') { const d = link.len - car.s; if (d > car.v * car.v / (2 * this.o.bMax) - 0.5) return false; }
    const tgt = car.next.lanes[this.peekLane(car)], tail = tgt.cars[tgt.cars.length - 1];
    const room = (tail ? tail.s - this.o.len : car.next.len) - tgt.res * (this.o.len + 2.5);
    return room > this.o.len + 3;
  }
  peekLane(car) {                                               // 다음 도로에서 쓸 차로 (그 끝에서의 회전을 미리 정해 둠)
    if (car.peek == null || car.peekFor !== car.next.id) {
      const tmp = { dest: car.dest, noise: car.noise };
      car.peek = this.plan(tmp, car.next).k; car.peekFor = car.next.id; car.peekNext = tmp.next; car.peekMove = tmp.move;
    }
    return car.peek;
  }
  stepCars(dt) {
    const o = this.o;
    // 1) 차로 위 차량 가속도
    for (const l of this.links) for (const lane of l.lanes) {
      const cars = lane.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        let gap = Infinity, vLead = 0, v0 = o.v0;
        if (i > 0) { gap = cars[i - 1].s - car.s - o.len; vLead = cars[i - 1].v; }
        else if (!this.mayEnter(car, l)) {
          gap = l.len - car.s; vLead = 0;
          // 자율주행차: 녹색까지 남은 시간을 알면 그때 정지선에 닿도록 미리 속도를 줄임 (불필요한 정지 · 출발 줄이기)
          if (car.av && l.to >= 0) {
            const tg = this.timeToGreen(this.nodes[l.to], l, car.move);
            if (tg != null && tg > 1 && gap < 160) v0 = Math.max(3, Math.min(o.v0, gap / tg));
          }
        } else {
          const ahead = this.inBox.filter(b => b.fromLane === lane).pop();      // 방금 교차로로 들어간 앞차
          if (ahead) { gap = l.len - car.s + ahead.bs - o.len; vLead = ahead.v; }
        }
        car.acc = this.react(car, this.idm(car, gap, vLead, v0), dt);
      }
    }
    // 2) 교차로 안 차량: 같은 곳으로 가는 앞차 또는 나갈 차로의 맨 뒤 차
    for (let i = 0; i < this.inBox.length; i++) {
      const car = this.inBox[i], box = car.box;
      let gap = Infinity, vLead = 0;
      for (let j = i - 1; j >= 0; j--) { const b = this.inBox[j]; if (b.toLane === car.toLane && b.box === box) { gap = b.bs - car.bs - o.len; vLead = b.v; break; } }
      if (gap === Infinity) { const tail = car.toLane.cars[car.toLane.cars.length - 1]; if (tail) { gap = box.len - car.bs + tail.s - o.len; vLead = tail.v; } }
      const v0 = box.move === 'L' ? o.vLeft : box.move === 'R' ? o.vRight : o.v0;
      car.acc = this.idm(car, gap, vLead, v0);
    }
    // 3) 움직이기 · 교차로 들어가기 · 다음 도로로 · 도시 밖으로
    for (const l of this.links) for (const lane of l.lanes) {
      for (const car of lane.cars) this.move(car, dt);
      while (lane.cars.length && lane.cars[0].s >= l.len) {
        const car = lane.cars.shift(), over = car.s - l.len;
        if (l.to < 0) { if (l.gate.id !== car.dest) this.wrongExit++; this.finish(car); continue; }
        if (this.signal(this.nodes[l.to], l, car.move) === 'R') this.redRuns++;      // 테스트용: 적신호에 들어가면 셈 (0이어야 함)
        const k = this.peekLane(car), toLane = car.next.lanes[k];
        car.box = boxPath(lane, toLane); car.bs = over; car.fromLane = lane; car.toLane = toLane; car.node = l.to;
        toLane.res++;
        this.inBox.push(car);
      }
    }
    for (const car of this.inBox) {
      const v1 = Math.max(0, car.v + car.acc * dt); car.bs += (car.v + v1) / 2 * dt; car.dist += (car.v + v1) / 2 * dt; car.v = v1;
    }
    const still = [];
    for (const car of this.inBox) {
      if (car.bs < car.box.len) { still.push(car); continue; }
      const lane = car.toLane, link = lane.link;
      lane.res--;
      car.s = car.bs - car.box.len; car.link = link; car.lane = lane; car.box = null;
      car.next = car.peekNext; car.move = car.peekMove; car.peek = null;
      lane.cars.push(car);
    }
    this.inBox = still;
  }
  // 사람은 멈춰 있다가 앞이 열려도 잠깐 늦게 출발 (출발 손실 시간). 자율주행차는 거의 바로
  react(car, acc, dt) {
    if (car.v < 0.2 && acc > 0.2) { car.hold += dt; if (car.hold < this.params(car).rt) return 0; }
    else if (car.v > 1) car.hold = 0;
    return acc;
  }
  move(car, dt) {
    const v1 = Math.max(0, car.v + car.acc * dt), ds = (car.v + v1) / 2 * dt;
    car.s += ds; car.dist += ds; car.v = v1;
    if (car.v < 0.3) { if (!car.stopped) { car.stops++; car.stopped = true; } } else if (car.v > 2.5) car.stopped = false;
  }
  finish(car) {
    const time = this.t - car.t0, free = car.dist / this.o.v0;
    this.done.push({ t: this.t, time, free, delay: Math.max(0, time - free), stops: car.stops, av: car.av });
    this.exited++; this.gates[car.dest].outCount++; this.outLog.push(this.t);
  }

  step() {
    const dt = this.o.dt;
    this.t += dt;
    this.updateSignals(dt);
    if (this.t - this.routedT >= 20) this.route();
    this.spawn();
    this.stepCars(dt);
    if (Math.round(this.t / dt) % Math.round(5 / dt) === 0) this.record();
  }
  run(seconds) { const n = Math.round(seconds / this.o.dt); for (let i = 0; i < n; i++) this.step(); }

  // ---- 지표 ----
  *cars() { for (const l of this.links) for (const lane of l.lanes) yield* lane.cars; yield* this.inBox; }
  count() { let n = 0; for (const l of this.links) for (const lane of l.lanes) n += lane.cars.length; return n + this.inBox.length; }
  nodeQueue(n) { let q = 0; for (const l of n.in) for (const lane of l.lanes) for (const c of lane.cars) if (c.v < 1 && l.len - c.s < 80) q++; return q; }
  stats(window = 300) {
    const t0 = this.t - window, d = this.done.filter(x => x.t > t0);
    const avg = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : NaN);
    let vs = 0, n = 0, stopped = 0;
    for (const c of this.cars()) { vs += c.v; n++; if (c.v < 1) stopped++; }
    const per = (log) => log.filter(x => x > this.t - 60).length;      // 최근 1분
    const av = d.filter(x => x.av), hu = d.filter(x => !x.av);
    return {
      inCity: n, stopped, speed: n ? vs / n : NaN, inflow: per(this.inLog), outflow: per(this.outLog),
      waiting: this.gates.reduce((s, g) => s + g.queue, 0),
      delay: avg(d, x => x.delay), time: avg(d, x => x.time), stops: avg(d, x => x.stops), trips: d.length,
      avTime: avg(av, x => x.time), huTime: avg(hu, x => x.time), avStops: avg(av, x => x.stops), huStops: avg(hu, x => x.stops),
      avDelay: avg(av, x => x.delay), huDelay: avg(hu, x => x.delay)
    };
  }
  record() {
    const s = this.stats();
    this.history.push({ t: Math.round(this.t), inCity: s.inCity, inflow: s.inflow, outflow: s.outflow, speed: s.speed, delay: s.delay, waiting: s.waiting });
    if (this.history.length > 1500) this.history.shift();
    const cut = this.t - 400;
    if (this.done.length > 6000) this.done = this.done.filter(x => x.t > cut);
    if (this.inLog.length > 4000) this.inLog = this.inLog.filter(x => x > this.t - 120);
    if (this.outLog.length > 4000) this.outLog = this.outLog.filter(x => x > this.t - 120);
  }
}
