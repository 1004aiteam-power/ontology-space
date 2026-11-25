// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 분산에너지 · VPP 통신 모형: 배전 운영자의 수요반응 요청이 OpenADR → IEEE 2030.5 → OCPP · Modbus 를 거쳐
// 현장 장비까지 내려가고, 계측값이 거꾸로 올라오는 하루. 메시지 이름은 각 규격의 것을 썼고, 내용은 줄였다.
// 현장: 건물 부하 + 전기차 충전기 6기 + 지붕 태양광 + ESS. 1분 단위 전력 흐름을 계산. 테스트: tests/ot.test.mjs

export const ACTORS = [
  { id: 'dso', ko: '배전 운영자 (DERMS)', en: 'Distribution operator (DERMS)' },
  { id: 'vpp', ko: 'VPP 플랫폼 (중개사업자)', en: 'VPP platform (aggregator)' },
  { id: 'gw', ko: '현장 게이트웨이 (EMS)', en: 'Site gateway (EMS)' },
  { id: 'evse', ko: '전기차 충전기 6기', en: '6 EV chargers' },
  { id: 'ess', ko: 'ESS (PCS)', en: 'Battery (PCS)' },
  { id: 'pv', ko: '태양광 인버터', en: 'PV inverter' },
  { id: 'meter', ko: '전력량계', en: 'Meter' }
];
export const PROTO = {
  openadr: { name: 'OpenADR 2.0b', ko: '수요반응 신호 (VTN → VEN)', en: 'Demand-response signals (VTN → VEN)' },
  '2030.5': { name: 'IEEE 2030.5', ko: 'DER 제어 · 계측 (REST)', en: 'DER control and metering (REST)' },
  ocpp: { name: 'OCPP 1.6J', ko: '충전기 ↔ 관리 시스템 (WebSocket · JSON)', en: 'Charger ↔ management system (WebSocket · JSON)' },
  modbus: { name: 'Modbus TCP', ko: '현장 장비 레지스터 (SunSpec)', en: 'Field device registers (SunSpec)' }
};
export const EVENT = { start: 17 * 60, end: 18 * 60, shed: 150 };    // 17:00~18:00 에 150 kW 줄이기 (분 단위)
export const ESS = { pmax: 100, kwh: 200 };
export const EVSE = { n: 6, kw: 25 };

