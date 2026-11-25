// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 가상 메모리 모형: ① 가상 주소 → 물리 주소 변환 (TLB · 페이지 테이블 · 페이지 폴트 · 보호 오류)
//                  ② 페이지 교체 알고리즘 (FIFO · LRU · Clock · OPT) 을 참조열 하나로 비교
// 주소 공간은 16비트(64 KB), 페이지는 4 KB(오프셋 12비트) → 페이지 16개. 학습용으로 줄인 크기다. 테스트: tests/os.test.mjs

export const PAGE = 0x1000, NPAGES = 16;
export const ALGOS = ['fifo', 'lru', 'clock', 'opt'];
export const COST = { tlb: 1, walk: 100, fault: 100000 };          // 걸리는 시간 (ns, 자릿수 감각용 모형값: TLB · 메모리 한 번 · SSD 에서 한 페이지)

// 한 프로세스의 주소 공간: 코드(읽기만) · 데이터 · 힙 · 스택. 나머지는 할당되지 않음
export const LAYOUT = [
  { vpn: 0, seg: 'code', w: false, present: true }, { vpn: 1, seg: 'code', w: false, present: true },
  { vpn: 2, seg: 'data', w: true, present: true }, { vpn: 3, seg: 'data', w: true, present: true },
  { vpn: 4, seg: 'heap', w: true, present: false }, { vpn: 5, seg: 'heap', w: true, present: false }, { vpn: 6, seg: 'heap', w: true, present: false },
  { vpn: 15, seg: 'stack', w: true, present: true }
];

/** 새 메모리 상태: 물리 프레임 nFrames 개, TLB tlbSize 칸 */
export function makeMem({ nFrames = 6, tlbSize = 4 } = {}) {
  const pt = Array.from({ length: NPAGES }, (_, vpn) => {
    const L = LAYOUT.find(l => l.vpn === vpn);
    return L ? { valid: true, seg: L.seg, w: L.w, present: false, frame: null, dirty: false, last: 0 } : { valid: false, seg: null, w: false, present: false, frame: null, dirty: false, last: 0 };
  });
  const S = { pt, frames: Array(nFrames).fill(null), tlb: [], tlbSize, clock: 0, stats: { n: 0, tlbHit: 0, faults: 0, writeBacks: 0, ns: 0 } };
  let f = 0;
  for (const L of LAYOUT) if (L.present && f < nFrames) { pt[L.vpn].present = true; pt[L.vpn].frame = f; S.frames[f++] = L.vpn; }
  return S;
}
export const split = (va) => ({ vpn: (va >> 12) & 0xf, off: va & 0xfff });
export const h4 = (v, n = 4) => '0x' + v.toString(16).toUpperCase().padStart(n, '0');

/**
 * 주소 하나에 접근한다 (상태를 바꿈). write = 쓰기인가
 * 반환: { steps: [{ k, ko, en }], pa | null, result: 'ok' | 'fault' | 'protect' | 'segv', tlbHit, victim }
 */
