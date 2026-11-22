// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 데이터베이스란: 같은 데이터를 일곱 가지 모양으로 보여 주고, 같은 질문에 같은 답이 나오는지 확인한다. 접근 사다리와 모양 선택표도 그린다 (계산은 models.js)
import { ASSETS } from './data.js?v=b680931a';
import { toDocument, toKV, toColumns, toGraph, toSeries, similar, vectorOf, ANSWERS, QUESTION } from './models.js?v=1102b14c';
import { $, esc, T, t } from '../lib/dom.js?v=3b73d59c';
import { tableHtml, jsonHtml } from './ui.js?v=2ed6a6af';

const S1 = ASSETS.filter(a => a.substation_id === QUESTION.sub);
const pre = (s) => `<pre class="m-pre">${esc(s)}</pre>`;

const MODELS = [
  { id: 'relational', ko: '관계형', en: 'Relational', eg: 'PostgreSQL · MySQL · SQLite',
    data: () => tableHtml(['id', 'substation_id', 'type', 'name', 'health', 'installed'], S1) + `<p class="meta">${T('assets 표에서 Sub-A(S1) 행만 (전체 12행). substations 표는 따로 있고 substation_id로 이어집니다.', 'Only the Sub-A (S1) rows of the assets table (12 in all). The substations table is separate, joined by substation_id.')}</p>`,
    query: `SELECT id FROM assets\nWHERE substation_id = 'S1' AND health >= 70\nORDER BY id;`,
    good: ['여러 표를 조인 · 집계하는 임의의 질문, 제약과 트랜잭션', 'Arbitrary joins and aggregates, constraints and transactions'],
    weak: ['모양이 자주 바뀌는 중첩 데이터, 수평 확장', 'Frequently changing nested data, scaling out'] },
  { id: 'document', ko: '문서', en: 'Document', eg: 'MongoDB · Firestore · CouchDB',
    data: () => `<pre class="m-pre">${jsonHtml(toDocument()[0])}</pre><p class="meta">${T('변전소 하나가 한 문서이고 설비가 그 안에 들어 있습니다 (비정규화).', 'One substation is one document with its assets nested inside (denormalised).')}</p>`,
    query: `db.substations.aggregate([\n  { $match: { _id: 'S1' } },\n  { $unwind: '$assets' },\n  { $match: { 'assets.health': { $gte: 70 } } },\n  { $project: { id: '$assets.id' } }\n])`,
    good: ['한 덩어리로 읽고 쓰는 데이터, 스키마를 유연하게', 'Data read and written as one unit, flexible schema'],
    weak: ['문서를 가로지르는 조인 · 일관성(설비가 두 곳에 중복되기 쉬움)', 'Cross-document joins and consistency (easy to duplicate assets)'] },
  { id: 'keyvalue', ko: '키-값', en: 'Key-value', eg: 'Redis · DynamoDB · etcd',
    data: () => `<div class="net-scroll"><table class="net-tab"><thead><tr><th>key</th><th>value</th></tr></thead><tbody>${toKV().filter(([k]) => /S1|T1$|T2$/.test(k)).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div><p class="meta">${T('이름표(키)로만 꺼냅니다. 값 안은 DB가 모릅니다 — 일부만 보임.', 'You fetch only by the label (key); the DB does not look inside the value. Partial view.')}</p>`,
    query: `SMEMBERS substation:S1:assets\n  → T1,T2,B1,B2,C1\nGET asset:T1 … asset:C1   (${t({ ko: '다섯 번 따로', en: 'five separate calls' })})\n  → ${t({ ko: '앱이 health ≥ 70을 직접 거름', en: 'the app filters health ≥ 70 itself' })}`,
    good: ['이름으로 즉시 꺼내기(세션 · 캐시 · 카운터), 아주 빠르고 단순', 'Instant fetch by name (sessions, caches, counters); very fast and simple'],
    weak: ['"건전도 70 이상" 같은 값 조건 질문(색인을 따로 만들어야 함)', 'Questions on values like "health ≥ 70" (needs a hand-made index)'] },
  { id: 'columnar', ko: '컬럼(열 저장)', en: 'Columnar', eg: 'ClickHouse · BigQuery · Parquet',
    data: () => `<pre class="m-pre">${esc(Object.entries(toColumns()).map(([c, v]) => `${c.padEnd(14)}[${v.join(', ')}]`).join('\n'))}</pre><p class="meta">${T('열마다 따로 모아 저장합니다. 질문에 쓰는 열(id · substation_id · health)만 읽으면 됩니다.', 'Each column is stored on its own. Only the columns the question uses (id, substation_id, health) are read.')}</p>`,
    query: `SELECT id FROM assets\nWHERE substation_id = 'S1' AND health >= 70;\n-- ${t({ ko: '같은 SQL이지만 엔진은 type · installed 열은 읽지 않음', en: 'Same SQL, but the engine never reads the type or installed columns' })}`,
    good: ['수억 건의 한 열을 합산 · 평균 (분석), 압축이 잘 됨', 'Summing or averaging one column over hundreds of millions of rows (analytics); compresses well'],
    weak: ['한 건을 자주 고치는 업무(행 단위 쓰기가 비쌈)', 'Frequent single-row updates (row writes are costly)'] },
  { id: 'graph', ko: '그래프', en: 'Graph', eg: 'Neo4j · Neptune · RDF 저장소',
    data: () => { const g = toGraph(); return `<pre class="m-pre">${esc(g.edges.filter(e => e.from === 'S1').map(e => `(${e.from})-[:${e.type}]->(${e.to})`).join('\n'))}\n${esc(g.nodes.filter(n => n.id === 'S1' || n.id === 'T1').map(n => `(${n.id}:${n.label} ${JSON.stringify(n.props)})`).join('\n'))}</pre><p class="meta">${T('점(노드)과 선(관계)이 1급 시민. 관계를 따라가는 질문이 빠릅니다. 이 사이트의 온톨로지가 이 모양입니다.', 'Nodes and relationships are first-class, so questions that follow relationships are fast. This site\'s ontologies take this shape.')} <a href="lab.html">Cypher</a></p>`; },
    query: `MATCH (:Substation {id:'S1'})-[:HAS_ASSET]->(a:Asset)\nWHERE a.health >= 70\nRETURN a.id ORDER BY a.id`,
    good: ['여러 단계 관계 따라가기(A → B → C), 연결 구조 분석', 'Following multi-step relationships (A → B → C), analysing connectivity'],
    weak: ['대량 집계, 관계가 적은 단순 표 데이터', 'Bulk aggregation, plain tables with few relationships'] },
  { id: 'series', ko: '시계열', en: 'Time-series', eg: 'TimescaleDB · InfluxDB · Prometheus',
    data: () => { const r = toSeries('T1'); return `<pre class="m-pre">${esc(r.map(x => `${x.month}  ${String(x.health).padStart(3)}  ${'█'.repeat(Math.round(x.health / 5))}`).join('\n'))}</pre><p class="meta">${T('설비 T1(MTr-1)의 월별 건전도 측정값. 시간이 기본 축이라 시간 구간 · 다운샘플링 · 오래된 데이터 자동 삭제가 내장됩니다.', 'Monthly health readings of asset T1 (MTr-1). Time is the primary axis, so time ranges, downsampling and automatic expiry of old data are built in.')}</p>`; },
    query: `SELECT time_bucket('1 month', ts) AS m, avg(health)\nFROM readings\nWHERE asset_id = 'T1' AND ts >= now() - interval '6 months'\nGROUP BY m ORDER BY m;\n-- ${t({ ko: '이 모양이 잘하는 질문: 추이', en: 'The question this shape is good at: trends' })}`,
    good: ['끊임없이 쌓이는 측정값(계량 · SCADA), 구간 집계', 'Endlessly arriving readings (metering, SCADA), range aggregates'],
    weak: ['측정값이 아닌 업무 데이터의 복잡한 관계', 'Complex relationships in non-measurement business data'] },
  { id: 'vector', ko: '벡터', en: 'Vector', eg: 'pgvector · Pinecone · Milvus',
    data: () => `<pre class="m-pre">${esc('id   [health, age, transformer, breaker, cable, relay]\n' + ASSETS.slice(0, 5).map(a => `${a.id.padEnd(4)} [${vectorOf(a).map(x => x.toFixed(2)).join(', ')}]`).join('\n'))}</pre><p class="meta">${T('설비를 숫자 묶음(벡터)으로 바꿔 두고 "가까운 것"을 찾습니다. 장난감 특징 6개이며, 실제로는 임베딩 모델이 문장 · 이미지에서 수백~수천 차원을 만듭니다.', 'Assets are turned into number lists (vectors) so "nearby" ones can be found. Six toy features here; in practice an embedding model makes hundreds or thousands of dimensions from text or images.')}</p>`,
    query: `SELECT name FROM assets\nORDER BY embedding <=> (SELECT embedding FROM assets WHERE id = 'T4')\nLIMIT 3;\n-- ${t({ ko: '이 모양이 잘하는 질문: "이것과 비슷한 것"', en: 'The question this shape is good at: "things like this one"' })}`,
    good: ['의미가 비슷한 것 찾기(문서 검색 · 추천 · RAG)', 'Finding things of similar meaning (document search, recommendation, RAG)'],
    weak: ['정확히 일치해야 하는 조건 · 집계', 'Exact-match conditions and aggregates'] }
];

