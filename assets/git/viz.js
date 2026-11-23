// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Git 상태 그림: 커밋 그래프(SVG)와 "작업 폴더 · 스테이지 · 저장소" 세 영역 표. 계산은 core.js 의 Repo 를 읽기만 한다.
import { esc, T } from '../lib/dom.js?v=3b73d59c';
import { short, hashObject } from './core.js?v=1f5924e3';

const LANE = ['#2a78d6', '#1f9d6b', '#d95926', '#8a63d2', '#b8860b', '#d33'];

export function graphSvg(repo, { max = 16, title = '' } = {}) {
  if (!repo || !repo.inited) return `<p class="meta">${T('(아직 저장소가 없습니다)', '(no repository yet)')}</p>`;
  let all = [...repo.reachable()];
  if (!all.length) return `<p class="meta">${T('(아직 커밋이 없습니다 — 첫 커밋을 만들어 보세요)', '(no commits yet — make the first one)')}</p>`;
  all.sort((a, b) => repo.obj(b).time - repo.obj(a).time);
  const hidden = Math.max(0, all.length - max);
  const keep = new Set(all.slice(0, max));
  const gen = new Map();
  const g = (h) => { if (gen.has(h)) return gen.get(h); const ps = repo.obj(h).parents; const v = ps.length ? Math.max(...ps.map(g)) + 1 : 0; gen.set(h, v); return v; };
  for (const h of keep) g(h);
  const minG = Math.min(...[...keep].map(g));
  // 브랜치 끝에서 첫 부모를 따라가며 한 줄(레인)을 정한다
  const lanes = new Map();
  let nl = 0;
  const chain = (h, lane) => { while (h && keep.has(h) && !lanes.has(h)) { lanes.set(h, lane); h = repo.obj(h).parents[0]; } };
  const tips = [];
  if (repo.headHash()) tips.push(repo.headHash());
  for (const b of repo.branches()) tips.push(repo.refs.get(`refs/heads/${b}`));
  for (const [r, h] of repo.refs) if (!r.startsWith('refs/heads/')) tips.push(h);
  for (const h of tips) if (keep.has(h) && !lanes.has(h)) chain(h, nl++);
  for (const h of keep) if (!lanes.has(h)) chain(h, nl++);
  const X = (h) => 58 + (g(h) - minG) * 58, Y = (h) => 56 + lanes.get(h) * 46;
  const W = Math.max(...[...keep].map(X)) + 70, H = 56 + (nl - 1) * 46 + 44;
  // 이름표: 같은 커밋의 참조는 위로 쌓는다
  const labels = new Map();
  const add = (h, text, kind) => { if (keep.has(h)) (labels.get(h) || labels.set(h, []).get(h)).push({ text, kind }); };
  if (repo.headHash()) add(repo.headHash(), repo.head.ref ? `HEAD → ${repo.branch()}` : 'HEAD', 'head');
  for (const [r, h] of repo.refs) {
    if (r.startsWith('refs/heads/')) { if (!(repo.head.ref === r)) add(h, r.slice(11), 'branch'); }
    else if (r.startsWith('refs/remotes/')) add(h, r.slice(13), 'remote');
    else if (r.startsWith('refs/tags/')) add(h, r.slice(10), 'tag');
  }
  let svg = `<svg class="gv" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title || 'commit graph')}">`;
  for (const h of keep) for (const p of repo.obj(h).parents) if (keep.has(p)) {
    const x1 = X(p), y1 = Y(p), x2 = X(h), y2 = Y(h);
    svg += y1 === y2 ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LANE[lanes.get(h) % 6]}" stroke-width="2.5"/>`
      : `<path d="M${x1},${y1} C${x1 + 26},${y1} ${x2 - 26},${y2} ${x2},${y2}" fill="none" stroke="${LANE[lanes.get(h) % 6]}" stroke-width="2.5"/>`;
  }
  for (const h of keep) {
    const c = repo.obj(h), x = X(h), y = Y(h), isHead = repo.headHash() === h;
    svg += `<g><title>${esc(short(h))} · ${esc(c.msg.split('\n')[0])}</title><circle cx="${x}" cy="${y}" r="${c.parents.length > 1 ? 8 : 7}" fill="${LANE[lanes.get(h) % 6]}" stroke="${isHead ? 'var(--text)' : 'var(--surface)'}" stroke-width="${isHead ? 3 : 2}"/>`;
    svg += `<text x="${x}" y="${y + 24}" text-anchor="middle" class="gv-h">${short(h)}</text></g>`;
    (labels.get(h) || []).forEach((l, i) => {
      const w = l.text.length * 6.4 + 12, yy = y - 20 - i * 18;
      svg += `<g class="gv-chip ${l.kind}"><rect x="${x - w / 2}" y="${yy - 11}" width="${w}" height="16" rx="8"/><text x="${x}" y="${yy + 1}" text-anchor="middle">${esc(l.text)}</text></g>`;
    });
  }
  svg += '</svg>';
  return `<div class="gv-wrap">${svg}</div>${hidden ? `<p class="meta">${T(`… 오래된 커밋 ${hidden}개는 생략`, `… ${hidden} older commits hidden`)}</p>` : ''}`;
}

// 파일마다 "작업 폴더 · 스테이지 · 저장소(HEAD)"에서의 내용 해시를 나란히: 다르면 강조
export function areasHtml(repo) {
  if (!repo || !repo.inited) return `<p class="meta">${T('(저장소가 없습니다)', '(no repository)')}</p>`;
  const head = repo.treeMap(repo.headHash());
  const paths = [...new Set([...repo.work.keys(), ...repo.index.keys(), ...head.keys()])].sort();
  if (!paths.length) return `<p class="meta">${T('(파일이 없습니다 — echo "글" > a.txt 로 만들어 보세요)', '(no files — make one with echo "text" > a.txt)')}</p>`;
  const conf = new Set(repo.merge?.conflicts || []);
  const rows = paths.map(p => {
    const w = repo.work.has(p) ? short(hashObject('blob', repo.work.get(p))) : null, i = repo.index.has(p) ? short(repo.index.get(p)) : null, h = head.has(p) ? short(head.get(p)) : null;
    const ign = repo.work.has(p) && !repo.index.has(p) && repo.isIgnored(p);
    const wd = repo.index.has(p) ? w !== i : (w && !ign), id = i !== h;
    const cell = (v, d, k) => `<td class="${v ? '' : 'none'} ${d ? 'chg ' + k : ''}">${v ?? '—'}</td>`;
    return `<tr class="${conf.has(p) ? 'conf' : ''}"><th scope="row">${esc(p)}${ign ? ` <small>${T('무시됨', 'ignored')}</small>` : ''}${conf.has(p) ? ' ⚔' : ''}</th>${cell(w, wd, 'w')}${cell(i, id, 'i')}${cell(h, false, '')}</tr>`;
  }).join('');
  return `<div class="net-scroll"><table class="net-tab ar-tab"><thead><tr><th></th><th>${T('① 작업 폴더', '① Working tree')}</th><th>${T('② 스테이지', '② Stage (index)')}</th><th>${T('③ 저장소 (HEAD)', '③ Repository (HEAD)')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
