"""pycim 모델 → pandapower 네트워크 변환.

매핑
  ConnectivityNode          → bus
  ExternalNetworkInjection  → ext_grid
  ACLineSegment             → line   (전체 r, x, bch를 km당 값으로 환산)
  Switch(Breaker 등)        → switch (bus-bus, closed = not open)
  PowerTransformer(2권선)   → trafo  (권선단 r, x → vk%, vkr%)
  EnergyConsumer            → load
  RotatingMachine           → sgen
"""
from __future__ import annotations

import math

from .core import ConductingEquipment, ConnectivityNode
from .model import Model
from .topology import nominal_voltages
from .wires import (ACLineSegment, EnergyConsumer, ExternalNetworkInjection, PowerTransformer,
                    RotatingMachine, Switch)


def transformer_percent(eq: PowerTransformer) -> tuple[float, float]:
    """2권선 변압기의 (vk%, vkr%). 권선단 임피던스를 고압측으로 환산해 합친다."""
    hv, lv = sorted(eq.ends, key=lambda e: -e.rated_u)
    ratio2 = (hv.rated_u / lv.rated_u) ** 2
    r = hv.r + lv.r * ratio2
    x = hv.x + lv.x * ratio2
    z_base = hv.rated_u ** 2 / hv.rated_s
    return math.hypot(r, x) / z_base * 100, r / z_base * 100


def to_pandapower(model: Model, f_hz: float = 60.0, slack_vm_pu: float | None = None):
    """(pandapower net, {ConnectivityNode: bus index}) 를 돌려준다.

    net.pycim_elements 에 {CIM 설비: (pandapower 표 이름, 행 번호)} 를 기록해 결과를 되돌릴 때 쓴다.
    slack_vm_pu: 외부 전원(ext_grid) 전압 설정값. 없으면 1.0 pu.
    """
    import pandapower as pp

    net = pp.create_empty_network(f_hz=f_hz)
    nodes = model.of_type(ConnectivityNode)
    vn = nominal_voltages(nodes)
    bus = {cn: pp.create_bus(net, vn_kv=vn[cn], name=cn.name) for cn in nodes}

    elements: dict = {}
    net.pycim_elements = elements

    def b(eq: ConductingEquipment, i: int = 0) -> int:
        return bus[eq.terminals[i].connectivity_node]

    for eq in model.of_type(ConductingEquipment):
        if isinstance(eq, ExternalNetworkInjection):
            elements[eq] = ("ext_grid", pp.create_ext_grid(net, b(eq), vm_pu=slack_vm_pu or 1.0, name=eq.name))
        elif isinstance(eq, ACLineSegment):
            km = eq.length or 1.0
            elements[eq] = ("line", pp.create_line_from_parameters(
                net, b(eq, 0), b(eq, 1), length_km=km,
                r_ohm_per_km=eq.r / km, x_ohm_per_km=eq.x / km,
                c_nf_per_km=eq.bch / (2 * math.pi * f_hz) * 1e9 / km,
                max_i_ka=1.0, name=eq.name))
        elif isinstance(eq, Switch):
            pp.create_switch(net, b(eq, 0), b(eq, 1), et="b", closed=not eq.open, name=eq.name)
        elif isinstance(eq, PowerTransformer):
            hv, lv = sorted(eq.ends, key=lambda e: -e.rated_u)
            vk, vkr = transformer_percent(eq)
            elements[eq] = ("trafo", pp.create_transformer_from_parameters(
                net, hv_bus=bus[hv.terminal.connectivity_node], lv_bus=bus[lv.terminal.connectivity_node],
                sn_mva=hv.rated_s, vn_hv_kv=hv.rated_u, vn_lv_kv=lv.rated_u,
                vk_percent=vk, vkr_percent=vkr, pfe_kw=0.0, i0_percent=0.0, name=eq.name))
        elif isinstance(eq, EnergyConsumer):
            elements[eq] = ("load", pp.create_load(net, b(eq), p_mw=eq.p, q_mvar=eq.q, name=eq.name))
        elif isinstance(eq, RotatingMachine):
            elements[eq] = ("sgen", pp.create_sgen(net, b(eq), p_mw=eq.p, q_mvar=eq.q, name=eq.name))
    return net, bus


def solve(model: Model, f_hz: float = 60.0, slack_vm_pu: float | None = None) -> dict[ConnectivityNode, float]:
    """조류계산 후 {노드: 전압[pu]}. 전원과 끊긴 노드는 NaN."""
    import pandapower as pp

    net, bus = to_pandapower(model, f_hz, slack_vm_pu)
    pp.runpp(net, numba=False)
    return {cn: float(net.res_bus.vm_pu.at[i]) for cn, i in bus.items()}
