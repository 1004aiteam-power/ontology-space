// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// SHA-1 (동기). Git 이 객체 이름(해시)을 만드는 데 쓰는 바로 그 함수다. 브라우저 없이 node 로 테스트: tests/git.test.mjs
export function sha1(msg) {
  const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : msg;
  const l = bytes.length, nb = ((l + 8) >> 6) + 1, w = new Uint32Array(nb * 16);
  for (let i = 0; i < l; i++) w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  w[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
  w[nb * 16 - 1] = l * 8;
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const W = new Uint32Array(80);
  for (let b = 0; b < nb; b++) {
    for (let t = 0; t < 16; t++) W[t] = w[b * 16 + t];
    for (let t = 16; t < 80; t++) { const x = W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16]; W[t] = (x << 1) | (x >>> 31); }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = (bb & c) | (~bb & d); k = 0x5A827999; }
      else if (t < 40) { f = bb ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = bb ^ c ^ d; k = 0xCA62C1D6; }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + W[t]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
