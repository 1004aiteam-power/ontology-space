// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 가상 메모리 페이지: 주소 변환 실험 (TLB · 페이지 테이블 · 폴트) 과 페이지 교체 알고리즘 비교 (계산은 vm.js)
import { ALGOS, makeMem, access, split, h4, replay, parseRefs } from './vm.js?v=51e2f8ef';
import { mulberry32 } from '../lib/rng.js?v=73d9551d';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

// ---- ① 주소 변환 ----
const rnd = mulberry32(7);
const VALID = [0, 1, 2, 3, 4, 5, 6, 15];
const OPS = [
  { id: 'code', ko: '코드 읽기 (TLB 적중)', en: 'Read code (TLB hit)', ops: [[0x0120, 0], [0x0124, 0]] },
  { id: 'heap', ko: '힙에 처음 쓰기 (페이지 폴트)', en: 'First write to the heap (page fault)', ops: [[0x4010, 1]] },
  { id: 'evict', ko: '메모리가 꽉 참 (교체)', en: 'Memory is full (eviction)', ops: [[0x5000, 1], [0x6000, 1]] },
  { id: 'ro', ko: '코드에 쓰기 (보호 오류)', en: 'Write to code (protection fault)', ops: [[0x0040, 1]] },
  { id: 'segv', ko: '할당 안 된 곳 (세그폴트)', en: 'Unmapped address (segfault)', ops: [[0x9000, 0]] },
  { id: 'seq', ko: '배열을 차례로 32번 읽기', en: 'Read an array in order, 32 times', ops: Array.from({ length: 32 }, (_, i) => [0x2000 + i * 0x80, 0]) },
  { id: 'rand', ko: '여기저기 32번 읽기', en: 'Read here and there, 32 times', ops: Array.from({ length: 32 }, () => [VALID[Math.floor(rnd() * VALID.length)] * 0x1000 + Math.floor(rnd() * 0x1000), 0]) }
];
let S = makeMem(), last = null, lastVa = 0x0120, batch = 0;
const SEG = { code: { ko: '코드', en: 'code' }, data: { ko: '데이터', en: 'data' }, heap: { ko: '힙', en: 'heap' }, stack: { ko: '스택', en: 'stack' } };

function run(ops) {
  const before = { ...S.stats };
  for (const [va, w] of ops) { last = access(S, va, !!w); lastVa = va; }
  batch = ops.length > 1 ? { n: ops.length, hit: S.stats.tlbHit - before.tlbHit, faults: S.stats.faults - before.faults } : 0;
  renderTr();
}

