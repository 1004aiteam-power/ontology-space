// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 브라우저 안의 작은 Git 터미널: 셸 명령(echo · cat · ls …)과 git 명령, 그리고 "GitHub" 역할을 하는 원격 저장소(hub).
// 출력 문장은 진짜 git 이 내는 것과 같은 영어 원문을 따른다. 브라우저 없이 node 로 테스트: tests/git.test.mjs
import { Repo, GitError, L, mergeTrees, lineDiff, short, split, join, sizeOf, SIZE, hashObject } from './core.js?v=1f5924e3';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
const fmtDate = (t) => { const d = new Date(t * 1000); return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${d.getUTCFullYear()} +0000`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const MB = 1024 * 1024, LIMIT = 100 * MB;
const normUrl = (u) => u.replace(/\/+$/, '').replace(/\.git$/, '');

function tokenize(line) {
  const toks = [];
  let cur = '', q = null, has = false;
  const flush = () => { if (has || cur) toks.push({ v: cur }); cur = ''; has = false; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && '"\\$'.includes(line[i + 1] || ' ')) cur += line[++i]; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { flush(); continue; }
    if (c === '&' && line[i + 1] === '&') { flush(); toks.push({ op: '&&' }); i++; continue; }
    if (c === '>') { flush(); if (line[i + 1] === '>') { toks.push({ op: '>>' }); i++; } else toks.push({ op: '>' }); continue; }
    cur += c; has = true;
  }
  if (q) throw new GitError(`bash: unexpected EOF while looking for matching \`${q}'`);
  flush();
  return toks;
}

// 인자 나누기: flags(참/거짓 옵션), vals(값을 받는 옵션), rest(나머지)
function parseArgs(args, valOpts = []) {
  const flags = new Set(), vals = {}, rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push('--', ...args.slice(i + 1)); break; }
    if (valOpts.includes(a)) { vals[a] = args[++i]; continue; }
    const eq = /^(--[a-z-]+)=(.*)$/.exec(a);
    if (eq && valOpts.includes(eq[1])) { vals[eq[1]] = eq[2]; continue; }
    if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) flags.add(a); else rest.push(a);
  }
  return { flags, vals, rest };
}

function diffText(oldC, newC, paths) {
  const out = [];
  for (const p of [...new Set([...oldC.keys(), ...newC.keys()])].sort()) {
    if (paths?.length && !paths.some(x => p === x || p.startsWith(x.replace(/\/$/, '') + '/'))) continue;
    const a = oldC.get(p), b = newC.get(p);
    if (a === b) continue;
    out.push(`diff --git a/${p} b/${p}`);
    if (a === undefined) out.push('new file mode 100644'); else if (b === undefined) out.push('deleted file mode 100644');
    out.push(`index ${a === undefined ? '0000000' : short(hashObject('blob', a))}..${b === undefined ? '0000000' : short(hashObject('blob', b))}${a !== undefined && b !== undefined ? ' 100644' : ''}`);
    if ((a || '').startsWith(SIZE) || (b || '').startsWith(SIZE)) { out.push(`Binary files a/${p} and b/${p} differ`); continue; }
    out.push(a === undefined ? '--- /dev/null' : `--- a/${p}`, b === undefined ? '+++ /dev/null' : `+++ b/${p}`);
    const ops = lineDiff(a ?? '', b ?? ''), n1 = ops.filter(o => o.t !== '+').length, n2 = ops.filter(o => o.t !== '-').length;
    out.push(`@@ -${n1 ? 1 : 0}${n1 === 1 ? '' : ',' + n1} +${n2 ? 1 : 0}${n2 === 1 ? '' : ',' + n2} @@`);
    for (const o of ops) out.push(o.t + o.l);
  }
  return out.join('\n');
}
function diffStat(oldC, newC) {
  let files = 0, ins = 0, del = 0;
  const extra = [];
  for (const p of [...new Set([...oldC.keys(), ...newC.keys()])].sort()) {
    const a = oldC.get(p), b = newC.get(p);
    if (a === b) continue;
    files++;
    for (const o of lineDiff(a ?? '', b ?? '')) { if (o.t === '+') ins++; else if (o.t === '-') del++; }
    if (a === undefined) extra.push(` create mode 100644 ${p}`); else if (b === undefined) extra.push(` delete mode 100644 ${p}`);
  }
  if (!files) return '';
  return [` ${plural(files, 'file')} changed${ins ? `, ${plural(ins, 'insertion')}(+)` : ''}${del ? `, ${plural(del, 'deletion')}(-)` : ''}`, ...extra].join('\n');
}

export class Session {
  constructor() {
    this.hub = new Map(); this.dirs = new Map(); this.cwd = '';
    this.t = 1700000000; this.clock = { tick: () => (this.t += 60) };
  }
  get repo() { return this.dirs.get(this.cwd) ?? null; }
  newRepo() { return new Repo(this.clock); }
  prompt() {
    const r = this.repo;
    const where = this.cwd || '~';
    const b = r?.inited ? (r.head.ref ? r.branch() : `HEAD detached at ${short(r.headHash())}`) : null;
    return `${where}${b ? ` (${r.rebase ? 'rebase' : r.merge?.conflicts?.length ? 'MERGING' : b})` : ''} $`;
  }

  // ---- 시나리오 도우미 (화면에 출력하지 않음) ----
  sh(line) { const r = this.run(line); if (!r.ok) throw new Error(`setup failed: ${line}\n${r.out}`); return r.out; }
  script(lines) { for (const l of lines) this.sh(l); }
  mkdir(name) { if (!this.dirs.has(name)) { const r = this.newRepo(); r.inited = false; this.dirs.set(name, r); } }
  hubRepo(url) { return this.hub.get(normUrl(url)); }
  hubCreate(url, files = {}, { branch = 'main', msg = 'Initial commit', protect = [] } = {}) {
    const r = this.newRepo();
    r.bare = true; r.inited = true; r.head = { ref: `refs/heads/${branch}` };
    r.config['user.name'] = 'GitHub'; r.config['user.email'] = 'noreply@github.com';
    if (Object.keys(files).length) {
      const t = new Map(Object.entries(files).map(([p, c]) => [p, r.blob(c)]));
      const h = r.commit({ tree: r.tree(t), parents: [], msg });
      r.refs.set(`refs/heads/${branch}`, h);
    }
    for (const b of protect) r.protectedBranches.add(b);
    this.hub.set(normUrl(url), r);
    return r;
  }
  // 동료가 GitHub 에 직접 커밋을 올렸다고 치고 원격 저장소를 앞으로 보낸다
  teammate(url, branch, files, msg, who = ['Teammate', 'mate@example.com']) {
    const r = this.hubRepo(url), ref = `refs/heads/${branch}`, parent = r.refs.get(ref) || null;
    const t = r.treeMap(parent);
    for (const [p, c] of Object.entries(files)) { if (c === null) t.delete(p); else t.set(p, r.blob(c)); }
    const keep = [r.config['user.name'], r.config['user.email']];
    [r.config['user.name'], r.config['user.email']] = who;
    const h = r.commit({ tree: r.tree(t), parents: parent ? [parent] : [], msg });
    [r.config['user.name'], r.config['user.email']] = keep;
    r.refs.set(ref, h);
    return h;
  }

  // ---- 한 줄 실행 ----
  run(line) {
    let toks;
    try { toks = tokenize(line.trim()); } catch (e) { return { out: e.message, ok: false }; }
    const groups = [[]];
    for (const t of toks) { if (t.op === '&&') groups.push([]); else groups.at(-1).push(t); }
    const outs = [];
    for (const g of groups) {
      if (!g.length) continue;
      try { const o = this.exec(g); if (o) outs.push(o); } catch (e) { if (!(e instanceof GitError)) throw e; outs.push(e.message); return { out: outs.join('\n'), ok: false }; }
    }
    return { out: outs.join('\n'), ok: true };
  }

