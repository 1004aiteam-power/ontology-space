// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 프로세스 · 스케줄링 페이지: 같은 작업 묶음을 7가지 스케줄러로 돌려 간트 차트 · 커널 안 상태 · 비교표로 보여 준다 (계산은 sched.js)
import { ALGOS, compareAll, randomJobs } from './sched.js?v=a400f8c7';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const INFO = {
  fcfs: { ko: '① 먼저 온 순서 (FCFS)', en: '① First come, first served (FCFS)', era: { ko: '1950~60년대 일괄 처리 · 지금도 프린터 대기열 같은 곳', en: '1950s–60s batch systems · still used for queues like printing' },
    does: { ko: '준비 줄의 맨 앞을 골라 <b>끝날 때까지</b> 돌립니다(비선점). 가장 단순하고 공평해 보이지만, 긴 작업 뒤에 짧은 작업들이 줄줄이 서는 <b>호위 효과(convoy effect)</b>가 생깁니다.', en: 'Takes the head of the ready queue and runs it <b>to completion</b> (non-preemptive). The simplest and seemingly fair, but short jobs pile up behind a long one: the <b>convoy effect</b>.' },
    code: `while True:
    p = ready.popleft()       # {{맨 앞|the head}}
    run(p)                    # {{스스로 I/O 를 하거나 끝날 때까지|until it does I/O or finishes}}` },
  sjf: { ko: '② 짧은 작업 먼저 (SJF)', en: '② Shortest job first (SJF)', era: { ko: '1960년대 · 평균 대기시간이 가장 짧음이 증명된 방식', en: '1960s · provably minimal average waiting time' },
    does: { ko: '다음 CPU 버스트가 가장 짧은 것을 고릅니다(비선점). 평균 대기시간은 가장 짧지만 <b>버스트 길이를 미리 알아야</b> 합니다. 실제로는 지난 버스트들의 지수 평균으로 짐작합니다. 긴 작업은 계속 밀릴 수 있습니다.', en: 'Picks the shortest next CPU burst (non-preemptive). It minimises average waiting time but <b>needs to know burst lengths in advance</b>; real systems guess from an exponential average of past bursts. Long jobs can be pushed back indefinitely.' },
    code: `p = min(ready, key=lambda p: p.next_burst)
# {{예측: 다음 = a·지난 버스트 + (1-a)·지난 예측|guess: next = a·last burst + (1-a)·last guess}}
run(p)` },
  srtf: { ko: '③ 남은 시간이 짧은 것 먼저 (SRTF)', en: '③ Shortest remaining time first (SRTF)', era: { ko: 'SJF의 선점형', en: 'The preemptive form of SJF' },
    does: { ko: '새로 준비된 프로세스의 버스트가 지금 실행 중인 것의 <b>남은 시간</b>보다 짧으면 바로 빼앗습니다(선점). 응답이 빠르지만 문맥 전환이 늘고, 긴 작업은 굶을 수 있습니다.', en: 'If a newly ready process has a burst shorter than the <b>remaining time</b> of the running one, it takes the CPU at once (preemption). Fast responses, but more context switches, and long jobs can starve.' },
    code: `on ready(p):
    if p.remaining < current.remaining:
        preempt(current)      # {{실행 중이던 것을 준비 줄로|send the running one back to the queue}}
        run(p)` },
  rr: { ko: '④ 라운드 로빈 (RR)', en: '④ Round robin (RR)', era: { ko: '1961년 CTSS · 시분할의 시작', en: '1961 CTSS · the start of time sharing' },
    does: { ko: '모두에게 <b>시간 할당량(quantum)</b>만큼씩 돌아가며 줍니다. 할당량을 다 쓰면 줄 맨 뒤로. 누구도 오래 기다리지 않아 대화형에 맞습니다. 할당량이 너무 작으면 문맥 전환 비용이, 너무 크면 FCFS와 같아집니다.', en: 'Everyone gets a <b>time quantum</b> in turn; when it is used up the process goes to the back of the line. Nobody waits long, which suits interactive use. Too small a quantum wastes time on context switches; too large and it turns into FCFS.' },
    code: `p = ready.popleft()
run(p, for_at_most=quantum)
if not p.finished and not p.blocked:
    ready.append(p)           # {{맨 뒤로|to the back}}` },
  prio: { ko: '⑤ 우선순위 (선점형)', en: '⑤ Priority (preemptive)', era: { ko: '유닉스 nice 값 · 실시간 OS', en: 'Unix nice values · real-time OSes' },
    does: { ko: '우선순위가 가장 높은 것(nice 값이 작은 것)을 돌리고, 더 높은 것이 준비되면 빼앗습니다. 중요한 일을 먼저 하지만, 높은 쪽이 계속 있으면 낮은 쪽은 <b>영영 못 도는(기아, starvation)</b> 일이 생깁니다. 기다린 시간만큼 우선순위를 올려 주는 <b>에이징(aging)</b>이 해법입니다.', en: 'Runs the highest priority (lowest nice value) and preempts when a higher one becomes ready. Important work goes first, but while higher ones keep coming, lower ones may <b>never run (starvation)</b>. The fix is <b>aging</b>: raise the priority the longer a process waits.' },
    code: `p = min(ready, key=lambda p: p.nice)   # {{작을수록 높음|lower = higher priority}}
if p.nice < current.nice:
    preempt(current)
run(p)` },
  mlfq: { ko: '⑥ 다단계 피드백 큐 (MLFQ)', en: '⑥ Multilevel feedback queue (MLFQ)', era: { ko: '1962년 Corbató(CTSS) · BSD · Windows · macOS 계열의 바탕', en: '1962 Corbató (CTSS) · the basis of BSD, Windows and macOS schedulers' },
    does: { ko: '줄을 여러 단계로 두고, 새 프로세스는 맨 위에서 시작합니다. <b>할당량을 다 쓰면 한 단계 아래로</b>(CPU를 많이 쓰는 일괄 작업), 그 전에 I/O로 비켜 주면 그대로(대화형). 버스트 길이를 몰라도 행동을 보고 SJF처럼 동작합니다. 아래로 밀린 작업이 굶지 않게 <b>주기적으로 모두 맨 위로 올립니다(boost)</b>.', en: 'Several queue levels; a new process starts at the top. <b>Use up the quantum and you drop a level</b> (CPU-heavy batch work); give up the CPU for I/O first and you stay (interactive). It behaves like SJF without knowing burst lengths, by watching behaviour. To keep demoted work from starving, <b>everyone is periodically boosted to the top</b>.' },
    code: `p = first non-empty of (level0, level1, level2)
run(p, for_at_most=quantum[p.level])   # {{q, 2q, 끝까지|q, 2q, to completion}}
if used_whole_quantum(p): p.level += 1
every boost_period: move everyone to level0` },
  cfs: { ko: '⑦ 공정 분배 (CFS, 리눅스)', en: '⑦ Completely Fair Scheduler (CFS, Linux)', era: { ko: '리눅스 2.6.23(2007) ~ 6.5 · 6.6(2023)부터는 EEVDF', en: 'Linux 2.6.23 (2007) to 6.5 · EEVDF since 6.6 (2023)' },
    does: { ko: '프로세스마다 <b>가상 실행 시간(vruntime)</b>을 재고, 가장 적게 쓴 것을 돌립니다. nice 값이 작을수록 가중치가 커서 vruntime이 천천히 늘어 CPU를 더 받습니다. 줄 대신 레드블랙 트리에 vruntime 순으로 넣어 맨 왼쪽을 뽑습니다. 잠들었다 깨어난 대화형 프로세스는 vruntime이 적어 금방 CPU를 얻습니다.', en: 'Tracks a <b>virtual runtime (vruntime)</b> for each process and runs the one that has used the least. A lower nice value means a bigger weight, so vruntime grows more slowly and the process gets more CPU. Instead of a queue it keeps a red-black tree ordered by vruntime and picks the leftmost. An interactive process that slept has a small vruntime and gets the CPU quickly.' },
    code: `p = tree.leftmost()                    # {{vruntime 이 가장 작은 것|smallest vruntime}}
slice = latency * p.weight / total_weight
run(p, for_at_most=slice)
p.vruntime += ran * 1024 / p.weight    # {{nice 0 의 가중치 = 1024|weight of nice 0 = 1024}}` }
};
const MN = { fcfs: ['① FCFS', '① FCFS'], sjf: ['② SJF', '② SJF'], srtf: ['③ SRTF', '③ SRTF'], rr: ['④ 라운드 로빈', '④ Round robin'], prio: ['⑤ 우선순위', '⑤ Priority'], mlfq: ['⑥ MLFQ', '⑥ MLFQ'], cfs: ['⑦ CFS', '⑦ CFS'] };
const mn = (a) => T(MN[a][0], MN[a][1]);
const J = (name, arrive, cpu, n = 1, io = 0, nice = 0) => ({ name, arrive, cpu, n, io, nice });
const PRESETS = [
  { id: 'base', ko: '기본 (대화형 · 일괄 섞임)', en: 'Default (interactive and batch)', jobs: [J('P1', 0, 18, 2, 6), J('P2', 2, 2, 5, 6), J('P3', 4, 12), J('P4', 6, 1, 6, 5), J('P5', 8, 3, 3, 8)] },
  { id: 'convoy', ko: '호위 효과', en: 'Convoy effect', jobs: [J('P1', 0, 30), J('P2', 1, 2), J('P3', 2, 2), J('P4', 3, 3)] },
  { id: 'book', ko: '교과서 예제 (24 · 3 · 3)', en: 'Textbook example (24 · 3 · 3)', jobs: [J('P1', 0, 24), J('P2', 0, 3), J('P3', 0, 3)] },
  { id: 'inter', ko: '계산 둘 + 대화형 둘', en: 'Two crunchers + two interactive', jobs: [J('P1', 0, 40), J('P2', 0, 40), J('P3', 2, 1, 8, 4), J('P4', 3, 2, 6, 6)] },
  { id: 'starve', ko: '우선순위와 기아', en: 'Priority and starvation', jobs: [J('P1', 0, 10, 1, 0, 10), J('P2', 1, 6, 5, 2, -5), J('P3', 2, 6, 5, 2, -5)] },
  { id: 'nice', ko: 'nice 값 차이 (0 vs 5)', en: 'Different nice values (0 vs 5)', jobs: [J('P1', 0, 60, 1, 0, 0), J('P2', 0, 60, 1, 0, 5)] }
];
const PCOL = ['#2a78d6', '#8a63d2', '#1f9d6b', '#c2549d', '#0097a7', '#8d6e63'];
const FIELDS = [['arrive', 0, 99, { ko: '도착', en: 'Arrive' }], ['cpu', 1, 60, { ko: 'CPU 한 번', en: 'CPU burst' }], ['n', 1, 10, { ko: '반복', en: 'Bursts' }], ['io', 0, 40, { ko: 'I/O 대기', en: 'I/O wait' }], ['nice', -20, 19, { ko: 'nice', en: 'nice' }]];
const SLIDERS = [['psQ', 'q', v => v], ['psCs', 'cs', v => v], ['psBoost', 'boost', v => (v ? v : T('끔', 'off'))]];
let jobs = PRESETS[0].jobs.map(j => ({ ...j })), V = { q: 4, cs: 1, boost: 60 }, sel = 'rr', preset = 'base', res = [], cur = null, time = 0, timer = null, seed = 1;

