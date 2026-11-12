// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 — 공통: 안전수칙 · 역할 · 장면 치수 · 붐(2관절) 계산 · 할 일(task) 만들기 (safety.js 가 이 파일들을 묶어 내보낸다)
// 배전 공사현장 안전조치 시뮬레이션 코어 (화면 없이 동작 → 테스트 가능). 단위: 미터, 초
//
// 장면: 왕복 2차로 도로(x축 방향), 북쪽 보도 위 전주 4기(-70 개폐기 · -35 접지 · 0 작업 · 35), 고압 3상 + 중성선 (저압선 없음)
//   시나리오 'pole'    가공 배전선로 애자·완금 교체 (정전 작업) — 안전수칙 1~8, 11(배전)
//   시나리오 'manhole' 지중 배전 맨홀 내 케이블 점검 — 안전수칙 1, 3, 9, 10, 11(토목: 개구부 방호)
// 각 단계 = 여러 줄(lane)의 할 일(task)을 동시에 진행. 매 틱 안전 규칙(불변식)을 확인해 위반을 기록
//
// ⚠ 교육용으로 단순화한 가상 현장입니다. 실제 작업은 소속 기관의 작업기준·안전수칙을 따르세요.

export const RULES = [
  null,
  { ko: '개인 안전장구 착용', en: 'Wear personal protective equipment' },
  { ko: '고임목 4개 이상 설치', en: 'Place 4 or more wheel chocks' },
  { ko: '작업계획서·TBM 작성 필수, 공법 임의변경 금지', en: 'Work plan and TBM required; no ad-hoc method changes' },
  { ko: '작업차량 전도방지 조치', en: 'Prevent the work vehicle from tipping over' },
  { ko: '작업반경 출입금지, 후진 시 전담유도자 배치', en: 'Keep out of the work radius; a dedicated guide when reversing' },
  { ko: '인양물 고정장치, 하부 출입금지', en: 'Secure lifted loads; nobody beneath them' },
  { ko: '안전대 착용, 안전고리 체결', en: 'Wear a safety harness and clip the lanyard' },
  { ko: '검전, 접지, 충전부 방호', en: 'Test for voltage, earth, cover live parts' },
  { ko: '밀폐공간 작업 허가절차 준수', en: 'Follow the confined-space permit procedure' },
  { ko: '맨홀 내 작업 시 작업반경 출입금지', en: 'Keep out of the work radius during manhole work' },
  { ko: '분야별 수칙 (배전: 적정공구 사용 · 토목: 개구부 추락방지 등)', en: 'Field rules (distribution: proper tools · civil: guard openings, etc.)' }
];

export const ROLES = {
  pole: {
    A: { ko: '작업책임자', en: 'Supervisor', col: '#2a78d6' },
    B: { ko: '버킷 작업자', en: 'Bucket lineworker', col: '#d95926' },
    C: { ko: '지상 작업자·운전원', en: 'Ground worker / driver', col: '#199e70' },
    D: { ko: '검전·접지 담당', en: 'Testing & earthing', col: '#9085e9' },
    E: { ko: '신호수(유도자)', en: 'Signaller (guide)', col: '#d4a106' }
  },
  tx: {
    A: { ko: '작업책임자', en: 'Supervisor', col: '#2a78d6' },
    B: { ko: '버킷 작업자', en: 'Bucket lineworker', col: '#d95926' },
    C: { ko: '지상 작업자·운전원', en: 'Ground worker / driver', col: '#199e70' },
    D: { ko: '접지·지상 보조', en: 'Earthing & ground helper', col: '#9085e9' },
    E: { ko: '신호수(유도자)', en: 'Signaller (guide)', col: '#d4a106' }
  },
  tower: {
    A: { ko: '작업책임자', en: 'Supervisor', col: '#2a78d6' },
    B: { ko: '승탑 작업자', en: 'Climber', col: '#d95926' },
    C: { ko: '지상 보조(달줄)', en: 'Ground helper (hand line)', col: '#199e70' },
    D: { ko: '안전 감시자', en: 'Safety watcher', col: '#9085e9' },
    E: { ko: '출입 통제', en: 'Access control', col: '#d4a106' }
  },
  manhole: {
    A: { ko: '작업책임자', en: 'Supervisor', col: '#2a78d6' },
    B: { ko: '입조 작업자', en: 'Entrant', col: '#d95926' },
    C: { ko: '감시인', en: 'Attendant', col: '#199e70' },
    D: { ko: '가스 측정·환기 담당', en: 'Gas testing & ventilation', col: '#9085e9' },
    E: { ko: '신호수(유도자)', en: 'Signaller (guide)', col: '#d4a106' }
  }
};

