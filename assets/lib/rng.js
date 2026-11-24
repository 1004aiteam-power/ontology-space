// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 시드를 주면 늘 같은 순서의 난수를 내는 생성기 (mulberry32). 시뮬레이션을 다시 돌려도 같은 결과가 나오게 한다.
// 예전에는 시뮬레이션마다 같은 함수를 복사해 두었다. 결과가 바뀌지 않도록 알고리즘은 그대로다.
//
//   import { mulberry32 } from '../lib/rng.js?v=73d9551d';
//   const R = mulberry32(42); R();   // 0 이상 1 미만

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