function run() { res = compareAll(jobs, V); cur = res.find(r => r.algo === sel); time = Math.min(time, cur.stats.end - 1); }

function jobTable() {
  $('psJobs').innerHTML = `<table class="net-tab os-jobs"><thead><tr><th>${T('프로세스', 'Process')}</th>${FIELDS.map(f => `<th>${t(f[3])}</th>`).join('')}<th>${T('종류', 'Kind')}</th></tr></thead><tbody>${jobs.map((j, i) =>
    `<tr><td><i class="os-dot" style="--c:${PCOL[i]}"></i>${esc(j.name)}</td>${FIELDS.map(([k, lo, hi]) => `<td><input type="number" data-i="${i}" data-k="${k}" min="${lo}" max="${hi}" value="${j[k]}" aria-label="${esc(j.name)} ${k}"></td>`).join('')}<td class="meta">${j.n > 1 && j.cpu <= 4 ? T('대화형', 'interactive') : T('계산 위주', 'CPU-bound')}</td></tr>`).join('')}</tbody></table>`;
  $('psAdd').disabled = jobs.length >= PCOL.length; $('psDel').disabled = jobs.length <= 1;
}

function gantt() {
  const end = cur.stats.end, W = 760, L = 44, RH = 14, top = 18, H = top + 20 + jobs.length * RH + 8;
  const sx = (x) => L + (x / end) * (W - L - 8);
  const o = [`<svg class="os-svg" id="psSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('CPU와 프로세스별 간트 차트', 'Gantt chart of the CPU and each process'))}">`];
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => end / s <= 12) || 1000;
  for (let x = 0; x <= end; x += step) o.push(`<line x1="${sx(x)}" y1="12" x2="${sx(x)}" y2="${H - 4}" class="gx"/><text x="${sx(x)}" y="9" text-anchor="middle">${x}</text>`);
  o.push(`<text x="2" y="${top + 11}" class="rl">CPU</text>`);
  for (const g of cur.cpu) {
    if (g.s === 'idle') continue;
    o.push(`<rect x="${sx(g.from).toFixed(1)}" y="${top}" width="${(sx(g.to) - sx(g.from)).toFixed(1)}" height="16" ${g.s === 'cs' ? 'class="cs"' : `fill="${PCOL[g.p]}"`}/>`);
    if (g.s === 'run' && sx(g.to) - sx(g.from) > 16) o.push(`<text x="${((sx(g.from) + sx(g.to)) / 2).toFixed(1)}" y="${top + 12}" text-anchor="middle" class="in">${g.p + 1}</text>`);
  }
  cur.procs.forEach((p, i) => {
    const y = top + 22 + i * RH;
    o.push(`<text x="2" y="${y + 10}" class="rl">${esc(p.name)}</text>`);
    for (const g of p.segs) o.push(`<rect x="${sx(g.from).toFixed(1)}" y="${y}" width="${Math.max(0.6, sx(g.to) - sx(g.from)).toFixed(1)}" height="${RH - 3}" ${g.s === 'run' ? `fill="${PCOL[i]}"` : `class="${g.s}"`}/>`);
    if (p.end !== null) o.push(`<text x="${(sx(p.end) + 3).toFixed(1)}" y="${y + 10}" class="fin">✓</text>`);
  });
  o.push(`<line id="psCur" x1="${sx(time + 0.5)}" y1="12" x2="${sx(time + 0.5)}" y2="${H - 4}" class="cur"/></svg>`);
  $('psGantt').innerHTML = o.join('');
  $('psSvg').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W;
    setTime(Math.floor((x - L) / (W - L - 8) * end));
  });
}

