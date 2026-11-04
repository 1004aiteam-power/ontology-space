// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 단세포 생태계 페이지: 배양 접시 · 개체수 그래프 · 형질 진화
import { Ecosystem, WORLD } from './ecosim.js?v=20261104a';

const $ = (id) => document.getElementById(id);
const t = (o) => (window.t ? window.t(o) : o.ko);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// 계열 색 (dataviz 검증: 밝은·어두운 배경 모두 색각 이상 구분 통과, 먹이는 밝은 배경 대비가 낮아 직접 라벨 + 표 제공)
const COL = { food: '#c98500', herb: '#199e70', carn: '#d95926' };
const NAME = {
  food: { ko: '먹이', en: 'Food' }, herb: { ko: '초식 세포', en: 'Herbivores' }, carn: { ko: '육식 세포', en: 'Carnivores' }
};

const SCENARIOS = {
  refuge: { label: { ko: '피난처 있음 (기본 · 공존)', en: 'With refuges (default · coexist)' }, opts: {} },
  none: { label: { ko: '피난처 없음 (가우스 실험 1)', en: 'No refuges (Gause experiment 1)' }, opts: { refuge: { on: false } } },
  immig: { label: { ko: '피난처 없음 + 이주 (가우스 실험 2)', en: 'No refuges + immigration (Gause 2)' }, opts: { refuge: { on: false }, immigration: { herb: 0.01, carn: 0.002 } } }
};
const SPEEDS = [1, 4, 16, 'max'];

let eco, running = false, speedIdx = 0, addMode = 'herb';
let effects = [];           // { x, y, kind, type, life }
const hover = {};           // 차트별 마우스 위치

// ---- 캔버스 공통 -------------------------------------------------------------------
function fit(canvas, aspect) {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth;
  const ch = aspect ? cw * aspect : canvas.clientHeight;
  if (aspect) canvas.style.height = ch + 'px';
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cw, ch };
}

