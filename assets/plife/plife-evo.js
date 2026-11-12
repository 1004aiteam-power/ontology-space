// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 입자 생명 — 살아 있는 세계: 에너지 · 번식 · 죽음 · 유전되는 규칙 (화면 없이 동작 → 테스트 가능)
//
// 고정 규칙 세계(plife.js)와 힘의 모양은 같다. 달라지는 것은 세 가지:
//   1) 에너지   입자마다 에너지가 있다. 빛에서 얻고(붐빌수록 적게), 살아 있는 것만으로 쓰고, 빨리 움직일수록 더 쓴다.
//               색 a 는 다음 색 a+1 을 먹는다: 아주 가까이 있으면 그 입자의 에너지를 빼앗는다 (먹이사슬이 한 바퀴 도는 고리)
//   2) 번식 · 죽음   에너지가 차면 둘로 나뉘고(에너지도 반씩), 바닥나면 사라진다
//   3) 유전   규칙 표가 세계에 하나 있는 것이 아니라, 입자마다 자기 가로줄(유전자)을 갖는다.
//             나뉠 때 자식은 부모의 유전자를 조금 바뀐 채로 물려받는다 → 잘 먹고 잘 피하는 유전자가 늘어난다
// 화면의 규칙 표는 이제 사람이 정한 값이 아니라 "지금 살아 있는 입자들의 유전자 평균"이다.
import { WORLD, MAX_TYPES, force, rng } from './plife.js?v=d3a2454c';

export const CAP = 2600;                 // 입자 수 상한 (배열 크기)
export const DEFAULTS = {
  n: 600, types: 3, radius: 12, halfLife: 0.04, strength: 10, seed: 1,
  sun: 0.55,          // 빛에서 얻는 에너지 (초당, 주변이 비었을 때)
  shade: 8,           // 이웃이 이만큼이면 빛이 절반으로 (붐비면 서로 그늘을 만든다)
  basal: 0.25,        // 살아 있는 것만으로 쓰는 에너지 (초당)
  moveCost: 0.004,    // 움직임 비용 = 이 값 × 속력² (초당)
  eatRange: 0.35,     // 먹을 수 있는 거리 (작용 거리에 대한 비율)
  bite: 1.6,          // 먹이 하나에서 빼앗는 에너지 (초당)
  gain: 0.7,          // 빼앗은 것 가운데 자기 것이 되는 비율
  birth: 4,           // 이 에너지에 이르면 나뉜다
  start: 2,           // 처음 에너지
  mutation: 0.08,     // 물려줄 때 유전자가 바뀌는 크기 (표준편차)
  genes: 'blank'      // 처음 유전자: 'blank' 모두 0 (아무 규칙 없이 시작) · 'random' 무작위
};

