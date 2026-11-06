// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 실습 페이지의 데이터와 예제 Cypher 질의

export const DATASETS = {
  full:   { file: 'examples/sample_grid_full.ttl', ko: '예제 변전소 – pycim 출력 (매핑 · TP · SV 포함)', en: 'Sample substation – pycim output (mapping · TP · SV)' },
  sample: { file: 'examples/power-grid-sample.ttl', ko: '예제 변전소 (손으로 작성한 TTL)', en: 'Sample substation (hand-written TTL)' },
  cigre:  { file: 'examples/cgmes/cigre_mv.ttl', ko: 'CIGRE MV 배전망 (CGMES → pycim)', en: 'CIGRE MV network (CGMES → pycim)' },
  korea:  { file: 'examples/twin/korea_virtual_grid.ttl', ko: '가상 대한민국 전력망 (디지털 트윈, 가상 데이터)', en: 'Virtual Korean grid (digital twin, virtual data)' },
  broken: { file: 'examples/broken-sample.ttl', ko: '규칙 위반 예제 (데이터 검증 실습용)', en: 'Rule-breaking sample (for data validation)' }
};

export const QUERIES = [
  { ko: '라벨별 개수', en: 'Count by label', q:
`// labels(n)[0] = 노드의 원래 클래스 (나머지는 상위 클래스)
MATCH (n)
RETURN labels(n)[0] AS label, count(*) AS count
ORDER BY count DESC` },
  { ko: '도전성 설비 전체 (상위 라벨)', en: 'All conducting equipment (parent label)', q:
`// 불러올 때 상위 클래스도 라벨로 붙여 두어,
// :ConductingEquipment 하나로 Breaker, ACLineSegment 등을 모두 찾습니다
MATCH (e:ConductingEquipment)
RETURN e.name AS name, labels(e)[0] AS class
ORDER BY class, name` },
  { ko: '인접 설비 (Terminal–ConnectivityNode)', en: 'Adjacent equipment (Terminal–ConnectivityNode)', q:
`MATCH (e1)<-[:CONDUCTING_EQUIPMENT]-(:Terminal)-[:CONNECTIVITY_NODE]->(cn)
      <-[:CONNECTIVITY_NODE]-(:Terminal)-[:CONDUCTING_EQUIPMENT]->(e2)
WHERE e1.name < e2.name
RETURN DISTINCT e1.name AS a, e2.name AS b, cn.name AS node
ORDER BY node` },
  { ko: '전원에서 부하까지 경로 (가변 길이)', en: 'Source to load path (variable length)', q:
`// *..24 : 관계를 1~24개 거치는 경로. 설비 사이 한 걸음 = 단자–노드–단자 4개
MATCH p = (src:ExternalNetworkInjection)
          -[:CONDUCTING_EQUIPMENT|CONNECTIVITY_NODE*..24]-(ld:EnergyConsumer)
RETURN src.name AS source, ld.name AS load, length(p) AS hops,
       [n IN nodes(p) WHERE n:ConductingEquipment | n.name] AS path
ORDER BY hops
LIMIT 5` },
  { ko: '변전소 → 전압계급 → 설비', en: 'Substation → voltage level → equipment', q:
`MATCH (vl:VoltageLevel)-[:SUBSTATION]->(s:Substation),
      (vl)-[:BASE_VOLTAGE]->(bv:BaseVoltage)
OPTIONAL MATCH (eq:Equipment)-[:EQUIPMENT_CONTAINER]->(vl)
RETURN s.name AS substation, vl.name AS voltageLevel, bv.nominalVoltage AS kV, eq.name AS equipment
ORDER BY substation, voltageLevel, equipment` },
  { ko: '매핑 테이블 (Name / NameType)', en: 'Mapping table (Name / NameType)', q:
`MATCH (n:Name)-[:IDENTIFIED_OBJECT]->(o), (n)-[:NAME_TYPE]->(nt:NameType)
OPTIONAL MATCH (nt)-[:NAME_TYPE_AUTHORITY]->(a)
RETURN o.name AS object, a.name AS authority, nt.name AS nameType, n.name AS code, o.mRID AS mRID
ORDER BY object, authority` },
  { ko: 'SV 전압 (조류계산 결과)', en: 'SV voltages (power flow results)', q:
`MATCH (sv:SvVoltage)-[:TOPOLOGICAL_NODE]->(tn:TopologicalNode)
RETURN tn.name AS node, sv.v AS kV, sv.angle AS angle
ORDER BY node` },
  { ko: '부하 합계', en: 'Total load', q:
`MATCH (l:EnergyConsumer)
RETURN count(l) AS loads, sum(l.p) AS totalMW, sum(l.q) AS totalMVAr` }
];
