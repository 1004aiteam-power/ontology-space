// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Physical AI 페이지: NEAT 자율주행 학습을 브라우저에서 실행·시각화
import { Population, Genome } from './neat.js?v=a16de3e3';
import { Trainer, Car, makeTrack, stepCar, maxStepsFor, testRun, RADAR, WORLD, CAR_SPEED } from './sim.js?v=e978db4e';   // ?v= 는 tools/build_nav.py 가 파일 내용으로 만듦

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// 차트 색상: dataviz 기준 팔레트 (라이트/다크 각각 색각 이상 검증 통과)
const SERIES = () => dark() ? ['#3987e5', '#d95926'] : ['#2a78d6', '#eb6834'];

let trainer, running = false, speed = 1, mode = 'train', test = null;
// 라운드 진행: 라운드 = NEAT의 한 세대. 2바퀴 완주한 차가 나오면 성공으로 멈춘다
let banner = null;          // { title, sub, until, kind: 'fail' | 'start' }
let roundLog = [];          // { round, progress, finished, ok }
let replayCar = null;
const SPEEDS = [1, 4, 16, 'max'];
// 종별 색: dataviz 8색 팔레트(어두운 도로용). 도로 대비가 낮은 색이 있어 흰 테두리 + 범례(이름·대수)를 함께 쓴다
const SPECIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const speciesColor = (id) => SPECIES_COLORS[((id % 8) + 8) % 8];

// ---- 캔버스 공통 -------------------------------------------------------------------
function fit(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth;
  const ch = h ? cw * h / w : canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    if (h && !document.fullscreenElement) canvas.style.height = ch + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cw, ch };
}

