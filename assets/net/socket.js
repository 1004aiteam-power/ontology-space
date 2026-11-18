// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 소켓 모형: 서버와 클라이언트 두 장비의 "커널"이 파일 디스크립터(fd) · 연결 대기열 · 수신 버퍼를 어떻게 다루는지 흉내 낸다.
// socket → bind → listen → accept / socket → connect → send · recv → close 의 호출 순서와 오류(ECONNREFUSED · EADDRINUSE …)를 보여 주려는 학습용 모형이다
// (실제 네트워크 없음, 글자는 ASCII 바이트로 취급). 브라우저 없이 node 로 테스트: tests/net.test.mjs

export const HOSTS = { S: { ip: '10.0.0.5', ko: '서버', en: 'Server' }, A: { ip: '10.0.0.21', ko: '클라이언트', en: 'Client' } };
const L = (ko, en) => ({ ko, en });
const ok = (o = {}) => ({ ok: true, ...o });
const err = (errno, ko, en) => ({ ok: false, errno, msg: L(ko, en) });

export class Net {
  constructor() {
    this.h = {};
    for (const [id, v] of Object.entries(HOSTS)) this.h[id] = { id, ip: v.ip, next: 3, eph: 49152, fds: new Map() };
    this.wire = [];                                   // 선 위를 오간 것: { from, to, text }
  }
  w(from, to, text, detail = '') { this.wire.push({ from, to, text, detail }); }
  get(h, fd) { return this.h[h].fds.get(fd); }

  socket(h) {
    const H = this.h[h], fd = H.next++;
    H.fds.set(fd, { fd, host: h, state: 'CREATED', local: null, remote: null, backlog: 0, acceptQ: [], rbuf: '', peer: null, eof: false, waiting: false });
    return ok({ fd });
  }

  bind(h, fd, port) {
    const s = this.get(h, fd);
    if (!s || s.state !== 'CREATED') return err('EINVAL', '이미 묶였거나 없는 소켓입니다', 'Socket already bound or does not exist');
    for (const o of this.h[h].fds.values()) {
      if (o !== s && o.local && o.local.port === port && (o.state === 'BOUND' || o.state === 'LISTEN')) return err('EADDRINUSE', `포트 ${port}를 이미 다른 소켓이 쓰고 있습니다 (Address already in use)`, `Port ${port} is already used by another socket (Address already in use)`);
    }
    s.local = { ip: '0.0.0.0', port }; s.state = 'BOUND';
    return ok({ port });
  }

  listen(h, fd, backlog) {
    const s = this.get(h, fd);
    if (!s || s.state !== 'BOUND') return err('EINVAL', 'bind()로 포트에 묶은 소켓만 listen()할 수 있습니다', 'Only a socket already bound with bind() can listen()');
    s.state = 'LISTEN'; s.backlog = backlog;
    return ok({ backlog });
  }

