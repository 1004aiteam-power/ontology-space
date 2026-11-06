// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 세계 지도 데이터 만들기: Natural Earth(공개 데이터)를 담은 world-atlas(ISC) TopoJSON → 화면용 작은 JSON
//
//   npm pack world-atlas@2.0.2 && tar xzf world-atlas-2.0.2.tgz
//   node examples/flights/build_world_map.mjs package/ > assets/data/world-map.json
//
// 출력 형식: { s: 1도당 정수 단위, land110, land50, borders50 }
//   각 항목은 고리(선) 목록, 고리는 [x0, y0, dx1, dy1, dx2, dy2, ...] (경도·위도 × s, 첫 점은 절댓값, 나머지는 차이)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'package';
const S = 50;                                                    // 0.02° 단위 (화면 확대 범위에서 충분)

function decodeArcs(topo) {
  const [kx, ky] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  return topo.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * kx + tx, y * ky + ty]; }); });
}
function ringFrom(arcs, idx) {
  const out = [];
  for (const i of idx) {
    const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
    out.push(...(out.length ? a.slice(1) : a));
  }
  return out;
}
function polygons(topo, obj) {
  const arcs = decodeArcs(topo), rings = [];
  const geoms = obj.type === 'GeometryCollection' ? obj.geometries : [obj];
  for (const g of geoms) {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    for (const p of polys) for (const r of p) rings.push(ringFrom(arcs, r));
  }
  return rings;
}
// 국경: 두 나라가 함께 쓰는 선(arc)만
function borders(topo, obj) {
  const arcs = decodeArcs(topo), use = new Map();
  obj.geometries.forEach((g, gi) => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    for (const p of polys) for (const r of p) for (const i of r) { const k = i >= 0 ? i : ~i; if (!use.has(k)) use.set(k, new Set()); use.get(k).add(gi); }
  });
  return [...use].filter(([, s]) => s.size > 1).map(([k]) => arcs[k]);
}
function encode(lines, minPts = 2) {
  const out = [];
  for (const l of lines) {
    const q = [];
    for (const [lon, lat] of l) {
      const x = Math.round(lon * S), y = Math.round(lat * S);
      if (q.length && q[q.length - 1][0] === x && q[q.length - 1][1] === y) continue;
      q.push([x, y]);
    }
    if (q.length < minPts) continue;
    const flat = [q[0][0], q[0][1]];
    for (let i = 1; i < q.length; i++) flat.push(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
    out.push(flat);
  }
  return out;
}
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const l110 = load('land-110m.json'), l50 = load('land-50m.json'), c50 = load('countries-50m.json');
const out = {
  source: 'Natural Earth (public domain) via world-atlas 2.0.2 (ISC, Mike Bostock)',
  s: S,
  land110: encode(polygons(l110, l110.objects.land), 4),
  land50: encode(polygons(l50, l50.objects.land), 4),
  borders50: encode(borders(c50, c50.objects.countries), 2)
};
process.stdout.write(JSON.stringify(out));
