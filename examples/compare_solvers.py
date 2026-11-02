"""같은 CIM 모델(pycim)을 pandapower와 OpenDSS로 각각 계산해 비교한다.

필요: pip install pandapower opendssdirect.py
실행: python examples/compare_solvers.py   (저장소 루트에서)
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pycim import Breaker, ConnectivityNode, export_opendss, export_pandapower
from pycim.samples import sample_grid
from pycim.topology import nominal_voltages

m = sample_grid()

# OpenDSS 스크립트를 파일로도 저장 (웹사이트에서 볼 수 있도록)
script, _ = export_opendss.to_opendss(m)
(ROOT / "examples" / "sample_grid.dss").write_text(script, encoding="utf-8")


def report(title):
    pp_v = export_pandapower.solve(m)
    dss_v = export_opendss.solve(m)
    vn = nominal_voltages(m.of_type(ConnectivityNode))
    print(f"\n== {title} ==")
    print(f"{'노드':<16}{'kV':>7}{'pandapower':>12}{'OpenDSS':>10}{'차이':>9}")
    for cn in m.of_type(ConnectivityNode):
        a, b = pp_v[cn], dss_v[cn]
        a_s = "정전" if a != a else f"{a:.4f}"
        b_s = "정전" if b < 0.01 else f"{b:.4f}"
        d = "" if a != a or b < 0.01 else f"{abs(a - b):.4f}"
        print(f"{cn.name:<16}{vn[cn]:>7g}{a_s:>12}{b_s:>10}{d:>9}")


report("평상시")
m.by_name("154kV 선로 CB").open = True
report("154kV 선로 CB 개방")
