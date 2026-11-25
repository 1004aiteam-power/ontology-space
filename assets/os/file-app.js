// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 파일시스템 페이지: 연산 하나를 블록 쓰기로 나누고, 원하는 순간에 전원을 끈 뒤 복구 · fsck 결과를 보여 준다 (계산은 fs.js)
import { MODES, NB, mkfs, steps, crashAt, fsck, readFile } from './fs.js?v=042ac63a';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const OPS = [
  { id: 'create', ko: '새 파일 만들기', en: 'Create a file', op: { kind: 'create', name: 'report.txt', text: 'Q3 sales up 12 percent' } },
  { id: 'append', ko: '파일에 덧붙이기', en: 'Append to a file', op: { kind: 'append', name: 'notes.txt', text: ' + bring slides' } },
  { id: 'delete', ko: '파일 지우기', en: 'Delete a file', op: { kind: 'delete', name: 'notes.txt', text: '' } }
];
const MN = { none: { ko: '저널 없음 (ext2 · FAT)', en: 'No journal (ext2 · FAT)' }, ordered: { ko: '메타데이터 저널 (ext4 기본 ordered)', en: 'Metadata journal (ext4 default, ordered)' }, journal: { ko: '전체 저널 (data=journal)', en: 'Full journal (data=journal)' } };
const KC = { dir: '#8a63d2', inode: '#2a78d6', bitmap: '#b8860b', data: '#1f9d6b', jw: '#c2549d', commit: '#c2549d', jfree: '#8d6e63' };
const ICOL = ['#9aa0a6', '#d95926', '#2a78d6', '#1f9d6b', '#8a63d2', '#c2549d', '#0097a7', '#8d6e63'];
const S0 = mkfs();
let opId = 'create', mode = 'none', crash = 2, text = OPS[0].op.text;

const curOp = () => { const o = OPS.find(x => x.id === opId).op; return { ...o, text: o.kind === 'delete' ? '' : text || 'x' }; };
const listOf = (op, m) => { const s = steps(S0, op, m); return s ? (m === 'none' ? s : s.list) : []; };

// 결과가 "연산 전 · 연산 후 · 섞임" 중 무엇인가
function outcome(op, m, c) {
  const r = crashAt(S0, op, m, c), f = fsck(r.disk);
  const fin = crashAt(S0, op, m, listOf(op, m).length).disk;
  const view = (D) => JSON.stringify(Object.keys(D.dir).sort().map(n => [n, readFile(D, n)?.text ?? '!']));
  const junk = Object.keys(r.disk.dir).some(n => { const x = readFile(r.disk, n); return !x || x.err || x.text.includes('#old'); });
  const sev = f.some(x => x.sev === 'bad') ? 'bad' : f.length ? 'warn' : junk ? 'junk' : 'ok';
  const st = view(r.disk) === view(S0) && !f.length ? 'old' : view(r.disk) === view(fin) && !f.length ? 'new' : 'mixed';
  return { r, f, sev, st, junk };
}

