// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 — 시나리오: 가공 배전선로 전선 교체 (한 경간, 정전 작업) (safety.js 가 이 파일들을 묶어 내보낸다)
//
// 0번 전주 ↔ 35번 전주 한 경간(35 m)의 고압 3상 전선을 정전 상태에서 새 전선으로 바꾼다.
// 방식: 구전선을 활차(풀리)에 올리고, 구전선 끝에 신전선을 물려 반대쪽 윈치로 끌어당기며 바꾼다 → 이도(처짐)를 맞춘 뒤 결속.
// 작업차는 두 대: 1호차(0번 전주 쪽) · 2호차(35번 전주 쪽), 버킷 작업자도 두 명(B · F).
// 교육용으로 3상을 한 번에 작업하는 것으로 줄였다. 실제로는 한 상씩 같은 절차를 반복한다.
import { GEO, BUCKET, STOW, boomIK, lerpJ, L, dist2, ease, go, act, say, tween, until, set, wait } from './core.js?v=96dbb605';
import { poleWorld, person, poleSteps } from './scn-pole.js?v=36fdb56d';

const G = GEO;
export const WIRE = {
  x0: 0, x1: 35, span: 35,
  P1: 0.5, P2: 35.5,                                            // 1 · 2호차 정차 위치 (차체 중심 x)
  zone: [[-12, -0.3], [47, -0.3], [47, 6.3], [-12, 6.3]],       // 출입금지 구역 (한 경간 전체 아래 + 양쪽 작업차)
  drum: [-6.5, 4.4], winch: [40.5, 4.4],                        // 신전선 드럼 스탠드 · 윈치(견인기)
  tol: 0.05,                                                    // 이도 허용 오차 (m)
  sagTaut: 0.15, sagOld: 0.55
};
// 목표 이도: 기준 15 ℃에서 0.50 m, 온도가 오르면 전선이 늘어 처진다.  L = S + 8D²/3S 에서 dD = 3S²α·dT / 16D
export function targetSag(tempC, span = WIRE.span) {
  const D0 = 0.5, T0 = 15, alpha = 19e-6;
  return D0 + 3 * span * span * alpha / (16 * D0) * (tempC - T0);
}
// 전선의 높이: 양끝 전주 완금 높이에서 포물선으로 처진다
export const wireZ = (u, sag) => G.armZ + 0.26 - sag * 4 * u * (1 - u);

const bk = (key, px = 0) => BUCKET[key].map((v, i) => (i === 0 ? v + px : v));
const ph = (px, i, dx = -0.6) => [px + dx, G.phaseY[i], G.armZ];

export function wireWorld() {
  const w = poleWorld();
  const cones = [], c = (x, y, side) => cones.push({ x, y, placed: false, side });
  for (let x = -12; x <= 44.01; x += 6) c(x, -0.3, 0);
  for (const y of [6.3, 5.3, 4.3]) c(-12, y, 3);
  for (let x = -8; x <= 43.01; x += 6) c(x, 6.3, 2);
  for (const y of [6.3, 5.3, 4.3]) c(47, y, 1);
  c(-11.5, 1.0, 4); c(-11.5, 2.6, 4);
  w.cones = cones;
  w.zone = WIRE.zone;
  w.people.F = person(-17.9, 4.2); w.people.F.rig = 2;
  w.truck.c = -30;
  w.truck2 = { present: true, c: -12, y: G.laneY, moving: 0, outrig: 0, pads: false, chocks: [false, false, false, false], boom: { ...STOW }, hookDrop: 0, driver: null };
  w.tested = { gnd: false, w0: false, w1: false };
  w.wg = [false, false];                                         // 작업구간 양단 접지 (0번 · 35번 전주)
  w.tempC = 22;
  w.wr = {
    pulley: [false, false], oldTied: true, linked: false, drum: false, winch: false,
    pull: 0, pulling: false, tension: 0,
    sag: WIRE.sagOld, target: targetSag(22), tol: WIRE.tol, manual: false, locked: false,
    newTied: false, jumper: false
  };
  return w;
}

// ---- 되풀이되는 작업 ---------------------------------------------------------------------
const rearOf = (P) => P - G.truckLen / 2;
// 고임목 4개: 담당자 who, 차량 key(truck | truck2), 정차 위치 P
const chockLane = (who, key, P, on = true) => {
  const wf = P + 2.9, wr = P - 2.3, rear = rearOf(P), v = on ? 1 : 0;
  const mark = (i) => ({ end: W => { W[key].chocks[i] = !!v; } });
  const dur = on ? 0.8 : 0.6;
  return [go(who, wf + 0.6, 0.2), act(who, 'bend', dur, mark(0)), go(who, wr - 0.6, 0.2), act(who, 'bend', dur, mark(1)),
    go(who, rear - 1.2, 0.2), go(who, rear - 1.2, 3.6), go(who, wr - 0.6, 3.6), act(who, 'bend', dur, mark(2)),
    go(who, wf + 0.6, 3.6), act(who, 'bend', dur, mark(3))];
};
const outrigLane = (who, key, P, out = true) => [go(who, P - 1.6, 0.2),
  ...(out ? [act(who, 'bend', 1.0, { end: W => { W[key].pads = true; } })] : []), go(who, rearOf(P) - 0.8, 0.2),
  act(who, 'work', out ? 5 : 4, { say: out ? L('아웃트리거 전개', 'Outriggers out') : L('아웃트리거 수납', 'Outriggers in'),
    fx: (W, k) => { W[key].outrig = out ? ease(k) : 1 - ease(k); }, end: out ? null : (W => { W[key].pads = false; }) })];
// 버킷에 타고 안전고리를 걸고 올라가는 줄
const boardLane = (who, key, P, px, check) => [go(who, rearOf(P) - 0.7, 0.4),
  act(who, 'climb', 1.6, { end: W => { W.people[who].inBucket = true; } }),
  act(who, 'work', 1.4, { say: L('안전고리 체결', 'Lanyard clipped'), end: W => { W.people[who].hooked = true; } }),
  until(W => W[check]),
  act(who, 'work', 6, { fx: (W, k) => { W[key].boom = lerpJ(STOW, boomIK(W[key], bk('near', px)), ease(k)); } })];
const moveBoom = (who, key, from, to, px, dur = 3) => act(who, 'work', dur, { fx: (W, k) => { W[key].boom = lerpJ(boomIK(W[key], bk(from, px)), boomIK(W[key], bk(to, px)), ease(k)); } });
const coneTasks = (who, sides, back) => (W) => {
  const out = [];
  for (const c of W.cones.filter(c => sides.includes(c.side) && !c.placed)) out.push(go(who, c.x, c.y + (c.side === 0 ? 0.6 : c.side === 2 ? -0.6 : 0)), act(who, 'bend', 0.5, { end: () => { c.placed = true; } }));
  if (back) out.push(go(who, ...back));
  return out;
};
// 세 상을 차례로: 검전기 · 접지 클램프 · 작업
const threePhases = (who, px, tool, last, key) => [0, 1, 2].map(i => act(who, 'stick', 1.5, { stick: ph(px, i), tool, say: i === 2 && last ? last : null, end: i === 2 ? key : null }));

