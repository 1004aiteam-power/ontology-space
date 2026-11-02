"""토폴로지 분석: Terminal–ConnectivityNode 그래프 탐색."""
from __future__ import annotations

from typing import Iterable

from .core import ConductingEquipment, ConnectivityNode, VoltageLevel
from .wires import EnergyConsumer, PowerTransformer, Switch


def neighbors(eq: ConductingEquipment) -> list[ConductingEquipment]:
    """같은 ConnectivityNode를 공유하는 설비 (개폐 상태와 무관)."""
    out = []
    for t in eq.terminals:
        if t.connectivity_node is None:
            continue
        out += [t2.conducting_equipment for t2 in t.connectivity_node.terminals
                if t2.conducting_equipment is not eq]
    return out


def energized(sources: Iterable[ConductingEquipment]) -> set[ConductingEquipment]:
    """전원에서 출발해 닫힌 경로로 도달하는 설비 집합.

    열린 Switch는 '한쪽만 가압'으로 보고 그 너머로는 진행하지 않는다.
    """
    seen_eq: set = set()
    seen_cn: set = set()
    stack = list(sources)
    while stack:
        eq = stack.pop()
        if eq in seen_eq:
            continue
        seen_eq.add(eq)
        if isinstance(eq, Switch) and eq.open:
            continue
        for t in eq.terminals:
            cn = t.connectivity_node
            if not t.connected or cn is None or cn in seen_cn:
                continue
            seen_cn.add(cn)
            stack += [t2.conducting_equipment for t2 in cn.terminals if t2.connected]
    return seen_eq


def deenergized_loads(objects: Iterable, sources: Iterable[ConductingEquipment]) -> list[EnergyConsumer]:
    """전원에서 끊긴 부하 목록 (정전 영향 분석)."""
    live = energized(sources)
    return [o for o in objects if isinstance(o, EnergyConsumer) and o not in live]


def nominal_voltages(nodes: Iterable[ConnectivityNode]) -> dict[ConnectivityNode, float]:
    """각 ConnectivityNode의 공칭전압[kV]을 추정한다. 해석 도구로 변환할 때 필요하다.

    1) 노드가 속한 VoltageLevel의 BaseVoltage
    2) 연결된 설비의 BaseVoltage (변압기는 해당 권선단의 정격전압)
    3) 그래도 모르면 변압기가 아닌 설비를 건너 이웃 노드의 값을 전파
    """
    nodes = list(nodes)
    volts: dict = {}
    for cn in nodes:
        c = cn.connectivity_node_container
        if isinstance(c, VoltageLevel) and c.base_voltage:
            volts[cn] = c.base_voltage.nominal_voltage
            continue
        for t in cn.terminals:
            eq = t.conducting_equipment
            if isinstance(eq, PowerTransformer):
                end = next((e for e in eq.ends if e.terminal is t), None)
                if end and end.rated_u:
                    volts[cn] = end.rated_u
                    break
                continue
            bv = eq.base_voltage
            if bv is None and isinstance(eq.equipment_container, VoltageLevel):
                bv = eq.equipment_container.base_voltage
            if bv:
                volts[cn] = bv.nominal_voltage
                break
    changed = True
    while changed:
        changed = False
        for cn in nodes:
            if cn in volts:
                continue
            for t in cn.terminals:
                eq = t.conducting_equipment
                if isinstance(eq, PowerTransformer):
                    continue
                known = [t2.connectivity_node for t2 in eq.terminals if t2.connectivity_node in volts]
                if known:
                    volts[cn] = volts[known[0]]
                    changed = True
                    break
    missing = [cn for cn in nodes if cn not in volts]
    if missing:
        raise ValueError(f"공칭전압을 알 수 없는 노드: {missing}")
    return volts
