# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""SV(State Variables) 프로파일: 조류계산 결과를 다시 CIM 객체로.

CIM → pandapower 조류계산 → SvVoltage / SvPowerFlow → RDF
  SvVoltage    TopologicalNode의 전압 크기[kV]와 위상각[deg]
  SvPowerFlow  Terminal을 통해 설비로 "들어가는" 유효/무효전력[MW, MVAr] (부하 기준 부호)
"""
from __future__ import annotations

import math

from .base import CIMObject, cim
from .core import ConnectivityNode, Terminal, TopologicalNode
from .ids import child_mrid
from .model import Model
from . import topology


@cim
class StateVariable(CIMObject):
    pass


@cim
class SvVoltage(StateVariable):
    v: float = 0.0        # kV
    angle: float = 0.0    # deg
    topological_node: TopologicalNode


@cim
class SvPowerFlow(StateVariable):
    p: float = 0.0        # MW
    q: float = 0.0        # MVAr
    terminal: Terminal


def from_pandapower(model: Model, f_hz: float = 60.0, slack_vm_pu: float | None = None) -> list[StateVariable]:
    """토폴로지 처리 → pandapower 조류계산 → SV 객체 목록. 정전된 노드는 SvVoltage를 만들지 않는다."""
    import pandapower as pp
    from .export_pandapower import to_pandapower

    tns = topology.process(model)
    net, bus = to_pandapower(model, f_hz, slack_vm_pu=slack_vm_pu)
    pp.runpp(net, numba=False)
    out: list[StateVariable] = []

    for tn in tns:
        idx = bus[tn.connectivity_nodes[0]]
        vm, va = net.res_bus.vm_pu.at[idx], net.res_bus.va_degree.at[idx]
        if math.isnan(vm):
            continue
        out.append(SvVoltage(mrid=child_mrid(tn.mrid, "SvVoltage"), topological_node=tn,
                             v=round(vm * net.bus.vn_kv.at[idx], 6), angle=round(va, 6)))

    def flow(term: Terminal, p: float, q: float) -> None:
        if not (math.isnan(p) or math.isnan(q)):
            out.append(SvPowerFlow(mrid=child_mrid(term.mrid, "SvPowerFlow"), terminal=term,
                                   p=round(p, 6), q=round(q, 6)))

    for eq, (table, i) in net.pycim_elements.items():
        res = net[f"res_{table}"]
        if table == "line":
            flow(eq.terminals[0], res.p_from_mw.at[i], res.q_from_mvar.at[i])
            flow(eq.terminals[1], res.p_to_mw.at[i], res.q_to_mvar.at[i])
        elif table == "trafo":
            hv, lv = sorted(eq.ends, key=lambda e: -e.rated_u)
            flow(hv.terminal, res.p_hv_mw.at[i], res.q_hv_mvar.at[i])
            flow(lv.terminal, res.p_lv_mw.at[i], res.q_lv_mvar.at[i])
        elif table == "load":
            flow(eq.terminals[0], res.p_mw.at[i], res.q_mvar.at[i])
        elif table in ("ext_grid", "sgen"):        # 발전 기준 → 부하 기준으로 부호 반전
            flow(eq.terminals[0], -res.p_mw.at[i], -res.q_mvar.at[i])
    return out


def voltages_pu(model: Model) -> dict[TopologicalNode, float]:
    """모델에 들어 있는 SvVoltage를 {TopologicalNode: pu}로."""
    from .topology import nominal_voltages
    out = {}
    for sv in model.of_type(SvVoltage):
        tn = sv.topological_node
        kv = tn.base_voltage.nominal_voltage if tn.base_voltage else None
        if kv is None and tn.connectivity_nodes:
            kv = nominal_voltages([tn.connectivity_nodes[0]])[tn.connectivity_nodes[0]]
        out[tn] = sv.v / kv if kv else float("nan")
    return out
