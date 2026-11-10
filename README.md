# Ontology Space

온톨로지(Ontology)의 기본 개념과 **전력망 온톨로지**를 정리하는 저장소입니다.

## 구성

| 경로 | 내용 |
|---|---|
| [docs/01-ontology-introduction.md](docs/01-ontology-introduction.md) | 온톨로지란 무엇인가: 개념, 구성요소, 표준 기술(RDF/OWL)과 Neo4j·Cypher |
| [docs/02-power-grid-ontology.md](docs/02-power-grid-ontology.md) | 전력망 온톨로지: IEC CIM, CGMES, IEC 61850 등과 핵심 모델 |
| [docs/03-python-cim-design.md](docs/03-python-cim-design.md) | **프로젝트**: CIM을 파이썬 클래스로 설계 (`pycim`) |
| [docs/04-physical-ai.md](docs/04-physical-ai.md) | Physical AI 개념·관련 기술과 NEAT 자율주행 시뮬레이션 |
| [docs/05-digital-twin.md](docs/05-digital-twin.md) | 가상 대한민국 전력망 디지털 트윈 (⚠ 가상 데이터) |
| [ai.html](ai.html) | AI × 온톨로지 시연: LLM만 · 문서 검색 · GraphRAG 비교, GraphRAG(질문 → 온톨로지 스키마 → Cypher → 실행 → 결과로만 답 → 근거 그래프), 고장 영향을 단계별로 추론하는 AI 에이전트. AI 부분은 미리 작성한 시연용 시나리오(`assets/ai/ai-scenarios.js`), Cypher 실행과 답의 숫자는 브라우저에서 실제 그래프로 계산 (⚠ 가상 데이터) |
| [ood.html](ood.html) | 온톨로지 vs. 객체지향 설계(OOD): 같은 ESS를 파이썬 클래스와 OWL로 나란히 적고, 목적 · 열린 세계 · 다중 분류 · 독립 속성 · 전역 이름 · 스키마 변경 · domain/range 추론의 일곱 가지 차이와 함께 쓰는 법 |
| [vpp.html](vpp.html) | VPP(가상발전소)·분산에너지 기본 개념: DER 종류, 예측 → 입찰 → 제어 → 정산, 관련 표준(IEC 61850-7-420 · IEEE 2030.5 · OpenADR · OCPP)과 국내외 제도, 기존 전력망·전기차 온톨로지와의 연결 |
| [examples/vpp/](examples/vpp/) | VPP 가상 전력시장 (`vpp-market.html`): VPP 10개 · 중개사업자 · DER 81개(태양광 · 풍력 · ESS · 전기차 충전소 · 수요반응) · 22.9kV 배전선로 15개 → 디지털 트윈 154kV 변전소 5곳, 하루 전 시장 24시간 입찰 · 정산 · 배전운영자 출력제한. `assets/vpp/vpp-graph.js` → `build_vpp.mjs` → 스키마 `vpp-schema.ttl` · 개체 `vpp-market.ttl` · Neo4j 적재 스크립트 `neo4j/import.cypher`, 브라우저에서 속성 그래프(Cytoscape)와 Cypher 질의 (⚠ 가상 데이터) |
| [bidding.html](bidding.html) | 내가 이해한 전력시장: 변동비 반영시장(CBP)에서 공급가능용량 입찰 → SMP 결정 → 급전지시 → 계량 · 정산 흐름, 메리트 오더 체험(가상 값), 발전사업자 체크리스트 (⚠ 개인 학습 노트, 참고용) |
| [examples/work/](examples/work/) | 업무 온톨로지: 가상의 AI추진부 업무 149개를 분류한 엑셀 원본, OWL, Neo4j 스크립트 (⚠ 가상 부서) |
| [examples/asset/](examples/asset/) | 전력설비 자산관리 온톨로지: 원본 CSV → `build_asset_ontology.py` → OWL · Neo4j · Cypher 검증(`neo4j/checks.cypher`) (⚠ 가상 데이터) |
| [examples/asset/neo4j/checks.cypher](examples/asset/neo4j/checks.cypher) | 자산관리 형상검증 (Neo4j · Cypher): 빈 설비 자리, 설치 기간 겹침, EAM 번호 형식, 근거 없는 작업지시 등 8개 규칙 |
| [examples/highway/](examples/highway/) | 가상 전국 고속도로·국도 온톨로지(OWL + GeoSPARQL)와 24시간 차량 흐름: 원본 CSV → `build_highway.py` (중력모형 수요 · 시간대별 이용자 균형 배정) (⚠ 가상 데이터) |
| [examples/ev/](examples/ev/) | 고속도로 × 전력망: 휴게소 전기차 충전 온톨로지. 24시간 교통량 → 충전 수요 → 22.9kV 배전선로 → 디지털 트윈 154kV 변전소, 세 그래프를 합친 Cypher 질의 (⚠ 가상 데이터) |
| [examples/impact/](examples/impact/) | 설비 고장 영향 분석: 자산관리 온톨로지 ↔ 배전선로 모델(`skos:exactMatch`, `im:feeds`), 연계 절체를 반영한 위험도 재계산 (⚠ 가상 데이터) |
| [shapes/highway-checks.cypher](shapes/highway-checks.cypher) | 도로망 형상검증 (Neo4j · Cypher): 구간·링크 방향, 분기점, 도로 등급, 연결성, 서비스수준, 표준 대응 기록 |
| [examples/highway/highway-alignment.ttl](examples/highway/highway-alignment.ttl) | 도로 온톨로지 ↔ INSPIRE 교통망 · 국토교통부 표준노드링크 · GeoSPARQL 대응 (SKOS, 항목별 원문 확인 여부 표시) |
| [examples/power-grid-sample.ttl](examples/power-grid-sample.ttl) | CIM 스타일의 간단한 전력망 예제 (Turtle) |
| [examples/queries.md](examples/queries.md) | 예제 데이터에 대한 Cypher(Neo4j) 질의 모음, RDF → Neo4j 불러오기 규칙 |
| [pycim/](pycim/) | CIM 파이썬 클래스 패키지 |
| [examples/build_sample_grid.py](examples/build_sample_grid.py) | pycim으로 예제 변전소 구성, 정전 분석, RDF 내보내기 |
| [examples/compare_solvers.py](examples/compare_solvers.py) | 같은 CIM 모델을 pandapower · OpenDSS로 계산해 비교 |
| [examples/sample_grid.dss](examples/sample_grid.dss) | pycim이 생성한 OpenDSS 스크립트 |
| [examples/import_cgmes.py](examples/import_cgmes.py) | CGMES(CIGRE MV) 읽기 → 조류계산 → SV 저장 → NEPLAN 결과와 비교 |
| [examples/cgmes/](examples/cgmes/) | CGMES 예제 데이터 (CIGRE MV, 출처 cimpy · Apache-2.0)와 변환 결과 |
| [examples/mapping_table.csv](examples/mapping_table.csv) | 예제 변전소의 SCADA / EAM / GIS 코드 ↔ mRID 매핑 테이블 |
| [shapes/](shapes/) | 형상검증 규칙(`cim-checks.cypher` · `highway-checks.cypher`, Neo4j Cypher)과 pycim 클래스 계층(`cim-classes.ttl`) |
| [tools/build_ontology_map.mjs](tools/build_ontology_map.mjs) | 사이트 전체 온톨로지 지도 데이터(`assets/data/ontology-map.json`): Turtle 파일에서 온톨로지별 클래스·개체 수와 서로 가리키는 트리플(술어별 건수), 외부 표준 사용을 셈 (`ontology-map.html`) |
| [tools/build_nav.py](tools/build_nav.py) | 모든 페이지의 위쪽 메뉴와 파비콘·링크 공유 미리보기(Open Graph) 태그를 한 곳에서 만듦 (메뉴를 바꿀 때 이 파일만 고치고 실행). [tools/thumbs.cjs](tools/thumbs.cjs): 소개 페이지 시뮬레이션 썸네일 생성 |
| [tools/cypher.mjs](tools/cypher.mjs) · [pycim/cypher.py](pycim/cypher.py) | Neo4j 없이 Cypher 실행 (브라우저 실습과 같은 엔진): Turtle 불러오기 · 적재 스크립트 · 질의 · 형상검증. 빌드 스크립트와 테스트가 사용 |
| [assets/physai/](assets/physai/) | 브라우저용 NEAT 구현과 자율주행 시뮬레이터, NEAT 스네이크 (`neat-snake.html`) |
| [assets/eco/](assets/eco/) | 단세포 생태계: 초식·육식 세포의 개체 기반 포식자–피식자 시뮬레이션, 피난처·계절·진화 (`ecosystem.html`, 만든 이의 또 다른 관심사) |
| [assets/traffic/](assets/traffic/) | 교차로 신호: 위에서 본 4갈래 교차로, IDM 차량·좌회전 전용 신호·보행 신호, 고정 주기 vs 감응식 (`intersection.html`) |
| [assets/cypher/](assets/cypher/) | 브라우저 Cypher 실습: RDF(Turtle)를 Neo4j식 속성 그래프로 불러오기(클래스 → 라벨, 값 → 속성, 개체 연결 → 관계, neosemantics 방식)와 읽기 전용 Cypher 엔진(MATCH · OPTIONAL MATCH · WHERE · WITH · UNWIND · RETURN, 가변 길이 경로, 집계, EXISTS), 실습 예제 질의, 전기차·고장 영향 페이지의 역량 질문 (`lab.html`) |
| [assets/safety/](assets/safety/) | 배전공사 안전 훈련: 가상 현장 네 곳(가공 전주 애자·완금 교체 정전 작업 · 주상변압기 교체(COS 개방, 본선 활선) · 지중 맨홀 밀폐공간 작업 · 송전 철탑 승탑)에서 작업자 5명이 "생명을 지키는 안전수칙 11"에 따라 TBM부터 철수까지 안전조치를 단계별로 진행, 순서 맞히기 훈련 모드(강사용 시작 단계 선택, 결과 인쇄·PDF, 브라우저 기록), 매 틱 안전 규칙 확인, 2D 캔버스 원근(pseudo-3D) 화면 (`safety.html`, ⚠ 교육용 가상 현장) |
| [assets/airport/](assets/airport/) | 공항 이착륙: 가상 공항의 평행 활주로 2개 혼합 운영, 하루 전체 운항 일정, 후류 간격·복행·지상 이동, 도착·출발 안내판과 2D 캔버스 원근(pseudo-3D) 화면 (`airport.html`, ⚠ 가상 공항·항공사) |
| [assets/flights/](assets/flights/) | 세계 항공 교통: 실제 주요 공항 176곳 · 가상 항공사의 하루 약 1만 편, 대권 항로·고도·편서풍, 국내선/국제선, 낮·밤 경계를 그린 메르카토르 세계 지도 (`flights.html`, 지도 데이터는 [examples/flights/build_world_map.mjs](examples/flights/build_world_map.mjs)로 Natural Earth에서 생성, ⚠ 가상 데이터: 공항 이름·위치만 실제이고 항공사·편명·운항 일정·항공기 위치는 모두 가상, 실제 항공편 추적 아님) |
| [examples/ecosystem/](examples/ecosystem/) | 단세포 생태계 온톨로지: 시뮬레이션 한 번의 세포 기록(분열·포식·죽음·피난처·계절) → OWL 스키마 `eco-ontology.ttl` + 개체 `eco-run-seed1.ttl` (`build_eco.mjs`, 브라우저와 같은 코드 `assets/eco/eco-graph.js`), 혈통·진화·피난처·계절 Cypher 질문 (`eco-ontology.html`, ⚠ 시뮬레이션 속 가상 생물) |
| [examples/safety/](examples/safety/) | 배전공사 안전 온톨로지: 안전 훈련 시뮬레이션(`assets/safety/safety.js`)의 현장 · 작업 단계 · 안전수칙 11 · 역할 · 훈련 오답 + 위험요인 → 스키마 `safety-schema.ttl` + 개체 `safety-steps.ttl` (`build_safety.mjs`, 브라우저와 같은 코드 `assets/safety/safety-graph.js`). 작업 단계 ⊑ 업무 온톨로지 `aipd:Task`(선행 · 리스크 · 생애주기), 작업 대상 설비 → 자산관리 자산 · 정비 흐름, 정전 작업 구간 → 배전선로 D/L #1 구간 · 개폐기 (`safety-ontology.html`, ⚠ 교육용 가상 현장) |
| [examples/twin/](examples/twin/) | 가상 대한민국 전력망: CIM 모델 생성 → 24시간 조류계산 (⚠ 가상 데이터) |
| [examples/feeder/](examples/feeder/) | A변전소 D/L #1 배전선로 상세: 구간 개폐기 6 · 연계 개폐기 4 · 분기점 3, pycim 모델 → CIM RDF · 웹 그림 데이터 · 모든 구간의 고장 복구(FLISR) 계획 (⚠ 가상 데이터) |
| `index.html` · `grid.html` · `project.html` · `lab.html` · `physical-ai.html` · `neat-snake.html` · `safety.html` · `ecosystem.html` · `intersection.html` · `airport.html` · `flights.html` · `twin.html` · `studio.html` · `work.html` · `work-graph.html` · `asset.html` · `highway.html` · `ev.html` · `impact.html` · `safety-ontology.html` · `eco-ontology.html` · `ontology-map.html` · `assets/` | GitHub Pages 웹사이트 (소개 / 전력망(배전선로 고장 복구 시뮬레이션 포함) / 프로젝트 / 실습 / 피지컬 AI(NEAT 자율주행 · NEAT 스네이크) / 시뮬레이션(배전공사 안전 훈련 · 단세포 생태계 · 교차로 신호 · 공항 이착륙 · 세계 항공 교통) / 디지털 트윈 / 온톨로지 설계실(업무 · 전력설비 자산관리 · 고속도로·국도 교통 · 전기차 충전 · 설비 고장 영향 분석 · 배전공사 안전 · 단세포 생태계), 한·영 전환) |

