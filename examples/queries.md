# Cypher 질의 예제 (Neo4j)

대상 데이터: [`power-grid-sample.ttl`](power-grid-sample.ttl) 을 Neo4j식 속성 그래프로 불러온 것

RDF(CIM)를 Neo4j에 불러오면 이렇게 바뀝니다.

| RDF | Neo4j | 예 |
|---|---|---|
| 클래스 (`rdf:type`) | 라벨. 상위 클래스도 라벨로 함께 붙임 | `:Breaker:ProtectedSwitch:Switch:ConductingEquipment:Equipment` |
| 값 (리터럴) | 속성. 이름은 술어의 마지막 부분 | `cim:IdentifiedObject.name` → `name` |
| 다른 개체를 가리키는 값 | 관계. 대문자_밑줄 | `cim:Terminal.ConductingEquipment` → `:CONDUCTING_EQUIPMENT` |
| IRI | `uri` 속성 | `http://example.org/grid#TR_1` |

Neo4j의 neosemantics(n10s) 플러그인으로 불러와도 생각은 같습니다. n10s는 기본으로 `IdentifiedObject.name` 같은 원래 이름을 쓰므로, 위와 같은 짧은 이름을 쓰려면 `n10s.mapping.add`로 이름을 바꿔 줍니다. 이 저장소의 실습 페이지와 `tools/cypher.mjs`는 위 표의 이름으로 불러옵니다.

## 1. 변전소별 전압계급

```cypher
MATCH (vl:VoltageLevel)-[:SUBSTATION]->(ss:Substation), (vl)-[:BASE_VOLTAGE]->(bv:BaseVoltage)
RETURN ss.name AS ss, vl.name AS vl, bv.nominalVoltage AS kv
```

## 2. 모든 도전성 설비 (상위 라벨 활용)

불러올 때 상위 클래스도 라벨로 붙였기 때문에, `:ConductingEquipment` 하나로 차단기·변압기 등 하위 종류까지 한 번에 찾습니다.

```cypher
MATCH (eq:ConductingEquipment)
RETURN eq.name AS name, labels(eq)[0] AS type
ORDER BY type, name
```

## 3. 특정 노드에 연결된 설비

```cypher
MATCH (cn:ConnectivityNode {name: '154kV 모선 노드'})<-[:CONNECTIVITY_NODE]-(:Terminal)-[:CONDUCTING_EQUIPMENT]->(eq)
RETURN cn.name AS node, eq.name AS equipment
```

## 4. 설비 간 직접 인접 관계 (토폴로지 그래프)

```cypher
MATCH (e1)<-[:CONDUCTING_EQUIPMENT]-(:Terminal)-[:CONNECTIVITY_NODE]->(cn:ConnectivityNode)
      <-[:CONNECTIVITY_NODE]-(:Terminal)-[:CONDUCTING_EQUIPMENT]->(e2)
WHERE e1 <> e2
RETURN DISTINCT e1.name AS a, e2.name AS b
```

## 5. 몇 단계든 따라가기 (가변 길이 경로)

전원에서 부하까지 설비를 차례로 나열합니다. 설비 사이 한 걸음은 단자–노드–단자라서 관계가 4개씩 늘어납니다. 손으로 쓴 `power-grid-sample.ttl`에는 전원(ExternalNetworkInjection)이 없으므로, 전원이 들어 있는 pycim 출력 [`sample_grid_full.ttl`](sample_grid_full.ttl)에서 실행하세요.

```cypher
MATCH p = (src:ExternalNetworkInjection)-[:CONDUCTING_EQUIPMENT|CONNECTIVITY_NODE*..24]-(ld:EnergyConsumer)
RETURN [n IN nodes(p) WHERE n:ConductingEquipment | n.name] AS path
ORDER BY length(p)
LIMIT 1
```

## 실행하기

- **브라우저**: [실습 페이지](../lab.html)의 Cypher 실습 칸에 붙여 넣고 ▶ 실행
- **명령줄** (Node.js, Neo4j 없이):
  ```bash
  node tools/cypher.mjs --ttl examples/power-grid-sample.ttl,shapes/cim-classes.ttl \
    --query "MATCH (b:Breaker) RETURN b.name"
  ```
- **파이썬**:
  ```python
  from pycim.cypher import run
  out = run(ttl=["examples/power-grid-sample.ttl", "shapes/cim-classes.ttl"],
            query="MATCH (b:Breaker) RETURN b.name AS name")
  print(out["queries"][0]["rows"])
  ```

데이터 검증(형상검증) 규칙은 [`shapes/cim-checks.cypher`](../shapes/cim-checks.cypher)에 있습니다. 규칙마다 "위반을 찾는" 질의 하나이며, 결과가 0행이면 통과입니다.
