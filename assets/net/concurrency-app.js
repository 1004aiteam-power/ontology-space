// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 동시 접속 처리 페이지: 같은 부하를 7가지 방식으로 돌려 간트 차트와 비교표로 보여 준다 (계산은 concurrency.js)
import { MODELS, makeLoad, compareAll } from './concurrency.js?v=b9a2fe1b';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';

const INFO = {
  iter: { ko: '① 한 번에 하나씩 (반복 서버)', en: '① One at a time (iterative)', era: { ko: '초기 · 아주 단순한 서버', en: 'Early, very simple servers' },
    does: { ko: '연결 하나를 끝까지 처리한 뒤에야 다음 <code>accept()</code>를 부릅니다. 느린 클라이언트 하나가 뒤의 모두를 세워 둡니다.', en: 'Finishes one connection before calling <code>accept()</code> again. One slow client stalls everyone behind it.' },
    code: `while True:
    conn, addr = srv.accept()
    handle(conn)          # {{끝날 때까지 다음 accept() 못 함|cannot accept() again until done}}
    conn.close()` },
  fork: { ko: '② 연결마다 프로세스 (fork)', en: '② A process per connection (fork)', era: { ko: '1980~90년대 · inetd, Apache prefork', en: '1980s–90s · inetd, Apache prefork' },
    does: { ko: '연결이 올 때마다 <code>fork()</code>로 자식 프로세스를 만들어 맡깁니다. 서로 완전히 격리되어 한 연결의 오류가 다른 연결에 번지지 않지만, 만드는 비용과 메모리가 큽니다.', en: 'Each connection gets a child process from <code>fork()</code>. Fully isolated, so one connection\'s crash does not spread, but creating and holding processes is expensive.' },
    code: `while True:
    conn, addr = srv.accept()
    if os.fork() == 0:    # {{자식 프로세스|child process}}
        srv.close(); handle(conn); os._exit(0)
    conn.close()          # {{부모는 곧바로 다음 accept()|the parent goes straight back to accept()}}` },
  thread: { ko: '③ 연결마다 스레드', en: '③ A thread per connection', era: { ko: '1990년대 후반~ · Apache worker, 초기 Java 서버', en: 'Late 1990s on · Apache worker, early Java servers' },
    does: { ko: '프로세스보다 가볍고 메모리를 공유합니다. 코드는 "한 연결 = 한 줄기 흐름"이라 읽기 쉽습니다. 하지만 연결 1만 개면 스레드 1만 개이고, 스택 메모리와 문맥 전환이 부담입니다.', en: 'Lighter than a process and shares memory. The code reads as "one connection = one flow". But 10,000 connections means 10,000 threads, with stack memory and context-switch costs.' },
    code: `while True:
    conn, addr = srv.accept()
    Thread(target=handle, args=(conn,)).start()` },
  pool: { ko: '④ 스레드 풀 + 대기열', en: '④ Thread pool + queue', era: { ko: '2000년대 · Tomcat 등 대부분의 Java 서버', en: '2000s · Tomcat and most Java servers' },
    does: { ko: '스레드를 미리 정해진 수만 만들어 재사용하고, 넘치는 연결은 대기열에서 기다립니다. 자원 사용은 예측 가능하지만, <b>I/O를 기다리는 동안에도 스레드를 붙들고 있어</b> 느린 연결이 많으면 풀이 바닥납니다.', en: 'A fixed number of reused threads; the overflow waits in a queue. Resource use is predictable, but a thread is <b>held even while waiting for I/O</b>, so many slow connections drain the pool.' },
    code: `pool = ThreadPoolExecutor(max_workers=8)
while True:
    conn, addr = srv.accept()
    pool.submit(handle, conn)   # {{일꾼이 다 바쁘면 큐에서 대기|waits in the queue if every worker is busy}}` },
  event: { ko: '⑤ 이벤트 루프 (select · epoll)', en: '⑤ Event loop (select / epoll)', era: { ko: '2000년대 · C10K 문제의 해법 · nginx, Node.js, Redis', en: '2000s · the answer to C10K · nginx, Node.js, Redis' },
    does: { ko: '스레드 하나가 수많은 소켓을 감시하다가 <b>준비된 소켓만</b> 처리합니다. 기다리는 연결은 거의 공짜(수 KB)라 연결 수만 개도 감당합니다. 대신 <b>CPU를 오래 쓰는 일이 끼면 루프 전체가 멈춥니다</b>.', en: 'One thread watches many sockets and handles <b>only the ready ones</b>. A waiting connection costs almost nothing (a few KB), so tens of thousands are fine. In return, <b>one long CPU job freezes the whole loop</b>.' },
    code: `sel = selectors.DefaultSelector()    # {{리눅스에서는 epoll|epoll on Linux}}
sel.register(srv, EVENT_READ)
while True:
    for key, _ in sel.select():        # {{준비된 소켓만 돌려줌|returns only the ready sockets}}
        if key.fileobj is srv:
            sel.register(srv.accept()[0], EVENT_READ)
        else:
            on_readable(key.fileobj)   # {{오래 걸리면 모두가 기다림|if this runs long, everyone waits}}` },
  async: { ko: '⑥ async/await · 코루틴 · 경량 스레드', en: '⑥ async/await · coroutines · lightweight threads', era: { ko: '2010년대~ · Go goroutine, Python asyncio, Java 가상 스레드', en: '2010s on · Go goroutines, Python asyncio, Java virtual threads' },
    does: { ko: '코드는 "연결 하나당 한 흐름"으로 쓰고, 기다릴 때(<code>await</code>)만 런타임이 다른 흐름으로 넘어갑니다. 이벤트 루프의 효율에 스레드 방식의 읽기 쉬움을 합친 셈이며, 런타임이 여러 코어에 나눠 실행하기도 합니다 (Go, Java 가상 스레드).', en: 'You write "one flow per connection", and only when it waits (<code>await</code>) does the runtime switch to another. It joins the efficiency of an event loop with the readability of threads, and the runtime may spread work over cores (Go, Java virtual threads).' },
    code: `async def handle(reader, writer):
    data = await reader.read(4096)   # {{기다리는 동안 다른 연결이 진행|other connections run meanwhile}}
    writer.write(process(data))
    await writer.drain()

asyncio.run(asyncio.start_server(handle, "0.0.0.0", 8080))` },
  multi: { ko: '⑦ 코어마다 이벤트 루프 (혼합형)', en: '⑦ An event loop per core (hybrid)', era: { ko: '현재 · nginx workers, Envoy', en: 'Today · nginx workers, Envoy' },
    does: { ko: '코어 수만큼 워커를 띄우고 각자 이벤트 루프를 돌립니다. 같은 포트를 여러 워커가 함께 열 수 있게 하는 <code>SO_REUSEPORT</code>로 커널이 연결을 나눠 줍니다. 이벤트 방식의 효율과 멀티코어를 동시에 얻지만 구조와 설정이 복잡해집니다.', en: 'One worker per core, each running its own event loop. <code>SO_REUSEPORT</code> lets several workers open the same port so the kernel spreads connections. You get event-style efficiency and all the cores, at the price of a more complex setup.' },
    code: `for _ in range(cores):                 # {{코어마다 워커 프로세스|one worker process per core}}
    if os.fork() == 0:
        s = socket(); s.setsockopt(SOL_SOCKET, SO_REUSEPORT, 1)
        s.bind(("0.0.0.0", 8080)); s.listen()
        run_event_loop(s)              # {{⑤ 와 같은 루프|the same loop as ⑤}}` }
};
const PRESETS = [
  { id: 'base', ko: '기본', en: 'Default', v: { n: 24, slow: 25, io: 50, slowIo: 800, cpu: 10, cores: 4, pool: 8, limit: 40 } },
  { id: 'slow', ko: '느린 클라이언트가 많음', en: 'Many slow clients', v: { n: 40, slow: 50, io: 50, slowIo: 1500, cpu: 10, cores: 4, pool: 8, limit: 40 } },
  { id: 'cpu', ko: 'CPU 작업이 무거움', en: 'Heavy CPU work', v: { n: 24, slow: 0, io: 0, slowIo: 800, cpu: 80, cores: 4, pool: 8, limit: 40 } },
  { id: 'flood', ko: '접속 폭주', en: 'Connection flood', v: { n: 60, slow: 0, io: 200, slowIo: 800, cpu: 10, cores: 4, pool: 8, limit: 20 } }
];
const COL = { queue: '#9aa0a6', cpu: '#2a78d6', ready: '#e8912d', io: '#8fcf9f' };
const SLIDERS = [['cnN', 'n', v => v], ['cnSlow', 'slow', v => v + '%'], ['cnIo', 'io', v => v + ' ms'], ['cnSlowIo', 'slowIo', v => v + ' ms'], ['cnCpu', 'cpu', v => v + ' ms'], ['cnCores', 'cores', v => v], ['cnPool', 'pool', v => v], ['cnLimit', 'limit', v => v]];
let V = { ...PRESETS[0].v }, seed = 1, sel = 'iter', preset = 'base', res = [];