// ---- 장면 치수 -----------------------------------------------------------------------
export const GEO = {
  roadHalf: 4, walkOut: 7.6, poleY: 5.6, poles: [-70, -35, 0, 35], poleH: 13.6,
  armZ: 11.6, phaseY: [4.5, 5.6, 6.7], neutralZ: 10.3, neutralY: 5.3,
  swX: -70, swZ: 10.2, gndX: -35, workX: 0,
  laneY: 1.9, truckLen: 8.5, truckW: 2.5, park: 0.5,         // 작업차 정차 위치(차체 중심 x)
  ttBack: 2.6, ttZ: 2.9, L1: 6.5, L2: 6.5,                    // 붐 회전대(차체 중심에서 뒤로), 하부·상부 붐 길이
  pedY: 6.95, fallR: 2.4, guideSpot: [-8.5, 0.4],
  zone: [[-12, -0.3], [12, -0.3], [12, 6.3], [-12, 6.3]],     // 가공 작업 출입금지 구역 (보행 통로는 6.3 바깥)
  mh: [14, -2], blower: [10.8, -0.7], vanC: 3, vanY: -2, mhZone: [[-5, 0.3], [20, 0.3], [20, -4.0], [-5, -4.0]], pedYm: -6.4
};
export const PHASE_LIVE = { source: 'source' };              // 개폐기 서쪽은 항상 충전

// ---- 붐 (2관절) -----------------------------------------------------------------------
// 관절 각: slew(수평 회전, +x=0) · e(하부 붐 앙각) · bend(하부 대비 상부 붐 꺾임, 아래쪽 +)
export function boomBase(tr) { return [tr.c - GEO.ttBack, tr.y, GEO.ttZ]; }
export function boomFK(tr, j = tr.boom) {
  const B = boomBase(tr), u = [Math.cos(j.slew), Math.sin(j.slew)];
  const E = [B[0] + u[0] * GEO.L1 * Math.cos(j.e), B[1] + u[1] * GEO.L1 * Math.cos(j.e), B[2] + GEO.L1 * Math.sin(j.e)];
  const a2 = j.e - j.bend;
  const T = [E[0] + u[0] * GEO.L2 * Math.cos(a2), E[1] + u[1] * GEO.L2 * Math.cos(a2), E[2] + GEO.L2 * Math.sin(a2)];
  return { B, E, T };
}
export function boomIK(tr, P) {
  const B = boomBase(tr), dx = P[0] - B[0], dy = P[1] - B[1], d = Math.hypot(dx, dy), h = P[2] - B[2];
  const r = Math.min(Math.hypot(d, h), GEO.L1 + GEO.L2 - 1e-3);
  const a = Math.acos(Math.max(-1, Math.min(1, (GEO.L1 ** 2 + r * r - GEO.L2 ** 2) / (2 * GEO.L1 * r))));
  const e = Math.atan2(h, d) + a, slew = Math.atan2(dy, dx);
  const E = [GEO.L1 * Math.cos(e), GEO.L1 * Math.sin(e)], a2 = Math.atan2(h - E[1], d - E[0]);
  return { slew, e, bend: e - a2 };
}
export const STOW = { slew: 0, e: 0.05, bend: 3.3 };          // 하부 붐은 운전석 쪽으로 눕히고 상부 붐은 접어 버킷을 뒤로
export const BUCKET = {                                              // 버킷 바닥 목표 위치
  near: [-1.7, 2.5, 9.4],       // 검전용: 충전부와 거리를 둔 위치
  work: [-0.9, 3.35, 10.5],     // 애자·완금 작업 위치
  cover: [-0.8, 3.9, 9.2]       // 중성선·인접 상 방호 위치
};
export const lerpJ = (a, b, k) => ({ slew: a.slew + (b.slew - a.slew) * k, e: a.e + (b.e - a.e) * k, bend: a.bend + (b.bend - a.bend) * k });
export const bucketPos = (tr) => { const { T } = boomFK(tr); return T; };
export const hookXY = (tr) => { const T = bucketPos(tr), s = tr.boom.slew; return [T[0] + Math.cos(s) * 0.9, T[1] + Math.sin(s) * 0.9]; };

// ---- 도우미 --------------------------------------------------------------------------
export const L = (ko, en) => ({ ko, en });
export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const ease = (k) => k * k * (3 - 2 * k);
export function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// 고깔 위치: 다각형 둘레를 따라 간격 sp로
export function conesAround(poly, sp, skip = () => false) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.round(dist2(a, b) / sp));
    for (let k = 0; k < n; k++) { const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; if (!skip(p, i)) out.push({ x: p[0], y: p[1], placed: false, side: i }); }
  }
  return out;
}

// ---- 할 일(task) 만들기 ---------------------------------------------------------------
export const go = (w, x, y) => ({ w, go: [x, y] });
export const act = (w, anim, dur, opt = {}) => ({ w, act: anim, dur, ...opt });
export const say = (w, text, dur = 2.2) => ({ w, act: 'talk', dur, say: text });
export const tween = (dur, fx, opt = {}) => ({ tween: true, dur, fx, ...opt });
export const until = (cond) => ({ until: cond });
export const set = (fn) => ({ set: fn });
export const wait = (dur) => ({ wait: dur });
