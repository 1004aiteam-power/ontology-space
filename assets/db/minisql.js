// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 브라우저 안의 작은 SQL 엔진. 데이터베이스 접근 페이지들이 "진짜 SQL 글자"를 받아 실제로 실행해 보이게 한다.
// 지원: SELECT (JOIN · WHERE · GROUP BY · 집계 · ORDER BY · LIMIT) · INSERT · UPDATE · DELETE · DROP TABLE · ? 자리표시자 · -- 주석 · ; 로 여러 문장
// 진짜 DB가 아니라 설명용이다: 인덱스 · 제약 · 타입 검사 · 동시성이 없다. 브라우저 없이 node 로 테스트: tests/db.test.mjs

export class SqlError extends Error {}

const KW = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'ORDER', 'BY', 'GROUP', 'LIMIT', 'ASC', 'DESC', 'JOIN', 'INNER', 'LEFT', 'ON', 'AS',
  'IN', 'LIKE', 'IS', 'NULL', 'DROP', 'TABLE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE']);
const AGG = new Set(['COUNT', 'AVG', 'MIN', 'MAX', 'SUM']);

export function tokenize(sql) {
  const out = [], n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === "'") {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= n) throw new SqlError('unterminated quoted string');
        if (sql[j] === "'") { if (sql[j + 1] === "'") { s += "'"; j += 2; continue; } break; }
        s += sql[j++];
      }
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    const prev = out[out.length - 1];
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(sql[i + 1] || '') && !(prev && (prev.t === 'num' || prev.t === 'str' || prev.t === 'id' || prev.v === ')')))) {
      const m = /^-?\d+(\.\d+)?/.exec(sql.slice(i));
      out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*|\.\*)?/.exec(sql.slice(i));
      const w = m[0];
      if (!w.includes('.') && KW.has(w.toUpperCase())) out.push({ t: 'kw', v: w.toUpperCase() });
      else out.push({ t: 'id', v: w });
      i += w.length; continue;
    }
    const two = sql.slice(i, i + 2);
    if (['<=', '>=', '<>', '!='].includes(two)) { out.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; continue; }
    if ('=<>'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if ('(),;*?'.includes(c)) { out.push({ t: 'p', v: c }); i++; continue; }
    throw new SqlError(`unexpected character "${c}"`);
  }
  return out;
}

class Parser {
  constructor(toks, params) { this.k = toks; this.i = 0; this.params = params || []; this.pi = 0; }
  get cur() { return this.k[this.i]; }
  is(t, v) { const c = this.cur; return c && c.t === t && (v === undefined || c.v === v); }
  eat(t, v) { if (this.is(t, v)) return this.k[this.i++]; return null; }
  need(t, v) {
    const x = this.eat(t, v);
    if (!x) throw new SqlError(`syntax error: expected ${v ?? t}${this.cur ? ` near "${this.cur.v}"` : ' at end'}`);
    return x;
  }
  ident() { return this.need('id').v; }

  statement() {
    const c = this.cur;
    if (!c) throw new SqlError('empty statement');
    if (c.t === 'kw') {
      if (c.v === 'SELECT') return this.select();
      if (c.v === 'INSERT') return this.insert();
      if (c.v === 'UPDATE') return this.update();
      if (c.v === 'DELETE') return this.del();
      if (c.v === 'DROP') { this.i++; this.need('kw', 'TABLE'); return { kind: 'drop', table: this.ident() }; }
    }
    throw new SqlError(`syntax error near "${c.v}"`);
  }

