"""가상 대한민국 전력망 디지털 트윈: CIM 모델 → pandapower 24시간 조류계산 → 웹 데이터.

⚠ 모든 데이터는 가상입니다.
  발전소·변전소·선로의 이름, 위치, 용량, 연결은 실제 한국전력 계통과 무관하며,
  지역 감각을 위해 도시 위치에 대략 배치했을 뿐입니다. 부하·태양광 곡선도 가상입니다.

흐름
  1) pycim으로 CIM 모델 생성 (Substation · VoltageLevel · ACLineSegment · PowerTransformer ·
     SynchronousMachine · PowerElectronicsConnection(태양광) · EnergyConsumer, mRID는 UUID v5)
  2) pycim.export_pandapower로 변환, 화력·원전은 전압 제어(PV) 발전기로 바꿈
  3) 24시간: 부하 곡선 · 태양광 곡선 · 발전 배분(급전) → 조류계산
  4) assets/data/twin.json (웹), examples/twin/korea_virtual_grid.ttl (CIM RDF)

필요: pip install pandapower rdflib
실행: python examples/twin/build_korea_twin.py   (저장소 루트에서)
"""
from __future__ import annotations

import json
import math
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pandapower as pp  # noqa: E402

from pycim import (ACLineSegment, BaseVoltage, ConnectivityNode, EnergyConsumer, Model,  # noqa: E402
                   PowerElectronicsConnection, PowerTransformer, Substation, SynchronousMachine,
                   VoltageLevel, stable_mrid, to_turtle)
from pycim.export_pandapower import to_pandapower  # noqa: E402

F_HZ = 60
PEAK_MW = 48_000            # 가상 전국 최대 수요 (실제 규모보다 작게 단순화)
PF = 0.97                   # 부하 역률 (무효전력 보상 설비가 있다고 가정)
DIST_SOLAR_MW = 4_000       # 지붕형 등 분산 태양광 (부하 지점에 나눠 배치)

