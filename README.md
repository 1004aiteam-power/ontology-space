# Ontology Space

온톨로지(Ontology)의 기본 개념과 **전력망 온톨로지**를 정리하는 저장소입니다.

## 구성

| 경로 | 내용 |
|---|---|
| [docs/01-ontology-introduction.md](docs/01-ontology-introduction.md) | 온톨로지란 무엇인가: 개념, 구성요소, 표준 기술(RDF/OWL/SPARQL) |
| [docs/02-power-grid-ontology.md](docs/02-power-grid-ontology.md) | 전력망 온톨로지: IEC CIM, CGMES, IEC 61850 등과 핵심 모델 |
| [docs/03-python-cim-design.md](docs/03-python-cim-design.md) | **프로젝트**: CIM을 파이썬 클래스로 설계 (`pycim`) |
| [examples/power-grid-sample.ttl](examples/power-grid-sample.ttl) | CIM 스타일의 간단한 전력망 예제 (Turtle) |
| [examples/queries.md](examples/queries.md) | 예제 데이터에 대한 SPARQL 질의 모음 |
| [pycim/](pycim/) | CIM 파이썬 클래스 패키지 |
| [examples/build_sample_grid.py](examples/build_sample_grid.py) | pycim으로 예제 변전소 구성, 정전 분석, RDF 내보내기 |
| [examples/compare_solvers.py](examples/compare_solvers.py) | 같은 CIM 모델을 pandapower · OpenDSS로 계산해 비교 |
| [examples/sample_grid.dss](examples/sample_grid.dss) | pycim이 생성한 OpenDSS 스크립트 |
| `index.html` · `grid.html` · `project.html` · `assets/` | GitHub Pages 웹사이트 (소개 / 전력망 / 프로젝트, 한·영 전환) |

웹사이트: https://1004aiteam-power.github.io/ontology-space/

## 빠르게 써 보기

```bash
pip install rdflib
python -c "import rdflib; g=rdflib.Graph().parse('examples/power-grid-sample.ttl'); print(len(g), 'triples')"
```

[Protégé](https://protege.stanford.edu/)로 `.ttl` 파일을 열어 클래스 계층과 개체를 시각적으로 볼 수도 있습니다.

## 라이선스

[MIT License](LICENSE) © 2026 1004aiteam-power
