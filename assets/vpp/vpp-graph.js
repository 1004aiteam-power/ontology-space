// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// VPP 10개가 참여하는 가상 전력시장 → VPP 온톨로지 개체 데이터 (스키마: examples/vpp/vpp-schema.ttl)
//
//  계통      디지털 트윈의 154kV 변전소 5곳(광주 · 전주 · 목포 · 군산 · 순천) ← 22.9kV 배전선로 15개 ← DER 80여 개
//  VPP       중개사업자 10곳이 DER을 묶은 가상발전소 10개
//  시장      하루 전 시장 24시간: 입찰(Bid) → 실적 · 정산(Settlement), 배전운영자(DERMS)의 출력제한 지시(CurtailmentInstruction)
//
//  simulate()  24시간 계산 (예측 → 입찰 → 실제 날씨 · 출력제한 → ESS 보정 → 정산)
//  triples()   [주어, 술어, 목적어] (목적어는 IRI 문자열 또는 { v, dt | lang } 리터럴)
//  toQuads()   브라우저 Cypher 엔진(assets/cypher/graph.js)이 읽는 RDF/JS 모양
//  toTurtle()  examples/vpp/vpp-market.ttl (build_vpp.mjs가 저장)
// 브라우저(vpp-market.html)와 빌드 스크립트(examples/vpp/build_vpp.mjs), 테스트가 같이 씀
//
// ⚠ 모든 숫자는 가상입니다. 회사 · 설비 · 배전선로 · 가격 · 정산 규칙은 개념 설명용이며 실제 제도와 다릅니다.

export const VPP = 'https://1004aiteam-power.github.io/ontology-space/vpp#';
const CIM = 'http://iec.ch/TC57/CIM100#';
const TW = 'http://example.org/kr-twin#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const NAME = CIM + 'IdentifiedObject.name';

// ---- 계통: 디지털 트윈(examples/twin/korea_virtual_grid.ttl)의 154kV 변전소 IRI 그대로 -------------------------
export const SUBSTATIONS = {
  GWANGJU: { iri: TW + '_301b3101-17f2-581b-a211-1735dbfa2c62', ko: '광주', en: 'Gwangju' },
  JEONJU: { iri: TW + '_2dc2d0c5-8a46-5e72-89f3-98604795fe47', ko: '전주', en: 'Jeonju' },
  MOKPO: { iri: TW + '_6baafe9b-ed3b-5d70-b9fa-c2f65a27836b', ko: '목포', en: 'Mokpo' },
  GUNSAN: { iri: TW + '_6cfe1260-c04a-5030-a232-ae1440440cec', ko: '군산', en: 'Gunsan' },
  SUNCHEON: { iri: TW + '_3ff77a97-0654-5324-89d2-b4612d4bca03', ko: '순천', en: 'Suncheon' }
};
// 변전소마다 배전선로 3개. kind: 도심(urban) · 공단(industrial) · 농어촌(rural)
// peakMW = 선로 부하 피크, hostingMW = 역송(DER 출력 − 부하)을 받아들일 수 있는 한도
const FEEDER_SPEC = {
  GWANGJU: [['urban', 7.5, 4.0], ['industrial', 6.0, 3.5], ['rural', 2.4, 2.6]],
  JEONJU: [['urban', 6.5, 3.5], ['rural', 2.2, 1.8], ['rural', 1.8, 1.5]],
  MOKPO: [['urban', 5.0, 3.0], ['rural', 1.6, 1.4], ['rural', 1.4, 1.2]],
  GUNSAN: [['industrial', 7.0, 4.0], ['rural', 1.5, 1.2], ['rural', 2.0, 1.6]],
  SUNCHEON: [['urban', 5.5, 3.0], ['industrial', 6.5, 3.5], ['rural', 1.8, 1.5]]
};
// 날씨 (가상): 예측과 실제 운량(0 맑음 ~ 1 흐림), 바람 세기 배율. 전주는 오후에 예보에 없던 구름, 목포는 새벽 바람이 예보보다 약함
const WEATHER = {
  GWANGJU: { cloudFc: () => 0.05, cloud: (h) => 0.05 },
  JEONJU: { cloudFc: () => 0.1, cloud: (h) => (h >= 13 && h <= 16 ? 0.55 : 0.1) },
  MOKPO: { cloudFc: () => 0.05, cloud: () => 0.05, windFc: () => 1.0, wind: (h) => (h <= 6 ? 0.8 : 0.97) },
  GUNSAN: { cloudFc: (h) => (h <= 9 ? 0.4 : 0.05), cloud: (h) => (h <= 10 ? 0.5 : 0.05), windFc: () => 1.0, wind: () => 1.05 },
  SUNCHEON: { cloudFc: () => 0.05, cloud: () => 0.1 }
};

