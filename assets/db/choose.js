// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 선택 도우미: "누가 · 어떤 모양으로 · 무엇을 우선해 · 얼마나 크게" 쓰는지에 따라 어떤 접근 방식이 맞는지 점수와 이유로 보여 준다.
// 정답표가 아니라 판단의 근거를 드러내는 규칙 모음이다. 브라우저 없이 테스트: tests/db.test.mjs

export const LAYERS = [
  { id: 'embedded', ko: '임베디드 · 파일 직접', en: 'Embedded / direct file', page: 'db-file.html' },
  { id: 'driver', ko: '드라이버 + SQL', en: 'Driver + SQL', page: 'db-driver.html' },
  { id: 'orm', ko: '쿼리 빌더 · ORM', en: 'Query builder / ORM', page: 'db-orm.html' },
  { id: 'rest', ko: '직접 만든 REST 서비스', en: 'Hand-built REST service', page: 'db-service.html' },
  { id: 'graphql', ko: 'GraphQL', en: 'GraphQL', page: 'db-graphql.html' },
  { id: 'autoapi', ko: '자동 생성 API · BaaS', en: 'Auto-generated API / BaaS', page: 'db-modern.html' },
  { id: 'agent', ko: '점검을 거친 에이전트 접근', en: 'Guarded agent access', page: 'db-modern.html#agent' }
];

export const QUESTIONS = [
  { id: 'caller', ko: '누가 데이터에 접근하나요?', en: 'Who accesses the data?', options: [
    { id: 'local', ko: '내 컴퓨터의 프로그램 · 스크립트 하나', en: 'One program or script on my machine' },
    { id: 'backend', ko: '우리 팀의 서버 코드', en: 'Our own server code' },
    { id: 'browser', ko: '브라우저 · 모바일 앱', en: 'A browser or mobile app' },
    { id: 'partner', ko: '다른 회사 · 다른 팀의 시스템', en: 'Another company or team\'s system' },
    { id: 'agent', ko: 'AI 에이전트', en: 'An AI agent' },
    { id: 'analyst', ko: '분석가 · BI 도구', en: 'Analysts and BI tools' }] },
  { id: 'shape', ko: '필요한 데이터의 모양은?', en: 'What shape of data is needed?', options: [
    { id: 'fixed', ko: '정해진 몇 가지 조회', en: 'A few fixed queries' },
    { id: 'flexible', ko: '화면마다 필요한 필드가 다름', en: 'Each screen needs different fields' },
    { id: 'adhoc', ko: '그때그때 묻는 탐색', en: 'Ad hoc exploration' }] },
  { id: 'priority', ko: '지금 더 중요한 것은?', en: 'What matters more now?', options: [
    { id: 'speed', ko: '빨리 만들어 보기', en: 'Building fast' },
    { id: 'control', ko: '오래 가는 구조 · 세밀한 제어', en: 'Long-lived design and fine control' }] },
  { id: 'scale', ko: '규모는?', en: 'Scale?', options: [
    { id: 'small', ko: '작음 (동시 사용자 적음)', en: 'Small (few concurrent users)' },
    { id: 'large', ko: '큼 (동시 접속 많음)', en: 'Large (many concurrent users)' }] }
];

