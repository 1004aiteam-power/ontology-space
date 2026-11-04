// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// NEAT Snake 시뮬레이션 코어 (화면 없이도 동작 → 테스트·빠른 학습 가능)
//
//  - 격자 GRID.w × GRID.h, 뱀은 한 칸씩 이동
//  - 입력 7개: 위험(앞·왼쪽·오른쪽) 3 + 먹이 방향(앞·뒤·왼쪽·오른쪽) 4 — 모두 진행 방향 기준 상대값
//    (먹이를 절대 방향(위·아래)으로 주면 "지금 방향 × 먹이 위치" 조합을 배워야 해서 은닉 노드 없이는 자주 막힘)
//  - 출력 3개: 직진 / 좌회전 / 우회전 중 가장 큰 값 (진행 방향 기준 상대 조작 → 반대로 꺾어 즉사하는 일이 없음)
//  - 적합도: 먹이 × 100 + 생존 걸음 × 0.1, 먹이 없이 STARVE 걸음이면 굶어 죽음 (제자리 돌기 방지)
//  - 먹이 위치는 시드 난수 → 같은 세대의 모든 개체가 같은 판(시드)으로 겨룬다

export const GRID = { w: 20, h: 20 };
export const SNAKE = { startLen: 3, starve: 100, maxSteps: 5000 };
export const FIT = { food: 100, step: 0.1 };
export const N_INPUTS = 7, N_OUTPUTS = 3;
export const ACTIONS = ['straight', 'left', 'right'];
// 방향: 0 위, 1 오른쪽, 2 아래, 3 왼쪽 (시계 방향)
export const DIRS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

// 시드 난수 (mulberry32) — 같은 시드면 같은 먹이 순서
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

export class Snake {
  constructor(seed = 1, genome = null) {
    this.genome = genome;
    this.seed = seed;
    this.rand = rng(seed);
    const cx = GRID.w >> 1, cy = GRID.h >> 1;
    this.dir = 1;
    this.body = [];                                   // body[0] = 머리
    for (let i = 0; i < SNAKE.startLen; i++) this.body.push({ x: cx - i, y: cy });
    this.occupied = new Set(this.body.map(key));
    this.alive = true;
    this.score = 0;           // 먹은 먹이 수
    this.steps = 0;
    this.hunger = 0;          // 마지막 먹이 이후 걸음
    this.cause = null;        // 'wall' | 'self' | 'starve' | 'timeout' | 'full'
    this.lastAction = 0;
    this.placeFood();
  }
  get head() { return this.body[0]; }
  placeFood() {
    const free = GRID.w * GRID.h - this.body.length;
    if (free <= 0) { this.food = null; return; }
    let n = (this.rand() * free) | 0;                // 빈 칸 중 n번째 (항상 한 번에 결정 → 재현 가능)
    for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) {
      if (this.occupied.has(x + ',' + y)) continue;
      if (n-- === 0) { this.food = { x, y }; return; }
    }
  }
  // 칸 (x, y)에 들어가면 죽는가. 다음 걸음에 꼬리가 비켜 주므로 꼬리 끝은 안전
  deadly(x, y) {
    if (x < 0 || y < 0 || x >= GRID.w || y >= GRID.h) return true;
    const tail = this.body[this.body.length - 1];
    return this.occupied.has(x + ',' + y) && !(x === tail.x && y === tail.y);
  }
}

const key = (p) => p.x + ',' + p.y;

// 신경망 입력 7개 (0 또는 1), 모두 진행 방향 기준
export const INPUT_LABELS = ['위험 앞', '위험 왼쪽', '위험 오른쪽', '먹이 앞', '먹이 뒤', '먹이 왼쪽', '먹이 오른쪽'];
export const INPUT_LABELS_EN = ['danger ahead', 'danger left', 'danger right', 'food ahead', 'food behind', 'food left', 'food right'];
export function sense(s) {
  const h = s.head, d = s.dir;
  const look = (dd) => { const v = DIRS[(dd + 4) % 4]; return s.deadly(h.x + v.x, h.y + v.y) ? 1 : 0; };
  const f = s.food || h, dx = f.x - h.x, dy = f.y - h.y;
  const fwd = DIRS[d], right = DIRS[(d + 1) % 4];
  const ahead = dx * fwd.x + dy * fwd.y, side = dx * right.x + dy * right.y;   // 앞(+)/뒤(-), 오른쪽(+)/왼쪽(-)
  return [
    look(d), look(d - 1), look(d + 1),
    ahead > 0 ? 1 : 0, ahead < 0 ? 1 : 0, side < 0 ? 1 : 0, side > 0 ? 1 : 0
  ];
}