// ---- 24시간 곡선 (가상) ---------------------------------------------------------------------------------------
export const HOURS = [...Array(24).keys()];
const SOLAR = [0, 0, 0, 0, 0, 0, 0.02, 0.12, 0.3, 0.5, 0.68, 0.8, 0.86, 0.84, 0.75, 0.6, 0.4, 0.2, 0.05, 0, 0, 0, 0, 0];
const WIND = [0.55, 0.58, 0.6, 0.6, 0.58, 0.55, 0.5, 0.45, 0.4, 0.36, 0.32, 0.3, 0.3, 0.32, 0.35, 0.38, 0.42, 0.46, 0.5, 0.52, 0.54, 0.55, 0.56, 0.56];
const LOAD = {   // 부하 곡선 (피크 = 1)
  urban: [0.55, 0.5, 0.48, 0.47, 0.48, 0.52, 0.6, 0.72, 0.82, 0.86, 0.88, 0.9, 0.88, 0.9, 0.92, 0.93, 0.95, 0.98, 1.0, 0.97, 0.9, 0.8, 0.7, 0.6],
  industrial: [0.6, 0.58, 0.57, 0.57, 0.58, 0.62, 0.72, 0.85, 0.95, 1.0, 1.0, 0.92, 0.85, 0.98, 1.0, 0.98, 0.95, 0.85, 0.75, 0.7, 0.66, 0.64, 0.62, 0.6],
  rural: [0.5, 0.46, 0.44, 0.44, 0.46, 0.55, 0.7, 0.75, 0.6, 0.48, 0.42, 0.4, 0.4, 0.4, 0.42, 0.48, 0.6, 0.8, 1.0, 0.95, 0.85, 0.72, 0.6, 0.55]
};
// 시간대별 SMP (원/kWh, 가상): 한낮엔 태양광 때문에 낮고 해 질 녘에 가장 높음
export const SMP = [118, 115, 112, 110, 110, 113, 120, 128, 132, 126, 112, 98, 92, 90, 95, 108, 128, 150, 162, 158, 145, 135, 128, 122];
// 정산 규칙 (가상): 오차 ±8% 안이면 예측 정확도 정산금, 넘으면 넘은 양에 SMP의 30%만큼 벌칙
export const RULE = { tolerance: 0.08, incentive: 4, penaltyRate: 0.3 };

