// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 브라우저 안의 작은 Git: 객체(blob · tree · commit) · 참조 · 스테이지 · 작업 폴더 · 3-way 병합.
// 객체 이름은 진짜 Git 과 같은 SHA-1 ("blob <길이>\0내용"). 단순화한 점: 트리는 중첩 없이 경로 → blob 한 장짜리 목록이다.
// 브라우저 없이 node 로 테스트: tests/git.test.mjs
import { sha1 } from './sha1.js?v=9e547634';

export class GitError extends Error {}
const enc = new TextEncoder();
// 시뮬레이터에만 있는 안내문: 한국어 · 영어 (git 이 내는 메시지는 원문 그대로 영어)
export const L = (ko, en) => (globalThis.window?.t ? globalThis.window.t({ ko, en }) : ko);

export const SIZE = '@@SIZE:';                                   // 큰 파일 흉내: 내용 대신 크기(바이트)만 적은 파일
export const sizeOf = (c) => (c.startsWith(SIZE) ? Number(c.slice(SIZE.length)) : enc.encode(c).length);
export const split = (t) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
export const join = (ls) => (ls.length ? ls.join('\n') + '\n' : '');

export function hashObject(type, body) {
  const b = enc.encode(body), head = enc.encode(`${type} ${b.length}\0`);
  return sha1(Uint8Array.from([...head, ...b]));
}
export const short = (h) => (h ? h.slice(0, 7) : '0000000');

// ---- 줄 단위 비교 (LCS) ----
function lcsOps(A, B) {
  const n = A.length, m = B.length, T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = A[i] === B[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { ops.push({ t: ' ', l: A[i] }); i++; j++; }
    else if (i < n && (j >= m || T[i + 1][j] >= T[i][j + 1])) { ops.push({ t: '-', l: A[i] }); i++; }      // 같으면 삭제를 먼저 (git diff 처럼)
    else { ops.push({ t: '+', l: B[j] }); j++; }
  }
  return ops;
}
export const lineDiff = (a, b) => lcsOps(split(a), split(b));
// base 의 [s,e) 줄을 repl 로 바꾼다는 "고친 곳" 목록
function hunks(B, X) {
  const out = [];
  let i = 0, cur = null;
  for (const o of lcsOps(B, X)) {
    if (o.t === ' ') { if (cur) { out.push(cur); cur = null; } i++; }
    else if (o.t === '+') { cur ||= { s: i, e: i, repl: [] }; cur.repl.push(o.l); }
    else { cur ||= { s: i, e: i, repl: [] }; cur.e = i + 1; i++; }
  }
  if (cur) out.push(cur);
  return out;
}

// 세 갈래 병합 (base · ours · theirs). 겹치지 않는 고침은 둘 다 반영하고, 같은 곳을 다르게 고쳤으면 충돌 표시를 남긴다
export function merge3(base, ours, theirs, la = 'HEAD', lb = 'theirs') {
  if (ours === theirs) return { text: ours, conflict: false };
  if (base === ours) return { text: theirs, conflict: false };
  if (base === theirs) return { text: ours, conflict: false };
  const B = split(base), HA = hunks(B, split(ours)).map(h => ({ ...h, side: 'a' })), HB = hunks(B, split(theirs)).map(h => ({ ...h, side: 'b' }));
  const all = [...HA, ...HB].sort((x, y) => x.s - y.s || x.e - y.e);
  const out = [];
  let pos = 0, k = 0, conflict = false;
  const apply = (hs, S, E) => { const r = []; let p = S; for (const h of hs) { r.push(...B.slice(p, h.s), ...h.repl); p = h.e; } r.push(...B.slice(p, E)); return r; };
  while (k < all.length) {
    const cl = [all[k++]];
    const S = cl[0].s;
    let E = cl[0].e;
    while (k < all.length && (all[k].s < E || all[k].s === S || (all[k].s === E && all[k].e === all[k].s))) { E = Math.max(E, all[k].e); cl.push(all[k++]); }
    out.push(...B.slice(pos, S));
    const a = cl.filter(h => h.side === 'a'), b = cl.filter(h => h.side === 'b');
    const ta = apply(a, S, E), tb = apply(b, S, E);
    if (!a.length) out.push(...tb);
    else if (!b.length || ta.join('\n') === tb.join('\n')) out.push(...ta);
    else { conflict = true; out.push(`<<<<<<< ${la}`, ...ta, '=======', ...tb, `>>>>>>> ${lb}`); }
    pos = E;
  }
  out.push(...B.slice(pos));
  return { text: join(out), conflict };
}

