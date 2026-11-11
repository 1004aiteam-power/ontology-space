// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// NEAT 드론 페이지: 150대가 한 하늘에서 동시에 진화하며 경유점 비행을 배우는 과정을 브라우저에서 실행·시각화
import { Population } from './neat.js?v=a16de3e3';
import { Trainer, WORLD, DRONE, stepDrone, sense, INPUT_LABELS, INPUT_LABELS_EN, OUTPUT_LABELS, OUTPUT_LABELS_EN } from './drone-sim.js?v=fcd8839c';

const $ = (id) => document.getElementById(id);
const t = (o) => (window.t ? window.t(o) : o.ko);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// 차트·신경망 색: 자율주행·스네이크 페이지와 같은 팔레트
const SERIES = () => dark() ? ['#3987e5', '#d95926'] : ['#2a78d6', '#eb6834'];
const SPECIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const speciesColor = (id) => SPECIES_COLORS[((id % 8) + 8) % 8];
const TARGET = '#e5484d', LEAD = '#facc15';

let trainer, running = false, mode = 'train';   // 'train' | 'replay'
let speedIdx = 0, acc = 0, lastT = 0;
let followed = null;        // 화면에서 클릭한 개체 (없으면 선두)
let replay = null;          // 다시 보기 중인 Drone
let hoverGen = null;
const trails = new WeakMap();                    // 드론 → 지나온 자리 (대표 드론만 그림)
// 초당 틱 수 (1× = 실제 시간). 'max' = 프레임마다 14ms 동안 최대한
const SPEEDS = [{ sps: 1 / WORLD.dt, label: '1×' }, { sps: 4 / WORLD.dt, label: '4×' }, { sps: 16 / WORLD.dt, label: '16×' }, { sps: 'max', label: 'max' }];
const POP_SIZE = 150;

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

// ---- 하늘 그리기 -------------------------------------------------------------------
// 세계 좌표(m, y 위쪽 +) → 화면 좌표(px, y 아래쪽 +)
let K = 1;
const sx = (x) => x * K, sy = (y) => (WORLD.h - y) * K;

function drawSky(ctx, cw, ch) {
  ctx.fillStyle = dark() ? '#141a22' : '#eef4fa'; ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = dark() ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 10; x < WORLD.w; x += 10) { ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), ch); }
  for (let y = 10; y < WORLD.h; y += 10) { ctx.moveTo(0, sy(y)); ctx.lineTo(cw, sy(y)); }
  ctx.stroke();
  ctx.strokeStyle = dark() ? 'rgba(248,113,113,.55)' : 'rgba(220,38,38,.45)'; ctx.lineWidth = 3;   // 가장자리 = 넘으면 끝
  ctx.strokeRect(1.5, 1.5, cw - 3, ch - 3);
}

function drawDrone(ctx, d, color, big = false) {
  const x = sx(d.x), y = sy(d.y), arm = DRONE.arm * K * (big ? 1.25 : 1);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(d.th);                  // th +는 오른쪽으로 기움 = 화면에서 시계 방향
  if (big) {                                              // 추력 불꽃: 프로펠러 아래로, 추력만큼 길게
    for (const [side, f] of [[-1, d.left], [1, d.right]]) {
      ctx.strokeStyle = 'rgba(249,115,22,.85)'; ctx.lineWidth = Math.max(2, arm * 0.22); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(side * arm, arm * 0.2); ctx.lineTo(side * arm, arm * (0.2 + 1.5 * f)); ctx.stroke();
    }
  }
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, arm * (big ? 0.24 : 0.2));
  ctx.beginPath(); ctx.moveTo(-arm, 0); ctx.lineTo(arm, 0); ctx.stroke();                     // 팔
  ctx.lineWidth = Math.max(1, arm * 0.12);
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * arm - arm * 0.45, -arm * 0.22); ctx.lineTo(side * arm + arm * 0.45, -arm * 0.22); ctx.stroke(); }   // 프로펠러
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, arm * (big ? 0.36 : 0.3), 0, 7); ctx.fill();   // 몸체
  ctx.restore();
}

