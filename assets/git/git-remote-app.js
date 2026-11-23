// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// GitHub 와 함께 페이지: 가짜 GitHub 저장소를 상대로 clone · push · fetch · pull 을 하고, 동료가 올리는 상황을 만든다
import { Session } from './cmds.js?v=478b631d';
import { URL } from './scenarios.js?v=ea32b874';
import { mountLab } from './lab.js?v=cb002380';
import { $, T } from '../lib/dom.js?v=3b73d59c';

function make() {
  const s = new Session();
  s.hubCreate(URL, { 'README.md': '# grid\n', 'app.txt': 'line1\nline2\nline3\n' });
  return s;
}
let n = 0;
const lab = mountLab({
  term: 'term', graph: 'gGraph', remote: 'graphRemote', make,
  welcome: () => T(`GitHub 저장소 ${URL} 가 준비되어 있습니다. git clone 으로 시작하세요.`, `A GitHub repo ${URL} is ready. Start with git clone.`)
});
const mate = (files, msg, branch = 'main') => {
  n++;
  lab.session.teammate(URL, branch, files, msg);
  lab.term.print(T(`(동료가 GitHub ${branch} 에 "${msg}" 커밋을 올렸습니다 — 내 컴퓨터는 아직 모릅니다)`, `(a teammate pushed "${msg}" to GitHub ${branch}; your computer does not know yet)`), 'h');
  lab.render();
};
$('mate').addEventListener('click', () => mate({ 'team.txt': `hello from teammate ${n}\n` }, 'teammate: add team.txt'));
$('mate2').addEventListener('click', () => mate({ 'docs.md': '# docs\n' }, 'docs: start', 'feature/docs'));
$('reset').addEventListener('click', () => { n = 0; lab.reset(); });
