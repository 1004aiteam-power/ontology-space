// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 훈련 시뮬레이션(safety.js) → 안전 온톨로지 개체 데이터 (스키마: examples/safety/safety-schema.ttl)
//
//  시뮬레이션에 이미 있는 것    수칙 11개(RULES) · 시나리오 5개 · 작업 단계 · 역할 · 훈련 오답(wrong)과 그 이유
//  여기서 덧붙이는 것          위험요인(HAZARDS)과 수칙별 위험요인, 단계 → 자산관리 정비 흐름(WF), 현장 → 설비 · 배전선로
//
//  triples()  [주어, 술어, 목적어] (목적어는 IRI 문자열 또는 { v, dt | lang } 리터럴)
//  toQuads()  브라우저 Cypher 엔진(assets/cypher/graph.js)이 읽는 RDF/JS 모양
//  toTurtle() examples/safety/safety-steps.ttl (build_safety.mjs가 저장)
// 브라우저(safety-ontology.html)와 빌드 스크립트(examples/safety/build_safety.mjs), 테스트가 같이 씀
//
// ⚠ 교육용 가상 현장입니다. 설비 · 선로 구간은 가상 배전선로(D/L #1)와 가상 A변전소 데이터입니다.
import { SCENARIOS, ROLES, RULES } from './safety.js?v=c575fd35';

export const SF = 'https://1004aiteam-power.github.io/ontology-space/safety#';
const AIPD = 'https://example.org/ai-promotion-dept/ontology#';
const PAM = 'https://1004aiteam-power.github.io/ontology-space/asset#';
const EX = 'http://example.org/grid#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

// 위험요인 (sf:Hazard ⊑ aipd:Risk)
export const HAZARDS = {
  Shock: { ko: '감전', en: 'Electric shock' },
  Arc: { ko: '아크·화상', en: 'Arc flash & burns' },
  Fall: { ko: '추락', en: 'Fall from height' },
  Struck: { ko: '낙하물·인양물에 맞음', en: 'Struck by falling objects' },
  TipOver: { ko: '작업차 전도', en: 'Work vehicle tipping over' },
  Rollaway: { ko: '작업차 밀림', en: 'Work vehicle rolling away' },
  Vehicle: { ko: '차량 충돌·끼임', en: 'Struck or caught by a vehicle' },
  Asphyxia: { ko: '산소결핍·유해가스', en: 'Oxygen deficiency & toxic gas' },
  Miscoordination: { ko: '작업 착오 (계획·소통 부재)', en: 'Miscoordination (no plan, no briefing)' }
};
// 수칙이 막는 위험요인. 같은 수칙이라도 현장에 따라 막는 위험이 다른 것은 시나리오별로 따로 적음
const RULE_HAZARDS = {
  1: ['Struck', 'Shock'], 2: ['Rollaway'], 3: ['Miscoordination'], 4: ['TipOver'], 5: ['Vehicle', 'Struck'],
  6: ['Struck'], 7: ['Fall'], 8: ['Shock'], 9: ['Asphyxia'], 10: ['Fall', 'Vehicle'], 11: ['Shock', 'Arc']
};
const RULE_HAZARDS_AT = {
  manhole: { 1: ['Struck', 'Asphyxia'], 11: ['Fall'] },          // 맨홀: 뚜껑 전용 공구 · 개구부 방호
  tower: { 1: ['Struck', 'Fall'], 5: ['Struck'], 11: ['Fall'] }   // 철탑: 안전그네 · 낙하물 구역 · 추락방지 설비
};
export const ruleHazards = (scenario, rule) => RULE_HAZARDS_AT[scenario]?.[rule] || RULE_HAZARDS[rule];

// 단계 → 자산관리 온톨로지의 정비 업무 흐름 (pam:WF_04 작업 허가·안전조치 · WF_05 작업 수행 · WF_07 재가압·복구)
const DOING = new Set(['lift', 'txlift', 'enter', 'climb', 'tieoff', 'hoist', 'twork', 'mfinish', 'tdown', 'pulley', 'detach', 'link', 'pull', 'sag', 'tie', 'jumper', 'remove']);
const RESTORE = new Set(['finish', 'txfinish']);
export const stepWorkflow = (id) => (RESTORE.has(id) ? 'WF_07' : DOING.has(id) ? 'WF_05' : 'WF_04');

