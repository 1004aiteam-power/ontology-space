// NEAT (NeuroEvolution of Augmenting Topologies) — Stanley & Miikkulainen, 2002
// 브라우저용 최소 구현: 혁신 번호(historical marking), 종 분화(speciation), 구조 확장(complexification)
//
// 원본 Python(neat-python) 설정과 비교해 바꾼 점
//  - 출력 3개(좌/우/가속, sigmoid > 0.5)  → 출력 2개(조향, 가감속) tanh 연속값
//  - 입력 7개(레이더)                      → 레이더 7개 + 현재 속도
//  - node_add 0.5 / conn_add 0.7 (너무 공격적) → 0.03 / 0.12 + 종 분화 임계값 자동 조절

export const DEFAULTS = {
  popSize: 150,
  nInputs: 8,
  nOutputs: 2,
  weightMutateRate: 0.8, weightPerturb: 0.5, weightReplaceRate: 0.1, weightMax: 8,
  biasMutateRate: 0.7,
  addConnRate: 0.12, addNodeRate: 0.03, toggleRate: 0.01,
  crossoverRate: 0.75,
  cDisjoint: 1.0, cWeight: 0.5,
  compatThreshold: 1.0, targetSpecies: 7,     // 첫 세대에 이분 탐색으로 정하고, 이후 세대마다 자동 조절
  survivalRate: 0.3, elitism: 1, stagnationLimit: 15
};