const mem = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(kb >= 10240 ? 0 : 1) + ' MB' : kb + ' KB');
const MN = { iter: ['① 한 번에 하나', '① One at a time'], fork: ['② 프로세스/연결', '② Process each'], thread: ['③ 스레드/연결', '③ Thread each'], pool: ['④ 스레드 풀', '④ Thread pool'], event: ['⑤ 이벤트 루프', '⑤ Event loop'], async: ['⑥ async · 코루틴', '⑥ async · coroutines'], multi: ['⑦ 코어별 루프', '⑦ Loop per core'] };
const mn = (m) => t({ ko: MN[m][0], en: MN[m][1] });

function run() {
  const load = makeLoad({ n: V.n, spread: 200, cpu: V.cpu, io: V.io, slowRatio: V.slow / 100, slowIo: V.slowIo, seed });
  res = compareAll(load, { cores: V.cores, pool: V.pool, limit: V.limit });
}

function gantt() {
  const r = res.find(x => x.model === sel), common = $('cnCommon').checked;
  const end = common ? Math.max(...res.map(x => x.stats.end)) : r.stats.end, W = 760, L = 30, RH = 9, H = r.reqs.length * RH + 28;
  const sx = (ms) => L + (ms / end) * (W - L - 8);
  const o = [`<svg class="cn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('접속별 처리 간트 차트', 'Per-connection Gantt chart'))}">`];
  const step = [50, 100, 200, 500, 1000, 2000, 5000, 10000].find(s => end / s <= 8) || 20000;
  for (let ms = 0; ms <= end; ms += step) o.push(`<line x1="${sx(ms)}" y1="14" x2="${sx(ms)}" y2="${H - 4}" class="gx"/><text x="${sx(ms)}" y="10" text-anchor="middle">${ms >= 1000 ? ms / 1000 + 's' : ms}</text>`);
  r.reqs.forEach((q, i) => { for (const g of q.segs) o.push(`<rect x="${sx(g.from).toFixed(1)}" y="${18 + i * RH}" width="${Math.max(0.6, sx(g.to) - sx(g.from)).toFixed(1)}" height="${RH - 2}" fill="${COL[g.s]}"/>`); });
  o.push('</svg>');
  $('cnGantt').innerHTML = o.join('');
}