export function wireSteps() {
  const pole = poleSteps(), byId = (id) => pole.find(s => s.id === id);
  const X0 = WIRE.x0, X1 = WIRE.x1, P1 = WIRE.P1, P2 = WIRE.P2;
  // 안전장구: 기존 단계에 버킷 작업자 F 한 사람을 더 입힘
  const ppeBase = byId('ppe');
  const ppe = { ...ppeBase, lanes: [...ppeBase.lanes, [act('F', 'dress', 2.4, { end: W => { Object.assign(W.people.F.ppe, { helmet: true, vest: true, gloves: true, harness: true }); } })]] };
  const sw = byId('switch');

  return [
    { id: 'tbm', rules: [3],
      title: L('작업 전 TBM · 작업계획서 확인 (구간, 전선 규격, 이도 기준표)', 'Pre-work TBM · check the plan (section, conductor, sag table)'),
      what: L('작업책임자가 작업계획서로 작업 구간(0번 ↔ 35번 전주 한 경간), 교체할 전선 규격, 정전 구간, 현재 기온에 맞는 목표 이도, 각자 역할을 설명합니다. 계획서에 없는 방법으로 바꾸지 않습니다.',
        'The supervisor walks the crew through the plan: the span (pole 0 to pole 35), the new conductor, the outage section, the target sag for today\'s temperature and each role. No method outside the plan.'),
      why: L('전선 교체는 장비·인원이 양쪽 전주와 지상에 흩어져 하는 작업이라, 신호와 역할이 어긋나면 한 사람의 실수가 곧바로 사고가 됩니다.', 'Wire replacement spreads people and machines over two poles and the ground; a mismatch in signals or roles turns one slip into an accident.'),
      lanes: [
        [say('A', L('오늘 작업: 0 ↔ 35번 전주 한 경간 전선 교체, 정전 작업', 'Today: replace one span, pole 0 to 35, de-energised'), 3.2),
          say('A', L('방식: 구전선에 신전선을 물려 윈치로 견인', 'Method: pull the new wire in behind the old one with the winch'), 3.2),
          say('A', L('목표 이도는 기온에 맞춰 계획서 기준표대로', 'Target sag from the plan table for today\'s temperature'), 3.2),
          set(W => { W.plan = true; }), say('A', L('각자 역할 확인!', 'Confirm your roles!'), 1.8)],
        [act('B', 'read', 13.4)], [act('C', 'read', 13.4)], [act('D', 'read', 13.4)], [act('F', 'read', 13.4)],
        [act('E', 'read', 11.5), say('E', L('확인!', 'Confirmed!'), 1.6)]
      ],
      wrong: [
        { text: L('경험이 많으니 계획서 없이 평소 하던 순서대로 시작한다', 'We are experienced — start in the usual order without the plan'),
          why: L('작업 구간과 정전 범위, 목표 이도를 모두가 같게 알고 있어야 합니다. 경험은 TBM을 생략할 이유가 아닙니다. (수칙 3)', 'Everyone must hold the same idea of the span, outage and target sag. Experience is no reason to skip the TBM. (Rule 3)') },
        { text: L('이도는 현장에서 눈대중으로 맞추기로 하고 기준표는 보지 않는다', 'Judge the sag by eye on site; skip the table'),
          why: L('이도는 기온에 따라 달라지는 시공 품질 기준입니다. 계획서의 기준표로 맞춥니다. (수칙 3)', 'Sag is a quality limit that changes with temperature. Use the table in the plan. (Rule 3)') }
      ] },

    ppe,

    { id: 'zone', rules: [5],
      title: L('작업구역 설정 · 한 경간 아래 출입금지 · 보행 통로 확보', 'Set up the work zone · keep out under the span · keep a walkway'),
      what: L('전선을 끌어당기는 동안 전선이 처지거나 튈 수 있는 한 경간 전체와 양쪽 작업차 주변을 라바콘과 안전띠로 막습니다. 보도 바깥쪽에 보행 통로를 남겨 시민이 작업구역에 들어오지 않게 합니다.',
        'Cones and tape close off the whole span, where wire may sag or whip while it is pulled, and the area around both trucks. A walkway stays open on the outer sidewalk.'),
      why: L('당기는 전선은 갑자기 걸리거나 끊어지면 반동으로 튑니다. 구간 아래에 사람이 있으면 피할 수 없습니다.', 'A wire under tension that snags or breaks whips back. Anyone under the span cannot get out of the way.'),
      lanes: [
        [{ w: 'E', dyn: coneTasks('E', [0], [-13, 4.6]) }],
        [{ w: 'D', dyn: coneTasks('D', [3, 2, 1], [-9, 4.6]) }, set(W => { W.tape = true; })],
        [say('A', L('한 경간 전체가 출입금지! 보행 통로 확보', 'The whole span is keep-out! Walkway open'), 2.6)]
      ],
      wrong: [
        { text: L('전주 두 곳 주변만 막고 경간 가운데는 열어 둔다', 'Block only around the two poles and leave mid-span open'),
          why: L('전선이 처지고 튀는 곳은 전주 주변이 아니라 한 경간 전체입니다. (수칙 5)', 'The wire sags and whips along the whole span, not just at the poles. (Rule 5)') },
        { text: L('시민이 많이 다니니 견인은 퇴근 시간 뒤로 미루고 구역은 느슨하게 둔다', 'The sidewalk is busy — keep the zone loose and pull later'),
          why: L('통행량 때문에 구역을 느슨하게 두면 안 됩니다. 구역은 그대로 막고 보행 통로를 안전하게 따로 둡니다. (수칙 5)', 'Heavy foot traffic is no reason for a loose zone. Close it properly and keep a separate safe walkway. (Rule 5)') }
      ] },

    { id: 'trucks', rules: [5],
      title: L('작업차 두 대 진입 · 후진은 전담 유도자', 'Bring in both trucks · dedicated guide when reversing'),
      what: L('2호차가 먼저 35번 전주까지 전진해 정차하고, 1호차가 이어서 0번 전주 옆으로 와 후진으로 자리를 맞춥니다. 신호수(전담 유도자)는 운전석에서 보이는 옆쪽에 서서 신호봉으로 유도합니다.',
        'Truck 2 drives ahead to pole 35 and stops; truck 1 follows and reverses into place at pole 0. The dedicated guide stands to the side, in the driver\'s view, with a baton.'),
      why: L('작업차가 두 대면 차량끼리, 차량과 사람 사이의 사각지대가 둘이 됩니다. 후진은 반드시 유도자 신호에 따릅니다.', 'Two trucks mean two sets of blind spots. Reversing always follows the guide\'s signal.'),
      lanes: [
        [go('D', -6.4, 0.4), set(W => { W.people.D.inCab = true; W.truck2.driver = 'D'; }),
          tween(14, (W, k) => { W.truck2.moving = 1; W.truck2.c = -12 + (P2 + 12) * ease(k); }, { end: W => { W.truck2.moving = 0; } }),
          set(W => { const d = W.people.D; d.inCab = false; d.x = P2 + 4.6; d.y = 0.5; W.truck2.driver = null; })],
        [until(W => W.truck2.c > 6), go('C', -26, 0.5), set(W => { W.people.C.inCab = true; W.truck.driver = 'C'; }),
          tween(9, (W, k) => { W.truck.moving = 1; W.truck.c = -30 + 40 * ease(k); }, { end: W => { W.truck.moving = 0; } }),
          until(W => dist2([W.people.E.x, W.people.E.y], G.guideSpot) < 0.3),
          tween(8, (W, k) => { W.truck.moving = -1; W.truck.c = 10 + (P1 - 10) * ease(k); }, { end: W => { W.truck.moving = 0; } }),
          set(W => { const c = W.people.C; c.inCab = false; c.x = P1 + G.truckLen / 2 - 1; c.y = 0.4; W.truck.driver = null; })],
        [until(W => W.truck.c > 2), go('E', ...G.guideSpot), until(W => W.truck.c > 9.9), act('E', 'wave', 8.2, { say: L('오라이~ 천천히!', 'Back… slowly!') }),
          say('E', L('정지!', 'Stop!'), 1.2),
          go('E', -11.5, 0.4), act('E', 'bend', 0.5, { end: W => { W.cones.find(c => c.side === 4 && c.y < 2).placed = true; } }),
          go('E', -11.5, 3.2), act('E', 'bend', 0.5, { end: W => { W.cones.find(c => c.side === 4 && c.y > 2).placed = true; } }),
          go('E', -8, -1.2)],
        [go('A', -9, 4.6), act('A', 'watch', 16)]
      ],
      wrong: [
        { text: L('두 대 모두 운전원이 후사경만 보고 각자 알아서 자리를 잡는다', 'Both drivers set up on their own, using mirrors only'),
          why: L('후진에는 전담 유도자가 있어야 하고, 두 대가 같은 차로를 쓰면 순서도 정해야 합니다. (수칙 5)', 'Reversing needs a dedicated guide, and two trucks in one lane need an agreed order. (Rule 5)') },
        { text: L('유도자가 두 차 사이에 서서 양쪽 차를 한꺼번에 유도한다', 'The guide stands between the trucks and signals both at once'),
          why: L('차 사이는 끼임 위치입니다. 차마다 운전원이 볼 수 있는 옆쪽에 서서 한 대씩 유도합니다. (수칙 5)', 'Between two trucks is a crush point. Guide one truck at a time from a visible spot at its side. (Rule 5)') }
      ] },

    { id: 'chocks', rules: [2],
      title: L('두 작업차 모두 고임목 4개 이상 설치', 'Chock both trucks (4 or more each)'),
      what: L('1호차와 2호차 각각 주차 브레이크를 채우고 앞·뒤 바퀴 양쪽에 고임목을 받쳐 차량이 밀리지 않게 합니다.', 'On each truck, set the parking brake and chock front and rear wheels on both sides.'),
      why: L('붐을 올리면 무게중심이 바뀌어 평지에서도 차량이 밀릴 수 있습니다. 두 번째 차도 똑같이 합니다.', 'Raising the boom shifts the centre of gravity, even on flat ground. The second truck is no exception.'),
      lanes: [[...chockLane('C', 'truck', P1), say('C', L('1호차 고임목 완료', 'Truck 1 chocked'), 1.6)],
        [...chockLane('D', 'truck2', P2), say('D', L('2호차 고임목 완료', 'Truck 2 chocked'), 1.6)],
        [say('A', L('주차 브레이크 두 대 모두 확인', 'Parking brakes — both trucks checked'), 2.4)],
        [go('B', rearOf(P1) - 2.6, 3.9)], [go('F', rearOf(P2) - 2.6, 3.9)]],
      wrong: [
        { text: L('1호차만 고임목을 받치고 2호차는 같은 도로라 생략한다', 'Chock truck 1 only; truck 2 is on the same road'),
          why: L('차량마다 붐 하중이 따로 걸립니다. 작업차 한 대마다 4개 이상입니다. (수칙 2)', 'Each truck carries its own boom load. Every truck needs 4 or more. (Rule 2)') },
        { text: L('시간이 없으니 고임목은 버킷을 올린 뒤에 받친다', 'No time — chock after the bucket is up'),
          why: L('붐이 움직이기 시작하면 가장 많이 밀립니다. 올리기 전에 받칩니다. (수칙 2)', 'The truck creeps most as the boom starts to move. Chock before lifting. (Rule 2)') }
      ] },

    { id: 'outrig', rules: [4],
      title: L('두 작업차 아웃트리거 전개 · 받침판 설치 (전도방지)', 'Deploy outriggers on pads, both trucks (anti-tip)'),
      what: L('받침판을 깔고 아웃트리거를 끝까지 펼쳐 차체를 받칩니다. 수평계로 기울기를 확인합니다. 두 대 모두 같은 방법입니다.', 'Lay pads, extend the outriggers fully and check the level gauge. Both trucks the same way.'),
      why: L('아웃트리거가 덜 펴지거나 받침판이 없으면 붐이 기울 때 차량이 넘어갑니다. 전선 장력이 걸리면 더 위험합니다.', 'Half-extended outriggers or no pads let the truck roll over when the boom leans; wire tension makes it worse.'),
      lanes: [[...outrigLane('C', 'truck', P1), say('C', L('1호차 수평 확인', 'Truck 1 level'), 1.6)],
        [...outrigLane('D', 'truck2', P2), say('D', L('2호차 수평 확인', 'Truck 2 level'), 1.6)],
        [wait(1.2), act('A', 'watch', 5), say('A', L('지반 상태 양호', 'Ground is firm'), 1.8)]],
      wrong: [
        { text: L('2호차 자리가 좁으니 아웃트리거를 반만 펴고 작업한다', 'Truck 2 has little room — extend halfway'),
          why: L('반만 펴면 전도 한계가 크게 줄어듭니다. 자리가 없으면 위치·방법을 다시 정합니다. (수칙 4)', 'Half extension slashes the tip limit. If there is no room, re-plan the position. (Rule 4)') },
        { text: L('받침판 없이 보도블록 위에 바로 내린다', 'Set the feet straight on paving, no pads'),
          why: L('보도블록·맨홀 뚜껑·연약지반은 꺼질 수 있습니다. 받침판으로 하중을 분산합니다. (수칙 4)', 'Paving, covers and soft ground can sink. Pads spread the load. (Rule 4)') }
      ] },

    { ...sw, lanes: sw.lanes.map(l => l.map(x => x)) },

    { id: 'earth', rules: [8],
      title: L('원방 검전 → 접지 (작업 구간에서 한 경간 이상 떨어진 -35 전주)', 'Test, then earth at pole -35 (a span clear of the work)'),
      what: L('-35 전주에서 접지봉을 박고 접지선의 대지측을 먼저 연결합니다. 검전기로 세 상 모두 무전압을 확인한 뒤 접지 클램프를 선로 측에 겁니다.',
        'At pole -35: drive the earth rod, connect the earth end first, prove all three phases dead with a detector, then clamp the line end.'),
      why: L('검전 없이 접지하면 충전 선로를 단락시킵니다. 오조작·역송전이 와도 접지가 작업자를 지켜 줍니다.', 'Earthing a live line is a short circuit. The earth protects you if wrong switching or back-feed comes later.'),
      lanes: [
        [go('D', -12.5, 4.5), go('D', G.gndX + 0.8, 4.5), until(W => !W.sw.closed),
          act('D', 'hammer', 2.2, { say: L('접지봉 · 대지측 먼저', 'Rod in — earth end first'), end: W => { W.ground.earth = true; } }),
          ...threePhases('D', G.gndX + 1.4, 'detector', L('3상 무전압 확인', 'All 3 phases dead'), W => { W.tested.gnd = true; }),
          ...[0, 1, 2].map(i => act('D', 'stick', 1.6, { stick: ph(G.gndX + 1.4, i), tool: 'clamp', end: W => { W.ground.line = i + 1; } })),
          say('D', L('접지 완료', 'Earthed'), 1.6), go('D', -12.5, 4.5), go('D', rearOf(P2) - 1.4, -0.6)],
        [until(W => W.sw.tag), go('A', -40, 4.4), go('A', -9, 4.6)]
      ],
      wrong: [
        { text: L('개폐기를 열었으니 검전 없이 바로 접지 클램프를 건다', 'The switch is open, so clamp the earth without testing'),
          why: L('다른 전원·오조작으로 살아 있을 수 있습니다. 검전 → 접지 순서는 바꿀 수 없습니다. (수칙 8)', 'Another source or wrong switching may keep it live. Test before earth, always. (Rule 8)') },
        { text: L('작업 구간 양단은 어차피 가까우니 -35 접지만으로 충분하다고 본다', '-35 is enough; the span ends are close anyway'),
          why: L('원방 접지와 별개로 작업 구간 양단에서도 검전하고 접지합니다. 이어지는 다음 단계들이 그것입니다. (수칙 8)', 'Besides this remote earth, test and earth at both span ends too, which the next steps do. (Rule 8)') }
      ] },

    { id: 'harness', rules: [7],
      title: L('두 버킷 작업자 안전고리 체결 → 각 전주로 상승', 'Both bucket workers clip in → rise to their poles'),
      what: L('버킷 작업자(0번 쪽 B, 35번 쪽 F)가 버킷에 타 안전대 고리를 걸고, 각 차량의 담당자가 확인한 뒤에 붐을 올립니다. 먼저 충전부와 거리를 둔 위치에 세웁니다.',
        'Each bucket worker (B at pole 0, F at pole 35) steps in and clips the lanyard; only after the ground person at that truck checks does the boom go up, first to a spot clear of the conductors.'),
      why: L('고리를 걸지 않은 안전대는 소용이 없습니다. 두 사람 모두, 올라가기 전에 서로 다른 사람이 확인합니다.', 'An unclipped harness does nothing. A second person checks each worker before lifting.'),
      lanes: [
        boardLane('B', 'truck', P1, X0, 'chk1'),
        boardLane('F', 'truck2', P2, X1, 'chk2'),
        [go('A', rearOf(P1) - 1.4, -0.6), until(W => W.people.B.hooked), say('A', L('0번 쪽 고리 확인 — 상승!', 'Pole 0 hook checked — up!'), 2.2), set(W => { W.chk1 = true; })],
        [go('D', rearOf(P2) - 1.4, -0.6), until(W => W.people.F.hooked), say('D', L('35번 쪽 고리 확인 — 상승!', 'Pole 35 hook checked — up!'), 2.2), set(W => { W.chk2 = true; })]
      ],
      wrong: [
        { text: L('올라가서 안전고리를 걸기로 하고 먼저 상승한다', 'Go up first and clip in at height'),
          why: L('붐이 움직이는 순간이 가장 흔들립니다. 탑승 즉시, 상승 전에 체결합니다. (수칙 7)', 'The bucket jolts most as the boom starts. Clip in on boarding, before lifting. (Rule 7)') },
        { text: L('한 사람이 두 전주를 오가며 안전고리를 확인한다', 'One person checks both workers, walking between the poles'),
          why: L('두 작업차가 35 m 떨어져 있어, 담당자가 자리를 비운 쪽은 확인 없이 올라갑니다. 차량마다 확인자를 둡니다. (수칙 7)', 'The trucks are 35 m apart, so the unattended one goes up unchecked. Each truck has its own checker. (Rule 7)') }
      ] },

    { id: 'wground', rules: [8],
      title: L('작업 구간 양단 검전 → 접지 (0번 · 35번 전주)', 'Test, then earth at both span ends (poles 0 and 35)'),
      what: L('두 버킷 작업자가 각자 전주에서 세 상을 다시 검전하고, 무전압이면 접지 클램프를 겁니다. 두 전주가 모두 접지되어야 전선을 풀기 시작합니다.',
        'Each bucket worker re-tests all three phases at their own pole and, if dead, clamps the earth. Only when both poles are earthed does anyone touch the wire.'),
      why: L('작업 구간 가까이에 다른 전원이나 유도전압이 있을 수 있습니다. 양단 접지는 구간 전체를 같은 전위로 묶어 줍니다.', 'There may be another source or induced voltage near the span. Earthing both ends ties the whole section to the same potential.'),
      lanes: [
        [...threePhases('B', X0, 'detector', L('0번 무전압', 'Pole 0 dead'), W => { W.tested.w0 = true; }),
          ...threePhases('B', X0, 'clamp', L('0번 접지 완료', 'Pole 0 earthed'), W => { W.wg[0] = true; })],
        [...threePhases('F', X1, 'detector', L('35번 무전압', 'Pole 35 dead'), W => { W.tested.w1 = true; }),
          ...threePhases('F', X1, 'clamp', L('35번 접지 완료', 'Pole 35 earthed'), W => { W.wg[1] = true; })],
        [say('A', L('양쪽 검전 결과 복창!', 'Read back both results!'), 2.4)]
      ],
      wrong: [
        { text: L('한쪽 전주만 접지하고 반대쪽은 전선을 풀면서 접지하기로 한다', 'Earth one pole and earth the other while releasing the wire'),
          why: L('전선을 만지기 전에 양단이 모두 검전·접지되어 있어야 합니다. (수칙 8)', 'Both ends must be tested and earthed before anyone touches the wire. (Rule 8)') },
        { text: L('-35 전주에서 검전했으니 여기서는 검전 없이 접지만 한다', 'Already tested at -35, so just clamp the earths'),
          why: L('작업 위치에서 다시 확인해야 다른 전원이 없음을 알 수 있습니다. (수칙 8)', 'Only a test at the work point proves no other source reaches it. (Rule 8)') }
      ] },

    { id: 'pulley', rules: [11],
      title: L('활차(풀리) 설치 — 완금에 세 상 모두', 'Fit the stringing blocks (pulleys) on the crossarm'),
      what: L('버킷을 작업 위치로 올려 각 전주 완금에 활차를 설치합니다. 전선이 애자에서 내려와도 활차 위에서 미끄러지며 지나가도록 하는 장치입니다.',
        'Raise the bucket to the work position and fit a stringing block on each phase of the crossarm. The wire will ride on it and slide through once it leaves the insulator.'),
      why: L('활차 없이 전선을 풀면 전선이 완금·전주를 긁어 손상시키고, 끌 때 걸려 튈 수 있습니다.', 'Without blocks the wire scrapes the arm and pole and can snag and whip when pulled.'),
      lanes: [
        [moveBoom('B', 'truck', 'near', 'work', X0, 3.4), act('B', 'reach', 4.6, { say: L('활차 설치 (0번)', 'Blocks on (pole 0)'), end: W => { W.wr.pulley[0] = true; } })],
        [moveBoom('F', 'truck2', 'near', 'work', X1, 3.4), act('F', 'reach', 4.6, { say: L('활차 설치 (35번)', 'Blocks on (pole 35)'), end: W => { W.wr.pulley[1] = true; } })],
        [say('A', L('활차 회전 · 고정 확인', 'Blocks turn freely and are locked'), 3)]
      ],
      wrong: [
        { text: L('활차를 건너뛰고 전선을 애자 위에 얹은 채 그대로 끈다', 'Skip the blocks and drag the wire along the insulators'),
          why: L('애자와 완금이 상하고 전선이 걸려 튑니다. 활차를 먼저 설치합니다. (수칙 11 배전)', 'Insulators and arms get damaged and the wire can snag and whip. Fit the blocks first. (Rule 11, distribution)') },
        { text: L('활차는 지상에서 던져 올려 전주 위 작업자가 받는다', 'Throw the blocks up from the ground for the worker to catch'),
          why: L('던진 공구는 낙하물이 됩니다. 자재는 버킷에 담거나 인양 로프로 올립니다. (수칙 6)', 'A thrown tool is a falling object. Carry it in the bucket or hoist it on a line. (Rule 6)') }
      ] },

    { id: 'detach', rules: [3, 8],
      title: L('구전선 분리 — 바인드를 풀어 활차에 올림', 'Release the old wire: undo the ties and lay it on the blocks'),
      what: L('애자 목에 묶인 바인드선(또는 클램프)을 풀어 구전선을 활차 위로 옮깁니다. 활차에 올라간 전선은 양 끝 전주에서만 지지됩니다.',
        'Undo the ties (or clamps) on the insulator necks and lift the old wire onto the blocks. It is now held only at the two poles.'),
      why: L('활차에 올리기 전에 먼저 풀면 전선이 도로·보도 위로 늘어집니다. 활차 설치와 양단 접지가 끝난 뒤에만 합니다.', 'Release it before it sits on a block and it falls across the road and sidewalk. Only after blocks are fitted and both ends earthed.'),
      lanes: [
        [act('B', 'reach', 5.2, { say: L('바인드 해체 (0번)', 'Ties off (pole 0)'), end: W => { W.wr.oldTied = false; } })],
        [act('F', 'reach', 5.2, { say: L('바인드 해체 (35번)', 'Ties off (pole 35)') })],
        [say('A', L('전선이 활차에 올라갔는지 확인', 'Wire sitting in the blocks — check'), 3)]
      ],
      wrong: [
        { text: L('전선이 무거우니 한 전주의 바인드만 먼저 풀고 반대쪽은 나중에 푼다', 'Free one pole first and the other later'),
          why: L('한쪽만 풀리면 전선이 다른 쪽 전주를 끌어당깁니다. 양 끝을 함께 활차에 올립니다. (수칙 3)', 'With one end free the wire pulls at the other pole. Move both ends onto the blocks together. (Rule 3)') },
        { text: L('활차 설치가 늦어지니 바인드를 먼저 풀어 두고 활차는 나중에 건다', 'Undo the ties now and fit the blocks later'),
          why: L('활차 없이 풀린 전선은 처져 도로를 덮습니다. 순서는 활차 → 분리입니다. (수칙 3)', 'A freed wire with no block sags over the road. The order is blocks, then release. (Rule 3)') }
      ] },

    { id: 'link', rules: [3],
      title: L('신전선 연결 — 드럼 스탠드, 윈치, 구전선과 신전선 연결', 'Connect the new wire: drum stand, winch, join old and new'),
      what: L('0번 전주 아래에 신전선 드럼을 스탠드에 걸어 제동을 겁니다. 35번 전주 너머에는 윈치를 세우고 구전선 끝을 물립니다. 0번 쪽에서 구전선 끝과 신전선 끝을 연결 그립으로 잇고, 연결부가 활차를 통과할 수 있는지 확인합니다.',
        'Set the new-wire drum on its stand with the brake on, below pole 0. Set the winch beyond pole 35 and attach the old wire\'s far end. At pole 0 join the old and new wire ends with a grip and check the joint can pass the blocks.'),
      why: L('연결 그립이 풀리거나 활차에 걸리면 견인 중에 전선이 튑니다. 견인 전에 연결부를 반드시 확인합니다.', 'A grip that slips or jams in a block makes the wire whip while pulled. Check the joint before any pull.'),
      lanes: [
        [go('C', WIRE.drum[0] + 1.2, WIRE.drum[1] - 1.2), act('C', 'bend', 1.4, { end: W => { W.wr.drum = true; } }),
          act('C', 'work', 2.6, { say: L('드럼 제동 · 스탠드 고정', 'Drum braked and stand fixed') })],
        [go('D', WIRE.winch[0] - 1.6, WIRE.winch[1] - 1.4), act('D', 'bend', 1.4, { end: W => { W.wr.winch = true; } }),
          act('D', 'work', 2.6, { say: L('윈치 설치 · 구전선 끝 연결', 'Winch set — old wire end attached') })],
        [act('B', 'reach', 5, { say: L('구전선과 신전선 연결', 'Joining old and new'), end: W => { W.wr.linked = true; } })],
        [act('F', 'work', 5), say('A', L('연결부 · 그립 확인', 'Joint and grip — checked'), 2.4)]
      ],
      wrong: [
        { text: L('연결 그립은 눈으로만 대충 보고 바로 견인을 시작한다', 'Glance at the grip and start pulling'),
          why: L('견인 중 그립이 풀리면 전선이 반동으로 튑니다. 연결부는 손으로 당겨 확인합니다. (수칙 3)', 'A grip that opens under load lets the wire whip back. Pull-test the joint by hand. (Rule 3)') },
        { text: L('드럼 제동은 견인 중에 필요할 때 걸면 된다', 'Apply the drum brake only when needed during the pull'),
          why: L('드럼이 제멋대로 풀리면 전선이 엉킵니다. 제동은 견인 전에 걸고 속도를 조절합니다. (수칙 11 배전)', 'A free-running drum tangles the wire. Brake first and control the speed. (Rule 11, distribution)') }
      ] },

    { id: 'pull', rules: [5, 6],
      title: L('견인 가선 — 하부 출입금지 · 장력 감시 · 무전 신호', 'Pull the new wire in — keep clear below, watch tension, radio signals'),
      what: L('모든 지상 인원이 경간 아래에서 벗어난 것을 확인한 뒤, 윈치로 구전선을 천천히 당겨 신전선을 끌어옵니다. 버킷 작업자는 활차의 연결부 통과를 지켜보고, 이상이 있으면 무전으로 즉시 정지를 외칩니다.',
        'Once everyone on the ground is out from under the span, the winch slowly draws the old wire in, pulling the new one through. The bucket workers watch the joint pass each block and call "stop" on the radio at any sign of trouble.'),
      why: L('장력이 걸린 전선이 걸려 끊어지면 채찍처럼 튑니다. 지상 인원이 경간 아래에 없고 정지 신호가 즉시 통해야 합니다.', 'A wire under tension that snags and breaks whips like a lash. Nobody may be under the span, and a stop call must work at once.'),
      lanes: [
        [say('A', L('경간 아래 인원 없음! 견인 시작', 'Nobody under the span! Start pulling'), 2.6), go('A', -4.2, 2.4)],
        [go('C', WIRE.drum[0] + 2.2, 2.6)],
        [go('E', -8, -1.2), until(W => W.wr.pull > 0.01), act('E', 'wave', 20, { say: L('견인 중! 접근 금지!', 'Pulling! Keep out!') })],
        [go('D', WIRE.winch[0] - 1.2, 2.4), until(W => W.wr.pull > 0.01), act('D', 'work', 20, { say: L('윈치 운전: 천천히', 'Winch: slow and steady') })],
        [wait(3.4), tween(22, (W, k) => { W.wr.pulling = true; W.wr.pull = ease(k); W.wr.tension = 5.5 + 1.6 * Math.sin(k * 14) * (1 - k * 0.4); W.wr.sag = WIRE.sagOld + (WIRE.sagTaut - WIRE.sagOld) * Math.min(1, k * 8); },
          { end: W => { W.wr.pulling = false; W.wr.tension = 0; W.wr.pull = 1; } })],
        [act('B', 'watch', 28)], [act('F', 'watch', 28)]
      ],
      wrong: [
        { text: L('속도를 내려고 지상 작업자가 전선을 따라 걸으며 손으로 잡아 준다', 'Ground workers walk beside the wire and steady it by hand'),
          why: L('전선이 걸려 끊어지면 반동에 맞습니다. 경간 아래 접근 금지, 전선은 활차와 윈치가 지나게 합니다. (수칙 5, 6)', 'If it snags and breaks, whoever is holding it is hit. Nobody under or near the span; let the blocks and winch do it. (Rules 5, 6)') },
        { text: L('연결부가 활차를 지나는 순간에도 속도를 줄이지 않는다', 'Keep the speed up as the joint passes the blocks'),
          why: L('연결부는 걸리기 쉬운 곳입니다. 통과할 때는 속도를 늦추고 버킷 작업자가 확인합니다. (수칙 3)', 'The joint is where it jams. Slow down as it passes and let the bucket worker watch it. (Rule 3)') }
      ] },

    { id: 'sag', rules: [3, 11],
      title: L('이도 조정 — 기온에 맞는 처짐 양으로', 'Adjust the sag to suit the temperature'),
      what: L('새 전선을 당겨 장력을 풀고 처짐(이도)을 계획서 기준표의 목표값에 맞춥니다. 기온이 높으면 전선이 늘어 더 처지게 하고, 낮으면 덜 처지게 합니다. 허용 오차 안에 들어온 뒤에 장력을 고정합니다.',
        'Slack the new wire off to the sag in the plan table. In warm weather the wire has stretched, so allow more sag; in cold, less. Lock the tension only once it is within tolerance.'),
      why: L('너무 팽팽하면 겨울에 끊어지거나 전주에 무리가 가고, 너무 처지면 바람에 전선끼리 닿거나 지상고가 모자랍니다.', 'Too tight and the wire may snap in the cold or overload the pole; too slack and wind brings the wires together or they hang too low.'),
      lanes: [
        [tween(7, (W, k) => { if (!W.wr.manual) W.wr.sag = WIRE.sagTaut + (W.wr.target - WIRE.sagTaut) * ease(k); }),
          until(W => !W.wr.manual || W.wr.locked), set(W => { W.wr.locked = true; })],
        [act('B', 'watch', 10), say('B', L('0번 쪽 이도 확인', 'Pole 0 sag — checked'), 2)],
        [act('F', 'watch', 10), say('F', L('35번 쪽 이도 확인', 'Pole 35 sag — checked'), 2)],
        [say('A', L('목표 이도와 비교 — 허용 오차 이내', 'Compared with target — within tolerance'), 3)]
      ],
      wrong: [
        { text: L('여름이든 겨울이든 같은 처짐으로 맞춘다', 'Use the same sag in summer and winter'),
          why: L('전선은 온도에 따라 길이가 변하므로 기온별 기준표의 이도로 맞춥니다. (수칙 3)', 'The wire changes length with temperature, so use the sag for today\'s temperature from the table. (Rule 3)') },
        { text: L('팽팽할수록 안전하니 최대한 당겨서 고정한다', 'Tighter is safer — pull as hard as possible and lock it'),
          why: L('과장력은 겨울에 전선과 전주를 상하게 합니다. 이도는 클수록도 작을수록도 아닌 기준값입니다. (수칙 3)', 'Over-tension damages wire and pole in the cold. Sag has a target value, neither as big nor as small as possible. (Rule 3)') }
      ] },

    { id: 'tie', rules: [11],
      title: L('결속 — 이도를 확인한 뒤 애자에 고정', 'Tie in: fix the wire to the insulators once the sag is checked'),
      what: L('이도가 확인되면 활차 위의 전선을 애자 위로 내려 바인드선(또는 클램프)으로 결속합니다. 활차는 아직 떼지 않고 결속이 끝난 뒤에 철거합니다.',
        'With the sag confirmed, lower the wire from the blocks onto the insulators and tie (or clamp) it. The blocks stay on until the ties are done.'),
      why: L('이도를 확인하기 전에 고정하면 다시 풀어야 하고, 그동안 전선이 풀린 채 남습니다.', 'Tie before the sag is checked and it has to be undone, leaving the wire loose meanwhile.'),
      lanes: [
        [act('B', 'reach', 6.2, { say: L('결속 (0번)', 'Tying in (pole 0)'), end: W => { W.wr.newTied = true; } })],
        [act('F', 'reach', 6.2, { say: L('결속 (35번)', 'Tying in (pole 35)') })],
        [say('A', L('결속 상태 · 바인드 길이 확인', 'Ties and binding length — checked'), 3)]
      ],
      wrong: [
        { text: L('이도 확인은 나중에 하기로 하고 일단 애자에 결속한다', 'Tie in first, check the sag later'),
          why: L('결속은 이도 확인 뒤입니다. 순서가 바뀌면 다시 풀고 묶는 동안 위험이 반복됩니다. (수칙 11 배전)', 'Tying comes after the sag check. Reverse it and the risk repeats while you undo and redo. (Rule 11, distribution)') },
        { text: L('활차를 먼저 떼어 내 버리고 그다음에 결속한다', 'Remove the blocks first, then tie in'),
          why: L('활차를 떼면 전선이 아직 고정되지 않은 채로 매달립니다. 결속 뒤에 철거합니다. (수칙 3)', 'Take the blocks off and the wire hangs untied. Remove them after tying in. (Rule 3)') }
      ] },

    { id: 'jumper', rules: [11],
      title: L('점퍼선 접속 · 압축 슬리브 작업', 'Connect the jumpers and crimp the sleeves'),
      what: L('전주 위에서 새 전선과 이웃 경간 전선을 점퍼선으로 잇고, 압축 슬리브를 규정 압력으로 압축합니다. 접속 부위를 방호 커버로 덮습니다.',
        'At the pole top, join the new wire to the next span\'s wire with jumpers, crimp the sleeves to the specified pressure and cover the joints.'),
      why: L('접속부는 전선에서 가장 약한 곳입니다. 압축이 부족하면 나중에 발열·단선으로 정전이 납니다.', 'A joint is the weakest point of a line. An under-crimped sleeve later overheats or breaks and causes an outage.'),
      lanes: [
        [act('B', 'reach', 6, { say: L('점퍼 접속 · 압축', 'Jumpers on, sleeves crimped'), end: W => { W.wr.jumper = true; } })],
        [act('F', 'reach', 6)], [say('A', L('압축 상태 확인', 'Crimps — checked'), 3)]
      ],
      wrong: [
        { text: L('압축기 대신 일반 공구로 슬리브를 조여 둔다', 'Tighten the sleeves with ordinary pliers'),
          why: L('규정 압력으로 압축해야 접속 저항과 강도가 보장됩니다. 적정 공구를 씁니다. (수칙 11 배전)', 'Only a proper crimp at the specified pressure gives the resistance and strength. Use the right tool. (Rule 11, distribution)') },
        { text: L('접속 부위는 커버 없이 두어도 전선과 같으니 그대로 둔다', 'Leave the joint uncovered, it is just wire'),
          why: L('접속부는 접촉·부식에 가장 약합니다. 규정대로 커버를 덮습니다. (수칙 11 배전)', 'A joint is most prone to contact and corrosion. Cover it as specified. (Rule 11, distribution)') }
      ] },

    { id: 'remove', rules: [6],
      title: L('활차 · 드럼 · 윈치 철거, 공구 회수', 'Take down the blocks, drum and winch; collect the tools'),
      what: L('버킷 작업자가 활차를 떼어 버킷에 담아 내리고, 지상에서는 드럼 스탠드와 윈치를 철거합니다. 전주 위에 남은 공구·바인드 조각이 없는지 확인합니다.',
        'The bucket workers take the blocks off and carry them down in the bucket. On the ground the drum stand and winch come away. Check nothing is left on the poles.'),
      why: L('전주 위에 남은 공구나 활차는 송전 뒤 떨어지거나 선로에 닿는 고장 원인이 됩니다.', 'A tool or block left on a pole falls or touches the line after the power is back on.'),
      lanes: [
        [act('B', 'reach', 4.4, { say: L('활차 철거 (0번)', 'Blocks off (pole 0)'), end: W => { W.wr.pulley[0] = false; } })],
        [act('F', 'reach', 4.4, { say: L('활차 철거 (35번)', 'Blocks off (pole 35)'), end: W => { W.wr.pulley[1] = false; } })],
        [wait(2), go('C', WIRE.drum[0] + 1.2, WIRE.drum[1] - 1.2), act('C', 'bend', 1.6, { end: W => { W.wr.drum = false; } }), go('C', P1 + 3.4, 0.4)],
        [wait(2), go('D', WIRE.winch[0] - 1.6, WIRE.winch[1] - 1.4), act('D', 'bend', 1.6, { end: W => { W.wr.winch = false; } }), go('D', P2 + 4.6, 0.5)],
        [say('A', L('전주 위 남은 공구 없음 — 확인', 'Nothing left aloft — checked'), 3.4)]
      ],
      wrong: [
        { text: L('활차는 송전한 뒤에 다음 작업 때 떼기로 하고 그대로 둔다', 'Leave the blocks and take them off on the next job'),
          why: L('활차를 단 채로 송전하면 접촉·낙하 사고가 납니다. 송전 전에 모두 철거합니다. (수칙 8)', 'Energising with rigging still on the line risks contact and drops. Remove everything before power. (Rule 8)') },
        { text: L('공구는 전주 아래로 던져 내리고 나중에 줍는다', 'Throw the tools down and pick them up later'),
          why: L('던진 공구는 낙하물입니다. 버킷에 담아 내립니다. (수칙 6)', 'A thrown tool is a falling object. Bring tools down in the bucket. (Rule 6)') }
      ] },

    { id: 'finish', rules: [8, 5, 2, 4],
      title: L('작업 완료 · 역순 철수 (양단 접지 해제 → 원방 접지 해제 → 개폐기 투입)', 'Finish · tear down in reverse (span earths → remote earth → switch)'),
      what: L('버킷 작업자가 양단 접지를 풀고(선로 측 먼저, 대지측 나중) 내려옵니다 → -35 전주 접지를 풉니다 → 인원·공구를 확인한 뒤 개폐기를 투입합니다 → 두 작업차의 아웃트리거와 고임목, 라바콘을 회수하고 유도자 신호로 출발합니다.',
        'The bucket workers remove the span earths (line end first, earth end last) and come down → the earth at -35 is removed → count people and tools, then close the switch → stow outriggers and chocks on both trucks, collect cones and leave under the guide\'s signal.'),
      why: L('송전 전에 인원과 접지, 남은 장비를 모두 확인하지 않으면 접지를 단 채 송전하거나 사람이 남은 채 송전합니다.', 'Skip the count and you may re-energise with an earth on, rigging left on the line or a worker aloft.'),
      lanes: [
        [moveBoom('B', 'truck', 'work', 'near', X0, 3),
          ...[2, 1, 0].map(i => act('B', 'stick', 1.4, { stick: ph(X0, i), tool: 'clamp', end: i === 0 ? (W => { W.wg[0] = false; }) : null })),
          act('B', 'work', 6, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, bk('near', X0)), STOW, ease(k)); }, end: W => { W.truck.boom = { ...STOW }; } }),
          act('B', 'work', 1, { end: W => { W.people.B.hooked = false; } }),
          act('B', 'climb', 1.4, { end: W => { const b = W.people.B; b.inBucket = false; b.x = rearOf(P1) - 0.8; b.y = 0.3; b.z = 0; } }),
          go('B', -9, 4.6), set(W => { W.bOff = true; })],
        [moveBoom('F', 'truck2', 'work', 'near', X1, 3),
          ...[2, 1, 0].map(i => act('F', 'stick', 1.4, { stick: ph(X1, i), tool: 'clamp', end: i === 0 ? (W => { W.wg[1] = false; }) : null })),
          act('F', 'work', 6, { fx: (W, k) => { W.truck2.boom = lerpJ(boomIK(W.truck2, bk('near', X1)), STOW, ease(k)); }, end: W => { W.truck2.boom = { ...STOW }; } }),
          act('F', 'work', 1, { end: W => { W.people.F.hooked = false; } }),
          act('F', 'climb', 1.4, { end: W => { const f = W.people.F; f.inBucket = false; f.x = rearOf(P2) - 0.8; f.y = 0.3; f.z = 0; } }),
          go('F', rearOf(P2) - 0.8, 0.3), set(W => { W.fOff = true; })],
        [go('D', -12.5, 4.5), go('D', G.gndX + 0.8, 4.5), until(W => !W.wg[0] && !W.wg[1] && W.bOff && W.fOff),
          ...[2, 1, 0].map(i => act('D', 'stick', 1.5, { stick: ph(G.gndX + 1.4, i), tool: 'clamp', end: W => { W.ground.line = i; } })),
          act('D', 'work', 1.6, { say: L('선로 측 먼저, 대지측 나중', 'Line end first, earth end last'), end: W => { W.ground.earth = false; } }),
          go('D', -12.5, 4.5), go('D', -10, 4.6), set(W => { W.dBack = true; })],
        [go('A', -40, 4.4), go('A', G.swX + 0.4, 4.4), until(W => W.bOff && W.fOff && W.ground.line === 0 && !W.ground.earth), say('A', L('인원·공구 확인 — 접지 전부 제거', 'People & tools counted — all earths off'), 2.4),
          act('A', 'work', 1, { end: W => { W.sw.tag = false; } }),
          act('A', 'stick', 2.6, { stick: [G.swX, G.poleY - 0.45, G.swZ], say: L('개폐기 투입 — 송전', 'Switch closed — line live'), end: W => { W.sw.closed = true; } }),
          go('A', -40, 4.4), go('A', -14, 4.6)],
        [until(W => W.bOff), ...outrigLane('C', 'truck', P1, false), go('C', P1 + 2.9 + 0.6, 0.2), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[0] = false; } }),
          go('C', P1 - 2.3 - 0.6, 0.2), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[1] = false; } }),
          go('C', rearOf(P1) - 1.2, 0.2), go('C', rearOf(P1) - 1.2, 3.6), go('C', P1 - 2.3 - 0.6, 3.6), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[2] = false; } }),
          go('C', P1 + 2.9 + 0.6, 3.6), act('C', 'bend', 0.6, { end: W => { W.truck.chocks[3] = false; } }),
          until(W => W.sw.closed && W.dBack && !W.truck2.present), go('C', P1 + G.truckLen / 2 - 1, 0.4),
          set(W => { W.people.C.inCab = true; W.truck.driver = 'C'; }), until(W => W.conesDown),
          tween(8, (W, k) => { W.truck.moving = 1; W.truck.c = P1 + 60 * k * k; }, { end: W => { W.truck.moving = 0; W.truck.present = false; } })],
        [until(W => W.fOff), ...outrigLane('F', 'truck2', P2, false), go('F', P2 + 2.9 + 0.6, 0.2), act('F', 'bend', 0.6, { end: W => { W.truck2.chocks[0] = false; } }),
          go('F', P2 - 2.3 - 0.6, 0.2), act('F', 'bend', 0.6, { end: W => { W.truck2.chocks[1] = false; } }),
          go('F', rearOf(P2) - 1.2, 0.2), go('F', rearOf(P2) - 1.2, 3.6), go('F', P2 - 2.3 - 0.6, 3.6), act('F', 'bend', 0.6, { end: W => { W.truck2.chocks[2] = false; } }),
          go('F', P2 + 2.9 + 0.6, 3.6), act('F', 'bend', 0.6, { end: W => { W.truck2.chocks[3] = false; } }),
          until(W => W.sw.closed), go('F', P2 + G.truckLen / 2 - 1, 0.4),
          set(W => { W.people.F.inCab = true; W.truck2.driver = 'F'; }),
          tween(8, (W, k) => { W.truck2.moving = 1; W.truck2.c = P2 + 60 * k * k; }, { end: W => { W.truck2.moving = 0; W.truck2.present = false; } })],
        [until(W => W.sw.closed && W.truck.outrig === 0 && W.truck2.outrig === 0), { w: 'E', dyn: W => {
          const out = [], pick = (pred) => W.cones.filter(c => c.placed && pred(c));
          for (const c of pick(c => c.side === 1 || (c.side === 2 && c.x > 20)).reverse()) out.push(go('E', c.x, c.y + (c.side === 2 ? -0.6 : 0)), act('E', 'bend', 0.4, { end: () => { c.placed = false; } }));
          out.push(go('E', 22, -0.8), set(W2 => { W2.conesDown = true; }), say('E', L('출발 — 앞 차로 확인', 'Go — lane is clear'), 1.6));    // 차로 밖으로 비킨 뒤 출발 신호
          for (const c of pick(c => c.side === 0).reverse()) out.push(go('E', c.x, c.y - 0.5), act('E', 'bend', 0.4, { end: () => { c.placed = false; } }));
          out.push(go('E', -12, -1));
          return out;
        } }],
        [until(W => W.sw.closed && W.truck.outrig === 0 && W.truck2.outrig === 0), { w: 'B', dyn: W => {
          const out = [];
          for (const c of W.cones.filter(c => c.placed && (c.side === 3 || c.side === 4 || (c.side === 2 && c.x <= 20)))) out.push(go('B', c.x, c.y + (c.side === 2 ? -0.6 : 0)), act('B', 'bend', 0.4, { end: () => { c.placed = false; } }));
          out.push(set(W2 => { W2.tape = false; }), go('B', -9, 4.6));
          return out;
        } }]
      ],
      wrong: [
        { text: L('양단 접지를 단 채로 먼저 개폐기를 투입한다', 'Close the switch while the span earths are still on'),
          why: L('접지를 단 채 송전하면 지락·아크 사고가 납니다. 접지 제거와 인원 확인 후에 송전합니다. (수칙 8)', 'Re-energising into an earth causes a fault and arc. Remove earths and count people first. (Rule 8)') },
        { text: L('붐을 올린 채로 아웃트리거부터 거둔다', 'Retract the outriggers while the boom is still up'),
          why: L('붐이 펼쳐진 상태에서 아웃트리거를 거두면 바로 전도됩니다. 붐 수납이 먼저입니다. (수칙 4)', 'Retracting with the boom out tips the truck immediately. Stow the boom first. (Rule 4)') }
      ] }
  ];
}
