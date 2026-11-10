// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// NEAT Snake 페이지: 150마리가 동시에 진화하며 Snake를 배우는 과정을 브라우저에서 실행·시각화
import { Population } from './neat.js?v=a16de3e3';   // ?v= 는 tools/build_nav.py 가 파일 내용으로 만듦
import { Trainer, Snake, GRID, SNAKE, stepSnake, sense, INPUT_LABELS, INPUT_LABELS_EN } from './snake-sim.js?v=da9d5017';

const $ = (id) => document.getElementById(id);
const t = (o) => (window.t ? window.t(o) : o.ko);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// 차트·신경망 색: 자율주행 페이지와 같은 팔레트
const SERIES = () => dark() ? ['#3987e5', '#d95926'] : ['#2a78d6', '#eb6834'];
const SPECIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const speciesColor = (id) => SPECIES_COLORS[((id % 8) + 8) % 8];
const FOOD = '#e5484d';

let trainer, running = false, mode = 'train';   // 'train' | 'replay'
let speedIdx = 1, acc = 0, lastT = 0;
let followed = null;        // 개체군 보드에서 클릭한 개체 (없으면 선두)
let replay = null;          // 다시 보기 중인 Snake
let hoverGen = null;
// 초당 걸음 수. 'max' = 프레임마다 14ms 동안 최대한
const SPEEDS = [{ sps: 12, label: '1×' }, { sps: 48, label: '4×' }, { sps: 200, label: '16×' }, { sps: 'max', label: 'max' }];

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

// ---- 게임판 그리기 ------------------------------------------------------------------
function drawBoard(ctx, s, x0, y0, size, opt = {}) {
  const c = size / GRID.w;
  if (!opt.transparent) { ctx.fillStyle = dark() ? '#161a1f' : '#f4f6f3'; ctx.fillRect(x0, y0, size, size); }
  if (opt.grid) {
    ctx.strokeStyle = dark() ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 5; i < GRID.w; i += 5) { ctx.moveTo(x0 + i * c, y0); ctx.lineTo(x0 + i * c, y0 + size); ctx.moveTo(x0, y0 + i * c); ctx.lineTo(x0 + size, y0 + i * c); }
    ctx.stroke();
  }
  if (!s) return;
  if (s.food) {
    ctx.fillStyle = FOOD;
    ctx.beginPath(); ctx.arc(x0 + (s.food.x + 0.5) * c, y0 + (s.food.y + 0.5) * c, Math.max(c * 0.45, opt.eyes ? 5 : 0), 0, 7); ctx.fill();
  }
  const color = opt.color || '#199e70';
  const pad = Math.max(0.5, c * 0.08);
  s.body.forEach((p, i) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = s.alive ? (i === 0 ? 1 : 0.85 - 0.45 * i / s.body.length) : 0.35;
    ctx.fillRect(x0 + p.x * c + pad, y0 + p.y * c + pad, c - 2 * pad, c - 2 * pad);
  });
  ctx.globalAlpha = 1;
  if (opt.eyes && s.body.length) {                    // 머리에 눈 (진행 방향 표시)
    const h = s.head, cx = x0 + (h.x + 0.5) * c, cy = y0 + (h.y + 0.5) * c;
    const f = [[0, -1], [1, 0], [0, 1], [-1, 0]][s.dir], side = [-f[1], f[0]];
    ctx.fillStyle = '#fff';
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + f[0] * c * 0.18 + side[0] * k * c * 0.2, cy + f[1] * c * 0.18 + side[1] * k * c * 0.2, c * 0.1, 0, 7); ctx.fill(); }
  }
}

// 센서가 보는 것: 위험 칸(✕)과 먹이 방향 화살표
function drawSensors(ctx, s, x0, y0, size) {
  if (!s.alive) return;
  const c = size / GRID.w, inp = sense(s), h = s.head;
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  [s.dir, (s.dir + 3) % 4, (s.dir + 1) % 4].forEach((d, i) => {
    const x = h.x + D[d][0], y = h.y + D[d][1];
    const px = x0 + (x + 0.5) * c, py = y0 + (y + 0.5) * c, r = c * 0.28;
    ctx.lineWidth = 2;
    if (inp[i]) {
      ctx.strokeStyle = '#f97316';
      ctx.beginPath(); ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r); ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(250,204,21,.7)'; ctx.setLineDash([2, 3]);
      ctx.strokeRect(x0 + x * c + 2, y0 + y * c + 2, c - 4, c - 4); ctx.setLineDash([]);
    }
  });
}

