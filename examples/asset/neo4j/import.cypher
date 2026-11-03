// 전력설비 자산관리 온톨로지 v0.1 — Neo4j 적재 (⚠ 가상 데이터)
// 생성: examples/asset/build_asset_ontology.py  ← 이 파일을 직접 고치지 말 것
CREATE CONSTRAINT asset_id IF NOT EXISTS FOR (a:Asset) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT loc_code IF NOT EXISTS FOR (l:FunctionalLocation) REQUIRE l.code IS UNIQUE;
CREATE CONSTRAINT task_id IF NOT EXISTS FOR (t:MaintenanceTask) REQUIRE t.id IS UNIQUE;

UNWIND [
  {code: 'ACLS_1', cim: 'ACLineSegment', name: 'B-A 154kV 1회선'},
  {code: 'CB_154_1', cim: 'Breaker', name: '154kV 선로 차단기'},
  {code: 'BUS_154', cim: 'BusbarSection', name: '154kV 모선'},
  {code: 'TR_1', cim: 'PowerTransformer', name: '주변압기 #1'},
  {code: 'BUS_22', cim: 'BusbarSection', name: '22.9kV 모선'},
  {code: 'CB_22_1', cim: 'Breaker', name: 'D/L #1 차단기'}
] AS r
MERGE (l:FunctionalLocation {code: r.code}) SET l.cimClass = r.cim, l.name = r.name;

UNWIND [
  {id: 'AS-TR-0007', eam: 'EQ-TR-2015-0007', kind: 'TransformerAsset', name: 'M.Tr #1 본체', status: '운전', year: 2015, hi: 53.0, pof: 3, cof: 5, risk: 15, mwh: 18360},
  {id: 'AS-TR-0002', eam: 'EQ-TR-1998-0002', kind: 'TransformerAsset', name: '구 M.Tr #1 본체', status: '폐기', year: 1998},
  {id: 'AS-CB-0123', eam: 'EQ-CB-2019-0123', kind: 'BreakerAsset', name: '154kV 가스차단기', status: '운전', year: 2019, hi: 70.3, pof: 2, cof: 2, risk: 4, mwh: 408},
  {id: 'AS-CB-0457', eam: 'EQ-CB-2021-0457', kind: 'BreakerAsset', name: '22.9kV 진공차단기', status: '운전', year: 2021, hi: 89.3, pof: 1, cof: 2, risk: 2, mwh: 204},
  {id: 'AS-LN-0031', eam: 'EQ-LN-2008-0031', kind: 'ConductorAsset', name: 'B-A 154kV 가공도체', status: '운전', year: 2008, hi: 78.0, pof: 2, cof: 2, risk: 4, mwh: 102}
] AS r
MERGE (a:Asset {id: r.id}) SET a += r;

UNWIND [
  {a: 'AS-TR-0002', l: 'TR_1', f: '1998-06-01', t: '2015-04-30'},
  {a: 'AS-TR-0007', l: 'TR_1', f: '2015-05-01', t: ''},
  {a: 'AS-CB-0123', l: 'CB_154_1', f: '2019-03-15', t: ''},
  {a: 'AS-CB-0457', l: 'CB_22_1', f: '2021-10-01', t: ''},
  {a: 'AS-LN-0031', l: 'ACLS_1', f: '2008-11-20', t: ''}
] AS r
MATCH (a:Asset {id: r.a}), (l:FunctionalLocation {code: r.l})
MERGE (a)-[d:INSTALLED_AT {from: r.f}]->(l) SET d.to = CASE WHEN r.t = '' THEN null ELSE r.t END;

UNWIND [
  {id: 'CP-TR7-BSH', a: 'AS-TR-0007', kind: 'Bushing', name: '154kV 부싱'},
  {id: 'CP-TR7-OLTC', a: 'AS-TR-0007', kind: 'TapChanger', name: '부하시 탭절환기(OLTC)'},
  {id: 'CP-TR7-COOL', a: 'AS-TR-0007', kind: 'CoolingUnit', name: '냉각장치(방열기·팬)'},
  {id: 'CP-TR7-OIL', a: 'AS-TR-0007', kind: 'InsulatingOil', name: '절연유·권선 절연'},
  {id: 'CP-CB123-GAS', a: 'AS-CB-0123', kind: 'GasSystem', name: 'SF6 가스계통'},
  {id: 'CP-CB123-MECH', a: 'AS-CB-0123', kind: 'OperatingMechanism', name: '조작기구'},
  {id: 'CP-CB457-VI', a: 'AS-CB-0457', kind: 'VacuumInterrupter', name: '진공 인터럽터'},
  {id: 'CP-CB457-MECH', a: 'AS-CB-0457', kind: 'OperatingMechanism', name: '조작기구'},
  {id: 'CP-LN31-JNT', a: 'AS-LN-0031', kind: 'Joint', name: '접속부(점퍼·슬리브)'},
  {id: 'CP-LN31-COND', a: 'AS-LN-0031', kind: 'Conductor', name: '도체(소선)'}
] AS r
MATCH (a:Asset {id: r.a})
MERGE (c:Component {id: r.id}) SET c.kind = r.kind, c.name = r.name
MERGE (a)-[:HAS_COMPONENT]->(c);

