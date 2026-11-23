// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Git 사용법 페이지(git-*.html)의 계산 점검 (브라우저 없이) — 실행: node tests/git.test.mjs
// 해시 · 명령 동작 · 병합/충돌/rebase · 원격(push 거절 · 보호 브랜치 · 큰 파일) · 모든 장애 사례 · 페이지 안내문의 명령까지 확인한다
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sha1 } from '../assets/git/sha1.js';
import { hashObject, merge3, mergeTrees, lineDiff, split } from '../assets/git/core.js';
import { Session } from '../assets/git/cmds.js';
import { LABS, GUIDES, CATS, URL as HUB } from '../assets/git/scenarios.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const mk = () => { const s = new Session(); s.mkdir('g'); s.cwd = 'g'; s.sh('git init'); s.sh('git config user.name "T"'); s.sh('git config user.email "t@e.com"'); return s; };
const withRemote = (files = { 'README.md': '# grid\n', 'app.txt': 'line1\nline2\nline3\n' }, opt) => { const s = new Session(); s.hubCreate(HUB, files, opt); s.sh(`git clone ${HUB}`); s.sh('cd grid'); s.sh('git config user.name "T"'); s.sh('git config user.email "t@e.com"'); return s; };
const out = (s, c) => s.run(c).out;
const fails = (s, c, re) => { const r = s.run(c); assert.equal(r.ok, false, `${c} should fail`); if (re) assert.match(r.out, re, c); return r.out; };
const oneline = (s, c = 'git log --oneline') => out(s, c).split('\n').map(l => l.replace(/^[0-9a-f]{7} (\([^)]*\) )?/, ''));

