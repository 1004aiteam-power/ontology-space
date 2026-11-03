# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""가상 전국 고속도로 온톨로지·교통 흐름 빌드 검증 (examples/highway)."""
import runpy
from pathlib import Path

import pytest
import rdflib
from pyshacl import validate

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def B():
    return runpy.run_path(str(ROOT / "examples" / "highway" / "build_highway.py"), run_name="build")


def shapes():
    return rdflib.Graph().parse(ROOT / "shapes" / "highway-shapes.ttl")


HW = rdflib.Namespace("https://1004aiteam-power.github.io/ontology-space/highway#")


def test_network_shape(B):
    assert len(B["links"]) == 2 * len(B["sections"])
    assert B["shacl"] == []                                   # SHACL 통과


def test_calibrated_peak(B):
    base = B["results"]["BASE"]["links"]
    assert max(max(x["vc"]) for x in base.values()) == pytest.approx(1.15, abs=0.05)


def test_incident_reroutes(B):
    base, inc = B["results"]["BASE"]["links"], B["results"]["INCIDENT"]["links"]
    hit = next(lk["link_id"] for lk in B["links"] if lk["route"] == "GYEONGBU" and lk["frm"] == "CHEONAN" and lk["to"] == "CHEONGJU")
    for h in range(16, 20):
        assert inc[hit]["vol"][h] < base[hit]["vol"][h]           # 막힌 링크의 교통량은 줄고
        assert inc[hit]["vc"][h] > base[hit]["vc"][h]             # v/c(혼잡)는 오른다
    gain = max(inc[l]["vol"][18] - base[l]["vol"][18] for l in base if l != hit)
    assert gain > 200                                             # 줄어든 차량은 여러 우회로로 나뉘어 간다
    assert max(B["results"]["INCIDENT"]["od"]["SEOUL-BUSAN"]) > max(B["results"]["BASE"]["od"]["SEOUL-BUSAN"])


def test_rush_hour_direction(B):
    od = B["results"]["BASE"]["od"]
    assert od["BUSAN-SEOUL"].index(max(od["BUSAN-SEOUL"])) in range(6, 10)   # 서울로 들어오는 길은 아침이 가장 막힌다
    assert od["SEOUL-BUSAN"].index(max(od["SEOUL-BUSAN"])) in range(16, 20)  # 나가는 길은 저녁


def test_competency_questions(B):
    cq = {c["q"]: c["rows"] for c in B["cq_out"]}
    assert cq["서울에서 모든 노드에 닿을 수 있나? (닿지 않는 노드 수)"] == [["0"]]
    assert cq["경부선 구간을 순서대로 나열하면?"][0] == ["1", "서울–수원·신갈"]


def test_shacl_catches_broken_link(B):
    g = rdflib.Graph().parse(data=B["TTL"], format="turtle")
    g.remove((HW.S01F, HW.oppositeOf, None))
    g.remove((None, HW.oppositeOf, HW.S01F))
    g.add((HW.S01F, HW.oppositeOf, HW.S02R))                      # 엉뚱한 반대 링크
    ok, rep, _ = validate(g, shacl_graph=shapes(), advanced=True)
    assert not ok


def test_national_roads(B):
    nat = [lk for lk in B["links"] if lk["cls"] == "NATIONAL"]
    assert nat and B["STATS"]["maxVc"]["NATIONAL"]["BASE"] < B["STATS"]["maxVc"]["EXPRESSWAY"]["BASE"]
    assert 0 < B["STATS"]["nationalShareVkm"] < 0.5
    # 사고 때 국도 1호선 천안→세종이 우회로가 된다
    nr1 = next(lk["link_id"] for lk in nat if lk["route"] == "NR1" and lk["frm"] == "CHEONAN" and lk["to"] == "SEJONG")
    base, inc = B["results"]["BASE"]["links"][nr1], B["results"]["INCIDENT"]["links"][nr1]
    assert sum(inc["vol"][16:20]) > sum(base["vol"][16:20])
    towns = {r[0] for r in next(c for c in B["cq_out"] if c["q"].startswith("고속도로에 닿지 않고"))["rows"]}
    assert {"속초", "울진", "남원"} <= towns


def test_shacl_catches_wrong_road_class(B):
    g = rdflib.Graph().parse(data=B["TTL"], format="turtle")
    g.add((HW.N_SOKCHO, rdflib.RDF.type, HW.Interchange))        # 국도만 닿는 지점을 IC로
    ok, rep, _ = validate(g, shacl_graph=shapes(), advanced=True)
    assert not ok


def test_shacl_catches_fake_junction(B):
    g = rdflib.Graph().parse(data=B["TTL"], format="turtle")
    g.add((HW.N_ULJIN, rdflib.RDF.type, HW.Junction))             # 노선 1개(국도 7호선)뿐인 노드를 JC로
    ok, rep, _ = validate(g, shacl_graph=shapes(), advanced=True)
    assert not ok


def test_alignment_covers_core_classes(B):
    cq = {c["q"]: c["rows"] for c in B["cq_out"]}
    assert next(v for k, v in cq.items() if k.startswith("표준과 대응시키지 않은")) == []
    for m in B["alignment"]:
        assert m["relation"] in B["SKOS_REL"]
        assert m["verified"] == "N" or m["source"]           # '확인'이면 출처가 있어야 한다


def test_shacl_catches_unsourced_verified_mapping(B):
    g = rdflib.Graph().parse(data=B["TTL"], format="turtle").parse(data=B["ALIGN_TTL"], format="turtle")
    HWX = rdflib.Namespace("https://1004aiteam-power.github.io/ontology-space/highway-std#")
    g.set((HWX.M02, HWX.verified, rdflib.Literal(True)))      # 출처 없는 기록을 '확인'으로
    ok, rep, _ = validate(g, shacl_graph=shapes(), advanced=True)
    assert not ok


def test_standard_export(B):
    import csv
    rows = list(csv.DictReader(open(ROOT / "examples" / "highway" / "export" / "std_link.csv", encoding="utf-8-sig")))
    assert len(rows) == len(B["links"])
    assert {"F_NODE", "T_NODE", "LANES", "ROAD_RANK"} <= set(rows[0])
