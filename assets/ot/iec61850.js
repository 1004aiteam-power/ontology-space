// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// IEC 61850 모형: ① 장치(IED) → 논리 장치 → 논리 노드 → 데이터 객체 → 데이터 속성의 이름 체계와 CIM 대응
//                 ② GOOSE 트립: 상태가 바뀌면 곧바로 보내고 2 · 4 · 8 … ms 간격으로 되풀이하는 재전송, 손실 · 감시
// 이름과 기능 제약(FC)은 IEC 61850-7-4 의 논리 노드를 따랐고, 장치 구성은 가상의 것. 테스트: tests/ot.test.mjs
import { mulberry32 } from '../lib/rng.js?v=73d9551d';

const DA = (name, fc, type, ko, en, cim = null, val = null) => ({ name, fc, type, ko, en, cim, val });
export const IED = {
  name: 'E1Q1SB1', ko: '22.9 kV 배전선로 보호 · 제어 장치', en: '22.9 kV feeder protection and control IED',
  lds: [
    { inst: 'PROT', ko: '보호', en: 'Protection', lns: [
      { ln: 'PTOC1', cls: 'PTOC', ko: '시한 과전류 보호', en: 'Time overcurrent protection', cim: 'cim:CurrentRelay (ProtectionEquipment)', dos: [
        { name: 'Str', ko: '기동 (고장 감지 시작)', en: 'Start (pickup)', das: [DA('general', 'ST', 'BOOLEAN', '기동했는가', 'Started?', null, false)] },
        { name: 'Op', ko: '동작 (트립 명령)', en: 'Operate (trip)', das: [DA('general', 'ST', 'BOOLEAN', '트립을 냈는가', 'Tripped?', null, false), DA('t', 'ST', 'Timestamp', '동작 시각', 'Operate time')] },
        { name: 'StrVal', ko: '기동 값', en: 'Start value', das: [DA('setMag.f', 'SG', 'FLOAT32', '동작 전류 설정 (A)', 'Pickup current setting (A)', 'cim:CurrentRelay.currentLimit1', 600)] }] },
      { ln: 'PTRC1', cls: 'PTRC', ko: '트립 조건 모음', en: 'Trip conditioning', dos: [
        { name: 'Tr', ko: '트립 출력', en: 'Trip output', das: [DA('general', 'ST', 'BOOLEAN', '차단기로 보낼 트립', 'Trip to the breaker', null, false)] }] }] },
    { inst: 'CTRL', ko: '제어', en: 'Control', lns: [
      { ln: 'XCBR1', cls: 'XCBR', ko: '차단기 (CB-101)', en: 'Circuit breaker (CB-101)', cim: 'cim:Breaker', dos: [
        { name: 'Pos', ko: '개폐 상태', en: 'Position', das: [DA('stVal', 'ST', 'Dbpos', '중간 · 열림 · 닫힘 · 불량', 'intermediate · off · on · bad', 'cim:Discrete (SwitchPosition) → cim:Switch.open', 'on'), DA('q', 'ST', 'Quality', '값의 품질', 'Quality of the value'), DA('t', 'ST', 'Timestamp', '바뀐 시각', 'Time of change')] },
        { name: 'OpCnt', ko: '동작 횟수', en: 'Operation counter', das: [DA('stVal', 'ST', 'INT32', '지금까지 열고 닫은 횟수', 'Operations so far', 'cim:Switch.switchOnCount', 1287)] },
        { name: 'BlkOpn', ko: '열기 막음', en: 'Block opening', das: [DA('stVal', 'ST', 'BOOLEAN', '열기가 막혔는가', 'Opening blocked?', null, false)] }] },
      { ln: 'CSWI1', cls: 'CSWI', ko: '개폐 제어', en: 'Switch controller', dos: [
        { name: 'Pos', ko: '개폐 명령', en: 'Position control', das: [DA('ctlVal', 'CO', 'BOOLEAN', '열기(false) · 닫기(true) 명령', 'Open (false) · close (true) command'), DA('stVal', 'ST', 'Dbpos', '명령 뒤 상태', 'Resulting position')] }] },
      { ln: 'XSWI1', cls: 'XSWI', ko: '단로기 (DS-101)', en: 'Disconnector (DS-101)', cim: 'cim:Disconnector', dos: [
        { name: 'Pos', ko: '개폐 상태', en: 'Position', das: [DA('stVal', 'ST', 'Dbpos', '열림 · 닫힘', 'off · on', 'cim:Discrete (SwitchPosition) → cim:Switch.open', 'on')] }] }] },
    { inst: 'MEAS', ko: '계측', en: 'Measurement', lns: [
      { ln: 'MMXU1', cls: 'MMXU', ko: '3상 계측', en: 'Three-phase measurement', cim: 'cim:Analog (measurementType)', dos: [
        { name: 'TotW', ko: '3상 유효전력', en: 'Total active power', das: [DA('mag.f', 'MX', 'FLOAT32', '값 (W)', 'Value (W)', 'cim:Analog "ThreePhaseActivePower"', 4.21e6)] },
        { name: 'A', ko: '상전류', en: 'Phase currents', das: [DA('phsA.cVal.mag.f', 'MX', 'FLOAT32', 'A상 전류 (A)', 'Phase A current (A)', 'cim:Analog "LineCurrent" (phases = A)', 182.4)] },
        { name: 'PhV', ko: '상전압', en: 'Phase voltages', das: [DA('phsA.cVal.mag.f', 'MX', 'FLOAT32', 'A상 전압 (V)', 'Phase A voltage (V)', 'cim:Analog "PhaseVoltage" (phases = A)', 13221)] },
        { name: 'Hz', ko: '주파수', en: 'Frequency', das: [DA('mag.f', 'MX', 'FLOAT32', '값 (Hz)', 'Value (Hz)', 'cim:Analog "Frequency"', 59.98)] }] }] }
  ]
};
export const FCS = { ST: { ko: '상태', en: 'status' }, MX: { ko: '계측값', en: 'measurand' }, CO: { ko: '제어', en: 'control' }, SG: { ko: '설정 그룹', en: 'setting group' } };

