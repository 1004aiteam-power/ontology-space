# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""D/L #1 배전선로 상세 모델 검증 (examples/feeder)."""
import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def B():
    return runpy.run_path(str(ROOT / "examples" / "feeder" / "build_feeder.py"), run_name="build")


def test_switch_counts(B):
    kinds = [e["kind"] for e in B["EQ"] if e.get("kind") in ("sectionalizer", "tie")]
    assert kinds.count("sectionalizer") == 6 and kinds.count("tie") == 4
    assert all(e["normalOpen"] for e in B["EQ"] if e.get("kind") == "tie")
    assert sum(e["p"] for e in B["EQ"] if e["id"].startswith(("LD_M", "LD_B"))) == pytest.approx(8.5)


def test_scenarios(B):
    sc = {s["id"]: s["check"] for s in B["SCENARIOS"]}
    assert sc["normal"]["dead_mw"] == 0 and not sc["normal"]["loop"] and not sc["normal"]["overload"]
    assert sc["fault3"]["dead_mw"] == pytest.approx(1.8)                 # 고장 구간과 개폐기 없는 분기선 2만 정전
    assert sc["cbtrip"]["overload"] == ["DL2"]                            # 통째로 넘기면 D/L #2 과부하
    assert sc["split"]["dead_mw"] == 0 and not sc["split"]["overload"]    # S2에서 나누면 한도 안
    assert sc["loop"]["loop"]                                            # 평상시 연계 개폐기를 닫으면 루프


def test_pycim_and_web_rules_agree(B):
    # pycim 토폴로지(정전 부하)와 웹 규칙(선로별 공급)이 같은 부하 합계를 낸다
    total = sum(e["p"] for e in B["EQ"] if e["cls"] == "EnergyConsumer")
    for s in B["SCENARIOS"]:
        assert sum(s["check"]["feederMW"].values()) + s["check"]["dead_mw"] == pytest.approx(total, abs=0.01)


def test_rdf_has_switch_states(B):
    ttl = B["TTL"]
    assert ttl.count("cim:LoadBreakSwitch") == 10
    assert "Switch.normalOpen" in ttl
