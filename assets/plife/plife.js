// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 입자 생명(Particle Life) 시뮬레이션 코어 (화면 없이 동작 → 테스트 가능)
//
// 규칙은 표 하나뿐이다: matrix[a][b] = "a 종류 입자가 b 종류 입자에게 느끼는 힘" (−1 밀침 … +1 끌림).
// 입자는 작용 거리 안의 이웃마다 그 값만큼 끌리거나 밀리고, 아주 가까우면 종류와 상관없이 서로 밀어낸다.
// 표가 대칭이 아니어도 된다 (a 는 b 를 쫓는데 b 는 a 에게서 달아남) → 스스로 움직이는 무리가 생긴다.
// 세계는 위아래 · 좌우가 이어진 도넛 모양(끝에서 나가면 반대쪽으로 들어옴). 단위: 거리 = 세계 단위, 시간 = 초

export const WORLD = { w: 240, h: 150 };
export const MAX_TYPES = 6;
export const BETA = 0.3;                 // 작용 거리의 이 비율 안쪽에서는 무조건 밀어냄 (입자가 한 점에 겹치지 않게)

// 시드 난수 (mulberry32): 같은 시드면 같은 배치 · 같은 규칙
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 거리(작용 거리에 대한 비율 0~1)와 규칙 값 a 로 정해지는 힘. 음수 = 밀침, 양수 = 끌림
//   0 … β   : −1 에서 0 으로 (가까울수록 세게 밀어냄, 규칙과 무관)
//   β … 1   : 가운데에서 a, 양 끝에서 0 인 삼각형
export function force(rn, a) {
  if (rn >= 1) return 0;
  if (rn < BETA) return rn / BETA - 1;
  return a * (1 - Math.abs(2 * rn - 1 - BETA) / (1 - BETA));
}

// 규칙 표 만들기. 모두 k×k, 값은 −1 … 1
export const PRESETS = {
  // 무작위: −1 … 1 고르게
  random: (k, rand) => Array.from({ length: k }, () => Array.from({ length: k }, () => Math.round((rand() * 2 - 1) * 20) / 20)),
  // 끼리끼리: 같은 종류끼리 끌리고 다른 종류는 약하게 밀어냄 → 색깔별 덩어리
  clusters: (k) => Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 0.8 : -0.3))),
  // 바람개비: 같은 종류끼리 뭉치고 다음 종류를 따라감 → 색 조각이 차례로 맞물려 도는 덩어리
  pinwheels: (k) => Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : j === (i + 1) % k ? 0.3 : 0))),
  // 쫓고 쫓기기: 다음 종류를 쫓고, 앞 종류에게서 달아남 (비대칭) → 돌아다니는 무리
  chase: (k) => Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 0.4 : j === (i + 1) % k ? 0.7 : j === (i + k - 1) % k ? -0.6 : 0))),
  // 규칙 없음: 모두 0 → 가까이에서 밀어내는 힘만 남아 고르게 퍼진 기체
  none: (k) => Array.from({ length: k }, () => Array(k).fill(0))
};

export class ParticleLife {
  constructor(opts = {}) {
    this.opts = { n: 900, types: 5, radius: 12, halfLife: 0.04, strength: 10, seed: 1, preset: 'random', ...opts };
    this.reset();
  }

  // 처음부터: 규칙 표와 입자 배치를 시드로 다시 만든다
  reset() {
    const o = this.opts;
    this.rand = rng(o.seed);
    this.matrix = PRESETS[o.preset](o.types, rng(o.seed * 7919 + 13));
    this.n = 0; this.tick = 0;
    this.x = new Float32Array(0); this.y = new Float32Array(0); this.vx = new Float32Array(0); this.vy = new Float32Array(0); this.type = new Uint8Array(0);
    this.setCount(o.n);
  }

  // 입자를 다시 뿌린다 (규칙 표는 그대로): 같은 규칙이 다른 출발점에서도 같은 모양을 만드는지 볼 때
  scatter() {
    for (let i = 0; i < this.n; i++) { this.x[i] = this.rand() * WORLD.w; this.y[i] = this.rand() * WORLD.h; this.vx[i] = this.vy[i] = 0; }
    this.tick = 0;
  }

