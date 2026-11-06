// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 전력설비 자산관리 — 형상검증 (Neo4j · Cypher). import.cypher 실행 뒤에 실행
// 규칙 하나 = 질의 하나, 결과 행 하나 = 위반 하나. 0행이면 통과
//
// 1단계: 저장 자체를 막는 제약조건 (import.cypher 맨 위에 있음, Community 에디션 가능)
//   CREATE CONSTRAINT asset_id IF NOT EXISTS FOR (a:Asset) REQUIRE a.id IS UNIQUE;
//   CREATE CONSTRAINT loc_code IF NOT EXISTS FOR (l:FunctionalLocation) REQUIRE l.code IS UNIQUE;
//   CREATE CONSTRAINT task_id IF NOT EXISTS FOR (t:MaintenanceTask) REQUIRE t.id IS UNIQUE;
// 2단계: 관계 수·기간·형식처럼 제약으로 표현할 수 없는 규칙 → 아래 검사 질의
// 실행: node tools/cypher.mjs --load examples/asset/neo4j/import.cypher --checks examples/asset/neo4j/checks.cypher

// [LOCATION_HAS_ASSET] Warning | 설비 자리에 현재 설치된 자산이 없음 (빈틈은 막지 않고 경고로) / no asset currently installed at the location (a warning, not an error)
MATCH (l:FunctionalLocation)
WHERE NOT EXISTS { MATCH (:Asset)-[d:INSTALLED_AT]->(l) WHERE d.to IS NULL }
RETURN l.code AS focus, l.name AS name;

// [IN_SERVICE_ONE_LOCATION] Violation | 운전 중인 자산은 현재 설치 위치가 정확히 1개 / an in-service asset has exactly one current location
MATCH (a:Asset {status: '운전'})
OPTIONAL MATCH (a)-[d:INSTALLED_AT]->(:FunctionalLocation) WHERE d.to IS NULL
WITH a, count(d) AS current
WHERE current <> 1
RETURN a.id AS focus, current;

// [EAM_NUMBER] Violation | EAM 설비번호는 EQ-종류-연도-번호 형식 / EAM number in EQ-XX-YYYY-NNNN form
MATCH (a:Asset)
WHERE a.eam IS NULL OR NOT a.eam =~ 'EQ-[A-Z]{2}-[0-9]{4}-[0-9]{4}'
RETURN a.id AS focus, a.eam AS eam;

// [DEPLOYMENT_OVERLAP] Violation | 같은 자리에 설치 기간이 겹치는 자산 두 개 / two assets with overlapping periods at the same location
MATCH (a1:Asset)-[d1:INSTALLED_AT]->(l:FunctionalLocation)<-[d2:INSTALLED_AT]-(a2:Asset)
WHERE a1.id < a2.id
  AND (d2.to IS NULL OR d1.from <= d2.to)
  AND (d1.to IS NULL OR d2.from <= d1.to)
RETURN l.code AS focus, a1.id AS asset1, d1.from AS from1, d1.to AS to1, a2.id AS asset2, d2.from AS from2, d2.to AS to2;

// [DEPLOYMENT_FROM] Violation | 설치 이력에는 시작일(from)이 있어야 함 / a deployment needs a start date
MATCH (a:Asset)-[d:INSTALLED_AT]->(l:FunctionalLocation)
WHERE d.from IS NULL OR NOT d.from =~ '[0-9]{4}-[0-9]{2}-[0-9]{2}'
RETURN a.id AS focus, l.code AS location, d.from AS from;

// [DIAGNOSIS] Violation | 진단은 대상 자산 1개, 방법 1개(점검 업무), 날짜, 판정(정상·주의·이상)이 있어야 함 / a diagnosis has one asset, one inspection method, a date and a judgement
MATCH (g:Diagnosis)
OPTIONAL MATCH (g)-[:ON_ASSET]->(a:Asset)
OPTIONAL MATCH (g)-[:USES_METHOD]->(m:MaintenanceTask)
WITH g, count(DISTINCT a) AS assets, collect(DISTINCT m.category) AS methodKinds
WHERE assets <> 1 OR methodKinds <> ['점검'] OR g.date IS NULL OR NOT g.judgement IN ['정상', '주의', '이상']
RETURN g.id AS focus, assets, methodKinds, g.date AS date, g.judgement AS judgement;

// [WORK_ORDER] Violation | 작업지시는 대상 자산 1개, 수행 업무 1개, 근거가 된 진단이 있어야 함 / a work order has one asset, one task and the diagnosis that triggered it
MATCH (w:WorkOrder)
OPTIONAL MATCH (w)-[:ON_ASSET]->(a:Asset)
OPTIONAL MATCH (w)-[:PERFORMS]->(t:MaintenanceTask)
OPTIONAL MATCH (w)-[:TRIGGERED_BY]->(g:Diagnosis)
WITH w, count(DISTINCT a) AS assets, count(DISTINCT t) AS tasks, count(DISTINCT g) AS diagnoses
WHERE assets <> 1 OR tasks <> 1 OR diagnoses < 1
RETURN w.id AS focus, assets, tasks, diagnoses;

// [WORK_ORDER_DONE] Violation | 완료된 작업지시에는 완료일이 있어야 함 / a completed work order has a completion date
MATCH (w:WorkOrder {status: '완료'})
WHERE w.done IS NULL OR w.done = ''
RETURN w.id AS focus, w.status AS status;
