// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 — 시나리오: 가공 배전 애자 · 완금 교체 (정전 작업) (safety.js 가 이 파일들을 묶어 내보낸다)
import { GEO, boomIK, STOW, BUCKET, lerpJ, L, dist2, ease, go, act, say, tween, until, set, wait } from './core.js?v=96dbb605';

// ---- 시나리오: 가공 배전 애자·완금 교체 ----------------------------------------------------
export function poleWorld() {
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
export function person(x, y) { return { x, y, z: 0, face: 1, anim: 'idle', ppe: { helmet: false, vest: false, gloves: false, harness: false }, carry: null, say: null, sayT: 0, inBucket: false, inCab: false, hooked: false, stick: null, k: 0 }; }

export function poleSteps() {
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
      title: L('방호: 중성선·인접 상에 절연 커버', 'Cover the neutral and adjacent phase'),
      what: L('검전·접지가 끝났어도, 작업 중 몸이 닿을 수 있는 중성선과 가까운 상에 절연 방호관·커버를 씌웁니다. 버킷을 조금 내려 중성선부터 덮고, 바로 옆 상을 덮은 뒤 작업 위치로 올라갑니다.',
        'Even after testing and earthing, fit insulating hoses and covers on the neutral and the nearby phase you could touch while working. Lower the bucket a little, cover the neutral, then the adjacent phase, and move up to the work position.'),
      why: L('오조작·역송전·유도전압으로 선로에 다시 전기가 올 수 있습니다. 접지는 사고 전류를 흘려 줄 뿐이라, 그 순간 몸이 선에 닿아 있으면 위험이 남습니다.', 'Wrong switching, back-feed or induced voltage can re-energise the line. The earth only carries the fault current; if your body is touching a conductor at that moment, you are still at risk.'),
      lanes: [
        [act('B', 'work', 3, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, BUCKET.near), boomIK(W.truck, BUCKET.cover), ease(k)); } }),
          act('B', 'reach', 4.5, { say: L('방호관 설치', 'Fitting line hoses'), fx: (W, k) => { W.covers = k; } }),
          act('B', 'work', 3.4, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, BUCKET.cover), boomIK(W.truck, BUCKET.work), ease(k)); } })],
        [say('A', L('몸 닿는 범위는 전부 방호', 'Cover everything within reach'), 2.4)]
      ],
      wrong: [
        { text: L('정전·접지를 했으니 방호관 없이 바로 작업한다', 'It is dead and earthed, so start without covers'),
          why: L('오조작·역송전·유도전압으로 다시 전기가 올 수 있습니다. 몸이 닿을 수 있는 중성선·인접 상은 방호합니다. (수칙 8)', 'Wrong switching, back-feed or induced voltage can bring the line back. Cover the neutral and adjacent phase within reach. (Rule 8)') },
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
