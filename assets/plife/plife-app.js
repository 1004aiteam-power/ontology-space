// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 입자 생명 페이지: 입자 화면 · 규칙 표(눌러서 고침) · 통계
import { ParticleLife, WORLD, MAX_TYPES } from './plife.js?v=d3a2454c';
import { $, t, fit } from '../lib/dom.js?v=3b73d59c';

// 종류 색: 어두운 바탕에서 서로 구분되는 여섯 색. 색만으로 구분하지 않도록 규칙 표에는 가 · 나 · 다 … 이름을 함께 적는다
const COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da'];
const NAMES = { ko: ['가', '나', '다', '라', '마', '바'], en: ['A', 'B', 'C', 'D', 'E', 'F'] };
const PRESET_LABEL = {
  random: { ko: '무작위 규칙', en: 'Random rules' },
  clusters: { ko: '끼리끼리 (같은 종류끼리 끌림)', en: 'Like attracts like' },
  pinwheels: { ko: '바람개비 (다음 종류를 따라감)', en: 'Pinwheels (each follows the next type)' },
  chase: { ko: '쫓고 쫓기기 (비대칭)', en: 'Chase and flee (asymmetric)' },
  none: { ko: '규칙 없음 (모두 0)', en: 'No rules (all zero)' }
};
const SPEEDS = [1, 2, 4];
const POS = [42, 120, 214], NEG = [217, 89, 38];          // 끌림 = 파랑, 밀침 = 주황 (신경망 그림과 같은 뜻)

let sim, running = false, speedIdx = 0, seed = 1;
const lang = () => (window.currentLang?.() === 'en' ? 'en' : 'ko');

// ---- 입자 화면 ------------------------------------------------------------------------
function draw() {
  const { ctx, cw, ch } = fit($('plView'), WORLD.h / WORLD.w), k = cw / WORLD.w, r = Math.max(1.2, 0.9 * k);
  ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, cw, ch);
  for (let c = 0; c < sim.opts.types; c++) {                 // 색별로 한 번에 그려 빠르게
    ctx.fillStyle = COLORS[c]; ctx.beginPath();
    for (let i = 0; i < sim.n; i++) if (sim.type[i] === c) { const x = sim.x[i] * k, y = sim.y[i] * k; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill();
  }
}

// ---- 규칙 표 --------------------------------------------------------------------------
const cellColor = (v) => { const c = v > 0 ? POS : NEG, a = 0.25 + 0.75 * Math.abs(v); return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(2)})`; };
function rules() {
  const k = sim.opts.types, nm = NAMES[lang()];
  const dot = (i) => `<i style="background:${COLORS[i]}"></i>`;
  let h = `<tr><th></th>${Array.from({ length: k }, (_, j) => `<th scope="col" title="${nm[j]}">${dot(j)}</th>`).join('')}</tr>`;
  for (let i = 0; i < k; i++) {
    h += `<tr><th scope="row" title="${nm[i]}">${dot(i)}</th>`;
    for (let j = 0; j < k; j++) {
      const v = sim.matrix[i][j], label = t({ ko: `${nm[i]}가 ${nm[j]}에게 느끼는 힘 ${v.toFixed(2)}`, en: `force ${nm[i]} feels towards ${nm[j]}: ${v.toFixed(2)}` });
      h += `<td><button type="button" data-i="${i}" data-j="${j}" class="${v === 0 ? 'zero' : ''}" style="${v === 0 ? '' : `background:${cellColor(v)}`}" aria-label="${label}" title="${label}">${v > 0 ? '+' : ''}${v.toFixed(2).replace(/\.?0+$/, '')}</button></td>`;
    }
    h += '</tr>';
  }
  $('plRules').innerHTML = h;
}
// 칸을 누르면 0.25 씩 올라가고(+1 다음은 −1), Shift 를 누른 채 누르거나 오른쪽 단추로 누르면 내려간다. 화살표 키로도 조절
function bump(btn, dir) {
  const i = +btn.dataset.i, j = +btn.dataset.j;
  let v = Math.round((sim.matrix[i][j] + dir * 0.25) * 4) / 4;
  if (v > 1) v = -1; if (v < -1) v = 1;
  sim.matrix[i][j] = v;
  rules();
  $('plRules').querySelector(`button[data-i="${i}"][data-j="${j}"]`)?.focus();
  $('plPreset').value = '';
}

// ---- 통계 -----------------------------------------------------------------------------
function stats() {
  const s = sim.last || { speed: 0, neighbours: sim.uniformNeighbours(), sameShare: 1 / sim.opts.types }, u = sim.uniformNeighbours();
  const items = [
    [t({ ko: '틱', en: 'Tick' }), sim.tick.toLocaleString(), t({ ko: `입자 ${sim.n}개 · ${sim.opts.types}종류`, en: `${sim.n} particles · ${sim.opts.types} types` })],
    [t({ ko: '평균 속력', en: 'Mean speed' }), s.speed.toFixed(1), t({ ko: '0에 가까우면 멈춘 모양', en: 'near 0 = a frozen pattern' })],
    [t({ ko: '평균 이웃 수', en: 'Mean neighbours' }), s.neighbours.toFixed(1), t({ ko: `고르게 퍼지면 ${u.toFixed(1)}`, en: `${u.toFixed(1)} if spread evenly` })],
    [t({ ko: '같은 종류 이웃', en: 'Same-type neighbours' }), Math.round(s.sameShare * 100) + '%', t({ ko: `섞여 있으면 ${Math.round(100 / sim.opts.types)}%`, en: `${Math.round(100 / sim.opts.types)}% if mixed` })]
  ];
  $('plStats').innerHTML = items.map(([a, b, c]) => `<div><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('');
}

