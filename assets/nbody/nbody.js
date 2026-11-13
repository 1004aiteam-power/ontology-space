// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 별과 행성의 탄생: 2차원 N체 중력 + 충돌 병합 + 가스 항력 + 얼음선. 화면(DOM)이 없는 계산만 담았다
//
// 단위: 거리 AU, 질량 태양 질량, 시간 년. 이 단위에서 중력 상수 G = 4π².
// 교육용 단순 모델이다. 구름 속 가스는 입자로 그리지 않고 (1) 별이 자라는 양 (2) 먼지를 끄는 항력 (3) 거대 행성이 빨아들일 재료로만 다룬다.

export const G = 4 * Math.PI * Math.PI;
export const M_EARTH = 3.003e-6;          // 지구 질량 (태양 질량 단위)
export const M_JUPITER = 9.546e-4;
export const M_IGNITE = 0.08;             // 수소 핵융합이 시작되는 최소 질량 (갈색 왜성 경계)
export const R_STAR = 0.2;                // 별에 닿았다고 보는 반지름 (AU). 실제 별은 훨씬 작지만 화면 · 계산 단계에 맞춘 값
const EPS2 = 0.02 * 0.02;                 // 중력 완화 (가까운 만남에서 힘이 무한대로 커지지 않게)
const M_HEAVY = 1e-4;                     // 이보다 무거우면 모든 천체와 중력을 주고받는다 (가벼운 것끼리는 이웃과만)
const M_GIANT = 1e-4;                     // 가스가 많아도 이보다 가벼우면 가스 거인이 아니라 해왕성 같은 얼음 행성으로 센다 (약 33 지구 질량)
const M_REF = 1e-5;                       // 충돌 반지름 · 항력의 기준 질량
const CELL = 2;                           // 이웃 찾기 격자 한 칸 (AU)
const SEED = 0.01;                        // 처음 씨앗이 가진 질량 (구름 총 질량의 비율). 나머지는 구름에서 떨어져 내림
const GAS_FOR_PLANETS = 0.3;             // 원반 가스 가운데 거대 행성이 가져갈 수 있는 몫 (나머지는 별로 떨어지거나 흩어짐)
const R_INNER = 0.45;                     // 먼지 원반의 안쪽 가장자리 (AU)

export const DEFAULTS = {
  seed: 1,
  N: 700,            // 먼지 · 얼음 알갱이(미행성) 수
  mass: 1,           // 구름이 결국 별에 보태는 총 질량 (태양 질량)
  stars: 1,          // 씨앗 별 수 (1 또는 2 = 쌍성)
  q: 0.35,           // 쌍성일 때 동반성이 가져갈 질량 비율
  metal: 0.004,      // 고체(먼지 · 얼음) 질량 비율
  gasFrac: 0.02,     // 원반 가스 질량 비율
  rOut: 35,          // 원반 바깥 반지름 (AU)
  frost: 2.7,        // 얼음선 (AU): 이 밖에서는 얼음이 얼어 고체가 늘어남
  spin: 1,        // 구름 가스의 회전 속도 (케플러 속도의 몇 배)
  drag: 1,           // 가스 항력 세기
  tDisp: 250,        // 가스가 걷히는 시간 (년)
  tInfall: 60,       // 구름이 별로 떨어지는 시간 (년)
  stick: 1,          // 병합 반지름 배율 (클수록 잘 뭉침)
  dt: 0.01           // 계산 한 단계 (년)
};

