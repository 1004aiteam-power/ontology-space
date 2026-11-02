# CIM을 파이썬 클래스로 설계하기 (`pycim`)

IEC CIM의 UML 모델을 **파이썬 클래스로 그대로 옮겨**,
전력망 데이터를 코드로 다루고, 분석하고, 온톨로지(RDF)로 내보내는 것을 목표로 하는 프로젝트입니다.

> 현재는 학습·프로토타입 단계입니다. CIM의 Core / Topology / Wires 패키지에서 핵심 클래스만 골라 구현했습니다.

## 1. 설계 원칙

| 원칙 | 구현 방법 |
|---|---|
| **CIM 상속 = 파이썬 상속** | `Breaker(ProtectedSwitch)`, `ProtectedSwitch(Switch)` … UML 계층을 그대로 옮김 |
| **파이썬다운 이름, CIM 이름 자동 변환** | 필드는 `snake_case`. 직렬화할 때 *선언한 클래스명.CIM이름*으로 변환 (`rated_s` → `PowerTransformerEnd.ratedS`) |
| **속성 vs 연관 구분** | 값은 camelCase(`normalOpen`), 다른 객체 참조는 PascalCase(`Equipment.EquipmentContainer`). CIM 규칙과 같음 |
| **역방향 연관 자동 관리** | `Terminal`을 만들면 `equipment.terminals`, `node.terminals`에 자동 등록. 역방향 필드는 직렬화하지 않음 |
| **안정적인 mRID** | 기본은 UUID v4. 기존 코드가 있으면 `stable_mrid()`(v5), Terminal·TransformerEnd는 부모에서 파생. 비UUID·중복은 `Model.add`에서 거부 |
| **표준 라이브러리만 사용** | `dataclasses` 기반. RDF 직렬화도 의존성 없이 구현 (`rdflib`는 테스트에만 사용) |

## 2. 패키지 구조

```
pycim/
├── base.py      IdentifiedObject, @cim 데코레이터, CIM 이름 매핑 규칙
├── ids.py       mRID 발급 (UUID v4 / v5 / 종속 객체 파생)
├── core.py      PowerSystemResource, 컨테이너(Substation, VoltageLevel…), Equipment,
│                ConductingEquipment, Terminal, ConnectivityNode, BaseVoltage
├── wires.py     ACLineSegment, Switch/Breaker/Disconnector, BusbarSection,
│                EnergyConsumer, ExternalNetworkInjection, PowerTransformer(+End)
├── topology.py  인접 설비, 가압 범위 탐색, 정전 영향 분석
├── rdf.py       Turtle 직렬화
├── model.py     객체 저장소 (타입별 조회)
├── naming.py    Name / NameType / NameTypeAuthority: 기존 시스템 코드 ↔ mRID 매핑
├── cgmes.py     CGMES(RDF/XML) 읽기
├── sv.py        SvVoltage / SvPowerFlow: 조류계산 결과 → SV 프로파일
├── samples.py   예제 계통 (154kV 선로 → 변전소 → 22.9kV 부하)
├── export_pandapower.py  pandapower 네트워크로 변환 + 조류계산
└── export_opendss.py     OpenDSS 스크립트로 변환 + 조류계산
```

## 3. 핵심 코드

### `@cim` 데코레이터

```python
def cim(cls):
    # kw_only: 상속이 깊어도 필드 순서 문제 없음
    # eq=False: 객체 동일성으로 비교 → set/dict 키로 사용 가능
    return dataclass(kw_only=True, eq=False, repr=False)(cls)
```

### 클래스 정의 예시

```python
@cim
class ConductingEquipment(Equipment):
    base_voltage: BaseVoltage | None = None
    terminals: list = inverse()          # 역방향 연관 (직렬화 제외)

@cim
class Switch(ConductingEquipment):
    normal_open: bool = False            # EQ 프로파일: 평상시 상태
    open: bool = False                   # SSH 프로파일: 현재 상태

@cim
class Breaker(ProtectedSwitch): ...
```

### CIM 이름 자동 변환

필드를 **처음 선언한 클래스**를 MRO에서 찾아 접두어로 씁니다.