// ---- 배양 접시 ---------------------------------------------------------------------
function drawDish() {
  const { ctx, cw } = fit($('dish'), WORLD.h / WORLD.w);
  const k = cw / WORLD.w;
  ctx.save(); ctx.scale(k, k);
  ctx.fillStyle = dark() ? '#10171a' : '#eef4f1'; ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  // 피난처 (침전물): 갈색 원 + 알갱이
  if (eco.cfg.refuge.on) for (const z of eco.cfg.refuge.zones) {
    ctx.fillStyle = dark() ? 'rgba(150,110,60,.28)' : 'rgba(150,110,60,.2)';
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.fill();
    ctx.strokeStyle = dark() ? 'rgba(190,150,90,.6)' : 'rgba(130,95,50,.55)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5;
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = dark() ? 'rgba(200,160,100,.35)' : 'rgba(120,85,40,.3)';
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996, r = z.r * Math.sqrt((i + 0.5) / 26);
      ctx.beginPath(); ctx.arc(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, 1.6, 0, 7); ctx.fill();
    }
  }
  // 먹이
  ctx.fillStyle = COL.food;
  for (const f of eco.food) ctx.fillRect(f.x - 1.3, f.y - 1.3, 2.6, 2.6);
  // 세포
  for (const c of eco.cells) {
    if (c.kind === 'herb') {
      ctx.fillStyle = COL.herb; ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(c.x - 1, c.y - 1, 1.3, 0, 7); ctx.fill();   // 핵
    } else if (c.cyst) {
      ctx.strokeStyle = dark() ? '#9aa3ab' : '#7b838b'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = COL.carn; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    } else {
      // 입이 진행 방향으로 벌어진 원
      ctx.fillStyle = COL.carn; ctx.beginPath();
      ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, 6.5, c.a + 0.45, c.a - 0.45 + Math.PI * 2); ctx.closePath(); ctx.fill();
      if (c.full > 0) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(c.x - Math.cos(c.a) * 2, c.y - Math.sin(c.a) * 2, 2.2, 0, 7); ctx.fill(); }   // 소화 중
    }
  }
  // 효과: 분열 = 퍼지는 고리, 포식 = 붉은 번쩍임
  for (const e of effects) {
    const p = 1 - e.life / 18;
    ctx.globalAlpha = Math.max(0, 1 - p);
    if (e.type === 'split') { ctx.globalAlpha *= 0.6; ctx.strokeStyle = COL[e.kind]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(e.x, e.y, 5 + p * 12, 0, 7); ctx.stroke(); }
    else if (e.type === 'eat') { ctx.fillStyle = COL.carn; ctx.beginPath(); ctx.arc(e.x, e.y, 3 + p * 9, 0, 7); ctx.fill(); }
    else if (e.type === 'arrive') { ctx.strokeStyle = css('--text'); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(e.x, e.y, 14 - p * 9, 0, 7); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // 왼쪽 위 안내
  const c = eco.counts(), narrow = cw < 520;
  const text = narrow
    ? t({ ko: `${eco.t.toLocaleString()}틱 · 초식 ${c.herb} · 육식 ${c.carn}`, en: `t ${eco.t.toLocaleString()} · herb ${c.herb} · carn ${c.carn}` })
    : t({ ko: `${eco.t.toLocaleString()}틱 · 먹이 ${c.food} · 초식 ${c.herb} · 육식 ${c.carn} (포낭 ${c.cyst})`, en: `t ${eco.t.toLocaleString()} · food ${c.food} · herbivores ${c.herb} · carnivores ${c.carn} (cysts ${c.cyst})` });
  ctx.font = `600 ${narrow ? 11 : 13}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = dark() ? 'rgba(18,20,23,.82)' : 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.roundRect(8, 8, w, 26, 13); ctx.fill();
  ctx.fillStyle = css('--text'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, 18, 21);
}

// ---- 선 그래프 (개체수 · 형질): 십자선 + 툴팁, 선 끝 직접 라벨 -------------------------------
function niceStep(max) { const r = max / 4, p = 10 ** Math.floor(Math.log10(r)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= r); }
function lineChart(id, rows, series, fmt = (v) => Math.round(v)) {
  const canvas = $(id), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  const pad = { l: 42, r: 92, t: 10, b: 24 }, W = cw - pad.l - pad.r, H = ch - pad.t - pad.b;
  const vals = rows.flatMap(r => series.map(s => r[s.key])).filter(Number.isFinite);
  const ymax = Math.max(1e-6, ...vals) * 1.1;
  const t0 = rows[0]?.t ?? 0, t1 = Math.max(t0 + 1, rows.at(-1)?.t ?? 1);
  const X = (v) => pad.l + W * (v - t0) / (t1 - t0), Y = (v) => pad.t + H * (1 - v / ymax);
  ctx.font = '11px system-ui, sans-serif'; ctx.strokeStyle = css('--line'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
  const st = niceStep(ymax);
  for (let v = 0; v <= ymax; v += st) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + W, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmt(v), pad.l - 6, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const xs = niceStep(t1 - t0);
  for (let v = Math.ceil(t0 / xs) * xs; v <= t1; v += xs) ctx.fillText(v.toLocaleString(), X(v), pad.t + H + 6);
  if (rows.length < 2) return;
  const ends = [];
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    let started = false;
    for (const r of rows) {
      const v = r[s.key];
      if (!Number.isFinite(v)) { started = false; continue; }
      started ? ctx.lineTo(X(r.t), Y(v)) : ctx.moveTo(X(r.t), Y(v)); started = true;
    }
    ctx.stroke();
    const last = [...rows].reverse().find(r => Number.isFinite(r[s.key]));
    if (last) ends.push({ s, y: Y(last[s.key]), x: X(last.t), v: last[s.key] });
  }
  // 직접 라벨: 겹치지 않게 아래로 밀기
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].ly = (ends[i - 1].ly ?? ends[i - 1].y) + 14;
  for (const e of ends) {
    ctx.fillStyle = e.s.color; ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, 7); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${t(e.s.label)} ${fmt(e.v)}`, e.x + 8, e.ly ?? e.y);
  }
  // 십자선 + 툴팁
  const tip = $(id + 'Tip'), hx = hover[id];
  if (hx == null || hx < pad.l || hx > pad.l + W) { tip.hidden = true; return; }
  const tt = t0 + (hx - pad.l) / W * (t1 - t0);
  let r = rows[0]; for (const q of rows) if (Math.abs(q.t - tt) < Math.abs(r.t - tt)) r = q;
  const x = X(r.t);
  ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke(); ctx.setLineDash([]);
  for (const s of series) if (Number.isFinite(r[s.key])) {
    ctx.fillStyle = s.color; ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, Y(r[s.key]), 5, 0, 7); ctx.fill(); ctx.stroke();
  }
  tip.hidden = false;
  tip.innerHTML = `<b>${r.t.toLocaleString()}${t({ ko: '틱', en: ' ticks' })}</b>` +
    series.map(s => `<br><i style="background:${s.color}"></i>${t(s.label)} ${Number.isFinite(r[s.key]) ? fmt(r[s.key]) : '–'}`).join('');
  tip.style.left = canvas.offsetLeft + Math.min(cw - 160, x + 10) + 'px'; tip.style.top = canvas.offsetTop + pad.t + 'px';
}