  connect(h, fd, toId, port) {
    const s = this.get(h, fd), H = this.h[h], T = this.h[toId];
    if (!s || s.state !== 'CREATED') return err('EISCONN', '이미 연결됐거나 쓸 수 없는 소켓입니다', 'Socket already connected or unusable');
    s.local = { ip: H.ip, port: H.eph++ };               // 포트를 안 정하면 운영체제가 빈 임시 포트를 골라 줌
    const ln = [...T.fds.values()].find(o => o.state === 'LISTEN' && o.local.port === port);
    if (!ln) {
      this.w(h, toId, 'SYN'); this.w(toId, h, 'RST');
      s.local = null;
      return err('ECONNREFUSED', `${T.ip}:${port} 에서 listen 하는 소켓이 없어 연결이 거부됐습니다 (RST)`, `Nobody is listening on ${T.ip}:${port}, so the connection was refused (RST)`);
    }
    if (ln.acceptQ.length >= ln.backlog) {
      this.w(h, toId, 'SYN', t0('대기열 가득 → 무시됨', 'queue full → ignored'));
      s.local = null;
      return err('ETIMEDOUT', '서버의 연결 대기열이 가득 차 SYN이 무시되고, 시간이 지나 연결이 실패했습니다', 'The server\'s accept queue was full, the SYN was ignored and the connection finally timed out');
    }
    this.w(h, toId, 'SYN'); this.w(toId, h, 'SYN+ACK'); this.w(h, toId, 'ACK');
    const conn = { fd: null, host: toId, state: 'ESTABLISHED', local: { ip: T.ip, port }, remote: { ip: H.ip, port: s.local.port }, backlog: 0, acceptQ: [], rbuf: '', peer: s, eof: false, waiting: false };
    s.state = 'ESTABLISHED'; s.remote = { ip: T.ip, port }; s.peer = conn;
    ln.acceptQ.push(conn);
    let woke = null;
    if (ln.waiting) {                                    // accept()에서 기다리던 서버가 깨어남
      ln.waiting = false; ln.acceptQ.shift(); conn.fd = T.next++; T.fds.set(conn.fd, conn);
      woke = { host: toId, listenFd: ln.fd, fd: conn.fd, remote: conn.remote };
    }
    return ok({ port: s.local.port, woke, queued: ln.acceptQ.length });
  }

  accept(h, fd) {
    const s = this.get(h, fd), H = this.h[h];
    if (!s || s.state !== 'LISTEN') return err('EINVAL', 'listen() 중인 소켓에서만 accept()할 수 있습니다', 'accept() works only on a socket that is listening');
    if (s.acceptQ.length) {
      const c = s.acceptQ.shift(); c.fd = H.next++; H.fds.set(c.fd, c);
      return ok({ fd: c.fd, remote: c.remote });
    }
    s.waiting = true;
    return ok({ blocked: true });
  }

  send(h, fd, data) {
    const s = this.get(h, fd);
    if (!s || s.state !== 'ESTABLISHED' || !s.peer) return err('ENOTCONN', '연결되지 않은 소켓입니다', 'Socket is not connected');
    if (s.peerClosed) return err('EPIPE', '상대가 이미 연결을 닫았습니다 (Broken pipe)', 'The peer already closed the connection (Broken pipe)');
    s.peer.rbuf += data;
    this.w(h, s.peer.host, `DATA ${data.length} B`);
    return ok({ n: data.length });
  }

  recv(h, fd, n) {
    const s = this.get(h, fd);
    if (!s || s.state !== 'ESTABLISHED') return err('ENOTCONN', '연결되지 않은 소켓입니다', 'Socket is not connected');
    if (s.rbuf.length) { const data = s.rbuf.slice(0, n); s.rbuf = s.rbuf.slice(n); return ok({ data, left: s.rbuf.length }); }
    if (s.eof) return ok({ data: '', eof: true, left: 0 });
    return ok({ blocked: true });
  }

  close(h, fd) {
    const s = this.get(h, fd);
    if (!s) return err('EBADF', '없는 fd 입니다', 'No such fd');
    if (s.state === 'ESTABLISHED' && s.peer) {
      s.peer.eof = true; s.peer.peerClosed = true;
      this.w(h, s.peer.host, 'FIN'); this.w(s.peer.host, h, 'ACK');
    }
    this.h[h].fds.delete(fd);
    return ok({});
  }

  snapshot(h) {
    return [...this.h[h].fds.values()].map(s => ({ fd: s.fd, state: s.state, local: s.local, remote: s.remote, rbuf: s.rbuf, queue: s.acceptQ.length, backlog: s.backlog, waiting: s.waiting, eof: s.eof }));
  }
}
function t0(ko, en) { return ko + ' / ' + en; }

// ---- 순서 따라가기 -------------------------------------------------------------------------------------
const ep = (s) => `${s.ip}:${s.port}`;
const res = (r, okKo, okEn) => r.ok ? { r, ko: okKo, en: okEn } : { r, ko: r.msg.ko, en: r.msg.en, error: r.errno };
const fdOf = (r) => r.fd;

