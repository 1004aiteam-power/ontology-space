# 온톨로지(Ontology) 소개

## 1. 온톨로지란?

철학에서 온톨로지(존재론)는 "무엇이 존재하는가"를 다루는 학문입니다.
정보과학에서는 이 개념을 빌려 다음과 같이 정의합니다.

> **온톨로지**: 특정 도메인의 개념(Concept)과 그 개념들 사이의 관계(Relation)를
> 사람과 기계가 함께 이해할 수 있도록 **명시적이고 형식적으로** 정의한 지식 모델
> (Gruber, 1993: "an explicit specification of a conceptualization")

쉽게 말하면 **"이 분야에서 쓰는 용어와, 그 용어들이 서로 어떻게 연결되는지에 대한 합의된 사전 + 규칙집"** 입니다.

## 2. 왜 필요한가?

| 문제 | 온톨로지가 주는 해결책 |
|---|---|
| 시스템마다 같은 대상을 다른 이름으로 부름 (예: "선로", "Line", "ACLineSegment") | 공통 어휘로 의미를 통일 → **시맨틱 상호운용성** |
| 데이터가 테이블·파일에 흩어져 관계를 파악하기 어려움 | 데이터를 그래프로 연결 → **지식 그래프(Knowledge Graph)** |
| 암묵적인 도메인 규칙이 코드 속에 숨어 있음 | 규칙을 모델에 명시 → **추론(Reasoning)** 으로 새로운 사실 도출 |
| AI/LLM이 도메인 맥락을 모름 | 구조화된 지식을 제공 → **GraphRAG**, 근거 기반 답변 |

## 3. 구성요소

| 구성요소 | 설명 | 전력망 예시 |
|---|---|---|
| **클래스 (Class)** | 개념의 범주 | `변압기`, `변전소`, `송전선로` |
| **개체 (Individual / Instance)** | 클래스의 구체적인 실체 | `신서울변전소`, `TR-1` |
| **속성 (Property)** | 개체 간 관계(Object Property) 또는 값(Data Property) | `설치위치`, `정격용량 = 100 MVA` |
| **계층 (Hierarchy)** | 상위-하위 개념 관계 (`subClassOf`) | `차단기` ⊂ `개폐장치` ⊂ `도전성설비` |
| **제약/공리 (Axiom)** | 논리 규칙 | "모든 변압기는 2개 이상의 권선을 가진다" |

온톨로지는 보통 두 층으로 나눠 생각합니다.

- **TBox (Terminological Box)**: 스키마. 클래스, 속성, 규칙 정의
- **ABox (Assertional Box)**: 데이터. 실제 개체와 사실

## 4. 표준 기술 스택 (W3C 시맨틱 웹)

```
        ┌───────────────────────────────┐
        │  응용 (검색, 추론, AI, 시각화)   │
        ├───────────────────────────────┤
        │  SPARQL  (질의)                │
        │  SHACL   (데이터 검증)          │
        ├───────────────────────────────┤
        │  OWL     (풍부한 논리 표현)      │
        │  RDFS    (클래스/속성 계층)      │
        ├───────────────────────────────┤
        │  RDF     (주어-술어-목적어 트리플) │
        ├───────────────────────────────┤
        │  IRI / URI (전역 식별자)         │
        └───────────────────────────────┘
```

### RDF 트리플

모든 지식을 `주어 – 술어 – 목적어` 세 요소로 표현합니다.

```turtle
ex:TR1  rdf:type          cim:PowerTransformer .
ex:TR1  cim:Equipment.EquipmentContainer  ex:SubstationA .
ex:TR1  ex:ratedS         "100"^^xsd:float .
```

### 직렬화 형식

- **Turtle (.ttl)**: 사람이 읽기 쉬움. 학습·작성에 적합
- **RDF/XML (.rdf, .xml)**: 전통적인 형식. IEC CIM 데이터 교환에 사용
- **JSON-LD**: 웹/API 친화적
- **N-Triples**: 한 줄에 트리플 하나. 대용량 처리에 적합

### SPARQL 예시

```sparql
# 변전소별 변압기 목록
SELECT ?substation ?transformer WHERE {
  ?transformer a cim:PowerTransformer ;
               cim:Equipment.EquipmentContainer ?substation .
}
```

## 5. 온톨로지 vs 다른 데이터 모델

| 구분 | 관계형 DB | 택소노미(분류체계) | 온톨로지 |
|---|---|---|---|
| 구조 | 테이블, 고정 스키마 | 트리 계층 | 그래프, 유연한 스키마 |
| 관계 표현 | 외래키 | 상하위만 | 임의의 의미 있는 관계 |
| 추론 | 없음 | 제한적 | 논리 추론 가능 |
| 시스템 간 통합 | 매핑 작업 필요 | 어려움 | 전역 식별자(IRI)로 자연스럽게 연결 |

## 6. 온톨로지 구축 절차 (일반적)

1. **범위 정의**: 무엇에 답하려는가? (Competency Questions 작성)
2. **기존 온톨로지 조사·재사용**: 전력 분야라면 IEC CIM부터 확인
3. **핵심 용어 나열** 및 클래스/속성 구분
4. **클래스 계층 설계**
5. **속성과 제약 정의**
6. **개체(데이터) 입력**
7. **검증**: 추론기(HermiT, Pellet 등), SHACL, Competency Question 질의로 확인

## 7. 주요 도구

| 도구 | 용도 |
|---|---|
| Protégé | 온톨로지 편집기 (Stanford, 무료) |
| Apache Jena / Fuseki | Java RDF 프레임워크, SPARQL 서버 |
| GraphDB, Stardog, Virtuoso | 트리플 스토어 |
| rdflib (Python) | RDF 파싱·질의 |
| pySHACL | SHACL 검증 |

## 참고

- W3C RDF 1.1 Primer: https://www.w3.org/TR/rdf11-primer/
- W3C OWL 2 Primer: https://www.w3.org/TR/owl2-primer/
- Noy & McGuinness, *Ontology Development 101* (Stanford)
