// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// R 페이지: 벡터 연산 · 재활용 · NA 시연 (모형은 rvec.js)
import { evaluate, ARITH, COMPARE } from './rvec.js?v=9f3a9224';
import { highlight } from './hl.js?v=5ac4dd32';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const PRESETS = [
  { ko: '재활용 (길이 4 + 2)', en: 'Recycling (4 + 2)', mode: 'binary', a: '1, 2, 3, 4', b: '10, 20', op: '+' },
  { ko: '재활용 경고 (길이 3 + 2)', en: 'Recycling warning (3 + 2)', mode: 'binary', a: '1, 2, 3', b: '10, 20', op: '+' },
  { ko: '스칼라 × 벡터', en: 'Scalar × vector', mode: 'binary', a: '82, 64, 91, 58', b: '0.01', op: '*' },
  { ko: 'NA 가 낀 합', en: 'A sum with NA', mode: 'summary', a: '82, NA, 91, 58', fn: 'sum', narm: false },
  { ko: 'na.rm = TRUE 로 평균', en: 'Mean with na.rm = TRUE', mode: 'summary', a: '82, NA, 91, 58', fn: 'mean', narm: true },
  { ko: 'NA 를 비교하면', en: 'Comparing with NA', mode: 'binary', a: '82, NA, 91, 58', b: '70', op: '>' },
  { ko: 'x[x > 70] 와 NA', en: 'x[x > 70] and NA', mode: 'filter', a: '82, NA, 91, 58', op: '>', k: '70' }
];
const parseVec = (s) => {
  const parts = s.split(',').map(x => x.trim()).filter(x => x !== '');
  return parts.map(p => { if (/^NA$/i.test(p)) return null; const n = Number(p); if (!Number.isFinite(n)) throw new Error(p); return n; });
};
function show() {
  const mode = $('rMode').value;
  $('rBL').hidden = mode !== 'binary'; $('rOpL').hidden = mode === 'summary'; $('rFnL').hidden = mode !== 'summary'; $('rKL').hidden = mode !== 'filter'; $('rNL').hidden = mode !== 'summary';
  const keep = $('rOp').value, ops = mode === 'binary' ? [...ARITH, ...COMPARE] : COMPARE;
  $('rOp').innerHTML = ops.map(o => `<option>${esc(o)}</option>`).join('');
  $('rOp').value = ops.includes(keep) ? keep : ops[0];
}
function run() {
  $('rErr').textContent = '';
  try {
    const mode = $('rMode').value, a = parseVec($('rA').value);
    const spec = mode === 'binary' ? { mode, op: $('rOp').value, a, b: parseVec($('rB').value) }
      : mode === 'summary' ? { mode, fn: $('rFn').value, a, narm: $('rNarm').checked }
        : { mode, op: $('rOp').value, a, k: Number($('rK').value) };
    if (mode === 'filter' && !Number.isFinite(spec.k)) throw new Error($('rK').value);
    const r = evaluate(spec);
    $('rCode').textContent = r.code;
    $('rOut').textContent = r.out;
    $('rWarn').innerHTML = r.warning ? `<div class="note-box bad"><b>Warning message:</b> ${esc(r.warning)}</div>` : '';
    $('rNotes').innerHTML = r.notes.map(n => `<div class="note-box">${esc(t({ ko: n[0], en: n[1] }))}</div>`).join('');
  } catch (e) {
    $('rErr').textContent = T(`숫자 또는 NA 만 쓸 수 있습니다: "${e.message}"`, `Only numbers or NA are allowed: "${e.message}"`);
  }
}
function presets() { $('rPresets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-i="${i}">${esc(t(p))}</button>`).join(''); }
function apply(p) {
  $('rMode').value = p.mode; show(); $('rA').value = p.a; if (p.b !== undefined) $('rB').value = p.b;
  if (p.op) $('rOp').value = p.op; if (p.fn) $('rFn').value = p.fn; if (p.narm !== undefined) $('rNarm').checked = p.narm; if (p.k !== undefined) $('rK').value = p.k;
  run();
}
$('rPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) apply(PRESETS[+b.dataset.i]); });
for (const id of ['rA', 'rB', 'rOp', 'rFn', 'rK', 'rNarm']) $(id).addEventListener('input', run);
$('rMode').addEventListener('change', () => { show(); run(); });
document.addEventListener('langchange', () => { presets(); run(); });
presets(); apply(PRESETS[1]); highlight();