export function access(S, va, write = false) {
  const steps = [], st = (k, ko, en) => steps.push({ k, ko, en });
  const { vpn, off } = split(va);
  S.clock++; S.stats.n++;
  st('split', `가상 주소 ${h4(va)} = 페이지 번호 ${vpn} (위 4비트) + 오프셋 ${h4(off, 3)} (아래 12비트)`, `Virtual address ${h4(va)} = page number ${vpn} (top 4 bits) + offset ${h4(off, 3)} (low 12 bits)`);
  let ns = COST.tlb, tlbHit = false, victim = null;
  const e = S.pt[vpn];
  const ti = S.tlb.findIndex(x => x.vpn === vpn);
  if (ti >= 0) {
    tlbHit = true; S.stats.tlbHit++;
    const [x] = S.tlb.splice(ti, 1); S.tlb.push(x);
    st('tlb', `TLB 적중: 페이지 ${vpn} → 프레임 ${x.frame} (페이지 테이블을 볼 필요 없음)`, `TLB hit: page ${vpn} → frame ${x.frame} (no page-table lookup needed)`);
  } else {
    ns += COST.walk;
    st('tlb', `TLB에 없음(miss) → 메모리에 있는 페이지 테이블 ${vpn}번 항목을 읽음`, `TLB miss → read entry ${vpn} of the page table in memory`);
    if (!e.valid) {
      st('segv', `${vpn}번 페이지는 이 프로세스에 할당되지 않음 → 커널이 SIGSEGV를 보냄 ("Segmentation fault")`, `Page ${vpn} is not mapped in this process → the kernel sends SIGSEGV ("Segmentation fault")`);
      S.stats.ns += ns; return { steps, pa: null, result: 'segv', tlbHit, victim };
    }
  }
  if (write && !e.w) {
    st('protect', `${vpn}번 페이지(${e.seg})는 쓰기 금지 → 보호 오류 → SIGSEGV`, `Page ${vpn} (${e.seg}) is read-only → protection fault → SIGSEGV`);
    S.stats.ns += ns; return { steps, pa: null, result: 'protect', tlbHit, victim };
  }
  let result = 'ok';
  if (!e.present) {
    result = 'fault'; S.stats.faults++; ns += COST.fault;
    st('fault', `있음(present) 비트가 0 → 페이지 폴트: CPU가 하던 명령을 멈추고 커널로 넘어감`, `Present bit is 0 → page fault: the CPU stops the instruction and traps into the kernel`);
    let f = S.frames.indexOf(null);
    if (f < 0) {
      // 빈 프레임이 없으면 가장 오래 안 쓴 페이지(LRU)를 내보냄
      f = S.frames.reduce((b, v, i) => (S.pt[v].last < S.pt[S.frames[b]].last ? i : b), 0);
      const old = S.frames[f], oe = S.pt[old];
      victim = old;
      if (oe.dirty) { S.stats.writeBacks++; ns += COST.fault; st('evict', `빈 프레임 없음 → 가장 오래 안 쓴 페이지 ${old}를 내보냄. 고쳐진(dirty) 페이지라 먼저 디스크(스왑)에 써 둠`, `No free frame → evict page ${old}, the least recently used. It is dirty, so it is written to disk (swap) first`); }
      else st('evict', `빈 프레임 없음 → 가장 오래 안 쓴 페이지 ${old}를 내보냄 (고친 적 없어 그냥 버림)`, `No free frame → evict page ${old}, the least recently used (clean, so simply dropped)`);
      oe.present = false; oe.frame = null; oe.dirty = false;
      S.tlb = S.tlb.filter(x => x.vpn !== old);
    }
    const from = e.seg === 'heap' && !e.touched ? { ko: '0으로 채운 새 페이지를', en: 'a fresh zero-filled page' } : { ko: '디스크에서 읽어', en: 'the page from disk' };
    st('load', `${from.ko} 프레임 ${f}에 올리고, 페이지 테이블을 고친 뒤 멈췄던 명령을 다시 실행`, `Load ${from.en} into frame ${f}, update the page table, and restart the stopped instruction`);
    S.frames[f] = vpn; e.present = true; e.frame = f;
  } else if (!tlbHit) st('pte', `항목: 있음, 프레임 ${e.frame}, ${e.w ? '쓰기 허용' : '읽기만'}`, `Entry: present, frame ${e.frame}, ${e.w ? 'writable' : 'read-only'}`);
  if (!tlbHit) {
    if (S.tlb.length >= S.tlbSize) S.tlb.shift();
    S.tlb.push({ vpn, frame: e.frame });
  }
  e.last = S.clock; e.touched = true;
  if (write) e.dirty = true;
  const pa = e.frame * PAGE + off;
  st('pa', `물리 주소 = 프레임 ${e.frame} × 0x1000 + ${h4(off, 3)} = ${h4(pa)}${write ? ' (쓰기: dirty 표시)' : ''}`, `Physical address = frame ${e.frame} × 0x1000 + ${h4(off, 3)} = ${h4(pa)}${write ? ' (write: marked dirty)' : ''}`);
  S.stats.ns += ns;
  return { steps, pa, result, tlbHit, victim };
}

/**
 * 참조열 refs 를 프레임 nFrames 개로 처리. 반환: { steps: [{ ref, hit, slots: [...], victim(슬롯), refBits?, hand? }], faults }
 */
export function replay(refs, nFrames, algo) {
  const slots = Array(nFrames).fill(null), loaded = Array(nFrames).fill(0), used = Array(nFrames).fill(0), refb = Array(nFrames).fill(0);
  let hand = 0, faults = 0;
  const steps = [];
  refs.forEach((r, t) => {
    let s = slots.indexOf(r), victim = -1;
    const hit = s >= 0;
    if (!hit) {
      faults++;
      s = slots.indexOf(null);
      if (s < 0) {
        if (algo === 'fifo') s = loaded.indexOf(Math.min(...loaded));
        else if (algo === 'lru') s = used.indexOf(Math.min(...used));
        else if (algo === 'opt') {
          const next = slots.map(p => { const i = refs.indexOf(p, t + 1); return i < 0 ? Infinity : i; });
          s = next.indexOf(Math.max(...next));
        } else {
          while (refb[hand]) { refb[hand] = 0; hand = (hand + 1) % nFrames; }
          s = hand; hand = (hand + 1) % nFrames;
        }
        victim = s;
      } else if (algo === 'clock') hand = (s + 1) % nFrames;
      slots[s] = r; loaded[s] = t + 1;
    }
    used[s] = t + 1; refb[s] = 1;
    steps.push({ ref: r, hit, slot: s, victim, slots: [...slots], refBits: [...refb], hand });
  });
  return { steps, faults };
}
export const parseRefs = (s) => s.split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n < 100).slice(0, 40);
