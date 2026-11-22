// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 직접 접근 페이지: 표를 페이지 바이트로 보여 주고, 전체 훑기와 B+트리 탐색을 비교하며, WAL 실험을 한다 (계산은 storage.js)
import { ASSETS } from './data.js?v=b680931a';
import { buildFile, buildBTree, fullScan, lookupById, slotCount, PAGE, costModel, walDemo, readSlot } from './storage.js?v=56708b13';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';
import { kb } from './ui.js?v=2ed6a6af';

const file = buildFile(ASSETS), tree = buildBTree(file);
let selRid = null;
const hx = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');

// 바이트마다 구역(머리 · 슬롯 · 레코드 · 빈 공간) 정하기
function regions(n) {
  const p = file.pages[n], cnt = slotCount(p), cls = new Array(PAGE).fill('fr');
  for (let i = 0; i < 4; i++) cls[i] = 'hd';
  for (let i = 4; i < 4 + cnt * 4; i++) cls[i] = 'sl';
  for (let s = 0; s < cnt; s++) {
    const o = (p[4 + s * 4] << 8) | p[5 + s * 4], l = (p[6 + s * 4] << 8) | p[7 + s * 4];
    for (let i = o; i < o + l; i++) cls[i] = 'rc' + (selRid && selRid[0] === n && selRid[1] === s ? ' sel' : '');
  }
  return cls;
}
function pagesHtml() {
  return file.pages.map((p, n) => {
    const cls = regions(n);
    let rows = '';
    for (let r = 0; r < PAGE; r += 16) {
      let h = '';
      for (let i = r; i < r + 16; i++) h += `<span class="${cls[i]}">${p[i].toString(16).padStart(2, '0')}</span>`;
      rows += `<div><span class="off">${r.toString(16).padStart(2, '0')}</span>${h}</div>`;
    }
    return `<div class="fl-page"><h4>${T('페이지', 'Page')} ${n} <small>${slotCount(p)} ${T('레코드', 'records')}</small></h4><div class="hexrow2">${rows}</div></div>`;
  }).join('');
}
function rowsHtml() {
  const head = `<thead><tr><th>${T('행', 'Row')}</th><th>id</th><th>name</th><th>health</th><th>→ ${T('위치 (페이지, 슬롯)', 'location (page, slot)')}</th></tr></thead>`;
  const on = (i) => selRid && selRid[0] === file.rids[i][0] && selRid[1] === file.rids[i][1];
  return head + '<tbody>' + ASSETS.map((a, i) => `<tr data-i="${i}" tabindex="0" class="${on(i) ? 'sel' : ''}"><td>${i + 1}</td><td>${a.id}</td><td>${a.name}</td><td>${a.health}</td><td>${file.rids[i][0]}, ${file.rids[i][1]}</td></tr>`).join('') + '</tbody>';
}
function pick(i) {
  selRid = file.rids[i];
  const a = ASSETS[i], [pg, sl] = selRid, rec = readSlot(file.pages[pg], sl);
  $('fDecode').innerHTML = T(`행 ${i + 1} (${a.id}) → 페이지 ${pg}의 슬롯 ${sl}, 레코드 ${rec.length}바이트: <code>${hx(rec)}</code> — 첫 바이트 ${rec[0]}은 id의 길이이고, 뒤따르는 ${rec[0]}바이트가 "${esc(a.id)}"입니다.`,
    `Row ${i + 1} (${a.id}) → slot ${sl} of page ${pg}, ${rec.length} bytes: <code>${hx(rec)}</code> — the first byte, ${rec[0]}, is the id's length, and the next ${rec[0]} bytes spell "${esc(a.id)}".`);
  $('fRows').innerHTML = rowsHtml(); $('fPages').innerHTML = pagesHtml();
}

