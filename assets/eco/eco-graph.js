// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 단세포 생태계 시뮬레이션 한 번 → 온톨로지 개체 데이터 (examples/ecosystem/eco-ontology.ttl의 클래스·관계)
//
//  Recorder   시뮬레이션을 돌리면서 세포마다 태어남·죽음·포식·피난처 시간을 기록
//  triples()  기록 → RDF 트리플 [주어, 술어, 목적어]
//  toQuads()  브라우저 Cypher 엔진(assets/cypher/graph.js)이 읽는 RDF/JS 모양
//  toTurtle() Neo4j(neosemantics) · rdflib 등으로 가져갈 Turtle 텍스트
// 브라우저(eco-ontology.html)와 빌드 스크립트(examples/ecosystem/build_eco.mjs)가 같이 씀
import { Ecosystem, WORLD } from './ecosim.js?v=20261107a';

export const ECO = 'https://1004aiteam-power.github.io/ontology-space/eco#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

const wrapD = (d, L) => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d);

export class Recorder {
  // opts: Ecosystem 설정 (seed 등). years: 실행 길이 (1년 = cfg.season.year 틱)
  constructor({ seed = 1, years = 2, ...cfg } = {}) {
    this.eco = new Ecosystem({ seed, ...cfg });
    this.ticks = Math.round(years * this.eco.cfg.season.year);
    this.cells = new Map();
    this.maxId = 0;
    this.scanNew();
  }
  get done() { return this.eco.t >= this.ticks; }

  refugeAt(x, y) {                     // 그 위치의 피난처 번호 (1부터) 또는 0
    const R = this.eco.cfg.refuge;
    if (!R.on) return 0;
    for (let i = 0; i < R.zones.length; i++) {
      const z = R.zones[i], dx = wrapD(x - z.x, WORLD.w), dy = wrapD(y - z.y, WORLD.h);
      if (dx * dx + dy * dy < z.r * z.r) return i + 1;
    }
    return 0;
  }

  scanNew() {                          // 이번 틱에 새로 생긴 세포 (분열 · 이주 · 자연발생)
    for (const c of this.eco.cells) {
      if (c.id <= this.maxId) continue;
      this.cells.set(c.id, {
        id: c.id, kind: c.kind, parent: c.parent, origin: c.origin, born: c.born, gen: c.gen,
        speed: c.speed, sense: c.sense, refuge: c.kind === 'herb' ? this.refugeAt(c.x, c.y) : 0,
        life: 0, safe: 0, died: null, cause: null, prey: []
      });
    }
    this.maxId = this.eco.nextId - 1;
  }

  // n틱 진행 (화면이 멈추지 않게 나눠 부르기 위함). 끝나면 true
  advance(n = Infinity) {
    const eco = this.eco;
    for (let i = 0; i < n && eco.t < this.ticks; i++) {
      eco.step();
      this.scanNew();
      for (const e of eco.events) {
        if (e.type === 'die') { const r = this.cells.get(e.id); r.died = eco.t; r.cause = e.cause; }
        else if (e.type === 'eat') { const r = this.cells.get(e.prey); r.died = eco.t; r.cause = 'eaten'; this.cells.get(e.id).prey.push(e.prey); }
      }
      for (const c of eco.cells) if (c.kind === 'herb') { const r = this.cells.get(c.id); r.life++; if (c.safe) r.safe++; }
    }
    return this.done;
  }

  summary() {
    const s = { cells: this.cells.size, herb: 0, carn: 0, alive: 0, maxGen: 0, predations: 0 };
    for (const r of this.cells.values()) {
      s[r.kind]++; if (r.died == null) s.alive++; s.maxGen = Math.max(s.maxGen, r.gen); s.predations += r.prey.length;
    }
    return s;
  }