  select() {
    this.need('kw', 'SELECT');
    const items = [];
    do {
      if (this.eat('p', '*')) { items.push({ star: true }); continue; }
      const t = this.cur;
      if (t && t.t === 'id' && t.v.endsWith('.*')) { this.i++; items.push({ star: true, of: t.v.slice(0, -2) }); continue; }
      let item;
      if (t && t.t === 'id' && AGG.has(t.v.toUpperCase()) && this.k[this.i + 1]?.v === '(') {
        this.i += 2;
        const arg = this.eat('p', '*') ? '*' : this.need('id').v;
        this.need('p', ')');
        item = { agg: t.v.toUpperCase(), arg };
      } else item = { col: this.need('id').v };
      if (this.eat('kw', 'AS')) item.as = this.ident();
      items.push(item);
    } while (this.eat('p', ','));
    this.need('kw', 'FROM');
    const from = this.tableRef();
    const joins = [];
    for (;;) {
      let left = false;
      if (this.eat('kw', 'LEFT')) left = true; else this.eat('kw', 'INNER');
      if (!this.eat('kw', 'JOIN')) break;
      const ref = this.tableRef();
      this.need('kw', 'ON');
      joins.push({ ...ref, left, on: this.expr() });
    }
    const st = { kind: 'select', items, from, joins, where: null, group: [], order: [], limit: null };
    if (this.eat('kw', 'WHERE')) st.where = this.expr();
    if (this.eat('kw', 'GROUP')) { this.need('kw', 'BY'); do st.group.push(this.need('id').v); while (this.eat('p', ',')); }
    if (this.eat('kw', 'ORDER')) {
      this.need('kw', 'BY');
      do { const col = this.need('id').v; const desc = !!this.eat('kw', 'DESC'); if (!desc) this.eat('kw', 'ASC'); st.order.push({ col, desc }); } while (this.eat('p', ','));
    }
    if (this.eat('kw', 'LIMIT')) st.limit = this.value().v;
    return st;
  }
  tableRef() { const table = this.ident(); const alias = this.is('id') ? this.ident() : table; return { table, alias }; }

  insert() {
    this.need('kw', 'INSERT'); this.need('kw', 'INTO');
    const table = this.ident(), cols = [], vals = [];
    this.need('p', '(');
    do cols.push(this.ident()); while (this.eat('p', ','));
    this.need('p', ')'); this.need('kw', 'VALUES'); this.need('p', '(');
    do vals.push(this.value().v); while (this.eat('p', ','));
    this.need('p', ')');
    if (cols.length !== vals.length) throw new SqlError('column count does not match value count');
    return { kind: 'insert', table, cols, vals };
  }
  update() {
    this.need('kw', 'UPDATE');
    const table = this.ident(), sets = [];
    this.need('kw', 'SET');
    do { const col = this.ident(); this.need('op', '='); sets.push({ col, v: this.value().v }); } while (this.eat('p', ','));
    return { kind: 'update', table, sets, where: this.eat('kw', 'WHERE') ? this.expr() : null };
  }
  del() {
    this.need('kw', 'DELETE'); this.need('kw', 'FROM');
    return { kind: 'delete', table: this.ident(), where: this.eat('kw', 'WHERE') ? this.expr() : null };
  }

  // 값: 숫자 · 글자 · NULL · ? (바인딩된 값)
  value() {
    if (this.is('num') || this.is('str')) return { v: this.k[this.i++].v };
    if (this.eat('kw', 'NULL')) return { v: null };
    if (this.eat('p', '?')) {
      if (this.pi >= this.params.length) throw new SqlError('missing value for a ? placeholder');
      return { v: this.params[this.pi++], bound: true };
    }
    throw new SqlError(`syntax error: expected a value${this.cur ? ` near "${this.cur.v}"` : ''}`);
  }
  operand() { return this.is('id') ? { col: this.k[this.i++].v } : { lit: this.value().v }; }

  expr() { let l = this.and(); while (this.eat('kw', 'OR')) l = { op: 'or', l, r: this.and() }; return l; }
  and() { let l = this.not(); while (this.eat('kw', 'AND')) l = { op: 'and', l, r: this.not() }; return l; }
  not() { return this.eat('kw', 'NOT') ? { op: 'not', e: this.not() } : this.cmp(); }
  cmp() {
    if (this.eat('p', '(')) { const e = this.expr(); this.need('p', ')'); return e; }
    const l = this.operand();
    if (this.is('op')) { const cmp = this.k[this.i++].v; return { op: 'cmp', cmp, l, r: this.operand() }; }
    if (this.eat('kw', 'LIKE')) return { op: 'like', l, r: this.operand() };
    if (this.eat('kw', 'IN')) {
      this.need('p', '(');
      const list = [];
      do list.push(this.value().v); while (this.eat('p', ','));
      this.need('p', ')');
      return { op: 'in', l, list };
    }
    if (this.eat('kw', 'IS')) { const not = !!this.eat('kw', 'NOT'); this.need('kw', 'NULL'); return { op: 'isnull', l, not }; }
    throw new SqlError(`syntax error: expected a comparison${this.cur ? ` near "${this.cur.v}"` : ''}`);
  }
}