  exec(toks) {
    let redir = null;
    const words = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].op) { redir = { op: toks[i].op, file: toks[i + 1]?.v }; i++; } else words.push(toks[i].v);
    }
    const [cmd, ...args] = words;
    if (!cmd) return '';
    const out = this.dispatch(cmd, args);
    if (redir) { this.writeFile(redir.file, out, redir.op === '>>'); return ''; }
    return out;
  }

  needDir() { const r = this.repo; if (!r) throw new GitError(L('bash: 먼저 디렉터리가 필요합니다 (mkdir 이름 && cd 이름)', 'bash: you need a directory first (mkdir name && cd name)')); return r; }
  writeFile(file, text, append) {
    if (!file) throw new GitError('bash: syntax error near unexpected token `newline\'');
    const r = this.needDir();
    r.work.set(file, (append ? r.work.get(file) ?? '' : '') + (text.endsWith('\n') || text === '' ? text : text + '\n'));
  }

  dispatch(cmd, a) {
    switch (cmd) {
      case 'git': return this.git(a);
      case 'echo': return a.join(' ').replace(/\\n/g, '\n');
      case 'cat': return a.map(f => { const r = this.needDir(); if (!r.work.has(f)) throw new GitError(`cat: ${f}: No such file or directory`); const c = r.work.get(f); return c.startsWith(SIZE) ? `(binary, ${(sizeOf(c) / MB).toFixed(0)} MB)` : c.replace(/\n$/, ''); }).join('\n');
      case 'touch': { const r = this.needDir(); for (const f of a) if (!r.work.has(f)) r.work.set(f, ''); return ''; }
      case 'rm': { const r = this.needDir(); const f = a.filter(x => !x.startsWith('-')); for (const x of f) { if (x === '.git/index.lock') { if (!r.locks.has('index')) throw new GitError("rm: cannot remove '.git/index.lock': No such file or directory"); r.locks.delete('index'); continue; } if (!r.work.has(x) && !a.includes('-f')) throw new GitError(`rm: cannot remove '${x}': No such file or directory`); r.work.delete(x); } return ''; }
      case 'mv': { const r = this.needDir(); const [x, y] = a; if (!r.work.has(x)) throw new GitError(`mv: cannot stat '${x}': No such file or directory`); r.work.set(y, r.work.get(x)); r.work.delete(x); return ''; }
      case 'mkdir': for (const x of a.filter(y => !y.startsWith('-'))) { if (this.cwd === '') this.mkdir(x); } return '';
      case 'cd': {
        const d = a[0];
        if (!d || d === '~' || d === '..' || d === '/') { this.cwd = ''; return ''; }
        if (!this.dirs.has(d.replace(/\/$/, ''))) throw new GitError(`bash: cd: ${d}: No such file or directory`);
        this.cwd = d.replace(/\/$/, ''); return '';
      }
      case 'pwd': return `/home/user${this.cwd ? '/' + this.cwd : ''}`;
      case 'ls': {
        if (!this.cwd) return [...this.dirs.keys()].sort().join('  ');
        const r = this.repo, names = new Set();
        for (const p of r.work.keys()) { const s = p.split('/'); names.add(s.length > 1 ? s[0] + '/' : p); }
        if (a.includes('-a') && r.inited) names.add('.git/');
        const vis = [...names].filter(n => a.includes('-a') || !n.startsWith('.')).sort();
        return a.includes('-l') ? vis.map(n => { const c = r.work.get(n); return `-rw-r--r-- ${String(c !== undefined ? sizeOf(c) : 4096).padStart(9)} ${n}`; }).join('\n') : vis.join('  ');
      }
      case 'fallocate': case 'truncate': {      // 큰 파일 흉내: fallocate big.bin 120MB
        const r = this.needDir(), f = a.find(x => !x.startsWith('-') && !/^\d+(\.\d+)?[KMG]?B?$/i.test(x)), sz = a.find(x => /^\d+(\.\d+)?[KMG]?B?$/i.test(x));
        if (!f || !sz) throw new GitError('usage: fallocate <file> <size, e.g. 120MB>');
        const m = /^(\d+(?:\.\d+)?)([KMG]?)B?$/i.exec(sz), mult = { '': 1, K: 1024, M: MB, G: 1024 * MB }[m[2].toUpperCase()];
        r.work.set(f, SIZE + Math.round(+m[1] * mult)); return '';
      }
      case 'nano': case 'vim': case 'vi': case 'code': return L("(이 시뮬레이터에는 편집기가 없습니다. echo '내용' > 파일 로 고치세요)", "(no editor in this simulator; change a file with: echo 'text' > file)");
      case 'clear': return '';
      case 'help': return this.help();
      default: throw new GitError(`bash: ${cmd}: command not found`);
    }
  }
  help() {
    return L('사용할 수 있는 명령\n  git …                       (status add commit log diff branch switch merge rebase stash reset restore revert reflog remote fetch pull push clone …)\n  echo "글" > 파일 · >> 파일   파일 쓰기 / 덧붙이기      cat 파일 · ls · rm 파일 · mv 가 나\n  fallocate 파일 120MB         큰 파일 흉내               mkdir 폴더 && cd 폴더 · cd ..',
      'Available commands\n  git …                       (status add commit log diff branch switch merge rebase stash reset restore revert reflog remote fetch pull push clone …)\n  echo "text" > file · >> file  write / append a file      cat file · ls · rm file · mv a b\n  fallocate file 120MB          fake a big file            mkdir dir && cd dir · cd ..');
  }

  // ================= git =================
  git(a) {
    const [sub, ...args] = a;
    if (!sub) return 'usage: git <command> [<args>]';
    if (sub === '--version' || sub === 'version') return 'git version 2.43.0';
    const fn = GIT[sub === 'checkout' ? 'checkout' : sub];
    if (!fn) throw new GitError(`git: '${sub}' is not a git command. See 'git --help'.`);
    if (sub === 'init' || sub === 'clone') return fn(this, null, args);
    const r = this.repo;
    if (!r || !r.inited) throw new GitError('fatal: not a git repository (or any of the parent directories): .git');
    if (r.locks.has('index') && ['add', 'commit', 'reset', 'checkout', 'switch', 'merge', 'rm', 'restore', 'stash'].includes(sub)) {
      throw new GitError("fatal: Unable to create '/home/user/" + this.cwd + "/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository, e.g.\nan editor opened by 'git commit'. Please make sure all processes\nare terminated then try again. If it still fails, a git process\nmay have crashed in this repository earlier:\nremove the file manually to continue.");
    }
    return fn(this, r, args);
  }
}

// ---------------- 공통 부품 ----------------
const need = (r) => { if (!r.headHash()) throw new GitError(`fatal: your current branch '${r.branch() ?? 'HEAD'}' does not have any commits yet`); return r.headHash(); };
const headC = (r) => r.contents(r.treeMap(r.headHash()));
const label = (r, h) => `${short(h)} ${r.obj(h).msg.split('\n')[0]}`;

function stageFile(r, p) {
  if (r.work.has(p)) r.index.set(p, r.blob(r.work.get(p)));
  else r.index.delete(p);
  if (r.merge) r.merge.conflicts = r.merge.conflicts.filter(x => x !== p);
}

// 세 갈래 병합을 작업 폴더와 스테이지에 적용하고 충돌 목록을 돌려준다
function threeWay(r, baseC, theirsC, la, lb) {
  const oursC = headC(r);
  const { merged, conflicts } = mergeTrees(baseC, oursC, theirsC, la, lb);
  const cset = new Set(conflicts.map(c => c.path));
  const touched = [...new Set([...merged.keys(), ...oursC.keys()])].filter(p => merged.get(p) !== oursC.get(p));
  const blocked = touched.filter(p => r.dirty(p) || (!r.index.has(p) && r.work.has(p) && r.work.get(p) !== merged.get(p)));
  if (blocked.length) throw new GitError(`error: Your local changes to the following files would be overwritten by merge:\n\t${blocked.join('\n\t')}\nPlease commit your changes or stash them before you merge.\nAborting`);
  for (const [p, c] of merged) if (oursC.get(p) !== c) { r.work.set(p, c); if (!cset.has(p)) r.index.set(p, r.blob(c)); }
  for (const p of oursC.keys()) if (!merged.has(p)) { r.work.delete(p); r.index.delete(p); }
  for (const c of conflicts) { if (oursC.has(c.path)) r.index.set(c.path, r.blob(oursC.get(c.path))); else r.index.delete(c.path); }
  return conflicts;
}
const conflictLines = (cs) => cs.flatMap(c => [c.kind === 'content' || c.kind === 'add/add' ? (c.kind === 'add/add' ? `CONFLICT (add/add): Merge conflict in ${c.path}` : `Auto-merging ${c.path}\nCONFLICT (content): Merge conflict in ${c.path}`) : `CONFLICT (${c.kind}): ${c.path}`]);

function makeCommit(r, msg, parents) {
  const tree = r.tree(r.index);
  const h = r.commit({ tree, parents, msg });
  return h;
}
function commitSummary(r, h, root, oldC) {
  const b = r.head.ref ? r.branch() : 'detached HEAD';
  return `[${b}${root ? ' (root-commit)' : ''} ${short(h)}] ${r.obj(h).msg.split('\n')[0]}\n${diffStat(oldC, r.contents(r.treeMap(h)))}`.trimEnd();
}

