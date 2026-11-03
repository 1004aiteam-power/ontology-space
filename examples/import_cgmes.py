# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""CGMES 파일 읽기 → 조류계산 → SV 내보내기 → 원본 결과와 비교.

데이터: examples/cgmes/CIGRE_MV (CIGRE 중압 배전 벤치마크, NEPLAN에서 내보낸 CGMES 2.4.15)
        출처: cimpy (https://github.com/sogno-platform/cimpy), Apache License 2.0
필요:   pip install rdflib pandapower
실행:   python examples/import_cgmes.py   (저장소 루트에서)

만드는 파일
  examples/cgmes/cigre_mv.ttl          읽은 모델을 pycim으로 다시 내보낸 RDF (EQ + TP + 원본 SV)
  examples/cgmes/cigre_mv_SV_pycim.ttl pycim → pandapower로 계산한 SV 프로파일
  examples/cgmes/cigre_mv_mapping.csv  원본 rdf:ID ↔ 새 mRID 매핑 테이블
  examples/sample_grid_full.ttl        예제 변전소 전체: 설비 + Name 매핑 + TP + SV
  examples/mapping_table.csv           예제 변전소의 SCADA / EAM / GIS 코드 ↔ mRID
  assets/data/cigre-compare.json       웹사이트용 비교 결과
"""
import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pycim import NameType, StateVariable, TopologicalNode, naming, sv, to_turtle
from pycim.cgmes import read_cgmes
from pycim.samples import sample_grid

# ---- 1) CGMES 읽기 -------------------------------------------------------------
files = sorted((ROOT / "examples" / "cgmes" / "CIGRE_MV").glob("*.xml"))
m = read_cgmes(files, source="NEPLAN")
rep = m.import_report
print("== 읽기 결과")
print("  읽은 클래스  :", rep["read"])
print("  건너뛴 클래스:", rep["skipped"])
print(f"  UUID가 아닌 ID {rep['renamed_ids']}개 → UUID v5 mRID 발급, 원본 ID는 Name으로 보존")
print(f"  버스-브랜치 모델: ConnectivityNode {rep['created_connectivity_nodes']}개 생성")
print(f"  SSH 없음: 부하 {rep['loads_from_sv']}개의 P, Q를 SV에서 가져옴")

(ROOT / "examples" / "cgmes" / "cigre_mv.ttl").write_text(to_turtle(m), encoding="utf-8")
rdf_id = next(nt for nt in m.of_type(NameType) if nt.name == "rdf:ID")
naming.write_csv(naming.mapping_table(m, [rdf_id]), ROOT / "examples" / "cgmes" / "cigre_mv_mapping.csv")

# ---- 2) 원본 SV(NEPLAN 계산값) 보관 후 제거 -------------------------------------------
reference = {tn.name: v for tn, v in sv.voltages_pu(m).items()}
slack_pu = reference.get("N0", 1.0)
for o in m.of_type(StateVariable):
    m.remove(o)

# ---- 3) pycim → pandapower 조류계산 → SV --------------------------------------------
svs = sv.from_pandapower(m, f_hz=50, slack_vm_pu=slack_pu)
for o in svs:
    m.add(o)
ours = {tn.name: v for tn, v in sv.voltages_pu(m).items()}
(ROOT / "examples" / "cgmes" / "cigre_mv_SV_pycim.ttl").write_text(
    to_turtle(list(m.of_type(TopologicalNode)) + svs), encoding="utf-8")

rows = []
print("\n== 전압 비교 [pu]: NEPLAN(파일의 SV) vs pycim → pandapower")
for name in sorted(reference, key=lambda n: int(n[1:]) if n[1:].isdigit() else 0):
    a, b = reference[name], next(v for tn, v in ours.items() if name in tn.split(" + "))
    rows.append({"node": name, "neplan": round(a, 5), "pycim": round(b, 5), "diff": round(abs(a - b), 5)})
    print(f"  {name:<4} {a:.5f}  {b:.5f}  차이 {abs(a - b):.5f}")
print("  최대 차이:", max(r["diff"] for r in rows))

# ---- 4) 예제 변전소: TP + SV, 매핑 테이블 ---------------------------------------------
s = sample_grid()
svs = sv.from_pandapower(s)
for o in svs:
    s.add(o)
(ROOT / "examples" / "sample_grid_full.ttl").write_text(to_turtle(s), encoding="utf-8")
types = s.of_type(NameType)
table = naming.mapping_table(s, types)
naming.write_csv(table, ROOT / "examples" / "mapping_table.csv")

(ROOT / "assets" / "data").mkdir(parents=True, exist_ok=True)
(ROOT / "assets" / "data" / "cigre-compare.json").write_text(json.dumps({
    "report": rep, "voltages": rows, "max_diff": max(r["diff"] for r in rows),
    "sample_mapping": table,
    "sample_sv": [{"class": type(o).__name__,
                   "target": (o.topological_node.name if isinstance(o, sv.SvVoltage) else o.terminal.name),
                   **({"v": o.v, "angle": o.angle} if isinstance(o, sv.SvVoltage) else {"p": o.p, "q": o.q})}
                  for o in svs],
}, ensure_ascii=False, indent=1), encoding="utf-8")
print("\n파일을 저장했습니다.")
