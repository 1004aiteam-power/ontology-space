// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 별과 행성의 탄생 페이지: 원반 화면 · 조절 슬라이더 · 통계 · 반장축–질량 그림 · 사건 기록
import { Nbody, DEFAULTS, M_EARTH, M_JUPITER } from './nbody.js?v=3ecf9bbd';
import { $, t, css, fit } from '../lib/dom.js?v=3b73d59c';

const SPEEDS = [[0.5, 6], [1, 12], [2, 24], [4, 48]];            // [배속, 한 프레임에 몇 단계(1단계 = 0.01년)]
const FRAME_BUDGET = 13;                                         // 한 프레임에 계산에 쓸 수 있는 시간 (ms). 넘으면 그 프레임은 거기서 멈춤
const PRESETS = {
  solar: { o: {}, label: { ko: '태양계 비슷하게', en: 'Solar-system-like' } },
  binary: { o: { stars: 2 }, label: { ko: '쌍성 형성', en: 'Binary stars' } },
  star: { o: { spin: 0.3 }, label: { ko: '행성 없이 별만', en: 'A star, no planets' } },
  hot: { o: { frost: 0.8, gasFrac: 0.05 }, label: { ko: '얼음선이 가까운 별', en: 'Frost line close in' } },
  big: { o: { mass: 2.5 }, label: { ko: '무거운 별', en: 'A heavy star' } },
  sticky: { o: { stick: 3, tDisp: 600 }, label: { ko: '잘 뭉치고 가스가 오래 남음', en: 'Sticky, long-lived gas' } }
};
const CLASSES = {
  star: { ko: '별', en: 'Star', c: '#ffd966' },
  protostar: { ko: '원시별', en: 'Protostar', c: '#e8663d' },
  gas: { ko: '가스 거인', en: 'Gas giant', c: '#e0a96d' },
  ice: { ko: '얼음 행성', en: 'Ice planet', c: '#5bc0de' },
  rock: { ko: '암석 행성', en: 'Rocky planet', c: '#c08a5b' },
  dust: { ko: '알갱이', en: 'Grain', c: '#9aa3ad' }
};
const SLIDERS = [                                                // [id, 단위, 소수 자릿수, 옵션 키, 값 → 옵션 변환]
  ['nbM', ' M☉', 1, 'mass', v => v], ['nbN', '', 0, 'N', v => v], ['nbR', ' AU', 0, 'rOut', v => v], ['nbF', ' AU', 1, 'frost', v => v],
  ['nbS', '', 2, 'spin', v => v], ['nbK', '×', 1, 'stick', v => v], ['nbD', '×', 1, 'drag', v => v], ['nbG', ' yr', 0, 'tDisp', v => v],
  ['nbI', ' yr', 0, 'tInfall', v => v], ['nbGf', ' %', 1, 'gasFrac', v => v / 100], ['nbZ', ' %', 2, 'metal', v => v / 100]
];
const MSG = {
  ignite: (e) => t({ ko: `별이 켜졌습니다 (질량 ${e.mass.toFixed(2)} M☉) — 수소 핵융합 시작`, en: `A star lit up (${e.mass.toFixed(2)} M☉): hydrogen fusion begins` }),
  giant: (e) => t({ ko: `첫 가스 거인이 생겼습니다 (${(e.mass / M_EARTH).toFixed(0)} 지구 질량, 별에서 ${e.a.toFixed(1)} AU)`, en: `The first gas giant formed (${(e.mass / M_EARTH).toFixed(0)} Earth masses, ${e.a.toFixed(1)} AU out)` }),
  'binary-merge': (e) => t({ ko: `두 별이 하나로 합쳐졌습니다 (${e.mass.toFixed(2)} M☉)`, en: `Two stars merged into one (${e.mass.toFixed(2)} M☉)` })
};

let sim, running = false, speedIdx = 1, seed = 1, frames = 0, trails = new Map(), seenEvents = 0;
const num = (id) => +$(id).value;
const flag = (id) => $(id).checked;
const fmtMass = (m) => (m >= 0.5 * M_JUPITER ? `${(m / M_JUPITER).toFixed(2)} M♃` : `${(m / M_EARTH).toFixed(m < 10 * M_EARTH ? 1 : 0)} M⊕`);

function options() {
  const o = { seed, stars: +$('nbStars').value };
  for (const [id, , , key, f] of SLIDERS) o[key] = f(num(id));
  return o;
}
function build(keepRunning = running) {
  sim = new Nbody(options());
  trails = new Map(); seenEvents = 0; frames = 0;
  running = keepRunning;
  $('nbLog').innerHTML = '';
  labels(); draw(); stats(); orbits();
}

