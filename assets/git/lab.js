// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Git 페이지 공통 실습 틀: 터미널 + 상태 그림(세 영역 · 커밋 그래프)을 묶고, 명령 칩(data-run)을 눌러 실행하게 한다
import { $, T } from '../lib/dom.js?v=3b73d59c';
import { createTerminal } from './terminal.js?v=bb7b666f';
import { graphSvg, areasHtml } from './viz.js?v=6f9fac9c';

export function mountLab({ term, areas, graph, remote, make, welcome, onRun, scope = 'main' }) {
  let sess = make();
  const render = () => {
    const r = sess.repo;
    if (areas) $(areas).innerHTML = areasHtml(r);
    if (graph) $(graph).innerHTML = graphSvg(r, { title: 'local' });
    if (remote) {
      const h = [...sess.hub.values()][0];
      $(remote).innerHTML = h ? graphSvg(h, { title: 'remote' }) : '';
    }
  };
  const t = createTerminal($(term), { session: sess, onRun: (line, res) => { render(); onRun?.(line, res, sess); } });
  const hello = () => { t.print(welcome ? welcome() : T("Git 터미널입니다. 'help' 로 사용할 수 있는 명령을 볼 수 있습니다.", "A Git terminal. Type 'help' to see the available commands."), 'h'); };
  hello(); render();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-run]');
    if (!b || !b.closest(scope)) return;
    t.run(b.dataset.run);
    b.closest('li')?.classList.add('done');
    t.focus();
  });
  document.addEventListener('langchange', render);
  return {
    term: t, render, get session() { return sess; },
    reset() { sess = make(); t.setSession(sess); t.clear(); document.querySelectorAll('.gt-steps li.done').forEach(l => l.classList.remove('done')); hello(); render(); }
  };
}
