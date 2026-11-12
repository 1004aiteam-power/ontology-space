// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전공사 안전 시뮬레이션 — 시나리오: 배전 변압기 교체 (COS 개방, 본선 활선 유지) (safety.js 가 이 파일들을 묶어 내보낸다)
import { GEO, boomIK, STOW, lerpJ, L, ease, go, act, say, tween, until, set } from './core.js?v=a3a7c3c2';
import { poleWorld, person, poleSteps } from './scn-pole.js?v=9f79de89';

// ---- 시나리오: 배전 변압기 교체 (COS 개방, 본선 활선 유지) ----------------------------------------
// 전주 현장(작업차·고임목·아웃트리거)은 위 시나리오와 같고, 정전 범위는 COS로 변압기만 끊는다.
// 본선 고압선과 COS 전원측은 작업 내내 살아 있으므로 접근(1.2m)과 방호가 핵심
export const TX = { x: -0.4, y: 4.85, z0: 7.6, z1: 8.9, cos: [0, 4.55, 10.35], rod: [0.5, 5.0] };
const TXB = { near: [-1.6, 3.2, 6.6], work: [-0.9, 4.0, 7.3] };   // 버킷 바닥 목표 (검전·방호 / 교체)
export function txWorld() {
  const W = poleWorld();
  W.people.D = person(-18.0, 6.2);
  Object.assign(W, { cos: { closed: true, tag: false }, txTested: false, txEarth: false, txGround: false, hvCover: 0,
    txOld: { state: 'pole' }, dBack: true });
  W.load.kind = 'txnew'; W.load.type = 'tx'; W.insul = 'new';
  return W;
}
export function txSteps() {
  const G = GEO, base = poleSteps(), pick = (id) => base.find(s => s.id === id);
  const fin = pick('finish'), rear = G.park - G.truckLen / 2;
  const j = (W, a, b, k) => lerpJ(boomIK(W.truck, a), boomIK(W.truck, b), ease(k));
  return [
    { id: 'tbm', rules: [3],
      title: L('작업 전 TBM · 작업계획서 확인', 'Pre-work TBM · check the work plan'),
      what: L('작업책임자가 작업 내용(0번 전주 주상변압기 교체), COS로 끊는 정전 범위, 계속 살아 있는 본선 고압선, 역할을 설명합니다.',
        'The supervisor explains the job (replace the pole-mounted transformer on pole 0), the outage limited by the cut-out, the main HV line that stays live, and each role.'),
      why: L('본선이 살아 있는 작업은 "어디까지가 죽어 있나"를 모두가 같게 알아야 합니다.', 'With the main line still live, everyone must share the same picture of what is dead and what is not.'),
      lanes: [
        [say('A', L('오늘 작업: 0번 전주 변압기 교체', 'Today: replace the transformer on pole 0'), 3),
          say('A', L('정전 범위: COS 개방 → 변압기만', 'Outage: open the cut-out — transformer only'), 3),
          say('A', L('본선 고압선·COS 전원측은 살아 있음!', 'Main HV line & cut-out source side stay live!'), 3.2),
          set(W => { W.plan = true; }), say('A', L('각자 역할 확인!', 'Confirm your roles!'), 1.8)],
        [act('B', 'read', 12.8)], [act('C', 'read', 12.8)], [act('D', 'read', 12.8)], [act('E', 'read', 11), say('E', L('확인!', 'Confirmed!'), 1.6)]
      ],
      wrong: [
        { text: L('변압기만 바꾸는 간단한 작업이니 TBM 없이 시작한다', 'Only a transformer swap — start without a TBM'),
          why: L('본선은 살아 있습니다. 정전 범위를 모르는 사람이 한 명이라도 있으면 감전 사고로 이어집니다. (수칙 3)', 'The main line is live. One person unsure of the outage limits is enough for a shock accident. (Rule 3)') },
        { text: L('현장에서 보고 COS 대신 본선을 활선 상태로 작업하기로 바꾼다', 'On site, switch to working the main line live instead of using the cut-out'),
          why: L('공법 임의변경 금지. 계획과 다르게 해야 하면 작업을 멈추고 다시 계획합니다. (수칙 3)', 'No ad-hoc method changes. If the plan does not fit, stop and re-plan. (Rule 3)') }
      ] },
    pick('ppe'), pick('zone'), pick('reverse'), pick('chocks'), pick('outrig'),
    { id: 'cos', rules: [11],
      title: L('COS 개방 — 절연 조작봉 · 조작금지 표찰', 'Open the cut-out (COS) with a hot stick · tag it'),
      what: L('작업책임자가 절연장갑을 끼고 절연 조작봉으로 변압기 1차측 COS(컷아웃 스위치)를 열고 "조작금지" 표찰을 겁니다. 본선은 살아 있으므로 몸은 충분히 떨어져 있습니다.',
        "Wearing insulating gloves, the supervisor opens the transformer's cut-out with an insulated hot stick and tags it. The main line is live, so the body stays well clear."),
      why: L('COS는 충전부 바로 옆에 있습니다. 맨손·일반 막대로 조작하면 아크·감전 사고가 납니다.', 'The cut-out sits right next to live parts. Bare hands or improvised poles mean arc flash and shock.'),
      lanes: [
        [go('A', -9, 4.6), go('A', 1.4, 4.3), act('A', 'stick', 3, { stick: TX.cos, say: L('COS 개방!', 'Cut-out open!'), end: W => { W.cos.closed = false; } }),
          act('A', 'work', 1.5, { say: L('조작금지 표찰 부착', 'Tag attached'), end: W => { W.cos.tag = true; } }), go('A', -6, -0.8)]
      ],
      wrong: [
        { text: L('COS 퓨즈홀더를 장갑 낀 손으로 당겨 연다', 'Pull the fuse holder open with a gloved hand'),
          why: L('COS 투개방은 반드시 적정 공구(절연 조작봉)로 합니다. (수칙 11 배전)', 'Cut-outs are operated only with the proper tool — an insulated hot stick. (Rule 11, distribution)') },
        { text: L('본선 개폐기를 열어 마을 전체를 정전시키고 작업한다', 'Open the main switch and black out the whole area'),
          why: L('계획에 없는 정전 범위 변경입니다. 계획대로 COS로 변압기만 분리합니다. (수칙 3)', 'That is an unplanned change of outage. Isolate only the transformer with its cut-out as planned. (Rule 3)') }
      ] },
    { id: 'harness', rules: [7],
      title: L('안전대 안전고리 체결 → 버킷 상승', 'Clip the harness lanyard → raise the bucket'),
      what: L('버킷 작업자가 탑승해 안전고리를 걸고, 작업책임자가 확인한 뒤 버킷을 변압기 아래쪽, 고압선과 떨어진 위치로 올립니다.',
        'The bucket worker boards and clips in; after the supervisor checks, the bucket rises to a spot below the transformer and well clear of the HV line.'),
      why: L('고리를 걸지 않은 안전대는 소용이 없습니다. 붐이 움직일 때 가장 많이 흔들립니다.', 'An unclipped harness does nothing, and the bucket jolts most when the boom starts.'),
      lanes: [
        [go('B', -9, 4.6), go('B', rear - 0.7, 0.4), act('B', 'climb', 1.6, { end: W => { W.people.B.inBucket = true; } }),
          act('B', 'work', 1.4, { say: L('안전고리 체결', 'Lanyard clipped'), end: W => { W.people.B.hooked = true; } }),
          until(W => W.checkedHook), act('B', 'work', 6, { fx: (W, k) => { W.truck.boom = lerpJ(STOW, boomIK(W.truck, TXB.near), ease(k)); } })],
        [go('A', rear - 1.4, -0.6), until(W => W.people.B.hooked), say('A', L('고리 체결 확인 — 상승!', 'Hook checked — up!'), 2), set(W => { W.checkedHook = true; })]
      ],
      wrong: pick('harness').wrong },
    { id: 'txearth', rules: [8],
      title: L('변압기 쪽 검전 → 접지 (대지측 먼저)', 'Test the transformer side → earth it (earth end first)'),
      what: L('지상 보조가 전주 아래에 접지봉을 박아 대지측을 먼저 연결하고, 버킷 작업자가 검전기로 COS 아래쪽·변압기 1차 단자의 무전압을 확인한 뒤 접지 클램프를 겁니다.',
        "The ground helper drives the earth rod and connects the earth end first; the bucket worker proves the cut-out's load side and the transformer primary dead with a detector, then clamps the earth on."),
      why: L('COS가 열렸어도 퓨즈홀더가 덜 빠졌거나 저압측 역송전이 있을 수 있습니다.', 'An open cut-out can still be half-seated, and back-feed from the low-voltage side is possible.'),
      lanes: [
        [go('D', -12.5, 4.6), go('D', TX.rod[0] + 0.3, TX.rod[1] - 0.6), act('D', 'hammer', 2.2, { say: L('접지봉 · 대지측 먼저', 'Rod in — earth end first'), end: W => { W.txEarth = true; } }),
          go('D', -6, 5.2)],
        [act('B', 'stick', 1.8, { stick: [TX.cos[0], TX.cos[1], TX.cos[2] - 0.35], tool: 'detector' }),
          act('B', 'stick', 1.8, { stick: [TX.x, TX.y, TX.z1 + 0.15], tool: 'detector', say: L('변압기 1차 무전압 확인', 'Transformer primary dead'), end: W => { W.txTested = true; } }),
          until(W => W.txEarth),
          act('B', 'stick', 1.8, { stick: [TX.x, TX.y, TX.z1 + 0.15], tool: 'clamp', say: L('접지 클램프 체결', 'Earth clamp on'), end: W => { W.txGround = true; } })]
      ],
      wrong: [
        { text: L('COS를 열었으니 검전 없이 바로 변압기 단자를 만진다', 'The cut-out is open — touch the transformer terminals without testing'),
          why: L('덜 빠진 퓨즈홀더, 저압측 역송전으로 살아 있을 수 있습니다. 검전·접지 후 작업합니다. (수칙 8)', 'A half-seated fuse holder or LV back-feed can keep it live. Test and earth first. (Rule 8)') },
        { text: L('접지 클램프를 먼저 걸고 접지봉은 나중에 박는다', 'Clamp the earth on first, drive the rod later'),
          why: L('대지측이 먼저 연결되어야 선로가 살아 있어도 사람을 통해 흐르지 않습니다.', 'The earth end must be connected first so a live line never discharges through a person.') }
      ] },
    { id: 'hvcover', rules: [8],
      title: L('충전부 방호: 살아 있는 COS 전원측 · 고압 인하선', 'Cover live parts: the cut-out source side and HV drop'),
      what: L('COS 위쪽(전원측)과 고압선에서 내려오는 인하선은 작업 내내 살아 있습니다. 버킷 작업자가 절연봉으로 절연 커버·방호관을 씌우고, 고압선과 1.2m 이상 떨어져 작업합니다.',
        "The cut-out's source side and the HV drop above it stay live throughout. The bucket worker fits insulating covers with a hot stick and keeps at least 1.2 m from the HV line."),
      why: L('같은 전주에 죽은 부분과 산 부분이 함께 있습니다. 몸이 닿을 수 있는 산 부분은 모두 덮습니다.', 'Dead and live parts share the same pole. Cover every live part your body could reach.'),
      lanes: [
        [act('B', 'stick', 2.2, { stick: [TX.cos[0], TX.cos[1], TX.cos[2] + 0.35], tool: 'stick', say: L('COS 전원측 커버', 'Cover on cut-out source side'), fx: (W, k) => { W.hvCover = 0.5 * k; } }),
          act('B', 'stick', 2.2, { stick: [0, G.phaseY[0], G.armZ + 0.1], tool: 'stick', say: L('인하선·가까운 상 방호관', 'Hose on drop & nearest phase'), fx: (W, k) => { W.hvCover = 0.5 + 0.5 * k; } })],
        [say('A', L('고압선 1.2m 이내 접근 금지', 'Stay 1.2 m from the HV line'), 2.4)]
      ],
      wrong: [
        { text: L('COS를 열었으니 전주 위는 전부 정전이라고 보고 작업한다', 'The cut-out is open, so treat the whole pole top as dead'),
          why: L('COS 전원측과 본선은 살아 있습니다. 산 부분은 방호합니다. (수칙 8)', 'The source side and main line are live. Cover live parts. (Rule 8)') },
        { text: L('방호 커버는 손으로 씌우는 게 빠르다', 'Fitting the covers by hand is quicker'),
          why: L('살아 있는 부분에는 절연봉으로 다가갑니다. 손으로 다가가면 접근한계거리를 넘습니다.', 'Approach live parts with a hot stick; reaching by hand breaks the minimum approach distance.') }
      ] },
    { id: 'txlift', rules: [6],
      title: L('변압기 인양 교체 · 인양물 하부 출입금지', 'Swap the transformer on the hook · nobody beneath it'),
      what: L('리드선을 분리하고 헌 변압기를 지브 훅(해지장치 확인)에 걸어 내린 뒤, 새 변압기를 올려 고정·결선합니다. 지상 작업자는 유도 로프만 잡고 낙하 반경 밖에 섭니다.',
        'Disconnect the leads, lower the old transformer on the latched jib hook, then lift the new one and bolt and connect it. The ground worker holds only the tag line, outside the drop radius.'),
      why: L('변압기는 수백 kg입니다. 매달린 물건 아래는 언제나 출입금지입니다.', 'A transformer weighs hundreds of kilograms. Never stand under a suspended load.'),
      lanes: [
        [act('B', 'work', 3, { fx: (W, k) => { W.truck.boom = j(W, TXB.near, TXB.work, k); } }),
          act('B', 'reach', 2.4, { say: L('리드선 분리 · 훅 체결', 'Leads off · hook on'), end: W => { W.txOld.state = 'hook'; W.truck.hookDrop = 0.08; } }),
          until(W => W.people.C.tagline), say('A', L('인양물 하부 출입금지!', 'Clear the area under the load!'), 2),
          tween(5, (W, k) => { W.truck.hookDrop = 0.08 + 0.92 * ease(k); }, { end: W => { W.txOld.state = 'down'; } }),
          until(W => W.load.state === 'hook' && W.people.C.tagline),
          tween(5, (W, k) => { W.truck.hookDrop = 1 - 0.92 * ease(k); }),
          act('B', 'reach', 4, { say: L('브래킷 고정 · 리드선 결선', 'Bolt on · connect leads'), end: W => { W.load.state = 'pole'; W.truck.hookDrop = 0; } })],
        [go('C', G.park - 0.6, 0.2), act('C', 'work', 2, { say: L('새 변압기 하역', 'Unload the new transformer'), end: W => { W.load.state = 'ground'; } }),
          go('C', -4.4, 1.0), set(W => { W.people.C.tagline = true; }), act('C', 'hold', 1),
          until(W => W.txOld.state === 'down'), set(W => { W.people.C.tagline = false; }), go('C', -1.6, 3.6),
          act('C', 'bend', 2, { say: L('헌 변압기 분리 · 새 변압기 훅 체결', 'Old one off · new one on the hook'), end: W => { W.txOld.state = 'aside'; } }),
          go('C', -4.4, 1.0), set(W => { W.people.C.tagline = true; W.load.state = 'hook'; }), act('C', 'hold', 1),
          until(W => W.load.state === 'pole'), set(W => { W.people.C.tagline = false; })]
      ],
      wrong: [
        { text: L('변압기를 받으려고 지상 작업자가 전주 바로 아래에서 기다린다', 'The ground worker waits right under the pole to receive it'),
          why: L('훅·슬링이 풀리면 수백 kg이 떨어집니다. 유도 로프로 낙하 반경 밖에서 잡습니다. (수칙 6)', 'If the hook or sling lets go, hundreds of kilograms fall. Hold the tag line from outside the radius. (Rule 6)') },
        { text: L('해지장치 없는 훅으로 빨리 내린다', 'Lower it fast on a hook without a safety latch'),
          why: L('흔들릴 때 슬링이 빠집니다. 고정장치를 확인한 뒤 인양합니다. (수칙 6)', 'The sling jumps off when it swings. Check the securing device first. (Rule 6)') }
      ] },
    { id: 'txfinish', rules: [8, 11, 5],
      title: L('작업 완료 · 역순 철수 (방호·접지 제거 → COS 투입)', 'Finish · tear down in reverse (covers & earth off → close the cut-out)'),
      what: L('방호 커버 제거 → 접지 제거(선로 측 먼저, 대지측 나중) → 버킷 하강·하차 → 인원 확인 후 절연 조작봉으로 COS 투입 → 저압 전압 확인 → 아웃트리거·고임목·라바콘 회수.',
        'Covers off → earth off (line end first, earth end last) → bucket down, worker out → after a headcount, close the cut-out with a hot stick → check the LV voltage → outriggers, chocks and cones in.'),
      why: L('접지를 단 채 COS를 넣으면 단락·아크가 납니다. 사람이 위에 있을 때 넣어서도 안 됩니다.', 'Closing the cut-out into an earth causes a fault and arc — and never with someone still aloft.'),
      lanes: [
        [act('B', 'work', 3, { say: L('변압기에서 물러나기', 'Back away from the transformer'), fx: (W, k) => { W.truck.boom = j(W, TXB.work, TXB.near, k); } }),
          act('B', 'stick', 2.4, { stick: [TX.cos[0], TX.cos[1], TX.cos[2] + 0.35], tool: 'stick', say: L('방호 커버 제거', 'Covers off'), fx: (W, k) => { W.hvCover = 1 - k; } }),
          act('B', 'stick', 1.8, { stick: [TX.x, TX.y, TX.z1 + 0.15], tool: 'clamp', say: L('접지: 선로 측 먼저', 'Earth: line end first'), end: W => { W.txGround = false; } }),
          act('B', 'work', 6, { fx: (W, k) => { W.truck.boom = lerpJ(boomIK(W.truck, TXB.near), STOW, ease(k)); }, end: W => { W.truck.boom = { ...STOW }; } }),
          act('B', 'work', 1, { end: W => { W.people.B.hooked = false; } }),
          act('B', 'climb', 1.4, { end: W => { const b = W.people.B; b.inBucket = false; b.x = rear - 0.8; b.y = 0.3; b.z = 0; } }),
          go('B', -9, 4.6), set(W => { W.bOff = true; })],
        [until(W => !W.txGround), go('D', TX.rod[0] + 0.3, TX.rod[1] - 0.6), act('D', 'work', 1.6, { say: L('대지측은 마지막에', 'Earth end last'), end: W => { W.txEarth = false; } }), go('D', -10, 4.6)],
        [until(W => W.bOff && !W.txEarth), say('A', L('인원 확인 — 접지 제거 확인', 'Headcount — earth removed'), 2.2), go('A', 1.4, 4.3),
          act('A', 'work', 1, { end: W => { W.cos.tag = false; } }),
          act('A', 'stick', 2.6, { stick: TX.cos, say: L('COS 투입 — 저압 전압 확인', 'Cut-out closed — check LV'), end: W => { W.cos.closed = true; } }),
          go('A', -6, -0.8), go('A', -14, 4.6)],
        [until(W => W.cos.closed), ...fin.lanes[3]],
        [until(W => W.cos.closed), ...fin.lanes[4]]
      ],
      wrong: [
        { text: L('끝났으니 접지를 단 채로 먼저 COS를 넣어 본다', 'Done — close the cut-out first, remove the earth later'),
          why: L('접지에 바로 전기를 넣는 단락입니다. 접지 제거·인원 확인 후 투입합니다. (수칙 8)', 'That energises straight into the earth. Remove earths and count people first. (Rule 8)') },
        { text: L('버킷에 작업자가 있는 채로 COS를 넣는다', 'Close the cut-out with the worker still in the bucket'),
          why: L('결선이 잘못됐으면 위에 있는 사람이 위험합니다. 모두 내려온 뒤 투입합니다.', 'If a connection is wrong, whoever is aloft is at risk. Close only when everyone is down.') }
      ] }
  ];
}
