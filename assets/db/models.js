// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 데이터 모델 지도: 같은 변전소 · 설비 데이터를 관계형 · 문서 · 키-값 · 컬럼 · 그래프 · 시계열 · 벡터의 모양으로 바꾸고,
// 같은 질문 "A변전소의 건전도 70 이상 설비는?"에 모두 같은 답을 내는지 확인한다. 브라우저 없이 테스트: tests/db.test.mjs
import { SUBSTATIONS, ASSETS, readings, makeDB } from './data.js?v=b680931a';

export const toRelational = () => ({ substations: SUBSTATIONS, assets: ASSETS });
export const toDocument = () => SUBSTATIONS.map(s => ({ _id: s.id, name: s.name, region: s.region, assets: ASSETS.filter(a => a.substation_id === s.id).map(({ substation_id, ...a }) => a) }));
export function toKV() {
  const kv = [];
  for (const a of ASSETS) kv.push([`asset:${a.id}`, JSON.stringify({ name: a.name, type: a.type, health: a.health, installed: a.installed })]);
  for (const s of SUBSTATIONS) { kv.push([`substation:${s.id}`, JSON.stringify({ name: s.name, region: s.region })]); kv.push([`substation:${s.id}:assets`, ASSETS.filter(a => a.substation_id === s.id).map(a => a.id).join(',')]); }
  return kv;
}
export const toColumns = () => Object.fromEntries(['id', 'substation_id', 'type', 'health'].map(c => [c, ASSETS.map(a => a[c])]));
export function toGraph() {
  const nodes = [...SUBSTATIONS.map(s => ({ id: s.id, label: 'Substation', props: { name: s.name } })), ...ASSETS.map(a => ({ id: a.id, label: 'Asset', props: { name: a.name, type: a.type, health: a.health } }))];
  const edges = ASSETS.map(a => ({ from: a.substation_id, type: 'HAS_ASSET', to: a.id }));
  return { nodes, edges };
}
export const toSeries = (id) => readings(id);

// 벡터: 숫자 특징으로 바꿔 "비슷한 설비"를 코사인 유사도로 찾는다 (장난감: 진짜 벡터 DB는 임베딩 모델이 만든 수백~수천 차원을 쓴다)
export const TYPES = ['transformer', 'breaker', 'cable', 'relay'];
export const vectorOf = (a) => [a.health / 100, (2026 - a.installed) / 35, ...TYPES.map(t => (a.type === t ? 1 : 0))];
const cos = (x, y) => { const d = x.reduce((s, v, i) => s + v * y[i], 0); return d / (Math.hypot(...x) * Math.hypot(...y)); };
export function similar(id, k = 3) {
  const me = ASSETS.find(a => a.id === id), v = vectorOf(me);
  return ASSETS.filter(a => a.id !== id).map(a => ({ id: a.id, name: a.name, sim: Math.round(cos(v, vectorOf(a)) * 1000) / 1000 })).sort((x, y) => y.sim - x.sim).slice(0, k);
}

// 같은 질문, 모양마다 다른 방법으로 — 답이 같아야 한다
export const QUESTION = { sub: 'S1', min: 70 };
export const ANSWERS = {
  relational: () => makeDB().exec('SELECT id FROM assets WHERE substation_id = ? AND health >= ? ORDER BY id', [QUESTION.sub, QUESTION.min]).rows.map(r => r.id),
  document: () => toDocument().find(d => d._id === QUESTION.sub).assets.filter(a => a.health >= QUESTION.min).map(a => a.id).sort(),
  keyvalue: () => { const kv = new Map(toKV()); return kv.get(`substation:${QUESTION.sub}:assets`).split(',').filter(id => JSON.parse(kv.get(`asset:${id}`)).health >= QUESTION.min).sort(); },
  columnar: () => { const c = toColumns(); return c.id.filter((_, i) => c.substation_id[i] === QUESTION.sub && c.health[i] >= QUESTION.min).sort(); },
  graph: () => { const g = toGraph(); return g.edges.filter(e => e.from === QUESTION.sub && e.type === 'HAS_ASSET').map(e => g.nodes.find(n => n.id === e.to)).filter(n => n.props.health >= QUESTION.min).map(n => n.id).sort(); }
};
