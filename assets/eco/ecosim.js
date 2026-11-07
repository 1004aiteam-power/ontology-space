// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 단세포 생태계: 먹이(영양 입자) · 초식 세포 · 육식 세포의 개체 기반 포식자–피식자 시뮬레이션
// 화면 없이도 동작 → 테스트·수치 조정 가능
//
//  - 월드는 가장자리가 반대편과 이어진다 (벽 없음)
//  - 세포는 에너지를 먹고 움직이며 에너지를 쓴다. 기준을 넘으면 둘로 분열, 0이 되거나 수명이 다하면 죽음
//  - 진화: 분열할 때 자식의 속도·감지 거리가 조금씩 변한다. 빠르고 멀리 볼수록 에너지를 더 쓴다
//  - 모든 무작위는 시드 난수 → 같은 시드면 같은 결과
//  - 세포마다 id · 부모 id(parent) · 생긴 방법(origin) · 태어난 틱(born)을 남기고, 사건(events)에도 관련 세포 id를 적는다
//    → 혈통·포식 관계를 그래프(온톨로지)로 옮길 수 있음 (assets/eco/eco-graph.js). 무작위 순서는 바뀌지 않아 결과는 그대로

export const WORLD = { w: 960, h: 640 };

export const DEFAULTS = {
  seed: 1,
  food: { max: 700, regrow: 2.2, energy: 22, init: 500 },      // regrow: 틱당 새로 자라는 수(빈 자리 비율만큼)
  herb: {
    init: 100, speed: 1.4, sense: 55, radius: 4,
    metab: 0.05, moveCost: 0.06, senseCost: 0.0006,           // 틱당 소모 = metab + moveCost·속도² + senseCost·감지거리
    split: 110, birth: 55, maxAge: 7500, turn: 0.35            // maxAge(수명): 분열하지 못한 채 이만큼 지나면 죽음 — 육식보다 김
  },
  carn: {
    init: 14, speed: 2.0, sense: 85, radius: 6,
    metab: 0.02, moveCost: 0.025, senseCost: 0.0006,
    split: 280, birth: 130, maxAge: 6000, turn: 0.3,            // 수명은 초식(7500)보다 짧음
    gain: 0.6, bonus: 20,                                       // 잡아먹으면 = gain × 먹이 세포 에너지 + bonus
    digest: 150,                                                // 소화 시간: 먹은 뒤 이 틱 동안 사냥하지 않고 천천히 떠돎
    lunge: 22, lungeBoost: 1.7,                                 // 먹잇감이 lunge 안이면 순간 속도 × lungeBoost
    idle: 0.25,                                                 // 먹잇감이 안 보이면 속도 × idle 로 천천히 (에너지 절약). 그래도 못 먹으면 굶어 죽음
    // 굶주림: 마지막으로 먹은 뒤 hungerGrace 틱이 지나면 틱당 hungerRate × (초과 틱 수) 만큼 에너지를 더 잃음
    //  → 못 먹는 시간이 길수록 빨리 소모되어 굶은 육식이 더 빨리 소멸 (보통 식사 간격 ~200틱, 90%가 450틱 이내 → 600틱까지는 영향 없음)
    hungerGrace: 600, hungerRate: 0.0003
  },
  herb2: { fear: 0.6 },                                         // 초식은 감지 거리 × fear 안의 육식만 알아채고 도망
  mutation: 0.06,                                              // 분열 때 형질 변화 폭 (표준편차, 비율)
  limits: { herb: { speed: [0.4, 2.0], sense: [15, 200] }, carn: { speed: [0.4, 4], sense: [15, 200] } },   // 형질의 생물학적 한계
  // 피난처: 육식이 사냥할 수 없는 구역 (가우스 실험의 침전물). 초식은 안에 있으면 보이지도 잡히지도 않음
  //  stay: 가장자리에서 안에 머무를 확률, slow: 안에서의 속도 배율, food: 안에서 틱당 추가로 자라는 먹이 (침전물의 박테리아)
  refuge: { on: true, stay: 0.995, slow: 0.5, food: 0.25, zones: [{ x: 170, y: 150, r: 55 }, { x: 760, y: 220, r: 55 }, { x: 450, y: 500, r: 55 }] },
  // 이주: 틱마다 이 확률로 바깥에서 초식이 한 마리씩 들어옴 (가우스의 두 번째 공존 조건)
  // 육식은 이주로 생기지 않는다 — 처음 넣은 개체와 그 분열, 아래 자연발생으로만 늘어남 (사용자가 직접 넣는 경우 제외)
  immigration: { herb: 0 },
  // 자연발생: 육식이 0마리가 된 뒤 carn 틱이 지나면 육식 한 마리가 새로 생김 (0 = 끔)
  respawn: { carn: 1000 },
  // 계절: 1년 = year 틱 (봄·여름·가을·겨울 각 1/4). 먹이의 상한과 자라는 속도가 계절 배율만큼 바뀜.
  //  배율 = 1 − amp × (1 − cos(여름 한가운데부터의 각도)) / 2 → 여름 한가운데 1, 겨울 한가운데 1 − amp
  //  상한보다 많은 먹이는 decay 비율로 시든다 (겨울에 먹이가 실제로 줄어듦)
  season: { on: true, year: 6000, amp: 0.8, decay: 0.004 },
  maxCells: 3000
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

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// 이어진 월드에서 a → b 최단 변위
const wrapD = (d, L) => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d);

