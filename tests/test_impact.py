# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""설비 고장 영향 분석 (examples/impact)."""
import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def B():
    return runpy.run_path(str(ROOT / "examples" / "impact" / "build_impact.py"), run_name="build")


def test_zones_cover_feeder(B):
    loads = [l for z in B["ZONES"] for l in z["loads"]]
    assert len(loads) == len(set(loads)) == 10
    assert sum(z["cust"] for z in B["ZONES"]) == B["DL1_CUST"]
    assert [z["up"] for z in B["ZONES"]] == ["CB_DL1", "S1", "S2", "S3", "S4", "S5", "S6"]


def test_source_loss_transfer(B):
    s = B["SOURCE_LOSS"]
    assert s["after"]["deadCust"] == 0 and not s["after"]["overload"] and not s["after"]["loop"]
    assert 0 < s["margin"] < 1                                            # 살렸지만 이웃 선로 여유가 거의 없다


def test_risk_rerated(B):
    tr = next(n for n in B["CHAIN"] if n["id"] == "TR_1")["asset"]
    assert tr["base"]["level"] == "높음"
    assert tr["withTie"]["auto"]["risk"] < tr["base"]["risk"] and tr["withTie"]["manual"]["mwh"] > tr["withTie"]["auto"]["mwh"]
    assert [n["id"] for n in B["CHAIN"] if not n["asset"]] == ["BUS_154", "BUS_22"]


def test_sparql_traversal(B):
    rows = {c["q"]: c["rows"] for c in B["CQ_OUT"]}
    assert rows["M.Tr #1 본체가 고장 나면 정전되는 고객은 모두 몇 호인가?"] == [["10", str(B["DL1_CUST"])]]
    assert rows["그중 중요 고객은?"] == [["아라 병원"]]