const R = (layer, when, pts, ko, en) => ({ layer, when, pts, ko, en });
const RULES = [
  R('embedded', a => a.caller === 'local', 5, '서버 없이 한 프로세스가 파일을 직접 엽니다', 'No server: one process opens the file itself'),
  R('driver', a => a.caller === 'local', 2, '드라이버로 서버 DB에 붙을 수도 있지만 설치할 것이 늘어납니다', 'A driver to a server DB works but adds things to install'),
  R('orm', a => a.caller === 'local', 1, '작은 스크립트에는 ORM이 과할 수 있습니다', 'An ORM can be overkill for a small script'),
  R('rest', a => a.caller === 'local', -2, '혼자 쓰는데 서비스를 하나 더 두는 것은 부담입니다', 'A separate service is a burden for a single user'),
  R('driver', a => a.caller === 'backend', 3, '신뢰하는 서버 코드는 드라이버로 바로 붙는 것이 가장 단순하고 빠릅니다', 'Trusted server code connecting by driver is simplest and fastest'),
  R('orm', a => a.caller === 'backend', 3, '업무 코드와 SQL 사이의 반복 작업을 줄여 줍니다', 'Cuts the repetitive work between business code and SQL'),
  R('rest', a => a.caller === 'backend', 1, '여러 서비스가 같은 데이터를 쓴다면 앞에 서비스를 둡니다', 'Put a service in front if several services share the data'),
  R('embedded', a => a.caller === 'backend', -1, '서버 여러 대가 한 파일을 함께 쓰기는 어렵습니다', 'Several servers sharing one file is hard'),
  R('rest', a => a.caller === 'browser', 4, '브라우저에는 DB 계정을 줄 수 없으므로 서비스가 권한을 대신 확인합니다', 'A browser cannot hold DB credentials, so a service checks permissions for it'),
  R('graphql', a => a.caller === 'browser', 3, '화면이 필요한 필드만 한 번에 받기 좋습니다', 'A screen can fetch just the fields it needs in one call'),
  R('autoapi', a => a.caller === 'browser', 3, '행 단위 보안(RLS)과 함께 쓰면 서비스 코드 없이 열 수 있습니다', 'With row-level security it can be exposed without service code'),
  R('rest', a => a.caller === 'partner', 5, '버전이 붙은 안정된 계약(API)이 외부와의 약속이 됩니다', 'A versioned, stable contract (API) is the promise to outsiders'),
  R('graphql', a => a.caller === 'partner', 2, '외부가 원하는 필드를 고르게 할 수 있지만 질의 비용 제한이 필요합니다', 'Lets outsiders pick fields, but needs query cost limits'),
  R('autoapi', a => a.caller === 'partner', 1, '내부 표 구조가 그대로 계약이 되는 점에 주의합니다', 'Mind that internal table layout becomes the contract'),
  R('agent', a => a.caller === 'agent', 5, '읽기 전용 · 허용 표 · 행 수 상한을 거친 질의만 실행합니다', 'Runs only queries that passed read-only, allow-list and row-cap checks'),
  R('rest', a => a.caller === 'agent', 3, '잘 정의된 API를 도구로 주면 에이전트가 할 수 있는 일이 분명해집니다', 'Giving well-defined APIs as tools makes what an agent can do explicit'),
  R('graphql', a => a.caller === 'agent', 2, '스키마가 자기 설명적이라 에이전트가 읽기 좋습니다', 'A self-describing schema is easy for an agent to read'),
  R('driver', a => a.caller === 'agent', -3, '관리자 계정을 에이전트에 그대로 주면 한 번의 실수가 삭제가 됩니다', 'Handing an agent a powerful account turns one mistake into a deletion'),
  R('driver', a => a.caller === 'analyst', 4, '읽기 전용 계정으로 SQL을 직접 쓰는 것이 분석에 가장 자유롭습니다', 'Read-only accounts and plain SQL are the freest way to analyse'),
  R('agent', a => a.caller === 'analyst', 2, '질문을 SQL로 바꿔 주는 보조가 도움이 됩니다', 'A helper that turns questions into SQL can help'),
  R('embedded', a => a.caller === 'analyst', 1, '내려받은 파일(Parquet · SQLite)로 가볍게 분석할 수도 있습니다', 'A downloaded file (Parquet, SQLite) allows light analysis'),
  R('rest', a => a.shape === 'fixed', 2, '조회가 정해져 있으면 엔드포인트로 굳히기 쉽습니다', 'Fixed queries are easy to harden into endpoints'),
  R('orm', a => a.shape === 'fixed', 1, '반복되는 조회는 모델 코드로 정리됩니다', 'Repeated queries settle into model code'),
  R('graphql', a => a.shape === 'flexible', 3, '클라이언트마다 다른 필드 조합이 GraphQL의 강점입니다', 'Different field combinations per client are GraphQL\'s strength'),
  R('autoapi', a => a.shape === 'flexible', 1, 'select=… 로 필드를 고를 수 있습니다', 'select=… lets callers choose fields'),
  R('driver', a => a.shape === 'adhoc', 2, '임의의 SQL이 가장 유연합니다', 'Arbitrary SQL is the most flexible'),
  R('agent', a => a.shape === 'adhoc', 2, '자연어로 그때그때 묻기에 맞습니다', 'Suits asking on the fly in natural language'),
  R('autoapi', a => a.shape === 'adhoc', 1, '필터 조건을 주소로 조합할 수 있습니다', 'Filters can be composed in the URL'),
  R('graphql', a => a.shape === 'adhoc', -1, '정해진 스키마 밖의 질문은 어렵습니다', 'Questions outside the fixed schema are hard'),
  R('autoapi', a => a.priority === 'speed', 3, '표만 만들면 API가 생깁니다', 'Create the tables and the API exists'),
  R('orm', a => a.priority === 'speed', 2, '기본 CRUD를 거의 공짜로 얻습니다', 'Basic CRUD comes almost free'),
  R('rest', a => a.priority === 'speed', -1, '서비스를 직접 짜야 합니다', 'You write the service yourself'),
  R('graphql', a => a.priority === 'speed', -1, '스키마와 리졸버를 직접 짜야 합니다', 'You write the schema and resolvers yourself'),
  R('driver', a => a.priority === 'control', 2, '쿼리를 한 줄 한 줄 직접 튜닝할 수 있습니다', 'You can tune every query by hand'),
  R('rest', a => a.priority === 'control', 2, '내부 구조를 바꿔도 계약은 지킬 수 있습니다', 'The contract survives internal changes'),
  R('orm', a => a.priority === 'control', -1, '생성되는 SQL을 늘 확인해야 합니다', 'You must keep checking the SQL it generates'),
  R('autoapi', a => a.priority === 'control', -2, '표 구조와 API가 붙어 있어 분리하기 어렵습니다', 'API and table layout are tied, hard to separate'),
  R('rest', a => a.scale === 'large', 1, '캐시와 확장을 서비스 계층에서 다룹니다', 'Caching and scaling are handled in the service layer'),
  R('driver', a => a.scale === 'large', 1, '커넥션 풀 조정이 중요해집니다', 'Connection-pool tuning becomes important'),
  R('orm', a => a.scale === 'large', -1, 'N+1 같은 숨은 질의가 부하로 커집니다', 'Hidden queries like N+1 grow into load'),
  R('graphql', a => a.scale === 'large', -1, '깊고 넓은 질의가 부하를 만들므로 깊이 · 비용 제한이 필요합니다', 'Deep, wide queries create load; depth and cost limits are needed'),
  R('embedded', a => a.scale === 'large', -3, '쓰는 쪽이 하나여야 하므로 동시 접속에 약합니다', 'Writers must be single, so it is weak under many connections'),
  R('autoapi', a => a.scale === 'large', -1, '규모가 커지면 직접 만든 서비스로 옮기는 경우가 많습니다', 'Many teams move to a hand-built service as they grow'),
  R('embedded', a => a.scale === 'small', 1, '작은 규모에는 임베디드로 충분합니다', 'Embedded is enough at small scale'),
  R('autoapi', a => a.scale === 'small', 1, '작은 규모에서는 서버 운영 부담이 적습니다', 'Little operational burden at small scale')
];
// 아무리 점수가 높아도 쓰면 안 되는 조합: DB 계정이 바깥에 나가는 경우
const BLOCK = [
  { when: a => a.caller === 'browser' || a.caller === 'partner', layers: ['embedded', 'driver', 'orm'], ko: '브라우저 · 외부 시스템에 DB 접속 정보를 줄 수 없습니다', en: 'You cannot hand DB credentials to a browser or an outside system' }
];