function drawTarget(ctx, p, n, strong) {
  const x = sx(p.x), y = sy(p.y), r = DRONE.reach * K;
  ctx.globalAlpha = strong ? 1 : 0.35;
  ctx.strokeStyle = TARGET; ctx.lineWidth = strong ? 3 : 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  if (strong) { ctx.fillStyle = 'rgba(229,72,77,.18)'; ctx.fill(); }
  ctx.fillStyle = TARGET; ctx.font = `700 ${Math.max(10, r * 0.9)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(n, x, y);
  ctx.globalAlpha = 1;
}

// 화면에 보여줄 대표: 클릭한 개체가 아직 날고 있으면 그 개체, 아니면 선두
function current() {
  if (followed && followed.drone.alive && trainer.agents.includes(followed)) return followed;
  followed = null;
  return trainer.leader();
}

function drawMain() {
  const { ctx, cw, ch } = fit($('sky'), WORLD.h / WORLD.w);
  K = cw / WORLD.w;
  drawSky(ctx, cw, ch);
  const focus = mode === 'replay' ? replay : current()?.drone;
  const course = mode === 'replay' ? replay.course : trainer.course;

  // 경유점: 가장 뒤처진 드론의 목표부터 대표 드론의 다음 목표까지
  let lo = focus ? focus.score : 0;
  if (mode === 'train') for (const a of trainer.agents) if (a.drone.alive && a.drone.score < lo) lo = a.drone.score;
  const hi = focus ? focus.score : 0;
  for (let i = Math.max(lo, hi - 3); i <= hi + 1; i++) drawTarget(ctx, course.point(i), i + 1, i === hi);

  if (mode === 'train') {
    const sp = trainer.speciesOf;
    ctx.globalAlpha = 0.5;
    for (const a of trainer.agents) if (a.drone.alive && a.drone !== focus) drawDrone(ctx, a.drone, speciesColor(sp.get(a.genome) ?? 0));
    ctx.globalAlpha = 1;
  }
  if (focus) {
    const tr = trails.get(focus);                         // 지나온 길
    if (tr && tr.length > 1) {
      ctx.strokeStyle = LEAD; ctx.globalAlpha = 0.55; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); tr.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])))); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (focus.alive) {                                    // 다음 경유점을 가리키는 점선
      const p = focus.target;
      ctx.strokeStyle = 'rgba(229,72,77,.6)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(sx(focus.x), sy(focus.y)); ctx.lineTo(sx(p.x), sy(p.y)); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(250,204,21,.3)'; ctx.beginPath(); ctx.arc(sx(focus.x), sy(focus.y), DRONE.arm * K * 2.1, 0, 7); ctx.fill();   // 노란 후광
    const color = mode === 'replay' ? '#199e70' : speciesColor(trainer.speciesOf.get(current()?.genome) ?? 0);
    ctx.globalAlpha = focus.alive ? 1 : 0.4;
    drawDrone(ctx, focus, color, true);
    ctx.globalAlpha = 1;
  }
  drawHud(ctx, cw, ch, focus);
}

function drawHud(ctx, cw, ch, d) {
  const narrow = cw < 460, T = trainer;
  let text;
  if (mode === 'replay') {
    const b = T.bestFlight;
    text = t({ ko: `최고 기록 다시 보기 · 세대 ${b.gen} · 경유점 ${d.score}/${b.score}`, en: `Replaying the record · gen ${b.gen} · waypoints ${d.score}/${b.score}` });
  } else if (!d) text = t({ ko: `세대 ${T.pop.generation + 1}`, en: `Generation ${T.pop.generation + 1}` });
  else {
    const who = (followed ? t({ ko: '노란 드론 = 선택한 개체', en: 'yellow = selected' }) : t({ ko: '노란 드론 = 선두', en: 'yellow = leader' })) + t({ ko: ` · ${T.alive}대 비행 중`, en: ` · ${T.alive} flying` });
    const left = Math.max(0, DRONE.starve - d.since).toFixed(0);
    text = narrow
      ? t({ ko: `세대 ${T.pop.generation + 1} · 코스 ${T.trial + 1}/${T.opts.trials} · 경유점 ${d.score}`, en: `Gen ${T.pop.generation + 1} · course ${T.trial + 1}/${T.opts.trials} · waypoints ${d.score}` })
      : t({ ko: `세대 ${T.pop.generation + 1} · ${who} · 코스 ${T.trial + 1}/${T.opts.trials} · 경유점 ${d.score} · 남은 시간 ${left}초`,
            en: `Gen ${T.pop.generation + 1} · ${who} · course ${T.trial + 1}/${T.opts.trials} · waypoints ${d.score} · ${left}s left` });
  }
  ctx.font = `600 ${narrow ? 11 : 13}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = dark() ? 'rgba(18,20,23,.82)' : 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.roundRect(8, 8, w, 26, 13); ctx.fill();
  ctx.fillStyle = css('--text'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, 18, 21);
  const wind = T.opts.wind;
  if (wind) {                                             // 바람 표시 (오른쪽으로 부는 바람)
    const label = t({ ko: `바람 → ${wind} m/s²`, en: `wind → ${wind} m/s²` });
    const ww = ctx.measureText(label).width + 20;
    ctx.fillStyle = dark() ? 'rgba(18,20,23,.82)' : 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.roundRect(8, ch - 34, ww, 26, 13); ctx.fill();
    ctx.fillStyle = css('--text'); ctx.fillText(label, 18, ch - 21);
  }
}

