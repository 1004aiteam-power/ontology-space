# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""고속도로 × 전력망: 휴게소 전기차 충전 (examples/ev)."""
import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def B():
    return runpy.run_path(str(ROOT / "examples" / "ev" / "build_ev.py"), run_name="build")


def test_energy_balance(B):
    # 이틀째 하루 동안: 공급 = 수요 + 전날 넘어온 대기 - 다음 날로 넘기는 대기 (단위 MWh)
    for ra in B["RAS"]:
        s, kwh = ra["sim"], B["PARAMS"]["kwh"]
        q0 = s["queue"][-1] * kwh / 1000                      # 정상 상태라 전날 자정의 대기 = 오늘 자정의 대기
        assert sum(s["served"]) == pytest.approx(sum(s["demand"]) + q0 - s["queue"][-1] * kwh / 1000, abs=1e-3)
        assert max(s["served"]) <= ra["chargers"] * ra["kw"] / 1000 + 1e-9


def test_scenario_story(B):
    sc = B["SCENARIOS"]
    assert not sc["today"]["over"] and sc["today"]["maxQueue"] < 1        # 오늘: 여유
    assert sc["ev30"]["maxQueue"] > 50 and not sc["ev30"]["over"]        # 전기차 30%: 충전기 부족
    assert sc["ev30x3"]["maxQueue"] < 1 and sc["ev30x3"]["over"]          # 충전기 3배: 배전선로 초과
    assert not sc["ev30x3smart"]["over"] and sc["ev30x3smart"]["maxQueue"] >= 1   # 충전 제어: 한도 지키고 대기


def test_bridge_queries(B):
    cq = {c["q"]: c["rows"] for c in B["CQ_OUT"]}
    rows = next(v for k, v in cq.items() if k.startswith("경부선"))
    assert len(rows) == sum(ra["route"] == "GYEONGBU" for ra in B["RAS"])   # 교통 → 전력 경로가 모두 이어진다
    inc = next(v for k, v in cq.items() if k.startswith("사고"))
    assert [r[1] for r in inc] == ["S04F"]


def test_substation_iri_matches_twin(B):
    ttl = (ROOT / "examples" / "twin" / "korea_virtual_grid.ttl").read_text(encoding="utf-8")
    for ra in B["RAS"]:
        assert B["tw_sub"](ra["station"]).replace("tw:", "ex:") + " a cim:Substation" in ttl
