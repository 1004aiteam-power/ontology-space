// Physical AI 페이지: NEAT 자율주행 학습을 브라우저에서 실행·시각화
import { Population, Genome } from './neat.js';
import { Trainer, Car, makeTrack, stepCar, maxStepsFor, testRun, RADAR, WORLD } from './sim.js';

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// 차트 색상: dataviz 기준 팔레트 (라이트/다크 각각 색각 이상 검증 통과)
const SERIES = () => dark() ? ['#3987e5', '#d95926'] : ['#2a78d6', '#eb6834'];

let trainer, running = false, speed = 1, mode = 'train', test = null;
const SPEEDS = [1, 4, 16, 'max'];

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

  for (const c of cars) if ((c.alive || c.finished) && c !== leader) drawCar(ctx, c, c.finished ? '#22c55e' : 'rgba(120,170,255,.55)');
  if (leader) {
    ctx.strokeStyle = 'rgba(250,204,21,.85)'; ctx.lineWidth = 1;
    RADAR.angles.forEach((deg, i) => {
      const a = leader.a + deg * Math.PI / 180, d = leader.radar[i];
      ctx.beginPath(); ctx.moveTo(leader.x, leader.y); ctx.lineTo(leader.x + Math.cos(a) * d, leader.y + Math.sin(a) * d); ctx.stroke();
      ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(leader.x + Math.cos(a) * d, leader.y + Math.sin(a) * d, 3, 0, 7); ctx.fill();
    });
    drawCar(ctx, leader, '#f97316', true);
  }
  ctx.restore();
}

function drawCar(ctx, c, color, outline) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = color; ctx.fillRect(-9, -4.5, 18, 9);
  if (outline) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(-9, -4.5, 18, 9); }
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(3, -3.5, 4, 7);              // 앞유리 (진행 방향 표시)
  ctx.restore();
}

// ---- 신경망 그리기 ----------------------------------------------------------------
const IN_LABELS = { ko: ['좌90°', '좌60°', '좌30°', '정면', '우30°', '우60°', '우90°', '속도'], en: ['L90°', 'L60°', 'L30°', 'Front', 'R30°', 'R60°', 'R90°', 'Speed'] };
const OUT_LABELS = { ko: ['조향', '가감속'], en: ['Steer', 'Throttle'] };