function renderTr() {
  const { vpn, off } = split(lastVa);
  const bits = lastVa.toString(2).padStart(16, '0');
  $('vmBits').innerHTML = `<div class="vm-bits">${[...bits].map((b, i) => `<span class="${i < 4 ? 'p' : 'o'}">${b}</span>`).join('')}</div><div class="vm-bl"><span class="p">${T('페이지 번호', 'Page number')} = ${vpn}</span><span class="o">${T('오프셋', 'Offset')} = ${h4(off, 3)}</span></div>`;
  const cls = { segv: 'no', protect: 'no', fault: 'warn' };
  $('vmSteps').innerHTML = (batch ? `<p class="os-now">${T(`${batch.n}번 접근: TLB 적중 ${batch.hit}번 (${Math.round(batch.hit / batch.n * 100)}%), 페이지 폴트 ${batch.faults}번. 아래는 마지막 접근의 과정입니다.`, `${batch.n} accesses: ${batch.hit} TLB hits (${Math.round(batch.hit / batch.n * 100)}%), ${batch.faults} page faults. Below is the last access.`)}</p>` : '') +
    (last ? `<ol class="os-log">${last.steps.map(s => `<li class="${cls[s.k] || 'ok'}">${esc(t(s))}</li>`).join('')}</ol>` : '');
  const ptRows = S.pt.map((e, v) => `<tr class="${v === vpn ? 'hit' : ''}${e.valid ? '' : ' off'}"><td>${v}</td><td>${e.valid ? esc(t(SEG[e.seg])) : '—'}</td><td>${e.valid ? (e.present ? '1' : '0') : ''}</td><td>${e.frame ?? ''}</td><td>${e.valid ? (e.w ? 'RW' : 'R') : ''}</td><td>${e.dirty ? '●' : ''}</td></tr>`).join('');
  $('vmPt').innerHTML = `<table class="net-tab os-regs vm-t"><caption>${T('페이지 테이블 (프로세스마다 하나)', 'Page table (one per process)')}</caption><thead><tr><th>${T('페이지', 'Page')}</th><th>${T('영역', 'Region')}</th><th>${T('있음', 'Present')}</th><th>${T('프레임', 'Frame')}</th><th>${T('권한', 'Perm')}</th><th>dirty</th></tr></thead><tbody>${ptRows}</tbody></table>`;
  $('vmTlb').innerHTML = `<table class="net-tab os-regs vm-t"><caption>${T(`TLB (${S.tlbSize}칸, 최근 것이 아래)`, `TLB (${S.tlbSize} entries, newest last)`)}</caption><thead><tr><th>${T('페이지', 'Page')}</th><th>${T('프레임', 'Frame')}</th></tr></thead><tbody>${S.tlb.length ? S.tlb.map(x => `<tr class="${x.vpn === vpn ? 'hit' : ''}"><td>${x.vpn}</td><td>${x.frame}</td></tr>`).join('') : `<tr><td colspan="2" class="meta">${T('비어 있음', 'empty')}</td></tr>`}</tbody></table>
    <table class="net-tab os-regs vm-t"><caption>${T('물리 메모리 (프레임)', 'Physical memory (frames)')}</caption><thead><tr><th>${T('프레임', 'Frame')}</th><th>${T('물리 주소', 'Phys. addr')}</th><th>${T('담긴 페이지', 'Holds page')}</th></tr></thead><tbody>${S.frames.map((v, f) => `<tr class="${last && last.pa !== null && Math.floor(last.pa / 0x1000) === f ? 'hit' : ''}"><td>${f}</td><td>${h4(f * 0x1000)}</td><td>${v === null ? `<span class="meta">${T('빈 칸', 'free')}</span>` : v}${last && last.victim !== null && S.pt[last.victim] && f === S.pt[vpn].frame ? ` <small>(${T(`${last.victim}번을 내보냄`, `evicted ${last.victim}`)})</small>` : ''}</td></tr>`).join('')}</tbody></table>`;
  const s = S.stats;
  $('vmStats').innerHTML = `<dl class="vm-dl"><dt>${T('접근', 'Accesses')}</dt><dd>${s.n}</dd><dt>${T('TLB 적중률', 'TLB hit rate')}</dt><dd>${s.n ? Math.round(s.tlbHit / s.n * 100) : 0}%</dd><dt>${T('페이지 폴트', 'Page faults')}</dt><dd>${s.faults}</dd><dt>${T('디스크에 되쓰기', 'Write-backs')}</dt><dd>${s.writeBacks}</dd><dt>${T('평균 접근 시간 (모형)', 'Avg access time (model)')}</dt><dd>${s.n ? fmtNs(s.ns / s.n) : '—'}</dd></dl>`;
}
const fmtNs = (ns) => (ns >= 1e6 ? (ns / 1e6).toFixed(2) + ' ms' : ns >= 1000 ? (ns / 1000).toFixed(1) + ' µs' : Math.round(ns) + ' ns');

