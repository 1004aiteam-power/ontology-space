// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 시뮬레이션 그래프가 함께 쓰는 작은 도우미. 예전에는 그래프마다 같은 줄을 복사해 두었다
//
//   import { niceStep } from '../lib/chart.js?v=93b999ef';

// 0 ~ max 를 약 ticks 칸으로 나눌 때 읽기 좋은 눈금 간격 (1 · 2 · 2.5 · 5 · 10 × 10의 거듭제곱 중 하나)
// 예: niceStep(370) → 100,  niceStep(37, 5, [1, 2, 5, 10]) → 10
export function niceStep(max, ticks = 4, steps = [1, 2, 2.5, 5, 10]) {
  const r = max / ticks, p = 10 ** Math.floor(Math.log10(r));
  return steps.map(m => m * p).find(s => s >= r);
}
