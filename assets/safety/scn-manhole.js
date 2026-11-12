// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 — 시나리오: 지중 배전 맨홀 (밀폐공간) (safety.js 가 이 파일들을 묶어 내보낸다)
import { GEO, STOW, L, dist2, conesAround, go, act, say, until, set, wait } from './core.js?v=a3a7c3c2';
import { person } from './scn-pole.js?v=9f79de89';

// ---- 시나리오: 지중 배전 맨홀 ---------------------------------------------------------------
const GAS_BAD = { o2: 17.2, h2s: 14, co: 22 };
export const GAS_GOOD = { o2: 20.9, h2s: 0, co: 2 };
export const GAS_LIMIT = { o2min: 18, o2max: 23.5, h2s: 10, co: 30 };   // 산업안전보건기준에 관한 규칙 제618조 '적정공기'
export const gasOK = (g) => g.o2 >= GAS_LIMIT.o2min && g.o2 < GAS_LIMIT.o2max && g.h2s < GAS_LIMIT.h2s && g.co < GAS_LIMIT.co;

export function manholeWorld() {
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
export function manholeSteps() {
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
