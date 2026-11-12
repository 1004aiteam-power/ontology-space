// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 입자 생명 페이지: 입자 화면 · 규칙 표 · 통계. 세계는 두 가지
//   고정 규칙 세계 (plife.js)      사람이 정한 표 하나로 움직임. 표를 눌러 고친다
//   살아 있는 세계 (plife-evo.js)  에너지 · 번식 · 죽음 · 유전. 표는 살아 있는 입자들의 유전자 평균이고 스스로 바뀐다
import { ParticleLife, WORLD, MAX_TYPES } from './plife.js?v=d3a2454c';
import { LivingWorld } from './plife-evo.js?v=3c166334';
import { $, t, css, fit } from '../lib/dom.js?v=3b73d59c';

// 종류 색: 어두운 바탕에서 서로 구분되는 여섯 색. 색만으로 구분하지 않도록 가 · 나 · 다 … 이름을 함께 적는다
const COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da'];
const NAMES = { ko: ['가', '나', '다', '라', '마', '바'], en: ['A', 'B', 'C', 'D', 'E', 'F'] };
const PRESET_LABEL = {
  random: { ko: '무작위 규칙', en: 'Random rules' },
  clusters: { ko: '끼리끼리 (같은 종류끼리 끌림)', en: 'Like attracts like' },
  pinwheels: { ko: '바람개비 (다음 종류를 따라감)', en: 'Pinwheels (each follows the next type)' },
  chase: { ko: '쫓고 쫓기기 (비대칭)', en: 'Chase and flee (asymmetric)' },
  none: { ko: '규칙 없음 (모두 0)', en: 'No rules (all zero)' }
};
const SPEEDS = { fixed: [1, 2, 4], living: [1, 4, 16] };
const POS = [42, 120, 214], NEG = [217, 89, 38];          // 끌림 = 파랑, 밀침 = 주황 (신경망 그림과 같은 뜻)
const TRAIT = [['chase', '#2a78d6', { ko: '먹이 색에게', en: 'towards prey' }], ['flee', '#d95926', { ko: '포식자 색에게', en: 'towards predator' }], ['self', '#8a8f98', { ko: '같은 색에게', en: 'towards own colour' }]];

let sim, living = false, running = false, speedIdx = 0, seed = 1, frameNo = 0;
const lang = () => (window.currentLang?.() === 'en' ? 'en' : 'ko');
const num = (id) => +$(id).value;