  // 입자 수 바꾸기: 늘리면 무작위 위치에 추가, 줄이면 뒤에서부터 뺌
  setCount(n) {
    const grow = (a, T) => { const b = new T(n); b.set(a.subarray(0, Math.min(n, a.length))); return b; };
    this.x = grow(this.x, Float32Array); this.y = grow(this.y, Float32Array); this.vx = grow(this.vx, Float32Array); this.vy = grow(this.vy, Float32Array); this.type = grow(this.type, Uint8Array);
    for (let i = this.n; i < n; i++) { this.x[i] = this.rand() * WORLD.w; this.y[i] = this.rand() * WORLD.h; this.vx[i] = this.vy[i] = 0; this.type[i] = i % this.opts.types; }
    this.n = this.opts.n = n;
  }

  // 종류 수 바꾸기: 규칙 표를 새 크기로 (겹치는 칸은 그대로, 새 칸은 0), 입자는 종류를 다시 나눔
  setTypes(k) {
    const old = this.matrix;
    this.matrix = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => old[i]?.[j] ?? 0));
    this.opts.types = k;
    for (let i = 0; i < this.n; i++) this.type[i] = i % k;
  }

  setPreset(name, seed = this.opts.seed) {
    this.opts.preset = name; this.opts.seed = seed;
    this.matrix = PRESETS[name](this.opts.types, rng(seed * 7919 + 13));
  }

  // 한 틱. 이웃 찾기는 작용 거리 크기의 칸으로 나눈 격자를 써서 가까운 칸만 본다
  step(dt = 0.02) {
    const { radius: R, halfLife, strength } = this.opts, { x, y, vx, vy, type, n, matrix } = this;
    const W = WORLD.w, H = WORLD.h, cols = Math.max(1, Math.floor(W / R)), rows = Math.max(1, Math.floor(H / R)), cw = W / cols, ch = H / rows;
    const head = new Int32Array(cols * rows).fill(-1), next = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = Math.min(cols - 1, Math.floor(x[i] / cw)) + Math.min(rows - 1, Math.floor(y[i] / ch)) * cols;
      next[i] = head[c]; head[c] = i;
    }
    const friction = Math.pow(0.5, dt / halfLife), R2 = R * R, gain = strength * R * dt;
    let neigh = 0, same = 0;
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cols - 1, Math.floor(x[i] / cw)), cy = Math.min(rows - 1, Math.floor(y[i] / ch)), row = matrix[type[i]];
      let fx = 0, fy = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if ((cols < 3 && ox > cols - 2) || (rows < 3 && oy > rows - 2)) continue;       // 아주 작은 격자에서 같은 칸을 두 번 보지 않게
        for (let j = head[(cx + ox + cols) % cols + ((cy + oy + rows) % rows) * cols]; j >= 0; j = next[j]) {
          if (j === i) continue;
          let dx = x[j] - x[i], dy = y[j] - y[i];
          if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;                        // 도넛 세계: 가까운 쪽으로
          if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
          const d2 = dx * dx + dy * dy;
          if (d2 >= R2 || d2 === 0) continue;
          const d = Math.sqrt(d2), f = force(d / R, row[type[j]]);
          fx += f * dx / d; fy += f * dy / d;
          neigh++; if (type[j] === type[i]) same++;
        }
      }
      vx[i] = vx[i] * friction + fx * gain;
      vy[i] = vy[i] * friction + fy * gain;
    }
    let speed = 0;
    for (let i = 0; i < n; i++) {
      x[i] = ((x[i] + vx[i] * dt) % W + W) % W;
      y[i] = ((y[i] + vy[i] * dt) % H + H) % H;
      speed += Math.hypot(vx[i], vy[i]);
    }
    this.tick++;
    // 통계: 평균 속력, 입자 하나가 작용 거리 안에 둔 이웃 수, 그 가운데 같은 종류의 비율
    this.last = { speed: n ? speed / n : 0, neighbours: n ? neigh / n : 0, sameShare: neigh ? same / neigh : 0 };
    return this.last;
  }

  // 입자가 고르게 퍼져 있을 때 기대되는 이웃 수 (무리 짓기의 기준선)
  uniformNeighbours() { return (this.n - 1) * Math.PI * this.opts.radius ** 2 / (WORLD.w * WORLD.h); }
}
