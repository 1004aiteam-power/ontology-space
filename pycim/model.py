"""객체들을 모아 두는 간단한 모델 저장소."""
from __future__ import annotations

from typing import Iterator, TypeVar

from .base import IdentifiedObject

T = TypeVar("T", bound=IdentifiedObject)


class Model:
    def __init__(self) -> None:
        self._objects: dict[str, IdentifiedObject] = {}

    def add(self, obj: T) -> T:
        self._objects[obj.mrid] = obj
        return obj

    def __iter__(self) -> Iterator[IdentifiedObject]:
        """등록한 객체와 그에 종속된 객체(Terminal, TransformerEnd 등)를 함께 순회."""
        for obj in self._objects.values():
            yield obj
            yield from obj.owned()

    def __len__(self) -> int:
        return sum(1 for _ in self)

    def get(self, mrid: str) -> IdentifiedObject:
        return next(o for o in self if o.mrid == mrid)

    def of_type(self, cls: type[T]) -> list[T]:
        """하위 클래스까지 포함해 조회. 예: of_type(Switch) → Breaker, Disconnector..."""
        return [o for o in self if isinstance(o, cls)]

    def by_name(self, name: str) -> IdentifiedObject:
        return next(o for o in self if o.name == name)