// ---- 시뮬레이션 그리기 ------------------------------------------------------------
function drawWorld(tr, cars, leader) {
  const { ctx, cw } = fit($('sim'), WORLD.w, WORLD.h);
  const k = cw / WORLD.w;
  ctx.save(); ctx.scale(k, k);
  ctx.fillStyle = dark() ? '#1d2a1f' : '#e7efe2'; ctx.fillRect(0, 0, WORLD.w, WORLD.h);   // 잔디
  const path = new Path2D();
  tr.center.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
  path.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = dark() ? '#e7e8ea' : '#ffffff'; ctx.lineWidth = tr.hw * 2 + 6; ctx.stroke(path);  // 연석
  ctx.strokeStyle = dark() ? '#3a3f47' : '#3b3f45'; ctx.lineWidth = tr.hw * 2; ctx.stroke(path);      // 도로
  ctx.setLineDash([10, 12]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.stroke(path); ctx.setLineDash([]);
  // 출발선
  const s = tr.start, nx = -Math.sin(s.a), ny = Math.cos(s.a);
  ctx.strokeStyle = '#f5f5f5'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(s.x + nx * tr.hw, s.y + ny * tr.hw); ctx.lineTo(s.x - nx * tr.hw, s.y - ny * tr.hw); ctx.stroke();

  const sp = trainer && (mode === 'train' || mode === 'success') ? trainer.speciesOf : null;
  const col = c => (sp ? speciesColor(sp.get(c.genome) ?? 0) : '#f97316');
  // 1) 실패한 차: 멈춘 자리에 ✕ (이번 세대의 시행착오)
  ctx.lineWidth = 2;
  for (const c of cars) if (!c.alive && !c.finished) {
    ctx.strokeStyle = col(c); ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(c.x - 4, c.y - 4); ctx.lineTo(c.x + 4, c.y + 4); ctx.moveTo(c.x + 4, c.y - 4); ctx.lineTo(c.x - 4, c.y + 4); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 2) 상위 차량 몇 대의 센서 (흐리게)
  const alive = cars.filter(c => c.alive && !c.finished).sort((a, b) => b.progress - a.progress);
  ctx.lineWidth = 0.8;
  for (const c of alive.slice(1, 6)) {
    ctx.strokeStyle = col(c); ctx.globalAlpha = 0.35;
    RADAR.angles.forEach((deg, i) => {
      const a = c.a + deg * Math.PI / 180, d = c.radar[i];
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d); ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
  // 3) 살아 있는 차 / 완주한 차: 종별 색 + 흰 테두리
  for (const c of cars) if ((c.alive || c.finished) && c !== leader) drawCar(ctx, c, col(c), true, c.finished);
  if (leader) {
    ctx.strokeStyle = 'rgba(250,204,21,.85)'; ctx.lineWidth = 1;
    RADAR.angles.forEach((deg, i) => {
      const a = leader.a + deg * Math.PI / 180, d = leader.radar[i];
      ctx.beginPath(); ctx.moveTo(leader.x, leader.y); ctx.lineTo(leader.x + Math.cos(a) * d, leader.y + Math.sin(a) * d); ctx.stroke();
      ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(leader.x + Math.cos(a) * d, leader.y + Math.sin(a) * d, 3, 0, 7); ctx.fill();
    });
    drawCar(ctx, leader, col(leader), true, leader.finished, true);
  }
  const ranks = rankCars(cars, leader);
  ranks.forEach((c, i) => {                                        // 1~5등 번호 (오른쪽 신경망과 짝)
    ctx.fillStyle = i ? 'rgba(17,24,39,.85)' : '#facc15'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(c.x + 13, c.y - 13, 8, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = i ? '#fff' : '#111827'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), c.x + 13, c.y - 12.5);
  });
  ctx.restore();
  if (trainer && (mode === 'train' || mode === 'success')) drawHud(ctx, cars);
  drawRankNets(ranks, cw, col, tr);
  if (banner && performance.now() < banner.until) drawBanner(ctx, cw, banner);
  if (mode === 'success') drawBanner(ctx, cw, successBanner());
}

function drawBanner(ctx, cw, b) {                   // 화면 가운데 큰 안내 (라운드 결과·성공)
  const h = cw * WORLD.h / WORLD.w, w = Math.min(cw - 40, 560);
  const x = (cw - w) / 2, y = h / 2 - 60;
  ctx.fillStyle = dark() ? 'rgba(18,20,23,.92)' : 'rgba(255,255,255,.95)';
  ctx.strokeStyle = b.kind === 'ok' ? '#22c55e' : b.kind === 'fail' ? '#f97316' : css('--line');
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x, y, w, 120, 18); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = css('--text');
  ctx.font = `700 ${cw < 500 ? 20 : 28}px system-ui, sans-serif`; ctx.fillText(b.title, cw / 2, y + 44);
  ctx.font = `${cw < 500 ? 13 : 16}px system-ui, sans-serif`; ctx.fillStyle = css('--muted'); ctx.fillText(b.sub, cw / 2, y + 84);
}
function successBanner() {
  const s = trainer.success;
  return { kind: 'ok', title: t({ ko: `🎉 성공! 라운드 ${s.round}`, en: `🎉 Success! Round ${s.round}` }),
           sub: t({ ko: `${s.winners.length}대가 ${trainer.opts.laps}바퀴를 완주했습니다 · ${s.step} 스텝`, en: `${s.winners.length} car(s) completed ${trainer.opts.laps} laps · ${s.step} steps` }) };
}

function drawHud(ctx, cars) {                       // 화면 위 안내: 동시에 학습 중인 개체 수
  const alive = cars.filter(c => c.alive && !c.finished).length, fin = cars.filter(c => c.finished).length;
  const narrow = ctx.canvas.clientWidth < 600;
  const text = narrow
    ? t({ ko: `라운드 ${trainer.pop.generation + 1} · 생존 ${alive}/${cars.length} · 완주 ${fin}`, en: `Round ${trainer.pop.generation + 1} · alive ${alive}/${cars.length} · done ${fin}` })
    : t({ ko: `라운드 ${trainer.pop.generation + 1} · ${cars.length}대 동시 주행 · 목표 ${trainer.opts.laps}바퀴 완주 · 생존 ${alive} · 실패 ${cars.length - alive - fin} · 완주 ${fin}`,
                   en: `Round ${trainer.pop.generation + 1} · ${cars.length} cars at once · goal: ${trainer.opts.laps} laps · alive ${alive} · failed ${cars.length - alive - fin} · finished ${fin}` });
  ctx.font = `600 ${narrow ? 11 : 13}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = dark() ? 'rgba(18,20,23,.82)' : 'rgba(255,255,255,.88)';
  ctx.beginPath(); ctx.roundRect(10, 10, w, 28, 14); ctx.fill();
  ctx.fillStyle = css('--text'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, 20, 24);
}

function drawCar(ctx, c, color, outline, finished, leader) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  if (leader) { ctx.fillStyle = 'rgba(250,204,21,.35)'; ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill(); }
  ctx.fillStyle = color; ctx.fillRect(-9, -4.5, 18, 9);
  if (outline) { ctx.strokeStyle = finished ? '#4ade80' : '#fff'; ctx.lineWidth = finished ? 2.5 : 1.2; ctx.strokeRect(-9, -4.5, 18, 9); }
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(3, -3.5, 4, 7);              // 앞유리 (진행 방향 표시)
  ctx.restore();
}

// ---- 신경망 그리기 ----------------------------------------------------------------
const IN_LABELS = { ko: ['좌90°', '좌60°', '좌30°', '정면', '우30°', '우60°', '우90°'], en: ['L90°', 'L60°', 'L30°', 'Front', 'R30°', 'R60°', 'R90°'] };
const OUT_LABELS = { ko: ['조향'], en: ['Steer'] };

// 신경망 그래프를 상자(box) 안에 그린다. mini = 주행 화면 오른쪽 아래의 작은 창
function drawNetGraph(ctx, genome, net, box, mini = false) {
  const cfg = genome.cfg, nIn = cfg.nInputs;
  // 층 = 입력에서의 최장 경로
  const depth = new Map(), on = [...genome.conns.values()].filter(c => c.on);
  for (const id of genome.nodes.keys()) depth.set(id, id < nIn ? 0 : 1);
  for (let it = 0; it < genome.nodes.size; it++) for (const c of on) if (depth.get(c.b) < depth.get(c.a) + 1 && genome.nodes.get(c.b).type !== 'out') depth.set(c.b, depth.get(c.a) + 1);
  const maxD = Math.max(1, ...[...genome.nodes.values()].filter(n => n.type === 'hid').map(n => depth.get(n.id))) + 1;
  for (const n of genome.nodes.values()) if (n.type === 'out') depth.set(n.id, maxD);
  const cols = new Map();
  for (const n of genome.nodes.values()) { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n.id); }
  const padL = mini ? 10 : 58, padR = mini ? 40 : 64, padV = mini ? 8 : 16, pos = new Map();
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
      // 신호 세기(입력 활성값 × 가중치)가 클수록 진하게 → 주행 중 어떤 연결이 쓰이는지 보인다
      const sig = Math.abs((net?.values.get(c.a) ?? 0.5) * c.w);
      ctx.globalAlpha = mini ? 0.25 + Math.min(0.75, sig / 2) : 0.35 + Math.min(0.6, Math.abs(c.w) / 4);
      ctx.lineWidth = Math.min(4, 0.6 + Math.abs(c.w)) * k;
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  const lang = window.currentLang?.() || 'ko';
  ctx.font = mini ? '600 10px system-ui, sans-serif' : '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const n of genome.nodes.values()) {
    const p = pos.get(n.id), v = net?.values.get(n.id) ?? 0;
    const r = (n.type === 'hid' ? 6 : 8) * (mini ? 0.55 : 1);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fillStyle = css('--surface'); ctx.fill();
    ctx.globalAlpha = Math.min(1, Math.abs(v)); ctx.fillStyle = v >= 0 ? pos1 : neg1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = css('--muted'); ctx.lineWidth = mini ? 0.8 : 1.2; ctx.stroke();
    ctx.fillStyle = css('--text');
    if (n.type === 'in' && !mini) { ctx.textAlign = 'right'; ctx.fillText(IN_LABELS[lang][n.id] ?? n.id, p.x - 12, p.y); }
    if (n.type === 'out') {
      ctx.textAlign = 'left';
      ctx.fillText(mini ? (v >= 0 ? '→ ' : '← ') + Math.abs(v).toFixed(2) : OUT_LABELS[lang][n.id - nIn] + ' ' + v.toFixed(2), p.x + (mini ? 7 : 12), p.y);
    }
  }
}

function drawNet(genome, net) {
  const canvas = $('net'), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  if (!genome) return;
  drawNetGraph(ctx, genome, net, { x: 0, y: 0, w: cw, h: ch });
  $('netInfo').textContent = t({ ko: `은닉 노드 ${genome.hidden}개 · 활성 연결 ${genome.enabledConns}개 — 선 색: 파랑 = 양(+) 가중치, 주황 = 음(−) 가중치, 점선 = 꺼진 연결`,
                                 en: `${genome.hidden} hidden nodes · ${genome.enabledConns} active connections — blue = positive weight, orange = negative, dashed = disabled` });
}

// 1~5등: 1등은 화면이 따라가는 선두 차량, 나머지는 완주 > 주행 중 > 실패 순, 같은 무리에서는 멀리 간 차가 앞
// 벽에 충돌(실패)한 차는 순위에서 빠짐 → 오른쪽 신경망 칸도 아래부터 사라지고, 새 라운드에 다시 5개
function rankCars(cars, leader) {
  const ok = c => c && (c.alive || c.finished);
  const out = ok(leader) ? [leader] : [];
  const key = (c) => [c.finished ? 2 : 1, c.alive && !c.finished ? c.progress : c.maxProgress];
  const rest = cars.filter(c => c !== leader && c.genome && ok(c)).sort((a, b) => { const ka = key(a), kb = key(b); return kb[0] - ka[0] || kb[1] - ka[1]; });
  return out.concat(rest).slice(0, 5);
}
// 트랙 오른쪽 바깥의 1~5등 신경망 (위에서 아래로). 창 크기는 예전 화면 안 작은 창과 같음
function drawRankNets(ranks, cw, col, tr) {
  const wide = matchMedia('(min-width: 960px)').matches;
  const w = Math.max(140, Math.min(220, cw * 0.18)), h = w * 0.62;
  for (let i = 0; i < 5; i++) {
    const canvas = $('rankNet' + i); if (!canvas) continue;
    canvas.style.visibility = ranks[i] ? '' : 'hidden';
    if (!ranks[i]) continue;
    canvas.style.width = wide ? w + 'px' : '';
    const { ctx, cw: W2 } = fit(canvas, 1, 0.62);
    const H2 = W2 * 0.62, car = ranks[i];
    ctx.clearRect(0, 0, W2, H2);
    ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const badge = (x, y) => { ctx.fillStyle = i ? 'rgba(17,24,39,.85)' : '#facc15'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); ctx.fillStyle = i ? '#fff' : '#111827'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y + 0.5); };
    badge(12, 12);
    if (!car) { ctx.fillStyle = css('--muted'); ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t({ ko: '—', en: '—' }), 26, 12); continue; }
    const pct = Math.max(0, 100 * (car.alive && !car.finished ? car.progress : car.maxProgress) / tr.L).toFixed(0);
    const state = car.finished ? t({ ko: '완주', en: 'done' }) : car.alive ? `${pct}%` : t({ ko: `실패 ${pct}%`, en: `failed ${pct}%` });
    ctx.fillStyle = col(car); ctx.beginPath(); ctx.arc(26, 12, 4, 0, 7); ctx.fill();
    ctx.fillStyle = css('--muted'); ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(W2 < 170 ? state : t({ ko: `${state} · 은닉 ${car.genome.hidden} · 연결 ${car.genome.enabledConns}`, en: `${state} · ${car.genome.hidden} hidden · ${car.genome.enabledConns} links` }), 34, 12);
    if (!car.alive && !car.finished) ctx.globalAlpha = 0.45;
    drawNetGraph(ctx, car.genome, car.net, { x: 2, y: 20, w: W2 - 4, h: H2 - 22 }, true);
    ctx.globalAlpha = 1;
  }
}
// ---- 학습 곡선 차트 ---------------------------------------------------------------
let hoverGen = null;
function drawChart() {
  const canvas = $('chart'), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  const h = trainer.pop.history;
  const pad = { l: 44, r: 54, t: 12, b: 26 };
  const W = cw - pad.l - pad.r, H = ch - pad.t - pad.b;
  const ymax = Math.max(1000, ...h.map(r => r.best)) * 1.05, xmax = Math.max(5, h.length - 1);
  const X = i => pad.l + W * i / xmax, Y = v => pad.t + H * (1 - v / ymax);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
  for (const v of [0, 1000, 2000, 3000].filter(v => v <= ymax)) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + W, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(v, pad.l - 6, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const stepX = Math.max(1, Math.ceil(xmax / 8));
  for (let i = 0; i <= xmax; i += stepX) ctx.fillText(i + 1, X(i), pad.t + H + 6);   // 라운드 번호
  if (!h.length) {
    ctx.fillText(t({ ko: '첫 세대가 끝나면 그려집니다', en: 'Appears after the first generation' }), pad.l + W / 2, pad.t + H / 2);
    return;
  }
  const cols = SERIES(), keys = ['best', 'mean'];
  keys.forEach((k, si) => {
    ctx.strokeStyle = cols[si]; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    h.forEach((r, i) => (i ? ctx.lineTo(X(i), Y(r[k])) : ctx.moveTo(X(i), Y(r[k]))));
    ctx.stroke();
    const last = h.at(-1);                                   // 직접 레이블 (끝점)
    ctx.fillStyle = cols[si]; ctx.beginPath(); ctx.arc(X(h.length - 1), Y(last[k]), 4, 0, 7); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t(k === 'best' ? { ko: '최고', en: 'Best' } : { ko: '평균', en: 'Mean' }), X(h.length - 1) + 8, Y(last[k]) + (si ? 7 : -7));
  });
  if (hoverGen != null && h[hoverGen]) {                     // 십자선 + 툴팁
    const r = h[hoverGen], x = X(hoverGen);
    ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke(); ctx.setLineDash([]);
    keys.forEach((k, si) => { ctx.fillStyle = cols[si]; ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, Y(r[k]), 5, 0, 7); ctx.fill(); ctx.stroke(); });
    const tip = $('chartTip');
    tip.hidden = false;
    tip.innerHTML = `<b>${t({ ko: '라운드', en: 'Round' })} ${r.gen + 1}</b><br><i style="background:${cols[0]}"></i>${t({ ko: '최고', en: 'Best' })} ${r.best.toFixed(0)}<br><i style="background:${cols[1]}"></i>${t({ ko: '평균', en: 'Mean' })} ${r.mean.toFixed(0)}<br>${t({ ko: '완주', en: 'Finished' })} ${r.finished} · ${t({ ko: '종', en: 'Species' })} ${r.species}`;
    tip.style.left = Math.min(cw - 150, x + 10) + 'px'; tip.style.top = pad.t + 'px';
  } else $('chartTip').hidden = true;
}

function updateTable() {
  const h = trainer.pop.history;
  $('histTable').innerHTML = `<tr><th>${t({ ko: '라운드', en: 'Round' })}</th><th>${t({ ko: '최고', en: 'Best' })}</th><th>${t({ ko: '평균', en: 'Mean' })}</th><th>${t({ ko: '완주', en: 'Finished' })}</th><th>${t({ ko: '종', en: 'Species' })}</th><th>${t({ ko: '은닉', en: 'Hidden' })}</th></tr>` +
    h.slice(-30).reverse().map(r => `<tr><td>${r.gen + 1}</td><td>${r.best.toFixed(0)}</td><td>${r.mean.toFixed(0)}</td><td>${r.finished}</td><td>${r.species}</td><td>${r.nodes}</td></tr>`).join('');
}

// ---- 개체군 보드: 점 하나 = 자동차 한 대 ----------------------------------------------
function drawPopulation() {
  const canvas = $('popBoard'); if (!canvas || !(mode === 'train' || mode === 'success')) return;
  const cars = trainer.cars, sp = trainer.speciesOf;
  const perRow = Math.max(10, Math.floor(canvas.clientWidth / 16));
  canvas.style.height = Math.ceil(cars.length / perRow) * (canvas.clientWidth / perRow) + 4 + 'px';   // 대수에 맞춘 높이
  const { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  // 종별로 묶어 정렬 → 같은 색이 모여 보인다
  const order = [...cars].sort((a, b) => (sp.get(a.genome) - sp.get(b.genome)) || (b.maxProgress - a.maxProgress));
  const n = order.length, cols = Math.max(10, Math.floor(cw / 16)), rows = Math.ceil(n / cols);
  const cell = Math.min(cw / cols, (ch - 4) / rows), r = Math.max(3, cell * 0.36);
  order.forEach((c, i) => {
    const x = (i % cols) * cell + cell / 2, y = Math.floor(i / cols) * cell + cell / 2 + 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    const color = speciesColor(sp.get(c.genome) ?? 0);
    if (c.finished) { ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.5; ctx.stroke(); }
    else if (c.alive) { ctx.fillStyle = color; ctx.fill(); }
    else { ctx.strokeStyle = color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1; }
  });
  // 종 범례: 색만으로 구분하지 않도록 이름과 대수
  const counts = new Map();
  for (const c of cars) { const s = sp.get(c.genome); counts.set(s, (counts.get(s) || 0) + 1); }
  $('speciesLegend').innerHTML = [...counts].sort((a, b) => b[1] - a[1]).map(([s, k]) =>
    `<span><i style="background:${speciesColor(s)}"></i>${t({ ko: '종', en: 'Species' })} ${s} · ${k}${t({ ko: '대', en: '' })}</span>`).join('');
}

// ---- 상태 표시 -------------------------------------------------------------------
function stats() {
  const T = trainer, h = T.pop.history.at(-1);
  const leader = T.leader();
  const cells = [
    [t({ ko: '라운드', en: 'Round' }), T.pop.generation + 1],
    [t({ ko: '생존', en: 'Alive' }), `${T.alive} / ${T.cars.length}`],
    [t({ ko: '선두 진행률', en: 'Leader progress' }), `${Math.max(0, 100 * leader.progress / T.track.L).toFixed(0)}% / ${T.opts.laps * 100}%`],
    [t({ ko: '지난 세대 완주', en: 'Finished last gen' }), h ? h.finished : '–'],
    [t({ ko: '종(species)', en: 'Species' }), T.pop.species.length],
    [t({ ko: '스텝 · 차량 속도', en: 'Step · car speed' }), `${T.step} / ${T.maxSteps} · ${T.opts.carSpeed}`]
  ];
  $('stats').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

// ---- 루프 ------------------------------------------------------------------------
function frame() {
  if (mode === 'replay') {
    for (let i = 0; i < 2 && replayCar.alive && !replayCar.finished; i++) stepCar(replayCar, trainer.track, trainer.opts);
    drawWorld(trainer.track, [], replayCar);
    drawNet(replayCar.genome, replayCar.net);
    if (!replayCar.alive || replayCar.finished) { mode = 'success'; $('successBar').hidden = false; }
  } else if (mode === 'train' || mode === 'success') {
    if (running && mode === 'train' && !(banner && performance.now() < banner.until)) {
      const t0 = performance.now();
      let n = 0, res = false;
      do { res = trainer.tick(); n++; } while (!res && (speed === 'max' ? performance.now() - t0 < 14 : n < speed));
      if (res === 'round') onRoundEnd();
      if (res === 'success') onSuccess();
    }
    const leader = mode === 'success' ? trainer.success.winners[0] : trainer.leader();
    drawWorld(trainer.track, trainer.cars, leader);
    drawNet(leader.genome, leader.net);
    stats();
    drawPopulation();
  } else if (test) {
    for (let i = 0; i < 2 && test.car.alive && !test.car.finished && test.car.steps < test.max; i++) stepCar(test.car, test.track, trainer.opts);
    drawWorld(test.track, [], test.car);
    drawNet(test.car.genome, test.car.net);
    const c = test.car, pct = Math.max(0, 100 * c.maxProgress / test.track.L).toFixed(0);
    const done = !c.alive || c.finished || c.steps >= test.max;
    $('testResult').innerHTML = done
      ? (c.finished ? t({ ko: `✅ 처음 보는 트랙을 ${trainer.opts.laps}바퀴 완주했습니다 (${c.steps} 스텝)`, en: `✅ Completed ${trainer.opts.laps} laps on an unseen track (${c.steps} steps)` })
                    : t({ ko: `❌ ${pct}% 지점에서 ${causeText(c.cause || 'timeout')}`, en: `❌ ${causeText(c.cause || 'timeout')} at ${pct}%` }))
      : t({ ko: `주행 중… ${pct}%`, en: `Driving… ${pct}%` });
  }
  requestAnimationFrame(frame);
}
const causeText = c => t({ crash: { ko: '벽에 충돌', en: 'Crashed' }, reverse: { ko: '역주행', en: 'Drove backwards' },
  stall: { ko: '정체(진전 없음)', en: 'Stalled' }, timeout: { ko: '시간 초과', en: 'Timed out' } }[c] || { ko: c, en: c });

// ---- 라운드 진행 -----------------------------------------------------------------
const BANNER_MS = { 1: 1800, 4: 1300, 16: 500, max: 150 };
function onRoundEnd() {
  const h = trainer.pop.history.at(-1), round = h.gen + 1;
  const ok = h.finished > 0;                         // 2바퀴 완주한 차가 한 대라도 있으면 성공 라운드
  const pct = (100 * Math.min(h.bestProgress, trainer.opts.laps) / trainer.opts.laps).toFixed(0);
  const last = roundLog.at(-1);
  if (last && last.round === round) Object.assign(last, { finished: h.finished, ok: last.ok || ok, progress: Math.max(last.progress, h.bestProgress) });
  else roundLog.push({ round, progress: h.bestProgress, finished: h.finished, ok });
  banner = ok
    ? { kind: 'ok', until: performance.now() + BANNER_MS[speed],
        title: t({ ko: `라운드 ${round} 성공 — ${h.finished}대 완주`, en: `Round ${round} succeeded — ${h.finished} finished` }),
        sub: t({ ko: `완주한 차들을 부모로 라운드 ${round + 1}에서 더 빠른 주행을 학습합니다`, en: `The finishers breed round ${round + 1} to learn faster driving` }) }
    : { kind: 'fail', until: performance.now() + BANNER_MS[speed],
        title: t({ ko: `라운드 ${round} 실패 — 완주 0대`, en: `Round ${round} failed — no car finished` }),
        sub: t({ ko: `최고 진행률 ${pct}% · 우수한 차들로 다음 세대를 만들어 라운드 ${round + 1} 시작`,
                 en: `Best progress ${pct}% · breeding the best cars → round ${round + 1}` }) };
  drawChart(); updateTable(); renderLog();
}
function onSuccess() {
  running = false; mode = 'success'; label();
  const s = trainer.success;
  roundLog.push({ round: s.round, progress: trainer.opts.laps, finished: s.winners.length, ok: true });
  $('successBar').hidden = false;
  renderLog();
}
function renderLog() {
  const box = $('roundLog');
  if (!roundLog.length) { box.innerHTML = `<p class="meta">${t({ ko: '학습을 시작하면 라운드 결과가 여기에 쌓입니다.', en: 'Round results will appear here once training starts.' })}</p>`; return; }
  box.innerHTML = roundLog.slice().reverse().slice(0, 60).map(r => `<div class="round-row ${r.ok ? 'ok' : ''}">
      <b>${t({ ko: '라운드', en: 'Round' })} ${r.round}</b>
      <span class="bar"><i style="width:${Math.min(100, 100 * r.progress / trainer.opts.laps)}%"></i></span>
      <span>${r.ok ? t({ ko: `🎉 성공 · ${r.finished}대 ${trainer.opts.laps}바퀴 완주`, en: `🎉 Success · ${r.finished} finished` })
                   : t({ ko: `실패 · 최고 ${(100 * r.progress / trainer.opts.laps).toFixed(0)}%`, en: `Failed · best ${(100 * r.progress / trainer.opts.laps).toFixed(0)}%` })}</span></div>`).join('');
}
function continueTraining() {                       // 성공 이후에도 더 빠른 주행을 위해 학습 계속
  trainer.opts.stopOnFinish = false;
  mode = 'train'; running = true; $('successBar').hidden = true; label();
}

// ---- 일반화 테스트 (sim-to-real 맛보기) ---------------------------------------------
function startTest() {
  const g = trainer.success?.winners[0].genome || trainer.pop.best || trainer.leader().genome;
  const track = makeTrack('random');
  test = { track, car: new Car(track, g, 0, trainer.opts.carSpeed), max: maxStepsFor(track, trainer.opts) };
  mode = 'test'; $('successBar').hidden = true;
  $('testBar').hidden = false;
  $('modeLabel').textContent = t({ ko: '일반화 테스트: 학습 때 본 적 없는 트랙', en: 'Generalisation test: a track never seen in training' });
}
function batchTest() {
  const g = trainer.success?.winners[0].genome || trainer.pop.best;
  if (!g) { $('batchResult').textContent = t({ ko: '먼저 한 세대 이상 학습하세요.', en: 'Train at least one generation first.' }); return; }
  let ok = 0; const N = 20;
  for (let i = 0; i < N; i++) if (testRun(g, makeTrack('random'), trainer.opts).finished) ok++;
  $('batchResult').innerHTML = t({ ko: `처음 보는 트랙 ${N}개 중 <b>${ok}개</b> 완주 (${(100 * ok / N).toFixed(0)}%)`, en: `Completed <b>${ok}</b> of ${N} unseen tracks (${(100 * ok / N).toFixed(0)}%)` });
}
function endTest() {
  mode = trainer?.success && trainer.opts.stopOnFinish ? 'success' : 'train';
  test = null; $('testBar').hidden = true; $('modeLabel').textContent = '';
  if (mode === 'success') $('successBar').hidden = false;
}

// ---- 조작부 ----------------------------------------------------------------------
function restart() {
  trainer = new Trainer(Population, {
    trackType: $('trackType').value, popSize: +$('popSize').value,
    randomize: $('randomize').checked, noise: $('noise').checked ? 0.05 : 0, stopOnFinish: true,
    carSpeed: +$('carSpeed').value
  });
  roundLog = []; banner = null; replayCar = null; mode = 'train'; $('successBar').hidden = true;
  endTest(); drawChart(); updateTable(); renderLog(); label(); $('batchResult').textContent = '';
}

const TRACKS = [['blob', { ko: '둥근 트랙', en: 'Round track' }], ['mm', { ko: 'M-M 트랙 (어려움)', en: 'M-M track (hard)' }],
                ['circuit', { ko: '서킷 트랙 (직선·시케인)', en: 'Circuit (straights · chicane)' }],
                ['snake', { ko: 'S자 연속 커브 (어려움)', en: 'S-curves (hard)' }],
                ['random', { ko: '무작위', en: 'Random' }]];
function fillTrackSelect() {
  const sel = $('trackType'), v = sel.value || 'blob';
  sel.innerHTML = TRACKS.map(([k, l]) => `<option value="${k}">${t(l)}</option>`).join('');
  sel.value = v;
  $('popSize').querySelectorAll('option').forEach(o => o.textContent = t({ ko: `${o.value}대`, en: `${o.value} cars` }));
  speedHint();
}
function speedHint() {                               // 슬라이더 값 표시 + 난이도 안내
  const v = +$('carSpeed').value;
  $('carSpeedOut').textContent = v.toFixed(1);
  $('speedHint').textContent = v > CAR_SPEED.hard
    ? t({ ko: '⚠ 5보다 빠르면 M-M 트랙 급커브를 돌기 매우 어렵습니다', en: '⚠ Above 5 the M-M hairpins are very hard to take' })
    : v <= 2 ? t({ ko: '느림: 빨리 배우지만 2바퀴에 시간이 오래 걸립니다', en: 'Slow: learns fast, but two laps take a while' }) : '';
}

function bind() {
  fillTrackSelect();
  $('playBtn').addEventListener('click', () => {
    if (mode === 'success' || mode === 'replay') { continueTraining(); return; }
    running = !running; label();
  });
  $('speedBtn').addEventListener('click', () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; label(); });
  $('resetBtn').addEventListener('click', restart);
  $('trackType').addEventListener('change', () => { trainer.opts.trackType = $('trackType').value; trainer.newTrack(); });
  $('newTrackBtn').addEventListener('click', () => trainer.newTrack());
  $('popSize').addEventListener('change', restart);
  const cs = $('carSpeed');
  Object.assign(cs, { min: CAR_SPEED.min, max: CAR_SPEED.max, step: CAR_SPEED.step });
  cs.addEventListener('input', speedHint);               // 움직이는 동안: 값만 표시
  cs.addEventListener('change', restart);                // 놓으면: 그 속도로 처음부터 다시 학습
  $('randomize').addEventListener('change', () => trainer.setRandomize($('randomize').checked));
  $('noise').addEventListener('change', () => { trainer.opts.noise = $('noise').checked ? 0.05 : 0; });
  $('testBtn').addEventListener('click', startTest);
  $('replayBtn').addEventListener('click', () => { replayCar = trainer.replay(trainer.success.winners[0]); mode = 'replay'; $('successBar').hidden = true; });
  $('continueBtn').addEventListener('click', continueTraining);
  $('successTestBtn').addEventListener('click', startTest);
  $('successResetBtn').addEventListener('click', restart);
  $('retestBtn').addEventListener('click', startTest);
  $('backBtn').addEventListener('click', endTest);
  $('batchBtn').addEventListener('click', batchTest);
  $('fsBtn').addEventListener('click', () => {
    const st = $('simStage');
    if (document.fullscreenElement) document.exitFullscreen(); else st.requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => { $('sim').style.height = ''; });
  $('saveBtn').addEventListener('click', () => {
    const g = trainer.pop.best; if (!g) return;
    const blob = new Blob([JSON.stringify({ format: 'neat-genome/1', inputs: IN_LABELS.en, outputs: OUT_LABELS.en, generation: trainer.pop.generation, genome: g.toJSON() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'best-genome.json'; a.click(); URL.revokeObjectURL(a.href);
  });
  const chart = $('chart');
  chart.addEventListener('mousemove', e => {
    const h = trainer.pop.history; if (!h.length) return;
    const r = chart.getBoundingClientRect(), W = r.width - 44 - 54, xmax = Math.max(5, h.length - 1);
    const i = Math.round((e.clientX - r.left - 44) / W * xmax);
    hoverGen = i >= 0 && i < h.length ? i : null; drawChart();
  });
  chart.addEventListener('mouseleave', () => { hoverGen = null; drawChart(); });
  document.addEventListener('langchange', () => { fillTrackSelect(); label(); drawChart(); updateTable(); renderLog(); });
  window.addEventListener('resize', () => drawChart());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawChart());
  $('themeBtn')?.addEventListener('click', () => setTimeout(drawChart, 0));
}
function label() {
  $('playBtn').innerHTML = mode === 'success' ? t({ ko: '▶ 계속 학습', en: '▶ Keep training' })
    : running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 학습 시작', en: '▶ Train' });
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Playback ' }) + (speed === 'max' ? t({ ko: '최대', en: 'max' }) : speed + '×');
}

function main() {
  bind(); restart(); label();
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