// 상태 전이 그림: 생성 → 준비 ⇄ 실행 → 종료, 실행 → 대기 → 준비
const BOX = { new: [20, 18, { ko: '생성', en: 'New' }], ready: [150, 18, { ko: '준비', en: 'Ready' }], run: [330, 18, { ko: '실행', en: 'Running' }], done: [510, 18, { ko: '종료', en: 'Done' }], wait: [240, 120, { ko: '대기 (I/O)', en: 'Waiting (I/O)' }] };
const BW = 120, BH = 58;
const ARROWS = [
  ['new', 'ready', 'M140 40 L150 40', { ko: '도착', en: 'admit' }, 145, 34],
  ['ready', 'run', 'M270 34 L330 34', { ko: '디스패치', en: 'dispatch' }, 300, 28],
  ['run', 'ready', 'M330 60 L270 60', { ko: '선점 · 할당량 끝', en: 'preempt · quantum' }, 300, 72],
  ['run', 'done', 'M450 40 L510 40', { ko: '끝', en: 'exit' }, 480, 34],
  ['run', 'wait', 'M380 76 L340 120', { ko: 'I/O 요청', en: 'I/O request' }, 398, 104],
  ['wait', 'ready', 'M260 120 L220 76', { ko: 'I/O 끝', en: 'I/O done' }, 200, 104]
];
function kernel() {
  const s = cur.snaps[time], prev = time > 0 ? cur.snaps[time - 1] : null;
  const moved = new Set();
  if (prev) s.st.forEach((x, i) => { const a = prev.st[i]; if (a !== x) moved.add(`${a === 'new' && x !== 'new' ? 'new' : a}>${x}`); });
  if (!prev) s.st.forEach(x => { if (x !== 'new') moved.add('new>' + x); });
  const o = [`<svg class="os-st" viewBox="0 0 640 186" role="img" aria-label="${esc(T('프로세스 상태 전이', 'Process state transitions'))}"><defs><marker id="psArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="ah"/></marker></defs>`];
  for (const [a, b, d, lab, lx, ly] of ARROWS) {
    const on = moved.has(`${a}>${b}`) || (a === 'new' && b === 'ready' && [...moved].some(m => m.startsWith('new>')));
    o.push(`<path d="${d}" class="ar${on ? ' on' : ''}" marker-end="url(#psArr)"/><text x="${lx}" y="${ly}" text-anchor="middle" class="al${on ? ' on' : ''}">${esc(t(lab))}</text>`);
  }
  for (const [k, [x, y, lab]] of Object.entries(BOX)) {
    const ids = s.st.map((v, i) => (v === k ? i : -1)).filter(i => i >= 0);
    o.push(`<rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="10" class="bx bx-${k}"/><text x="${x + 8}" y="${y + 15}" class="bl">${esc(t(lab))}</text>`);
    ids.forEach((i, n) => o.push(`<circle cx="${x + 16 + (n % 5) * 22}" cy="${y + 34 + Math.floor(n / 5) * 16}" r="9" fill="${PCOL[i]}"/><text x="${x + 16 + (n % 5) * 22}" y="${y + 38 + Math.floor(n / 5) * 16}" text-anchor="middle" class="in">${i + 1}</text>`));
  }
  o.push('</svg>');
  const name = (i) => esc(jobs[i]?.name ?? 'P' + (i + 1));
  const note = (i) => (sel === 'sjf' || sel === 'srtf' ? T(`남은 ${s.rm[i]}`, `rem ${s.rm[i]}`) : sel === 'prio' ? `nice ${jobs[i].nice}` : sel === 'mlfq' ? T(`단계 ${s.lv[i]}`, `level ${s.lv[i]}`) : sel === 'cfs' ? `vrt ${s.vr[i]}` : '');
  const now = s.cs ? T('문맥 전환 중 (아무도 일하지 못함)', 'Context switch (no one makes progress)') : s.cur >= 0 ? T(`${name(s.cur)} 실행 중`, `${name(s.cur)} running`) + (note(s.cur) ? ` · ${note(s.cur)}` : '') : T('쉼 (모두 I/O 대기 중이거나 아직 안 옴)', 'Idle (everyone is waiting for I/O or has not arrived)');
  const q = s.q.length ? s.q.map(i => `<span class="os-q" style="--c:${PCOL[i]}">${name(i)}${note(i) ? `<small>${note(i)}</small>` : ''}</span>`).join('<span class="os-qa" aria-hidden="true">→</span>') : `<span class="meta">${T('비어 있음', 'empty')}</span>`;
  $('psKernel').innerHTML = `<p class="os-now"><b>t = ${time}</b> · CPU: ${now}</p>${o.join('')}<p class="os-ql"><b>${T('준비 줄 (다음에 뽑힐 순서)', 'Ready queue (in the order it will be picked)')}</b> ${q}</p>`;
  $('psTOut').textContent = `${time} / ${cur.stats.end - 1}`;
  const c = $('psCur'); if (c) { const W = 760, L = 44, x = L + ((time + 0.5) / cur.stats.end) * (W - L - 8); c.setAttribute('x1', x); c.setAttribute('x2', x); }
}
function setTime(x) { time = Math.max(0, Math.min(cur.stats.end - 1, x)); $('psT').value = time; kernel(); }