# ---- 1. 가상 설비 목록 -------------------------------------------------------------
# (id, 한글, 영문, 경도, 위도, 전압 계급들, 부하 비중)
STATIONS = [
    # 765kV 거점
    ("E765", "동해안 765", "East Coast 765", 129.30, 37.05, [765], 0),
    ("K765", "영서 765", "Yeongseo 765", 128.20, 37.38, [765, 345, 154], 0.005),
    ("ME765", "수도권 동부", "Capital East", 127.45, 37.50, [765, 345, 154], 0.03),
    ("W765", "서해안 765", "West Coast 765", 126.62, 36.98, [765], 0),
    ("MS765", "수도권 남부", "Capital South", 127.22, 37.05, [765, 345, 154], 0.05),
    ("SE765", "남동해안 765", "Southeast Coast 765", 129.24, 35.36, [765, 345], 0),
    ("Y765", "영남 중부", "Central Yeongnam", 128.55, 35.68, [765, 345, 154], 0.01),
    # 345kV 도시 변전소 (154kV로 낮춰 부하 공급)
    ("SEOUL", "서울", "Seoul", 126.98, 37.56, [345, 154], 0.14),
    ("GGN", "경기 북부", "Gyeonggi North", 127.05, 37.75, [345, 154], 0.05),
    ("GGS", "경기 남부", "Gyeonggi South", 127.02, 37.28, [345, 154], 0.09),
    ("INCHEON", "인천", "Incheon", 126.70, 37.46, [345, 154], 0.06),
    ("CHEONAN", "천안", "Cheonan", 127.15, 36.81, [345, 154], 0.03),
    ("CHEONGJU", "청주", "Cheongju", 127.49, 36.64, [345, 154], 0.03),
    ("DAEJEON", "대전", "Daejeon", 127.38, 36.35, [345, 154], 0.03),
    ("BORYEONG", "충남 서부", "West Chungnam", 126.60, 36.35, [345], 0),
    ("JEONJU", "전주", "Jeonju", 127.15, 35.82, [345, 154], 0.02),
    ("GWANGJU", "광주", "Gwangju", 126.85, 35.16, [345, 154], 0.03),
    ("YEONGGWANG", "전남 서해안", "West Jeonnam", 126.42, 35.41, [345], 0),
    ("HONAMPV", "호남 태양광 거점", "Honam PV hub", 126.58, 34.98, [345], 0),
    ("SAEMANGEUM", "전북 해안", "Jeonbuk Coast", 126.58, 35.80, [345], 0),
    ("YEOSU", "여수", "Yeosu", 127.66, 34.76, [345, 154], 0.04),
    ("HADONG", "경남 서부", "West Gyeongnam", 127.80, 34.98, [345], 0),
    ("DAEGU", "대구", "Daegu", 128.60, 35.87, [345, 154], 0.04),
    ("GUMI", "구미", "Gumi", 128.34, 36.12, [345, 154], 0.02),
    ("POHANG", "포항", "Pohang", 129.36, 36.02, [345, 154], 0.04),
    ("ULSAN", "울산", "Ulsan", 129.31, 35.54, [345, 154], 0.05),
    ("BUSAN", "부산", "Busan", 129.07, 35.18, [345, 154], 0.05),
    ("CHANGWON", "창원", "Changwon", 128.68, 35.23, [345, 154], 0.03),
    ("GANGNEUNG", "강릉", "Gangneung", 128.90, 37.75, [345, 154], 0.01),
    # 154kV 중소 도시
    ("CHUNCHEON", "춘천", "Chuncheon", 127.73, 37.88, [154], 0.004),
    ("WONJU", "원주", "Wonju", 127.92, 37.34, [154], 0.004),
    ("CHUNGJU", "충주", "Chungju", 127.93, 36.99, [154], 0.004),
    ("SEOSAN", "서산", "Seosan", 126.45, 36.78, [154], 0.004),
    ("GUNSAN", "군산", "Gunsan", 126.71, 35.97, [154], 0.004),
    ("MOKPO", "목포", "Mokpo", 126.39, 34.81, [154], 0.004),
    ("SUNCHEON", "순천", "Suncheon", 127.49, 34.95, [154], 0.004),
    ("JINJU", "진주", "Jinju", 128.11, 35.18, [154], 0.004),
    ("GYEONGJU", "경주", "Gyeongju", 129.21, 35.86, [154], 0.004),
    ("GIMHAE", "김해", "Gimhae", 128.89, 35.23, [154], 0.004),
    ("ANDONG", "안동", "Andong", 128.73, 36.57, [154], 0.003),
    ("SOKCHO", "속초", "Sokcho", 128.59, 38.20, [154], 0.003),
    ("SAMCHEOK", "삼척", "Samcheok", 129.17, 37.45, [154], 0.003),
]