// 큰 판: 게임 중인 모든 뱀을 한 판에 겹쳐 그림 (각자 자기 게임을 하므로 서로 부딪히지 않음)
// 먹이는 그 뱀의 종 색 점, 큰 화면 대표(선두 또는 클릭한 뱀)는 맨 위에 진하게 + 빨간 먹이·눈·센서
const SHOW_N = 1;           // 큰 판에 그리는 뱀 수 (학습은 개체군 전체로)
const POP_SIZE = 150;
// 큰 판에 보여줄 뱀: 대표 + 나머지는 점수 순 상위
function shownAgents() {
  const focus = current();
  const score = a => a.scores.reduce((x, y) => x + y, 0) + a.game.score + a.game.steps * 1e-6;
  const rest = trainer.agents.filter(a => a.game && a !== focus).sort((a, b) => score(b) - score(a));
  return (focus ? [focus] : []).concat(rest).slice(0, SHOW_N);
}
function drawMain() {
  const { ctx, cw } = fit($('board'), 1);
  const focus = mode === 'replay' ? replay : current()?.game;
  drawBoard(ctx, null, 0, 0, cw, { grid: true });
  if (mode === 'train') {
    const c = cw / GRID.w, sp = trainer.speciesOf;
    for (const a of shownAgents()) {
      const g = a.game;
      if (!g || g === focus) continue;
      const color = speciesColor(sp.get(a.genome) ?? 0);
      if (g.food) { ctx.fillStyle = color; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc((g.food.x + 0.5) * c, (g.food.y + 0.5) * c, c * 0.4, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      for (const p of g.body) ctx.fillRect(p.x * c + 1, p.y * c + 1, c - 2, c - 2);
      ctx.globalAlpha = 0.9;                            // 머리는 조금 진하게
      ctx.fillRect(g.head.x * c + 1, g.head.y * c + 1, c - 2, c - 2);
    }
    ctx.globalAlpha = 1;
  }
  if (focus) {
    const color = mode === 'replay' ? '#199e70' : speciesColor(trainer.speciesOf.get(current()?.genome) ?? 0);
    const c = cw / GRID.w;
    ctx.fillStyle = 'rgba(250,204,21,.35)';            // 대표 뱀 강조 (노란 후광)
    for (const p of focus.body) ctx.fillRect(p.x * c - 2, p.y * c - 2, c + 4, c + 4);
    drawBoard(ctx, focus, 0, 0, cw, { eyes: true, color, transparent: true });
    drawSensors(ctx, focus, 0, 0, cw);
  }
  drawHud(ctx, cw, focus);
}

function drawHud(ctx, cw, s) {
  const narrow = cw < 420;
  let text;
  if (mode === 'replay') {
    const b = trainer.bestGame;
    text = t({ ko: `최고 기록 다시 보기 · 세대 ${b.gen} · 먹이 ${s.score}/${b.score}`, en: `Replaying the record · gen ${b.gen} · food ${s.score}/${b.score}` });
  } else {
    const a = current();
    if (!a) text = t({ ko: `세대 ${trainer.pop.generation + 1} 종료`, en: `Generation ${trainer.pop.generation + 1} done` });
    else {
      const who = (followed ? t({ ko: '노란 뱀 = 선택한 개체', en: 'yellow = selected' }) : t({ ko: '노란 뱀 = 선두', en: 'yellow = leader' })) + t({ ko: ` · ${trainer.alive}마리 게임 중`, en: ` · ${trainer.alive} playing` });
      text = narrow
        ? t({ ko: `세대 ${trainer.pop.generation + 1} · 먹이 ${s.score} · 판 ${a.trial + 1}/${trainer.opts.trials}`, en: `Gen ${trainer.pop.generation + 1} · food ${s.score} · game ${a.trial + 1}/${trainer.opts.trials}` })
        : t({ ko: `세대 ${trainer.pop.generation + 1} · ${who} · 판 ${a.trial + 1}/${trainer.opts.trials} · 먹이 ${s.score} · 배고픔 ${s.hunger}/${SNAKE.starve}`,
              en: `Gen ${trainer.pop.generation + 1} · ${who} · game ${a.trial + 1}/${trainer.opts.trials} · food ${s.score} · hunger ${s.hunger}/${SNAKE.starve}` });
    }
  }
  ctx.font = `600 ${narrow ? 11 : 13}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = dark() ? 'rgba(18,20,23,.82)' : 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.roundRect(8, 8, w, 26, 13); ctx.fill();
  ctx.fillStyle = css('--text'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, 18, 21);
}

// 화면에 보여줄 개체: 클릭한 개체가 아직 게임 중이면 그 개체, 아니면 선두
function current() {
  if (followed && followed.game && trainer.agents.includes(followed)) return followed;
  followed = null;
  return trainer.leader();
}

// ---- 개체군 보드: 작은 판 하나 = 뱀 한 마리 ----------------------------------------------
let miniLayout = null;
function drawPopulation() {
  const canvas = $('popBoard');
  const agents = trainer.agents, sp = trainer.speciesOf;
  const w = canvas.clientWidth, cols = Math.max(8, Math.floor(w / 72)), cell = w / cols;
  const rows = Math.ceil(agents.length / cols);
  canvas.style.height = rows * cell + 'px';
  const { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  // 종별로 묶어 정렬 → 같은 색 테두리가 모여 보인다 (정렬은 세대가 바뀔 때만 → 판이 제자리에 있음)
  if (!miniLayout || miniLayout.gen !== trainer.pop.generation || miniLayout.cols !== cols) {
    const order = [...agents].sort((a, b) => (sp.get(a.genome) - sp.get(b.genome)));
    miniLayout = { gen: trainer.pop.generation, cols, order };
  }
  const lead = mode === 'train' ? current() : null;
  miniLayout.order.forEach((a, i) => {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell, m = 3, size = cell - 2 * m;
    const color = speciesColor(sp.get(a.genome) ?? 0);
    ctx.globalAlpha = a.game ? 1 : 0.35;
    drawBoard(ctx, a.game, x + m, y + m, size, { color });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = a === lead ? '#facc15' : color; ctx.lineWidth = a === lead ? 3 : 1.5;
    ctx.strokeRect(x + m, y + m, size, size);
    if (!a.game) {                                      // 끝난 개체: 평균 먹이 수
      ctx.fillStyle = css('--text'); ctx.font = `600 ${Math.max(9, cell * 0.24)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((a.scores.reduce((p, q) => p + q, 0) / a.scores.length).toFixed(1), x + cell / 2, y + cell / 2);
    }
  });
  miniLayout.cell = cell;
  const counts = new Map();
  for (const a of agents) { const s = sp.get(a.genome); counts.set(s, (counts.get(s) || 0) + 1); }
  $('speciesLegend').innerHTML = [...counts].sort((a, b) => b[1] - a[1]).map(([s, k]) =>
    `<span><i style="background:${speciesColor(s)}"></i>${t({ ko: '종', en: 'Species' })} ${s} · ${k}${t({ ko: '마리', en: '' })}</span>`).join('');
}

