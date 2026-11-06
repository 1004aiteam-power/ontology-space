# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""설비 고장 영향 분석: 자산관리 온톨로지 × 배전선로 모델(디지털 트윈) (⚠ 가상 데이터).

자산관리 온톨로지는 "M.Tr #1이 고장 나면 D/L #1 부하 8.5MW가 복구될 때까지(90일) 끊긴다"고 보고 위험도를 매긴다.
배전선로 모델(examples/feeder)을 붙이면 질문이 달라진다.
  - 정전되는 곳은 어느 구간·지역·고객이고, 중요 고객(병원)이 들어 있나?
  - 연계 개폐기로 이웃 선로에 넘기면 몇 분 만에 살릴 수 있나? 그러면 고장 영향(CoF)과 위험도는 얼마로 바뀌나?
  - 넘긴 뒤 이웃 선로에는 여유가 얼마나 남나(다음 고장에 대한 대비)?

  자산 ─pam:installedAt→ 기능 위치(CIM) ─im:feeds→ … → D/L #1 CB ≡ 배전선로 모델의 CB_DL1 (skos:exactMatch)
       ─im:feeds→ 구간(개폐기 사이) ─im:feeds→ 부하(지역·고객 수) ;  구간 ─im:tieTo→ 연계 개폐기 ─im:toFeeder→ 이웃 선로

