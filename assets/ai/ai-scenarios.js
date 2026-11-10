// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// AI × 온톨로지 시연 (ai.html)의 시나리오
//
//  ⚠ 시연용: "AI가 하는 부분"(Cypher 작성, 생각, 도구 선택)은 미리 작성한 예시입니다. 실제 LLM을 부르지 않습니다.
//     대신 Cypher 실행과 그 결과, 결과로 만든 답 · 보고서는 브라우저에서 실제 그래프에 매번 계산합니다.
//
//  GRAPHRAG  자연어 질문 → (온톨로지에서 꺼낸 스키마) → Cypher → 실행 → 결과로만 답 → 근거 노드
//  AGENT     고장 영향 분석: 생각 → 도구 호출(Cypher) → 관찰 → … → 보고서
// 브라우저(assets/ai/ai-app.js)와 테스트(tests/ai-demo.test.mjs)가 같이 씀

export const GRAPHRAG_FILES = ['examples/vpp/vpp-schema.ttl', 'examples/vpp/vpp-market.ttl', 'examples/twin/korea_virtual_grid.ttl'];
export const AGENT_FILES = ['examples/impact/impact-links.ttl', 'examples/asset/asset-ontology.ttl', 'examples/feeder/feeder.ttl'];

// 영어 화면: 결과로 보여 주는 이름만 영어 속성으로 (값으로 찾는 {label: '…'}은 그대로)
export const toEn = (q) => q.replace(/\.label\b/g, '.label_en');
const nf = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const list = (a) => a.join(', ');

