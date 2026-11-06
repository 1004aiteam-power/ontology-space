// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 브라우저 안에서 도는 작은 Cypher 엔진 (읽기 전용 부분집합). Neo4j가 없어도 실습할 수 있게
//
// 지원: MATCH · OPTIONAL MATCH · WHERE · WITH · UNWIND · RETURN (DISTINCT, AS) · ORDER BY · SKIP · LIMIT
//       노드 (n:Label {k: v}) · 관계 -[r:A|B]-> <-[]- -[]- · 가변 길이 *, *2, *1..3 · 경로 변수 p = (…)
//       AND OR XOR NOT · = <> < > <= >= · IS [NOT] NULL · IN · STARTS WITH · ENDS WITH · CONTAINS · =~
//       + - * / % · 리스트 [..] · 맵 {..} · 인덱스 x[0] · 라벨 검사 n:Label · CASE · EXISTS { 패턴 }, 패턴 조건
//       집계 count sum avg min max collect (DISTINCT 포함), 그 밖의 함수는 FUNCS 참고
// 지원하지 않음: CREATE · MERGE · SET · DELETE (쓰기), CALL, UNION, 파라미터

// ---- 토큰 -----------------------------------------------------------------------------
const KW = new Set(['MATCH', 'OPTIONAL', 'WHERE', 'RETURN', 'WITH', 'UNWIND', 'AS', 'ORDER', 'BY', 'ASC', 'ASCENDING', 'DESC', 'DESCENDING', 'SKIP', 'LIMIT',
  'DISTINCT', 'AND', 'OR', 'XOR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE', 'STARTS', 'ENDS', 'CONTAINS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
  'CREATE', 'MERGE', 'SET', 'DELETE', 'DETACH', 'REMOVE', 'CALL', 'UNION', 'FOREACH', 'LOAD']);
export class CypherError extends Error {}

function tokenize(src) {
  const T = [];
  let i = 0;
  const err = (m) => { throw new CypherError(`${m} (위치 ${i})`); };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { j++; s += ({ n: '\n', t: '\t' })[src[j]] ?? src[j]; } else s += src[j]; j++; }
      if (j >= src.length) err('닫히지 않은 문자열');
      T.push({ t: 'str', v: s, p: i }); i = j + 1; continue;
    }
    if (c === '`') { const j = src.indexOf('`', i + 1); if (j < 0) err('닫히지 않은 `'); T.push({ t: 'id', v: src.slice(i + 1, j), p: i }); i = j + 1; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]) && src[i - 1] !== '.')) {
      const m = /^(\d+\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)/.exec(src.slice(i));
      if (src[i + m[0].length] === '.' && src[i + m[0].length + 1] === '.' && m[0].includes('.')) { const k = m[0].indexOf('.'); T.push({ t: 'num', v: +m[0].slice(0, k), p: i }); i += k; continue; }
      T.push({ t: 'num', v: +m[0], p: i }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$À-￿]/.test(c)) {
      const m = /^[A-Za-z_$À-￿][A-Za-z0-9_$À-￿]*/.exec(src.slice(i))[0];
      T.push(KW.has(m.toUpperCase()) ? { t: 'kw', v: m.toUpperCase(), raw: m, p: i } : { t: 'id', v: m, p: i }); i += m.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<>', '!=', '<=', '>=', '=~', '..', '->', '<-'].includes(two)) { T.push({ t: 'sym', v: two === '!=' ? '<>' : two, p: i }); i += 2; continue; }
    if ('()[]{},.:|*=<>+-/%;^'.includes(c)) { T.push({ t: 'sym', v: c, p: i }); i++; continue; }
    err(`알 수 없는 문자 '${c}'`);
  }
  T.push({ t: 'eof', p: src.length });
  return T;
}

