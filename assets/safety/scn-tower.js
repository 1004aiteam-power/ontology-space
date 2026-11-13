// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 — 시나리오: 송전 철탑 승탑 (safety.js 가 이 파일들을 묶어 내보낸다)
import { GEO, STOW, L, ease, go, act, say, tween, until, set, wait } from './core.js?v=96dbb605';
import { person } from './scn-pole.js?v=36fdb56d';

// ---- 시나리오: 송전 철탑 승탑 ------------------------------------------------------------
// 도로 북쪽 들판의 가상 154kV 철탑. 추락방지 와이어(수직 구명줄)를 따라 오르내리며, 공중에서는 언제나 고리 하나 이상
export const TW = { x: 0, y: 20, base: 4, topHalf: 1.4, top: 38, armZ: [24, 29, 34], armLen: 7.5, workZ: 22 };
export const towerLeg = (z, out = 0) => {                            // 남서쪽 다리 위의 점 (out: 바깥쪽으로 띄움)
  const h = TW.base - (TW.base - TW.topHalf) * Math.min(z, TW.top) / TW.top + out;
  return [TW.x - h, TW.y - h, z];
};
export const PULLEY = (() => { const p = towerLeg(TW.armZ[0], 1.1); return [p[0], p[1], TW.armZ[0] + 0.4]; })();
export function towerWorld() {
  const cones = [];
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; cones.push({ x: TW.x + Math.cos(a) * 9, y: TW.y + Math.sin(a) * 9, placed: false, side: 0 }); }
  return {
    people: { A: person(-12, 5.0), B: person(-10.6, 4.5), C: person(-10.2, 5.6), D: person(-11.4, 6.2), E: person(-9.8, 5.1) },
    truck: { present: false, c: -60, y: GEO.laneY, moving: 0, outrig: 0, pads: false, chocks: [false, false, false, false], boom: { ...STOW }, hookDrop: 0 },
    van: { c: -10, y: 1.9 },
    cones, board: { x: -13.4, y: 5.4, present: true },
    sw: { closed: true, tag: false }, tested: { gnd: false, work: false }, ground: { earth: false, line: 0 }, covers: 0, insul: 'new',
    load: { x: 0, y: 0, z: 0, state: 'gone', kind: 'new' },
    lifelineOK: false, arrester: false, lanyard: false, bag: { z: 0, state: 'ground' }, plan: false
  };
}
export function towerSteps() {
  const [lx, ly] = towerLeg(0, 0.9), [px, py] = PULLEY, rope = [px - 4.5, py - 4.5];
  return [
    { id: 'ttbm', rules: [3],
      title: L('작업 전 TBM · 작업계획서 확인', 'Pre-work TBM · check the work plan'),
      what: L('작업책임자가 작업 내용(철탑 부재·볼트 점검), 승탑 경로와 추락방지 설비, 낙하물 위험 구역, 기상(풍속) 조건을 설명합니다.',
        'The supervisor covers the job (tower member and bolt inspection), the climbing route and fall-arrest system, the dropped-object zone and the weather (wind) limits.'),
      why: L('고소 작업은 한 번의 실수가 생명과 직결됩니다. 오르기 전에 모든 것을 정합니다.', 'At height one mistake is fatal. Settle everything before anyone climbs.'),
      lanes: [
        [say('A', L('오늘 작업: 154kV 철탑 부재·볼트 점검 (가상)', 'Today: inspect 154 kV tower members & bolts (virtual)'), 3),
          say('A', L('승탑은 추락방지 와이어로만, 공중에선 고리 항상 체결', 'Climb only on the fall-arrest wire; always clipped aloft'), 3.4),
          say('A', L('풍속 10m/s 넘으면 중지', 'Stop if wind exceeds 10 m/s'), 2.6), set(W => { W.plan = true; })],
        [act('B', 'read', 9)], [act('C', 'read', 9)], [act('D', 'read', 9)], [act('E', 'read', 7.4), say('E', L('확인!', 'Confirmed!'), 1.6)]
      ],
      wrong: [
        { text: L('늘 하던 점검이니 TBM 없이 바로 오른다', 'A routine inspection — climb without a TBM'),
          why: L('익숙한 작업일수록 절차를 건너뛰다 사고가 납니다. (수칙 3)', 'Familiar jobs are exactly where steps get skipped. (Rule 3)') },
        { text: L('바람이 세도 계획한 날이니 그대로 진행한다', 'Windy, but it is the planned day — carry on'),
          why: L('강풍은 추락·낙하물 위험을 크게 높입니다. 기준을 넘으면 작업을 미룹니다.', 'Strong wind multiplies fall and dropped-object risk. Postpone above the limit.') }
      ] },
    { id: 'tppe', rules: [1, 11],
      title: L('개인 안전장구 · 안전그네식 안전대', 'PPE · full-body harness'),
      what: L('안전모(턱끈)·안전화·장갑과 함께 승탑자는 안전그네식(전신) 안전대, 추락방지기, 공구 낙하방지 줄을 착용합니다. 작업책임자가 버클과 고리를 확인합니다.',
        'Hard hats with chin straps, boots and gloves; the climber also wears a full-body harness, a fall arrester and tool lanyards. The supervisor checks buckles and hooks.'),
      why: L('송전 철탑에서는 허리 벨트식 안전대를 쓰지 않습니다. 추락을 멈출 때 충격이 몸 전체로 나뉘어야 합니다.', 'Waist belts are not used on towers; arresting a fall must spread the force over the whole body.'),
      lanes: ['A', 'B', 'C', 'D', 'E'].map(w => [act(w, 'dress', 2.4, { end: W => { Object.assign(W.people[w].ppe, { helmet: true, vest: true, gloves: true, harness: w === 'B' }); } })])
        .concat([[wait(2.6), say('A', L('그네식 안전대 버클·고리 확인', 'Harness buckles & hooks checked'), 2.4)]]),
      wrong: [
        { text: L('허리에 차는 벨트식 안전대로 오른다', 'Climb with a waist-belt type harness'),
          why: L('철탑 승탑에는 안전그네식 안전대가 필수입니다. (수칙 11 송전)', 'Tower climbing requires a full-body harness. (Rule 11, transmission)') },
        { text: L('공구는 주머니에 넣고 오른다', 'Put the tools in your pockets and climb'),
          why: L('주머니에서 떨어진 공구는 아래 사람에게 치명적입니다. 낙하방지 줄로 몸에 묶습니다.', 'A tool slipping from a pocket can kill someone below. Tether tools to your body.') }
      ] },
    { id: 'tzone', rules: [5],
      title: L('철탑 주변 낙하물 위험 구역 출입금지', 'Keep out of the dropped-object zone around the tower'),
      what: L('철탑 둘레에 라바콘을 둘러 낙하물 위험 구역을 정하고, 승탑 중에는 지상 인원도 다리 바로 아래에 서지 않습니다.',
        'Cones ring the tower to mark the dropped-object zone; while someone climbs, the ground crew keeps away from the foot of the leg.'),
      why: L('수십 m 높이에서 떨어진 볼트 하나도 안전모를 뚫을 수 있습니다.', 'A single bolt dropped from tens of metres can pierce a hard hat.'),
      lanes: [
        [{ w: 'E', dyn: W => W.cones.filter((c, i) => i % 2 === 0).flatMap(c => [go('E', c.x, c.y), act('E', 'bend', 0.45, { end: () => { c.placed = true; } })]).concat([go('E', -12, 9)]) }],
        [{ w: 'D', dyn: W => W.cones.filter((c, i) => i % 2 === 1).flatMap(c => [go('D', c.x, c.y), act('D', 'bend', 0.45, { end: () => { c.placed = true; } })]).concat([go('D', rope[0] - 1, rope[1] - 2)]) }],
        [say('A', L('승탑 중 다리 아래 접근 금지', 'Nobody at the leg foot during the climb'), 2.4)]
      ],
      wrong: [
        { text: L('보조자는 바로 받아 주려고 다리 밑에서 대기한다', 'The helper waits at the leg foot to catch things'),
          why: L('떨어지는 물건을 받으려다 맞습니다. 낙하 반경 밖에서 대기합니다. (수칙 5)', 'Catching dropped objects is how people get hit. Wait outside the zone. (Rule 5)') },
        { text: L('들판이라 지나가는 사람이 없으니 구역 표시는 생략한다', 'It is an open field — skip the zone markers'),
          why: L('농민·산책객이 들어올 수 있습니다. 구역은 언제나 표시합니다.', 'Farmers and walkers do come by. Always mark the zone.') }
      ] },
    { id: 'lifeline', rules: [11],
      title: L('추락방지 와이어(수직 구명줄) · 추락방지기 점검', 'Inspect the fall-arrest wire and arrester'),
      what: L('승탑자가 철탑 다리의 추락방지 와이어 고정부·장력·손상 여부를 확인하고, 추락방지기를 와이어에 걸어 아래로 당겨 잠기는지 시험합니다.',
        "The climber checks the fall-arrest wire's anchors, tension and damage, then fits the arrester and tugs it down to prove it locks."),
      why: L('추락방지 설비가 고장이면 떨어지는 순간 아무것도 붙잡아 주지 않습니다.', 'A faulty fall-arrest system holds nothing when you fall.'),
      lanes: [
        [go('B', lx - 0.4, ly - 0.4), act('B', 'work', 3, { say: L('와이어 고정부·장력 확인', 'Anchors & tension OK') }),
          act('B', 'work', 2.4, { say: L('추락방지기 잠김 시험 OK', 'Arrester lock test OK'), end: W => { W.lifelineOK = true; } })],
        [go('A', lx - 2.6, ly - 1.6), until(W => W.lifelineOK), say('A', L('점검 결과 확인', 'Inspection confirmed'), 2)],
        [go('C', px + 0.3, py - 0.9), act('C', 'bend', 1.6, { say: L('공구 가방 달줄 결속 (승탑 전에)', 'Bag tied to the hand line (before the climb)') }), go('C', ...rope)]
      ],
      wrong: [
        { text: L('어제 쓴 설비라서 점검 없이 오른다', 'It was used yesterday — climb without checking'),
          why: L('밤사이 손상·풀림이 생길 수 있습니다. 매번 오르기 전에 점검합니다. (수칙 11 송전)', 'Damage or slack can appear overnight. Inspect before every climb. (Rule 11, transmission)') },
        { text: L('추락방지 와이어 대신 손으로 볼트를 잡고 오른다', 'Skip the wire and climb holding the step bolts'),
          why: L('철탑 승탑 시 추락방지 와이어 사용은 필수입니다. (수칙 11 송전)', 'Using the fall-arrest wire is mandatory on towers. (Rule 11, transmission)') }
      ] },
    { id: 'climb', rules: [11, 7],
      title: L('추락방지기를 체결하고 승탑', 'Clip the arrester on and climb'),
      what: L('승탑자가 안전대의 추락방지기를 와이어에 체결한 상태로 천천히 오릅니다. 감시자는 아래에서 계속 지켜보고, 아무도 다리 아래로 들어가지 않습니다.',
        "The climber goes up slowly with the harness arrester on the wire. The watcher stays on him from below, and nobody steps under the leg."),
      why: L('승탑 중 미끄러지면 추락방지기가 바로 잠겨 떨어지는 거리를 짧게 막아 줍니다.', 'If the climber slips, the arrester locks at once and limits the fall.'),
      lanes: [
        [act('B', 'work', 1.4, { say: L('추락방지기 체결', 'Arrester on'), end: W => { W.arrester = true; } }),
          act('B', 'climb', 14, { fx: (W, k) => { const p = towerLeg(TW.workZ * k, 0.55); Object.assign(W.people.B, { x: p[0], y: p[1], z: p[2] }); } })],
        [go('D', rope[0] - 1, rope[1] - 2), act('D', 'watch', 15.4, { say: L('승탑 감시 중', 'Watching the climb') })]
      ],
      wrong: [
        { text: L('빨리 오르려고 추락방지기는 작업 위치에서 건다', 'Climb fast and clip the arrester on at the work position'),
          why: L('오르는 동안이 가장 위험합니다. 지상에서 체결한 뒤 오릅니다. (수칙 7, 11)', 'Climbing is the riskiest part. Clip on at ground level before climbing. (Rules 7, 11)') },
        { text: L('두 사람이 같은 와이어로 바짝 붙어 함께 오른다', 'Two people climb the same wire close together'),
          why: L('한 사람이 떨어지면 아래 사람을 덮칩니다. 한 번에 한 사람씩 오릅니다.', 'If the upper one falls, he takes the lower one with him. One at a time.') }
      ] },
    { id: 'tieoff', rules: [7],
      title: L('작업 위치 이중 체결 (고리 하나는 항상)', 'Tie off at the work position (always one hook on)'),
      what: L('작업 위치에서 먼저 안전대 고리(랜야드)를 철탑 부재에 건 뒤에 추락방지기를 쉬게 합니다. 공중에서는 어느 순간에도 고리 하나 이상이 걸려 있어야 합니다.',
        'At the work position the climber first clips the lanyard to a tower member, only then parks the arrester. Aloft, at least one hook is on at every moment.'),
      why: L('고리를 바꿔 거는 그 몇 초 동안의 추락 사고가 가장 많습니다.', 'Most falls happen in the few seconds of swapping hooks.'),
      lanes: [
        [act('B', 'reach', 1.8, { say: L('랜야드 부재에 체결', 'Lanyard on the member'), end: W => { W.lanyard = true; } }),
          act('B', 'work', 1.2, { say: L('두 고리 확인', 'Both hooks checked') })]
      ],
      wrong: [
        { text: L('추락방지기를 먼저 풀고 랜야드를 건다', 'Unclip the arrester first, then clip the lanyard'),
          why: L('그 사이 아무것도 걸려 있지 않습니다. 새 고리를 먼저 걸고 헌 고리를 풉니다. (수칙 7)', 'For those seconds nothing holds you. New hook on first, then the old one off. (Rule 7)') },
        { text: L('발판이 넓으니 작업 위치에서는 고리를 풀고 자유롭게 움직인다', 'The platform is wide — unclip and move freely at the work spot'),
          why: L('발판 위에서도 미끄러짐·돌풍으로 떨어집니다. 고리는 항상 체결합니다. (수칙 7)', 'Slips and gusts happen on platforms too. Stay clipped. (Rule 7)') }
      ] },
    { id: 'hoist', rules: [6],
      title: L('공구·자재 인양: 달줄 · 하부 출입금지', 'Hoist tools on a hand line · nobody beneath'),
      what: L('공구는 손에 들고 오르지 않고 달줄(도르래)로 올립니다. 지상 보조는 줄 끝을 잡고 낙하 반경 밖에 서며, 매단 가방 아래로는 아무도 들어가지 않습니다.',
        'Tools go up on a hand line through a pulley, not in the climber\'s hands. The helper holds the line end outside the drop radius and nobody walks under the bag.'),
      why: L('올리는 중 매듭이 풀리면 가방이 그대로 떨어집니다.', 'If the knot slips on the way up, the bag drops straight down.'),
      lanes: [
        [set(W => { W.people.C.tagline = true; }),
          tween(7, (W, k) => { W.bag.state = 'up'; W.bag.z = 0.3 + (PULLEY[2] - 1.6) * ease(k); }, { end: W => { W.bag.state = 'top'; } }),
          act('C', 'hold', 1)],
        [until(W => W.bag.state === 'up'), say('A', L('가방 아래 출입금지!', 'Keep out from under the bag!'), 2)],
        [until(W => W.bag.state === 'top'), act('B', 'reach', 1.6, { say: L('가방 수령 · 공구 줄 체결', 'Bag in · tools tethered') })]
      ],
      wrong: [
        { text: L('공구를 허리에 차고 한 번에 들고 오른다', 'Carry all the tools up on your belt'),
          why: L('무게 때문에 균형을 잃고, 떨어진 공구는 아래 사람을 칩니다. 달줄로 올립니다. (수칙 6)', 'The weight unbalances you and dropped tools hit people below. Use a hand line. (Rule 6)') },
        { text: L('보조자가 가방 바로 아래에서 줄을 당긴다', 'The helper pulls the line standing right under the bag'),
          why: L('매듭이 풀리면 바로 맞습니다. 줄을 비스듬히 끌어 낙하 반경 밖에 섭니다. (수칙 6)', 'If the knot fails he is hit. Pull at an angle from outside the radius. (Rule 6)') }
      ] },
    { id: 'twork', rules: [7],
      title: L('작업: 공구 줄 체결 상태로 점검', 'Work with tethered tools'),
      what: L('부재 변형·볼트 풀림을 점검합니다. 공구는 모두 낙하방지 줄로 몸이나 부재에 묶여 있고, 감시자는 무전으로 상태를 확인합니다.',
        'Inspect members for deformation and loose bolts. Every tool is tethered to the body or the tower; the watcher checks in by radio.'),
      why: L('작업에 집중하면 손에서 공구가 빠지는 것을 모릅니다.', 'Concentrating on the job, you do not notice a tool slipping.'),
      lanes: [
        [act('B', 'work', 8, { say: L('볼트 조임 · 부재 변형 점검', 'Bolt torque · member check') })],
        [wait(2), say('D', L('상태 이상 없나? — 이상 없음!', 'All OK up there? — All OK!'), 2.6), wait(2), say('A', L('공구 줄 체결 확인', 'Tool tethers — checked'), 2)]
      ],
      wrong: [
        { text: L('줄이 걸리적거려 공구 줄을 풀고 작업한다', 'The tethers get in the way — untie them'),
          why: L('떨어진 공구는 아래 사람에게 흉기가 됩니다. 줄은 항상 묶어 둡니다.', 'A dropped tool becomes a weapon for those below. Keep tethers on.') },
        { text: L('감시자도 같이 올라가 작업을 돕는다', 'The watcher climbs up to help'),
          why: L('아래에서 상황을 보는 사람이 없어집니다. 감시자는 지상에 남습니다.', 'Then nobody watches from below. The watcher stays on the ground.') }
      ] },
    { id: 'tdown', rules: [7, 5],
      title: L('하강 · 철수 (추락방지기 체결 후 랜야드 해제)', 'Descend and tear down (arrester on before the lanyard comes off)'),
      what: L('공구 가방을 달줄로 먼저 내리고, 추락방지기가 와이어에 걸린 것을 확인한 뒤에 랜야드를 풀고 천천히 내려옵니다. 지상에서 추락방지기를 풀고 라바콘을 거둡니다.',
        'Lower the tool bag first; make sure the arrester is on the wire, then unclip the lanyard and climb down slowly. Unclip the arrester on the ground and collect the cones.'),
      why: L('내려올 때도 올라갈 때와 같은 규칙입니다. 지친 상태라 더 위험합니다.', 'Coming down follows the same rules — and you are more tired.'),
      lanes: [
        [until(W => W.bag.state === 'ground'), act('B', 'work', 1.4, { say: L('추락방지기 체결 확인', 'Arrester on — checked') }),
          act('B', 'reach', 1.2, { say: L('랜야드 해제', 'Lanyard off'), end: W => { W.lanyard = false; } }),
          act('B', 'climb', 12, { fx: (W, k) => { const p = towerLeg(TW.workZ * (1 - k), 0.55); Object.assign(W.people.B, { x: p[0], y: p[1], z: p[2] }); }, end: W => { W.people.B.z = 0; } }),
          act('B', 'work', 1.2, { say: L('지상 — 추락방지기 해제', 'On the ground — arrester off'), end: W => { W.arrester = false; } }),
          go('B', -11, 6), set(W => { W.bOff = true; })],
        [tween(6, (W, k) => { W.bag.state = 'down'; W.bag.z = 0.3 + (PULLEY[2] - 1.6) * (1 - ease(k)); }, { end: W => { W.bag.state = 'ground'; W.bag.z = 0; } }),
          set(W => { W.people.C.tagline = false; }), go('C', -10.4, 5.6)],
        [until(W => W.bOff), say('A', L('인원 확인 — 모두 지상', 'Headcount — all on the ground'), 2.2), go('A', -12.5, 5.2)],
        [until(W => W.bOff), { w: 'E', dyn: W => W.cones.filter(c => c.placed).flatMap(c => [go('E', c.x, c.y), act('E', 'bend', 0.4, { end: () => { c.placed = false; } })]).concat([go('E', -9.8, 5.1)]) }]
      ],
      wrong: [
        { text: L('빨리 내려가려고 랜야드를 먼저 풀고 추락방지기를 건다', 'Unclip the lanyard first, then put the arrester on'),
          why: L('그 순간 아무것도 걸려 있지 않습니다. 언제나 새 고리 먼저. (수칙 7)', 'For that moment nothing holds you. New hook on first, always. (Rule 7)') },
        { text: L('공구 가방을 들고 함께 내려온다', 'Climb down carrying the tool bag'),
          why: L('한 손으로 내려오면 균형을 잃습니다. 가방은 달줄로 먼저 내립니다.', 'One-handed climbing loses balance. Lower the bag on the line first.') }
      ] }
  ];
}