function drawNet(genome, net) {
  const canvas = $('net'), { ctx, cw, ch } = fit(canvas);
  ctx.clearRect(0, 0, cw, ch);
  if (!genome) return;
  const cfg = genome.cfg, nIn = cfg.nInputs;
  // 층 = 입력에서의 최장 경로
  const depth = new Map(), on = [...genome.conns.values()].filter(c => c.on);
  for (const id of genome.nodes.keys()) depth.set(id, id < nIn ? 0 : 1);
  for (let it = 0; it < genome.nodes.size; it++) for (const c of on) if (depth.get(c.b) < depth.get(c.a) + 1 && genome.nodes.get(c.b).type !== 'out') depth.set(c.b, depth.get(c.a) + 1);
  const maxD = Math.max(1, ...[...genome.nodes.values()].filter(n => n.type === 'hid').map(n => depth.get(n.id))) + 1;
  for (const n of genome.nodes.values()) if (n.type === 'out') depth.set(n.id, maxD);
  const cols = new Map();
  for (const n of genome.nodes.values()) { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n.id); }
  const padL = 58, padR = 64, pos = new Map();
  for (const [d, ids] of cols) ids.forEach((id, i) => pos.set(id, {
    x: padL + (cw - padL - padR) * d / maxD,
    y: 16 + (ch - 32) * (ids.length === 1 ? 0.5 : i / (ids.length - 1))
  }));
  const [pos1, neg1] = SERIES();
  for (const c of genome.conns.values()) {
    const a = pos.get(c.a), b = pos.get(c.b);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    if (!c.on) { ctx.setLineDash([3, 4]); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; }
    else { ctx.setLineDash([]); ctx.strokeStyle = c.w > 0 ? pos1 : neg1; ctx.globalAlpha = 0.35 + Math.min(0.6, Math.abs(c.w) / 4); ctx.lineWidth = Math.min(4, 0.6 + Math.abs(c.w)); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  const lang = window.currentLang?.() || 'ko';
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const n of genome.nodes.values()) {
    const p = pos.get(n.id), v = net?.values.get(n.id) ?? 0;
    const r = n.type === 'hid' ? 6 : 8;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fillStyle = css('--surface'); ctx.fill();
    ctx.globalAlpha = Math.min(1, Math.abs(v)); ctx.fillStyle = v >= 0 ? pos1 : neg1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = css('--text');
    if (n.type === 'in') { ctx.textAlign = 'right'; ctx.fillText(IN_LABELS[lang][n.id] ?? n.id, p.x - 12, p.y); }
    if (n.type === 'out') { ctx.textAlign = 'left'; ctx.fillText(OUT_LABELS[lang][n.id - nIn] + ' ' + v.toFixed(2), p.x + 12, p.y); }
  }
  $('netInfo').textContent = t({ ko: `은닉 노드 ${genome.hidden}개 · 활성 연결 ${genome.enabledConns}개 — 선 색: 파랑 = 양(+) 가중치, 주황 = 음(−) 가중치, 점선 = 꺼진 연결`,
                                 en: `${genome.hidden} hidden nodes · ${genome.enabledConns} active connections — blue = positive weight, orange = negative, dashed = disabled` });
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
  for (let i = 0; i <= xmax; i += stepX) ctx.fillText(i, X(i), pad.t + H + 6);
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
    tip.innerHTML = `<b>${t({ ko: '세대', en: 'Gen' })} ${r.gen}</b><br><i style="background:${cols[0]}"></i>${t({ ko: '최고', en: 'Best' })} ${r.best.toFixed(0)}<br><i style="background:${cols[1]}"></i>${t({ ko: '평균', en: 'Mean' })} ${r.mean.toFixed(0)}<br>${t({ ko: '완주', en: 'Finished' })} ${r.finished} · ${t({ ko: '종', en: 'Species' })} ${r.species}`;
    tip.style.left = Math.min(cw - 150, x + 10) + 'px'; tip.style.top = pad.t + 'px';
  } else $('chartTip').hidden = true;
}

function updateTable() {
  const h = trainer.pop.history;
  $('histTable').innerHTML = `<tr><th>${t({ ko: '세대', en: 'Gen' })}</th><th>${t({ ko: '최고', en: 'Best' })}</th><th>${t({ ko: '평균', en: 'Mean' })}</th><th>${t({ ko: '완주', en: 'Finished' })}</th><th>${t({ ko: '종', en: 'Species' })}</th><th>${t({ ko: '은닉', en: 'Hidden' })}</th></tr>` +
    h.slice(-30).reverse().map(r => `<tr><td>${r.gen}</td><td>${r.best.toFixed(0)}</td><td>${r.mean.toFixed(0)}</td><td>${r.finished}</td><td>${r.species}</td><td>${r.nodes}</td></tr>`).join('');
}