  // [s, p, o] — s·p는 IRI 문자열, o는 IRI 문자열 또는 { v, dt | lang } 리터럴
  triples() {
    const eco = this.eco, out = [];
    const I = (n) => ECO + n, cell = (id) => I('cell_' + id);
    const lit = (v, dt) => ({ v: String(v), dt: XSD + dt });
    const season = (t) => I(SEASONS[eco.season(t)]);
    const run = I('run_seed' + eco.cfg.seed);
    out.push([run, RDF_TYPE, I('SimulationRun')], [run, I('seed'), lit(eco.cfg.seed, 'integer')], [run, I('ticks'), lit(this.ticks, 'integer')]);
    for (const r of this.cells.values()) {
      const s = cell(r.id);
      out.push(
        [s, RDF_TYPE, I(r.kind === 'herb' ? 'Herbivore' : 'Carnivore')],
        [s, I('inRun'), run],
        [s, I('cellId'), lit(r.id, 'integer')],
        [s, I('generation'), lit(r.gen, 'integer')],
        [s, I('origin'), lit(r.origin, 'string')],
        [s, I('bornAt'), lit(r.born, 'integer')],
        [s, I('bornIn'), season(r.born)],
        [s, I('speed'), lit(r.speed.toFixed(3), 'decimal')],
        [s, I('sense'), lit(r.sense.toFixed(1), 'decimal')],
        [s, I('alive'), lit(r.died == null, 'boolean')]
      );
      if (r.parent != null) out.push([s, I('descendsFrom'), cell(r.parent)]);
      if (r.died != null) out.push([s, I('diedAt'), lit(r.died, 'integer')], [s, I('diedIn'), season(r.died)], [s, I('deathCause'), lit(r.cause, 'string')]);
      if (r.kind === 'herb') {
        out.push([s, I('refugeShare'), lit(r.life ? (r.safe / r.life).toFixed(3) : '0.000', 'decimal')]);
        if (r.refuge) out.push([s, I('bornInRefuge'), I('Refuge' + r.refuge)]);
      }
      for (const p of r.prey) out.push([s, I('preysOn'), cell(p)]);
    }
    return out;
  }

  toQuads() {
    const nn = (v) => ({ termType: 'NamedNode', value: v });
    return this.triples().map(([s, p, o]) => ({
      subject: nn(s), predicate: nn(p),
      object: typeof o === 'string' ? nn(o) : { termType: 'Literal', value: o.v, language: o.lang || '', datatype: nn(o.dt) }
    }));
  }

  toTurtle() {
    const q = (iri) => (iri.startsWith(ECO) ? 'eco:' + iri.slice(ECO.length) : iri === RDF_TYPE ? 'a' : '<' + iri + '>');
    const val = (o) => {
      if (typeof o === 'string') return q(o);
      const t = o.dt.slice(XSD.length);
      return t === 'integer' || t === 'decimal' || t === 'boolean' ? o.v : t === 'string' ? JSON.stringify(o.v) : `${JSON.stringify(o.v)}^^xsd:${t}`;
    };
    const s = this.summary();
    const lines = [
      `# 단세포 생태계 시뮬레이션 한 번의 기록 — 시드 ${this.eco.cfg.seed}, ${this.ticks}틱. 만든 곳: examples/ecosystem/build_eco.mjs`,
      `# 세포 ${s.cells} (초식 ${s.herb} · 육식 ${s.carn}), 포식 ${s.predations}건, 최대 세대 ${s.maxGen}. 스키마는 eco-ontology.ttl`,
      '# ⚠ 시뮬레이션 세계의 가상 생물입니다.',
      `@prefix eco: <${ECO}> .`, `@prefix xsd: <${XSD}> .`, ''
    ];
    let cur = null, buf = [];
    const flush = () => { if (cur) lines.push(q(cur) + ' ' + buf.join(' ; ') + ' .'); buf = []; };
    for (const [s2, p, o] of this.triples()) {
      if (s2 !== cur) { flush(); cur = s2; }
      buf.push(q(p) + ' ' + val(o));
    }
    flush();
    return lines.join('\n') + '\n';
  }
}