// ---- 구문 분석 ---------------------------------------------------------------------------
function parse(src) {
  const T = tokenize(src);
  let k = 0;
  const peek = (o = 0) => T[k + o], next = () => T[k++];
  const is = (t, v, o = 0) => { const x = T[k + o]; return x.t === t && (v === undefined || x.v === v); };
  const isKw = (v, o = 0) => is('kw', v, o), isSym = (v, o = 0) => is('sym', v, o);
  const fail = (m) => { const x = peek(); throw new CypherError(`${m} — '${x.t === 'eof' ? '끝' : (x.raw || x.v)}' 근처 (위치 ${x.p})`); };
  const eat = (t, v) => { if (!is(t, v)) fail(`'${v ?? t}'가 필요합니다`); return next(); };
  const ident = () => { if (is('id')) return next().v; if (is('kw') && !['MATCH', 'RETURN', 'WHERE', 'WITH'].includes(peek().v)) return next().raw; fail('이름이 필요합니다'); };

  function query() {
    const clauses = [];
    while (!is('eof')) {
      if (isSym(';')) { next(); continue; }
      if (isKw('OPTIONAL') || isKw('MATCH')) clauses.push(matchClause());
      else if (isKw('WITH')) clauses.push(projection('WITH'));
      else if (isKw('RETURN')) clauses.push(projection('RETURN'));
      else if (isKw('UNWIND')) { next(); const e = expr(); eat('kw', 'AS'); clauses.push({ c: 'UNWIND', e, as: ident() }); }
      else if (is('kw') && ['CREATE', 'MERGE', 'SET', 'DELETE', 'DETACH', 'REMOVE', 'FOREACH', 'LOAD'].includes(peek().v)) throw new CypherError(`이 실습은 읽기 질의만 지원합니다 (${peek().v}는 쓰기 명령)`);
      else if (is('kw') && ['CALL', 'UNION'].includes(peek().v)) throw new CypherError(`${peek().v}는 이 실습에서 지원하지 않습니다`);
      else fail('MATCH, WITH, UNWIND, RETURN 중 하나가 와야 합니다');
    }
    if (!clauses.length) throw new CypherError('빈 질의입니다');
    if (clauses[clauses.length - 1].c !== 'RETURN') throw new CypherError('질의는 RETURN으로 끝나야 합니다');
    return clauses;
  }
  function matchClause() {
    let optional = false;
    if (isKw('OPTIONAL')) { next(); optional = true; }
    eat('kw', 'MATCH');
    const patterns = [pattern()];
    while (isSym(',')) { next(); patterns.push(pattern()); }
    let where = null;
    if (isKw('WHERE')) { next(); where = expr(); }
    return { c: 'MATCH', optional, patterns, where };
  }
  function pattern() {
    let pathVar = null;
    if (is('id') && isSym('=', 1)) { pathVar = next().v; next(); }
    const el = [nodePat()];
    while (isSym('-') || isSym('<-')) { el.push(relPat()); el.push(nodePat()); }
    return { pathVar, el };
  }
  function props() { return isSym('{') ? mapLit() : null; }
  function nodePat() {
    eat('sym', '(');
    let v = null; const labels = [];
    if (is('id')) v = next().v;
    while (isSym(':')) { next(); labels.push(ident()); }
    const pr = props();
    eat('sym', ')');
    return { v, labels, props: pr };
  }
  function relPat() {
    let left = false;
    if (isSym('<-')) { next(); left = true; } else eat('sym', '-');
    let v = null, types = [], varLen = false, min = 1, max = 1, pr = null;
    if (isSym('[')) {
      next();
      if (is('id')) v = next().v;
      if (isSym(':')) { next(); types.push(ident()); while (isSym('|')) { next(); if (isSym(':')) next(); types.push(ident()); } }
      if (isSym('*')) {
        next(); varLen = true; min = 1; max = Infinity;
        if (is('num')) { min = next().v; max = min; }
        if (isSym('..')) { next(); max = is('num') ? next().v : Infinity; }
      }
      pr = props();
      eat('sym', ']');
    }
    let right = false;
    if (isSym('->')) { next(); right = true; } else eat('sym', '-');
    if (left && right) fail('관계 방향은 한쪽만 지정할 수 있습니다');
    return { v, types, varLen, min, max, props: pr, dir: right ? 'out' : left ? 'in' : 'both' };
  }
  function projection(kind) {
    next();
    let distinct = false; if (isKw('DISTINCT')) { next(); distinct = true; }
    const items = []; let star = false;
    if (isSym('*')) { next(); star = true; if (isSym(',')) next(); }
    if (!star || !(isKw('WHERE') || isKw('ORDER') || isKw('SKIP') || isKw('LIMIT') || is('eof') || isKw('MATCH') || isKw('RETURN') || isKw('WITH') || isKw('UNWIND') || isKw('OPTIONAL'))) {
      do {
        if (items.length) next();
        const s0 = peek().p, e = expr(), s1 = peek().p;
        let as = null; if (isKw('AS')) { next(); as = ident(); }
        items.push({ e, as, text: src.slice(s0, s1).trim() });
      } while (isSym(','));
    }
    let order = null, skip = null, limit = null, where = null;
    if (isKw('ORDER')) {
      next(); eat('kw', 'BY'); order = [];
      do {
        if (order.length) next();
        const s0 = peek().p, e = expr(), text = src.slice(s0, peek().p).trim();
        let desc = false; if (isKw('DESC') || isKw('DESCENDING')) { next(); desc = true; } else if (isKw('ASC') || isKw('ASCENDING')) next();
        order.push({ e, desc, text });
      } while (isSym(','));
    }
    if (isKw('SKIP')) { next(); skip = expr(); }
    if (isKw('LIMIT')) { next(); limit = expr(); }
    if (kind === 'WITH' && isKw('WHERE')) { next(); where = expr(); }
    return { c: kind, distinct, items, star, order, skip, limit, where };
  }
  // 식 (우선순위 낮은 것부터)
  function expr() { return orE(); }
  function orE() { let a = xorE(); while (isKw('OR')) { next(); a = { t: 'or', a, b: xorE() }; } return a; }
  function xorE() { let a = andE(); while (isKw('XOR')) { next(); a = { t: 'xor', a, b: andE() }; } return a; }
  function andE() { let a = notE(); while (isKw('AND')) { next(); a = { t: 'and', a, b: notE() }; } return a; }
  function notE() { if (isKw('NOT')) { next(); return { t: 'not', e: notE() }; } return cmpE(); }
  function cmpE() {
    let a = addE();
    for (;;) {
      if (is('sym') && ['=', '<>', '<', '>', '<=', '>=', '=~'].includes(peek().v)) { const op = next().v; a = { t: 'cmp', op, a, b: addE() }; continue; }
      if (isKw('IS')) { next(); let not = false; if (isKw('NOT')) { next(); not = true; } eat('kw', 'NULL'); a = { t: 'isnull', e: a, not }; continue; }
      if (isKw('NOT') && isKw('IN', 1)) { next(); next(); a = { t: 'not', e: { t: 'in', a, b: addE() } }; continue; }
      if (isKw('IN')) { next(); a = { t: 'in', a, b: addE() }; continue; }
      if (isKw('STARTS') && isKw('WITH', 1)) { next(); next(); a = { t: 'str', op: 'starts', a, b: addE() }; continue; }
      if (isKw('ENDS') && isKw('WITH', 1)) { next(); next(); a = { t: 'str', op: 'ends', a, b: addE() }; continue; }
      if (isKw('CONTAINS')) { next(); a = { t: 'str', op: 'contains', a, b: addE() }; continue; }
      return a;
    }
  }
  function addE() { let a = mulE(); while (isSym('+') || isSym('-')) { const op = next().v; a = { t: 'arith', op, a, b: mulE() }; } return a; }
  function mulE() { let a = powE(); while (isSym('*') || isSym('/') || isSym('%')) { const op = next().v; a = { t: 'arith', op, a, b: powE() }; } return a; }
  function powE() { let a = unE(); while (isSym('^')) { next(); a = { t: 'arith', op: '^', a, b: unE() }; } return a; }
  function unE() { if (isSym('-')) { next(); return { t: 'neg', e: unE() }; } if (isSym('+')) { next(); return unE(); } return postE(); }
  function postE() {
    let e = primary();
    for (;;) {
      if (isSym('.') && !isSym('..')) { next(); e = { t: 'prop', e, k: ident() }; continue; }
      if (isSym('[')) {
        next();
        let a = null, b = null, slice = false;
        if (!isSym('..')) a = expr();
        if (isSym('..')) { next(); slice = true; if (!isSym(']')) b = expr(); }
        eat('sym', ']');
        e = slice ? { t: 'slice', e, a, b } : { t: 'idx', e, i: a }; continue;
      }
      if (isSym(':') && e.t === 'var') { const labels = []; while (isSym(':')) { next(); labels.push(ident()); } e = { t: 'haslabel', e, labels }; continue; }
      return e;
    }
  }
  function mapLit() {
    eat('sym', '{'); const entries = [];
    while (!isSym('}')) { if (entries.length) eat('sym', ','); const key = is('str') ? next().v : ident(); eat('sym', ':'); entries.push([key, expr()]); }
    eat('sym', '}');
    return { t: 'map', entries };
  }
  function tryPattern() {                       // WHERE 안의 패턴 조건: (a)-[:R]->(b)
    const save = k;
    try { const p = pattern(); if (p.el.length > 1) return p; } catch (e) { if (!(e instanceof CypherError)) throw e; }
    k = save; return null;
  }
  function primary() {
    const x = peek();
    if (x.t === 'num') { next(); return { t: 'lit', v: x.v }; }
    if (x.t === 'str') { next(); return { t: 'lit', v: x.v }; }
    if (isKw('TRUE')) { next(); return { t: 'lit', v: true }; }
    if (isKw('FALSE')) { next(); return { t: 'lit', v: false }; }
    if (isKw('NULL')) { next(); return { t: 'lit', v: null }; }
    if (isKw('CASE')) return caseE();
    if (isKw('EXISTS') && isSym('{', 1)) {
      next(); next();
      if (isKw('MATCH')) next();
      const patterns = [pattern()]; while (isSym(',')) { next(); patterns.push(pattern()); }
      let where = null; if (isKw('WHERE')) { next(); where = expr(); }
      eat('sym', '}');
      return { t: 'exists', patterns, where };
    }
    if (isSym('(')) {
      const p = tryPattern(); if (p) return { t: 'exists', patterns: [p], where: null };
      next(); const e = expr(); eat('sym', ')'); return e;
    }
    if (isSym('[') && is('id', undefined, 1) && isKw('IN', 2)) {      // [x IN list WHERE 조건 | 식]
      next(); const v = next().v; next(); const src2 = expr();
      let where = null, map = null;
      if (isKw('WHERE')) { next(); where = expr(); }
      if (isSym('|')) { next(); map = expr(); }
      eat('sym', ']'); return { t: 'comp', v, src: src2, where, map };
    }
    if (isSym('[')) {
      next(); const items = [];
      while (!isSym(']')) { if (items.length) eat('sym', ','); items.push(expr()); }
      eat('sym', ']'); return { t: 'list', items };
    }
    if (isSym('{')) return mapLit();
    if (is('id') || (is('kw') && isSym('(', 1))) {
      const name = next(); const nm = name.raw || name.v;
      if (isSym('(')) {
        next();
        const fn = nm.toLowerCase();
        if (fn === 'count' && isSym('*')) { next(); eat('sym', ')'); return { t: 'fn', fn: 'count', star: true, args: [] }; }
        let distinct = false; if (isKw('DISTINCT')) { next(); distinct = true; }
        const args = [];
        while (!isSym(')')) { if (args.length) eat('sym', ','); args.push(expr()); }
        eat('sym', ')');
        if (!(fn in FUNCS) && !AGG.has(fn)) throw new CypherError(`지원하지 않는 함수: ${nm}()`);
        return { t: 'fn', fn, distinct, args };
      }
      return { t: 'var', n: nm };
    }
    fail('식이 필요합니다');
  }
  function caseE() {
    next(); let subject = null;
    if (!isKw('WHEN')) subject = expr();
    const whens = [];
    while (isKw('WHEN')) { next(); const w = expr(); eat('kw', 'THEN'); whens.push([w, expr()]); }
    let els = null; if (isKw('ELSE')) { next(); els = expr(); }
    eat('kw', 'END');
    return { t: 'case', subject, whens, els };
  }
  return query();
}

