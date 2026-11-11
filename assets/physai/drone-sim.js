// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// NEAT 드론 시뮬레이션 코어 (화면 없이도 동작 → 테스트·빠른 학습 가능)
//
//  - 옆에서 본 2차원 세계 WORLD.w × WORLD.h (m). y는 위쪽이 +, 중력은 아래로
//  - 드론: 몸체 하나에 좌우 프로펠러 둘. 두 추력의 합이 몸체 위쪽으로 미는 힘, 차이가 기울이는 힘(토크)
//    기울기 th는 오른쪽으로 기울 때 +. 가만히 두면 떨어지므로 "균형을 잡으면서 이동"을 배워야 한다
//  - 입력 7개: 다음 경유점까지 가로·세로 거리, 가로·세로 속도, 기울기(sin·cos), 회전 속도
//  - 출력 2개: 왼쪽·오른쪽 프로펠러 추력 (tanh −1…1 → 0…1)
//  - 적합도: 통과한 경유점 × 100 + 다음 경유점에 가까워진 정도 × 60 + 버틴 시간 약간
//    (떠 있기만 해서는 거의 오르지 않음), 경유점 없이 STARVE 초가 지나면 끝
//  - 경유점 위치는 시드 난수 → 같은 세대의 모든 드론이 같은 코스로 겨룬다

export const WORLD = { w: 100, h: 70, dt: 1 / 30 };
export const DRONE = {
  g: 9.8,            // 중력 가속도 (m/s²)
  thrust: 9.8,       // 프로펠러 하나의 최대 가속도. 둘 다 절반(0.5)이면 정확히 떠 있음, 둘 다 최대면 2g
  torque: 12,        // 추력 차이 1당 각가속도 (rad/s²)
  spinDrag: 5,       // 회전 감쇠 (1/s). 작으면 조금만 잘못 밀어도 뒤집혀 배우기 어렵다
  drag: 0.6,         // 공기저항 (1/s)
  arm: 2.2,          // 그릴 때 쓰는 팔 길이 (m)
  flip: 1.9,         // 이보다 더 기울면(약 109°) 뒤집힌 것으로 봄 (rad)
  reach: 3.5,        // 경유점에 닿았다고 보는 거리 (m)
  starve: 15,        // 경유점에 닿지 못하고 버틸 수 있는 시간 (초). 8초로 하면 처음 몇 세대가 거의 배우지 못한다
  maxTime: 60        // 한 번 비행의 최대 시간 (초)
};
export const FIT = { point: 100, approach: 60, time: 0.6 };   // time: 초당
export const N_INPUTS = 7, N_OUTPUTS = 2;
export const INPUT_LABELS = ['경유점 가로', '경유점 세로', '가로 속도', '세로 속도', '기울기 sin', '기울기 cos', '회전 속도'];
export const INPUT_LABELS_EN = ['target dx', 'target dy', 'speed x', 'speed y', 'tilt sin', 'tilt cos', 'spin'];
export const OUTPUT_LABELS = ['왼쪽 추력', '오른쪽 추력'];
export const OUTPUT_LABELS_EN = ['left thrust', 'right thrust'];

// 시드 난수 (mulberry32) — 같은 시드면 같은 코스
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

