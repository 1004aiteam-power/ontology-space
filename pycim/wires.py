# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""Wires 패키지: 선로, 변압기, 개폐기, 모선, 부하, 전원."""
from __future__ import annotations

from .base import IdentifiedObject, cim, inverse
from .ids import child_mrid
from .core import BaseVoltage, ConductingEquipment, Terminal


# ---- 선로 -------------------------------------------------------------------
@cim
class Conductor(ConductingEquipment):
    length: float = 0.0  # km


@cim
class ACLineSegment(Conductor):
    r: float = 0.0    # 정상분 저항 [ohm]
    x: float = 0.0    # 정상분 리액턴스 [ohm]
    bch: float = 0.0  # 정상분 서셉턴스 [S]


# ---- 개폐기 -----------------------------------------------------------------
@cim
class Switch(ConductingEquipment):
    normal_open: bool = False  # 평상시 상태 (EQ 프로파일)
    open: bool = False         # 현재 상태  (SSH 프로파일)


@cim
class ProtectedSwitch(Switch):
    pass


@cim
class Breaker(ProtectedSwitch):
    """차단기: 고장전류 차단 가능."""


@cim
class LoadBreakSwitch(ProtectedSwitch):
    pass


@cim
class Disconnector(Switch):
    """단로기: 무부하 상태에서만 개폐."""


# ---- 모선 -------------------------------------------------------------------
@cim
class Connector(ConductingEquipment):
    pass


@cim
class BusbarSection(Connector):
    pass


# ---- 부하 / 전원 ------------------------------------------------------------
@cim
class EnergyConnection(ConductingEquipment):
    pass


@cim
class EnergyConsumer(EnergyConnection):
    p: float = 0.0  # MW
    q: float = 0.0  # MVAr


@cim
class ConformLoad(EnergyConsumer):
    """부하 곡선을 따르는 부하."""


@cim
class NonConformLoad(EnergyConsumer):
    """부하 곡선을 따르지 않는 부하 (대형 산업 부하 등)."""


@cim
class RegulatingCondEq(EnergyConnection):
    pass


@cim
class ExternalNetworkInjection(RegulatingCondEq):
    """외부 계통 등가 (상위 계통을 하나의 전원으로 표현)."""


@cim
class PowerElectronicsConnection(RegulatingCondEq):
    """인버터로 계통에 연결되는 설비 (태양광, ESS 등)."""

    p: float = 0.0        # MW
    q: float = 0.0        # MVAr
    rated_s: float = 0.0  # MVA


@cim
class RotatingMachine(RegulatingCondEq):
    rated_s: float = 0.0  # MVA
    p: float = 0.0
    q: float = 0.0


@cim
class SynchronousMachine(RotatingMachine):
    pass


# ---- 변압기 -----------------------------------------------------------------
@cim
class PowerTransformer(ConductingEquipment):
    ends: list = inverse(repr=False)

    def owned(self) -> list:
        return super().owned() + list(self.ends)

    def add_end(self, terminal: Terminal, **kwargs) -> "PowerTransformerEnd":
        n = len(self.ends) + 1
        kwargs.setdefault("mrid", child_mrid(self.mrid, "PowerTransformerEnd", n))
        return PowerTransformerEnd(power_transformer=self, terminal=terminal, end_number=n, **kwargs)


@cim
class TransformerEnd(IdentifiedObject):
    end_number: int = 1
    terminal: Terminal | None = None
    base_voltage: BaseVoltage | None = None


@cim
class PowerTransformerEnd(TransformerEnd):
    """변압기 권선단. 정격과 임피던스는 PowerTransformer가 아니라 End에 둔다."""

    power_transformer: PowerTransformer
    rated_s: float = 0.0  # MVA
    rated_u: float = 0.0  # kV
    r: float = 0.0
    x: float = 0.0

    def __post_init__(self) -> None:
        self.power_transformer.ends.append(self)