function table() {
  const maxAvg = Math.max(...res.map(r => r.stats.avg));
  $('cnTable').innerHTML = `<table class="net-tab cn-tab"><thead><tr><th>${T('방식', 'Design')}</th><th>${T('평균 지연', 'Avg latency')}</th><th>${T('95% 지연', 'p95')}</th><th>${T('최대', 'Max')}</th><th>${T('처리량 (건/초)', 'Throughput (req/s)')}</th><th>${T('동시에 붙든 일꾼', 'Peak workers')}</th><th>${T('추정 메모리', 'Est. memory')}</th></tr></thead><tbody>${res.map(r => `<tr tabindex="0" data-m="${r.model}" class="${r.model === sel ? 'sel' : ''}"><td>${mn(r.model)}</td><td><span class="cn-bar"><i style="width:${(r.stats.avg / maxAvg * 100).toFixed(1)}%"></i><b>${Math.round(r.stats.avg)} ms</b></span></td><td>${r.stats.p95} ms</td><td>${r.stats.max} ms</td><td>${r.stats.throughput.toFixed(1)}</td><td>${r.model === 'pool' ? V.pool : r.stats.peak}</td><td>${mem(r.stats.memKB)}</td></tr>`).join('')}</tbody></table>`;
}

function detail() {
  const i = INFO[sel];
  $('cnDetail').innerHTML = `<h4>${t({ ko: i.ko, en: i.en })}</h4><p class="meta">${t(i.era)}</p><p>${t(i.does)}</p><pre class="cn-code"><code>${esc(i.code.replace(/\{\{([^|]*)\|([^}]*)\}\}/g, (_, ko, en) => T(ko, en)))}</code></pre>`;
}

function labels() {
  for (const [id, k, f] of SLIDERS) $(id + 'Out').textContent = f(V[k]);
  $('cnModels').innerHTML = MODELS.map(m => `<button type="button" data-m="${m}" aria-pressed="${m === sel}">${mn(m)}</button>`).join('');
  $('cnPresets').innerHTML = PRESETS.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${p.id === preset}">${t(p)}</button>`).join('');
}
function render() { labels(); gantt(); table(); detail(); }

function init() {
  for (const [id, k] of SLIDERS) $(id).addEventListener('input', () => { V[k] = +$(id).value; preset = ''; run(); render(); });
  $('cnPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = PRESETS.find(x => x.id === b.dataset.id); V = { ...p.v }; preset = p.id; for (const [id, k] of SLIDERS) $(id).value = V[k]; run(); render(); });
  const pick = (e) => { const b = e.target.closest('[data-m]'); if (b) { sel = b.dataset.m; render(); } };
  $('cnModels').addEventListener('click', pick); $('cnTable').addEventListener('click', pick);
  $('cnTable').addEventListener('keydown', e => { if (e.key === 'Enter') pick(e); });
  $('cnSeed').addEventListener('click', () => { seed = seed % 999 + 1; run(); render(); });
  $('cnCommon').addEventListener('input', gantt);
  document.addEventListener('langchange', render);
  run(); render();
}
init();
