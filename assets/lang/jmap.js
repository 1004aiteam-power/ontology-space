// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Java HashMap 시연의 모형: String.hashCode, 해시 퍼뜨리기(h ^ h>>>16), 버킷 번호 (n-1)&h, 같은 버킷의 연결 리스트, 0.75 적재율에서 두 배로 늘리기.
// tests/lang.test.mjs 가 같은 키로 진짜 JVM 의 HashMap 내부 table 을 리플렉션으로 읽어 버킷 배치와 equals 호출 수가 같은지 확인한다.

export function javaHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
export const spread = (h) => (h ^ (h >>> 16)) | 0;
export const bucketOf = (h, n) => (n - 1) & spread(h);

// 키 종류: str = 문자열(좋은 해시), bad = hashCode 가 늘 42, mut = 가변 필드 id 를 해시로 씀
const SCN = (id, ko, en, program, steps) => ({ id, ko, en, program, steps });
const keys = (names) => names.map(n => ({ id: n, h: javaHash(n) }));

export const SCENARIOS = [
  SCN('good', '좋은 해시: 고르게 퍼짐', 'A good hash: spread evenly',
    'Map<String, Integer> m = new HashMap<>();\nm.put("T1", 82);  m.put("T2", 64);  m.put("T3", 95);\nm.put("B1", 91);  m.put("B2", 58);  m.put("C1", 77);\nm.put("R1", 66);  m.put("M1", 40);  m.put("M2", 55);\nm.get("B2");',
    [
      ...[['T1', 82, 1], ['T2', 64, 1], ['T3', 95, 1], ['B1', 91, 2], ['B2', 58, 2], ['C1', 77, 2], ['R1', 66, 3], ['M1', 40, 3], ['M2', 55, 3]].map(([k, v, l]) => ({ line: l, op: ['put', k, javaHash(k), v], note: [`"${k}".hashCode() = ${javaHash(k)} → 퍼뜨린 뒤 (n-1)&h 로 버킷이 정해집니다.`, `"${k}".hashCode() = ${javaHash(k)} → after spreading, (n-1)&h picks the bucket.`] })),
      { line: 4, op: ['get', 'B2', javaHash('B2'), true], note: ['get 은 버킷 번호를 곧바로 계산해 그 버킷만 확인합니다 — 항목이 몇 개든 거의 한 번에 찾습니다 (평균 O(1)).', 'get computes the bucket straight away and checks only that bucket: nearly one step however many entries (average O(1)).'] }]),
  SCN('bad', '나쁜 hashCode: 한 버킷에 몰림', 'A bad hashCode: everything in one bucket',
    'class BadKey {\n    final String id;\n    BadKey(String id) { this.id = id; }\n    @Override public int hashCode() { return 42; }          // 늘 같은 값\n    @Override public boolean equals(Object o) { return o instanceof BadKey b && b.id.equals(id); }\n}\nfor (int i = 1; i <= 7; i++) m.put(new BadKey("k" + i), i);\nm.get(new BadKey("k7"));',
    [
      ...[1, 2, 3, 4, 5, 6, 7].map(i => ({ line: 6, op: ['put', `k${i}`, 42, i], note: [i === 1 ? '모든 키의 hashCode 가 42 라 항상 같은 버킷으로 갑니다.' : `k${i} 도 같은 버킷 — 연결 리스트가 ${i}칸으로 길어집니다.`, i === 1 ? 'Every key\'s hashCode is 42, so all go to the same bucket.' : `k${i} lands in the same bucket too; the chain is now ${i} long.`] })),
      { line: 7, op: ['get', 'k7', 42, true], note: ['해시가 같은 노드를 처음부터 하나씩 equals 로 비교해 7번째에서야 찾습니다 → O(n). 해시 맵의 장점이 사라집니다. (한 버킷이 8개를 넘고 테이블이 64칸 이상이면 Java 8 부터는 트리로 바꿔 O(log n)으로 완화하지만, 원인은 고쳐야 합니다.)', 'It compares equal-hash nodes one by one with equals and finds it at the 7th → O(n). The hash map\'s advantage is gone. (Since Java 8 a bucket over 8 entries in a table of 64+ is turned into a tree for O(log n), but fix the cause.)'] }]),
  SCN('mutable', '가변 키: 넣은 뒤 바꾸면 못 찾음', 'A mutable key: change it after insertion and it is lost',
    'class Key {\n    int id;\n    Key(int id) { this.id = id; }\n    @Override public int hashCode() { return id; }\n    @Override public boolean equals(Object o) { return o instanceof Key k && k.id == id; }\n}\nKey k = new Key(1);\nm.put(k, "grid");\nk.id = 99;                       // 키를 바꿈\nm.get(k);                        // 같은 객체인데?',
    [
      { line: 7, op: ['put', 'k', 1, 'grid'], note: ['id=1 일 때의 해시로 버킷 1 에 저장됩니다. 맵은 그 해시를 노드에 기억해 둡니다.', 'It is stored in bucket 1 using the hash at id=1, and the node remembers that hash.'] },
      { line: 8, op: ['mutate', 'k', 99], note: ['키 객체의 id 를 99 로 바꿨습니다. 맵 안의 노드는 그대로 버킷 1 에 있습니다.', 'The key object\'s id became 99, but the node stays in bucket 1.'] },
      { line: 9, op: ['get', 'k', 99, false], note: ['get 은 지금의 해시(99)로 버킷 3 을 찾아보지만 거기엔 아무것도 없습니다 → null. 항목은 맵 안에 있는데 영원히 못 찾는 "유령"이 됩니다.', 'get uses the current hash (99), looks in bucket 3 and finds nothing → null. The entry is in the map but is now an unreachable "ghost".'] }])
];

export function simulate(scn) {
  let n = 16, size = 0;
  let buckets = Array.from({ length: n }, () => []);
  const hashes = new Map();                  // 키 id → 지금의 hashCode (가변 키는 바뀔 수 있음)
  const snaps = [], out = [];
  const snap = (step, look) => snaps.push({ line: step ? step.line : -1, note: step ? step.note : null, n, size, buckets: buckets.map(b => b.map(e => ({ ...e }))), look: look || null, out: [...out] });
  snap(null);
  for (const step of scn.steps) {
    const [op, id, h, a] = step.op;
    let look = null;
    if (op === 'put') {
      hashes.set(id, h);
      buckets[bucketOf(h, n)].push({ id, hash: spread(h), val: a }); size++;
      if (size > n * 0.75) {                     // 임계값을 넘으면 두 배로 늘리고 옛 버킷 순서대로 다시 넣는다
        const old = buckets; n *= 2; buckets = Array.from({ length: n }, () => []);
        for (const b of old) for (const e of b) buckets[(n - 1) & e.hash].push(e);
      }
    } else if (op === 'mutate') hashes.set(id, h);
    else if (op === 'get') {
      const cur = hashes.get(id), idx = bucketOf(cur, n), checked = [];
      let equalsCalls = 0, found = null;
      for (const e of buckets[idx]) {
        if (e.hash !== spread(cur)) { checked.push({ id: e.id, equals: false }); continue; }        // 해시가 다르면 equals 도 안 부름
        equalsCalls += a ? 1 : 0;                                                                  // a=true: 새로 만든 같은 값 객체 → equals 호출
        checked.push({ id: e.id, equals: true });
        if (e.id === id) { found = e; break; }
      }
      look = { index: idx, checked, equalsCalls, found: found ? found.val : null };
      out.push(found ? `get → ${found.val}` : 'get → null');
    }
    snap(step, look);
  }
  return { snaps, out };
}
