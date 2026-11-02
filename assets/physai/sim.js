// 자율주행 시뮬레이션 코어 (화면 없이도 동작 → 테스트·빠른 학습 가능)
//
// 원본(pygame) 대비 개선
//  - 벽 판정: 화면 픽셀 색(get_at) → 트랙 중심선까지의 거리 (해상도와 무관, 빠르고 정확)
//  - 충돌: 회전하지 않은 사각형 → 실제로 회전한 차체의 네 모서리
//  - 레이더: 1px씩 전진하며 픽셀 검사 → 벽 선분과의 교차 계산 (공간 격자로 가속)
//  - 적합도: "x > 850 통과 보너스" → 중심선을 따라 실제로 전진한 거리 (역주행·제자리 돌기 무효)
//  - 조작: 좌/우 on-off, 속도 고정 → 조향·가감속 연속 제어, 관성과 저항

export const WORLD = { w: 1000, h: 700 };
export const CAR = { len: 18, wid: 9, vMin: 0.5, vMax: 8, accel: 0.25, drag: 0.985, turn: 0.085 };
export const RADAR = { angles: [-90, -60, -30, 0, 30, 60, 90], range: 220 };

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---- 트랙 생성 -----------------------------------------------------------------
function catmullRom(ctrl, perSeg = 30) {           // 닫힌 Catmull-Rom 스플라인
  const out = [], n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

function resample(pts, step) {                      // 일정 간격으로 다시 찍기
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = step - carry;
    while (d <= seg) { const t = d / seg; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); d += step; }
    carry = seg - (d - step);
  }
  if (Math.hypot(out.at(-1).x - out[0].x, out.at(-1).y - out[0].y) < step * 0.5) out.pop();
  return out;
}

function blobControls(irregular = 0.3) {           // 둥근 무작위 트랙 (이미지 1)
  const k = 9 + ((Math.random() * 4) | 0), pts = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2 + rnd(-0.15, 0.15);
    const r = rnd(1 - irregular, 1.05);
    pts.push({ x: 500 + Math.cos(a) * 400 * r, y: 350 + Math.sin(a) * 260 * r });
  }
  return pts;
}

function mmControls() {                             // M 두 개를 이은 트랙 (이미지 2, 원본 main.py의 뼈대)
  // 원본처럼 꼭짓점 하나로 봉우리를 만들면 V자로 뾰족해져 도로가 꼬인다.
  // 봉우리·골짜기마다 점 두 개(±42px)를 둬서 아치로 만든다.
  const ext = [[140, 560, 0], [245, 140, 1], [330, 350, 1], [435, 140, 1], [560, 500, 1],
               [685, 140, 1], [780, 330, 1], [875, 140, 1], [900, 560, 0], [520, 650, 0]];
  const pts = [];
  for (const [x0, y0, arch] of ext) {
    const x = x0 + rnd(-12, 12), y = y0 + rnd(-15, 15);
    if (arch) pts.push({ x: x - 42, y }, { x: x + 42, y }); else pts.push({ x, y });
  }
  return pts;
}

function smooth(p, sigma) {                         // 원형 가우시안 평활화 (원본의 splprep s=5000과 같은 역할)
  const n = p.length, r = Math.ceil(sigma * 3), w = [];
  let sum = 0;
  for (let k = -r; k <= r; k++) { const v = Math.exp(-k * k / (2 * sigma * sigma)); w.push(v); sum += v; }
  return p.map((_, i) => {
    let x = 0, y = 0;
    for (let k = -r; k <= r; k++) { const q = p[((i + k) % n + n) % n]; x += q.x * w[k + r]; y += q.y * w[k + r]; }
    return { x: x / sum, y: y / sum };
  });
}

