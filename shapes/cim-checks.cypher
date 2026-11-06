// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// CIM 데이터 형상검증 (Neo4j · Cypher) — 규칙 하나 = 질의 하나, 결과 행 하나 = 위반 하나. 0행이면 통과
//
// 대상 그래프: RDF(CIM)를 Neo4j에 불러온 모양 (neosemantics 방식)
//   클래스 → 라벨 (상위 클래스도 라벨: :Breaker:ProtectedSwitch:Switch:ConductingEquipment…)
//   값 → 속성 (cim:IdentifiedObject.mRID → mRID), 개체 연결 → 관계 (cim:Terminal.ConductingEquipment → :CONDUCTING_EQUIPMENT)
// 실행: node tools/cypher.mjs --ttl examples/power-grid-sample.ttl,shapes/cim-classes.ttl --checks shapes/cim-checks.cypher
//       실습 페이지(lab.html)의 '데이터 검증'도 이 파일을 그대로 씁니다
//
// Neo4j에서 쓰기 전에 막을 수 있는 규칙은 제약조건으로 (Community 에디션은 UNIQUE만):
//   CREATE CONSTRAINT mrid_unique IF NOT EXISTS FOR (o:IdentifiedObject) REQUIRE o.mRID IS UNIQUE;
//   CREATE CONSTRAINT mrid_exists IF NOT EXISTS FOR (o:IdentifiedObject) REQUIRE o.mRID IS NOT NULL;   // Enterprise
// 관계 수·값 범위·형식 같은 나머지 규칙은 아래 질의로 검사합니다.

// [MRID] Violation | mRID는 정확히 1개, UUID 형식 / mRID must be exactly one UUID
MATCH (o:IdentifiedObject)
WHERE o.mRID IS NULL
   OR NOT o.mRID =~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
RETURN coalesce(o.name, o.uri) AS focus, labels(o)[0] AS class, o.mRID AS value;

// [MRID_UNIQUE] Violation | mRID가 다른 객체와 겹치지 않음 (Neo4j에서는 UNIQUE 제약) / mRID is unique (a UNIQUE constraint in Neo4j)
MATCH (o:IdentifiedObject) WHERE o.mRID IS NOT NULL
WITH o.mRID AS mRID, collect(coalesce(o.name, o.uri)) AS objects
WHERE size(objects) > 1
RETURN mRID AS focus, objects;

// [TERMINALS_2] Violation | 선로·개폐기·2권선 변압기는 단자(Terminal)가 정확히 2개 / lines, switches and transformers have exactly 2 terminals
MATCH (e:ConductingEquipment)
WHERE e:ACLineSegment OR e:Switch OR e:PowerTransformer
OPTIONAL MATCH (t:Terminal)-[:CONDUCTING_EQUIPMENT]->(e)
WITH e, count(t) AS terminals
WHERE terminals <> 2
RETURN e.name AS focus, labels(e)[0] AS class, terminals;

// [TERMINALS_1] Violation | 부하·모선·전원은 단자가 정확히 1개 / loads, busbars and sources have exactly 1 terminal
MATCH (e:ConductingEquipment)
WHERE e:EnergyConsumer OR e:BusbarSection OR e:ExternalNetworkInjection OR e:RotatingMachine
OPTIONAL MATCH (t:Terminal)-[:CONDUCTING_EQUIPMENT]->(e)
WITH e, count(t) AS terminals
WHERE terminals <> 1
RETURN e.name AS focus, labels(e)[0] AS class, terminals;

// [TERMINAL] Violation | 단자는 설비 1개에 속하고, 노드는 최대 1개, sequenceNumber는 1 이상 / a terminal belongs to one equipment, at most one node, sequenceNumber ≥ 1
MATCH (t:Terminal)
OPTIONAL MATCH (t)-[:CONDUCTING_EQUIPMENT]->(e:ConductingEquipment)
OPTIONAL MATCH (t)-[:CONNECTIVITY_NODE]->(cn:ConnectivityNode)
WITH t, count(DISTINCT e) AS equipment, count(DISTINCT cn) AS nodes
WHERE equipment <> 1 OR nodes > 1 OR t.sequenceNumber < 1
RETURN coalesce(t.name, t.uri) AS focus, equipment, nodes, t.sequenceNumber AS sequenceNumber;

// [LINE] Violation | 선로 길이는 0보다 크고, 저항·리액턴스는 음수가 아님 / line length > 0, r and x ≥ 0
MATCH (l:ACLineSegment)
WHERE l.length <= 0 OR l.r < 0 OR l.x < 0
RETURN l.name AS focus, l.length AS length, l.r AS r, l.x AS x;

// [SWITCH] Violation | 개폐기 normalOpen·open 은 true/false / switch normalOpen and open are true/false
MATCH (s:Switch)
WHERE (s.normalOpen IS NOT NULL AND NOT s.normalOpen IN [true, false])
   OR (s.open IS NOT NULL AND NOT s.open IN [true, false])
RETURN s.name AS focus, s.normalOpen AS normalOpen, s.open AS open;

// [VOLTAGE_LEVEL] Violation | 전압계급은 기준전압 1개, 변전소 1개에 속함 / a voltage level has one base voltage and one substation
MATCH (vl:VoltageLevel)
OPTIONAL MATCH (vl)-[:BASE_VOLTAGE]->(bv:BaseVoltage)
OPTIONAL MATCH (vl)-[:SUBSTATION]->(s:Substation)
WITH vl, count(DISTINCT bv) AS baseVoltages, count(DISTINCT s) AS substations
WHERE baseVoltages <> 1 OR substations <> 1
RETURN vl.name AS focus, baseVoltages, substations;

// [BASE_VOLTAGE] Violation | 공칭전압은 0보다 큼 / nominal voltage > 0
MATCH (bv:BaseVoltage)
WHERE bv.nominalVoltage IS NULL OR bv.nominalVoltage <= 0
RETURN coalesce(bv.name, bv.uri) AS focus, bv.nominalVoltage AS nominalVoltage;

// [TRANSFORMER_ENDS] Violation | 변압기는 권선단(PowerTransformerEnd)이 2~3개 / a transformer has 2–3 ends
MATCH (p:PowerTransformer)
OPTIONAL MATCH (e:PowerTransformerEnd)-[:POWER_TRANSFORMER]->(p)
WITH p, count(e) AS ends
WHERE ends < 2 OR ends > 3
RETURN p.name AS focus, ends;

// [TRANSFORMER_END] Violation | 권선단 정격전압은 0보다 큼 / a transformer end's ratedU > 0
MATCH (e:PowerTransformerEnd)
WHERE e.ratedU IS NULL OR e.ratedU <= 0
RETURN coalesce(e.name, e.uri) AS focus, e.ratedU AS ratedU;

// [NAME] Violation | 매핑 이름(Name)은 대상 객체 1개와 NameType 1개를 가리킴 / a Name points to one object and one NameType
MATCH (n:Name)
OPTIONAL MATCH (n)-[:IDENTIFIED_OBJECT]->(o)
OPTIONAL MATCH (n)-[:NAME_TYPE]->(nt)
WITH n, count(DISTINCT o) AS objects, count(DISTINCT nt) AS nameTypes
WHERE objects <> 1 OR nameTypes <> 1
RETURN n.name AS focus, objects, nameTypes;