function legend() {
  const sp = trainer.speciesOf, counts = new Map();
  for (const a of trainer.agents) { const s = sp.get(a.genome); counts.set(s, (counts.get(s) || 0) + 1); }
  $('speciesLegend').innerHTML = [...counts].sort((a, b) => b[1] - a[1]).map(([s, k]) =>
    `<span><i style="background:${speciesColor(s)}"></i>${t({ ko: '종', en: 'Species' })} ${s} · ${k}${t({ ko: '대', en: '' })}</span>`).join('');
}

// ---- 신경망 그리기 ----------------------------------------------------------------
function drawNetGraph(ctx, genome, net, box, thrust) {
  const cfg = genome.cfg, nIn = cfg.nInputs;
  const depth = new Map(), on = [...genome.conns.values()].filter(c => c.on);
  for (const id of genome.nodes.keys()) depth.set(id, id < nIn ? 0 : 1);
  for (let it = 0; it < genome.nodes.size; it++) for (const c of on) if (depth.get(c.b) < depth.get(c.a) + 1 && genome.nodes.get(c.b).type !== 'out') depth.set(c.b, depth.get(c.a) + 1);
  const maxD = Math.max(1, ...[...genome.nodes.values()].filter(n => n.type === 'hid').map(n => depth.get(n.id))) + 1;
  for (const n of genome.nodes.values()) if (n.type === 'out') depth.set(n.id, maxD);
  const cols = new Map();
  for (const n of genome.nodes.values()) { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n.id); }
  // 아래에서 위로: 입력(드론이 느끼는 것)이 맨 아래 줄, 출력(좌우 프로펠러 추력)이 맨 위 줄 — 드론의 프로펠러가 위에 있는 것과 같은 방향
  const padH = 30, padT = 46, padB = 44, pos = new Map();
  for (const [d, ids] of cols) ids.forEach((id, i) => pos.set(id, {
    x: box.x + padH + (box.w - 2 * padH) * (ids.length === 1 ? 0.5 : (d === maxD ? 0.25 + 0.5 * i / (ids.length - 1) : i / (ids.length - 1))),
    y: box.y + box.h - padB - (box.h - padT - padB) * d / maxD
  }));
  const [pos1, neg1] = SERIES();
  for (const c of genome.conns.values()) {
    const a = pos.get(c.a), b = pos.get(c.b);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    if (!c.on) { ctx.setLineDash([3, 4]); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; }
    else {
      ctx.setLineDash([]); ctx.strokeStyle = c.w > 0 ? pos1 : neg1;
      const sig = Math.abs((net?.values.get(c.a) ?? 0.5) * c.w);       // 지금 흐르는 신호가 셀수록 진하게
      ctx.globalAlpha = 0.15 + Math.min(0.85, sig / 2);
      ctx.lineWidth = Math.min(4, 0.6 + Math.abs(c.w));
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  const en = (window.currentLang?.() || 'ko') === 'en', IN = en ? INPUT_LABELS_EN : INPUT_LABELS, OUT = en ? OUTPUT_LABELS_EN : OUTPUT_LABELS;
  ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const n of genome.nodes.values()) {
    const p = pos.get(n.id), v = net?.values.get(n.id) ?? 0, r = n.type === 'hid' ? 6 : 8;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fillStyle = css('--surface'); ctx.fill();
    ctx.globalAlpha = Math.min(1, Math.abs(v)); ctx.fillStyle = v >= 0 ? pos1 : neg1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = css('--text');
    // 글자가 그림 밖으로 나가지 않게 가운데 정렬한 뒤 좌우 끝에서 안쪽으로 당김
    const centered = (text, y) => { const w = ctx.measureText(text).width / 2; ctx.fillText(text, Math.max(box.x + w + 2, Math.min(box.x + box.w - w - 2, p.x)), y); };
    ctx.textAlign = 'center';
    if (n.type === 'in') centered(IN[n.id], p.y + (n.id % 2 ? 32 : 18));           // 이름이 겹치지 않게 두 줄로 엇갈림
    if (n.type === 'out') {
      const f = thrust[n.id - nIn], bw = 80, bx = Math.max(box.x + 2, Math.min(box.x + box.w - bw - 2, p.x - bw / 2));
      centered(`${OUT[n.id - nIn]} ${Math.round(f * 100)}%`, p.y - 32);
      ctx.fillStyle = css('--line'); ctx.fillRect(bx, p.y - 22, bw, 6);                              // 추력 막대
      ctx.fillStyle = 'rgb(249,115,22)'; ctx.fillRect(bx, p.y - 22, bw * f, 6);
    }
  }
}

