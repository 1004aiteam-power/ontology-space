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

## 5. 식별자: IRI와 UUID

온톨로지에서 모든 개체는 **IRI(전역 식별자)** 로 구별합니다. 이름은 겹치고 바뀌지만 식별자는 **유일하고 바뀌지 않아야** 합니다.

> "M.Tr #1"이라는 변압기는 변전소마다 있습니다. 이름만으로는 구별할 수 없고, 이름을 기준으로 연결하면 이름이 바뀔 때 연결이 모두 끊깁니다.
> 그래서 **이름은 속성으로, 식별은 IRI로** 합니다.

### IRI를 만드는 두 가지 방식

| 방식 | 예 | 장점 | 단점 |
|---|---|---|---|
| 의미 있는 경로 | `http://example.org/grid/SS_A/TR_1` | 읽기 쉬움 | 이름·소속이 바뀌면 IRI도 바뀌어야 함 |
| **불투명 ID (UUID)** | `urn:uuid:3f2b…` | 바뀔 이유가 없음, 중앙 발급 없이 유일 | 읽기 어려움 → 이름은 별도 속성 |

### UUID (RFC 9562, 구 RFC 4122)

128비트 식별자로, 각 시스템이 따로 만들어도 사실상 충돌하지 않습니다.

| 버전 | 만드는 방법 | 언제 쓰나 |
|---|---|---|
| **v4** | 무작위 (122비트) | 새 객체를 처음 등록할 때 |
| **v5** | 네임스페이스 + 이름의 SHA-1. **같은 입력 → 같은 UUID** | 기존 코드(설비번호 등)에서 매번 같은 ID를 만들어야 할 때 |
| **v7** | 시각 + 무작위, 시간순 정렬 | 데이터베이스 기본키 |

```python
import uuid
uuid.uuid4()                                   # 무작위
ns = uuid.uuid5(uuid.NAMESPACE_URL, "https://example.org/grid")
uuid.uuid5(ns, "A변전소/CB-154-01")            # 항상 같은 값
```

### 운영 원칙

1. **한 번 발급하면 바꾸지 않는다.** 내보낼 때마다 ID가 바뀌면 시스템 간 연결과 이력이 끊깁니다.
2. **재사용하지 않는다.** 철거된 설비의 ID를 새 설비에 붙이지 않습니다.
3. **ID에 의미를 넣지 않는다.** 위치·전압·소속은 속성으로 표현합니다.
4. **매핑 테이블을 관리한다.** 기존 시스템 코드(SCADA 포인트, GIS ID, 자산번호) ↔ UUID.

참고: W3C *Cool URIs for the Semantic Web* (https://www.w3.org/TR/cooluris/)

## 6. 온톨로지 vs 다른 데이터 모델

| 구분 | 관계형 DB | 택소노미(분류체계) | 온톨로지 |
|---|---|---|---|
| 구조 | 테이블, 고정 스키마 | 트리 계층 | 그래프, 유연한 스키마 |
| 관계 표현 | 외래키 | 상하위만 | 임의의 의미 있는 관계 |
| 추론 | 없음 | 제한적 | 논리 추론 가능 |
| 시스템 간 통합 | 매핑 작업 필요 | 어려움 | 전역 식별자(IRI)로 자연스럽게 연결 |

## 7. 온톨로지 구축 절차 (일반적)

1. **범위 정의**: 무엇에 답하려는가? (Competency Questions 작성)
2. **기존 온톨로지 조사·재사용**: 전력 분야라면 IEC CIM부터 확인
3. **핵심 용어 나열** 및 클래스/속성 구분
4. **클래스 계층 설계**
5. **속성과 제약 정의**
6. **개체(데이터) 입력**
7. **검증**: 추론기(HermiT, Pellet 등), SHACL, Competency Question 질의로 확인

## 8. 주요 도구

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