// ; 로 나뉜 문장들을 구문 트리로 (실행하지 않음). 바인딩 값은 params 로 (없으면 ? 는 undefined 자리)
export function parse(sql, params) {
  const toks = tokenize(sql), stmts = [];
  let cur = [];
  for (const t of toks) { if (t.t === 'p' && t.v === ';') { if (cur.length) stmts.push(cur); cur = []; } else cur.push(t); }
  if (cur.length) stmts.push(cur);
  const p = { pi: 0 };
  return stmts.map(s => {
    const ps = new Parser(s, params ? params.slice(p.pi) : new Array(40).fill(undefined));
    const st = ps.statement();
    if (ps.cur) throw new SqlError(`syntax error near "${ps.cur.v}"`);
    p.pi += ps.pi;
    return st;
  });
}

// 안전 점검용: 문장 종류 · 건드리는 표 · LIMIT
export function analyze(sql) {
  return parse(sql).map(s => ({ kind: s.kind, tables: [s.table ?? s.from?.table, ...(s.joins || []).map(j => j.table)].filter(Boolean), limit: s.limit ?? null }));
}

const like = (v, pat) => new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i').test(String(v));
const cmpv = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b));

export class Database {
  // tables: { 이름: { cols: [...], rows: [{...}] } } — 복사해서 가진다
  constructor(tables) { this.t = structuredClone(tables); this.log = []; this.stack = []; }
  get queryCount() { return this.log.length; }
  resetLog() { this.log = []; }
  begin() { this.stack.push(structuredClone(this.t)); }
  commit() { this.stack.pop(); }
  rollback() { const s = this.stack.pop(); if (s) this.t = s; }
  tableNames() { return Object.keys(this.t); }
  table(name) { const x = this.t[name]; if (!x) throw new SqlError(`no such table: ${name}`); return x; }

  // 실행한 문장은 log 에 남긴다 (몇 번 물어봤는지 세는 데 쓴다). single: 문장 하나만 허용하는 드라이버처럼
  exec(sql, params = [], { single = false } = {}) {
    this.log.push({ sql, params });
    const stmts = parse(sql, params);
    if (single && stmts.length > 1) throw new SqlError('you can only execute one statement at a time');
    let res = { kind: 'none', columns: [], rows: [], rowCount: 0 };
    for (const s of stmts) res = this.run(s);
    return res;
  }

  lookup(ctx, name) {
    if (name.includes('.')) {
      const [a, c] = name.split('.');
      if (!(a in ctx.rows)) throw new SqlError(`no such column: ${name}`);
      if (!ctx.cols[a].includes(c)) throw new SqlError(`no such column: ${name}`);
      return ctx.rows[a][c];
    }
    const hit = Object.keys(ctx.rows).filter(a => ctx.cols[a].includes(name));
    if (hit.length === 0) throw new SqlError(`no such column: ${name}`);
    if (hit.length > 1) throw new SqlError(`ambiguous column name: ${name}`);
    return ctx.rows[hit[0]][name];
  }
  evalOp(o, ctx) { return 'col' in o ? this.lookup(ctx, o.col) : o.lit; }
  test(e, ctx) {
    if (!e) return true;
    switch (e.op) {
      case 'and': return this.test(e.l, ctx) && this.test(e.r, ctx);
      case 'or': return this.test(e.l, ctx) || this.test(e.r, ctx);
      case 'not': return !this.test(e.e, ctx);
      case 'like': return like(this.evalOp(e.l, ctx), this.evalOp(e.r, ctx));
      case 'in': return e.list.some(v => cmpv(this.evalOp(e.l, ctx), v) === 0);
      case 'isnull': { const v = this.evalOp(e.l, ctx); return e.not ? v != null : v == null; }
      default: {
        const a = this.evalOp(e.l, ctx), b = this.evalOp(e.r, ctx);
        if (a == null || b == null) return false;
        const d = cmpv(a, b);
        return { '=': d === 0, '!=': d !== 0, '<': d < 0, '>': d > 0, '<=': d <= 0, '>=': d >= 0 }[e.cmp];
      }
    }
  }