// 역량 질문 (eco-ontology.html과 tests/eco-graph.test.mjs가 같이 씀). qEn = 영어 화면에서 쓰는 같은 질의 (결과 글자만 영어)
export const ECO_CYPHER = [
  { ko: '끝까지 살아남은 육식 세포는 어느 첫 세대 조상에서 왔나?', en: 'Which founders do the surviving carnivores come from?',
    q: `// 살아 있는 육식 세포에서 부모 → 부모로 끝(부모가 없는 세포)까지 따라감
MATCH (c:Carnivore {alive: true})-[:DESCENDS_FROM*0..]->(root:Carnivore)
WHERE NOT EXISTS { (root)-[:DESCENDS_FROM]->() }
RETURN root.cellId AS founder, root.origin AS origin, count(c) AS survivors, max(c.generation) AS maxGen
ORDER BY survivors DESC` },
  { ko: '세대가 지나며 초식 세포의 속도와 감지 거리는 어떻게 변했나?', en: 'How did herbivore speed and sensing change over generations?',
    q: `MATCH (h:Herbivore)
WITH h.generation / 5 * 5 AS gen, h
RETURN gen AS fromGen, count(h) AS cells, round(avg(h.speed), 3) AS avgSpeed, round(avg(h.sense), 1) AS avgSense
ORDER BY fromGen` },
  { ko: '피난처에서 오래 머문 초식 세포는 덜 잡아먹혔나?', en: 'Were herbivores that stayed in refuges eaten less?',
    q: `MATCH (h:Herbivore) WHERE h.alive = false
WITH CASE WHEN h.refugeShare >= 0.5 THEN '절반 이상 피난처' WHEN h.refugeShare > 0 THEN '가끔 피난처' ELSE '피난처 밖' END AS stay, h
RETURN stay, count(h) AS died,
       sum(CASE WHEN h.deathCause = 'eaten' THEN 1 ELSE 0 END) AS eaten,
       round(100.0 * sum(CASE WHEN h.deathCause = 'eaten' THEN 1 ELSE 0 END) / count(h), 1) AS eatenPct
ORDER BY eatenPct`,
    qEn: `MATCH (h:Herbivore) WHERE h.alive = false
WITH CASE WHEN h.refugeShare >= 0.5 THEN 'mostly in refuge' WHEN h.refugeShare > 0 THEN 'sometimes' ELSE 'never' END AS stay, h
RETURN stay, count(h) AS died,
       sum(CASE WHEN h.deathCause = 'eaten' THEN 1 ELSE 0 END) AS eaten,
       round(100.0 * sum(CASE WHEN h.deathCause = 'eaten' THEN 1 ELSE 0 END) / count(h), 1) AS eatenPct
ORDER BY eatenPct` },
  { ko: '육식 세포는 어느 계절에 굶어 죽나?', en: 'In which season do carnivores starve?',
    q: `MATCH (c:Carnivore {deathCause: 'starve'})-[:DIED_IN]->(s:Season)
RETURN s.index AS i, s.label AS season, count(c) AS starved
ORDER BY i`,
    qEn: `MATCH (c:Carnivore {deathCause: 'starve'})-[:DIED_IN]->(s:Season)
RETURN s.index AS i, s.label_en AS season, count(c) AS starved
ORDER BY i` },
  { ko: '가장 많이 사냥한 육식 세포와 그 혈통의 깊이는?', en: 'Which carnivores hunted most, and how deep is their lineage?',
    q: `MATCH (c:Carnivore)-[:PREYS_ON]->(h:Herbivore)
WITH c, count(h) AS kills
ORDER BY kills DESC LIMIT 5
MATCH p = (c)-[:DESCENDS_FROM*0..]->(root)
WHERE NOT EXISTS { (root)-[:DESCENDS_FROM]->() }
RETURN c.cellId AS carnivore, kills, c.generation AS gen, length(p) AS ancestors, c.speed AS speed
ORDER BY kills DESC` }
];