function drawNet() {
  const canvas = $('net'), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  const d = mode === 'replay' ? replay : current()?.drone;
  if (!d?.genome) return;
  const net = d.genome.network();
  if (!d.t) net.activate(sense(d));                      // 아직 한 틱도 안 지났으면 지금 입력으로 채움
  drawNetGraph(ctx, d.genome, net, { x: 0, y: 0, w: cw, h: ch }, [d.left, d.right]);
  $('netInfo').textContent = t({ ko: `은닉 노드 ${d.genome.hidden}개 · 활성 연결 ${d.genome.enabledConns}개 — 아래 = 입력, 위 = 출력 · 파랑 = 양(+) 가중치, 주황 = 음(−) 가중치, 점선 = 꺼진 연결, 주황 막대 = 지금 추력`,
                                 en: `${d.genome.hidden} hidden nodes · ${d.genome.enabledConns} active links — inputs at the bottom, outputs at the top · blue = positive weight, orange = negative, dashed = disabled, orange bar = thrust right now` });
}

// ---- 학습 곡선: 세대별 한 번 비행 최다 경유점 / 평균 경유점 ------------------------------
function niceStep(max) { const r = max / 5, p = 10 ** Math.floor(Math.log10(r)); return [1, 2, 5, 10].map(m => m * p).find(s => s >= r); }
function drawChart() {
  const canvas = $('chart'), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  const h = trainer.pop.history;
  const pad = { l: 40, r: 54, t: 12, b: 26 };
  const W = cw - pad.l - pad.r, H = ch - pad.t - pad.b;
  const ymax = Math.max(5, ...h.map(r => r.bestScore)) * 1.08, xmax = Math.max(5, h.length - 1);
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
  $('histTable').innerHTML = `<tr><th>${t({ ko: '세대', en: 'Gen' })}</th><th>${t({ ko: '최다 경유점', en: 'Best waypoints' })}</th><th>${t({ ko: '평균 경유점', en: 'Mean waypoints' })}</th><th>${t({ ko: '최고 적합도', en: 'Best fitness' })}</th><th>${t({ ko: '종', en: 'Species' })}</th><th>${t({ ko: '은닉', en: 'Hidden' })}</th></tr>` +
    h.slice(-30).reverse().map(r => `<tr><td>${r.gen + 1}</td><td>${r.bestScore}</td><td>${r.meanScore.toFixed(1)}</td><td>${r.best.toFixed(0)}</td><td>${r.species}</td><td>${r.nodes}</td></tr>`).join('');
}