function table() {
  const maxT = Math.max(...res.map(r => r.stats.turnaround));
  const f1 = (x) => (Math.round(x * 10) / 10).toString();
  $('psTable').innerHTML = `<table class="net-tab cn-tab"><thead><tr><th>${T('방식', 'Scheduler')}</th><th>${T('평균 반환시간', 'Avg turnaround')}</th><th>${T('평균 대기', 'Avg waiting')}</th><th>${T('평균 응답', 'Avg response')}</th><th>${T('가장 긴 응답', 'Worst response')}</th><th>${T('문맥 전환', 'Switches')}</th><th>${T('CPU 이용률', 'CPU use')}</th></tr></thead><tbody>${res.map(r => `<tr tabindex="0" data-m="${r.algo}" class="${r.algo === sel ? 'sel' : ''}"><td>${mn(r.algo)}</td><td><span class="cn-bar"><i style="width:${(r.stats.turnaround / maxT * 100).toFixed(1)}%"></i><b>${f1(r.stats.turnaround)}</b></span></td><td>${f1(r.stats.wait)}</td><td>${f1(r.stats.resp)}</td><td>${r.stats.maxResp}</td><td>${r.stats.switches}</td><td>${Math.round(r.stats.util * 100)}%</td></tr>`).join('')}</tbody></table>`;
}