const POP_SERIES = [
  { key: 'herb', color: COL.herb, label: NAME.herb },
  { key: 'carn', color: COL.carn, label: NAME.carn }
];
const window_ = () => eco.history.slice(-1500);      // 최근 15,000틱
function drawCharts() {
  const rows = window_();
  lineChart('popChart', rows, POP_SERIES);
  lineChart('foodChart', rows, [{ key: 'food', color: COL.food, label: NAME.food }]);
  lineChart('speedChart', rows, [{ key: 'hSpeed', color: COL.herb, label: NAME.herb }, { key: 'cSpeed', color: COL.carn, label: NAME.carn }], v => v.toFixed(2));
  lineChart('senseChart', rows, [{ key: 'hSense', color: COL.herb, label: NAME.herb }, { key: 'cSense', color: COL.carn, label: NAME.carn }]);
  lineChart('liveChart', eco.history.slice(-300), POP_SERIES);   // 실시간: 최근 3,000틱
}

function updateTable() {
  const rows = eco.history.filter(r => r.t % 500 === 0).slice(-30).reverse();
  $('histTable').innerHTML = `<tr><th>${t({ ko: '틱', en: 'Tick' })}</th><th>${t(NAME.food)}</th><th>${t(NAME.herb)}</th><th>${t(NAME.carn)}</th><th>${t({ ko: '초식 속도', en: 'Herb speed' })}</th><th>${t({ ko: '육식 속도', en: 'Carn speed' })}</th></tr>` +
    rows.map(r => `<tr><td>${r.t.toLocaleString()}</td><td>${r.food}</td><td>${r.herb}</td><td>${r.carn}</td><td>${Number.isFinite(r.hSpeed) ? r.hSpeed.toFixed(2) : '–'}</td><td>${Number.isFinite(r.cSpeed) ? r.cSpeed.toFixed(2) : '–'}</td></tr>`).join('');
}

function stats() {
  const c = eco.counts(), h = eco.traits('herb'), k = eco.traits('carn');
  const safe = eco.cells.filter(x => x.safe).length;
  const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '–'), f0 = v => (Number.isFinite(v) ? Math.round(v) : '–');
  const ext = (n) => (n === 0 ? t({ ko: ' · 멸종', en: ' · extinct' }) : '');
  const cells = [
    [t(NAME.food), c.food, COL.food],
    [t(NAME.herb), `${c.herb}${ext(c.herb)}`, COL.herb, eco.cfg.refuge.on ? t({ ko: `피난처 안 ${safe}`, en: `${safe} in refuges` }) : ''],
    [t(NAME.carn), `${c.carn}${ext(c.carn)}`, COL.carn, t({ ko: `포낭 ${c.cyst}`, en: `${c.cyst} cysts` })],
    [t({ ko: '초식 평균 속도 · 감지', en: 'Herb speed · sense' }), `${f2(h.speed)} · ${f0(h.sense)}`, null, t({ ko: `최대 ${h.maxGen}세대`, en: `gen ${h.maxGen}` })],
    [t({ ko: '육식 평균 속도 · 감지', en: 'Carn speed · sense' }), `${f2(k.speed)} · ${f0(k.sense)}`, null, t({ ko: `최대 ${k.maxGen}세대`, en: `gen ${k.maxGen}` })],
    [t({ ko: '경과 시간', en: 'Elapsed' }), `${eco.t.toLocaleString()}${t({ ko: '틱', en: '' })}`, null]
  ];
  $('ecoStats').innerHTML = cells.map(([name, v, col, sub]) =>
    `<div><span>${col ? `<i style="background:${col}"></i>` : ''}${name}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`).join('');
}