function stats() {
  const T = trainer, a = current();
  const cells = [
    [t({ ko: '세대', en: 'Generation' }), T.pop.generation + 1],
    [t({ ko: '비행 중', en: 'Flying' }), `${T.alive} / ${T.agents.length}`],
    [t({ ko: '최고 기록 (경유점)', en: 'Record (waypoints)' }), T.bestScore],
    [t({ ko: '지난 세대 평균 경유점', en: 'Mean waypoints last gen' }), T.lastGen ? T.lastGen.meanScore.toFixed(1) : '–'],
    [t({ ko: '종(species)', en: 'Species' }), T.pop.species.length],
    [t({ ko: '선두 신경망', en: 'Leader network' }), a ? t({ ko: `은닉 ${a.genome.hidden} · 연결 ${a.genome.enabledConns}`, en: `${a.genome.hidden} hidden · ${a.genome.enabledConns} links` }) : '–']
  ];
  $('stats').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

// ---- 루프 ------------------------------------------------------------------------
function track(d) {                                      // 대표 드론이 지나온 자리 (최근 4초)
  if (!d) return;
  let tr = trails.get(d);
  if (!tr) trails.set(d, tr = []);
  tr.push([d.x, d.y]);
  if (tr.length > 4 / WORLD.dt) tr.shift();
}
function advance(n) {
  for (let i = 0; i < n; i++) {
    if (mode === 'replay') { if (!replay.alive) break; stepDrone(replay); track(replay); continue; }
    const r = trainer.tick();
    if (r === 'round') onRoundEnd(); else if (!r) track(current()?.drone);
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
  drawMain(); drawNet(); stats();
  requestAnimationFrame(frame);
}
function onRoundEnd() { legend(); drawChart(); updateTable(); $('replayBtn').disabled = !trainer.bestFlight; }

// ---- 조작부 ----------------------------------------------------------------------
function restart() {
  trainer = new Trainer(Population, { popSize: POP_SIZE, trials: +($('trials')?.value || 3), wind: +($('wind')?.value || 0), seed: (Math.random() * 1e9) | 0 });
  followed = null; replay = null; mode = 'train';
  $('replayEnd').hidden = true; $('replayBtn').disabled = true;
  legend(); drawChart(); updateTable(); label();
}
function skipGeneration() {                              // 지금 세대를 화면 없이 끝까지
  if (mode !== 'train') return;
  const g = trainer.pop.generation;
  while (trainer.pop.generation === g) trainer.tick();
  onRoundEnd();
}
function startReplay() {
  if (!trainer.bestFlight) return;
  replay = trainer.replay(); mode = 'replay'; $('replayEnd').hidden = true; label();
}
function endReplay() { mode = 'train'; replay = null; $('replayEnd').hidden = true; label(); }

function label() {
  $('playBtn').innerHTML = mode === 'replay' ? t({ ko: '↩ 학습으로 돌아가기', en: '↩ Back to training' })
    : running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 학습 시작', en: '▶ Train' });
  $('speedBtn').textContent = t({ ko: '배속 ', en: 'Playback ' }) + (SPEEDS[speedIdx].sps === 'max' ? t({ ko: '최대', en: 'max' }) : SPEEDS[speedIdx].label);
  $('trials')?.querySelectorAll('option').forEach(o => o.textContent = t({ ko: `세대당 코스 ${o.value}개`, en: `${o.value} course${o.value > 1 ? 's' : ''} per generation` }));
  $('wind')?.querySelectorAll('option').forEach(o => o.textContent = +o.value ? t({ ko: `옆바람 ${o.value} m/s²`, en: `Side wind ${o.value} m/s²` }) : t({ ko: '바람 없음', en: 'No wind' }));
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
  // 바람은 학습을 처음부터 다시 하지 않고 바꾼다 → 바람 없이 배운 드론이 바람 속에서 어떻게 되는지 볼 수 있음 (다음 코스부터 적용)
  $('wind')?.addEventListener('change', () => { trainer.opts.wind = +$('wind').value; if (mode === 'replay') startReplay(); });
  $('saveBtn')?.addEventListener('click', () => {
    const g = trainer.bestFlight?.genome || trainer.pop.best; if (!g) return;
    const blob = new Blob([JSON.stringify({ format: 'neat-genome/1', inputs: INPUT_LABELS_EN, outputs: OUTPUT_LABELS_EN, generation: trainer.pop.generation, genome: g.toJSON() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'drone-best-genome.json'; a.click(); URL.revokeObjectURL(a.href);
  });
  $('sky')?.addEventListener('click', e => {             // 드론을 누르면 그 개체를 노란 드론으로 따라감
    if (mode !== 'train') return;
    const r = $('sky').getBoundingClientRect(), x = (e.clientX - r.left) / K, y = WORLD.h - (e.clientY - r.top) / K;
    let best = null, bd = Math.max(4, 14 / K);
    for (const a of trainer.agents) if (a.drone.alive) { const d = Math.hypot(a.drone.x - x, a.drone.y - y); if (d < bd) { bd = d; best = a; } }
    followed = best;
  });
  const chart = $('chart');
  chart.addEventListener('mousemove', e => {
    const h = trainer.pop.history; if (!h.length) return;
    const r = chart.getBoundingClientRect(), W = r.width - 40 - 54, xmax = Math.max(5, h.length - 1);
    const i = Math.round((e.clientX - r.left - 40) / W * xmax);
    hoverGen = i >= 0 && i < h.length ? i : null; drawChart();
  });
  chart.addEventListener('mouseleave', () => { hoverGen = null; drawChart(); });
  document.addEventListener('langchange', () => { label(); legend(); drawChart(); updateTable(); });
  window.addEventListener('resize', () => drawChart());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawChart());
  $('themeBtn')?.addEventListener('click', () => setTimeout(drawChart, 0));
}

function main() { bind(); restart(); requestAnimationFrame(frame); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