// 코스: 시드로 정해지는 경유점 순서. 필요한 만큼만 만들어 둔다 (모든 드론이 같은 순서를 본다)
export class Course {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    this.points = [];
    this.start = { x: WORLD.w / 2, y: WORLD.h / 2 };
  }
  point(i) {
    while (this.points.length <= i) {
      const prev = this.points.at(-1) || this.start;
      let p;
      for (let k = 0; k < 50; k++) {                        // 앞 경유점에서 너무 가깝지도 멀지도 않게
        p = { x: 12 + this.rand() * (WORLD.w - 24), y: 12 + this.rand() * (WORLD.h - 24) };
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (d >= 18 && d <= 55) break;
      }
      this.points.push(p);
    }
    return this.points[i];
  }
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Drone {
  constructor(course, genome = null, wind = 0) {
    this.course = course; this.genome = genome; this.wind = wind;
    this.x = course.start.x; this.y = course.start.y;
    this.vx = 0; this.vy = 0; this.th = 0; this.om = 0;
    this.left = 0.5; this.right = 0.5;                     // 지금 추력 (그리기용)
    this.score = 0;                                        // 통과한 경유점 수
    this.t = 0; this.since = 0;                            // 전체 시간, 마지막 경유점 뒤로 지난 시간 (초)
    this.alive = true; this.cause = null;                  // 'out' | 'flip' | 'starve' | 'timeout'
    this.d0 = this.dist();                                 // 이번 경유점을 향해 출발할 때의 거리
    this.best = this.d0;                                   // 이번 경유점에 가장 가까웠던 거리
  }
  get target() { return this.course.point(this.score); }
  dist() { const p = this.target; return Math.hypot(p.x - this.x, p.y - this.y); }
}

// 신경망 입력 7개 (모두 대략 −1…1)
export function sense(d) {
  const p = d.target;
  return [
    clamp((p.x - d.x) / 40, -1, 1), clamp((p.y - d.y) / 40, -1, 1),
    clamp(d.vx / 15, -1, 1), clamp(d.vy / 15, -1, 1),
    Math.sin(d.th), Math.cos(d.th), clamp(d.om / 4, -1, 1)
  ];
}

// 추력 두 개(0…1)를 받아 한 틱 진행
export function step(d, left, right) {
  if (!d.alive) return;
  const dt = WORLD.dt;
  d.left = clamp(left, 0, 1); d.right = clamp(right, 0, 1);
  const f = (d.left + d.right) * DRONE.thrust;
  const ax = f * Math.sin(d.th) - DRONE.drag * d.vx + d.wind;
  const ay = f * Math.cos(d.th) - DRONE.g - DRONE.drag * d.vy;
  const al = (d.left - d.right) * DRONE.torque - DRONE.spinDrag * d.om;   // 왼쪽이 세면 오른쪽으로 기움
  d.vx += ax * dt; d.vy += ay * dt; d.om += al * dt;
  d.x += d.vx * dt; d.y += d.vy * dt; d.th += d.om * dt;
  d.t += dt; d.since += dt;

  let dist = d.dist();
  if (dist < d.best) d.best = dist;
  if (dist <= DRONE.reach) {                               // 경유점 통과 → 다음 경유점
    d.score++; d.since = 0;
    d.d0 = d.dist(); d.best = d.d0;
  }
  if (d.x < 0 || d.x > WORLD.w || d.y < 0 || d.y > WORLD.h) { d.alive = false; d.cause = 'out'; }
  else if (Math.abs(d.th) > DRONE.flip) { d.alive = false; d.cause = 'flip'; }
  else if (d.since >= DRONE.starve) { d.alive = false; d.cause = 'starve'; }
  else if (d.t >= DRONE.maxTime) { d.alive = false; d.cause = 'timeout'; }
}

// 신경망이 보고 → 추력을 정하고 → 한 틱
export function decide(genome, d) {
  const out = genome.network().activate(sense(d));
  return [(out[0] + 1) / 2, (out[1] + 1) / 2];
}
export function stepDrone(d) { if (d.alive) { const [l, r] = decide(d.genome, d); step(d, l, r); } }

export const flightFitness = (d) =>
  d.score * FIT.point + Math.max(0, 1 - d.best / d.d0) * FIT.approach + Math.min(d.t, 20) * FIT.time;

// 한 번의 비행을 끝까지 (화면 없이)
export function fly(genome, seed, wind = 0) {
  const d = new Drone(new Course(seed), genome, wind);
  while (d.alive) stepDrone(d);
  return d;
}