// ---- 신경망 그리기 ----------------------------------------------------------------
const OUT_LABELS = { ko: ['직진', '좌회전', '우회전'], en: ['Straight', 'Left', 'Right'] };
function drawNetGraph(ctx, genome, net, box, mini = false, chosen = -1) {
  const cfg = genome.cfg, nIn = cfg.nInputs;
  const depth = new Map(), on = [...genome.conns.values()].filter(c => c.on);
  for (const id of genome.nodes.keys()) depth.set(id, id < nIn ? 0 : 1);
  for (let it = 0; it < genome.nodes.size; it++) for (const c of on) if (depth.get(c.b) < depth.get(c.a) + 1 && genome.nodes.get(c.b).type !== 'out') depth.set(c.b, depth.get(c.a) + 1);
  const maxD = Math.max(1, ...[...genome.nodes.values()].filter(n => n.type === 'hid').map(n => depth.get(n.id))) + 1;
  for (const n of genome.nodes.values()) if (n.type === 'out') depth.set(n.id, maxD);
  const cols = new Map();
  for (const n of genome.nodes.values()) { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n.id); }
  const padL = mini ? 10 : 104, padR = mini ? 36 : 104, padV = mini ? 8 : 16, pos = new Map();
  const OUT_ORDER = [1, 0, 2];                         // 화면 위에서부터 좌회전 · 직진 · 우회전
  cols.get(maxD).sort((a, b) => OUT_ORDER.indexOf(a - nIn) - OUT_ORDER.indexOf(b - nIn));
  for (const [d, ids] of cols) ids.forEach((id, i) => pos.set(id, {
    x: box.x + padL + (box.w - padL - padR) * d / maxD,
    y: box.y + padV + (box.h - 2 * padV) * (ids.length === 1 ? 0.5 : i / (ids.length - 1))
  }));
  const [pos1, neg1] = SERIES(), k = mini ? 0.5 : 1;
  for (const c of genome.conns.values()) {
    const a = pos.get(c.a), b = pos.get(c.b);
    if (!a || !b || (mini && !c.on)) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    if (!c.on) { ctx.setLineDash([3, 4]); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; }
    else {
      ctx.setLineDash([]); ctx.strokeStyle = c.w > 0 ? pos1 : neg1;
      const sig = Math.abs((net?.values.get(c.a) ?? 0.5) * c.w);       // 지금 흐르는 신호가 셀수록 진하게
      ctx.globalAlpha = 0.15 + Math.min(0.85, sig / 2);
      ctx.lineWidth = Math.min(4, 0.6 + Math.abs(c.w)) * k;
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  const lang = window.currentLang?.() || 'ko', IN = lang === 'en' ? INPUT_LABELS_EN : INPUT_LABELS;
  ctx.font = mini ? '600 10px system-ui, sans-serif' : '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const n of genome.nodes.values()) {
    const p = pos.get(n.id), v = net?.values.get(n.id) ?? 0;
    const r = (n.type === 'hid' ? 6 : 8) * (mini ? 0.55 : 1);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fillStyle = css('--surface'); ctx.fill();
    ctx.globalAlpha = Math.min(1, Math.abs(v)); ctx.fillStyle = v >= 0 ? pos1 : neg1; ctx.fill(); ctx.globalAlpha = 1;
    const pick = n.type === 'out' && n.id - nIn === chosen;
    ctx.strokeStyle = pick ? '#facc15' : css('--muted'); ctx.lineWidth = pick ? 3 : (mini ? 0.8 : 1.2); ctx.stroke();
    ctx.fillStyle = css('--text');
    if (n.type === 'in' && !mini) { ctx.textAlign = 'right'; ctx.fillText(IN[n.id], p.x - 12, p.y); }
    if (n.type === 'out') {
      ctx.textAlign = 'left';
      const name = OUT_LABELS[lang === 'en' ? 'en' : 'ko'][n.id - nIn];
      ctx.font = (pick ? '700 ' : '') + (mini ? '10px' : '12px') + ' system-ui, sans-serif';
      ctx.fillText(mini ? name : `${name} ${v.toFixed(2)}${pick ? ' ◀' : ''}`, p.x + (mini ? 6 : 12), p.y);
      ctx.font = mini ? '600 10px system-ui, sans-serif' : '12px system-ui, sans-serif';
    }
  }
}

