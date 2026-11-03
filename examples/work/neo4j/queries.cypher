// AI추진부 업무 온톨로지 — 역량 질문 쿼리 모음 (import.cypher 실행 후 사용)

// Q1. PoC 단계에서 만들어야 할 산출물은?
MATCH (t:Task)-[:BELONGS_TO]->(:SubDomain {code:'BD-2'}), (t)-[:PRODUCES]->(a)
RETURN t.code, t.name, a.name ORDER BY t.code;

// Q2. 데이터엔지니어가 주관하는 업무와 KPI는?
MATCH (t:Task)-[:OWNED_BY]->(:Role {name:'데이터엔지니어'})
RETURN t.code, t.name, t.kpi ORDER BY t.code;

// Q3. 개인정보 리스크가 걸린 업무는?
MATCH (t:Task) WHERE t.condition CONTAINS '개인정보' OR EXISTS { (t)-[:HAS_RISK]->(k) WHERE k.name CONTAINS '개인정보' }
RETURN t.code, t.name;

// Q4. 신규 AI 서비스 오픈(OP-1-1) 전에 끝나야 할 업무는?
MATCH (a:Task)-[:PRECEDES*]->(:Task {code:'OP-1-1'})
RETURN DISTINCT a.code, a.name ORDER BY a.code;

// Q5. PoC 결과 평가(BD-2-3)가 늦어지면 영향받는 업무는?
MATCH (:Task {code:'BD-2-3'})-[:PRECEDES*]->(d:Task)
RETURN DISTINCT d.code, d.name ORDER BY d.code;

// Q6. 고위험 AI에만 추가로 필요한 업무는?
MATCH (t:Task {condition:'고위험 AI'}) RETURN t.code, t.name;

// Q7. 분기마다 해야 할 정기 업무와 주관 역할은?
MATCH (t:Task {cycle:'분기'})-[:OWNED_BY]->(r) RETURN t.code, t.name, r.name ORDER BY r.name;

// Q8. 운영 결과가 다음 계획으로 돌아가는 경로는?
MATCH p = (o:Task)-[:FEEDS_BACK_TO*1..3]->(s:Task)
WHERE o.code STARTS WITH 'OP' AND s.code STARTS WITH 'ST'
RETURN [n IN nodes(p) | n.code + ' ' + n.name] AS path;

// Q9. 외부 조직에 의존하는 업무는?
MATCH (t:Task)-[:COLLABORATES_WITH]->(r:Role {internal:false})
RETURN r.name, collect(t.code) AS tasks ORDER BY size(tasks) DESC;

// Q10. 최장 선행 흐름(일정 기준선)
MATCH p = (s:Task)-[:PRECEDES*]->(e:Task)
WHERE NOT ()-[:PRECEDES]->(s) AND NOT (e)-[:PRECEDES]->()
RETURN length(p) + 1 AS steps, [n IN nodes(p) | n.code] AS path
ORDER BY steps DESC LIMIT 1;

// Q11. 역할별 업무 부하(주관 건수, 정기 업무 건수)
MATCH (t:Task)-[:OWNED_BY]->(r:Role)
RETURN r.name, count(t) AS owned, sum(CASE WHEN t.nature = '정기' THEN 1 ELSE 0 END) AS recurring
ORDER BY owned DESC;

// 전체 그래프 보기 (Neo4j Browser)
MATCH (a:Task)-[r:PRECEDES|FEEDS_BACK_TO]->(b:Task) RETURN a, r, b;