# (id, 한글, 영문, 종류, 접속 변전소, 접속 전압, 용량 MW, 최소 출력 비율)
PLANTS = [
    ("N_EAST", "동해안 원전 (가상)", "East Coast Nuclear (virtual)", "nuclear", "E765", 765, 6000, 0.95),
    ("N_SE", "남동해안 원전 (가상)", "Southeast Coast Nuclear (virtual)", "nuclear", "SE765", 765, 6000, 0.95),
    ("N_WEST", "서남해안 원전 (가상)", "Southwest Coast Nuclear (virtual)", "nuclear", "YEONGGWANG", 345, 4000, 0.95),
    ("C_WEST_A", "서해안 화력 A (가상)", "West Coast Coal A (virtual)", "coal", "W765", 765, 6000, 0.45),
    ("C_WEST_B", "서해안 화력 B (가상)", "West Coast Coal B (virtual)", "coal", "BORYEONG", 345, 3500, 0.45),
    ("C_SOUTH", "남해안 화력 (가상)", "South Coast Coal (virtual)", "coal", "HADONG", 345, 3000, 0.45),
    ("C_EAST", "강원 화력 (가상)", "Gangwon Coal (virtual)", "coal", "GANGNEUNG", 345, 2000, 0.45),
    ("L_METRO", "수도권 LNG (가상)", "Capital LNG (virtual)", "lng", "INCHEON", 345, 7000, 0.15),
    ("L_SOUTH", "경기 남부 LNG (가상)", "Gyeonggi South LNG (virtual)", "lng", "GGS", 345, 4000, 0.15),
    ("L_NORTH", "경기 북부 LNG (가상)", "Gyeonggi North LNG (virtual)", "lng", "GGN", 345, 2000, 0.15),
    ("L_CENTRAL", "충청 LNG (가상)", "Chungcheong LNG (virtual)", "lng", "CHEONGJU", 345, 2000, 0.15),
    ("L_YEONGNAM", "영남 LNG (가상)", "Yeongnam LNG (virtual)", "lng", "ULSAN", 345, 3000, 0.15),
    ("S_HONAM", "호남 태양광 (가상)", "Honam Solar (virtual)", "solar", "HONAMPV", 345, 3000, 0),
    ("S_JEONBUK", "전북 해안 태양광 (가상)", "Jeonbuk Coast Solar (virtual)", "solar", "SAEMANGEUM", 345, 2000, 0),
    ("S_CHUNGNAM", "충남 태양광 (가상)", "Chungnam Solar (virtual)", "solar", "SEOSAN", 154, 300, 0),
    ("S_GYEONGBUK", "경북 태양광 (가상)", "Gyeongbuk Solar (virtual)", "solar", "ANDONG", 154, 300, 0),
]

# 선로 (변전소 A, 변전소 B, 전압, 병렬 루트 수) — 각 루트는 2회선 송전탑 1개를 뜻함
LINES = [
    # 765kV
    ("E765", "K765", 765, 1), ("K765", "ME765", 765, 1), ("W765", "MS765", 765, 1),
    ("MS765", "ME765", 765, 1), ("SE765", "Y765", 765, 1), ("Y765", "MS765", 765, 1),
    # 345kV 수도권
    ("INCHEON", "SEOUL", 345, 2), ("SEOUL", "GGN", 345, 1), ("SEOUL", "GGS", 345, 2),
    ("SEOUL", "ME765", 345, 2), ("GGN", "ME765", 345, 1), ("GGS", "ME765", 345, 1),
    ("GGS", "MS765", 345, 2), ("INCHEON", "GGS", 345, 1), ("K765", "GANGNEUNG", 345, 1),
    # 345kV 중부
    ("MS765", "CHEONAN", 345, 1), ("CHEONAN", "CHEONGJU", 345, 1), ("CHEONAN", "DAEJEON", 345, 1),
    ("CHEONGJU", "DAEJEON", 345, 1), ("BORYEONG", "CHEONAN", 345, 1), ("BORYEONG", "DAEJEON", 345, 1),
    ("DAEJEON", "JEONJU", 345, 2), ("DAEJEON", "GUMI", 345, 1), ("CHEONGJU", "GUMI", 345, 1),
    # 345kV 호남
    ("JEONJU", "GWANGJU", 345, 1), ("YEONGGWANG", "GWANGJU", 345, 1), ("YEONGGWANG", "JEONJU", 345, 1),
    ("HONAMPV", "GWANGJU", 345, 1), ("HONAMPV", "YEONGGWANG", 345, 1), ("SAEMANGEUM", "JEONJU", 345, 1),
    ("SAEMANGEUM", "YEONGGWANG", 345, 1), ("GWANGJU", "YEOSU", 345, 1), ("YEOSU", "HADONG", 345, 1),
    ("HADONG", "CHANGWON", 345, 1),
    # 345kV 영남
    ("GUMI", "DAEGU", 345, 1), ("DAEGU", "Y765", 345, 2), ("DAEGU", "POHANG", 345, 1),
    ("POHANG", "ULSAN", 345, 1), ("ULSAN", "SE765", 345, 1), ("SE765", "BUSAN", 345, 1),
    ("BUSAN", "CHANGWON", 345, 1), ("CHANGWON", "Y765", 345, 1), ("ULSAN", "BUSAN", 345, 1),
    # 154kV
    ("GGN", "CHUNCHEON", 154, 2), ("K765", "WONJU", 154, 2), ("CHEONGJU", "CHUNGJU", 154, 2),
    ("CHEONAN", "SEOSAN", 154, 2), ("JEONJU", "GUNSAN", 154, 2), ("GWANGJU", "MOKPO", 154, 2),
    ("YEOSU", "SUNCHEON", 154, 2), ("CHANGWON", "JINJU", 154, 2), ("POHANG", "GYEONGJU", 154, 2),
    ("BUSAN", "GIMHAE", 154, 2), ("DAEGU", "ANDONG", 154, 2), ("GANGNEUNG", "SOKCHO", 154, 2),
    ("GANGNEUNG", "SAMCHEOK", 154, 2), ("CHUNCHEON", "WONJU", 154, 2),
]

