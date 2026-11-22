// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 직접 접근: 표 하나를 "페이지(고정 크기 덩어리)"로 파일에 적고, 읽을 때 몇 페이지를 건드리는지 센다.
// 슬롯 페이지(slotted page): 앞쪽에 [슬롯 수][빈 공간 끝] 머리와 슬롯 목록, 레코드는 페이지 끝에서 앞으로 쌓인다.
// 인덱스는 B+트리. 전체 훑기(full scan)와 인덱스 탐색이 읽는 페이지 수가 얼마나 다른지 본다. 브라우저 없이 테스트: tests/db.test.mjs

export const PAGE = 128;
const enc = new TextEncoder(), dec = new TextDecoder();

// 행 → 바이트: [길이 id][id][길이 type][type][길이 name][name][health 1바이트][installed 2바이트][길이 sub][sub]
export function encodeRow(r) {
  const out = [];
  const str = (s) => { const b = enc.encode(s); out.push(b.length, ...b); };
  str(r.id); str(r.type); str(r.name);
  out.push(r.health & 255, (r.installed >> 8) & 255, r.installed & 255);
  str(r.substation_id);
  return Uint8Array.from(out);
}
export function decodeRow(b) {
  let i = 0;
  const str = () => { const n = b[i++]; const s = dec.decode(b.slice(i, i + n)); i += n; return s; };
  const id = str(), type = str(), name = str();
  const health = b[i++], installed = (b[i++] << 8) | b[i++];
  return { id, substation_id: str(), type, name, health, installed };
}

export const newPage = () => new Uint8Array(PAGE).fill(0);
const u16 = (p, o) => (p[o] << 8) | p[o + 1];
const set16 = (p, o, v) => { p[o] = v >> 8; p[o + 1] = v & 255; };
export const slotCount = (p) => u16(p, 0);
const freeEnd = (p) => { const f = u16(p, 2); return f === 0 ? PAGE : f; };
export function fits(p, len) { return 4 + (slotCount(p) + 1) * 4 <= freeEnd(p) - len; }
export function insertRecord(p, rec) {
  if (!fits(p, rec.length)) return -1;
  const n = slotCount(p), end = freeEnd(p) - rec.length;
  p.set(rec, end);
  set16(p, 4 + n * 4, end); set16(p, 6 + n * 4, rec.length);
  set16(p, 0, n + 1); set16(p, 2, end);
  return n;
}
export function readSlot(p, s) { const o = u16(p, 4 + s * 4), l = u16(p, 6 + s * 4); return p.slice(o, o + l); }

// 행들을 차례로 페이지에 채워 "파일"을 만든다. rid = [페이지 번호, 슬롯 번호]
export function buildFile(rows) {
  const pages = [newPage()], rids = [];
  for (const r of rows) {
    const rec = encodeRow(r);
    let s = insertRecord(pages[pages.length - 1], rec);
    if (s < 0) { pages.push(newPage()); s = insertRecord(pages[pages.length - 1], rec); }
    rids.push([pages.length - 1, s]);
  }
  return { pages, rids, rows };
}
export function readPage(file, n) { const p = file.pages[n]; return Array.from({ length: slotCount(p) }, (_, s) => decodeRow(readSlot(p, s))); }

// 조건에 맞는 행 찾기: 모든 페이지를 처음부터 끝까지 읽는다
export function fullScan(file, pred) {
  const rows = [];
  file.pages.forEach((_, n) => { for (const r of readPage(file, n)) if (pred(r)) rows.push(r); });
  return { rows, pagesRead: file.pages.length };
}

