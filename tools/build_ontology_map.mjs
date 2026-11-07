#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 사이트 전체 온톨로지 지도 데이터 만들기: node tools/build_ontology_map.mjs → assets/data/ontology-map.json
//
// 온톨로지마다 Turtle 파일을 읽어
//  - 정의한 클래스(owl:Class) · 관계(owl:ObjectProperty) · 값(owl:DatatypeProperty) · 개체(rdf:type이 붙은 것) 수
//  - 다른 온톨로지와의 연결: A의 트리플이 B에서 정의된 개체·클래스·속성을 가리키면 A → B (술어별 건수)
//  - 외부 표준(IEC CIM · GeoSPARQL · SKOS · OBO RO …)의 클래스·속성을 쓰는 곳
// 을 세어 JSON으로 저장합니다. 손으로 적지 않고 파일에서 세므로, 온톨로지가 바뀌면 다시 실행만 하면 됩니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import init, { parse } from '../assets/vendor/oxigraph/web.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', RDFS = 'http://www.w3.org/2000/01/rdf-schema#', OWL = 'http://www.w3.org/2002/07/owl#';
const TYPE = RDF + 'type';

// id, 파일, 페이지, 이름, 묶음(전력 · 교통 · 업무 · 자연)
export const ONTOLOGIES = [
  { id: 'work', files: ['examples/work/work-ontology.ttl'], page: 'work.html', ko: '업무', en: 'Work', group: 'work' },
  { id: 'asset', files: ['examples/asset/asset-ontology.ttl'], page: 'asset.html', ko: '전력설비 자산관리', en: 'Asset management', group: 'power' },
  { id: 'substation', files: ['examples/power-grid-sample.ttl'], page: 'grid.html', ko: '예제 변전소', en: 'Sample substation', group: 'power' },
  { id: 'impact', files: ['examples/impact/impact-links.ttl'], page: 'impact.html', ko: '설비 고장 영향', en: 'Failure impact', group: 'power' },
  { id: 'feeder', files: ['examples/feeder/feeder.ttl'], page: 'grid.html#feeder', ko: '배전선로 D/L #1', en: 'Feeder D/L #1', group: 'power' },
  { id: 'twin', files: ['examples/twin/korea_virtual_grid.ttl'], page: 'twin.html', ko: '디지털 트윈 전력망', en: 'Digital twin grid', group: 'power' },
  { id: 'ev', files: ['examples/ev/ev-ontology.ttl'], page: 'ev.html', ko: '전기차 충전', en: 'EV charging', group: 'traffic' },
  { id: 'highway', files: ['examples/highway/highway-ontology.ttl', 'examples/highway/highway-alignment.ttl'], page: 'highway.html', ko: '고속도로·국도 교통', en: 'Road traffic', group: 'traffic' },
  { id: 'eco', files: ['examples/ecosystem/eco-ontology.ttl'], page: 'eco-ontology.html', ko: '단세포 생태계', en: 'Cell ecosystem', group: 'nature' }
];
// 외부 표준: 이름공간 → 이름
export const STANDARDS = [
  { id: 'cim', ns: 'http://iec.ch/TC57/CIM100#', ko: 'IEC CIM', en: 'IEC CIM', page: 'grid.html' },
  { id: 'geo', ns: 'http://www.opengis.net/ont/geosparql#', ko: 'GeoSPARQL', en: 'GeoSPARQL' },
  { id: 'skos', ns: 'http://www.w3.org/2004/02/skos/core#', ko: 'SKOS', en: 'SKOS' },
  { id: 'obo', ns: 'http://purl.obolibrary.org/obo/', ko: 'OBO 관계 온톨로지', en: 'OBO Relation Ontology' },
  { id: 'dct', ns: 'http://purl.org/dc/terms/', ko: 'Dublin Core', en: 'Dublin Core' }
];