// 공간 격자: 근처 개체만 빠르게 찾기
class Grid {
  constructor(cell) {
    this.cell = cell;
    this.cols = Math.ceil(WORLD.w / cell); this.rows = Math.ceil(WORLD.h / cell);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }
  clear() { for (const b of this.buckets) b.length = 0; }
  key(x, y) { return (Math.floor(y / this.cell) % this.rows) * this.cols + (Math.floor(x / this.cell) % this.cols); }
  add(o) { this.buckets[this.key(o.x, o.y)].push(o); }
  // (x, y)에서 r 안의 가장 가까운 살아 있는 개체
  nearest(x, y, r, skip) {
    const c = this.cell, n = Math.ceil(r / c);
    const cx = Math.floor(x / c), cy = Math.floor(y / c);
    let best = null, bd = r * r;
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const col = ((cx + i) % this.cols + this.cols) % this.cols, row = ((cy + j) % this.rows + this.rows) % this.rows;
      for (const o of this.buckets[row * this.cols + col]) {
        if (o.dead || o === skip || (skip instanceof Function && skip(o))) continue;
        const dx = wrapD(o.x - x, WORLD.w), dy = wrapD(o.y - y, WORLD.h), d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = o; }
      }
    }
    return best;
  }
}

export class Ecosystem {
  constructor(opts = {}) {
    this.cfg = mergeCfg(DEFAULTS, opts);
    this.rand = rng(this.cfg.seed);
    this.t = 0;
    this.food = []; this.cells = [];
    this.nextId = 1;
    this.events = [];          // 이번 틱의 사건 (화면 효과 · 기록용): { type: 'split'|'eat'|'die'|'arrive', x, y, kind, id, … }
    this.deaths = { herb: { starve: 0, age: 0, eaten: 0 }, carn: { starve: 0, age: 0 } };   // 누적 사망 원인
    this.respawns = { carn: 0 };   // 누적 자연발생 수
    this.carnGone = 0;             // 육식이 0마리로 지난 틱 수
    this.history = [];         // 일정 간격 기록 { t, food, herb, carn, hSpeed, hSense, cSpeed, cSense }
    this.foodGrid = new Grid(32); this.herbGrid = new Grid(40);
    for (let i = 0; i < this.cfg.food.init; i++) this.addFood();
    for (let i = 0; i < this.cfg.herb.init; i++) this.spawn('herb');
    for (let i = 0; i < this.cfg.carn.init; i++) this.spawn('carn');
    this.record();
  }

  inRefuge(o) {
    if (!this.cfg.refuge.on) return false;
    for (const z of this.cfg.refuge.zones) {
      const dx = wrapD(o.x - z.x, WORLD.w), dy = wrapD(o.y - z.y, WORLD.h);
      if (dx * dx + dy * dy < z.r * z.r) return true;
    }
    return false;
  }

  addFood(x = this.rand() * WORLD.w, y = this.rand() * WORLD.h) { this.food.push({ x, y, dead: false }); }

  // 새 세포 (초기 개체 또는 사용자가 투입)
  //  origin: 'initial'(처음 넣은 개체) · 'immigrant'(이주) · 'respawn'(자연발생) · 'user'(사용자 투입)
  spawn(kind, x = this.rand() * WORLD.w, y = this.rand() * WORLD.h, origin = this.t === 0 ? 'initial' : 'user') {
    const k = this.cfg[kind];
    const c = {
      id: this.nextId++, kind, x, y, a: this.rand() * TAU,
      speed: k.speed * (0.9 + 0.2 * this.rand()), sense: k.sense * (0.9 + 0.2 * this.rand()),
      energy: k.birth * (0.8 + 0.4 * this.rand()), age: (this.rand() * k.maxAge * 0.5) | 0, gen: 0, dead: false, full: 0, hungry: 0,
      parent: null, origin, born: this.t
    };
    this.cells.push(c);
    return c;
  }

