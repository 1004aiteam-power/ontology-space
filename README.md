# Ontology Space

온톨로지(Ontology)의 기본 개념과 **전력망 온톨로지**를 정리하는 저장소입니다.

## 구성

| 경로 | 내용 |
|---|---|
| [docs/01-ontology-introduction.md](docs/01-ontology-introduction.md) | 온톨로지란 무엇인가: 개념, 구성요소, 표준 기술(RDF/OWL/SPARQL) |
| [docs/02-power-grid-ontology.md](docs/02-power-grid-ontology.md) | 전력망 온톨로지: IEC CIM, CGMES, IEC 61850 등과 핵심 모델 |
| [docs/03-python-cim-design.md](docs/03-python-cim-design.md) | **프로젝트**: CIM을 파이썬 클래스로 설계 (`pycim`) |
| [docs/04-physical-ai.md](docs/04-physical-ai.md) | Physical AI 개념·관련 기술과 NEAT 자율주행 시뮬레이션 |
| [docs/05-digital-twin.md](docs/05-digital-twin.md) | 가상 대한민국 전력망 디지털 트윈 (⚠ 가상 데이터) |
| [examples/work/](examples/work/) | 업무 온톨로지: 가상의 AI추진부 업무 149개를 분류한 엑셀 원본, OWL, Neo4j 스크립트 (⚠ 가상 부서) |
| [examples/asset/](examples/asset/) | 전력설비 자산관리 온톨로지: 원본 CSV → `build_asset_ontology.py` → OWL · SHACL 검증 · Neo4j (⚠ 가상 데이터) |
| [shapes/asset-shapes.ttl](shapes/asset-shapes.ttl) | 자산관리 SHACL 규칙 (빈 설비 자리, 설치 기간 겹침, 근거 없는 작업지시) |
| [examples/power-grid-sample.ttl](examples/power-grid-sample.ttl) | CIM 스타일의 간단한 전력망 예제 (Turtle) |
| [examples/queries.md](examples/queries.md) | 예제 데이터에 대한 SPARQL 질의 모음 |
| [pycim/](pycim/) | CIM 파이썬 클래스 패키지 |
| [examples/build_sample_grid.py](examples/build_sample_grid.py) | pycim으로 예제 변전소 구성, 정전 분석, RDF 내보내기 |
| [examples/compare_solvers.py](examples/compare_solvers.py) | 같은 CIM 모델을 pandapower · OpenDSS로 계산해 비교 |
| [examples/sample_grid.dss](examples/sample_grid.dss) | pycim이 생성한 OpenDSS 스크립트 |
| [examples/import_cgmes.py](examples/import_cgmes.py) | CGMES(CIGRE MV) 읽기 → 조류계산 → SV 저장 → NEPLAN 결과와 비교 |
| [examples/validate.py](examples/validate.py) | SHACL로 데이터 품질 검증 |
| [examples/cgmes/](examples/cgmes/) | CGMES 예제 데이터 (CIGRE MV, 출처 cimpy · Apache-2.0)와 변환 결과 |
| [examples/mapping_table.csv](examples/mapping_table.csv) | 예제 변전소의 SCADA / EAM / GIS 코드 ↔ mRID 매핑 테이블 |
| [shapes/](shapes/) | SHACL 규칙(`cim-shapes.ttl`)과 pycim 클래스 계층(`cim-classes.ttl`) |
| [assets/physai/](assets/physai/) | 브라우저용 NEAT 구현과 자율주행 시뮬레이터 |
| [examples/twin/](examples/twin/) | 가상 대한민국 전력망: CIM 모델 생성 → 24시간 조류계산 (⚠ 가상 데이터) |
| `index.html` · `grid.html` · `project.html` · `lab.html` · `physical-ai.html` · `twin.html` · `studio.html` · `work.html` · `work-graph.html` · `asset.html` · `assets/` | GitHub Pages 웹사이트 (소개 / 전력망 / 프로젝트 / 실습 / 피지컬 AI / 디지털 트윈 / 온톨로지 설계실(업무 · 전력설비 자산관리), 한·영 전환) |

웹사이트: https://1004aiteam-power.github.io/ontology-space/

## 빠르게 써 보기

```bash
pip install rdflib pyshacl pandapower opendssdirect.py pytest
```

```bash
python examples/compare_solvers.py   # 같은 CIM 모델을 pandapower · OpenDSS로 계산해 비교
```

```bash
python examples/import_cgmes.py      # CGMES 읽기 → 조류계산 → SV 저장 → NEPLAN 결과와 비교
```

```bash
python examples/validate.py          # SHACL 검증
```

```bash
python examples/twin/build_korea_twin.py   # 가상 대한민국 전력망 24시간 계산 (디지털 트윈)
```

```bash
python examples/asset/build_asset_ontology.py   # 전력설비 자산관리: 위험도 계산 · OWL/Neo4j 생성 · SHACL 검증
```

```bash
python -m pytest tests               # 테스트
```

```bash
node tests/physai.test.mjs           # Physical AI 시뮬레이션 테스트
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