let cur = 'relational';
function answerHtml(m) {
  if (m.id === 'series') return `<p class="st-cap">${T('답: T1의 건전도는 6개월 동안 ', 'Answer: T1\'s health over six months went ')}${toSeries('T1')[0].health} → ${toSeries('T1')[5].health}</p>`;
  if (m.id === 'vector') return `<p class="st-cap">${T('MTr-4와 가장 비슷한 설비: ', 'Assets most like MTr-4: ')}${similar('T4').map(s => `${esc(s.name)} (${s.sim})`).join(' · ')}</p>`;
  return `<p class="st-cap">${T('답: ', 'Answer: ')}<b>${ANSWERS[m.id]().join(', ')}</b></p>`;
}
function show() {
  const m = MODELS.find(x => x.id === cur);
  document.querySelectorAll('#mTabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === cur)));
  $('mData').innerHTML = m.data();
  $('mQuery').textContent = m.query;
  $('mAnswer').innerHTML = answerHtml(m);
  $('mTraits').innerHTML = `<div class="card"><h4>${T('잘하는 것', 'Good at')}</h4><p>${t({ ko: m.good[0], en: m.good[1] })}</p><p class="ex">${esc(m.eg)}</p></div><div class="card"><h4>${T('약한 것', 'Weaker at')}</h4><p>${t({ ko: m.weak[0], en: m.weak[1] })}</p></div>`;
}
function render() {
  $('mTabs').innerHTML = MODELS.map(m => `<button type="button" data-id="${m.id}" aria-pressed="false">${t({ ko: m.ko, en: m.en })}</button>`).join('');
  const same = Object.values(ANSWERS).map(f => f().join()), ok = same.every(x => x === same[0]);
  $('mCheck').innerHTML = ok ? T(`✓ 관계형 · 문서 · 키-값 · 컬럼 · 그래프 다섯 모양이 같은 답(${same[0]})을 냅니다. 담는 모양과 묻는 말이 달라도 데이터가 같으면 답은 같습니다.`, `✓ Relational, document, key-value, columnar and graph all give the same answer (${same[0]}). Different shapes and languages, same data, same answer.`)
    : T('✗ 답이 서로 다릅니다 (오류)', '✗ The answers differ (a bug)');

  const L = [
    { page: 'db-modern.html#agent', ko: 'AI 에이전트 · 자동 생성 API', en: 'AI agents and auto-generated APIs', who: { ko: '점검(guardrail)을 거친 질의만', en: 'only guard-checked queries' }, safe: 5 },
    { page: 'db-graphql.html', ko: 'GraphQL', en: 'GraphQL', who: { ko: '서비스가 DB 계정 보관', en: 'service holds the DB account' }, safe: 4 },
    { page: 'db-service.html', ko: '서비스 계층 (REST · RPC)', en: 'Service layer (REST, RPC)', who: { ko: '서비스가 DB 계정 보관', en: 'service holds the DB account' }, safe: 4 },
    { page: 'db-orm.html', ko: '쿼리 빌더 · ORM', en: 'Query builder / ORM', who: { ko: '앱 서버가 DB 계정 보관', en: 'app server holds the DB account' }, safe: 2 },
    { page: 'db-driver.html', ko: '드라이버 · 표준 API (JDBC · ODBC · DB-API)', en: 'Drivers and standard APIs (JDBC, ODBC, DB-API)', who: { ko: 'SQL 글자를 앱이 직접 작성', en: 'the app writes SQL text itself' }, safe: 2 },
    { page: 'db-wire.html', ko: '와이어 프로토콜 (소켓 위의 메시지)', en: 'Wire protocol (messages on a socket)', who: { ko: '드라이버가 대신 말함', en: 'a driver speaks it for you' }, safe: 1 },
    { page: 'db-file.html', ko: '파일 · 임베디드 엔진 직접', en: 'Files and embedded engines directly', who: { ko: '같은 프로세스가 파일을 직접 엶', en: 'the same process opens the file' }, safe: 1 }
  ];
  $('ladderList').innerHTML = L.map(r => `<li><a href="${r.page}"><b>${t(r)}</b><small>${T('DB와의 관계: ', 'Relation to the DB: ')}${t(r.who)}</small></a></li>`).join('');

  const FIT = [
    ['설비 · 고객 마스터, 정산(돈이 걸린 일)', 'Asset and customer masters, settlement (money involved)', '관계형', 'Relational', '제약 · 트랜잭션 · 조인', 'constraints, transactions, joins'],
    ['한 덩어리로 읽는 화면 데이터(프로필 · 설정)', 'Screen data read as one unit (profiles, settings)', '문서', 'Document', '모양이 자주 바뀜', 'shape changes often'],
    ['세션 · 캐시 · 실시간 카운터', 'Sessions, caches, live counters', '키-값', 'Key-value', '이름으로 즉시', 'instant by name'],
    ['수억 건 계량 데이터의 월별 합계', 'Monthly totals over hundreds of millions of meter rows', '컬럼', 'Columnar', '한 열만 읽고 압축', 'read one column, compresses'],
    ['"이 차단기가 열리면 어디가 정전되나?"', '"If this breaker opens, what loses power?"', '그래프', 'Graph', '관계를 여러 단계 따라감', 'follows many relationship hops'],
    ['SCADA 측정값 · 추이 · 오래된 값 삭제', 'SCADA readings, trends, expiring old values', '시계열', 'Time-series', '시간 구간 집계 내장', 'built-in time-range aggregates'],
    ['"이 점검 보고서와 비슷한 과거 사례?"', '"Past cases like this inspection report?"', '벡터', 'Vector', '의미가 가까운 것 찾기', 'nearest by meaning']
  ];
  $('fitTab').innerHTML = `<thead><tr><th>${T('이런 질문 · 데이터', 'This question or data')}</th><th>${T('어울리는 모양', 'Fitting shape')}</th><th>${T('이유', 'Why')}</th></tr></thead><tbody>` +
    FIT.map(r => `<tr><td>${T(r[0], r[1])}</td><td><b>${T(r[2], r[3])}</b></td><td>${T(r[4], r[5])}</td></tr>`).join('') + '</tbody>';
  show();
}
$('mTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { cur = b.dataset.id; show(); } });
document.addEventListener('langchange', render);
render();