  gauss() { let u = 0, v = 0; while (!u) u = this.rand(); while (!v) v = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

  // 분열: 에너지를 반씩 나누고 자식 형질은 조금 변이
  divide(c) {
    const m = this.cfg.mutation, L = this.cfg.limits[c.kind];
    const child = {
      id: this.nextId++, kind: c.kind, x: c.x, y: c.y, a: this.rand() * TAU,
      speed: clamp(c.speed * (1 + this.gauss() * m), L.speed[0], L.speed[1]),
      sense: clamp(c.sense * (1 + this.gauss() * m), L.sense[0], L.sense[1]),
      energy: c.energy / 2, age: 0, gen: c.gen + 1, dead: false, full: 0, hungry: 0,
      parent: c.id, origin: 'division', born: this.t
    };
    c.energy /= 2; c.age = 0;
    this.cells.push(child);
    this.events.push({ type: 'split', x: c.x, y: c.y, kind: c.kind, id: child.id, parent: c.id });
  }

  cost(c, v = c.speed) {                                       // v = 이번 틱에 실제로 움직인 속도
    const k = this.cfg[c.kind];
    return k.metab + k.moveCost * v * v + k.senseCost * c.sense;
  }

  steer(c, tx, ty, away, turn) {
    let want = Math.atan2(wrapD(ty - c.y, WORLD.h), wrapD(tx - c.x, WORLD.w));
    if (away) want += Math.PI;
    let d = ((want - c.a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    c.a += clamp(d, -turn, turn);
  }

  step() {
    const cfg = this.cfg;
    this.t++;
    this.events.length = 0;
    // 1) 먹이 자라기: 빈 자리 비율만큼 (로지스틱 성장), 상한과 속도는 계절 배율만큼
    let alive = this.food.length;
    const sf = this.seasonFactor(), cap = cfg.food.max * sf;
    const grow = cfg.food.regrow * sf * Math.max(0, 1 - alive / Math.max(1, cap));
    if (alive > cap) {                                                 // 상한을 넘는 먹이는 시듦
      const rot = (alive - cap) * cfg.season.decay;
      let k = Math.floor(rot) + (this.rand() < rot % 1 ? 1 : 0);
      while (k-- > 0 && this.food.length) this.food.splice((this.rand() * this.food.length) | 0, 1);
    }
    let n = Math.floor(grow) + (this.rand() < grow % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) this.addFood();
    if (cfg.refuge.on && this.rand() < cfg.refuge.food) {             // 피난처 안 추가 먹이
      const z = cfg.refuge.zones[(this.rand() * cfg.refuge.zones.length) | 0];
      const r = z.r * Math.sqrt(this.rand()), a = this.rand() * TAU;
      this.addFood((z.x + Math.cos(a) * r + WORLD.w) % WORLD.w, (z.y + Math.sin(a) * r + WORLD.h) % WORLD.h);
    }

    // 이주
    if (this.rand() < (cfg.immigration.herb || 0)) { const c = this.spawn('herb', undefined, undefined, 'immigrant'); this.events.push({ type: 'arrive', x: c.x, y: c.y, kind: 'herb', id: c.id }); }
    // 2) 격자 다시 만들기
    this.foodGrid.clear(); this.herbGrid.clear();
    for (const f of this.food) this.foodGrid.add(f);
    for (const c of this.cells) if (c.kind === 'herb') { c.safe = this.inRefuge(c); this.herbGrid.add(c); }
    const hidden = (o) => o.safe;
    const carnGrid = new Grid(60);
    for (const c of this.cells) if (c.kind === 'carn') carnGrid.add(c);

    // 3) 세포마다: 감지 → 방향 → 이동 → 먹기 → 에너지 → 분열·죽음
    const cells = this.cells, len = cells.length;
    for (let i = 0; i < len; i++) {
      const c = cells[i];
      if (c.dead) continue;
      const k = cfg[c.kind];
      c.a += (this.rand() - 0.5) * 0.25;                       // 무작위로 조금씩 흔들림
      if (c.kind === 'herb') {
        const danger = c.safe ? null : carnGrid.nearest(c.x, c.y, c.sense * cfg.herb2.fear);
        if (danger) this.steer(c, danger.x, danger.y, true, k.turn);
        else {
          const f = this.foodGrid.nearest(c.x, c.y, c.sense);
          if (f) this.steer(c, f.x, f.y, false, k.turn);
        }
      }
      let v = c.safe ? c.speed * cfg.refuge.slow : c.speed;
      if (c.kind === 'carn') {
        if (c.full > 0) { c.full--; v *= 0.5; }                // 소화 중: 사냥 안 함, 느리게
        else {
          const prey = this.herbGrid.nearest(c.x, c.y, c.sense, hidden);
          if (prey) {
            this.steer(c, prey.x, prey.y, false, k.turn);
            const dx = wrapD(prey.x - c.x, WORLD.w), dy = wrapD(prey.y - c.y, WORLD.h);
            if (dx * dx + dy * dy < k.lunge * k.lunge) v *= k.lungeBoost;   // 돌진
          } else v *= k.idle;
        }
      }
      const nx = (c.x + Math.cos(c.a) * v + WORLD.w) % WORLD.w, ny = (c.y + Math.sin(c.a) * v + WORLD.h) % WORLD.h;
      // 피난처 안의 초식은 대체로 밖으로 나가지 않음 (가장자리에서 방향을 돌림)
      if (c.safe && !this.inRefuge({ x: nx, y: ny }) && this.rand() < cfg.refuge.stay) c.a += Math.PI * (0.6 + 0.8 * this.rand());
      else { c.x = nx; c.y = ny; }

      if (c.kind === 'herb') {
        const f = this.foodGrid.nearest(c.x, c.y, k.radius + 2);
        if (f) { f.dead = true; c.energy += cfg.food.energy; }
      } else if (c.full === 0) {
        const prey = this.herbGrid.nearest(c.x, c.y, k.radius + cfg.herb.radius, hidden);
        if (prey) {
          c.full = k.digest; c.hungry = 0;
          prey.dead = true; this.deaths.herb.eaten++;
          c.energy += k.gain * prey.energy + k.bonus;
          this.events.push({ type: 'eat', x: prey.x, y: prey.y, kind: 'carn', id: c.id, prey: prey.id });
        }
      }
      c.energy -= this.cost(c, v);
      if (c.kind === 'carn') {                                 // 굶주림: 오래 못 먹을수록 추가 소모가 커짐
        c.hungry = (c.hungry || 0) + 1;
        if (c.hungry > k.hungerGrace) c.energy -= k.hungerRate * (c.hungry - k.hungerGrace);
      }
      c.age++;
      if (c.energy <= 0 || c.age > k.maxAge) {
        c.dead = true;
        const cause = c.energy <= 0 ? 'starve' : 'age';
        this.deaths[c.kind][cause]++;
        this.events.push({ type: 'die', x: c.x, y: c.y, kind: c.kind, cause, id: c.id });
      } else if (c.energy >= k.split && cells.length < cfg.maxCells) this.divide(c);
    }
    // 4) 정리
    this.cells = this.cells.filter(c => !c.dead);
    this.food = this.food.filter(f => !f.dead);
    // 5) 자연발생: 육식이 멸종한 뒤 일정 시간이 지나면 한 마리가 새로 생김
    const wait = cfg.respawn.carn;
    if (wait > 0 && !this.cells.some(c => c.kind === 'carn')) {
      if (++this.carnGone >= wait) {
        const c = this.spawn('carn', undefined, undefined, 'respawn'); c.age = 0;
        this.carnGone = 0; this.respawns.carn++;
        this.events.push({ type: 'arrive', x: c.x, y: c.y, kind: 'carn', respawn: true, id: c.id });
      }
    } else this.carnGone = 0;
    if (this.t % 10 === 0) this.record();
  }

  // 계절 배율 (0..1]과 계절 이름
  seasonFactor(t = this.t) {
    const S = this.cfg.season;
    if (!S.on) return 1;
    const p = (t % S.year) / S.year;
    return 1 - S.amp * (1 - Math.cos(TAU * (p - 0.375))) / 2;      // 여름 한가운데(p = 0.375)에서 최대
  }
  season(t = this.t) { return this.cfg.season.on ? Math.floor(((t % this.cfg.season.year) / this.cfg.season.year) * 4) : -1; }   // 0 봄 1 여름 2 가을 3 겨울

  counts() {
    let herb = 0, carn = 0;
    for (const c of this.cells) c.kind === 'herb' ? herb++ : carn++;
    return { food: this.food.length, herb, carn };
  }
  // 종별 평균 형질
  traits(kind) {
    let n = 0, sp = 0, se = 0, g = 0;
    for (const c of this.cells) if (c.kind === kind) { n++; sp += c.speed; se += c.sense; g = Math.max(g, c.gen); }
    return n ? { n, speed: sp / n, sense: se / n, maxGen: g } : { n: 0, speed: NaN, sense: NaN, maxGen: 0 };
  }
  record() {
    const h = this.traits('herb'), c = this.traits('carn');
    this.history.push({ t: this.t, food: this.food.length, cap: Math.round(this.cfg.food.max * this.seasonFactor()), herb: h.n, carn: c.n, hSpeed: h.speed, hSense: h.sense, cSpeed: c.speed, cSense: c.sense });
    if (this.history.length > 6000) this.history.splice(0, this.history.length - 6000);
  }
}

function mergeCfg(base, over) {      // 두 단계까지 합침 (limits.herb 같은 것은 통째로 바꿈)
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k], o = over[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? { ...b, ...(o || {}) } : (o ?? b);
  }
  return out;
}