function detail() {
  const i = INFO[sel];
  $('psDetail').innerHTML = `<h4>${t(i)}</h4><p class="meta">${t(i.era)}</p><p>${t(i.does)}</p><pre class="cn-code"><code>${esc(i.code.replace(/\{\{([^|]*)\|([^}]*)\}\}/g, (_, ko, en) => T(ko, en)))}</code></pre>`;
}

function labels() {
  for (const [id, k, f] of SLIDERS) $(id + 'Out').textContent = f(V[k]);
  $('psAlgos').innerHTML = ALGOS.map(a => `<button type="button" data-m="${a}" aria-pressed="${a === sel}">${mn(a)}</button>`).join('');
  $('psPresets').innerHTML = PRESETS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${p.id === preset}">${t(p)}</button>`).join('');
  $('psT').max = cur.stats.end - 1; $('psT').value = time;
}
function render() { labels(); jobTable(); gantt(); kernel(); table(); detail(); }
function redo() { run(); labels(); gantt(); kernel(); table(); }

function play() {
  if (timer) { clearInterval(timer); timer = null; $('psPlay').textContent = '▶'; return; }
  if (time >= cur.stats.end - 1) time = 0;
  $('psPlay').textContent = '⏸';
  timer = setInterval(() => { if (time >= cur.stats.end - 1) return play(); setTime(time + 1); }, 160);
}

