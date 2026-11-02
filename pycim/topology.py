"""토폴로지 분석: Terminal–ConnectivityNode 그래프 탐색."""
from __future__ import annotations

from typing import Iterable

from .core import ConductingEquipment
from .wires import EnergyConsumer, Switch


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
