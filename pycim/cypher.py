# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
"""파이썬에서 Cypher 실행 — tools/cypher.mjs(브라우저 실습과 같은 엔진)를 Node로 부른다.

Neo4j 서버 없이 빌드 스크립트·테스트에서 역량 질문과 형상검증 규칙을 Cypher로 돌리기 위한 얇은 래퍼.
Neo4j에서 같은 결과를 보려면 같은 .cypher 파일을 Neo4j Browser나 cypher-shell에서 실행하면 된다.

    from pycim.cypher import run
    out = run(ttl=["examples/power-grid-sample.ttl", "shapes/cim-classes.ttl"], checks="shapes/cim-checks.cypher")
    out["checks"]  # [{id, severity, ko, en, columns, rows}, …]
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(ttl: list[str] | None = None, load: list[str] | str | None = None, queries: str | None = None,
        checks: str | None = None, query: list[str] | str | None = None) -> dict:
    """ttl → load(쓰기 스크립트) → queries → query → checks 순서로 실행해 JSON 결과를 돌려준다."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js가 필요합니다 (Cypher 엔진 tools/cypher.mjs 실행)")
    as_list = lambda x: [] if x is None else [x] if isinstance(x, str) else list(x)  # noqa: E731
    args = [node, str(ROOT / "tools" / "cypher.mjs"), "--json"]
    if ttl:
        args += ["--ttl", ",".join(str(t) for t in ttl)]
    for f in as_list(load):
        args += ["--load", str(f)]
    if queries:
        args += ["--queries", str(queries)]
    for q in as_list(query):
        args += ["--query", q]
    if checks:
        args += ["--checks", str(checks)]
    p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if p.returncode not in (0, 1):              # 1 = 위반 있음 (정상 실행)
        raise RuntimeError(p.stderr.strip() or f"tools/cypher.mjs 실패 ({p.returncode})")
    return json.loads(p.stdout)
