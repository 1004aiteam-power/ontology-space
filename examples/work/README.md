# 업무 온톨로지 (AI추진부 예시) v0.2

> 가상의 부서를 예로 든 설계 사례입니다. 설명 페이지: [work.html](https://1004aiteam-power.github.io/ontology-space/work.html)

`work_ontology_v0.2.xlsx`를 그래프 형식으로 옮긴 파일들이다.

| 파일 | 용도 |
|---|---|
| `work-ontology.ttl` | OWL 온톨로지 (Turtle). Protégé, GraphDB, Apache Jena 등에서 연다 |
| `neo4j/import.cypher` | Neo4j 적재 스크립트. 외부 파일 없이 붙여 넣어 실행한다 |
| `neo4j/queries.cypher` | 역량 질문 11개에 대한 Cypher 쿼리 |
| `neo4j/tasks.csv`, `neo4j/relations.csv` | 범용 CSV (노드·엣지). 다른 그래프 도구나 BI에서 사용 |

## 모델 요약

- **클래스**: Task(단위업무), Domain(대분류), SubDomain(중분류), Role(InternalRole·ExternalParty), Artifact(산출물), Risk, LifecycleStage, TaskNature
- **업무 간 관계**
  - `precedes` / `PRECEDES`: 직접 선행 164건. 순환 없음. 전이 속성 `precedesTransitive`로 간접 선행을 추론
  - `feedsBackTo` / `FEEDS_BACK_TO`: 환류 14건. 순서를 강제하지 않아 순환 허용
- **그 밖의 관계**: belongsTo, partOf, ownedBy, collaboratesWith, produces, hasRisk, inStage, hasNature
- 협업 값이 "전 역할"인 업무는 주관 역할을 뺀 내부 역할 7개로 펼쳤다.

## 사용법

**Neo4j (5.x)**: Neo4j Browser에 `import.cypher` 전체를 붙여 넣고 실행한 뒤(Browser 설정에서 multi-statement 허용), `queries.cypher`의 쿼리를 하나씩 실행한다.

**Protégé**: `work-ontology.ttl`을 열고 Reasoner(HermiT 등)를 실행하면 `precedesTransitive`로 간접 선행 관계가 추론된다.

## 검증 상태

- `work-ontology.ttl`: Neo4j식 속성 그래프로 불러와 Cypher로 역량 질문을 재현해 엑셀 결과와 일치함을 확인했다(`tools/cypher.mjs`). 예: OP-1-1 오픈 전 선행 업무 40건 (`MATCH (a)-[:PRECEDES*]->(:Task {code:'OP-1-1'})`), 선행 순환 0건.
- `import.cypher`: 작업 환경에 Neo4j가 없어 실제로 실행하지 못했다. 처음 실행할 때 노드 수(Task 149)와 관계 수(PRECEDES 164, FEEDS_BACK_TO 14)를 확인할 것.

## 다음 확장 후보

- 승인자(A), 예상 공수, 사용 시스템 속성 추가 (엑셀 노란 열을 워크숍에서 채운 뒤)
- Resource 클래스(예산·인프라·벤더 계약)와 System 클래스 추가
- 네임스페이스 `https://example.org/...`를 실제 조직 도메인으로 교체