export function makeTrack(type = 'blob') {
  const kind = type === 'random' ? (Math.random() < 0.35 ? 'mm' : 'blob') : type;
  for (let attempt = 0; attempt < 60; attempt++) {
    const ctrl = kind === 'mm' ? mmControls() : blobControls(type === 'random' ? rnd(0.2, 0.45) : 0.3);
    const hw = kind === 'mm' ? 21 : 30;             // 도로 폭의 절반
    const center = resample(smooth(resample(catmullRom(ctrl), 3), 8), 6);
    if (!fits(center, hw)) continue;
    return buildTrack(center, hw, kind);
  }
  return buildTrack(resample(catmullRom(blobControls(0.15)), 6), 30, 'blob');
}

function fits(c, hw) {                              // 화면 안에 있고, 트랙끼리 겹치지 않는가
  const n = c.length;
  for (const p of c) if (p.x < hw + 8 || p.x > WORLD.w - hw - 8 || p.y < hw + 8 || p.y > WORLD.h - hw - 8) return false;
  const gap = Math.ceil((Math.PI * hw * 1.6) / 6);
  for (let i = 0; i < n; i += 2) for (let j = i + gap; j < n; j += 2) {
    if ((n - (j - i)) < gap) continue;
    if (Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y) < 2 * hw + 14) return false;
  }
  // 곡률 반경이 도로 폭보다 작으면 안쪽 벽이 꼬인다
  for (let i = 0; i < n; i++) {
    const a = c[(i - 2 + n) % n], b = c[i], d = c[(i + 2) % n];
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    const r = (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - b.x, d.y - b.y) * Math.hypot(d.x - a.x, d.y - a.y)) / (2 * Math.abs(cross) + 1e-9);
    if (r < hw * 1.15) return false;
  }
  return true;
}

function buildTrack(center, hw, kind) {
  const n = center.length, cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(center[i % n].x - center[i - 1].x, center[i % n].y - center[i - 1].y));
  const L = cum[n];
  // 벽 = 중심선을 법선 방향으로 ±hw 이동
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = center[(i - 1 + n) % n], b = center[(i + 1) % n];
    let tx = b.x - a.x, ty = b.y - a.y; const m = Math.hypot(tx, ty); tx /= m; ty /= m;
    left.push({ x: center[i].x - ty * hw, y: center[i].y + tx * hw });
    right.push({ x: center[i].x + ty * hw, y: center[i].y - tx * hw });
  }
  const segs = [];
  for (const wall of [left, right]) for (let i = 0; i < n; i++) {
    const a = wall[i], b = wall[(i + 1) % n];
    segs.push([a.x, a.y, b.x, b.y]);
  }
  // 공간 격자: 레이더가 근처 벽 선분만 검사하도록
  const cell = 40, cols = Math.ceil(WORLD.w / cell) + 1, rows = Math.ceil(WORLD.h / cell) + 1;
  const grid = Array.from({ length: cols * rows }, () => []);
  segs.forEach(([x1, y1, x2, y2], i) => {
    const c0 = Math.floor(Math.min(x1, x2) / cell), c1 = Math.floor(Math.max(x1, x2) / cell);
    const r0 = Math.floor(Math.min(y1, y2) / cell), r1 = Math.floor(Math.max(y1, y2) / cell);
    for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++)
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) grid[cy * cols + cx].push(i);
  });
  const s0 = center[0], s1 = center[1];
  return { kind, center, cum, L, hw, left, right, segs, grid, cell, cols, rows, stamp: new Int32Array(segs.length), stampId: 0,
           start: { x: s0.x, y: s0.y, a: Math.atan2(s1.y - s0.y, s1.x - s0.x) } };
}

