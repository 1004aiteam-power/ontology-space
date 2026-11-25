// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 작은 파일시스템 모형: inode 8개 · 데이터 블록 16개(한 블록 = 8글자) · 블록 비트맵 · 디렉터리 하나.
// 파일 만들기 · 덧붙이기 · 지우기를 "디스크 블록 쓰기" 몇 번으로 나누고, 그 중간에 전원이 나가면 어떻게 되는지,
// 저널링(없음 · ordered · 전체)이 그것을 어떻게 막는지, fsck 가 무엇을 찾아내는지 계산한다. 테스트: tests/os.test.mjs

export const BS = 8, NB = 16, NI = 8;
export const MODES = ['none', 'ordered', 'journal'];
const clone = (x) => JSON.parse(JSON.stringify(x));
const chunks = (s) => { const out = []; for (let i = 0; i < s.length; i += BS) out.push(s.slice(i, i + BS)); return out.length ? out : ['']; };

/** 처음 디스크: notes.txt 하나 (inode 1, 블록 0~1). 나머지 블록에는 예전 파일의 흔적이 남아 있다 */
export function mkfs() {
  const S = {
    inodes: Array.from({ length: NI }, () => ({ used: false, size: 0, blocks: [] })),
    bitmap: Array(NB).fill(false),
    blocks: Array.from({ length: NB }, (_, i) => `#old${String(i).padStart(2, '0')}#`.slice(0, BS)),
    dir: { 'notes.txt': 1 }
  };
  S.inodes[0] = { used: true, size: 0, blocks: [], root: true };            // 0번 = 루트 디렉터리
  const text = 'meet at 3pm';
  S.inodes[1] = { used: true, size: text.length, blocks: [0, 1] };
  chunks(text).forEach((c, i) => { S.blocks[i] = c; S.bitmap[i] = true; });
  return S;
}
const freeInode = (S) => S.inodes.findIndex(n => !n.used);
const freeBlocks = (S, k) => { const out = []; for (let i = 0; i < NB && out.length < k; i++) if (!S.bitmap[i]) out.push(i); return out; };

/**
 * 연산 하나를 블록 쓰기 목록으로 바꾼다 (쓰기 순서는 저널이 없을 때 디스크에 실제로 닿는 순서: 커널과 디스크가 순서를 바꿀 수 있다).
 * op: { kind: 'create' | 'append' | 'delete', name, text }
 * 반환: [{ k: 'dir' | 'inode' | 'bitmap' | 'data', ko, en, fn(S) }]
 */
export function plan(S, op) {
  const W = [];
  const w = (k, ko, en, fn) => W.push({ k, ko, en, fn });
  if (op.kind === 'create') {
    const ino = freeInode(S), parts = chunks(op.text), bl = freeBlocks(S, parts.length);
    if (ino < 0 || bl.length < parts.length || S.dir[op.name] !== undefined) return null;
    w('dir', `디렉터리에 "${op.name}" → inode ${ino} 항목 추가`, `Add "${op.name}" → inode ${ino} to the directory`, s => { s.dir[op.name] = ino; });
    w('inode', `inode ${ino}: 사용 중, 크기 ${op.text.length}, 블록 ${bl.join(', ')}`, `inode ${ino}: in use, size ${op.text.length}, blocks ${bl.join(', ')}`, s => { s.inodes[ino] = { used: true, size: op.text.length, blocks: [...bl] }; });
    w('bitmap', `비트맵: 블록 ${bl.join(', ')} 사용 중으로 표시`, `Bitmap: mark blocks ${bl.join(', ')} in use`, s => { for (const b of bl) s.bitmap[b] = true; });
    w('data', `데이터 블록 ${bl.join(', ')}에 내용 쓰기`, `Write the contents into data blocks ${bl.join(', ')}`, s => { parts.forEach((c, i) => { s.blocks[bl[i]] = c; }); });
  } else if (op.kind === 'append') {
    const ino = S.dir[op.name]; if (ino === undefined) return null;
    const n = S.inodes[ino], parts = chunks(op.text), bl = freeBlocks(S, parts.length);
    if (bl.length < parts.length) return null;
    w('data', `새 데이터 블록 ${bl.join(', ')}에 덧붙일 내용 쓰기`, `Write the appended text into new data blocks ${bl.join(', ')}`, s => { parts.forEach((c, i) => { s.blocks[bl[i]] = c; }); });
    w('inode', `inode ${ino}: 크기 ${n.size} → ${n.size + op.text.length}, 블록 목록에 ${bl.join(', ')} 추가`, `inode ${ino}: size ${n.size} → ${n.size + op.text.length}, add blocks ${bl.join(', ')}`, s => { s.inodes[ino] = { used: true, size: n.size + op.text.length, blocks: [...n.blocks, ...bl] }; });   // 새 값을 통째로 씀: 저널을 다시 실행해도 결과가 같다
    w('bitmap', `비트맵: 블록 ${bl.join(', ')} 사용 중으로 표시`, `Bitmap: mark blocks ${bl.join(', ')} in use`, s => { for (const b of bl) s.bitmap[b] = true; });
  } else if (op.kind === 'delete') {
    const ino = S.dir[op.name]; if (ino === undefined) return null;
    const bl = [...S.inodes[ino].blocks];
    w('dir', `디렉터리에서 "${op.name}" 항목 지우기`, `Remove "${op.name}" from the directory`, s => { delete s.dir[op.name]; });
    w('inode', `inode ${ino}: 비움`, `inode ${ino}: free`, s => { s.inodes[ino] = { used: false, size: 0, blocks: [] }; });
    w('bitmap', `비트맵: 블록 ${bl.join(', ')} 빈 칸으로 표시`, `Bitmap: mark blocks ${bl.join(', ')} free`, s => { for (const b of bl) s.bitmap[b] = false; });
  }
  return W;
}