// ---- ② 페이지 교체 ----
const REFS = [
  { id: 'book', ko: '교과서 참조열', en: 'Textbook string', s: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', n: 3 },
  { id: 'belady', ko: 'Belady의 이상 현상', en: "Belady's anomaly", s: '1 2 3 4 1 2 5 1 2 3 4 5', n: 3 },
  { id: 'loop', ko: '작은 고리 (지역성)', en: 'Small loop (locality)', s: '1 2 3 1 2 3 1 2 3 4 1 2 3 1 2 3 5 1 2 3', n: 4 },
  { id: 'scan', ko: '프레임보다 큰 고리', en: 'Loop larger than memory', s: '1 2 3 4 5 1 2 3 4 5 1 2 3 4 5', n: 4 }
];
const AN = { fifo: 'FIFO', lru: 'LRU', clock: 'Clock', opt: 'OPT' };
const ACOL = { fifo: '#d95926', lru: '#2a78d6', clock: '#1f9d6b', opt: '#8a63d2' };
let R = { refs: parseRefs(REFS[0].s), n: 3, algo: 'lru', preset: 'book' };

function renderRp() {
  const r = replay(R.refs, R.n, R.algo);
  $('rpNOut').textContent = R.n;
  $('rpAlgos').innerHTML = ALGOS.map(a => `<button type="button" data-a="${a}" aria-pressed="${a === R.algo}">${a === 'opt' ? T('OPT (최적)', 'OPT (optimal)') : AN[a]}</button>`).join('');
  $('rpPresets').innerHTML = REFS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${p.id === R.preset}">${t(p)}</button>`).join('');
  const head = `<tr><th>${T('참조', 'Ref')}</th>${r.steps.map(s => `<th class="${s.hit ? '' : 'miss'}">${s.ref}</th>`).join('')}</tr>`;
  const rows = Array.from({ length: R.n }, (_, f) => `<tr><th>${T('프레임', 'Frame')} ${f}</th>${r.steps.map(s => `<td class="${s.slot === f ? (s.hit ? 'h' : 'm') : ''}">${s.slots[f] ?? ''}${R.algo === 'clock' && s.slots[f] !== null ? `<sup>${s.refBits[f]}</sup>` : ''}</td>`).join('')}</tr>`).join('');
  const foot = `<tr><th></th>${r.steps.map(s => `<td class="rp-f">${s.hit ? '' : s.victim >= 0 ? '✕' : '•'}</td>`).join('')}</tr>`;
  $('rpGrid').innerHTML = `<table class="rp-grid">${head}${rows}${foot}</table>`;
  const all = ALGOS.map(a => ({ a, f: replay(R.refs, R.n, a).faults })), mx = Math.max(...all.map(x => x.f), 1);
  $('rpCmp').innerHTML = all.map(x => `<div class="cmp-row"><div class="cmp-name">${x.a === 'opt' ? T('OPT (최적, 미래를 안다고 가정)', 'OPT (optimal, assumes it knows the future)') : AN[x.a]}</div><div class="cmp-bar"><i style="width:${(x.f / mx * 100).toFixed(1)}%;background:color-mix(in srgb,${ACOL[x.a]} 55%,transparent)"></i><b>${T(`폴트 ${x.f}번 / ${R.refs.length}`, `${x.f} faults / ${R.refs.length}`)}</b></div></div>`).join('');
  chart();
}
function chart() {
  const W = 420, H = 200, L = 34, B = 26, maxN = 7, data = ALGOS.map(a => Array.from({ length: maxN }, (_, i) => replay(R.refs, i + 1, a).faults));
  const top = Math.max(...data.flat(), 1), sx = (n) => L + (n - 1) / (maxN - 1) * (W - L - 10), sy = (f) => H - B - f / top * (H - B - 12);
  const o = [`<svg class="os-svg vm-ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('프레임 수에 따른 페이지 폴트 수', 'Page faults by number of frames'))}">`];
  for (let n = 1; n <= maxN; n++) o.push(`<line x1="${sx(n)}" y1="8" x2="${sx(n)}" y2="${H - B}" class="gx"/><text x="${sx(n)}" y="${H - B + 14}" text-anchor="middle">${n}</text>`);
  o.push(`<text x="${(L + W) / 2}" y="${H - 2}" text-anchor="middle">${esc(T('프레임 수', 'Frames'))}</text><text x="4" y="12">${top}</text><text x="4" y="${H - B}">0</text>`);
  ALGOS.forEach((a, k) => o.push(`<polyline fill="none" stroke="${ACOL[a]}" stroke-width="2.2" points="${data[k].map((f, i) => `${sx(i + 1).toFixed(1)},${sy(f).toFixed(1)}`).join(' ')}"/>${data[k].map((f, i) => `<circle cx="${sx(i + 1).toFixed(1)}" cy="${sy(f).toFixed(1)}" r="${i + 1 === R.n ? 4 : 2.5}" fill="${ACOL[a]}"/>`).join('')}`));
  o.push('</svg>');
  $('rpChart').innerHTML = o.join('') + `<div class="lg">${ALGOS.map(a => `<span><i style="--c:${ACOL[a]}"></i>${a === 'opt' ? 'OPT' : AN[a]}</span>`).join('')}</div>`;
}

function labels() { $('vmPresets').innerHTML = OPS.map(p => `<button type="button" data-id="${p.id}">${t(p)}</button>`).join(''); }
function render() { labels(); renderTr(); renderRp(); }

function init() {
  $('vmPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) run(OPS.find(p => p.id === b.dataset.id).ops); });
  $('vmGo').addEventListener('click', () => {
    const va = parseInt($('vmVa').value.replace(/^0x/i, ''), 16);
    if (!Number.isFinite(va) || va < 0 || va > 0xffff) { $('vmMsg').textContent = T('0000 ~ FFFF 사이의 16진수를 넣으세요', 'Enter a hex number between 0000 and FFFF'); return; }
    $('vmMsg').textContent = ''; run([[va, $('vmRw').value === 'w']]);
  });
  $('vmReset').addEventListener('click', () => { S = makeMem({ nFrames: +$('vmFrames').value }); last = null; batch = 0; renderTr(); });
  $('vmFrames').addEventListener('input', () => { $('vmFramesOut').textContent = $('vmFrames').value; S = makeMem({ nFrames: +$('vmFrames').value }); last = null; batch = 0; renderTr(); });
  $('rpPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = REFS.find(x => x.id === b.dataset.id); R = { ...R, refs: parseRefs(p.s), n: p.n, preset: p.id }; $('rpRefs').value = p.s; $('rpN').value = p.n; renderRp(); });
  $('rpAlgos').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { R.algo = b.dataset.a; renderRp(); } });
  $('rpRefs').addEventListener('input', () => { const r = parseRefs($('rpRefs').value); if (r.length) { R.refs = r; R.preset = ''; renderRp(); } });
  $('rpN').addEventListener('input', () => { R.n = +$('rpN').value; renderRp(); });
  document.addEventListener('langchange', render);
  $('rpRefs').value = REFS[0].s; $('vmFramesOut').textContent = $('vmFrames').value;
  run(OPS[0].ops); render();
}
init();
