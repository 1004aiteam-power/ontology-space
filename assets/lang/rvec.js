// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// R 벡터 시연의 모형: 재활용 규칙(recycling) · NA 전파 · 논리 벡터 부분집합, 그리고 R 의 print 형식([1] … 줄바꿈 · 공통 소수 자릿수).
// tests/lang.test.mjs 가 같은 식을 진짜 R 로 실행해 출력 문자열과 경고 문구가 같은지 확인한다. NA 는 null 로 나타낸다.

export const NA = null;
const isNA = (x) => x === null;

// ---- R 의 print 형식 ----
function fmtNum(vals) {
  const ok = vals.filter(v => !isNA(v));
  let dec = 0;
  for (const v of ok) { const s = Number(v.toPrecision(7)).toString(); const m = /\.(\d+)$/.exec(s); if (m) dec = Math.max(dec, m[1].length); }
  return vals.map(v => (isNA(v) ? 'NA' : v.toFixed(dec)));
}
export function fmtVector(vals, kind = 'num') {
  if (!vals.length) return kind === 'lgl' ? 'logical(0)' : 'numeric(0)';
  const cells = kind === 'lgl' ? vals.map(v => (isNA(v) ? 'NA' : v ? 'TRUE' : 'FALSE')) : fmtNum(vals);
  const w = Math.max(...cells.map(c => c.length));
  const labW = `[${vals.length}]`.length, per = Math.max(1, Math.floor((80 - labW) / (w + 1)));
  const lines = [];
  for (let i = 0; i < cells.length; i += per) lines.push(`[${i + 1}]`.padStart(labW) + cells.slice(i, i + per).map(c => ' ' + c.padStart(w)).join(''));
  return lines.join('\n');
}
const fmtScalar = (v, kind) => fmtVector([v], kind);

// ---- 연산 ----
const OPS = {
  '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '^': (x, y) => x ** y,
  '%%': (x, y) => (y === 0 ? NaN : x - Math.floor(x / y) * y),
  '>': (x, y) => x > y, '<': (x, y) => x < y, '>=': (x, y) => x >= y, '<=': (x, y) => x <= y, '==': (x, y) => x === y, '!=': (x, y) => x !== y
};
export const ARITH = ['+', '-', '*', '/', '^', '%%'], COMPARE = ['>', '<', '>=', '<=', '==', '!='];

// 재활용: 짧은 쪽을 처음부터 다시 쓴다. 길이가 나누어떨어지지 않으면 결과는 같지만 경고가 붙는다
export function binary(op, a, b) {
  if (!a.length || !b.length) return { values: [], kind: COMPARE.includes(op) ? 'lgl' : 'num', warning: null };
  const n = Math.max(a.length, b.length);
  const warning = n % a.length !== 0 || n % b.length !== 0 ? 'longer object length is not a multiple of shorter object length' : null;
  const values = Array.from({ length: n }, (_, i) => { const x = a[i % a.length], y = b[i % b.length]; return isNA(x) || isNA(y) ? NA : OPS[op](x, y); });
  return { values, kind: COMPARE.includes(op) ? 'lgl' : 'num', warning };
}
export function summary(fn, a, narm) {
  const v = narm ? a.filter(x => !isNA(x)) : a;
  if (fn === 'length') return { value: a.length, kind: 'num' };      // 길이는 NA 가 있어도 센다
  if (v.some(isNA)) return { value: NA, kind: 'num' };
  if (fn === 'sum') return { value: v.reduce((s, x) => s + x, 0), kind: 'num' };
  if (fn === 'mean') return { value: v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN, kind: 'num' };
  if (fn === 'max') return { value: v.length ? Math.max(...v) : -Infinity, kind: 'num' };
  if (fn === 'min') return { value: v.length ? Math.min(...v) : Infinity, kind: 'num' };
  throw new Error('unknown function ' + fn);
}
// x[mask]: 논리 벡터로 고르기. mask 의 NA 자리는 결과도 NA 한 칸
export function select(a, mask) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, mask.length); i++) { const m = mask[i % mask.length], x = a[i % a.length]; if (isNA(m)) out.push(NA); else if (m) out.push(x); }
  return out;
}