// 파일 단위 세 갈래 병합. 입력은 경로 → 내용(글자) 표. 돌려주는 것: 합쳐진 표와 충돌 목록
export function mergeTrees(base, ours, theirs, la, lb) {
  const merged = new Map(), conflicts = [];
  for (const p of new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])) {
    const b = base.get(p), o = ours.get(p), t = theirs.get(p);
    const put = (v) => { if (v !== undefined) merged.set(p, v); };
    if (o === t) put(o);
    else if (b === o) put(t);
    else if (b === t) put(o);
    else if (o === undefined || t === undefined) { put(o ?? t); conflicts.push({ path: p, kind: o === undefined ? 'modify/delete (deleted by HEAD)' : 'modify/delete (deleted by theirs)' }); }
    else { const r = merge3(b ?? '', o, t, la, lb); merged.set(p, r.text); if (r.conflict) conflicts.push({ path: p, kind: b === undefined ? 'add/add' : 'content' }); }
  }
  return { merged, conflicts };
}

// .gitignore 한 줄을 정규식으로 (이름 · *.확장자 · 폴더/ · 경로)
function ignoreRe(line) {
  let p = line.trim();
  if (!p || p.startsWith('#')) return null;
  const dir = p.endsWith('/');
  if (dir) p = p.slice(0, -1);
  const anchored = p.startsWith('/');
  p = p.replace(/^\//, '');
  const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`${anchored || p.includes('/') ? '^' : '(^|/)'}${body}${dir ? '/' : '(/|$)'}`);
}

export class Repo {
  constructor(clock) {
    this.clock = clock;
    this.objects = new Map(); this.refs = new Map();
    this.head = { ref: 'refs/heads/main' };
    this.index = new Map(); this.work = new Map();
    this.reflog = []; this.config = { 'user.name': 'You', 'user.email': 'you@example.com' };
    this.remotes = {}; this.upstream = {}; this.stashes = [];
    this.merge = null; this.rebase = null; this.origHead = null;
    this.bare = false; this.inited = false; this.protectedBranches = new Set(); this.locks = new Set();
  }