```python
ACLineSegment(length=12.5)   →  cim:Conductor.length "12.5"
Breaker(open=True)           →  cim:Switch.open "true"
VoltageLevel(substation=ss)  →  cim:VoltageLevel.Substation ex:_<mRID>
```

### mRID 발급 (`ids.py`)

| 함수 | UUID | 용도 |
|---|---|---|
| `new_mrid()` | v4 | 기본값. 새 설비 등록 |
| `stable_mrid(*keys)` | v5 | 기존 설비코드에서 항상 같은 mRID |
| `child_mrid(parent, *keys)` | v5 | Terminal, TransformerEnd (자동 적용) |

```python
cb = Breaker(mrid=stable_mrid("SCADA", "A변전소", "CB-154-01"), name="154kV 선로 CB")
cb.connect(n1, n2)          # Terminal mRID = child_mrid(cb.mrid, "Terminal", 1), ...
to_turtle(m, iri_style="urn")   # <urn:uuid:...> 형식 IRI (기본은 CGMES 2.4.15식 ex:_uuid)
```

## 4. 사용 예

```python
from pycim import *

m = Model()
n1, n2 = m.add(ConnectivityNode(name="N1")), m.add(ConnectivityNode(name="N2"))
src = m.add(ExternalNetworkInjection(name="계통")).connect(n1)
cb  = m.add(Breaker(name="CB")).connect(n1, n2)          # Terminal 1, 2 자동 생성
ld  = m.add(EnergyConsumer(name="부하", p=8.5)).connect(n2)

cb.open = True
topology.deenergized_loads(m, [src])   # → [EnergyConsumer('부하')]
print(to_turtle(m))                    # CIM RDF(Turtle)로 내보내기
```

전체 예제: [`examples/build_sample_grid.py`](../examples/build_sample_grid.py)

```bash
python examples/build_sample_grid.py
```

```bash
pip install rdflib pyshacl pandapower opendssdirect.py   # CGMES·SHACL·변환기 사용 시
python -m pytest tests
```

## 5. 해석 도구 변환 (pandapower · OpenDSS)

| CIM (pycim) | pandapower | OpenDSS |
|---|---|---|
| ConnectivityNode | bus | bus (n1, n2, …) |
| ExternalNetworkInjection | ext_grid | Circuit (Vsource, `MVAsc3=1e6`로 이상 전원에 가깝게) |
| ACLineSegment | line | Line |
| Switch / Breaker | switch (bus-bus) | Line `switch=yes` (+ `Open`) |
| PowerTransformer + End ×2 | trafo (vk%, vkr%) | Transformer (XHL, %Rs) |
| EnergyConsumer | load | Load (model=1) |
| RotatingMachine | sgen | Generator |

노드 공칭전압은 `topology.nominal_voltages()`가 VoltageLevel → 설비 BaseVoltage → 변압기 권선단 정격전압 순서로 찾고, 없으면 이웃 노드에서 전파합니다.

```python
from pycim import export_pandapower, export_opendss
from pycim.samples import sample_grid

m = sample_grid()
net, bus_map = export_pandapower.to_pandapower(m)   # pandapower net
script, names = export_opendss.to_opendss(m)        # .dss 문자열
export_pandapower.solve(m)                          # {노드: 전압 pu}
```

`python examples/compare_solvers.py` 결과 (두 도구가 소수 넷째 자리까지 일치):

| 노드 | kV | 평상시 pandapower | 평상시 OpenDSS | 154kV CB 개방 |
|---|---|---|---|---|
| B변전소 측 노드 | 154 | 1.0000 | 1.0000 | 1.0000 |
| 선로-CB 접점 | 154 | 0.9992 | 0.9992 | 1.0000 |
| 154kV 모선 노드 | 154 | 0.9992 | 0.9992 | 정전 |
| 22.9kV 모선 노드 | 22.9 | 0.9945 | 0.9945 | 정전 |
| D/L #1 인출 노드 | 22.9 | 0.9945 | 0.9945 | 정전 |

## 6. 매핑 테이블 (Name / NameType)

mRID는 바뀌지 않는 기준 키이고, 기존 시스템의 코드는 CIM `Name`으로 붙입니다.

