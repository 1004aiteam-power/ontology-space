# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""객체들을 모아 두는 간단한 모델 저장소."""
from __future__ import annotations

from typing import Iterator, TypeVar

from .base import CIMObject
from .ids import is_uuid

T = TypeVar("T", bound=CIMObject)


class Model:
    def __init__(self) -> None:
        self._objects: dict[str, CIMObject] = {}

    def add(self, obj: T) -> T:
        """객체 등록. mRID가 UUID가 아니거나 이미 있으면 거부한다."""
        if not is_uuid(obj.mrid):
            raise ValueError(f"mRID는 UUID여야 합니다: {obj.mrid!r}")
        if obj.mrid in self._objects and self._objects[obj.mrid] is not obj:  # 같은 객체 재등록은 허용
            raise ValueError(f"중복 mRID: {obj.mrid} ({self._objects[obj.mrid]!r}, {obj!r})")
        self._objects[obj.mrid] = obj
        return obj

    def remove(self, obj: CIMObject) -> None:
        self._objects.pop(obj.mrid, None)

    def __iter__(self) -> Iterator[CIMObject]:
        """등록한 객체와 그에 종속된 객체(Terminal, TransformerEnd, Name 등)를 함께 순회. 중복 없음."""
        seen: set[int] = set()

        def walk(obj: CIMObject) -> Iterator[CIMObject]:
            if id(obj) in seen:
                return
            seen.add(id(obj))
            yield obj
            for child in obj.owned():
                yield from walk(child)

        for obj in list(self._objects.values()):
            yield from walk(obj)

    def __len__(self) -> int:
        return sum(1 for _ in self)

    def get(self, mrid: str) -> CIMObject:
        return next(o for o in self if o.mrid == mrid)

    def of_type(self, cls: type[T]) -> list[T]:
        """하위 클래스까지 포함해 조회. 예: of_type(Switch) → Breaker, Disconnector..."""
        return [o for o in self if isinstance(o, cls)]

    def by_name(self, name: str) -> CIMObject:
        return next(o for o in self if getattr(o, "name", None) == name)
