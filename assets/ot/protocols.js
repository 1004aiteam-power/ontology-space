// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 산업·전력 통신 지도: 퍼듀 모델의 층과 그 사이를 오가는 규약들. 연도는 첫 공개 · 표준 발행의 대략적인 해. 테스트: tests/ot.test.mjs

export const LEVELS = [
  { n: 5, ko: '5층 · 외부 연계', en: 'Level 5 · external', ex: { ko: 'VPP 클라우드, 전력시장, 충전 로밍, 인터넷', en: 'VPP cloud, power market, charging roaming, internet' } },
  { n: 4, ko: '4층 · 업무 IT', en: 'Level 4 · business IT', ex: { ko: '자산관리 · 요금 · ERP, 사무망', en: 'Asset management, billing, ERP, office network' } },
  { n: 3.5, ko: 'DMZ (경계)', en: 'DMZ (boundary)', ex: { ko: '방화벽 · 데이터 다이오드 · 중계 서버', en: 'Firewalls, data diodes, relay servers' } },
  { n: 3, ko: '3층 · 운영', en: 'Level 3 · operations', ex: { ko: '급전 · 배전 운영 SCADA/EMS/DMS, DERMS, 이력 DB', en: 'Transmission and distribution SCADA/EMS/DMS, DERMS, historians' } },
  { n: 2, ko: '2층 · 감시 · 제어', en: 'Level 2 · supervisory control', ex: { ko: '변전소 HMI · 게이트웨이, 현장 EMS', en: 'Substation HMI and gateway, site EMS' } },
  { n: 1, ko: '1층 · 제어 장치', en: 'Level 1 · controllers', ex: { ko: '보호계전기(IED), PLC, RTU, 인버터 제어기, 충전기', en: 'Protection relays (IEDs), PLCs, RTUs, inverter controllers, chargers' } },
  { n: 0, ko: '0층 · 공정 · 현장 기기', en: 'Level 0 · process', ex: { ko: '센서, 계기용 변성기 · 병합 장치, 차단기 구동부', en: 'Sensors, instrument transformers and merging units, breaker drives' } }
];

const P = (id, name, year, levels, transport, style, time, security, page, ko, en) => ({ id, name, year, levels, transport, style, time, security, page, ko, en });
export const PROTOCOLS = [
  P('modbus', 'Modbus RTU / TCP', 1979, [0, 1, 2], 'RS-485 · TCP 502', 'poll', 's', 'none', 'ot-modbus.html', '레지스터 읽기 · 쓰기. 단순해서 거의 모든 장비가 지원', 'Read and write registers. So simple nearly every device supports it'),
  P('dnp3', 'DNP3 (IEEE 1815)', 1993, [1, 2, 3], 'serial · TCP 20000', 'event', 's', 'optional', 'ot-dnp3.html', '사건과 ms 시각, 무응답 보고. 북미 전력 · 수도 SCADA', 'Events with ms timestamps, unsolicited reports. North American power and water SCADA'),
  P('iec104', 'IEC 60870-5-104', 2000, [1, 2, 3], 'TCP 2404', 'event', 's', 'optional', 'ot-dnp3.html', 'DNP3와 같은 뿌리. 유럽 · 아시아의 원격 감시', 'Same roots as DNP3. Telecontrol in Europe and Asia'),
  P('mms', 'IEC 61850 MMS', 2004, [1, 2, 3], 'TCP 102', 'cs', 's', 'optional', 'ot-61850.html', '이름이 정해진 데이터 모델 읽기 · 보고서 · 제어', 'Read a named data model, reports, controls'),
  P('goose', 'IEC 61850 GOOSE', 2004, [1], 'Ethernet (0x88B8)', 'pubsub', 'ms', 'optional', 'ot-61850.html', '장치끼리 트립 · 연동 신호를 수 ms 안에', 'Trip and interlock signals between devices within milliseconds'),
  P('sv', 'IEC 61850 SV', 2004, [0, 1], 'Ethernet (0x88BA)', 'stream', 'us', 'optional', 'ot-61850.html', '전류 · 전압 파형을 초당 수천 번', 'Current and voltage waveforms thousands of times a second'),
  P('iccp', 'ICCP / TASE.2 (IEC 60870-6)', 1996, [3], 'TCP 102', 'cs', 's', 'optional', null, '급전소와 급전소, 전력회사끼리 실시간 데이터 교환', 'Real-time data exchange between control centres and utilities'),
  P('profinet', 'PROFINET', 2003, [0, 1], 'Ethernet', 'cyclic', 'ms', 'optional', null, '공장 자동화: PLC와 구동기 · 센서의 주기 통신', 'Factory automation: cyclic exchange between PLCs, drives and sensors'),
  P('opcua', 'OPC UA', 2008, [1, 2, 3, 4], 'TCP 4840 · HTTPS', 'cs', 's', 'builtin', null, '정보 모델 + 보안을 갖춘 산업 공용 인터페이스', 'An industrial common interface with an information model and built-in security'),
  P('mqtt', 'MQTT', 1999, [2, 3, 4, 5], 'TCP 1883 / 8883', 'pubsub', 's', 'tls', null, '중계 서버(브로커)를 거친 게시 · 구독. 현장 → 클라우드 계측 전송', 'Publish/subscribe through a broker. Field-to-cloud telemetry'),
  P('2030.5', 'IEEE 2030.5', 2013, [1, 2, 3, 5], 'HTTPS (REST)', 'poll', 'min', 'mandatory', 'ot-der.html', 'DER 제어 · 계측. 장치마다 인증서', 'DER control and metering, a certificate per device'),
  P('openadr', 'OpenADR 2.0 / 3.0', 2012, [3, 5], 'HTTPS', 'poll', 'min', 'mandatory', 'ot-der.html', '수요반응 · 가격 신호 (결과를 요청)', 'Demand-response and price signals (requests outcomes)'),
  P('ocpp', 'OCPP 1.6 / 2.0.1', 2015, [1, 2, 5], 'WebSocket (JSON)', 'cs', 's', 'tls', 'ot-der.html', '전기차 충전기 ↔ 관리 시스템', 'EV charger ↔ management system')
];
export const STYLE = {
  poll: { ko: '폴링 (묻고 답하기)', en: 'Polling (ask and answer)' }, event: { ko: '사건 보고', en: 'Event reporting' }, cs: { ko: '클라이언트 · 서버', en: 'Client/server' },
  pubsub: { ko: '게시 · 구독', en: 'Publish/subscribe' }, stream: { ko: '연속 스트림', en: 'Continuous stream' }, cyclic: { ko: '주기 교환', en: 'Cyclic exchange' }
};
export const TIME = { us: { ko: '마이크로초', en: 'microseconds' }, ms: { ko: '밀리초', en: 'milliseconds' }, s: { ko: '초', en: 'seconds' }, min: { ko: '분', en: 'minutes' } };
export const SEC = { none: { ko: '없음', en: 'none' }, optional: { ko: '선택 (IEC 62351 · SA 등)', en: 'optional (IEC 62351, SA, …)' }, builtin: { ko: '규격에 내장', en: 'built in' }, tls: { ko: 'TLS', en: 'TLS' }, mandatory: { ko: 'TLS 필수', en: 'TLS required' } };
/** 이 층을 쓰는 규약 */
export const atLevel = (n) => PROTOCOLS.filter(p => p.levels.includes(n));