웹사이트: https://1004aiteam-power.github.io/ontology-space/

## 빠르게 써 보기

```bash
pip install rdflib pandapower opendssdirect.py pytest   # Cypher 질의·검증에는 Node.js도 필요
```

```bash
python examples/compare_solvers.py   # 같은 CIM 모델을 pandapower · OpenDSS로 계산해 비교
```

```bash
python examples/import_cgmes.py      # CGMES 읽기 → 조류계산 → SV 저장 → NEPLAN 결과와 비교
```

```bash
node tools/cypher.mjs --ttl examples/power-grid-sample.ttl,shapes/cim-classes.ttl --checks shapes/cim-checks.cypher   # 형상검증 (Cypher)
```

```bash
python examples/twin/build_korea_twin.py   # 가상 대한민국 전력망 24시간 계산 (디지털 트윈)
```

```bash
python examples/feeder/build_feeder.py   # D/L #1 배전선로: 개폐 시나리오 검증 · CIM RDF 생성
```

```bash
python examples/asset/build_asset_ontology.py   # 전력설비 자산관리: 위험도 계산 · OWL/Neo4j 생성 · Cypher 검증
```

```bash
python examples/highway/build_highway.py   # 가상 고속도로: 수요 배정 24시간 계산 · OWL 생성 · Cypher 검증
```