/**
 * 저널 방식에 따라 실제로 디스크에 가는 단계 목록. 각 단계: { k, ko, en, apply?(S), journal? }
 * none: 제자리 쓰기만 / ordered: 데이터 먼저 제자리 → 메타데이터를 저널에 → 커밋 → 제자리 / journal: 모두 저널에 → 커밋 → 제자리
 */
export function steps(S, op, mode) {
  const W = plan(S, op); if (!W) return null;
  if (mode === 'none') return W.map(x => ({ ...x, place: true }));
  const data = W.filter(x => x.k === 'data'), meta = W.filter(x => x.k !== 'data');
  const toJ = mode === 'ordered' ? meta : W;
  const out = [];
  if (mode === 'ordered') for (const x of data) out.push({ ...x, place: true, ko: x.ko + ' (데이터는 먼저 제자리에)', en: x.en + ' (data goes in place first)' });
  out.push({ k: 'jw', ko: `저널에 ${toJ.length}개 블록의 새 내용을 기록 (${toJ.map(x => x.k).join(' · ')})`, en: `Log the new contents of ${toJ.length} blocks in the journal (${toJ.map(x => x.k).join(' · ')})`, journal: 'write' });
  out.push({ k: 'commit', ko: '저널에 커밋 기록: "이 묶음은 완전함"', en: 'Write the commit record: "this transaction is complete"', journal: 'commit' });
  for (const x of toJ) out.push({ ...x, place: true, ko: '제자리 반영: ' + x.ko, en: 'Checkpoint: ' + x.en });
  out.push({ k: 'jfree', ko: '저널 공간 비우기', en: 'Free the journal space', journal: 'free' });
  return { list: out, toJ };
}

/**
 * crash 번째 단계 직전에 전원이 나감(crash = 단계 수면 모두 끝남). 재부팅 뒤 복구까지 한 결과.
 * 반환: { disk (복구 뒤 상태), recovery: { ko, en } | null, applied: 단계별 true/false }
 */
export function crashAt(S0, op, mode, crash) {
  const S = clone(S0);
  const st = steps(S0, op, mode); if (!st) return null;
  const list = mode === 'none' ? st : st.list;
  let committed = false, freed = false;
  const applied = list.map((x, i) => i < crash);
  list.forEach((x, i) => {
    if (i >= crash) return;
    if (x.place) x.fn(S);
    if (x.journal === 'commit') committed = true;
    if (x.journal === 'free') freed = true;
  });
  let recovery = null;
  if (mode !== 'none' && crash < list.length) {
    if (committed && !freed) {
      for (const x of st.toJ) x.fn(S);                                     // 저널의 내용을 다시 제자리에 씀 (여러 번 해도 결과가 같다)
      recovery = { ko: '저널에 커밋된 묶음이 있음 → 다시 실행(replay)해 모두 반영', en: 'A committed transaction is in the journal → replay it so all of it lands' };
    } else if (!committed) recovery = { ko: '커밋 기록이 없는 저널 → 버림. 디스크는 연산 전 그대로', en: 'Journal without a commit record → discarded; the disk is as it was before the operation' };
  }
  return { disk: S, recovery, applied, list };
}

/** fsck: 디렉터리 · inode · 비트맵이 서로 맞는지 검사. 반환: [{ k, sev: 'bad' | 'warn', ko, en }] */
export function fsck(S) {
  const out = [];
  const refd = new Set(Object.values(S.dir));
  for (const [name, ino] of Object.entries(S.dir)) if (!S.inodes[ino].used)
    out.push({ k: 'dangling', sev: 'bad', ko: `"${name}"가 비어 있는 inode ${ino}를 가리킴 (열면 오류 · 다른 파일과 섞일 위험)`, en: `"${name}" points to free inode ${ino} (opening fails; may get mixed with another file)` });
  S.inodes.forEach((n, i) => { if (n.used && !n.root && !refd.has(i)) out.push({ k: 'orphan', sev: 'warn', ko: `inode ${i}는 사용 중인데 이름이 없음 → lost+found로 옮김`, en: `inode ${i} is in use but has no name → moved to lost+found` }); });
  const owner = Array(NB).fill(null);
  S.inodes.forEach((n, i) => { if (n.used) for (const b of n.blocks) { if (owner[b] !== null) out.push({ k: 'dup', sev: 'bad', ko: `블록 ${b}를 inode ${owner[b]}와 ${i}가 함께 씀`, en: `block ${b} is used by both inode ${owner[b]} and ${i}` }); owner[b] = i; } });
  for (let b = 0; b < NB; b++) {
    if (owner[b] !== null && !S.bitmap[b]) out.push({ k: 'free-used', sev: 'bad', ko: `블록 ${b}는 inode ${owner[b]}가 쓰는데 비트맵은 "빈 칸" → 다음 파일에 또 할당되어 덮어써질 위험`, en: `block ${b} is used by inode ${owner[b]} but marked free → could be handed out again and overwritten` });
    if (owner[b] === null && S.bitmap[b]) out.push({ k: 'leak', sev: 'warn', ko: `블록 ${b}는 "사용 중"인데 아무도 안 씀 → 공간 낭비 (회수)`, en: `block ${b} is marked used but nobody owns it → wasted space (reclaimed)` });
  }
  return out;
}
/** 사용자가 보는 파일 내용 (inode 가 가리키는 블록을 이어 붙여 크기만큼) */
export function readFile(S, name) {
  const ino = S.dir[name]; if (ino === undefined) return null;
  const n = S.inodes[ino]; if (!n.used) return { err: true };
  return { text: n.blocks.map(b => S.blocks[b]).join('').slice(0, n.size), ino };
}
