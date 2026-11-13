// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 소개 페이지 '시뮬레이션' 썸네일 만들기 (Playwright). 로컬 서버를 띄운 뒤 실행:
//   python3 -m http.server 8765 &  node tools/thumbs.cjs            (전부)
//   node tools/thumbs.cjs drone                                     (이름을 적으면 그것만)
const { chromium } = require('playwright');
const path = require('path');

const PAGES = [
  ['safety', 'safety.html', 'sfView', async p => { await p.evaluate(() => { const a = document.createElement('a'); a.dataset.goto = 'pole:11'; document.body.appendChild(a); a.click(); }); }, 7000],
  ['intersection', 'intersection.html', 'view', async p => p.click('#playBtn'), 6000],
  ['airport', 'airport.html', 'apView', async p => { await p.selectOption('#camSel', 'terminal'); await p.click('#playBtn'); }, 6000],
  ['flights', 'flights.html', 'flMap', async p => p.click('#playBtn'), 4000],
  ['ecosystem', 'ecosystem.html', 'dish', async p => p.click('#playBtn'), 6000],
  ['tunneling', 'tunneling.html', 'tnView', async p => { await p.click('#playBtn'); }, 3200],
  ['star-formation', 'star-formation.html', 'nbView', async p => { await p.click('#playBtn'); await p.click('#speedBtn'); await p.click('#speedBtn'); }, 14000],
  ['particle-life', 'particle-life.html', 'plView', async p => { await p.click('#playBtn'); await p.click('#speedBtn'); await p.click('#speedBtn'); }, 9000],
  // 드론: 30세대를 화면 없이 넘긴 뒤(잘 나는 세대) 실제 속도로 몇 초 날린 장면
  ['drone', 'neat-drone.html', 'sky', async p => { await p.click('#playBtn'); for (let i = 0; i < 30; i++) await p.click('#skipBtn'); }, 7000],
  ['neat-drive', 'physical-ai.html', 'sim', async p => p.click('#playBtn'), 7000],
  ['neat-snake', 'neat-snake.html', 'board', async p => { await p.click('#playBtn'); for (let i = 0; i < 10; i++) await p.click('#skipBtn'); }, 5000],
  // 온톨로지 · 전력망 페이지 안의 재생형 시뮬레이션
  ['twin', 'twin.html', 'map', async p => p.click('#playBtn'), 5000],
  ['flisr', 'grid.html', 'flMap', async p => { await p.click('[data-fl-seg="BR2_1"]'); await p.click('#flPlay'); }, 3000],
  ['highway', 'highway.html', 'hwMap', async p => p.click('#hwPlay'), 5000],
  ['ev', 'ev.html', 'evMap', async p => p.click('#evPlay'), 5000],
  ['impact', 'impact.html', 'imGraph', async p => p.click('#imPlay'), 4000],
  ['merit', 'bidding.html', 'moChart', async p => p.check('#moSolar'), 800]
].filter(([name]) => process.argv.length < 3 || process.argv.slice(2).includes(name));

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