# 2회선 1루트 기준 선로 정수 (km당, 가상 대표값): r, x [Ω/km], c [nF/km], 열적 한계 [kA]
LINE_PARAM = {765: (0.0055, 0.134, 28.0, 8.0), 345: (0.016, 0.155, 23.0, 4.0), 154: (0.035, 0.19, 18.0, 1.6)}

# 24시간 곡선 (가상, 여름 평일 모양). 부하: 최대 수요 대비, 태양광: 설비 용량 대비
LOAD_CURVE = [0.78, 0.74, 0.71, 0.69, 0.68, 0.69, 0.73, 0.80, 0.88, 0.94, 0.97, 0.98,
              0.96, 0.98, 1.00, 1.00, 0.99, 0.97, 0.95, 0.94, 0.93, 0.91, 0.87, 0.82]
SOLAR_CURVE = [0, 0, 0, 0, 0, 0, 0.02, 0.10, 0.28, 0.48, 0.66, 0.78,
               0.84, 0.82, 0.72, 0.56, 0.36, 0.16, 0.04, 0, 0, 0, 0, 0]


def km(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (a[3], a[4], b[3], b[4]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h)) * 1.2       # 직선 거리 × 1.2 (우회 경로)


def build_cim():
    m = Model()
    st = {s[0]: s for s in STATIONS}
    shares = sum(s[6] for s in STATIONS)
    bv = {kv: m.add(BaseVoltage(mrid=stable_mrid("kr-twin", "BV", kv), name=f"{kv}kV", nominal_voltage=kv))
          for kv in (765, 345, 154)}
    node = {}
    subs = {}
    for sid, ko, en, lon, lat, levels, share in STATIONS:
        ss = subs[sid] = m.add(Substation(mrid=stable_mrid("kr-twin", sid), name=f"{ko} (가상)", description=en))
        for kv in levels:
            vl = m.add(VoltageLevel(mrid=stable_mrid("kr-twin", sid, kv), name=f"{ko} {kv}kV",
                                    substation=ss, base_voltage=bv[kv]))
            node[sid, kv] = m.add(ConnectivityNode(mrid=stable_mrid("kr-twin", sid, kv, "CN"),
                                                   name=f"{ko} {kv}kV", connectivity_node_container=vl))
        # 변압기: 위 전압 → 아래 전압 (용량은 그 아래로 흐를 전력에 맞춰 넉넉히)
        for hi, lo in zip(levels, levels[1:]):
            rating = 8000 if hi == 765 else max(600, round(PEAK_MW * share * 1.6, -2) + 600)
            tr = m.add(PowerTransformer(mrid=stable_mrid("kr-twin", sid, "TR", hi, lo),
                                        name=f"{ko} {hi}/{lo}kV", equipment_container=ss))
            tr.connect(node[sid, hi], node[sid, lo])
            vk = 0.14 if hi == 765 else 0.12
            z = hi ** 2 / rating
            tr.add_end(tr.terminals[0], rated_u=hi, rated_s=rating, r=0.0025 * z, x=vk * z, base_voltage=bv[hi])
            tr.add_end(tr.terminals[1], rated_u=lo, rated_s=rating, base_voltage=bv[lo])   # 탭은 계산 중 OLTC가 조절
        if share:
            lvl = min(levels)
            m.add(EnergyConsumer(mrid=stable_mrid("kr-twin", sid, "LOAD"), name=f"{ko} 부하",
                                 p=PEAK_MW * share / shares)).connect(node[sid, lvl])
            m.add(PowerElectronicsConnection(mrid=stable_mrid("kr-twin", sid, "DPV"), name=f"{ko} 분산 태양광",
                                             rated_s=DIST_SOLAR_MW * share / shares)).connect(node[sid, lvl])
    lines = []
    for a, b, kv, routes in LINES:
        length = km(st[a], st[b])
        r, x, c, imax = LINE_PARAM[kv]
        seg = m.add(ACLineSegment(mrid=stable_mrid("kr-twin", "LN", a, b, kv),
                                  name=f"{st[a][1]}–{st[b][1]} {kv}kV", base_voltage=bv[kv], length=round(length, 1),
                                  r=r * length / routes, x=x * length / routes,
                                  bch=2 * math.pi * F_HZ * c * routes * length * 1e-9))
        seg.connect(node[a, kv], node[b, kv])
        lines.append({"id": f"{a}-{b}-{kv}", "a": a, "b": b, "kv": kv, "km": round(length), "routes": routes,
                      "ratingMVA": round(math.sqrt(3) * kv * imax * routes), "eq": seg})
    plants = []
    for pid, ko, en, kind, sid, kv, cap, pmin in PLANTS:
        cls = PowerElectronicsConnection if kind == "solar" else SynchronousMachine
        eq = m.add(cls(mrid=stable_mrid("kr-twin", "GEN", pid), name=ko, description=en, rated_s=cap))
        eq.connect(node[sid, kv])
        plants.append({"id": pid, "ko": ko, "en": en, "type": kind, "station": sid, "kv": kv,
                       "capMW": cap, "pmin": pmin, "eq": eq})
    return m, node, lines, plants