const M = (t, from, to, proto, name, ko, en, body, x = {}) => ({ t, from, to, proto, name, ko, en, body, ...x });
const hm = (min, s = 0) => min * 60 + s;
/** 하루의 메시지 (초 단위 시각). opt: { evseOffline, lowSoc } */
export function messages({ evseOffline = false, lowSoc = false } = {}) {
  const S = EVENT.start, E = EVENT.end, L = [];
  L.push(M(hm(14 * 60), 'dso', 'vpp', 'openadr', 'oadrDistributeEvent', '내일이 아니라 오늘 17:00~18:00, 이 지역 부하를 줄여 달라는 수요반응 이벤트', 'A demand-response event: shed load in this area today 17:00–18:00',
    `<oadrEvent>\n  <eventDescriptor><eventID>dr-0412</eventID><priority>1</priority></eventDescriptor>\n  <activePeriod><dtstart>17:00</dtstart><duration>PT1H</duration></activePeriod>\n  <eventSignal><signalName>LOAD_DISPATCH</signalName><signalType>delta</signalType>\n    <currentValue>-${EVENT.shed}</currentValue><!-- kW --></eventSignal>\n</oadrEvent>`, { req: 'dr' }));
  L.push(M(hm(14 * 60, 20), 'vpp', 'dso', 'openadr', 'oadrCreatedEvent', '참여하겠다(optIn)는 응답', 'Reply: we opt in',
    `<oadrCreatedEvent>\n  <eventResponse><responseCode>200</responseCode>\n    <eventID>dr-0412</eventID><optType>optIn</optType></eventResponse>\n</oadrCreatedEvent>`, { res: 'dr' }));
  L.push(M(hm(14 * 60 + 5), 'gw', 'vpp', '2030.5', 'GET /derp/1/derc', '게이트웨이가 주기적으로 "나에게 온 DER 제어가 있나" 묻습니다 (2030.5는 현장이 서버에 묻는 방식)', 'The gateway polls "any DER controls for me?" (in 2030.5 the field device asks the server)',
    'GET /derp/1/derc HTTP/1.1\nHost: vpp.example\nAccept: application/sep+xml', { req: 'derc' }));
  L.push(M(hm(14 * 60 + 5, 1), 'vpp', 'gw', '2030.5', 'DERControl', '17:00부터 1시간, 계통에서 받는 전력을 평소보다 150 kW 줄이라는 제어 (VPP가 여러 현장에 나눈 몫)', 'A control: from 17:00 for an hour, draw 150 kW less from the grid than usual (this site\'s share)',
    `<DERControl>\n  <mRID>c-77</mRID>\n  <interval><start>17:00</start><duration>3600</duration></interval>\n  <DERControlBase><opModTargetW><value>-${EVENT.shed}</value><multiplier>3</multiplier></opModTargetW></DERControlBase>\n</DERControl>`, { res: 'derc' }));
  L.push(M(hm(14 * 60 + 5, 2), 'gw', 'vpp', '2030.5', 'POST /rsp (Response)', '"받았음"(상태 1) 응답', 'Response: "event received" (status 1)', '<Response><status>1</status><subject>c-77</subject></Response>'));
  L.push(M(hm(S), 'gw', 'evse', 'ocpp', 'SetChargingProfile', evseOffline ? '충전기들에 충전 한도를 보내려 했지만 충전기 쪽 WebSocket 연결이 끊겨 있어 전달되지 않음' : '충전기 6기에 "기당 최대 15 kW"로 줄이는 충전 프로필', evseOffline ? 'Tried to send the charging limit, but the chargers\' WebSocket connection is down: not delivered' : 'A charging profile capping each of the 6 chargers at 15 kW',
    `[2, "81", "SetChargingProfile", {\n  "connectorId": 0,\n  "csChargingProfiles": {\n    "chargingProfileId": 12, "stackLevel": 1,\n    "chargingProfilePurpose": "TxDefaultProfile",\n    "chargingProfileKind": "Absolute",\n    "chargingSchedule": { "chargingRateUnit": "W",\n      "chargingSchedulePeriod": [{ "startPeriod": 0, "limit": 15000 }] } } }]`, { req: 'cp', lost: evseOffline }));
  if (!evseOffline) L.push(M(hm(S, 1), 'evse', 'gw', 'ocpp', 'CallResult', '"Accepted"', '"Accepted"', '[3, "81", { "status": "Accepted" }]', { res: 'cp' }));
  L.push(M(hm(S, 1), 'gw', 'ess', 'modbus', 'Write Multiple Registers (FC 16)', `ESS에 방전 목표 출력을 씀 (최대 ${ESS.pmax} kW)`, `Write the discharge set-point to the battery (up to ${ESS.pmax} kW)`, `01 10 00 14 00 02 04 00 01 FF 9C …\n(WSetEna = 1, WSet = -100 kW: discharge)`, { req: 'ess' }));
  L.push(M(hm(S, 1), 'ess', 'gw', 'modbus', 'FC 16 reply', '쓰기 확인', 'Write acknowledged', '01 10 00 14 00 02 …', { res: 'ess' }));
  for (let m = S; m <= E; m += 15) L.push(M(hm(m, 5), 'gw', 'meter', 'modbus', 'Read Holding Registers (FC 3)', '전력량계에서 지금 수전 전력을 읽음', 'Read the present grid import from the meter', '01 03 9C 8B 00 02 …', { quiet: m !== S }));
  for (let m = S + 15; m <= E; m += 15) L.push(M(hm(m, 10), 'gw', 'vpp', '2030.5', 'POST MirrorMeterReading', '15분마다 계측값을 VPP로 올림', 'Upload meter readings every 15 minutes', `<MirrorMeterReading>\n  <Reading><timePeriod><start>${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}</start></timePeriod><value>…</value></Reading>\n</MirrorMeterReading>`, { quiet: m !== S + 15 }));
  const empty = lowSoc ? series({ evseOffline, lowSoc }).rows.find(r => r.m > S + 1 && r.target !== null && r.soc <= 0.0501) : null;
  if (empty) L.push(M(hm(empty.m), 'ess', 'gw', 'modbus', 'FC 3 reply (SoC)', 'ESS 잔량이 바닥(5%)에 닿아 방전이 멈춤', 'The battery reached its floor (5% SoC) and stopped discharging', '… ChaState = 5 %', {}));
  L.push(M(hm(E + 0, 2), 'vpp', 'dso', 'openadr', 'oadrUpdateReport', '이벤트 동안의 15분 단위 감축량 보고', 'Report the 15-minute reductions during the event', '<oadrUpdateReport>\n  <oadrReport><reportName>TELEMETRY_USAGE</reportName> … </oadrReport>\n</oadrUpdateReport>'));
  L.push(M(hm(E, 3), 'gw', 'evse', 'ocpp', 'ClearChargingProfile', evseOffline ? '(연결이 끊겨 보내지 못함)' : '충전 한도를 풀어 원래대로', evseOffline ? '(not sent: connection down)' : 'Remove the cap: back to normal', '[2, "82", "ClearChargingProfile", { "id": 12 }]', { lost: evseOffline }));
  L.push(M(hm(E, 3), 'gw', 'ess', 'modbus', 'Write Single Register (FC 6)', 'ESS 방전 끝 (WSetEna = 0)', 'Stop discharging (WSetEna = 0)', '01 06 00 14 00 00 …'));
  return L.sort((a, b) => a.t - b.t);
}

