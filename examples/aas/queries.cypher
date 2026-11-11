// 자산관리셸(AAS) × 자산관리 온톨로지 — 역량 질문
// 그래프: aas-mtr1.ttl (AAS RDF) + aas-links.ttl (다리) + ../asset/asset-ontology.ttl 을 함께 불러온 것
// 실행: node tools/cypher.mjs --ttl examples/aas/aas-mtr1.ttl,examples/aas/aas-links.ttl,examples/asset/asset-ontology.ttl --queries examples/aas/queries.cypher

// AAS 안의 참조는 Key 의 문자열 값이다. 셸에서 서브모델로 가려면 선을 따라가지 못하고 값을 맞춰야 한다
// Q1. AAS만으로: 셸의 서브모델과 요소 수 / AAS alone: the shell's submodels and their element counts
MATCH (s:AssetAdministrationShell)-[:SUBMODELS]->(:Reference)-[:KEYS]->(k:Key), (sm:Submodel)
WHERE sm.id = k.value
OPTIONAL MATCH (sm)-[:SUBMODEL_ELEMENTS]->(e)
RETURN sm.idShort AS submodel, count(e) AS elements
ORDER BY submodel;

// semanticId 가 자산관리 온톨로지(pam:)의 용어인 요소. 이름(idShort)이 아니라 뜻으로 찾는다
// Q2. 뜻으로 찾기: 온톨로지 용어를 semanticId 로 가진 요소 / Find by meaning: elements whose semanticId is an ontology term
MATCH (sm:Submodel)-[:SUBMODEL_ELEMENTS]->(e)-[:SEMANTIC_ID]->(:Reference)-[:KEYS]->(k:Key)
WHERE k.value STARTS WITH 'https://1004aiteam-power.github.io/ontology-space/asset#'
RETURN sm.idShort AS submodel, e.idShort AS element, 'pam:' + split(k.value, '#')[1] AS meaning, e.value AS value
ORDER BY submodel, element;

// DESCRIBES 는 globalAssetId 를 실제 연결로 바꾼 다리. 고장 모드와 작업지시는 AAS 에 없고 온톨로지에만 있다
// Q3. 다리를 건너: 이 셸의 자산에서 의심되는 고장 모드와 작업지시 / Across the bridge: suspected failure modes and work orders for the shell's asset
MATCH (s:AssetAdministrationShell)-[:DESCRIBES]->(a:Asset)<-[:ON_ASSET]-(g:Diagnosis)-[:INDICATES]->(f:FailureMode)
OPTIONAL MATCH (f)<-[:ADDRESSES]-(w:WorkOrder)-[:ON_ASSET]->(a)
RETURN f.label AS failureMode, g.date AS diagnosed, w.code AS workOrder, w.plannedDate AS planned
ORDER BY diagnosed;

// 셸은 실물 한 대에 붙는다. 같은 자리에 전에 있던 변압기는 온톨로지의 설치 이력에서 나온다
// Q4. 기능 위치의 이력: 이 변압기 자리에 있었던 자산 / History of the location: every asset that has sat in this transformer's place
MATCH (:AssetAdministrationShell)-[:HAS_SUBMODEL]->(:Submodel)<-[:IN_SUBMODEL]-(r:ResolvedReference {idShortPath: 'FunctionalLocation'}),
      (r)-[:REFERS_TO]->(loc)<-[:AT_LOCATION]-(d:Deployment)-[:DEPLOYED_ASSET]->(a:Asset)
RETURN 'ex:' + split(loc.uri, '#')[1] AS location, a.code AS asset, a.label AS name, d.validFrom AS validFrom, d.validTo AS validTo
ORDER BY validFrom;

// 같은 값이 두 곳에 있으면 어긋날 수 있다. AAS 의 값은 모두 문자열이라 숫자로 바꿔 비교한다. 결과가 없어야 정상
// Q5. 일치 검사: AAS 의 값과 온톨로지의 값이 다른 속성 / Consistency: properties whose AAS value differs from the ontology
MATCH (s:AssetAdministrationShell)-[:DESCRIBES]->(a:Asset),
      (s)-[:HAS_SUBMODEL]->(sm:Submodel)-[:SUBMODEL_ELEMENTS]->(p:Property)-[:SEMANTIC_ID]->(:Reference)-[:KEYS]->(k:Key)
WHERE k.value STARTS WITH 'https://1004aiteam-power.github.io/ontology-space/asset#'
WITH a, p, split(k.value, '#')[1] AS term
WHERE term IN ['healthIndex', 'probabilityOfFailure', 'consequenceOfFailure', 'riskScore', 'designLifeYears']
  AND toFloat(p.value) <> toFloat(properties(a)[term])
RETURN p.idShort AS element, p.value AS aasValue, properties(a)[term] AS ontologyValue;