export function scenario(id, { recv = 1024 } = {}) {
  const S = 'S', A = 'A', PORT = 8080, SIP = HOSTS.S.ip;
  const sock = (name, side) => ({ side, code: `${name} = socket.socket(AF_INET, SOCK_STREAM)`, fn: (n, c) => { const r = n.socket(side); c[name] = r.fd; return res(r, `fd ${r.fd} 가 만들어짐. 아직 포트도 상대도 없는 빈 소켓`, `fd ${r.fd} created: an empty socket with no port and no peer yet`); } });
  const bind = (name, side, port = PORT) => ({ side, code: `${name}.bind(("0.0.0.0", ${port}))`, fn: (n, c) => res(n.bind(side, c[name], port), `포트 ${port}에 묶임: "이 포트로 오는 것은 내 것"`, `Bound to port ${port}: "traffic for this port is mine"`) });
  const listen = (name, side, b) => ({ side, code: `${name}.listen(${b})`, fn: (n, c) => res(n.listen(side, c[name], b), `LISTEN 상태. 완성된 연결을 최대 ${b}개까지 줄 세워 둠 (연결 대기열)`, `LISTEN state. Up to ${b} completed connections can wait in the accept queue`) });
  const accept = (lname, cname) => ({ side: S, code: `${cname}, addr = ${lname}.accept()`, kind: 'accept', fn: (n, c) => { const r = n.accept(S, c[lname]); if (r.blocked) return { r, blocked: true, ko: '연결이 올 때까지 여기서 멈춰 있음 (blocking)', en: 'Blocks here until a connection arrives' }; c[cname] = r.fd; return res(r, `연결 전용 새 소켓 fd ${r.fd} 를 돌려줌 (상대 ${r.remote ? ep(r.remote) : ''})`, `Returns a NEW socket fd ${r.fd} for this connection (peer ${r.remote ? ep(r.remote) : ''})`); } });
  const connect = (name, side = A) => ({ side, code: `${name}.connect(("${SIP}", ${PORT}))`, kind: 'connect', fn: (n, c) => { const r = n.connect(side, c[name], S, PORT); return res(r, `3-way handshake 끝. 내 포트는 운영체제가 고른 ${r.port}`, `3-way handshake done. The OS picked my port ${r.port}`); } });
  const send = (name, text, side) => ({ side, code: `${name}.send(b${JSON.stringify(text)})`, fn: (n, c) => res(n.send(side, c[name], text), `${text.length} 바이트를 커널에 맡김 (상대가 읽었다는 뜻은 아님)`, `Handed ${text.length} bytes to the kernel (not a sign the peer has read them)`) });
  const recvStep = (name, side, size, again = false) => ({
    side, code: `data = ${name}.recv(${size})`, kind: 'recv', again, size,
    fn: (n, c) => {
      const r = n.recv(side, c[name], size);
      if (!r.ok) return res(r);
      if (r.blocked) return { r, blocked: true, ko: '읽을 데이터가 아직 없어 멈춤', en: 'No data yet, so it blocks' };
      if (r.eof) return { r, ko: '0바이트 = 상대가 연결을 닫음 (EOF)', en: '0 bytes = the peer closed the connection (EOF)' };
      return { r, ko: `${r.data.length}바이트 읽음: ${JSON.stringify(r.data)}${r.left ? ` · 커널 버퍼에 ${r.left}바이트 남음 → 다시 recv` : ''}`, en: `Read ${r.data.length} bytes: ${JSON.stringify(r.data)}${r.left ? ` · ${r.left} bytes left in the kernel buffer → recv again` : ''}` };
    }
  });
  const close = (name, side) => ({ side, code: `${name}.close()`, fn: (n, c) => res(n.close(side, c[name]), 'FIN을 보내 연결을 닫고 fd를 반환', 'Sends FIN to close the connection and releases the fd') });
  const bad = (side, code, fn) => ({ side, code, fn });

  if (id === 'echo') return [
    sock('srv', S), bind('srv', S), listen('srv', S, 5), accept('srv', 'conn'),
    sock('cli', A), connect('cli'),
    send('cli', 'Hello, ', A), send('cli', 'socket!', A),
    recvStep('conn', S, recv),
    send('conn', 'echo: Hello, socket!', S), recvStep('cli', A, 1024),
    close('cli', A), recvStep('conn', S, 1024), close('conn', S)
  ];
  if (id === 'two') return [
    sock('srv', S), bind('srv', S), listen('srv', S, 5),
    sock('c1', A), connect('c1'), sock('c2', A), connect('c2'),
    accept('srv', 'conn1'), accept('srv', 'conn2'),
    send('c1', 'from first', A), send('c2', 'from second', A),
    recvStep('conn2', S, 1024), recvStep('conn1', S, 1024)
  ];
  if (id === 'errors') return [
    bad(A, `cli = socket.create_connection(("${SIP}", ${PORT}))`, (n, c) => { const s = n.socket(A); c.x = s.fd; return res(n.connect(A, s.fd, S, PORT)); }),
    sock('srv', S), bind('srv', S),
    bad(S, `srv2 = socket.socket(); srv2.bind(("0.0.0.0", ${PORT}))`, (n) => { const s = n.socket(S); return res(n.bind(S, s.fd, PORT)); }),
    bad(S, 'conn, addr = srv.accept()   # listen() 전', (n, c) => res(n.accept(S, c.srv))),
    listen('srv', S, 1),
    bad(A, `c1 = socket.create_connection(("${SIP}", ${PORT}))`, (n) => { const s = n.socket(A); return res(n.connect(A, s.fd, S, PORT), '연결은 됐지만 서버가 accept() 하지 않아 대기열(1/1)에 앉아 있음', 'Connected, but the server has not called accept() so it sits in the queue (1/1)'); }),
    bad(A, `c2 = socket.create_connection(("${SIP}", ${PORT}))`, (n) => { const s = n.socket(A); return res(n.connect(A, s.fd, S, PORT)); }),
    accept('srv', 'conn')
  ];
  throw new Error('unknown scenario ' + id);
}