// 현장 → 작업 대상 설비(자산관리) · 배전선로 구간 (가상 D/L #1, examples/feeder/feeder.ttl의 mRID)
const FEEDER = {
  S5: '_a1e1b903-48f9-5256-8862-92c891050074',            // 구간 개폐기 S5
  main6: '_756664b6-b373-5677-98ab-854ba7714b9f',         // D/L #1 간선 6구간 (S5 뒤)
  main4bp2: '_9deae0c4-be38-58c3-bd4c-bf0f60cba6db',      // D/L #1 간선 4구간 (분기점 BP2까지)
  br2end: '_c8cfbc2d-15f4-5ce1-9862-3e1a8efb577d',        // 분기선 2 끝
  br2load: '_596df0e5-b7d1-5426-9e12-c660a00639f4',       // 분기선 2 부하 (아라 병원, impact-links.ttl)
  toT4: '_604bcf96-d6de-5322-b795-23b28c1f72b9'           // D/L #1 끝 → T4 (연계 개폐기까지)
};
export const SITES = {
  pole: {
    asset: { id: 'AS_PL_0601', cls: SF + 'PoleAsset', code: 'AS-PL-0601', ko: 'D/L #1 6구간 전주 (가상)', en: 'Pole on D/L #1 section 6 (virtual)', at: EX + FEEDER.main6,
      parts: [{ id: 'CP_PL0601_INS', ko: '현수애자', en: 'Suspension insulators', type: 'CT_Insulator' }, { id: 'CP_PL0601_ARM', ko: '완금', en: 'Crossarm', type: 'CT_Crossarm' }] },
    task: PAM + 'MT_10', section: EX + FEEDER.main6, isolate: EX + FEEDER.S5, lineDead: true
  },
  wire: {
    asset: { id: 'AS_WR_0602', cls: SF + 'WireAsset', code: 'AS-WR-0602', ko: 'D/L #1 6구간 가공 전선 · 0↔35번 전주 한 경간 (가상)', en: 'Overhead conductors, one span (poles 0 to 35) on D/L #1 section 6 (virtual)', at: EX + FEEDER.main6, parts: [] },
    task: PAM + 'MT_09', section: EX + FEEDER.main6, isolate: EX + FEEDER.S5, lineDead: true
  },
  tx: {
    asset: { id: 'AS_TR_P0021', cls: PAM + 'TransformerAsset', code: 'AS-TR-P0021', ko: '주상변압기 (분기선 2, 가상)', en: 'Pole transformer on branch 2 (virtual)', at: EX + FEEDER.br2end, parts: [] },
    task: PAM + 'MT_10', section: EX + FEEDER.br2end, liveNearby: EX + FEEDER.main4bp2, load: EX + FEEDER.br2load, lineDead: false
  },
  manhole: {
    asset: { id: 'AS_UG_0004', cls: SF + 'CableAsset', code: 'AS-UG-0004', ko: '지중 케이블 (D/L #1 끝 → T4, 가상)', en: 'Underground cable, D/L #1 end → T4 (virtual)', at: EX + FEEDER.toT4, parts: [] },
    task: PAM + 'IN_01', section: EX + FEEDER.toT4
  },
  tower: {
    asset: { id: 'AS_TW_0017', cls: SF + 'TowerAsset', code: 'AS-TW-0017', ko: 'B-A 154kV 송전 철탑 No.17 (가상)', en: 'B-A 154 kV tower No. 17 (virtual)', at: EX + 'ACLS_1', parts: [], carries: PAM + 'AS_LN_0031' },
    task: PAM + 'IN_01'
  }
};

// 단계에 참여하는 사람 (할 일 줄 · 함수로 만드는 줄 · 진행 중에 펼쳐지는 할 일까지)
function workers(step, world) {
  const ws = new Set();
  const visit = (t) => { if (t.w) ws.add(t.w); if (t.dyn) for (const x of t.dyn(world)) visit(x); };
  for (const lane of step.lanes) for (const t of (typeof lane === 'function' ? lane(world) : lane)) visit(t);
  return [...ws].sort();
}
// 오답 설명 끝의 "(수칙 3, 8)" → [3, 8]. 없으면 그 단계의 수칙
export const violatedRules = (wrong, step) => {
  const m = /\(수칙 ([\d,\s]+)\)/.exec(wrong.why.ko);
  return m ? m[1].split(',').map(s => Number(s.trim())).filter(Boolean) : step.rules;
};
const slug = (s) => s.replace(/\(.*?\)/g, '').replace(/[^A-Za-z]+/g, ' ').trim().split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join('');

