# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""고속도로 × 전력망: 휴게소 전기차 충전 온톨로지 (⚠ 가상 데이터).

교통 온톨로지(hw:)와 전력망 온톨로지(cim:, 디지털 트윈)를 휴게소 충전소 하나로 잇는다.

  hw:Link ──ev:onLink── ev:RestArea ──ev:hasChargingStation── ev:ChargingStation (⊂ cim:EnergyConsumer)
                                                              └─ cim:Equipment.EquipmentContainer ─ cim:Feeder (22.9kV 배전선로)
                                                                   └─ cim:Feeder.NormalEnergizingSubstation ─ cim:Substation (디지털 트윈 154kV)

계산 (매시 h):
  충전 수요(kWh)   = 링크 교통량(대/시, 고속도로 온톨로지 24시간 배정 결과) × 전기차 비율 × 충전 정차 비율 × 1회 충전량
  충전 공급(kW)    = min(수요 + 대기 중인 수요, 충전기 대수 × 정격 kW [, 배전선로 여유])   # 못 채운 수요는 다음 시간으로 넘어간다(대기)
  배전선로 부하(MW) = 선로의 다른 부하(피크 × 디지털 트윈 24시간 부하 곡선) + 충전 공급

입력: examples/ev/data/rest_areas.csv, assets/data/highway.json, assets/data/twin.json
      (CQ는 examples/highway/highway-ontology.ttl · examples/twin/korea_virtual_grid.ttl 과 합쳐 SPARQL로 묻는다)
생성: examples/ev/ev-ontology.ttl, assets/data/ev.json
실행: python examples/ev/build_ev.py   (저장소 루트에서, rdflib 필요)
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from pycim.ids import stable_mrid  # noqa: E402

HERE = Path(__file__).parent
HW = json.loads((ROOT / "assets" / "data" / "highway.json").read_text(encoding="utf-8"))
TW = json.loads((ROOT / "assets" / "data" / "twin.json").read_text(encoding="utf-8"))

# ---- 가정 (가상) -----------------------------------------------------------------------------
PARAMS = dict(
    evShare=0.10,        # 고속도로 통행 차량 중 전기차 비율
    stopRate=0.03,       # 휴게소 앞을 지나는 전기차 중 충전하려고 들르는 비율
    kwh=30.0,            # 1회 충전량 (kWh)
    feederLimitMW=10.0,  # 22.9kV 배전선로 상시 운전 한도
    chargerScale=1,      # 충전기 대수 배율 (웹에서 ×1·×2·×3)
    smart=False,         # 충전 제어: 배전선로 여유 안에서만 충전
)
LOAD_CURVE = TW["meta"]["loadCurve"]              # 디지털 트윈의 24시간 부하 곡선 (피크 = 1.0)

NODE = {n["id"]: n for n in HW["nodes"]}
ROUTE = {r["route_id"]: r for r in HW["routes"]}
LINK = {l["id"]: l for l in HW["links"]}
VOL = {k: v["vol"] for k, v in HW["results"]["BASE"]["links"].items()}
INCIDENT_VOL = {k: v["vol"] for k, v in HW["results"]["INCIDENT"]["links"].items()}
ST154 = [s for s in TW["stations"] if 154 in s["levels"] and not s["jeju"]]


def km(lon1, lat1, lon2, lat2) -> float:
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def simulate(vol: list[float], chargers: int, kw: float, base_peak: float, p: dict = PARAMS) -> dict:
    """한 휴게소의 24시간 충전 수요·공급·대기·배전선로 부하. 이틀을 돌려 둘째 날을 쓴다(자정을 넘긴 대기 포함). ev.js 의 simulate() 와 같은 식."""
    cap_kw = chargers * p["chargerScale"] * kw
    base = [base_peak * c for c in LOAD_CURVE]
    q = 0.0
    out = dict(demand=[], served=[], queue=[], feeder=[], base=base)
    for day in range(2):
        for h in range(24):
            dem = vol[h] * p["evShare"] * p["stopRate"] * p["kwh"]                       # kWh/h = kW (한 시간 평균)
            cap = cap_kw
            if p["smart"]:
                cap = min(cap, max(0.0, (p["feederLimitMW"] - base[h]) * 1000))
            served = min(dem + q, cap)
            q = dem + q - served
            if day == 1:
                out["demand"].append(round(dem / 1000, 4))
                out["served"].append(round(served / 1000, 4))
                out["queue"].append(round(q / p["kwh"], 1))                              # 기다리는 차 대수
                out["feeder"].append(round(base[h] + served / 1000, 4))
    out["sessions"] = round(sum(out["served"]) * 1000 / p["kwh"])
    out["peakMW"] = max(out["served"])
    out["feederPeak"] = max(out["feeder"])
    out["overHours"] = [h for h, v in enumerate(out["feeder"]) if v > p["feederLimitMW"] + 1e-9]
    out["maxQueue"] = max(out["queue"])
    return out