function drawNet() {
  const canvas = $('net'), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  const s = mode === 'replay' ? replay : current()?.game;
  if (!s?.genome) return;
  drawNetGraph(ctx, s.genome, s.genome.network(), { x: 0, y: 0, w: cw, h: ch }, false, s.lastAction);
  $('netInfo').textContent = t({ ko: `은닉 노드 ${s.genome.hidden}개 · 활성 연결 ${s.genome.enabledConns}개 — 파랑 = 양(+) 가중치, 주황 = 음(−) 가중치, 점선 = 꺼진 연결, 노란 테두리 = 이번 걸음에 고른 행동`,
                                 en: `${s.genome.hidden} hidden nodes · ${s.genome.enabledConns} active links — blue = positive weight, orange = negative, dashed = disabled, yellow ring = the action just chosen` });
}

// ---- 학습 곡선: 세대별 한 판 최고 먹이 수 / 평균 먹이 수 ---------------------------------
function niceStep(max) { const r = max / 5, p = 10 ** Math.floor(Math.log10(r)); return [1, 2, 5, 10].map(m => m * p).find(s => s >= r); }
function drawChart() {
  const canvas = $('chart'), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  const h = trainer.pop.history;
  const pad = { l: 40, r: 54, t: 12, b: 26 };
  const W = cw - pad.l - pad.r, H = ch - pad.t - pad.b;
  const ymax = Math.max(10, ...h.map(r => r.bestScore)) * 1.08, xmax = Math.max(5, h.length - 1);
  const X = i => pad.l + W * i / xmax, Y = v => pad.t + H * (1 - v / ymax);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
  const st = niceStep(ymax);
  for (let v = 0; v <= ymax; v += st) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + W, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(v, pad.l - 6, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const stepX = Math.max(1, Math.ceil(xmax / 8));
  for (let i = 0; i <= xmax; i += stepX) ctx.fillText(i + 1, X(i), pad.t + H + 6);
  if (!h.length) {
    ctx.fillText(t({ ko: '첫 세대가 끝나면 그려집니다', en: 'Appears after the first generation' }), pad.l + W / 2, pad.t + H / 2);
    return;
  }
  const cols = SERIES(), keys = ['bestScore', 'meanScore'];
  keys.forEach((k, si) => {
    ctx.strokeStyle = cols[si]; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    h.forEach((r, i) => (i ? ctx.lineTo(X(i), Y(r[k])) : ctx.moveTo(X(i), Y(r[k]))));
    ctx.stroke();
    const last = h.at(-1);
    ctx.fillStyle = cols[si]; ctx.beginPath(); ctx.arc(X(h.length - 1), Y(last[k]), 4, 0, 7); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t(si ? { ko: '평균', en: 'Mean' } : { ko: '최고', en: 'Best' }), X(h.length - 1) + 8, Y(last[k]) + (si ? 7 : -7));
  });
  const tip = $('chartTip');
  if (hoverGen != null && h[hoverGen]) {
    const r = h[hoverGen], x = X(hoverGen);
    ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke(); ctx.setLineDash([]);
    keys.forEach((k, si) => { ctx.fillStyle = cols[si]; ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, Y(r[k]), 5, 0, 7); ctx.fill(); ctx.stroke(); });
    tip.hidden = false;
    tip.innerHTML = `<b>${t({ ko: '세대', en: 'Gen' })} ${r.gen + 1}</b><br><i style="background:${cols[0]}"></i>${t({ ko: '최고', en: 'Best' })} ${r.bestScore}<br><i style="background:${cols[1]}"></i>${t({ ko: '평균', en: 'Mean' })} ${r.meanScore.toFixed(1)}<br>${t({ ko: '종', en: 'Species' })} ${r.species} · ${t({ ko: '은닉', en: 'Hidden' })} ${r.nodes}`;
    tip.style.left = Math.min(cw - 150, x + 10) + 'px'; tip.style.top = pad.t + 'px';
  } else tip.hidden = true;
}