const gauss = () => {           // Box-Muller
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ---- 혁신 번호 관리 -------------------------------------------------------------
// 같은 구조 변이(같은 두 노드를 잇는 연결, 같은 연결을 쪼갠 노드)는 모든 개체에서 같은 번호를 받는다.
// 덕분에 서로 다른 신경망끼리도 유전자를 줄 맞춰 교차(crossover)할 수 있다.
class Innovations {
  constructor(nIn, nOut) {
    this.nextConn = 0;
    this.nextNode = nIn + nOut;
    this.conns = new Map();   // "in>out" → innovation
    this.splits = new Map();  // conn innovation → new node id
  }
  conn(a, b) {
    const k = a + '>' + b;
    if (!this.conns.has(k)) this.conns.set(k, this.nextConn++);
    return this.conns.get(k);
  }
  split(innov) {
    if (!this.splits.has(innov)) this.splits.set(innov, this.nextNode++);
    return this.splits.get(innov);
  }
}

// ---- 유전체 -------------------------------------------------------------------
// 노드 id: 0..nIn-1 입력, nIn..nIn+nOut-1 출력, 그 뒤는 은닉
export class Genome {
  constructor(cfg) {
    this.cfg = cfg;
    this.nodes = new Map();  // id → { id, type: 'in'|'out'|'hid', bias }
    this.conns = new Map();  // innovation → { innov, a, b, w, on }
    this.fitness = 0;
    this._net = null;
  }
  static minimal(cfg, inno) {       // 입력 → 출력 전체 연결로 시작 (가장 단순한 구조)
    const g = new Genome(cfg);
    for (let i = 0; i < cfg.nInputs; i++) g.nodes.set(i, { id: i, type: 'in', bias: 0 });
    for (let o = 0; o < cfg.nOutputs; o++) {
      const id = cfg.nInputs + o;
      g.nodes.set(id, { id, type: 'out', bias: gauss() * 0.5 });
      for (let i = 0; i < cfg.nInputs; i++) {
        const innov = inno.conn(i, id);
        g.conns.set(innov, { innov, a: i, b: id, w: gauss(), on: true });
      }
    }
    return g;
  }
  clone() {
    const g = new Genome(this.cfg);
    for (const [k, n] of this.nodes) g.nodes.set(k, { ...n });
    for (const [k, c] of this.conns) g.conns.set(k, { ...c });
    g.fitness = this.fitness;
    return g;
  }
  get hidden() { let n = 0; for (const v of this.nodes.values()) if (v.type === 'hid') n++; return n; }
  get enabledConns() { let n = 0; for (const c of this.conns.values()) if (c.on) n++; return n; }

  // ---- 변이 ----
  mutate(inno) {
    const c = this.cfg;
    for (const k of this.conns.values()) {
      if (Math.random() < c.weightMutateRate) {
        k.w = Math.random() < c.weightReplaceRate ? gauss() : clamp(k.w + gauss() * c.weightPerturb, -c.weightMax, c.weightMax);
      }
      if (Math.random() < c.toggleRate) k.on = !k.on;
    }
    for (const n of this.nodes.values()) {
      if (n.type !== 'in' && Math.random() < c.biasMutateRate) n.bias = clamp(n.bias + gauss() * c.weightPerturb, -c.weightMax, c.weightMax);
    }
    if (Math.random() < c.addNodeRate) this.addNode(inno);
    if (Math.random() < c.addConnRate) this.addConn(inno);
    this._net = null;
  }
  addConn(inno) {
    const ids = [...this.nodes.keys()];
    for (let tries = 0; tries < 20; tries++) {
      const a = pick(ids), b = pick(ids);
      const na = this.nodes.get(a), nb = this.nodes.get(b);
      if (a === b || nb.type === 'in' || na.type === 'out') continue;
      if ([...this.conns.values()].some(k => k.a === a && k.b === b)) continue;
      if (this.reaches(b, a)) continue;              // 순환 금지 (feed-forward 유지)
      const innov = inno.conn(a, b);
      this.conns.set(innov, { innov, a, b, w: gauss(), on: true });
      return;
    }
  }
  addNode(inno) {                                    // 연결 하나를 쪼개 은닉 노드 삽입
    const on = [...this.conns.values()].filter(k => k.on);
    if (!on.length) return;
    const k = pick(on);
    const id = inno.split(k.innov);
    if (this.nodes.has(id)) return;
    k.on = false;
    this.nodes.set(id, { id, type: 'hid', bias: 0 });
    const i1 = inno.conn(k.a, id), i2 = inno.conn(id, k.b);
    this.conns.set(i1, { innov: i1, a: k.a, b: id, w: 1, on: true });      // 기존 동작을 최대한 유지
    this.conns.set(i2, { innov: i2, a: id, b: k.b, w: k.w, on: true });
  }
  reaches(from, to) {                                // from에서 to로 가는 경로가 있는가
    const stack = [from], seen = new Set();
    while (stack.length) {
      const x = stack.pop();
      if (x === to) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const k of this.conns.values()) if (k.a === x) stack.push(k.b);
    }
    return false;
  }

  // ---- 교차: 혁신 번호로 유전자를 맞춰 정렬 ----
  static crossover(fit, weak) {                      // fit이 더 우수한 부모
    const child = new Genome(fit.cfg);
    for (const [k, c] of fit.conns) {
      const o = weak.conns.get(k);
      const gene = { ...(o && Math.random() < 0.5 ? o : c) };          // 일치 유전자: 무작위, 나머지: 우수 부모
      if (o && (!c.on || !o.on)) gene.on = Math.random() > 0.75;
      child.conns.set(k, gene);
    }
    for (const [id, n] of fit.nodes) {
      const o = weak.nodes.get(id);
      child.nodes.set(id, { ...(o && Math.random() < 0.5 ? o : n) });
    }
    return child;
  }

  static distance(a, b, cfg) {                       // 종 구분용 호환성 거리
    let disjoint = 0, matching = 0, wdiff = 0;
    for (const [k, c] of a.conns) {
      const o = b.conns.get(k);
      if (o) { matching++; wdiff += Math.abs(c.w - o.w); } else disjoint++;
    }
    for (const k of b.conns.keys()) if (!a.conns.has(k)) disjoint++;
    const n = Math.max(a.conns.size, b.conns.size, 1);
    return cfg.cDisjoint * disjoint / (n < 20 ? 1 : n) + cfg.cWeight * (matching ? wdiff / matching : 0);
  }

  // ---- 신경망으로 컴파일 (위상 정렬) ----
  network() {
    if (this._net) return this._net;
    const on = [...this.conns.values()].filter(k => k.on);
    const indeg = new Map([...this.nodes.keys()].map(k => [k, 0]));
    for (const k of on) indeg.set(k.b, indeg.get(k.b) + 1);
    const order = [], queue = [...this.nodes.keys()].filter(k => indeg.get(k) === 0);
    while (queue.length) {
      const x = queue.shift();
      order.push(x);
      for (const k of on) if (k.a === x) { indeg.set(k.b, indeg.get(k.b) - 1); if (indeg.get(k.b) === 0) queue.push(k.b); }
    }
    const incoming = new Map(order.map(id => [id, on.filter(k => k.b === id)]));
    const cfg = this.cfg;
    const values = new Map();
    this._net = {
      values,
      order,
      activate(inputs) {
        for (const id of order) {
          if (id < cfg.nInputs) { values.set(id, inputs[id]); continue; }
          let s = 0;
          for (const k of incoming.get(id)) s += (values.get(k.a) || 0) * k.w;
          values.set(id, Math.tanh(s + this.bias(id)));
        }
        const out = [];
        for (let o = 0; o < cfg.nOutputs; o++) out.push(values.get(cfg.nInputs + o) || 0);
        return out;
      },
      bias: (id) => this.nodes.get(id).bias
    };
    return this._net;
  }

  toJSON() {
    return { nodes: [...this.nodes.values()], conns: [...this.conns.values()], fitness: this.fitness };
  }
  static fromJSON(obj, cfg) {
    const g = new Genome(cfg);
    for (const n of obj.nodes) g.nodes.set(n.id, { ...n });
    for (const c of obj.conns) g.conns.set(c.innov, { ...c });
    g.fitness = obj.fitness || 0;
    return g;
  }
}