# ---- 휴게소 → 링크 위치 → 가까운 154kV 변전소 ------------------------------------------------------
RAS = []
for r in csv.DictReader(open(HERE / "data" / "rest_areas.csv", encoding="utf-8")):
    lk = LINK[r["link"]]
    a, b, t = NODE[lk["frm"]], NODE[lk["to"]], float(r["pos"])
    lon, lat = a["lon"] + (b["lon"] - a["lon"]) * t, a["lat"] + (b["lat"] - a["lat"]) * t
    st = min(ST154, key=lambda s: km(lon, lat, s["lon"], s["lat"]))
    RAS.append(dict(id=r["ra_id"], ko=r["ko"], en=r["en"], link=r["link"], route=lk["route"],
                    routeKo=ROUTE[lk["route"]]["ko"], routeEn=ROUTE[lk["route"]]["en"],
                    frm=lk["frm"], to=lk["to"], pos=t, lon=round(lon, 3), lat=round(lat, 3),
                    chargers=int(r["chargers"]), kw=float(r["kw"]), baseMW=float(r["feeder_base_mw"]),
                    station=st["id"], distKm=round(km(lon, lat, st["lon"], st["lat"]), 1),
                    vol=VOL[r["link"]], volIncident=INCIDENT_VOL[r["link"]]))
for ra in RAS:
    ra["sim"] = simulate(ra["vol"], ra["chargers"], ra["kw"], ra["baseMW"])

USED_ST = sorted({ra["station"] for ra in RAS})
STATIONS = [dict(id=s["id"], ko=s["ko"], en=s["en"], lon=s["lon"], lat=s["lat"], loadMW=s["loadMW"]) for s in TW["stations"] if s["id"] in USED_ST]


def scenario(**kw) -> dict:
    """가정을 바꿔 전체를 다시 계산한 요약 (테스트·문서용)."""
    p = dict(PARAMS, **kw)
    sims = {ra["id"]: simulate(ra["vol"], ra["chargers"], ra["kw"], ra["baseMW"], p) for ra in RAS}
    return dict(params=p, peakMW=round(sum(max(s["served"]) for s in sims.values()), 2),
                over=sorted(k for k, s in sims.items() if s["overHours"]),
                maxQueue=max(s["maxQueue"] for s in sims.values()),
                sessions=sum(s["sessions"] for s in sims.values()))


SCENARIOS = {
    "today": scenario(),
    "ev30": scenario(evShare=0.30),
    "ev30x3": scenario(evShare=0.30, chargerScale=3),
    "ev30x3smart": scenario(evShare=0.30, chargerScale=3, smart=True),
}

# ---- 온톨로지 (Turtle) ------------------------------------------------------------------------
HWNS = "https://1004aiteam-power.github.io/ontology-space/highway#"
EVNS = "https://1004aiteam-power.github.io/ontology-space/ev#"
TWNS = "http://example.org/kr-twin#"


def tw_sub(sid: str) -> str:
    return f"tw:_{stable_mrid('kr-twin', sid)}"


def lit(s: str, lang: str = "ko") -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + f'"@{lang}'


