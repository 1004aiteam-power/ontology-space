// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 교차로 신호 시뮬레이션 코어 (화면 없이도 동작 → 테스트 가능). 단위: 미터, 초
//
//  - 4갈래 교차로, 우측통행. 갈래마다 들어오는 차로 2개(안쪽 = 좌회전, 바깥쪽 = 직진·우회전), 나가는 차로 2개
//  - 차량: IDM(지능형 운전자 모델)으로 앞차·정지선과의 거리에 맞춰 가속·감속
//  - 신호 4현시: ① 남북 직진 ② 남북 좌회전 ③ 동서 직진 ④ 동서 좌회전, 현시 사이 황색 3초 + 전적색 2초
//  - 보행자: 네 모서리에서 횡단보도를 건넘. 직진 현시 동안 그와 나란한 횡단보도가 보행 신호
//  - 차량은 자기가 지나갈 횡단보도에 보행자가 있으면 양보 (우회전 차량이 주로 해당)
//  - 신호 방식: 고정 주기 / 감응식 (감지기에 차가 있으면 녹색 연장, 없으면 일찍 넘기고 수요 없는 좌회전은 건너뜀)

export const GEO = { laneW: 3.5, half: 7, cwNear: 8, cwFar: 12, stop: 13, len: 110 };   // 교차로 가장자리 7m, 횡단보도 8~12m, 정지선 13m
export const ARMS = ['N', 'E', 'S', 'W'];
const OUT = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };          // 갈래 바깥 방향 (화면 좌표: y 아래쪽)
const RIGHT_OF = { N: 'W', E: 'N', S: 'E', W: 'S' };                  // 그 갈래에서 들어온 차가 우회전하면 나가는 갈래
const LEFT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };
const OPP = { N: 'S', E: 'W', S: 'N', W: 'E' };
export const AXIS = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };

export const PHASES = [
  { id: 'NS', axis: 'NS', move: 'T', label: { ko: '남북 직진', en: 'N–S through' } },
  { id: 'NSL', axis: 'NS', move: 'L', label: { ko: '남북 좌회전', en: 'N–S left' } },
  { id: 'EW', axis: 'EW', move: 'T', label: { ko: '동서 직진', en: 'E–W through' } },
  { id: 'EWL', axis: 'EW', move: 'L', label: { ko: '동서 좌회전', en: 'E–W left' } }
];

export const DEFAULTS = {
  seed: 1,
  mode: 'fixed',                                                      // 'fixed' | 'actuated'
  demand: { N: 450, S: 450, E: 350, W: 350 },                         // 갈래별 도착 교통량 (대/시)
  turn: { L: 0.2, R: 0.15 },                                          // 좌회전·우회전 비율 (나머지는 직진)
  ped: 120,                                                           // 모서리마다 보행자 도착 (명/시)
  fixed: { through: 30, left: 12 },                                   // 고정 주기 녹색 시간 (초)
  actuated: { minT: 10, maxT: 50, minL: 5, maxL: 20, gap: 3, detect: 40 },
  yellow: 3, allRed: 2,
  ped2: { speed: [1.0, 1.6], walkMin: 7, clear: 1.2 },                // 보행 최소 시간, 보행 신호 끝 점멸 계산용 속도(m/s)
  car: { v0: 13.9, a: 2.0, b: 2.0, T: 1.0, s0: 1.5, len: 4.5, wid: 1.9, vLeft: 7, vRight: 5.5, bMax: 4.5 },   // v0 = 50km/h
  dt: 0.1
};

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

const add = (p, q, k = 1) => [p[0] + q[0] * k, p[1] + q[1] * k];
const rightVec = (d) => [-d[1], d[0]];                                // 진행 방향 d의 오른쪽 (화면 좌표)