export async function buildMap() {
  await init({ module_or_path: readFileSync(ROOT + 'assets/vendor/oxigraph/web_bg.wasm') });
  const quads = new Map(), owner = new Map();            // IRI → 그 IRI를 정의(rdf:type)한 온톨로지들
  for (const o of ONTOLOGIES) {
    const qs = o.files.flatMap(f => parse(readFileSync(ROOT + f, 'utf8'), { format: 'text/turtle', base_iri: 'http://example.org/base' }));
    quads.set(o.id, qs);
    for (const q of qs) if (q.predicate.value === TYPE && q.subject.termType === 'NamedNode' && !STANDARDS.some(st => q.subject.value.startsWith(st.ns))) {   // 표준 용어는 누구의 것도 아님
      if (!owner.has(q.subject.value)) owner.set(q.subject.value, new Set());
      owner.get(q.subject.value).add(o.id);
    }
  }
  const local = (iri) => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);
  const std = (iri) => STANDARDS.find(s => iri.startsWith(s.ns));
  const nodes = [], links = new Map(), uses = new Map();
  const bump = (m, k, p) => { if (!m.has(k)) m.set(k, new Map()); const x = m.get(k); x.set(p, (x.get(p) || 0) + 1); };
  for (const o of ONTOLOGIES) {
    const qs = quads.get(o.id);
    const typed = (t) => new Set(qs.filter(q => q.predicate.value === TYPE && q.object.value === t && !std(q.subject.value)).map(q => q.subject.value));   // 표준 용어 정의는 빼고 셈
    const own = new Set(qs.filter(q => q.predicate.value === TYPE).map(q => q.subject.value));
    const schema = new Set([...typed(OWL + 'Class'), ...typed(OWL + 'ObjectProperty'), ...typed(OWL + 'DatatypeProperty'), ...typed(OWL + 'Ontology')]);
    const classesUsed = new Set(qs.filter(q => q.predicate.value === TYPE && !q.object.value.startsWith(OWL) && !q.object.value.startsWith(RDFS)).map(q => q.object.value));
    nodes.push({
      id: o.id, ko: o.ko, en: o.en, page: o.page, group: o.group, files: o.files, triples: qs.length,
      classes: typed(OWL + 'Class').size, objectProps: typed(OWL + 'ObjectProperty').size, dataProps: typed(OWL + 'DatatypeProperty').size,
      individuals: [...own].filter(i => !schema.has(i)).length, classesUsed: classesUsed.size
    });
    for (const q of qs) {
      const p = q.predicate.value;
      for (const term of [q.subject, q.predicate, q.object]) {
        if (term.termType !== 'NamedNode') continue;
        const iri = term.value, ow = owner.get(iri);
        if (ow && !ow.has(o.id)) {                      // 다른 온톨로지에서 정의된 것을 가리킴
          const how = term === q.predicate ? 'reuses ' + local(iri) : local(p);
          for (const b of ow) bump(links, o.id + '>' + b, how);
        } else if (!ow && std(iri) && !own.has(iri)) {
          bump(uses, o.id + '>' + std(iri).id, term === q.predicate ? local(iri) : (p === TYPE ? 'a ' : p === RDFS + 'subClassOf' ? '⊑ ' : p === RDFS + 'subPropertyOf' ? '⊑ ' : '') + local(iri));
        }
      }
    }
  }
  const pack = (m) => [...m].map(([k, v]) => {
    const [from, to] = k.split('>');
    const via = [...v].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ p, n }));
    return { from, to, n: via.reduce((s, x) => s + x.n, 0), via };
  }).sort((a, b) => b.n - a.n);
  return {
    generated: 'tools/build_ontology_map.mjs', nodes,
    standards: STANDARDS.map(({ id, ko, en, page }) => ({ id, ko, en, page: page || null })),
    links: pack(links), standardLinks: pack(uses)
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const map = await buildMap();
  writeFileSync(ROOT + 'assets/data/ontology-map.json', JSON.stringify(map, null, 1) + '\n');
  for (const n of map.nodes) console.log(`${n.id.padEnd(8)} 클래스 ${n.classes} · 관계 ${n.objectProps} · 값 ${n.dataProps} · 개체 ${n.individuals} · 쓰는 클래스 ${n.classesUsed}`);
  for (const l of map.links) console.log(`${l.from} → ${l.to}: ${l.n}  ${l.via.slice(0, 4).map(v => v.p + '×' + v.n).join(', ')}`);
  for (const l of map.standardLinks) console.log(`  ${l.from} ⇢ ${l.to}: ${l.n}  ${l.via.slice(0, 4).map(v => v.p + '×' + v.n).join(', ')}`);
}