L = [f"""# ⚠ 가상 데이터: 휴게소 이름·충전기 수·전기차 비율·배전선로 부하는 모두 지어낸 값입니다.
@prefix ev:   <{EVNS}> .
@prefix hw:   <{HWNS}> .
@prefix tw:   <{TWNS}> .
@prefix cim:  <http://iec.ch/TC57/CIM100#> .
@prefix geo:  <http://www.opengis.net/ont/geosparql#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

<https://1004aiteam-power.github.io/ontology-space/ev> a owl:Ontology ;
    rdfs:label "고속도로 휴게소 전기차 충전 온톨로지"@ko ; owl:versionInfo "0.1" ;
    owl:imports <https://1004aiteam-power.github.io/ontology-space/highway> ;
    rdfs:comment "교통 온톨로지(hw:)의 방향 링크와 전력망(CIM, 디지털 트윈)의 변전소를 휴게소 충전소로 잇는다. 모든 값은 가상."@ko .

### 클래스
ev:RestArea a owl:Class ; rdfs:subClassOf geo:Feature ; rdfs:label "휴게소"@ko, "Rest area"@en ;
    rdfs:comment "한 방향 링크 위의 휴게 시설. INSPIRE에서는 RoadNode(service station)에 해당한다."@ko .
ev:ChargingStation a owl:Class ; rdfs:subClassOf cim:EnergyConsumer ; rdfs:label "충전소"@ko, "Charging station"@en ;
    rdfs:comment "전력망 쪽에서 보면 충전소는 부하(EnergyConsumer)다. 교통 쪽에서는 휴게소의 시설이다. 두 관점이 이 클래스에서 만난다."@ko .
ev:Charger a owl:Class ; rdfs:label "충전기"@ko, "Charger"@en .
ev:ChargingPeak a owl:Class ; rdfs:label "충전 첨두"@ko ; rdfs:comment "기본 가정에서 하루 중 충전 전력이 가장 큰 시각과 그 값. 24시간 전체는 ev.json에 있다."@ko .

### 속성 (교통 ↔ 전력의 다리)
ev:onLink a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain ev:RestArea ; rdfs:range hw:Link ; rdfs:label "놓인 방향 링크"@ko .
ev:positionOnLink a owl:DatatypeProperty ; rdfs:domain ev:RestArea ; rdfs:range xsd:decimal ; rdfs:label "링크 위 위치(0=시점, 1=종점)"@ko .
ev:hasChargingStation a owl:ObjectProperty ; rdfs:domain ev:RestArea ; rdfs:range ev:ChargingStation .
ev:hasCharger a owl:ObjectProperty ; rdfs:domain ev:ChargingStation ; rdfs:range ev:Charger .
ev:chargerCount a owl:DatatypeProperty ; rdfs:domain ev:Charger ; rdfs:range xsd:integer .
ev:ratedKW a owl:DatatypeProperty ; rdfs:domain ev:Charger ; rdfs:range xsd:decimal ; rdfs:label "1대 정격 출력(kW)"@ko .
ev:installedKW a owl:DatatypeProperty ; rdfs:domain ev:ChargingStation ; rdfs:range xsd:decimal ; rdfs:label "설치 용량(kW)"@ko .
ev:feederBasePeakMW a owl:DatatypeProperty ; rdfs:domain cim:Feeder ; rdfs:range xsd:decimal ; rdfs:label "선로의 다른 부하 첨두(MW)"@ko .
ev:feederLimitMW a owl:DatatypeProperty ; rdfs:domain cim:Feeder ; rdfs:range xsd:decimal .
ev:distanceKm a owl:DatatypeProperty ; rdfs:domain cim:Feeder ; rdfs:range xsd:decimal ; rdfs:label "변전소까지 직선 거리(km)"@ko .
ev:peakOf a owl:ObjectProperty ; rdfs:domain ev:ChargingPeak ; rdfs:range ev:ChargingStation .
ev:hour a owl:DatatypeProperty ; rdfs:range xsd:integer .
ev:mw a owl:DatatypeProperty ; rdfs:range xsd:decimal .
ev:sessionsPerDay a owl:DatatypeProperty ; rdfs:domain ev:ChargingStation ; rdfs:range xsd:integer .
"""]
L.append("### 개체")
for ra in RAS:
    i, s = ra["id"], ra["sim"]
    h = s["served"].index(s["peakMW"])
    L.append(f"""ev:{i} a ev:RestArea ; rdfs:label {lit(ra['ko'])}, {lit(ra['en'], 'en')} ; ev:onLink hw:{ra['link']} ; ev:positionOnLink {ra['pos']} ;
    geo:hasGeometry [ geo:asWKT "POINT({ra['lon']} {ra['lat']})"^^geo:wktLiteral ] ; ev:hasChargingStation ev:CS_{i} .
ev:CS_{i} a ev:ChargingStation ; rdfs:label {lit(ra['ko'] + ' 충전소')} ; ev:installedKW {ra['chargers'] * ra['kw']:.0f} ; ev:sessionsPerDay {s['sessions']} ;
    ev:hasCharger ev:CH_{i} ; cim:Equipment.EquipmentContainer ev:FD_{i} .
ev:CH_{i} a ev:Charger ; ev:chargerCount {ra['chargers']} ; ev:ratedKW {ra['kw']:.0f} .
ev:FD_{i} a cim:Feeder ; cim:IdentifiedObject.name "{ra['ko']} 공급 D/L (22.9kV, 가상)" ; ev:feederBasePeakMW {ra['baseMW']} ; ev:feederLimitMW {PARAMS['feederLimitMW']} ;
    cim:Feeder.NormalEnergizingSubstation {tw_sub(ra['station'])} ; ev:distanceKm {ra['distKm']} .
ev:PK_{i} a ev:ChargingPeak ; ev:peakOf ev:CS_{i} ; ev:hour {h} ; ev:mw {s['peakMW']} .
""")
TTL = "\n".join(L)
(HERE / "ev-ontology.ttl").write_text(TTL, encoding="utf-8")

