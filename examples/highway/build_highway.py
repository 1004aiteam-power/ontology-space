# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""가상 전국 고속도로·국도 온톨로지 + 24시간 차량 흐름 (⚠ 가상 데이터).

원본: examples/highway/data/*.csv  ← 사람이 고치는 곳은 여기뿐
      nodes(도시 노드·존 가중치) · routes(노선, 고속도로/국도) · sections(구간·차로·자유속도) · scenarios(평일 기본, 사고)
생성: examples/highway/highway-ontology.ttl   OWL + GeoSPARQL (TBox + ABox, 요약 교통 상태 포함)
      assets/data/highway.json                웹페이지(highway.html) 데이터 (시간별 교통량 전체)
검증: shapes/highway-shapes.ttl (SHACL) + 역량 질문을 SPARQL로 재현

교통 모형 (모두 단순화한 가상 모형)
  수요   T_ij(일) = k · f · (W_i · W_j)^0.8 / max(40, d_ij)^1.2   (중력모형, W=존 가중치, d=직선거리 km,
         수도권 안(서울·인천·수원) 통행은 f=0.3으로 줄인다)
         시간 분포는 평일 프로파일. 서울 관련 통행은 아침에 서울 방향, 저녁에 서울 밖 방향으로 치우친다.
  비용   t = t0 · (1 + 0.15 (v/c)^4)          (BPR 함수, t0 = 길이 / 자유속도)
  배정   시간대마다 이용자 균형(MSA, 40회 반복)
  용량   차로당 고속도로 2,000 · 국도 1,200 대/시, 자유속도 고속도로 100 · 국도 70 km/h
         고속도로와 국도를 한 망으로 배정한다: 차는 둘 중 빠른 길을 고른다
  규모 k 가장 붐비는 고속도로 구간의 기본 시나리오 최대 v/c가 1.15가 되도록 맞춘다 (가상 보정)
  서비스수준(LOS, v/c 기준 단순화) A <0.35, B <0.55, C <0.75, D <0.90, E ≤1.00, F >1.00

실행: python examples/highway/build_highway.py   (저장소 루트에서, rdflib · pyshacl 필요)
"""
from __future__ import annotations

import csv
import heapq
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = HERE / "data"
CAP_PER_LANE = {"EXPRESSWAY": 2000, "NATIONAL": 1200}   # 국도는 신호·교차로가 있어 차로당 용량이 낮다
DETOUR = {"EXPRESSWAY": 1.2, "NATIONAL": 1.3}          # 직선거리 대비 실제 길이 (굴곡 계수)
TARGET_MAX_VC = 1.15
MSA_ITERS = 40
PROFILE = [0.012, 0.008, 0.006, 0.006, 0.010, 0.025, 0.050, 0.070, 0.068, 0.055, 0.050, 0.050,
           0.050, 0.050, 0.052, 0.055, 0.062, 0.072, 0.070, 0.055, 0.040, 0.032, 0.026, 0.018]
PROFILE = [p / sum(PROFILE) for p in PROFILE]
METRO = "SEOUL"
METRO_AREA = {"SEOUL", "INCHEON", "SUWON"}   # 수도권 안 통행은 대부분 일반도로를 쓴다고 보고 줄인다
METRO_INTRA = 0.3
WEIGHT_EXP, DIST_EXP, D_MIN = 0.8, 1.2, 40.0
LOS = [("A", 0.35), ("B", 0.55), ("C", 0.75), ("D", 0.90), ("E", 1.00), ("F", math.inf)]
OD_WATCH = [("SEOUL", "BUSAN"), ("BUSAN", "SEOUL"), ("SEOUL", "GWANGJU"), ("SEOUL", "GANGNEUNG")]


def read(name: str) -> list[dict]:
    with open(DATA / name, encoding="utf-8") as f:
        return [{k: (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


def km(a: dict, b: dict) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"])))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def los_grade(vc: float) -> str:
    for g, lim in LOS:
        if (vc < lim) if g != "E" else (vc <= lim):
            return g
    return "F"


# ---------------------------------------------------------------- 원본 → 네트워크
nodes = read("nodes.csv")
routes = read("routes.csv")
sections = read("sections.csv")
scenarios = read("scenarios.csv")
N = {n["node_id"]: n for n in nodes}
R = {r["route_id"]: r for r in routes}
ZONES = [n["node_id"] for n in nodes]

for i, s in enumerate(sections, 1):
    s["section_id"] = f"S{i:02d}"
    s["cls"] = R[s["route_id"]]["road_class"]
    s["km"] = round(km(N[s["a"]], N[s["b"]]) * DETOUR[s["cls"]], 1)

links = []                                                     # 방향이 있는 링크: 구간마다 2개
for s in sections:
    for d, (fr, to) in (("F", (s["a"], s["b"])), ("R", (s["b"], s["a"]))):
        links.append(dict(link_id=f"{s['section_id']}{d}", section=s["section_id"], route=s["route_id"], cls=s["cls"], frm=fr, to=to,
                          lanes=int(s["lanes"]), km=s["km"], kph=float(s["free_kph"]),
                          t0=s["km"] / float(s["free_kph"])))
L = {lk["link_id"]: lk for lk in links}
OUT: dict[str, list[dict]] = {n: [] for n in N}
for lk in links:
    OUT[lk["frm"]].append(lk)

node_routes = {n: sorted({s["route_id"] for s in sections if n in (s["a"], s["b"])}) for n in N}
# 나들목(IC) = 고속도로 구간이 닿는 노드. 국도만 닿는 노드는 일반 교차점(Intersection)
on_expressway = {n: any(s["cls"] == "EXPRESSWAY" for s in sections if n in (s["a"], s["b"])) for n in N}


def capacity(lk: dict, scen: dict, h: int) -> float:
    lanes = lk["lanes"]
    if scen["route_id"] and lk["route"] == scen["route_id"] and lk["frm"] == scen["from"] and lk["to"] == scen["to"] \
            and int(scen["start_h"]) <= h < int(scen["end_h"]):
        lanes -= int(scen["lanes_closed"])
    return lanes * CAP_PER_LANE[lk["cls"]]


def cost(lk: dict, v: float, c: float) -> float:
    return lk["t0"] * (1 + 0.15 * (v / c) ** 4)


def shortest(origin: str, w: dict[str, float]) -> dict[str, tuple[float, str | None]]:
    dist = {origin: (0.0, None)}
    pq = [(0.0, origin)]
    done = set()
    while pq:
        dcur, u = heapq.heappop(pq)
        if u in done:
            continue
        done.add(u)
        for lk in OUT[u]:
            nd = dcur + w[lk["link_id"]]
            if lk["to"] not in dist or nd < dist[lk["to"]][0]:
                dist[lk["to"]] = (nd, lk["link_id"])
                heapq.heappush(pq, (nd, lk["to"]))
    return dist


def path_links(tree, dest) -> list[str]:
    out = []
    while tree[dest][1]:
        lid = tree[dest][1]
        out.append(lid)
        dest = L[lid]["frm"]
    return out[::-1]


# ---------------------------------------------------------------- 수요 (중력모형)
def daily_demand(k: float) -> dict[tuple[str, str], float]:
    T = {}
    for i in ZONES:
        for j in ZONES:
            if i != j:
                d = max(D_MIN, km(N[i], N[j]))
                f = METRO_INTRA if i in METRO_AREA and j in METRO_AREA else 1.0
                T[(i, j)] = k * f * (float(N[i]["zone_weight"]) * float(N[j]["zone_weight"])) ** WEIGHT_EXP / d ** DIST_EXP
    return T


def hourly(T: dict, h: int) -> dict:
    out = {}
    for (i, j), v in T.items():
        f = 1.0
        if 6 <= h <= 9:
            f = 1.35 if j == METRO else 0.65 if i == METRO else 1.0
        elif 17 <= h <= 20:
            f = 0.70 if j == METRO else 1.30 if i == METRO else 1.0
        out[(i, j)] = v * PROFILE[h] * f
    return out


def assign(od: dict, scen: dict, h: int) -> dict[str, float]:
    caps = {lid: capacity(lk, scen, h) for lid, lk in L.items()}
    flow = {lid: 0.0 for lid in L}
    by_origin: dict[str, list] = {}
    for (i, j), v in od.items():
        by_origin.setdefault(i, []).append((j, v))
    for it in range(1, MSA_ITERS + 1):
        w = {lid: cost(L[lid], flow[lid], caps[lid]) for lid in L}
        aux = {lid: 0.0 for lid in L}
        for o, dests in by_origin.items():
            tree = shortest(o, w)
            for dst, v in dests:
                for lid in path_links(tree, dst):
                    aux[lid] += v
        a = 1.0 / it
        for lid in L:
            flow[lid] += a * (aux[lid] - flow[lid])
    return flow


def run(k: float, scen: dict, hours=range(24)) -> dict[int, dict[str, float]]:
    T = daily_demand(k)
    return {h: assign(hourly(T, h), scen, h) for h in hours}


BASE = next(s for s in scenarios if s["scenario_id"] == "BASE")
# 규모 보정: 피크 시간대(8시, 18시)만으로 k를 맞춘 뒤 24시간 전체를 계산
k = 1.0
for _ in range(5):
    peak = run(k, BASE, hours=(8, 18))
    mx = max(f / capacity(L[lid], BASE, h) for h, fl in peak.items() for lid, f in fl.items() if L[lid]["cls"] == "EXPRESSWAY")
    k *= (TARGET_MAX_VC / mx) ** 0.85

results = {}
for scen in scenarios:
    flows = run(k, scen)
    per_link = {}
    for lid, lk in L.items():
        vol = [round(flows[h][lid]) for h in range(24)]
        vc = [round(flows[h][lid] / capacity(lk, scen, h), 3) for h in range(24)]
        spd = [round(lk["km"] / cost(lk, flows[h][lid], capacity(lk, scen, h)), 1) for h in range(24)]
        per_link[lid] = dict(vol=vol, vc=vc, spd=spd, los=[los_grade(x) for x in vc], daily=sum(vol))
    odt = {}
    for o, d_ in OD_WATCH:
        tt = []
        for h in range(24):
            w = {lid: cost(L[lid], flows[h][lid], capacity(L[lid], scen, h)) for lid in L}
            tree = shortest(o, w)
            tt.append(round(tree[d_][0] * 60))
        odt[f"{o}-{d_}"] = tt
    results[scen["scenario_id"]] = dict(links=per_link, od=odt)

DAILY_TRIPS = round(sum(daily_demand(k).values()))


def vkm(scen: str, cls: str, hours=range(24)) -> float:
    return sum(results[scen]["links"][lid]["vol"][h] * L[lid]["km"] for lid in L if L[lid]["cls"] == cls for h in hours)


def veh(scen: str, cls: str, hours) -> float:
    return sum(results[scen]["links"][lid]["vol"][h] for lid in L if L[lid]["cls"] == cls for h in hours)


INC = next(s_ for s_ in scenarios if s_["route_id"])
inc_hours = range(int(INC["start_h"]), int(INC["end_h"]))
STATS = dict(
    nationalShareVkm=round(vkm("BASE", "NATIONAL") / (vkm("BASE", "NATIONAL") + vkm("BASE", "EXPRESSWAY")), 3),
    nationalVehIncidentHours=dict(base=round(veh("BASE", "NATIONAL", inc_hours)), incident=round(veh("INCIDENT", "NATIONAL", inc_hours))),
    maxVc={c: {sc: round(max(max(results[sc]["links"][lid]["vc"]) for lid in L if L[lid]["cls"] == c), 3) for sc in results}
           for c in ("EXPRESSWAY", "NATIONAL")},
)

# ---------------------------------------------------------------- Turtle (OWL + GeoSPARQL)
PFX = """@prefix hw:   <https://1004aiteam-power.github.io/ontology-space/highway#> .
@prefix geo:  <http://www.opengis.net/ont/geosparql#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
"""
TBOX = """
<https://1004aiteam-power.github.io/ontology-space/highway> a owl:Ontology ;
    rdfs:label "가상 전국 고속도로 온톨로지"@ko ; owl:versionInfo "0.1" ;
    rdfs:comment "노선·구간·방향 링크·노드(IC/JC)·교통 존·수요·시나리오·교통 상태. 위치는 GeoSPARQL WKT. 모든 교통 데이터는 가상."@ko .

### 클래스
hw:Route a owl:Class ; rdfs:label "노선"@ko ; rdfs:comment "이름이 붙은 도로. 여러 구간의 순서 있는 묶음."@ko .
hw:Node a owl:Class ; rdfs:subClassOf geo:Feature ; rdfs:label "노드"@ko .
hw:Expressway a owl:Class ; rdfs:subClassOf hw:Route ; rdfs:label "고속도로"@ko ; rdfs:comment "출입이 제한된 도로. 신호가 없고 용량이 크다."@ko .
hw:NationalRoad a owl:Class ; rdfs:subClassOf hw:Route ; rdfs:label "일반국도"@ko ; rdfs:comment "번호가 붙은 국도. 교차로·신호가 있어 속도와 차로당 용량이 낮다."@ko .
hw:Expressway owl:disjointWith hw:NationalRoad .
hw:Interchange a owl:Class ; rdfs:subClassOf hw:Node ; rdfs:label "나들목(IC)"@ko ; rdfs:comment "고속도로 구간이 닿아 고속도로에 들어오고 나갈 수 있는 지점."@ko .
hw:Intersection a owl:Class ; rdfs:subClassOf hw:Node ; rdfs:label "일반 교차점"@ko ; rdfs:comment "국도만 닿는 지점. 고속도로로 바로 들어갈 수 없다."@ko .
hw:Interchange owl:disjointWith hw:Intersection .
hw:Junction a owl:Class ; rdfs:subClassOf hw:Node ; rdfs:label "분기점(JC)"@ko ; rdfs:comment "둘 이상의 노선이 만나는 지점. IC와 배타적이지 않다(다중 분류)."@ko .
hw:Section a owl:Class ; rdfs:subClassOf geo:Feature ; rdfs:label "구간"@ko ; rdfs:comment "두 노드 사이의 물리적인 도로. 방향이 없다."@ko .
hw:Link a owl:Class ; rdfs:label "방향 링크"@ko ; rdfs:comment "구간의 한 방향(상행 또는 하행). 교통량·속도는 링크에 붙는다."@ko .
hw:Zone a owl:Class ; rdfs:label "교통 존"@ko ; rdfs:comment "통행이 생기고 끝나는 지역(도시). 가중치는 가상."@ko .
hw:Demand a owl:Class ; rdfs:label "기종점 수요(OD)"@ko .
hw:Scenario a owl:Class ; rdfs:label "시나리오"@ko .
hw:Incident a owl:Class ; rdfs:label "사고·차로 차단"@ko .
hw:TrafficState a owl:Class ; rdfs:label "교통 상태"@ko ; rdfs:comment "한 링크의 한 시나리오·시각 상태. 여기에는 첨두 시각만 싣고, 24시간 전체는 highway.json에 있다."@ko .
hw:LevelOfService a owl:Class ; rdfs:label "서비스수준(LOS)"@ko .
hw:Section owl:disjointWith hw:Link, hw:Node .

### 객체 속성
hw:onRoute a owl:ObjectProperty ; rdfs:domain hw:Section ; rdfs:range hw:Route ; rdfs:label "소속 노선"@ko .
hw:endpoint a owl:ObjectProperty ; rdfs:domain hw:Section ; rdfs:range hw:Node ; rdfs:label "양 끝 노드"@ko .
hw:ofSection a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:Link ; rdfs:range hw:Section ; rdfs:label "소속 구간"@ko .
hw:fromNode a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:Link ; rdfs:range hw:Node ; rdfs:label "출발 노드"@ko .
hw:toNode a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:Link ; rdfs:range hw:Node ; rdfs:label "도착 노드"@ko .
hw:oppositeOf a owl:ObjectProperty, owl:SymmetricProperty ; rdfs:domain hw:Link ; rdfs:range hw:Link ; rdfs:label "반대 방향 링크"@ko .
hw:adjacentTo a owl:ObjectProperty ; rdfs:domain hw:Node ; rdfs:range hw:Node ; rdfs:label "링크로 바로 이어진 노드"@ko ;
    rdfs:comment "링크에서 생성한 지름길 (fromNode → toNode)."@ko .
hw:servesZone a owl:ObjectProperty ; rdfs:domain hw:Node ; rdfs:range hw:Zone ; rdfs:label "연결 존"@ko .
hw:connectsRoute a owl:ObjectProperty ; rdfs:domain hw:Junction ; rdfs:range hw:Route ; rdfs:label "만나는 노선"@ko .
hw:originZone a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:Demand ; rdfs:range hw:Zone .
hw:destinationZone a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:Demand ; rdfs:range hw:Zone .
hw:affectsLink a owl:ObjectProperty ; rdfs:domain hw:Incident ; rdfs:range hw:Link .
hw:hasIncident a owl:ObjectProperty ; rdfs:domain hw:Scenario ; rdfs:range hw:Incident .
hw:onLink a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:TrafficState ; rdfs:range hw:Link .
hw:inScenario a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:TrafficState ; rdfs:range hw:Scenario .
hw:los a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain hw:TrafficState ; rdfs:range hw:LevelOfService .

### 데이터 속성
hw:code a owl:DatatypeProperty ; rdfs:range xsd:string .
hw:routeNumber a owl:DatatypeProperty ; rdfs:domain hw:NationalRoad ; rdfs:range xsd:integer ; rdfs:label "노선 번호"@ko .
hw:routeOrder a owl:DatatypeProperty ; rdfs:domain hw:Section ; rdfs:range xsd:integer ; rdfs:label "노선 안 순서"@ko .
hw:lengthKm a owl:DatatypeProperty ; rdfs:range xsd:decimal .
hw:lanes a owl:DatatypeProperty ; rdfs:domain hw:Link ; rdfs:range xsd:integer ; rdfs:label "한 방향 차로 수"@ko .
hw:capacityVph a owl:DatatypeProperty ; rdfs:domain hw:Link ; rdfs:range xsd:integer ; rdfs:label "용량(대/시)"@ko .
hw:freeSpeedKph a owl:DatatypeProperty ; rdfs:domain hw:Link ; rdfs:range xsd:decimal .
hw:zoneWeight a owl:DatatypeProperty ; rdfs:domain hw:Zone ; rdfs:range xsd:decimal ; rdfs:label "존 가중치(가상)"@ko .
hw:dailyTrips a owl:DatatypeProperty ; rdfs:domain hw:Demand ; rdfs:range xsd:decimal .
hw:hour a owl:DatatypeProperty ; rdfs:range xsd:integer .
hw:startHour a owl:DatatypeProperty ; rdfs:domain hw:Incident ; rdfs:range xsd:integer .
hw:endHour a owl:DatatypeProperty ; rdfs:domain hw:Incident ; rdfs:range xsd:integer .
hw:lanesClosed a owl:DatatypeProperty ; rdfs:domain hw:Incident ; rdfs:range xsd:integer .
hw:volumeVph a owl:DatatypeProperty ; rdfs:domain hw:TrafficState ; rdfs:range xsd:integer .
hw:vcRatio a owl:DatatypeProperty ; rdfs:domain hw:TrafficState ; rdfs:range xsd:decimal .
hw:speedKph a owl:DatatypeProperty ; rdfs:domain hw:TrafficState ; rdfs:range xsd:decimal .
hw:dailyVolume a owl:DatatypeProperty ; rdfs:domain hw:Link ; rdfs:range xsd:integer ; rdfs:label "기본 시나리오 하루 교통량"@ko .
hw:maxVc a owl:DatatypeProperty ; rdfs:range xsd:decimal .

### 서비스수준
"""
LOS_TTL = "\n".join(f'hw:LOS_{g} a hw:LevelOfService ; rdfs:label "LOS {g}" ; hw:maxVc {("1.0E9" if lim == math.inf else lim)} .'
                    for g, lim in LOS)


def lit(s: str) -> str:
    return '"' + s.replace('"', '\\"') + '"@ko'


def en(s: str) -> str:
    return '"' + s.replace('"', '\\"') + '"@en'


lines = [PFX, TBOX, LOS_TTL, "\n### 노선"]
for r in routes:
    cls = "hw:Expressway" if r["road_class"] == "EXPRESSWAY" else "hw:NationalRoad"
    num = f" ; hw:routeNumber {r['number']}" if r["number"] else ""
    lines.append(f"hw:R_{r['route_id']} a {cls} ; hw:code \"{r['route_id']}\" ; rdfs:label {lit(r['ko'])}, {en(r['en'])}{num} .")
lines.append("\n### 노드와 존")
for n in nodes:
    nid = n["node_id"]
    types = ["hw:Interchange" if on_expressway[nid] else "hw:Intersection"] + (["hw:Junction"] if len(node_routes[nid]) >= 2 else [])
    p = [f"hw:N_{nid} a {', '.join(types)}", f'hw:code "{nid}"', f"rdfs:label {lit(n['ko'])}, {en(n['en'])}",
         f"hw:servesZone hw:Z_{nid}",
         f'geo:hasGeometry [ geo:asWKT "POINT({n["lon"]} {n["lat"]})"^^geo:wktLiteral ]']
    if len(node_routes[nid]) >= 2:
        p.append("hw:connectsRoute " + ", ".join(f"hw:R_{r}" for r in node_routes[nid]))
    adj = sorted({lk["to"] for lk in OUT[nid]})
    p.append("hw:adjacentTo " + ", ".join(f"hw:N_{a}" for a in adj))
    lines.append(" ;\n    ".join(p) + " .")
    lines.append(f"hw:Z_{nid} a hw:Zone ; rdfs:label {lit(n['ko'] + ' 존')} ; hw:zoneWeight {n['zone_weight']} .")
lines.append("\n### 구간과 방향 링크")
order: dict[str, int] = {}
for s in sections:
    order[s["route_id"]] = order.get(s["route_id"], 0) + 1
    a, b = N[s["a"]], N[s["b"]]
    lines.append(f"hw:{s['section_id']} a hw:Section ; hw:code \"{s['section_id']}\" ; rdfs:label {lit(a['ko'] + '–' + b['ko'])} ; hw:onRoute hw:R_{s['route_id']} ; "
                 f"hw:routeOrder {order[s['route_id']]} ; hw:endpoint hw:N_{s['a']}, hw:N_{s['b']} ; hw:lengthKm {s['km']} ; "
                 f'geo:hasGeometry [ geo:asWKT "LINESTRING({a["lon"]} {a["lat"]}, {b["lon"]} {b["lat"]})"^^geo:wktLiteral ] .')
base_links = results["BASE"]["links"]
for lk in links:
    opp = lk["link_id"][:-1] + ("R" if lk["link_id"].endswith("F") else "F")
    lines.append(f"hw:{lk['link_id']} a hw:Link ; hw:code \"{lk['link_id']}\" ; hw:ofSection hw:{lk['section']} ; "
                 f"hw:fromNode hw:N_{lk['frm']} ; hw:toNode hw:N_{lk['to']} ; hw:oppositeOf hw:{opp} ; "
                 f"hw:lanes {lk['lanes']} ; hw:capacityVph {lk['lanes'] * CAP_PER_LANE[lk['cls']]} ; hw:freeSpeedKph {lk['kph']} ; "
                 f"hw:lengthKm {lk['km']} ; hw:dailyVolume {base_links[lk['link_id']]['daily']} .")
lines.append("\n### 시나리오와 사고")
for sc in scenarios:
    p = [f"hw:SC_{sc['scenario_id']} a hw:Scenario", f"rdfs:label {lit(sc['ko'])}, {en(sc['en'])}"]
    if sc["route_id"]:
        p.append(f"hw:hasIncident hw:INC_{sc['scenario_id']}")
    lines.append(" ; ".join(p) + " .")
    if sc["route_id"]:
        tgt = next(lk for lk in links if lk["route"] == sc["route_id"] and lk["frm"] == sc["from"] and lk["to"] == sc["to"])
        lines.append(f"hw:INC_{sc['scenario_id']} a hw:Incident ; hw:affectsLink hw:{tgt['link_id']} ; hw:startHour {sc['start_h']} ; "
                     f"hw:endHour {sc['end_h']} ; hw:lanesClosed {sc['lanes_closed']} ; rdfs:comment {lit(sc['note'])} .")
lines.append("\n### 교통 상태 (링크·시나리오별 최대 v/c 시각)")
for sc in scenarios:
    for lid, r in results[sc["scenario_id"]]["links"].items():
        h = max(range(24), key=lambda x: r["vc"][x])
        lines.append(f"hw:TS_{sc['scenario_id']}_{lid} a hw:TrafficState ; hw:onLink hw:{lid} ; hw:inScenario hw:SC_{sc['scenario_id']} ; "
                     f"hw:hour {h} ; hw:volumeVph {r['vol'][h]} ; hw:vcRatio {r['vc'][h]} ; hw:speedKph {r['spd'][h]} ; hw:los hw:LOS_{r['los'][h]} .")
lines.append("\n### 기종점 수요 (하루, 가상)")
for (i, j), v in sorted(daily_demand(k).items()):
    lines.append(f"hw:D_{i}_{j} a hw:Demand ; hw:originZone hw:Z_{i} ; hw:destinationZone hw:Z_{j} ; hw:dailyTrips {round(v)} .")
TTL = "\n".join(lines) + "\n"
(HERE / "highway-ontology.ttl").write_text(TTL, encoding="utf-8")

# ---------------------------------------------------------------- 표준 정렬 (SKOS) + 표준 형식 내보내기
# 원본: data/alignment.csv. 표준 용어는 우리 쪽 SKOS 개념(hwx:)으로 두고 출처 URL을 붙인다.
# 공식 OWL IRI를 확인하지 못한 표준의 IRI를 지어내지 않기 위해서다.
alignment = read("alignment.csv")
SKOS_REL = {"exact": "skos:exactMatch", "close": "skos:closeMatch", "broad": "skos:broadMatch",
            "narrow": "skos:narrowMatch", "related": "skos:relatedMatch", "none": None}
SCHEMES = {"INSPIRE": ("INSPIRE 교통망 - 도로 (Transport Networks, Road)", "INSPIRE Transport Networks – Road"),
           "KR_NODELINK": ("국가 표준 노드·링크 (국토교통부)", "Korean standard node-link (MOLIT)"),
           "GeoSPARQL": ("OGC GeoSPARQL", "OGC GeoSPARQL")}


def std_iri(m: dict) -> str:
    if m["standard"] == "GeoSPARQL":
        return m["std_term"]                                  # geo:Feature 는 실제 표준 IRI
    return f"hwx:{m['map_id']}_term"


AL = ["""@prefix hw:   <https://1004aiteam-power.github.io/ontology-space/highway#> .
@prefix hwx:  <https://1004aiteam-power.github.io/ontology-space/highway-std#> .
@prefix geo:  <http://www.opengis.net/ont/geosparql#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dct:  <http://purl.org/dc/terms/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

# 가상 고속도로·국도 온톨로지 ↔ 국제·국내 표준 정렬. 생성: build_highway.py (원본 data/alignment.csv)
# owl:equivalentClass 대신 SKOS 대응 관계를 쓴다: 표준과 뜻이 '가깝다'와 '같다'를 구분하고,
# 표준의 의미를 우리 추론에 그대로 끌어오지 않기 위해서다.
hwx:Mapping a rdfs:Class ; rdfs:label "표준 대응 기록"@ko .
"""]
for sid, (ko_, en_) in SCHEMES.items():
    if sid != "GeoSPARQL":
        AL.append(f"hwx:{sid} a skos:ConceptScheme ; skos:prefLabel {lit(ko_)}, {en(en_)} .")
for m in alignment:
    if m["standard"] != "GeoSPARQL" and m["relation"] != "none":
        AL.append(f"{std_iri(m)} a skos:Concept ; skos:inScheme hwx:{m['standard']} ; skos:prefLabel {lit(m['std_term'])}"
                  + (f" ; dct:source <{m['source']}>" if m["source"] else "") + " .")
    rel = SKOS_REL[m["relation"]]
    if rel:
        AL.append(f"{m['our_term']} {rel} {std_iri(m)} .")
    p = [f"hwx:{m['map_id']} a hwx:Mapping", f"hwx:subject {m['our_term']}", f'hwx:standard hwx:{m["standard"]}',
         f"hwx:standardTerm {lit(m['std_term'])}", f'hwx:relation "{m["relation"]}"', f"rdfs:comment {lit(m['note_ko'])}, {en(m['note_en'])}",
         f'hwx:verified {"true" if m["verified"] == "Y" else "false"}']
    if m["source"]:
        p.append(f"dct:source <{m['source']}>")
    AL.append(" ; ".join(p) + " .")
ALIGN_TTL = "\n".join(AL) + "\n"
(HERE / "highway-alignment.ttl").write_text(ALIGN_TTL, encoding="utf-8")

# 표준노드링크 필드 이름을 따른 예시 내보내기. ID 체계와 ROAD_RANK 코드값은 원문 미확인 (가정값).
RANK_ASSUMED = {"EXPRESSWAY": "101", "NATIONAL": "103"}
EXP = HERE / "export"
EXP.mkdir(exist_ok=True)
with open(EXP / "std_link.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["LINK_ID", "F_NODE", "T_NODE", "LANES", "ROAD_RANK", "ROAD_NO", "ROAD_NAME", "MAX_SPD", "LENGTH"])
    for lk in links:
        r = R[lk["route"]]
        w.writerow([lk["link_id"], lk["frm"], lk["to"], lk["lanes"], RANK_ASSUMED[lk["cls"]], r["number"], r["ko"],
                    int(lk["kph"]), round(lk["km"] * 1000)])
with open(EXP / "std_node.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["NODE_ID", "NODE_NAME", "NODE_TYPE", "LON", "LAT"])
    for n in nodes:
        nid = n["node_id"]
        ntype = ("IC" if on_expressway[nid] else "교차점") + ("·JC" if len(node_routes[nid]) >= 2 else "")
        w.writerow([nid, n["ko"], ntype, n["lon"], n["lat"]])
(EXP / "README.md").write_text("""# 표준노드링크 형식 내보내기 (예시)

`build_highway.py`가 만든 파일입니다. 국토교통부 표준노드링크의 필드 이름(F_NODE, T_NODE, LANES, ROAD_RANK 등)을 따랐지만,
아래 값은 **원문 지침을 확인하지 못한 가정**입니다.

- LINK_ID / NODE_ID: 이 사례의 코드(S04F, DAEJEON 등)를 그대로 썼습니다. 실제 표준의 ID 자릿수·권역 코드 체계가 아닙니다.
- ROAD_RANK: 고속도로 101, 국도 103으로 두었습니다. 원문 코드표로 확인해야 합니다.
- NODE_TYPE: 실제 코드값 대신 IC / 교차점 / ·JC 글자로 적었습니다.
- MAX_SPD: 법정 제한속도가 아니라 교통 모형의 자유속도입니다.
- LENGTH: 미터. 직선거리 × 굴곡 계수로 만든 가상 값입니다.

⚠ 모든 데이터는 가상입니다.
""", encoding="utf-8")

# ---------------------------------------------------------------- 검증: SHACL + SPARQL
import rdflib  # noqa: E402
from pyshacl import validate  # noqa: E402

g = rdflib.Graph().parse(data=TTL, format="turtle")
g.parse(data=ALIGN_TTL, format="turtle")
conforms, rep, _ = validate(g, shacl_graph=rdflib.Graph().parse(ROOT / "shapes" / "highway-shapes.ttl"), advanced=True)
SH = rdflib.Namespace("http://www.w3.org/ns/shacl#")
shacl = sorted(dict(focus=str(rep.value(r, SH.focusNode)).split("#")[-1], severity=str(rep.value(r, SH.resultSeverity)).split("#")[-1],
                    message=str(rep.value(r, SH.resultMessage))) for r in rep.subjects(rdflib.RDF.type, SH.ValidationResult)
               ) if not conforms else []

Q = "PREFIX hw: <https://1004aiteam-power.github.io/ontology-space/highway#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> "


def q(s: str) -> list[list[str]]:
    return [[str(x) for x in row] for row in g.query(Q + s)]


CQ = [
    ("경부선 구간을 순서대로 나열하면?",
     "SELECT ?o ?n WHERE { ?s hw:onRoute hw:R_GYEONGBU ; hw:routeOrder ?o ; rdfs:label ?n } ORDER BY ?o"),
    ("노선이 5개 이상 만나는 분기점(JC)은?",
     "SELECT ?n (COUNT(?r) AS ?k) WHERE { ?j a hw:Junction ; hw:connectsRoute ?r ; rdfs:label ?n . FILTER(LANG(?n) = 'ko') } GROUP BY ?n HAVING (COUNT(?r) >= 5) ORDER BY DESC(?k) ?n"),
    ("기본 시나리오에서 하루 교통량이 가장 많은 링크 3개는?",
     "SELECT ?l ?v WHERE { ?x hw:code ?l ; hw:dailyVolume ?v } ORDER BY DESC(?v) LIMIT 3"),
    ("기본 시나리오에서 첨두 때 서비스수준 F가 되는 링크는?",
     "SELECT ?l ?h ?vc WHERE { ?t hw:inScenario hw:SC_BASE ; hw:los hw:LOS_F ; hw:onLink ?x ; hw:hour ?h ; hw:vcRatio ?vc . ?x hw:code ?l } ORDER BY DESC(?vc)"),
    ("사고 시나리오에서 첨두 v/c가 가장 많이 오른 링크는? (사고 링크 제외)",
     "SELECT ?l ?b ?i WHERE { ?tb hw:inScenario hw:SC_BASE ; hw:onLink ?x ; hw:vcRatio ?b . ?ti hw:inScenario hw:SC_INCIDENT ; hw:onLink ?x ; hw:vcRatio ?i . "
     "?x hw:code ?l . FILTER NOT EXISTS { ?inc hw:affectsLink ?x } } ORDER BY DESC(?i - ?b) LIMIT 3"),
    ("대전에서 링크 2개 이내로 닿는 노드는?",
     "SELECT (COUNT(DISTINCT ?n) AS ?k) WHERE { hw:N_DAEJEON (hw:adjacentTo|hw:adjacentTo/hw:adjacentTo) ?n . FILTER(?n != hw:N_DAEJEON) }"),
    ("IC이면서 JC인 노드는 몇 개인가?",
     "SELECT (COUNT(?n) AS ?k) WHERE { ?n a hw:Interchange, hw:Junction }"),
    ("고속도로에 닿지 않고 국도로만 갈 수 있는 지점은?",
     "SELECT ?n WHERE { ?x a hw:Intersection ; rdfs:label ?n . FILTER(LANG(?n) = 'ko') } ORDER BY ?n"),
    ("고속도로와 국도가 함께 지나는 도시는 몇 곳인가?",
     "SELECT (COUNT(DISTINCT ?n) AS ?k) WHERE { ?s1 hw:endpoint ?n ; hw:onRoute ?r1 . ?r1 a hw:Expressway . ?s2 hw:endpoint ?n ; hw:onRoute ?r2 . ?r2 a hw:NationalRoad . }"),
    ("표준과 대응시키지 않은 핵심 클래스는? (Route·Section·Link·Node·Expressway·NationalRoad·Interchange 중)",
     "PREFIX hwx: <https://1004aiteam-power.github.io/ontology-space/highway-std#> SELECT ?c WHERE { VALUES ?c { hw:Route hw:Section hw:Link hw:Node hw:Expressway hw:NationalRoad hw:Interchange } FILTER NOT EXISTS { ?m hwx:subject ?c } }"),
    ("표준별 대응 수와 원문 확인 수는?",
     "PREFIX hwx: <https://1004aiteam-power.github.io/ontology-space/highway-std#> SELECT ?s (COUNT(?m) AS ?n) (SUM(IF(?v, 1, 0)) AS ?ok) WHERE { ?m hwx:standard ?s ; hwx:verified ?v } GROUP BY ?s ORDER BY ?s"),
    ("서울에서 모든 노드에 닿을 수 있나? (닿지 않는 노드 수)",
     "SELECT (COUNT(?n) AS ?k) WHERE { ?n a hw:Node . FILTER NOT EXISTS { hw:N_SEOUL hw:adjacentTo* ?n } }"),
]
cq_out = [dict(q=t, rows=q(s)) for t, s in CQ]

# ---------------------------------------------------------------- 웹 데이터
twin = json.loads((ROOT / "assets" / "data" / "twin.json").read_text(encoding="utf-8"))
web = dict(
    virtual=True, stats=STATS, model=dict(capPerLane=CAP_PER_LANE, k=k, dailyTrips=DAILY_TRIPS, profile=[round(p, 4) for p in PROFILE],
                             los=[[g_, (None if lim == math.inf else lim)] for g_, lim in LOS], msaIters=MSA_ITERS),
    outline=twin["outline"],
    nodes=[dict(id=n["node_id"], ko=n["ko"], en=n["en"], lon=float(n["lon"]), lat=float(n["lat"]), w=float(n["zone_weight"]),
                routes=node_routes[n["node_id"]]) for n in nodes],
    routes=routes, sections=[dict(id=s["section_id"], route=s["route_id"], a=s["a"], b=s["b"], km=s["km"], lanes=int(s["lanes"])) for s in sections],
    links=[dict(id=lk["link_id"], section=lk["section"], route=lk["route"], cls=lk["cls"], frm=lk["frm"], to=lk["to"], lanes=lk["lanes"], km=lk["km"]) for lk in links],
    scenarios=scenarios, results=results, alignment=alignment, odWatch=[f"{o}-{d_}" for o, d_ in OD_WATCH], cq=cq_out, shacl=shacl,
)
(ROOT / "assets" / "data" / "highway.json").write_text(json.dumps(web, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

if __name__ == "__main__":
    print(f"노드 {len(nodes)} · 노선 {len(routes)} · 구간 {len(sections)} · 방향 링크 {len(links)} · 트리플 {len(g)}")
    print(f"규모 보정 k={k:.3g} → 하루 통행 {DAILY_TRIPS:,}대")
    print("통계:", STATS)
    for sid in ("BASE", "INCIDENT"):
        r = results[sid]
        worst = sorted(((max(x["vc"]), lid) for lid, x in r["links"].items()), reverse=True)[:5]
        print(f"\n== {sid}: 최대 v/c 상위 ==")
        for vc, lid in worst:
            lk = L[lid]
            print(f"{lid} {R[lk['route']]['ko']} {N[lk['frm']]['ko']}→{N[lk['to']]['ko']} v/c {vc}")
        for key, tt in r["od"].items():
            print(f"{key}: 최소 {min(tt)}분, 최대 {max(tt)}분 ({tt.index(max(tt))}시)")
    print("\n== SHACL ==", "통과" if conforms else shacl)
    print("\n== 역량 질문 ==")
    for c in cq_out:
        print("Q.", c["q"], "→", c["rows"][:6])