가정: D/L #2·#3은 M.Tr #2 쪽 모선에서 나가므로 M.Tr #1 계통의 고장과 무관하다 (배전선로 그림에서는 한 모선으로 그림).
입력: assets/data/asset.json, examples/asset/asset-ontology.ttl, examples/feeder/build_feeder.py(모델·절체 탐색), assets/data/twin.json(24시간 부하 곡선)
생성: examples/impact/impact-links.ttl, assets/data/impact.json
실행: python examples/impact/build_impact.py   (저장소 루트에서, Node.js 필요)
"""
from __future__ import annotations

import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from pycim.ids import stable_mrid  # noqa: E402

HERE = Path(__file__).parent
F = runpy.run_path(str(ROOT / "examples" / "feeder" / "build_feeder.py"), run_name="impact")   # 배전선로 모델·절체 탐색 함수
A = json.loads((ROOT / "assets" / "data" / "asset.json").read_text(encoding="utf-8"))
TW = json.loads((ROOT / "assets" / "data" / "twin.json").read_text(encoding="utf-8"))
CURVE = TW["meta"]["loadCurve"]

EQ, SW, LOADS, AT, ALIAS = F["EQ"], F["SW"], F["LOADS"], F["AT"], F["POS_ALIAS"]
evaluate, best_transfer, LIMIT = F["evaluate"], F["best_transfer"], F["FEEDER_LIMIT_MW"]
SWITCH_MIN = {"auto": 3, "manual": 75}           # 절체까지 걸리는 시간(분, 가상) — 고장 복구 시뮬레이션과 같은 값
COF_CUTS = A["rules"]["cofCutsMWh"]


def cof_band(mwh: float) -> int:
    for i, c in enumerate(COF_CUTS, 1):
        if mwh < c:
            return i
    return len(COF_CUTS) + 1


def level(r: int) -> str:
    return "높음" if r >= 15 else "중간" if r >= 8 else "낮음"


# ---- D/L #1 을 개폐기 사이 구간(zone)으로 나눈다 -----------------------------------------------------
def zones() -> list[dict]:
    dl1 = [e for e in EQ if (e["cls"] == "ACLineSegment" and e["line"] == "DL1") or (e["cls"] == "EnergyConsumer" and e["id"].startswith(("LD_M", "LD_B")))]
    seen, out = set(), []
    for e0 in dl1:
        if e0["id"] in seen or e0["cls"] != "ACLineSegment":
            continue
        z, bnd = F["fault_zone"](e0["id"])
        seen |= z
        out.append(dict(segs=sorted(x for x in z if x.startswith(("DL1", "BR"))), loads=sorted(x for x in z if x.startswith("LD_")), bnd=sorted(bnd)))
    # 변전소에서 가까운 순서: 경계 구간 개폐기 번호로 정렬 (CB 쪽이 1)
    order = ["CB_DL1", "S1", "S2", "S3", "S4", "S5", "S6"]
    out.sort(key=lambda z: min(order.index(b) for b in z["bnd"] if b in order))
    for i, z in enumerate(out, 1):
        z["id"] = f"Z{i}"
        up = [b for b in z["bnd"] if b in order]
        z["up"] = min(up, key=order.index)                      # 전원 쪽 경계
        z["down"] = [b for b in up if b != z["up"]]             # 다음 구간으로 가는 개폐기
        z["ties"] = [b for b in z["bnd"] if SW[b]["kind"] == "tie"]
        z["cust"] = sum(next(l for l in LOADS if l["id"] == x)["cust"] for x in z["loads"])
        z["mw"] = round(sum(next(l for l in LOADS if l["id"] == x)["p"] for x in z["loads"]), 2)
    return out


ZONES = zones()
ZONE_OF = {x: z["id"] for z in ZONES for x in z["segs"] + z["loads"]}
TIE_FEEDER = {"T1": "DL2", "T2": "DL3", "T3": "DL2", "T4": "C11"}


def supply_after(st: dict, fault: str | None) -> dict:
    """구간별 공급 선로 (정전이면 None)."""
    reach = F["trace"](st, fault)
    return {z["id"]: (sorted(reach.get(z["segs"][0], set())) or [None])[0] for z in ZONES}


# ---- 상위 설비(자산) 고장: D/L #1 전원을 잃는다 → 연계 개폐기로 넘긴다 ---------------------------------------
normal = {k: e["normalOpen"] for k, e in SW.items()}
lost = dict(normal, CB_DL1=True)                                     # 전원 상실: D/L #1 CB를 연다
ops = best_transfer(lost, None)
after = dict(lost, **dict(ops))
EV_LOST, EV_AFTER = evaluate(lost, None), evaluate(after, None)
SOURCE_LOSS = dict(ops=[[k, v] for k, v in ops], before=EV_LOST, after=EV_AFTER, supply=supply_after(after, None),
                   margin=round(min(LIMIT - v for k, v in EV_AFTER["feederMW"].items() if k != "DL1"), 2))
DL1_MW = EV_LOST["deadMW"]
DL1_CUST = EV_LOST["deadCust"]

LOC_ORDER = [l["location"] for l in A["locations"]]                 # 전원 → D/L #1 CB 순서
ASSET = {a["asset_id"]: a for a in A["assets"]}
CHAIN = []
for i, l in enumerate(A["locations"]):
    a = ASSET.get(l["asset"]) if l["asset"] else None
    node = dict(id=l["location"], cls=l["cim_class"], ko=l["name"], asset=None)
    if a and a.get("calc"):
        c = a["calc"]
        res = {}
        for mode, m in SWITCH_MIN.items():
            # 절체가 끝날 때까지는 D/L #1 전체, 그 뒤에는 절체로도 못 살린 부하만 자산 복구 시간 동안 끊긴다
            mwh = DL1_MW * m / 60 + EV_AFTER["deadMW"] * float(a["restore_h"])
            cof = cof_band(mwh)
            res[mode] = dict(mwh=round(mwh, 2), cof=cof, risk=c["pof"] * cof, level=level(c["pof"] * cof),
                             cmi=DL1_CUST * m + EV_AFTER["deadCust"] * float(a["restore_h"]) * 60)
        node["asset"] = dict(id=a["asset_id"], name=a["name"], kind=a["kind"], restoreH=float(a["restore_h"]),
                             restoreSpareH=float(a["restore_h_with_spare"]), hi=c["hi"], pof=c["pof"],
                             base=dict(mwh=c["mwh"], cof=c["cof"], risk=c["risk"], level=c["level"]),
                             spare=dict(mwh=c["mwh_spare"], cof=c["cof_spare"], risk=c["risk_spare"], level=c["level_spare"]),
                             withTie=res)
    CHAIN.append(node)

# ---- 배전선로 구간 고장: 고장 복구(FLISR) 계획을 그대로 쓴다 ------------------------------------------
ZONE_FAULT = {}
for z in ZONES:
    p = F["FLISR"][z["segs"][0]]
    last = p["steps"][-2]                                             # 수리 직전 상태
    st = {k: k in last["open"] for k in SW}
    ZONE_FAULT[z["id"]] = dict(seg=z["segs"][0], steps=[dict(id=s["id"], ops=s["ops"], deadCust=s["deadCust"], deadMW=s["deadMW"]) for s in p["steps"]],
                               after=dict(dead=last["dead"], deadCust=last["deadCust"], deadMW=last["deadMW"], feederMW=last["feederMW"]),
                               supply=supply_after(st, z["segs"][0]), cmi=p["cmi"])

# ---- 연결 트리플 (Turtle) -----------------------------------------------------------------------
def fid(key: str) -> str:
    return f"ex:_{stable_mrid('sample-feeder', key)}"


T = ["""# ⚠ 가상 데이터. 자산관리 온톨로지(asset-ontology.ttl)와 배전선로 모델(feeder.ttl)을 잇는 트리플.
# im:feeds 는 평상시 개폐 상태에서 전원 → 부하 방향으로 계산해 넣은 '파생' 관계다 (원본은 Terminal–ConnectivityNode 연결).
@prefix im:   <https://1004aiteam-power.github.io/ontology-space/impact#> .
@prefix pam:  <https://1004aiteam-power.github.io/ontology-space/asset#> .
@prefix ex:   <http://example.org/grid#> .
@prefix cim:  <http://iec.ch/TC57/CIM100#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