// 1) 해시: 진짜 Git 과 같은 값
{
  assert.equal(sha1('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(hashObject('blob', 'hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a', 'same as `echo hello | git hash-object --stdin`');
  assert.equal(hashObject('blob', ''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', 'the well-known empty blob');
  assert.equal(hashObject('blob', 'a'.repeat(100000)).length, 40);
  const s = mk(); s.sh('echo "hello" > a.txt');
  assert.equal(out(s, 'git hash-object a.txt'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  console.log('✓ SHA-1 and blob hashes equal real Git\'s');
}

// 2) 로컬 기본 흐름: 세 영역 · status 문장 · commit · log · diff · cat-file
{
  const s = mk();
  assert.match(out(s, 'git status'), /On branch main\n\nNo commits yet\n\nnothing to commit \(create\/copy files/);
  s.sh('echo "hello" > a.txt');
  assert.match(out(s, 'git status'), /Untracked files:[\s\S]*\ta\.txt[\s\S]*nothing added to commit but untracked files present/);
  s.sh('git add a.txt');
  assert.match(out(s, 'git status'), /Changes to be committed:[\s\S]*new file:   a\.txt/);
  assert.equal(s.repo.index.get('a.txt'), 'ce013625030ba8dba906f756967f9e9ca394464a', 'the stage holds the content hash');
  assert.match(out(s, 'git commit -m "first"'), /^\[main \(root-commit\) [0-9a-f]{7}\] first\n 1 file changed, 1 insertion\(\+\)\n create mode 100644 a\.txt$/);
  assert.match(out(s, 'git status'), /nothing to commit, working tree clean/);
  s.sh('echo "world" >> a.txt');
  assert.match(out(s, 'git diff'), /--- a\/a\.txt\n\+\+\+ b\/a\.txt\n@@ -1 \+1,2 @@\n hello\n\+world/);
  assert.equal(out(s, 'git diff --staged'), '');
  s.sh('git add a.txt');
  assert.equal(out(s, 'git diff'), ''); assert.match(out(s, 'git diff --staged'), /\+world/);
  fails(s, 'git commit', /커밋 메시지|commit message/);
  s.sh('git commit -m "second"');
  assert.deepEqual(oneline(s), ['second', 'first']);
  const head = out(s, 'git rev-parse HEAD');
  assert.match(out(s, 'git cat-file -p HEAD'), new RegExp(`^tree [0-9a-f]{40}\\nparent ${out(s, 'git rev-parse HEAD~1')}\\nauthor T <t@e.com> \\d+ \\+0000`));
  assert.equal(out(s, 'git cat-file -t HEAD'), 'commit'); assert.equal(out(s, `git cat-file -p ${out(s, 'git hash-object a.txt')}`), 'hello\nworld');
  assert.equal(head.length, 40);
  fails(s, 'git commit -m "x"', /nothing to commit, working tree clean/);
  console.log('✓ init, add, commit, status, diff, log and cat-file behave like Git');
}
{
  const s = new Session();
  fails(s, 'git status', /fatal: not a git repository/);
  assert.match(fails(s, 'git frobnicate', /is not a git command/), /frobnicate/);
  console.log('✓ errors outside a repository and for unknown commands');
}

// 3) 되돌리기: amend · reset 세 모드 · restore · revert · reflog · 파일 삭제와 .gitignore
{
  const s = mk();
  s.sh('echo 1 > a && git add . && git commit -m c1'); s.sh('echo 2 > a && git commit -am c2');
  const c2 = out(s, 'git rev-parse HEAD'), c1 = out(s, 'git rev-parse HEAD~1');
  s.sh('git commit --amend -m "c2 fixed"'); assert.notEqual(out(s, 'git rev-parse HEAD'), c2, 'amend changes the hash'); assert.equal(out(s, 'git rev-parse HEAD~1'), c1);
  s.sh('git reset --soft HEAD~1'); assert.equal(out(s, 'git rev-parse HEAD'), c1); assert.equal(s.repo.work.get('a'), '2\n'); assert.match(out(s, 'git status'), /Changes to be committed:[\s\S]*modified:   a/);
  s.sh('git reset HEAD~0'); assert.match(out(s, 'git status'), /Changes not staged for commit:[\s\S]*modified:   a/);
  s.sh('git restore a'); assert.equal(s.repo.work.get('a'), '1\n');
  s.sh('echo 3 > a && git commit -am c3'); s.sh('git reset --hard HEAD~1'); assert.equal(s.repo.work.get('a'), '1\n');
  assert.match(out(s, 'git reflog'), /HEAD@\{0\}: reset: moving to HEAD~1\n[0-9a-f]{7} HEAD@\{1\}: commit: c3/);
  s.sh('git reset --hard HEAD@{1}'); assert.equal(s.repo.work.get('a'), '3\n', 'reflog brings the lost commit back');
  s.sh('git revert HEAD --no-edit'); assert.equal(s.repo.work.get('a'), '1\n'); assert.match(out(s, 'git log --oneline -n 1'), /Revert "c3"/);
  s.sh('echo "*.log\\nbuild/" > .gitignore'); s.sh('echo x > debug.log'); s.sh('echo y > build/out.o'); s.sh('echo z > keep.txt');
  assert.equal(out(s, 'git status -s'), '?? .gitignore\n?? keep.txt');
  fails(s, 'git add debug.log', /ignored by one of your \.gitignore files/);
  s.sh('git add .'); assert.ok(!s.repo.index.has('debug.log') && !s.repo.index.has('build/out.o') && s.repo.index.has('keep.txt'));
  s.sh('git commit -m ignore'); s.sh('git rm --cached keep.txt'); assert.ok(s.repo.work.has('keep.txt')); assert.equal(out(s, 'git ls-files').includes('keep.txt'), false);
  s.sh('git rm a'); assert.ok(!s.repo.work.has('a'));
  assert.match(fails(s, 'git reset --hard nonexistent', /unknown revision/), /ambiguous argument/);
  console.log('✓ amend, reset (soft/mixed/hard), restore, revert, reflog, .gitignore and rm');
}

// 4) 세 갈래 병합 (줄 단위)
{
  const base = 'a\nb\nc\nd\ne\n';
  assert.deepEqual(merge3(base, 'A\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n'), { text: 'A\nb\nc\nd\nE\n', conflict: false }, 'changes in different places are both kept');
  const c = merge3(base, 'a\nOURS\nc\nd\ne\n', 'a\nTHEIRS\nc\nd\ne\n', 'HEAD', 'feature');
  assert.equal(c.conflict, true); assert.equal(c.text, 'a\n<<<<<<< HEAD\nOURS\n=======\nTHEIRS\n>>>>>>> feature\nc\nd\ne\n');
  assert.equal(merge3(base, 'a\nSAME\nc\nd\ne\n', 'a\nSAME\nc\nd\ne\n').conflict, false);
  assert.equal(merge3(base, base, 'x\n').text, 'x\n'); assert.equal(merge3(base, 'y\n', base).text, 'y\n');
  assert.equal(merge3('', 'one\n', 'two\n').conflict, true, 'add/add with an empty base conflicts');
  assert.deepEqual(lineDiff('a\nb\n', 'a\nc\n').map(o => o.t + o.l), [' a', '-b', '+c']);
  const m = mergeTrees(new Map([['f', 'x\n'], ['g', 'y\n']]), new Map([['f', 'x1\n'], ['g', 'y\n']]), new Map([['g', 'y\n']]), 'HEAD', 't');
  assert.equal(m.conflicts[0].kind, 'modify/delete (deleted by theirs)');
  assert.deepEqual(split('a\nb\n'), ['a', 'b']);
  console.log('✓ the three-way merge keeps independent changes and marks real conflicts');
}

// 5) 브랜치 · 병합 · 충돌 · rebase · cherry-pick · stash
{
  const s = mk();
  s.sh('echo 1 > a && git add . && git commit -m c1'); s.sh('echo 2 > b && git add . && git commit -m c2');
  s.sh('git branch feature'); assert.equal(s.repo.refs.get('refs/heads/feature'), s.repo.headHash(), 'a branch is just a label on the same commit');
  s.sh('git switch feature'); s.sh('echo f > f && git add . && git commit -m f1'); s.sh('git switch main');
  assert.ok(!s.repo.work.has('f'), 'files follow the branch');
  assert.match(out(s, 'git merge feature'), /Updating [0-9a-f]{7}\.\.[0-9a-f]{7}\nFast-forward\n 1 file changed/); assert.equal(s.repo.headHash(), s.repo.refs.get('refs/heads/feature'));
  assert.equal(out(s, 'git merge feature'), 'Already up to date.');
  s.sh('git switch -c login'); s.sh('echo l > l && git add . && git commit -m login'); s.sh('git switch main'); s.sh('echo h > h && git add . && git commit -m hotfix');
  assert.match(out(s, 'git merge login'), /Merge made by the 'ort' strategy/);
  assert.equal(s.repo.obj(s.repo.headHash()).parents.length, 2); assert.match(out(s, 'git log --oneline -n 1'), /Merge branch 'login'/);
  assert.match(out(s, 'git branch -d login'), /Deleted branch login/); fails(s, 'git branch -d nope', /not found/);
  s.sh('git switch -c x'); s.sh('echo x > xx && git add . && git commit -m xx'); s.sh('git switch main');
  assert.match(fails(s, 'git branch -d x', /not fully merged/), /git branch -D x/); s.sh('git branch -D x');
  // 충돌
  s.sh('echo "l1\\nl2\\nl3" > app.txt && git add . && git commit -m app');
  s.sh('git switch -c fe'); s.sh('echo "l1\\nBLUE\\nl3\\nl4" > app.txt && git commit -am blue'); s.sh('git switch main'); s.sh('echo "l1\\nGREEN\\nl3" > app.txt && git commit -am green');
  const conf = fails(s, 'git merge fe', /CONFLICT \(content\): Merge conflict in app\.txt/); assert.match(conf, /Automatic merge failed/);
  assert.match(s.prompt(), /MERGING/); assert.match(out(s, 'git status'), /Unmerged paths:[\s\S]*both modified:   app\.txt/);
  assert.equal(s.repo.work.get('app.txt'), 'l1\n<<<<<<< HEAD\nGREEN\n=======\nBLUE\n>>>>>>> fe\nl3\nl4\n', 'the non-conflicting added line was merged');
  fails(s, 'git commit -m x', /unmerged files/); fails(s, 'git merge fe', /not concluded your merge/);
  s.sh('git merge --abort'); assert.equal(s.repo.work.get('app.txt'), 'l1\nGREEN\nl3\n'); assert.equal(s.repo.merge, null);
  fails(s, 'git merge fe'); s.sh('git checkout --theirs app.txt'); assert.match(s.repo.work.get('app.txt'), /BLUE/);
  s.sh('git add app.txt'); s.sh('git commit --no-edit'); assert.equal(s.repo.obj(s.repo.headHash()).parents.length, 2);
  // 로컬 변경이 있을 때 이동 거절 · stash
  s.sh('git switch fe'); s.sh('echo "fe-only" > app.txt && git commit -am feonly'); s.sh('git switch main'); s.sh('echo wip > app.txt');
  assert.match(fails(s, 'git switch fe', /would be overwritten by checkout:\n\tapp\.txt\nPlease commit your changes or stash them/), /Aborting/);
  assert.equal(out(s, 'git stash'), 'Saved working directory and index state WIP on main: ' + out(s, 'git log --oneline -n 1').slice(0, 7) + ' ' + out(s, 'git log -n 1').split('\n').pop().trim());
  assert.equal(out(s, 'git stash'), 'No local changes to save');
  s.sh('git switch fe'); assert.match(out(s, 'git stash list'), /stash@\{0\}: WIP on main/);
  s.sh('git switch main'); s.sh('git stash pop'); assert.equal(s.repo.work.get('app.txt'), 'wip\n'); assert.equal(s.repo.stashes.length, 0);
  // detached HEAD
  s.sh('git commit -am wipcommit'); s.sh('git checkout HEAD~1'); assert.match(s.prompt(), /HEAD detached at/);
  s.sh('echo e > e && git add . && git commit -m exp');
  assert.match(out(s, 'git switch main'), /^Warning: you are leaving 1 commit behind[\s\S]*exp[\s\S]*Switched to branch 'main'$/);
  console.log('✓ fast-forward, merge commits, conflicts (abort and resolve), stash and detached HEAD');
}
{
  // rebase: 성공 · 충돌 · continue · abort · cherry-pick
  const mkb = () => { const s = mk(); s.sh('echo "l1\\nl2\\nl3" > app.txt && git add . && git commit -m base'); s.sh('git switch -c fe'); s.sh('echo "l1\\nFE\\nl3" > app.txt && git commit -am fe1'); s.sh('echo f2 > f2 && git add . && git commit -m fe2'); s.sh('git switch main'); return s; };
  let s = mkb(); s.sh('echo m > m && git add . && git commit -m m1'); s.sh('git switch fe');
  const before = out(s, 'git rev-parse HEAD'); const r = out(s, 'git rebase main');
  assert.equal(r, 'Successfully rebased and updated refs/heads/fe.'); assert.notEqual(out(s, 'git rev-parse HEAD'), before, 'rebase gives the commits new hashes');
  assert.deepEqual(oneline(s), ['fe2', 'fe1', 'm1', 'base']); assert.ok(s.repo.work.has('m') && s.repo.work.has('f2'));
  s = mkb(); s.sh('echo "l1\\nMAIN\\nl3" > app.txt && git commit -am main1'); s.sh('git switch fe');
  fails(s, 'git rebase main', /could not apply [0-9a-f]{7}\.\.\. fe1[\s\S]*git rebase --continue/); assert.match(s.prompt(), /rebase/);
  assert.match(out(s, 'git status'), /rebase in progress; onto/); fails(s, 'git rebase --continue', /Resolve all conflicts manually/);
  s.sh('echo "l1\\nBOTH\\nl3" > app.txt'); s.sh('git add app.txt'); assert.equal(out(s, 'git rebase --continue'), 'Successfully rebased and updated refs/heads/fe.');
  assert.deepEqual(oneline(s), ['fe2', 'fe1', 'main1', 'base']); assert.equal(s.repo.rebase, null);
  s = mkb(); s.sh('echo "l1\\nMAIN\\nl3" > app.txt && git commit -am main1'); s.sh('git switch fe'); const orig = out(s, 'git rev-parse HEAD');
  fails(s, 'git rebase main'); s.sh('git rebase --abort'); assert.equal(out(s, 'git rev-parse HEAD'), orig); assert.equal(s.repo.branch(), 'fe'); assert.equal(s.repo.rebase, null);
  s = mkb(); const f2 = out(s, 'git rev-parse fe'); assert.match(out(s, `git cherry-pick ${f2}`), /fe2/); assert.ok(s.repo.work.has('f2') && !s.repo.work.has('app.txt') === false);
  assert.notEqual(out(s, 'git rev-parse HEAD'), f2, 'cherry-pick makes a new commit with a new hash');
  console.log('✓ rebase (clean, conflict + continue, abort) and cherry-pick');
}

// 6) 원격: clone · push · fetch · pull · 거절 · 강제 · 보호 · 큰 파일 · 삭제
{
  const s = withRemote();
  assert.equal(out(s, 'git remote -v'), `origin\t${HUB} (fetch)\norigin\t${HUB} (push)`);
  assert.match(out(s, 'git branch -vv'), /\* main\s+[0-9a-f]{7} \[origin\/main\] Initial commit/);
  s.sh('echo m > m && git add . && git commit -m mine');
  assert.match(out(s, 'git status'), /ahead of 'origin\/main' by 1 commit\./);
  assert.match(out(s, 'git push'), new RegExp(`^To ${HUB.replace(/[.]/g, '\\.')}\n   [0-9a-f]{7}\\.\\.[0-9a-f]{7}  main -> main$`));
  assert.match(out(s, 'git status'), /up to date with 'origin\/main'/);
  s.teammate(HUB, 'main', { 't.txt': 'x\n' }, 'teammate');
  assert.match(out(s, 'git status'), /up to date/, 'origin/main is only a photograph until fetch');
  assert.match(out(s, 'git fetch'), /From .*\n   [0-9a-f]{7}\.\.[0-9a-f]{7}  main       -> origin\/main/);
  assert.match(out(s, 'git status'), /behind 'origin\/main' by 1 commit, and can be fast-forwarded/);
  assert.match(out(s, 'git pull'), /Updating [0-9a-f]{7}\.\.[0-9a-f]{7}\nFast-forward/); assert.ok(s.repo.work.has('t.txt'));
}
{
  const s = withRemote(); s.sh('echo m > m && git add . && git commit -m mine'); s.teammate(HUB, 'main', { 't.txt': 'x\n' }, 'teammate');
  assert.match(fails(s, 'git push', /\(fetch first\)/), /error: failed to push some refs to/);
  s.sh('git fetch'); assert.match(fails(s, 'git push', /\(non-fast-forward\)/), /tip of your current branch is behind/);
  assert.match(out(s, 'git status'), /have diverged,\nand have 1 and 1 different commits each/);
  assert.match(fails(s, 'git pull', /Need to specify how to reconcile divergent branches/), /git config pull\.rebase true/);
  fails(s, 'git pull --ff-only', /Not possible to fast-forward/);
  s.sh('git pull --rebase'); assert.deepEqual(oneline(s), ['mine', 'teammate', 'Initial commit']);
  assert.match(out(s, 'git push'), /main -> main/); assert.equal(s.hubRepo(HUB).refs.get('refs/heads/main'), s.repo.headHash());
  // 강제 push 와 lease
  const t = withRemote(); t.sh('echo a > a && git add . && git commit -m a'); t.sh('git push'); t.sh('git commit --amend -m "a2"');
  assert.match(fails(t, 'git push', /non-fast-forward/), /tip of your current branch/); t.teammate(HUB, 'main', { 'z': '1\n' }, 'surprise');
  assert.match(fails(t, 'git push --force-with-lease', /stale info/), /Fetch first/);
  assert.match(out(t, 'git push --force'), /\+ [0-9a-f]{7}\.\.\.[0-9a-f]{7} main -> main \(forced update\)/);
  assert.ok(!t.hubRepo(HUB).history(t.hubRepo(HUB).refs.get('refs/heads/main')).some(h => t.hubRepo(HUB).obj(h).msg === 'surprise'), '--force destroys the teammate\'s commit');
  // 새 브랜치 · upstream · 삭제
  const u = withRemote(); u.sh('git switch -c feature/x'); u.sh('echo x > x && git add . && git commit -m x');
  assert.match(fails(u, 'git push', /has no upstream branch[\s\S]*git push --set-upstream origin feature\/x/), /fatal/);
  assert.match(out(u, 'git push -u origin feature/x'), / \* \[new branch\]      feature\/x -> feature\/x\nbranch 'feature\/x' set up to track 'origin\/feature\/x'\./);
  assert.match(out(u, 'git branch -vv'), /\* feature\/x\s+[0-9a-f]{7} \[origin\/feature\/x\] x/);
  assert.match(out(u, 'git push origin --delete feature/x'), / - \[deleted\]         feature\/x/); assert.ok(!u.hubRepo(HUB).refs.has('refs/heads/feature/x'));
  u.teammate(HUB, 'docs', { 'd': '1\n' }, 'docs'); u.sh('git fetch'); assert.match(out(u, 'git switch docs'), /branch 'docs' set up to track 'origin\/docs'\.\nSwitched to a new branch 'docs'/);
  fails(u, 'git push nowhere', /does not appear to be a git repository/); fails(u, 'git clone https://github.com/none/none.git', /Repository not found/);
  fails(u, `git clone ${HUB}`, /already exists and is not an empty directory/);
  console.log('✓ clone, push, fetch, pull, rejections, force, force-with-lease, upstream and remote branches');
}
{
  const p = withRemote(undefined, { protect: ['main'] }); p.sh('echo d >> README.md && git commit -am docs');
  assert.match(fails(p, 'git push', /GH006: Protected branch update failed for refs\/heads\/main/), /Changes must be made through a pull request/);
  p.sh('git switch -c feature/docs'); assert.match(out(p, 'git push -u origin feature/docs'), /new branch/);
  const b = withRemote(); b.sh('echo "print(1)" > t.py'); b.sh('fallocate model.bin 120MB'); b.sh('git add . && git commit -m "add"');
  assert.match(fails(b, 'git push', /File model\.bin is 120\.00 MB; this exceeds GitHub's file size limit of 100\.00 MB/), /GH001: Large files detected/);
  b.sh('fallocate small.bin 50MB'); assert.equal(b.repo.work.get('small.bin').startsWith('@@SIZE:'), true);
  b.sh('git rm --cached model.bin'); b.sh('git commit --amend --no-edit'); assert.match(out(b, 'git push'), /main -> main/);
  const r = withRemote(); r.sh('echo "K=1" > secrets.env && git add . && git commit -m key'); r.sh('git push'); r.sh('echo more >> README.md && git commit -am docs'); r.sh('git push');
  assert.match(out(r, 'git filter-repo --invert-paths --path secrets.env'), /^Parsed 3 commits\nNew history written/);
  assert.deepEqual(oneline(r), ['docs', 'Initial commit'], 'the commit that became empty is pruned'); assert.equal(out(r, 'git remote -v'), '', 'filter-repo removes origin');
  r.sh(`git remote add origin ${HUB}`); assert.match(fails(r, 'git push', /no upstream|set-upstream/), /fatal/); assert.match(out(r, 'git push --force origin main'), /forced update/);
  const h = r.hubRepo(HUB); assert.ok(h.history(h.refs.get('refs/heads/main')).every(c => !h.treeMap(c).has('secrets.env')));
  const w = mk(); w.sh('echo "x" > f'); w.repo.locks.add('index'); assert.match(fails(w, 'git add f', /Unable to create '.*index\.lock': File exists/), /Another git process/); w.sh('rm .git/index.lock'); w.sh('git add f'); assert.ok(w.repo.index.has('f'));
  const un = new Session(); un.hubCreate(HUB, { 'README.md': 'r\n' }); un.sh('mkdir p && cd p'); un.sh('git init'); un.sh('echo n > n.txt && git add . && git commit -m n'); un.sh(`git remote add origin ${HUB}`);
  fails(un, 'git pull origin main', /refusing to merge unrelated histories/); assert.match(out(un, 'git pull origin main --allow-unrelated-histories'), /Merge made by the 'ort' strategy/);
  console.log('✓ protected branches, the 100 MB limit, filter-repo, index.lock and unrelated histories');
}

// 7) 장애 사례: 모든 사례가 "처음엔 미해결 → 정답으로 해결"이고, 문서가 빠짐없이 있다
{
  const ids = [...LABS, ...GUIDES].map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, 'case ids are unique');
  assert.equal(LABS.length + GUIDES.length, 21, 'the page and menu promise 21 cases');
  const cats = new Set(CATS.map(c => c.id));
  for (const x of [...LABS, ...GUIDES]) { assert.ok(cats.has(x.cat), `${x.id}: known category`); for (const k of ['cause', 'prevent']) assert.ok(x[k].ko && x[k].en, `${x.id}.${k} in both languages`); assert.ok(x.title.ko && x.title.en); }
  for (const g of GUIDES) { assert.ok(g.transcript && g.steps.length >= 3 && g.steps.every(s => s.ko && s.en), `${g.id}: guide steps`); }
  for (const lab of LABS) {
    for (const k of ['symptom', 'goalText', 'fix']) assert.ok(lab[k].ko && lab[k].en, `${lab.id}.${k} in both languages`);
    assert.ok(lab.hints.length >= 1 && lab.hints.every(h => h.ko && h.en), `${lab.id}: hints`);
    const s = new Session(); lab.setup(s);
    assert.equal(lab.goal(s), false, `${lab.id}: not solved at the start`);
    assert.ok(lab.trigger, `${lab.id}: has a trigger`); s.run(lab.trigger);
    assert.equal(lab.goal(s), false, `${lab.id}: the symptom command does not solve it`);
    for (const c of lab.solution) { const r = s.run(c); assert.ok(r.ok, `${lab.id}: solution step failed: ${c}\n${r.out}`); }
    assert.equal(lab.goal(s), true, `${lab.id}: solved after the answer`);
  }
  // 오답 확인: 일부러 위험한 해법은 해결로 치지 않는다
  { const lab = LABS.find(l => l.id === 'push-rejected'), s = new Session(); lab.setup(s); s.run('git push --force'); assert.equal(lab.goal(s), false, 'force-push destroys the teammate commit and is not a solution'); }
  { const lab = LABS.find(l => l.id === 'revert-pushed'), s = new Session(); lab.setup(s); s.run('git reset --hard HEAD~1'); s.run('git push --force'); assert.equal(lab.goal(s), false, 'rewriting shared history is not the revert solution'); }
  { const lab = LABS.find(l => l.id === 'wrong-branch'), s = new Session(); lab.setup(s); s.run('git reset --hard origin/main'); assert.equal(lab.goal(s), false, 'resetting without catching the commits loses them'); }
  console.log(`✓ all ${LABS.length} lab cases start unsolved and are solved by their answers; ${GUIDES.length} guides are complete in both languages`);
}

// 8) 그림: 커밋 그래프와 세 영역 표
{
  globalThis.window = {};
  const { graphSvg, areasHtml } = await import('../assets/git/viz.js');
  const s = mk();
  assert.match(graphSvg(s.repo), /아직 커밋이 없습니다/);
  s.sh('echo a > a && git add . && git commit -m c1'); s.sh('git switch -c f'); s.sh('echo b > b && git add . && git commit -m c2'); s.sh('git switch main'); s.sh('echo c > c && git add . && git commit -m c3'); s.sh('git merge f');
  const svg = graphSvg(s.repo);
  assert.equal((svg.match(/<circle /g) || []).length, 4, 'one circle per commit'); assert.match(svg, /HEAD → main/); assert.match(svg, />f</);
  assert.equal((svg.match(/<path |<line /g) || []).length, 4, 'one edge per parent link (c2→c1, c3→c1, and two for the merge)');
  s.sh('echo x >> a'); const a = areasHtml(s.repo);
  assert.match(a, /chg w/, 'a modified file is highlighted in the working-tree column'); s.sh('git add a'); assert.match(areasHtml(s.repo), /chg i/);
  assert.match(areasHtml(new Session().repo ?? { inited: false }), /저장소가 없습니다/);
  delete globalThis.window;
  console.log('✓ the commit graph and three-area table render the repository state');
}

// 9) 페이지: 메뉴 · 한영 짝 · 고유한 id · 사례 링크 · 안내문의 명령이 실제로 동작한다
{
  const pages = ['git-basics', 'git-branch', 'git-remote', 'git-trouble'];
  const caseIds = new Set([...LABS, ...GUIDES].map(x => x.id));
  const html = Object.fromEntries(pages.map(p => [p, readFileSync(join(root, `${p}.html`), 'utf8')]));
  for (const p of pages) {
    const s = html[p];
    assert.ok(s.includes('id="otherMenu"'), `${p}: menu`); assert.ok(/<meta name="title-en"/.test(s));
    const ko = (s.match(/lang="ko"/g) || []).length, en = (s.match(/lang="en"/g) || []).length;
    assert.ok(ko > 10 && Math.abs(ko - en) <= 8, `${p}: Korean (${ko}) and English (${en}) texts are paired`);
    const ids = [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${p}: duplicate ids ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
    for (const m of s.matchAll(/href="(git-[a-z]+\.html)(?:#case=([a-z-]+))?"/g)) { assert.ok(pages.includes(m[1].replace('.html', '')), `${p}: link ${m[1]}`); if (m[2]) assert.ok(caseIds.has(m[2]), `${p}: case link ${m[2]}`); }
  }
  const chips = (sec) => [...sec.matchAll(/data-run='([^']*)'/g)].map(m => m[1].replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  const section = (h, id) => h.split(`<section id="${id}"`)[1].split('</section>')[0];
  const runAll = (s, list, expectFail = []) => list.forEach((c, i) => { const r = s.run(c); assert.equal(r.ok, !expectFail.includes(i), `step ${i + 1} "${c}": ${r.out}`); });
  const demo = () => { const s = new Session(); s.mkdir('demo'); s.cwd = 'demo'; s.sh('git init'); s.sh('git config user.name "You"'); s.sh('git config user.email "y@e.com"'); return s; };
  { const c = chips(section(html['git-basics'], 'lab')); assert.equal(c.length, 13); const s = demo(); runAll(s, c); assert.equal(s.repo.work.get('a.txt'), 'hello\nworld\n'); assert.deepEqual(oneline(s), ['world 추가', '첫 커밋']); }
  { const fresh = () => demo(); const s = fresh(); s.cwd = 'demo';
    const make1 = () => { const t = new Session(); t.mkdir('grid'); t.cwd = 'grid'; t.sh('git init'); t.sh('git config user.name "You"'); t.sh('git config user.email "y@e.com"'); t.sh('echo "one" > a.txt && git add . && git commit -m "init: a.txt"'); t.sh('echo "two" > b.txt && git add . && git commit -m "add b.txt"'); t.sh('echo "three" > c.txt && git add . && git commit -m "add c.txt"'); return t; };
    const b1 = chips(section(html['git-branch'], 'branch')), t1 = make1(); runAll(t1, b1); assert.equal(t1.repo.obj(t1.repo.headHash()).parents.length, 2, 'the walkthrough ends on a merge commit'); assert.ok(!t1.repo.refs.has('refs/heads/login'));
    const b2 = chips(section(html['git-branch'], 'conflict')), t2 = new Session(); t2.mkdir('grid'); t2.cwd = 'grid'; t2.sh('git init'); t2.sh('git config user.name "You"'); t2.sh('git config user.email "y@e.com"'); t2.sh('echo "line1\\nline2\\nline3" > app.txt && git add . && git commit -m "add app.txt"');
    runAll(t2, b2, [4, 7]); assert.equal(t2.repo.merge, null); assert.equal(t2.repo.work.get('app.txt'), 'line1\nline2 (green+blue)\nline3\n'); }
  { const s = new Session(); s.hubCreate(HUB, { 'README.md': '# grid\n', 'app.txt': 'line1\nline2\nline3\n' });
    const secs = section(html['git-remote'], 'lab').split('<h3>'); assert.equal(secs.length, 4);
    runAll(s, chips(secs[1])); s.teammate(HUB, 'main', { 'team.txt': 'hello from teammate 0\n' }, 'teammate: add team.txt');
    runAll(s, chips(secs[2])); assert.ok(s.repo.work.has('team.txt'), 'pull brought the teammate file');
    runAll(s, chips(secs[3]), [2]); assert.ok(!s.hubRepo(HUB).refs.has('refs/heads/feature/x'), 'the remote branch was deleted at the end'); }
  console.log('✓ the four Git pages are well formed and every command in the walkthroughs works as the text says');
}