// ---- 경로: 들어오는 직선 → 교차로 안 곡선(2차 베지어) → 나가는 직선 -----------------------
function laneLine(arm, lane, inbound) {                               // lane 0 = 안쪽, 1 = 바깥쪽
  const u = OUT[arm], d = inbound ? [-u[0], -u[1]] : u;
  const off = rightVec(d), k = GEO.laneW * (lane + 0.5);
  return { at: (dist) => add([u[0] * dist, u[1] * dist], off, k), dir: d };
}
function buildPath(from, move) {
  const to = move === 'T' ? OPP[from] : move === 'L' ? LEFT_OF[from] : RIGHT_OF[from];
  const lane = move === 'L' ? 0 : 1;
  const inL = laneLine(from, lane, true), outL = laneLine(to, lane, false);
  const pts = [inL.at(GEO.len), inL.at(GEO.half)];
  const A = inL.at(GEO.half), B = outL.at(GEO.half);
  if (move === 'T') pts.push(B);
  else {                                                              // 두 직선의 교점을 제어점으로
    const d1 = inL.dir, d2 = outL.dir;
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    const t = ((B[0] - A[0]) * d2[1] - (B[1] - A[1]) * d2[0]) / den;
    const C = add(A, d1, t);
    for (let i = 1; i <= 16; i++) {
      const s = i / 16, m = 1 - s;
      pts.push([m * m * A[0] + 2 * m * s * C[0] + s * s * B[0], m * m * A[1] + 2 * m * s * C[1] + s * s * B[1]]);
    }
  }
  pts.push(outL.at(GEO.len));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const boxIn = GEO.len - GEO.half, boxOut = cum[cum.length - 1] - (GEO.len - GEO.half);
  return {
    from, to, move, lane, pts, cum, length: cum[cum.length - 1],
    stopS: GEO.len - GEO.stop,                                        // 정지선
    boxIn, boxOut,                                                    // 교차로 들어가는·나오는 지점
    entryCwS: GEO.len - GEO.cwFar,                                    // 들어가는 쪽 횡단보도 시작
    exitCwS: boxOut + (GEO.cwNear - GEO.half),                        // 나가는 쪽 횡단보도 시작
    exitCwEnd: boxOut + (GEO.cwFar - GEO.half),
    inLane: from + lane, outLane: to + lane
  };
}
export function pointAt(path, s) {
  const { pts, cum } = path;
  s = Math.max(0, Math.min(path.length, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const k = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  const p = pts[i - 1], q = pts[i];
  return { x: p[0] + (q[0] - p[0]) * k, y: p[1] + (q[1] - p[1]) * k, a: Math.atan2(q[1] - p[1], q[0] - p[0]) };
}

// ---- 횡단보도: 갈래마다 하나, 그 갈래의 두 모서리를 잇는다 -------------------------------
// 보행 신호는 그 횡단보도와 나란한 축의 직진 현시 동안 (북쪽 횡단보도 = 동서 직진 때)
function crosswalk(arm) {
  const u = OUT[arm], side = rightVec(u), mid = (GEO.cwNear + GEO.cwFar) / 2, w = GEO.half + 1.5;
  return { arm, a: add([u[0] * mid, u[1] * mid], side, -w), b: add([u[0] * mid, u[1] * mid], side, w), length: 2 * w, axis: AXIS[arm] === 'NS' ? 'EW' : 'NS' };
}

export class Intersection {
  constructor(opts = {}) {
    this.cfg = merge(DEFAULTS, opts);
    this.rand = rng(this.cfg.seed);
    this.t = 0;
    this.paths = {};
    for (const a of ARMS) for (const m of ['L', 'T', 'R']) this.paths[a + m] = buildPath(a, m);
    this.cws = Object.fromEntries(ARMS.map(a => [a, crosswalk(a)]));
    this.cars = []; this.peds = [];
    this.waiting = Object.fromEntries(ARMS.flatMap(a => [[a + '0', []], [a + '1', []]]));   // 도로에 들어가지 못하고 기다리는 차 (도착 시각)
    this.nextArrive = {}; this.nextPed = {};
    for (const a of ARMS) this.nextArrive[a] = this.expo(this.cfg.demand[a]);
    for (const c of ['NE', 'NW', 'SE', 'SW']) this.nextPed[c] = this.expo(this.cfg.ped);
    this.id = 1;
    // 신호
    this.phase = 0; this.stage = 'green'; this.stageT = 0;            // stage: green | yellow | allred
    this.done = [];                                                   // 빠져나간 차 { t, delay, stops, from }
    this.pedDone = [];                                                // 건넌 보행자 { t, wait }
    this.history = [];
    this.events = [];
  }
  expo(perHour) { return perHour > 0 ? this.t - Math.log(1 - this.rand()) * 3600 / perHour : Infinity; }

  // ---- 신호 상태 ----
  greenFor(phaseIdx) {                                                 // 지금 현시의 녹색 길이 (고정) 또는 최소~최대 (감응)
    const P = PHASES[phaseIdx], c = this.cfg;
    return P.move === 'T' ? c.fixed.through : c.fixed.left;
  }
  // 들어오는 차로의 신호: 'G' | 'Y' | 'R'
  laneSignal(arm, lane) {
    const P = PHASES[this.phase];
    const mine = P.axis === AXIS[arm] && (lane === 0 ? P.move === 'L' : P.move === 'T');
    if (!mine || this.stage === 'allred') return 'R';
    return this.stage === 'green' ? 'G' : 'Y';
  }
  // 횡단보도 보행 신호: 'W'(보행) | 'F'(점멸, 새로 건너기 시작 금지) | 'D'(정지)
  pedSignal(arm) {
    const P = PHASES[this.phase], cw = this.cws[arm];
    if (!(P.move === 'T' && P.axis === cw.axis && this.stage === 'green')) return 'D';
    const clear = cw.length / this.cfg.ped2.clear;                   // 다 건너는 데 걸리는 시간만큼 남으면 점멸
    return this.greenLeft() > clear ? 'W' : 'F';
  }
  greenLeft() { return this.stage === 'green' ? Math.max(0, this.greenTarget - this.stageT) : 0; }

  // 감응식: 녹색 목표 시간을 매 틱 조정
  detected(phaseIdx, range) {
    const P = PHASES[phaseIdx];
    return this.cars.some(c => !c.passed && AXIS[c.path.from] === P.axis && c.path.lane === (P.move === 'L' ? 0 : 1) &&
      c.path.stopS - c.s < range && c.path.stopS - c.s > -1) ||
      ARMS.some(a => AXIS[a] === P.axis && this.waiting[a + (P.move === 'L' ? '0' : '1')].length);
  }
  pedsWaitingFor(phaseIdx) {
    const P = PHASES[phaseIdx];
    return P.move === 'T' && this.peds.some(p => p.state === 'wait' && this.cws[p.cw].axis === P.axis);
  }
  updateSignal(dt) {
    const c = this.cfg;
    this.stageT += dt;
    if (this.stage === 'green') {
      if (c.mode === 'fixed') this.greenTarget = this.greenFor(this.phase);
      else {
        const A = c.actuated, P = PHASES[this.phase];
        const min = P.move === 'T' ? Math.max(A.minT, this.pedHold ? c.ped2.walkMin + this.cws.N.length / c.ped2.clear : 0) : A.minL;
        const max = P.move === 'T' ? A.maxT : A.maxL;
        if (this.stageT < min) this.greenTarget = min;
        else if (this.detected(this.phase, A.detect)) { this.lastDetect = this.stageT; this.greenTarget = Math.min(max, this.stageT + A.gap); }
        else this.greenTarget = Math.min(this.greenTarget ?? min, Math.max(min, (this.lastDetect ?? 0) + A.gap));
      }
      if (this.stageT >= this.greenTarget) this.setStage('yellow');
    } else if (this.stage === 'yellow' && this.stageT >= c.yellow) this.setStage('allred');
    else if (this.stage === 'allred' && this.stageT >= c.allRed) {
      let next = (this.phase + 1) % 4;
      if (c.mode === 'actuated') {                                    // 수요 없는 좌회전 현시는 건너뜀
        for (let k = 0; k < 3 && PHASES[next].move === 'L' && !this.detected(next, 80); k++) next = (next + 1) % 4;
      }
      this.phase = next;
      this.pedHold = c.mode === 'actuated' && this.pedsWaitingFor(next);
      this.lastDetect = 0; this.greenTarget = undefined;
      this.setStage('green');
    }
  }
  setStage(s) { this.stage = s; this.stageT = 0; this.events.push({ type: 'signal', phase: this.phase, stage: s }); }

  // ---- 차량 ----
  spawnArrivals() {
    for (const a of ARMS) {
      while (this.t >= this.nextArrive[a]) {
        const r = this.rand(), T = this.cfg.turn;
        const move = r < T.L ? 'L' : r < T.L + T.R ? 'R' : 'T';
        this.waiting[a + (move === 'L' ? '0' : '1')].push({ t: this.nextArrive[a], move });
        this.nextArrive[a] = this.expo(this.cfg.demand[a]) + (this.nextArrive[a] - this.t);
      }
    }
    // 차로 입구에 자리가 있으면 기다리던 차가 들어감
    for (const key of Object.keys(this.waiting)) {
      const q = this.waiting[key];
      if (!q.length) continue;
      const arm = key[0], lane = +key[1];
      const last = this.cars.filter(c => c.path.from === arm && c.path.lane === lane && c.s < 30).reduce((m, c) => Math.min(m, c.s), Infinity);
      if (last < this.cfg.car.len + this.cfg.car.s0 + 4) continue;
      const w = q.shift(), path = this.paths[arm + w.move];
      const v = last === Infinity ? this.cfg.car.v0 : Math.min(this.cfg.car.v0, this.carAhead(path, 0)?.v ?? this.cfg.car.v0);
      this.cars.push({ id: this.id++, path, s: 0, v, acc: 0, t0: w.t, stops: 0, stopped: false, passed: false, color: arm });
    }
  }
  carAhead(path, s) {
    let best = null, bg = Infinity;
    for (const c of this.cars) {
      if (c.path.inLane === path.inLane && s <= path.stopS + 1 && c.s > s && c.s <= c.path.boxIn + 3) { const g = c.s - s; if (g < bg) { bg = g; best = c; } }
    }
    return best;
  }
  // 앞을 막는 것까지의 거리와 그 속도: 앞차(같은 들어오는 차로 / 같은 나가는 차로), 신호 정지선, 횡단보도 보행자
  obstacle(car) {
    const C = this.cfg.car, p = car.path;
    let gap = Infinity, vLead = 0;
    for (const o of this.cars) {
      if (o === car) continue;
      let g = Infinity;
      if (o.path.inLane === p.inLane && car.s <= p.boxIn + 3 && o.s <= o.path.boxIn + 3 && o.s > car.s) g = o.s - car.s;
      const ep = car.s - p.boxOut, eo = o.s - o.path.boxOut;            // 나가는 차로 좌표
      if (o.path.outLane === p.outLane && eo > ep && car.s > p.boxIn - 25 && o.s > o.path.boxIn) g = Math.min(g, eo - ep);
      if (g < Infinity) { g -= C.len; if (g < gap) { gap = g; vLead = o.v; } }
    }
    // 신호: 정지선을 아직 안 넘었는데 녹색이 아니면 정지선이 벽 (황색인데 멈출 수 없으면 통과)
    if (!car.passed) {
      const sig = this.laneSignal(p.from, p.lane), d = p.stopS - car.s;
      const canStop = d > car.v * car.v / (2 * C.bMax) - 0.5;
      if (sig === 'R' || (sig === 'Y' && canStop)) if (d < gap) { gap = d; vLead = 0; }
    }
    // 보행자: 지나갈 횡단보도(들어가는 쪽·나가는 쪽)에 사람이 있으면 그 앞에서 멈춤
    for (const [arm, cwS] of [[p.from, p.entryCwS], [p.to, p.exitCwS]]) {
      if (car.s < cwS && car.s > cwS - 40 && this.peds.some(q => q.state === 'walk' && q.cw === arm && this.pedInPath(q, p, cwS + 2))) {
        const d = cwS - 0.5 - car.s;
        if (d < gap) { gap = d; vLead = 0; }
      }
    }
    return { gap, vLead };
  }
  pedInPath(ped, path, sAt) {                                         // 보행자가 그 차가 지나갈 자리 근처에 있거나 그쪽으로 다가오는 중
    const pos = this.pedPos(ped), q = pointAt(path, sAt);
    const along = this.cws[ped.cw];
    const ux = (along.b[0] - along.a[0]) / along.length, uy = (along.b[1] - along.a[1]) / along.length;
    const rel = q.x - pos.x, rel2 = q.y - pos.y;
    const ahead = (rel * ux + rel2 * uy) * (ped.dir > 0 ? 1 : -1);    // 차 위치가 보행자 진행 방향 앞쪽이면 +
    return ahead > -2.5 && ahead < 9;
  }
  stepCars(dt) {
    const C = this.cfg.car;
    for (const car of this.cars) {
      const p = car.path;
      // 곡선 구간 근처에서는 회전 속도까지만
      let v0 = C.v0;
      if (p.move !== 'T' && car.s > p.boxIn - 30 && car.s < p.boxOut) v0 = p.move === 'L' ? C.vLeft : C.vRight;
      const { gap, vLead } = this.obstacle(car);
      const ss = C.s0 + Math.max(0, car.v * C.T + car.v * (car.v - vLead) / (2 * Math.sqrt(C.a * C.b)));
      let acc = C.a * (1 - (car.v / v0) ** 4 - (gap < Infinity ? (ss / Math.max(gap, 0.1)) ** 2 : 0));
      acc = Math.max(-C.bMax * 2, acc);
      car.acc = acc;
    }
    for (const car of this.cars) {
      const v1 = Math.max(0, car.v + car.acc * dt);
      car.s += (car.v + v1) / 2 * dt; car.v = v1;
      if (!car.passed && car.s > car.path.stopS) { car.passed = true; car.passT = this.t; }
      if (car.v < 0.3) { if (!car.stopped) { car.stops++; car.stopped = true; } } else if (car.v > 2) car.stopped = false;
      if (car.s >= car.path.length) {
        car.gone = true;
        const free = car.path.length / C.v0 + (car.path.move === 'T' ? 0 : 6);
        this.done.push({ t: this.t, delay: Math.max(0, this.t - car.t0 - free), stops: car.stops, from: car.path.from });
      }
    }
    this.cars = this.cars.filter(c => !c.gone);
  }

  // ---- 보행자 ----
  pedPos(p) {
    const cw = this.cws[p.cw], k = p.dir > 0 ? p.x : 1 - p.x;
    const along = [cw.a[0] + (cw.b[0] - cw.a[0]) * k, cw.a[1] + (cw.b[1] - cw.a[1]) * k];
    const u = OUT[p.cw];
    return { x: along[0] + u[0] * p.lat, y: along[1] + u[1] * p.lat };
  }
  stepPeds(dt) {
    for (const c of ['NE', 'NW', 'SE', 'SW']) {
      while (this.t >= this.nextPed[c]) {
        // 모서리에서 건널 수 있는 두 횡단보도 중 하나
        const cw = this.rand() < 0.5 ? c[0] : c[1];
        const sideSign = Math.sign(rightVec(OUT[cw])[0] * ((OUT[c[0] === cw ? c[1] : c[0]])[0]) + rightVec(OUT[cw])[1] * ((OUT[c[0] === cw ? c[1] : c[0]])[1]));
        const S = this.cfg.ped2.speed;
        this.peds.push({ id: this.id++, cw, dir: sideSign > 0 ? -1 : 1, x: 0, lat: (this.rand() - 0.5) * 2.4, state: 'wait', t0: this.nextPed[c],
          speed: S[0] + this.rand() * (S[1] - S[0]) });
        this.nextPed[c] = this.expo(this.cfg.ped) + (this.nextPed[c] - this.t);
      }
    }
    for (const p of this.peds) {
      if (p.state === 'wait' && this.pedSignal(p.cw) === 'W') { p.state = 'walk'; p.wait = this.t - p.t0; }
      if (p.state === 'walk') {
        p.x += p.speed * dt / this.cws[p.cw].length;
        if (p.x >= 1) { p.gone = true; this.pedDone.push({ t: this.t, wait: p.wait }); }
      }
    }
    this.peds = this.peds.filter(p => !p.gone);
  }

  step() {
    const dt = this.cfg.dt;
    this.events.length = 0;
    this.t += dt;
    this.updateSignal(dt);
    this.spawnArrivals();
    this.stepPeds(dt);
    this.stepCars(dt);
    if (Math.round(this.t * 10) % 50 === 0) this.record();            // 5초마다
  }

  // ---- 지표 ----
  queue(arm) {                                                        // 멈춰 있거나 아직 들어오지 못한 차
    return this.cars.filter(c => c.path.from === arm && !c.passed && c.v < 1).length + this.waiting[arm + '0'].length + this.waiting[arm + '1'].length;
  }
  stats(window = 300) {
    const t0 = this.t - window;
    const d = this.done.filter(x => x.t > t0), pd = this.pedDone.filter(x => x.t > t0);
    const avg = (a, k) => (a.length ? a.reduce((s, x) => s + x[k], 0) / a.length : NaN);
    return { delay: avg(d, 'delay'), stops: avg(d, 'stops'), flow: d.length * 3600 / Math.min(window, Math.max(this.t, 1)), pedWait: avg(pd, 'wait'), n: d.length };
  }
  record() {
    const s = this.stats();
    this.history.push({ t: Math.round(this.t), N: this.queue('N'), E: this.queue('E'), S: this.queue('S'), W: this.queue('W'), delay: s.delay, pedWait: s.pedWait, flow: s.flow });
    if (this.history.length > 2000) this.history.shift();
    if (this.done.length > 5000) this.done.splice(0, 1000);
    if (this.pedDone.length > 3000) this.pedDone.splice(0, 1000);
  }
}

function merge(base, over) {
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k], o = over[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? { ...b, ...(o || {}) } : (o ?? b);
  }
  return out;
}