// ---- VPP 10개 (가상 회사) --------------------------------------------------------------------------------------
// mix: [자원 종류, 개수]. PV 태양광 · WT 풍력 · ESS · EV 충전소 · DR 수요반응
export const VPPS = [
  { id: 'VPP01', ko: '햇살모아 VPP', en: 'Sunshine VPP', agg: { ko: '햇살모아에너지', en: 'Haetsal Energy' }, regions: ['GWANGJU', 'JEONJU'], mix: [['PV', 9]],
    strategy: { ko: '태양광만 묶음 (가장 단순)', en: 'Solar only (simplest)' } },
  { id: 'VPP02', ko: '빛고을 VPP', en: 'Bitgoeul VPP', agg: { ko: '빛고을파워', en: 'Bitgoeul Power' }, regions: ['GWANGJU'], mix: [['PV', 6], ['ESS', 2]],
    strategy: { ko: '태양광 + ESS로 오차 보정', en: 'Solar + battery to correct errors' } },
  { id: 'VPP03', ko: '새만금 에너지', en: 'Saemangeum Energy', agg: { ko: '새만금그리드', en: 'Saemangeum Grid' }, regions: ['GUNSAN', 'JEONJU'], mix: [['PV', 6], ['WT', 2], ['ESS', 1]],
    strategy: { ko: '태양광 · 풍력 · ESS 혼합', en: 'Solar, wind and battery mix' } },
  { id: 'VPP04', ko: '다도해 바람', en: 'Dadohae Wind', agg: { ko: '다도해에너지', en: 'Dadohae Energy' }, regions: ['MOKPO'], mix: [['WT', 4], ['PV', 4]],
    strategy: { ko: '풍력 중심 (밤에도 발전)', en: 'Wind-led (generates at night too)' } },
  { id: 'VPP05', ko: '충전나눔 VPP', en: 'ChargeShare VPP', agg: { ko: '충전나눔모빌리티', en: 'ChargeShare Mobility' }, regions: ['GWANGJU', 'SUNCHEON', 'JEONJU'], mix: [['EV', 6], ['PV', 2]],
    strategy: { ko: '전기차 충전 미루기 (저녁 피크)', en: 'Deferring EV charging (evening peak)' } },
  { id: 'VPP06', ko: '공장절전 VPP', en: 'FactoryFlex VPP', agg: { ko: '산단수요관리', en: 'Industrial DR Co.' }, regions: ['GUNSAN', 'SUNCHEON', 'GWANGJU'], mix: [['DR', 7]],
    strategy: { ko: '공장 수요반응 (오후 피크 감축)', en: 'Factory demand response (afternoon peak)' } },
  { id: 'VPP07', ko: '마을발전소', en: 'Village Power', agg: { ko: '마을에너지협동조합', en: 'Village Energy Co-op' }, regions: ['JEONJU', 'MOKPO'], mix: [['PV', 8], ['ESS', 1]],
    strategy: { ko: '농촌 지붕 태양광 + 작은 ESS', en: 'Rural rooftop solar + small battery' } },
  { id: 'VPP08', ko: '그린캠퍼스', en: 'Green Campus', agg: { ko: '그린캠퍼스에너지', en: 'Green Campus Energy' }, regions: ['GWANGJU', 'SUNCHEON'], mix: [['PV', 4], ['DR', 2], ['ESS', 1]],
    strategy: { ko: '대학 · 공공건물 태양광 + 냉방 수요반응', en: 'Campus solar + cooling demand response' } },
  { id: 'VPP09', ko: '남도스마트', en: 'Namdo Smart', agg: { ko: '남도스마트그리드', en: 'Namdo Smart Grid' }, regions: ['SUNCHEON', 'MOKPO', 'GUNSAN'], mix: [['PV', 4], ['WT', 1], ['ESS', 1], ['EV', 2], ['DR', 1]],
    strategy: { ko: '다섯 종류 모두 (분산 투자)', en: 'All five kinds (diversified)' } },
  { id: 'VPP10', ko: '한빛배터리', en: 'Hanbit Battery', agg: { ko: '한빛저장', en: 'Hanbit Storage' }, regions: ['GUNSAN', 'JEONJU'], mix: [['ESS', 4], ['PV', 3]],
    strategy: { ko: 'ESS 중심 (한낮에 사서 저녁에 판다)', en: 'Battery-led (buy at noon, sell in the evening)' } }
];
export const DER_KIND = {
  PV: { cls: 'PVSystem', ko: '태양광', en: 'Solar PV' },
  WT: { cls: 'WindSystem', ko: '풍력', en: 'Wind' },
  ESS: { cls: 'BatterySystem', ko: 'ESS', en: 'Battery' },
  EV: { cls: 'EVChargingSite', ko: '전기차 충전소', en: 'EV charging site' },
  DR: { cls: 'DemandResponseResource', ko: '수요반응', en: 'Demand response' }
};
const OWNERS = {
  PV: [['가정 지붕', 'home rooftop'], ['축사 지붕', 'barn rooftop'], ['창고 지붕', 'warehouse roof'], ['영농형', 'agrivoltaic'], ['주차장', 'car park'], ['학교 옥상', 'school roof']],
  WT: [['해안 풍력', 'coastal wind']], ESS: [['상가 ESS', 'commercial battery'], ['태양광 연계 ESS', 'solar-paired battery']],
  EV: [['아파트 충전소', 'apartment chargers'], ['공영주차장 충전소', 'public car park chargers'], ['마트 충전소', 'supermarket chargers']],
  DR: [['주물 공장', 'foundry'], ['냉동 창고', 'cold storage'], ['정수장', 'water works'], ['대학 냉방', 'campus cooling']]
};

// 결정적 난수 (같은 데이터가 늘 나오도록)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;

// ---- 설비 배치 --------------------------------------------------------------------------------------------------
export function buildAssets() {
  const R = rng(20261109);
  const feeders = [];
  for (const [sid, specs] of Object.entries(FEEDER_SPEC)) specs.forEach(([kind, peakMW, hostingMW], i) => {
    const S = SUBSTATIONS[sid];
    feeders.push({ id: `FD_${sid}_${i + 1}`, sid, no: i + 1, kind, peakMW, hostingMW, ko: `${S.ko} D/L ${i + 1}`, en: `${S.en} D/L ${i + 1}` });
  });
  const ders = [], count = {};
  for (const v of VPPS) for (const [k, n] of v.mix) for (let j = 0; j < n; j++) {
    // 태양광 · 풍력은 농어촌 선로에, 수요반응은 공단에, 전기차는 도심에 더 많이
    const cand = feeders.filter(f => v.regions.includes(f.sid));
    const w = cand.map(f => (k === 'PV' || k === 'WT' ? (f.kind === 'rural' ? 2.5 : 1) : k === 'DR' ? (f.kind === 'industrial' ? 4 : 0.5) : k === 'EV' ? (f.kind === 'urban' ? 4 : 1) : 1));
    let x = R() * w.reduce((a, b) => a + b, 0), fi = 0;
    while (x > w[fi]) x -= w[fi++];
    const f = cand[fi];
    count[k] = (count[k] || 0) + 1;
    const own = OWNERS[k][Math.floor(R() * OWNERS[k].length)];
    const d = { id: `${k}_${String(count[k]).padStart(3, '0')}`, kind: k, vpp: v.id, feeder: f.id, owner: { ko: own[0], en: own[1] } };
    if (k === 'PV') d.kw = Math.round((100 + R() * 900) / 10) * 10;
    if (k === 'WT') d.kw = Math.round((600 + R() * 400) / 50) * 50;
    if (k === 'ESS') { d.kw = Math.round((250 + R() * 750) / 50) * 50; d.kwh = d.kw * (2 + Math.floor(R() * 3)); }
    if (k === 'EV') { d.chargers = 4 + Math.floor(R() * 12); d.kw = d.chargers * 50; d.flexKw = Math.round(d.kw * (0.4 + R() * 0.3) / 10) * 10; }
    if (k === 'DR') { d.kw = Math.round((300 + R() * 900) / 10) * 10; d.flexKw = Math.round(d.kw * (0.3 + R() * 0.3) / 10) * 10; d.maxHours = 2 + Math.floor(R() * 3); }
    const word = { PV: ['태양광', 'solar'], WT: ['풍력', 'wind'], ESS: ['ESS', 'battery'], EV: ['충전소', 'chargers'], DR: ['수요반응', 'demand response'] }[k];
    d.ko = `${f.ko} ${own[0]}${own[0].includes(word[0]) ? '' : ' ' + word[0]} ${d.kw}kW`;
    d.en = `${f.en} ${own[1]}${own[1].includes(word[1]) ? '' : ' ' + word[1]} ${d.kw} kW`;
    ders.push(d);
  }
  return { feeders, ders };
}