function updateTable() {
  const h = trainer.pop.history;
  $('histTable').innerHTML = `<tr><th>${t({ ko: '세대', en: 'Gen' })}</th><th>${t({ ko: '최고 먹이', en: 'Best food' })}</th><th>${t({ ko: '평균 먹이', en: 'Mean food' })}</th><th>${t({ ko: '최고 적합도', en: 'Best fitness' })}</th><th>${t({ ko: '종', en: 'Species' })}</th><th>${t({ ko: '은닉', en: 'Hidden' })}</th></tr>` +
    h.slice(-30).reverse().map(r => `<tr><td>${r.gen + 1}</td><td>${r.bestScore}</td><td>${r.meanScore.toFixed(1)}</td><td>${r.best.toFixed(0)}</td><td>${r.species}</td><td>${r.nodes}</td></tr>`).join('');
}

function stats() {
  const T = trainer, a = current();
  const cells = [
    [t({ ko: '세대', en: 'Generation' }), T.pop.generation + 1],
    [t({ ko: '게임 중', en: 'Playing' }), `${T.alive} / ${T.agents.length}`],
    [t({ ko: '최고 기록 (먹이)', en: 'Record (food)' }), T.bestScore],
    [t({ ko: '지난 세대 평균 먹이', en: 'Mean food last gen' }), T.lastGen ? T.lastGen.meanScore.toFixed(1) : '–'],
    [t({ ko: '종(species)', en: 'Species' }), T.pop.species.length],
    [t({ ko: '선두 신경망', en: 'Leader network' }), a ? t({ ko: `은닉 ${a.genome.hidden} · 연결 ${a.genome.enabledConns}`, en: `${a.genome.hidden} hidden · ${a.genome.enabledConns} links` }) : '–']
  ];
  $('stats').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

// ---- 루프 ------------------------------------------------------------------------
function advance(n) {
  for (let i = 0; i < n; i++) {
    if (mode === 'replay') { if (!replay.alive) break; stepSnake(replay); continue; }
    if (trainer.tick() === 'round') onRoundEnd();
  }
}
function frame(now) {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
  const active = mode === 'replay' ? replay.alive : running;
  if (active) {
    const sp = SPEEDS[speedIdx].sps;
    if (sp === 'max') { const t0 = performance.now(); while (performance.now() - t0 < 14) advance(20); }
    else { acc += dt * sp; const n = Math.floor(acc); acc -= n; advance(n); }
  }
  if (mode === 'replay' && !replay.alive) $('replayEnd').hidden = false;
  drawMain(); drawNet(); stats(); drawPopulation();
  requestAnimationFrame(frame);
}
function onRoundEnd() { miniLayout = null; drawChart(); updateTable(); $('replayBtn').disabled = !trainer.bestGame; }

// ---- 조작부 ----------------------------------------------------------------------
function restart() {
  trainer = new Trainer(Population, { popSize: POP_SIZE, trials: +($('trials')?.value || 3), seed: (Math.random() * 1e9) | 0 });
  followed = null; replay = null; mode = 'train'; miniLayout = null;
  $('replayEnd').hidden = true; $('replayBtn').disabled = true;
  drawChart(); updateTable(); label();
}
function skipGeneration() {                          // 지금 세대를 화면 없이 끝까지
  if (mode !== 'train') return;
  const g = trainer.pop.generation;
  while (trainer.pop.generation === g) trainer.tick();
  onRoundEnd();
}
function startReplay() {
  if (!trainer.bestGame) return;
  replay = trainer.replay(); mode = 'replay'; $('replayEnd').hidden = true; label();
}
function endReplay() { mode = 'train'; replay = null; $('replayEnd').hidden = true; label(); }

function label() {
  $('playBtn').innerHTML = mode === 'replay' ? t({ ko: '↩ 학습으로 돌아가기', en: '↩ Back to training' })
    : running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 학습 시작', en: '▶ Train' });
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Playback ' }) + (SPEEDS[speedIdx].sps === 'max' ? t({ ko: '최대', en: 'max' }) : SPEEDS[speedIdx].label);
  $('trials')?.querySelectorAll('option').forEach(o => o.textContent = t({ ko: `개체당 ${o.value}판`, en: `${o.value} game${o.value > 1 ? 's' : ''} each` }));
}

function bind() {
  $('playBtn')?.addEventListener('click', () => { if (mode === 'replay') endReplay(); else running = !running; label(); });
  $('speedBtn')?.addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; label(); });
  $('skipBtn')?.addEventListener('click', skipGeneration);
  $('replayBtn')?.addEventListener('click', startReplay);
  $('replayAgainBtn')?.addEventListener('click', startReplay);
  $('replayBackBtn')?.addEventListener('click', endReplay);
  $('resetBtn')?.addEventListener('click', restart);
  $('trials')?.addEventListener('change', restart);
  $('saveBtn')?.addEventListener('click', () => {
    const g = trainer.bestGame?.genome || trainer.pop.best; if (!g) return;
    const blob = new Blob([JSON.stringify({ format: 'neat-genome/1', inputs: INPUT_LABELS_EN, outputs: OUT_LABELS.en, generation: trainer.pop.generation, genome: g.toJSON() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'snake-best-genome.json'; a.click(); URL.revokeObjectURL(a.href);
  });
  $('popBoard')?.addEventListener('click', e => {      // 작은 판을 누르면 그 개체를 크게 보기
    if (!miniLayout?.cell || mode !== 'train') return;
    const r = $('popBoard').getBoundingClientRect(), c = miniLayout.cell;
    const i = Math.floor((e.clientY - r.top) / c) * miniLayout.cols + Math.floor((e.clientX - r.left) / c);
    const a = miniLayout.order[i];
    if (a?.game) followed = a;
  });
  const chart = $('chart');
  chart.addEventListener('mousemove', e => {
    const h = trainer.pop.history; if (!h.length) return;
    const r = chart.getBoundingClientRect(), W = r.width - 40 - 54, xmax = Math.max(5, h.length - 1);
    const i = Math.round((e.clientX - r.left - 40) / W * xmax);
    hoverGen = i >= 0 && i < h.length ? i : null; drawChart();
  });
  chart.addEventListener('mouseleave', () => { hoverGen = null; drawChart(); });
  document.addEventListener('langchange', () => { label(); drawChart(); updateTable(); });
  window.addEventListener('resize', () => drawChart());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawChart());
  $('themeBtn')?.addEventListener('click', () => setTimeout(drawChart, 0));
}

function main() { bind(); restart(); requestAnimationFrame(frame); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