// ---- 원반 화면 ---------------------------------------------------------------------------
function view() {
  const { ctx, cw, ch } = fit($('nbView'), 0.62);
  const half = sim.o.rOut * 1.15 / num('nbZoom'), S = Math.min(cw, ch) / 2 / half;       // 한 AU 가 몇 픽셀
  // 보는 중심: 별들의 질량 중심 (원점)
  return { ctx, cw, ch, S, X: (x) => cw / 2 + x * S, Y: (y) => ch / 2 - y * S };
}
function bodyRadius(i) {
  const k = sim.classify(i), m = sim.m[i];
  if (k === 'star' || k === 'protostar') return 5 + 5 * Math.sqrt(sim.starVisible(i));
  return 1.3 + 1.5 * Math.log10(1 + m / M_EARTH);
}
function draw() {
  const { ctx, cw, ch, S, X, Y } = view();
  ctx.fillStyle = '#080b17'; ctx.fillRect(0, 0, cw, ch);
  ctx.font = '11px system-ui, sans-serif';
  const cx = X(0), cy = Y(0);
  // 가스 · 구름의 옅은 안개: 아직 별이 되지 못한 구름 + 원반에 남은 가스
  if (flag('nbGas')) {
    const cloud = sim.cloudLeft() / (sim.o.mass * 0.99), gas = sim.gasFrac(), a = Math.min(0.5, 0.42 * cloud + 0.16 * gas), R = sim.o.rOut * S * 1.1;
    if (a > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, `rgba(150,130,255,${a})`); g.addColorStop(0.55, `rgba(90,110,220,${a * 0.45})`); g.addColorStop(1, 'rgba(60,80,200,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
    }
  }
  // 거리 고리
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  for (const au of [1, 5, 10, 20, 40, 80]) {
    if (au * S < 14 || au * S > Math.max(cw, ch)) continue;
    ctx.beginPath(); ctx.arc(cx, cy, au * S, 0, 7); ctx.stroke();
    if (cx + au * S + 28 < cw) ctx.fillText(`${au} AU`, cx + au * S + 3, cy - 2);
  }
  // 얼음선
  if (flag('nbFrostLine')) {
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(110,210,255,0.75)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, sim.o.frost * S, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(130,215,255,0.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    if (sim.o.frost * S > 12) ctx.fillText(t({ ko: `얼음선 ${sim.o.frost.toFixed(1)} AU`, en: `frost line ${sim.o.frost.toFixed(1)} AU` }), cx, cy - sim.o.frost * S - 3);
  }
  // 궤적
  if (flag('nbTrail')) {
    ctx.lineWidth = 1;
    for (const [, tr] of trails) {
      if (tr.pts.length < 2) continue;
      ctx.strokeStyle = tr.color + '55'; ctx.beginPath();
      tr.pts.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
    }
  }
  // 천체: 작은 것 먼저, 별은 마지막에
  const order = [];
  for (let i = 0; i < sim.n; i++) order.push(i);
  order.sort((a, b) => sim.m[a] - sim.m[b]);
  for (const i of order) {
    const k = sim.classify(i), px = X(sim.x[i]), py = Y(sim.y[i]);
    if (px < -10 || px > cw + 10 || py < -10 || py > ch + 10) continue;
    const r = bodyRadius(i);
    if (k === 'star' || k === 'protostar') {
      const mv = sim.starVisible(i), col = k === 'protostar' ? '232,102,61' : mv > 1.6 ? '190,215,255' : mv > 0.7 ? '255,226,140' : '255,170,110';
      const g = ctx.createRadialGradient(px, py, 0, px, py, r * 3.2);
      g.addColorStop(0, `rgba(${col},${k === 'star' ? 0.95 : 0.55})`); g.addColorStop(0.35, `rgba(${col},${k === 'star' ? 0.35 : 0.15})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r * 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
      continue;
    }
    ctx.fillStyle = CLASSES[k].c; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    if (k === 'gas' && r > 3.5) { ctx.strokeStyle = 'rgba(120,70,30,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px - r * 0.8, py - r * 0.25); ctx.lineTo(px + r * 0.8, py - r * 0.25); ctx.moveTo(px - r * 0.85, py + r * 0.3); ctx.lineTo(px + r * 0.85, py + r * 0.3); ctx.stroke(); }
    if (flag('nbLabels') && r > 5) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fmtMass(sim.m[i]), px + r + 3, py); }
  }
  // 시간 · 눈금 표시
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`t = ${sim.t < 100 ? sim.t.toFixed(1) : Math.round(sim.t)} ${t({ ko: '년', en: 'yr' })}`, 10, 8);
}

function sampleTrails() {
  const keep = new Set();
  for (let i = 0; i < sim.n; i++) {
    const k = sim.classify(i);
    if (k !== 'star' && k !== 'protostar' && sim.m[i] < 25 * M_EARTH) continue;           // 무거운 천체만 (안 그러면 꼬리로 빽빽해짐)
    const id = sim.id[i]; keep.add(id);
    let tr = trails.get(id);
    if (!tr) { tr = { pts: [], color: CLASSES[k].c }; trails.set(id, tr); }
    tr.color = CLASSES[k].c; tr.pts.push([sim.x[i], sim.y[i]]);
    if (tr.pts.length > 70) tr.pts.shift();
  }
  for (const id of [...trails.keys()]) if (!keep.has(id)) trails.delete(id);
}

// ---- 반장축 – 질량 그림 -------------------------------------------------------------------
function orbits() {
  const { ctx, cw, ch } = fit($('nbOrbits'), 0.46), padL = 46, padR = 12, padT = 10, padB = 30;
  const lo = Math.log10(0.3), hi = Math.log10(Math.max(100, sim.o.rOut * 3)), mLo = Math.log10(0.3), mHi = Math.log10(1500);
  const X = (a) => padL + (cw - padL - padR) * (Math.log10(a) - lo) / (hi - lo), Y = (m) => ch - padB - (ch - padB - padT) * (Math.log10(m) - mLo) / (mHi - mLo);
  ctx.clearRect(0, 0, cw, ch);
  ctx.font = '11px system-ui, sans-serif'; ctx.strokeStyle = css('--line'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const [m, lab] of [[1, '1'], [10, '10'], [100, '100'], [1000, '1000']]) { ctx.beginPath(); ctx.moveTo(padL, Y(m)); ctx.lineTo(cw - padR, Y(m)); ctx.stroke(); ctx.fillText(lab, padL - 6, Y(m)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const a of [0.5, 1, 2, 5, 10, 20, 50, 100]) { if (Math.log10(a) > hi) continue; ctx.beginPath(); ctx.moveTo(X(a), padT); ctx.lineTo(X(a), ch - padB); ctx.stroke(); ctx.fillText(String(a), X(a), ch - padB + 4); }
  ctx.fillText(t({ ko: '별에서의 거리 (AU, 로그)', en: 'distance from the star (AU, log)' }), (padL + cw - padR) / 2, ch - 14);
  ctx.save(); ctx.translate(11, (padT + ch - padB) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(t({ ko: '질량 (지구 = 1, 로그)', en: 'mass (Earth = 1, log)' }), 0, 0); ctx.restore();
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#4fb3d9'; ctx.beginPath(); ctx.moveTo(X(sim.o.frost), padT); ctx.lineTo(X(sim.o.frost), ch - padB); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#4fb3d9'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(t({ ko: '얼음선', en: 'frost line' }), X(sim.o.frost) + 4, padT + 2);
  for (let i = 0; i < sim.n; i++) {
    const k = sim.classify(i);
    if (k === 'star' || k === 'protostar') continue;
    const o = sim.orbit(i); if (o.a === null || o.a < 0.3 || o.a > Math.pow(10, hi)) continue;
    const me = sim.m[i] / M_EARTH; if (me < 0.3) continue;
    ctx.fillStyle = CLASSES[k].c + 'cc'; ctx.beginPath(); ctx.arc(X(o.a), Y(Math.min(1500, me)), k === 'dust' ? 2 : 3.2, 0, 7); ctx.fill();
  }
}

// ---- 숫자 · 기록 ------------------------------------------------------------------------
function labels() {
  $('playBtn').textContent = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : sim.t > 0 ? t({ ko: '▶ 계속', en: '▶ Resume' }) : t({ ko: '▶ 구름 풀어놓기', en: '▶ Release the cloud' });
  $('speedBtn').textContent = t({ ko: '배속', en: 'Speed' }) + ` ${SPEEDS[speedIdx][0]}×`;
  $('seedBtn').textContent = t({ ko: '🎲 다른 구름', en: '🎲 Another cloud' }) + ` #${seed}`;
  for (const [id, unit, d] of SLIDERS) $(id + 'Out').textContent = (+$(id).value).toFixed(d) + unit;
  $('nbZoomOut').textContent = (+$('nbZoom').value).toFixed(1) + '×';
  const cur = Object.entries(PRESETS).find(([, p]) => matches(p.o))?.[0] || '';
  $('nbPresets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}" aria-pressed="${k === cur}">${t(p.label)}</button>`).join('');
  $('nbLegend').innerHTML = ['protostar', 'star', 'dust', 'rock', 'ice', 'gas'].map(k => `<span><i class="dot" style="background:${CLASSES[k].c}"></i>${t(CLASSES[k])}</span>`).join('');
}
function matches(po) {
  const o = options(), want = { ...DEFAULTS, ...po };
  return ['mass', 'N', 'rOut', 'frost', 'spin', 'stick', 'drag', 'tDisp', 'tInfall', 'gasFrac', 'metal', 'stars'].every(k => Math.abs(o[k] - want[k]) < 1e-9);
}
function stats() {
  const s = sim.stats(), c = s.counts, big = s.biggestIdx >= 0 ? fmtMass(sim.m[s.biggestIdx]) : '–';
  const state = c.star + c.protostar === 0 ? '–' : c.star > 0 ? t({ ko: `켜짐 (${c.star}개)`, en: `lit (${c.star})` }) : t({ ko: '아직 원시별', en: 'still a protostar' });
  const cell = (k, v, sub = '') => `<div><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  $('nbStats').innerHTML =
    cell(t({ ko: '별이 모은 질량', en: 'Mass the star(s) gathered' }), `${s.starMass.toFixed(2)} M☉`, state) +
    cell(t({ ko: '행성', en: 'Planets' }), String(s.planets), t({ ko: `암석 ${c.rock} · 얼음 ${c.ice} · 가스 ${c.gas}`, en: `rock ${c.rock} · ice ${c.ice} · gas ${c.gas}` })) +
    cell(t({ ko: '아직 알갱이', en: 'Grains left' }), String(c.dust), t({ ko: `남은 천체 ${s.n - c.star - c.protostar}개 중`, en: `of ${s.n - c.star - c.protostar} bodies` })) +
    cell(t({ ko: '가장 큰 행성', en: 'Biggest planet' }), big) +
    cell(t({ ko: '원반 가스', en: 'Disk gas left' }), `${Math.round(s.gasLeft * 100)} %`) +
    cell(t({ ko: '별이 삼킴 · 쫓겨남', en: 'Swallowed · ejected' }), `${s.swallowed} · ${s.ejected}`, t({ ko: `합쳐짐 ${s.merges}회`, en: `${s.merges} mergers` }));
}
function showLog() {
  const box = $('nbLog');
  for (; seenEvents < sim.events.length; seenEvents++) {
    const e = sim.events[seenEvents], f = MSG[e.type]; if (!f) continue;
    const li = document.createElement('li'); li.dataset.e = JSON.stringify(e); li.dataset.type = e.type;
    li.textContent = `${e.t.toFixed(0)} ${t({ ko: '년', en: 'yr' })}: ${f(e)}`; box.appendChild(li);
  }
}
function relog() { for (const li of $('nbLog').children) { const e = JSON.parse(li.dataset.e); li.textContent = `${e.t.toFixed(0)} ${t({ ko: '년', en: 'yr' })}: ${MSG[e.type](e)}`; } }

// ---- 반복 ------------------------------------------------------------------------------
function frame() {
  if (running) {
    const t0 = performance.now(), n = SPEEDS[speedIdx][1];
    for (let i = 0; i < n; i++) { sim.step(1); if (performance.now() - t0 > FRAME_BUDGET) break; }
    if (++frames % 4 === 0) sampleTrails();
    showLog();
    if (frames % 5 === 0) { stats(); orbits(); }
  }
  draw();
  requestAnimationFrame(frame);
}

function main() {
  if (!$('nbView')) return;
  build(false);
  $('playBtn').addEventListener('click', () => { running = !running; labels(); });
  $('resetBtn').addEventListener('click', () => build(false));
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; labels(); });
  $('seedBtn').addEventListener('click', () => { seed = seed % 99 + 1; build(true); });
  for (const [id] of SLIDERS) $(id).addEventListener('input', () => build(false));         // 설정을 바꾸면 처음 구름에서 다시
  $('nbStars').addEventListener('change', () => build(false));
  $('nbZoom').addEventListener('input', () => { labels(); draw(); });
  $('nbPresets').addEventListener('click', e => {
    const b = e.target.closest('button[data-preset]'); if (!b) return;
    const o = { ...DEFAULTS, ...PRESETS[b.dataset.preset].o };
    for (const [id, , , key, f] of SLIDERS) { const inv = key === 'gasFrac' || key === 'metal' ? o[key] * 100 : o[key]; $(id).value = inv; }
    $('nbStars').value = o.stars;
    build(true);
  });
  for (const id of ['nbTrail', 'nbGas', 'nbFrostLine', 'nbLabels']) $(id).addEventListener('change', draw);
  document.addEventListener('langchange', () => { labels(); stats(); orbits(); relog(); draw(); });
  addEventListener('resize', () => { orbits(); draw(); });
  $('themeBtn')?.addEventListener('click', () => setTimeout(orbits, 0));
  requestAnimationFrame(frame);
}
main();