// 세대 학습기. 150대가 같은 코스를 동시에 날고, 모두 끝나면 다음 코스로 (trials번) → 평균 적합도
// (코스 3개의 평균으로 뽑아야 낯선 코스에서도 나는 드론이 남는다. 2개면 그 세대 코스에만 맞는 드론이 자주 뽑힘)
// 같은 세대에서는 모두 같은 코스 → 공정한 비교, 세대마다 코스가 바뀜 → 특정 코스 암기 방지
export class Trainer {
  constructor(Population, opts = {}) {
    this.opts = { popSize: 150, trials: 3, seed: 1, wind: 0, ...opts };
    // 변이를 약하게: 균형 제어는 가중치가 조금만 틀어져도 추락하므로, 기본값(세기 0.5 · 새 값으로 바꾸기 10%)으로는
    // 잘 나는 부모의 자손이 대부분 떨어진다. 약하게 하면 더 빨리 배우고 개체군 평균도 올라간다
    this.pop = new Population({ popSize: this.opts.popSize, nInputs: N_INPUTS, nOutputs: N_OUTPUTS, championPerGeneration: true,
      weightPerturb: 0.2, weightReplaceRate: 0.03 });
    this.bestScore = 0;       // 지금까지 한 번의 비행에서 통과한 최다 경유점
    this.bestFlight = null;   // { genome, seed, score, gen } 다시 보기용
    this.reset();
  }
  seedFor(trial) { return (this.opts.seed * 7919 + this.pop.generation * 101 + trial) >>> 0; }
  reset() {
    this.trial = 0;
    this.agents = this.pop.genomes.map(g => ({ genome: g, total: 0, scores: [], drone: null }));
    this.speciesOf = new Map();
    for (const s of this.pop.species) for (const g of s.members) this.speciesOf.set(g, s.id);
    this.startTrial();
  }
  startTrial() {
    this.course = new Course(this.seedFor(this.trial));
    for (const a of this.agents) a.drone = new Drone(this.course, a.genome, this.opts.wind);
    this.step = 0;
  }
  get alive() { return this.agents.filter(a => a.drone.alive).length; }
  // 지금 화면에서 강조할 대표: 날고 있는 드론 중 가장 앞선 드론
  leader() {
    let best = null, bv = -1;
    for (const a of this.agents) if (a.drone.alive) {
      const d = a.drone, v = d.score + Math.max(0, 1 - d.dist() / d.d0) * 0.99;
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }
  // 모든 드론을 한 틱. 코스 하나가 끝나면 'trial', 세대가 끝나면 'round'
  tick() {
    let alive = 0;
    for (const a of this.agents) {
      const d = a.drone;
      if (!d.alive) continue;
      stepDrone(d);
      if (d.alive) { alive++; continue; }
      a.total += flightFitness(d); a.scores.push(d.score);
      if (d.score > this.bestScore || !this.bestFlight) {
        this.bestScore = Math.max(this.bestScore, d.score);
        this.bestFlight = { genome: a.genome.clone(), seed: this.course.seed, score: d.score, gen: this.pop.generation + 1 };
      }
    }
    this.step++;
    if (alive) return false;
    if (++this.trial < this.opts.trials) { this.startTrial(); return 'trial'; }
    this.endGeneration();
    return 'round';
  }
  // 화면 없이 한 세대를 끝까지
  runGeneration() { while (this.tick() !== 'round'); return this.pop.history.at(-1); }
  endGeneration() {
    const scores = this.agents.flatMap(a => a.scores);
    this.lastGen = { bestScore: Math.max(...scores), meanScore: scores.reduce((x, y) => x + y, 0) / scores.length };
    for (const a of this.agents) a.genome.fitness = a.total / this.opts.trials;
    this.pop.evolve();
    Object.assign(this.pop.history.at(-1), this.lastGen);
    this.reset();
  }
  // 최고 기록 비행을 같은 코스로 다시 (바람은 지금 설정대로)
  replay() { return this.bestFlight ? new Drone(new Course(this.bestFlight.seed), this.bestFlight.genome, this.opts.wind) : null; }
}