# ---- 역량 질문 (CQ): 세 온톨로지를 한 그래프에 합쳐 SPARQL로 ---------------------------------------
CQ = [
    ("경부선을 달리다 충전하면, 그 전기는 어느 변전소에서 오나?",
     "Charging on the Gyeongbu line: which substations supply it?",
     """SELECT ?ra ?sub WHERE {
  ?r ev:onLink/hw:ofSection/hw:onRoute hw:R_GYEONGBU ; rdfs:label ?ra ;
     ev:hasChargingStation/cim:Equipment.EquipmentContainer/cim:Feeder.NormalEnergizingSubstation ?s .
  ?s cim:IdentifiedObject.name ?sub . FILTER(LANG(?ra) = 'ko') } ORDER BY ?ra"""),
    ("변전소별로 휴게소 충전 설비가 얼마나 걸려 있나?",
     "Installed charging capacity per substation",
     """SELECT ?sub (COUNT(?cs) AS ?n) (SUM(?kw) AS ?totalKW) WHERE {
  ?cs a ev:ChargingStation ; ev:installedKW ?kw ; cim:Equipment.EquipmentContainer/cim:Feeder.NormalEnergizingSubstation ?s .
  ?s cim:IdentifiedObject.name ?sub } GROUP BY ?sub ORDER BY DESC(?totalKW)"""),
    ("사고 시나리오의 차로 차단 링크 위에 있는 휴게소는?",
     "Which rest areas sit on the link closed in the crash scenario?",
     """SELECT ?ra ?link WHERE { ?inc a hw:Incident ; hw:affectsLink ?l . ?l hw:code ?link .
  ?r ev:onLink ?l ; rdfs:label ?ra . FILTER(LANG(?ra) = 'ko') }"""),
    ("충전 첨두가 출근 시간(7~9시)에 오는 충전소는?",
     "Charging stations that peak in the morning rush (7–9 h)",
     """SELECT ?ra ?h ?mw WHERE { ?p ev:peakOf ?cs ; ev:hour ?h ; ev:mw ?mw . FILTER(?h >= 7 && ?h <= 9)
  ?r ev:hasChargingStation ?cs ; rdfs:label ?ra . FILTER(LANG(?ra) = 'ko') } ORDER BY DESC(?mw)"""),
    ("교통 링크 하나에서 출발해 전력 설비까지 몇 단계로 닿나? (S03F)",
     "From one traffic link to the grid: the path from S03F",
     """SELECT ?ra ?cs ?feeder ?sub WHERE { ?r ev:onLink hw:S03F ; rdfs:label ?ra ; ev:hasChargingStation ?c .
  ?c rdfs:label ?cs ; cim:Equipment.EquipmentContainer ?f . ?f cim:IdentifiedObject.name ?feeder ; cim:Feeder.NormalEnergizingSubstation/cim:IdentifiedObject.name ?sub .
  FILTER(LANG(?ra) = 'ko') }"""),
]
# 웹페이지에 보여 주는 같은 질문의 Cypher (Neo4j). assets/cypher/cq.js와 같아야 함 — tests/cypher.test.mjs가 결과까지 대조
CYPHER = [
    """MATCH (r:RestArea)-[:ON_LINK]->(:Link)-[:OF_SECTION]->(:Section)-[:ON_ROUTE]->(:Route {code: 'GYEONGBU'}),
      (r)-[:HAS_CHARGING_STATION]->(:ChargingStation)-[:EQUIPMENT_CONTAINER]->(:Feeder)
         -[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
RETURN r.label AS ra, s.name AS sub
ORDER BY ra""",
    """MATCH (cs:ChargingStation)-[:EQUIPMENT_CONTAINER]->(:Feeder)-[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
RETURN s.name AS sub, count(cs) AS n, sum(cs.installedKW) AS totalKW
ORDER BY totalKW DESC""",
    """MATCH (:Incident)-[:AFFECTS_LINK]->(l:Link)<-[:ON_LINK]-(r:RestArea)
RETURN r.label AS ra, l.code AS link""",
    """MATCH (p:ChargingPeak)-[:PEAK_OF]->(:ChargingStation)<-[:HAS_CHARGING_STATION]-(r:RestArea)
WHERE p.hour >= 7 AND p.hour <= 9
RETURN r.label AS ra, p.hour AS h, p.mw AS mw
ORDER BY mw DESC""",
    """MATCH (r:RestArea)-[:ON_LINK]->(:Link {code: 'S03F'}),
      (r)-[:HAS_CHARGING_STATION]->(c:ChargingStation)-[:EQUIPMENT_CONTAINER]->(f:Feeder)
         -[:NORMAL_ENERGIZING_SUBSTATION]->(s:Substation)
RETURN r.label AS ra, c.label AS cs, f.name AS feeder, s.name AS sub""",
]
PREFIX = f"PREFIX ev: <{EVNS}> PREFIX hw: <{HWNS}> PREFIX cim: <http://iec.ch/TC57/CIM100#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n"


