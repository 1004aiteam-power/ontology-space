// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전 공사현장 안전조치 시뮬레이션 코어 (화면 없이 동작 → 테스트 가능). 단위: 미터, 초
//
// 장면: 왕복 2차로 도로(x축 방향), 북쪽 보도 위 전주 4기(-70 개폐기 · -35 접지 · 0 작업 · 35 변압기)
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
  armZ: 11.6, phaseY: [4.5, 5.6, 6.7], neutralZ: 10.3, lvZ: 8.6, lvY: [5.25, 5.95],
  swX: -70, swZ: 10.2, gndX: -35, workX: 0, txX: 35,
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
const BUCKET = {                                              // 버킷 바닥 목표 위치
  near: [-1.7, 2.5, 9.4],       // 검전용: 충전부와 거리를 둔 위치
  work: [-0.9, 3.35, 10.5],     // 애자·완금 작업 위치
  cover: [-0.7, 3.7, 7.5]       // 저압선 방호 위치
};
const lerpJ = (a, b, k) => ({ slew: a.slew + (b.slew - a.slew) * k, e: a.e + (b.e - a.e) * k, bend: a.bend + (b.bend - a.bend) * k });
export const bucketPos = (tr) => { const { T } = boomFK(tr); return T; };
export const hookXY = (tr) => { const T = bucketPos(tr), s = tr.boom.slew; return [T[0] + Math.cos(s) * 0.9, T[1] + Math.sin(s) * 0.9]; };

// ---- 도우미 --------------------------------------------------------------------------
const L = (ko, en) => ({ ko, en });
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ease = (k) => k * k * (3 - 2 * k);
export function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// 고깔 위치: 다각형 둘레를 따라 간격 sp로
function conesAround(poly, sp, skip = () => false) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.round(dist2(a, b) / sp));
    for (let k = 0; k < n; k++) { const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; if (!skip(p, i)) out.push({ x: p[0], y: p[1], placed: false, side: i }); }
  }
  return out;
}

// ---- 할 일(task) 만들기 ---------------------------------------------------------------
const go = (w, x, y) => ({ w, go: [x, y] });
const act = (w, anim, dur, opt = {}) => ({ w, act: anim, dur, ...opt });
const say = (w, text, dur = 2.2) => ({ w, act: 'talk', dur, say: text });
const tween = (dur, fx, opt = {}) => ({ tween: true, dur, fx, ...opt });
const until = (cond) => ({ until: cond });
const set = (fn) => ({ set: fn });
const wait = (dur) => ({ wait: dur });

// ---- 시나리오: 가공 배전 애자·완금 교체 ----------------------------------------------------
function poleWorld() {
  const G = GEO;
  // side 0: 차도 쪽 줄(y=-0.3) · 3: 서쪽 보도 끝 · 2: 보행 통로 경계(y=6.3) · 1: 동쪽 보도 끝 · 4: 차량 진입 뒤 닫는 서쪽 차로 입구
  const cones = [], c = (x, y, side) => cones.push({ x, y, placed: false, side });
  for (let x = -12; x <= 12.01; x += 2.4) c(x, -0.3, 0);
  for (const y of [6.3, 5.3, 4.3]) c(-12, y, 3);
  for (let x = -9.6; x <= 9.61; x += 2.4) c(x, 6.3, 2);
  for (const y of [6.3, 5.3, 4.3]) c(12, y, 1);
  c(-11.5, 1.0, 4); c(-11.5, 2.6, 4);
  return {
    people: {
      A: person(-19, 5.0), B: person(-17.6, 4.5), C: person(-17.2, 5.5), D: person(-18.4, 6.0), E: person(-16.8, 5.0)
    },
    truck: { present: true, c: -30, y: G.laneY, moving: 0, outrig: 0, pads: false, chocks: [false, false, false, false], boom: { ...STOW }, hookDrop: 0, driver: null },
    cones, tape: false, board: { x: -20.2, y: 5.4, present: true },
    sw: { closed: true, tag: false }, tested: { gnd: false, work: false },
    ground: { earth: false, line: 0 }, covers: 0, insul: 'old',
    load: { x: 0, y: 0, z: 0, state: 'bed', kind: 'new' },     // bed(차량 적재함) · ground · hook · gone
    plan: false
  };
}
function person(x, y) { return { x, y, z: 0, face: 1, anim: 'idle', ppe: { helmet: false, vest: false, gloves: false, harness: false }, carry: null, say: null, sayT: 0, inBucket: false, inCab: false, hooked: false, stick: null, k: 0 }; }

