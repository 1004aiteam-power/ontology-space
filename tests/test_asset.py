# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""전력설비 자산관리 온톨로지 빌드 검증 (examples/asset)."""
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pycim.cypher import run as run_cypher  # noqa: E402

NEO = "examples/asset/neo4j/"
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


def test_checks_only_warnings():
    # Cypher 형상검증: 빈 자리 2곳만 경고, 위반은 없음
    assert {c["severity"] for c in B["checks"]} == {"Warning"}
    assert sorted(c["focus"] for c in B["checks"]) == ["BUS_154", "BUS_22"]


def _violations(fault: str, tmp_path) -> dict:
    f = tmp_path / "fault.cypher"
    f.write_text(fault, encoding="utf-8")
    res = run_cypher(load=[NEO + "import.cypher", str(f)], checks=NEO + "checks.cypher")
    return {c["id"]: c["rows"] for c in res["checks"] if c["rows"] and c["severity"] == "Violation"}


def test_checks_catch_injected_faults(tmp_path):
    # 일부러 망가뜨린 데이터를 넣으면 해당 규칙이 잡아낸다
    assert _violations("MATCH (a:Asset {id: 'AS-TR-0002'}), (l:FunctionalLocation {code: 'TR_1'}) "
                       "CREATE (a)-[:INSTALLED_AT {from: '2014-01-01'}]->(l)", tmp_path).keys() == {"DEPLOYMENT_OVERLAP"}
    assert _violations("MATCH (a:Asset {id: 'AS-CB-0123'}) SET a.eam = 'CB-0123'", tmp_path).keys() == {"EAM_NUMBER"}
    assert _violations("MATCH (w:WorkOrder {id: 'WO-2026-0731'})-[r:TRIGGERED_BY]->() DELETE r", tmp_path).keys() == {"WORK_ORDER"}
    assert _violations("MATCH (w:WorkOrder {id: 'WO-2026-0731'}) SET w.done = ''", tmp_path).keys() == {"WORK_ORDER_DONE"}
    v = _violations("MATCH (g:Diagnosis {id: 'DG-01'}), (t:MaintenanceTask {id: 'MT-01'}) CREATE (g)-[:USES_METHOD]->(t)", tmp_path)
    assert v.keys() == {"DIAGNOSIS"} and v["DIAGNOSIS"][0][0] == "DG-01"


def test_unique_constraint_blocks_duplicates(tmp_path):
    # 제약조건(UNIQUE)은 검사 이전에 저장 자체를 막는다
    import pytest
    f = tmp_path / "dup.cypher"
    f.write_text("CREATE (:Asset {id: 'AS-TR-0007'})", encoding="utf-8")
    with pytest.raises(RuntimeError, match="제약 위반"):
        run_cypher(load=[NEO + "import.cypher", str(f)])


def test_workflow_reuses_work_ontology_precedes():
    assert B["cq_out"][-1]["rows"] == [["7"]]