im:feeds a owl:ObjectProperty, owl:TransitiveProperty ; rdfs:label "전기를 보낸다 (평상시, 하류 방향)"@ko .
im:FeederZone a owl:Class ; rdfs:label "배전선로 구간 (개폐기 사이)"@ko .
im:tieTo a owl:ObjectProperty ; rdfs:domain im:FeederZone ; rdfs:range cim:LoadBreakSwitch ; rdfs:label "닿아 있는 연계 개폐기"@ko .
im:toFeeder a owl:ObjectProperty ; rdfs:range cim:Line ; rdfs:label "연계 개폐기 건너편 선로"@ko .
im:area a owl:DatatypeProperty ; rdfs:label "지역"@ko .
im:customers a owl:DatatypeProperty ; rdfs:range xsd:integer ; rdfs:label "고객 호수"@ko .
im:critical a owl:DatatypeProperty ; rdfs:range xsd:boolean ; rdfs:label "중요 고객"@ko .

# 같은 차단기를 두 모델이 다른 IRI로 부른다: 자산관리 쪽 기능 위치 ↔ 배전선로 모델의 설비
ex:CB_22_1 skos:exactMatch """ + fid("CB_DL1") + """ .
"""]
for a, b in zip(LOC_ORDER, LOC_ORDER[1:]):
    T.append(f"ex:{a} im:feeds ex:{b} .")
T.append(f"ex:{LOC_ORDER[-1]} im:feeds {fid('CB_DL1')} .")
T.append(f"{fid('CB_DL1')} im:feeds im:Z1 .")
for z in ZONES:
    T.append(f"im:{z['id']} a im:FeederZone ; rdfs:label \"D/L #1 {z['id']} ({z['up']} 뒤)\"@ko ; im:feeds {', '.join(fid(x) for x in z['loads']) if z['loads'] else 'im:nothing'} .")
    for d in z["down"]:
        nxt = next(y for y in ZONES if y["up"] == d)
        T.append(f"im:{z['id']} im:feeds {fid(d)} . {fid(d)} im:feeds im:{nxt['id']} .")
    for t in z["ties"]:
        T.append(f"im:{z['id']} im:tieTo {fid(t)} . {fid(t)} im:toFeeder {fid('LINE-' + TIE_FEEDER[t])} .")
for l in LOADS:
    if l["id"].startswith(("LD_M", "LD_B")):
        T.append(f"{fid(l['id'])} a cim:EnergyConsumer ; im:area \"{l['area']}\"@ko ; im:customers {l['cust']} ; im:critical {str(l['critical']).lower()} .")
T.append("im:nothing a rdfs:Resource .")
TTL = "\n".join(T) + "\n"
(HERE / "impact-links.ttl").write_text(TTL, encoding="utf-8")

# 역량 질문 (한국어, 영어). 같은 순서의 Cypher가 아래 CYPHER 목록
CQ = [
    ("M.Tr #1 본체가 고장 나면 정전되는 고객은 모두 몇 호인가?",
     "If the M.Tr #1 body fails, how many customers lose power?"),
    ("그중 중요 고객은?",
     "Which of them are critical customers?"),
    ("위험도 '높음' 자산이 끊는 구간은 어느 이웃 선로로 넘길 수 있나?",
     "Which neighbouring feeders can take the zones cut off by high-risk assets?"),
    ("자산이 등록되지 않은 기능 위치(빈 자리)는 고장 나면 몇 호에 영향을 주나?",
     "Functional locations with no asset installed: how many customers do they affect?"),
]
# 웹페이지에 보여 주는 같은 질문의 Cypher (Neo4j). assets/cypher/cq.js와 같아야 함 — tests/cypher.test.mjs가 결과까지 대조
CYPHER = [
    """// FEEDS* : 공급 방향으로 몇 단계든 따라감 (가변 길이 경로)
MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(ld:EnergyConsumer)
WITH DISTINCT ld
RETURN count(ld) AS loads, sum(ld.customers) AS customers""",
    """MATCH (:Asset {code: 'AS-TR-0007'})-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(ld)
WHERE ld.critical = true
RETURN DISTINCT ld.area AS area""",
    """MATCH (a:Asset)-[:INSTALLED_AT]->(loc)-[:FEEDS*]->(z:FeederZone)-[:TIE_TO]->(t)
WHERE a.riskScore >= 15
RETURN DISTINCT a.code AS asset, z.label AS zone, t.name AS tie
ORDER BY zone""",
    """// 자산관리 쪽 기능 위치만 (ex:_mRID 는 배전선로 모델 설비)
MATCH (loc)-[:FEEDS]->()
WHERE loc.uri STARTS WITH 'http://example.org/grid#'
  AND NOT loc.uri STARTS WITH 'http://example.org/grid#_'
  AND NOT EXISTS { (:Asset)-[:INSTALLED_AT]->(loc) }
MATCH (loc)-[:FEEDS*]->(ld)
WHERE ld.customers IS NOT NULL
WITH DISTINCT loc, ld
RETURN 'ex:' + split(loc.uri, '#')[1] AS loc, sum(ld.customers) AS customers""",
]


def run_cq():
    """세 Turtle을 Neo4j식 속성 그래프 하나로 합쳐 CYPHER를 실행 (tools/cypher.mjs)"""
    from pycim.cypher import run as run_cypher
    res = run_cypher(ttl=["examples/impact/impact-links.ttl", "examples/asset/asset-ontology.ttl", "examples/feeder/feeder.ttl"], query=CYPHER)
    cell = lambda v: "" if v is None else str(v)  # noqa: E731
    return [dict(q=ko, en=en, cypher=cy, rows=[[cell(v) for v in row] for row in r["rows"]])
            for (ko, en), cy, r in zip(CQ, CYPHER, res["queries"])]


CQ_OUT = run_cq()

loads_web = [dict(id=l["id"], area=l["area"], areaEn=l["areaEn"], cust=l["cust"], p=l["p"], critical=l["critical"], zone=ZONE_OF[l["id"]])
             for l in LOADS if l["id"].startswith(("LD_M", "LD_B"))]
web = dict(virtual=True, limitMW=LIMIT, curve=CURVE, switchMin=SWITCH_MIN, cofCuts=COF_CUTS, dl1MW=DL1_MW, dl1Cust=DL1_CUST,
           chain=CHAIN, zones=[{k: v for k, v in z.items()} for z in ZONES], loads=loads_web, tieFeeder=TIE_FEEDER,
           neighbours={k: dict(ko=v["ko"], mw=EV_LOST["feederMW"][k]) for k, v in F["web"]["feeders"].items() if k != "DL1"},
           sourceLoss=SOURCE_LOSS, zoneFault=ZONE_FAULT, cq=CQ_OUT)
(ROOT / "assets" / "data" / "impact.json").write_text(json.dumps(web, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

if __name__ == "__main__":
    print(f"D/L #1 {DL1_MW} MW · {DL1_CUST}호 · 구간 {len(ZONES)}개: " + ", ".join(f"{z['id']}({z['up']}→{z['down']}, {z['cust']}호, 연계 {z['ties']})" for z in ZONES))
    print(f"전원 상실 시 절체: {ops} → 남는 정전 {EV_AFTER['deadCust']}호 · 선로 {EV_AFTER['feederMW']} · 이웃 최소 여유 {SOURCE_LOSS['margin']} MW")
    for n in CHAIN:
        a = n["asset"]
        if not a:
            print(f"  {n['id']:9s} 자산 미등록")
            continue
        print(f"  {n['id']:9s} {a['id']} 위험도 {a['base']['risk']}({a['base']['level']}) → 연계 절체 자동 {a['withTie']['auto']['risk']}({a['withTie']['auto']['level']}) / "
              f"수동 {a['withTie']['manual']['risk']}({a['withTie']['manual']['level']})  MWh {a['base']['mwh']} → {a['withTie']['auto']['mwh']} / {a['withTie']['manual']['mwh']}")
    for c in CQ_OUT:
        print("CQ", c["q"], c["rows"])