// ---- 루프 ------------------------------------------------------------------------
let lastChart = 0, lastTable = 0;
function frame(now) {
  if (running) {
    const sp = SPEEDS[speedIdx];
    if (sp === 'max') { const t0 = performance.now(); while (performance.now() - t0 < 14) tick(); }
    else for (let i = 0; i < sp; i++) tick();
  }
  for (const e of effects) e.life--;
  effects = effects.filter(e => e.life > 0);
  drawDish();
  if (now - lastChart > 120) { drawCharts(); stats(); lastChart = now; }
  if (now - lastTable > 1500) { updateTable(); lastTable = now; }
  requestAnimationFrame(frame);
}
function tick() {
  eco.step();
  if (SPEEDS[speedIdx] === 'max' || effects.length > 300) return;     // 빠를 때는 효과 생략
  for (const e of eco.events) if (e.type === 'split' || e.type === 'eat' || e.type === 'arrive') effects.push({ ...e, life: 18 });
}

// ---- 조작부 ----------------------------------------------------------------------
function restart() {
  const sc = SCENARIOS[$('scenario').value] || SCENARIOS.refuge;
  eco = new Ecosystem({ ...sc.opts, seed: (Math.random() * 1e9) | 0, food: { regrow: +$('regrow').value }, mutation: +$('mutation').value });
  effects = []; drawCharts(); updateTable(); stats();
}
function label() {
  $('playBtn').innerHTML = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 시작', en: '▶ Start' });
  const sp = SPEEDS[speedIdx];
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Speed ' }) + (sp === 'max' ? t({ ko: '최대', en: 'max' }) : sp + '×');
  const sel = $('scenario'), v = sel.value || 'refuge';
  sel.innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${t(s.label)}</option>`).join('');
  sel.value = v;
  $('regrowOut').textContent = (+$('regrow').value).toFixed(1);
  $('mutationOut').textContent = Math.round(+$('mutation').value * 100) + '%';
  document.querySelectorAll('[data-add]').forEach(b => b.setAttribute('aria-pressed', b.dataset.add === addMode ? 'true' : 'false'));
}
function bind() {
  $('playBtn').addEventListener('click', () => { running = !running; label(); });
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; label(); });
  $('resetBtn').addEventListener('click', restart);
  $('scenario').addEventListener('change', restart);
  $('regrow').addEventListener('input', () => { eco.cfg.food.regrow = +$('regrow').value; label(); });
  $('mutation').addEventListener('input', () => { eco.cfg.mutation = +$('mutation').value; label(); });
  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { addMode = b.dataset.add; label(); }));
  // 접시를 누르면 그 자리에 넣기
  $('dish').addEventListener('click', e => {
    const r = $('dish').getBoundingClientRect(), k = WORLD.w / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    if (addMode === 'food') for (let i = 0; i < 25; i++) eco.addFood((x + (Math.random() - 0.5) * 50 + WORLD.w) % WORLD.w, (y + (Math.random() - 0.5) * 50 + WORLD.h) % WORLD.h);
    else for (let i = 0; i < 3; i++) eco.spawn(addMode, (x + (Math.random() - 0.5) * 16 + WORLD.w) % WORLD.w, (y + (Math.random() - 0.5) * 16 + WORLD.h) % WORLD.h);
    effects.push({ type: 'arrive', x, y, kind: addMode, life: 18 });
  });
  for (const id of ['liveChart', 'popChart', 'foodChart', 'speedChart', 'senseChart']) {
    $(id).addEventListener('mousemove', e => { hover[id] = e.clientX - $(id).getBoundingClientRect().left; drawCharts(); });
    $(id).addEventListener('mouseleave', () => { hover[id] = null; drawCharts(); });
  }
  document.addEventListener('langchange', () => { label(); drawCharts(); updateTable(); stats(); });
  window.addEventListener('resize', drawCharts);
}

function main() { bind(); label(); restart(); requestAnimationFrame(frame); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
