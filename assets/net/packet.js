// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 패킷 조립: 애플리케이션 데이터 → TCP 세그먼트 → IPv4 패킷 → 이더넷 프레임.
// 헤더 필드 · 체크섬 · FCS(CRC-32)를 실제 규칙대로 계산한다 (브라우저 없이 node 로 테스트: tests/net.test.mjs)

export const LAYERS = ['data', 'tcp', 'ip', 'eth'];
export const SRC_MAC = [0x02, 0x00, 0x00, 0x00, 0x00, 0x01];
export const DST_MAC = [0x02, 0x00, 0x00, 0x00, 0x00, 0x02];
export const FLAG_BITS = { FIN: 0x01, SYN: 0x02, RST: 0x04, PSH: 0x08, ACK: 0x10, URG: 0x20 };

export const utf8 = (s) => Array.from(new TextEncoder().encode(s));
export const hex = (b, n = 2) => b.toString(16).padStart(n, '0');
export const hexs = (bytes) => bytes.map(b => hex(b)).join(' ');
const be = (v, n) => Array.from({ length: n }, (_, i) => (v >>> (8 * (n - 1 - i))) & 0xff);   // 큰 값부터 (네트워크 바이트 순서)

export function parseIp(s) {
  const p = String(s).trim().split('.');
  if (p.length !== 4 || !p.every(x => /^\d{1,3}$/.test(x))) return null;
  const b = p.map(Number);
  return b.every(x => x <= 255) ? b : null;
}

// 인터넷 체크섬: 16비트씩 더해 올림을 되돌려 더하고 비트를 뒤집는다 (RFC 1071). 체크섬 칸까지 넣어 다시 계산하면 0
export function checksum16(bytes) {
  let s = 0;
  for (let i = 0; i < bytes.length; i += 2) s += (bytes[i] << 8) | (i + 1 < bytes.length ? bytes[i + 1] : 0);
  while (s >>> 16) s = (s & 0xffff) + (s >>> 16);
  return (~s) & 0xffff;
}