// ---- 24시간 시장 계산 -------------------------------------------------------------------------------------------
// 1) 하루 전: 예측 날씨로 자원별 출력 예측 → ESS 계획(한낮 SMP가 싼 11~14시 충전, 비싼 18~21시 방전) → VPP 입찰량
// 2) 당일: 실제 날씨 → 배전선로 역송이 한도를 넘으면 DERMS가 그 선로 태양광 · 풍력 출력을 제한
// 3) 실시간 보정: VPP 오차를 ESS 여유로 메움 (출력제한 선로의 ESS는 방전하지 않음) → 계량 실적 → 정산
export function simulate() {
  const { feeders, ders } = buildAssets();
  const F = Object.fromEntries(feeders.map(f => [f.id, f]));
  const sidOf = (d) => F[d.feeder].sid;
  const gen = (d, h, fc) => {
    const W = WEATHER[sidOf(d)];
    if (d.kind === 'PV') return d.kw / 1000 * SOLAR[h] * (1 - (fc ? W.cloudFc(h) : W.cloud(h)));
    if (d.kind === 'WT') return d.kw / 1000 * WIND[h] * ((fc ? W.windFc : W.wind)?.(h) ?? 1);
    return 0;
  };
  // 수요자원: EV는 17~21시 충전을 미룸, DR은 14~17시 중 maxHours 동안 감축 (실제로는 예측의 90% · 95%만 따라옴)
  const flex = (d, h, fc) => {
    if (d.kind === 'EV') return h >= 17 && h <= 21 ? d.flexKw / 1000 * (fc ? 1 : 0.9) : 0;
    if (d.kind === 'DR') return h >= 14 && h < 14 + d.maxHours ? d.flexKw / 1000 * (fc ? 1 : 0.95) : 0;
    return 0;
  };
  const essPlan = (d, h) => (h >= 11 && h <= 14 ? -d.kw / 1000 * 0.5 : h >= 18 && h <= 21 ? d.kw / 1000 * 0.5 : 0);   // + 방전, − 충전 (MW, 1시간)

  // 1) 입찰
  const bids = {};
  for (const v of VPPS) bids[v.id] = HOURS.map(h => {
    const mine = ders.filter(d => d.vpp === v.id);
    let fcGen = 0, plan = 0;
    for (const d of mine) fcGen += gen(d, h, true) + flex(d, h, true);
    for (const d of mine) if (d.kind === 'ESS') plan += essPlan(d, h);
    if (plan < 0) plan = Math.max(plan, -fcGen);      // 충전은 예측 발전량 안에서만 (입찰량이 음수가 되지 않게)
    return r3(fcGen + plan);
  });

  // 2) 실제 출력과 배전선로 출력제한
  const out = Object.fromEntries(ders.map(d => [d.id, HOURS.map(h => gen(d, h, false))]));
  const curtail = [];
  for (const f of feeders) for (const h of HOURS) {
    const on = ders.filter(d => d.feeder === f.id && (d.kind === 'PV' || d.kind === 'WT'));
    const inj = on.reduce((a, d) => a + out[d.id][h], 0), load = f.peakMW * LOAD[f.kind][h];
    const reverse = inj - load;
    if (reverse > f.hostingMW) {
      const allowed = load + f.hostingMW, k = allowed / inj;
      let cut = 0;
      for (const d of on) { cut += out[d.id][h] * (1 - k); out[d.id][h] *= k; }
      curtail.push({ id: `CI_${f.id}_${String(h).padStart(2, '0')}`, feeder: f.id, h, reverseMW: r3(reverse), limitMW: f.hostingMW, curtailedMWh: r3(cut), ders: on.map(d => d.id) });
    }
  }
  const curtailed = new Set(curtail.map(c => c.feeder + '@' + c.h));

  // 3) ESS 보정과 정산
  const settle = {};
  for (const v of VPPS) {
    const mine = ders.filter(d => d.vpp === v.id), ess = mine.filter(d => d.kind === 'ESS');
    const soc = Object.fromEntries(ess.map(d => [d.id, d.kwh / 1000 * 0.5]));   // 처음 50%
    settle[v.id] = HOURS.map(h => {
      let act = 0, cut = 0;
      for (const d of mine) act += out[d.id][h] + flex(d, h, false);
      for (const c of curtail) if (c.h === h) for (const id of c.ders) if (mine.some(d => d.id === id)) cut += (gen(ders.find(d => d.id === id), h, false) - out[id][h]);
      // 계획한 충방전을 먼저 하고, 남은 여유로 오차를 메움
      let essNet = 0, adj = 0;
      for (const d of ess) {
        const e = d.kwh / 1000, p = d.kw / 1000;
        let x = essPlan(d, h);
        if (x < 0) x = Math.max(x, -(e - soc[d.id]));
        if (x > 0) x = Math.min(x, soc[d.id]);
        soc[d.id] -= x; essNet += x;
      }
      if (essNet < 0) { const fcGen = mine.reduce((a, d) => a + gen(d, h, true) + flex(d, h, true), 0); if (-essNet > fcGen) essNet = -Math.min(-essNet, act); }
      let gap = bids[v.id][h] - (act + essNet);
      for (const d of ess) {
        if (Math.abs(gap) < 1e-6) break;
        const e = d.kwh / 1000, p = d.kw / 1000, cur = essPlan(d, h);
        if (gap > 0 && curtailed.has(d.feeder + '@' + h)) continue;          // 출력제한 걸린 선로에서는 더 내보내지 않음
        const room = gap > 0 ? Math.min(p - Math.max(cur, 0), soc[d.id]) : Math.min(p + Math.min(cur, 0), e - soc[d.id]);
        const x = Math.sign(gap) * Math.min(Math.abs(gap), Math.max(room, 0));
        soc[d.id] -= x; adj += x; gap -= x;
      }
      const bid = bids[v.id][h], actual = r3(Math.max(act + essNet + adj, 0));
      const dev = bid > 0 ? (actual - bid) / bid : 0;
      const outside = Math.max(Math.abs(actual - bid) - RULE.tolerance * bid, 0);
      return {
        h, bid, actual, devPct: r1(dev * 100), essAdj: r3(adj), curtailed: r3(cut),
        revenue: Math.round(actual * 1000 * SMP[h]),
        incentive: bid > 0 && outside === 0 ? Math.round(actual * 1000 * RULE.incentive) : 0,
        penalty: Math.round(outside * 1000 * SMP[h] * RULE.penaltyRate)
      };
    });
  }
  return { feeders, ders, bids, settle, curtail };
}