UNWIND [
  {id: 'IN-01', name: '순시점검', cat: '점검', strategy: 'TBM', cycle: '월', outage: 'N', pre: [], fb: []},
  {id: 'IN-02', name: '열화상 진단', cat: '점검', strategy: 'TBM', cycle: '분기', outage: 'N', pre: [], fb: []},
  {id: 'IN-03', name: '유중가스분석(DGA)', cat: '점검', strategy: 'CBM', cycle: '반기', outage: 'N', pre: [], fb: []},
  {id: 'IN-04', name: '절연유 특성시험', cat: '점검', strategy: 'TBM', cycle: '연', outage: 'N', pre: [], fb: []},
  {id: 'IN-05', name: 'OLTC 동작횟수 확인', cat: '점검', strategy: 'CBM', cycle: '월', outage: 'N', pre: [], fb: []},
  {id: 'IN-06', name: '부싱 tanδ 시험', cat: '점검', strategy: 'TBM', cycle: '3년', outage: 'Y', pre: [], fb: []},
  {id: 'IN-07', name: 'SF6 가스압 감시', cat: '점검', strategy: 'CBM', cycle: '상시', outage: 'N', pre: [], fb: []},
  {id: 'IN-08', name: '차단기 동작특성 시험', cat: '점검', strategy: 'TBM', cycle: '3년', outage: 'Y', pre: [], fb: []},
  {id: 'IN-09', name: '진공도 시험', cat: '점검', strategy: 'TBM', cycle: '3년', outage: 'Y', pre: [], fb: []},
  {id: 'IN-10', name: '부분방전 측정', cat: '점검', strategy: 'CBM', cycle: '연', outage: 'N', pre: [], fb: []},
  {id: 'IN-11', name: '드론 선로 점검', cat: '점검', strategy: 'TBM', cycle: '반기', outage: 'N', pre: [], fb: []},
  {id: 'MT-01', name: '절연유 여과·탈기', cat: '정비', strategy: 'CBM', cycle: '필요시', outage: 'Y', pre: [], fb: []},
  {id: 'MT-02', name: 'OLTC 정비', cat: '정비', strategy: 'CBM', cycle: '필요시', outage: 'Y', pre: [], fb: []},
  {id: 'MT-03', name: '부싱 교체', cat: '정비', strategy: 'CM', cycle: '필요시', outage: 'Y', pre: [], fb: []},
  {id: 'MT-04', name: '냉각장치 정비', cat: '정비', strategy: 'TBM', cycle: '연', outage: 'N', pre: [], fb: []},
  {id: 'MT-05', name: 'SF6 보충·밀봉 정비', cat: '정비', strategy: 'CM', cycle: '필요시', outage: 'Y', pre: [], fb: []},
  {id: 'MT-06', name: '조작기구 정비', cat: '정비', strategy: 'TBM', cycle: '6년', outage: 'Y', pre: [], fb: []},
  {id: 'MT-07', name: '진공 인터럽터 교체', cat: '정비', strategy: 'CM', cycle: '필요시', outage: 'Y', pre: [], fb: []},
  {id: 'MT-08', name: '접속부 재시공', cat: '정비', strategy: 'CM', cycle: '필요시', outage: 'Y', pre: [], fb: []},
  {id: 'MT-09', name: '도체 보수', cat: '정비', strategy: 'CM', cycle: '필요시', outage: 'Y', pre: [], fb: []},
  {id: 'MT-10', name: '설비 교체', cat: '교체', strategy: 'CM', cycle: '수명 도달 시', outage: 'Y', pre: [], fb: []},
  {id: 'WF-01', name: '작업 요청 등록', cat: '업무흐름', strategy: '', cycle: '', outage: 'N', pre: ['WF-02'], fb: []},
  {id: 'WF-02', name: '위험도 평가·우선순위 결정', cat: '업무흐름', strategy: '', cycle: '', outage: 'N', pre: ['WF-03'], fb: []},
  {id: 'WF-03', name: '정전 계획 수립(계통운영 협의)', cat: '업무흐름', strategy: '', cycle: '', outage: 'N', pre: ['WF-04'], fb: []},
  {id: 'WF-04', name: '작업 허가·안전조치(접지)', cat: '업무흐름', strategy: '', cycle: '', outage: 'N', pre: ['WF-05'], fb: []},
  {id: 'WF-05', name: '작업 수행', cat: '업무흐름', strategy: '', cycle: '', outage: 'Y', pre: ['WF-06'], fb: []},
  {id: 'WF-06', name: '시험·검수', cat: '업무흐름', strategy: '', cycle: '', outage: 'N', pre: ['WF-07'], fb: []},
  {id: 'WF-07', name: '재가압·복구', cat: '업무흐름', strategy: '', cycle: '', outage: 'N', pre: ['WF-08'], fb: []},
  {id: 'WF-08', name: '이력 등록(EAM)·건전도 재산정', cat: '업무흐름', strategy: '', cycle: '', outage: 'N', pre: [], fb: ['WF-02']}
] AS r
MERGE (t:MaintenanceTask {id: r.id}) SET t.name = r.name, t.category = r.cat, t.strategy = r.strategy, t.cycle = r.cycle, t.outage = (r.outage = 'Y')
WITH t, r
FOREACH (p IN r.pre | MERGE (n:MaintenanceTask {id: p}) MERGE (t)-[:PRECEDES]->(n))
FOREACH (p IN r.fb | MERGE (n:MaintenanceTask {id: p}) MERGE (t)-[:FEEDS_BACK_TO]->(n));

