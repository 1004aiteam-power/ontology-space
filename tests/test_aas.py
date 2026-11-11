# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""자산관리셸(AAS) 예제 빌드 검증 (examples/aas)."""
import copy
import json
import runpy
import sys
from pathlib import Path

from rdflib import Graph, URIRef

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pycim.cypher import run as run_cypher  # noqa: E402

AAS = ROOT / "examples" / "aas"
B = runpy.run_path(str(AAS / "build_aas.py"), run_name="build")
ENV = B["ENV"]


def test_generated_files_are_current():
    # 빌드를 다시 돌려도 저장된 파일과 같다 (원본 CSV · 온톨로지를 고치고 빌드를 잊으면 여기서 걸림)
    assert json.loads((AAS / "aas-mtr1.json").read_text(encoding="utf-8")) == ENV
    assert (AAS / "aas-mtr1.ttl").read_text(encoding="utf-8") == B["TTL"]
    assert (AAS / "aas-links.ttl").read_text(encoding="utf-8") == B["LINKS"]
    assert json.loads((ROOT / "assets" / "data" / "aas.json").read_text(encoding="utf-8")) == json.loads(json.dumps(B["web"]))


def test_shell_points_at_the_ontology_asset():
    shell = ENV["assetAdministrationShells"][0]
    onto = Graph().parse(ROOT / "examples" / "asset" / "asset-ontology.ttl")
    asset = URIRef(shell["assetInformation"]["globalAssetId"])
    assert (asset, None, None) in onto                                   # globalAssetId = 온톨로지의 자산 개체
    assert shell["assetInformation"]["assetKind"] == "Instance"
    assert [r["keys"][0]["value"] for r in shell["submodels"]] == [s["id"] for s in ENV["submodels"]]
    assert [s["idShort"] for s in ENV["submodels"]] == ["Nameplate", "TechnicalData", "ConditionAndRisk", "BillOfMaterial"]


def test_values_come_from_the_asset_ontology():
    cond = {e["idShort"]: e for e in ENV["submodels"][2]["submodelElements"]}
    assert (cond["HealthIndex"]["value"], cond["RiskScore"]["value"]) == ("53", "15")
    assert cond["HealthIndex"]["semanticId"]["keys"][0]["value"].endswith("asset#healthIndex")
    assert len(cond["Diagnoses"]["value"]) == 5 and all("idShort" not in d for d in cond["Diagnoses"]["value"])
    tech = {e["idShort"]: e["value"] for e in ENV["submodels"][1]["submodelElements"]}
    assert (tech["RatedPower"], tech["RatedVoltageHV"], tech["RatedVoltageLV"]) == ("60", "154", "22.9")


def test_constraints_catch_broken_environments():
    assert B["check_env"](ENV) == []
    bad = copy.deepcopy(ENV)
    bad["submodels"][2]["submodelElements"][7]["value"][0]["idShort"] = "First"       # 목록 항목에 idShort
    bad["submodels"][1]["submodelElements"][0]["idShort"] = "1stPower"               # 숫자로 시작
    bad["assetAdministrationShells"][0]["submodels"][0]["keys"][0]["value"] = "urn:missing"
    msgs = "\n".join(B["check_env"](bad))
    assert "AASd-120" in msgs and "AASd-002" in msgs and "urn:missing" in msgs


def test_rdf_follows_the_aas_mapping():
    g = Graph().parse(data=B["TTL"], format="turtle")
    ns = "https://admin-shell.io/aas/3/0/"
    types = {str(o).removeprefix(ns) for o in g.objects(None, URIRef("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"))}
    assert {"AssetAdministrationShell", "Submodel", "Property", "SubmodelElementList", "Entity", "ConceptDescription", "Reference", "Key"} <= types
    assert len(g) == B["web"]["stats"]["triples"]
    assert (None, URIRef(ns + "Property/valueType"), URIRef(ns + "DataTypeDefXsd/Decimal")) in g
    assert (None, URIRef(ns + "AssetInformation/assetKind"), URIRef(ns + "AssetKind/Instance")) in g


def test_questions_cross_the_bridge():
    q = B["cq_out"]
    assert [r[0] for r in q[0]["rows"]] == ["BillOfMaterial", "ConditionAndRisk", "Nameplate", "TechnicalData"]
    assert ["ConditionAndRisk", "HealthIndex", "pam:healthIndex", "53"] in q[1]["rows"]
    assert {r[2] for r in q[2]["rows"]} == {"WO-2026-0915", "WO-2026-0912"}       # 작업지시는 온톨로지에만 있다
    assert [r[1] for r in q[3]["rows"]] == ["AS-TR-0002", "AS-TR-0007"]           # 같은 자리의 이전 변압기
    assert q[4]["rows"] == []                                                     # AAS 값 = 온톨로지 값


def test_consistency_question_catches_drift(tmp_path):
    # AAS 의 건전도만 바꾸면 Q5 가 잡아낸다
    f = tmp_path / "drift.ttl"
    f.write_text(B["TTL"].replace('Property/value> "53"^^xs:string', 'Property/value> "71"^^xs:string'), encoding="utf-8")
    res = run_cypher(ttl=[str(f)] + B["FILES"][1:], queries="examples/aas/queries.cypher")
    assert res["queries"][4]["rows"] == [["HealthIndex", "71", 53]]
