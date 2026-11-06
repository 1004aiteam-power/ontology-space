// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 가상 전국 고속도로·국도 — 형상검증 (Neo4j · Cypher). 규칙 하나 = 질의 하나, 결과 행 하나 = 위반 하나. 0행이면 통과
// 대상: highway-ontology.ttl + highway-alignment.ttl을 Neo4j에 불러온 그래프 (클래스 → 라벨, 값 → 속성, 개체 연결 → 관계)
// 실행: node tools/cypher.mjs --ttl examples/highway/highway-ontology.ttl,examples/highway/highway-alignment.ttl --checks shapes/highway-checks.cypher
//
// Neo4j 제약조건으로 막을 수 있는 것: 노드·구간·링크 코드 중복
//   CREATE CONSTRAINT node_code IF NOT EXISTS FOR (n:Node) REQUIRE n.code IS UNIQUE;
//   CREATE CONSTRAINT link_code IF NOT EXISTS FOR (l:Link) REQUIRE l.code IS UNIQUE;

// [SECTION] Violation | 구간은 노선 1개 이상, 서로 다른 양 끝 노드 2개, 길이 > 0, 위치(WKT) 있음 / a section has a route, two distinct end nodes, length > 0 and a geometry
MATCH (s:Section)
OPTIONAL MATCH (s)-[:ON_ROUTE]->(r:Route)
OPTIONAL MATCH (s)-[:ENDPOINT]->(n:Node)
OPTIONAL MATCH (s)-[:HAS_GEOMETRY]->(g)
WITH s, count(DISTINCT r) AS routes, count(DISTINCT n) AS ends, count(DISTINCT g) AS geometries
WHERE routes < 1 OR ends <> 2 OR geometries < 1 OR s.lengthKm IS NULL OR s.lengthKm <= 0
RETURN s.code AS focus, routes, ends, geometries, s.lengthKm AS lengthKm;

// [SECTION_LINKS] Violation | 구간에는 상행·하행 링크가 정확히 2개 / a section has exactly two directional links
MATCH (s:Section)
OPTIONAL MATCH (l:Link)-[:OF_SECTION]->(s)
WITH s, count(l) AS links
WHERE links <> 2
RETURN s.code AS focus, links;

// [LINK] Violation | 링크는 차로 1 이상, 반대 링크 1개, 출발≠도착이고 반대 링크와 방향이 맞음 / a link has ≥ 1 lane, one opposite link, distinct ends that mirror the opposite link
MATCH (x:Link)
OPTIONAL MATCH (x)-[:OPPOSITE_OF]->(o:Link)
OPTIONAL MATCH (x)-[:FROM_NODE]->(a)
OPTIONAL MATCH (x)-[:TO_NODE]->(b)
OPTIONAL MATCH (o)-[:FROM_NODE]->(oa)
OPTIONAL MATCH (o)-[:TO_NODE]->(ob)
WITH x, count(DISTINCT o) AS opposites, a, b, oa, ob
WHERE x.lanes IS NULL OR x.lanes < 1 OR opposites <> 1 OR a = b OR oa <> b OR ob <> a
RETURN x.code AS focus, x.lanes AS lanes, opposites, a.code AS from, b.code AS to, oa.code AS oppositeFrom, ob.code AS oppositeTo;

// [JUNCTION] Violation | 분기점(JC)에는 노선이 2개 이상 만나야 함 / a junction connects two or more routes
MATCH (j:Junction)
OPTIONAL MATCH (j)-[:CONNECTS_ROUTE]->(r:Route)
WITH j, count(DISTINCT r) AS routes
WHERE routes < 2
RETURN j.code AS focus, j.label AS name, routes;

// [ZONE] Violation | 모든 노드(IC·교차점)는 교통 존과 이어짐 / every node serves a traffic zone
MATCH (n:Node)
WHERE NOT EXISTS { (n)-[:SERVES_ZONE]->(:Zone) }
RETURN n.code AS focus, n.label AS name;

// [CONNECTED] Violation | 서울에서 모든 노드에 닿을 수 있음 (네트워크 연결성) / every node is reachable from Seoul
MATCH (seoul:Node {code: 'SEOUL'}), (n:Node)
WHERE NOT EXISTS { (seoul)-[:ADJACENT_TO*0..]->(n) }
RETURN n.code AS focus, n.label AS name;

// [LOS] Violation | 교통 상태의 v/c가 서비스수준 등급 범위 안 / v/c lies inside the range of its LOS grade
MATCH (t:TrafficState)-[:LOS]->(g:LevelOfService)
OPTIONAL MATCH (lo:LevelOfService) WHERE g.maxVc IS NULL OR lo.maxVc < g.maxVc
WITH t, g, max(lo.maxVc) AS lower
WHERE t.vcRatio IS NULL OR t.vcRatio < 0
   OR (g.maxVc IS NOT NULL AND t.vcRatio > g.maxVc)
   OR (lower IS NOT NULL AND t.vcRatio < lower)
RETURN t.uri AS focus, t.vcRatio AS vc, g.label AS los, lower, g.maxVc AS upper;

// [INTERCHANGE] Violation | 나들목(IC)에는 고속도로 구간이 닿아야 함 / an interchange touches an expressway section
MATCH (n:Interchange)
WHERE NOT EXISTS { (n)<-[:ENDPOINT]-(:Section)-[:ON_ROUTE]->(:Expressway) }
RETURN n.code AS focus, n.label AS name;

// [INTERSECTION] Violation | 일반 교차점에 고속도로 구간이 닿으면 나들목으로 분류해야 함 / an intersection touching an expressway should be an interchange
MATCH (n:Intersection)
WHERE EXISTS { (n)<-[:ENDPOINT]-(:Section)-[:ON_ROUTE]->(:Expressway) }
RETURN n.code AS focus, n.label AS name;

// [NATIONAL_ROAD] Violation | 국도에는 노선 번호(정수) 1개 / a national road has one integer route number
MATCH (r:NationalRoad)
WHERE r.routeNumber IS NULL OR NOT r.routeNumber = toInteger(r.routeNumber)
RETURN r.code AS focus, r.routeNumber AS routeNumber;

// [MAPPING] Violation | 표준 대응 기록: 관계 값은 정해진 것만, verified는 true/false, '확인'이면 출처 URL 있음 / mapping relation from the fixed list, verified is boolean, verified records cite a source
MATCH (m:Mapping)
WHERE NOT m.relation IN ['exact', 'close', 'broad', 'narrow', 'related', 'none']
   OR NOT m.verified IN [true, false]
   OR (m.verified = true AND NOT EXISTS { (m)-[:SOURCE]->() } AND m.source IS NULL)
RETURN split(m.uri, '#')[1] AS focus, m.relation AS relation, m.verified AS verified;