// 중심선에 투영: 근처(hint ± win)만 찾는다
export function project(tr, x, y, hint, win = 30) {
  const n = tr.center.length;
  let best = { d: Infinity, i: 0, t: 0 };
  for (let k = -win; k <= win; k++) {
    const i = ((hint + k) % n + n) % n, a = tr.center[i], b = tr.center[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t - x, py = a.y + dy * t - y, d = px * px + py * py;
    if (d < best.d) best = { d, i, t };
  }
  return { dist: Math.sqrt(best.d), i: best.i, s: tr.cum[best.i] + (tr.cum[best.i + 1] - tr.cum[best.i]) * best.t };
}

export function raycast(tr, x, y, ang) {
  const R = RADAR.range, dx = Math.cos(ang), dy = Math.sin(ang);
  const id = ++tr.stampId;
  let best = R;
  for (let d = 0; d <= R + tr.cell; d += tr.cell * 0.5) {
    const px = x + dx * Math.min(d, R), py = y + dy * Math.min(d, R);
    const cx = Math.floor(px / tr.cell), cy = Math.floor(py / tr.cell);
    if (cx < 0 || cy < 0 || cx >= tr.cols || cy >= tr.rows) break;
    for (const si of tr.grid[cy * tr.cols + cx]) {
      if (tr.stamp[si] === id) continue;
      tr.stamp[si] = id;
      const [x1, y1, x2, y2] = tr.segs[si];
      const ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - x) * ey - (y1 - y) * ex) / den, u = ((x1 - x) * dy - (y1 - y) * dx) / den;
      if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    if (best < d - tr.cell) break;                 // 이미 더 가까운 벽을 찾음
  }
  return best;
}

// ---- 자동차 -------------------------------------------------------------------
export class Car {
  constructor(tr, genome, jitter = 0) {
    this.genome = genome; this.net = genome ? genome.network() : null;
    // jitter > 0: 차선 안에서 출발 위치·방향을 조금씩 다르게 (초기 조건 무작위화, 화면에서 겹치지 않게)
    const off = (Math.random() - 0.5) * tr.hw * 0.9 * jitter, nx = -Math.sin(tr.start.a), ny = Math.cos(tr.start.a);
    this.x = tr.start.x + nx * off; this.y = tr.start.y + ny * off;
    this.a = tr.start.a + (Math.random() - 0.5) * 0.16 * jitter; this.v = 2;
    this.idx = 0; this.s = 0; this.progress = 0; this.maxProgress = 0; this.lastImprove = 0;
    this.alive = true; this.finished = false; this.steps = 0; this.cause = '';
    this.radar = new Array(RADAR.angles.length).fill(RADAR.range);
    this.inputs = []; this.outputs = [0, 0];
  }
  sense(tr, noise) {
    this.inputs = RADAR.angles.map((deg, k) => {
      const d = raycast(tr, this.x, this.y, this.a + deg * Math.PI / 180);
      this.radar[k] = d;
      const v = d / RADAR.range + (noise ? gauss() * noise : 0);
      return v < 0 ? 0 : v > 1 ? 1 : v;
    });
    this.inputs.push(this.v / CAR.vMax);
    return this.inputs;
  }
  act(steer, throttle) {                           // 조향·가감속은 -1..1 연속값
    this.outputs = [steer, throttle];
    this.v = Math.min(CAR.vMax, Math.max(CAR.vMin, (this.v + throttle * CAR.accel) * CAR.drag));
    this.a += steer * CAR.turn * Math.min(1, 0.35 + this.v / 4);
    this.x += Math.cos(this.a) * this.v;
    this.y += Math.sin(this.a) * this.v;
  }
  corners() {
    const c = Math.cos(this.a), s = Math.sin(this.a), hl = CAR.len / 2, hw = CAR.wid / 2;
    return [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]].map(([u, v]) => [this.x + u * c - v * s, this.y + u * s + v * c]);
  }
}

// 한 스텝: 감지 → 판단(신경망) → 행동 → 평가
export function stepCar(car, tr, opts) {
  if (!car.alive || car.finished) return;
  const out = car.net.activate(car.sense(tr, opts.noise));
  car.act(out[0], out[1]);
  car.steps++;
  const p = project(tr, car.x, car.y, car.idx);
  let ds = p.s - car.s;
  if (ds > tr.L / 2) ds -= tr.L; else if (ds < -tr.L / 2) ds += tr.L;   // 출발선 통과 보정
  car.idx = p.i; car.s = p.s; car.progress += ds;
  if (car.progress > car.maxProgress + 1) { car.maxProgress = car.progress; car.lastImprove = car.steps; }
  for (const [cx, cy] of car.corners()) {
    if (project(tr, cx, cy, car.idx, 12).dist > tr.hw) { car.alive = false; car.cause = 'crash'; return; }
  }
  if (car.progress < car.maxProgress - 80) { car.alive = false; car.cause = 'reverse'; return; }        // 역주행
  if (car.steps - car.lastImprove > opts.stallSteps) { car.alive = false; car.cause = 'stall'; return; } // 정체
  if (car.progress >= tr.L * opts.laps) { car.finished = true; car.cause = 'finish'; }
}

