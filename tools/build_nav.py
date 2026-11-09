# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""모든 페이지의 위쪽 메뉴(<nav>)를 한 곳(아래 NAV)에서 다시 만든다.

메뉴를 바꿀 때는 이 파일의 NAV만 고치고 실행: python tools/build_nav.py
현재 페이지의 링크에는 aria-current="page", 그 링크가 든 드롭다운 버튼에는 class="menu-btn current"를 붙인다.
<head>에는 파비콘과 링크 공유 미리보기(Open Graph · Twitter 카드) 태그도 함께 넣는다 (페이지의 제목·설명에서 만듦).
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# (href, 한국어, English, 한국어 설명, English description) — 설명이 None이면 위쪽 줄의 단순 링크
# ("hr",) = 구분선, ("h", 한국어, English) = 메뉴 안의 작은 제목
NAV = [
    ("index.html", "소개", "Intro"),
    ("menu", "gridMenu", "전력망 온톨로지", "Power Grid Ontology", [
        ("grid.html", "전력망 온톨로지", "Power grid ontology", "IEC CIM · 토폴로지 · 관련 표준", "IEC CIM · topology · related standards"),
        ("project.html", "pycim 프로젝트", "pycim project", "CIM을 파이썬 클래스로 · 조류계산 · CGMES", "CIM as Python classes · load flow · CGMES"),
        ("lab.html", "Cypher 실습 · 데이터 검증", "Cypher lab · data validation", "브라우저에서 Neo4j Cypher 질의 · 형상검증", "Neo4j Cypher in the browser · shape checks"),
        ("twin.html", "디지털 트윈", "Digital twin", "가상 대한민국 전력망 24시간", "Virtual Korean grid over 24 hours"),
        ("hr",),
        ("grid.html#flisr", "배전선로 고장 복구", "Feeder fault restoration", "D/L #1 구간 고장 → 분리 → 복구 (FLISR)", "D/L #1 fault → isolate → restore (FLISR)"),
    ]),
    ("menu", "vppMenu", "VPP·분산에너지", "VPP · DER", [
        ("vpp.html", "VPP 기본 개념", "VPP basics", "가상발전소란 · 운영 고리 · 기존 발전소와 비교", "What a VPP is · operating loop · vs. conventional plants"),
        ("vpp-market.html", "VPP 가상 전력시장 (그래프 DB)", "VPP virtual market (graph DB)", "VPP 10개 · 배전선로 · 입찰 · 정산 → 온톨로지 → 그래프 DB", "10 VPPs, feeders, bids, settlements → ontology → graph DB"),
        ("hr",),
        ("vpp.html#der", "분산에너지자원(DER)", "Distributed energy resources", "태양광 · ESS · 전기차 · 수요반응", "Solar, storage, EVs, demand response"),
        ("vpp.html#market", "예측 · 입찰 · 정산", "Forecast, bid, settle", "하루 전부터 실시간까지의 흐름", "From day-ahead to real time"),
        ("vpp.html#standards", "통신 · 데이터 표준", "Standards", "IEC 61850-7-420 · IEEE 2030.5 · OpenADR · OCPP", "IEC 61850-7-420 · IEEE 2030.5 · OpenADR · OCPP"),
        ("vpp.html#policy", "국내외 제도 (참고용)", "Rules in Korea and abroad (reference)", "소규모전력중개 · 분산에너지법 · FERC 2222 · 정확하지 않을 수 있음", "Brokerage, Distributed Energy Act, FERC 2222 · may be inaccurate"),
    ]),
    ("menu", "physaiMenu", "피지컬 AI", "Physical AI", [
        ("physical-ai.html", "피지컬 AI 소개", "About Physical AI", "개념 · 관련 기술 · MuJoCo", "Concepts · key technologies · MuJoCo"),
        ("hr",),
        ("physical-ai.html#lab", "NEAT 자율주행", "NEAT Self-driving", "150대가 진화하며 트랙 주행을 배움", "150 cars evolve to drive a track"),
        ("neat-snake.html", "NEAT 스네이크", "NEAT Snake", "150마리가 진화하며 Snake 게임을 배움", "150 snakes evolve to play Snake"),
    ]),
    ("menu", "simMenu", "시뮬레이션", "Simulation", [
        ("h", "전력 현장 교육", "Power field training"),
        ("safety.html", "배전공사 안전 훈련", "Distribution Work Safety", "전주·변압기·맨홀·송전 철탑 현장 · 훈련 기록 인쇄", "Pole, transformer, manhole & tower sites · printable training record"),
        ("hr",), ("h", "교통", "Traffic"),
        ("intersection.html", "교차로 신호", "Intersection", "위에서 본 교차로 · 차량·좌회전·보행 신호", "Top-down junction · through, left &amp; walk signals"),
        ("airport.html", "공항 이착륙", "Airport Runways", "평행 활주로 2개 · 도착·출발 안내판 · 입체 시점", "Two parallel runways · arrival &amp; departure boards · 3D-style view"),
        ("flights.html", "세계 항공 교통", "World Air Traffic", "세계 지도 위 국내선·국제선 항공기 · 대권 항로 · 낮과 밤", "Domestic &amp; international flights on a world map · great circles · day and night"),
        ("hr",), ("h", "자연", "Nature"),
        ("ecosystem.html", "단세포 생태계", "Cell Ecosystem", "초식·육식 세포의 포식자–피식자 개체수 주기 · 진화", "Predator–prey population cycles · evolution"),
    ]),
    ("menu", "studioMenu", "온톨로지 설계실", "Design Studio", [
        ("studio.html", "설계실 소개", "About the studio", "정답 없는 설계를 기록하는 곳", "Where design decisions are recorded"),
        ("ontology-map.html", "온톨로지 지도", "Ontology map", "사이트의 온톨로지가 서로 어떻게 이어지나", "How the site's ontologies connect"),
        ("hr",),
        ("work.html", "업무 온톨로지", "Work Ontology", "가상의 AI추진부 업무 149개", "149 tasks of a fictional department"),
        ("asset.html", "전력설비 자산관리", "Power Asset Management", "가상 A변전소 설비 · 진단 · 위험도", "Virtual substation: assets, diagnoses, risk"),
        ("highway.html", "고속도로·국도 교통", "Road Traffic", "가상 고속도로·국도망 · 24시간 차량 흐름", "Virtual expressways &amp; national roads · 24 h traffic"),
        ("hr",),
        ("ev.html", "고속도로 × 전력망: 전기차 충전", "Roads × Grid: EV Charging", "휴게소 충전 수요 → 배전선로 → 변전소", "Rest-area charging → feeder → substation"),
        ("impact.html", "설비 고장 영향 분석", "Failure Impact Analysis", "자산 위험도 × 배전선로 · 고객 · 복구", "Asset risk × feeder · customers · restoration"),
        ("safety-ontology.html", "배전공사 안전 온톨로지", "Distribution Work Safety Ontology", "현장 단계 · 수칙 · 위험요인 → 업무 · 자산 · 배전선로", "Field steps, rules, hazards → work, assets, feeder"),
        ("hr",), ("h", "자연", "Nature"),
        ("eco-ontology.html", "단세포 생태계 온톨로지", "Cell Ecosystem Ontology", "시뮬레이션 기록 → 혈통 · 포식 · 진화 그래프", "Simulation record → lineage, predation, evolution graph"),
    ]),
]


