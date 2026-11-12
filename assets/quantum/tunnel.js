// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 양자 터널 효과: 1차원 시간에 따른 슈뢰딩거 방정식 (화면 없이 동작 → 테스트 가능)
//
//   iħ ∂ψ/∂t = −(ħ²/2m) ∂²ψ/∂x² + V(x) ψ
//
// 전자 하나(비상대론적, 스핀 없음)를 가우스 파동 묶음으로 만들어 네모난 벽(퍼텐셜 장벽) 쪽으로 쏜다.
// 단위: 거리 nm, 에너지 eV, 시간 ħ/eV (= 0.658 fs). 이 단위에서 ħ = 1, ħ²/2m(전자) = 0.0381 eV·nm²
// 풀이: 분할 단계 푸리에법 (반 걸음 퍼텐셜 → 운동 에너지는 푸리에 공간에서 한 걸음 → 반 걸음 퍼텐셜).
//       각 단계가 위상만 곱하므로 확률의 합이 보존된다. 양 끝에는 파동을 흡수하는 띠를 두어 되돌아오지 않게 하고,
//       흡수된 양은 왼쪽(반사) · 오른쪽(투과)으로 나눠 따로 센다.

export const HBAR2_2M = 0.0381;            // ħ²/2mₑ (eV·nm²)
export const FS_PER_T = 0.6582;            // 시간 단위 ħ/eV 를 펨토초로
// dt: 벽 모서리가 날카로워 시간 간격이 크면 분할 오차가 커진다. 0.005 에서 이론값과 맞는다 (tests/tunnel.test.mjs)
export const DEFAULTS = { E: 5, V0: 6, a: 0.25, sigma: 1.5, x0: -9, L: 48, N: 2048, dt: 0.005, absorb: 7 };

// ---- 고속 푸리에 변환 (기수 2, 제자리) ---------------------------------------------------------------
export function makeFFT(n) {
  const levels = Math.log2(n);
  if (levels % 1) throw new Error('FFT size must be a power of two');
  const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  // inverse = true 면 역변환 (1/n 까지 곱함)
  return function fft(re, im, inverse = false) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    const s = inverse ? 1 : -1;
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half, wr = cos[k], wi = s * sin[k];
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };
}

// ---- 이론: 평면파 하나가 네모난 벽을 지나갈 확률 ---------------------------------------------------------
//   E < V₀:  T = 1 / (1 + V₀² sinh²(κa) / (4E(V₀−E))),  κ = √((V₀−E)/(ħ²/2m))   ← 벽 안에서 지수적으로 줄어듦
//   E > V₀:  T = 1 / (1 + V₀² sin²(qa)  / (4E(E−V₀))),  q = √((E−V₀)/(ħ²/2m))   ← 벽보다 높아도 일부 반사, 공명하면 100%
export function transmission(E, V0, a) {
  if (E <= 0) return 0;
  if (V0 === 0 || a === 0) return 1;
  const d = E - V0;
  if (Math.abs(d) < 1e-9) return 1 / (1 + V0 * a * a / (4 * HBAR2_2M));           // E = V₀ 의 극한
  if (d < 0) { const k = Math.sqrt(-d / HBAR2_2M), s = Math.sinh(k * a); return 1 / (1 + V0 * V0 * s * s / (4 * E * -d)); }
  const q = Math.sqrt(d / HBAR2_2M), s = Math.sin(q * a); return 1 / (1 + V0 * V0 * s * s / (4 * E * d));
}

// 파동 묶음은 여러 에너지가 섞여 있으므로, 운동량 분포로 평균한 투과 확률이 시뮬레이션과 비교할 값이다
export function packetTransmission(E, V0, a, sigma) {
  const k0 = Math.sqrt(E / HBAR2_2M), sk = 1 / (2 * sigma);                        // |φ(k)|² 는 중심 k₀, 표준편차 1/(2σ) 인 정규분포
  let sum = 0, w = 0;
  for (let i = -400; i <= 400; i++) {
    const k = k0 + sk * 6 * i / 400; if (k <= 0) continue;
    const p = Math.exp(-((k - k0) ** 2) / (2 * sk * sk));
    sum += p * transmission(HBAR2_2M * k * k, V0, a); w += p;
  }
  return w ? sum / w : 0;
}