let CRC_TABLE;
export function crc32(bytes) {
  if (!CRC_TABLE) CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const F = (name, off, len, bytes, value, ko, en) => ({ name, off, len, bytes: bytes.slice(off, off + len), value, note: { ko, en } });

// TCP 세그먼트 (옵션 없는 20바이트 머리말)
export function buildTcp({ srcPort, dstPort, seq, ack, flags, window, payload, srcIp, dstIp }) {
  const fl = flags.reduce((a, f) => a | FLAG_BITS[f], 0);
  const head = [...be(srcPort, 2), ...be(dstPort, 2), ...be(seq, 4), ...be(ack, 4), 0x50, fl, ...be(window, 2), 0, 0, 0, 0];
  const seg = [...head, ...payload];
  const len = seg.length;
  const sum = checksum16([...srcIp, ...dstIp, 0, 6, ...be(len, 2), ...seg]);       // 가짜 머리말(pseudo header)까지 포함
  seg[16] = sum >> 8; seg[17] = sum & 0xff;
  const h = seg.slice(0, 20);
  return {
    bytes: seg, checksum: sum, flags,
    fields: [
      F('Source Port', 0, 2, h, String(srcPort), '보내는 쪽 프로그램을 가리키는 포트 번호', 'Port of the sending program'),
      F('Destination Port', 2, 2, h, String(dstPort), '받는 쪽 프로그램을 가리키는 포트 번호 (80=HTTP, 443=HTTPS)', 'Port of the receiving program (80=HTTP, 443=HTTPS)'),
      F('Sequence Number', 4, 4, h, String(seq), '이 세그먼트 첫 바이트의 번호. 받는 쪽이 순서를 맞추는 기준', 'Number of this segment\'s first byte; lets the receiver restore order'),
      F('Acknowledgment Number', 8, 4, h, String(ack), '"여기까지 받았으니 다음엔 이 번호를 보내라"는 확인 번호', '"Received up to here — send this byte next"'),
      F('Data Offset', 12, 1, h, '5 (= 20 B)', '머리말 길이(4바이트 단위). 옵션이 없으면 5', 'Header length in 4-byte words; 5 without options'),
      F('Flags', 13, 1, h, flags.join(' · ') || '—', '연결을 열고 닫고 확인하는 제어 비트 (SYN · ACK · FIN · PSH …)', 'Control bits to open, close and acknowledge (SYN · ACK · FIN · PSH …)'),
      F('Window', 14, 2, h, String(window), '받는 쪽이 지금 더 받을 수 있는 바이트 수 (흐름 제어)', 'Bytes the receiver can still accept (flow control)'),
      F('Checksum', 16, 2, h, '0x' + hex(sum, 4), '머리말 · 데이터 · 가짜 머리말(IP 주소)의 오류 검사', 'Error check over header, data and a pseudo-header (IP addresses)'),
      F('Urgent Pointer', 18, 2, h, '0', '긴급 데이터 위치 (거의 안 씀)', 'Urgent data position (rarely used)')
    ]
  };
}

// IPv4 패킷 (옵션 없는 20바이트 머리말)
export function buildIp({ srcIp, dstIp, id, ttl, payload }) {
  const total = 20 + payload.length;
  const head = [0x45, 0, ...be(total, 2), ...be(id, 2), 0x40, 0, ttl, 6, 0, 0, ...srcIp, ...dstIp];
  const sum = checksum16(head);
  head[10] = sum >> 8; head[11] = sum & 0xff;
  return {
    bytes: [...head, ...payload], checksum: sum,
    fields: [
      F('Version · IHL', 0, 1, head, '4 · 5 (= 20 B)', 'IP 버전 4, 머리말 길이 5×4 = 20바이트', 'IP version 4, header length 5×4 = 20 bytes'),
      F('DSCP · ECN', 1, 1, head, '0', '서비스 품질 표시 (여기서는 기본값)', 'Quality-of-service marking (default here)'),
      F('Total Length', 2, 2, head, String(total), 'IP 머리말 + TCP 머리말 + 데이터의 길이', 'IP header + TCP header + data'),
      F('Identification', 4, 2, head, '0x' + hex(id, 4), '패킷 식별 번호 (조각난 패킷을 다시 합칠 때 씀)', 'Packet ID (used to reassemble fragments)'),
      F('Flags · Fragment Offset', 6, 2, head, 'DF · 0', 'DF = 쪼개지 마시오. 조각 위치는 0', 'DF = do not fragment; fragment offset 0'),
      F('TTL', 8, 1, head, String(ttl), '라우터를 지날 때마다 1씩 줄어 0이 되면 버려짐 (떠돌이 패킷 방지)', 'Drops by 1 at every router; discarded at 0 (stops wandering packets)'),
      F('Protocol', 9, 1, head, '6 (TCP)', '안에 든 것이 TCP(6)라는 표시 (UDP는 17)', 'What is inside: TCP (6); UDP is 17'),
      F('Header Checksum', 10, 2, head, '0x' + hex(sum, 4), 'IP 머리말만의 오류 검사. 라우터마다 TTL이 바뀌어 다시 계산됨', 'Checks the IP header only; recomputed at each router as TTL changes'),
      F('Source Address', 12, 4, head, srcIp.join('.'), '보내는 컴퓨터의 IP 주소', 'IP address of the sender'),
      F('Destination Address', 16, 4, head, dstIp.join('.'), '받는 컴퓨터의 IP 주소', 'IP address of the receiver')
    ]
  };
}

// 이더넷 프레임: 머리말 14바이트 + (46바이트가 안 되면 0으로 채움) + FCS 4바이트
export function buildEth({ payload, srcMac = SRC_MAC, dstMac = DST_MAC }) {
  const head = [...dstMac, ...srcMac, 0x08, 0x00];
  const pad = Math.max(0, 46 - payload.length);
  const body = [...head, ...payload, ...Array(pad).fill(0)];
  const crc = crc32(body);
  const fcs = [crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff];   // FCS는 낮은 바이트부터 보냄
  const mac = (m) => m.map(b => hex(b)).join(':');
  return {
    bytes: [...body, ...fcs], pad, crc, fcs,
    fields: [
      F('Destination MAC', 0, 6, head, mac(dstMac), '같은 네트워크 안에서 받을 장비(다음 홉)의 MAC 주소', 'MAC address of the next device on this local network'),
      F('Source MAC', 6, 6, head, mac(srcMac), '보내는 장비의 MAC 주소', 'MAC address of the sender'),
      F('EtherType', 12, 2, head, '0x0800 (IPv4)', '안에 든 것이 IPv4라는 표시 (IPv6은 0x86DD)', 'What is inside: IPv4 (IPv6 is 0x86DD)')
    ]
  };
}

// 텍스트(또는 바이트열)를 MTU 에 맞춰 세그먼트로 나누고 각각을 프레임까지 감싼다
export function buildPackets(o) {
  const c = { srcIp: '192.168.0.10', dstIp: '93.184.216.34', srcPort: 51724, dstPort: 80, mtu: 1500, seq: 1001, ack: 5001, window: 502, ttl: 64, id: 0x1a2b, text: '', crlf: false, ...o };
  const src = parseIp(c.srcIp), dst = parseIp(c.dstIp);
  if (!src || !dst) return { error: 'ip', packets: [], data: [], mss: 0 };
  const data = utf8(c.crlf ? c.text.replace(/\r?\n/g, '\r\n') : c.text);
  const mss = Math.max(1, c.mtu - 40);                      // MTU − IP 머리말 20 − TCP 머리말 20
  const parts = [];
  for (let i = 0; i < data.length; i += mss) parts.push(data.slice(i, i + mss));
  const packets = parts.map((payload, i) => {
    const seq = c.seq + i * mss;
    const flags = i === parts.length - 1 ? ['PSH', 'ACK'] : ['ACK'];
    const tcp = buildTcp({ srcPort: c.srcPort, dstPort: c.dstPort, seq, ack: c.ack, flags, window: c.window, payload, srcIp: src, dstIp: dst });
    const ip = buildIp({ srcIp: src, dstIp: dst, id: (c.id + i) & 0xffff, ttl: c.ttl, payload: tcp.bytes });
    const eth = buildEth({ payload: ip.bytes });
    // 프레임 안의 칸: 바이트마다 어느 계층 것인지
    const layer = [];
    const put = (name, n) => { for (let k = 0; k < n; k++) layer.push(name); };
    put('eth', 14); put('ip', 20); put('tcp', 20); put('data', payload.length); put('pad', eth.pad); put('fcs', 4);
    // 검증: 받는 쪽이 같은 계산을 해서 맞는지 본다
    const ok = {
      ip: checksum16(ip.bytes.slice(0, 20)) === 0,
      tcp: checksum16([...src, ...dst, 0, 6, ...be(tcp.bytes.length, 2), ...tcp.bytes]) === 0,
      fcs: crc32(eth.bytes.slice(0, eth.bytes.length - 4)) === (eth.fcs[0] | (eth.fcs[1] << 8) | (eth.fcs[2] << 16) | (eth.fcs[3] << 24)) >>> 0
    };
    return { index: i, seq, payload, tcp, ip, eth, frame: eth.bytes, layer, ok };
  });
  return { packets, data, mss };
}