```
Breaker (mRID) ◀─ Name "A154_CB01" ─▶ NameType "포인트 ID" ─▶ NameTypeAuthority "SCADA"
```

```python
from pycim import naming
scada = naming.name_type(m, "SCADA", "포인트 ID")
naming.add_name(cb, "A154_CB01", scada)
naming.find(m, "A154_CB01", scada)            # → Breaker
naming.write_csv(naming.mapping_table(m, m.of_type(naming.NameType)), "mapping_table.csv")
```

결과: [`examples/mapping_table.csv`](../examples/mapping_table.csv)

## 7. CGMES 읽기 (`cgmes.py`)

`read_cgmes(paths, source=...)` 가 RDF/XML 파일들을 rdflib로 읽어 pycim 객체를 만듭니다.

- CIM16(2012·2013)과 CIM100 네임스페이스 인식
- pycim에 없는 클래스(Diagram, OperationalLimit 등)는 건너뛰고 `import_report`에 기록
- 속성 이름은 pycim 이름 변환 규칙을 거꾸로 적용해 찾음 (`Conductor.length` → `length`)
- UUID가 아닌 rdf:ID(예: NEPLAN의 `Load7-I`)는 UUID v5 mRID를 새로 발급하고, 원본 ID를 `Name`(NameType "rdf:ID")으로 보존
- 버스-브랜치 모델: TopologicalNode마다 ConnectivityNode 생성
- SSH가 없으면 SV의 `SvPowerFlow` 값을 부하 입력으로 사용

**CIGRE MV 검증** (`python examples/import_cgmes.py`): NEPLAN이 파일에 저장한 조류계산 결과(SV)와
pycim → pandapower 결과를 15개 노드에서 비교한 결과, **최대 차이 0.00004 pu**.
남은 차이는 변압기 여자 성분(b, g)을 무시해서 생깁니다.

## 8. 토폴로지 처리와 SV 프로파일 (`topology.process`, `sv.py`)

```
CIM (EQ, SSH) ─ topology.process() ─▶ TopologicalNode (TP)
              ─ pandapower 조류계산 ─▶ SvVoltage / SvPowerFlow (SV) ─ to_turtle() ─▶ RDF
```

- `topology.process(m)`: 닫힌 개폐기로 이어진 ConnectivityNode를 하나의 TopologicalNode로 묶음 (union-find)
- `sv.from_pandapower(m)`: SvVoltage(kV, deg), SvPowerFlow(설비로 들어가는 방향이 +)
- TopologicalNode와 SV 객체의 mRID도 부모에서 파생(v5) → 다시 계산해도 같은 ID

## 9. SHACL 검증

`shapes/cim-shapes.ttl`에 8종의 규칙(mRID 형식, 단자 수, Terminal 소속, 선로 파라미터, 개폐기 상태,
전압 체계, 변압기 권선단, Name)을 정의했습니다. 클래스 계층은 `pycim.rdf.class_hierarchy_turtle()`이
자동 생성한 `shapes/cim-classes.ttl`을 씁니다.

```bash
python examples/validate.py
```

| 데이터 | 결과 |
|---|---|
| power-grid-sample.ttl (손으로 작성) | 통과 |
| pycim sample_grid() | 통과 |
| CIGRE MV (CGMES → pycim) | 통과 |
| broken-sample.ttl (일부러 규칙 위반) | 위반 8건 |

## 10. 로드맵

- [x] pandapower / OpenDSS 모델로 변환해 조류계산
- [x] mRID 발급 규칙 (UUID v4 / v5, 종속 객체 파생, 중복 검사)
- [x] 기존 설비코드 ↔ mRID 매핑 테이블 (CIM Name / NameType)
- [x] CGMES(RDF/XML) 파일 읽기 → 파이썬 객체 생성
- [x] 토폴로지 처리(TP), 계산 결과 → SV 프로파일
- [x] SHACL 규칙으로 모델 검증
- [ ] CGMES RDF/XML로 내보내기 (프로파일별 파일 분리)
- [ ] Measurement / Analog 클래스와 SCADA 값 연계
- [ ] 변압기 탭(RatioTapChanger), 여자 성분 반영
- [ ] 배전(IEC 61968)·DER 클래스 확장, 불평형(상별) 모델