function poleSteps() {
  const G = GEO, P = G.park, rear = P - G.truckLen / 2, front = P + G.truckLen / 2;
  const wheelF = P + 2.9, wheelR = P - 2.3;
  const ph = (i) => [G.gndX + 0.8, G.phaseY[i], G.armZ];
  const coneTasks = (who, sides, back) => (W) => {
    const list = W.cones.filter(c => sides.includes(c.side) && !c.placed);
    const out = [];
    for (const c of list) out.push(go(who, c.x + (c.side === 0 ? 0 : 0), c.y + (c.side === 0 ? 0.6 : c.side === 2 ? -0.6 : 0)), act(who, 'bend', 0.5, { end: () => { c.placed = true; } }));
    if (back) out.push(go(who, ...back));
    return out;
  };
  return [
    { id: 'tbm', rules: [3],
      title: L('작업 전 TBM · 작업계획서 확인', 'Pre-work TBM · check the work plan'),
      what: L('작업책임자가 작업계획서로 작업 내용·순서·정전 구간·위험요인을 설명하고 각자 역할을 확인합니다. 계획서에 없는 방법으로 바꾸지 않습니다.',
        'The supervisor walks the crew through the plan: task, sequence, outage section and hazards, then confirms each role. No method outside the plan.'),
      why: L('감전·추락·전도 사고 대부분은 "계획에 없던 즉흥 작업"에서 시작됩니다.', 'Most shock, fall and tip-over accidents begin with an improvised step that was not in the plan.'),
      lanes: [
        [say('A', L('오늘 작업: 0번 전주 애자·완금 교체, 정전 작업', "Today: replace insulators & crossarm on pole 0, de-energised"), 3),
          say('A', L('정전 구간: -70 개폐기 개방 → 검전 → -35 전주 접지', 'Outage: open switch at -70 → test → earth at pole -35'), 3.2),
          say('A', L('위험요인: 감전 · 추락 · 차량 전도 · 낙하물', 'Hazards: shock · falls · tip-over · falling objects'), 3),
          set(W => { W.plan = true; }), say('A', L('각자 역할 확인!', 'Confirm your roles!'), 1.8)],
        [act('B', 'read', 12.6)], [act('C', 'read', 12.6)], [act('D', 'read', 12.6)],
        [act('E', 'read', 11), say('E', L('확인!', 'Confirmed!'), 1.6)]
      ],
      wrong: [
        { text: L('시간이 없으니 TBM은 생략하고 바로 작업차를 진입시킨다', 'Skip the TBM to save time and bring the truck in'),
          why: L('작업자마다 정전 구간·역할을 다르게 알고 있으면 충전부 접촉 같은 치명적 실수로 이어집니다. (수칙 3)', 'If people hold different ideas of the outage section and roles, someone touches a live part. (Rule 3)') },
        { text: L('현장 상황이 다르니 작업 방법은 각자 판단해서 바꾼다', 'The site looks different, so each person adapts the method as they see fit'),
          why: L('공법 임의변경 금지. 현장이 계획과 다르면 작업을 멈추고 계획을 다시 세웁니다. (수칙 3)', 'No ad-hoc method changes. If the site differs from the plan, stop and re-plan. (Rule 3)') }
      ] },

    { id: 'ppe', rules: [1],
      title: L('개인 안전장구 착용', 'Put on personal protective equipment'),
      what: L('안전모(턱끈 체결)·절연장갑·안전화·반사조끼를 착용하고, 버킷 작업자는 그네식 안전대를 맵니다. 작업책임자가 서로의 착용 상태를 확인합니다.',
        'Hard hat with chin strap, insulating gloves, safety boots, hi-vis vest; the bucket worker puts on a full-body harness. The supervisor checks everyone.'),
      why: L('장구는 사고가 났을 때 생사를 가르는 마지막 방어선입니다.', 'PPE is the last line of defence when everything else has failed.'),
      lanes: ['A', 'B', 'C', 'D', 'E'].map(w => [act(w, 'dress', 2.4, { end: W => { Object.assign(W.people[w].ppe, { helmet: true, vest: true, gloves: true, harness: w === 'B' }); } })])
        .concat([[wait(2.6), say('A', L('턱끈·장갑·안전대 확인 완료', 'Chin straps, gloves, harness — checked'), 2.4)]]),
      wrong: [
        { text: L('지상 작업자는 높은 곳에 안 올라가니 안전모를 쓰지 않는다', 'Ground workers stay low, so they skip the hard hat'),
          why: L('지상 작업자는 위에서 떨어지는 공구·자재에 가장 많이 다칩니다. (수칙 1)', 'Ground workers are the ones hit by dropped tools and parts. (Rule 1)') },
        { text: L('정전 작업이니 절연장갑은 필요 없다', 'It is a dead-line job, so insulating gloves are unnecessary'),
          why: L('검전 전에는 충전 상태로 간주합니다. 역송전·오조작도 있습니다. (수칙 1, 8)', 'Treat it as live until tested; back-feed and wrong switching happen. (Rules 1, 8)') }
      ] },

    { id: 'zone', rules: [5],
      title: L('작업구역 설정 · 출입금지 · 보행 통로 확보', 'Set up the work zone · keep out · keep a walkway'),
      what: L('라바콘과 안전띠로 작업차·전주 주변을 막아 작업반경 출입을 금지합니다. 보도는 바깥쪽에 보행 통로를 남겨 시민이 작업구역에 들어오지 않게 합니다.',
        'Cones and tape close off the truck and pole area. A walkway stays open on the outer sidewalk so the public never enters the zone.'),
      why: L('붐 회전·낙하물 반경 안에 사람이 있으면 아무리 조심해도 사고가 납니다.', 'Anyone inside the boom-swing or drop radius will eventually be hit.'),
      lanes: [
        [{ w: 'E', dyn: coneTasks('E', [0], [-13, 4.6]) }],
        [{ w: 'D', dyn: coneTasks('D', [3, 2, 1], [11.8, 4.6]) }, set(W => { W.tape = true; })],
        [say('A', L('보행 통로 확보! 시민 통행 안내', 'Walkway open — guide the public'), 2.4)]
      ],
      wrong: [
        { text: L('작업이 금방 끝나니 라바콘 없이 시작한다', 'It will be quick — start without cones'),
          why: L('작업 시간과 상관없이 붐 회전·낙하 반경 안으로 사람·차량이 들어옵니다. (수칙 5)', 'Short or not, people and cars wander into the swing and drop radius. (Rule 5)') },
        { text: L('보도 전체를 막고 시민에게 차도로 돌아가라고 한다', 'Close the whole sidewalk and send pedestrians onto the road'),
          why: L('보행자를 차도로 내보내면 교통사고 위험이 생깁니다. 안전한 보행 통로를 남깁니다.', 'Sending pedestrians into traffic creates a new hazard. Keep a safe walkway.') }
      ] },

    { id: 'reverse', rules: [5],
      title: L('작업차 진입 · 후진 시 전담 유도자', 'Bring in the truck · dedicated guide when reversing'),
      what: L('운전원이 작업차를 전주 옆으로 몰고 와 후진으로 위치를 맞춥니다. 신호수(전담 유도자)는 운전석에서 보이는 차량 뒤쪽 옆에 서서 신호봉으로 유도하고, 운전원은 유도자가 보이지 않으면 즉시 멈춥니다.',
        'The driver brings the truck alongside the pole and reverses into position. The dedicated guide stands behind and to the side, visible from the cab, signalling with a baton; if the guide is out of sight the driver stops.'),
      why: L('후진 차량의 사각지대는 차량 뒤 수 m에 이릅니다. 끼임·충돌 사고의 대표 원인입니다.', 'A reversing truck has a blind zone several metres long — a top cause of crush and strike accidents.'),
      lanes: [
        [go('C', -26, 0.5), set(W => { W.people.C.inCab = true; W.truck.driver = 'C'; }),
          tween(9, (W, k) => { W.truck.moving = 1; W.truck.c = -30 + (10 + 30) * ease(k); }, { end: W => { W.truck.moving = 0; } }),
          until(W => dist2([W.people.E.x, W.people.E.y], G.guideSpot) < 0.3),
          tween(8, (W, k) => { W.truck.moving = -1; W.truck.c = 10 + (P - 10) * ease(k); }, { end: W => { W.truck.moving = 0; } }),
          set(W => { const c = W.people.C; c.inCab = false; c.x = front - 1; c.y = 0.4; W.truck.driver = null; })],
        [until(W => W.truck.c > 2), go('E', ...G.guideSpot), until(W => W.truck.c > 9.9), act('E', 'wave', 8.2, { say: L('오라이~ 천천히!', 'Back… slowly!') }),
          say('E', L('정지!', 'Stop!'), 1.2),
          go('E', -11.5, 0.4), act('E', 'bend', 0.5, { end: W => { W.cones.find(c => c.side === 4 && c.y < 2).placed = true; } }),
          go('E', -11.5, 3.2), act('E', 'bend', 0.5, { end: W => { W.cones.find(c => c.side === 4 && c.y > 2).placed = true; } }),
          go('E', -8, -1.2)],
        [go('A', -9, 4.6), act('A', 'watch', 16)]
      ],
      wrong: [
        { text: L('후사경과 후방카메라만 보고 혼자 후진한다', 'Reverse alone using mirrors and the rear camera'),
          why: L('카메라·거울에는 사각지대가 있습니다. 후진 시에는 반드시 전담 유도자를 배치합니다. (수칙 5)', 'Mirrors and cameras have blind spots. Reversing needs a dedicated guide. (Rule 5)') },
        { text: L('유도자가 차량 바로 뒤 가운데에 서서 신호한다', 'The guide stands directly behind the truck, in the middle'),
          why: L('차량 바로 뒤는 운전석에서 보이지 않는 끼임 위치입니다. 운전원이 볼 수 있는 옆쪽에 섭니다.', 'Dead centre behind is invisible from the cab and a crush point. Stand to the side, in view.') }
      ] },

    { id: 'chocks', rules: [2],
      title: L('고임목 4개 이상 설치', 'Place 4 or more wheel chocks'),
      what: L('주차 브레이크를 채운 뒤 앞·뒤 바퀴 양쪽에 고임목을 받쳐 차량이 밀리지 않게 합니다.', 'With the parking brake on, chock front and rear wheels on both sides so the truck cannot roll.'),
      why: L('붐을 올리면 무게중심이 바뀌어 경사가 거의 없는 도로에서도 차량이 밀릴 수 있습니다.', 'Raising the boom shifts the centre of gravity; even a gentle slope can make the truck creep.'),
      lanes: [
        [go('C', wheelF + 0.6, 0.2), act('C', 'bend', 0.8, { end: W => { W.truck.chocks[0] = true; } }),
          go('C', wheelR - 0.6, 0.2), act('C', 'bend', 0.8, { end: W => { W.truck.chocks[1] = true; } }),
          go('C', rear - 1.2, 0.2), go('C', rear - 1.2, 3.6), go('C', wheelR - 0.6, 3.6), act('C', 'bend', 0.8, { end: W => { W.truck.chocks[2] = true; } }),
          go('C', wheelF + 0.6, 3.6), act('C', 'bend', 0.8, { end: W => { W.truck.chocks[3] = true; } }),
          say('C', L('고임목 4개 설치 완료', '4 chocks in place'), 1.8)],
        [say('A', L('주차 브레이크 확인', 'Parking brake — check'), 2)]
      ],
      wrong: [
        { text: L('평지이니 고임목 없이 주차 브레이크만 채운다', 'The road is flat, so the parking brake is enough'),
          why: L('붐 하중으로 무게중심이 바뀌면 브레이크만으로는 밀림을 막지 못합니다. (수칙 2)', 'Boom loads shift the centre of gravity; the brake alone will not stop creep. (Rule 2)') },
        { text: L('뒷바퀴 한쪽에만 고임목 2개를 받친다', 'Put two chocks under one rear wheel only'),
          why: L('앞·뒤 양쪽 4개 이상을 받쳐야 어느 방향으로도 밀리지 않습니다. (수칙 2)', 'Four or more, front and rear on both sides, stop movement in any direction. (Rule 2)') }
      ] },

    { id: 'outrig', rules: [4],
      title: L('아웃트리거 전개 · 받침판 설치 (전도방지)', 'Deploy outriggers on pads (anti-tip)'),
      what: L('받침판을 깔고 아웃트리거를 끝까지 펼쳐 바퀴가 들릴 정도로 차체를 받칩니다. 수평계로 기울기를 확인합니다.',
        'Lay outrigger pads, extend the outriggers fully and take the weight off the wheels. Check the level gauge.'),
      why: L('아웃트리거를 덜 펴거나 연약지반에 그대로 내리면 붐이 기울 때 차량이 넘어갑니다.', 'Half-extended outriggers, or feet on soft ground, let the truck roll over when the boom leans out.'),
      lanes: [
        [go('C', P - 1.6, 0.2), act('C', 'bend', 1.0, { end: W => { W.truck.pads = true; } }), go('C', rear - 0.8, 0.2),
          act('C', 'work', 5, { say: L('아웃트리거 전개', 'Outriggers out'), fx: (W, k) => { W.truck.outrig = ease(k); } }),
          say('C', L('수평 확인 · 바퀴 들림 확인', 'Level OK · wheels unloaded'), 2)],
        [wait(1.2), act('A', 'watch', 5), say('A', L('지반 상태 양호', 'Ground is firm'), 1.8)]
      ],
      wrong: [
        { text: L('자리가 좁으니 아웃트리거를 반만 펴고 작업한다', 'Space is tight — extend the outriggers halfway'),
          why: L('반만 펴면 전도 한계가 크게 줄어듭니다. 공간이 없으면 작업 위치·방법을 다시 정합니다. (수칙 4)', 'Half extension slashes the tip limit. If there is no room, re-plan the position or method. (Rule 4)') },
        { text: L('받침판 없이 보도블록 위에 아웃트리거를 바로 내린다', 'Lower the outriggers straight onto paving blocks, no pads'),
          why: L('보도블록·맨홀 뚜껑·연약지반은 꺼질 수 있습니다. 받침판으로 하중을 분산합니다. (수칙 4)', 'Paving, covers and soft ground can sink. Pads spread the load. (Rule 4)') }
      ] },

    { id: 'switch', rules: [11],
      title: L('개폐기 개방 — 절연 조작봉 사용', 'Open the switch with an insulated hot stick'),
      what: L('작업책임자가 정전 구간 전원측 개폐기(-70 전주)를 절연장갑을 끼고 절연 조작봉으로 개방하고, "작업 중 조작금지" 표찰을 겁니다.',
        'The supervisor opens the source-side switch on pole -70 with insulating gloves and an insulated hot stick, then hangs a "Do not operate — work in progress" tag.'),
      why: L('맨손이나 아무 막대로 조작하면 아크·감전 위험이 있습니다. 표찰이 없으면 다른 사람이 다시 투입할 수 있습니다.', 'Bare hands or improvised poles risk arc and shock. Without a tag someone may close it again.'),
      lanes: [
        [go('A', -40, 4.4), go('A', G.swX + 0.4, 4.4),
          act('A', 'stick', 3, { stick: [G.swX, G.poleY - 0.45, G.swZ], say: L('개폐기 개방!', 'Switch open!'), end: W => { W.sw.closed = false; } }),
          act('A', 'work', 1.5, { say: L('조작금지 표찰 부착', 'Tag attached'), end: W => { W.sw.tag = true; } })],
        [go('D', -12.5, 4.5), go('D', G.gndX + 0.8, 4.5)]
      ],
      wrong: [
        { text: L('가까이 있는 일반 막대로 개폐기 손잡이를 당긴다', 'Pull the switch handle with any pole lying around'),
          why: L('적정 공구(절연 조작봉)가 아니면 감전·아크에 노출됩니다. (수칙 11 배전)', 'Without the proper insulated tool you are exposed to shock and arc. (Rule 11, distribution)') },
        { text: L('개폐기를 열지 않고 활선 상태로 바로 교체 작업을 한다', 'Skip the switching and replace parts live'),
          why: L('계획은 정전 작업입니다. 활선 작업으로 바꾸는 것은 공법 임의변경입니다. (수칙 3, 8)', 'The plan is dead-line work. Working live is an unauthorised method change. (Rules 3, 8)') }
      ] },

    { id: 'earth', rules: [8],
      title: L('검전 → 접지 (작업장소에서 1경간 이상 떨어진 곳)', 'Test, then earth (at least one span from the work)'),
      what: L('-35 전주에서 접지봉을 박고 접지선의 대지측을 먼저 연결합니다. 검전기로 세 상 모두 무전압을 확인한 뒤, 절연봉으로 접지 클램프를 선로 측에 겁니다.',
        'At pole -35: drive the earth rod and connect the earth end first. Prove all three phases dead with a voltage detector, then clamp the earth onto the line with an insulated stick.'),
      why: L('검전 없이 접지하면 충전 선로를 단락시킵니다. 접지는 오조작·역송전·유도전압이 와도 작업자를 지켜 줍니다.', 'Earthing a live line is a short circuit; test first. The earth protects you from wrong switching, back-feed and induced voltage.'),
      lanes: [
        [until(W => dist2([W.people.D.x, W.people.D.y], [G.gndX + 0.8, 4.5]) < 0.2 && !W.sw.closed),
          act('D', 'hammer', 2.2, { say: L('접지봉 · 대지측 먼저', 'Rod in — earth end first'), end: W => { W.ground.earth = true; } }),
          ...[0, 1, 2].map(i => act('D', 'stick', 1.6, { stick: ph(i), tool: 'detector', say: i === 2 ? L('3상 무전압 확인', 'All 3 phases dead') : null, end: i === 2 ? (W => { W.tested.gnd = true; }) : null })),
          ...[0, 1, 2].map(i => act('D', 'stick', 1.6, { stick: ph(i), tool: 'clamp', end: W => { W.ground.line = i + 1; } })),
          say('D', L('접지 완료', 'Earthed'), 1.6)],
        [until(W => W.sw.tag), go('A', -40, 4.4), go('A', -9, 4.6)]
      ],
      wrong: [
        { text: L('개폐기를 열었으니 검전 없이 바로 접지 클램프를 건다', 'The switch is open, so clamp the earth without testing'),
          why: L('다른 전원·오조작으로 살아 있을 수 있습니다. 검전 → 접지 순서는 바꿀 수 없습니다. (수칙 8)', 'Another source or wrong switching may keep it live. Test before earth, always. (Rule 8)') },
        { text: L('선로 측 클램프를 먼저 걸고 대지측을 나중에 연결한다', 'Clamp the line end first, connect the earth end later'),
          why: L('선로가 살아 있으면 접지선을 든 사람이 대지 역할을 합니다. 대지측을 먼저, 뗄 때는 선로 측을 먼저.', 'If the line is live, the person holding the lead becomes the earth path. Earth end first on, last off.') }
      ] },

    { id: 'harness', rules: [7],
      title: L('안전대 안전고리 체결 → 버킷 상승', 'Clip the harness lanyard → raise the bucket'),
      what: L('버킷 작업자가 버킷에 탑승해 안전대 고리를 버킷 지지점에 걸고, 작업책임자가 확인한 뒤에 붐을 올립니다. 버킷은 충전부와 거리를 둔 위치에 먼저 세웁니다.',
        'The bucket worker steps in and clips the lanyard to the bucket anchor; only after the supervisor checks does the boom go up — first to a spot well clear of the conductors.'),
      why: L('고리를 걸지 않은 안전대는 아무 소용이 없습니다. 버킷 흔들림·충격으로 튕겨 나가는 추락 사고가 납니다.', 'An unclipped harness does nothing. Jolts of the bucket throw people out.'),
      lanes: [
        [go('B', -9, 4.6), go('B', rear - 0.7, 0.4), act('B', 'climb', 1.6, { end: W => { const b = W.people.B; b.inBucket = true; } }),
          act('B', 'work', 1.4, { say: L('안전고리 체결', 'Lanyard clipped'), end: W => { W.people.B.hooked = true; } }),
          until(W => W.checkedHook),
          act('B', 'work', 6, { fx: (W, k) => { W.truck.boom = lerpJ(STOW, boomIK(W.truck, BUCKET.near), ease(k)); } })],
        [go('A', rear - 1.4, -0.6), until(W => W.people.B.hooked), say('A', L('고리 체결 확인 — 상승!', 'Hook checked — up!'), 2, { }), set(W => { W.checkedHook = true; })]
      ],
      wrong: [
        { text: L('버킷 안이니 안전고리는 위에 올라가서 건다', 'Clip the lanyard once the bucket is up'),
          why: L('붐이 움직이는 순간이 가장 흔들립니다. 탑승 즉시, 상승 전에 체결합니다. (수칙 7)', 'The bucket jolts most when the boom starts. Clip in on boarding, before lifting. (Rule 7)') },
        { text: L('허리에 차는 벨트식 안전대를 쓴다', 'Use a waist-belt type safety belt'),
          why: L('추락을 멈출 때 충격이 허리에 집중됩니다. 그네식(전신) 안전대를 씁니다. (수칙 7, 11)', 'Arresting a fall with a waist belt injures the spine. Use a full-body harness. (Rules 7, 11)') }
      ] },

    { id: 'test', rules: [8],
      title: L('작업 개소 검전', 'Test for voltage at the work point'),
      what: L('버킷 작업자가 작업 전주에서도 검전기로 세 상을 다시 확인합니다. 무전압이 확인되어야 작업 위치로 다가갑니다.',
        'At the work pole the bucket worker tests all three phases again. Only when they are proven dead does the bucket move in.'),
      why: L('접지 지점과 작업 지점 사이에 다른 회선·분기·역송전이 있을 수 있습니다.', 'Between the earth and the work point there may be another feed, a tap or back-feed.'),
      lanes: [
        [...[0, 1, 2].map(i => act('B', 'stick', 1.6, { stick: [G.workX - 0.6, G.phaseY[i], G.armZ], tool: 'detector', say: i === 2 ? L('작업개소 무전압 확인', 'Work point dead') : null, end: i === 2 ? (W => { W.tested.work = true; }) : null }))],
        [say('A', L('검전 결과 복창!', 'Read back the result!'), 2)]
      ],
      wrong: [
        { text: L('-35 전주에서 검전했으니 여기서는 생략한다', 'Already tested at pole -35, skip it here'),
          why: L('작업 위치에서 다시 확인해야 다른 전원이 없음을 알 수 있습니다. (수칙 8)', 'Only a test at the work point proves no other source reaches it. (Rule 8)') },
        { text: L('장갑 낀 손등으로 전선을 살짝 대 본다', 'Touch the conductor lightly with the back of a gloved hand'),
          why: L('사람은 검전기가 아닙니다. 반드시 정격 검전기를 쓰고, 쓰기 전에 검전기 자체를 점검합니다.', 'People are not voltage detectors. Use a rated detector and check the detector itself first.') }
      ] },

    { id: 'cover', rules: [8],
      title: L('충전부 방호 (살아 있는 저압선)', 'Cover live parts (the energised LV line)'),
      what: L('고압선은 정전되었지만 아래의 저압선은 다른 변압기(35 전주)에서 전기를 받아 살아 있습니다. 버킷을 내려 절연 방호관으로 저압선을 덮습니다.',
        'The HV line is dead, but the LV line below is fed from another transformer (pole 35) and stays live. Lower the bucket and cover it with insulating line hoses.'),
      why: L('정전 구간에도 저압선·다른 회선 같은 충전부가 남습니다. 몸이 닿을 수 있는 범위는 모두 방호합니다.', 'Even in an outage, LV or other circuits stay live. Cover everything you could touch.'),
      lanes: [
        [act('B', 'work', 3, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, BUCKET.near), boomIK(W.truck, BUCKET.cover), ease(k)); } }),
          act('B', 'reach', 4.5, { say: L('방호관 설치', 'Fitting line hoses'), fx: (W, k) => { W.covers = k; } }),
          act('B', 'work', 3.4, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, BUCKET.cover), boomIK(W.truck, BUCKET.work), ease(k)); } })],
        [say('A', L('저압선 살아 있음 — 방호 철저', 'LV is live — cover it fully'), 2.4)]
      ],
      wrong: [
        { text: L('정전 작업이니 저압선도 죽어 있다고 보고 바로 작업한다', 'It is an outage, so assume the LV is dead too and start'),
          why: L('저압선은 다른 변압기에서 전기를 받을 수 있습니다. 살아 있는 충전부는 방호합니다. (수칙 8)', 'LV can be fed from another transformer. Cover live parts. (Rule 8)') },
        { text: L('방호관 대신 몸을 피해서 조심히 작업한다', 'Skip the hoses and just be careful not to touch'),
          why: L('작업에 집중하면 몸의 위치를 놓칩니다. "조심"은 방호가 아닙니다. (수칙 8)', 'Focused on the task, you lose track of your body. Care is not cover. (Rule 8)') }
      ] },

    { id: 'lift', rules: [6],
      title: L('인양물 고정 · 하부 출입금지', 'Secure the load · nobody beneath it'),
      what: L('새 애자·완금을 버킷 지브 훅으로 올립니다. 훅 해지장치를 확인하고 유도 로프를 단 뒤, 지상 작업자는 낙하 반경 밖에서 로프만 잡습니다. 낡은 자재도 같은 방법으로 내립니다.',
        'The new insulators and crossarm go up on the jib hook. Check the hook latch and attach a tag line; the ground worker holds only the tag line, outside the drop radius. The old parts come down the same way.'),
      why: L('매단 자재는 언제든 떨어질 수 있다고 봅니다. 아래에 사람이 없으면 떨어져도 사고가 아닙니다.', 'Assume a hanging load can drop at any moment. If nobody is under it, a drop is not an injury.'),
      lanes: [
        [go('C', P - 0.6, 0.2), act('C', 'bend', 1, { end: W => { W.load.state = 'carried'; W.people.C.carry = 'load'; } }),
          go('C', P - 0.6, 3.4), until(W => W.truck.hookDrop >= 1),
          go('C', -0.6, 3.5), act('C', 'bend', 1, { end: W => { W.people.C.carry = null; W.load.state = 'hook'; } }),
          act('C', 'work', 1.6, { say: L('해지장치 · 유도 로프 확인', 'Latch & tag line — OK') }),
          go('C', -4.4, 1.0), set(W => { W.people.C.tagline = true; }), act('C', 'hold', 1),
          until(W => W.load.state === 'down'), go('C', -0.6, 3.5), act('C', 'bend', 1.2, { end: W => { W.load.state = 'carried'; W.people.C.carry = 'load'; W.people.C.tagline = false; } }),
          go('C', P - 0.6, 3.4), go('C', P - 0.6, 0.2), act('C', 'bend', 1, { end: W => { W.load.state = 'gone'; W.people.C.carry = null; } })],
        [tween(3, (W, k) => { W.truck.hookDrop = ease(k); }),
          until(W => W.people.C.tagline),
          say('A', L('인양물 하부 출입금지!', 'Clear the area under the load!'), 2),
          tween(5, (W, k) => { W.truck.hookDrop = 1 - ease(k); }),
          act('B', 'reach', 1.2, { end: W => { W.load.state = 'bucket'; } }),
          act('B', 'reach', 7, { say: L('애자·완금 교체', 'Replacing insulators & crossarm'), end: W => { W.insul = 'new'; W.load.kind = 'old'; W.load.state = 'hook'; } }),
          tween(5, (W, k) => { W.truck.hookDrop = ease(k); }, { end: W => { W.load.state = 'down'; } }),
          until(W => W.load.state === 'carried'), tween(3, (W, k) => { W.truck.hookDrop = 1 - ease(k); })]
      ],
      wrong: [
        { text: L('빨리 받으려고 지상 작업자가 인양물 바로 아래에서 기다린다', 'The ground worker waits right under the load to grab it'),
          why: L('훅·슬링이 풀리면 바로 아래 사람이 맞습니다. 유도 로프로 낙하 반경 밖에서 잡습니다. (수칙 6)', 'If the hook or sling lets go, whoever is underneath is hit. Use a tag line from outside the radius. (Rule 6)') },
        { text: L('해지장치가 고장 난 훅에 자재를 걸어 그대로 올린다', 'Lift on a hook whose safety latch is broken'),
          why: L('해지장치가 없으면 흔들릴 때 슬링이 빠집니다. 고정장치를 확인한 뒤 올립니다. (수칙 6)', 'Without a latch the sling can jump off when it swings. Check the securing device first. (Rule 6)') }
      ] },

    { id: 'finish', rules: [8, 5, 2, 4],
      title: L('작업 완료 · 역순 철수 (방호 → 접지 → 개폐기 투입)', 'Finish · tear down in reverse (cover → earth → switch)'),
      what: L('방호관 제거 → 버킷 하강·하차 → 접지 제거(선로 측 먼저, 대지측 나중) → 인원·공구 확인 후 개폐기 투입 → 아웃트리거·고임목·라바콘 회수 → 유도자 신호로 출발.',
        'Remove hoses → lower and leave the bucket → remove the earth (line end first, earth end last) → count people and tools, then close the switch → stow outriggers, chocks, cones → leave under the guide’s signal.'),
      why: L('송전 전 인원·접지 확인을 빠뜨리면 접지를 단 채 송전하거나 작업자가 남은 상태로 송전합니다.', 'Skip the count and you may re-energise with the earth on or a worker still on the line.'),
      lanes: [
        [act('B', 'work', 3, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, BUCKET.work), boomIK(W.truck, BUCKET.cover), ease(k)); } }),
          act('B', 'reach', 3, { say: L('방호관 제거', 'Hoses off'), fx: (W, k) => { W.covers = 1 - k; } }),
          act('B', 'work', 6, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, BUCKET.cover), STOW, ease(k)); }, end: W => { W.truck.boom = { ...STOW }; } }),
          act('B', 'work', 1, { end: W => { W.people.B.hooked = false; } }),
          act('B', 'climb', 1.4, { end: W => { const b = W.people.B; b.inBucket = false; b.x = rear - 0.8; b.y = 0.3; b.z = 0; } }),
          go('B', -9, 4.6), set(W => { W.bOff = true; })],
        [until(W => W.covers <= 0.01), go('D', -12.5, 4.5), go('D', G.gndX + 0.8, 4.5),
          ...[2, 1, 0].map(i => act('D', 'stick', 1.5, { stick: ph(i), tool: 'clamp', end: W => { W.ground.line = i; } })),
          act('D', 'work', 1.6, { say: L('선로 측 먼저, 대지측 나중', 'Line end first, earth end last'), end: W => { W.ground.earth = false; } }),
          go('D', -12.5, 4.5), go('D', -10, 4.6), set(W => { W.dBack = true; })],
        [until(W => W.bOff && W.ground.line === 0 && !W.ground.earth), say('A', L('인원·공구 확인 — 접지 제거 확인', 'People & tools counted — earth removed'), 2.4),
          go('A', -40, 4.4), go('A', G.swX + 0.4, 4.4),
          act('A', 'work', 1, { end: W => { W.sw.tag = false; } }),
          act('A', 'stick', 2.6, { stick: [G.swX, G.poleY - 0.45, G.swZ], say: L('개폐기 투입 — 송전', 'Switch closed — line live'), end: W => { W.sw.closed = true; } }),
          go('A', -40, 4.4), go('A', -14, 4.6)],
        [until(W => W.bOff), go('C', rear - 0.8, 0.2), act('C', 'work', 4, { say: L('아웃트리거 수납', 'Outriggers in'), fx: (W, k) => { W.truck.outrig = 1 - ease(k); }, end: W => { W.truck.pads = false; } }),
          go('C', wheelF + 0.6, 0.2), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[0] = false; } }),
          go('C', wheelR - 0.6, 0.2), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[1] = false; } }),
          go('C', rear - 1.2, 0.2), go('C', rear - 1.2, 3.6), go('C', wheelR - 0.6, 3.6), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[2] = false; } }),
          go('C', wheelF + 0.6, 3.6), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[3] = false; } }),
          until(W => W.sw.closed && W.dBack), go('C', front - 1, 0.4),
          set(W => { W.people.C.inCab = true; W.truck.driver = 'C'; }),
          until(W => W.conesDown),
          tween(8, (W, k) => { W.truck.moving = 1; W.truck.c = P + 60 * k * k; }, { end: W => { W.truck.moving = 0; W.truck.present = false; } })],
        [until(W => W.sw.closed && W.truck.outrig === 0 && W.truck.chocks.every(c => !c)), { w: 'E', dyn: W => {
          const out = [];
          for (const c of W.cones.filter(c => c.placed && c.side !== 0)) out.push(go('E', c.x, c.y + (c.side === 2 ? -0.6 : 0)), act('E', 'bend', 0.4, { end: () => { c.placed = false; } }));
          out.push(set(W2 => { W2.tape = false; }), go('E', 13, -1.0), say('E', L('출발 — 앞 차로 확인', 'Go — lane is clear'), 1.6));
          out.push(set(W2 => { W2.conesDown = true; }));
          for (const c of W.cones.filter(c => c.placed && c.side === 0).reverse()) out.push(go('E', c.x, c.y - 0.5), act('E', 'bend', 0.4, { end: () => { c.placed = false; } }));
          out.push(go('E', -12, -1));
          return out;
        } }]
      ],
      wrong: [
        { text: L('작업이 끝났으니 접지를 단 채로 먼저 개폐기를 투입한다', 'Work is done — close the switch first, remove the earth later'),
          why: L('접지를 단 채 송전하면 지락·아크 사고가 납니다. 접지 제거와 인원 확인 후에 송전합니다. (수칙 8)', 'Re-energising into an earth causes a fault and arc. Remove earths and count people first. (Rule 8)') },
        { text: L('붐을 올린 채로 아웃트리거부터 거둔다', 'Retract the outriggers while the boom is still up'),
          why: L('붐이 펼쳐진 상태에서 아웃트리거를 거두면 바로 전도됩니다. 붐 수납이 먼저입니다. (수칙 4)', 'Retracting with the boom out tips the truck immediately. Stow the boom first. (Rule 4)') }
      ] }
  ];
}

