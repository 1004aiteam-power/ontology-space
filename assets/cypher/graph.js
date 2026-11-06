// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// RDF 트리플 → Neo4j식 속성 그래프 (neosemantics(n10s)로 RDF를 Neo4j에 불러올 때와 같은 생각)
//
//  - rdf:type          → 라벨. 클래스 계층(rdfs:subClassOf)을 따라 상위 클래스도 라벨로 붙임
//                        (예: Breaker → :Breaker:ProtectedSwitch:Switch:ConductingEquipment:Equipment:…)
//  - 값(리터럴)         → 노드 속성. 이름은 술어의 마지막 부분 (cim:IdentifiedObject.name → name, ev:installedKW → installedKW)
//                        언어 태그가 ko이거나 없으면 그 이름 그대로, 다른 언어는 이름_언어 (rdfs:label@en → label_en)
//  - IRI·빈 노드 값     → 관계. 타입은 술어의 마지막 부분을 대문자_밑줄로 (Terminal.ConductingEquipment → CONDUCTING_EQUIPMENT)
//  - 모든 노드에 uri 속성 (원래 IRI)
//  - owl:Class 같은 스키마 정의는 노드로 만들지 않고 라벨 계층에만 씀. 클래스를 값으로 가리키면 클래스 이름이 속성 값

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const SCHEMA_TYPES = new Set(['Class', 'ObjectProperty', 'DatatypeProperty', 'AnnotationProperty', 'Property', 'Ontology', 'Restriction', 'TransitiveProperty', 'FunctionalProperty', 'SymmetricProperty', 'NamedIndividual', 'AllDisjointClasses']);
const SCHEMA_NS = ['http://www.w3.org/2002/07/owl#', 'http://www.w3.org/2000/01/rdf-schema#', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'];
const INT = /#(integer|int|long|short|byte|nonNegativeInteger|positiveInteger|unsignedInt)$/, DEC = /#(decimal|double|float)$/;

export const localName = (iri) => { const s = iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1); return s.slice(s.lastIndexOf('.') + 1) || s; };
export const relType = (iri) => localName(iri).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
const isSchemaClass = (iri) => SCHEMA_NS.some(ns => iri.startsWith(ns));

function literalValue(o) {
  const dt = o.datatype?.value || '';
  if (INT.test(dt)) return parseInt(o.value, 10);
  if (DEC.test(dt)) return parseFloat(o.value);
  if (dt.endsWith('#boolean')) return o.value === 'true' || o.value === '1';
  return o.value;
}

// quads: [{ subject, predicate, object }] (RDF/JS 모양: termType, value, language, datatype)
export function buildGraph(quads) {
  const key = (t) => (t.termType === 'BlankNode' ? '_:' : '') + t.value;
  // 1) 스키마: 클래스 계층과 스키마 개체
  const parents = new Map(), schema = new Set();
  for (const q of quads) {
    const p = q.predicate.value;
    if (p === SUBCLASS && q.object.termType === 'NamedNode') {
      if (!parents.has(q.subject.value)) parents.set(q.subject.value, new Set());
      parents.get(q.subject.value).add(q.object.value);
    }
    if (p === RDF_TYPE && isSchemaClass(q.object.value) && SCHEMA_TYPES.has(localName(q.object.value))) schema.add(key(q.subject));
  }
  for (const s of parents.keys()) schema.add(s);
  const ancestors = (c, out = []) => { for (const p of parents.get(c) || []) if (!out.includes(p)) { out.push(p); ancestors(p, out); } return out; };

  // 2) 노드 · 속성 · 관계
  const nodes = [], rels = [], byKey = new Map();
  const node = (t) => {
    const k = key(t);
    let n = byKey.get(k);
    if (!n) { n = { id: nodes.length, kind: 'node', labels: [], props: { uri: t.termType === 'BlankNode' ? '_:' + t.value : t.value }, out: [], in: [] }; nodes.push(n); byKey.set(k, n); }
    return n;
  };
  const types = new Map();
  for (const q of quads) {
    const sk = key(q.subject); if (schema.has(sk)) continue;
    const p = q.predicate.value, o = q.object;
    if (p === RDF_TYPE) { if (!isSchemaClass(o.value)) { node(q.subject); if (!types.has(sk)) types.set(sk, []); types.get(sk).push(o.value); } continue; }
    if (SCHEMA_NS.some(ns => p.startsWith(ns)) && p !== 'http://www.w3.org/2000/01/rdf-schema#label' && p !== 'http://www.w3.org/2000/01/rdf-schema#comment') continue;
    const n = node(q.subject);
    if (o.termType === 'Literal') {
      let k = localName(p); if (o.language && o.language !== 'ko') k += '_' + o.language;
      const v = literalValue(o);
      if (k in n.props && k !== 'uri') n.props[k] = [].concat(n.props[k], v); else n.props[k] = v;
    } else {
      if (schema.has(key(o))) { const k = localName(p), v = localName(o.value); n.props[k] = k in n.props ? [].concat(n.props[k], v) : v; continue; }   // 클래스를 가리키는 값 → 클래스 이름
      const m = node(o), r = { id: rels.length, kind: 'rel', type: relType(p), start: n, end: m, props: {} };
      rels.push(r); n.out.push(r); m.in.push(r);
    }
  }
  for (const [k, cls] of types) {
    const n = byKey.get(k), labels = [];
    for (const c of cls) { const l = localName(c); if (!labels.includes(l)) labels.push(l); }
    for (const c of cls) for (const a of ancestors(c)) { const l = localName(a); if (!labels.includes(l)) labels.push(l); }
    n.labels = labels;
  }
  for (const n of nodes) n.labelSet = new Set(n.labels);
  const byLabel = new Map();
  for (const n of nodes) for (const l of n.labels) { if (!byLabel.has(l)) byLabel.set(l, []); byLabel.get(l).push(n); }
  return { nodes, rels, byLabel, byUri: new Map(nodes.map(n => [n.props.uri, n])) };
}
