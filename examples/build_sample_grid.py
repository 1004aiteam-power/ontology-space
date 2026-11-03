# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""pycim으로 예제 변전소를 만들고, 정전 영향 분석과 RDF 내보내기를 해 본다.

실행: python examples/build_sample_grid.py   (저장소 루트에서)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pycim import (ACLineSegment, BaseVoltage, Breaker, BusbarSection, ConnectivityNode,
                   EnergyConsumer, ExternalNetworkInjection, Line, Model, PowerTransformer,
                   Substation, VoltageLevel, to_turtle, topology)

m = Model()

# 1) 기준 전압, 변전소, 전압계급
bv154 = m.add(BaseVoltage(name="154kV", nominal_voltage=154.0))
bv22 = m.add(BaseVoltage(name="22.9kV", nominal_voltage=22.9))
ss = m.add(Substation(name="A변전소"))
vl154 = m.add(VoltageLevel(name="A변전소 154kV", substation=ss, base_voltage=bv154))
vl22 = m.add(VoltageLevel(name="A변전소 22.9kV", substation=ss, base_voltage=bv22))

# 2) 접속 노드
cn_remote = m.add(ConnectivityNode(name="B변전소 측 노드"))
cn_line = m.add(ConnectivityNode(name="선로-CB 접점"))
cn_154 = m.add(ConnectivityNode(name="154kV 모선 노드", connectivity_node_container=vl154))
cn_22 = m.add(ConnectivityNode(name="22.9kV 모선 노드", connectivity_node_container=vl22))
cn_feeder = m.add(ConnectivityNode(name="D/L #1 인출 노드", connectivity_node_container=vl22))

# 3) 설비 생성 + 연결 (connect: 노드 순서대로 Terminal 1, 2 생성)
grid = m.add(ExternalNetworkInjection(name="B변전소 계통")).connect(cn_remote)
line = m.add(Line(name="B-A 154kV T/L"))
m.add(ACLineSegment(name="B-A 1회선", equipment_container=line, base_voltage=bv154,
                    length=12.5, r=0.98, x=4.20)).connect(cn_remote, cn_line)
cb154 = m.add(Breaker(name="154kV 선로 CB", equipment_container=vl154)).connect(cn_line, cn_154)
m.add(BusbarSection(name="154kV 모선", equipment_container=vl154)).connect(cn_154)

tr = m.add(PowerTransformer(name="M.Tr #1", equipment_container=ss)).connect(cn_154, cn_22)
tr.add_end(tr.terminals[0], name="M.Tr #1 1차", rated_u=154.0, rated_s=60.0, base_voltage=bv154)
tr.add_end(tr.terminals[1], name="M.Tr #1 2차", rated_u=22.9, rated_s=60.0, base_voltage=bv22)

m.add(BusbarSection(name="22.9kV 모선", equipment_container=vl22)).connect(cn_22)
cb22 = m.add(Breaker(name="D/L #1 CB", equipment_container=vl22)).connect(cn_22, cn_feeder)
m.add(EnergyConsumer(name="D/L #1 부하", p=8.5, q=2.1)).connect(cn_feeder)

# 4) 조회
print("== CIM 상속 계층 ==")
print(" → ".join(Breaker.cim_hierarchy()))

print("\n== 변압기 인접 설비 ==")
print(topology.neighbors(tr))

print("\n== 정전 영향 분석 ==")
print("평상시   :", topology.deenergized_loads(m, [grid]))
cb154.open = True
print("154kV CB 개방:", topology.deenergized_loads(m, [grid]))
cb154.open = False

# 5) RDF(Turtle) 내보내기
ttl = to_turtle(m)
print(f"\n== Turtle 내보내기: 객체 {len(m)}개 (Terminal, TransformerEnd 포함) ==")
print("\n".join(ttl.splitlines()[4:12]))
