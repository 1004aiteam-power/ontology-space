"""CIM 객체 → RDF Turtle 직렬화 (외부 라이브러리 없이)."""
from __future__ import annotations

from typing import Iterable

from .base import IdentifiedObject

CIM_NS = "http://iec.ch/TC57/CIM100#"


def _literal(value: object) -> str:
    if isinstance(value, bool):
        return f'"{str(value).lower()}"^^xsd:boolean'
    if isinstance(value, int):
        return f'"{value}"^^xsd:integer'
    if isinstance(value, float):
        return f'"{value}"^^xsd:float'
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


def to_turtle(objects: Iterable[IdentifiedObject], base: str = "http://example.org/grid#") -> str:
    lines = [
        f"@prefix cim: <{CIM_NS}> .",
        f"@prefix ex:  <{base}> .",
        "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
        "",
    ]
    for obj in objects:
        lines.append(f"ex:_{obj.mrid} a cim:{type(obj).__name__} ;")
        props = []
        for prop, value in obj.cim_properties():
            obj_str = f"ex:_{value.mrid}" if isinstance(value, IdentifiedObject) else _literal(value)
            props.append(f"    cim:{prop} {obj_str}")
        lines.append(" ;\n".join(props) + " .\n")
    return "\n".join(lines)