// ---- 상태 표시 -------------------------------------------------------------------
function stats() {
  const T = trainer, h = T.pop.history.at(-1);
  const leader = T.leader();
  const cells = [
    [t({ ko: '세대', en: 'Generation' }), T.pop.generation],
    [t({ ko: '생존', en: 'Alive' }), `${T.alive} / ${T.cars.length}`],
    [t({ ko: '선두 진행률', en: 'Leader progress' }), `${Math.max(0, 100 * leader.progress / T.track.L).toFixed(0)}% / ${T.opts.laps * 100}%`],
    [t({ ko: '지난 세대 완주', en: 'Finished last gen' }), h ? h.finished : '–'],
    [t({ ko: '종(species)', en: 'Species' }), T.pop.species.length],
    [t({ ko: '스텝', en: 'Step' }), `${T.step} / ${T.maxSteps}`]
  ];
  $('stats').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

// ---- 루프 ------------------------------------------------------------------------
function frame() {
  if (mode === 'train') {
    if (running) {
      const t0 = performance.now();
      let n = 0, genEnded = false;
      do {
        genEnded = trainer.tick() || genEnded;
        n++;
      } while (speed === 'max' ? performance.now() - t0 < 14 : n < speed);
      if (genEnded) { drawChart(); updateTable(); }
    }
    const leader = trainer.leader();
    drawWorld(trainer.track, trainer.cars, leader);
    drawNet(leader.genome, leader.net);
    stats();
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

// ---- 일반화 테스트 (sim-to-real 맛보기) ---------------------------------------------
function startTest() {
  const g = trainer.pop.best || trainer.leader().genome;
  const track = makeTrack('random');
  test = { track, car: new Car(track, g), max: maxStepsFor(track, trainer.opts) };
  mode = 'test';
  $('testBar').hidden = false;
  $('modeLabel').textContent = t({ ko: '일반화 테스트: 학습 때 본 적 없는 트랙', en: 'Generalisation test: a track never seen in training' });
}
function batchTest() {
  const g = trainer.pop.best;
  if (!g) { $('batchResult').textContent = t({ ko: '먼저 한 세대 이상 학습하세요.', en: 'Train at least one generation first.' }); return; }
  let ok = 0; const N = 20;
  for (let i = 0; i < N; i++) if (testRun(g, makeTrack('random'), trainer.opts).finished) ok++;
  $('batchResult').innerHTML = t({ ko: `처음 보는 트랙 ${N}개 중 <b>${ok}개</b> 완주 (${(100 * ok / N).toFixed(0)}%)`, en: `Completed <b>${ok}</b> of ${N} unseen tracks (${(100 * ok / N).toFixed(0)}%)` });
}
function endTest() { mode = 'train'; test = null; $('testBar').hidden = true; $('modeLabel').textContent = ''; }

// ---- 조작부 ----------------------------------------------------------------------
function restart() {
  trainer = new Trainer(Population, {
    trackType: $('trackType').value, popSize: +$('popSize').value,
    randomize: $('randomize').checked, noise: $('noise').checked ? 0.05 : 0
  });
  endTest(); drawChart(); updateTable(); $('batchResult').textContent = '';
}

const TRACKS = [['blob', { ko: '둥근 트랙', en: 'Round track' }], ['mm', { ko: 'M-M 트랙 (어려움)', en: 'M-M track (hard)' }],
                ['random', { ko: '무작위', en: 'Random' }]];
function fillTrackSelect() {
  const sel = $('trackType'), v = sel.value || 'blob';
  sel.innerHTML = TRACKS.map(([k, l]) => `<option value="${k}">${t(l)}</option>`).join('');
  sel.value = v;
  $('popSize').querySelectorAll('option').forEach(o => o.textContent = t({ ko: `${o.value}대`, en: `${o.value} cars` }));
}

function bind() {
  fillTrackSelect();
  $('playBtn').addEventListener('click', () => { running = !running; label(); });
  $('speedBtn').addEventListener('click', () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; label(); });
  $('resetBtn').addEventListener('click', restart);
  $('trackType').addEventListener('change', () => { trainer.opts.trackType = $('trackType').value; trainer.newTrack(); });
  $('newTrackBtn').addEventListener('click', () => trainer.newTrack());
  $('popSize').addEventListener('change', restart);
  $('randomize').addEventListener('change', () => trainer.setRandomize($('randomize').checked));
  $('noise').addEventListener('change', () => { trainer.opts.noise = $('noise').checked ? 0.05 : 0; });
  $('testBtn').addEventListener('click', startTest);
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
  document.addEventListener('langchange', () => { fillTrackSelect(); label(); drawChart(); updateTable(); });
  window.addEventListener('resize', () => drawChart());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawChart());
  $('themeBtn')?.addEventListener('click', () => setTimeout(drawChart, 0));
}
function label() {
  $('playBtn').innerHTML = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 학습 시작', en: '▶ Train' });
  $('speedBtn').textContent = t({ ko: '속도 ', en: 'Speed ' }) + (speed === 'max' ? t({ ko: '최대', en: 'max' }) : speed + '×');
}

function main() {
  bind(); restart(); label();
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
