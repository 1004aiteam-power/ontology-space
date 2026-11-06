# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""CIM 객체 → RDF Turtle 직렬화 (외부 라이브러리 없이)."""
from __future__ import annotations

from typing import Iterable

from .base import CIMObject

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


def iri(obj: CIMObject, style: str = "cgmes2") -> str:
    """객체 IRI.

    cgmes2 : ex:_<uuid>         (CGMES 2.4.15 방식: 파일 기준 상대 IRI, rdf:about="#_<uuid>")
    urn    : <urn:uuid:<uuid>>  (위치와 무관한 전역 IRI, CGMES 3.0 방식)
    """
    if style == "urn":
        return f"<urn:uuid:{obj.mrid}>"
    return f"ex:_{obj.mrid}"


def to_turtle(objects: Iterable[CIMObject], base: str = "http://example.org/grid#",
              iri_style: str = "cgmes2") -> str:
    lines = [
        f"@prefix cim: <{CIM_NS}> .",
        f"@prefix ex:  <{base}> .",
        "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
        "",
    ]
    for obj in objects:
        lines.append(f"{iri(obj, iri_style)} a cim:{type(obj).__name__} ;")
        props = []
        for prop, value in obj.cim_properties():
            obj_str = iri(value, iri_style) if isinstance(value, CIMObject) else _literal(value)
            props.append(f"    cim:{prop} {obj_str}")
        lines.append(" ;\n".join(props) + " .\n")
    return "\n".join(lines)


def class_hierarchy_turtle() -> str:
    """pycim 클래스 계층을 RDFS(TBox)로 내보낸다. Neo4j로 불러올 때 상위 클래스를 라벨로 붙이는 데 쓴다."""
    from .cgmes import _all_classes

    lines = [f"@prefix cim:  <{CIM_NS}> .",
             "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
             "@prefix owl:  <http://www.w3.org/2002/07/owl#> .", "",
             "# pycim에서 자동 생성 (pycim.rdf.class_hierarchy_turtle)",
             "# SPDX-License-Identifier: AGPL-3.0-only", ""]
    for name, cls in sorted(_all_classes().items()):
        if cls is CIMObject:
            continue
        parents = [b.__name__ for b in cls.__bases__ if issubclass(b, CIMObject) and b is not CIMObject]
        doc = (cls.__doc__ or "").strip().splitlines()
        if doc and doc[0].startswith(f"{name}("):   # dataclass가 자동으로 만든 서명은 제외
            doc = []
        line = f"cim:{name} a owl:Class"
        for p in parents:
            line += f" ; rdfs:subClassOf cim:{p}"
        if doc and doc[0]:
            line += " ; rdfs:comment " + _literal(doc[0]) + "@ko"
        lines.append(line + " .")
    return "\n".join(lines) + "\n"