SITE = "https://1004aiteam-power.github.io/ontology-space/"
# 공유 미리보기 이미지: 시뮬레이션 썸네일(tools/thumbs.cjs)이 있는 페이지는 그것, 나머지는 소개 페이지 화면
OG_IMAGE = {f"{n}.html": f"assets/thumbs/{n}.jpg" for n in ("safety", "intersection", "airport", "flights", "ecosystem")}
OG_DEFAULT = "assets/og/site.jpg"


def head_meta(page: str, s: str) -> str:
    title = re.search(r'<meta name="title-ko" content="([^"]*)"', s) or re.search(r"<title>([^<]*)</title>", s)
    desc = re.search(r'<meta name="description" content="([^"]*)"', s)
    t, d = title.group(1).strip(), desc.group(1) if desc else ""
    url = SITE + ("" if page == "index.html" else page)
    img = SITE + OG_IMAGE.get(page, OG_DEFAULT)
    q = lambda v: html.escape(html.unescape(v), quote=True)  # noqa: E731
    return "\n".join([
        "<!-- head:meta (tools/build_nav.py) -->",
        '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
        '<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">',
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Ontology Space">',
        f'<meta property="og:title" content="{q(t)}">',
        f'<meta property="og:description" content="{q(d)}">',
        f'<meta property="og:url" content="{url}">',
        f'<meta property="og:image" content="{img}">',
        '<meta property="og:locale" content="ko_KR">',
        '<meta name="twitter:card" content="summary_large_image">',
        "<!-- /head:meta -->",
    ])


def add_head_meta(page: str, s: str) -> str:
    s = re.sub(r"<!-- head:meta .*?<!-- /head:meta -->\n", "", s, flags=re.S)
    m = re.search(r'<meta name="description"[^>]*>\n', s) or re.search(r"</title>\n", s)
    return s[:m.end()] + head_meta(page, s) + "\n" + s[m.end():] if m else s


def label(ko: str, en: str) -> str:
    return f'<span lang="ko">{ko}</span><span lang="en">{en}</span>'


# 여러 메뉴에 들어 있는 페이지는 이 메뉴의 버튼만 강조 (링크 표시는 양쪽 다). 지금은 중복 없음.
PRIMARY: dict[str, str] = {}


def build(page: str) -> str:
    cur = lambda href: ' aria-current="page"' if href == page else ""  # noqa: E731
    menus = [it[1] for it in NAV if it[0] == "menu" and any(e[0] == page for e in it[4])]
    primary = PRIMARY.get(page, menus[0] if menus else None)
    out = ["  <nav>"]
    for item in NAV:
        if item[0] != "menu":
            href, ko, en = item
            out.append(f'    <a href="{href}"{cur(href)}>{label(ko, en)}</a>')
            continue
        _, mid, ko, en, entries = item
        here = mid == primary
        out.append(f'    <button type="button" class="menu-btn{" current" if here else ""}" aria-expanded="false" aria-controls="{mid}">'
                   f'{label(ko, en)}<span class="caret" aria-hidden="true">▾</span></button>')
        out.append(f'    <div class="menu" id="{mid}" hidden>')
        for e in entries:
            if e[0] == "hr":
                out.append("      <hr>")
            elif e[0] == "h":
                out.append(f'      <p class="menu-h">{label(e[1], e[2])}</p>')
            else:
                href, ko2, en2, dko, den = e
                out.append(f'      <a href="{href}"{cur(href)}>{label(ko2, en2)}<small lang="ko">{dko}</small><small lang="en">{den}</small></a>')
        out.append("    </div>")
    out.append("  </nav>")
    return "\n".join(out)


def main() -> None:
    n = 0
    for f in sorted(ROOT.glob("*.html")):
        s = f.read_text(encoding="utf-8")
        new = re.sub(r"[ \t]*<nav>.*?</nav>", lambda m: build(f.name), s, count=1, flags=re.S)
        new = add_head_meta(f.name, new)
        if new != s:
            f.write_text(new, encoding="utf-8")
            n += 1
    print(f"메뉴·head 태그를 다시 만든 페이지: {n}개")


if __name__ == "__main__":
    main()