// 시나리오를 한 단계씩 실행. accept()에서 멈춰 있다가 connect()로 깨어나면 그 줄에 결과를 덧붙인다. recv()가 다 못 읽었으면 같은 줄을 한 번 더 넣는다
export class Runner {
  constructor(steps) { this.net = new Net(); this.ctx = {}; this.steps = steps.map(s => ({ ...s })); this.i = 0; this.out = []; this.pending = null; }
  get done() { return this.i >= this.steps.length; }
  next() {
    if (this.done) return null;
    const st = this.steps[this.i], o = st.fn(this.net, this.ctx);
    this.out[this.i] = o;
    if (st.kind === 'accept' && o.blocked) this.pending = { idx: this.i, step: st };
    const w = o.r && o.r.woke;
    if (w && this.pending) {
      const p = this.pending; this.pending = null;
      this.ctx[p.step.code.split(',')[0]] = w.fd;
      this.out[p.idx] = { r: o.r, woke: true, ko: `깨어남: 연결 전용 소켓 fd ${w.fd} (상대 ${ep(w.remote)})`, en: `Wakes up: a NEW socket fd ${w.fd} for the connection (peer ${ep(w.remote)})` };
    }
    if (st.kind === 'recv' && o.r && o.r.left > 0) this.steps.splice(this.i + 1, 0, { ...st, again: true, code: st.code.replace(/ +# again$/, '') + '   # again' });
    this.i++;
    return o;
  }
  goto(k) { const r = new Runner(this.steps.filter(s => !s.again).map(s => s)); while (r.i < k && !r.done) r.next(); return r; }
}