```bash
python examples/ev/build_ev.py   # 고속도로 × 전력망: 휴게소 충전 수요 · 배전선로 부하 · 세 그래프 Cypher
```

```bash
python examples/impact/build_impact.py   # 설비 고장 영향 분석: 자산 → 구간 · 고객, 연계 절체 반영 위험도
```

```bash
node examples/safety/build_safety.mjs   # 배전공사 안전 온톨로지: 시뮬레이션 → Turtle, 업무 · 자산 · 배전선로를 함께 불러 Cypher 질의
```

```bash
python -m pytest tests               # 테스트
```

```bash
node tests/physai.test.mjs           # Physical AI 시뮬레이션 테스트
```

```bash
node tests/ecosim.test.mjs           # 단세포 생태계 시뮬레이션 테스트
```

```bash
node tests/safety.test.mjs           # 배전공사 안전 시뮬레이션 테스트
node tests/safety-graph.test.mjs     # 배전공사 안전 온톨로지: Turtle 최신 여부 · 다른 온톨로지 IRI 확인 · 역량 질문
node tests/cypher.test.mjs           # 브라우저 Cypher 엔진 · 실습 예제 · 역량 질문 결과 대조
node tests/traffic.test.mjs          # 교차로 신호 시뮬레이션 테스트
node tests/airport.test.mjs          # 공항 이착륙 시뮬레이션 테스트
node tests/flights.test.mjs          # 세계 항공 교통 시뮬레이션 테스트
```