export function fitness(car, tr, maxSteps) {
  // 트랙 길이로 정규화한 전진률(한 바퀴 = 1000점) + 완주하면 남은 시간 비율만큼 보너스
  // → 트랙이 바뀌어도 점수 척도가 같다
  const progress = 1000 * Math.max(0, car.maxProgress) / tr.L;
  return progress + (car.finished ? 500 + 1500 * (maxSteps - car.steps) / maxSteps : 0);
}

export const maxStepsFor = (tr, opts) => Math.ceil((tr.L * opts.laps) / 2.2) + 240;

// ---- 학습기 ------------------------------------------------------------------
export class Trainer {
  constructor(Population, opts) {
    this.opts = { laps: 2, stallSteps: 150, noise: 0, trackType: 'blob', randomize: false, popSize: 150, ...opts };
    this.pop = new Population({ popSize: this.opts.popSize, nInputs: RADAR.angles.length + 1, nOutputs: 2,
                                championPerGeneration: this.opts.randomize });
    this.track = makeTrack(this.opts.trackType);
    this.reset();
  }
  reset() {
    this.cars = this.pop.genomes.map(g => new Car(this.track, g, 1));
    // 각 차가 속한 종 (화면에서 종별 색으로 표시)
    this.speciesOf = new Map();
    for (const s of this.pop.species) for (const g of s.members) this.speciesOf.set(g, s.id);
    this.step = 0;
    this.maxSteps = maxStepsFor(this.track, this.opts);
  }
  get alive() { return this.cars.filter(c => c.alive && !c.finished).length; }
  leader() {
    let best = null;
    for (const c of this.cars) if ((c.alive && !c.finished) && (!best || c.progress > best.progress)) best = c;
    return best || this.cars.reduce((a, b) => (b.maxProgress > a.maxProgress ? b : a));
  }
  // 한 프레임 진행. 세대가 끝나면 true
  tick() {
    for (const c of this.cars) stepCar(c, this.track, this.opts);
    this.step++;
    if (this.alive === 0 || this.step >= this.maxSteps) { this.endGeneration(); return true; }
    return false;
  }
  endGeneration() {
    this.lastGen = {
      finished: this.cars.filter(c => c.finished).length,
      bestLapSteps: Math.min(...this.cars.filter(c => c.finished).map(c => c.steps / this.opts.laps), Infinity),
      bestProgress: Math.max(...this.cars.map(c => c.maxProgress)) / this.track.L
    };
    for (const c of this.cars) c.genome.fitness = fitness(c, this.track, this.maxSteps);
    const h = this.pop;
    h.evolve();
    Object.assign(h.history.at(-1), this.lastGen);
    if (this.opts.randomize) this.track = makeTrack(this.opts.trackType === 'mm' ? 'mm' : 'random');   // 도메인 랜덤화
    this.reset();
  }
  newTrack() { this.track = makeTrack(this.opts.trackType); this.reset(); }
  setRandomize(on) { this.opts.randomize = on; this.pop.cfg.championPerGeneration = on; }
}

// 일반화 테스트: 학습 때 본 적 없는 트랙에서 한 대만 주행
export function testRun(genome, tr, opts) {
  const car = new Car(tr, genome);
  const max = maxStepsFor(tr, opts);
  while (car.alive && !car.finished && car.steps < max) stepCar(car, tr, opts);
  return { finished: car.finished, progress: car.maxProgress / tr.L, steps: car.steps, cause: car.cause || 'timeout' };
}
