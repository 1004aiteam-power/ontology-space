# SPARQL 질의 예제

대상 데이터: [`power-grid-sample.ttl`](power-grid-sample.ttl)

모든 질의에 아래 접두어를 붙입니다.

```sparql
PREFIX cim:  <http://iec.ch/TC57/CIM100#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
```

## 1. 변전소별 전압계급

```sparql
SELECT ?ss ?vl ?kv WHERE {
  ?vlRes cim:VoltageLevel.Substation/cim:IdentifiedObject.name ?ss ;
         cim:IdentifiedObject.name ?vl ;
         cim:VoltageLevel.BaseVoltage/cim:BaseVoltage.nominalVoltage ?kv .
}
```

## 2. 모든 도전성 설비 (클래스 계층 활용)

`rdfs:subClassOf*` 경로로 하위 클래스(차단기, 변압기 등)까지 한 번에 찾습니다.

```sparql
SELECT ?name ?type WHERE {
  ?eq a ?cls ; cim:IdentifiedObject.name ?name .
  ?cls rdfs:subClassOf* cim:ConductingEquipment ; rdfs:label ?type .
}
```

## 3. 특정 노드에 연결된 설비

```sparql
SELECT ?node ?equipment WHERE {
  ?t cim:Terminal.ConnectivityNode/cim:IdentifiedObject.name ?node ;
     cim:Terminal.ConductingEquipment/cim:IdentifiedObject.name ?equipment .
  FILTER(?node = "154kV 모선 노드")
}
```

## 4. 설비 간 직접 인접 관계 (토폴로지 그래프)

```sparql
SELECT DISTINCT ?a ?b WHERE {
  ?t1 cim:Terminal.ConductingEquipment ?e1 ; cim:Terminal.ConnectivityNode ?cn .
  ?t2 cim:Terminal.ConductingEquipment ?e2 ; cim:Terminal.ConnectivityNode ?cn .
  FILTER(?e1 != ?e2)
  ?e1 cim:IdentifiedObject.name ?a .
  ?e2 cim:IdentifiedObject.name ?b .
}
```

## Python으로 실행하기

```python
import rdflib
g = rdflib.Graph().parse("examples/power-grid-sample.ttl")
q = """
PREFIX cim: <http://iec.ch/TC57/CIM100#>
SELECT ?name WHERE { ?x a cim:Breaker ; cim:IdentifiedObject.name ?name }
"""
for row in g.query(q):
    print(row.name)
```