// ---- 개체군 -------------------------------------------------------------------
export class Population {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.inno = new Innovations(this.cfg.nInputs, this.cfg.nOutputs);
    this.genomes = Array.from({ length: this.cfg.popSize }, () => {
      const g = Genome.minimal(this.cfg, this.inno);
      g.mutate(this.inno);
      return g;
    });
    this.species = [];        // { id, rep, members, best, stale }
    this.nextSpecies = 0;
    this.generation = 0;
    this.best = null;         // 지금까지 최고 개체
    this.history = [];        // 세대별 { gen, best, mean, species, nodes, conns }
    // 첫 세대는 모두 같은 구조라 거리가 비슷하다 → 목표 종 수가 나오는 임계값을 이분 탐색으로 찾는다
    let lo = 0.05, hi = 5;
    for (let i = 0; i < 14; i++) {
      this.cfg.compatThreshold = (lo + hi) / 2;
      this.species = []; this.speciate(false);
      if (this.species.length > this.cfg.targetSpecies) lo = this.cfg.compatThreshold; else hi = this.cfg.compatThreshold;
    }
    this.cfg.compatThreshold = hi;
    this.species = []; this.speciate(false);
  }

  speciate(adjust = true) {
    for (const s of this.species) s.members = [];
    for (const g of this.genomes) {
      let home = this.species.find(s => Genome.distance(g, s.rep, this.cfg) < this.cfg.compatThreshold);
      if (!home) {
        home = { id: this.nextSpecies++, rep: g, members: [], best: -Infinity, stale: 0 };
        this.species.push(home);
      }
      home.members.push(g);
    }
    this.species = this.species.filter(s => s.members.length);
    // 종 개수가 목표에 가깝도록 임계값 자동 조절
    if (!adjust) return;
    if (this.species.length < this.cfg.targetSpecies) this.cfg.compatThreshold = Math.max(0.15, this.cfg.compatThreshold - 0.1);
    else if (this.species.length > this.cfg.targetSpecies) this.cfg.compatThreshold = Math.min(6, this.cfg.compatThreshold + 0.1);
  }

  // 모든 개체의 fitness가 정해진 뒤 호출 → 다음 세대
  evolve() {
    const cfg = this.cfg;
    const fits = this.genomes.map(g => g.fitness);
    const genBest = this.genomes.reduce((a, b) => (b.fitness > a.fitness ? b : a));
    // 환경이 세대마다 바뀌면(도메인 랜덤화) 적합도를 세대끼리 비교할 수 없으므로 이번 세대 최고를 챔피언으로
    if (!this.best || cfg.championPerGeneration || genBest.fitness >= this.best.fitness) this.best = genBest.clone();
    this.history.push({
      gen: this.generation, best: genBest.fitness, mean: fits.reduce((a, b) => a + b, 0) / fits.length,
      species: this.species.length, nodes: genBest.hidden, conns: genBest.enabledConns
    });

    // 정체된 종 제거 (상위 2개 종은 보호)
    for (const s of this.species) {
      const top = Math.max(...s.members.map(g => g.fitness));
      if (top > s.best) { s.best = top; s.stale = 0; } else s.stale++;
    }
    const ranked = [...this.species].sort((a, b) => b.best - a.best);
    this.species = ranked.filter((s, i) => i < 2 || s.stale < cfg.stagnationLimit);

    // 적합도 공유: 종 크기로 나눈 조정 적합도에 비례해 자손 수 배분
    const minFit = Math.min(...fits);
    const adj = this.species.map(s => s.members.reduce((a, g) => a + (g.fitness - minFit + 1), 0) / s.members.length);
    const total = adj.reduce((a, b) => a + b, 0);
    let quotas = adj.map(a => Math.max(1, Math.round(a / total * cfg.popSize)));
    while (quotas.reduce((a, b) => a + b, 0) > cfg.popSize) quotas[quotas.indexOf(Math.max(...quotas))]--;

    const next = [this.best.clone()];                 // 전체 최고 개체는 그대로 다음 세대로
    this.species.forEach((s, i) => {
      const members = [...s.members].sort((a, b) => b.fitness - a.fitness);
      const parents = members.slice(0, Math.max(1, Math.ceil(members.length * cfg.survivalRate)));
      for (let e = 0; e < cfg.elitism && e < quotas[i] && members.length >= 3; e++) next.push(members[e].clone());
      while (next.length < cfg.popSize && quotas[i]-- > (members.length >= 3 ? cfg.elitism : 0)) {
        let child;
        if (parents.length > 1 && Math.random() < cfg.crossoverRate) {
          let a = pick(parents), b = pick(parents);
          if (b.fitness > a.fitness) [a, b] = [b, a];
          child = Genome.crossover(a, b);
        } else child = pick(parents).clone();
        child.mutate(this.inno);
        next.push(child);
      }
      s.rep = pick(members);
    });
    while (next.length < cfg.popSize) {               // 반올림으로 모자란 자리
      const c = pick(this.species[0].members).clone();
      c.mutate(this.inno);
      next.push(c);
    }
    this.genomes = next.slice(0, cfg.popSize);
    for (const g of this.genomes) g.fitness = 0;
    this.generation++;
    this.speciate();
  }
}
