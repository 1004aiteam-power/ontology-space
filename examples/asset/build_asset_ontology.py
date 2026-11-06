# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""전력설비 자산관리 온톨로지 빌드 (⚠ 가상 데이터).

원본: examples/asset/data/*.csv  ← 사람이 고치는 곳은 여기뿐
생성: examples/asset/asset-ontology.ttl      OWL (TBox + ABox, 계산값 포함)
      examples/asset/neo4j/import.cypher     Neo4j 적재 스크립트
      assets/data/asset.json                 웹페이지(asset.html) 데이터
검증: neo4j/checks.cypher (Cypher 형상검증) + neo4j/queries.cypher (역량 질문), tools/cypher.mjs로 실행

계산 규칙
  건전도 HI = 100 − 60 × 경과연수 / 설계수명 − Σ(방법별 최신 진단 감점: 주의 15, 이상 35)   (0~100)
  고장 가능성 PoF: HI ≥80 →1, ≥60 →2, ≥40 →3, ≥20 →4, 그 밖 →5
  고장 영향 CoF: 미공급 전력량(MWh) = 정전 부하(MW, pycim 토폴로지) × 복구시간(h)
                 <100 →1, <500 →2, <2000 →3, <10000 →4, 그 밖 →5
  위험도 = PoF × CoF   (15 이상 높음, 8~14 중간, 7 이하 낮음)

실행: python examples/asset/build_asset_ontology.py   (저장소 루트에서, Node.js 필요)
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pycim import topology  # noqa: E402
from pycim.samples import sample_grid  # noqa: E402
from pycim.wires import BusbarSection, ExternalNetworkInjection, Switch  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
AS_OF = date(2026, 11, 3)
JUDGE_PENALTY = {"정상": 0, "주의": 15, "이상": 35}
KIND_KO = {"TransformerAsset": "변압기", "BreakerAsset": "차단기", "ConductorAsset": "가공도체"}


def read(name: str) -> list[dict]:
    with open(DATA / name, encoding="utf-8") as f:
        return [{k: (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


def split(v: str) -> list[str]:
    return [x for x in (s.strip() for s in v.split(";")) if x]


def d(s: str) -> date | None:
    return date.fromisoformat(s) if s else None


def months_between(a: date, b: date) -> float:
    return (b - a).days / 30.44


# ---------------------------------------------------------------- 원본 읽기
assets = read("assets.csv")
deps = read("deployments.csv")
locs = read("locations.csv")
comps = read("components.csv")
tasks = read("tasks.csv")
fms = read("failure_modes.csv")
diags = read("diagnoses.csv")
wos = read("work_orders.csv")
A = {a["asset_id"]: a for a in assets}
T = {t["task_id"]: t for t in tasks}
FM = {f["fm_id"]: f for f in fms}
L = {x["location"]: x for x in locs}


def applies(task: dict, asset: dict) -> bool:
    for rule in split(task["applies_to"]):
        kind, _, qual = rule.partition(":")
        if kind == asset["kind"] and (not qual or qual in asset["rating"]):
            return True
    return False


# ---------------------------------------------------------------- 정전 영향 (pycim 토폴로지)
def outage_mw() -> dict[str, tuple[float, list[str]]]:
    m = sample_grid()
    src = [o for o in m if isinstance(o, ExternalNetworkInjection)]
    out = {}
    for loc in locs:
        eq = m.by_name(loc["pycim_name"])
        if isinstance(eq, Switch):
            eq.open = True
            lost = topology.deenergized_loads(m, src)
            eq.open = False
        else:
            # 고장 설비를 계통에서 분리. 모선(단자 1개) 고장은 모선 보호가 그 모선에 붙은
            # 모든 설비를 끊으므로, 모선 노드의 단자를 모두 분리한다.
            if isinstance(eq, BusbarSection):
                cut = [t for t0 in eq.terminals for t in t0.connectivity_node.terminals]
            else:
                cut = list(eq.terminals)
            saved = [t.connected for t in cut]
            for t in cut:
                t.connected = False
            lost = topology.deenergized_loads(m, src)
            for t, c in zip(cut, saved):
                t.connected = c
        out[loc["location"]] = (round(sum(x.p or 0 for x in lost), 3), [x.name for x in lost])
    return out


OUTAGE = outage_mw()

# ---------------------------------------------------------------- 현재 위치, 건전도, 위험도
current_loc = {x["asset_id"]: x["location"] for x in deps if not x["valid_to"]}


def latest_diags(asset_id: str) -> dict[str, dict]:
    last: dict[str, dict] = {}
    for g in sorted((g for g in diags if g["asset_id"] == asset_id), key=lambda g: g["date"]):
        last[g["task_id"]] = g
    return last


def band(x: float, cuts: list[float], higher_is_better: bool) -> int:
    if higher_is_better:  # HI → PoF
        for i, c in enumerate(cuts, 1):
            if x >= c:
                return i
        return len(cuts) + 1
    for i, c in enumerate(cuts, 1):  # MWh → CoF
        if x < c:
            return i
    return len(cuts) + 1


def risk_level(r: int) -> str:
    return "높음" if r >= 15 else "중간" if r >= 8 else "낮음"


calc = {}
for a in assets:
    if a["status"] != "운전":
        continue
    aid = a["asset_id"]
    age = (AS_OF - date(int(a["year_made"]), 7, 1)).days / 365.25
    age_pen = 60 * age / float(a["design_life_y"])
    last = latest_diags(aid)
    diag_pen = sum(JUDGE_PENALTY[g["judgement"]] for g in last.values())
    hi = max(0.0, min(100.0, 100 - age_pen - diag_pen))
    pof = band(hi, [80, 60, 40, 20], True)
    loc = current_loc[aid]
    mw, lost = OUTAGE[loc]
    mwh = mw * float(a["restore_h"])
    mwh_sp = mw * float(a["restore_h_with_spare"])
    cof = band(mwh, [100, 500, 2000, 10000], False)
    cof_sp = band(mwh_sp, [100, 500, 2000, 10000], False)
    calc[aid] = dict(age=round(age, 1), age_penalty=round(age_pen, 1), diag_penalty=diag_pen, hi=round(hi, 1),
                     pof=pof, outage_mw=mw, lost_loads=lost, mwh=round(mwh), cof=cof, risk=pof * cof,
                     level=risk_level(pof * cof), mwh_spare=round(mwh_sp), cof_spare=cof_sp,
                     risk_spare=pof * cof_sp, level_spare=risk_level(pof * cof_sp),
                     latest={k: v["diag_id"] for k, v in last.items()})

# ---------------------------------------------------------------- 점검 주기 확인
overdue = []
for a in assets:
    if a["status"] != "운전":
        continue
    last = latest_diags(a["asset_id"])
    for t in tasks:
        if t["category"] != "점검" or not t["cycle_months"] or not applies(t, a):
            continue
        g = last.get(t["task_id"])
        if g is None:
            overdue.append(dict(asset=a["asset_id"], task=t["task_id"], last=None, state="기록 없음"))
        else:
            age_m = months_between(d(g["date"]), AS_OF)
            if age_m > float(t["cycle_months"]):
                overdue.append(dict(asset=a["asset_id"], task=t["task_id"], last=g["date"], state="주기 초과"))

gaps = [x["location"] for x in locs if x["location"] not in current_loc.values()]

# ---------------------------------------------------------------- Turtle
P = """@prefix pam:  <https://1004aiteam-power.github.io/ontology-space/asset#> .
@prefix aipd: <https://example.org/ai-promotion-dept/ontology#> .
@prefix cim:  <http://iec.ch/TC57/CIM100#> .
@prefix ex:   <http://example.org/grid#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
"""


def lit(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"@ko'


def iri(s: str) -> str:
    return "pam:" + s.replace("-", "_").replace(".", "_")


TBOX = """
<https://1004aiteam-power.github.io/ontology-space/asset> a owl:Ontology ;
    rdfs:label "전력설비 자산관리 온톨로지 (가상 A변전소)"@ko ;
    owl:versionInfo "0.1" ;
    rdfs:comment "기능 위치(CIM 설비)와 물리 자산을 분리하고, 진단·고장모드·점검정비·작업지시·위험도를 잇는다. 모든 데이터는 가상."@ko ;
    rdfs:seeAlso <https://1004aiteam-power.github.io/ontology-space/examples/power-grid-sample.ttl> ,
                 <https://1004aiteam-power.github.io/ontology-space/examples/work/work-ontology.ttl> .

### 클래스
pam:Asset a owl:Class ; rdfs:subClassOf cim:Asset ; rdfs:label "물리 자산"@ko ;
    rdfs:comment "제조번호가 있는 실물. 기능 위치(cim:PowerSystemResource)와 다르다: 자산은 교체되어도 위치는 남는다."@ko .
pam:TransformerAsset a owl:Class ; rdfs:subClassOf pam:Asset ; rdfs:label "변압기 자산"@ko .
pam:BreakerAsset a owl:Class ; rdfs:subClassOf pam:Asset ; rdfs:label "차단기 자산"@ko .
pam:ConductorAsset a owl:Class ; rdfs:subClassOf pam:Asset ; rdfs:label "가공도체 자산"@ko .
pam:Component a owl:Class ; rdfs:label "구성품"@ko .
pam:ComponentType a owl:Class ; rdfs:label "구성품 종류"@ko .
pam:Deployment a owl:Class ; rdfs:label "설치 이력"@ko ; rdfs:comment "어떤 자산이 언제부터 언제까지 어느 기능 위치에 있었는지."@ko .
pam:FailureMode a owl:Class ; rdfs:label "고장 모드"@ko .
pam:MaintenanceTask a owl:Class ; rdfs:label "점검·정비 업무 유형"@ko .
pam:InspectionTask a owl:Class ; rdfs:subClassOf pam:MaintenanceTask ; rdfs:label "점검"@ko .
pam:RepairTask a owl:Class ; rdfs:subClassOf pam:MaintenanceTask ; rdfs:label "정비·교체"@ko .
pam:WorkflowStep a owl:Class ; rdfs:label "정비 업무 흐름 단계"@ko .
pam:Strategy a owl:Class ; rdfs:label "정비 전략"@ko .
pam:Diagnosis a owl:Class ; rdfs:label "진단 기록"@ko .
pam:Judgement a owl:Class ; rdfs:label "판정"@ko .
pam:WorkOrder a owl:Class ; rdfs:subClassOf cim:Work ; rdfs:label "작업지시"@ko .
pam:Asset owl:disjointWith pam:Component, pam:MaintenanceTask, pam:Diagnosis, pam:WorkOrder .

### 객체 속성
pam:deployedAsset a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain pam:Deployment ; rdfs:range pam:Asset ; rdfs:label "설치 자산"@ko .
pam:atLocation a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain pam:Deployment ; rdfs:range cim:PowerSystemResource ; rdfs:label "기능 위치"@ko .
pam:installedAt a owl:ObjectProperty ; rdfs:domain pam:Asset ; rdfs:range cim:PowerSystemResource ; rdfs:label "현재 설치 위치"@ko ;
    rdfs:comment "현재 유효한 Deployment에서 생성한 지름길."@ko .
pam:hasComponent a owl:ObjectProperty ; rdfs:domain pam:Asset ; rdfs:range pam:Component ; rdfs:label "구성품"@ko .
pam:componentType a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain pam:Component ; rdfs:range pam:ComponentType .
pam:appliesToAssetClass a owl:AnnotationProperty ; rdfs:label "적용 자산 클래스"@ko .
pam:affectsComponentType a owl:ObjectProperty ; rdfs:domain pam:FailureMode ; rdfs:range pam:ComponentType ; rdfs:label "고장 부위"@ko .
pam:detectedBy a owl:ObjectProperty ; rdfs:domain pam:FailureMode ; rdfs:range pam:InspectionTask ; rdfs:label "탐지 점검"@ko .
pam:mitigatedBy a owl:ObjectProperty ; rdfs:domain pam:FailureMode ; rdfs:range pam:RepairTask ; rdfs:label "대응 정비"@ko .
pam:strategy a owl:ObjectProperty ; rdfs:domain pam:MaintenanceTask ; rdfs:range pam:Strategy .
pam:onAsset a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:range pam:Asset ; rdfs:label "대상 자산"@ko .
pam:usesMethod a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain pam:Diagnosis ; rdfs:range pam:InspectionTask ; rdfs:label "진단 방법"@ko .
pam:judgement a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain pam:Diagnosis ; rdfs:range pam:Judgement .
pam:indicates a owl:ObjectProperty ; rdfs:domain pam:Diagnosis ; rdfs:range pam:FailureMode ; rdfs:label "의심 고장 모드"@ko .
pam:performs a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain pam:WorkOrder ; rdfs:range pam:MaintenanceTask ; rdfs:label "수행 업무"@ko .
pam:addresses a owl:ObjectProperty ; rdfs:domain pam:WorkOrder ; rdfs:range pam:FailureMode ; rdfs:label "대응 고장 모드"@ko .
pam:triggeredBy a owl:ObjectProperty ; rdfs:domain pam:WorkOrder ; rdfs:range pam:Diagnosis ; rdfs:label "발행 근거"@ko .
pam:precedes a owl:ObjectProperty ; rdfs:subPropertyOf aipd:precedes ; rdfs:domain pam:WorkflowStep ; rdfs:range pam:WorkflowStep ; rdfs:label "선행"@ko ;
    rdfs:comment "업무 온톨로지의 aipd:precedes를 재사용(하위 속성). 두 온톨로지를 함께 읽으면 같은 쿼리로 업무 흐름을 따라갈 수 있다."@ko .
pam:feedsBackTo a owl:ObjectProperty ; rdfs:subPropertyOf aipd:feedsBackTo ; rdfs:domain pam:WorkflowStep ; rdfs:range pam:WorkflowStep ; rdfs:label "환류"@ko .

### 데이터 속성
pam:code a owl:DatatypeProperty ; rdfs:range xsd:string .
pam:eamNumber a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:string ; rdfs:label "EAM 설비번호"@ko .
pam:yearMade a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:gYear .
pam:designLifeYears a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:integer .
pam:status a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:string .
pam:validFrom a owl:DatatypeProperty ; rdfs:domain pam:Deployment ; rdfs:range xsd:date .
pam:validTo a owl:DatatypeProperty ; rdfs:domain pam:Deployment ; rdfs:range xsd:date .
pam:date a owl:DatatypeProperty ; rdfs:range xsd:date .
pam:finding a owl:DatatypeProperty ; rdfs:domain pam:Diagnosis ; rdfs:range xsd:string .
pam:cycleMonths a owl:DatatypeProperty ; rdfs:domain pam:MaintenanceTask ; rdfs:range xsd:integer .
pam:requiresOutage a owl:DatatypeProperty ; rdfs:domain pam:MaintenanceTask ; rdfs:range xsd:boolean .
pam:workStatus a owl:DatatypeProperty ; rdfs:domain pam:WorkOrder ; rdfs:range xsd:string .
pam:plannedDate a owl:DatatypeProperty ; rdfs:domain pam:WorkOrder ; rdfs:range xsd:date .
pam:completedDate a owl:DatatypeProperty ; rdfs:domain pam:WorkOrder ; rdfs:range xsd:date .
pam:outageHours a owl:DatatypeProperty ; rdfs:domain pam:WorkOrder ; rdfs:range xsd:decimal .
pam:restoreHours a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:decimal ; rdfs:label "고장 시 복구시간(h)"@ko .
pam:healthIndex a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:decimal ; rdfs:label "건전도 지수(계산값)"@ko .
pam:probabilityOfFailure a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:integer ; rdfs:label "고장 가능성 1~5(계산값)"@ko .
pam:outageMW a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:decimal ; rdfs:label "고장 시 정전 부하(계산값)"@ko .
pam:unsuppliedMWh a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:decimal ; rdfs:label "미공급 전력량(계산값)"@ko .
pam:consequenceOfFailure a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:integer ; rdfs:label "고장 영향 1~5(계산값)"@ko .
pam:riskScore a owl:DatatypeProperty ; rdfs:domain pam:Asset ; rdfs:range xsd:integer ; rdfs:label "위험도 PoF×CoF(계산값)"@ko .

### 값 목록
pam:TBM a pam:Strategy ; rdfs:label "시간기반 정비(TBM)"@ko .
pam:CBM a pam:Strategy ; rdfs:label "상태기반 정비(CBM)"@ko .
pam:CM a pam:Strategy ; rdfs:label "사후·교정 정비(CM)"@ko .
pam:Normal a pam:Judgement ; rdfs:label "정상"@ko .
pam:Caution a pam:Judgement ; rdfs:label "주의"@ko .
pam:Abnormal a pam:Judgement ; rdfs:label "이상"@ko .
"""
JUDGE = {"정상": "pam:Normal", "주의": "pam:Caution", "이상": "pam:Abnormal"}

lines = [P, TBOX, "### 구성품 종류"]
ctypes = sorted({c["kind"] for c in comps} | {f["component_kind"] for f in fms})
for k in ctypes:
    lines.append(f"pam:CT_{k} a pam:ComponentType ; rdfs:label \"{k}\" .")
lines.append("\n### 자산")
for a in assets:
    aid = a["asset_id"]
    p = [f"{iri(aid)} a pam:{a['kind']}", f'pam:code "{aid}"', f'pam:eamNumber "{a["eam_no"]}"',
         f"rdfs:label {lit(a['name'])}", f'pam:yearMade "{a["year_made"]}"^^xsd:gYear',
         f"pam:designLifeYears {a['design_life_y']}", f"pam:status {lit(a['status'])}",
         f"pam:restoreHours {a['restore_h']}", f"rdfs:comment {lit(a['manufacturer'] + ' ' + a['model'] + ' · ' + a['rating'])}"]
    if aid in current_loc:
        p.append(f"pam:installedAt ex:{current_loc[aid]}")
    cs = [c for c in comps if c["asset_id"] == aid]
    if cs:
        p.append("pam:hasComponent " + ", ".join(iri(c["component_id"]) for c in cs))
    if aid in calc:
        c = calc[aid]
        p += [f"pam:healthIndex {c['hi']}", f"pam:probabilityOfFailure {c['pof']}", f"pam:outageMW {c['outage_mw']}",
              f"pam:unsuppliedMWh {c['mwh']}", f"pam:consequenceOfFailure {c['cof']}", f"pam:riskScore {c['risk']}"]
    lines.append(" ;\n    ".join(p) + " .")
for c in comps:
    lines.append(f"{iri(c['component_id'])} a pam:Component ; pam:code \"{c['component_id']}\" ; rdfs:label {lit(c['name'])} ; pam:componentType pam:CT_{c['kind']} .")
lines.append("\n### 설치 이력")
for i, x in enumerate(deps, 1):
    p = [f"pam:DEP_{i:02d} a pam:Deployment", f"pam:deployedAsset {iri(x['asset_id'])}", f"pam:atLocation ex:{x['location']}",
         f'pam:validFrom "{x["valid_from"]}"^^xsd:date']
    if x["valid_to"]:
        p.append(f'pam:validTo "{x["valid_to"]}"^^xsd:date')
    lines.append(" ; ".join(p) + " .")
lines.append("\n### 점검·정비 업무 유형과 정비 업무 흐름")
for t in tasks:
    if t["category"] == "업무흐름":
        p = [f"{iri(t['task_id'])} a pam:WorkflowStep", f'pam:code "{t["task_id"]}"', f"rdfs:label {lit(t['name'])}"]
        if t["precedes"]:
            p.append("pam:precedes " + ", ".join(iri(x) for x in split(t["precedes"])))
        if t["feeds_back_to"]:
            p.append("pam:feedsBackTo " + ", ".join(iri(x) for x in split(t["feeds_back_to"])))
    else:
        cls = "pam:InspectionTask" if t["category"] == "점검" else "pam:RepairTask"
        p = [f"{iri(t['task_id'])} a {cls}", f'pam:code "{t["task_id"]}"', f"rdfs:label {lit(t['name'])}",
             f"pam:requiresOutage {'true' if t['outage'] == 'Y' else 'false'}"]
        if t["strategy"]:
            p.append(f"pam:strategy pam:{t['strategy']}")
        if t["cycle_months"]:
            p.append(f"pam:cycleMonths {t['cycle_months']}")
    lines.append(" ;\n    ".join(p) + " .")
lines.append("\n### 고장 모드")
for f in fms:
    p = [f"{iri(f['fm_id'])} a pam:FailureMode", f'pam:code "{f["fm_id"]}"', f"rdfs:label {lit(f['name'])}",
         f"pam:appliesToAssetClass pam:{f['asset_kind'].split(':')[0]}", f"pam:affectsComponentType pam:CT_{f['component_kind']}",
         "pam:detectedBy " + ", ".join(iri(x) for x in split(f["detected_by"])),
         "pam:mitigatedBy " + ", ".join(iri(x) for x in split(f["mitigated_by"])),
         f"rdfs:comment {lit(f['effect'])}"]
    lines.append(" ;\n    ".join(p) + " .")
lines.append("\n### 진단 기록")
for g in diags:
    p = [f"{iri(g['diag_id'])} a pam:Diagnosis", f"pam:onAsset {iri(g['asset_id'])}", f"pam:usesMethod {iri(g['task_id'])}",
         f'pam:date "{g["date"]}"^^xsd:date', f"pam:finding {lit(g['finding'])}", f"pam:judgement {JUDGE[g['judgement']]}"]
    if g["fm_id"]:
        p.append(f"pam:indicates {iri(g['fm_id'])}")
    lines.append(" ; ".join(p) + " .")
lines.append("\n### 작업지시")
for w in wos:
    p = [f"{iri(w['wo_id'])} a pam:WorkOrder", f'pam:code "{w["wo_id"]}"', f"pam:onAsset {iri(w['asset_id'])}",
         f"pam:performs {iri(w['task_id'])}", f"pam:addresses {iri(w['fm_id'])}", f"pam:triggeredBy {iri(w['trigger'])}",
         f"pam:workStatus {lit(w['status'])}", f'pam:plannedDate "{w["planned"]}"^^xsd:date', f"pam:outageHours {w['outage_h']}"]
    if w["done"]:
        p.append(f'pam:completedDate "{w["done"]}"^^xsd:date')
    lines.append(" ; ".join(p) + " .")
TTL = "\n".join(lines) + "\n"
(HERE / "asset-ontology.ttl").write_text(TTL, encoding="utf-8")

# ---------------------------------------------------------------- Neo4j
def cy(v) -> str:
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"


def cylist(rows: list[dict]) -> str:
    def val(v):
        if isinstance(v, list):
            return "[" + ", ".join(cy(x) for x in v) + "]"
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
        return cy(v)
    return "[\n  " + ",\n  ".join("{" + ", ".join(f"{k}: {val(v)}" for k, v in r.items()) + "}" for r in rows) + "\n]"


asset_rows = []
for a in assets:
    r = dict(id=a["asset_id"], eam=a["eam_no"], kind=a["kind"], name=a["name"], status=a["status"], year=int(a["year_made"]))
    if a["asset_id"] in calc:
        c = calc[a["asset_id"]]
        r.update(hi=c["hi"], pof=c["pof"], cof=c["cof"], risk=c["risk"], mwh=c["mwh"])
    asset_rows.append(r)
CYPHER = f"""// 전력설비 자산관리 온톨로지 v0.1 — Neo4j 적재 (⚠ 가상 데이터)
// 생성: examples/asset/build_asset_ontology.py  ← 이 파일을 직접 고치지 말 것
CREATE CONSTRAINT asset_id IF NOT EXISTS FOR (a:Asset) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT loc_code IF NOT EXISTS FOR (l:FunctionalLocation) REQUIRE l.code IS UNIQUE;
CREATE CONSTRAINT task_id IF NOT EXISTS FOR (t:MaintenanceTask) REQUIRE t.id IS UNIQUE;

UNWIND {cylist([dict(code=x['location'], cim=x['cim_class'], name=x['name']) for x in locs])} AS r
MERGE (l:FunctionalLocation {{code: r.code}}) SET l.cimClass = r.cim, l.name = r.name;

UNWIND {cylist(asset_rows)} AS r
MERGE (a:Asset {{id: r.id}}) SET a += r;

UNWIND {cylist([dict(a=x['asset_id'], l=x['location'], f=x['valid_from'], t=x['valid_to']) for x in deps])} AS r
MATCH (a:Asset {{id: r.a}}), (l:FunctionalLocation {{code: r.l}})
MERGE (a)-[d:INSTALLED_AT {{from: r.f}}]->(l) SET d.to = CASE WHEN r.t = '' THEN null ELSE r.t END;

UNWIND {cylist([dict(id=c['component_id'], a=c['asset_id'], kind=c['kind'], name=c['name']) for c in comps])} AS r
MATCH (a:Asset {{id: r.a}})
MERGE (c:Component {{id: r.id}}) SET c.kind = r.kind, c.name = r.name
MERGE (a)-[:HAS_COMPONENT]->(c);

UNWIND {cylist([dict(id=t['task_id'], name=t['name'], cat=t['category'], strategy=t['strategy'], cycle=t['cycle'], outage=t['outage'], pre=split(t['precedes']), fb=split(t['feeds_back_to'])) for t in tasks])} AS r
MERGE (t:MaintenanceTask {{id: r.id}}) SET t.name = r.name, t.category = r.cat, t.strategy = r.strategy, t.cycle = r.cycle, t.outage = (r.outage = 'Y')
WITH t, r
FOREACH (p IN r.pre | MERGE (n:MaintenanceTask {{id: p}}) MERGE (t)-[:PRECEDES]->(n))
FOREACH (p IN r.fb | MERGE (n:MaintenanceTask {{id: p}}) MERGE (t)-[:FEEDS_BACK_TO]->(n));

UNWIND {cylist([dict(id=f['fm_id'], name=f['name'], kind=f['asset_kind'], part=f['component_kind'], det=split(f['detected_by']), mit=split(f['mitigated_by']), effect=f['effect']) for f in fms])} AS r
MERGE (f:FailureMode {{id: r.id}}) SET f.name = r.name, f.assetKind = r.kind, f.componentKind = r.part, f.effect = r.effect
WITH f, r
FOREACH (x IN r.det | MERGE (t:MaintenanceTask {{id: x}}) MERGE (f)-[:DETECTED_BY]->(t))
FOREACH (x IN r.mit | MERGE (t:MaintenanceTask {{id: x}}) MERGE (f)-[:MITIGATED_BY]->(t));

UNWIND {cylist([dict(id=g['diag_id'], a=g['asset_id'], t=g['task_id'], date=g['date'], finding=g['finding'], j=g['judgement'], fm=g['fm_id']) for g in diags])} AS r
MATCH (a:Asset {{id: r.a}}), (t:MaintenanceTask {{id: r.t}})
MERGE (g:Diagnosis {{id: r.id}}) SET g.date = r.date, g.finding = r.finding, g.judgement = r.j
MERGE (g)-[:ON_ASSET]->(a) MERGE (g)-[:USES_METHOD]->(t)
WITH g, r
FOREACH (_ IN CASE WHEN r.fm <> '' THEN [1] ELSE [] END | MERGE (f:FailureMode {{id: r.fm}}) MERGE (g)-[:INDICATES]->(f));

UNWIND {cylist([dict(id=w['wo_id'], a=w['asset_id'], t=w['task_id'], fm=w['fm_id'], status=w['status'], planned=w['planned'], done=w['done'], outage=float(w['outage_h']), trig=w['trigger']) for w in wos])} AS r
MATCH (a:Asset {{id: r.a}}), (t:MaintenanceTask {{id: r.t}}), (f:FailureMode {{id: r.fm}}), (g:Diagnosis {{id: r.trig}})
MERGE (w:WorkOrder {{id: r.id}}) SET w.status = r.status, w.planned = r.planned, w.done = r.done, w.outageHours = r.outage
MERGE (w)-[:ON_ASSET]->(a) MERGE (w)-[:PERFORMS]->(t) MERGE (w)-[:ADDRESSES]->(f) MERGE (w)-[:TRIGGERED_BY]->(g);
"""
(HERE / "neo4j").mkdir(exist_ok=True)
(HERE / "neo4j" / "import.cypher").write_text(CYPHER, encoding="utf-8")

# ---------------------------------------------------------------- 검증: Neo4j Cypher (형상검증 + 역량 질문)
# import.cypher를 그대로 적재한 그래프에 neo4j/queries.cypher(역량 질문)와 neo4j/checks.cypher(형상검증)를 실행.
# Neo4j 서버 없이 tools/cypher.mjs(브라우저 실습과 같은 엔진)로 돌리며, Neo4j에서도 같은 파일을 그대로 쓸 수 있다.
from pycim.cypher import run as run_cypher  # noqa: E402

NEO = "examples/asset/neo4j/"
res = run_cypher(load=NEO + "import.cypher", queries=NEO + "queries.cypher", checks=NEO + "checks.cypher")
cell = lambda v: "" if v is None else str(v)  # noqa: E731
checks = sorted((dict(focus=cell(row[0]), severity=c["severity"], rule=c["id"], message=f"{c['ko']} / {c['en']}")
                 for c in res["checks"] for row in c["rows"]), key=lambda x: (x["severity"], x["focus"]))
conforms = not any(c["severity"] == "Violation" for c in checks)
cq_out = [dict(q=q["title"], rows=[[cell(v) for v in row] for row in q["rows"]]) for q in res["queries"]]

# ---------------------------------------------------------------- 웹 데이터
web = dict(
    asOf=AS_OF.isoformat(), virtual=True,
    rules=dict(judgePenalty=JUDGE_PENALTY, pofCuts=[80, 60, 40, 20], cofCutsMWh=[100, 500, 2000, 10000]),
    locations=[dict(**x, outageMW=OUTAGE[x["location"]][0], lostLoads=OUTAGE[x["location"]][1],
                    asset=next((a for a, l in current_loc.items() if l == x["location"]), None)) for x in locs],
    assets=[dict(**a, kindKo=KIND_KO[a["kind"]], location=current_loc.get(a["asset_id"]),
                 calc=calc.get(a["asset_id"]),
                 components=[c for c in comps if c["asset_id"] == a["asset_id"]],
                 deployments=[x for x in deps if x["asset_id"] == a["asset_id"]]) for a in assets],
    tasks=tasks, failureModes=fms, diagnoses=diags, workOrders=wos,
    overdue=overdue, gaps=gaps, checks=checks, cq=cq_out,
)
(ROOT / "assets" / "data" / "asset.json").write_text(json.dumps(web, ensure_ascii=False, indent=1), encoding="utf-8")

# ---------------------------------------------------------------- 요약 출력
if __name__ == "__main__":
    print(f"Neo4j 그래프: 노드 {res['graph']['nodes']}개 · 관계 {res['graph']['relationships']}개 (import.cypher)")
    print("\n== 위험도 (기준일 %s) ==" % AS_OF)
    for aid, c in sorted(calc.items(), key=lambda x: -x[1]["risk"]):
        print(f"{aid:11s} HI {c['hi']:5.1f}  PoF {c['pof']}  정전 {c['outage_mw']}MW × 복구 → {c['mwh']:>6} MWh  CoF {c['cof']}  위험도 {c['risk']:2d} ({c['level']})"
              + (f"  · 예비품 확보 시 {c['risk_spare']}" if c["risk_spare"] != c["risk"] else ""))
    print("\n== 점검 기록 없음·주기 초과 ==")
    for o in overdue:
        print(f"{o['asset']} {o['task']} {T[o['task']]['name']}: {o['state']}")
    print("\n== 자산 기록이 없는 기능 위치 ==", ", ".join(gaps) or "없음")
    print(f"\n== 형상검증 (Cypher): {'위반 없음' if conforms else '위반 있음'} ==")
    for c in checks:
        print(f"[{c['severity']}] {c['rule']} {c['focus']}: {c['message']}")
    print("\n== 역량 질문 ==")
    for c in cq_out:
        print("Q.", c["q"], "→", c["rows"])