function render() {
  const op = curOp(), list = listOf(op, mode);
  crash = Math.min(crash, list.length);
  $('fsOps').innerHTML = OPS.map(o => `<button type="button" data-id="${o.id}" aria-pressed="${o.id === opId}">${esc(t(o))}</button>`).join('');
  $('fsModes').innerHTML = MODES.map(m => `<button type="button" data-m="${m}" aria-pressed="${m === mode}">${esc(t(MN[m]))}</button>`).join('');
  $('fsTextL').hidden = opId === 'delete';
  $('fsCrash').max = list.length; $('fsCrash').value = crash;
  $('fsCrashOut').textContent = crash >= list.length ? T('끝까지 완료 (정전 없음)', 'Completed (no power loss)') : T(`${crash}단계까지 쓰고 정전`, `Power lost after step ${crash}`);
  $('fsSteps').innerHTML = list.map((x, i) => `${i === crash ? `<li class="fs-cut">⚡ ${T('여기서 전원이 나감', 'Power is lost here')}</li>` : ''}<li class="${i < crash ? 'done' : 'lost'}" style="--c:${KC[x.k]}"><span class="fs-k">${x.k}</span> ${esc(t(x))}</li>`).join('');
  const o = outcome(op, mode, crash), D = o.r.disk;
  // 디스크 그림
  const owner = Array(NB).fill(null); D.inodes.forEach((n, i) => { if (n.used) for (const b of n.blocks) owner[b] = i; });
  const bad = new Set(o.f.filter(x => /^block (\d+)/.test(x.en)).map(x => +x.en.match(/^block (\d+)/)[1]));
  $('fsDisk').innerHTML = `<div class="fs-blocks">${D.blocks.map((b, i) => `<div class="fs-b${D.bitmap[i] ? ' used' : ''}${bad.has(i) ? ' bad' : ''}" style="--c:${owner[i] === null ? 'var(--line)' : ICOL[owner[i]]}"><small>${i}${D.bitmap[i] ? ' ■' : ' □'}</small><code>${esc(b) || '&nbsp;'}</code></div>`).join('')}</div>
    <p class="meta">${T('■ = 비트맵에서 사용 중, □ = 빈 칸. 테두리 색 = 그 블록을 가리키는 inode, 빨간 테두리 = 맞지 않음.', '■ = marked in use in the bitmap, □ = free. Border colour = the inode pointing at the block; red border = inconsistent.')}</p>
    <div class="fs-meta"><table class="net-tab os-regs"><caption>${T('디렉터리 (/)', 'Directory (/)')}</caption><thead><tr><th>${T('이름', 'Name')}</th><th>inode</th></tr></thead><tbody>${Object.entries(D.dir).map(([n, i]) => `<tr><td>${esc(n)}</td><td><i class="os-dot" style="--c:${ICOL[i]}"></i>${i}</td></tr>`).join('') || `<tr><td colspan="2" class="meta">${T('비어 있음', 'empty')}</td></tr>`}</tbody></table>
    <table class="net-tab os-regs"><caption>${T('inode 표', 'inode table')}</caption><thead><tr><th>#</th><th>${T('사용', 'Used')}</th><th>${T('크기', 'Size')}</th><th>${T('블록', 'Blocks')}</th></tr></thead><tbody>${D.inodes.map((n, i) => `<tr class="${n.used ? '' : 'off'}"><td><i class="os-dot" style="--c:${ICOL[i]}"></i>${i}${n.root ? ' /' : ''}</td><td>${n.used ? '●' : ''}</td><td>${n.used && !n.root ? n.size : ''}</td><td>${n.blocks.join(', ')}</td></tr>`).join('')}</tbody></table></div>`;
  const files = Object.keys(D.dir).sort();
  $('fsCheck').innerHTML = `${o.r.recovery ? `<p class="os-now">🔁 ${esc(t(o.r.recovery))}</p>` : mode === 'none' && crash < list.length ? `<p class="os-now">${T('저널이 없으므로 재부팅 때 디스크 전체를 fsck로 훑어야 합니다 (큰 디스크는 몇 시간).', 'With no journal, the whole disk must be scanned by fsck on reboot (hours for a big disk).')}</p>` : ''}
    <h4>fsck</h4>${o.f.length ? `<ul class="os-log">${o.f.map(x => `<li class="${x.sev === 'bad' ? 'no' : 'warn'}">${esc(t(x))}</li>`).join('')}</ul>` : `<p class="rc-ok">${T('문제 없음: 디렉터리 · inode · 비트맵이 서로 맞음', 'Clean: directory, inodes and bitmap agree')}</p>`}
    <h4>${T('사용자가 보는 것', 'What the user sees')}</h4><pre class="cn-code"><code>$ ls\n${esc(files.join('  ')) || ''}\n${files.map(n => { const x = readFile(D, n); return `$ cat ${n}\n${x.err ? `cat: ${n}: ${T('입출력 오류', 'Input/output error')}` : x.text}`; }).map(esc).join('\n')}</code></pre>
    ${o.junk && !o.f.some(x => x.sev === 'bad') ? `<p class="os-warn">${T('fsck는 "구조"만 검사합니다. 내용이 예전 파일의 흔적(#old…)인 것은 찾지 못합니다: 데이터가 쓰이기 전에 메타데이터가 먼저 디스크에 닿았기 때문입니다. ordered 방식이 막는 것이 바로 이것입니다.', 'fsck checks structure only. It cannot see that the contents are leftovers of an old file (#old…): the metadata reached the disk before the data. This is exactly what ordered mode prevents.')}</p>` : ''}`;
  // 모든 정전 시점 한눈에
  const lab = { old: T('전', 'before'), new: T('후', 'after'), mixed: T('섞임', 'mixed') };
  $('fsAll').innerHTML = `<table class="fs-all"><thead><tr><th>${T('방식 \\ 정전 시점', 'Mode \\ power lost after step')}</th>${Array.from({ length: Math.max(...MODES.map(m => listOf(op, m).length)) + 1 }, (_, i) => `<th>${i}</th>`).join('')}</tr></thead><tbody>${MODES.map(m => {
    const n = listOf(op, m).length;
    return `<tr><th>${esc(t(MN[m]))}</th>${Array.from({ length: n + 1 }, (_, c) => { const x = outcome(op, m, c); return `<td class="${x.sev}${m === mode && c === crash ? ' sel' : ''}" data-m="${m}" data-c="${c}" tabindex="0">${x.sev === 'ok' ? lab[x.st] : x.sev === 'junk' ? T('쓰레기', 'junk') : x.sev === 'bad' ? T('깨짐', 'broken') : T('누수', 'leak')}</td>`; }).join('')}</tr>`;
  }).join('')}</tbody></table>`;
}

function init() {
  $('fsOps').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; opId = b.dataset.id; text = OPS.find(x => x.id === opId).op.text; $('fsText').value = text; crash = 2; render(); });
  $('fsModes').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; render(); });
  $('fsCrash').addEventListener('input', () => { crash = +$('fsCrash').value; render(); });
  $('fsText').addEventListener('input', () => { text = $('fsText').value.slice(0, 32); render(); });
  const pick = (e) => { const td = e.target.closest('td[data-m]'); if (!td) return; mode = td.dataset.m; crash = +td.dataset.c; render(); };
  $('fsAll').addEventListener('click', pick);
  $('fsAll').addEventListener('keydown', e => { if (e.key === 'Enter') pick(e); });
  document.addEventListener('langchange', render);
  $('fsText').value = text;
  render();
}
init();
