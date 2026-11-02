"""CIM 클래스의 공통 기반: IdentifiedObject와 CIM 이름 매핑 규칙.

설계 원칙
- 파이썬 클래스 상속 = CIM 클래스 상속 (UML 계층을 그대로 옮긴다)
- 파이썬 필드는 snake_case, RDF로 내보낼 때 CIM 이름으로 자동 변환
    속성(값)     : rated_s            -> PowerTransformerEnd.ratedS
    연관(참조)   : equipment_container -> Equipment.EquipmentContainer
- CIM 이름이 규칙과 다르면 field metadata {"cim": "..."} 로 지정
- 역방향 연관(예: ConductingEquipment.terminals)은 {"cim": None} 으로
  직렬화에서 제외하고, 생성 시 자동으로 채운다.
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Iterator, TypeVar

from .ids import new_mrid

T = TypeVar("T")


def cim(cls: type[T]) -> type[T]:
    """CIM 클래스용 dataclass 데코레이터.

    kw_only: 상속 계층이 깊어도 필드 순서 문제가 없도록 키워드 인자만 허용
    eq=False: 객체 동일성(identity)으로 비교 → set/dict 키로 사용 가능
    """
    return dataclass(kw_only=True, eq=False, repr=False)(cls)


def inverse(**kwargs):
    """역방향 연관 필드: 직렬화하지 않고, 상대 객체 생성 시 자동으로 채워진다."""
    return field(default_factory=list, metadata={"cim": None}, **kwargs)


@cim
class IdentifiedObject:
    """모든 CIM 객체의 최상위 클래스 (IEC 61970-301 Core)."""

    mrid: str = field(default_factory=new_mrid, metadata={"cim": "mRID"})  # 기본: UUID v4
    name: str = ""
    description: str = ""

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.name or self.mrid[:8]!r})"

    def owned(self) -> list["IdentifiedObject"]:
        """이 객체에 종속된 하위 객체 (예: 설비의 Terminal). Model이 자동으로 포함한다."""
        return []

    # ---- CIM 메타데이터 ---------------------------------------------------
    @classmethod
    def cim_hierarchy(cls) -> list[str]:
        """['Breaker', 'ProtectedSwitch', 'Switch', ..., 'IdentifiedObject']"""
        return [c.__name__ for c in cls.__mro__ if issubclass(c, IdentifiedObject)]

    def cim_properties(self) -> Iterator[tuple[str, object]]:
        """(CIM 속성 이름, 값) 쌍을 돌려준다. 비어 있는 값과 역방향 연관은 제외."""
        for f in dataclasses.fields(self):
            value = getattr(self, f.name)
            if value is None or value == "" or f.metadata.get("cim", "") is None:
                continue
            yield cim_property_name(type(self), f, value), value


def _declaring_class(cls: type, field_name: str) -> type:
    """필드를 처음 선언한 클래스 (CIM 속성 이름의 접두어가 된다)."""
    for c in reversed(cls.__mro__):
        if field_name in c.__dict__.get("__annotations__", {}):
            return c
    return cls


def cim_property_name(cls: type, f: dataclasses.Field, value: object) -> str:
    owner = _declaring_class(cls, f.name).__name__
    if "cim" in f.metadata:
        return f"{owner}.{f.metadata['cim']}"
    parts = f.name.split("_")
    if isinstance(value, IdentifiedObject):  # 연관 → PascalCase
        local = "".join(p.capitalize() for p in parts)
    else:                                    # 속성 → camelCase
        local = parts[0] + "".join(p.capitalize() for p in parts[1:])
    return f"{owner}.{local}"