/** 16:00~19:00 1분 단위 전력 (kW). 반환: [{ m, building, pv, evDemand, ev, ess, grid, base, target }], 성과 */
export function series({ evseOffline = false, lowSoc = false } = {}) {
  const out = [];
  let soc = lowSoc ? 0.25 : 0.9;                                                 // ESS 잔량 (0~1). 바닥은 5%
  for (let m = 16 * 60; m < 19 * 60; m++) {
    const h = m / 60;
    const building = 250 + 30 * Math.sin((h - 16) * 1.3) + (m % 7) * 1.5;
    const pv = Math.max(0, 85 * Math.cos((h - 13) / 6.5 * Math.PI / 2));
    const evDemand = Math.min(EVSE.n * EVSE.kw, 120 + 30 * Math.sin((h - 16.5) * 2));
    const base = building + evDemand - pv;
    const on = m >= EVENT.start && m < EVENT.end;
    const capOk = on && !evseOffline && m >= EVENT.start + 1;                  // 충전기는 프로필을 받고 1분쯤 뒤 반영
    const ev = capOk ? Math.min(evDemand, EVSE.n * 15) : evDemand;
    let ess = 0;
    if (on) {
      const need = Math.max(0, (building + ev - pv) - (base - EVENT.shed));       // 목표까지 더 줄여야 하는 양
      const avail = Math.max(0, (soc - 0.05) * ESS.kwh * 60);                  // 이번 1분에 꺼낼 수 있는 kW (에너지 한도)
      ess = Math.min(ESS.pmax, need, avail);
      soc -= ess / 60 / ESS.kwh;
    }
    out.push({ m, building, pv, evDemand, ev, ess, grid: building + ev - pv - ess, base, target: on ? base - EVENT.shed : null, soc });
  }
  const ev = out.filter(x => x.target !== null);
  const shed = ev.map(x => x.base - x.grid);
  return { rows: out, perf: { avgShed: shed.reduce((s, x) => s + x, 0) / shed.length, pct: shed.reduce((s, x) => s + Math.min(x, EVENT.shed), 0) / (EVENT.shed * shed.length), minShed: Math.min(...shed), essKwh: ev.reduce((s, x) => s + x.ess / 60, 0) } };
}
