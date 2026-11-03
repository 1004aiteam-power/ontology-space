// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 프로젝트 페이지: UUID v4 · v5 · v7 과 현재 시각(나노초)을 브라우저에서 직접 만들어 보기
(function () {
  const $ = (id) => document.getElementById(id);
  const hex = (bytes) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const fmt = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  const parse = (u) => Uint8Array.from(u.replace(/-/g, '').match(/../g), x => parseInt(x, 16));
  const NS_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';             // RFC 9562 NameSpace_URL
  const NS_PYCIM = '06c51a58-c0dc-5986-8205-43aa3a0f35f2';           // pycim/ids.py PYCIM_NAMESPACE

  // 버전 자리(13번째 글자)와 variant 자리(17번째 글자)를 강조해서 보여 준다
  function show(el, u) {
    el.innerHTML = `${u.slice(0, 14)}<mark class="uv">${u[14]}</mark>${u.slice(15, 19)}<mark class="uvar">${u[19]}</mark>${u.slice(20)}`;
  }
  function stamp(b, version) {                                        // 버전 4비트 + variant 10xx
    b[6] = (b[6] & 0x0f) | (version << 4);
    b[8] = (b[8] & 0x3f) | 0x80;
    return fmt(hex(b));
  }

  function v4() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return stamp(crypto.getRandomValues(new Uint8Array(16)), 4);
  }
  async function v5(ns, name) {
    const data = new Uint8Array([...parse(ns), ...new TextEncoder().encode(name)]);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16);
    return stamp(h, 5);
  }
  function v7() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    let ms = BigInt(Date.now());
    for (let i = 5; i >= 0; i--) { b[i] = Number(ms & 0xffn); ms >>= 8n; }   // 앞 48비트 = 유닉스 밀리초
    return stamp(b, 7);
  }
  function nowNs() {
    const wall = BigInt(Date.now()) * 1000000n;                                  // 밀리초 × 10^6
    const hiMs = performance.timeOrigin + performance.now();                     // 소수점 아래는 브라우저가 일부러 거칠게 만든다
    const hi = BigInt(Math.floor(hiMs)) * 1000000n + BigInt(Math.round((hiMs % 1) * 1e6));
    return { wall: wall.toString(), hi: hi.toString() };
  }

  async function run(kind) {
    if (kind === 'v4') { show($('uOut4'), v4()); return; }
    if (kind === 'v7') { const u = v7(); show($('uOut7'), u); $('uOut7t').textContent = new Date(parseInt(u.replace(/-/g, '').slice(0, 12), 16)).toISOString(); return; }
    if (kind === 'v5') {
      const ns = $('uNs').value === 'pycim' ? NS_PYCIM : NS_URL;
      try { show($('uOut5'), await v5(ns, $('uName').value)); }
      catch (e) { $('uOut5').textContent = window.t ? t({ ko: '이 브라우저에서는 SHA-1을 쓸 수 없습니다 (HTTPS 필요).', en: 'SHA-1 is unavailable here (needs HTTPS).' }) : 'SHA-1 unavailable'; }
      return;
    }
    if (kind === 'ns') { const n = nowNs(); $('uNsWall').textContent = n.wall; $('uNsHi').textContent = n.hi; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('uuidLab')) return;
    document.querySelectorAll('[data-uuid]').forEach(b => b.addEventListener('click', () => run(b.dataset.uuid)));
    $('uName').addEventListener('input', () => run('v5'));
    $('uNs').addEventListener('change', () => run('v5'));
    ['v4', 'v5', 'v7', 'ns'].forEach(run);
  });
})();