[Protégé](https://protege.stanford.edu/)로 `.ttl` 파일을 열어 클래스 계층과 개체를 시각적으로 볼 수도 있습니다.

## 라이선스

© 2026 1004aiteam-power. 가져다 써도 좋지만, **아래 조건을 꼭 지켜 주세요.**

| 대상 | 라이선스 | 지켜야 할 것 |
|---|---|---|
| 코드 (`pycim/`, `tests/`, `examples/**/*.py`, `shapes/`, `assets/*.js·css`, `assets/physai/`, `assets/twin/`) | [AGPL-3.0](LICENSE-CODE) | 저작권·라이선스 표시 유지, 수정·포함한 프로그램은 **전체 소스를 같은 조건으로 공개** (웹 서비스로 제공해도 공개) |
| 문서·콘텐츠 (`docs/`, README, 웹페이지의 글·그림·디자인, 데이터 파일) | [CC BY-NC-SA 4.0](LICENSE-DOCS) | **출처 표시 필수**, 상업적 이용 금지, 수정한 결과물은 같은 조건으로만 공개 |
| 외부 구성요소 (Oxigraph, Cytoscape.js, cimpy 예제 데이터, Natural Earth) | 각 원래 라이선스 | [LICENSE](LICENSE) 참고 |

### 출처 표시 방법

```
출처: Ontology Space (1004aiteam-power), https://1004aiteam-power.github.io/ontology-space/ , CC BY-NC-SA 4.0
```

```
Source: Ontology Space by 1004aiteam-power, https://1004aiteam-power.github.io/ontology-space/ , CC BY-NC-SA 4.0
```

수정했다면 "○○를 수정함"처럼 변경 사항도 함께 밝혀 주세요. 상업적 이용이나 다른 조건의 사용은 별도로 문의해 주세요.
사용하신다면 GitHub 이슈로 알려 주시면 반갑겠습니다.

자세한 내용: [LICENSE](LICENSE)
