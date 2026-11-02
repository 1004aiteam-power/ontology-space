# 전력망 온톨로지

## 1. 왜 전력망에 온톨로지가 필요한가?

전력망은 발전·송전·변전·배전·소비가 하나로 연결된 거대한 시스템이고, 이를 다루는 시스템도 여러 가지입니다.

- **EMS** (Energy Management System): 송전망 운영
- **DMS / ADMS**: 배전망 운영
- **SCADA**: 실시간 감시·제어
- **GIS**: 설비 위치·지리 정보
- **AMI / MDMS**: 스마트 계량
- **자산관리(EAM)**, 계통 해석 툴, 전력시장 시스템 등

시스템마다 데이터 모델이 다르면 같은 변압기 하나를 두고도 연계 작업이 끝없이 반복됩니다.
**전력망 온톨로지는 설비, 연결(토폴로지), 측정값, 운영 정보를 공통 의미 모델로 정의해서**
이 문제를 풉니다.

## 2. 주요 표준 및 온톨로지

### 2.1 IEC CIM (Common Information Model): 핵심

IEC TC57이 관리하는 전력 분야의 사실상 표준 정보 모델입니다. UML로 정의되고, RDF/XML로 데이터를 교환합니다.

| 표준 | 범위 |
|---|---|
| **IEC 61970** | 송전, EMS (Core, Wires, Topology, Measurement 등). 61970-301이 기본 CIM |
| **IEC 61968** | 배전 관리 (자산, 작업, 고객, 계량 등) |
| **IEC 62325** | 전력시장 |
| IEC 61970-552 | CIM 데이터의 RDF/XML 교환 형식 (CIMXML) |

### 2.2 CGMES (Common Grid Model Exchange Standard)

유럽 송전망 운영자 협의체 **ENTSO-E**가 CIM을 바탕으로 만든 계통 모델 교환 규격입니다.
TSO들은 이 규격으로 계통 모델을 주고받습니다. 데이터를 **프로파일**로 나눠 관리합니다.

| 프로파일 | 내용 |
|---|---|
| EQ (Equipment) | 설비와 연결 구조 |
| TP (Topology) | 개폐 상태를 반영한 토폴로지 |
| SSH (Steady State Hypothesis) | 해석 입력 조건 (부하, 발전, 탭 위치 등) |
| SV (State Variables) | 조류계산 결과 (전압, 위상, 조류) |
| DL / GL | 단선도 배치 / 지리 위치 |

### 2.3 그 밖의 관련 표준·온톨로지

| 이름 | 설명 |
|---|---|
| **IEC 61850** | 변전소 자동화 통신. SCL(System Configuration Language)로 변전소 구성을 기술. CIM과 연계(조화) 연구가 활발 |
| **SAREF4ENER** | ETSI SAREF의 에너지 확장. 수요반응, 가전·에너지 기기 연계 |
| **OEO (Open Energy Ontology)** | 에너지 시스템 모델링·연구 데이터를 위한 오픈 온톨로지 |
| **Brick / ASHRAE 223P** | 건물 설비 쪽에서 전력 소비 설비와 연계할 때 활용 |

## 3. CIM 핵심 개념 모델

### 3.1 클래스 계층 (일부)

```
IdentifiedObject                       (mRID, name을 가진 모든 객체의 최상위)
 └─ PowerSystemResource                (전력계통 자원)
     ├─ ConnectivityNodeContainer
     │   └─ EquipmentContainer
     │       ├─ Substation             (변전소)
     │       ├─ VoltageLevel           (전압계급, 예: 154kV 모선 영역)
     │       ├─ Bay                    (베이)
     │       └─ Line                   (선로 묶음)
     └─ Equipment                      (설비)
         └─ ConductingEquipment        (전류가 흐르는 설비, Terminal을 가짐)
             ├─ ACLineSegment          (교류 선로 구간)
             ├─ PowerTransformer       (변압기)
             ├─ Switch
             │   ├─ Breaker            (차단기)
             │   ├─ Disconnector       (단로기)
             │   └─ LoadBreakSwitch
             ├─ BusbarSection          (모선)
             ├─ EnergyConsumer         (부하)
             └─ RegulatingCondEq
                 └─ RotatingMachine
                     └─ SynchronousMachine (동기발전기)

Terminal            (설비의 접속 단자)
ConnectivityNode    (단자들이 만나는 전기적 접점)
TopologicalNode     (개폐 상태를 반영해 ConnectivityNode를 묶은 노드)
BaseVoltage         (기준 전압)
PowerTransformerEnd (변압기 권선 측)
Measurement / Analog / Discrete  (측정 포인트)
```

