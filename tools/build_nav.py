# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""모든 페이지의 머리말(사이트 이름 · 위쪽 메뉴 · 언어/테마 버튼)과 꼬리말을 한 곳에서 다시 만든다.
새 페이지를 만들 때는 <header class="top"></header> 와 <footer></footer> 만 적어 두면 이 도구가 채운다.

메뉴를 바꿀 때는 이 파일의 NAV만 고치고 실행: python tools/build_nav.py
현재 페이지의 링크에는 aria-current="page", 그 링크가 든 드롭다운 버튼에는 class="menu-btn current"를 붙인다.
<body> 맨 앞에는 "본문 바로가기" 링크를 넣는다.
<head>에는 파비콘과 링크 공유 미리보기(Open Graph · Twitter 카드) 태그, 검색엔진용 대표 주소(canonical)와
언어별 주소(hreflang: 영어는 ?lang=en)도 함께 넣는다 (페이지의 제목·설명에서 만듦).
sitemap.xml 과 robots.txt 도 여기서 만든다 (404.html 은 검색 대상에서 뺌).
스크립트·스타일 주소 뒤의 ?v= 도 여기서 붙인다: 파일 내용(과 그 파일이 불러오는 모듈)의 해시라서, 파일을 고치고
이 도구를 실행하면 방문자의 브라우저가 옛 파일 대신 새 파일을 받는다. 손으로 ?v= 를 고칠 필요가 없다.
"""
from __future__ import annotations

import hashlib
import html
import posixpath
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# (href, 한국어, English, 한국어 설명, English description) — 설명이 None이면 위쪽 줄의 단순 링크
# ("hr",) = 구분선, ("h", 한국어, English) = 메뉴 안의 작은 제목, ("col",) = 여기서부터 다음 열 (긴 메뉴를 옆으로 나눔)
NAV = [
    ("menu", "introMenu", "소개", "Intro", [
        ("index.html", "사이트 소개", "About this site", "전체 구성 · 읽는 순서 · 시뮬레이션 둘러보기", "What is here · reading orders · simulations"),
        ("ontology.html", "온톨로지 입문", "Ontology primer", "개념 · 구성요소 · RDF · OWL · Cypher · 식별자", "Concepts · building blocks · RDF · OWL · Cypher · identifiers"),
        ("hr",),
        ("index.html#why", "왜 온톨로지인가", "Why ontology", "만든 이의 생각", "A personal view"),
    ]),
    ("menu", "gridMenu", "전력망 온톨로지", "Power Grid Ontology", [
        ("grid.html", "전력망 온톨로지", "Power grid ontology", "IEC CIM · 토폴로지 · 관련 표준", "IEC CIM · topology · related standards"),
        ("project.html", "pycim 프로젝트", "pycim project", "CIM을 파이썬 클래스로 · 조류계산 · CGMES", "CIM as Python classes · load flow · CGMES"),
        ("ood.html", "온톨로지 vs. 객체지향 설계", "Ontology vs. OOD", "같은 ESS를 파이썬 클래스와 OWL로 · 일곱 가지 차이", "One battery as Python and OWL · seven differences"),
        ("aas.html", "자산관리셸(AAS)과 온톨로지", "AAS and Ontologies", "AAS 구조 · 온톨로지와의 관계 · 변압기 한 대의 AAS 데이터셋", "AAS structure · how it relates to ontologies · one transformer as an AAS dataset"),
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
        ("vpp.html#collect", "현장 데이터 수집", "Field data collection", "인버터 · 게이트웨이 · 통신 · 플랫폼", "Inverters, gateways, networks, platform"),
        ("vpp.html#policy", "국내외 제도 (참고용)", "Rules in Korea and abroad (reference)", "소규모전력중개 · 분산에너지법 · FERC 2222 · 정확하지 않을 수 있음", "Brokerage, Distributed Energy Act, FERC 2222 · may be inaccurate"),
    ]),
    ("menu", "physaiMenu", "피지컬 AI", "Physical AI", [
        ("physical-ai.html", "피지컬 AI 소개", "About Physical AI", "개념 · 관련 기술 · MuJoCo", "Concepts · key technologies · MuJoCo"),
        ("hr",),
        ("physical-ai.html#lab", "자율주행", "Self-driving", "150대가 진화하며 트랙 주행을 배움", "150 cars evolve to drive a track"),
        ("neat-snake.html", "스네이크", "Snake", "150마리가 진화하며 Snake 게임을 배움", "150 snakes evolve to play Snake"),
        ("neat-drone.html", "드론", "Drone", "150대가 진화하며 균형 잡고 경유점 비행을 배움", "150 drones evolve to balance and fly through waypoints"),
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
        ("particle-life.html", "입자 생명", "Particle Life", "끌림 · 밀침 표 하나에서 생기는 무리 · 창발", "Groups emerging from one attraction table"),
    ]),
    ("menu", "studioMenu", "온톨로지 설계실", "Design Studio", [
        ("h", "설계실", "Studio"),
        ("studio.html", "설계실 소개", "About the studio", "정답 없는 설계를 기록하는 곳", "Where design decisions are recorded"),
        ("ontology-map.html", "온톨로지 지도", "Ontology map", "사이트의 온톨로지가 서로 어떻게 이어지나", "How the site's ontologies connect"),
        ("hr",), ("h", "업무", "Work"),
        ("work.html", "업무 온톨로지", "Work ontology", "가상의 AI추진부 업무 149개", "149 tasks of a fictional department"),
        ("hr",), ("h", "교통", "Traffic"),
        ("highway.html", "고속도로·국도 교통", "Road traffic", "가상 고속도로·국도망 · 24시간 차량 흐름", "Virtual expressways &amp; national roads · 24 h traffic"),
        ("ev.html", "전기차 충전", "EV charging", "고속도로 × 전력망 · 휴게소 → 변전소", "Roads × grid · rest area → substation"),
        ("col",), ("h", "전력", "Power"),
        ("asset.html", "전력설비 자산관리", "Power asset management", "가상 A변전소 설비 · 진단 · 위험도", "Virtual substation: assets, diagnoses, risk"),
        ("impact.html", "설비 고장 영향 분석", "Failure impact analysis", "자산 위험도 × 배전선로 · 고객 · 복구", "Asset risk × feeder · customers · restoration"),
        ("safety-ontology.html", "배전공사 안전", "Distribution work safety", "현장 단계 · 수칙 · 위험요인 → 업무 · 자산", "Field steps, rules, hazards → work, assets"),
        ("hr",), ("h", "자연", "Nature"),
        ("eco-ontology.html", "단세포 생태계", "Cell ecosystem", "시뮬레이션 기록 → 혈통 · 포식 · 진화 그래프", "Simulation record → lineage, predation, evolution graph"),
    ]),
    ("menu", "aiMenu", "AI × 온톨로지", "AI × Ontology", [
        ("ai.html", "AI × 온톨로지 시연", "AI × ontology demo", "LLM만 · 문서 검색 · GraphRAG 비교", "LLM alone vs. RAG vs. GraphRAG"),
        ("hr",),
        ("ai.html#graphrag", "GraphRAG 시연", "GraphRAG demo", "자연어 질문 → Cypher → 그래프에서 답", "Question → Cypher → answer from the graph"),
        ("ai.html#agent", "AI 에이전트 시연", "AI agent demo", "고장 영향을 단계별로 추론하는 에이전트", "An agent tracing a failure step by step"),
    ]),
    ("bidding.html", "내가 이해한 전력시장", "The power market, as I understand it"),
]


# 첫 화면이 그려지기 전에 끝나야 하는 것만 <head> 안에 직접 넣는다 (언어 · 테마 · window.t). 나머지는 assets/site.js 가 defer 로.
# 주소의 ?lang=en · ?lang=ko 가 가장 먼저, 다음이 지난번 선택, 다음이 브라우저 언어.
BOOT = ("<script>(function(){var r=document.documentElement,l=null,s=null;"
        "try{var v=new URLSearchParams(location.search).get('lang');if(v==='ko'||v==='en')l=v}catch(e){}"
        "try{l=l||localStorage.getItem('lang');s=localStorage.getItem('theme')}catch(e){}"
        "r.lang=l==='ko'||l==='en'?l:((navigator.language||'ko').indexOf('ko')===0?'ko':'en');"
        "if(s==='dark'||s==='light')r.dataset.theme=s;r.classList.add('js');"
        "window.currentLang=function(){return r.lang};"
        "window.t=function(o){var x=o[r.lang];return x==null?o.ko:x}})();</script>")

SITE = "https://1004aiteam-power.github.io/ontology-space/"
# 공유 미리보기 이미지: 시뮬레이션 썸네일(tools/thumbs.cjs)이 있는 페이지는 그것, 나머지는 소개 페이지 화면
OG_IMAGE = {f"{n}.html": f"assets/thumbs/{n}.jpg" for n in ("safety", "intersection", "airport", "flights", "ecosystem", "particle-life")}
OG_IMAGE.update({"neat-drone.html": "assets/thumbs/drone.jpg", "neat-snake.html": "assets/thumbs/neat-snake.jpg", "twin.html": "assets/thumbs/twin.jpg"})
OG_DEFAULT = "assets/og/site.jpg"
NOINDEX = {"404.html"}   # 검색 대상이 아닌 페이지: canonical · sitemap 에서 빼고 noindex 를 붙임


def has_en(s: str) -> bool:
    """영어 본문이 있는 페이지인가 (한국어만 있는 페이지에는 영어 주소를 알리지 않음)."""
    return '<meta name="title-en"' in s


def head_meta(page: str, s: str) -> str:
    title = re.search(r'<meta name="title-ko" content="([^"]*)"', s) or re.search(r"<title>([^<]*)</title>", s)
    desc = re.search(r'<meta name="description" content="([^"]*)"', s)
    t, d = title.group(1).strip(), desc.group(1) if desc else ""
    url = SITE + ("" if page == "index.html" else page)
    img = SITE + OG_IMAGE.get(page, OG_DEFAULT)
    q = lambda v: html.escape(html.unescape(v), quote=True)  # noqa: E731
    if page in NOINDEX:
        seo = ['<meta name="robots" content="noindex">']
    else:
        seo = [f'<link rel="canonical" href="{url}">']
        if has_en(s):
            seo += [
                f'<link rel="alternate" hreflang="ko" href="{url}">',
                f'<link rel="alternate" hreflang="en" href="{url}?lang=en">',
                f'<link rel="alternate" hreflang="x-default" href="{url}">',
            ]
    return "\n".join([
        "<!-- head:meta (tools/build_nav.py) -->",
        '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
        '<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">',
        *seo,
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Ontology Space">',
        f'<meta property="og:title" content="{q(t)}">',
        f'<meta property="og:description" content="{q(d)}">',
        f'<meta property="og:url" content="{url}">',
        f'<meta property="og:image" content="{img}">',
        '<meta property="og:locale" content="ko_KR">',
        *(['<meta property="og:locale:alternate" content="en_US">'] if has_en(s) else []),
        '<meta name="twitter:card" content="summary_large_image">',
        BOOT,
        "<!-- /head:meta -->",
    ])


def add_head_meta(page: str, s: str) -> str:
    s = re.sub(r"<!-- head:meta .*?<!-- /head:meta -->\n", "", s, flags=re.S)
    m = re.search(r'<meta name="description"[^>]*>\n', s) or re.search(r"</title>\n", s)
    return s[:m.end()] + head_meta(page, s) + "\n" + s[m.end():] if m else s


def label(ko: str, en: str) -> str:
    return f'<span lang="ko">{ko}</span><span lang="en">{en}</span>'


# 여러 메뉴에 들어 있는 페이지는 이 메뉴의 버튼만 강조 (링크 표시는 양쪽 다). 메뉴에 없는 페이지는 여기 적은 메뉴의 버튼을 강조.
PRIMARY: dict[str, str] = {"work-graph.html": "studioMenu"}


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
        cols = any(e[0] == "col" for e in entries)
        out.append(f'    <div class="menu{" cols" if cols else ""}" id="{mid}" hidden>')
        if cols:
            out.append('      <div class="menu-col">')
        for e in entries:
            if e[0] == "col":
                out.append('      </div><div class="menu-col">')
            elif e[0] == "hr":
                out.append("      <hr>")
            elif e[0] == "h":
                out.append(f'      <p class="menu-h">{label(e[1], e[2])}</p>')
            else:
                href, ko2, en2, dko, den = e
                out.append(f'      <a href="{href}"{cur(href)}>{label(ko2, en2)}<small lang="ko">{dko}</small><small lang="en">{den}</small></a>')
        if cols:
            out.append("      </div>")
        out.append("    </div>")
    out.append("  </nav>")
    return "\n".join(out)


# ---- ?v= (캐시 갱신) --------------------------------------------------------------------------------------
V = r"(?:\?v=[0-9A-Za-z]+)?"
JS_IMPORT = re.compile(r"""(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}/[^'"?]+\.js)""" + V + r"\2")        # import … from './x.js'
JS_FETCH = re.compile(r"""(\bfetch\(\s*)(['"])(assets/[^'"?]+)\?v=[0-9A-Za-z]+\2""")              # fetch('assets/…?v=…') 만 (이미 붙은 것)
HTML_REF = re.compile(r"""(<(?:script|link)\b[^>]*?\b(?:src|href)=")(assets/[^"?]+\.(?:js|css))""" + V + '"')
_ver: dict[str, str] = {}


def _deps(rel: str, text: str) -> list[str]:
    """이 파일이 가리키는 사이트 안의 파일들 (사이트 뿌리 기준 경로)."""
    if not rel.endswith(".js") or rel.startswith("assets/vendor/"):
        return []
    here = posixpath.dirname(rel)
    out = [posixpath.normpath(posixpath.join(here, m.group(3))) for m in JS_IMPORT.finditer(text)]
    return out + [m.group(3) for m in JS_FETCH.finditer(text)]


def version(rel: str, _stack: tuple[str, ...] = ()) -> str:
    """파일 내용 + 불러오는 파일들의 버전으로 만든 8자리 해시 (?v= 자체는 빼고 계산)."""
    if rel in _ver:
        return _ver[rel]
    p = ROOT / rel
    data = p.read_bytes()
    h = hashlib.sha1()
    if rel.endswith((".js", ".css")) and not rel.startswith("assets/vendor/"):
        text = data.decode("utf-8")
        h.update(re.sub(r"\?v=[0-9A-Za-z]+", "", text).encode("utf-8"))
        for d in sorted(set(_deps(rel, text))):
            if d not in _stack and (ROOT / d).is_file():      # 서로 불러오는 경우(순환)는 내용만으로
                h.update(version(d, _stack + (rel,)).encode())
    else:
        h.update(data)
    _ver[rel] = h.hexdigest()[:8]
    return _ver[rel]


def stamp_js(rel: str, text: str) -> str:
    here = posixpath.dirname(rel)

    def imp(m: re.Match) -> str:
        target = posixpath.normpath(posixpath.join(here, m.group(3)))
        if not (ROOT / target).is_file():
            return m.group(0)
        return f"{m.group(1)}{m.group(2)}{m.group(3)}?v={version(target)}{m.group(2)}"

    def fetch(m: re.Match) -> str:
        if not (ROOT / m.group(3)).is_file():
            return m.group(0)
        return f"{m.group(1)}{m.group(2)}{m.group(3)}?v={version(m.group(3))}{m.group(2)}"

    return JS_FETCH.sub(fetch, JS_IMPORT.sub(imp, text))


def stamp_html(text: str) -> str:
    # 화면 그리기를 막지 않게: 공통 스크립트와 코드 색칠 라이브러리는 defer (실행 순서는 문서에 적힌 순서 그대로)
    text = re.sub(r'(<script src="assets/(?:site|vendor/highlight\.min)\.js[^"]*")></script>', r"\1 defer></script>", text)

    def ref(m: re.Match) -> str:
        return f'{m.group(1)}{m.group(2)}?v={version(m.group(2))}"' if (ROOT / m.group(2)).is_file() else m.group(0)
    return HTML_REF.sub(ref, text)


# ---- 머리말 · 꼬리말: 모든 페이지가 같은 것을 쓴다. 바꿀 때는 여기만 고치고 실행 ---------------------------------
HEADER = ('<header class="top"><div class="wrap">\n'
          '  <a class="brand" href="index.html">Ontology Space</a>\n'
          '{nav}\n'
          '  <div class="tools"><button id="langBtn">EN</button><button id="themeBtn" aria-label="theme">◐</button></div>\n'
          '</div></header>')
FOOTER = '<footer><div class="wrap">Ontology Space · <a href="https://github.com/1004aiteam-power/ontology-space">GitHub</a> · © 2026 1004aiteam-power · <span lang="ko">문서</span><span lang="en">Docs</span> <a rel="license" href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a> · <span lang="ko">코드</span><span lang="en">Code</span> <a href="https://github.com/1004aiteam-power/ontology-space/blob/main/LICENSE-CODE">AGPL-3.0</a> · <a href="https://github.com/1004aiteam-power/ontology-space/blob/main/README.md#출처-표시-방법"><span lang="ko">가져가실 때는 출처를 꼭 밝혀 주세요</span><span lang="en">Please credit the source when you reuse it</span></a></div></footer>'


def add_frame(page: str, s: str) -> str:
    """페이지의 <header class="top">…</header> 와 <footer>…</footer> 를 위 틀로 다시 쓴다 (메뉴 포함)."""
    s = re.sub(r'<header class="top">.*?</header>', lambda m: HEADER.format(nav=build(page)), s, count=1, flags=re.S)
    return re.sub(r"<footer>.*?</footer>", lambda m: FOOTER, s, count=1, flags=re.S)


SKIP = '<a class="skip" href="#main"><span lang="ko">본문 바로가기</span><span lang="en">Skip to content</span></a>'


def add_skip_link(s: str) -> str:
    """키보드·화면낭독기 사용자가 긴 메뉴를 건너뛸 수 있게: <body> 바로 뒤에 본문 바로가기 링크, <main>에 id="main"."""
    s = re.sub(r'<a class="skip" href="#main">.*?</a>\n', "", s, flags=re.S)
    s = re.sub(r"<body([^>]*)>\n", lambda m: f"<body{m.group(1)}>\n{SKIP}\n", s, count=1)
    return re.sub(r"<main(?![^>]*\bid=)", '<main id="main"', s, count=1)


def write_if_changed(path: Path, text: str) -> int:
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return 0
    path.write_text(text, encoding="utf-8")
    return 1


def sitemap(pages: list[str]) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for p in ["index.html"] + [p for p in pages if p != "index.html"]:
        url = SITE + ("" if p == "index.html" else p)
        alt = [f'    <xhtml:link rel="alternate" hreflang="ko" href="{url}"/>',
               f'    <xhtml:link rel="alternate" hreflang="en" href="{url}?lang=en"/>'] if has_en((ROOT / p).read_text(encoding="utf-8")) else []
        out += ["  <url>", f"    <loc>{url}</loc>", *alt, "  </url>"]
    return "\n".join(out + ["</urlset>"]) + "\n"


def main() -> None:
    n = 0
    pages = [f.name for f in sorted(ROOT.glob("*.html")) if f.name not in NOINDEX]
    n += write_if_changed(ROOT / "sitemap.xml", sitemap(pages))
    n += write_if_changed(ROOT / "robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {SITE}sitemap.xml\n")
    for f in sorted((ROOT / "assets").rglob("*.js")):
        rel = f.relative_to(ROOT).as_posix()
        if not rel.startswith("assets/vendor/"):
            s = f.read_text(encoding="utf-8")
            n += write_if_changed(f, stamp_js(rel, s))
    for f in sorted(ROOT.glob("*.html")):
        s = f.read_text(encoding="utf-8")
        new = stamp_html(add_skip_link(add_head_meta(f.name, add_frame(f.name, s))))
        if new != s:
            f.write_text(new, encoding="utf-8")
            n += 1
    print(f"메뉴·head 태그·sitemap·?v= 를 다시 만든 파일: {n}개")


if __name__ == "__main__":
    main()
