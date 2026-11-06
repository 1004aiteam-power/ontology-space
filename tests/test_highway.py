# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""가상 전국 고속도로 온톨로지·교통 흐름 빌드 검증 (examples/highway)."""
import runpy
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pycim.cypher import run as run_cypher  # noqa: E402


@pytest.fixture(scope="module")
def B():
    return runpy.run_path(str(ROOT / "examples" / "highway" / "build_highway.py"), run_name="build")


def violations(fault: str, tmp_path) -> set:
    """Turtle을 불러온 그래프에 고장(Cypher 쓰기)을 넣고 형상검증 → 위반이 나온 규칙 ID"""
    f = tmp_path / "fault.cypher"
    f.write_text(fault, encoding="utf-8")
    res = run_cypher(ttl=["examples/highway/highway-ontology.ttl", "examples/highway/highway-alignment.ttl"],
                     load=str(f), checks="shapes/highway-checks.cypher")
    return {c["id"] for c in res["checks"] if c["rows"]}


def test_network_shape(B):
    assert len(B["links"]) == 2 * len(B["sections"])
    assert B["checks"] == []                                  # Cypher 형상검증 통과


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


def test_checks_catch_broken_link(tmp_path):
    assert "LINK" in violations("MATCH (:Link {code: 'S01F'})-[r:OPPOSITE_OF]-() DELETE r;"
                                "MATCH (a:Link {code: 'S01F'}), (b:Link {code: 'S02R'}) CREATE (a)-[:OPPOSITE_OF]->(b)", tmp_path)  # 엉뚱한 반대 링크


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


def test_checks_catch_wrong_road_class(tmp_path):
    assert violations("MATCH (n:Node {code: 'SOKCHO'}) SET n:Interchange", tmp_path) == {"INTERCHANGE"}   # 국도만 닿는 지점을 IC로


def test_checks_catch_fake_junction(tmp_path):
    assert violations("MATCH (n:Node {code: 'ULJIN'}) SET n:Junction", tmp_path) == {"JUNCTION"}         # 노선 1개(국도 7호선)뿐인 노드를 JC로


def test_checks_catch_disconnected_node(tmp_path):
    assert violations("MATCH (n:Node {code: 'SOKCHO'})-[r:ADJACENT_TO]-() DELETE r", tmp_path) >= {"CONNECTED"}


def test_alignment_covers_core_classes(B):
    cq = {c["q"]: c["rows"] for c in B["cq_out"]}
    assert next(v for k, v in cq.items() if k.startswith("표준과 대응시키지 않은")) == []
    for m in B["alignment"]:
        assert m["relation"] in B["SKOS_REL"]
        assert m["verified"] == "N" or m["source"]           # '확인'이면 출처가 있어야 한다


def test_checks_catch_unsourced_verified_mapping(tmp_path):
    assert violations("MATCH (m:Mapping) WHERE m.uri ENDS WITH '#M02' SET m.verified = true", tmp_path) == {"MAPPING"}  # 출처 없는 기록을 '확인'으로


def test_standard_export(B):
    import csv
    rows = list(csv.DictReader(open(ROOT / "examples" / "highway" / "export" / "std_link.csv", encoding="utf-8-sig")))
    assert len(rows) == len(B["links"])
    assert {"F_NODE", "T_NODE", "LANES", "ROAD_RANK"} <= set(rows[0])