function init() {
  for (const [id, k] of SLIDERS) $(id).addEventListener('input', () => { V[k] = +$(id).value; redo(); });
  $('psPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = PRESETS.find(x => x.id === b.dataset.id); jobs = p.jobs.map(j => ({ ...j })); preset = p.id; time = 0; run(); render(); });
  $('psJobs').addEventListener('change', e => {
    const x = e.target.closest('input'); if (!x) return;
    const f = FIELDS.find(f => f[0] === x.dataset.k), v = Math.max(f[1], Math.min(f[2], Math.round(+x.value || 0)));
    jobs[+x.dataset.i][x.dataset.k] = v; x.value = v; preset = ''; run(); render();
  });
  $('psAdd').addEventListener('click', () => { if (jobs.length < PCOL.length) { jobs.push(J('P' + (jobs.length + 1), 5, 4, 2, 5)); preset = ''; run(); render(); } });
  $('psDel').addEventListener('click', () => { if (jobs.length > 1) { jobs.pop(); preset = ''; run(); render(); } });
  $('psRand').addEventListener('click', () => { seed = seed % 999 + 1; jobs = randomJobs(seed, 5); preset = ''; time = 0; run(); render(); });
  const pick = (e) => { const b = e.target.closest('[data-m]'); if (b) { sel = b.dataset.m; cur = res.find(r => r.algo === sel); time = Math.min(time, cur.stats.end - 1); render(); } };
  $('psAlgos').addEventListener('click', pick); $('psTable').addEventListener('click', pick);
  $('psTable').addEventListener('keydown', e => { if (e.key === 'Enter') pick(e); });
  $('psT').addEventListener('input', () => setTime(+$('psT').value));
  $('psPrev').addEventListener('click', () => setTime(time - 1));
  $('psNext').addEventListener('click', () => setTime(time + 1));
  $('psPlay').addEventListener('click', play);
  document.addEventListener('langchange', render);
  run(); render();
}
init();