const rv = (a) => 'c(' + a.map(x => (isNA(x) ? 'NA' : String(x))).join(', ') + ')';

// spec: { mode: 'binary', op, a, b } | { mode: 'summary', fn, a, narm } | { mode: 'filter', op, a, k }
export function evaluate(spec) {
  if (spec.mode === 'binary') {
    const r = binary(spec.op, spec.a, spec.b);
    const code = `a <- ${rv(spec.a)}\nb <- ${rv(spec.b)}\na ${spec.op} b`;
    const hasNA = spec.a.some(isNA) || spec.b.some(isNA);
    const notes = [];
    if (spec.a.length !== spec.b.length && spec.a.length && spec.b.length) {
      const [s, l] = spec.a.length < spec.b.length ? ['a', 'b'] : ['b', 'a'];
      notes.push(r.warning ? [`짧은 ${s}(${Math.min(spec.a.length, spec.b.length)}개)가 처음부터 반복(재활용)되어 ${l} 와 짝지어졌지만, 길이가 나누어떨어지지 않아 R 이 경고합니다. 결과는 나오지만 의도한 것인지 의심해야 합니다.`, `The shorter ${s} (${Math.min(spec.a.length, spec.b.length)} items) is reused from its start (recycled) to pair with ${l}, but the lengths do not divide evenly so R warns. A result appears, but doubt whether it is what you meant.`]
        : [`짧은 ${s}가 ${l} 의 길이에 맞게 반복(재활용)되어 계산됩니다. 길이가 나누어떨어져 경고는 없습니다 — 스칼라 × 벡터가 자연스러운 것도 같은 규칙입니다.`, `The shorter ${s} is repeated (recycled) to match ${l}. The lengths divide evenly so there is no warning; scalar × vector working naturally is the same rule.`]);
    }
    if (hasNA) notes.push(['NA("모름")가 낀 자리의 결과는 항상 NA 입니다 — 모르는 값과의 계산은 모릅니다.', 'Wherever an NA ("unknown") is involved the result is NA: a calculation with an unknown is unknown.']);
    return { code, out: fmtVector(r.values, r.kind), warning: r.warning, notes };
  }
  if (spec.mode === 'summary') {
    const r = summary(spec.fn, spec.a, spec.narm);
    const call = spec.fn === 'length' ? 'length(x)' : `${spec.fn}(x${spec.narm ? ', na.rm = TRUE' : ''})`;
    const notes = [];
    if (spec.a.some(isNA) && spec.fn !== 'length') notes.push(spec.narm ? ['na.rm = TRUE 는 NA 를 계산에서 빼 줍니다. 단, 몇 개를 뺐는지는 스스로 확인해야 합니다 (조용히 빠지므로).', 'na.rm = TRUE drops the NAs from the calculation. Do check how many were dropped, since they vanish silently.'] : ['벡터에 NA 가 하나라도 있으면 sum · mean · max 는 NA 입니다. 값을 모르는데 합을 알 수는 없으니까요. 의도적으로 빼려면 na.rm = TRUE.', 'If a vector contains any NA, sum, mean and max give NA: you cannot know a total with an unknown part. Use na.rm = TRUE to exclude deliberately.']);
    return { code: `x <- ${rv(spec.a)}\n${call}`, out: fmtScalar(r.value, r.kind), warning: null, notes };
  }
  if (spec.mode === 'filter') {
    const mask = binary(spec.op, spec.a, [spec.k]).values, r = select(spec.a, mask);
    const notes = [];
    if (spec.a.some(isNA)) notes.push(['조건이 NA 인 자리를 고르면 결과에도 NA 가 한 칸 남습니다 (x[NA] 는 NA). NA 를 빼려면 which(x > k) 나 x[!is.na(x) & x > k] 를 쓰세요.', 'Where the condition is NA the result keeps an NA slot (x[NA] is NA). To drop them use which(x > k) or x[!is.na(x) & x > k].']);
    return { code: `x <- ${rv(spec.a)}\nx[x ${spec.op} ${spec.k}]`, out: fmtVector(r, 'num'), warning: null, notes, mask: fmtVector(mask, 'lgl') };
  }
  throw new Error('unknown mode');
}
