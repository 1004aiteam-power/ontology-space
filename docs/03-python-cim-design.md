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
| **mRID 기본 제공** | 모든 객체에 UUID `mRID` 자동 부여 |
| **표준 라이브러리만 사용** | `dataclasses` 기반. RDF 직렬화도 의존성 없이 구현 (`rdflib`는 테스트에만 사용) |

## 2. 패키지 구조

```
pycim/
├── base.py      IdentifiedObject, @cim 데코레이터, CIM 이름 매핑 규칙
├── core.py      PowerSystemResource, 컨테이너(Substation, VoltageLevel…), Equipment,
│                ConductingEquipment, Terminal, ConnectivityNode, BaseVoltage
├── wires.py     ACLineSegment, Switch/Breaker/Disconnector, BusbarSection,
│                EnergyConsumer, ExternalNetworkInjection, PowerTransformer(+End)
├── topology.py  인접 설비, 가압 범위 탐색, 정전 영향 분석
├── rdf.py       Turtle 직렬화
├── model.py     객체 저장소 (타입별 조회)
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
pip install pandapower opendssdirect.py   # 변환기 사용 시
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

## 6. 로드맵

- [x] pandapower / OpenDSS 모델로 변환해 조류계산
- [ ] CGMES(RDF/XML) 파일 읽기 → 파이썬 객체 생성
- [ ] EQ / SSH / SV 프로파일 분리 직렬화 (계산 결과 → SV)
- [ ] Measurement / Analog 클래스와 SCADA 값 연계
- [ ] SHACL 규칙으로 모델 검증
- [ ] 배전(IEC 61968)·DER 클래스 확장, 불평형(상별) 모델