// ---- 시나리오: 지중 배전 맨홀 ---------------------------------------------------------------
const GAS_BAD = { o2: 17.2, h2s: 14, co: 22 }, GAS_GOOD = { o2: 20.9, h2s: 0, co: 2 };
export const GAS_LIMIT = { o2min: 18, o2max: 23.5, h2s: 10, co: 30 };   // 산업안전보건기준에 관한 규칙 제618조 '적정공기'
export const gasOK = (g) => g.o2 >= GAS_LIMIT.o2min && g.o2 < GAS_LIMIT.o2max && g.h2s < GAS_LIMIT.h2s && g.co < GAS_LIMIT.co;

function manholeWorld() {
  const G = GEO;
  const cones = conesAround(G.mhZone, 2.6);
  return {
    people: { A: person(-2, -5.2), B: person(-0.6, -5.6), C: person(0.6, -5.0), D: person(-1.4, -6.3), E: person(1.6, -5.9) },
    truck: { present: false, c: -60, y: G.laneY, moving: 0, outrig: 0, pads: false, chocks: [false, false, false, false], boom: { ...STOW }, hookDrop: 0 },
    van: { c: G.vanC, y: G.vanY },
    cones, tape: false, board: { x: -3.4, y: -5.0, present: true },
    sw: { closed: true, tag: false }, tested: { gnd: false, work: false }, ground: { earth: false, line: 0 }, covers: 0, insul: 'new',
    load: { x: 0, y: 0, z: 0, state: 'gone', kind: 'new' },
    mh: { lid: 'closed', guard: false, gas: { ...GAS_BAD }, measured: null, vent: false, tripod: false, permit: false, inside: false },
    plan: false
  };
}
function manholeSteps() {
  const G = GEO, [mx, my] = G.mh;
  const coneTasks = (who, sides, back) => (W) => {
    const out = [];
    for (const c of W.cones.filter(c => sides.includes(c.side) && !c.placed)) out.push(go(who, c.x, c.y + (c.side === 0 ? -0.5 : c.side === 2 ? 0.5 : 0)), act(who, 'bend', 0.45, { end: () => { c.placed = true; } }));
    if (back) out.push(go(who, ...back));
    return out;
  };
  const measure = (who, label) => act(who, 'probe', 3.2, { say: label, end: W => { W.mh.measured = { ...W.mh.gas, t: W.t }; } });
  return [
    { id: 'permit', rules: [9, 3],
      title: L('밀폐공간 작업허가서 · TBM', 'Confined-space permit · TBM'),
      what: L('맨홀은 밀폐공간입니다. 작업책임자가 작업허가서(측정·환기·감시인·구조장비·출입 인원)를 확인하고 TBM에서 비상 시 연락·구조 방법까지 정합니다.',
        'A manhole is a confined space. The supervisor checks the permit — testing, ventilation, attendant, rescue gear, entrants — and the TBM agrees how to call for help and rescue.'),
      why: L('밀폐공간 사고는 구하러 들어간 사람까지 쓰러지는 연쇄 사고가 많습니다. 허가 절차가 이를 막습니다.', 'Confined-space accidents often kill the would-be rescuers too. The permit procedure prevents that chain.'),
      lanes: [
        [say('A', L('작업: 맨홀 내 케이블 접속부 점검', 'Task: inspect cable joints in the manhole'), 2.8),
          say('A', L('허가서: 측정 → 환기 → 감시인 → 입조', 'Permit: test → ventilate → attendant → enter'), 3.2),
          say('A', L('비상 시 들어가지 말고 삼각대로 끌어올림', 'In an emergency: do not go in — winch out'), 3.2),
          set(W => { W.mh.permit = true; W.plan = true; })],
        [act('B', 'read', 9.2)], [act('C', 'read', 9.2)], [act('D', 'read', 9.2)], [act('E', 'read', 7.6), say('E', L('확인!', 'Confirmed!'), 1.6)]
      ],
      wrong: [
        { text: L('뚜껑만 열고 잠깐 들어갔다 나오니 허가서는 생략한다', 'It is a quick look inside — skip the permit'),
          why: L('짧은 출입에서도 산소결핍은 몇 번의 호흡만에 의식을 잃게 합니다. (수칙 9)', 'Even a brief entry: oxygen-poor air knocks you out within a few breaths. (Rule 9)') },
        { text: L('작업자가 쓰러지면 옆 사람이 바로 들어가 구한다', 'If the entrant collapses, the nearest person goes in to rescue'),
          why: L('준비 없이 들어간 구조자도 같은 공기에 쓰러집니다. 삼각대·윈치로 밖에서 구조합니다.', 'An unprepared rescuer breathes the same air and collapses too. Rescue from outside with the tripod winch.') }
      ] },

    { id: 'mppe', rules: [1],
      title: L('개인 안전장구 · 측정기 준비', 'PPE · gas detector ready'),
      what: L('안전모·반사조끼·장갑을 착용하고 입조자는 그네식 안전대를 맵니다. 가스 측정기는 교정 상태와 경보를 확인합니다.',
        'Hard hats, vests and gloves; the entrant wears a full-body harness. Check the gas detector is calibrated and its alarm works.'),
      why: L('측정기가 고장이면 "안전"이라는 잘못된 숫자를 믿게 됩니다.', 'A faulty detector gives a false "safe".'),
      lanes: ['A', 'B', 'C', 'D', 'E'].map(w => [act(w, 'dress', 2.4, { end: W => { Object.assign(W.people[w].ppe, { helmet: true, vest: true, gloves: true, harness: w === 'B' }); if (w === 'D') W.people.D.carry = 'detector'; } })])
        .concat([[wait(2.6), say('D', L('측정기 경보 시험 OK', 'Detector bump test OK'), 2.2)]]),
      wrong: [
        { text: L('측정기 점검은 생략하고 바로 쓴다', 'Use the detector straight away without checking it'),
          why: L('교정이 안 된 측정기는 산소 부족을 정상으로 표시할 수 있습니다. (수칙 9)', 'An uncalibrated detector can show oxygen-poor air as normal. (Rule 9)') },
        { text: L('입조자도 안전대 없이 사다리로만 오르내린다', 'The entrant uses only the ladder, no harness'),
          why: L('쓰러지면 밖에서 끌어올릴 방법이 없습니다. 안전대와 구명줄이 구조 수단입니다.', 'If they collapse there is no way to pull them out. Harness and lifeline are the rescue path.') }
      ] },

    { id: 'mzone', rules: [10],
      title: L('맨홀 작업반경 출입금지', 'Keep out of the manhole work radius'),
      what: L('작업 차량과 맨홀을 라바콘으로 둘러싸 차량·보행자가 들어오지 못하게 하고, 신호수가 접근 차량을 유도합니다.',
        'Cones surround the van and manhole so no vehicle or pedestrian enters; the signaller guides approaching traffic.'),
      why: L('열린 맨홀은 추락 위험이고, 차로 위 작업자는 차량에 치일 위험이 있습니다.', 'An open manhole is a fall hazard, and people on the carriageway can be struck by traffic.'),
      lanes: [
        [{ w: 'E', dyn: coneTasks('E', [3, 0], [-8, 1.6]) }, act('E', 'wave', 2)],
        [{ w: 'D', dyn: coneTasks('D', [1, 2], [8, -4.6]) }],
        [say('A', L('작업반경 출입금지 확인', 'Keep-out zone — checked'), 2.2)]
      ],
      wrong: [
        { text: L('맨홀 주변만 막고 작업 차량 주변은 그대로 둔다', 'Cone only the manhole, not the van'),
          why: L('작업자는 차량과 맨홀 사이를 계속 오갑니다. 작업반경 전체를 막습니다. (수칙 10)', 'People walk back and forth between van and manhole. Close the whole work radius. (Rule 10)') },
        { text: L('지나가는 차가 적으니 라바콘 없이 한다', 'Little traffic — work without cones'),
          why: L('드문 차량일수록 속도가 빠르고 운전자가 작업을 예상하지 못합니다. (수칙 10)', 'Sparse traffic is fast traffic, and drivers do not expect you. (Rule 10)') }
      ] },

    { id: 'lid', rules: [11],
      title: L('뚜껑 개방 (전용 공구) · 개구부 방호', 'Open the lid (proper tool) · guard the opening'),
      what: L('맨홀 뚜껑은 전용 개폐 공구로 두 사람이 엽니다. 연 즉시 개구부 주위에 안전 펜스를 세워 추락을 막습니다.',
        'Two people open the lid with a purpose-made lifter. A guard rail goes around the opening immediately to stop falls.'),
      why: L('무거운 뚜껑은 손·발 끼임과 허리 부상을, 열린 구멍은 추락을 부릅니다.', 'Heavy lids crush hands and feet and strain backs; open holes invite falls.'),
      lanes: [
        [go('B', mx - 1.1, my - 1.2), act('B', 'work', 3, { say: L('전용 공구로 개방', 'Opening with the lifter') })],
        [go('C', mx + 1.1, my - 1.2), until(W => dist2([W.people.B.x, W.people.B.y], [mx - 1.1, my - 1.2]) < 0.1), act('C', 'work', 3, { end: W => { W.mh.lid = 'open'; W.mh.guard = true; } }), say('C', L('개구부 펜스 설치', 'Guard rail up'), 1.8)]
      ],
      wrong: [
        { text: L('드라이버를 틈에 끼워 한 사람이 들어 올린다', 'Lever it up alone with a screwdriver'),
          why: L('뚜껑이 미끄러지면 손발이 끼입니다. 전용 공구와 2인 작업이 원칙입니다. (수칙 11)', 'If the lid slips it crushes hands and feet. Proper lifter, two people. (Rule 11)') },
        { text: L('뚜껑을 연 채 펜스 없이 다른 준비를 한다', 'Leave the hole unguarded while preparing other things'),
          why: L('개구부는 즉시 방호합니다. 작업자 자신도 뒷걸음질하다 떨어집니다. (수칙 11 토목)', 'Guard openings at once — workers step backwards into them too. (Rule 11, civil)') }
      ] },

    { id: 'gas1', rules: [9],
      title: L('산소·유해가스 측정 (들어가기 전)', 'Test oxygen and toxic gas (before entry)'),
      what: L('입구에서 측정기 호스를 내려 위·중간·바닥 세 높이에서 잽니다. 산소 18% 이상 23.5% 미만, 황화수소 10ppm 미만, 일산화탄소 30ppm 미만이어야 들어갈 수 있습니다.',
        'From the opening, lower the sampling hose and test at top, middle and bottom. Entry needs O₂ 18–23.5 %, H₂S under 10 ppm, CO under 30 ppm.'),
      why: L('밀폐공간의 공기는 눈으로 알 수 없습니다. 가스는 무겁거나 가벼워 높이마다 다릅니다.', 'You cannot see bad air, and gases layer by height.'),
      lanes: [
        [go('D', mx - 0.2, my - 1.4), measure('D', L('위 · 중간 · 바닥 측정', 'Top · middle · bottom')),
          say('D', L('산소 17.2% — 부족! 입조 금지', 'O₂ 17.2 % — too low! No entry'), 2.8)],
        [wait(3.4), say('A', L('들어가지 마! 환기부터', 'Nobody in! Ventilate first'), 2.6)]
      ],
      wrong: [
        { text: L('냄새가 안 나니 측정 없이 들어간다', 'It does not smell, so go in without testing'),
          why: L('산소결핍과 일산화탄소는 냄새가 없고, 황화수소는 고농도에서 후각을 마비시킵니다. (수칙 9)', 'Oxygen deficiency and CO are odourless; high H₂S paralyses the sense of smell. (Rule 9)') },
        { text: L('입구에서 한 번만 재고 괜찮으면 들어간다', 'Test once at the opening and go in if it reads fine'),
          why: L('가스는 층을 이룹니다. 바닥까지 여러 높이에서 잽니다. (수칙 9)', 'Gases layer. Test at several heights down to the floor. (Rule 9)') }
      ] },

    { id: 'vent', rules: [9],
      title: L('강제 환기 → 재측정', 'Force-ventilate → re-test'),
      what: L('송풍기로 신선한 공기를 바닥까지 불어 넣고, 다시 측정해 적정 공기를 확인합니다. 환기는 작업이 끝날 때까지 계속합니다. (화면은 시간을 줄여서 보여 줍니다)',
        'A blower pushes fresh air to the bottom; re-test to confirm safe air. Ventilation runs until the job is finished. (Time is compressed on screen.)'),
      why: L('측정이 한 번 좋아도 작업 중 가스가 다시 나올 수 있어 환기를 멈추지 않습니다.', 'Gas can build up again during work, so ventilation never stops.'),
      lanes: [
        [go('D', G.blower[0], G.blower[1] - 0.7), act('D', 'work', 2, { say: L('송풍기 가동', 'Blower on'), end: W => { W.mh.vent = true; } }),
          go('D', mx - 0.2, my - 1.4), wait(6), measure('D', L('재측정', 'Re-testing')),
          until(W => gasOK(W.mh.measured || GAS_BAD)), say('D', L('산소 20.9% · H₂S 0 · CO 2 — 적정', 'O₂ 20.9 % · H₂S 0 · CO 2 — safe'), 2.8)]
      ],
      wrong: [
        { text: L('뚜껑을 열어 두었으니 자연 환기로 충분하다', 'The lid is open — natural ventilation is enough'),
          why: L('깊은 맨홀은 자연 환기로 바닥 공기가 바뀌지 않습니다. 송풍기로 강제 환기합니다. (수칙 9)', 'Deep manholes do not clear naturally. Use a blower. (Rule 9)') },
        { text: L('환기 후 측정 없이 바로 들어간다', 'Ventilate, then go in without re-testing'),
          why: L('환기가 충분한지는 측정해야만 압니다. (수칙 9)', 'Only a test tells you the ventilation worked. (Rule 9)') }
      ] },

    { id: 'watch', rules: [9, 10],
      title: L('감시인 배치 · 구조장비(삼각대) 설치', 'Post an attendant · set up rescue tripod'),
      what: L('맨홀 위에 삼각대와 윈치를 세우고, 감시인은 입구에서 작업자와 계속 연락하며 자리를 떠나지 않습니다.',
        'A tripod and winch go over the opening; the attendant stays at the entrance in constant contact and never leaves.'),
      why: L('안에서 쓰러지면 감시인이 밖에서 바로 끌어올릴 수 있어야 합니다.', 'If the entrant collapses, the attendant must be able to winch them out from outside.'),
      lanes: [
        [go('B', mx + 1.2, my + 0.9), act('B', 'work', 4, { say: L('삼각대·윈치 설치', 'Tripod & winch up'), end: W => { W.mh.tripod = true; } })],
        [go('C', mx - 1.4, my - 1.0), act('C', 'work', 4), say('C', L('감시인 위치 — 이탈 금지', 'Attendant in place — not leaving'), 2.2)]
      ],
      wrong: [
        { text: L('감시인도 같이 들어가 작업을 돕는다', 'The attendant goes in to help'),
          why: L('밖에 남은 사람이 없으면 구조할 사람이 없습니다. 감시인은 밖에 있어야 합니다. (수칙 9)', 'With nobody outside, nobody can rescue. The attendant stays out. (Rule 9)') },
        { text: L('구조장비는 차에 실어 두고 필요할 때 꺼낸다', 'Keep the rescue gear in the van and fetch it if needed'),
          why: L('산소결핍은 몇 분 안에 생명을 잃게 합니다. 구조장비는 입조 전에 설치합니다.', 'Oxygen deficiency kills in minutes. Rig the rescue gear before anyone enters.') }
      ] },

    { id: 'enter', rules: [9, 7],
      title: L('입조: 구명줄 체결 · 연속 측정', 'Enter: lifeline clipped · continuous testing'),
      what: L('입조자는 안전대 고리를 삼각대 윈치 줄에 걸고 들어갑니다. 개인 가스 측정기를 차고, 밖에서도 계속 측정하며 감시인은 정해진 간격으로 상태를 확인합니다.',
        'The entrant clips the harness to the tripod winch line and goes down wearing a personal gas monitor; testing continues outside and the attendant checks in at set intervals.'),
      why: L('들어갈 때 안전했던 공기도 작업 중 바뀔 수 있습니다.', 'Air that was safe at entry can change during the job.'),
      lanes: [
        [go('B', mx + 0.2, my + 0.6), act('B', 'work', 1.4, { say: L('구명줄 체결', 'Lifeline clipped'), end: W => { W.people.B.hooked = true; } }),
          until(W => W.mhOK), act('B', 'climb', 3, { fx: (W, k) => { const b = W.people.B; b.x = mx; b.y = my; b.z = -2.4 * k; }, end: W => { W.mh.inside = true; } }),
          act('B', 'work', 8, { say: L('케이블 접속부 점검 중', 'Inspecting cable joints') })],
        [until(W => W.people.B.hooked), say('A', L('측정값·환기·감시인 확인 — 입조!', 'Gas, air, attendant — OK, enter!'), 2.4), set(W => { W.mhOK = true; }),
          until(W => W.mh.inside), wait(1.5), measure('D', L('연속 측정 — 적정', 'Continuous test — OK')), wait(1), measure('D', L('연속 측정 — 적정', 'Continuous test — OK'))],
        [until(W => W.mh.inside), say('C', L('괜찮아? — 이상 없음!', 'You OK? — All good!'), 2.4), wait(2.5), say('C', L('응답 확인', 'Reply received'), 2)]
      ],
      wrong: [
        { text: L('입조자 혼자 들어가고 밖의 인원은 다른 일을 한다', 'The entrant goes in alone and everyone else does other work'),
          why: L('밖에서 아무도 지켜보지 않으면 쓰러져도 알 수 없습니다. (수칙 9, 10)', 'With nobody watching, a collapse goes unnoticed. (Rules 9, 10)') },
        { text: L('송풍기 소음이 시끄러우니 입조 후 끈다', 'The blower is noisy — switch it off once inside'),
          why: L('환기는 작업이 끝날 때까지 계속합니다. (수칙 9)', 'Ventilation runs until the work is finished. (Rule 9)') }
      ] },

    { id: 'mfinish', rules: [9, 10],
      title: L('출조 · 뚜껑 복구 · 철수', 'Exit · close the lid · tear down'),
      what: L('입조자가 나온 것을 인원 확인한 뒤 구명줄을 풀고, 삼각대·펜스를 거두고 뚜껑을 닫습니다. 마지막으로 송풍기와 라바콘을 회수합니다.',
        'Confirm the entrant is out by headcount, unclip, remove tripod and guard, close the lid; finally collect the blower and cones.'),
      why: L('사람이 남았는지 확인하지 않고 뚜껑을 닫는 사고를 막기 위해 인원 확인을 먼저 합니다.', 'Headcount first — lids have been closed on people.'),
      lanes: [
        [act('B', 'climb', 3, { fx: (W, k) => { W.people.B.z = -2.4 * (1 - k); }, end: W => { W.mh.inside = false; W.people.B.z = 0; } }),
          act('B', 'work', 1, { end: W => { W.people.B.hooked = false; } }), go('B', mx + 1.2, my + 0.9),
          act('B', 'work', 2.6, { say: L('삼각대 해체', 'Tripod down'), end: W => { W.mh.tripod = false; } }), go('B', mx - 1.1, my - 1.2)],
        [until(W => !W.mh.inside), say('A', L('인원 확인 — 5명 모두 지상', 'Headcount — all 5 above ground'), 2.4),
          until(W => !W.mh.tripod), say('A', L('뚜껑 닫기', 'Close the lid'), 1.6)],
        [until(W => !W.mh.tripod), go('C', mx + 1.1, my - 1.2), act('C', 'work', 3, { end: W => { W.mh.lid = 'closed'; W.mh.guard = false; } }),
          go('D', G.blower[0], G.blower[1] - 0.7), act('D', 'work', 1.6, { say: L('송풍기 정지', 'Blower off'), end: W => { W.mh.vent = false; W.mh.measured = null; } }), set(W => { W.lidDone = true; })],
        [until(W => W.lidDone), { w: 'E', dyn: W => {
          const out = [];
          for (const c of W.cones.filter(c => c.placed)) out.push(go('E', c.x, c.y + (c.side === 0 ? -0.5 : c.side === 2 ? 0.5 : 0)), act('E', 'bend', 0.4, { end: () => { c.placed = false; } }));
          out.push(go('E', 1.6, -5.9));
          return out;
        } }]
      ],
      wrong: [
        { text: L('인원 확인 없이 뚜껑부터 닫는다', 'Close the lid before the headcount'),
          why: L('안에 사람이 남아 있을 수 있습니다. 인원 확인이 먼저입니다. (수칙 9)', 'Someone may still be inside. Headcount first. (Rule 9)') },
        { text: L('뚜껑을 닫기 전에 펜스와 라바콘부터 치운다', 'Remove the guard and cones before closing the lid'),
          why: L('열린 구멍이 방호 없이 남습니다. 뚜껑을 닫은 뒤에 펜스·라바콘을 거둡니다. (수칙 10, 11)', 'That leaves an open hole unguarded. Close the lid, then remove guards and cones. (Rules 10, 11)') }
      ] }
  ];
}

