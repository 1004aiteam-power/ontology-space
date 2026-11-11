# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""자산관리셸(AAS, Asset Administration Shell) 예제 데이터셋 빌드 (⚠ 가상 데이터).

자산관리 온톨로지의 주변압기 본체(AS-TR-0007) 한 대를 AAS 메타모델 V3.0(IDTA-01001-3-0) 모양으로 다시 적는다.
값은 새로 만들지 않고 examples/asset 의 원본 CSV와 asset-ontology.ttl(계산값)에서 가져온다.

원본: examples/asset/data/*.csv · examples/asset/asset-ontology.ttl
생성: examples/aas/aas-mtr1.json     AAS 환경(Environment) JSON: 셸 1 · 서브모델 4 · 개념 설명 5
      examples/aas/aas-mtr1.ttl      같은 내용의 AAS RDF 직렬화 (이름공간 https://admin-shell.io/aas/3/0/)
      examples/aas/aas-links.ttl     다리: AAS 안의 문자열 참조 가운데 이 사이트 온톨로지의 개체를 가리키는 것을 실제 연결로
      assets/data/aas.json           웹페이지(aas.html) 데이터
질의: examples/aas/queries.cypher   위 두 Turtle + asset-ontology.ttl 을 한 그래프로 불러 실행 (tools/cypher.mjs)

AAS ↔ 온톨로지 연결 세 가지
  1) AssetInformation.globalAssetId = 온톨로지의 자산 개체 IRI (pam:AS_TR_0007)
  2) 요소의 semanticId = 온톨로지 속성·클래스 IRI (pam:healthIndex, cim:PowerTransformerEnd.ratedS …)
     명판(Nameplate)은 IDTA 02006-3-0 템플릿의 IEC CDD 식별자를 그대로 사용
  3) ReferenceElement · valueId · ConceptDescription.isCaseOf = 온톨로지 개체 · 용어 IRI

실행: python examples/aas/build_aas.py   (저장소 루트에서, Node.js 필요)
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDFS

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
HERE = Path(__file__).resolve().parent
ASSET = ROOT / "examples" / "asset"

SITE = "https://1004aiteam-power.github.io/ontology-space/"
PAM = Namespace(SITE + "asset#")
CIM = "http://iec.ch/TC57/CIM100#"
EX = "http://example.org/grid#"
AAS_NS = "https://admin-shell.io/aas/3/0/"
LINK = SITE + "aas/links#"
ASSET_ID = "AS-TR-0007"
AS_OF = "2026-11-03"                      # 자산관리 온톨로지의 기준일 (건전도 · 위험도 계산 시점)

# IDTA 02006-3-0 Digital Nameplate 템플릿의 식별자 (admin-shell-io/submodel-templates 의 템플릿 JSON에서 옮김)
NAMEPLATE = "https://admin-shell.io/idta/nameplate/3/0/Nameplate"
NP = {
    "URIOfTheProduct": "0112/2///61987#ABN590#002",
    "ManufacturerName": "0112/2///61987#ABA565#009",
    "ManufacturerProductDesignation": "0112/2///61987#ABA567#009",
    "ManufacturerProductType": "0112/2///61987#ABA300#008",
    "OrderCodeOfManufacturer": "0112/2///61987#ABA950#008",
    "YearOfConstruction": "0112/2///61987#ABP000#002",
    "CountryOfOrigin": "0112/2///61987#ABP462#001",
}
IEC61360 = "https://admin-shell.io/DataSpecificationTemplates/DataSpecificationIec61360/3/0"


def read(name: str) -> list[dict]:
    with open(ASSET / "data" / name, encoding="utf-8") as f:
        return [{k: (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


# ---------------------------------------------------------------- 원본 읽기
onto = Graph().parse(ASSET / "asset-ontology.ttl")
asset = next(a for a in read("assets.csv") if a["asset_id"] == ASSET_ID)
comps = [c for c in read("components.csv") if c["asset_id"] == ASSET_ID]
diags = sorted((g for g in read("diagnoses.csv") if g["asset_id"] == ASSET_ID), key=lambda g: g["date"])
tasks = {t["task_id"]: t for t in read("tasks.csv")}
A = PAM[ASSET_ID.replace("-", "_")]
JUDGE = {"정상": "Normal", "주의": "Caution", "이상": "Abnormal"}


def onto_value(prop: str):
    v = onto.value(A, PAM[prop])
    if v is None:
        raise SystemExit(f"asset-ontology.ttl 에 pam:{prop} 값이 없습니다")
    return v


def num(v) -> str:
    """xs:decimal · xs:integer 값의 표기 (53.0 → 53, 8.5 → 8.5)."""
    f = float(v)
    return str(int(f)) if f == int(f) else repr(f)


m = re.fullmatch(r"(\d+(?:\.\d+)?)MVA (\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)kV (\S+)", asset["rating"])
if not m:
    raise SystemExit(f"정격 표기를 읽을 수 없습니다: {asset['rating']}")
RATED_MVA, RATED_HV, RATED_LV, COOLING = m.groups()
LOCATION = str(onto_value("installedAt"))


# ---------------------------------------------------------------- AAS 요소 만들기 (JSON 직렬화 모양 그대로)
def ext(iri: str) -> dict:
    """AAS 밖의 것을 가리키는 참조 (온톨로지 IRI · IEC CDD 식별자 …)."""
    return {"type": "ExternalReference", "keys": [{"type": "GlobalReference", "value": str(iri)}]}


def ko(text: str) -> list[dict]:
    return [{"language": "ko", "text": text}]


def prop(id_short: str, value, value_type: str, sem: str, name: str | None = None, value_id: str | None = None) -> dict:
    e = {"idShort": id_short}
    if name:
        e["displayName"] = ko(name)
    e |= {"semanticId": ext(sem), "valueType": value_type, "value": str(value)}
    if value_id:
        e["valueId"] = ext(value_id)
    return e | {"modelType": "Property"}


def mlp(id_short: str, text: str, sem: str) -> dict:
    return {"idShort": id_short, "semanticId": ext(sem), "value": ko(text), "modelType": "MultiLanguageProperty"}


def ref_el(id_short: str, target: str, sem: str, name: str | None = None) -> dict:
    e = {"idShort": id_short}
    if name:
        e["displayName"] = ko(name)
    return e | {"semanticId": ext(sem), "value": ext(target), "modelType": "ReferenceElement"}


def submodel(id_short: str, name: str, sem: str, elements: list[dict]) -> dict:
    return {"idShort": id_short, "displayName": ko(name), "id": f"{SITE}aas/sm/{ASSET_ID}/{id_short}", "kind": "Instance",
            "semanticId": ext(sem), "submodelElements": elements, "modelType": "Submodel"}


OWN = SITE + "aas/semantics/"          # 이 예제가 직접 정한 서브모델 뜻 (IDTA 템플릿이 아닌 것)

nameplate = submodel("Nameplate", "명판", NAMEPLATE, [
    prop("URIOfTheProduct", A, "xs:anyURI", NP["URIOfTheProduct"]),
    mlp("ManufacturerName", asset["manufacturer"], NP["ManufacturerName"]),
    mlp("ManufacturerProductDesignation", f"{asset['rating']} 변압기", NP["ManufacturerProductDesignation"]),
    prop("ManufacturerProductType", asset["model"], "xs:string", NP["ManufacturerProductType"]),
    prop("OrderCodeOfManufacturer", asset["model"], "xs:string", NP["OrderCodeOfManufacturer"]),
    prop("YearOfConstruction", asset["year_made"], "xs:string", NP["YearOfConstruction"]),
    prop("CountryOfOrigin", "KR", "xs:string", NP["CountryOfOrigin"]),
])

technical = submodel("TechnicalData", "기술 데이터", OWN + "TechnicalData/1/0", [
    prop("RatedPower", RATED_MVA, "xs:decimal", CIM + "PowerTransformerEnd.ratedS", "정격 용량 (MVA)"),
    prop("RatedVoltageHV", RATED_HV, "xs:decimal", CIM + "PowerTransformerEnd.ratedU", "1차 정격 전압 (kV)"),
    prop("RatedVoltageLV", RATED_LV, "xs:decimal", CIM + "PowerTransformerEnd.ratedU", "2차 정격 전압 (kV)"),
    prop("CoolingType", COOLING, "xs:string", OWN + "CoolingType", "냉각 방식"),
    prop("DesignLifeYears", num(onto_value("designLifeYears")), "xs:integer", PAM.designLifeYears, "설계 수명 (년)"),
])


def diagnosis(g: dict) -> dict:
    """진단 기록 한 건. SubmodelElementList 의 항목은 idShort 를 갖지 않는다 (제약 AASd-120)."""
    tid = g["task_id"].replace("-", "_")
    return {"semanticId": ext(PAM.Diagnosis), "value": [
        ref_el("Record", PAM[g["diag_id"].replace("-", "_")], PAM.Diagnosis, "온톨로지의 진단 기록"),
        prop("Date", g["date"], "xs:date", PAM.date, "진단일"),
        prop("Method", tasks[g["task_id"]]["name"], "xs:string", PAM.usesMethod, "진단 방법", value_id=PAM[tid]),
        prop("Finding", g["finding"], "xs:string", PAM.finding, "소견"),
        prop("Judgement", g["judgement"], "xs:string", PAM.judgement, "판정", value_id=PAM[JUDGE[g["judgement"]]]),
    ], "modelType": "SubmodelElementCollection"}


condition = submodel("ConditionAndRisk", "상태 · 위험도", OWN + "ConditionAndRisk/1/0", [
    ref_el("FunctionalLocation", LOCATION, PAM.installedAt, "현재 설치 위치 (전력망의 기능 위치)"),
    prop("EamNumber", onto_value("eamNumber"), "xs:string", PAM.eamNumber, "EAM 설비번호"),
    prop("Status", asset["status"], "xs:string", PAM.status, "운전 상태"),
    prop("HealthIndex", num(onto_value("healthIndex")), "xs:decimal", PAM.healthIndex, "건전도 지수 (0~100)"),
    prop("ProbabilityOfFailure", num(onto_value("probabilityOfFailure")), "xs:integer", PAM.probabilityOfFailure, "고장 가능성 (1~5)"),
    prop("ConsequenceOfFailure", num(onto_value("consequenceOfFailure")), "xs:integer", PAM.consequenceOfFailure, "고장 영향 (1~5)"),
    prop("RiskScore", num(onto_value("riskScore")), "xs:integer", PAM.riskScore, "위험도 (PoF × CoF)"),
    {"idShort": "Diagnoses", "displayName": ko("진단 기록"), "semanticId": ext(PAM.Diagnosis), "orderRelevant": True,
     "typeValueListElement": "SubmodelElementCollection", "value": [diagnosis(g) for g in diags], "modelType": "SubmodelElementList"},
])

bom = submodel("BillOfMaterial", "구성품", OWN + "BillOfMaterial/1/0", [
    {"idShort": c["component_id"].replace("-", "_"), "displayName": ko(c["name"]), "semanticId": ext(PAM.Component),
     "statements": [prop("ComponentType", c["kind"], "xs:string", PAM.componentType, "구성품 종류", value_id=PAM["CT_" + c["kind"]]),
                    ref_el("Record", PAM[c["component_id"].replace("-", "_")], PAM.hasComponent, "온톨로지의 구성품 개체")],
     "entityType": "CoManagedEntity", "modelType": "Entity"} for c in comps
])


def concept(id_short: str, name: str, definition: str, case_of: str, data_type: str, unit: str | None = None) -> dict:
    content = {"preferredName": ko(name)}
    if unit:
        content["unit"] = unit
    content |= {"dataType": data_type, "definition": ko(definition), "modelType": "DataSpecificationIec61360"}
    return {"idShort": id_short, "id": f"{SITE}aas/cd/{id_short}",
            "embeddedDataSpecifications": [{"dataSpecification": ext(IEC61360), "dataSpecificationContent": content}],
            "isCaseOf": [ext(case_of)], "modelType": "ConceptDescription"}


def label(term: URIRef) -> str:
    return str(next((x for x in onto.objects(term, RDFS.label) if isinstance(x, Literal)), ""))


concepts = [
    concept("RatedPower", "정격 용량", "변압기 권선의 정격 피상전력. IEC CIM 의 PowerTransformerEnd.ratedS 와 같은 뜻.", CIM + "PowerTransformerEnd.ratedS", "REAL_MEASURE", "MVA"),
    concept("RatedVoltage", "정격 전압", "변압기 권선의 정격 전압. IEC CIM 의 PowerTransformerEnd.ratedU 와 같은 뜻.", CIM + "PowerTransformerEnd.ratedU", "REAL_MEASURE", "kV"),
    concept("HealthIndex", "건전도 지수", "경과연수와 최신 진단 판정으로 계산한 0~100 점수. 자산관리 온톨로지의 pam:healthIndex 와 같은 뜻.", PAM.healthIndex, "REAL_MEASURE"),
    concept("RiskScore", "위험도", "고장 가능성(1~5) × 고장 영향(1~5). 자산관리 온톨로지의 pam:riskScore 와 같은 뜻.", PAM.riskScore, "INTEGER_MEASURE"),
    concept("DesignLifeYears", "설계 수명", "제작사가 정한 설계 수명. 자산관리 온톨로지의 pam:designLifeYears 와 같은 뜻.", PAM.designLifeYears, "INTEGER_MEASURE", "a"),
]

submodels = [nameplate, technical, condition, bom]
shell = {
    "idShort": "MTr1_" + ASSET_ID.replace("-", "_"),
    "displayName": ko(asset["name"]),
    "description": ko(f"가상 A변전소 주변압기 #1 본체의 자산관리셸 (가상 데이터, 기준일 {AS_OF})"),
    "id": f"{SITE}aas/shell/{ASSET_ID}",
    "assetInformation": {
        "assetKind": "Instance",
        "globalAssetId": str(A),
        "specificAssetIds": [{"name": "eamNumber", "value": str(onto_value("eamNumber")), "semanticId": ext(PAM.eamNumber)}],
        "assetType": str(PAM[asset["kind"]]),
    },
    "submodels": [{"type": "ModelReference", "keys": [{"type": "Submodel", "value": s["id"]}]} for s in submodels],
    "modelType": "AssetAdministrationShell",
}
ENV = {"assetAdministrationShells": [shell], "submodels": submodels, "conceptDescriptions": concepts}


# ---------------------------------------------------------------- 검사: 메타모델의 기본 제약 (JSON 스키마 대신 직접 확인)
def walk(e: dict, path: str = ""):
    """서브모델 요소를 깊이 우선으로: (경로, 요소, 목록 항목인가)."""
    for key, in_list in (("submodelElements", False), ("statements", False), ("value", e.get("modelType") == "SubmodelElementList")):
        kids = e.get(key)
        if isinstance(kids, list) and kids and isinstance(kids[0], dict) and "modelType" in kids[0]:
            for i, k in enumerate(kids):
                p = f"{path}[{i}]" if in_list else f"{path}.{k['idShort']}" if path else k.get("idShort", "")
                yield p, k, in_list
                yield from walk(k, p)


def check_env(env: dict) -> list[str]:
    bad = []
    ids = [x["id"] for k in env for x in env[k]]
    bad += [f"id 중복: {i}" for i in set(ids) if ids.count(i) > 1]
    sm_ids = {s["id"] for s in env["submodels"]}
    for sh in env["assetAdministrationShells"]:
        ai = sh["assetInformation"]
        if not (ai.get("globalAssetId") or ai.get("specificAssetIds")):
            bad.append(f"{sh['idShort']}: globalAssetId 나 specificAssetIds 가 있어야 함 (AASd-131)")
        bad += [f"{sh['idShort']}: 없는 서브모델 참조 {r['keys'][0]['value']}" for r in sh["submodels"] if r["keys"][0]["value"] not in sm_ids]
    for s in env["submodels"]:
        seen: dict[str, set] = {}
        for path, e, in_list in walk(s):
            parent = path.rsplit(".", 1)[0] if "." in path and not in_list else ""
            if in_list:
                if "idShort" in e:
                    bad.append(f"{s['idShort']}.{path}: 목록 항목은 idShort 를 갖지 않음 (AASd-120)")
            elif not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", e.get("idShort", "")):
                bad.append(f"{s['idShort']}.{path}: idShort 형식 (AASd-002)")
            elif e["idShort"] in seen.setdefault(parent, set()):
                bad.append(f"{s['idShort']}.{path}: 같은 자리에 idShort 중복 (AASd-022)")
            else:
                seen[parent].add(e["idShort"])
            if e["modelType"] == "Property" and "valueType" not in e:
                bad.append(f"{s['idShort']}.{path}: Property 는 valueType 필수")
            if e["modelType"] == "Entity" and e["entityType"] == "CoManagedEntity" and ("globalAssetId" in e or "specificAssetIds" in e):
                bad.append(f"{s['idShort']}.{path}: CoManagedEntity 는 자산 식별자를 갖지 않음 (AASd-014)")
    return bad


# ---------------------------------------------------------------- AAS JSON → AAS RDF (IDTA-01001 의 RDF 대응 규칙)
# 술어 IRI = 이름공간 + 그 속성을 정의한 (추상) 클래스 + "/" + 속성 이름. 식별자가 있는 것(Identifiable)만 IRI, 나머지는 빈 노드.
SHARED = {"idShort": "Referable", "displayName": "Referable", "description": "Referable", "id": "Identifiable",
          "semanticId": "HasSemantics", "kind": "HasKind", "embeddedDataSpecifications": "HasDataSpecification"}
LANG_TYPE = {"displayName": "LangStringNameType", "description": "LangStringTextType", "value": "LangStringTextType",
             "preferredName": "LangStringPreferredNameTypeIec61360", "definition": "LangStringDefinitionTypeIec61360"}
ENUM = {"assetKind": "AssetKind", "kind": "ModellingKind", "entityType": "EntityType", "typeValueListElement": "AasSubmodelElements",
        "valueType": "DataTypeDefXsd", "dataType": "DataTypeIec61360"}
NESTED = {"assetInformation": "AssetInformation", "specificAssetIds": "SpecificAssetId", "embeddedDataSpecifications": "EmbeddedDataSpecification"}


def enum_name(v: str) -> str:
    """xs:anyURI → AnyUri, REAL_MEASURE → RealMeasure, Instance → Instance."""
    v = v.removeprefix("xs:")
    if "_" in v:
        return "".join(w.capitalize() for w in v.split("_"))
    return re.sub(r"[A-Z]{2,}", lambda x: x.group(0).capitalize(), v[0].upper() + v[1:])


def lit(v) -> str:
    s = json.dumps(str(v), ensure_ascii=False)
    return f"{s}^^xs:{'boolean' if isinstance(v, bool) else 'string'}".replace('"True"', '"true"').replace('"False"', '"false"')


def rdf_node(o: dict, cls: str, ind: int) -> list[str]:
    """객체 하나의 '술어 목적어 ;' 줄들."""
    pad, out = "    " * ind, []
    for key, v in o.items():
        if key == "modelType":
            continue
        pred = f"<{AAS_NS}{SHARED.get(key, cls)}/{key}>"
        for item in v if isinstance(v, list) else [v]:
            if key == "type" and cls in ("Reference", "Key"):
                out.append(f"{pad}{pred} <{AAS_NS}{'ReferenceTypes' if cls == 'Reference' else 'KeyTypes'}/{item}> ;")
            elif key in ENUM and isinstance(item, str):
                out.append(f"{pad}{pred} <{AAS_NS}{ENUM[key]}/{enum_name(item)}> ;")
            elif isinstance(item, dict):
                if "language" in item:
                    sub = LANG_TYPE[key]
                    body = [f"{pad}    <{AAS_NS}AbstractLangString/language> {lit(item['language'])} ;", f"{pad}    <{AAS_NS}AbstractLangString/text> {lit(item['text'])} ;"]
                else:
                    sub = (item.get("modelType") or NESTED.get(key) or ("Key" if key == "keys" else "Reference"))
                    body = rdf_node(item, sub, ind + 1)
                out += [f"{pad}{pred} [", f"{pad}    rdf:type aas:{sub} ;", *body, f"{pad}] ;"]
            else:
                out.append(f"{pad}{pred} {lit(item)} ;")
    return out


def to_rdf(env: dict) -> str:
    out = [f"# 자산관리셸 예제: 가상 A변전소 주변압기 #1 본체 ({ASSET_ID}) — AAS 메타모델 V3.0 의 RDF 직렬화 (⚠ 가상 데이터)",
           "# examples/aas/build_aas.py 가 aas-mtr1.json 과 함께 만든 파일. 손으로 고치지 마세요.",
           f"@prefix aas: <{AAS_NS}> .", "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .", "@prefix xs:  <http://www.w3.org/2001/XMLSchema#> .", ""]
    for key in ("assetAdministrationShells", "submodels", "conceptDescriptions"):
        for x in env[key]:
            out += [f"<{x['id']}> rdf:type aas:{x['modelType']} ;", *rdf_node(x, x["modelType"], 1), ".", ""]
    return "\n".join(out)


# ---------------------------------------------------------------- 다리: 문자열 참조 → 실제 연결
def to_links(env: dict) -> str:
    """AAS RDF 에서 참조는 Key 의 문자열 값이라 그대로는 다른 그래프와 이어지지 않는다.
    온톨로지에 실제로 있는 개체를 가리키는 것만 골라 IRI 연결로 적는다 (없는 IRI 를 가리키면 빌드 실패)."""
    individuals = {str(s) for s in onto.subjects() if isinstance(s, URIRef)} | {str(o) for o in onto.objects(None, PAM.installedAt)}
    out = ["# 다리: 자산관리셸(aas-mtr1.ttl) → 자산관리 온톨로지(examples/asset/asset-ontology.ttl) · 예제 변전소 (⚠ 가상 데이터)",
           "# examples/aas/build_aas.py 가 만든 파일. 손으로 고치지 마세요.",
           f"@prefix aasl: <{LINK}> .", "@prefix owl:  <http://www.w3.org/2002/07/owl#> .", "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .", "",
           f"<{SITE}aas/links> a owl:Ontology ; rdfs:label \"자산관리셸 ↔ 온톨로지 연결\"@ko .",
           "aasl:describes a owl:ObjectProperty ; rdfs:label \"설명하는 자산\"@ko ; rdfs:comment \"AssetInformation.globalAssetId 가 가리키는 온톨로지의 자산 개체.\"@ko .",
           "aasl:hasSubmodel a owl:ObjectProperty ; rdfs:label \"서브모델\"@ko ; rdfs:comment \"셸의 submodels 참조(문자열 키)를 실제 서브모델로 이은 것.\"@ko .",
           "aasl:ResolvedReference a owl:Class ; rdfs:label \"풀어 낸 참조\"@ko ; rdfs:comment \"ReferenceElement 하나. AAS RDF 에서는 빈 노드라 밖에서 가리킬 수 없어, 서브모델과 idShort 경로로 다시 적는다.\"@ko .",
           "aasl:inSubmodel a owl:ObjectProperty ; rdfs:domain aasl:ResolvedReference ; rdfs:label \"속한 서브모델\"@ko .",
           "aasl:idShortPath a owl:DatatypeProperty ; rdfs:domain aasl:ResolvedReference ; rdfs:label \"idShort 경로\"@ko ; rdfs:comment \"서브모델 안에서 요소를 찾아가는 경로 (AAS API 의 idShortPath 와 같은 표기).\"@ko .",
           "aasl:refersTo a owl:ObjectProperty ; rdfs:domain aasl:ResolvedReference ; rdfs:label \"가리키는 개체\"@ko ; rdfs:comment \"ReferenceElement 의 값이 가리키는 온톨로지 개체.\"@ko .", ""]

    def need(iri: str, where: str) -> str:
        if iri not in individuals:
            raise SystemExit(f"{where}: 온톨로지에 없는 IRI {iri}")
        return iri

    for sh in env["assetAdministrationShells"]:
        out.append(f"<{sh['id']}> aasl:describes <{need(sh['assetInformation']['globalAssetId'], 'globalAssetId')}> ;")
        out.append("    aasl:hasSubmodel " + " ,\n        ".join(f"<{r['keys'][0]['value']}>" for r in sh["submodels"]) + " .")
    out.append("")
    for s in env["submodels"]:
        for path, e, _ in walk(s):
            if e["modelType"] == "ReferenceElement":
                out.append(f"<{s['id']}#{path}> a aasl:ResolvedReference ; aasl:inSubmodel <{s['id']}> ; aasl:idShortPath \"{path}\" ;\n"
                           f"    aasl:refersTo <{need(e['value']['keys'][0]['value'], path)}> .")
    return "\n".join(out) + "\n"


problems = check_env(ENV)
if problems:
    raise SystemExit("AAS 제약 위반:\n  " + "\n  ".join(problems))
JSON_TEXT = json.dumps(ENV, ensure_ascii=False, indent=2) + "\n"
TTL = to_rdf(ENV)
LINKS = to_links(ENV)
(HERE / "aas-mtr1.json").write_text(JSON_TEXT, encoding="utf-8")
(HERE / "aas-mtr1.ttl").write_text(TTL, encoding="utf-8")
(HERE / "aas-links.ttl").write_text(LINKS, encoding="utf-8")

# ---------------------------------------------------------------- 질의: 세 파일을 한 그래프로 (Neo4j 에 불러올 때와 같은 방식)
from pycim.cypher import run as run_cypher  # noqa: E402

FILES = ["examples/aas/aas-mtr1.ttl", "examples/aas/aas-links.ttl", "examples/asset/asset-ontology.ttl"]


def read_queries() -> list[dict]:
    """queries.cypher: 문장 앞 주석의 마지막 줄이 제목 (한국어 / English), 그 앞 주석은 설명."""
    out = []
    for block in (HERE / "queries.cypher").read_text(encoding="utf-8").split(";\n"):
        lines = [x for x in block.strip().splitlines()]
        head = [x[2:].strip() for x in lines if x.startswith("//")]
        body = "\n".join(x for x in lines if not x.startswith("//")).strip()
        if body:
            q, _, en = re.sub(r"^Q\d+\.\s*", "", head[-1]).partition(" / ")
            out.append(dict(q=q, en=en, cypher=body))
    return out


def run_queries(files: list[str] = FILES) -> tuple[list[dict], dict]:
    res = run_cypher(ttl=files, queries="examples/aas/queries.cypher")
    cell = lambda v: "" if v is None else str(v)  # noqa: E731
    qs = read_queries()
    assert len(qs) == len(res["queries"])
    return [q | dict(columns=r["columns"], rows=[[cell(v) for v in row] for row in r["rows"]]) for q, r in zip(qs, res["queries"])], res["graph"]


cq_out, graph = run_queries()
aas_only = run_cypher(ttl=FILES[:1])["graph"]

# ---------------------------------------------------------------- 웹 데이터
# 뜻(semanticId)으로 쓰인 식별자마다: 어디 것인지, 온톨로지에 이름표가 있으면 그 이름표
def source(iri: str) -> str:
    return ("pam" if iri.startswith(str(PAM)) else "cim" if iri.startswith(CIM) else "grid" if iri.startswith(EX)
            else "idta" if iri.startswith("https://admin-shell.io/") else "cdd" if iri.startswith("0112/") else "own")


terms: dict[str, dict] = {}


def collect(o) -> None:
    if isinstance(o, dict):
        if o.get("type") == "ExternalReference":
            iri = o["keys"][0]["value"]
            terms[iri] = dict(source=source(iri), label=label(URIRef(iri)) if iri.startswith("http") else "")
        for v in o.values():
            collect(v)
    elif isinstance(o, list):
        for v in o:
            collect(v)


collect(ENV)
terms[str(A)] = dict(source="pam", label=label(A))
elements = sum(1 for s in submodels for _ in walk(s))
web = dict(
    asOf=AS_OF, virtual=True, asset=ASSET_ID, env=ENV, terms=terms,
    files=dict(json="examples/aas/aas-mtr1.json", ttl="examples/aas/aas-mtr1.ttl", links="examples/aas/aas-links.ttl", queries="examples/aas/queries.cypher"),
    stats=dict(submodels=len(submodels), elements=elements, concepts=len(concepts), jsonBytes=len(JSON_TEXT.encode("utf-8")),
               triples=len(Graph().parse(data=TTL, format="turtle")), linkTriples=sum(1 for _, p, _ in Graph().parse(data=LINKS, format="turtle") if str(p) in (LINK + "describes", LINK + "hasSubmodel", LINK + "refersTo")),
               aasNodes=aas_only["nodes"], aasRels=aas_only["relationships"], nodes=graph["nodes"], rels=graph["relationships"]),
    cq=cq_out,
)
(ROOT / "assets" / "data" / "aas.json").write_text(json.dumps(web, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    st = web["stats"]
    print(f"AAS 환경: 셸 1 · 서브모델 {st['submodels']} · 요소 {st['elements']} · 개념 설명 {st['concepts']}  ({st['jsonBytes']:,} bytes JSON)")
    print(f"AAS RDF: 트리플 {st['triples']}개 → 속성 그래프 노드 {st['aasNodes']} · 관계 {st['aasRels']}")
    print(f"다리 {st['linkTriples']}개를 더해 자산관리 온톨로지와 합친 그래프: 노드 {st['nodes']} · 관계 {st['rels']}")
    print("\n== 역량 질문 ==")
    for i, c in enumerate(cq_out, 1):
        print(f"Q{i}. {c['q']}")
        for r in c["rows"]:
            print("    " + " | ".join(r))
        if not c["rows"]:
            print("    (결과 없음)")
