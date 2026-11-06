// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 가상 전국 고속도로·국도 — 역량 질문 (Neo4j · Cypher)
// 대상: highway-ontology.ttl + highway-alignment.ttl을 Neo4j에 불러온 그래프 (클래스 → 라벨, 값 → 속성, 개체 연결 → 관계)
// 실행: node tools/cypher.mjs --ttl examples/highway/highway-ontology.ttl,examples/highway/highway-alignment.ttl --queries examples/highway/queries.cypher
// 빌드 스크립트(build_highway.py)가 이 파일을 실행해 결과를 assets/data/highway.json에 넣습니다. 각 질의 앞 주석의 마지막 줄 = 질문

// 경부선 구간을 순서대로 나열하면?
MATCH (s:Section)-[:ON_ROUTE]->(:Route {code: 'GYEONGBU'})
RETURN s.routeOrder AS o, s.label AS n
ORDER BY o;

// 노선이 5개 이상 만나는 분기점(JC)은?
MATCH (j:Junction)-[:CONNECTS_ROUTE]->(r:Route)
WITH j, count(r) AS k
WHERE k >= 5
RETURN j.label AS n, k
ORDER BY k DESC, n;

// 기본 시나리오에서 하루 교통량이 가장 많은 링크 3개는?
MATCH (x:Link)
WHERE x.dailyVolume IS NOT NULL
RETURN x.code AS l, x.dailyVolume AS v
ORDER BY v DESC
LIMIT 3;

// 기본 시나리오에서 첨두 때 서비스수준 F가 되는 링크는?
MATCH (t:TrafficState)-[:IN_SCENARIO]->(sc:Scenario), (t)-[:LOS]->(los:LevelOfService), (t)-[:ON_LINK]->(x:Link)
WHERE sc.uri ENDS WITH '#SC_BASE' AND los.uri ENDS WITH '#LOS_F'
RETURN x.code AS l, t.hour AS h, t.vcRatio AS vc
ORDER BY vc DESC;

// 사고 시나리오에서 첨두 v/c가 가장 많이 오른 링크는? (사고 링크 제외)
MATCH (tb:TrafficState)-[:IN_SCENARIO]->(b:Scenario), (tb)-[:ON_LINK]->(x:Link),
      (ti:TrafficState)-[:IN_SCENARIO]->(i:Scenario), (ti)-[:ON_LINK]->(x)
WHERE b.uri ENDS WITH '#SC_BASE' AND i.uri ENDS WITH '#SC_INCIDENT'
  AND NOT EXISTS { (:Incident)-[:AFFECTS_LINK]->(x) }
RETURN x.code AS l, tb.vcRatio AS b, ti.vcRatio AS i
ORDER BY i - b DESC
LIMIT 3;

// 대전에서 링크 2개 이내로 닿는 노드는?
MATCH (d:Node {code: 'DAEJEON'})-[:ADJACENT_TO*1..2]->(n:Node)
WHERE n <> d
RETURN count(DISTINCT n) AS k;

// IC이면서 JC인 노드는 몇 개인가?
MATCH (n:Interchange:Junction)
RETURN count(n) AS k;

// 고속도로에 닿지 않고 국도로만 갈 수 있는 지점은?
MATCH (x:Intersection)
RETURN x.label AS n
ORDER BY n;

// 고속도로와 국도가 함께 지나는 도시는 몇 곳인가?
MATCH (:Expressway)<-[:ON_ROUTE]-(:Section)-[:ENDPOINT]->(n:Node)<-[:ENDPOINT]-(:Section)-[:ON_ROUTE]->(:NationalRoad)
RETURN count(DISTINCT n) AS k;

// 표준과 대응시키지 않은 핵심 클래스는? (Route·Section·Link·Node·Expressway·NationalRoad·Interchange 중)
UNWIND ['Route', 'Section', 'Link', 'Node', 'Expressway', 'NationalRoad', 'Interchange'] AS c
WITH c
WHERE NOT EXISTS { MATCH (m:Mapping) WHERE m.subject = c }
RETURN c;

// 표준별 대응 수와 원문 확인 수는?
MATCH (m:Mapping)-[:STANDARD]->(s)
RETURN split(s.uri, '#')[1] AS s, count(m) AS n, sum(CASE WHEN m.verified THEN 1 ELSE 0 END) AS ok
ORDER BY s;

// 서울에서 모든 노드에 닿을 수 있나? (닿지 않는 노드 수)
MATCH (seoul:Node {code: 'SEOUL'}), (n:Node)
WHERE NOT EXISTS { (seoul)-[:ADJACENT_TO*0..]->(n) }
RETURN count(n) AS k;