function labels() {
  $('playBtn').textContent = running ? t({ ko: '⏸ 일시정지', en: '⏸ Pause' }) : t({ ko: '▶ 시작', en: '▶ Start' });
  $('speedBtn').textContent = t({ ko: '배속', en: 'Speed' }) + ` ${SPEEDS[speedIdx]}×`;
  const cur = $('plPreset').value;
  $('plPreset').innerHTML = `<option value="">${t({ ko: '직접 고친 규칙', en: 'Hand-edited rules' })}</option>` +
    Object.entries(PRESET_LABEL).map(([k, v]) => `<option value="${k}">${t(v)}</option>`).join('');
  $('plPreset').value = cur;
  $('plSeed').textContent = sim.opts.preset === 'random' && $('plPreset').value === 'random' ? t({ ko: `규칙 번호 ${seed}`, en: `rule set no. ${seed}` }) : '';
  for (const [id, fmt] of [['plN', v => v], ['plTypes', v => v], ['plRadius', v => v], ['plStrength', v => v], ['plSlip', v => (+v).toFixed(2)]]) $(id + 'Out').textContent = fmt($(id).value);
}

function frame() {
  if (running) for (let i = 0; i < SPEEDS[speedIdx]; i++) sim.step();
  draw();
  if (running || !frame.drawn) { stats(); frame.drawn = true; }
  requestAnimationFrame(frame);
}

function applyPreset(name) {
  sim.setPreset(name, seed); sim.scatter();
  $('plPreset').value = name;
  rules(); labels(); frame.drawn = false;
}

function main() {
  if (!$('plView')) return;
  sim = new ParticleLife({ n: +$('plN').value, types: +$('plTypes').value, radius: +$('plRadius').value, strength: +$('plStrength').value, halfLife: +$('plSlip').value, seed, preset: 'random' });
  $('plTypes').max = MAX_TYPES;
  labels(); $('plPreset').value = 'random'; labels(); rules();
  $('playBtn').addEventListener('click', () => { running = !running; labels(); });
  $('speedBtn').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; labels(); });
  $('plPreset').addEventListener('change', e => { if (e.target.value) applyPreset(e.target.value); });
  $('plNew').addEventListener('click', () => { seed++; applyPreset('random'); });                       // 새 무작위 규칙
  // 표 전체를 한꺼번에: 새 무작위 값으로 (입자는 지금 자리에서 그대로 이어감), 또는 모두 0 으로
  $('plRefresh').addEventListener('click', () => { seed++; sim.setPreset('random', seed); $('plPreset').value = 'random'; rules(); labels(); });
  $('plZero').addEventListener('click', () => { sim.setPreset('none', seed); $('plPreset').value = 'none'; rules(); labels(); });
  $('plScatter').addEventListener('click', () => { sim.scatter(); frame.drawn = false; });              // 같은 규칙, 입자만 다시
  $('plN').addEventListener('input', e => { sim.setCount(+e.target.value); labels(); frame.drawn = false; });
  $('plTypes').addEventListener('input', e => { sim.setTypes(+e.target.value); if ($('plPreset').value) sim.setPreset($('plPreset').value, seed); rules(); labels(); frame.drawn = false; });
  $('plRadius').addEventListener('input', e => { sim.opts.radius = +e.target.value; labels(); frame.drawn = false; });
  $('plStrength').addEventListener('input', e => { sim.opts.strength = +e.target.value; labels(); });
  $('plSlip').addEventListener('input', e => { sim.opts.halfLife = +e.target.value; labels(); });
  const table = $('plRules');
  table.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) bump(b, e.shiftKey ? -1 : 1); });
  table.addEventListener('contextmenu', e => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); bump(b, -1); } });
  table.addEventListener('keydown', e => {
    const b = e.target.closest('button[data-i]');
    if (b && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); bump(b, e.key === 'ArrowUp' ? 1 : -1); }
  });
  document.addEventListener('langchange', () => { labels(); rules(); stats(); });
  requestAnimationFrame(frame);
}
main();
