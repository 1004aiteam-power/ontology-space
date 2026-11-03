// 전력설비 자산관리 온톨로지 — 역량 질문 쿼리 (import.cypher 실행 후)

// Q1. 주변압기 #1 자리의 현재·이전 자산
MATCH (a:Asset)-[d:INSTALLED_AT]->(:FunctionalLocation {code:'TR_1'})
RETURN a.id, a.name, d.from, d.to ORDER BY d.from;

// Q2. 위험도 순위
MATCH (a:Asset) WHERE a.risk IS NOT NULL
RETURN a.id, a.name, a.hi AS healthIndex, a.pof, a.cof, a.risk ORDER BY a.risk DESC;

// Q3. OLTC 접점 마모를 찾는 점검과 대응 정비
MATCH (f:FailureMode {id:'FM-02'})
OPTIONAL MATCH (f)-[:DETECTED_BY]->(i) OPTIONAL MATCH (f)-[:MITIGATED_BY]->(m)
RETURN f.name, collect(DISTINCT i.name) AS detect, collect(DISTINCT m.name) AS mitigate;

// Q4. 주의·이상 판정 후 작업지시가 끝나지 않은 자산
MATCH (w:WorkOrder)-[:TRIGGERED_BY]->(g:Diagnosis), (w)-[:ON_ASSET]->(a)
WHERE g.judgement <> '정상' AND w.status <> '완료'
RETURN a.id, w.id, w.status, g.finding;

// Q5. 정전이 필요한 미완료 작업지시
MATCH (w:WorkOrder)-[:PERFORMS]->(t:MaintenanceTask {outage:true})
WHERE w.status <> '완료' RETURN w.id, t.name, w.outageHours, w.planned ORDER BY w.planned;

// Q6. 자산 기록이 없는 기능 위치
MATCH (l:FunctionalLocation)
WHERE NOT EXISTS { MATCH (:Asset)-[d:INSTALLED_AT]->(l) WHERE d.to IS NULL }
RETURN l.code, l.name;

// Q7. 자산 하나의 전체 맥락 (구성품·진단·고장모드·작업지시)
MATCH (a:Asset {id:'AS-TR-0007'})
OPTIONAL MATCH (a)-[:HAS_COMPONENT]->(c)
OPTIONAL MATCH (g:Diagnosis)-[:ON_ASSET]->(a)
OPTIONAL MATCH (w:WorkOrder)-[:ON_ASSET]->(a)
RETURN a, collect(DISTINCT c) AS components, collect(DISTINCT g) AS diagnoses, collect(DISTINCT w) AS workOrders;

// Q8. 정비 업무 흐름 (선행 + 환류)
MATCH p = (:MaintenanceTask {id:'WF-01'})-[:PRECEDES*]->(:MaintenanceTask {id:'WF-08'})
RETURN [n IN nodes(p) | n.name] AS flow;