def dispatch(load_mw, solar_mw, plants, loss_est):
    """급전: 원전은 거의 일정, 나머지 부족분은 석탄 → LNG 순으로 용량에 비례해 배분 (가상 규칙)."""
    out = {}
    need = load_mw + loss_est - solar_mw
    for p in plants:
        if p["type"] == "nuclear":
            out[p["id"]] = p["capMW"] * p["pmin"]
            need -= out[p["id"]]
    for kind in ("coal", "lng"):            # 석탄을 먼저 채우고 남는 것을 LNG가 맡는다 (가상 급전 순서)
        group = [p for p in plants if p["type"] == kind]
        mins = sum(p["capMW"] * p["pmin"] for p in group)
        caps = sum(p["capMW"] for p in group)
        take = min(max(need, mins), caps)
        for p in group:
            out[p["id"]] = p["capMW"] * p["pmin"] + (take - mins) * (p["capMW"] - p["capMW"] * p["pmin"]) / (caps - mins)
        need -= take
    return out


def main():
    m, node, lines, plants = build_cim()
    (ROOT / "examples" / "twin" / "korea_virtual_grid.ttl").write_text(
        "# ⚠ 가상 데이터: 실제 한국 전력 계통과 무관합니다.\n" + to_turtle(m, base="http://example.org/kr-twin#"),
        encoding="utf-8")

    net, bus = to_pandapower(m, f_hz=F_HZ)
    el = net.pycim_elements
    # 선로 열적 한계: CIM에서는 OperationalLimit(CurrentLimit)로 표현하지만 pycim에는 아직 없어
    # 변환기가 1 kA로 둔 값을 전압 계급별 대표값 × 루트 수로 바꾼다
    for l in lines:
        net.line.at[el[l["eq"]][1], "max_i_ka"] = LINE_PARAM[l["kv"]][3] * l["routes"]
    # 화력·원전은 전압을 일정하게 유지하는 PV 발전기로 (sgen → gen), 수도권 LNG는 기준 발전기(슬랙)
    gen_idx = {}
    for p in plants:
        table, i = el[p["eq"]]
        if p["type"] == "solar":
            p["sgen"] = i
            continue
        net.sgen.drop(i, inplace=True)
        b = bus[node[p["station"], p["kv"]]]
        vm = 1.03 if p["kv"] == 765 else 1.02
        if p["id"] == "L_METRO":
            gen_idx[p["id"]] = ("ext_grid", pp.create_ext_grid(net, b, vm_pu=vm, name=p["ko"]))
        else:
            gen_idx[p["id"]] = ("gen", pp.create_gen(net, b, p_mw=0, vm_pu=vm, name=p["ko"]))
    oltc = [i for i in net.trafo.index if round(net.trafo.vn_hv_kv.at[i]) == 345]   # 345/154kV 변압기
    loads = [(eq, i) for eq, (t, i) in el.items() if t == "load"]
    dpv = [(eq, i) for eq, (t, i) in el.items() if t == "sgen" and isinstance(eq, PowerElectronicsConnection)
           and all(eq is not p["eq"] for p in plants)]

    station_of = {}
    for (sid, kv), cn in node.items():
        station_of.setdefault(sid, []).append((kv, bus[cn]))

    series = {k: [] for k in ("load", "solar", "nuclear", "coal", "lng", "losses", "minV", "maxLoading")}
    st_v = {s[0]: [] for s in STATIONS}
    ln_load = {l["id"]: [] for l in lines}
    ln_flow = {l["id"]: [] for l in lines}
    pl_p = {p["id"]: [] for p in plants}
    loss_est = 0.02 * PEAK_MW
    tan = math.tan(math.acos(PF))
    for h in range(24):
        load_mw = PEAK_MW * LOAD_CURVE[h]
        for eq, i in loads:
            net.load.at[i, "p_mw"] = eq.p * LOAD_CURVE[h]
            net.load.at[i, "q_mvar"] = eq.p * LOAD_CURVE[h] * tan
        solar_total = 0.0
        for eq, i in dpv:
            net.sgen.at[i, "p_mw"] = eq.rated_s * SOLAR_CURVE[h]; solar_total += eq.rated_s * SOLAR_CURVE[h]
        for p in plants:
            if p["type"] == "solar":
                net.sgen.at[p["sgen"], "p_mw"] = p["capMW"] * SOLAR_CURVE[h]; solar_total += p["capMW"] * SOLAR_CURVE[h]
        disp = dispatch(load_mw, solar_total, plants, loss_est)
        for pid, (t, i) in gen_idx.items():
            if t == "gen":
                net.gen.at[i, "p_mw"] = disp[pid]
        pp.runpp(net, numba=False, init="results" if h else "auto")
        # OLTC 흉내: 345/154kV 변압기 탭을 1.25% 단위로 움직여 154kV 모선 전압을 1.01 pu 근처로 (최대 ±10%)
        for _ in range(8):
            moved = False
            for i in oltc:
                vm = float(net.res_bus.vm_pu.at[net.trafo.lv_bus.at[i]])
                step = 154 * 0.0125
                # 2차 정격(vn_lv_kv)을 올리면 2차 전압이 올라간다
                if vm > 1.025 and net.trafo.vn_lv_kv.at[i] > 154 * 0.95:
                    net.trafo.at[i, "vn_lv_kv"] -= step; moved = True
                elif vm < 0.995 and net.trafo.vn_lv_kv.at[i] < 154 * 1.10:
                    net.trafo.at[i, "vn_lv_kv"] += step; moved = True
            if not moved:
                break
            pp.runpp(net, numba=False, init="results")
        if "--debug" in sys.argv and h in (0, 14):
            rl = net.res_line.join(net.line[["name"]]).sort_values("loading_percent", ascending=False)
            print(rl[["name", "loading_percent", "p_from_mw"]].head(8).to_string())
            rb = net.res_bus.join(net.bus[["name"]]).sort_values("vm_pu")
            print(rb[["name", "vm_pu", "q_mvar"]].head(6).to_string())
            rt = net.res_trafo.join(net.trafo[["name", "sn_mva"]]).sort_values("loading_percent", ascending=False)
            print(rt[["name", "sn_mva", "loading_percent"]].head(4).to_string())
            print(net.res_gen.join(net.gen[["name"]])[["name", "p_mw", "q_mvar"]].to_string(), net.res_ext_grid)
        losses = net.res_line.pl_mw.sum() + net.res_trafo.pl_mw.sum()
        loss_est = losses
        # 결과 정리
        out = {"nuclear": 0, "coal": 0, "lng": 0}
        for p in plants:
            if p["type"] == "solar":
                v = p["capMW"] * SOLAR_CURVE[h]
            else:
                t, i = gen_idx[p["id"]]
                v = float(net.res_ext_grid.p_mw.at[i]) if t == "ext_grid" else float(net.res_gen.p_mw.at[i])
                out[p["type"]] += v
            pl_p[p["id"]].append(round(v))
        for k in out:
            series[k].append(round(out[k]))
        series["load"].append(round(load_mw))
        series["solar"].append(round(solar_total))
        series["losses"].append(round(losses))
        for sid, lv in station_of.items():
            kv, b = min(lv)                              # 가장 낮은 전압 모선 = 부하가 붙는 곳
            st_v[sid].append(round(float(net.res_bus.vm_pu.at[b]), 4))
        for l in lines:
            i = el[l["eq"]][1]
            ln_load[l["id"]].append(round(float(net.res_line.loading_percent.at[i]), 1))
            ln_flow[l["id"]].append(round(float(net.res_line.p_from_mw.at[i])))
        series["minV"].append(min(v[-1] for v in st_v.values()))
        series["maxLoading"].append(max(v[-1] for v in ln_load.values()))
        print(f"{h:02d}시 수요 {load_mw:7.0f} 태양광 {solar_total:6.0f} 원전 {out['nuclear']:6.0f} 석탄 {out['coal']:6.0f} "
              f"LNG {out['lng']:6.0f} 손실 {losses:5.0f} | 최저전압 {series['minV'][-1]:.3f} 최대부하율 {series['maxLoading'][-1]:.0f}%")

    outline = json.loads((ROOT / "examples" / "twin" / "korea_outline.geojson").read_text())
    polys = [[[round(x, 3), round(y, 3)] for x, y in poly[0]] for poly in outline["geometry"]["coordinates"]]
    data = {
        "meta": {"virtual": True, "peakMW": PEAK_MW, "distSolarMW": DIST_SOLAR_MW, "hours": list(range(24)),
                 "loadCurve": LOAD_CURVE, "solarCurve": SOLAR_CURVE,
                 "objects": {k: len(m.of_type(c)) for k, c in [("Substation", Substation), ("VoltageLevel", VoltageLevel),
                             ("ACLineSegment", ACLineSegment), ("PowerTransformer", PowerTransformer),
                             ("SynchronousMachine", SynchronousMachine), ("PowerElectronicsConnection", PowerElectronicsConnection),
                             ("EnergyConsumer", EnergyConsumer)]}},
        "outline": polys,
        "stations": [{"id": s[0], "ko": s[1], "en": s[2], "lon": s[3], "lat": s[4], "levels": s[5],
                      "loadMW": round(PEAK_MW * s[6] / sum(x[6] for x in STATIONS))} for s in STATIONS],
        "lines": [{k: v for k, v in l.items() if k != "eq"} for l in lines],
        "plants": [{k: v for k, v in p.items() if k not in ("eq", "sgen", "pmin")} for p in plants],
        "series": {**series, "stationV": st_v, "lineLoading": ln_load, "lineFlow": ln_flow, "plantP": pl_p},
    }
    (ROOT / "assets" / "data").mkdir(parents=True, exist_ok=True)
    (ROOT / "assets" / "data" / "twin.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print("\n저장: assets/data/twin.json, examples/twin/korea_virtual_grid.ttl")


if __name__ == "__main__":
    main()