export const SCENARIOS = {
  pole: { title: L('가공 배전 애자·완금 교체 (정전 작업)', 'Overhead line: replace insulators & crossarm (de-energised)'), world: poleWorld, steps: poleSteps },
  manhole: { title: L('지중 배전 맨홀 작업 (밀폐공간)', 'Underground: manhole work (confined space)'), world: manholeWorld, steps: manholeSteps }
};

// ---- 보행자 ----------------------------------------------------------------------------
function makePeds(scenario) {
  const y = scenario === 'pole' ? GEO.pedY : GEO.pedYm;
  return [{ x: -40, y, dir: 1, sp: 1.25, k: 0 }, { x: 30, y: y + (scenario === 'pole' ? 0.3 : -0.4), dir: -1, sp: 1.05, k: 0.5 }];
}

// ---- 시뮬레이터 -------------------------------------------------------------------------
export class SafetySim {
  constructor(opts = {}) {
    this.scenario = opts.scenario || 'pole';
    const S = SCENARIOS[this.scenario];
    this.w = S.world();
    this.steps = S.steps();
    this.peds = makePeds(this.scenario);
    this.t = 0; this.dt = opts.dt || 0.05;
    this.stepIdx = -1; this.lanes = null; this.stepT = 0;
    this.violations = []; this.log = [];
    this.w.t = 0;
  }
  get step() { return this.steps[this.stepIdx] || null; }
  // 다음 단계 시작 (현재 단계가 끝났을 때만)
  begin(i = this.stepIdx + 1) {
    if (this.lanes && this.lanes.some(l => l.length)) return false;
    if (i >= this.steps.length) return false;
    this.stepIdx = i; this.stepT = 0;
    this.lanes = this.steps[i].lanes.map(l => l.map(x => ({ ...x, el: 0, started: false })));
    this.log.push({ t: this.t, step: this.steps[i].id });
    return true;
  }
  stepDone() { return !!this.lanes && this.lanes.every(l => l.length === 0); }
  done() { return this.stepIdx === this.steps.length - 1 && this.stepDone(); }

