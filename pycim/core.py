"""Core / Topology 패키지: 컨테이너, 설비, 단자, 접속 노드."""
from __future__ import annotations

from .base import IdentifiedObject, cim, inverse
from .ids import child_mrid


@cim
class BaseVoltage(IdentifiedObject):
    nominal_voltage: float = 0.0  # kV


@cim
class PowerSystemResource(IdentifiedObject):
    """전력계통 자원: 설비와 컨테이너의 공통 상위 클래스."""


@cim
class ConnectivityNodeContainer(PowerSystemResource):
    pass


@cim
class EquipmentContainer(ConnectivityNodeContainer):
    equipments: list = inverse(repr=False)


@cim
class Substation(EquipmentContainer):
    voltage_levels: list = inverse(repr=False)


@cim
class VoltageLevel(EquipmentContainer):
    substation: Substation | None = None
    base_voltage: BaseVoltage | None = None

    def __post_init__(self) -> None:
        if self.substation is not None:
            self.substation.voltage_levels.append(self)


@cim
class Bay(EquipmentContainer):
    voltage_level: VoltageLevel | None = None


@cim
class Line(EquipmentContainer):
    pass


@cim
class Equipment(PowerSystemResource):
    equipment_container: EquipmentContainer | None = None

    def __post_init__(self) -> None:
        if self.equipment_container is not None:
            self.equipment_container.equipments.append(self)


@cim
class ConductingEquipment(Equipment):
    """전류가 흐르는 설비. Terminal을 통해 ConnectivityNode에 연결된다."""

    base_voltage: BaseVoltage | None = None
    terminals: list = inverse(repr=False)

    def owned(self) -> list:
        return super().owned() + list(self.terminals)

    def connect(self, *nodes: "ConnectivityNode") -> "ConductingEquipment":
        """노드 순서대로 Terminal(sequenceNumber 1, 2, ...)을 만들어 연결한다."""
        for node in nodes:
            n = len(self.terminals) + 1
            Terminal(mrid=child_mrid(self.mrid, "Terminal", n),  # 설비 mRID가 같으면 단자도 같다
                     name=f"{self.name} T{n}", sequence_number=n,
                     conducting_equipment=self, connectivity_node=node)
        return self


@cim
class TopologicalNode(IdentifiedObject):
    """닫힌 개폐기로 이어진 ConnectivityNode들을 하나로 묶은 노드 (TP 프로파일, 해석용 모선)."""

    base_voltage: BaseVoltage | None = None
    connectivity_node_container: ConnectivityNodeContainer | None = None
    connectivity_nodes: list = inverse(repr=False)


@cim
class ConnectivityNode(IdentifiedObject):
    """단자들이 만나는 전기적 접점."""

    connectivity_node_container: ConnectivityNodeContainer | None = None
    topological_node: TopologicalNode | None = None  # TP 프로파일
    terminals: list = inverse(repr=False)

    def __post_init__(self) -> None:
        if self.topological_node is not None:
            self.topological_node.connectivity_nodes.append(self)


@cim
class ACDCTerminal(IdentifiedObject):
    sequence_number: int = 1
    connected: bool = True


@cim
class Terminal(ACDCTerminal):
    """설비의 접속 단자. 설비 ↔ 노드 연결은 항상 Terminal을 거친다."""

    conducting_equipment: ConductingEquipment
    connectivity_node: ConnectivityNode | None = None
    topological_node: TopologicalNode | None = None  # 버스-브랜치 모델(TP)에서 사용

    def __post_init__(self) -> None:
        self.conducting_equipment.terminals.append(self)
        if self.connectivity_node is not None:
            self.connectivity_node.terminals.append(self)