// ---- B+트리 (id 로 찾는 인덱스) ----
export function buildBTree(file, maxKeys = 3) {
  const entries = file.rows.map((r, i) => ({ key: r.id, rid: file.rids[i] })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const nodes = [];
  const mk = (n) => { n.id = nodes.length; nodes.push(n); return n; };
  let level = [];
  for (let i = 0; i < entries.length; i += maxKeys) level.push(mk({ leaf: true, entries: entries.slice(i, i + maxKeys), keys: entries.slice(i, i + maxKeys).map(e => e.key) }));
  const fan = maxKeys + 1;
  while (level.length > 1) {
    const up = [];
    for (let i = 0; i < level.length; i += fan) {
      const kids = level.slice(i, i + fan);
      up.push(mk({ leaf: false, children: kids.map(k => k.id), keys: kids.slice(1).map(k => firstKey(nodes, k)) }));
    }
    level = up;
  }
  return { nodes, root: level[0].id, maxKeys, height: heightOf(nodes, level[0].id) };
}
const firstKey = (nodes, n) => (n.leaf ? n.keys[0] : firstKey(nodes, nodes[n.children[0]]));
const heightOf = (nodes, id) => (nodes[id].leaf ? 1 : 1 + heightOf(nodes, nodes[id].children[0]));

// 키로 찾기: 루트에서 잎까지 내려간 마디 목록(path)과 찾은 위치(rid)
export function btreeSearch(tree, key) {
  const path = [];
  let n = tree.nodes[tree.root];
  for (;;) {
    path.push(n.id);
    if (n.leaf) { const e = n.entries.find(x => x.key === key); return { found: !!e, rid: e ? e.rid : null, path }; }
    let c = 0;
    while (c < n.keys.length && key >= n.keys[c]) c++;
    n = tree.nodes[n.children[c]];
  }
}
// 인덱스로 한 행 가져오기: 인덱스 마디 몇 개 + 데이터 페이지 1개
export function lookupById(file, tree, id) {
  const s = btreeSearch(tree, id);
  if (!s.found) return { row: null, nodesRead: s.path.length, pagesRead: 0, path: s.path };
  const [pg, sl] = s.rid;
  return { row: decodeRow(readSlot(file.pages[pg], sl)), nodesRead: s.path.length, pagesRead: 1, path: s.path, rid: s.rid };
}

// 행이 아주 많아지면: 전체 훑기는 행 수에 비례, B+트리는 로그. rowsPerPage 는 한 페이지에 들어가는 행 수, fanout 은 한 마디의 자식 수
export function costModel(rows, rowsPerPage = 80, fanout = 200) {
  const scan = Math.ceil(rows / rowsPerPage);
  let height = 1, cap = fanout;
  while (cap < rows) { cap *= fanout; height++; }
  return { rows, scan, index: height + 1, height };
}

// ---- 쓰기 전 기록(WAL) ----
// 설비 T2를 A변전소 페이지에서 B변전소 페이지로 옮기는 일: 페이지 두 개를 고쳐야 한다. 중간에 전원이 나가면?
// wal=true 면 "이렇게 하겠다 + 커밋" 기록을 먼저 안전한 로그에 적는다. 다시 켰을 때 로그에 커밋이 있으면 끝까지 다시 하고(redo), 없으면 없던 일로.
// crashAfter: 몇 단계를 마친 뒤 전원이 나가는가 (0 = 아무것도 쓰기 전). 단계: wal 이면 [로그, 첫 페이지, 둘째 페이지], 아니면 [첫 페이지, 둘째 페이지]
export function walDemo({ wal, crashAfter }) {
  const steps = wal ? ['log', 'src', 'dst'] : ['src', 'dst'];
  const done = Math.min(crashAfter, steps.length);
  const st = { logCommitted: false, srcHas: true, dstHas: false, replay: [] };
  steps.slice(0, done).forEach(s => { if (s === 'log') st.logCommitted = true; if (s === 'src') st.srcHas = false; if (s === 'dst') st.dstHas = true; });
  const crashed = done < steps.length;
  const before = { ...st };
  if (crashed && wal) {
    if (st.logCommitted) { st.srcHas = false; st.dstHas = true; st.replay = ['redo']; } else { st.replay = ['ignore']; }
  }
  const consistent = (st.srcHas !== st.dstHas);          // 설비는 정확히 한 곳에만 있어야 한다
  return { steps, done, crashed, before, after: st, consistent, lost: !st.srcHas && !st.dstHas, duplicated: st.srcHas && st.dstHas };
}

export function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' '); }