export function recommend(a) {
  const rows = LAYERS.map(l => ({ id: l.id, score: 0, reasons: [], blocked: null }));
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  for (const r of RULES) if (r.when(a)) { by[r.layer].score += r.pts; by[r.layer].reasons.push({ pts: r.pts, ko: r.ko, en: r.en }); }
  for (const b of BLOCK) if (b.when(a)) for (const l of b.layers) by[l].blocked = { ko: b.ko, en: b.en };
  return rows.sort((x, y) => (!!x.blocked - !!y.blocked) || (y.score - x.score));
}

// 각 항목 1~5, 모두 "높을수록 좋음": 변화에 강함 · 보안 경계(DB 계정을 감춤) · 속도(거치는 단계가 적음) · 만들기 쉬움 · 질문의 자유
export const MATRIX = [
  { id: 'embedded', resilience: 1, security: 1, speed: 5, ease: 5, freedom: 3 },
  { id: 'driver', resilience: 1, security: 1, speed: 5, ease: 3, freedom: 5 },
  { id: 'orm', resilience: 2, security: 1, speed: 4, ease: 4, freedom: 3 },
  { id: 'rest', resilience: 4, security: 5, speed: 3, ease: 2, freedom: 2 },
  { id: 'graphql', resilience: 4, security: 4, speed: 3, ease: 2, freedom: 4 },
  { id: 'autoapi', resilience: 2, security: 3, speed: 3, ease: 5, freedom: 3 },
  { id: 'agent', resilience: 3, security: 3, speed: 2, ease: 3, freedom: 5 }
];
