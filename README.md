# Ontology Space

온톨로지(Ontology)의 기본 개념과 **전력망 온톨로지**를 정리하는 저장소입니다.

## 구성

| 경로 | 내용 |
|---|---|
| `*.html` · [assets/](assets/) | GitHub Pages 웹사이트 (한·영 전환). 페이지별 스크립트와 데이터는 `assets/` 아래 |
| [docs/](docs/) | 글로 읽는 문서: [온톨로지 소개](docs/01-ontology-introduction.md) · [전력망 온톨로지](docs/02-power-grid-ontology.md) · [pycim 설계](docs/03-python-cim-design.md) · [Physical AI](docs/04-physical-ai.md) · [디지털 트윈](docs/05-digital-twin.md) |
| [pycim/](pycim/) | IEC CIM을 파이썬 클래스로 옮긴 패키지 (조류계산 · CGMES · RDF 내보내기) |
| [examples/](examples/) | 분야별 온톨로지와 데이터를 만드는 스크립트 · 원본 데이터 · 결과 파일(Turtle, Neo4j 스크립트) |
| [shapes/](shapes/) | 형상검증 규칙 (Neo4j Cypher)과 pycim 클래스 계층 |
| [tools/](tools/) | 사이트 관리 도구: 메뉴 · head 태그 · sitemap · 캐시 갱신(`build_nav.py`), 온톨로지 지도 데이터, Neo4j 없이 Cypher 실행 |
| [tests/](tests/) | 파이썬(pytest) · Node 테스트. push · pull request마다 GitHub Actions가 실행 ([.github/workflows/test.yml](.github/workflows/test.yml)) |

파일 · 폴더별 자세한 설명과 모든 실행 명령은 **[docs/repository-map.md](docs/repository-map.md)** 에 있습니다.

웹사이트: https://1004aiteam-power.github.io/ontology-space/

## 빠르게 써 보기

```bash
pip install -r requirements-dev.txt   # rdflib · pandapower · opendssdirect.py · pytest (Cypher 질의·검증에는 Node.js도 필요)
```

```bash
python examples/build_sample_grid.py   # pycim으로 예제 변전소 구성, 정전 분석, RDF 내보내기
```

```bash
node tools/cypher.mjs --ttl examples/power-grid-sample.ttl,shapes/cim-classes.ttl --checks shapes/cim-checks.cypher   # 형상검증 (Cypher)
```

```bash
python -m pytest tests               # 파이썬 테스트
```

```bash
for t in tests/*.test.mjs; do node "$t"; done   # Node 테스트 (시뮬레이션 · Cypher 엔진 · 온톨로지)
```

분야별 예제를 다시 만드는 명령은 [docs/repository-map.md](docs/repository-map.md#실행-명령-모음)에 있습니다.
[Protégé](https://protege.stanford.edu/)로 `.ttl` 파일을 열어 클래스 계층과 개체를 시각적으로 볼 수도 있습니다.

## 웹사이트를 고칠 때

```bash
python tools/build_nav.py   # 메뉴 · head 태그 · sitemap.xml · 스크립트 주소의 ?v= 를 다시 만듦
```

페이지나 `assets/`의 스크립트 · 스타일을 고친 뒤에는 위 명령을 실행하고 결과를 함께 커밋합니다. 실행하지 않으면 GitHub Actions 검사가 실패합니다.
메뉴 항목은 `tools/build_nav.py`의 `NAV`만 고치면 모든 페이지에 반영됩니다.

## 라이선스

© 2026 1004aiteam-power. 가져다 써도 좋지만, **아래 조건을 꼭 지켜 주세요.**

| 대상 | 라이선스 | 지켜야 할 것 |
|---|---|---|
| 코드 (`pycim/`, `tests/`, `examples/**/*.py`, `shapes/`, `assets/*.js·css`, `assets/physai/`, `assets/twin/`) | [AGPL-3.0](LICENSE-CODE) | 저작권·라이선스 표시 유지, 수정·포함한 프로그램은 **전체 소스를 같은 조건으로 공개** (웹 서비스로 제공해도 공개) |
| 문서·콘텐츠 (`docs/`, README, 웹페이지의 글·그림·디자인, 데이터 파일) | [CC BY-NC-SA 4.0](LICENSE-DOCS) | **출처 표시 필수**, 상업적 이용 금지, 수정한 결과물은 같은 조건으로만 공개 |
| 외부 구성요소 (N3.js, Cytoscape.js, cimpy 예제 데이터, Natural Earth) | 각 원래 라이선스 | [LICENSE](LICENSE) 참고 |

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