export class LivingWorld {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    const o = this.opts, K = MAX_TYPES;
    this.rand = rng(o.seed);
    this.n = 0; this.tick = 0; this.births = 0; this.deaths = 0; this.arrivals = 0;
    this.x = new Float32Array(CAP); this.y = new Float32Array(CAP); this.vx = new Float32Array(CAP); this.vy = new Float32Array(CAP);
    this.e = new Float32Array(CAP); this.type = new Uint8Array(CAP); this.gen = new Uint16Array(CAP);
    this.genes = new Float32Array(CAP * K);            // 입자 i 의 유전자 = genes[i*K … i*K+types-1]: 각 색에게 느끼는 힘
    this.dE = new Float32Array(CAP);
    this.history = [];
    for (let i = 0; i < o.n; i++) this.add(i % o.types);
    this.record();
  }

  gauss() { return Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand()); }
  prey(t) { return (t + 1) % this.opts.types; }                              // t 가 먹는 색
  predator(t) { return (t + this.opts.types - 1) % this.opts.types; }        // t 를 먹는 색

  // 새 입자 (처음 뿌릴 때, 한 색이 모두 사라져 바깥에서 들어올 때)
  add(type) {
    if (this.n >= CAP) return -1;
    const i = this.n++, K = MAX_TYPES, o = this.opts;
    this.x[i] = this.rand() * WORLD.w; this.y[i] = this.rand() * WORLD.h; this.vx[i] = this.vy[i] = 0;
    this.e[i] = o.start; this.type[i] = type; this.gen[i] = 0;
    for (let g = 0; g < K; g++) this.genes[i * K + g] = o.genes === 'random' && g < o.types ? this.rand() * 2 - 1 : 0;
    return i;
  }

  remove(i) {                                   // 마지막 입자를 이 자리로 옮겨 빈칸을 메움
    const j = --this.n, K = MAX_TYPES;
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
    this.e[i] = this.e[j]; this.type[i] = this.type[j]; this.gen[i] = this.gen[j];
    this.genes.copyWithin(i * K, j * K, j * K + K);
  }

  divide(i) {
    if (this.n >= CAP) return;
    const c = this.n++, K = MAX_TYPES, o = this.opts, a = this.rand() * 6.2832;
    this.e[i] /= 2; this.e[c] = this.e[i];
    this.x[c] = ((this.x[i] + Math.cos(a) * 1.5) % WORLD.w + WORLD.w) % WORLD.w;
    this.y[c] = ((this.y[i] + Math.sin(a) * 1.5) % WORLD.h + WORLD.h) % WORLD.h;
    this.vx[c] = this.vx[i]; this.vy[c] = this.vy[i];
    this.type[c] = this.type[i]; this.gen[c] = Math.min(65535, this.gen[i] + 1);
    for (let g = 0; g < K; g++) {
      const v = g < o.types ? this.genes[i * K + g] + this.gauss() * o.mutation : 0;      // 물려받되 조금 바뀜
      this.genes[c * K + g] = Math.max(-1, Math.min(1, v));
    }
    this.births++;
  }

  step(dt = 0.02) {
    const o = this.opts, { x, y, vx, vy, e, type, genes, dE } = this, K = MAX_TYPES, R = o.radius, n = this.n;
    const W = WORLD.w, H = WORLD.h, cols = Math.max(1, Math.floor(W / R)), rows = Math.max(1, Math.floor(H / R)), cw = W / cols, ch = H / rows;
    const head = new Int32Array(cols * rows).fill(-1), next = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = Math.min(cols - 1, Math.floor(x[i] / cw)) + Math.min(rows - 1, Math.floor(y[i] / ch)) * cols;
      next[i] = head[c]; head[c] = i; dE[i] = 0;
    }
    const friction = Math.pow(0.5, dt / o.halfLife), R2 = R * R, push = o.strength * R * dt, eat2 = (o.eatRange * R) ** 2, biteDt = o.bite * dt;
    let neigh = 0, eaten = 0;
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cols - 1, Math.floor(x[i] / cw)), cy = Math.min(rows - 1, Math.floor(y[i] / ch)), gi = i * K, food = this.prey(type[i]);
      let fx = 0, fy = 0, crowd = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if ((cols < 3 && ox > cols - 2) || (rows < 3 && oy > rows - 2)) continue;
        for (let j = head[(cx + ox + cols) % cols + ((cy + oy + rows) % rows) * cols]; j >= 0; j = next[j]) {
          if (j === i) continue;
          let dx = x[j] - x[i], dy = y[j] - y[i];
          if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
          if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
          const d2 = dx * dx + dy * dy;
          if (d2 >= R2 || d2 === 0) continue;
          const d = Math.sqrt(d2), f = force(d / R, genes[gi + type[j]]);
          fx += f * dx / d; fy += f * dy / d; crowd++;
          if (type[j] === food && d2 < eat2 && type[j] !== type[i]) {          // 먹기: 아주 가까운 먹이 색에서 에너지를 빼앗음
            const take = Math.min(biteDt, Math.max(0, e[j] + dE[j]));
            dE[j] -= take; dE[i] += take * o.gain; eaten += take;
          }
        }
      }
      neigh += crowd;
      vx[i] = vx[i] * friction + fx * push;
      vy[i] = vy[i] * friction + fy * push;
      // 에너지: 빛(붐빌수록 적음) − 기초대사 − 움직임
      dE[i] += (o.sun / (1 + crowd / o.shade) - o.basal - o.moveCost * (vx[i] * vx[i] + vy[i] * vy[i])) * dt;
    }
    for (let i = 0; i < n; i++) {
      x[i] = ((x[i] + vx[i] * dt) % W + W) % W;
      y[i] = ((y[i] + vy[i] * dt) % H + H) % H;
      e[i] += dE[i];
    }
    for (let i = this.n - 1; i >= 0; i--) if (e[i] <= 0) { this.remove(i); this.deaths++; }      // 죽음 (뒤에서부터)
    for (let i = 0, m = this.n; i < m; i++) if (e[i] >= o.birth) this.divide(i);                 // 번식
    // 한 색이 모두 사라지면 바깥에서 몇 개가 들어온다 (먹이사슬 고리가 끊기지 않게). 유전자는 처음 상태
    const count = this.counts();
    for (let t = 0; t < o.types; t++) if (count[t] === 0) for (let k = 0; k < 6; k++) { if (this.add(t) >= 0) this.arrivals++; }
    this.tick++;
    this.last = { neighbours: n ? neigh / n : 0, eaten };
    if (this.tick % 50 === 0) this.record();
    return this.last;
  }

  counts() { const c = new Array(this.opts.types).fill(0); for (let i = 0; i < this.n; i++) c[this.type[i]]++; return c; }

  // 지금 살아 있는 입자들의 유전자 평균 = 화면에 보이는 규칙 표 (가로줄 = 느끼는 색, 세로줄 = 상대 색)
  meanMatrix() {
    const k = this.opts.types, K = MAX_TYPES, sum = Array.from({ length: k }, () => new Array(k).fill(0)), cnt = this.counts();
    for (let i = 0; i < this.n; i++) { const row = sum[this.type[i]]; for (let g = 0; g < k; g++) row[g] += this.genes[i * K + g]; }
    return sum.map((row, t) => row.map(v => (cnt[t] ? v / cnt[t] : 0)));
  }

  // 세 가지 유전자의 평균: 먹이에게 느끼는 힘 · 포식자에게 느끼는 힘 · 같은 색에게 느끼는 힘
  traits() {
    const K = MAX_TYPES; let chase = 0, flee = 0, self = 0, gen = 0, energy = 0;
    for (let i = 0; i < this.n; i++) {
      const t = this.type[i];
      chase += this.genes[i * K + this.prey(t)]; flee += this.genes[i * K + this.predator(t)]; self += this.genes[i * K + t];
      gen += this.gen[i]; energy += this.e[i];
    }
    const n = this.n || 1;
    return { chase: chase / n, flee: flee / n, self: self / n, generation: gen / n, energy: energy / n };
  }

  record() {
    this.history.push({ tick: this.tick, counts: this.counts(), ...this.traits() });
    if (this.history.length > 600) this.history.shift();
  }

  // 사람이 끼어들기: 한 색 전체의 유전자 한 칸을 더하거나 뺀다 (화면의 규칙 표를 눌렀을 때)
  nudge(t, g, delta) {
    const K = MAX_TYPES;
    for (let i = 0; i < this.n; i++) if (this.type[i] === t) this.genes[i * K + g] = Math.max(-1, Math.min(1, this.genes[i * K + g] + delta));
  }
}