// ---- GraphRAG: VPP 가상 전력시장 그래프에 묻기 ------------------------------------------------------------------
export const GRAPHRAG = [
  {
    id: 'curtail',
    q: { ko: '광주 D/L 3에 출력제한이 걸리면 어느 VPP가 손해를 보나?', en: 'When Gwangju D/L 3 is curtailed, which VPPs lose out?' },
    cypher: `// 선로 ← 출력제한 지시 → 영향받은 DER ← 묶은 VPP
MATCH (f:Feeder {label: '광주 D/L 3'})<-[:ON_FEEDER]-(ci:CurtailmentInstruction)
      -[:FOR_INTERVAL]->(h:MarketInterval),
      (ci)-[:AFFECTS]->(d:DER)<-[:AGGREGATES]-(v:VirtualPowerPlant)
RETURN v.vppId AS vpp, v.label AS name, count(DISTINCT d) AS ders,
       collect(DISTINCT h.hour) AS hours
ORDER BY vpp`,
    extra: `MATCH (f:Feeder {label: '광주 D/L 3'})<-[:ON_FEEDER]-(ci:CurtailmentInstruction)
RETURN round(sum(ci.curtailedMWh), 2) AS mwh, max(ci.reverseFlowMW) AS peak, f.hostingCapacityMW AS limit`,
    focus: `MATCH (f:Feeder {label: '광주 D/L 3'})<-[:ON_FEEDER]-(ci:CurtailmentInstruction)-[:AFFECTS]->(d:DER)<-[:AGGREGATES]-(v:VirtualPowerPlant)
MATCH (f)-[:NORMAL_ENERGIZING_SUBSTATION]->(s)
RETURN f, ci, d, v, s`,
    answer(rows, extra, en) {
      if (!rows.length) return en ? 'The graph has no curtailment on that feeder.' : '그래프에는 그 선로의 출력제한 기록이 없습니다.';
      const hours = [...new Set(rows.flatMap(r => r[3]))].sort((a, b) => a - b);
      const [mwh, peak, limit] = extra[0];
      const who = rows.map(r => en ? `${r[1]} (${r[0]}, ${r[2]} resources)` : `${r[1]}(${r[0]}, 자원 ${r[2]}개)`);
      return en
        ? `${rows.length} VPPs lose output: ${list(who, en)}. Curtailment was issued for ${hours.length} hours (${hours[0]}:00–${hours[hours.length - 1] + 1}:00) because reverse flow reached up to ${peak} MW against a ${limit} MW limit; ${mwh} MWh was cut in total.`
        : `손해를 보는 VPP는 ${rows.length}곳입니다: ${list(who)}. 역송이 최대 ${peak}MW로 한도 ${limit}MW를 넘어 ${hours[0]}시~${hours[hours.length - 1] + 1}시, ${hours.length}시간 동안 출력제한이 걸렸고 모두 ${mwh}MWh가 깎였습니다.`;
    },
    naive: { ko: '광주 지역 배전선로에 출력제한이 걸리면 그 지역에서 태양광을 많이 운영하는 VPP 사업자들이 손해를 볼 가능성이 높습니다. 구체적인 사업자는 해당 지역의 계통 정보를 확인해야 알 수 있습니다.', en: 'If a Gwangju feeder is curtailed, VPP operators running a lot of solar in that area are likely to lose out. You would need the local grid data to name them.' }
  },
  {
    id: 'shared',
    q: { ko: '전주 D/L 2에 자원을 둔 VPP는 어디이고, 각각 얼마나 되나?', en: 'Which VPPs have resources on Jeonju D/L 2, and how much each?' },
    cypher: `MATCH (v:VirtualPowerPlant)-[:AGGREGATES]->(d:DER)
      -[:EQUIPMENT_CONTAINER]->(f:Feeder {label: '전주 D/L 2'})
RETURN v.vppId AS vpp, v.label AS name, count(d) AS ders,
       round(sum(d.capacityKW) * 0.001, 2) AS MW
ORDER BY MW DESC`,
    extra: `MATCH (f:Feeder {label: '전주 D/L 2'}) RETURN f.hostingCapacityMW AS limit, f.feederKind AS kind`,
    focus: `MATCH (v:VirtualPowerPlant)-[:AGGREGATES]->(d:DER)-[:EQUIPMENT_CONTAINER]->(f:Feeder {label: '전주 D/L 2'})-[:NORMAL_ENERGIZING_SUBSTATION]->(s)
RETURN v, d, f, s`,
    answer(rows, extra, en) {
      if (!rows.length) return en ? 'No VPP resources are on that feeder in the graph.' : '그래프에는 그 선로의 VPP 자원이 없습니다.';
      const total = rows.reduce((a, r) => a + r[3], 0).toFixed(2), [limit] = extra[0];
      const who = rows.map(r => en ? `${r[1]} ${r[3]} MW` : `${r[1]} ${r[3]}MW`);
      return en
        ? `${rows.length} VPPs share it: ${list(who, en)} — ${total} MW in all, while the feeder can take ${limit} MW of reverse flow. With this many operators on one feeder, the distribution operator has to coordinate them.`
        : `${rows.length}개 VPP가 함께 쓰고 있습니다: ${list(who)}. 합계 ${total}MW이고 이 선로의 역송 한도는 ${limit}MW입니다. 한 선로에 사업자가 이렇게 겹치면 배전운영자가 조정해야 합니다.`;
    },
    naive: { ko: '전주 지역에는 여러 태양광 발전사업자와 VPP 사업자가 활동하고 있습니다. 특정 배전선로에 연결된 사업자 목록은 한전 배전 정보나 사업자 공시를 통해 확인할 수 있습니다.', en: 'Several solar and VPP operators are active around Jeonju. Which ones sit on a given feeder can be checked in KEPCO distribution data or company disclosures.' }
  },
  {
    id: 'why14',
    q: { ko: '14시에 약속을 가장 크게 어긴 VPP는? 왜 그랬나?', en: 'Which VPP missed its 14:00 promise the most, and why?' },
    cypher: `MATCH (s:Settlement)-[:SETTLES]->(b:Bid)-[:FOR_INTERVAL]->(:MarketInterval {hour: 14}),
      (b)-[:SUBMITTED_BY]->(v:VirtualPowerPlant)
RETURN v.vppId AS vpp, v.label AS name, b.offeredMWh AS bid, s.actualMWh AS actual,
       s.deviationPct AS dev, coalesce(s.curtailedMWh, 0) AS curtailed,
       coalesce(s.essAdjustMWh, 0) AS ess,
       EXISTS { (v)-[:AGGREGATES]->(:BatterySystem) } AS hasESS
ORDER BY abs(dev) DESC LIMIT 1`,
    extra: `MATCH (s:Settlement)-[:SETTLES]->(b:Bid)-[:FOR_INTERVAL]->(:MarketInterval {hour: 14}), (b)-[:SUBMITTED_BY]->(v:VirtualPowerPlant)
WITH v ORDER BY abs(s.deviationPct) DESC LIMIT 1
MATCH (v)-[:AGGREGATES]->(d:DER)-[:EQUIPMENT_CONTAINER]->(:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(sub:Substation)
RETURN sub.name AS substation, count(d) AS ders ORDER BY ders DESC`,
    focus: `MATCH (s:Settlement)-[:SETTLES]->(b:Bid)-[:FOR_INTERVAL]->(h:MarketInterval {hour: 14}), (b)-[:SUBMITTED_BY]->(v:VirtualPowerPlant)
WITH v, s, b, h ORDER BY abs(s.deviationPct) DESC LIMIT 1
MATCH (v)-[:AGGREGATES]->(d:DER)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
RETURN v, s, b, h, d, f`,
    answer(rows, extra, en) {
      const [vpp, name, bid, actual, dev, cut, ess, hasESS] = rows[0];
      const subs = extra.map(r => en ? `${r[0]} ${r[1]}` : `${r[0]} ${r[1]}개`);
      const cutShare = bid - actual > 0 ? Math.round(cut / (bid - actual) * 100) : 0;
      return en
        ? `${name} (${vpp}): it bid ${bid} MWh but delivered ${actual} MWh (${dev}%). The graph explains part of it: ${cut} MWh — about ${cutShare}% of the gap — was cut by curtailment, and the VPP ${hasESS ? 'has' : 'has no'} battery to fill the rest. Its resources sit under ${list(subs, en)}. The remaining gap is not in the graph: weather is not stored, so I cannot say it was clouds — only that the cause lies outside the data.`
        : `${name}(${vpp})입니다. ${bid}MWh를 약속했지만 ${actual}MWh만 냈습니다(오차 ${dev}%). 그래프로 설명되는 것은 출력제한으로 깎인 ${cut}MWh, 모자란 양의 약 ${cutShare}%입니다. 이 VPP는 나머지를 메울 ESS가 ${hasESS ? '있습니다' : '없습니다'}. 자원은 ${list(subs)}에 있습니다. 나머지 원인은 그래프에 없습니다. 날씨는 저장돼 있지 않으므로 "구름 때문"이라고 단정하지 않고, 데이터 밖의 원인이라고만 답합니다.`;
    },
    naive: { ko: '14시는 태양광 발전이 가장 많은 시간대라 예측 오차도 커집니다. 아마 태양광 비중이 높은 VPP가 구름 때문에 약속을 지키지 못했을 것입니다.', en: '14:00 is peak solar, so forecast errors are largest then. Probably a solar-heavy VPP missed its promise because of clouds.' }
  },
  {
    id: 'dr',
    q: { ko: '순천 변전소 아래에서 수요반응으로 줄일 수 있는 전력은 얼마나 되나?', en: 'How much load can demand response cut under Suncheon substation?' },
    cypher: `// 디지털 트윈의 변전소에서 시작해 선로 → 자원까지 내려감
MATCH (d:DemandResponseResource)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
      -[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation {name: '순천 (가상)'}),
      (v:VirtualPowerPlant)-[:AGGREGATES]->(d)
RETURN v.vppId AS vpp, d.label AS resource, f.label AS feeder,
       d.flexibleKW AS flexKW, d.maxDurationH AS hours
ORDER BY flexKW DESC`,
    extra: `RETURN 1`,
    focus: `MATCH (d:DemandResponseResource)-[:EQUIPMENT_CONTAINER]->(f:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation {name: '순천 (가상)'}), (v:VirtualPowerPlant)-[:AGGREGATES]->(d)
RETURN d, f, s, v`,
    answer(rows, extra, en) {
      if (!rows.length) return en ? 'No demand-response resources found there.' : '그곳에는 수요반응 자원이 없습니다.';
      const kw = rows.reduce((a, r) => a + r[3], 0), minH = Math.min(...rows.map(r => r[4]));
      const vpps = [...new Set(rows.map(r => r[0]))];
      return en
        ? `${rows.length} resources from ${vpps.length} VPPs (${list(vpps, en)}) can cut ${nf(kw)} kW together. All of them can hold it for at least ${minH} hours; longer cuts rely on fewer resources.`
        : `${vpps.length}개 VPP(${list(vpps)})의 자원 ${rows.length}곳을 합쳐 ${nf(kw)}kW를 줄일 수 있습니다. 모두 함께라면 최소 ${minH}시간 유지할 수 있고, 그보다 길게는 일부 자원만 버팁니다.`;
    },
    naive: { ko: '순천 지역에는 산업단지가 있어 공장 수요반응 잠재량이 상당할 것으로 보입니다. 정확한 양은 전력거래소의 수요반응 자원 등록 현황을 확인해야 합니다.', en: 'Suncheon has industrial areas, so its factory demand-response potential is likely sizeable. The exact amount would be in KPX\'s DR registration records.' }
  },
  {
    id: 'best',
    q: { ko: '하루 정산에서 가장 많이 번 VPP는? 벌칙은 얼마였나?', en: 'Which VPP earned the most in the daily settlement, and what was its penalty?' },
    cypher: `MATCH (v:VirtualPowerPlant)<-[:SUBMITTED_BY]-(b:Bid)<-[:SETTLES]-(s:Settlement)
WITH v, sum(s.energyRevenueKRW) + sum(s.incentiveKRW) - sum(s.penaltyKRW) AS net,
     sum(s.penaltyKRW) AS penalty, count(s) AS hours
RETURN v.vppId AS vpp, v.label AS name, net, penalty, hours
ORDER BY net DESC LIMIT 1`,
    extra: `MATCH (v:VirtualPowerPlant)<-[:SUBMITTED_BY]-(b:Bid)<-[:SETTLES]-(s:Settlement)
WITH v, sum(s.energyRevenueKRW) + sum(s.incentiveKRW) - sum(s.penaltyKRW) AS net ORDER BY net DESC LIMIT 1
MATCH (v)-[:AGGREGATES]->(d:DER)
RETURN sum(CASE WHEN d:WindSystem THEN 1 ELSE 0 END) AS wind, sum(CASE WHEN d:PVSystem THEN 1 ELSE 0 END) AS pv, count(d) AS ders`,
    focus: `MATCH (v:VirtualPowerPlant)<-[:SUBMITTED_BY]-(b:Bid)<-[:SETTLES]-(s:Settlement)
WITH v, sum(s.energyRevenueKRW) + sum(s.incentiveKRW) - sum(s.penaltyKRW) AS net ORDER BY net DESC LIMIT 1
MATCH (v)-[:AGGREGATES]->(d:DER)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
OPTIONAL MATCH (v)-[:OPERATED_BY]->(a)
RETURN v, d, f, a`,
    answer(rows, extra, en) {
      const [vpp, name, net, penalty, hours] = rows[0], [wind, pv, ders] = extra[0];
      return en
        ? `${name} (${vpp}) earned the most: ${nf(net)} KRW net over ${hours} bid hours, after a ${nf(penalty)} KRW penalty. Of its ${ders} resources, ${wind} are wind turbines — wind keeps generating at night, so it bid all 24 hours. (Virtual numbers.)`
        : `가장 많이 번 VPP는 ${name}(${vpp})입니다. 입찰한 ${hours}시간의 순수익은 ${nf(net)}원으로, 벌칙 ${nf(penalty)}원을 뺀 값입니다. 자원 ${ders}개 가운데 ${wind}개가 풍력이라 밤에도 발전해 24시간 모두 입찰할 수 있었던 것이 큽니다. (가상 숫자)`;
    },
    naive: { ko: '일반적으로 태양광과 ESS를 함께 운영하는 VPP가 오차가 작아 수익이 좋은 편입니다. 다만 실제 정산 결과는 공개되지 않는 경우가 많습니다.', en: 'Generally VPPs combining solar and batteries earn well thanks to small errors. Actual settlement results are often not public, though.' }
  }
];

