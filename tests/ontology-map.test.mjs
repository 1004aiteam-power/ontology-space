// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 온톨로지 지도 테스트 — 실행: node tests/ontology-map.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMap } from '../tools/build_ontology_map.mjs';

const map = await buildMap();
const saved = JSON.parse(readFileSync(new URL('../assets/data/ontology-map.json', import.meta.url), 'utf8'));
assert.deepEqual(saved, JSON.parse(JSON.stringify(map)), 'assets/data/ontology-map.json is out of date: run node tools/build_ontology_map.mjs');
console.log('✓ ontology-map.json matches the Turtle files');

const has = (from, to, p) => map.links.some(l => l.from === from && l.to === to && (!p || l.via.some(v => v.p === p)));
assert.ok(has('ev', 'highway', 'onLink'));
assert.ok(has('ev', 'twin', 'Feeder.NormalEnergizingSubstation'));
assert.ok(has('asset', 'work', 'subPropertyOf'));
assert.ok(has('asset', 'substation', 'installedAt'));
assert.ok(has('impact', 'feeder', 'exactMatch') && has('impact', 'substation', 'exactMatch'));
assert.ok(!map.links.some(l => l.to === 'cim' || l.from === 'eco' || l.to === 'eco'), 'standards and the ecosystem are not linked as ontologies');
assert.ok(!has('twin', 'feeder') && !has('feeder', 'twin'), 'sharing CIM is not a link');
console.log('✓ the links described on the page exist (and the ones it says are absent do not)');

for (const n of map.nodes) assert.ok(readFileSync(new URL('../' + n.page.split('#')[0], import.meta.url)), n.page);
console.log('✓ every node links to an existing page');