// 씨드를 주면 같은 결과가 나오는 난수
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Nbody {
  constructor(opts = {}) {
    const o = this.o = { ...DEFAULTS, ...opts };
    this.cap = o.N + 8;
    const F = () => new Float64Array(this.cap);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F(); this.ax = F(); this.ay = F();
    this.m = F(); this.ice = F(); this.gm = F();             // 질량 · 얼음 비율 · 삼킨 가스 질량
    this.starShare = new Float64Array(this.cap);
    this.id = new Int32Array(this.cap); this.merges = new Int32Array(this.cap);
    this.kind = new Uint8Array(this.cap); this.dead = new Uint8Array(this.cap);
    this.heavy = new Uint8Array(this.cap); this.next = new Int32Array(this.cap);
    this.n = 0; this.t = 0; this.nextId = 0;
    this.rand = rng(o.seed); this.lit = {};
    this.ejected = 0; this.swallowed = 0; this.mergeCount = 0; this.ejectedMass = 0;
    this.events = [];
    this.rEsc = 6 * o.rOut;
    this.ext = 3 * o.rOut;
    this.D = Math.ceil(2 * this.ext / CELL) + 2;
    this.head = new Int32Array(this.D * this.D);
    this.#init();
  }

  #add(x, y, vx, vy, m, kind, ice = 0) {
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.m[i] = m;
    this.kind[i] = kind; this.starShare[i] = 0; this.ice[i] = ice; this.gm[i] = 0; this.merges[i] = 0; this.dead[i] = 0; this.id[i] = this.nextId++;
    return i;
  }

  #init() {
    const o = this.o, two = o.stars === 2, seed = SEED * o.mass;
    const share = two ? [1 - o.q, o.q] : [1], rnd = this.rand;
    this.share = share;
    const m0 = share.map(s => o.mass * s);                    // 중력은 처음부터 구름 전체 질량이 중심에 모인 것처럼 (아직 별이 되지 못한 가스의 중력 포함)
    const mt = o.mass;
    if (two) {                                                // 쌍성: 서로의 둘레를 원 궤도로 도는 두 씨앗
      const sep = Math.max(6, 0.45 * o.rOut), v = Math.sqrt(G * mt / sep);
      this.#add(0, 0, 0, -v * m0[1] / mt, m0[0], 1);
      this.#add(sep, 0, 0, v * m0[0] / mt, m0[1], 1);
    } else this.#add(0, 0, 0, 0, m0[0], 1);
    this.nStars = this.n;
    for (let i = 0; i < this.n; i++) this.starShare[i] = share[i];
    this.#recentre();
    this.gas0 = o.gasFrac * o.mass; this.gasUsed = 0;
    const mp = o.metal * o.mass / o.N;
    for (let k = 0; k < o.N; k++) {
      const q0 = Math.sqrt(R_INNER), r = (q0 + (Math.sqrt(o.rOut) - q0) * rnd()) ** 2, a = 2 * Math.PI * rnd();   // 면밀도 ∝ r^-1.5 (안쪽일수록 촘촘)
      const icy = r > o.frost ? 0.5 : 0, vk = o.spin * Math.sqrt(G * mt / r);
      const jitter = 0.02 * vk, ja = 2 * Math.PI * rnd();
      const m = mp * (0.4 + 1.2 * rnd()) * (icy ? 3 : 1);     // 얼음선 밖에서는 얼음이 얼어 붙어 같은 자리의 고체가 서너 배
      this.#add(r * Math.cos(a), r * Math.sin(a), -vk * Math.sin(a) + jitter * Math.cos(ja), vk * Math.cos(a) + jitter * Math.sin(ja), m, 0, icy);
    }
    this.mAvg = this.m.slice(this.nStars, this.n).reduce((a, b) => a + b, 0) / o.N;
    this.#grid(); this.#accel();
  }

  // 별들의 질량 중심을 원점에 · 전체 운동량은 0으로
  #recentre() {
    let M = 0, cx = 0, cy = 0, px = 0, py = 0;
    for (let i = 0; i < this.n; i++) { const m = this.m[i]; M += m; cx += m * this.x[i]; cy += m * this.y[i]; px += m * this.vx[i]; py += m * this.vy[i]; }
    cx /= M; cy /= M; px /= M; py /= M;
    for (let i = 0; i < this.n; i++) { this.x[i] -= cx; this.y[i] -= cy; this.vx[i] -= px; this.vy[i] -= py; }
  }

  // ---- 읽기 -----------------------------------------------------------------------
  cloudLeft() { return this.o.mass * (1 - SEED) * Math.exp(-this.t / this.o.tInfall); }          // 아직 별에 떨어지지 못한 구름 질량
  starVisible(i) { return Math.max(0, this.m[i] - this.starShare[i] * this.cloudLeft()); }
  starMass() { let s = 0; for (let i = 0; i < this.n; i++) if (this.kind[i] === 1) s += this.starVisible(i); return s; }   // 지금까지 별이 모은 질량
  starDyn() { let s = 0; for (let i = 0; i < this.n; i++) if (this.kind[i] === 1) s += this.m[i]; return s; }          // 중력을 주는 질량
  gasMass() { return Math.max(0, this.gas0 * Math.exp(-this.t / this.o.tDisp) - this.gasUsed); }   // 원반에 남은 가스 (항력의 세기를 정함)
  gasFrac() { return this.gas0 > 0 ? this.gasMass() / this.gas0 : 0; }
  radius(i) { return this.kind[i] === 1 ? R_STAR : this.o.stick * 0.012 * Math.cbrt(this.m[i] / M_REF); }

  // 종류: star(별) · protostar(점화 전) · gas(가스 거인) · ice(얼음 행성) · rock(암석 행성) · dust(아직 합쳐지지 않은 알갱이)
  classify(i) {
    if (this.kind[i] === 1) return this.starVisible(i) >= M_IGNITE ? 'star' : 'protostar';
    if (this.gm[i] > 0.3 * this.m[i] && this.m[i] >= M_GIANT) return 'gas';
    if (this.merges[i] === 0) return 'dust';
    return this.ice[i] > 0.3 ? 'ice' : 'rock';
  }

  // 별 무리(질량 중심)에 대한 반장축 · 이심률. 묶여 있지 않으면 a 는 null
  orbit(i) {
    let M = 0, cx = 0, cy = 0, cvx = 0, cvy = 0;
    for (let s = 0; s < this.n; s++) if (this.kind[s] === 1) { const m = this.m[s]; M += m; cx += m * this.x[s]; cy += m * this.y[s]; cvx += m * this.vx[s]; cvy += m * this.vy[s]; }
    cx /= M; cy /= M; cvx /= M; cvy /= M;
    const dx = this.x[i] - cx, dy = this.y[i] - cy, dvx = this.vx[i] - cvx, dvy = this.vy[i] - cvy;
    const r = Math.hypot(dx, dy), v2 = dvx * dvx + dvy * dvy, e = 2 / r - v2 / (G * M);
    if (e <= 0) return { a: null, e: null, r };
    const a = 1 / e, h = dx * dvy - dy * dvx, ecc = Math.sqrt(Math.max(0, 1 - h * h / (G * M * a)));
    return { a, e: ecc, r };
  }

  stats() {
    const c = { star: 0, protostar: 0, gas: 0, ice: 0, rock: 0, dust: 0 };
    let big = 0, bigI = -1, solid = 0;
    for (let i = 0; i < this.n; i++) {
      c[this.classify(i)]++;
      if (this.kind[i] === 0) { solid += this.m[i]; if (this.m[i] > big) { big = this.m[i]; bigI = i; } }
    }
    return { counts: c, starMass: this.starMass(), biggest: big, biggestIdx: bigI, solidMass: solid, gasLeft: this.gasFrac(), n: this.n,
      planets: c.gas + c.ice + c.rock, ejected: this.ejected, swallowed: this.swallowed, merges: this.mergeCount };
  }

  log(type, data = {}) { if (this.events.length < 60) this.events.push({ t: this.t, type, ...data }); }

  // ---- 한 단계 ---------------------------------------------------------------------
  step(count = 1) { for (let s = 0; s < count; s++) this.#one(); }

  #one() {
    const dt = this.o.dt, h = dt / 2, n0 = this.n;
    for (let i = 0; i < n0; i++) { this.vx[i] += this.ax[i] * h; this.vy[i] += this.ay[i] * h; }
    for (let i = 0; i < n0; i++) { this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; }
    this.t += dt;
    this.#infall();
    this.#gasGiants(dt);
    this.#grid();
    if (this.#collide()) { this.#compact(); this.#grid(); }
    this.#accel();
    for (let i = 0; i < this.n; i++) { this.vx[i] += this.ax[i] * h; this.vy[i] += this.ay[i] * h; }
    this.#drag(dt);
    this.#escape();
    this.#recentre();
  }

  // 구름이 별로 떨어짐: 중력은 그대로이고, 별로 '보이는' 질량만 늘어난다. 점화(수소 핵융합 시작)를 알아챔
  #infall() {
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] !== 1 || this.lit[this.id[i]]) continue;
      if (this.starVisible(i) >= M_IGNITE) { this.lit[this.id[i]] = 1; this.log('ignite', { id: this.id[i], mass: this.starVisible(i) }); }
    }
  }

  // 큰 핵은 가스를 빨아들여 거대 행성이 된다 (얼음선 밖이 더 쉬움). 가스는 정해진 양뿐이라 먼저 큰 쪽이 가져간다
  #gasGiants(dt) {
    const gf = this.gasFrac();
    if (gf <= 0) return;
    const Ms = this.starDyn(), mCrit = 3e-5;                                       // 약 10 지구 질량
    for (let i = this.nStars; i < this.n; i++) {
      if (this.kind[i] === 1) continue;
      const need = this.ice[i] > 0.3 ? mCrit : 20 * mCrit, m = this.m[i];   // 얼음선 안쪽은 뜨거워 가스를 붙잡기 어렵다
      if (m < need) continue;
      const left = GAS_FOR_PLANETS * this.gas0 * Math.exp(-this.t / this.o.tDisp) - this.gasUsed;
      if (left <= 0) return;
      const gap = 1 / (1 + (m / (2 * M_JUPITER)) ** 2);          // 목성의 두 배쯤 되면 둘레에 틈이 생겨 성장이 더뎌짐
      const dm = Math.min(left, m * gf * gap * dt / 40);      // 커질수록 빨라지는 폭주 성장
      const was = this.gm[i] > 0.3 * m;
      const px = this.x[i], py = this.y[i], r = Math.max(0.3, Math.hypot(px, py)), vg = this.o.spin * Math.sqrt(G * Ms / r);
      this.vx[i] = (m * this.vx[i] + dm * (-py / r * vg)) / (m + dm); this.vy[i] = (m * this.vy[i] + dm * (px / r * vg)) / (m + dm);   // 삼키는 가스도 원반을 따라 돌고 있다
      this.m[i] = m + dm; this.gm[i] += dm; this.gasUsed += dm;
      if (!was && this.gm[i] > 0.3 * this.m[i] && this.m[i] >= M_GIANT && !this.giantLogged) { this.giantLogged = true; this.log('giant', { id: this.id[i], mass: this.m[i], a: Math.hypot(px, py) }); }
    }
  }

  // ---- 격자 · 충돌 · 중력 -----------------------------------------------------------
  #cell(i) {
    const D = this.D, c = (v) => Math.min(D - 1, Math.max(0, Math.floor((v + this.ext) / CELL)));
    return c(this.y[i]) * D + c(this.x[i]);
  }
  #grid() {
    this.head.fill(-1);
    for (let i = 0; i < this.n; i++) { const c = this.#cell(i); this.next[i] = this.head[c]; this.head[c] = i; }
  }
  // 이웃 칸 쌍을 한 번씩만 도는 순회: fn(i, j)
  #pairs(fn) {
    const D = this.D, head = this.head, next = this.next;
    for (let cy = 0; cy < D; cy++) {
      for (let cx = 0; cx < D; cx++) {
        let i = head[cy * D + cx];
        if (i < 0) continue;
        for (; i >= 0; i = next[i]) {
          for (let j = next[i]; j >= 0; j = next[j]) fn(i, j);
          for (const [dx, dy] of [[1, 0], [-1, 1], [0, 1], [1, 1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= D || ny >= D) continue;
            for (let j = head[ny * D + nx]; j >= 0; j = next[j]) fn(i, j);
          }
        }
      }
    }
  }

  #collide() {
    let any = false;
    const dead = this.dead, x = this.x, y = this.y;
    this.#pairs((i, j) => {
      if (dead[i] || dead[j]) return;
      const dx = x[j] - x[i], dy = y[j] - y[i], rs = this.radius(i) + this.radius(j);
      if (dx * dx + dy * dy < rs * rs) { this.#merge(i, j); any = true; }
    });
    return any;
  }

  // 닿으면 합쳐진다: 질량 · 운동량 보존, 별이 있으면 별이 삼킨다
  #merge(i, j) {
    if (this.kind[j] === 1 && this.kind[i] !== 1 || (this.kind[i] === this.kind[j] && this.m[j] > this.m[i])) [i, j] = [j, i];
    const mi = this.m[i], mj = this.m[j], mt = mi + mj, was = this.classify(i);
    this.vx[i] = (mi * this.vx[i] + mj * this.vx[j]) / mt; this.vy[i] = (mi * this.vy[i] + mj * this.vy[j]) / mt;
    this.x[i] = (mi * this.x[i] + mj * this.x[j]) / mt; this.y[i] = (mi * this.y[i] + mj * this.y[j]) / mt;
    this.ice[i] = (mi * this.ice[i] + mj * this.ice[j]) / mt;
    this.gm[i] += this.gm[j]; this.merges[i] += this.merges[j] + 1;
    this.m[i] = mt; this.dead[j] = 1;
    if (this.kind[i] === 1) {
      if (this.kind[j] === 1) this.log('binary-merge', { mass: mt });
      else this.swallowed++;
      this.starShare[i] += this.starShare[j];
    } else this.mergeCount++;
  }

  #compact() {
    let w = 0;
    for (let r = 0; r < this.n; r++) {
      if (this.dead[r]) continue;
      if (w !== r) for (const a of [this.x, this.y, this.vx, this.vy, this.ax, this.ay, this.m, this.ice, this.gm, this.id, this.merges, this.kind, this.starShare]) a[w] = a[r];
      this.dead[w] = 0; w++;
    }
    this.n = w;
    this.nStars = this.#countStars();
  }
  #countStars() { let s = 0; for (let i = 0; i < this.n; i++) if (this.kind[i] === 1) s++; return s; }

  // 멀리 날아간 것은 내보낸다
  #escape() {
    const lim = this.rEsc * this.rEsc;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] === 1) continue;
      if (this.x[i] * this.x[i] + this.y[i] * this.y[i] > lim) { this.dead[i] = 1; this.ejected++; this.ejectedMass += this.m[i]; any = true; }
    }
    if (any) { this.#compact(); this.#grid(); this.#accel(); }
  }

  #accel() {
    const n = this.n, x = this.x, y = this.y, m = this.m, ax = this.ax, ay = this.ay, heavy = this.heavy;
    ax.fill(0, 0, n); ay.fill(0, 0, n);
    const H = [];
    for (let i = 0; i < n; i++) { heavy[i] = this.kind[i] === 1 || m[i] > M_HEAVY ? 1 : 0; if (heavy[i]) H.push(i); }
    const pull = (i, j) => {
      const dx = x[j] - x[i], dy = y[j] - y[i], r2 = dx * dx + dy * dy + EPS2, f = G / (r2 * Math.sqrt(r2));
      ax[i] += m[j] * dx * f; ay[i] += m[j] * dy * f; ax[j] -= m[i] * dx * f; ay[j] -= m[i] * dy * f;
    };
    for (let a = 0; a < H.length; a++) {
      const i = H[a];
      for (let j = 0; j < n; j++) { if (j === i || (heavy[j] && j < i)) continue; pull(i, j); }
    }
    this.#pairs((i, j) => { if (!heavy[i] && !heavy[j]) pull(i, j); });
  }

  // 가스 항력: 먼지는 가스가 도는 속도(케플러의 spin 배)로 끌려간다. 작을수록, 가스가 많을수록 세게
  #drag(dt) {
    const gf = this.gasFrac();
    if (gf <= 0 || this.o.drag <= 0) return;
    const Ms = this.starDyn(), spin = this.o.spin, k0 = 0.5 * this.o.drag * gf;
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] === 1) continue;
      const x = this.x[i], y = this.y[i], r = Math.max(0.3, Math.hypot(x, y)), vg = spin * Math.sqrt(G * Ms / r);
      const k = k0 * Math.min(5, (M_REF / this.m[i]) ** 1.5) * Math.min(3, Math.max(0.3, Math.pow(3 / r, 0.75))), f = Math.exp(-k * dt);
      const gx = -y / r * vg, gy = x / r * vg;
      this.vx[i] = gx + (this.vx[i] - gx) * f; this.vy[i] = gy + (this.vy[i] - gy) * f;
    }
  }
}