function treeHtml(path = []) {
  const levels = [];
  const walk = (id, d) => { (levels[d] ||= []).push(id); const n = tree.nodes[id]; if (!n.leaf) n.children.forEach(c => walk(c, d + 1)); };
  walk(tree.root, 0);
  return levels.map(ids => `<div class="bt-level">${ids.map(id => { const n = tree.nodes[id]; return `<span class="bt-node ${n.leaf ? 'leaf' : ''} ${path.includes(id) ? 'hit' : ''}">${n.keys.map(esc).join(' · ')}</span>`; }).join('')}</div>`).join('');
}
const scanHtml = (found) => `<div class="bt-level">${file.pages.map((_, n) => `<span class="bt-node hit ${found === n ? 'found' : ''}">${T('페이지', 'Page')} ${n}</span>`).join('')}</div>`;

function searchId() {
  const id = $('sId').value;
  const sc = fullScan(file, r => r.id === id);
  const ix = lookupById(file, tree, id);
  $('sScan').innerHTML = scanHtml(ix.rid ? ix.rid[0] : -1) + `<p class="meta">${T(`페이지 ${sc.pagesRead}개를 모두 읽음`, `Read all ${sc.pagesRead} pages`)}</p>`;
  $('sTree').innerHTML = treeHtml(ix.path) + `<p class="meta">${T(`인덱스 마디 ${ix.nodesRead}개 + 데이터 페이지 ${ix.pagesRead}개`, `${ix.nodesRead} index nodes + ${ix.pagesRead} data page`)}</p>`;
  $('sResult').innerHTML = ix.row
    ? T(`찾음: ${esc(JSON.stringify(ix.row))}. 읽은 페이지: 전체 훑기 ${sc.pagesRead}개 vs 인덱스 ${ix.nodesRead + ix.pagesRead}개 (12행이라 차이가 작지만 아래 표처럼 행이 늘면 벌어집니다).`,
      `Found: ${esc(JSON.stringify(ix.row))}. Pages read: full scan ${sc.pagesRead} vs index ${ix.nodesRead + ix.pagesRead} (a small gap at 12 rows, but it widens as the table below shows).`)
    : T(`"${esc(id)}"는 없습니다. 인덱스는 마디 ${ix.nodesRead}개만 읽고 "없음"을 알지만, 전체 훑기는 ${sc.pagesRead}개를 다 읽어야 압니다.`,
      `"${esc(id)}" does not exist. The index learns that after ${ix.nodesRead} nodes; the full scan reads all ${sc.pagesRead} pages to know.`);
}
function searchHealth() {
  const sc = fullScan(file, r => r.health >= 90);
  $('sScan').innerHTML = scanHtml(-1) + `<p class="meta">${T(`페이지 ${sc.pagesRead}개를 모두 읽음`, `Read all ${sc.pagesRead} pages`)}</p>`;
  $('sTree').innerHTML = treeHtml([]) + `<p class="meta">${T('이 인덱스는 id 기준이라 health 조건에는 쓸 수 없음 → 똑같이 전체 훑기', 'This index is on id, useless for a health condition → a full scan as well')}</p>`;
  $('sResult').innerHTML = T(`건전도 ≥ 90: ${sc.rows.map(r => r.id).join(', ')}. 자주 찾는 열이라면 health에도 인덱스를 만들 수 있지만, 쓸 때마다 둘 다 고쳐야 합니다.`,
    `Health ≥ 90: ${sc.rows.map(r => r.id).join(', ')}. If it is searched often you can index health too, at the price of updating both on every write.`);
}
function costs() {
  $('costTab').innerHTML = `<thead><tr><th>${T('행 수', 'Rows')}</th><th>${T('전체 훑기 (페이지)', 'Full scan (pages)')}</th><th>${T('인덱스 (마디 + 데이터 1)', 'Index (nodes + 1 data)')}</th><th>${T('차이', 'Ratio')}</th></tr></thead><tbody>` +
    [12, 1e3, 1e6, 1e9].map(n => { const c = costModel(n); return `<tr><td>${kb(n)}</td><td>${kb(c.scan)}</td><td>${c.index}</td><td>×${kb(Math.round(c.scan / c.index))}</td></tr>`; }).join('') + '</tbody>';
}