// ---- 트리플 -----------------------------------------------------------------------------------------------------
export function triples(sim = simulate()) {
  const out = [], I = (n) => VPP + n;
  const lit = (v, dt) => ({ v: String(v), dt: XSD + dt });
  const txt = (o) => [{ v: o.ko, lang: 'ko' }, { v: o.en, lang: 'en' }];
  const add = (s, p, o) => { for (const x of [].concat(o)) out.push([s, p, x]); };
  const hourIri = (h) => I('Hour' + String(h).padStart(2, '0'));

  // 운영 주체 · 시장
  add(I('MarketOperator'), RDF_TYPE, I('MarketOperator')); add(I('MarketOperator'), LABEL, txt({ ko: '가상 시장운영자', en: 'Virtual market operator' }));
  add(I('DSO'), RDF_TYPE, I('DistributionOperator')); add(I('DSO'), LABEL, txt({ ko: '가상 배전운영자 (DERMS)', en: 'Virtual distribution operator (DERMS)' }));
  add(I('DayAheadMarket'), RDF_TYPE, I('Market')); add(I('DayAheadMarket'), LABEL, txt({ ko: '가상 하루 전 전력시장', en: 'Virtual day-ahead market' }));
  add(I('DayAheadMarket'), I('operatedBy'), I('MarketOperator'));
  add(I('DayAheadMarket'), I('tolerancePct'), lit(RULE.tolerance * 100, 'decimal'));
  for (const h of HOURS) {
    const s = hourIri(h);
    add(s, RDF_TYPE, I('MarketInterval')); add(s, I('hour'), lit(h, 'integer')); add(s, I('smp'), lit(SMP[h], 'decimal'));
    add(s, LABEL, { v: `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`, lang: '' }); add(s, I('inMarket'), I('DayAheadMarket'));
  }
  // 배전선로 (CIM Feeder) → 디지털 트윈 변전소
  for (const f of sim.feeders) {
    const s = I(f.id);
    add(s, RDF_TYPE, CIM + 'Feeder'); add(s, NAME, { v: f.ko + ' (가상)', lang: '' }); add(s, LABEL, txt(f));
    add(s, CIM + 'Feeder.NormalEnergizingSubstation', SUBSTATIONS[f.sid].iri);
    add(s, I('feederKind'), lit(f.kind, 'string')); add(s, I('peakLoadMW'), lit(f.peakMW, 'decimal')); add(s, I('hostingCapacityMW'), lit(f.hostingMW, 'decimal'));
  }
  // VPP · 중개사업자
  for (const v of VPPS) {
    const s = I(v.id), a = I('AGG_' + v.id.slice(3));
    add(a, RDF_TYPE, I('Aggregator')); add(a, LABEL, txt(v.agg));
    add(s, RDF_TYPE, I('VirtualPowerPlant')); add(s, I('vppId'), lit(v.id, 'string')); add(s, LABEL, txt(v)); add(s, I('strategy'), txt(v.strategy));
    add(s, I('operatedBy'), a); add(s, I('participatesIn'), I('DayAheadMarket'));
  }
  // DER
  for (const d of sim.ders) {
    const s = I(d.id);
    add(s, RDF_TYPE, I(DER_KIND[d.kind].cls)); add(s, I('derId'), lit(d.id, 'string')); add(s, LABEL, txt(d)); add(s, I('ownerType'), txt(d.owner));
    add(s, I('capacityKW'), lit(d.kw, 'decimal'));
    if (d.kwh) add(s, I('energyKWh'), lit(d.kwh, 'decimal'));
    if (d.flexKw) add(s, I('flexibleKW'), lit(d.flexKw, 'decimal'));
    if (d.chargers) add(s, I('chargerCount'), lit(d.chargers, 'integer'));
    if (d.maxHours) add(s, I('maxDurationH'), lit(d.maxHours, 'integer'));
    add(s, CIM + 'Equipment.EquipmentContainer', I(d.feeder));
    add(I(d.vpp), I('aggregates'), s);
  }
  // 입찰 · 정산 (입찰량이 0인 시간은 입찰하지 않은 것으로)
  for (const v of VPPS) for (const st of sim.settle[v.id]) {
    if (st.bid <= 0) continue;
    const hh = String(st.h).padStart(2, '0'), b = I(`BID_${v.id}_${hh}`), x = I(`STL_${v.id}_${hh}`);
    add(b, RDF_TYPE, I('Bid')); add(b, I('submittedBy'), I(v.id)); add(b, I('forInterval'), hourIri(st.h)); add(b, I('offeredMWh'), lit(st.bid, 'decimal'));
    add(x, RDF_TYPE, I('Settlement')); add(x, I('settles'), b);
    add(x, I('actualMWh'), lit(st.actual, 'decimal')); add(x, I('deviationPct'), lit(st.devPct, 'decimal'));
    if (st.essAdj) add(x, I('essAdjustMWh'), lit(st.essAdj, 'decimal'));
    if (st.curtailed) add(x, I('curtailedMWh'), lit(st.curtailed, 'decimal'));
    add(x, I('energyRevenueKRW'), lit(st.revenue, 'integer')); add(x, I('incentiveKRW'), lit(st.incentive, 'integer')); add(x, I('penaltyKRW'), lit(st.penalty, 'integer'));
  }
  // 배전운영자의 출력제한 지시
  for (const c of sim.curtail) {
    const s = I(c.id);
    add(s, RDF_TYPE, I('CurtailmentInstruction')); add(s, I('issuedBy'), I('DSO')); add(s, I('onFeeder'), I(c.feeder)); add(s, I('forInterval'), hourIri(c.h));
    add(s, I('reverseFlowMW'), lit(c.reverseMW, 'decimal')); add(s, I('limitMW'), lit(c.limitMW, 'decimal')); add(s, I('curtailedMWh'), lit(c.curtailedMWh, 'decimal'));
    for (const d of c.ders) add(s, I('affects'), I(d));
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

export const NS = [['vpp', VPP], ['cim', CIM], ['tw', TW], ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'], ['xsd', XSD]];
export const qname = (iri) => {
  if (iri === RDF_TYPE) return 'a';
  for (const [p, ns] of NS) if (iri.startsWith(ns) && /^[A-Za-z_][\w.-]*$/.test(iri.slice(ns.length)) && !iri.endsWith('.')) return p + ':' + iri.slice(ns.length);
  return '<' + iri + '>';
};
export const turtleValue = (o) => {
  if (typeof o === 'string') return qname(o);
  if (o.lang != null) return JSON.stringify(o.v) + (o.lang ? '@' + o.lang : '');
  const t = o.dt.slice(XSD.length);
  return t === 'integer' || t === 'boolean' ? o.v : t === 'string' ? JSON.stringify(o.v) : t === 'decimal' ? (o.v.includes('.') ? o.v : o.v + '.0') : `${JSON.stringify(o.v)}^^xsd:${t}`;
};
// 주어 하나의 트리플 → Turtle 문단 (화면에서 "원본 온톨로지"로 보여 줄 때도 씀)
export function turtleBlock(subject, list) {
  const mine = list.filter(([s]) => s === subject);
  return mine.length ? qname(subject) + ' ' + mine.map(([, p, o]) => qname(p) + ' ' + turtleValue(o)).join(' ;\n    ') + ' .' : '';
}

export function toTurtle(list = triples()) {
  const n = (c) => list.filter(([, p, o]) => p === RDF_TYPE && o === c).length;
  const derN = Object.values(DER_KIND).reduce((a, k) => a + n(VPP + k.cls), 0);
  const lines = [
    '# VPP 가상 전력시장 — 개체 데이터. 만든 곳: examples/vpp/build_vpp.mjs (원본: assets/vpp/vpp-graph.js)',
    `# VPP ${n(VPP + 'VirtualPowerPlant')} · DER ${derN} · 배전선로 ${n(CIM + 'Feeder')} · 시장 시간대 ${n(VPP + 'MarketInterval')} · 입찰 ${n(VPP + 'Bid')} · 정산 ${n(VPP + 'Settlement')} · 출력제한 지시 ${n(VPP + 'CurtailmentInstruction')}. 스키마는 vpp-schema.ttl`,
    '# 변전소(tw:)는 디지털 트윈(examples/twin/korea_virtual_grid.ttl)의 개체를 그대로 가리킵니다.',
    '# ⚠ 가상 데이터입니다. 회사 · 설비 · 배전선로 · 가격 · 정산 규칙은 개념 설명용이며 실제 제도와 다릅니다.',
    ...NS.map(([p, ns]) => `@prefix ${p}: <${ns}> .`), ''
  ];
  let cur = null, buf = [];
  const flush = () => { if (cur) lines.push(qname(cur) + ' ' + buf.join(' ;\n    ') + ' .\n'); buf = []; };
  for (const [s, p, o] of list) {
    if (s !== cur) { flush(); cur = s; }
    buf.push(qname(p) + ' ' + turtleValue(o));
  }
  flush();
  return lines.join('\n');
}

export const VPP_SCHEMA = 'examples/vpp/vpp-schema.ttl';
export const VPP_DATA = 'examples/vpp/vpp-market.ttl';
export const LINKED_FILES = ['examples/twin/korea_virtual_grid.ttl'];

// 역량 질문 (vpp-market.html · tests/vpp-graph.test.mjs). qEn = 영어 화면에서 쓰는 같은 질의 (결과 글자만 영어)
const en = (q) => q.replace(/\.label\b/g, '.label_en').replace(/\.strategy\b/g, '.strategy_en');
const C = (ko, enT, q) => ({ ko, en: enT, q, qEn: en(q) });
export const VPP_CYPHER = [
  C('VPP마다 어떤 자원을 얼마나 묶었나?', 'What resources does each VPP aggregate, and how much?',
    `MATCH (v:VirtualPowerPlant)-[:AGGREGATES]->(d:DER)
RETURN v.vppId AS vpp, v.label AS name, count(d) AS ders,
       sum(CASE WHEN d:PVSystem THEN 1 ELSE 0 END) AS pv,
       sum(CASE WHEN d:WindSystem THEN 1 ELSE 0 END) AS wind,
       sum(CASE WHEN d:BatterySystem THEN 1 ELSE 0 END) AS ess,
       sum(CASE WHEN d:EVChargingSite THEN 1 ELSE 0 END) AS ev,
       sum(CASE WHEN d:DemandResponseResource THEN 1 ELSE 0 END) AS dr,
       round(sum(d.capacityKW) * 0.001, 2) AS capacityMW
ORDER BY vpp`),
  C('VPP의 자원은 어느 배전선로 · 변전소에 흩어져 있나? (CIM · 디지털 트윈과 연결)', 'Across which feeders and substations is each VPP spread? (joins CIM and the digital twin)',
    `// DER -[:EQUIPMENT_CONTAINER]-> Feeder -[:NORMAL_ENERGIZING_SUBSTATION]-> 디지털 트윈의 154kV 변전소
MATCH (v:VirtualPowerPlant)-[:AGGREGATES]->(d:DER)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
      -[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
RETURN v.vppId AS vpp, s.name AS substation, f.label AS feeder, count(d) AS ders,
       round(sum(d.capacityKW) * 0.001, 2) AS MW
ORDER BY vpp, substation, feeder`),
  C('한 배전선로에 VPP가 몇 개나 겹치나? (배전운영자가 조정해야 하는 곳)', 'How many VPPs share each feeder? (where the DSO has to coordinate)',
    `MATCH (v:VirtualPowerPlant)-[:AGGREGATES]->(d:DER)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
WITH f, collect(DISTINCT v.vppId) AS vpps, sum(CASE WHEN d:PVSystem OR d:WindSystem THEN d.capacityKW ELSE 0 END) AS genKW
RETURN f.label AS feeder, f.feederKind AS kind, size(vpps) AS vppCount, vpps,
       round(genKW * 0.001, 2) AS renewableMW, f.hostingCapacityMW AS hostingMW
ORDER BY vppCount DESC, renewableMW DESC`),
  C('출력제한 지시는 어느 선로, 몇 시에 나왔고 어느 VPP가 손해를 봤나?', 'Where and when were curtailment instructions issued, and which VPPs lost output?',
    `MATCH (ci:CurtailmentInstruction)-[:ON_FEEDER]->(f:Feeder), (ci)-[:FOR_INTERVAL]->(h:MarketInterval),
      (ci)-[:AFFECTS]->(d:DER)<-[:AGGREGATES]-(v:VirtualPowerPlant)
RETURN f.label AS feeder, h.hour AS hour, ci.reverseFlowMW AS reverseMW, ci.limitMW AS limitMW,
       ci.curtailedMWh AS curtailedMWh, collect(DISTINCT v.vppId) AS vpps
ORDER BY feeder, hour`),
  C('14시 시장: VPP별 입찰량 · 실적 · 오차는? (전주는 예보에 없던 구름)', 'The 14:00 market: bid, actual and deviation per VPP (unforecast clouds over Jeonju)',
    `MATCH (s:Settlement)-[:SETTLES]->(b:Bid)-[:FOR_INTERVAL]->(h:MarketInterval {hour: 14}),
      (b)-[:SUBMITTED_BY]->(v:VirtualPowerPlant)
RETURN v.vppId AS vpp, v.label AS name, b.offeredMWh AS bid, s.actualMWh AS actual, s.deviationPct AS devPct,
       coalesce(s.essAdjustMWh, 0) AS essAdj, coalesce(s.curtailedMWh, 0) AS curtailed, h.smp AS smp
ORDER BY abs(devPct) DESC`),
  C('하루 정산: VPP별 수익 · 정산금 · 벌칙 순위', 'Daily settlement: revenue, incentive and penalty ranking',
    `MATCH (v:VirtualPowerPlant)<-[:SUBMITTED_BY]-(b:Bid)<-[:SETTLES]-(s:Settlement)
WITH v, sum(b.offeredMWh) AS bid, sum(s.actualMWh) AS actual, sum(s.energyRevenueKRW) AS revenue,
     sum(s.incentiveKRW) AS incentive, sum(s.penaltyKRW) AS penalty,
     sum(CASE WHEN abs(s.deviationPct) <= 8 THEN 1 ELSE 0 END) AS hoursInBand, count(s) AS hours
RETURN v.vppId AS vpp, v.label AS name, round(bid, 2) AS bidMWh, round(actual, 2) AS actualMWh,
       hoursInBand + '/' + hours AS inBand, revenue + incentive - penalty AS netKRW, penalty AS penaltyKRW
ORDER BY netKRW DESC`),
  C('ESS가 있는 VPP와 없는 VPP, 오차 범위를 지킨 비율은?', 'Share of hours within tolerance: VPPs with and without a battery',
    `MATCH (v:VirtualPowerPlant)
WITH v, EXISTS { (v)-[:AGGREGATES]->(:BatterySystem) } AS hasESS
MATCH (v)<-[:SUBMITTED_BY]-(:Bid)<-[:SETTLES]-(s:Settlement)
RETURN hasESS, count(DISTINCT v) AS vpps, count(s) AS bids,
       round(avg(CASE WHEN abs(s.deviationPct) <= 8 THEN 100.0 ELSE 0.0 END), 1) AS inBandPct,
       round(avg(abs(s.deviationPct)), 1) AS avgAbsDevPct
ORDER BY hasESS DESC`),
  C('변전소(디지털 트윈)별로 VPP 자원 용량은 얼마나 되나?', 'How much VPP capacity sits under each substation (digital twin)?',
    `MATCH (d:DER)-[:EQUIPMENT_CONTAINER]->(:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
OPTIONAL MATCH (s)<-[:NORMAL_ENERGIZING_SUBSTATION]-(f:Feeder)
WITH s, d, count(DISTINCT f) AS feeders
RETURN s.name AS substation, feeders, count(d) AS ders,
       round(sum(CASE WHEN d:PVSystem OR d:WindSystem THEN d.capacityKW ELSE 0 END) * 0.001, 2) AS renewableMW,
       round(sum(CASE WHEN d:BatterySystem THEN d.capacityKW ELSE 0 END) * 0.001, 2) AS essMW,
       round(sum(coalesce(d.flexibleKW, 0)) * 0.001, 2) AS flexMW
ORDER BY renewableMW DESC`)
];
