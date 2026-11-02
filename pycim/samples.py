"""예제 계통: B변전소 → 154kV 선로 → A변전소(154/22.9kV) → 배전선로 부하."""
from __future__ import annotations

from .core import BaseVoltage, ConnectivityNode, Line, Substation, VoltageLevel
from .model import Model
from .wires import (ACLineSegment, Breaker, BusbarSection, EnergyConsumer,
                    ExternalNetworkInjection, PowerTransformer)


def sample_grid() -> Model:
    m = Model()

    bv154 = m.add(BaseVoltage(name="154kV", nominal_voltage=154.0))
    bv22 = m.add(BaseVoltage(name="22.9kV", nominal_voltage=22.9))
    ss = m.add(Substation(name="A변전소"))
    vl154 = m.add(VoltageLevel(name="A변전소 154kV", substation=ss, base_voltage=bv154))
    vl22 = m.add(VoltageLevel(name="A변전소 22.9kV", substation=ss, base_voltage=bv22))

    cn_remote = m.add(ConnectivityNode(name="B변전소 측 노드"))
    cn_line = m.add(ConnectivityNode(name="선로-CB 접점"))
    cn_154 = m.add(ConnectivityNode(name="154kV 모선 노드", connectivity_node_container=vl154))
    cn_22 = m.add(ConnectivityNode(name="22.9kV 모선 노드", connectivity_node_container=vl22))
    cn_feeder = m.add(ConnectivityNode(name="D/L #1 인출 노드", connectivity_node_container=vl22))

    m.add(ExternalNetworkInjection(name="B변전소 계통")).connect(cn_remote)
    line = m.add(Line(name="B-A 154kV T/L"))
    m.add(ACLineSegment(name="B-A 1회선", equipment_container=line, base_voltage=bv154,
                        length=12.5, r=0.98, x=4.20)).connect(cn_remote, cn_line)
    m.add(Breaker(name="154kV 선로 CB", equipment_container=vl154)).connect(cn_line, cn_154)
    m.add(BusbarSection(name="154kV 모선", equipment_container=vl154)).connect(cn_154)

    # 60 MVA, %Z 약 12% (임피던스는 1차(154kV) 측 값으로 표현)
    tr = m.add(PowerTransformer(name="M.Tr #1", equipment_container=ss)).connect(cn_154, cn_22)
    tr.add_end(tr.terminals[0], name="M.Tr #1 1차", rated_u=154.0, rated_s=60.0,
               r=1.0, x=47.4, base_voltage=bv154)
    tr.add_end(tr.terminals[1], name="M.Tr #1 2차", rated_u=22.9, rated_s=60.0, base_voltage=bv22)

    m.add(BusbarSection(name="22.9kV 모선", equipment_container=vl22)).connect(cn_22)
    m.add(Breaker(name="D/L #1 CB", equipment_container=vl22)).connect(cn_22, cn_feeder)
    m.add(EnergyConsumer(name="D/L #1 부하", p=8.5, q=2.1)).connect(cn_feeder)
    return m
