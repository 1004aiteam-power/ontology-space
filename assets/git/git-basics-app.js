// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Git 구조와 로컬 명령 페이지: 터미널 + 세 영역 표 + 커밋 그래프, 그리고 해시 계산기
import { Session } from './cmds.js?v=478b631d';
import { hashObject } from './core.js?v=1f5924e3';
import { mountLab } from './lab.js?v=cb002380';
import { $, T } from '../lib/dom.js?v=3b73d59c';

function make() {
  const s = new Session();
  s.mkdir('demo'); s.cwd = 'demo';
  s.sh('git init'); s.sh('git config user.name "You"'); s.sh('git config user.email "you@example.com"');
  return s;
}
const lab = mountLab({ term: 'term', areas: 'areas', graph: 'gGraph', make });
$('reset').addEventListener('click', () => lab.reset());

const enc = new TextEncoder();
function hash() {
  const text = $('hIn').value, n = enc.encode(text).length, h = hashObject('blob', text);
  const shown = text.replace(/\n/g, '\\n');
  $('hOut').innerHTML = `${T('내용', 'content')}: <b>${shown.replace(/</g, '&lt;') || '(empty)'}</b> (${n} bytes)<br>${T('해시 입력', 'hashed input')}: <b>blob ${n}\\0${shown.replace(/</g, '&lt;')}</b><br>SHA-1: <b>${h}</b><br>${T('저장 위치', 'stored at')}: <b>.git/objects/${h.slice(0, 2)}/${h.slice(2)}</b>`;
}
$('hIn').addEventListener('input', hash);
document.addEventListener('langchange', hash);
hash();
