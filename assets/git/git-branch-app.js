// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 브랜치 · 병합 · 충돌 페이지: 실습 터미널 둘, 그리고 merge 와 rebase 결과를 나란히 보여 주는 그림
import { Session } from './cmds.js?v=478b631d';
import { mountLab } from './lab.js?v=cb002380';
import { graphSvg } from './viz.js?v=6f9fac9c';
import { $ } from '../lib/dom.js?v=3b73d59c';

function fresh() {
  const s = new Session();
  s.mkdir('grid'); s.cwd = 'grid';
  s.sh('git init'); s.sh('git config user.name "You"'); s.sh('git config user.email "you@example.com"');
  return s;
}
function make1() {
  const s = fresh();
  s.sh('echo "one" > a.txt && git add . && git commit -m "init: a.txt"');
  s.sh('echo "two" > b.txt && git add . && git commit -m "add b.txt"');
  s.sh('echo "three" > c.txt && git add . && git commit -m "add c.txt"');
  return s;
}
function make2() {
  const s = fresh();
  s.sh('echo "line1\\nline2\\nline3" > app.txt && git add . && git commit -m "add app.txt"');
  return s;
}
const lab1 = mountLab({ term: 'term1', areas: 'areas1', graph: 'graph1', make: make1, scope: '#branch' });
const lab2 = mountLab({ term: 'term2', areas: 'areas2', graph: 'graph2', make: make2, scope: '#conflict' });
$('reset1').addEventListener('click', () => lab1.reset());
$('reset2').addEventListener('click', () => lab2.reset());

function compare() {
  const mk = () => {
    const s = fresh();
    s.sh('echo A > a.txt && git add . && git commit -m "A"');
    s.sh('git switch -c feature'); s.sh('echo C > c.txt && git add . && git commit -m "C"');
    s.sh('git switch main'); s.sh('echo B > b.txt && git add . && git commit -m "B"');
    return s;
  };
  const m = mk(); m.sh('git merge feature');
  const r = mk(); r.sh('git switch feature && git rebase main && git switch main && git merge feature');
  $('gMerge').innerHTML = graphSvg(m.repo); $('gRebase').innerHTML = graphSvg(r.repo);
  $('lMerge').textContent = '$ git log --oneline\n' + m.run('git log --oneline').out;
  $('lRebase').textContent = '$ git log --oneline\n' + r.run('git log --oneline').out;
}
compare();
document.addEventListener('langchange', compare);