export class Tunnel {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    const { N, L } = this.opts;
    this.fft = makeFFT(N);
    this.dx = L / N;
    this.x = Float64Array.from({ length: N }, (_, i) => -L / 2 + i * this.dx);
    this.k = Float64Array.from({ length: N }, (_, i) => 2 * Math.PI * (i < N / 2 ? i : i - N) / L);
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.reset();
  }

  // 벽(가운데가 x = 0, 두께 a)과 파동 묶음을 지금 설정으로 다시 만든다
  reset() {
    const { N, E, V0, a, sigma, x0, dt, L, absorb } = this.opts, k0 = Math.sqrt(E / HBAR2_2M);
    // 벽: 격자 칸이 벽과 겹치는 비율만큼 높이를 준다 → 두께가 칸 크기에 딱 맞지 않아도 벽의 '넓이'가 정확히 V₀ × a
    const dx = this.dx;
    this.V = Float64Array.from(this.x, x => V0 * Math.max(0, Math.min(x + dx / 2, a / 2) - Math.max(x - dx / 2, -a / 2)) / dx);
    this.vr = new Float64Array(N); this.vi = new Float64Array(N); this.kr = new Float64Array(N); this.ki = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      this.vr[i] = Math.cos(-this.V[i] * dt / 2); this.vi[i] = Math.sin(-this.V[i] * dt / 2);          // e^{−iV dt/2}
      const ph = -HBAR2_2M * this.k[i] ** 2 * dt; this.kr[i] = Math.cos(ph); this.ki[i] = Math.sin(ph); // e^{−i(ħ²k²/2m)dt}
    }
    // 흡수 띠: 양 끝 absorb nm 에서 매 단계 조금씩 줄임 (부드럽게 줄여야 띠에서 반사가 생기지 않음)
    const edge = L / 2 - absorb;
    this.mask = Float64Array.from(this.x, x => { const d = Math.abs(x) - edge; return d <= 0 ? 1 : Math.exp(-0.05 * (d / absorb) ** 2 * dt / 0.04); });
    let norm = 0;
    for (let i = 0; i < N; i++) {
      const g = Math.exp(-((this.x[i] - x0) ** 2) / (4 * sigma * sigma));
      this.re[i] = g * Math.cos(k0 * this.x[i]); this.im[i] = g * Math.sin(k0 * this.x[i]); norm += g * g;
    }
    const s = 1 / Math.sqrt(norm * this.dx);
    for (let i = 0; i < N; i++) { this.re[i] *= s; this.im[i] *= s; }
    this.t = 0; this.lostL = 0; this.lostR = 0; this.k0 = k0;
  }

  set(opts) { Object.assign(this.opts, opts); this.reset(); }

  step(n = 1) {
    const { re, im, vr, vi, kr, ki, mask } = this, N = this.opts.N, half = N / 2;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < N; i++) { const a = re[i], b = im[i]; re[i] = a * vr[i] - b * vi[i]; im[i] = a * vi[i] + b * vr[i]; }
      this.fft(re, im);
      for (let i = 0; i < N; i++) { const a = re[i], b = im[i]; re[i] = a * kr[i] - b * ki[i]; im[i] = a * ki[i] + b * kr[i]; }
      this.fft(re, im, true);
      for (let i = 0; i < N; i++) { const a = re[i], b = im[i]; re[i] = a * vr[i] - b * vi[i]; im[i] = a * vi[i] + b * vr[i]; }
      for (let i = 0; i < N; i++) if (mask[i] < 1) {                                                     // 흡수한 만큼 왼쪽 · 오른쪽에 더함
        const p = (re[i] * re[i] + im[i] * im[i]) * this.dx, m = mask[i];
        re[i] *= m; im[i] *= m;
        const lost = p * (1 - m * m);
        if (i < half) this.lostL += lost; else this.lostR += lost;
      }
      this.t += this.opts.dt;
    }
  }

  // 확률이 어디에 있나: 벽 왼쪽 · 벽 안 · 벽 오른쪽 (흡수된 것 포함). 셋의 합은 1
  regions() {
    const a = this.opts.a / 2; let L = 0, M = 0, R = 0;
    for (let i = 0; i < this.opts.N; i++) {
      const p = (this.re[i] ** 2 + this.im[i] ** 2) * this.dx, x = this.x[i];
      if (x < -a) L += p; else if (x > a) R += p; else M += p;
    }
    return { left: L + this.lostL, inside: M, right: R + this.lostR, total: L + M + R + this.lostL + this.lostR };
  }

  // 묶음의 무게중심이 움직이는 속도 (군속도) = ħk/m = 2(ħ²/2m)k/ħ
  groupVelocity() { return 2 * HBAR2_2M * this.k0; }

  theory() {
    const { E, V0, a, sigma } = this.opts;
    return { plane: transmission(E, V0, a), packet: packetTransmission(E, V0, a, sigma), classical: E > V0 ? 1 : 0 };
  }

  // 벽에서 충분히 떨어질 때까지 (투과 · 반사가 다 나뉠 때까지) 걸리는 단계 수
  stepsToSettle() {
    const { x0, sigma, dt } = this.opts, v = this.groupVelocity();
    return Math.ceil((Math.abs(x0) + 6 * sigma + 4) / v / dt);
  }
}