// 행동 0 직진 / 1 좌회전 / 2 우회전 → 한 걸음
export function move(s, action) {
  if (!s.alive) return;
  s.lastAction = action;
  if (action === 1) s.dir = (s.dir + 3) % 4;
  else if (action === 2) s.dir = (s.dir + 1) % 4;
  const v = DIRS[s.dir], h = s.head;
  const nx = h.x + v.x, ny = h.y + v.y;
  s.steps++; s.hunger++;
  if (s.deadly(nx, ny)) {
    s.alive = false;
    s.cause = nx < 0 || ny < 0 || nx >= GRID.w || ny >= GRID.h ? 'wall' : 'self';
    return;
  }
  const eat = s.food && nx === s.food.x && ny === s.food.y;
  if (!eat) s.occupied.delete(key(s.body.pop()));     // 꼬리 이동
  s.body.unshift({ x: nx, y: ny });
  s.occupied.add(nx + ',' + ny);
  if (eat) {
    s.score++; s.hunger = 0;
    s.placeFood();
    if (!s.food) { s.alive = false; s.cause = 'full'; return; }   // 판을 다 채움
  }
  if (s.hunger >= SNAKE.starve) { s.alive = false; s.cause = 'starve'; }
  else if (s.steps >= SNAKE.maxSteps) { s.alive = false; s.cause = 'timeout'; }
}

// 신경망이 보고 → 판단 → 한 걸음
export function decide(genome, s) {
  const out = genome.network().activate(sense(s));
  let a = 0;
  for (let i = 1; i < out.length; i++) if (out[i] > out[a]) a = i;
  return a;
}
export function stepSnake(s) { if (s.alive) move(s, decide(s.genome, s)); }

export const gameFitness = (s) => s.score * FIT.food + s.steps * FIT.step;

// 한 판을 끝까지 (화면 없이)
export function playGame(genome, seed) {
  const s = new Snake(seed, genome);
  while (s.alive) stepSnake(s);
  return s;
}

// 세대 학습기. 개체마다 시드가 다른 판을 trials번 하고 평균 적합도를 쓴다.
// 같은 세대에서는 모두 같은 시드 → 공정한 비교, 세대마다 시드가 바뀜 → 특정 먹이 배치 암기 방지
export class Trainer {
  constructor(Population, opts = {}) {
    this.opts = { popSize: 150, trials: 3, seed: 1, ...opts };
    this.pop = new Population({ popSize: this.opts.popSize, nInputs: N_INPUTS, nOutputs: N_OUTPUTS, championPerGeneration: true });
    this.bestScore = 0;       // 지금까지 한 판 최고 먹이 수
    this.bestGame = null;     // { genome, seed, score } 다시 보기용
    this.reset();
  }
  seedFor(trial) { return (this.opts.seed * 7919 + this.pop.generation * 101 + trial) >>> 0; }
  reset() {
    this.agents = this.pop.genomes.map(g => ({ genome: g, trial: 0, total: 0, scores: [], game: new Snake(this.seedFor(0), g) }));
    this.speciesOf = new Map();
    for (const s of this.pop.species) for (const g of s.members) this.speciesOf.set(g, s.id);
    this.step = 0;
  }
  get alive() { return this.agents.filter(a => a.game).length; }
  // 지금 화면에 보여줄 대표: 살아 있는 뱀 중 (끝낸 판 점수 + 지금 점수)가 가장 높은 개체
  leader() {
    let best = null, bv = -1;
    for (const a of this.agents) if (a.game) {
      const v = a.scores.reduce((x, y) => x + y, 0) + a.game.score + a.game.steps * 1e-6;
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }
  // 모든 뱀을 한 걸음. 세대가 끝나면 'round'
  tick() {
    for (const a of this.agents) {
      if (!a.game) continue;
      stepSnake(a.game);
      if (a.game.alive) continue;
      const g = a.game;
      a.total += gameFitness(g); a.scores.push(g.score);
      if (g.score > this.bestScore || !this.bestGame) {
        this.bestScore = Math.max(this.bestScore, g.score);
        this.bestGame = { genome: a.genome.clone(), seed: g.seed, score: g.score, gen: this.pop.generation + 1 };
      }
      a.trial++;
      a.game = a.trial < this.opts.trials ? new Snake(this.seedFor(a.trial), a.genome) : null;
    }
    this.step++;
    if (this.alive === 0) { this.endGeneration(); return 'round'; }
    return false;
  }
  // 화면 없이 한 세대를 끝까지
  runGeneration() { while (this.tick() !== 'round'); return this.pop.history.at(-1); }
  endGeneration() {
    const scores = this.agents.flatMap(a => a.scores);
    this.lastGen = {
      bestScore: Math.max(...scores),
      meanScore: scores.reduce((x, y) => x + y, 0) / scores.length
    };
    for (const a of this.agents) a.genome.fitness = a.total / this.opts.trials;
    this.pop.evolve();
    Object.assign(this.pop.history.at(-1), this.lastGen);
    this.reset();
  }
  // 최고 기록 판을 같은 시드로 다시
  replay() { return this.bestGame ? new Snake(this.bestGame.seed, this.bestGame.genome) : null; }
}