export function triples() {
  const out = [], I = (n) => SF + n;
  const lit = (v, dt) => ({ v: String(v), dt: XSD + dt });
  const txt = (o) => [{ v: o.ko, lang: 'ko' }, { v: o.en, lang: 'en' }];
  const add = (s, p, o) => { for (const x of [].concat(o)) out.push([s, p, x]); };
  const ruleIri = (n) => I('Rule' + String(n).padStart(2, '0'));

  for (const [k, h] of Object.entries(HAZARDS)) { const s = I('Hazard' + k); add(s, RDF_TYPE, I('Hazard')); add(s, LABEL, txt(h)); }
  RULES.forEach((r, n) => {
    if (!r) return;
    const s = ruleIri(n), hz = new Set(Object.keys(SCENARIOS).flatMap(sc => ruleHazards(sc, n)));
    add(s, RDF_TYPE, I('SafetyRule')); add(s, I('ruleNo'), lit(n, 'integer')); add(s, LABEL, txt(r));
    for (const h of hz) add(s, I('controls'), I('Hazard' + h));
  });
  const roleIri = new Map();                                             // 역할 이름이 같으면 같은 개체 (작업책임자 등)
  for (const roles of Object.values(ROLES)) for (const r of Object.values(roles)) {
    const id = 'Role' + slug(r.en);
    if (!roleIri.has(r.ko)) { roleIri.set(r.ko, I(id)); add(I(id), RDF_TYPE, I('CrewRole')); add(I(id), LABEL, txt(r)); }
  }
  for (const pt of ['CT_Insulator', 'CT_Crossarm']) add(I(pt), RDF_TYPE, PAM + 'ComponentType');
  add(I('CT_Insulator'), LABEL, { v: 'Insulator', lang: '' }); add(I('CT_Crossarm'), LABEL, { v: 'Crossarm', lang: '' });

  for (const [sc, S] of Object.entries(SCENARIOS)) {
    const site = SITES[sc], scen = I('Scenario_' + sc), world = S.world(), steps = S.steps();
    add(scen, RDF_TYPE, I('WorkScenario')); add(scen, I('scenarioId'), lit(sc, 'string')); add(scen, LABEL, txt(S.title));
    // 작업 대상 설비 (자산관리 온톨로지의 클래스 · 속성으로)
    const a = site.asset, as = I(a.id);
    add(as, RDF_TYPE, a.cls); add(as, PAM + 'code', lit(a.code, 'string')); add(as, LABEL, txt(a)); add(as, PAM + 'installedAt', a.at);
    if (a.carries) add(as, I('carries'), a.carries);
    for (const p of a.parts) {
      add(as, PAM + 'hasComponent', I(p.id));
      add(I(p.id), RDF_TYPE, PAM + 'Component'); add(I(p.id), LABEL, txt(p)); add(I(p.id), PAM + 'componentType', I(p.type));
      add(scen, I('replacesComponent'), I(p.id));
    }
    add(scen, I('targetAsset'), as); add(scen, I('maintenanceTask'), site.task);
    // 배전선로 구간 (정전 작업 구간 · 개방하는 개폐기 · 살아 있는 이웃 선로 · 끊기는 부하)
    if (site.section) add(scen, I('workSection'), site.section);
    if (site.isolate) add(scen, I('isolatedBy'), site.isolate);
    if (site.liveNearby) add(scen, I('liveNearby'), site.liveNearby);
    if (site.load) add(scen, I('interruptsLoad'), site.load);
    if (site.lineDead != null) add(scen, I('lineDeEnergised'), lit(site.lineDead, 'boolean'));

    steps.forEach((st, i) => {
      const s = I(`${sc}_${st.id}`), wf = stepWorkflow(st.id);
      if (i === 0) add(scen, I('firstStep'), s);
      add(s, RDF_TYPE, I('WorkStep')); add(s, I('inScenario'), scen);
      add(s, I('stepId'), lit(st.id, 'string')); add(s, I('stepNo'), lit(i + 1, 'integer'));
      add(s, LABEL, txt(st.title)); add(s, I('instruction'), txt(st.what)); add(s, I('reason'), txt(st.why));
      for (const r of st.rules) add(s, I('appliesRule'), ruleIri(r));
      for (const h of new Set(st.rules.flatMap(r => ruleHazards(sc, r)))) add(s, AIPD + 'hasRisk', I('Hazard' + h));
      for (const w of workers(st, world)) add(s, I('involves'), roleIri.get(ROLES[sc][w].ko));
      add(s, I('inWorkflow'), PAM + wf);
      add(s, AIPD + 'inStage', AIPD + (i === 0 ? 'Stage_Plan' : i === steps.length - 1 ? 'Stage_Close' : wf === 'WF_04' ? 'Stage_Initiate' : 'Stage_Execute'));
      if (i + 1 < steps.length) add(s, AIPD + 'precedes', I(`${sc}_${steps[i + 1].id}`));
      st.wrong.forEach((w, j) => {
        const m = I(`${sc}_${st.id}_x${j + 1}`);
        add(m, RDF_TYPE, I('UnsafeChoice')); add(m, LABEL, txt(w.text)); add(m, I('explanation'), txt(w.why));
        add(m, I('mistakeAt'), s);
        for (const r of violatedRules(w, st)) add(m, I('violates'), ruleIri(r));
      });
    });
  }
  return out;
}