  // ---- 객체 ----
  put(type, body, extra) { const h = hashObject(type, body); if (!this.objects.has(h)) this.objects.set(h, { type, ...extra }); return h; }
  blob(content) { return this.put('blob', content, { content }); }
  tree(map) {
    const entries = [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return this.put('tree', entries.map(([p, h]) => `${p}\0${h}`).join('\n'), { entries });
  }
  commit({ tree, parents, msg }) {
    const time = this.clock.tick(), who = `${this.config['user.name']} <${this.config['user.email']}>`;
    const body = `tree ${tree}\n${parents.map(p => `parent ${p}\n`).join('')}author ${who} ${time} +0000\ncommitter ${who} ${time} +0000\n\n${msg}\n`;
    return this.put('commit', body, { tree, parents, msg, author: who, time });
  }
  obj(h) { const o = this.objects.get(h); if (!o) throw new GitError(`fatal: bad object ${h}`); return o; }
  treeMap(commitHash) { return commitHash ? new Map(this.obj(this.obj(commitHash).tree).entries) : new Map(); }
  contents(treeMap) { return new Map([...treeMap].map(([p, h]) => [p, this.obj(h).content])); }

  // ---- 참조 ----
  headHash() { return this.head.ref ? this.refs.get(this.head.ref) || null : this.head.hash; }
  branch() { return this.head.ref ? this.head.ref.replace('refs/heads/', '') : null; }
  branches() { return [...this.refs.keys()].filter(r => r.startsWith('refs/heads/')).map(r => r.slice(11)).sort(); }
  moveHead(hash, msg) {
    const from = this.headHash();
    if (this.head.ref) this.refs.set(this.head.ref, hash); else this.head.hash = hash;
    this.reflog.unshift({ from, to: hash, msg });
  }
  note(hash, msg) { this.reflog.unshift({ from: this.headHash(), to: hash, msg }); }

  // ---- 이력 ----
  ancestors(h) {
    const seen = new Set(), st = h ? [h] : [];
    while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); st.push(...this.obj(x).parents); }
    return seen;
  }
  isAncestor(a, b) { return this.ancestors(b).has(a); }
  mergeBase(a, b) {
    if (!a || !b) return null;
    const A = this.ancestors(a), B = this.ancestors(b), common = [...A].filter(x => B.has(x));
    const best = common.filter(x => !common.some(y => y !== x && this.ancestors(y).has(x)));
    return best.sort((x, y) => this.obj(y).time - this.obj(x).time)[0] || null;
  }
  allTips() { return [...this.refs.values(), ...(this.head.ref ? [] : [this.head.hash])].filter(Boolean); }
  reachable(tips = this.allTips()) { const s = new Set(); for (const t of tips) for (const x of this.ancestors(t)) s.add(x); return s; }
  history(h) { return [...this.ancestors(h)].sort((x, y) => this.obj(y).time - this.obj(x).time); }     // 최신순
  decorations(h) {
    const d = [];
    const cur = this.headHash() === h;
    if (cur) d.push(this.head.ref ? `HEAD -> ${this.branch()}` : 'HEAD');
    for (const [r, x] of this.refs) if (x === h) { if (r.startsWith('refs/heads/') && !(cur && this.head.ref === r)) d.push(r.slice(11)); else if (r.startsWith('refs/remotes/')) d.push(r.slice(13)); else if (r.startsWith('refs/tags/')) d.push(`tag: ${r.slice(10)}`); }
    return d;
  }

  // ---- 리비전 해석: HEAD · HEAD~2 · HEAD^ · 브랜치 · origin/main · 태그 · 해시 앞자리 · HEAD@{1} · ORIG_HEAD ----
  resolve(rev) {
    let m = /^(.*?)((?:[~^]\d*)+)$/.exec(rev), base = rev, steps = [];
    if (m && m[1]) { base = m[1]; steps = [...m[2].matchAll(/([~^])(\d*)/g)].map(x => [x[1], x[2] === '' ? 1 : +x[2]]); }
    let h;
    const rl = /^(.*)@\{(\d+)\}$/.exec(base);
    if (rl && (rl[1] === 'HEAD' || rl[1] === '')) { const e = this.reflog[+rl[2]]; if (!e) throw new GitError(`fatal: log for 'HEAD' only has ${this.reflog.length} entries`); h = e.to; }
    else if (base === 'HEAD' || base === '@') h = this.headHash();
    else if (base === 'ORIG_HEAD') h = this.origHead;
    else if (base === 'MERGE_HEAD') h = this.merge?.theirs;
    else if (this.refs.has(`refs/heads/${base}`)) h = this.refs.get(`refs/heads/${base}`);
    else if (this.refs.has(`refs/remotes/${base}`)) h = this.refs.get(`refs/remotes/${base}`);
    else if (this.refs.has(`refs/tags/${base}`)) h = this.refs.get(`refs/tags/${base}`);
    else if (/^[0-9a-f]{4,40}$/.test(base)) { const c = [...this.objects].filter(([k, o]) => o.type === 'commit' && k.startsWith(base)).map(([k]) => k); if (c.length === 1) h = c[0]; else if (c.length > 1) throw new GitError(`fatal: ambiguous argument '${rev}'`); }
    if (!h) throw new GitError(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`);
    for (const [k, n] of steps) for (let i = 0; i < n; i++) { const p = this.obj(h).parents[k === '~' ? 0 : 0]; if (!p) throw new GitError(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`); h = p; }
    return h;
  }

  // ---- 무시 규칙 ----
  isIgnored(path) {
    const g = this.work.get('.gitignore');
    if (!g) return false;
    let ig = false;
    for (const line of split(g)) {
      const neg = line.startsWith('!'), re = ignoreRe(neg ? line.slice(1) : line);
      if (re && re.test(path)) ig = !neg;
    }
    return ig;
  }

  // ---- 상태 ----
  blobOfWork(p) { return hashObject('blob', this.work.get(p)); }
  status() {
    const head = this.treeMap(this.headHash());
    const staged = [], unstaged = [], untracked = [];
    for (const [p, h] of this.index) { if (!head.has(p)) staged.push({ path: p, kind: 'new file' }); else if (head.get(p) !== h) staged.push({ path: p, kind: 'modified' }); }
    for (const p of head.keys()) if (!this.index.has(p)) staged.push({ path: p, kind: 'deleted' });
    for (const [p, h] of this.index) {
      if (this.merge?.conflicts.includes(p)) continue;
      if (!this.work.has(p)) unstaged.push({ path: p, kind: 'deleted' }); else if (this.blobOfWork(p) !== h) unstaged.push({ path: p, kind: 'modified' });
    }
    for (const p of this.work.keys()) if (!this.index.has(p) && !this.isIgnored(p)) untracked.push(p);
    const key = (x) => x.path;
    return { staged: staged.sort((a, b) => (key(a) < key(b) ? -1 : 1)), unstaged: unstaged.sort((a, b) => (key(a) < key(b) ? -1 : 1)), untracked: untracked.sort() };
  }
  dirty(p) {   // 스테이지나 작업 폴더에 HEAD 와 다른 고침이 있는 경로
    const head = this.treeMap(this.headHash());
    if ((head.get(p) ?? null) !== (this.index.get(p) ?? null)) return true;
    if (this.index.has(p)) return !this.work.has(p) || this.blobOfWork(p) !== this.index.get(p);
    return false;
  }

  // 트리 하나를 스테이지와 작업 폴더에 그대로 펼친다 (checkout · reset --hard)
  materialize(newTree) {
    for (const p of this.index.keys()) if (!newTree.has(p)) this.work.delete(p);
    this.index = new Map(newTree);
    for (const [p, h] of newTree) this.work.set(p, this.obj(h).content);
  }
}