function statusText(r) {
  const st = r.status(), L2 = [];
  if (r.rebase) {
    L2.push(`rebase in progress; onto ${short(r.rebase.onto)}`, `You are currently rebasing branch '${r.rebase.branch}' on '${short(r.rebase.onto)}'.`);
    if (r.merge?.conflicts.length) L2.push('  (fix conflicts and then run "git rebase --continue")', '  (use "git rebase --skip" to skip this patch)', '  (use "git rebase --abort" to check out the original branch)');
    else L2.push('  (all conflicts fixed: run "git rebase --continue")');
  } else L2.push(r.head.ref ? `On branch ${r.branch()}` : `HEAD detached at ${short(r.headHash())}`);
  const up = r.head.ref && r.upstream[r.branch()];
  if (up) {
    const uh = r.refs.get(`refs/remotes/${up}`), h = r.headHash();
    if (!uh) L2.push(`Your branch is based on '${up}', but the upstream is gone.`);
    else if (uh === h) L2.push(`Your branch is up to date with '${up}'.`);
    else if (r.isAncestor(uh, h)) { const n = [...r.ancestors(h)].filter(x => !r.ancestors(uh).has(x)).length; L2.push(`Your branch is ahead of '${up}' by ${plural(n, 'commit')}.`, '  (use "git push" to publish your local commits)'); }
    else if (r.isAncestor(h, uh)) { const n = [...r.ancestors(uh)].filter(x => !r.ancestors(h).has(x)).length; L2.push(`Your branch is behind '${up}' by ${plural(n, 'commit')}, and can be fast-forwarded.`, '  (use "git pull" to update your local branch)'); }
    else { const n1 = [...r.ancestors(h)].filter(x => !r.ancestors(uh).has(x)).length, n2 = [...r.ancestors(uh)].filter(x => !r.ancestors(h).has(x)).length; L2.push(`Your branch and '${up}' have diverged,`, `and have ${n1} and ${n2} different commits each, respectively.`, '  (use "git pull" to merge the remote branch into yours)'); }
  }
  if (!r.headHash() && !r.rebase) L2.push('', 'No commits yet');
  const conf = r.merge?.conflicts || [];
  if (r.merge && !r.rebase) {
    if (conf.length) L2.push('', 'You have unmerged paths.', '  (fix conflicts and run "git commit")', `  (use "git ${r.merge.kind === 'cherry-pick' ? 'cherry-pick' : r.merge.kind === 'revert' ? 'revert' : 'merge'} --abort" to abort the ${r.merge.kind === 'merge' ? 'merge' : r.merge.kind})`);
    else L2.push('', 'All conflicts fixed but you are still merging.', '  (use "git commit" to conclude merge)');
  }
  const kind = (k) => ({ 'new file': 'new file:   ', modified: 'modified:   ', deleted: 'deleted:    ' }[k]);
  if (st.staged.length) L2.push('', 'Changes to be committed:', `  (use "git restore --staged <file>..." to unstage)`, ...st.staged.map(x => `\t${kind(x.kind)}${x.path}`));
  if (conf.length) L2.push('', 'Unmerged paths:', '  (use "git add <file>..." to mark resolution)', ...conf.map(p => { const k = r.merge.kinds?.[p] || 'content'; return `\t${(k === 'add/add' ? 'both added:' : k.includes('HEAD') ? 'deleted by us:' : k.includes('theirs') ? 'deleted by them:' : 'both modified:').padEnd(17)}${p}`; }));
  if (st.unstaged.length) L2.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)', '  (use "git restore <file>..." to discard changes in working directory)', ...st.unstaged.map(x => `\t${kind(x.kind)}${x.path}`));
  if (st.untracked.length) L2.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)', ...collapse(r, st.untracked).map(x => `\t${x}`));
  if (!st.staged.length && !st.unstaged.length && !conf.length) L2.push('', st.untracked.length ? 'nothing added to commit but untracked files present (use "git add" to track)' : !r.headHash() ? 'nothing to commit (create/copy files and use "git add" to track)' : 'nothing to commit, working tree clean');
  else if (!st.staged.length && !conf.length) L2.push('', 'no changes added to commit (use "git add" and/or "git commit -a")');
  return L2.join('\n');
}
function collapse(r, paths) {      // 폴더 안이 전부 추적되지 않으면 폴더 이름만
  const out = new Set();
  for (const p of paths) { const s = p.split('/'); out.add(s.length > 1 && ![...r.index.keys()].some(k => k.startsWith(s[0] + '/')) ? s[0] + '/' : p); }
  return [...out].sort();
}

function decorate(r, h) { const d = r.decorations(h); return d.length ? ` (${d.join(', ')})` : ''; }

// 커밋 하나 만들기(병합 · cherry-pick 마무리 공통)
function finishCommit(r, msg, parents, label2) {
  const old = headC(r), root = !r.headHash();
  const h = makeCommit(r, msg, parents);
  r.moveHead(h, label2);
  r.merge = null;
  return commitSummary(r, h, root, old);
}

function fastForward(r, target, msg) {
  const cur = headC(r), next = r.contents(r.treeMap(target));
  const touched = [...new Set([...cur.keys(), ...next.keys()])].filter(p => cur.get(p) !== next.get(p));
  const blocked = touched.filter(p => r.dirty(p) || (!r.index.has(p) && r.work.has(p)));
  if (blocked.length) throw new GitError(`error: Your local changes to the following files would be overwritten by merge:\n\t${blocked.join('\n\t')}\nPlease commit your changes or stash them before you merge.\nAborting`);
  const old = r.headHash();
  for (const p of touched) { if (next.has(p)) { r.work.set(p, next.get(p)); r.index.set(p, r.blob(next.get(p))); } else { r.work.delete(p); r.index.delete(p); } }
  r.moveHead(target, msg);
  return `Updating ${short(old)}..${short(target)}\nFast-forward\n${diffStat(cur, next)}`;
}

function integrateBranch(s, r, target, name, { noff = false, ffOnly = false, unrelated = false, msg = null } = {}) {
  const head = need(r);
  if (r.merge) throw new GitError('fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.');
  if (target === head || r.isAncestor(target, head)) return 'Already up to date.';
  const base = r.mergeBase(head, target);
  if (!base && !unrelated) throw new GitError('fatal: refusing to merge unrelated histories');
  r.origHead = head;
  if (base === head && !noff) return fastForward(r, target, `merge ${name}: Fast-forward`);
  if (ffOnly) throw new GitError('fatal: Not possible to fast-forward, aborting.');
  const cur = r.branch();
  const text = msg || `Merge branch '${name}'${cur && cur !== 'main' && cur !== 'master' ? ` into ${cur}` : ''}`;
  const conflicts = threeWay(r, r.contents(r.treeMap(base)), r.contents(r.treeMap(target)), 'HEAD', name);
  if (conflicts.length) {
    r.merge = { kind: 'merge', kinds: Object.fromEntries(conflicts.map(c => [c.path, c.kind])), theirs: target, theirsC: r.contents(r.treeMap(target)), msg: text, conflicts: conflicts.map(c => c.path), parents: [head, target], name };
    throw new GitError(`${conflictLines(conflicts).join('\n')}\nAutomatic merge failed; fix conflicts and then commit the result.`);
  }
  const old = r.contents(r.treeMap(head));
  const h = makeCommit(r, text, [head, target]);
  r.moveHead(h, `merge ${name}: Merge made by the 'ort' strategy.`);
  return `Merge made by the 'ort' strategy.\n${diffStat(old, headC(r))}`.trimEnd();
}

function pickLike(s, r, kind, hash) {
  const c = r.obj(hash), parent = c.parents[0] || null, head = need(r);
  const baseC = kind === 'revert' ? r.contents(r.treeMap(hash)) : r.contents(r.treeMap(parent));
  const theirsC = kind === 'revert' ? r.contents(r.treeMap(parent)) : r.contents(r.treeMap(hash));
  const msg = kind === 'revert' ? `Revert "${c.msg.split('\n')[0]}"\n\nThis reverts commit ${hash}.` : c.msg;
  r.origHead = head;
  const conflicts = threeWay(r, baseC, theirsC, 'HEAD', kind === 'revert' ? `parent of ${short(hash)}` : `${short(hash)} (${c.msg.split('\n')[0]})`);
  if (conflicts.length) {
    r.merge = { kind, kinds: Object.fromEntries(conflicts.map(c => [c.path, c.kind])), theirsC, conflicts: conflicts.map(x => x.path), msg, parents: [head] };
    throw new GitError(`${conflictLines(conflicts).join('\n')}\nerror: could not ${kind === 'revert' ? 'revert' : 'apply'} ${short(hash)}... ${c.msg.split('\n')[0]}\nhint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\nhint: "git ${kind} --continue".`);
  }
  if (diffStat(headC(r), r.contents(r.index)) === '' && [...r.index].every(([p, h]) => headC(r).get(p) !== undefined)) { /* 변화 없음 */ }
  const old = headC(r);
  const h = makeCommit(r, msg, [head]);
  r.moveHead(h, `${kind === 'revert' ? 'revert' : 'cherry-pick'}: ${msg.split('\n')[0]}`);
  return commitSummary(r, h, false, old);
}

// 원격 저장소 찾기
function remoteOf(s, r, name) {
  const url = r.remotes[name];
  if (!url) throw new GitError(`fatal: '${name}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`);
  const hub = s.hub.get(normUrl(url));
  if (!hub) throw new GitError(`remote: Repository not found.\nfatal: repository '${url}/' not found`);
  return { url, hub };
}
function copyObjects(from, to) { for (const [h, o] of from.objects) if (!to.objects.has(h)) to.objects.set(h, o); }
const pad = (t, n = 17) => t.padEnd(n);

function doFetch(s, r, name) {
  const { url, hub } = remoteOf(s, r, name);
  copyObjects(hub, r);
  const lines = [];
  for (const [ref, h] of hub.refs) {
    if (!ref.startsWith('refs/heads/')) continue;
    const b = ref.slice(11), loc = `refs/remotes/${name}/${b}`, old = r.refs.get(loc);
    if (old === h) continue;
    r.refs.set(loc, h);
    if (!old) lines.push(` * [new branch]      ${b.padEnd(10)} -> ${name}/${b}`);
    else lines.push(`${r.isAncestor(old, h) ? ' ' : '+'}  ${short(old)}..${short(h)}  ${b.padEnd(10)} -> ${name}/${b}`);
  }
  for (const loc of [...r.refs.keys()]) if (loc.startsWith(`refs/remotes/${name}/`) && !hub.refs.has('refs/heads/' + loc.slice(`refs/remotes/${name}/`.length))) r.refs.delete(loc);
  return lines.length ? `From ${url}\n${lines.join('\n')}` : '';
}