export function toQuads(list = triples()) {
  const nn = (v) => ({ termType: 'NamedNode', value: v });
  return list.map(([s, p, o]) => ({
    subject: nn(s), predicate: nn(p),
    object: typeof o === 'string' ? nn(o) : { termType: 'Literal', value: o.v, language: o.lang || '', datatype: nn(o.lang ? 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' : o.dt || XSD + 'string') }
  }));
}

export function toTurtle(list = triples()) {
  const NS = [['sf', SF], ['aipd', AIPD], ['pam', PAM], ['ex', EX], ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'], ['xsd', XSD]];
  const q = (iri) => {
    if (iri === RDF_TYPE) return 'a';
    for (const [p, ns] of NS) if (iri.startsWith(ns) && /^[A-Za-z_][\w-]*$/.test(iri.slice(ns.length))) return p + ':' + iri.slice(ns.length);
    return '<' + iri + '>';
  };
  const val = (o) => {
    if (typeof o === 'string') return q(o);
    if (o.lang != null) return JSON.stringify(o.v) + (o.lang ? '@' + o.lang : '');
    const t = o.dt.slice(XSD.length);
    return t === 'integer' || t === 'boolean' ? o.v : t === 'string' ? JSON.stringify(o.v) : `${JSON.stringify(o.v)}^^xsd:${t}`;
  };
  const n = (c) => list.filter(([, p, o]) => p === RDF_TYPE && o === SF + c).length;
  const lines = [
    '# 배전공사 안전 온톨로지 — 개체 데이터. 만든 곳: examples/safety/build_safety.mjs (원본: assets/safety/safety.js)',
    `# 시나리오 ${n('WorkScenario')} · 작업 단계 ${n('WorkStep')} · 수칙 ${n('SafetyRule')} · 위험요인 ${n('Hazard')} · 역할 ${n('CrewRole')} · 잘못된 선택 ${n('UnsafeChoice')}. 스키마는 safety-schema.ttl`,
    '# ⚠ 교육용 가상 현장입니다. 설비 · 선로 구간은 가상 데이터이며, 실제 작업은 소속 기관의 작업기준·안전수칙을 따르세요.',
    ...NS.map(([p, ns]) => `@prefix ${p}: <${ns}> .`), ''
  ];
  let cur = null, buf = [];
  const flush = () => { if (cur) lines.push(q(cur) + ' ' + buf.join(' ;\n    ') + ' .'); buf = []; };
  for (const [s, p, o] of list) {
    if (s !== cur) { flush(); cur = s; }
    buf.push(q(p) + ' ' + val(o));
  }
  flush();
  return lines.join('\n') + '\n';
}

// 함께 불러오는 파일: 안전 온톨로지(스키마 · 개체) + 연결되는 업무 · 자산관리 · 배전선로 · 고장 영향 · 예제 변전소
export const SAFETY_SCHEMA = 'examples/safety/safety-schema.ttl';
export const SAFETY_DATA = 'examples/safety/safety-steps.ttl';
export const LINKED_FILES = ['examples/work/work-ontology.ttl', 'examples/asset/asset-ontology.ttl', 'examples/feeder/feeder.ttl', 'examples/impact/impact-links.ttl', 'examples/power-grid-sample.ttl'];

// 역량 질문 (safety-ontology.html · tests/safety-graph.test.mjs). qEn = 영어 화면에서 쓰는 같은 질의 (결과 글자만 영어)
export const SAFETY_CYPHER = [
  { ko: '가공 정전 작업에서 버킷 작업자가 올라가기 전에 끝나야 하는 단계는? (업무 온톨로지의 precedes)', en: 'In the overhead outage job, which steps must finish before the bucket worker goes up? (work ontology precedes)',
    q: `// aipd:precedes (업무 온톨로지의 '직접 선행')를 거꾸로 몇 단계든 따라감
MATCH (up:WorkStep {stepId: 'harness'})-[:IN_SCENARIO]->(:WorkScenario {scenarioId: 'pole'}),
      (before:WorkStep)-[:PRECEDES*]->(up)
OPTIONAL MATCH (before)-[:APPLIES_RULE]->(r:SafetyRule)
RETURN before.stepNo AS no, before.label AS step, collect(r.ruleNo) AS rules
ORDER BY no`,
    qEn: `MATCH (up:WorkStep {stepId: 'harness'})-[:IN_SCENARIO]->(:WorkScenario {scenarioId: 'pole'}),
      (before:WorkStep)-[:PRECEDES*]->(up)
OPTIONAL MATCH (before)-[:APPLIES_RULE]->(r:SafetyRule)
RETURN before.stepNo AS no, before.label_en AS step, collect(r.ruleNo) AS rules
ORDER BY no` },
  { ko: '개폐기 S5를 열면 정전되는 고객은? 연계 개폐기로 다시 살릴 수 있는 구간은? (배전선로 · 고장 영향)', en: 'Which customers lose supply when switch S5 opens, and which zones can be re-fed through a tie? (feeder · impact)',
    q: `// 정전 작업 현장 → 개방하는 개폐기 → 하류로 FEEDS* → 부하 · 연계 개폐기
MATCH (sc:WorkScenario {scenarioId: 'pole'})-[:ISOLATED_BY]->(sw:LoadBreakSwitch)-[:FEEDS*]->(z:FeederZone)
OPTIONAL MATCH (z)-[:FEEDS]->(ld:EnergyConsumer)
OPTIONAL MATCH (z)-[:TIE_TO]->(t:LoadBreakSwitch)-[:TO_FEEDER]->(other:Line)
RETURN sw.name AS opened, z.label AS zone, collect(ld.area) AS areas, sum(ld.customers) AS customers,
       t.name AS tie, other.name AS backupFeeder
ORDER BY zone` },
  { ko: '현장별 작업 대상 설비는 자산관리에서 무엇이고, 어디에 설치돼 있나?', en: 'For each site, what is the target asset in asset management, and where is it installed?',
    q: `MATCH (sc:WorkScenario)-[:TARGET_ASSET]->(a:Asset)-[:INSTALLED_AT]->(loc)
OPTIONAL MATCH (sc)-[:MAINTENANCE_TASK]->(task)
OPTIONAL MATCH (sc)-[:REPLACES_COMPONENT]->(c:Component)
OPTIONAL MATCH (a)-[:CARRIES]->(line:Asset)
RETURN sc.label AS site, a.code AS asset, coalesce(loc.name, loc.uri) AS installedAt, task.label AS task,
       collect(c.label) AS parts, line.label AS carries`,
    qEn: `MATCH (sc:WorkScenario)-[:TARGET_ASSET]->(a:Asset)-[:INSTALLED_AT]->(loc)
OPTIONAL MATCH (sc)-[:MAINTENANCE_TASK]->(task)
OPTIONAL MATCH (sc)-[:REPLACES_COMPONENT]->(c:Component)
OPTIONAL MATCH (a)-[:CARRIES]->(line:Asset)
RETURN sc.label_en AS site, a.code AS asset, coalesce(loc.name, loc.uri) AS installedAt, task.label AS task,
       collect(c.label_en) AS parts, line.label AS carries` },
  { ko: '변압기 교체 때 끊기는 부하에 중요 고객이 있나? 옆에서 살아 있는 선로는?', en: 'Does the transformer job interrupt a critical customer? Which line stays live next to it?',
    q: `MATCH (sc:WorkScenario {scenarioId: 'tx'})-[:INTERRUPTS_LOAD]->(ld:EnergyConsumer),
      (sc)-[:LIVE_NEARBY]->(live:ACLineSegment)
RETURN ld.name AS load, ld.area AS area, ld.customers AS customers, ld.critical AS critical,
       live.name AS liveLine, sc.lineDeEnergised AS mainLineDead` },
  { ko: '위험요인마다 몇 단계에서 막나? 어느 수칙이 막나? (sf:Hazard ⊑ aipd:Risk)', en: 'How many steps guard against each hazard, and by which rules? (sf:Hazard ⊑ aipd:Risk)',
    q: `// HAS_RISK는 업무 온톨로지의 aipd:hasRisk. 위험요인 노드는 Hazard이면서 Risk 라벨도 가짐
MATCH (h:Hazard:Risk)<-[:HAS_RISK]-(s:WorkStep)-[:IN_SCENARIO]->(sc:WorkScenario)
OPTIONAL MATCH (h)<-[:CONTROLS]-(r:SafetyRule)<-[:APPLIES_RULE]-(s)
RETURN h.label AS hazard, count(DISTINCT s) AS steps, collect(DISTINCT sc.scenarioId) AS sites, collect(DISTINCT r.ruleNo) AS rules
ORDER BY steps DESC`,
    qEn: `MATCH (h:Hazard:Risk)<-[:HAS_RISK]-(s:WorkStep)-[:IN_SCENARIO]->(sc:WorkScenario)
OPTIONAL MATCH (h)<-[:CONTROLS]-(r:SafetyRule)<-[:APPLIES_RULE]-(s)
RETURN h.label_en AS hazard, count(DISTINCT s) AS steps, collect(DISTINCT sc.scenarioId) AS sites, collect(DISTINCT r.ruleNo) AS rules
ORDER BY steps DESC` },
  { ko: '훈련에서 어떤 수칙을 어기는 오답이 가장 많나?', en: 'Which rules do the training\'s wrong answers break most often?',
    q: `MATCH (x:UnsafeChoice)-[:VIOLATES]->(r:SafetyRule), (x)-[:MISTAKE_AT]->(s:WorkStep)
RETURN r.ruleNo AS no, r.label AS rule, count(DISTINCT x) AS wrongChoices, count(DISTINCT s) AS steps
ORDER BY wrongChoices DESC, no`,
    qEn: `MATCH (x:UnsafeChoice)-[:VIOLATES]->(r:SafetyRule), (x)-[:MISTAKE_AT]->(s:WorkStep)
RETURN r.ruleNo AS no, r.label_en AS rule, count(DISTINCT x) AS wrongChoices, count(DISTINCT s) AS steps
ORDER BY wrongChoices DESC, no` },
  { ko: '자산관리 정비 흐름(WF)의 어느 단계에 안전조치가 몰려 있나? 업무 생애주기로는?', en: 'Which maintenance workflow step (WF) carries the safety measures, and which lifecycle stage?',
    q: `MATCH (s:WorkStep)-[:IN_WORKFLOW]->(wf:WorkflowStep), (s)-[:IN_STAGE]->(st:LifecycleStage)
RETURN wf.code AS wf, wf.label AS workflow, st.label AS stage, count(s) AS steps
ORDER BY wf, steps DESC` },
  { ko: '역할마다 몇 개 단계에 참여하나? (aipd:Role의 하위 클래스)', en: 'How many steps does each crew role take part in? (subclass of aipd:Role)',
    q: `MATCH (r:CrewRole)<-[:INVOLVES]-(s:WorkStep)-[:IN_SCENARIO]->(sc:WorkScenario)
RETURN r.label AS role, count(s) AS steps, collect(DISTINCT sc.scenarioId) AS sites
ORDER BY steps DESC`,
    qEn: `MATCH (r:CrewRole)<-[:INVOLVES]-(s:WorkStep)-[:IN_SCENARIO]->(sc:WorkScenario)
RETURN r.label_en AS role, count(s) AS steps, collect(DISTINCT sc.scenarioId) AS sites
ORDER BY steps DESC` }
];
