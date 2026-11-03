# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""전력설비 자산관리 온톨로지 빌드 검증 (examples/asset)."""
import runpy
from pathlib import Path

import rdflib
from pyshacl import validate

ROOT = Path(__file__).resolve().parents[1]
B = runpy.run_path(str(ROOT / "examples" / "asset" / "build_asset_ontology.py"), run_name="build")


def test_risk_ranking():
    c = B["calc"]
    assert c["AS-TR-0007"]["risk"] == 15 and c["AS-TR-0007"]["level"] == "높음"
    assert c["AS-TR-0007"]["risk_spare"] == 9          # 예비 변압기가 있으면 복구 72h → CoF 3
    assert max(c, key=lambda k: c[k]["risk"]) == "AS-TR-0007"
    assert "AS-TR-0002" not in c                        # 폐기 자산은 계산하지 않는다


def test_outage_from_topology():
    # 방사형 단일 공급: 어느 설비가 고장 나도 D/L #1 부하 8.5MW가 끊긴다
    assert all(mw == 8.5 for mw, _ in B["OUTAGE"].values())


def test_latest_diagnosis_only():
    # 선로 접속부 '주의'(8/10)는 재시공 후 '정상'(9/20)으로 대체되어 감점되지 않는다
    assert B["calc"]["AS-LN-0031"]["diag_penalty"] == 0


def test_gaps_and_overdue():
    assert B["gaps"] == ["BUS_154", "BUS_22"]
    assert {(o["asset"], o["task"]) for o in B["overdue"]} == {
        ("AS-TR-0007", "IN-06"), ("AS-TR-0007", "IN-10"), ("AS-CB-0457", "IN-08")}


def test_shacl_only_warnings():
    assert {s["severity"] for s in B["shacl"]} == {"Warning"}


def test_shacl_catches_overlap():
    g = rdflib.Graph().parse(data=B["TTL"], format="turtle")
    g.parse(ROOT / "examples" / "power-grid-sample.ttl")
    pam = rdflib.Namespace("https://1004aiteam-power.github.io/ontology-space/asset#")
    ex = rdflib.Namespace("http://example.org/grid#")
    bad = pam.DEP_BAD
    g.add((bad, rdflib.RDF.type, pam.Deployment))
    g.add((bad, pam.deployedAsset, pam.AS_TR_0002))
    g.add((bad, pam.atLocation, ex.TR_1))
    g.add((bad, pam.validFrom, rdflib.Literal("2020-01-01", datatype=rdflib.XSD.date)))
    ok, rep, _ = validate(g, shacl_graph=rdflib.Graph().parse(ROOT / "shapes" / "asset-shapes.ttl"), advanced=True)
    assert not ok
    sh = rdflib.Namespace("http://www.w3.org/ns/shacl#")
    assert (None, sh.focusNode, bad) in rep


def test_workflow_reuses_work_ontology_precedes():
    assert B["cq_out"][-1]["rows"] == [["7"]]