### 3.2 연결(토폴로지) 표현: 가장 중요한 패턴

CIM은 설비끼리 직접 연결하지 않습니다. **Terminal과 ConnectivityNode**를 거쳐 연결합니다.

```
[Breaker] ─ Terminal ─┐
                      ├─ ConnectivityNode ─┬─ Terminal ─ [BusbarSection]
[ACLineSegment] ─ Terminal ─┘              └─ Terminal ─ [PowerTransformer]
```

- `Terminal.ConductingEquipment` → 이 단자가 속한 설비
- `Terminal.ConnectivityNode` → 이 단자가 접속된 노드
- `Terminal.sequenceNumber` → 설비의 몇 번째 단자인지 (선로는 1, 2)

이 구조 덕분에 차단기가 열리고 닫힐 때 토폴로지를 다시 계산(Topology Processing)할 수 있고,
그래프 질의로 "이 차단기가 열리면 정전되는 부하는?" 같은 질문에 답할 수 있습니다.

### 3.3 컨테인먼트(포함) 관계

```
Substation ──contains──▶ VoltageLevel ──contains──▶ Bay ──contains──▶ Equipment
     │                         │
     └─ Region (지역)          └─ BaseVoltage (예: 154 kV)
```

- `Equipment.EquipmentContainer` → 설비가 속한 컨테이너
- `VoltageLevel.Substation`, `VoltageLevel.BaseVoltage`

### 3.4 측정값 연계

```
Measurement ──PowerSystemResource──▶ 설비
            ──Terminal──▶ 측정 위치(단자)
            measurementType = "ThreePhaseActivePower", unitSymbol = W, unitMultiplier = M
Analog ──AnalogValues──▶ AnalogValue (실제 값, SCADA 연계)
```

## 4. CIM 네이밍 규칙 (RDF로 쓸 때)

- 네임스페이스: CIM 버전마다 다름
  - CGMES 2.4.15: `http://iec.ch/TC57/2013/CIM-schema-cim16#`
  - CGMES 3.0 / CIM100: `http://iec.ch/TC57/CIM100#`
- 클래스: `cim:PowerTransformer`
- 속성: `클래스명.속성명` 형식. 예: `cim:IdentifiedObject.name`, `cim:Terminal.ConnectivityNode`
- 식별자: `mRID` (UUID 권장)

## 5. 활용 사례

| 분야 | 활용 |
|---|---|
| **계통 모델 교환** | TSO/DSO 간, 시스템 간 CGMES/CIMXML 교환 |
| **디지털 트윈** | 설비, 토폴로지, 실시간 측정, 자산 정보를 하나의 지식 그래프로 통합 |
| **정전 영향 분석** | 그래프 탐색으로 차단기 개방 시 영향받는 부하 산출 |
| **자산관리 / 예방정비** | 설비 이력, 고장, 점검 데이터를 연결해 위험도 분석 |
| **DER / 분산전원 관리** | 태양광, ESS, EV 충전기를 배전망 토폴로지에 연결해 호스팅 용량 분석 |
| **데이터 품질 검증** | SHACL로 "모든 ACLineSegment는 Terminal을 2개 가진다" 같은 규칙 검증 |
| **AI / LLM 연계** | 전력망 지식 그래프 기반 GraphRAG, 운영자 질의 응답 |

## 6. 국내 관점에서의 적용 포인트 (아이디어)

- 송전(154/345/765 kV)·배전(22.9 kV) 계통을 같은 CIM 모델 안에서 표현하기
- 기존 시스템(SCADA, GIS, 설비관리)의 코드 체계와 CIM `mRID` 사이 매핑 테이블 설계
- 재생에너지·ESS 확산에 대비한 DER 확장 모델 (IEC 61968 및 CIM DER 확장 참고)
- 온톨로지와 계통 해석 툴 연계 (예: CGMES ↔ OpenDSS, pandapower 변환)

## 7. 참고 자료

- IEC CIM 사용자 그룹 (CIMug): https://cimug.ucaiug.org/
- ENTSO-E CGMES: https://www.entsoe.eu/data/cim/cim-for-grid-models-exchange/
- CIMTool (CIM 프로파일 편집): https://cimtool.ucaiug.io/
- PowSyBl (CGMES 처리 오픈소스): https://www.powsybl.org/
- CIMpy (Python CGMES 라이브러리): https://github.com/sogno-platform/cimpy
- Open Energy Ontology: https://openenergyplatform.org/ontology/
- SAREF4ENER: https://saref.etsi.org/saref4ener/

예제는 [`../examples/power-grid-sample.ttl`](../examples/power-grid-sample.ttl)을 참고하세요.
