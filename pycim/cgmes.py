"""CGMES(RDF/XML) 파일 읽기 → pycim 객체.

- CIM16(CGMES 2.4.15)과 CIM100(CGMES 3.0) 네임스페이스를 모두 읽는다.
- pycim에 있는 클래스만 만들고, 나머지(Diagram, OperationalLimit 등)는 건너뛴다.
- 속성 이름은 pycim의 이름 변환 규칙을 거꾸로 적용해 찾는다 (Conductor.length → length).
- 원본 ID가 UUID가 아니면(예: NEPLAN의 "Load7-I") 이름 기반 UUID v5로 mRID를 만들고,
  원본 ID는 Name(NameType "rdf:ID")으로 보존한다. → 원본과의 매핑이 남는다.
- 버스-브랜치 모델(ConnectivityNode 없이 TopologicalNode만 있는 경우)은
  TopologicalNode마다 ConnectivityNode를 하나씩 만들어 연결한다.
- SSH가 없어 부하 값이 비어 있으면(loads_from_sv=True) SV의 SvPowerFlow 값을 부하 입력으로 쓴다.
"""
from __future__ import annotations

import dataclasses
import re
from collections import Counter
from pathlib import Path
from typing import Iterable

from .base import CIMObject
from .ids import child_mrid, is_uuid, stable_mrid
from .model import Model

# 예: http://iec.ch/TC57/2012/CIM-schema-cim16#, .../2013/CIM-schema-cim16#, http://iec.ch/TC57/CIM100#
CIM_NAMESPACE = re.compile(r"^http://iec\.ch/TC57/.*CIM.*#$")
BASE = "http://pycim.local/cgmes"


def _all_classes() -> dict[str, type]:
    from . import core, naming, sv, wires  # noqa: F401  (클래스 등록)
    out, stack = {}, [CIMObject]
    while stack:
        c = stack.pop()
        out[c.__name__] = c
        stack += c.__subclasses__()
    return out


def _field_index(cls: type) -> dict[str, dataclasses.Field]:
    """CIM 속성 이름(점 뒤 부분) → dataclass 필드."""
    idx = {}
    for f in dataclasses.fields(cls):
        if f.metadata.get("cim", "") is None:
            continue
        parts = f.name.split("_")
        idx[parts[0] + "".join(p.capitalize() for p in parts[1:])] = f   # 속성: camelCase
        idx["".join(p.capitalize() for p in parts)] = f                  # 연관: PascalCase
    return idx


def _convert(f: dataclasses.Field, value: str):
    t = str(f.type)
    if t.startswith("float"):
        return float(value)
    if t.startswith("int"):
        return int(float(value))
    if t.startswith("bool"):
        return value.strip().lower() == "true"
    return str(value)


def _blank(cls: type) -> CIMObject:
    obj = cls.__new__(cls)
    for f in dataclasses.fields(cls):
        if f.default is not dataclasses.MISSING:
            val = f.default
        elif f.default_factory is not dataclasses.MISSING:
            val = f.default_factory()
        else:
            val = None
        object.__setattr__(obj, f.name, val)
    return obj


def read_cgmes(paths: Iterable[str | Path], source: str = "CGMES", loads_from_sv: bool = True) -> Model:
    import rdflib
    from rdflib.namespace import RDF

    from .core import ConnectivityNode, Terminal
    from .naming import add_name, name_type
    from .sv import SvPowerFlow
    from .wires import EnergyConsumer

    g = rdflib.Graph()
    for p in paths:
        g.parse(str(p), format="xml", publicID=BASE)

    classes = _all_classes()
    objects: dict = {}
    original_ids: dict = {}
    skipped: Counter = Counter()

    # 1) 객체 만들기
    for s, o in g.subject_objects(RDF.type):
        ns, _, local = str(o).rpartition("#")
        if not CIM_NAMESPACE.match(ns + "#"):
            continue
        cls = classes.get(local)
        if cls is None:
            skipped[local] += 1
            continue
        if s in objects:
            continue
        obj = _blank(cls)
        raw = str(s).split("#")[-1].removeprefix("urn:uuid:")
        mrid_lit = next((str(v) for v in g.objects(s, rdflib.URIRef(ns + "#IdentifiedObject.mRID"))), None)
        if mrid_lit and is_uuid(mrid_lit):
            obj.mrid = mrid_lit
        elif is_uuid(raw.removeprefix("_")):
            obj.mrid = raw.removeprefix("_")
        else:
            obj.mrid = stable_mrid(source, raw)
            original_ids[obj] = raw
        objects[s] = obj

    # 2) 속성과 연관 채우기
    index_cache: dict = {}
    for s, obj in objects.items():
        idx = index_cache.setdefault(type(obj), _field_index(type(obj)))
        for p, v in g.predicate_objects(s):
            local = str(p).rpartition("#")[2]
            if "." not in local:
                continue
            f = idx.get(local.split(".", 1)[1])
            if f is None:
                continue
            if isinstance(v, rdflib.URIRef):
                target = objects.get(v)
                if target is not None:
                    setattr(obj, f.name, target)
            elif isinstance(v, rdflib.Literal):
                try:
                    setattr(obj, f.name, _convert(f, str(v)))
                except ValueError:
                    pass

    # 3) 필수 연관이 빠진 객체 제거 후, 역방향 연관 등록(__post_init__)
    def complete(obj) -> bool:
        return all(getattr(obj, f.name) is not None for f in dataclasses.fields(obj)
                   if f.default is dataclasses.MISSING and f.default_factory is dataclasses.MISSING)

    alive = [o for o in objects.values() if complete(o)]
    for obj in alive:
        if hasattr(obj, "__post_init__"):
            obj.__post_init__()

    m = Model()
    for obj in alive:
        m.add(obj)

    # 4) 버스-브랜치: TopologicalNode마다 ConnectivityNode 생성
    created_cn = {}
    for t in m.of_type(Terminal):
        if t.connectivity_node is None and t.topological_node is not None:
            tn = t.topological_node
            cn = created_cn.get(tn)
            if cn is None:
                cn = m.add(ConnectivityNode(mrid=child_mrid(tn.mrid, "ConnectivityNode"), name=tn.name,
                                            connectivity_node_container=tn.connectivity_node_container,
                                            topological_node=tn))
                created_cn[tn] = cn
            t.connectivity_node = cn
            cn.terminals.append(t)

    # 5) 원본 ID 보존
    if original_ids:
        nt = name_type(m, source, "rdf:ID", "원본 파일의 rdf:ID (UUID가 아니어서 mRID를 새로 발급)")
        for obj, raw in original_ids.items():
            if obj in alive and hasattr(obj, "names"):
                add_name(obj, raw, nt)

    # 6) SSH가 없을 때 SV 값을 부하 입력으로
    loads_set = 0
    if loads_from_sv:
        for f in m.of_type(SvPowerFlow):
            eq = f.terminal.conducting_equipment
            if isinstance(eq, EnergyConsumer) and eq.p == 0 and eq.q == 0:
                eq.p, eq.q = f.p, f.q
                loads_set += 1

    m.import_report = {
        "read": dict(Counter(type(o).__name__ for o in alive)),
        "skipped": dict(skipped),
        "renamed_ids": sum(1 for o in original_ids if o in alive),
        "created_connectivity_nodes": len(created_cn),
        "loads_from_sv": loads_set,
    }
    return m
