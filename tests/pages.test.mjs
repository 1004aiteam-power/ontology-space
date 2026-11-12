// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 페이지 구조 테스트 (브라우저 없이) — 실행: node tests/pages.test.mjs
// 파일을 옮기거나 이름을 바꿨을 때 끊어진 연결을 잡는다. 화면까지 열어 보는 점검은 tools/check_pages.cjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const pages = readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const clean = (u) => u.split('#')[0].split('?')[0];
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap(f => (statSync(join(ROOT, dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

// 1) 페이지가 가리키는 사이트 안의 파일(스타일 · 스크립트 · 그림 · 다른 페이지)이 모두 있다
const linkedCss = new Set(), linkedJs = new Set();
for (const p of pages) {
  const s = read(p);
  for (const m of s.matchAll(/\b(?:href|src)="([^"#][^"]*)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|data:|\/\/|\/)/.test(u)) continue;             // 바깥 주소, 404.html 의 /ontology-space/…
    const f = clean(u);
    if (!f) continue;
    assert.ok(existsSync(join(ROOT, f)), `${p}: ${u} does not exist`);
    if (f.endsWith('.css')) linkedCss.add(normalize(f));
    if (f.endsWith('.js')) linkedJs.add(normalize(f));
  }
}
console.log(`✓ every local link in ${pages.length} pages points at an existing file`);

// 2) 스크립트의 import 가 있는 파일을 가리키고, 어느 페이지에서도 닿지 않는 스크립트 · 스타일이 없다
const reach = new Set();
const follow = (f) => {
  if (reach.has(f)) return;
  reach.add(f);
  const code = read(f).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');          // 주석 속 사용 예는 빼고
  for (const m of code.matchAll(/\b(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const t = normalize(join(dirname(f), clean(m[1])));
    assert.ok(existsSync(join(ROOT, t)), `${f}: import ${m[1]} does not exist`);
    follow(t);
  }
};
for (const f of linkedJs) if (!f.includes('vendor')) follow(f);
const TOOLS_ONLY = new Set(['assets/cypher/cq.js']);          // 페이지가 아니라 빌드 스크립트 · 테스트가 쓰는 것 (역량 질문 원문)
for (const f of walk('assets').filter(f => f.endsWith('.js') && !TOOLS_ONLY.has(f))) {
  assert.ok(reach.has(f) || linkedJs.has(f), `${f}: no page loads this script (delete it or link it)`);
}
for (const f of walk('assets').filter(f => f.endsWith('.css'))) assert.ok(linkedCss.has(f), `${f}: no page links this stylesheet`);
console.log(`✓ ${reach.size} scripts and ${linkedCss.size} stylesheets are all reachable from a page, and every import resolves`);

// 3) 모든 페이지가 같은 틀을 갖는다: 머리말 · 메뉴 · 본문 · 꼬리말, 스타일은 파일로 (페이지 안 <style> · 긴 <script> 없음)
const footer = read('index.html').match(/<footer>[\s\S]*?<\/footer>/)[0];
for (const p of pages) {
  const s = read(p);
  for (const need of ['<header class="top">', '<a class="brand" href="index.html">', '<nav>', '<main id="main"', 'id="langBtn"', 'id="themeBtn"']) assert.ok(s.includes(need), `${p}: missing ${need}`);
  assert.equal(s.match(/<footer>[\s\S]*?<\/footer>/)?.[0], footer, `${p}: footer differs (run python tools/build_nav.py)`);
  assert.ok(!/<style[\s>]/.test(s), `${p}: has a <style> block — put it in assets/css/`);
  for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.ok(m[1].split('\n').length <= 3, `${p}: has an inline script — put it in assets/`);
  assert.equal((s.match(/<h1[\s>]/g) || []).length, 1, `${p}: needs exactly one <h1>`);
}
console.log('✓ every page has the shared header, menu, main and footer, one <h1>, and no inline styles or scripts');