UNWIND [
  {id: 'FM-01', name: '권선 절연 열화', kind: 'TransformerAsset', part: 'InsulatingOil', det: ['IN-03', 'IN-04', 'IN-10'], mit: ['MT-01', 'MT-10'], effect: '절연 파괴로 변압기 내부 고장'},
  {id: 'FM-02', name: 'OLTC 접점 마모', kind: 'TransformerAsset', part: 'TapChanger', det: ['IN-05', 'IN-03'], mit: ['MT-02'], effect: '탭 절환 실패·아크로 변압기 정지'},
  {id: 'FM-03', name: '부싱 열화', kind: 'TransformerAsset', part: 'Bushing', det: ['IN-06', 'IN-02'], mit: ['MT-03'], effect: '부싱 섬락·파손'},
  {id: 'FM-04', name: '냉각 성능 저하', kind: 'TransformerAsset', part: 'CoolingUnit', det: ['IN-01', 'IN-02'], mit: ['MT-04'], effect: '과열로 출력 제한·수명 단축'},
  {id: 'FM-05', name: 'SF6 가스 누설', kind: 'BreakerAsset:SF6', part: 'GasSystem', det: ['IN-07'], mit: ['MT-05'], effect: '차단 능력 상실·동작 잠금'},
  {id: 'FM-06', name: '조작기구 동작 불량', kind: 'BreakerAsset', part: 'OperatingMechanism', det: ['IN-08'], mit: ['MT-06'], effect: '고장 전류 차단 실패'},
  {id: 'FM-07', name: '진공도 저하', kind: 'BreakerAsset:진공', part: 'VacuumInterrupter', det: ['IN-09'], mit: ['MT-07'], effect: '차단 실패'},
  {id: 'FM-08', name: '접속부 과열', kind: 'ConductorAsset', part: 'Joint', det: ['IN-02', 'IN-11'], mit: ['MT-08'], effect: '접속부 용단으로 선로 정지'},
  {id: 'FM-09', name: '도체 부식·소선 단선', kind: 'ConductorAsset', part: 'Conductor', det: ['IN-11'], mit: ['MT-09', 'MT-10'], effect: '도체 단선'}
] AS r
MERGE (f:FailureMode {id: r.id}) SET f.name = r.name, f.assetKind = r.kind, f.componentKind = r.part, f.effect = r.effect
WITH f, r
FOREACH (x IN r.det | MERGE (t:MaintenanceTask {id: x}) MERGE (f)-[:DETECTED_BY]->(t))
FOREACH (x IN r.mit | MERGE (t:MaintenanceTask {id: x}) MERGE (f)-[:MITIGATED_BY]->(t));