def run_cq() -> list[dict]:
    import rdflib
    g = rdflib.Graph()
    g.parse(data=TTL, format="turtle")
    g.parse(ROOT / "examples" / "highway" / "highway-ontology.ttl", format="turtle")
    g.parse(ROOT / "examples" / "twin" / "korea_virtual_grid.ttl", format="turtle")
    out = []
    for (ko, en, q), cy in zip(CQ, CYPHER):
        rows = [[str(v) if v is not None else "" for v in r] for r in g.query(PREFIX + q)]
        out.append(dict(q=ko, en=en, cypher=cy, rows=rows))
    return out, len(g)


CQ_OUT, TRIPLES = run_cq()

# ---- 웹 데이터 ---------------------------------------------------------------------------------
ex_links = []
for l in HW["links"]:
    if l["cls"] == "EXPRESSWAY" and l["id"].endswith("F"):
        a, b = NODE[l["frm"]], NODE[l["to"]]
        ex_links.append([round(a["lon"], 3), round(a["lat"], 3), round(b["lon"], 3), round(b["lat"], 3)])
web = dict(virtual=True, params=PARAMS, loadCurve=LOAD_CURVE, outline=HW["outline"], roads=ex_links,
           restAreas=RAS, stations=STATIONS, scenarios=SCENARIOS, cq=CQ_OUT, triples=TRIPLES,
           nodes=[dict(id=n["id"], ko=n["ko"], en=n["en"], lon=n["lon"], lat=n["lat"]) for n in HW["nodes"]])
(ROOT / "assets" / "data" / "ev.json").write_text(json.dumps(web, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

if __name__ == "__main__":
    print(f"휴게소 {len(RAS)}곳 · 연결 변전소 {len(USED_ST)}곳 · 합친 그래프 {TRIPLES:,} 트리플")
    for ra in RAS:
        s = ra["sim"]
        print(f"  {ra['id']} {ra['ko']:28s} → {ra['station']:9s} {ra['distKm']:5.1f}km · 하루 {s['sessions']:4d}회 · 첨두 {s['peakMW']:.2f}MW "
              f"(@{s['served'].index(s['peakMW'])}시) · 선로 첨두 {s['feederPeak']:.2f}MW · 최대 대기 {s['maxQueue']}대")
    for k, v in SCENARIOS.items():
        print(f"[{k}] 충전 첨두 합 {v['peakMW']} MW · 과부하 선로 {v['over']} · 최대 대기 {v['maxQueue']}대 · 하루 {v['sessions']}회")
    for c in CQ_OUT:
        print("CQ", c["q"], c["rows"][:6])