function rebaseRun(s, r, todo) {
  const rb = r.rebase;
  while (todo.length) {
    const c = todo.shift(), o = r.obj(c);
    const conflicts = threeWay(r, r.contents(r.treeMap(o.parents[0] || null)), r.contents(r.treeMap(c)), 'HEAD', `${short(c)} (${o.msg.split('\n')[0]})`);
    if (conflicts.length) {
      rb.todo = todo;
      r.merge = { kind: 'rebase', kinds: Object.fromEntries(conflicts.map(c => [c.path, c.kind])), theirsC: r.contents(r.treeMap(c)), conflicts: conflicts.map(x => x.path), msg: o.msg, parents: [r.headHash()] };
      throw new GitError(`${conflictLines(conflicts).join('\n')}\nerror: could not apply ${short(c)}... ${o.msg.split('\n')[0]}\nhint: Resolve all conflicts manually, mark them as resolved with\nhint: "git add/rm <conflicted_files>", then run "git rebase --continue".\nhint: You can instead skip this commit: run "git rebase --skip".\nhint: To abort and get back to the state before "git rebase", run "git rebase --abort".`);
    }
    const h = makeCommit(r, o.msg, [r.headHash()]);
    r.moveHead(h, `rebase (pick): ${o.msg.split('\n')[0]}`);
  }
  const fin = r.headHash();
  r.refs.set(`refs/heads/${rb.branch}`, fin);
  r.head = { ref: `refs/heads/${rb.branch}` };
  r.reflog.unshift({ from: fin, to: fin, msg: `rebase (finish): returning to refs/heads/${rb.branch}` });
  r.rebase = null; r.merge = null;
  return `Successfully rebased and updated refs/heads/${rb.branch}.`;
}
function startRebase(s, r, upstream, name) {
  const head = need(r);
  if (!r.head.ref) throw new GitError('fatal: HEAD is detached; switch to a branch first');
  const st = r.status();
  if (st.unstaged.length || st.staged.length) throw new GitError('error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.');
  if (r.isAncestor(upstream, head)) return `Current branch ${r.branch()} is up to date.`;
  const upA = r.ancestors(upstream);
  const todo = r.history(head).filter(x => !upA.has(x) && r.obj(x).parents.length < 2).reverse();
  r.origHead = head;
  if (!todo.length) { r.moveHead(upstream, `rebase (finish): ${r.branch()} onto ${short(upstream)}`); r.materialize(r.treeMap(upstream)); return `Successfully rebased and updated refs/heads/${r.branch()}.`; }
  const branch = r.branch();
  r.rebase = { branch, orig: head, onto: upstream, todo: [...todo] };
  r.head = { hash: upstream };
  r.materialize(r.treeMap(upstream));
  r.reflog.unshift({ from: head, to: upstream, msg: `rebase (start): checkout ${name}` });
  return rebaseRun(s, r, todo);
}