  run(s) {
    if (s.kind === 'drop') { this.table(s.table); delete this.t[s.table]; return { kind: 'drop', columns: [], rows: [], rowCount: 0 }; }
    if (s.kind === 'insert') {
      const t = this.table(s.table);
      for (const c of s.cols) if (!t.cols.includes(c)) throw new SqlError(`table ${s.table} has no column named ${c}`);
      const row = Object.fromEntries(t.cols.map(c => [c, null]));
      s.cols.forEach((c, i) => { row[c] = s.vals[i]; });
      t.rows.push(row);
      return { kind: 'insert', columns: [], rows: [], rowCount: 1 };
    }
    if (s.kind === 'update' || s.kind === 'delete') {
      const t = this.table(s.table), cols = { [s.table]: t.cols };
      for (const c of (s.sets || [])) if (!t.cols.includes(c.col)) throw new SqlError(`no such column: ${c.col}`);
      const hit = t.rows.filter(r => this.test(s.where, { rows: { [s.table]: r }, cols }));
      if (s.kind === 'update') for (const r of hit) for (const c of s.sets) r[c.col] = c.v;
      else t.rows = t.rows.filter(r => !hit.includes(r));
      return { kind: s.kind, columns: [], rows: [], rowCount: hit.length };
    }
    return this.select(s);
  }

  select(s) {
    const refs = [s.from, ...s.joins], cols = {};
    for (const r of refs) { if (r.alias in cols) throw new SqlError(`ambiguous alias: ${r.alias}`); cols[r.alias] = this.table(r.table).cols; }
    let ctxs = this.table(s.from.table).rows.map(r => ({ rows: { [s.from.alias]: r }, cols }));
    for (const j of s.joins) {
      const right = this.table(j.table).rows, next = [];
      const blank = Object.fromEntries(cols[j.alias].map(c => [c, null]));
      for (const c of ctxs) {
        const m = right.filter(r => this.test(j.on, { rows: { ...c.rows, [j.alias]: r }, cols }));
        for (const r of m) next.push({ rows: { ...c.rows, [j.alias]: r }, cols });
        if (!m.length && j.left) next.push({ rows: { ...c.rows, [j.alias]: blank }, cols });
      }
      ctxs = next;
    }
    ctxs = ctxs.filter(c => this.test(s.where, c));

    const aggs = s.items.some(i => i.agg);
    const outCols = [];
    const name = (it) => it.as || (it.agg ? it.agg.toLowerCase() : it.col.split('.').pop());
    for (const it of s.items) {
      if (it.star) for (const a of Object.keys(cols)) { if (!it.of || it.of === a) for (const c of cols[a]) outCols.push({ star: true, a, c, n: c }); }
      else outCols.push({ it, n: name(it) });
    }
    const seen = new Set();
    for (const o of outCols) { let k = o.n, x = 2; while (seen.has(k)) k = `${o.n}_${x++}`; o.n = k; seen.add(k); }

    let rows;
    if (aggs || s.group.length) {
      const groups = new Map();
      for (const c of ctxs) { const key = JSON.stringify(s.group.map(g => this.lookup(c, g))); (groups.get(key) || groups.set(key, []).get(key)).push(c); }
      if (!groups.size && !s.group.length) groups.set('', []);
      rows = [...groups.values()].map(g => {
        const r = {};
        for (const o of outCols) {
          if (o.star) throw new SqlError('* cannot be used with GROUP BY or aggregates');
          const it = o.it;
          if (!it.agg) { r[o.n] = g.length ? this.lookup(g[0], it.col) : null; continue; }
          const vals = it.arg === '*' ? g.map(() => 1) : g.map(c => this.lookup(c, it.arg)).filter(v => v != null);
          r[o.n] = it.agg === 'COUNT' ? vals.length : !vals.length ? null :
            it.agg === 'SUM' ? vals.reduce((a, b) => a + b, 0) : it.agg === 'AVG' ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 :
            vals.reduce((a, b) => (it.agg === 'MIN' ? (cmpv(b, a) < 0 ? b : a) : (cmpv(b, a) > 0 ? b : a)));
        }
        r.__g = g[0];
        return r;
      });
    } else {
      rows = ctxs.map(c => {
        const r = {};
        for (const o of outCols) r[o.n] = o.star ? c.rows[o.a][o.c] : this.lookup(c, o.it.col);
        r.__g = c;
        return r;
      });
    }
    for (let k = s.order.length - 1; k >= 0; k--) {
      const { col, desc } = s.order[k], alias = outCols.find(o => o.n === col);
      const val = (r) => alias ? r[col] : this.lookup(r.__g, col);
      rows.sort((a, b) => (desc ? -1 : 1) * cmpv(val(a), val(b)));
    }
    if (s.limit != null) rows = rows.slice(0, s.limit);
    rows = rows.map(({ __g, ...r }) => r);
    return { kind: 'select', columns: outCols.map(o => o.n), rows, rowCount: rows.length };
  }
}
