// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 브라우저 안의 터미널 화면: 줄을 입력하면 Session(cmds.js)이 실행하고 결과를 색을 입혀 보여 준다. ↑ ↓ 로 지난 명령을 불러온다.
import { esc } from '../lib/dom.js?v=3b73d59c';

const cls = (l) => (/^(error|fatal|CONFLICT)\b|^remote: error|^ ! \[rejected\]|^ ! \[remote rejected\]|^U\t/.test(l) ? 'e' : /^hint:|^remote:|^warning:/i.test(l) ? 'h' : /^(Switched|Successfully|Merge made|Fast-forward|Initialized|Cloning|Saved|HEAD is now)/.test(l) ? 'o' : '');

export function createTerminal(box, { session, onRun } = {}) {
  box.classList.add('gt');
  box.innerHTML = '<div class="gt-out" role="log" aria-live="polite" tabindex="0"></div><form class="gt-in" autocomplete="off"><span class="gt-prompt"></span><input type="text" class="gt-line" aria-label="terminal input" autocapitalize="off" autocorrect="off" spellcheck="false"></form>';
  const out = box.querySelector('.gt-out'), form = box.querySelector('form'), inp = box.querySelector('input'), pr = box.querySelector('.gt-prompt');
  const hist = [];
  let hp = 0, sess = session;
  const refreshPrompt = () => { pr.textContent = sess.prompt() + ' '; };
  const scroll = () => { out.scrollTop = out.scrollHeight; };
  const t = {
    get session() { return sess; },
    setSession(s) { sess = s; refreshPrompt(); },
    print(text, c = '') { const d = document.createElement('div'); d.className = 'gt-l ' + c; d.innerHTML = esc(text) || '&nbsp;'; out.appendChild(d); scroll(); },
    clear() { out.innerHTML = ''; },
    // 명령을 화면에 보이며 실행. echo=false 면 화면에는 안 보이고 조용히 실행 (처음 상태 만들기)
    run(line, { echo = true } = {}) {
      if (echo) { const d = document.createElement('div'); d.className = 'gt-l gt-cmd-l'; d.innerHTML = `<span class="gt-p">${esc(sess.prompt())}</span> ${esc(line)}`; out.appendChild(d); }
      if (line.trim() === 'clear') { t.clear(); refreshPrompt(); return { out: '', ok: true }; }
      const r = sess.run(line);
      if (echo && r.out) for (const l of r.out.split('\n')) t.print(l, cls(l));
      refreshPrompt(); scroll();
      onRun?.(line, r);
      return r;
    },
    focus() { inp.focus({ preventScroll: true }); }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = inp.value;
    inp.value = '';
    if (!line.trim()) { t.print(sess.prompt()); return; }
    hist.push(line); hp = hist.length;
    t.run(line);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { if (hp > 0) inp.value = hist[--hp]; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { inp.value = hp < hist.length - 1 ? hist[++hp] : (hp = hist.length, ''); e.preventDefault(); }
  });
  box.addEventListener('click', (e) => { if (!window.getSelection().toString() && e.target.closest('.gt-out, .gt-in')) inp.focus({ preventScroll: true }); });
  refreshPrompt();
  return t;
}
