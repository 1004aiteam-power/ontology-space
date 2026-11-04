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


def test_flisr_every_dl1_section(B):
    # D/L #1 의 모든 구간에 대해 복구 계획이 있고, 수리 후에는 평상시로 돌아간다
    assert set(B["FLISR"]) == set(B["DL1_SEGS"])
    for sid, p in B["FLISR"].items():
        ss = p["steps"]
        assert ss[0]["id"] == "trip" and ss[0]["deadCust"] == sum(e["cust"] for e in B["LOADS"] if e["id"].startswith(("LD_M", "LD_B")))
        assert ss[-1]["id"] == "repair" and ss[-1]["deadCust"] == 0 and not ss[-1]["loop"]
        assert all(not s["loop"] and not s["overload"] for s in ss)            # 어느 단계에서도 루프·과부하 없음
        assert [s["deadCust"] for s in ss] == sorted((s["deadCust"] for s in ss), reverse=True)   # 정전은 줄기만 한다
        before_repair = ss[-2]["dead"]
        assert set(before_repair) <= set(p["zone"])                              # 수리 전까지 남는 정전은 고장 구간 안의 부하뿐
        assert p["cmi"]["auto"] < p["cmi"]["manual"]


def test_flisr_split_and_unswitched_lateral(B):
    p = B["FLISR"]["DL1_SEC1"]                                                  # CB 바로 뒤 고장: 한 선로로는 다 못 받아 S2에서 나눈다
    tr = next(s for s in p["steps"] if s["id"] == "transfer")
    assert ["S2", True] in tr["ops"] and {"T1", "T4"} <= {k for k, v in tr["ops"] if v is False}
    assert tr["deadCust"] == 0
    p = B["FLISR"]["BR2_1"]                                                     # 개폐기 없는 분기선 2 고장: 병원과 간선 3구간이 수리 때까지 정전
    assert {"LD_B2", "LD_M3"} <= set(p["steps"][-2]["dead"])