const CRASH = [
  [0, { ko: '아직 아무것도 쓰기 전', en: 'Before anything is written' }],
  [1, { ko: '첫 쓰기 하나를 마친 뒤', en: 'After the first write' }],
  [2, { ko: '두 번째 쓰기까지 마친 뒤', en: 'After the second write' }],
  [3, { ko: '세 번째 쓰기까지 마친 뒤 (WAL 없이는 전부 끝남)', en: 'After the third write (without a WAL: all done)' }]
];
function wal() {
  const on = $('wWal').checked, c = +$('wCrash').value, r = walDemo({ wal: on, crashAfter: c });
  const names = { log: T('로그에 "T2 이동 + 확정" 기록', 'log "move T2 + commit"'), src: T('Sub-A 페이지에서 T2 제거', 'remove T2 from the Sub-A page'), dst: T('Sub-B 페이지에 T2 추가', 'add T2 to the Sub-B page') };
  const steps = r.steps.map((s, i) => `<li class="${i < r.done ? 'done' : 'todo'}">${names[s]}${i === r.done - 1 && r.crashed ? ` ⚡ ${T('여기서 전원 차단', 'power fails here')}` : ''}</li>`).join('');
  const st = r.after;
  const verdict = r.lost ? `<span class="db-tag bad">✗ ${T('T2가 어디에도 없음 (유실)', 'T2 is nowhere (lost)')}</span>`
    : r.duplicated ? `<span class="db-tag bad">✗ ${T('T2가 두 곳에 있음 (중복)', 'T2 is in both places (duplicate)')}</span>`
      : `<span class="db-tag ok">✓ ${T('T2가 정확히 한 곳에 있음', 'T2 is in exactly one place')}</span>`;
  const rec = !r.crashed ? '' : on
    ? `<p>${st.replay[0] === 'redo' ? T('다시 켜자 로그에 확정이 있어 <b>redo</b>: 남은 쓰기를 끝까지 다시 해 줍니다.', 'On restart the log has the commit, so <b>redo</b>: the remaining writes are finished.') : T('다시 켜자 로그에 확정이 없어 <b>없던 일</b>로 합니다 (아무것도 반영되지 않음).', 'On restart the log has no commit, so it is <b>as if it never happened</b> (nothing applied).')}</p>`
    : `<p>${T('로그가 없어 복구할 근거가 없습니다. 쓰다 만 상태가 그대로 남습니다.', 'With no log there is nothing to recover from; the half-done state stays.')}</p>`;
  $('wOut').innerHTML = `<div class="http-grid"><div><h4>${T('진행 순서', 'Order of work')}</h4><ol class="wal-steps">${steps}</ol></div><div><h4>${T('다시 켠 뒤', 'After restart')}</h4><p>${T('Sub-A 페이지에 T2', 'T2 in the Sub-A page')}: <b>${st.srcHas ? '●' : '○'}</b> · ${T('Sub-B 페이지에 T2', 'T2 in the Sub-B page')}: <b>${st.dstHas ? '●' : '○'}</b></p>${rec}<p>${verdict}</p></div></div>`;
}
function render() {
  const keep = $('sId').value || 'B4';
  $('sId').innerHTML = [...ASSETS.map(a => a.id), 'X9'].map(id => `<option>${id}</option>`).join('');
  $('sId').value = keep;
  const k = $('wCrash').value || '1';
  $('wCrash').innerHTML = CRASH.map(([v, o]) => `<option value="${v}">${t(o)}</option>`).join('');
  $('wCrash').value = k;
  pick(selRid ? file.rids.findIndex(r => r[0] === selRid[0] && r[1] === selRid[1]) : 9);
  searchId(); costs(); wal();
}
$('fRows').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) pick(+tr.dataset.i); });
$('fRows').addEventListener('keydown', e => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-i]'); if (tr) pick(+tr.dataset.i); } });
$('sGo').addEventListener('click', searchId); $('sId').addEventListener('change', searchId);
$('sHealth').addEventListener('click', searchHealth);
$('wWal').addEventListener('change', wal); $('wCrash').addEventListener('change', wal);
document.addEventListener('langchange', render);
render();
