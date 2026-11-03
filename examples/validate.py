# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""SHACL로 데이터 품질 검증.

규칙: shapes/cim-shapes.ttl, 클래스 계층: shapes/cim-classes.ttl
필요: pip install pyshacl
실행: python examples/validate.py   (저장소 루트에서)
결과: 화면 출력 + assets/data/shacl-report.json (웹사이트 실습 페이지에서 사용)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import rdflib
from pyshacl import validate

from pycim import to_turtle
from pycim.samples import sample_grid

SH = rdflib.Namespace("http://www.w3.org/ns/shacl#")
CIM = rdflib.Namespace("http://iec.ch/TC57/CIM100#")
shapes = rdflib.Graph().parse(ROOT / "shapes" / "cim-shapes.ttl")
classes = rdflib.Graph().parse(ROOT / "shapes" / "cim-classes.ttl")


def path_text(report, path, data) -> str:
    if isinstance(path, rdflib.URIRef):
        return path.n3(data.namespace_manager)
    inv = report.value(path, SH.inversePath)       # [ sh:inversePath p ] → ^p
    return "^" + inv.n3(data.namespace_manager) if inv is not None else str(path)


def check(data: rdflib.Graph):
    conforms, report, _ = validate(data, shacl_graph=shapes, ont_graph=classes, inference="rdfs")
    rows = []
    for r in report.subjects(rdflib.RDF.type, SH.ValidationResult):
        focus = report.value(r, SH.focusNode)
        msg = str(report.value(r, SH.resultMessage))
        ko, _, en = msg.partition(" / ")
        name = data.value(focus, CIM["IdentifiedObject.name"]) or data.value(focus, CIM["Name.name"])
        path = report.value(r, SH.resultPath)
        rows.append({
            "focus": str(focus).split("#")[-1],
            "name": str(name) if name else "",
            "class": str(data.value(focus, rdflib.RDF.type) or "").split("#")[-1],
            "path": path_text(report, path, data),
            "value": str(report.value(r, SH.value) or ""),
            "ko": ko, "en": en or ko,
        })
    rows.sort(key=lambda x: (x["class"], x["focus"]))
    return conforms, rows


def datasets():
    yield "power-grid-sample.ttl", "손으로 작성한 예제 TTL", "Hand-written sample TTL", \
        rdflib.Graph().parse(ROOT / "examples" / "power-grid-sample.ttl")
    yield "pycim sample_grid()", "pycim으로 만든 예제 계통 (Name 매핑 포함)", "Sample grid built with pycim (incl. Name mapping)", \
        rdflib.Graph().parse(data=to_turtle(sample_grid()), format="turtle")
    cigre = ROOT / "examples" / "cgmes" / "cigre_mv.ttl"
    if cigre.exists():
        yield "CIGRE MV (CGMES → pycim)", "CGMES 파일을 pycim으로 읽어 다시 내보낸 데이터", "CGMES files read by pycim and re-exported", \
            rdflib.Graph().parse(cigre)
    korea = ROOT / "examples" / "twin" / "korea_virtual_grid.ttl"
    if korea.exists():
        yield "korea_virtual_grid.ttl", "가상 대한민국 전력망 (디지털 트윈)", "Virtual Korean grid (digital twin)", \
            rdflib.Graph().parse(korea)
    yield "broken-sample.ttl", "일부러 규칙을 어긴 데이터", "Data that breaks the rules on purpose", \
        rdflib.Graph().parse(ROOT / "examples" / "broken-sample.ttl")


out = []
for key, ko, en, g in datasets():
    conforms, rows = check(g)
    out.append({"dataset": key, "ko": ko, "en": en, "triples": len(g), "conforms": conforms, "violations": rows})
    print(f"\n== {key}  ({len(g)} triples) → {'통과' if conforms else f'위반 {len(rows)}건'}")
    for r in rows:
        print(f"  - {r['class']:<16} {r['name'] or r['focus']:<14} {r['path']:<32} {r['ko']}")

dest = ROOT / "assets" / "data"
dest.mkdir(parents=True, exist_ok=True)
(dest / "shacl-report.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