// ---- 입자 화면 ------------------------------------------------------------------------
function draw() {
  const { ctx, cw, ch } = fit($('plView'), WORLD.h / WORLD.w), k = cw / WORLD.w, r = Math.max(1.2, 0.9 * k);
  ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, cw, ch);
  // 살아 있는 세계: 에너지가 적은 입자(배고픔)는 옅게, 많은 입자(곧 나뉨)는 진하게 — 두 묶음으로 나눠 그린다
  const passes = living ? [[0.45, (i) => sim.e[i] < sim.opts.birth / 2], [1, (i) => sim.e[i] >= sim.opts.birth / 2]] : [[1, () => true]];
  for (const [alpha, pick] of passes) {
    ctx.globalAlpha = alpha;
    for (let c = 0; c < sim.opts.types; c++) {               // 색별로 한 번에 그려 빠르게
      ctx.fillStyle = COLORS[c]; ctx.beginPath();
      for (let i = 0; i < sim.n; i++) if (sim.type[i] === c && pick(i)) { const x = sim.x[i] * k, y = sim.y[i] * k; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ---- 규칙 표 --------------------------------------------------------------------------
const cellColor = (v) => { const c = v > 0 ? POS : NEG, a = 0.25 + 0.75 * Math.min(1, Math.abs(v)); return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(2)})`; };
const show = (v) => (Math.abs(v) < 0.005 ? '0' : (v > 0 ? '+' : '') + v.toFixed(2).replace(/\.?0+$/, ''));
function rules() {
  const k = sim.opts.types, nm = NAMES[lang()], m = living ? sim.meanMatrix() : sim.matrix, focus = document.activeElement?.dataset;
  // 살아 있는 세계에서는 표가 계속 바뀐다: 칸을 새로 만들지 않고 값만 고쳐야 누르는 도중에 단추가 사라지지 않는다
  const cells = $('plRules').querySelectorAll('button[data-i]');
  if (cells.length === k * k && $('plRules').dataset.mode === (living ? 'living' : 'fixed') && $('plRules').dataset.lang === lang()) {
    for (const b of cells) {
      const v = m[+b.dataset.i][+b.dataset.j], zero = Math.abs(v) < 0.005;
      const label = t({ ko: `${nm[+b.dataset.i]}가 ${nm[+b.dataset.j]}에게 느끼는 힘 ${v.toFixed(2)}`, en: `force ${nm[+b.dataset.i]} feels towards ${nm[+b.dataset.j]}: ${v.toFixed(2)}` });
      b.textContent = show(v); b.className = zero ? 'zero' : ''; b.style.background = zero ? '' : cellColor(v); b.title = label; b.setAttribute('aria-label', label);
    }
    return;
  }
  $('plRules').dataset.mode = living ? 'living' : 'fixed'; $('plRules').dataset.lang = lang();
  const dot = (i) => `<i style="background:${COLORS[i]}"></i>`;
  let h = `<tr><th></th>${Array.from({ length: k }, (_, j) => `<th scope="col" title="${nm[j]}">${dot(j)}</th>`).join('')}</tr>`;
  for (let i = 0; i < k; i++) {
    h += `<tr><th scope="row" title="${nm[i]}">${dot(i)}</th>`;
    for (let j = 0; j < k; j++) {
      const v = m[i][j], zero = Math.abs(v) < 0.005;
      const label = t({ ko: `${nm[i]}가 ${nm[j]}에게 느끼는 힘 ${v.toFixed(2)}`, en: `force ${nm[i]} feels towards ${nm[j]}: ${v.toFixed(2)}` });
      // 살아 있는 세계: 먹이 칸(가 → 나)과 포식자 칸에 표시
      const mark = !living || k < 3 ? '' : j === sim.prey(i) ? ' data-rel="prey"' : j === sim.predator(i) ? ' data-rel="pred"' : '';
      h += `<td><button type="button" data-i="${i}" data-j="${j}"${mark} class="${zero ? 'zero' : ''}" style="${zero ? '' : `background:${cellColor(v)}`}" aria-label="${label}" title="${label}">${show(v)}</button></td>`;
    }
    h += '</tr>';
  }
  $('plRules').innerHTML = h;
  if (focus?.i != null) $('plRules').querySelector(`button[data-i="${focus.i}"][data-j="${focus.j}"]`)?.focus();
}
// 칸을 누르면 0.25 씩 올라가고(+1 다음은 −1), Shift 를 누른 채 누르거나 오른쪽 단추로 누르면 내려간다. 화살표 키로도 조절
// 살아 있는 세계에서는 그 색 입자 모두의 유전자에 0.25 를 더하거나 뺀다 (사람이 끼어들기. 그 뒤는 다시 진화에 맡김)
function bump(btn, dir) {
  const i = +btn.dataset.i, j = +btn.dataset.j;
  if (living) sim.nudge(i, j, dir * 0.25);
  else {
    let v = Math.round((sim.matrix[i][j] + dir * 0.25) * 4) / 4;
    if (v > 1) v = -1; if (v < -1) v = 1;
    sim.matrix[i][j] = v;
    $('plPreset').value = '';
  }
  rules();
  $('plRules').querySelector(`button[data-i="${i}"][data-j="${j}"]`)?.focus();
}

// ---- 통계 -----------------------------------------------------------------------------
function stats() {
  let items;
  if (living) {
    const c = sim.counts(), tr = sim.traits(), nm = NAMES[lang()];
    items = [
      [t({ ko: '틱', en: 'Tick' }), sim.tick.toLocaleString(), t({ ko: `입자 ${sim.n}개`, en: `${sim.n} particles` })],
      [t({ ko: '색별 개체수', en: 'By colour' }), c.map((v, i) => `<i style="background:${COLORS[i]}"></i>${v}`).join(' '), nm.slice(0, c.length).join(' · ')],
      [t({ ko: '태어남 · 죽음', en: 'Births · deaths' }), `${sim.births.toLocaleString()} · ${sim.deaths.toLocaleString()}`, sim.arrivals ? t({ ko: `바깥에서 들어옴 ${sim.arrivals}`, en: `${sim.arrivals} arrived from outside` }) : t({ ko: '사라진 색 없음', en: 'no colour lost' })],
      [t({ ko: '평균 세대', en: 'Mean generation' }), tr.generation.toFixed(1), t({ ko: `평균 에너지 ${tr.energy.toFixed(1)}`, en: `mean energy ${tr.energy.toFixed(1)}` })]
    ];
  } else {
    const s = sim.last || { speed: 0, neighbours: sim.uniformNeighbours(), sameShare: 1 / sim.opts.types }, u = sim.uniformNeighbours();
    items = [
      [t({ ko: '틱', en: 'Tick' }), sim.tick.toLocaleString(), t({ ko: `입자 ${sim.n}개 · ${sim.opts.types}종류`, en: `${sim.n} particles · ${sim.opts.types} types` })],
      [t({ ko: '평균 속력', en: 'Mean speed' }), s.speed.toFixed(1), t({ ko: '0에 가까우면 멈춘 모양', en: 'near 0 = a frozen pattern' })],
      [t({ ko: '평균 이웃 수', en: 'Mean neighbours' }), s.neighbours.toFixed(1), t({ ko: `고르게 퍼지면 ${u.toFixed(1)}`, en: `${u.toFixed(1)} if spread evenly` })],
      [t({ ko: '같은 종류 이웃', en: 'Same-type neighbours' }), Math.round(s.sameShare * 100) + '%', t({ ko: `섞여 있으면 ${Math.round(100 / sim.opts.types)}%`, en: `${Math.round(100 / sim.opts.types)}% if mixed` })]
    ];
  }
  $('plStats').innerHTML = items.map(([a, b, c]) => `<div><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('');
}

// ---- 살아 있는 세계의 그래프: 색별 개체수, 유전자 평균 ---------------------------------------------
function lineChart(canvas, series, lo, hi, zeroLine) {
  const { ctx, cw, ch } = fit(canvas), padL = 34, padR = 8, padT = 8, padB = 18, H = sim.history, n = H.length;
  ctx.clearRect(0, 0, cw, ch);
  const X = (i) => padL + (cw - padL - padR) * (n > 1 ? i / (n - 1) : 0), Y = (v) => padT + (ch - padT - padB) * (1 - (v - lo) / (hi - lo));
  ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  for (const v of zeroLine ? [lo, 0, hi] : [lo, (lo + hi) / 2, hi]) {
    ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(cw - padR, Y(v)); ctx.stroke();
    ctx.fillText(zeroLine ? (v > 0 ? '+' : '') + v : Math.round(v), padL - 5, Y(v));
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  if (n) { ctx.fillText(t({ ko: '틱 ', en: 'tick ' }) + H[0].tick.toLocaleString(), padL, ch - 4); ctx.textAlign = 'right'; ctx.fillText(H[n - 1].tick.toLocaleString(), cw - padR, ch - 4); }
  for (const [color, get] of series) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    H.forEach((h, i) => { const y = Y(Math.max(lo, Math.min(hi, get(h)))); if (i) ctx.lineTo(X(i), y); else ctx.moveTo(X(i), y); });
    ctx.stroke();
  }
}
function charts() {
  if (!living) return;
  const k = sim.opts.types, top = Math.max(100, ...sim.history.flatMap(h => h.counts));
  lineChart($('plPop'), Array.from({ length: k }, (_, c) => [COLORS[c], (h) => h.counts[c] ?? 0]), 0, Math.ceil(top / 100) * 100, false);
  lineChart($('plGene'), TRAIT.map(([key, color]) => [color, (h) => h[key]]), -1, 1, true);
}

// ---- 글자 · 보이기 -----------------------------------------------------------------------
function labels() {
  const sp = SPEEDS[living ? 'living' : 'fixed'];
  $('playBtn').textContent = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 시작', en: '▶ Start' });
  $('speedBtn').textContent = t({ ko: '배속', en: 'Speed' }) + ` ${sp[speedIdx % sp.length]}×`;
  const cur = $('plPreset').value;
  $('plPreset').innerHTML = `<option value="">${t({ ko: '직접 고친 규칙', en: 'Hand-edited rules' })}</option>` +
    Object.entries(PRESET_LABEL).map(([k, v]) => `<option value="${k}">${t(v)}</option>`).join('');
  $('plPreset').value = cur;
  const g = $('plGenes').value;
  $('plGenes').innerHTML = `<option value="blank">${t({ ko: '처음 유전자: 모두 0 (규칙 없이 시작)', en: 'Starting genes: all zero (no rules)' })}</option><option value="random">${t({ ko: '처음 유전자: 무작위', en: 'Starting genes: random' })}</option>`;
  $('plGenes').value = g || 'blank';
  $('plSeed').textContent = living ? t({ ko: `세계 번호 ${seed}`, en: `world no. ${seed}` })
    : sim.opts.preset === 'random' && $('plPreset').value === 'random' ? t({ ko: `규칙 번호 ${seed}`, en: `rule set no. ${seed}` }) : '';
  for (const [id, fmt] of [['plN', v => v], ['plTypes', v => v], ['plRadius', v => v], ['plStrength', v => v], ['plSlip', v => (+v).toFixed(2)], ['plMut', v => (+v).toFixed(2)], ['plSun', v => (+v).toFixed(2)]]) $(id + 'Out').textContent = fmt($(id).value);
  $('plRulesTitle').textContent = living ? t({ ko: '규칙 표 = 유전자 평균 (스스로 바뀜)', en: 'Rule table = mean genes (changes by itself)' }) : t({ ko: '규칙 표 (눌러서 고치기)', en: 'Rule table (click to edit)' });
  // 먹이사슬: 가 → 나 → 다 → 가
  const k = sim.opts.types, nm = NAMES[lang()];
  $('plChain').innerHTML = Array.from({ length: k + 1 }, (_, i) => `<i style="background:${COLORS[i % k]}"></i>${nm[i % k]}`).join(' → ') + ' <span class="muted">' + t({ ko: '(화살표 = 먹는다)', en: '(arrow = eats)' }) + '</span>';
  $('plTraitKey').innerHTML = TRAIT.map(([, color, name]) => `<span><i style="background:${color}"></i>${t(name)}</span>`).join('');
  document.querySelectorAll('[data-world]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.world === 'living') === living)));
  document.querySelectorAll('[data-only]').forEach(el => { el.hidden = (el.dataset.only === 'living') !== living; });
}

function frame() {
  if (running) { const sp = SPEEDS[living ? 'living' : 'fixed']; for (let i = 0; i < sp[speedIdx % sp.length]; i++) sim.step(); }
  draw();
  frameNo++;
  if ((running && frameNo % 6 === 0) || !frame.drawn) { stats(); if (living) { rules(); charts(); } frame.drawn = true; }
  requestAnimationFrame(frame);
}

// 세계 만들기: 지금 슬라이더 값으로
function build() {
  const common = { n: num('plN'), types: num('plTypes'), radius: num('plRadius'), strength: num('plStrength'), halfLife: num('plSlip'), seed };
  sim = living ? new LivingWorld({ ...common, n: Math.min(common.n, 1200), mutation: num('plMut'), sun: num('plSun'), genes: $('plGenes').value || 'blank' })
    : new ParticleLife({ ...common, preset: $('plPreset').value || 'random' });
  rules(); labels(); frame.drawn = false;
}

function applyPreset(name) {
  sim.setPreset(name, seed); sim.scatter();
  $('plPreset').value = name;
  rules(); labels(); frame.drawn = false;
}

function main() {
  if (!$('plView')) return;
  $('plTypes').max = MAX_TYPES;
  sim = new ParticleLife({ n: num('plN'), types: num('plTypes'), radius: num('plRadius'), strength: num('plStrength'), halfLife: num('plSlip'), seed, preset: 'random' });
  labels(); $('plPreset').value = 'random'; labels(); rules();
  $('playBtn').addEventListener('click', () => { running = !running; labels(); });
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % 3; labels(); });
  document.querySelectorAll('[data-world]').forEach(b => b.addEventListener('click', () => {            // 세계 바꾸기
    const to = b.dataset.world === 'living';
    if (to === living) return;
    living = to; speedIdx = 0;
    if (living && num('plTypes') > 4) $('plTypes').value = 3;                                             // 살아 있는 세계는 세 색으로 시작 (먹이사슬이 잘 보임)
    if (!living && !$('plPreset').value) $('plPreset').value = 'random';
    build();
  }));
  $('plPreset').addEventListener('change', e => { if (e.target.value) applyPreset(e.target.value); });
  $('plNew').addEventListener('click', () => { seed++; applyPreset('random'); });                       // 새 무작위 규칙
  // 표 전체를 한꺼번에: 새 무작위 값으로 (입자는 지금 자리에서 그대로 이어감), 또는 모두 0 으로
  $('plRefresh').addEventListener('click', () => { seed++; sim.setPreset('random', seed); $('plPreset').value = 'random'; rules(); labels(); });
  $('plZero').addEventListener('click', () => { sim.setPreset('none', seed); $('plPreset').value = 'none'; rules(); labels(); });
  $('plScatter').addEventListener('click', () => { sim.scatter(); frame.drawn = false; });              // 같은 규칙, 입자만 다시
  $('plRestart').addEventListener('click', () => { build(); });                                         // 살아 있는 세계: 같은 번호로 처음부터
  $('plNewWorld').addEventListener('click', () => { seed++; build(); });                                //                 다른 번호로
  $('plGenes').addEventListener('change', () => build());
  $('plN').addEventListener('input', e => { if (living) build(); else { sim.setCount(+e.target.value); labels(); frame.drawn = false; } });
  $('plTypes').addEventListener('input', e => {
    if (living) return build();
    sim.setTypes(+e.target.value); if ($('plPreset').value) sim.setPreset($('plPreset').value, seed); rules(); labels(); frame.drawn = false;
  });
  $('plRadius').addEventListener('input', e => { sim.opts.radius = +e.target.value; labels(); frame.drawn = false; });
  $('plStrength').addEventListener('input', e => { sim.opts.strength = +e.target.value; labels(); });
  $('plSlip').addEventListener('input', e => { sim.opts.halfLife = +e.target.value; labels(); });
  $('plMut').addEventListener('input', e => { if (living) sim.opts.mutation = +e.target.value; labels(); });
  $('plSun').addEventListener('input', e => { if (living) sim.opts.sun = +e.target.value; labels(); });
  const table = $('plRules');
  table.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) bump(b, e.shiftKey ? -1 : 1); });
  table.addEventListener('contextmenu', e => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); bump(b, -1); } });
  table.addEventListener('keydown', e => {
    const b = e.target.closest('button[data-i]');
    if (b && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); bump(b, e.key === 'ArrowUp' ? 1 : -1); }
  });
  document.addEventListener('langchange', () => { labels(); rules(); stats(); charts(); });
  requestAnimationFrame(frame);
}
main();