// ---------------- git 하위 명령 ----------------
const GIT = {
  init(s, _r, a) {
    const dir = a.find(x => !x.startsWith('-'));
    if (dir) { s.mkdir(dir); s.cwd = dir; }
    if (!s.cwd) throw new GitError(L('먼저 mkdir 이름 && cd 이름 으로 폴더를 만드세요 (또는 git init 이름).', 'First make a folder: mkdir name && cd name (or git init name).'));
    if (!s.repo) s.mkdir(s.cwd);
    const r = s.repo;
    if (r.inited) return `Reinitialized existing Git repository in /home/user/${s.cwd}/.git/`;
    r.inited = true; r.head = { ref: 'refs/heads/main' };
    return `Initialized empty Git repository in /home/user/${s.cwd}/.git/`;
  },

  config(s, r, a) {
    const { flags, rest } = parseArgs(a);
    if (flags.has('--list') || flags.has('-l')) return Object.entries(r.config).map(([k, v]) => `${k}=${v}`).join('\n');
    const [k, v] = rest;
    if (v === undefined) { if (!(k in r.config)) throw new GitError(''); return r.config[k]; }
    r.config[k] = v; return '';
  },

  status(s, r, a) {
    if (a.includes('-s') || a.includes('--short') || a.includes('-sb')) {
      const st = r.status(), m = new Map();
      for (const x of st.staged) m.set(x.path, [{ 'new file': 'A', modified: 'M', deleted: 'D' }[x.kind], ' ']);
      for (const x of st.unstaged) { const e = m.get(x.path) || [' ', ' ']; e[1] = x.kind === 'deleted' ? 'D' : 'M'; m.set(x.path, e); }
      for (const p of r.merge?.conflicts || []) m.set(p, ['U', 'U']);
      const lines = [...m].sort(([x], [y]) => (x < y ? -1 : 1)).map(([p, e]) => `${e.join('')} ${p}`);
      for (const p of st.untracked) lines.push(`?? ${p}`);
      return (a.includes('-sb') ? [`## ${r.branch() ?? 'HEAD (no branch)'}`] : []).concat(lines).join('\n');
    }
    return statusText(r);
  },

  add(s, r, a) {
    const { flags, rest } = parseArgs(a);
    const all = flags.has('-A') || flags.has('--all') || flags.has('-u') || rest.includes('.');
    if (!all && !rest.length) return 'Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?';
    const paths = all ? [...new Set([...r.work.keys(), ...r.index.keys()])] : [];
    if (!all) {
      for (const x of rest) {
        const pre = x.replace(/\/$/, '') + '/', hit = [...new Set([...r.work.keys(), ...r.index.keys()])].filter(p => p === x || p.startsWith(pre));
        if (!hit.length) throw new GitError(`fatal: pathspec '${x}' did not match any files`);
        if (hit.every(p => r.isIgnored(p) && !r.index.has(p))) throw new GitError(`The following paths are ignored by one of your .gitignore files:\n${x}\nhint: Use -f if you really want to add them.\nhint: Turn this message off by running\nhint: "git config advice.addIgnoredFile false"`);
        paths.push(...hit);
      }
    }
    for (const p of paths) {
      if (flags.has('-u') && !r.index.has(p)) continue;
      if (all && r.isIgnored(p) && !r.index.has(p)) continue;
      stageFile(r, p);
    }
    return '';
  },

  rm(s, r, a) {
    const { flags, rest } = parseArgs(a);
    const out = [];
    for (const x of rest) {
      const pre = x.replace(/\/$/, '') + '/', hit = [...r.index.keys()].filter(p => p === x || (flags.has('-r') && p.startsWith(pre)));
      if (!hit.length) throw new GitError(`fatal: pathspec '${x}' did not match any files`);
      for (const p of hit) { r.index.delete(p); if (!flags.has('--cached')) r.work.delete(p); out.push(`rm '${p}'`); }
    }
    return out.join('\n');
  },

  commit(s, r, a) {
    const { flags, vals } = parseArgs(a.flatMap(x => (x === '-am' ? ['-a', '-m'] : [x])), ['-m', '--message']);
    const m = vals['-m'] ?? vals['--message'];
    if (flags.has('-a')) for (const x of r.status().unstaged) stageFile(r, x.path);
    if (r.merge?.conflicts.length) throw new GitError(`error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.\n${r.merge.conflicts.map(p => `U\t${p}`).join('\n')}`);
    if (r.rebase) throw new GitError('error: you are in the middle of a rebase; use "git rebase --continue"');
    if (flags.has('--amend')) {
      const head = need(r), c = r.obj(head), msg = m ?? c.msg;
      if (m === undefined && !flags.has('--no-edit')) throw new GitError(L('error: 메시지를 -m 으로 적거나 --no-edit 을 붙이세요 (이 시뮬레이터에는 편집기가 없습니다)', 'error: give the message with -m or add --no-edit (this simulator has no editor)'));
      const old = r.contents(r.treeMap(c.parents[0] || null));
      const h = makeCommit(r, msg, c.parents);
      r.moveHead(h, `commit (amend): ${msg.split('\n')[0]}`);
      return commitSummary(r, h, !c.parents.length, old);
    }
    if (r.merge) return finishCommit(r, m ?? r.merge.msg, r.merge.parents, `commit (merge): ${(m ?? r.merge.msg).split('\n')[0]}`);
    const st = r.status();
    if (!st.staged.length && !flags.has('--allow-empty')) {
      if (st.unstaged.length) throw new GitError(`${statusText(r)}`);
      throw new GitError(statusText(r));
    }
    if (m === undefined) throw new GitError(L('error: -m "메시지" 로 커밋 메시지를 적어 주세요 (이 시뮬레이터에는 편집기가 없습니다)', 'error: give a commit message with -m "message" (this simulator has no editor)'));
    const root = !r.headHash(), old = headC(r);
    const h = makeCommit(r, m, r.headHash() ? [r.headHash()] : []);
    r.moveHead(h, `commit${root ? ' (initial)' : ''}: ${m.split('\n')[0]}`);
    return commitSummary(r, h, root, old);
  },

  log(s, r, a) {
    const { flags, vals, rest } = parseArgs(a, ['-n', '--max-count']);
    let n = Infinity;
    if (vals['-n'] || vals['--max-count']) n = +(vals['-n'] || vals['--max-count']);
    for (const f of flags) if (/^-\d+$/.test(f)) n = +f.slice(1);
    const revs = rest.filter(x => x !== '--');
    let tips;
    if (flags.has('--all')) tips = r.allTips(); else tips = [revs.length ? r.resolve(revs[0]) : need(r)];
    const seen = new Set(), list = [];
    for (const t of tips) for (const x of r.history(t)) if (!seen.has(x)) { seen.add(x); list.push(x); }
    list.sort((x, y) => r.obj(y).time - r.obj(x).time);
    const one = flags.has('--oneline');
    return list.slice(0, n).map(h => {
      const c = r.obj(h);
      if (one) return `${flags.has('--graph') ? '* ' : ''}${short(h)}${decorate(r, h)} ${c.msg.split('\n')[0]}`;
      return `commit ${h}${decorate(r, h)}\n${c.parents.length > 1 ? `Merge: ${c.parents.map(short).join(' ')}\n` : ''}Author: ${c.author}\nDate:   ${fmtDate(c.time)}\n\n${c.msg.split('\n').map(l => '    ' + l).join('\n')}\n`;
    }).join(one ? '\n' : '\n').trimEnd();
  },

  show(s, r, a) {
    const h = a.length ? r.resolve(a.find(x => !x.startsWith('-'))) : need(r), c = r.obj(h);
    const d = diffText(r.contents(r.treeMap(c.parents[0] || null)), r.contents(r.treeMap(h)));
    return `commit ${h}${decorate(r, h)}\nAuthor: ${c.author}\nDate:   ${fmtDate(c.time)}\n\n${c.msg.split('\n').map(l => '    ' + l).join('\n')}${d ? '\n\n' + d : ''}`;
  },

  diff(s, r, a) {
    const { flags, rest } = parseArgs(a);
    const files = rest.filter(x => x !== '--');
    const hasRev = files.length && (() => { try { r.resolve(files[0]); return !r.work.has(files[0]); } catch { return false; } })();
    if (flags.has('--staged') || flags.has('--cached')) return diffText(headC(r), r.contents(r.index), files);
    if (hasRev) { const h = r.resolve(files[0]); return diffText(r.contents(r.treeMap(h)), new Map([...r.index.keys()].filter(p => r.work.has(p)).map(p => [p, r.work.get(p)])), files.slice(1)); }
    return diffText(r.contents(r.index), new Map([...r.index.keys()].filter(p => r.work.has(p)).map(p => [p, r.work.get(p)])), files);
  },

  branch(s, r, a) {
    const { flags, vals, rest } = parseArgs(a, ['-u', '--set-upstream-to']);
    const up = vals['-u'] || vals['--set-upstream-to'];
    if (up) { const b = rest[0] || r.branch(); if (!r.refs.has(`refs/remotes/${up}`)) throw new GitError(`fatal: the requested upstream branch '${up}' does not exist`); r.upstream[b] = up; return `branch '${b}' set up to track '${up}'.`; }
    if (flags.has('-d') || flags.has('-D')) {
      const out = [];
      for (const b of rest) {
        const ref = `refs/heads/${b}`;
        if (!r.refs.has(ref)) throw new GitError(`error: branch '${b}' not found.`);
        if (r.head.ref === ref) throw new GitError(`error: Cannot delete branch '${b}' checked out at '/home/user/${s.cwd}'`);
        const h = r.refs.get(ref);
        if (flags.has('-d') && !r.isAncestor(h, r.headHash())) throw new GitError(`error: The branch '${b}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${b}'.`);
        r.refs.delete(ref); delete r.upstream[b]; out.push(`Deleted branch ${b} (was ${short(h)}).`);
      }
      return out.join('\n');
    }
    if (flags.has('-m') || flags.has('-M')) {
      const [from, to] = rest.length === 2 ? rest : [r.branch(), rest[0]];
      if (!r.refs.has(`refs/heads/${from}`)) throw new GitError(`error: refname refs/heads/${from} not found`);
      r.refs.set(`refs/heads/${to}`, r.refs.get(`refs/heads/${from}`)); r.refs.delete(`refs/heads/${from}`);
      if (r.head.ref === `refs/heads/${from}`) r.head = { ref: `refs/heads/${to}` };
      if (r.upstream[from]) { r.upstream[to] = r.upstream[from]; delete r.upstream[from]; }
      return '';
    }
    if (rest.length) {
      const [name, start] = rest;
      if (r.refs.has(`refs/heads/${name}`)) throw new GitError(`fatal: a branch named '${name}' already exists`);
      r.refs.set(`refs/heads/${name}`, start ? r.resolve(start) : need(r));
      return '';
    }
    const lines = [];
    const vv = flags.has('-vv') || flags.has('-v');
    const fmt = (b, ref, h) => {
      const cur = r.head.ref === ref;
      let t = `${cur ? '* ' : '  '}${b}`;
      if (vv) { const up = r.upstream[b]; t = `${cur ? '* ' : '  '}${b.padEnd(12)} ${short(h)} ${up ? `[${up}] ` : ''}${r.obj(h).msg.split('\n')[0]}`; }
      return t;
    };
    if (!r.head.ref && r.headHash()) lines.push(`* (HEAD detached at ${short(r.headHash())})`);
    for (const b of r.branches()) lines.push(fmt(b, `refs/heads/${b}`, r.refs.get(`refs/heads/${b}`)));
    if (flags.has('-a') || flags.has('-r')) for (const [ref, h] of [...r.refs].sort()) if (ref.startsWith('refs/remotes/')) lines.push(`  remotes/${ref.slice(13)}${vv ? ` ${short(h)} ${r.obj(h).msg.split('\n')[0]}` : ''}`);
    return lines.join('\n');
  },

  switch(s, r, a) { return GIT.checkout(s, r, a, true); },
  checkout(s, r, a, isSwitch = false) {
    const { flags, vals, rest } = parseArgs(a, ['-b', '-c', '-B']);
    const create = vals['-b'] ?? vals['-c'] ?? vals['-B'];
    const ddash = rest.indexOf('--');
    // 파일 되돌리기: git checkout -- file / git checkout <rev> -- file / --ours / --theirs
    if (!isSwitch && (ddash >= 0 || flags.has('--ours') || flags.has('--theirs') || (rest.length && !create && rest.every(x => r.work.has(x) || r.index.has(x)) && !rest.every(x => r.refs.has(`refs/heads/${x}`))))) {
      const files = ddash >= 0 ? rest.slice(ddash + 1) : rest, rev = ddash > 0 ? rest[0] : null;
      if (flags.has('--ours') || flags.has('--theirs')) {
        if (!r.merge) throw new GitError('error: path is not unmerged');
        for (const p of files) {
          const v = flags.has('--ours') ? headC(r).get(p) : r.merge.theirsC.get(p);
          if (v === undefined) r.work.delete(p); else r.work.set(p, v);
        }
        return '';
      }
      const src = rev ? r.contents(r.treeMap(r.resolve(rev))) : r.contents(r.index);
      for (const p of files) { if (!src.has(p)) throw new GitError(`error: pathspec '${p}' did not match any file(s) known to git`); r.work.set(p, src.get(p)); if (rev) r.index.set(p, r.blob(src.get(p))); }
      return `Updated ${plural(files.length, 'path')} from ${rev ? short(r.resolve(rev)) : 'the index'}`;
    }
    const name = rest[0];
    if (create) {
      const ref = `refs/heads/${create}`;
      if (r.refs.has(ref) && !flags.has('-B')) throw new GitError(`fatal: a branch named '${create}' already exists`);
      const start = name ? r.resolve(name) : need(r);
      const from = r.branch() ?? short(r.headHash());
      r.refs.set(ref, start);
      if (start !== r.headHash()) moveTo(r, start);
      r.head = { ref }; r.reflog.unshift({ from: start, to: start, msg: `checkout: moving from ${from} to ${create}` });
      return `Switched to a new branch '${create}'`;
    }
    if (!name) { return statusText(r).split('\n')[0]; }
    const ref = `refs/heads/${name}`;
    if (r.refs.has(ref) && !flags.has('--detach')) {
      if (r.head.ref === ref) return `Already on '${name}'`;
      const from = r.branch() ?? short(r.headHash()), target = r.refs.get(ref);
      const warn = leavingWarning(r);
      moveTo(r, target);
      r.head = { ref }; r.reflog.unshift({ from: target, to: target, msg: `checkout: moving from ${from} to ${name}` });
      return `${warn}Switched to branch '${name}'${trackNote(r, name)}`;
    }
    const remote = [...r.refs.keys()].find(k => k.startsWith('refs/remotes/') && k.endsWith('/' + name) && k.split('/').length === 4);
    if (remote && !flags.has('--detach') && !/^[0-9a-f]{7,}$/.test(name)) {
      const h = r.refs.get(remote), from = r.branch() ?? short(r.headHash());
      moveTo(r, h);
      r.refs.set(ref, h); r.upstream[name] = remote.slice(13); r.head = { ref };
      r.reflog.unshift({ from: h, to: h, msg: `checkout: moving from ${from} to ${name}` });
      return `branch '${name}' set up to track '${remote.slice(13)}'.\nSwitched to a new branch '${name}'`;
    }
    if (isSwitch && !flags.has('--detach')) throw new GitError(`fatal: invalid reference: ${name}`);
    let target;
    try { target = r.resolve(name); } catch { throw new GitError(`error: pathspec '${name}' did not match any file(s) known to git`); }
    const from = r.branch() ?? short(r.headHash());
    moveTo(r, target);
    r.head = { hash: target }; r.reflog.unshift({ from: target, to: target, msg: `checkout: moving from ${from} to ${short(target)}` });
    return `Note: switching to '${name}'.\n\nYou are in 'detached HEAD' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.\n\nIf you want to create a new branch to retain commits you create, you may\ndo so (now or later) by using -c with the switch command. Example:\n\n  git switch -c <new-branch-name>\n\nOr undo this operation with:\n\n  git switch -\n\nTurn off this advice by setting config variable advice.detachedHead to false\n\nHEAD is now at ${label(r, target)}`;
  },

  restore(s, r, a) {
    const { flags, vals, rest } = parseArgs(a, ['--source', '-s']);
    const files = rest.filter(x => x !== '--');
    if (!files.length) throw new GitError('fatal: you must specify path(s) to restore');
    const src = vals['--source'] || vals['-s'];
    const expand = (x) => (x === '.' ? [...new Set([...r.work.keys(), ...r.index.keys(), ...r.treeMap(r.headHash()).keys()])] : [...new Set([...r.work.keys(), ...r.index.keys(), ...r.treeMap(r.headHash()).keys()])].filter(p => p === x || p.startsWith(x.replace(/\/$/, '') + '/')));
    for (const f of files) {
      const hit = expand(f);
      if (!hit.length) throw new GitError(`error: pathspec '${f}' did not match any file(s) known to git`);
      for (const p of hit) {
        if (flags.has('--staged')) {
          const h = r.treeMap(src ? r.resolve(src) : r.headHash()).get(p);
          if (h === undefined) r.index.delete(p); else r.index.set(p, h);
          if (flags.has('--worktree') || flags.has('-W')) { if (h === undefined) r.work.delete(p); else r.work.set(p, r.obj(h).content); }
        } else {
          const h = src ? r.treeMap(r.resolve(src)).get(p) : r.index.get(p);
          if (h === undefined) { if (src) { r.work.delete(p); } continue; }
          r.work.set(p, r.obj(h).content);
        }
      }
    }
    return '';
  },

  reset(s, r, a) {
    const { flags, rest } = parseArgs(a);
    const mode = flags.has('--hard') ? 'hard' : flags.has('--soft') ? 'soft' : 'mixed';
    const dd = rest.indexOf('--');
    const files = dd >= 0 ? rest.slice(dd + 1) : [];
    const revArg = dd >= 0 ? rest.slice(0, dd)[0] : rest[0];
    // git reset <file> : 스테이지에서 내리기
    if (dd >= 0 ? files.length : (rest.length && !(() => { try { r.resolve(rest[0]); return true; } catch { return false; } })())) {
      const targets = dd >= 0 ? files : rest;
      const known = new Set([...r.work.keys(), ...r.index.keys(), ...r.treeMap(r.headHash()).keys()]);
      if (dd < 0) for (const x of targets) if (![...known].some(p => p === x || p.startsWith(x.replace(/\/$/, '') + '/'))) throw new GitError(`fatal: ambiguous argument '${x}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
      if (flags.has('--hard') || flags.has('--soft')) throw new GitError(`fatal: Cannot do ${flags.has('--hard') ? 'hard' : 'soft'} reset with paths.`);
      const head = r.treeMap(r.headHash());
      for (const p of targets) { const h = head.get(p); if (h === undefined) r.index.delete(p); else r.index.set(p, h); }
      const un = r.status().unstaged;
      return un.length ? `Unstaged changes after reset:\n${un.map(x => `${x.kind === 'deleted' ? 'D' : 'M'}\t${x.path}`).join('\n')}` : '';
    }
    const target = revArg ? r.resolve(revArg) : need(r);
    r.origHead = r.headHash();
    r.moveHead(target, `reset: moving to ${revArg || 'HEAD'}`);
    r.merge = null;
    if (mode === 'soft') return '';
    if (mode === 'hard') { r.materialize(r.treeMap(target)); return `HEAD is now at ${label(r, target)}`; }
    r.index = new Map(r.treeMap(target));
    const un = r.status().unstaged;
    return un.length ? `Unstaged changes after reset:\n${un.map(x => `${x.kind === 'deleted' ? 'D' : 'M'}\t${x.path}`).join('\n')}` : '';
  },

  revert(s, r, a) {
    const { flags, rest } = parseArgs(a);
    if (flags.has('--abort')) return GIT.merge(s, r, ['--abort']);
    if (flags.has('--continue')) return GIT.commit(s, r, ['--no-edit']);
    return pickLike(s, r, 'revert', r.resolve(rest[0] || 'HEAD'));
  },
  'cherry-pick'(s, r, a) {
    const { flags, rest } = parseArgs(a);
    if (flags.has('--abort')) return GIT.merge(s, r, ['--abort']);
    if (flags.has('--continue')) return GIT.commit(s, r, ['--no-edit']);
    return pickLike(s, r, 'cherry-pick', r.resolve(rest[0]));
  },

  merge(s, r, a) {
    const { flags, rest } = parseArgs(a, ['-m']);
    if (flags.has('--abort')) {
      if (!r.merge) throw new GitError('fatal: There is no merge to abort (MERGE_HEAD missing).');
      r.materialize(r.treeMap(r.headHash())); r.merge = null; return '';
    }
    if (flags.has('--continue')) return GIT.commit(s, r, ['--no-edit']);
    const name = rest[0];
    if (!name) throw new GitError('fatal: No remote for the current branch.');
    let target;
    try { target = r.resolve(name); } catch { throw new GitError(`merge: ${name} - not something we can merge`); }
    return integrateBranch(s, r, target, name, { noff: flags.has('--no-ff'), ffOnly: flags.has('--ff-only'), unrelated: flags.has('--allow-unrelated-histories') });
  },

  rebase(s, r, a) {
    const { flags, rest } = parseArgs(a);
    if (flags.has('--abort')) {
      if (!r.rebase) throw new GitError('fatal: No rebase in progress?');
      const { branch, orig } = r.rebase;
      r.head = { ref: `refs/heads/${branch}` }; r.refs.set(`refs/heads/${branch}`, orig);
      r.materialize(r.treeMap(orig)); r.rebase = null; r.merge = null; return '';
    }
    if (flags.has('--continue') || flags.has('--skip')) {
      if (!r.rebase) throw new GitError('fatal: No rebase in progress?');
      if (r.merge?.conflicts.length) throw new GitError('error: Resolve all conflicts manually, mark them as resolved with\n"git add/rm <conflicted_files>", then run "git rebase --continue".\nYou can instead skip this commit: run "git rebase --skip".\nTo abort and get back to the state before "git rebase", run "git rebase --abort".');
      if (flags.has('--skip')) { r.materialize(r.treeMap(r.headHash())); r.merge = null; }
      else if (r.merge) { const h = makeCommit(r, r.merge.msg, [r.headHash()]); r.moveHead(h, `rebase (continue): ${r.merge.msg.split('\n')[0]}`); r.merge = null; }
      return rebaseRun(s, r, [...r.rebase.todo]);
    }
    const name = rest[0];
    if (!name) throw new GitError('fatal: no upstream configured for branch');
    return startRebase(s, r, r.resolve(name), name);
  },

  stash(s, r, a) {
    const sub = a[0] && !a[0].startsWith('-') ? a[0] : 'push', args = a[0] && !a[0].startsWith('-') ? a.slice(1) : a;
    if (sub === 'list') return r.stashes.map((x, i) => `stash@{${i}}: ${x.msg}`).join('\n');
    if (sub === 'drop') { const i = +(args[0]?.match(/\d+/)?.[0] ?? 0); if (!r.stashes[i]) throw new GitError('error: No stash entries found.'); const [d] = r.stashes.splice(i, 1); return `Dropped refs/stash@{${i}} (${short(d.id)})`; }
    if (sub === 'pop' || sub === 'apply') {
      const i = +(args[0]?.match(/\d+/)?.[0] ?? 0), z = r.stashes[i];
      if (!z) throw new GitError('No stash entries found.');
      const conflicts = threeWay(r, r.contents(r.treeMap(z.base)), z.work, 'Updated upstream', 'Stashed changes');
      for (const [p, c] of z.untracked) r.work.set(p, c);
      const hm = r.treeMap(r.headHash());
      for (const p of z.work.keys()) if (hm.has(p) && !conflicts.some(c => c.path === p)) r.index.set(p, hm.get(p));      // 되살린 고침은 스테이지에 올리지 않은 상태로
      if (conflicts.length) throw new GitError(`${conflictLines(conflicts).join('\n')}\nThe stash entry is kept in case you need it again.`);
      if (sub === 'pop') r.stashes.splice(i, 1);
      return `${statusText(r)}${sub === 'pop' ? `\nDropped refs/stash@{${i}} (${short(z.id)})` : ''}`;
    }
    if (sub !== 'push' && sub !== 'save') throw new GitError(`error: unknown subcommand: ${sub}`);
    const { flags, vals } = parseArgs(args, ['-m', '--message']);
    const st = r.status(), un = flags.has('-u') || flags.has('--include-untracked');
    if (!st.staged.length && !st.unstaged.length && !(un && st.untracked.length)) return 'No local changes to save';
    need(r);
    const work = new Map([...r.index.keys()].filter(p => r.work.has(p)).map(p => [p, r.work.get(p)]));
    const untracked = new Map(un ? st.untracked.map(p => [p, r.work.get(p)]) : []);
    const head = r.headHash(), msg = `${vals['-m'] || vals['--message'] ? `On ${r.branch()}: ${vals['-m'] || vals['--message']}` : `WIP on ${r.branch() ?? '(no branch)'}: ${label(r, head)}`}`;
    const id = hashObject('blob', msg + r.stashes.length + head);
    r.stashes.unshift({ id, msg, base: head, work, untracked });
    r.materialize(r.treeMap(head));
    for (const p of untracked.keys()) r.work.delete(p);
    return `Saved working directory and index state ${msg}`;
  },

  reflog(s, r) {
    return r.reflog.map((e, i) => `${short(e.to)} HEAD@{${i}}: ${e.msg}`).join('\n');
  },

  tag(s, r, a) {
    const { flags, rest } = parseArgs(a, ['-m']);
    if (flags.has('-d')) { for (const t of rest) { const ref = `refs/tags/${t}`; if (!r.refs.has(ref)) throw new GitError(`error: tag '${t}' not found.`); const h = r.refs.get(ref); r.refs.delete(ref); return `Deleted tag '${t}' (was ${short(h)})`; } }
    if (!rest.length) return [...r.refs.keys()].filter(k => k.startsWith('refs/tags/')).map(k => k.slice(10)).sort().join('\n');
    const [name, rev] = rest;
    if (r.refs.has(`refs/tags/${name}`)) throw new GitError(`fatal: tag '${name}' already exists`);
    r.refs.set(`refs/tags/${name}`, rev ? r.resolve(rev) : need(r));
    return '';
  },

  remote(s, r, a) {
    const [sub, ...args] = a;
    if (!sub) return Object.keys(r.remotes).join('\n');
    if (sub === '-v') return Object.entries(r.remotes).flatMap(([n, u]) => [`${n}\t${u} (fetch)`, `${n}\t${u} (push)`]).join('\n');
    if (sub === 'add') { const [n, u] = args; if (r.remotes[n]) throw new GitError(`error: remote ${n} already exists.`); r.remotes[n] = u; return ''; }
    if (sub === 'remove' || sub === 'rm') { const [n] = args; if (!r.remotes[n]) throw new GitError(`error: No such remote: '${n}'`); delete r.remotes[n]; for (const k of [...r.refs.keys()]) if (k.startsWith(`refs/remotes/${n}/`)) r.refs.delete(k); for (const b of Object.keys(r.upstream)) if (r.upstream[b].startsWith(n + '/')) delete r.upstream[b]; return ''; }
    if (sub === 'set-url') { const [n, u] = args; if (!r.remotes[n]) throw new GitError(`error: No such remote '${n}'`); r.remotes[n] = u; return ''; }
    throw new GitError(`error: Unknown subcommand: ${sub}`);
  },

  clean(s, r, a) {
    const { flags } = parseArgs(a);
    const un = r.status().untracked;
    if (!flags.has('-f') && !flags.has('-n')) throw new GitError('fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean');
    const out = un.map(p => (flags.has('-n') ? `Would remove ${p}` : `Removing ${p}`));
    if (!flags.has('-n')) for (const p of un) r.work.delete(p);
    return out.join('\n');
  },

  'ls-files'(s, r) { return [...r.index.keys()].sort().join('\n'); },
  'rev-parse'(s, r, a) { const { flags, rest } = parseArgs(a); const h = r.resolve(rest[0] || 'HEAD'); return flags.has('--short') ? short(h) : h; },
  'hash-object'(s, r, a) { const f = a.find(x => !x.startsWith('-')); if (!r.work.has(f)) throw new GitError(`fatal: could not open '${f}' for reading: No such file or directory`); const h = hashObject('blob', r.work.get(f)); if (a.includes('-w')) r.blob(r.work.get(f)); return h; },
  'cat-file'(s, r, a) {
    const { flags, rest } = parseArgs(a);
    const k = rest[0]; let h = k;
    try { h = r.resolve(k); } catch { h = [...r.objects.keys()].find(x => x.startsWith(k)); }
    const o = h && r.objects.get(h);
    if (!o) throw new GitError(`fatal: Not a valid object name ${k}`);
    if (flags.has('-t')) return o.type;
    if (flags.has('-s')) return String(o.type === 'blob' ? sizeOf(o.content) : 0);
    if (o.type === 'blob') return o.content.replace(/\n$/, '');
    if (o.type === 'tree') return o.entries.map(([p, b]) => `100644 blob ${b}\t${p}`).join('\n');
    return `tree ${o.tree}\n${o.parents.map(p => `parent ${p}\n`).join('')}author ${o.author} ${o.time} +0000\ncommitter ${o.author} ${o.time} +0000\n\n${o.msg}`;
  },

  clone(s, _r, a) {
    const { rest } = parseArgs(a);
    const url = rest[0];
    if (!url) throw new GitError('fatal: You must specify a repository to clone.');
    const dir = rest[1] || normUrl(url).split('/').pop();
    const hub = s.hub.get(normUrl(url));
    if (!hub) throw new GitError(`Cloning into '${dir}'...\nremote: Repository not found.\nfatal: repository '${url}/' not found`);
    const ex = s.dirs.get(dir);
    if (ex && (ex.work.size || ex.inited)) throw new GitError(`fatal: destination path '${dir}' already exists and is not an empty directory.`);
    const r = s.newRepo();
    r.inited = true; r.remotes.origin = url;
    copyObjects(hub, r);
    for (const [ref, h] of hub.refs) if (ref.startsWith('refs/heads/')) r.refs.set(`refs/remotes/origin/${ref.slice(11)}`, h);
    const b = hub.head.ref.slice(11), h = hub.refs.get(hub.head.ref);
    r.head = { ref: `refs/heads/${b}` };
    s.dirs.set(dir, r);
    if (!h) return `Cloning into '${dir}'...\nwarning: You appear to have cloned an empty repository.`;
    r.refs.set(`refs/heads/${b}`, h); r.upstream[b] = `origin/${b}`;
    r.materialize(r.treeMap(h));
    r.reflog.unshift({ from: null, to: h, msg: `clone: from ${url}` });
    return `Cloning into '${dir}'...`;
  },

  fetch(s, r, a) {
    const { rest } = parseArgs(a);
    return doFetch(s, r, rest[0] || 'origin');
  },

  pull(s, r, a) {
    const { flags, rest } = parseArgs(a);
    const head = need(r);
    if (!r.head.ref) throw new GitError('You are not currently on a branch.\nPlease specify which branch you want to merge with.');
    const b = r.branch();
    const remote = rest[0] || (r.upstream[b] ? r.upstream[b].split('/')[0] : 'origin');
    const rb = rest[1] || (r.upstream[b] && !rest[0] ? r.upstream[b].split('/').slice(1).join('/') : null);
    if (!rb) throw new GitError(`There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=${remote}/<branch> ${b}`);
    const fetched = doFetch(s, r, remote);
    const target = r.refs.get(`refs/remotes/${remote}/${rb}`);
    if (!target) throw new GitError(`fatal: couldn't find remote ref ${rb}`);
    const lines = fetched ? [fetched] : [];
    if (target === head || r.isAncestor(target, head)) return [...lines, 'Already up to date.'].join('\n');
    const base = r.mergeBase(head, target);
    const diverged = base && base !== head;
    const cfg = r.config['pull.rebase'];
    const mode = flags.has('--rebase') || flags.has('-r') ? 'rebase' : flags.has('--no-rebase') ? 'merge' : flags.has('--ff-only') ? 'ff-only' : cfg === 'true' ? 'rebase' : cfg === 'false' ? 'merge' : r.config['pull.ff'] === 'only' ? 'ff-only' : null;
    if (diverged && !mode) throw new GitError(`${lines.join('\n')}${lines.length ? '\n' : ''}hint: You have divergent branches and need to specify how to reconcile them.\nhint: You can do so by running one of the following commands sometime before\nhint: your next pull:\nhint:\nhint:   git config pull.rebase false  # merge\nhint:   git config pull.rebase true   # rebase\nhint:   git config pull.ff only       # fast-forward only\nhint:\nhint: You can replace "git config" with "git config --global" to set a default\nhint: preference for all repositories. You can also pass --rebase, --no-rebase,\nhint: or --ff-only on the command line to override the configured default per\nhint: invocation.\nfatal: Need to specify how to reconcile divergent branches.`);
    if (diverged && mode === 'ff-only') throw new GitError(`${lines.join('\n')}\nfatal: Not possible to fast-forward, aborting.`);
    if (diverged && mode === 'rebase') return [...lines, startRebase(s, r, target, `${remote}/${rb}`)].join('\n');
    if (!base && !flags.has('--allow-unrelated-histories')) throw new GitError(`${lines.join('\n')}${lines.length ? '\n' : ''}fatal: refusing to merge unrelated histories`);
    const url = r.remotes[remote];
    return [...lines, integrateBranch(s, r, target, rb, { unrelated: true, msg: `Merge branch '${rb}' of ${url}` })].join('\n');
  },

  push(s, r, a) {
    const { flags, rest } = parseArgs(a);
    const force = flags.has('--force') || flags.has('-f'), lease = [...flags].some(f => f.startsWith('--force-with-lease'));
    const setUp = flags.has('-u') || flags.has('--set-upstream');
    const del = flags.has('--delete') || flags.has('-d');
    let remote = rest[0], spec = rest[1];
    const cur = r.branch();
    if (!remote) {
      if (!Object.keys(r.remotes).length) throw new GitError('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>');
      if (!cur) throw new GitError('fatal: You are not currently on a branch.');
      const up = r.upstream[cur];
      if (!up) throw new GitError(`fatal: The current branch ${cur} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin ${cur}\n`);
      remote = up.split('/')[0]; spec = cur;
    }
    if (flags.has('--all')) { return [...r.branches()].map(b => GIT.push(s, r, [remote, b, ...(force ? ['--force'] : [])])).join('\n'); }
    const { url, hub } = remoteOf(s, r, remote);
    if (!spec) { if (!cur) throw new GitError('fatal: You are not currently on a branch.'); spec = cur; }
    if (del || spec.startsWith(':')) {
      const b = spec.replace(/^:/, '');
      if (!hub.refs.has(`refs/heads/${b}`)) throw new GitError(`error: unable to delete '${b}': remote ref does not exist`);
      if (hub.protectedBranches.has(b)) throw new GitError(`remote: error: GH006: Protected branch update failed for refs/heads/${b}.\nTo ${url}\n ! [remote rejected] ${b} (protected branch hook declined)\nerror: failed to push some refs to '${url}'`);
      hub.refs.delete(`refs/heads/${b}`); r.refs.delete(`refs/remotes/${remote}/${b}`);
      return `To ${url}\n - [deleted]         ${b}`;
    }
    const [src, dst0] = spec.split(':'), dst = dst0 || src;
    const local = r.refs.get(`refs/heads/${src}`);
    if (!local) throw new GitError(`error: src refspec ${src} does not match any\nerror: failed to push some refs to '${url}'`);
    const ref = `refs/heads/${dst}`, old = hub.refs.get(ref);
    if (old === local) { if (setUp) r.upstream[src] = `${remote}/${dst}`; return `Everything up-to-date${setUp ? `\nbranch '${src}' set up to track '${remote}/${dst}'.` : ''}`; }
    const reject = (why, hint) => { throw new GitError(`To ${url}\n ! [rejected]        ${src} -> ${dst} (${why})\nerror: failed to push some refs to '${url}'\n${hint}`); };
    let forced = false;
    if (old && !r.isAncestor(old, local)) {
      if (lease) {
        const tracked = r.refs.get(`refs/remotes/${remote}/${dst}`);
        if (tracked !== old) reject('stale info', "hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. Fetch first, then check the result and push again.");
        forced = true;
      } else if (force) forced = true;
      else if (!r.objects.has(old)) reject('fetch first', "hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. This is usually caused by another repository pushing to\nhint: the same ref. If you want to integrate the remote changes, use\nhint: 'git pull' before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.");
      else reject('non-fast-forward', "hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use 'git pull' before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.");
    }
    if (hub.protectedBranches.has(dst)) throw new GitError(`remote: error: GH006: Protected branch update failed for refs/heads/${dst}.\nremote: error: Changes must be made through a pull request.\nTo ${url}\n ! [remote rejected] ${src} -> ${dst} (protected branch hook declined)\nerror: failed to push some refs to '${url}'`);
    // 새로 올라가는 커밋에 든 100MB 넘는 파일 검사
    const fresh = [...r.ancestors(local)].filter(x => !hub.objects.has(x));
    for (const cm of fresh) for (const [p, bh] of r.treeMap(cm)) {
      const sz = sizeOf(r.obj(bh).content);
      if (sz > LIMIT && !hub.objects.has(bh)) throw new GitError(`remote: error: File ${p} is ${(sz / MB).toFixed(2)} MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.\nTo ${url}\n ! [remote rejected] ${src} -> ${dst} (pre-receive hook declined)\nerror: failed to push some refs to '${url}'`);
    }
    copyObjects(r, hub);
    hub.refs.set(ref, local);
    r.refs.set(`refs/remotes/${remote}/${dst}`, local);
    if (setUp) r.upstream[src] = `${remote}/${dst}`;
    const line = !old ? ` * [new branch]      ${src} -> ${dst}` : forced ? ` + ${short(old)}...${short(local)} ${src} -> ${dst} (forced update)` : `   ${short(old)}..${short(local)}  ${src} -> ${dst}`;
    return `To ${url}\n${line}${setUp ? `\nbranch '${src}' set up to track '${remote}/${dst}'.` : ''}`;
  },

  // git filter-repo --invert-paths --path <파일>: 모든 커밋에서 파일을 지운다 (실제로는 별도 도구). 끝나면 origin 도 지워 실수로 push 하지 않게 한다
  'filter-repo'(s, r, a) {
    const { flags, vals, rest } = parseArgs(a, ['--path']);
    const paths = [vals['--path'], ...rest].filter(Boolean);
    if (!flags.has('--invert-paths') || !paths.length) throw new GitError(L('이 시뮬레이터는 --invert-paths --path <파일> 만 지원합니다.', 'This simulator supports only --invert-paths --path <file>.'));
    const map = new Map();
    const rewrite = (h) => {
      if (map.has(h)) return map.get(h);
      const c = r.obj(h), t = new Map(r.treeMap(h));
      for (const p of paths) for (const k of [...t.keys()]) if (k === p || k.startsWith(p.replace(/\/$/, '') + '/')) t.delete(k);
      const keep = [r.config['user.name'], r.config['user.email']];
      const ps = c.parents.map(rewrite);
      const author = c.author.match(/^(.*) <(.*)>$/);
      [r.config['user.name'], r.config['user.email']] = [author[1], author[2]];
      const t0 = r.clock.tick;
      r.clock.tick = t0;
      const tr = r.tree(t);
      // 고치고 나서 아무 변화도 없게 된 커밋은 지운다 (filter-repo 의 기본 동작)
      if (ps.length === 1 && r.obj(ps[0]).tree === tr && c.parents.length === 1 && r.obj(c.parents[0]).tree !== c.tree) { [r.config['user.name'], r.config['user.email']] = keep; map.set(h, ps[0]); return ps[0]; }
      r.clock.tick = () => c.time;
      const n = r.commit({ tree: tr, parents: ps, msg: c.msg });
      r.clock.tick = t0; [r.config['user.name'], r.config['user.email']] = keep;
      map.set(h, n); return n;
    };
    const total = r.reachable().size;
    for (const [ref, h] of [...r.refs]) if (ref.startsWith('refs/heads/') || ref.startsWith('refs/tags/')) r.refs.set(ref, rewrite(h));
    for (const ref of [...r.refs.keys()]) if (ref.startsWith('refs/remotes/')) r.refs.delete(ref);
    r.remotes = {}; r.upstream = {};
    const nh = r.headHash();
    if (r.head.ref === undefined) r.head = { hash: map.get(r.head.hash) || r.head.hash };
    r.materialize(r.treeMap(nh));
    r.reflog = [];
    return `Parsed ${plural(total, 'commit')}\nNew history written in 0.02 seconds; now repacking/cleaning...\nCompleted after 0.05 seconds.`;
  }
};

// detached HEAD 에서 브랜치로 떠날 때, 어느 브랜치에도 안 이어진 커밋이 있으면 경고
function leavingWarning(r) {
  if (r.head.ref || !r.headHash()) return '';
  const safe = r.reachable([...r.refs.values()]);
  const lost = r.history(r.headHash()).filter(x => !safe.has(x));
  if (!lost.length) return '';
  return `Warning: you are leaving ${plural(lost.length, 'commit')} behind, not connected to\nany of your branches:\n\n${lost.map(h => `  ${label(r, h)}`).join('\n')}\n\nIf you want to keep it by creating a new branch, this may be a good time\nto do so with:\n\n git branch <new-branch-name> ${short(lost[0])}\n\n`;
}
function trackNote(r, name) { const up = r.upstream[name]; if (!up) return ''; const uh = r.refs.get(`refs/remotes/${up}`), h = r.refs.get(`refs/heads/${name}`); return uh === h ? `\nYour branch is up to date with '${up}'.` : ''; }

// 현재 HEAD 에서 target 커밋의 트리로 작업 폴더와 스테이지를 옮긴다 (고친 파일이 겹치면 거절)
function moveTo(r, target) {
  const cur = headC(r), next = r.contents(r.treeMap(target));
  const differing = [...new Set([...cur.keys(), ...next.keys()])].filter(p => cur.get(p) !== next.get(p));
  const blocked = differing.filter(p => r.dirty(p) || (!r.index.has(p) && r.work.has(p) && r.work.get(p) !== next.get(p)));
  if (blocked.length) throw new GitError(`error: Your local changes to the following files would be overwritten by checkout:\n\t${blocked.join('\n\t')}\nPlease commit your changes or stash them before you switch branches.\nAborting`);
  for (const p of differing) { if (next.has(p)) { r.work.set(p, next.get(p)); r.index.set(p, r.blob(next.get(p))); } else { r.work.delete(p); r.index.delete(p); } }
}

export { statusText, diffText, diffStat, fmtDate, normUrl, tokenize };