// ---- 값 · 비교 ---------------------------------------------------------------------------
const isNode = (v) => v && v.kind === 'node', isRel = (v) => v && v.kind === 'rel', isPath = (v) => v && v.kind === 'path';
const keyOf = (v) => v == null ? 'null' : isNode(v) ? 'n' + v.id : isRel(v) ? 'r' + v.id : isPath(v) ? 'p' + v.rels.map(r => r.id).join(',') + ':' + v.nodes[0].id
  : Array.isArray(v) ? '[' + v.map(keyOf).join(',') + ']' : typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => k + ':' + keyOf(v[k])).join(',') + '}' : typeof v + ':' + String(v);
function equal(a, b) {
  if (a == null || b == null) return null;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return keyOf(a) === keyOf(b);
}
const typeRank = (v) => v == null ? 9 : typeof v === 'boolean' ? 3 : typeof v === 'number' ? 4 : typeof v === 'string' ? 2 : Array.isArray(v) ? 1 : 0;
function order(a, b) {                       // ORDER BY용: null은 오름차순에서 맨 뒤
  if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1;
  const ra = typeRank(a), rb = typeRank(b); if (ra !== rb) return ra - rb;
  if (typeof a === 'number') return a - b;
  if (typeof a === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  if (isNode(a) || isRel(a)) return a.id - b.id;
  return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0;
}
function compare(op, a, b) {
  if (op === '=') return equal(a, b);
  if (op === '<>') { const e = equal(a, b); return e == null ? null : !e; }
  if (op === '=~') return a == null || b == null ? null : new RegExp('^(?:' + b + ')$').test(String(a));
  if (a == null || b == null) return null;
  const num = typeof a === 'number' && typeof b === 'number', str = typeof a === 'string' && typeof b === 'string';
  if (!num && !str) return null;
  return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
}
const truth = (v) => v === true;

const AGG = new Set(['count', 'sum', 'avg', 'min', 'max', 'collect']);
const num = (v, f) => (v == null ? null : f(v));
const FUNCS = {
  labels: (n) => (isNode(n) ? [...n.labels] : null),
  type: (r) => (isRel(r) ? r.type : null),
  id: (x) => (x == null ? null : x.id),
  elementid: (x) => (x == null ? null : (isNode(x) ? '4:n:' : '5:r:') + x.id),
  keys: (x) => (x == null ? null : Object.keys(isNode(x) || isRel(x) ? x.props : x)),
  properties: (x) => (x == null ? null : { ...(isNode(x) || isRel(x) ? x.props : x) }),
  size: (x) => (x == null ? null : x.length),
  length: (x) => (x == null ? null : isPath(x) ? x.rels.length : x.length),
  nodes: (p) => (isPath(p) ? [...p.nodes] : null),
  relationships: (p) => (isPath(p) ? [...p.rels] : null),
  startnode: (r) => (isRel(r) ? r.start : null), endnode: (r) => (isRel(r) ? r.end : null),
  head: (l) => (l == null ? null : l[0] ?? null), last: (l) => (l == null ? null : l[l.length - 1] ?? null), tail: (l) => (l == null ? null : l.slice(1)),
  reverse: (l) => (l == null ? null : typeof l === 'string' ? [...l].reverse().join('') : [...l].reverse()),
  range: (a, b, s = 1) => { const o = []; for (let i = a; s > 0 ? i <= b : i >= b; i += s) o.push(i); return o; },
  coalesce: (...a) => a.find(v => v != null) ?? null,
  toupper: (s) => num(s, x => String(x).toUpperCase()), tolower: (s) => num(s, x => String(x).toLowerCase()),
  tostring: (s) => num(s, x => String(x)), trim: (s) => num(s, x => String(x).trim()),
  tointeger: (s) => num(s, x => { const n = parseInt(x, 10); return Number.isNaN(n) ? null : n; }),
  tofloat: (s) => num(s, x => { const n = parseFloat(x); return Number.isNaN(n) ? null : n; }),
  split: (s, d) => num(s, x => String(x).split(d)), replace: (s, a, b) => num(s, x => String(x).split(a).join(b)),
  substring: (s, a, n) => num(s, x => (n == null ? String(x).slice(a) : String(x).substr(a, n))),
  left: (s, n) => num(s, x => String(x).slice(0, n)), right: (s, n) => num(s, x => String(x).slice(-n)),
  round: (x, p = 0) => num(x, v => Math.round(v * 10 ** p) / 10 ** p), abs: (x) => num(x, Math.abs), floor: (x) => num(x, Math.floor), ceil: (x) => num(x, Math.ceil), sqrt: (x) => num(x, Math.sqrt)
};

// ---- 실행 ---------------------------------------------------------------------------------
export function runCypher(G, src, { maxRows = 100000, maxHops = 30, maxSteps = 3e6 } = {}) {
  const clauses = parse(src);
  let work = 0;
  const tick = () => { if (++work > maxSteps) throw new CypherError('질의가 너무 많은 경로를 탐색합니다. 관계 타입이나 길이(*1..n)를 좁혀 보세요'); };
  let rows = [{}];
  const ev = (e, r) => evalE(e, r);

  function evalE(e, r) {
    switch (e.t) {
      case 'lit': return e.v;
      case 'var': if (!(e.n in r)) throw new CypherError(`정의되지 않은 변수: ${e.n}`); return r[e.n];
      case 'prop': { const o = ev(e.e, r); if (o == null) return null; const src2 = isNode(o) || isRel(o) ? o.props : o; return src2[e.k] ?? null; }
      case 'idx': { const o = ev(e.e, r), i = ev(e.i, r); if (o == null || i == null) return null; if (typeof i === 'string') return (isNode(o) || isRel(o) ? o.props : o)[i] ?? null; return o[i < 0 ? o.length + i : i] ?? null; }
      case 'slice': { const o = ev(e.e, r); if (o == null) return null; const a = e.a ? ev(e.a, r) : 0, b = e.b ? ev(e.b, r) : o.length; return o.slice(a, b); }
      case 'list': return e.items.map(x => ev(x, r));
      case 'comp': { const l = ev(e.src, r); if (l == null) return null; const out = []; for (const x of l) { const r2 = { ...r, [e.v]: x }; if (!e.where || truth(ev(e.where, r2))) out.push(e.map ? ev(e.map, r2) : x); } return out; }
      case 'map': return Object.fromEntries(e.entries.map(([k, x]) => [k, ev(x, r)]));
      case 'haslabel': { const n = ev(e.e, r); return n == null ? null : e.labels.every(l => n.labelSet?.has(l)); }
      case 'and': { const a = ev(e.a, r), b = ev(e.b, r); if (a === false || b === false) return false; if (a == null || b == null) return null; return true; }
      case 'or': { const a = ev(e.a, r), b = ev(e.b, r); if (a === true || b === true) return true; if (a == null || b == null) return null; return false; }
      case 'xor': { const a = ev(e.a, r), b = ev(e.b, r); return a == null || b == null ? null : a !== b; }
      case 'not': { const a = ev(e.e, r); return a == null ? null : !a; }
      case 'cmp': return compare(e.op, ev(e.a, r), ev(e.b, r));
      case 'isnull': { const v = ev(e.e, r); return e.not ? v != null : v == null; }
      case 'in': { const a = ev(e.a, r), l = ev(e.b, r); if (l == null) return null; let sawNull = false; for (const x of l) { const q = equal(a, x); if (q === true) return true; if (q == null) sawNull = true; } return sawNull ? null : false; }
      case 'str': { const a = ev(e.a, r), b = ev(e.b, r); if (typeof a !== 'string' || typeof b !== 'string') return null; return e.op === 'starts' ? a.startsWith(b) : e.op === 'ends' ? a.endsWith(b) : a.includes(b); }
      case 'arith': {
        const a = ev(e.a, r), b = ev(e.b, r); if (a == null || b == null) return null;
        if (e.op === '+') { if (Array.isArray(a) || Array.isArray(b)) return [].concat(a, b); return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : a + b; }
        if (typeof a !== 'number' || typeof b !== 'number') throw new CypherError(`숫자가 아닌 값에 ${e.op} 연산`);
        return e.op === '-' ? a - b : e.op === '*' ? a * b : e.op === '/' ? (Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b) : e.op === '%' ? a % b : a ** b;
      }
      case 'neg': { const v = ev(e.e, r); return v == null ? null : -v; }
      case 'case': {
        if (e.subject) { const s = ev(e.subject, r); for (const [w, t] of e.whens) if (equal(s, ev(w, r)) === true) return ev(t, r); }
        else for (const [w, t] of e.whens) if (truth(ev(w, r))) return ev(t, r);
        return e.els ? ev(e.els, r) : null;
      }
      case 'exists': { let found = false; matchAll(e.patterns, r, (b) => { if (!e.where || truth(ev(e.where, b))) { found = true; return true; } }); return found; }
      case 'fn':
        if (AGG.has(e.fn)) throw new CypherError(`집계 함수 ${e.fn}()는 WITH 또는 RETURN에서만 쓸 수 있습니다`);
        return FUNCS[e.fn](...e.args.map(a => ev(a, r)));
    }
    throw new CypherError('알 수 없는 식');
  }

  // 패턴 맞추기 — 한 MATCH 안에서 같은 관계는 한 번만 (Cypher의 관계 고유성)
  function nodeOk(n, np, b) {
    for (const l of np.labels) if (!n.labelSet.has(l)) return false;
    if (np.props) for (const [k, x] of np.props.entries) if (equal(n.props[k] ?? null, ev(x, b)) !== true) return false;
    return true;
  }
  function relOk(rel, rp, b) {
    if (rp.types.length && !rp.types.includes(rel.type)) return false;
    if (rp.props) for (const [k, x] of rp.props.entries) if (equal(rel.props[k] ?? null, ev(x, b)) !== true) return false;
    return true;
  }
  // from 노드에서 rp를 따라 갈 수 있는 (끝 노드, 관계 목록). forward=false면 패턴을 거꾸로 읽는 중
  function* steps(from, rp, forward, used, b) {
    const dir = rp.dir === 'both' ? 'both' : (rp.dir === 'out') === forward ? 'out' : 'in';
    const nbrs = (n) => {
      const o = [];
      if (dir !== 'in') for (const r of n.out) o.push([r, r.end]);
      if (dir !== 'out') for (const r of n.in) o.push([r, r.start]);
      return o;
    };
    if (!rp.varLen) { for (const [r, m] of nbrs(from)) if (tick(), true) if (!used.has(r.id) && relOk(r, rp, b)) yield [m, [r]]; return; }
    const max = Math.min(rp.max, maxHops), path = [], seen = new Set();
    function* dfs(n) {
      if (path.length >= rp.min) yield [n, [...path]];
      if (path.length >= max) return;
      for (const [r, m] of nbrs(n)) {
        tick();
        if (used.has(r.id) || seen.has(r.id) || !relOk(r, rp, b)) continue;
        seen.add(r.id); path.push(r);
        yield* dfs(m);
        path.pop(); seen.delete(r.id);
      }
    }
    yield* dfs(from);
  }
  function bindNode(b, np, n) {
    if (!nodeOk(n, np, b)) return null;
    if (np.v) { if (np.v in b && b[np.v] != null) { if (b[np.v] !== n) return null; return b; } return { ...b, [np.v]: n }; }
    return b;
  }
  function bindRel(b, rp, rl) {
    if (!rp.v) return b;
    const val = rp.varLen ? rl : rl[0];
    if (rp.v in b && b[rp.v] != null) return keyOf(b[rp.v]) === keyOf(val) ? b : null;
    return { ...b, [rp.v]: val };
  }
  // cb가 true를 돌려주면 멈춤
  function matchAll(patterns, b0, cb) {
    const used = new Set();
    let stop = false;
    function pat(i, b) {
      if (stop) return;
      if (i === patterns.length) { if (cb(b)) stop = true; return; }
      const p = patterns[i], el = p.el, N = (el.length + 1) / 2;
      // 시작 노드: 이미 묶인 변수 → 라벨·속성이 있는 노드 → 첫 노드
      let s = -1;
      for (let j = 0; j < N; j++) { const v = el[2 * j].v; if (v && v in b && b[v] != null) { s = j; break; } }
      if (s < 0) { let best = Infinity; for (let j = 0; j < N; j++) { const np = el[2 * j]; const c = np.labels.length ? Math.min(...np.labels.map(l => (G.byLabel.get(l) || []).length)) - (np.props ? 0.5 : 0) : G.nodes.length; if (c < best) { best = c; s = j; } } }
      const np0 = el[2 * s];
      const cands = np0.v && np0.v in b && b[np0.v] != null ? [b[np0.v]] : np0.labels.length ? (G.byLabel.get([...np0.labels].sort((x, y) => (G.byLabel.get(x)?.length || 0) - (G.byLabel.get(y)?.length || 0))[0]) || []) : G.nodes;
      const nodesAt = new Array(N), relsAt = new Array(N - 1);
      for (const n of cands) {
        if (np0.v && np0.v in b && b[np0.v] != null && b[np0.v] !== n) continue;
        const b1 = bindNode(b, np0, n); if (!b1) continue;
        nodesAt[s] = n;
        right(s, b1);
        if (stop) return;
      }
      function right(j, bb) {
        if (stop) return;
        if (j === N - 1) { left(s, bb); return; }
        const rp = el[2 * j + 1], np = el[2 * j + 2];
        for (const [m, rl] of steps(nodesAt[j], rp, true, used, bb)) {
          let b2 = bindRel(bb, rp, rl); if (!b2) continue;
          b2 = bindNode(b2, np, m); if (!b2) continue;
          nodesAt[j + 1] = m; relsAt[j] = rl;
          rl.forEach(r => used.add(r.id)); right(j + 1, b2); rl.forEach(r => used.delete(r.id));
          if (stop) return;
        }
      }
      function left(j, bb) {
        if (stop) return;
        if (j === 0) { done(bb); return; }
        const rp = el[2 * j - 1], np = el[2 * j - 2];
        for (const [m, rl] of steps(nodesAt[j], rp, false, used, bb)) {
          const rl2 = [...rl].reverse();
          let b2 = bindRel(bb, rp, rl2); if (!b2) continue;
          b2 = bindNode(b2, np, m); if (!b2) continue;
          nodesAt[j - 1] = m; relsAt[j - 1] = rl2;
          rl.forEach(r => used.add(r.id)); left(j - 1, b2); rl.forEach(r => used.delete(r.id));
          if (stop) return;
        }
      }
      function done(bb) {
        if (p.pathVar) {
          const nodes = [nodesAt[0]], rels = [];
          for (let j = 0; j < N - 1; j++) { let cur = nodes[nodes.length - 1]; for (const r of relsAt[j]) { rels.push(r); cur = r.start === cur ? r.end : r.start; nodes.push(cur); } }
          bb = { ...bb, [p.pathVar]: { kind: 'path', nodes, rels } };
        }
        pat(i + 1, bb);
      }
    }
    pat(0, b0);
  }

  const hasAgg = (e) => !!e && typeof e === 'object' && (e.t === 'fn' && AGG.has(e.fn) || Object.values(e).some(v => Array.isArray(v) ? v.some(x => Array.isArray(x) ? x.some(hasAgg) : hasAgg(x)) : typeof v === 'object' && v !== null && hasAgg(v)));
  function aggregate(e, group) {
    if (e.t === 'fn' && AGG.has(e.fn)) {
      if (e.star) return group.length;
      let vals = group.map(r => ev(e.args[0], r)).filter(v => v != null);
      if (e.distinct) { const s = new Set(); vals = vals.filter(v => { const k = keyOf(v); if (s.has(k)) return false; s.add(k); return true; }); }
      switch (e.fn) {
        case 'count': return vals.length;
        case 'collect': return vals;
        case 'sum': return vals.reduce((a, v) => a + v, 0);
        case 'avg': return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
        case 'min': return vals.length ? vals.reduce((a, v) => (order(v, a) < 0 ? v : a)) : null;
        case 'max': return vals.length ? vals.reduce((a, v) => (order(v, a) > 0 ? v : a)) : null;
      }
    }
    if (!hasAgg(e)) return ev(e, group[0] || {});
    // 집계가 안쪽에 있는 식: 집계 부분만 값으로 바꿔 계산
    const sub = (x) => (x && typeof x === 'object' && x.t ? (x.t === 'fn' && AGG.has(x.fn) ? { t: 'lit', v: aggregate(x, group) } : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map(y => Array.isArray(y) ? y.map(sub) : sub(y)) : sub(v)]))) : x);
    return ev(sub(e), group[0] || {});
  }
  const colName = (it) => it.as || it.text;

  function project(cl, input) {
    let items = cl.items;
    if (cl.star) { const vars = Object.keys(input[0] || {}).filter(v => !v.startsWith(' ')); items = vars.map(v => ({ e: { t: 'var', n: v }, as: v, text: v })).concat(items); }
    if (cl.c === 'WITH') for (const it of items) if (!it.as && it.e.t !== 'var') throw new CypherError(`WITH의 식에는 AS로 이름을 붙여야 합니다: ${it.text}`);
    const agg = items.some(it => hasAgg(it.e));
    let out;
    if (agg) {
      const keys = items.filter(it => !hasAgg(it.e)), groups = new Map();
      for (const r of input) { const vals = keys.map(it => ev(it.e, r)); const k = keyOf(vals); if (!groups.has(k)) groups.set(k, { r, rows: [] }); groups.get(k).rows.push(r); }
      if (!input.length && !keys.length) groups.set('', { r: {}, rows: [] });
      out = [...groups.values()].map(g => { const o = {}; for (const it of items) o[colName(it)] = aggregate(it.e, g.rows); Object.defineProperty(o, ' src', { value: g.r, enumerable: false }); return o; });
    } else out = input.map(r => { const o = {}; for (const it of items) o[colName(it)] = ev(it.e, r); Object.defineProperty(o, ' src', { value: r, enumerable: false }); return o; });
    if (cl.distinct) { const s = new Set(); out = out.filter(o => { const k = keyOf(items.map(it => o[colName(it)])); if (s.has(k)) return false; s.add(k); return true; }); }
    if (cl.order) {
      const val = (o, ob) => { const it = items.find(it => it.text === ob.text); if (it) return o[colName(it)]; return ev(ob.e, agg || cl.distinct ? o : { ...o[' src'], ...o }); };
      const dec = out.map(o => ({ o, k: cl.order.map(ob => val(o, ob)) }));
      dec.sort((x, y) => { for (let i = 0; i < cl.order.length; i++) { let c = order(x.k[i], y.k[i]); if (cl.order[i].desc) c = x.k[i] == null ? 1 : y.k[i] == null ? -1 : -c; if (c) return c; } return 0; });
      out = dec.map(d => d.o);
    }
    const skip = cl.skip ? ev(cl.skip, {}) : 0, limit = cl.limit ? ev(cl.limit, {}) : Infinity;
    out = out.slice(skip, skip + limit);
    return { out, cols: items.map(colName) };
  }

  for (const cl of clauses) {
    if (cl.c === 'MATCH') {
      const next = [];
      for (const r of rows) {
        let any = false;
        matchAll(cl.patterns, r, (b) => { if (!cl.where || truth(ev(cl.where, b))) { next.push(b); any = true; if (next.length > maxRows) throw new CypherError(`결과가 너무 많습니다 (${maxRows}행 초과). LIMIT이나 조건을 추가하세요`); } });
        if (!any && cl.optional) {
          const o = { ...r };
          for (const p of cl.patterns) { if (p.pathVar && !(p.pathVar in o)) o[p.pathVar] = null; for (const x of p.el) if (x.v && !(x.v in o)) o[x.v] = null; }
          next.push(o);
        }
      }
      rows = next;
    } else if (cl.c === 'UNWIND') {
      const next = [];
      for (const r of rows) { const l = ev(cl.e, r); if (l == null) continue; for (const v of Array.isArray(l) ? l : [l]) next.push({ ...r, [cl.as]: v }); }
      rows = next;
    } else if (cl.c === 'WITH') {
      const { out } = project(cl, rows);
      rows = out.map(o => ({ ...o }));
      if (cl.where) rows = rows.filter(r => truth(ev(cl.where, r)));
    } else {
      const { out, cols } = project(cl, rows);
      return { columns: cols, rows: out.map(o => cols.map(c => o[c])) };
    }
  }
}

// 화면·테스트용 값 → 글자
export function show(v, short = (x) => x) {
  if (v == null) return 'null';
  if (isNode(v)) return `(${v.labels[0] ? ':' + v.labels[0] + ' ' : ''}${v.props.name ?? v.props.label ?? short(v.props.uri)})`;
  if (isRel(v)) return `[:${v.type}]`;
  if (isPath(v)) return v.nodes.map(n => show(n, short)).join('→');
  if (Array.isArray(v)) return '[' + v.map(x => show(x, short)).join(', ') + ']';
  if (typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => `${k}: ${show(x, short)}`).join(', ') + '}';
  if (typeof v === 'number' && !Number.isInteger(v)) return String(Math.round(v * 1e6) / 1e6);
  return String(v);
}