  update() {
    const dt = this.dt, W = this.w;
    this.t += dt; W.t = this.t; this.stepT += dt;
    for (const p of Object.values(W.people)) {
      if (p.sayT > 0) { p.sayT -= dt; if (p.sayT <= 0) p.say = null; }
    }
    if (this.lanes) {
      const busy = new Set();
      for (const lane of this.lanes) {
        let guard = 0;
        while (lane.length && guard++ < 50) {
          const task = lane[0];
          if (task.w && busy.has(task.w) && !task.started) break;   // 한 사람은 한 번에 한 가지만
          if (this.run(task, dt)) { lane.shift(); continue; }
          if (task.w) busy.add(task.w);
          break;
        }
      }
    }
    for (const p of Object.values(W.people)) if (!p._busy) { p.anim = 'idle'; p.stick = null; }
    if (W.people.B.inBucket) { const T = bucketPos(W.truck); Object.assign(W.people.B, { x: T[0], y: T[1], z: T[2] }); }
    for (const p of Object.values(W.people)) p._busy = false;
    this.movePeds(dt);
    this.check();
  }
  // 할 일 하나 진행. 끝나면 true
  run(task, dt) {
    const W = this.w;
    if (task.dyn) { const list = task.dyn(W).map(x => ({ ...x, el: 0, started: false })); const lane = this.lanes.find(l => l[0] === task); lane.splice(1, 0, ...list); return true; }
    if (task.set) { task.set(W); return true; }
    if (task.until) return !!task.until(W);
    if (task.wait !== undefined) { task.el += dt; return task.el >= task.wait; }
    const p = task.w ? W.people[task.w] : null;
    if (p) p._busy = true;
    if (!task.started) {
      task.started = true;
      if (p && task.say) { p.say = task.say; p.sayT = Math.max(task.dur || 2, 1.6); }
    }
    if (task.go) {
      const [tx, ty] = task.go, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), sp = 1.6 * dt;
      p.anim = 'walk'; p.k += dt * 2.4;
      if (Math.abs(dx) > 0.02) p.face = Math.sign(dx);
      if (d <= sp) { p.x = tx; p.y = ty; p.anim = 'idle'; return true; }
      p.x += dx / d * sp; p.y += dy / d * sp; return false;
    }
    task.el += dt;
    const k = Math.min(1, task.el / task.dur);
    if (task.tween) { task.fx(W, k); if (k >= 1) { task.end?.(W); return true; } return false; }
    // act
    p.anim = task.act; p.k += dt;
    p.stick = task.stick ? { to: task.stick, tool: task.tool || 'stick' } : null;
    task.fx?.(W, k);
    if (k >= 1) { task.end?.(W); p.stick = null; return true; }
    return false;
  }
  movePeds(dt) {
    for (const q of this.peds) {
      q.x += q.dir * q.sp * dt; q.k += dt * 2.2;
      if (q.x > 55) q.dir = -1; if (q.x < -55) q.dir = 1;
    }
  }

  // ---- 안전 규칙 (매 틱) ----
  check() {
    const W = this.w, G = GEO, v = (rule, msg) => {
      const last = this.violations[this.violations.length - 1];
      if (!last || last.msg !== msg || this.t - last.t > 1) this.violations.push({ t: this.t, rule, msg, step: this.step?.id });
    };
    if (this.scenario === 'pole') {
      const tr = W.truck, T = bucketPos(tr), up = T[2] > 4.2;
      if (up && !(tr.chocks.every(Boolean) && tr.outrig >= 1)) v(2, 'boom up without 4 chocks and full outriggers');
      if (up && !(W.people.B.inBucket && W.people.B.hooked)) v(7, 'boom up without hooked worker');
      if (tr.moving && W.people.B.inBucket) v(7, 'truck moving with a person in the bucket');
      if (tr.moving && tr.outrig > 0) v(4, 'truck moving with outriggers out');
      if (tr.moving === -1 && dist2([W.people.E.x, W.people.E.y], G.guideSpot) > 0.5) v(5, 'reversing without the guide in position');
      if (tr.moving && Object.entries(W.people).some(([k, p]) => !p.inCab && Math.abs(p.y - tr.y) < 1.7 && Math.abs(p.x - tr.c) < G.truckLen / 2 + 0.6)) v(5, 'person in the path of the moving truck');
      if (W.ground.line > 0 && !(W.ground.earth && W.tested.gnd && !W.sw.closed)) v(8, 'earth clamp without earth end / test / open switch');
      if (W.sw.closed && (W.ground.line > 0 || W.people.B.inBucket && up)) v(8, 'line energised with earth on or worker aloft');
      // 버킷 작업자 손이 고압선 1.2m 이내 → 검전·접지 끝났어야 함, 저압 방호 끝났어야 함
      if (W.people.B.inBucket) {
        const hand = [T[0] + Math.cos(tr.boom.slew) * 0.5, T[1] + Math.sin(tr.boom.slew) * 0.5, T[2] + 1.2];
        const nearHV = G.phaseY.some(y => Math.hypot(hand[1] - y, hand[2] - G.armZ) < 1.2 && Math.abs(hand[0] - G.workX) < 3);
        if (nearHV && !(W.tested.work && W.ground.line === 3 && !W.sw.closed)) v(8, 'hands near HV before test & earth');
        if (nearHV && W.covers < 1 && W.load.state !== 'down') { /* 방호 중 이동은 허용: 작업(교체)은 covers=1에서만 */ }
        if (W.insul === 'old' && W.load.state === 'bucket' && W.covers < 1) v(8, 'working without LV covers');
      }
      // 매달린 인양물 아래 사람 없음
      if (W.load.state === 'hook' && tr.hookDrop < 0.97) {
        const h = hookXY(tr);
        for (const [k, p] of Object.entries(W.people)) if (!p.inBucket && !p.inCab && Math.hypot(p.x - h[0], p.y - h[1]) < G.fallR) v(6, `person ${k} under suspended load`);
      }
    } else {
      const M = W.mh;
      if (M.lid === 'open' && !(M.guard && W.cones.every(c => c.placed))) v(10, 'open manhole without guard or full zone');
      if (M.inside || W.people.B.z < -0.05) {
        if (!(M.permit && gasOK(M.gas) && M.measured && gasOK(M.measured) && M.vent && M.tripod && W.people.B.hooked)) v(9, 'entry without permit, safe air, ventilation, tripod and lifeline');
        if (dist2([W.people.C.x, W.people.C.y], G.mh) > 2.5) v(9, 'attendant away from the manhole');
      }
      // 환기: 가스가 적정 공기로
      const g = M.gas, k = M.vent ? 1 - Math.exp(-this.dt / 2.5) : 0;
      if (k) for (const key of ['o2', 'h2s', 'co']) g[key] += (GAS_GOOD[key] - g[key]) * k;
    }
    for (const q of this.peds) if (inPoly([q.x, q.y], this.scenario === 'pole' ? G.zone : G.mhZone)) v(5, 'pedestrian inside work zone');
  }

  // 처음부터 i번째 단계 시작 직전까지 빠르게 진행
  static jumpTo(opts, i) {
    const s = new SafetySim(opts);
    for (let k = 0; k < i; k++) { s.begin(k); let n = 0; while (!s.stepDone() && n++ < 40000) s.update(); }
    return s;
  }
}

// ---- 훈련 모드: 보기 3개 (정답 1) ---------------------------------------------------------
export function quizOptions(sim, i, rand = Math.random) {
  const st = sim.steps[i];
  const opts = [{ text: st.title, correct: true }, ...st.wrong.map(w => ({ text: w.text, correct: false, why: w.why }))];
  for (let k = opts.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [opts[k], opts[j]] = [opts[j], opts[k]]; }
  return opts;
}
