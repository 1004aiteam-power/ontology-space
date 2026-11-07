// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 단세포 생태계 온톨로지 테스트 — 실행: node tests/eco-graph.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Recorder, ECO_CYPHER } from '../assets/eco/eco-graph.js';
import { loadGraph } from '../tools/load.mjs';
import { buildGraph } from '../assets/cypher/graph.js';
import { runCypher } from '../assets/cypher/cypher.js';
import init, { parse } from '../assets/vendor/oxigraph/web.js';

const rec = new Recorder({ seed: 3, years: 1 });
rec.advance();
const cells = [...rec.cells.values()], by = new Map(cells.map(c => [c.id, c]));

// 1) 혈통: 분열로 태어난 세포는 부모가 있고, 같은 종류, 세대 + 1, 부모가 살아 있을 때 태어남
{
  let n = 0;
  for (const c of cells) {
    if (c.origin !== 'division') { assert.equal(c.parent, null); assert.equal(c.gen, 0); continue; }
    const p = by.get(c.parent);
    assert.ok(p, `parent of ${c.id}`);
    assert.equal(p.kind, c.kind); assert.equal(c.gen, p.gen + 1);
    assert.ok(c.born >= p.born && (p.died == null || p.died >= c.born), `parent ${p.id} alive at birth of ${c.id}`);
    n++;
  }
  assert.ok(n > 100, 'many divisions');
}
console.log('✓ lineage: parent, kind, generation and timing are consistent');

// 2) 죽음과 포식 기록이 시뮬레이션의 누적 집계와 같다
{
  const count = (kind, cause) => cells.filter(c => c.kind === kind && c.cause === cause).length;
  const D = rec.eco.deaths;
  assert.equal(count('herb', 'eaten'), D.herb.eaten);
  assert.equal(count('herb', 'starve'), D.herb.starve);
  assert.equal(count('carn', 'starve'), D.carn.starve);
  assert.equal(count('carn', 'age') + count('herb', 'age'), D.carn.age + D.herb.age);
  const prey = cells.flatMap(c => c.prey);
  assert.equal(prey.length, D.herb.eaten);
  for (const id of prey) assert.equal(by.get(id).cause, 'eaten');
  assert.equal(cells.filter(c => c.died == null).length, rec.eco.cells.length, 'alive = cells left in the dish');
}
console.log('✓ deaths and predations match the simulation counters');

// 3) 같은 시드면 같은 트리플
{
  const r2 = new Recorder({ seed: 3, years: 1 }); r2.advance();
  assert.deepEqual(r2.triples(), rec.triples());
}
console.log('✓ deterministic: same seed → same triples');

// 4) Turtle로 저장해 다시 읽어도 브라우저에서 바로 만든 그래프와 같다
{
  await init({ module_or_path: readFileSync(new URL('../assets/vendor/oxigraph/web_bg.wasm', import.meta.url)) });
  const tbox = parse(readFileSync(new URL('../examples/ecosystem/eco-ontology.ttl', import.meta.url), 'utf8'), { format: 'text/turtle' });
  const direct = buildGraph([...tbox, ...rec.toQuads()]);
  const f = join(mkdtempSync(join(tmpdir(), 'eco-')), 'run.ttl');
  writeFileSync(f, rec.toTurtle());
  const viaTtl = await loadGraph('examples/ecosystem/eco-ontology.ttl', f);
  assert.equal(viaTtl.nodes.length, direct.nodes.length);
  assert.equal(viaTtl.rels.length, direct.rels.length);
  const herb = direct.byLabel.get('Herbivore')[0];
  assert.ok(herb.labels.includes('Cell'), 'subclass label');
  for (const c of ECO_CYPHER) for (const q of [c.q, c.qEn].filter(Boolean)) {
    const a = runCypher(direct, q), b = runCypher(viaTtl, q);
    assert.ok(a.rows.length > 0, `rows for: ${c.ko}`);
    assert.deepEqual(a.rows, b.rows, `same answer from Turtle: ${c.ko}`);
  }
}
console.log('✓ Turtle round trip gives the same graph and the same answers to every question');

// 5) 혈통 질문: 살아남은 육식 세포의 조상은 부모 없는 첫 세대
{
  const G = await loadGraph('examples/ecosystem/eco-ontology.ttl');
  assert.equal(G.byLabel.get('Season').length, 4);
  assert.equal(G.byLabel.get('Refuge').length, 3);
  const quadsG = buildGraph([...parse(readFileSync(new URL('../examples/ecosystem/eco-ontology.ttl', import.meta.url), 'utf8'), { format: 'text/turtle' }), ...rec.toQuads()]);
  const r = runCypher(quadsG, ECO_CYPHER[0].q);
  for (const [founder, origin] of r.rows) { assert.equal(by.get(founder).parent, null); assert.notEqual(origin, 'division'); }
}
console.log('✓ founders of surviving carnivores have no parent');
