#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 모든 페이지를 실제 브라우저로 열어 보는 화면 점검 (Playwright 필요: npm i -g playwright 또는 이미 설치된 환경)
//
//   node tools/check_pages.cjs                      모든 페이지: 스크립트 오류 · 가로 밀림 · 불러오지 못한 파일
//   node tools/check_pages.cjs --save DIR           위 점검 + 요소별 스타일 기록을 DIR 에 저장 (고치기 전에)
//   node tools/check_pages.cjs --compare DIR        위 점검 + DIR 의 기록과 비교 (고친 뒤에). 달라진 요소를 페이지별로 출력
//   node tools/check_pages.cjs --only aas.html,ev.html   일부 페이지만
//
// 스타일 · 스크립트를 정리(리팩터링)할 때 "화면이 그대로인가"를 확인하는 용도.
// 시뮬레이션 화면은 실행할 때마다 내용이 달라서 그림을 비교하지 않고, 요소마다 계산된 스타일(색 · 글자 · 여백 · 배치)을 비교한다.
// 밝은 화면 1200px · 어두운 화면 1200px · 밝은 화면 390px 세 가지로 연다. 문제가 있으면 종료 코드 1
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', ttl: 'text/turtle; charset=utf-8', csv: 'text/csv', txt: 'text/plain; charset=utf-8', py: 'text/plain; charset=utf-8', cypher: 'text/plain; charset=utf-8', geojson: 'application/json' };
const VIEWS = [['light-1200', 1200, 'light'], ['dark-1200', 1200, 'dark'], ['light-390', 390, 'light']];
const PROPS = ['display', 'position', 'float', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign',
  'textTransform', 'textDecorationLine', 'whiteSpace', 'wordBreak', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderTopColor', 'borderLeftColor', 'borderBottomColor', 'borderTopLeftRadius',
  'boxShadow', 'opacity', 'overflowX', 'overflowY', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'columnGap', 'rowGap', 'maxWidth', 'minWidth', 'maxHeight',
  'zIndex', 'cursor', 'fill', 'stroke', 'strokeWidth', 'strokeDasharray', 'listStyleType', 'verticalAlign', 'fontVariantNumeric', 'textOverflow', 'visibility'];

function serve() {
  const server = http.createServer((req, res) => {
    // 404.html 은 어느 깊이에서 열려도 되게 /ontology-space/ 로 시작하는 주소를 쓰므로 그 앞부분은 떼고 찾는다
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/ontology-space(?=\/)/, '').replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).slice(1)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

// 페이지 안에서 실행: 요소마다 "경로 → 스타일" (경로 = 태그와 형제 중 순서. 클래스 이름은 넣지 않아, 클래스를 바꿔도 모양이 같으면 같다고 본다)
function fingerprint(props) {
  const out = {};
  const walk = (el, p) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;                                   // 숨긴 것(반대 언어 등)은 건너뜀
    out[p] = props.map(k => cs[k]).join('|');
    const count = {};
    for (const c of el.children) {
      const t = c.tagName.toLowerCase();
      if (t === 'script' || t === 'style') continue;
      count[t] = (count[t] || 0) + 1;
      walk(c, `${p}>${t}${count[t]}`);
    }
  };
  walk(document.body, 'body');
  return out;
}

(async () => {
  const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
  const save = opt('--save'), compare = opt('--compare'), only = opt('--only');
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && (!only || only.split(',').includes(f))).sort();
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  if (save) fs.mkdirSync(save, { recursive: true });
  let bad = 0;
  for (const page of pages) {
    const notes = [];
    for (const [view, width, scheme] of VIEWS) {
      const p = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
      const errs = [];
      p.on('pageerror', e => errs.push('script error: ' + e.message));
      p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
      p.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) errs.push(`${r.status()} ${r.url().slice(base.length)}`); });
      // 시뮬레이션이 매번 같은 난수를 쓰게 해서, 기록과 비교할 때 우연한 차이를 줄인다
      await p.addInitScript(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
      await p.goto(base + page + '?lang=ko', { waitUntil: 'load' });
      await p.waitForTimeout(1200);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (over > 1) errs.push(`page is ${over}px wider than the screen`);
      for (const e of new Set(errs)) notes.push(`[${view}] ${e}`);
      if (save || compare) {
        const fp = await p.evaluate(fingerprint, PROPS), file = (dir) => path.join(dir, `${page}.${view}.json`);
        if (save) fs.writeFileSync(file(save), JSON.stringify(fp));
        if (compare && fs.existsSync(file(compare))) {
          const old = JSON.parse(fs.readFileSync(file(compare), 'utf8')), diffs = [];
          for (const k of Object.keys(old)) if (k in fp && old[k] !== fp[k]) {
            const a = old[k].split('|'), b = fp[k].split('|');
            diffs.push(`${k}: ` + PROPS.map((n, i) => (a[i] !== b[i] ? `${n} ${a[i]} → ${b[i]}` : '')).filter(Boolean).join(', '));
          }
          const gone = Object.keys(old).filter(k => !(k in fp)).length, added = Object.keys(fp).filter(k => !(k in old)).length;
          if (diffs.length) notes.push(`[${view}] ${diffs.length} elements look different, e.g.\n      ` + diffs.slice(0, 4).join('\n      ').slice(0, 900));
          if (gone + added > Math.max(6, Object.keys(old).length * 0.02)) notes.push(`[${view}] structure changed: ${gone} elements gone, ${added} new (of ${Object.keys(old).length})`);
        }
      }
      await p.close();
    }
    console.log(`${notes.length ? '✗' : '✓'} ${page}`);
    for (const n of notes) console.log('    ' + n);
    bad += notes.length ? 1 : 0;
  }
  await browser.close(); server.close();
  console.log(bad ? `\n${bad} of ${pages.length} pages need a look` : `\nall ${pages.length} pages fine`);
  process.exit(bad ? 1 : 0);
})();
