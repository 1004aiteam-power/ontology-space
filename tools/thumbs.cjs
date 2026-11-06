// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 소개 페이지 '시뮬레이션' 썸네일 만들기 (Playwright). 로컬 서버를 띄운 뒤 실행:
//   python3 -m http.server 8765 &  node tools/thumbs.cjs
const { chromium } = require('playwright');
const path = require('path');

const PAGES = [
  ['safety', 'safety.html', 'sfView', async p => { await p.evaluate(() => { const a = document.createElement('a'); a.dataset.goto = 'pole:11'; document.body.appendChild(a); a.click(); }); }, 7000],
  ['intersection', 'intersection.html', 'view', async p => p.click('#playBtn'), 6000],
  ['airport', 'airport.html', 'apView', async p => { await p.selectOption('#camSel', 'terminal'); await p.click('#playBtn'); }, 6000],
  ['flights', 'flights.html', 'flMap', async p => p.click('#playBtn'), 4000],
  ['ecosystem', 'ecosystem.html', 'dish', async p => p.click('#playBtn'), 6000]
];

(async () => {
  const b = await chromium.launch();
  for (const [name, url, id, start, wait] of PAGES) {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR' });
    await p.goto('http://localhost:8765/' + url); await p.waitForTimeout(1500);
    await start(p); await p.waitForTimeout(wait);
    await p.evaluate(i => document.getElementById(i).scrollIntoView({ block: 'center' }), id);
    await p.waitForTimeout(400);
    const el = await p.$('#' + id), box = await el.boundingBox();
    const h = Math.min(box.height, box.width * 0.625);               // 16:10으로 자름 (가운데)
    await p.screenshot({ path: path.join(__dirname, '..', 'assets', 'thumbs', name + '.jpg'), type: 'jpeg', quality: 72,
      clip: { x: box.x, y: box.y + (box.height - h) / 2, width: box.width, height: h } });
    await p.close();
    console.log('✓', name);
  }
  await b.close();
})();