/** 객체 참조 (IEC 61850-7-2): IED이름 + 논리장치 / 논리노드 . 데이터객체 . 데이터속성 */
export const ref = (ld, ln, dO, da) => `${IED.name}${ld}/${ln}.${dO}.${da}`;
/** MMS 이름 (IEC 61850-8-1): 논리노드$FC$데이터객체$데이터속성 (점은 $ 로) */
export const mms = (ld, ln, dO, da, fc) => `${IED.name}${ld}/${ln}$${fc}$${dO}$${da.replace(/\./g, '$')}`;
/** 트리의 모든 데이터 속성을 평평하게 */
export const leaves = () => IED.lds.flatMap(l => l.lns.flatMap(n => n.dos.flatMap(d => d.das.map(a => ({ ld: l.inst, ln: n.ln, cls: n.cls, dO: d.name, da: a, ref: ref(l.inst, n.ln, d.name, a.name), mms: mms(l.inst, n.ln, d.name, a.name, a.fc) })))));

/**
 * GOOSE 트립 시간축 (ms). 고장 시각 0.
 * opt: { det (고장 감지까지), delay (의도한 시간 지연), tmin (첫 재전송 간격), t0 (평상시 간격), loss (메시지 손실 확률), cut (보낸 쪽 선이 끊김: true 면 고장 전 300 ms 부터 아무것도 안 감), seed, net (전달 지연), mech (차단기가 열리는 기계 시간) }
 * 반환: { msgs: [{ t, st, sq, val, lost, ttl }], tOp, tRx, tOpen, transfer, alarm, wire }
 */
export function goose({ det = 18, delay = 0, tmin = 2, t0 = 1000, loss = 0, cut = false, seed = 1, net = 0.2, mech = 40 } = {}) {
  const rand = mulberry32(seed), msgs = [];
  const tOp = det + delay;
  let st = 7, sq = 0;
  const pub = (t, val, interval) => { const lost = (cut && t >= -300) || rand() < loss; msgs.push({ t, st, sq, val, lost, ttl: 2 * interval }); sq++; };
  for (let t = -2 * t0; t < tOp; t += t0) pub(t, false, t0);                     // 평상시: t0 마다 같은 내용 (sqNum 만 증가)
  st++; sq = 0;                                                                  // 상태가 바뀜 → stNum 증가, sqNum 0
  let iv = tmin, t = tOp;
  pub(t, true, iv);
  while (t + iv <= tOp + 3 * t0) { t += iv; pub(t, true, Math.min(iv * 2, t0)); iv = Math.min(iv * 2, t0); }
  const first = msgs.find(m => m.st === st && !m.lost);
  const r2 = (x) => Math.round(x * 100) / 100;
  const tRx = first ? r2(first.t + net) : null;
  const tOpen = tRx === null ? null : tRx + 1 + mech;                            // 받은 뒤 트립 코일까지 1 ms, 그다음 기계 시간
  // 감시: 받는 쪽은 마지막으로 받은 메시지의 TAL(유효 시간) 안에 다음 것이 오지 않으면 경보
  let alarm = null, lastOk = null;
  for (const m of msgs) {
    if (lastOk && m.t + net > lastOk.t + net + lastOk.ttl && alarm === null) alarm = lastOk.t + net + lastOk.ttl;
    if (!m.lost) lastOk = m;
  }
  if (lastOk && alarm === null && lastOk.t + lastOk.ttl < msgs[msgs.length - 1].t) alarm = lastOk.t + net + lastOk.ttl;
  const wire = { tRx: tOp + 4, tOpen: tOp + 4 + 1 + mech };                     // 구리선 배선: 보호계전기 출력 접점이 닫히는 데 4 ms 쯤
  return { msgs, tOp, tRx, tOpen, transfer: tRx === null ? null : r2(tRx - tOp), alarm: alarm === null ? null : r2(alarm), wire, st };
}
