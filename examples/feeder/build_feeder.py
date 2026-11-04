# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""A변전소 D/L #1 배전선로 상세 모델 (⚠ 가상 데이터).

전력망 페이지의 예제 변전소에서 'D/L #1 부하 8.5MW' 하나로 줄여 그렸던 배전선로를 펼친다.

  22.9kV 모선 ─ D/L #1 CB ─ 간선 ─ S1 ─ S2 ─ S3 ─ S4 ─ S5 ─ S6 ─ 끝 ─ T4 ─ C변전소 D/L #11
                                 └ 분기점 BP1 ─ 분기선 ─ T1 ─ D/L #2
                                           └ 분기점 BP2 ─ 분기선 ─ T2 ─ D/L #3
                                                        └ 분기점 BP3 ─ 분기선 ─ T3 ─ D/L #2

  구간 개폐기 S1~S6 : cim:LoadBreakSwitch, normalOpen = false (평상시 닫힘)
  연계 개폐기 T1~T4 : cim:LoadBreakSwitch, normalOpen = true  (평상시 열림, 이웃 선로와 연결)
  부하 10곳        : cim:EnergyConsumer, 합계 8.5MW (전력망 예제의 D/L #1 부하와 같은 크기)

생성: examples/feeder/feeder.ttl   (pycim → CIM RDF)
      assets/data/feeder.json      (전력망 페이지의 인터랙티브 배전선로 그림)
실행: python examples/feeder/build_feeder.py   (저장소 루트에서)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pycim import to_turtle, topology  # noqa: E402
from pycim.core import BaseVoltage, ConductingEquipment, ConnectivityNode, Line, Substation, VoltageLevel  # noqa: E402
from pycim.ids import stable_mrid  # noqa: E402
from pycim.model import Model  # noqa: E402
from pycim.wires import (ACLineSegment, Breaker, BusbarSection, EnergyConsumer,  # noqa: E402
                         ExternalNetworkInjection, LoadBreakSwitch)

FEEDER_LIMIT_MW = 10.0          # 선로당 상시 운전 한도 (가상)
R_PER_KM, X_PER_KM = 0.182, 0.391   # ACSR 160mm² 급 대표값 (가상, 단위 Ω/km)
PX_PER_KM = 60                  # 그림 좌표 60px = 1km 로 길이를 정한다


def _id(key: str) -> str:
    return stable_mrid("sample-feeder", key)


m = Model()
bv = m.add(BaseVoltage(mrid=_id("BV-22.9"), name="22.9kV", nominal_voltage=22.9))
ss_a = m.add(Substation(mrid=_id("SS-A"), name="A변전소"))
vl_a = m.add(VoltageLevel(mrid=_id("SS-A/VL-22.9"), name="A변전소 22.9kV", substation=ss_a, base_voltage=bv))
ss_c = m.add(Substation(mrid=_id("SS-C"), name="C변전소"))
vl_c = m.add(VoltageLevel(mrid=_id("SS-C/VL-22.9"), name="C변전소 22.9kV", substation=ss_c, base_voltage=bv))

POS: dict[str, tuple[float, float]] = {}          # 접속 노드(ConnectivityNode) 그림 좌표
CN: dict[str, ConnectivityNode] = {}
EQ: list[dict] = []                               # 웹 그림용 설비 목록
LINES = {k: m.add(Line(mrid=_id(f"LINE-{k}"), name=n)) for k, n in
         (("DL1", "D/L #1"), ("DL2", "D/L #2"), ("DL3", "D/L #3"), ("C11", "C변전소 D/L #11"))}


def node(key: str, x: float, y: float, container=None) -> ConnectivityNode:
    CN[key] = m.add(ConnectivityNode(mrid=_id(f"CN-{key}"), name=key, connectivity_node_container=container))
    POS[key] = (x, y)
    return CN[key]


def seg(key: str, a: str, b: str, line: str, ko: str, en: str) -> None:
    (x1, y1), (x2, y2) = POS[a], POS[b]
    km = round(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 / PX_PER_KM, 2)
    m.add(ACLineSegment(mrid=_id(key), name=ko, equipment_container=LINES[line], base_voltage=bv,
                        length=km, r=round(km * R_PER_KM, 4), x=round(km * X_PER_KM, 4))).connect(CN[a], CN[b])
    EQ.append(dict(id=key, cls="ACLineSegment", t=[a, b], ko=ko, en=en, km=km, line=line))


def switch(key: str, a: str, b: str, cls, normal_open: bool, kind: str, ko: str, en: str, container=None) -> None:
    sw = m.add(cls(mrid=_id(key), name=ko, normal_open=normal_open, open=normal_open,
                   equipment_container=container)).connect(CN[a], CN[b])
    EQ.append(dict(id=key, cls=type(sw).__name__, t=[a, b], ko=ko, en=en, normalOpen=normal_open, kind=kind))


def load(key: str, at: str, p: float, ko: str, en: str, dx: float = 0, dy: float = 22) -> None:
    m.add(EnergyConsumer(mrid=_id(key), name=ko, p=p, q=round(p * 0.25, 3))).connect(CN[at])
    x, y = POS[at]
    EQ.append(dict(id=key, cls="EnergyConsumer", t=[at], ko=ko, en=en, p=p, at=[x + dx, y + dy]))


# ---- 변전소 모선과 전원 ---------------------------------------------------------------
node("BUS_A", 40, 270, vl_a)
m.add(BusbarSection(mrid=_id("BUS-A-22.9"), name="A변전소 22.9kV 모선", equipment_container=vl_a)).connect(CN["BUS_A"])
m.add(ExternalNetworkInjection(mrid=_id("ENI-A"), name="A변전소 M.Tr #1 (상위 계통 등가)")).connect(CN["BUS_A"])
EQ.append(dict(id="SRC_A", cls="ExternalNetworkInjection", t=["BUS_A"], ko="A변전소 22.9kV 모선", en="Substation A 22.9 kV bus", source=True))
node("BUS_C", 975, 270, vl_c)
m.add(ExternalNetworkInjection(mrid=_id("ENI-C"), name="C변전소 22.9kV 모선 (등가)")).connect(CN["BUS_C"])
EQ.append(dict(id="SRC_C", cls="ExternalNetworkInjection", t=["BUS_C"], ko="C변전소 22.9kV 모선", en="Substation C 22.9 kV bus", source=True))

# ---- 인출 차단기 (선로 시작) --------------------------------------------------------
FEEDERS = {"DL1": ("CB_DL1", "D/L #1"), "DL2": ("CB_DL2", "D/L #2"), "DL3": ("CB_DL3", "D/L #3"), "C11": ("CB_C11", "C변전소 D/L #11")}
# 그림에서는 모선을 위아래로 길게 그리지만, 모델에서는 하나의 접속 노드(BUS_A)다
POS["BUS_A3"], POS["BUS_A2"] = (40, 90), (40, 450)
CN["BUS_A3"] = CN["BUS_A2"] = CN["BUS_A"]
POS_ALIAS = {"BUS_A3": "BUS_A", "BUS_A2": "BUS_A"}
node("DL1_0", 100, 270); node("DL2_0", 100, 450); node("DL3_0", 100, 90)
node("C11_0", 935, 270)
switch("CB_DL1", "BUS_A", "DL1_0", Breaker, False, "breaker", "D/L #1 CB", "Feeder #1 CB", vl_a)
switch("CB_DL2", "BUS_A2", "DL2_0", Breaker, False, "breaker", "D/L #2 CB", "Feeder #2 CB", vl_a)
switch("CB_DL3", "BUS_A3", "DL3_0", Breaker, False, "breaker", "D/L #3 CB", "Feeder #3 CB", vl_a)
switch("CB_C11", "BUS_C", "C11_0", Breaker, False, "breaker", "C변전소 D/L #11 CB", "Sub. C feeder #11 CB", vl_c)

# ---- D/L #1 간선: 구간 개폐기 6대를 120px(2km) 간격으로 ----------------------------------
xs = [160 + 120 * i for i in range(6)]                             # S1..S6 위치
BRANCH_AFTER = {1: ("BP1", "down"), 3: ("BP2", "up"), 5: ("BP3", "down")}
MAIN_P = [1.0, 0.8, 0.9, 0.7, 0.8, 0.6]
prev = "DL1_0"
for i, x in enumerate(xs, 1):
    a, b = f"S{i}a", f"S{i}b"
    node(a, x - 12, 270); node(b, x + 12, 270)
    seg(f"DL1_SEC{i}", prev, a, "DL1", f"D/L #1 간선 {i}구간", f"Feeder #1 main, section {i}")
    switch(f"S{i}", a, b, LoadBreakSwitch, False, "sectionalizer", f"구간 개폐기 S{i}", f"Sectionalizing switch S{i}")
    node(f"L{i}", x + 45, 270)
    seg(f"DL1_SEC{i}_L", b, f"L{i}", "DL1", f"D/L #1 간선 {i+1}구간 (S{i} 뒤)", f"Feeder #1 main after S{i}")
    load(f"LD_M{i}", f"L{i}", MAIN_P[i - 1], f"간선 부하 {i}", f"Main-line load {i}", dy=-24 if i in BRANCH_AFTER and BRANCH_AFTER[i][1] == "down" else 24)
    prev = f"L{i}"
    if i in BRANCH_AFTER:
        bp, _ = BRANCH_AFTER[i]
        node(bp, x + 85, 270)
        seg(f"DL1_SEC{i}_{bp}", prev, bp, "DL1", f"D/L #1 간선 {i+1}구간 (분기점 {bp}까지)", f"Feeder #1 main to {bp}")
        prev = bp
node("MEND", 850, 270)
seg("DL1_SEC7_END", prev, "MEND", "DL1", "D/L #1 간선 끝 구간", "Feeder #1 main, last stretch")

# ---- 분기선 3개 (분기점 → 연계 개폐기) -----------------------------------------------------
# BP1(아래) 부하 2곳 → T1 → D/L #2 / BP2(위) 부하 1곳 → T2 → D/L #3 / BP3(아래) 부하 1곳 → T3 → D/L #2
bx = {bp: POS[bp][0] for bp in ("BP1", "BP2", "BP3")}
node("B1_1", bx["BP1"], 330); node("B1_2", bx["BP1"], 380); node("T1a", bx["BP1"], 412); node("T1b", bx["BP1"], 436)
seg("BR1_1", "BP1", "B1_1", "DL1", "분기선 1 (BP1)", "Lateral 1 (BP1)"); seg("BR1_2", "B1_1", "B1_2", "DL1", "분기선 1 (BP1)", "Lateral 1 (BP1)")
seg("BR1_3", "B1_2", "T1a", "DL1", "분기선 1 끝", "Lateral 1 end")
load("LD_B1a", "B1_1", 1.0, "분기선 1 부하 a", "Lateral 1 load a", dx=26, dy=4); load("LD_B1b", "B1_2", 0.9, "분기선 1 부하 b", "Lateral 1 load b", dx=26, dy=4)
node("B2_1", bx["BP2"], 215); node("T2a", bx["BP2"], 130); node("T2b", bx["BP2"], 106)
seg("BR2_1", "BP2", "B2_1", "DL1", "분기선 2 (BP2)", "Lateral 2 (BP2)"); seg("BR2_2", "B2_1", "T2a", "DL1", "분기선 2 끝", "Lateral 2 end")
load("LD_B2", "B2_1", 0.9, "분기선 2 부하", "Lateral 2 load", dx=26, dy=4)
node("B3_1", bx["BP3"], 340); node("T3a", bx["BP3"], 412); node("T3b", bx["BP3"], 436)
seg("BR3_1", "BP3", "B3_1", "DL1", "분기선 3 (BP3)", "Lateral 3 (BP3)"); seg("BR3_2", "B3_1", "T3a", "DL1", "분기선 3 끝", "Lateral 3 end")
load("LD_B3", "B3_1", 0.9, "분기선 3 부하", "Lateral 3 load", dx=26, dy=4)

# ---- 이웃 선로 (부하를 한 곳에 모아 단순화) -----------------------------------------------
node("DL2_A", bx["BP1"], 450); node("DL2_B", bx["BP3"], 450); node("DL2_E", 820, 450)
seg("DL2_1", "DL2_0", "DL2_A", "DL2", "D/L #2 선로", "Feeder #2"); seg("DL2_2", "DL2_A", "DL2_B", "DL2", "D/L #2 선로", "Feeder #2")
seg("DL2_3", "DL2_B", "DL2_E", "DL2", "D/L #2 선로 끝", "Feeder #2 end")
load("LD_DL2", "DL2_E", 6.0, "D/L #2 부하 (모음)", "Feeder #2 load (lumped)", dx=22, dy=0)
node("DL3_A", bx["BP2"], 90); node("DL3_E", 640, 90)
seg("DL3_1", "DL3_0", "DL3_A", "DL3", "D/L #3 선로", "Feeder #3"); seg("DL3_2", "DL3_A", "DL3_E", "DL3", "D/L #3 선로 끝", "Feeder #3 end")
load("LD_DL3", "DL3_E", 5.0, "D/L #3 부하 (모음)", "Feeder #3 load (lumped)", dx=22, dy=0)
node("C11_A", 905, 270); node("C11_E", 905, 380)
seg("C11_1", "C11_0", "C11_A", "C11", "C변전소 D/L #11 선로", "Sub. C feeder #11"); seg("C11_2", "C11_A", "C11_E", "C11", "C변전소 D/L #11 선로", "Sub. C feeder #11")
load("LD_C11", "C11_E", 4.0, "C변전소 D/L #11 부하 (모음)", "Sub. C feeder #11 load (lumped)", dx=0, dy=22)

# ---- 부하가 있는 지역과 고객 수 (가상) --------------------------------------------------------
# 고장 복구·영향 분석에서 "몇 집이 정전인가"를 세기 위한 값. 지명은 지어낸 것이다.
AREA = {  # 부하 id: (고객 호수, 지역 ko, 지역 en, 중요 고객 여부)
    "LD_M1": (420, "가람동 주택가", "Garam-dong homes", False),
    "LD_M2": (180, "나래동 상가", "Narae-dong shops", False),
    "LD_M3": (510, "다솜 아파트", "Dasom apartments", False),
    "LD_M4": (260, "라온동 주택·초등학교", "Raon-dong homes & school", False),
    "LD_M5": (150, "마루 전통시장", "Maru market", False),
    "LD_M6": (230, "바다마을", "Bada village", False),
    "LD_B1a": (12, "사랑 산업단지 1", "Sarang industrial park 1", False),
    "LD_B1b": (9, "사랑 산업단지 2", "Sarang industrial park 2", False),
    "LD_B2": (3, "아라 병원", "Ara hospital", True),
    "LD_B3": (140, "자람 농공단지", "Jaram agro-industrial park", False),
    "LD_DL2": (2100, "D/L #2 공급 지역", "Feeder #2 area", False),
    "LD_DL3": (1800, "D/L #3 공급 지역", "Feeder #3 area", False),
    "LD_C11": (1500, "C변전소 D/L #11 공급 지역", "Sub. C #11 area", False),
}
for _e in EQ:
    if _e["id"] in AREA:
        _c, _ko, _en, _crit = AREA[_e["id"]]
        _e.update(cust=_c, area=_ko, areaEn=_en, critical=_crit)

# ---- 연계 개폐기 4대 (평상시 열림) ----------------------------------------------------
switch("T1", "T1a", "T1b", LoadBreakSwitch, True, "tie", "연계 개폐기 T1 (D/L #2)", "Tie switch T1 (to feeder #2)")
switch("T2", "T2a", "T2b", LoadBreakSwitch, True, "tie", "연계 개폐기 T2 (D/L #3)", "Tie switch T2 (to feeder #3)")
switch("T3", "T3a", "T3b", LoadBreakSwitch, True, "tie", "연계 개폐기 T3 (D/L #2)", "Tie switch T3 (to feeder #2)")
node("T4a", 868, 270); node("T4b", 890, 270)
seg("DL1_END_T4", "MEND", "T4a", "DL1", "D/L #1 끝 → T4", "Feeder #1 end to T4")
switch("T4", "T4a", "T4b", LoadBreakSwitch, True, "tie", "연계 개폐기 T4 (C변전소)", "Tie switch T4 (to Sub. C)")
seg("C11_T4", "T4b", "C11_A", "C11", "C변전소 D/L #11 연계 구간", "Sub. C feeder #11 tie stretch")
seg("T1_DL2", "T1b", "DL2_A", "DL2", "T1 ↔ D/L #2", "T1 to feeder #2")
seg("T2_DL3", "T2b", "DL3_A", "DL3", "T2 ↔ D/L #3", "T2 to feeder #3")
seg("T3_DL2", "T3b", "DL2_B", "DL2", "T3 ↔ D/L #2", "T3 to feeder #2")


# ---- 검증: pycim 토폴로지로 평상시·고장 시나리오 확인 ------------------------------------------
def state(open_ids: set[str], close_ids: set[str] = frozenset()) -> dict:
    """개폐 상태를 바꾼 뒤 정전 부하와 루프 여부를 pycim으로 계산한다."""
    sws = {o.name: o for o in m if hasattr(o, "normal_open")}
    by_key = {e["id"]: sws[e["ko"]] for e in EQ if e.get("kind")}
    for k, sw in by_key.items():
        sw.open = (sw.normal_open or k in open_ids) and k not in close_ids
    src = [o for o in m if isinstance(o, ExternalNetworkInjection)]
    dead = topology.deenergized_loads(m, src)
    # 루프: 닫힌 2단자 설비를 간선으로 보고 접속 노드를 합칠 때 이미 같은 묶음이면 고리가 생긴 것
    parent: dict = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    loop = False
    seen = set()
    for o in m:
        if id(o) in seen:
            continue
        seen.add(id(o))
        ts = o.terminals if isinstance(o, ConductingEquipment) else []
        if len(ts) == 2 and not getattr(o, "open", False) and all(t.connectivity_node for t in ts):
            a, b = find(ts[0].connectivity_node.mrid), find(ts[1].connectivity_node.mrid)
            if a == b:
                loop = True
            parent[a] = b
    # 두 전원(A, C)을 같은 묶음으로 보지 않도록 A·C 모선이 이어지면 루프로 본다
    if find(CN["BUS_A"].mrid) == find(CN["BUS_C"].mrid):
        loop = True
    for sw in by_key.values():
        sw.open = sw.normal_open
    return dict(dead=sorted(x.name for x in dead), dead_mw=round(sum(x.p for x in dead), 2), loop=loop)


SCENARIOS = [
    dict(id="normal", ko="평상시", en="Normal", open=[], close=[]),
    dict(id="fault3", ko="3~4구간 사이 고장: S3·S4 열고 T4로 복구", en="Fault between S3 and S4: open S3·S4, restore via T4",
         open=["S3", "S4"], close=["T4"], fault="DL1_SEC3_BP2"),
    dict(id="cbtrip", ko="D/L #1 CB 트립 → T1으로 전체 절체 (과부하)", en="Feeder #1 CB trips → all to feeder #2 via T1 (overload)",
         open=["CB_DL1"], close=["T1"]),
    dict(id="split", ko="D/L #1 CB 트립 → S2에서 나눠 T1·T4로 절체", en="Feeder #1 CB trips → split at S2, transfer via T1 and T4",
         open=["CB_DL1", "S2"], close=["T1", "T4"]),
    dict(id="loop", ko="평상시에 T4를 닫으면? (루프 운전)", en="Close T4 in normal state? (loop)", open=[], close=["T4"]),
]
AT: dict[str, list] = {}                          # 접속 노드 → 닿아 있는 설비
for _e in EQ:
    for _t in _e["t"]:
        AT.setdefault(POS_ALIAS.get(_t, _t), []).append(_e)


def feeder_mw(open_ids: set[str], close_ids: set[str], fault: str | None = None) -> dict[str, float]:
    """웹 그림과 같은 규칙으로 선로별 공급 부하(MW)를 센다: 인출 CB에서 닫힌 설비를 따라가되 다른 CB·전원·고장 구간은 건너지 않는다."""
    is_open = {e["id"]: (e["normalOpen"] or e["id"] in open_ids) and e["id"] not in close_ids for e in EQ if e.get("kind")}
    reach = trace(is_open, fault)
    mw = {k: 0.0 for k in FEEDERS}
    for e in EQ:
        if e["cls"] == "EnergyConsumer" and reach.get(e["id"]):
            for f in reach[e["id"]]:
                mw[f] += e["p"] / len(reach[e["id"]])
    return {k: round(v, 2) for k, v in mw.items()}


def trace(is_open: dict[str, bool], fault: str | None = None) -> dict[str, set]:
    """설비 id → 그 설비까지 닿는 선로(인출 CB) 집합. feeder.js · flisr.js 의 trace() 와 같은 규칙."""
    at = AT
    reach: dict[str, set] = {}
    for fid, (cb, _) in FEEDERS.items():
        if is_open[cb]:
            continue
        cbe = next(e for e in EQ if e["id"] == cb)
        seen, stack = set(), [POS_ALIAS.get(cbe["t"][1], cbe["t"][1])]
        while stack:
            n = stack.pop()
            if n in seen:
                continue
            seen.add(n)
            for e in at.get(n, []):
                if e["id"] == cb or e.get("source") or e["cls"] == "Breaker" or e["id"] == fault:
                    continue
                reach.setdefault(e["id"], set()).add(fid)
                if e.get("kind") and is_open[e["id"]]:
                    continue
                stack += [POS_ALIAS.get(t, t) for t in e["t"]]
    return reach


for sc in SCENARIOS:
    sc["check"] = state(set(sc["open"]), set(sc["close"]))
    sc["check"]["feederMW"] = feeder_mw(set(sc["open"]), set(sc["close"]), sc.get("fault"))
    sc["check"]["overload"] = sorted(k for k, v in sc["check"]["feederMW"].items() if v > FEEDER_LIMIT_MW)

# ---- 고장 복구 (FLISR: Fault Location, Isolation and Service Restoration) --------------------------
# D/L #1 의 어느 구간에 고장이 나도 같은 규칙으로 복구 순서를 만든다. 웹(flisr.js)은 이 결과를 재생만 한다.
#   1 트립   : D/L #1 CB 가 고장 전류를 끊는다 → D/L #1 전체 정전
#   2 분리   : 고장 구간을 둘러싼 닫힌 개폐기를 연다 (고장 구간 = 개폐기를 건너지 않고 이어진 설비 묶음)
#   3 상위 복구: CB 를 다시 닫아 고장 구간 앞쪽(전원 쪽)을 살린다
#   4 하위 절체: 고장 구간 뒤쪽을 연계 개폐기로 이웃 선로에 넘긴다. 한도(10MW)를 넘지 않고 루프가 없는
#                조합 중 살리는 고객이 가장 많고, 조작이 가장 적고, 여유가 가장 큰 것을 고른다 (구간 개폐기 최대 2대를 더 열어 나눌 수 있다)
#   5 수리 완료: 고장 구간을 고친 뒤 평상시 상태로 되돌린다
SW = {e["id"]: e for e in EQ if e.get("kind")}
LOADS = [e for e in EQ if e["cls"] == "EnergyConsumer"]
DL1_SEGS = [e["id"] for e in EQ if e["cls"] == "ACLineSegment" and e["line"] == "DL1"]
# 단계별 경과 시간(분, 가상): 배전자동화(원격 개폐기·고장 표시기) vs 현장 출동 수동 조작
FLISR_TIMES = {"auto": {"trip": 0, "isolate": 1, "upstream": 2, "transfer": 3, "repair": 240},
               "manual": {"trip": 0, "isolate": 50, "upstream": 55, "transfer": 75, "repair": 240}}


def fault_zone(seg_id: str) -> tuple[set[str], set[str]]:
    """고장 구간: 고장 난 선로에서 개폐기를 건너지 않고 이어진 선로·부하 묶음과 그 경계 개폐기."""
    seg = next(e for e in EQ if e["id"] == seg_id)
    zone, bnd, seen = {seg_id}, set(), set()
    stack = [POS_ALIAS.get(t, t) for t in seg["t"]]
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        for e in AT.get(n, []):
            if e.get("kind"):
                bnd.add(e["id"])
            elif e["cls"] in ("ACLineSegment", "EnergyConsumer") and e["id"] not in zone:
                zone.add(e["id"])
                stack += [POS_ALIAS.get(t, t) for t in e["t"]]
    return zone, bnd


def evaluate(is_open: dict[str, bool], fault: str | None) -> dict:
    reach = trace(is_open, fault)
    mw = {k: 0.0 for k in FEEDERS}
    dead, loop = [], False
    for e in LOADS:
        s = reach.get(e["id"], set())
        if not s:
            dead.append(e["id"])
        for f in s:
            mw[f] += e["p"] / len(s)
    for k, s in reach.items():
        if len(s) > 1 and not (k in SW and is_open[k]):    # 열린 개폐기는 양쪽에서 닿아도 루프가 아니다
            loop = True
    return dict(open=sorted(k for k, v in is_open.items() if v), dead=dead,
                deadCust=sum(next(x for x in LOADS if x["id"] == d)["cust"] for d in dead),
                deadMW=round(sum(next(x for x in LOADS if x["id"] == d)["p"] for d in dead), 2),
                feederMW={k: round(v, 2) for k, v in mw.items()}, loop=loop,
                overload=sorted(k for k, v in mw.items() if v > FEEDER_LIMIT_MW + 1e-9))


def best_transfer(st: dict[str, bool], fault: str | None = None, keep_open=frozenset()) -> list[tuple[str, bool]]:
    """정전 구역을 이웃 선로로 넘기는 조작: 정전 구역 안의 닫힌 구간 개폐기(나눌 곳, 최대 2대)와
    keep_open 에 없는 열린 연계 개폐기(받을 곳)를 조합해, 루프·과부하 없이 살리는 고객이 가장 많고
    조작이 가장 적고 여유가 가장 큰 것을 고른다. 설비 고장 영향 분석(examples/impact)도 이 함수를 쓴다."""
    from itertools import combinations
    reach = trace(st, fault)
    split_c = [k for k, e in SW.items() if e["kind"] == "sectionalizer" and not st[k] and k not in keep_open and not reach.get(k)]
    tie_c = [k for k, e in SW.items() if e["kind"] == "tie" and st[k] and k not in keep_open]
    best, best_key = [], None
    for n in range(3):
        for opens in combinations(split_c, n):
            for r in range(1, len(tie_c) + 1):
                for ties in combinations(tie_c, r):
                    trial = dict(st, **{k: True for k in opens}, **{k: False for k in ties})
                    ev = evaluate(trial, fault)
                    if ev["loop"] or ev["overload"]:
                        continue
                    margin = min(FEEDER_LIMIT_MW - v for v in ev["feederMW"].values())
                    key = (-ev["deadCust"], -(len(opens) + len(ties)), round(margin, 3))
                    if best_key is None or key > best_key:
                        best_key, best = key, [(k, True) for k in opens] + [(k, False) for k in ties]
    return best


def flisr_plan(seg_id: str) -> dict:
    st = {k: e["normalOpen"] for k, e in SW.items()}
    zone, bnd = fault_zone(seg_id)
    steps = []

    def step(sid, ops):
        for k, v in ops:
            st[k] = v
        steps.append(dict(id=sid, ops=[[k, v] for k, v in ops], **evaluate(st, seg_id)))
    step("trip", [("CB_DL1", True)])
    step("isolate", [(k, True) for k in sorted(bnd) if not st[k]])
    if "CB_DL1" not in bnd:
        step("upstream", [("CB_DL1", False)])
    best = best_transfer(st, seg_id, bnd)
    before = steps[-1]["deadCust"]
    if best and evaluate(dict(st, **dict(best)), seg_id)["deadCust"] < before:
        step("transfer", best)
    # 수리 완료: 평상시로 (절체에 쓴 연계 개폐기를 먼저 열고, 분리했던 개폐기를 닫는다)
    back = [(k, True) for k, v in st.items() if v != SW[k]["normalOpen"] and SW[k]["normalOpen"]] + \
           [(k, False) for k, v in st.items() if v != SW[k]["normalOpen"] and not SW[k]["normalOpen"]]
    for k, v in back:
        st[k] = v
    steps.append(dict(id="repair", ops=[[k, v] for k, v in back], **evaluate(st, None)))
    return dict(zone=sorted(zone), boundary=sorted(bnd), steps=steps)


def cmi(plan: dict, mode: str) -> int:
    """고객 정전 시간(Customer Minutes Interrupted): 단계 사이마다 정전 고객 수 × 지속 시간(분)."""
    t = FLISR_TIMES[mode]
    ss = plan["steps"]
    return sum(a["deadCust"] * (t[b["id"]] - t[a["id"]]) for a, b in zip(ss, ss[1:]))


FLISR = {sid: flisr_plan(sid) for sid in DL1_SEGS}
for _p in FLISR.values():
    _p["cmi"] = {mode: cmi(_p, mode) for mode in FLISR_TIMES}

TTL = to_turtle(m)
(Path(__file__).parent / "feeder.ttl").write_text(TTL, encoding="utf-8")

web = dict(virtual=True, limitMW=FEEDER_LIMIT_MW, pos=POS, eq=EQ,
           feeders={k: dict(cb=cb, ko=name) for k, (cb, name) in FEEDERS.items()},
           alias=POS_ALIAS, scenarios=SCENARIOS, flisr=FLISR, flisrTimes=FLISR_TIMES,
           dl1Cust=sum(e["cust"] for e in LOADS if e["id"].startswith(("LD_M", "LD_B"))),
           mrid={e["id"]: next((o.mrid for o in m if getattr(o, "name", None) == e["ko"]), None) for e in EQ if e.get("kind")})
(ROOT / "assets" / "data" / "feeder.json").write_text(json.dumps(web, ensure_ascii=False, indent=0), encoding="utf-8")

if __name__ == "__main__":
    sw = [e for e in EQ if e.get("kind") in ("sectionalizer", "tie")]
    print(f"객체 {len(m)}개 · 선로 구간 {sum(e['cls'] == 'ACLineSegment' for e in EQ)} · 개폐기 {len(sw)} "
          f"(구간 {sum(e['kind'] == 'sectionalizer' for e in sw)}, 연계 {sum(e['kind'] == 'tie' for e in sw)}) · "
          f"D/L #1 부하 {round(sum(e['p'] for e in EQ if e['id'].startswith(('LD_M', 'LD_B'))), 2)} MW")
    for sid, p in FLISR.items():
        tr = next((x for x in p["steps"] if x["id"] == "transfer"), None)
        print(f"  고장 {sid:14s} 분리 {p['boundary']} · 절체 {tr['ops'] if tr else '-'} · "
              f"수리 전 정전 {p['steps'][-2]['deadCust']}호 · CMI 자동 {p['cmi']['auto']:,} / 수동 {p['cmi']['manual']:,}")
    for sc in SCENARIOS:
        print(f"[{sc['id']}] {sc['ko']}: 정전 {sc['check']['dead_mw']} MW {sc['check']['dead']} · 루프 {sc['check']['loop']} · "
              f"선로 {sc['check']['feederMW']} · 과부하 {sc['check']['overload']}")