// ---- AI 에이전트: 고장 영향 분석 ----------------------------------------------------------------------------------
// 도구는 모두 "온톨로지 위의 질의"입니다. 에이전트는 무엇을 물을지만 고르고, 답은 그래프가 냅니다.
export const TOOLS = {
  find_risky_assets: { ko: '위험도 높은 설비 찾기', en: 'Find high-risk assets' },
  get_diagnoses: { ko: '진단 이력 읽기', en: 'Read diagnosis history' },
  trace_downstream: { ko: '하류 구간 · 고객 따라가기', en: 'Trace downstream zones and customers' },
  find_critical_loads: { ko: '중요 고객 찾기', en: 'Find critical customers' },
  find_tie_switches: { ko: '연계 개폐기 찾기', en: 'Find tie switches' },
  get_work_orders: { ko: '예정된 작업 확인', en: 'Check planned work' }
};

export const AGENT = {
  task: { ko: 'A변전소에서 고장 위험이 가장 큰 설비를 찾고, 고장 나면 누가 영향을 받는지, 무엇부터 해야 하는지 보고하라.', en: 'Find the asset at A substation most at risk of failure, who would be affected if it failed, and what to do first.' },
  steps: [
    {
      tool: 'find_risky_assets', args: '{ minRisk: 10 }',
      thought: { ko: '먼저 "가장 위험한 설비"가 무엇인지 알아야 한다. 자산관리 온톨로지의 위험도(PoF × CoF)로 정렬해 보자.', en: 'First I need to know which asset is riskiest. Sort by the asset ontology\'s risk score (PoF × CoF).' },
      cypher: `MATCH (a:Asset) WHERE a.riskScore IS NOT NULL
RETURN a.code AS code, a.label AS asset, a.riskScore AS risk,
       a.probabilityOfFailure AS pof, a.consequenceOfFailure AS cof, a.healthIndex AS hi
ORDER BY risk DESC`,
      focus: `MATCH (a:Asset) WHERE a.riskScore >= 10 RETURN a`,
      observe(rows, en) {
        const [code, asset, risk, pof, cof, hi] = rows[0], next = rows[1];
        return en ? `${asset} (${code}) stands out: risk ${risk} = PoF ${pof} × CoF ${cof}, health index ${hi}. The next one is only ${next[2]}.`
          : `${asset}(${code})가 두드러진다. 위험도 ${risk} = 고장확률 ${pof} × 영향도 ${cof}, 건전도 ${hi}. 두 번째 설비는 ${next[2]}에 불과하다.`;
      }
    },
    {
      tool: 'get_diagnoses', args: "{ asset: 'AS-TR-0007' }",
      thought: { ko: '위험도가 왜 높은지 근거가 필요하다. 이 설비에 걸린 진단 기록을 읽자.', en: 'I need evidence for the high risk. Read the diagnoses recorded on this asset.' },
      cypher: `MATCH (d:Diagnosis)-[:ON_ASSET]->(:Asset {code: 'AS-TR-0007'})
RETURN d.date AS date, d.finding AS finding
ORDER BY date DESC`,
      focus: `MATCH (d:Diagnosis)-[:ON_ASSET]->(a:Asset {code: 'AS-TR-0007'}) RETURN d, a`,
      observe(rows, en) {
        const warn = rows.filter(r => /초과|기준/.test(r[1]));
        return en ? `${rows.length} diagnoses. ${warn.length} exceed a threshold: ${warn.map(r => `${r[0]} "${r[1]}"`).join('; ')}. Dissolved gas and the tap changer's operation count are the warning signs.`
          : `진단 ${rows.length}건 중 ${warn.length}건이 기준을 넘었다: ${warn.map(r => `${r[0]} "${r[1]}"`).join(', ')}. 절연유 가스와 탭절환기 동작 횟수가 경고 신호다.`;
      }
    },
    {
      tool: 'trace_downstream', args: "{ from: 'AS-TR-0007' }",
      thought: { ko: '이 변압기가 고장 나면 전기가 끊기는 범위는 공급 관계(feeds)를 하류로 끝까지 따라가면 나온다. 설치 위치에서 출발하자.', en: 'If this transformer fails, the outage area is wherever the supply relation (feeds) leads downstream. Start from where it is installed.' },
      cypher: `// 자산 → 설치 위치 → FEEDS* (이행적 공급 관계) → 구간 → 부하
MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)
WITH DISTINCT z
OPTIONAL MATCH (z)-[:FEEDS]->(ld:EnergyConsumer)
RETURN z.label AS zone, collect(ld.area) AS areas, sum(ld.customers) AS customers
ORDER BY zone`,
      focus: `MATCH p = (a:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)
OPTIONAL MATCH (z)-[:FEEDS]->(ld:EnergyConsumer)
RETURN p, ld`,
      observe(rows, en) {
        const total = rows.reduce((a, r) => a + r[2], 0), hit = rows.filter(r => r[2] > 0);
        return en ? `The whole of D/L #1 goes dark: ${rows.length} zones, ${hit.length} with customers, ${nf(total)} customers in total.`
          : `D/L #1 전체가 끊긴다. 구간 ${rows.length}개, 그중 고객이 있는 구간 ${hit.length}개, 모두 ${nf(total)}호.`;
      }
    },
    {
      tool: 'find_critical_loads', args: "{ from: 'AS-TR-0007' }",
      thought: { ko: '고객 수만으로는 부족하다. 병원처럼 먼저 살려야 할 중요 고객이 있는지 확인하자.', en: 'Customer counts are not enough. Check for critical customers such as hospitals that must come back first.' },
      cypher: `MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)
      -[:FEEDS]->(ld:EnergyConsumer)
WHERE ld.critical = true
RETURN DISTINCT ld.area AS area, ld.customers AS customers, z.label AS zone`,
      focus: `MATCH p = (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)-[:FEEDS]->(ld:EnergyConsumer) WHERE ld.critical = true RETURN p`,
      observe(rows, en) {
        if (!rows.length) return en ? 'No critical customers downstream.' : '하류에 중요 고객은 없다.';
        return en ? `Critical: ${rows.map(r => `${r[0]} in ${r[2]}`).join(', ')}. These come first in restoration.`
          : `중요 고객: ${rows.map(r => `${r[0]}(${r[2]})`).join(', ')}. 복구 순서의 맨 앞이다.`;
      }
    },
    {
      tool: 'find_tie_switches', args: "{ from: 'AS-TR-0007' }",
      thought: { ko: '변압기를 2,160시간(약 3개월) 안에 고칠 수는 없다. 다른 선로와 이어진 연계 개폐기로 구간을 넘겨 받을 수 있는지 보자.', en: 'The transformer cannot be fixed quickly (restore time 2,160 h). See which zones can be switched over to neighbouring feeders through tie switches.' },
      cypher: `MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)
      -[:TIE_TO]->(t)-[:TO_FEEDER]->(other)
OPTIONAL MATCH (z)-[:FEEDS]->(ld:EnergyConsumer)
RETURN DISTINCT z.label AS zone, t.name AS tie, other.name AS backup, sum(ld.customers) AS customers
ORDER BY zone`,
      focus: `MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)-[:TIE_TO]->(t)-[:TO_FEEDER]->(other) RETURN z, t, other`,
      observe(rows, en) {
        const c = rows.reduce((a, r) => a + r[3], 0);
        return en ? `${rows.length} zones touch a tie switch (${rows.map(r => r[1]).join(', ')}). Switching them over can restore ${nf(c)} customers directly; zones between them can follow once isolated.`
          : `연계 개폐기에 닿은 구간이 ${rows.length}개다(${rows.map(r => r[1]).join(', ')}). 이 구간만으로 ${nf(c)}호를 바로 넘겨 살릴 수 있고, 사이 구간도 분리 후 이어 붙일 수 있다.`;
      }
    },
    {
      tool: 'get_work_orders', args: "{ asset: 'AS-TR-0007' }",
      thought: { ko: '마지막으로 이미 잡혀 있는 작업이 있는지 확인한다. 있으면 앞당길지 판단하면 된다.', en: 'Finally, check whether work is already scheduled; if so, the question is whether to bring it forward.' },
      cypher: `MATCH (w:WorkOrder)-[:ON_ASSET]->(:Asset {code: 'AS-TR-0007'})
RETURN w.code AS workOrder, w.workStatus AS status, w.plannedDate AS planned, w.outageHours AS outageH
ORDER BY planned`,
      focus: `MATCH (w:WorkOrder)-[:ON_ASSET]->(a:Asset {code: 'AS-TR-0007'}) RETURN w, a`,
      observe(rows, en) {
        return en ? `${rows.length} work orders are planned: ${rows.map(r => `${r[0]} on ${r[2]} (${r[3]} h outage)`).join(', ')}.`
          : `계획된 작업지시 ${rows.length}건: ${rows.map(r => `${r[0]} ${r[2]}(정전 ${r[3]}시간)`).join(', ')}.`;
      }
    }
  ],
  // 모든 단계의 결과(rows)로 보고서를 만듦 — 글은 템플릿이지만 숫자 · 이름은 모두 그래프에서 온 값
  report(R, en) {
    const [top] = R[0], diag = R[1].filter(r => /초과|기준/.test(r[1])), down = R[2], crit = R[3], ties = R[4], wo = R[5];
    const total = down.reduce((a, r) => a + r[2], 0), tieC = ties.reduce((a, r) => a + r[3], 0);
    const major = wo.reduce((a, r) => (r[3] > a[3] ? r : a), wo[0]);   // 정전이 필요한 큰 작업
    return en ? [
      `Riskiest asset: ${top[1]} (${top[0]}), risk ${top[2]} (PoF ${top[3]} × CoF ${top[4]}).`,
      `Evidence: ${diag.map(r => r[1]).join(' / ')}.`,
      `If it fails: all of D/L #1, ${down.length} zones and ${nf(total)} customers, lose supply.`,
      crit.length ? `Critical customers: ${crit.map(r => r[0]).join(', ')} — restore first.` : 'No critical customers downstream.',
      `Quick restoration: ${ties.length} tie switches can pick up ${nf(tieC)} customers directly (${ties.map(r => `${r[1]} → ${r[2]}`).join(', ')}).`,
      `Recommendation: consider bringing forward ${major[0]} (planned ${major[2]}, ${major[3]} h outage), and prepare the tie-switch transfer plan first — starting with the zone that holds the critical customer — so the outage for that work can also be covered.`
    ] : [
      `가장 위험한 설비: ${top[1]}(${top[0]}), 위험도 ${top[2]}(고장확률 ${top[3]} × 영향도 ${top[4]}).`,
      `근거: ${diag.map(r => r[1]).join(' / ')}.`,
      `고장 시 영향: D/L #1 전체, 구간 ${down.length}개, 고객 ${nf(total)}호 정전.`,
      crit.length ? `중요 고객: ${crit.map(r => r[0]).join(', ')} — 가장 먼저 복구.` : '하류에 중요 고객 없음.',
      `빠른 복구: 연계 개폐기 ${ties.length}개로 ${nf(tieC)}호를 바로 넘겨 받을 수 있음(${ties.map(r => `${r[1]} → ${r[2]}`).join(', ')}).`,
      `권고: 작업지시 ${major[0]}(예정 ${major[2]}, 정전 ${major[3]}시간)을 앞당길지 검토하고, 그 전에 중요 고객이 있는 구간부터 연계 개폐기 절체 계획을 준비해 작업 중 정전도 함께 줄일 것.`
    ];
  }
};
