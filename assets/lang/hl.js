// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 코드 블록 색칠 (assets/vendor/highlight.min.js, 페이지가 먼저 불러 둠). 다크/라이트 색은 site.css 의 .hljs-* 를 쓴다
export function highlight(root = document) {
  if (!window.hljs) return;
  root.querySelectorAll('pre code[class*="language-"]').forEach(el => { if (!el.dataset.highlighted) window.hljs.highlightElement(el); });
}
