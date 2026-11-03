# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""pycim 모델 → OpenDSS 스크립트(.dss) 변환.

매핑
  ConnectivityNode          → bus (n1, n2, ...)
  ExternalNetworkInjection  → Circuit (Vsource). pandapower ext_grid와 맞추기 위해 매우 강한 전원으로 설정
  ACLineSegment             → Line
  Switch                    → Line (switch=yes), 열려 있으면 Open 명령
  PowerTransformer(2권선)   → Transformer
  EnergyConsumer            → Load (정전력 model=1)
  RotatingMachine           → Generator
"""
from __future__ import annotations

import math

from .core import ConductingEquipment, ConnectivityNode
from .export_pandapower import transformer_percent
from .model import Model
from .topology import nominal_voltages
from .wires import (ACLineSegment, EnergyConsumer, ExternalNetworkInjection, PowerTransformer,
                    RotatingMachine, Switch)


def to_opendss(model: Model, f_hz: float = 60.0) -> tuple[str, dict[ConnectivityNode, str]]:
    """(.dss 스크립트 문자열, {ConnectivityNode: OpenDSS 모선 이름})"""
    nodes = model.of_type(ConnectivityNode)
    vn = nominal_voltages(nodes)
    names = {cn: f"n{i}" for i, cn in enumerate(nodes, 1)}
    count: dict[str, int] = {}

    def b(eq: ConductingEquipment, i: int = 0) -> str:
        return names[eq.terminals[i].connectivity_node]

    def ident(prefix: str) -> str:
        count[prefix] = count.get(prefix, 0) + 1
        return f"{prefix}{count[prefix]}"

    sources = model.of_type(ExternalNetworkInjection)
    if not sources:
        raise ValueError("OpenDSS 회로에는 전원(ExternalNetworkInjection)이 하나 필요합니다.")
    src = sources[0]

    out = ["! pycim에서 자동 생성한 OpenDSS 스크립트", "Clear",
           f"Set DefaultBaseFrequency={f_hz:g}", "",
           f"! {src.name}",
           f"New Circuit.pycim basekv={vn[src.terminals[0].connectivity_node]:g} bus1={b(src)} "
           "pu=1.0 phases=3 MVAsc3=1e6 MVAsc1=1e6", ""]
    tail = []
    for eq in model.of_type(ConductingEquipment):
        if isinstance(eq, ACLineSegment):
            km = eq.length or 1.0
            r1, x1 = eq.r / km, eq.x / km
            c1 = eq.bch / (2 * math.pi * f_hz) * 1e9 / km
            out += [f"! {eq.name}",
                    f"New Line.{ident('L')} bus1={b(eq, 0)} bus2={b(eq, 1)} phases=3 "
                    f"r1={r1:.6g} x1={x1:.6g} c1={c1:.6g} r0={r1:.6g} x0={x1:.6g} c0={c1:.6g} "
                    f"length={km:g} units=km"]
        elif isinstance(eq, Switch):
            name = ident("SW")
            out += [f"! {eq.name}", f"New Line.{name} bus1={b(eq, 0)} bus2={b(eq, 1)} phases=3 switch=yes"]
            if eq.open:
                tail.append(f"Open Line.{name} 1")
        elif isinstance(eq, PowerTransformer):
            hv, lv = sorted(eq.ends, key=lambda e: -e.rated_u)
            vk, vkr = transformer_percent(eq)
            xhl = math.sqrt(max(vk ** 2 - vkr ** 2, 0.0))
            kva = hv.rated_s * 1000
            out += [f"! {eq.name}",
                    f"New Transformer.{ident('T')} phases=3 windings=2 "
                    f"buses=[{names[hv.terminal.connectivity_node]} {names[lv.terminal.connectivity_node]}] "
                    f"conns=[wye wye] kVs=[{hv.rated_u:g} {lv.rated_u:g}] kVAs=[{kva:g} {kva:g}] "
                    f"%Rs=[{vkr / 2:.6g} {vkr / 2:.6g}] XHL={xhl:.6g} %noloadloss=0 %imag=0"]
        elif isinstance(eq, EnergyConsumer):
            out += [f"! {eq.name}",
                    f"New Load.{ident('LD')} bus1={b(eq)} phases=3 kV={vn[eq.terminals[0].connectivity_node]:g} "
                    f"kW={eq.p * 1000:g} kvar={eq.q * 1000:g} model=1 vminpu=0.5"]
        elif isinstance(eq, RotatingMachine):
            out += [f"! {eq.name}",
                    f"New Generator.{ident('G')} bus1={b(eq)} phases=3 kV={vn[eq.terminals[0].connectivity_node]:g} "
                    f"kW={eq.p * 1000:g} kvar={eq.q * 1000:g} model=1"]
    bases = sorted(set(vn.values()), reverse=True)
    out += [""] + tail + ["", "Set voltagebases=[" + " ".join(f"{v:g}" for v in bases) + "]",
                          "Calcvoltagebases", "Solve"]
    out += ["", "! 모선 이름 ↔ CIM ConnectivityNode"] + [f"!   {n} = {cn.name}" for cn, n in names.items()]
    return "\n".join(out) + "\n", names


def solve(model: Model, f_hz: float = 60.0) -> dict[ConnectivityNode, float]:
    """OpenDSSDirect.py로 조류계산 후 {노드: 상전압 평균[pu]}."""
    import opendssdirect as dss

    script, names = to_opendss(model, f_hz)
    for line in script.splitlines():
        if line.strip() and not line.lstrip().startswith("!"):
            dss.Text.Command(line)
    result = {}
    for cn, name in names.items():
        dss.Circuit.SetActiveBus(name)
        mags = dss.Bus.puVmagAngle()[::2]
        result[cn] = sum(mags) / len(mags) if mags else float("nan")
    return result