UNWIND [
  {id: 'DG-01', a: 'AS-TR-0007', t: 'IN-03', date: '2026-09-15', finding: 'TCG 820ppm, C2H2 2ppm (주의 기준 초과)', j: '주의', fm: 'FM-01'},
  {id: 'DG-02', a: 'AS-TR-0007', t: 'IN-04', date: '2026-03-10', finding: '수분 18ppm, 절연파괴전압 52kV', j: '정상', fm: ''},
  {id: 'DG-03', a: 'AS-TR-0007', t: 'IN-05', date: '2026-10-31', finding: 'OLTC 정비 후 동작 68,400회 (정비 기준 60,000회)', j: '주의', fm: 'FM-02'},
  {id: 'DG-04', a: 'AS-TR-0007', t: 'IN-02', date: '2026-09-20', finding: '최고 61℃, 이상 없음', j: '정상', fm: ''},
  {id: 'DG-05', a: 'AS-CB-0123', t: 'IN-07', date: '2026-10-05', finding: 'SF6 0.58MPa (정격 0.60, 경보 0.55), 월 0.005MPa 감소', j: '주의', fm: 'FM-05'},
  {id: 'DG-06', a: 'AS-CB-0123', t: 'IN-08', date: '2025-05-20', finding: '개극 시간 32ms (기준 40ms 이하)', j: '정상', fm: ''},
  {id: 'DG-07', a: 'AS-CB-0457', t: 'IN-09', date: '2024-11-12', finding: '진공도 양호', j: '정상', fm: ''},
  {id: 'DG-08', a: 'AS-LN-0031', t: 'IN-02', date: '2026-08-10', finding: '3번 철탑 점퍼 접속부 ΔT 18℃', j: '주의', fm: 'FM-08'},
  {id: 'DG-09', a: 'AS-LN-0031', t: 'IN-02', date: '2026-09-20', finding: '재시공 후 ΔT 3℃', j: '정상', fm: ''},
  {id: 'DG-10', a: 'AS-LN-0031', t: 'IN-11', date: '2026-05-14', finding: '소선 단선 없음, 경미한 부식', j: '정상', fm: ''},
  {id: 'DG-11', a: 'AS-CB-0457', t: 'IN-02', date: '2026-09-20', finding: '이상 없음', j: '정상', fm: ''},
  {id: 'DG-12', a: 'AS-CB-0123', t: 'IN-02', date: '2026-09-20', finding: '이상 없음', j: '정상', fm: ''},
  {id: 'DG-13', a: 'AS-TR-0007', t: 'IN-01', date: '2026-10-28', finding: '이상 없음', j: '정상', fm: ''},
  {id: 'DG-14', a: 'AS-CB-0123', t: 'IN-01', date: '2026-10-28', finding: '가스압 지시계 0.58MPa 확인', j: '정상', fm: ''},
  {id: 'DG-15', a: 'AS-CB-0457', t: 'IN-01', date: '2026-10-28', finding: '이상 없음', j: '정상', fm: ''},
  {id: 'DG-16', a: 'AS-LN-0031', t: 'IN-01', date: '2026-10-21', finding: '이상 없음', j: '정상', fm: ''}
] AS r
MATCH (a:Asset {id: r.a}), (t:MaintenanceTask {id: r.t})
MERGE (g:Diagnosis {id: r.id}) SET g.date = r.date, g.finding = r.finding, g.judgement = r.j
MERGE (g)-[:ON_ASSET]->(a) MERGE (g)-[:USES_METHOD]->(t)
WITH g, r
FOREACH (_ IN CASE WHEN r.fm <> '' THEN [1] ELSE [] END | MERGE (f:FailureMode {id: r.fm}) MERGE (g)-[:INDICATES]->(f));

UNWIND [
  {id: 'WO-2026-0731', a: 'AS-LN-0031', t: 'MT-08', fm: 'FM-08', status: '완료', planned: '2026-08-25', done: '2026-08-28', outage: 6.0, trig: 'DG-08'},
  {id: 'WO-2026-0877', a: 'AS-CB-0123', t: 'MT-05', fm: 'FM-05', status: '진행', planned: '2026-11-12', done: '', outage: 8.0, trig: 'DG-05'},
  {id: 'WO-2026-0912', a: 'AS-TR-0007', t: 'MT-02', fm: 'FM-02', status: '계획', planned: '2026-12-08', done: '', outage: 36.0, trig: 'DG-03'},
  {id: 'WO-2026-0915', a: 'AS-TR-0007', t: 'IN-03', fm: 'FM-01', status: '계획', planned: '2026-12-01', done: '', outage: 0.0, trig: 'DG-01'}
] AS r
MATCH (a:Asset {id: r.a}), (t:MaintenanceTask {id: r.t}), (f:FailureMode {id: r.fm}), (g:Diagnosis {id: r.trig})
MERGE (w:WorkOrder {id: r.id}) SET w.status = r.status, w.planned = r.planned, w.done = r.done, w.outageHours = r.outage
MERGE (w)-[:ON_ASSET]->(a) MERGE (w)-[:PERFORMS]->(t) MERGE (w)-[:ADDRESSES]->(f) MERGE (w)-[:TRIGGERED_BY]->(g);
