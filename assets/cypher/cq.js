// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 전기차 충전 · 설비 고장 영향 페이지의 역량 질문(Cypher). 순서는 assets/data/ev.json, impact.json의 cq와 같음
// tests/cypher.test.mjs가 이 질의를 브라우저용 Cypher 엔진으로 실행해 데이터 파일의 결과와 같은지 확인합니다

export const EV_FILES = ['examples/ev/ev-ontology.ttl', 'examples/highway/highway-ontology.ttl', 'examples/twin/korea_virtual_grid.ttl'];
export const EV_CYPHER = [
`MATCH (r:RestArea)-[:ON_LINK]->(:Link)-[:OF_SECTION]->(:Section)-[:ON_ROUTE]->(:Route {code: 'GYEONGBU'}),
      (r)-[:HAS_CHARGING_STATION]->(:ChargingStation)-[:EQUIPMENT_CONTAINER]->(:Feeder)
         -[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
RETURN r.label AS ra, s.name AS sub
ORDER BY ra`,
`MATCH (cs:ChargingStation)-[:EQUIPMENT_CONTAINER]->(:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
RETURN s.name AS sub, count(cs) AS n, sum(cs.installedKW) AS totalKW
ORDER BY totalKW DESC`,
`MATCH (:Incident)-[:AFFECTS_LINK]->(l:Link)<-[:ON_LINK]-(r:RestArea)
RETURN r.label AS ra, l.code AS link`,
`MATCH (p:ChargingPeak)-[:PEAK_OF]->(:ChargingStation)<-[:HAS_CHARGING_STATION]-(r:RestArea)
WHERE p.hour >= 7 AND p.hour <= 9
RETURN r.label AS ra, p.hour AS h, p.mw AS mw
ORDER BY mw DESC`,
`MATCH (r:RestArea)-[:ON_LINK]->(:Link {code: 'S03F'}),
      (r)-[:HAS_CHARGING_STATION]->(c:ChargingStation)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
         -[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
RETURN r.label AS ra, c.label AS cs, f.name AS feeder, s.name AS sub`
];

export const IMPACT_FILES = ['examples/impact/impact-links.ttl', 'examples/asset/asset-ontology.ttl', 'examples/feeder/feeder.ttl'];
export const IMPACT_CYPHER = [
`// FEEDS* : 공급 방향으로 몇 단계든 따라감 (가변 길이 경로)
MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(ld:EnergyConsumer)
WITH DISTINCT ld
RETURN count(ld) AS loads, sum(ld.customers) AS customers`,
`MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(ld)
WHERE ld.critical = true
RETURN DISTINCT ld.area AS area`,
`MATCH (a:Asset)-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)-[:TIE_TO]->(t)
WHERE a.riskScore >= 15
RETURN DISTINCT a.code AS asset, z.label AS zone, t.name AS tie
ORDER BY zone`,
`// 자산관리 쪽 기능 위치만 (ex:_mRID 는 배전선로 모델 설비)
MATCH (loc)-[:FEEDS]->()
WHERE loc.uri STARTS WITH 'http://example.org/grid#'
  AND NOT loc.uri STARTS WITH 'http://example.org/grid#_'
  AND NOT EXISTS { (:Asset)-[:INSTALLED_AT]->(loc) }
MATCH (loc)-[:FEEDS*]->(ld)
WHERE ld.customers IS NOT NULL
WITH DISTINCT loc, ld
RETURN 'ex:' + split(loc.uri, '#')[1] AS loc, sum(ld.customers) AS customers`
];
