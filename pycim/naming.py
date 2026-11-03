# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""Name / NameType / NameTypeAuthority: 다른 시스템의 코드를 mRID에 연결하는 매핑 테이블.

CIM은 하나의 객체가 여러 이름(코드)을 가질 수 있게 한다.
  NameTypeAuthority  이름을 발급하는 주체        예) "SCADA", "설비관리(EAM)"
  NameType           이름의 종류                  예) "SCADA 포인트 ID", "설비번호"
  Name               실제 값 + 대상 객체          예) "A-154-CB01" → 154kV 선로 CB

mRID는 바뀌지 않는 기준 키이고, 각 시스템의 코드는 Name으로 붙인다.
"""
from __future__ import annotations

import csv
from typing import Iterable

from .base import CIMObject, IdentifiedObject, cim
from .ids import child_mrid, stable_mrid
from .model import Model


@cim
class NameTypeAuthority(CIMObject):
    name: str = ""
    description: str = ""


@cim
class NameType(CIMObject):
    name: str = ""
    description: str = ""
    name_type_authority: NameTypeAuthority | None = None


@cim
class Name(CIMObject):
    name: str = ""
    identified_object: IdentifiedObject
    name_type: NameType | None = None

    def __post_init__(self) -> None:
        self.identified_object.names.append(self)


def name_type(model: Model, authority: str, type_name: str, description: str = "") -> NameType:
    """(발급 주체, 이름 종류)에 해당하는 NameType을 찾거나 만든다. mRID는 v5로 고정."""
    for nt in model.of_type(NameType):
        if nt.name == type_name and nt.name_type_authority and nt.name_type_authority.name == authority:
            return nt
    auth = next((a for a in model.of_type(NameTypeAuthority) if a.name == authority), None)
    if auth is None:
        auth = model.add(NameTypeAuthority(mrid=stable_mrid("NameTypeAuthority", authority), name=authority))
    return model.add(NameType(mrid=stable_mrid("NameType", authority, type_name), name=type_name,
                              description=description, name_type_authority=auth))


def add_name(obj: IdentifiedObject, value: str, nt: NameType) -> Name:
    """obj에 다른 시스템의 코드(value)를 붙인다. 같은 값이면 같은 Name mRID."""
    for n in obj.names:
        if n.name_type is nt and n.name == value:
            return n
    return Name(mrid=child_mrid(obj.mrid, "Name", nt.mrid, value), name=value,
                identified_object=obj, name_type=nt)


def find(model: Model, value: str, nt: NameType) -> IdentifiedObject | None:
    """다른 시스템의 코드로 객체 찾기. 예: SCADA 포인트 ID → 설비"""
    for n in model.of_type(Name):
        if n.name_type is nt and n.name == value:
            return n.identified_object
    return None


def codes(obj: IdentifiedObject, nt: NameType) -> list[str]:
    return [n.name for n in obj.names if n.name_type is nt]


def mapping_table(model: Model, name_types: Iterable[NameType]) -> list[dict[str, str]]:
    """mRID 기준 매핑 테이블: 한 행 = 한 객체, 열 = 각 시스템의 코드."""
    name_types = list(name_types)
    rows = []
    for obj in model.of_type(IdentifiedObject):
        cols = {f"{nt.name_type_authority.name if nt.name_type_authority else ''}:{nt.name}":
                ", ".join(codes(obj, nt)) for nt in name_types}
        if any(cols.values()):
            rows.append({"mRID": obj.mrid, "class": type(obj).__name__, "name": obj.name, **cols})
    return rows


def write_csv(rows: list[dict[str, str]], path) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8-sig") as f:   # utf-8-sig: 엑셀에서 한글 깨짐 방지
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
