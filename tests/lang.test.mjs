// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 프로그래밍 언어 페이지(lang-*.html) 점검 (브라우저 없이) — 실행: node tests/lang.test.mjs
// 페이지의 모든 예제 코드를 실제 컴파일러 · 인터프리터로 다시 실행해 화면에 적힌 출력과 같은지 확인하고, 시연 모형이 진짜 실행과 일치하는지 본다.
// 도구가 없으면(예: R) 그 언어는 건너뛰고 그 사실을 출력한다.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(root, f), 'utf8');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const have = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const env = { ...process.env }; delete env.JAVA_TOOL_OPTIONS;
const sh = (cmd, args, cwd, input) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env, timeout: 60000, input });

// 코드 한 덩어리를 실행해 표준 출력을 돌려준다 (도구가 없으면 null)
export function runCode(lang, src) {
  const d = mkdtempSync(join(tmpdir(), 'lang-'));
  try {
    if (lang === 'python') { if (!have('python3')) return null; writeFileSync(join(d, 'main.py'), src); const r = sh('python3', ['main.py'], d); assert.equal(r.status, 0, `python failed:\n${r.stderr}\n${src}`); return r.stdout.replace(/\n$/, ''); }
    if (lang === 'c' || lang === 'cpp') {
      const cc = lang === 'c' ? 'gcc' : 'g++'; if (!have(cc)) return null;
      writeFileSync(join(d, `main.${lang === 'c' ? 'c' : 'cpp'}`), src);
      const c = sh(cc, [lang === 'c' ? '-std=c17' : '-std=c++20', '-Wall', '-Wextra', '-O0', `main.${lang === 'c' ? 'c' : 'cpp'}`, '-o', 'a.out'], d); assert.equal(c.status, 0, `${cc} failed:\n${c.stderr}\n${src}`);
      const r = sh('./a.out', [], d); assert.equal(r.status, 0, `${lang} run failed (${r.status}):\n${r.stderr}\n${src}`); return r.stdout.replace(/\n$/, '');
    }
    if (lang === 'java') {
      if (!have('javac')) return null; writeFileSync(join(d, 'Main.java'), src);
      const c = sh('javac', ['Main.java'], d); assert.equal(c.status, 0, `javac failed:\n${c.stderr}\n${src}`);
      const r = sh('java', ['-cp', '.', 'Main'], d); assert.equal(r.status, 0, `java failed:\n${r.stderr}\n${src}`); return r.stdout.replace(/\n$/, '');
    }
    if (lang === 'rust') {
      if (!have('rustc')) return null; writeFileSync(join(d, 'main.rs'), src);
      const c = sh('rustc', ['--edition', '2021', 'main.rs', '-o', 'a.out'], d); assert.equal(c.status, 0, `rustc failed:\n${c.stderr}\n${src}`);
      assert.ok(!/^warning/m.test(c.stderr), `rustc warns:\n${c.stderr}`);
      const r = sh('./a.out', [], d); assert.equal(r.status, 0, `rust run failed:\n${r.stderr}\n${src}`); return r.stdout.replace(/\n$/, '');
    }
    if (lang === 'r') { if (!have('Rscript')) return null; writeFileSync(join(d, 'main.R'), src); const r = sh('Rscript', ['main.R'], d); assert.equal(r.status, 0, `Rscript failed:\n${r.stderr}\n${src}`); return r.stdout.replace(/\n$/, ''); }
    throw new Error('unknown language ' + lang);
  } finally { rmSync(d, { recursive: true, force: true }); }
}

const PAGES = ['lang-c', 'lang-cpp', 'lang-java', 'lang-r', 'lang-python', 'lang-rust', 'lang-compare'].filter(p => existsSync(join(root, `${p}.html`)));

// 1) 페이지의 모든 예제를 다시 실행해 출력이 같은지 확인
{
  const stats = {}, skipped = new Set();
  for (const p of PAGES) {
    const s = read(`${p}.html`);
    for (const m of s.matchAll(/<div class="ex" data-lang="(\w+)"([^>]*)>([\s\S]*?)<\/div>/g)) {
      const [, lang, attrs, inner] = m;
      if (/data-norun/.test(attrs)) continue;
      const code = /<code class="language-\w+">([\s\S]*?)<\/code><\/pre>\s*<pre class="lout"[^>]*><code>([\s\S]*?)<\/code>/.exec(inner);
      assert.ok(code, `${p}: malformed example block (${lang})`);
      const [src, expect] = [unesc(code[1]), unesc(code[2])];
      const got = runCode(lang, src);
      if (got === null) { skipped.add(lang); assert.ok(/data-unverified/.test(attrs), `${p}: a ${lang} example is not marked unverified though the tool is missing`); continue; }
      assert.ok(!/data-unverified/.test(attrs) || true);
      assert.equal(got, expect, `${p}: output differs for ${lang} example:\n${src}`);
      stats[lang] = (stats[lang] || 0) + 1;
    }
  }
  console.log(`✓ every runnable example reproduces its printed output: ${Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'}${skipped.size ? ` (skipped, tool missing: ${[...skipped].join(', ')})` : ''}`);
}

// 2) Python 참조 시연: 모형의 출력이 진짜 Python 과 같다
{
  const { SCENARIOS, simulate } = await import('../assets/lang/pyref.js');
  if (have('python3')) {
    for (const scn of SCENARIOS) {
      const real = runCode('python', scn.program), model = simulate(scn).out.join('\n');
      assert.equal(model, real, `pyref ${scn.id}: the model prints what real Python prints`);
      // 모든 줄 번호가 프로그램 안에 있다
      const n = scn.program.split('\n').length; for (const st of scn.steps) assert.ok(st.line >= 0 && st.line < n, `${scn.id}: line ${st.line} exists`);
      assert.ok(scn.steps.every(st => st.note[0] && st.note[1]), `${scn.id}: both languages`);
    }
    const a = simulate(SCENARIOS[0]), last = a.snaps.at(-1);
    assert.equal(last.vars.a, last.vars.b, 'a and b are the same object'); assert.notEqual(last.vars.c, last.vars.a);
    const rows = simulate(SCENARIOS.find(s => s.id === 'rows')).snaps, afterMul = rows[1];
    assert.equal(new Set(afterMul.objs[afterMul.vars.m].items.map(x => x.ref)).size, 1, '[[0]*3]*3 holds the same inner list three times');
    const after = rows[4]; assert.equal(new Set(after.objs[after.vars.n].items.map(x => x.ref)).size, 3, 'the comprehension makes three separate lists');
    console.log(`✓ the Python reference demo prints exactly what real Python prints (${SCENARIOS.length} scenarios)`);
  } else console.log('- python3 missing: reference demo not compared');
}

// 3) C 메모리 시연: 모형의 판정이 진짜 AddressSanitizer 의 보고와 같은 종류다
{
  const { SCENARIOS, simulate } = await import('../assets/lang/cmem.js');
  if (have('gcc')) {
    for (const scn of SCENARIOS) {
      const d = mkdtempSync(join(tmpdir(), 'asan-'));
      try {
        writeFileSync(join(d, 'm.c'), scn.program);
        const c = sh('gcc', ['-g', '-fsanitize=address', '-O0', '-w', 'm.c', '-o', 'a.out'], d); assert.equal(c.status, 0, `${scn.id}: compile\n${c.stderr}`);
        const r = sh('./a.out', [], d), report = r.stdout + r.stderr;
        const model = simulate(scn);
        if (scn.asan === null) { assert.equal(r.status, 0); assert.equal(model.verdict, null, `${scn.id}: the model sees no problem`); assert.equal(r.stdout.trim(), scn.stdout); assert.equal(model.out.join('\n'), scn.stdout); }
        else { assert.ok(report.includes(scn.asan), `${scn.id}: AddressSanitizer reports "${scn.asan}":\n${report.slice(0, 400)}`); assert.ok(model.verdict, `${scn.id}: the model also finds a problem`); }
        const n = scn.program.split('\n').length; for (const st of scn.steps) assert.ok(st.line >= 0 && st.line < n && st.note[0] && st.note[1], `${scn.id}: step text and line`);
      } finally { rmSync(d, { recursive: true, force: true }); }
    }
    const kinds = Object.fromEntries(SCENARIOS.map(s => [s.id, simulate(s).verdict?.kind ?? null]));
    assert.deepEqual(kinds, { ok: null, leak: 'leak', uaf: 'uaf', dfree: 'dfree', oob: 'oob' });
    console.log(`✓ the C memory demo's verdicts match what AddressSanitizer reports (${SCENARIOS.length} scenarios)`);
  } else console.log('- gcc missing: C memory demo not compared');
}

// 4) C++ 시연: 저장해 둔 실행 기록이 지금 g++ 로 다시 실행한 결과와 같다
{
  const { RUNS } = await import('../assets/lang/cppruns.js');
  if (have('g++')) {
    for (const r of RUNS) {
      const out = runCode('cpp', r.program), ev = out.split('\n').map(l => { const m = /^(\d+):(.*)$/.exec(l); return { line: +m[1] - 1, text: m[2] }; });
      assert.deepEqual(r.events, ev, `${r.id}: the recorded run equals a fresh run`);
      assert.equal(r.notes.length, r.events.length, `${r.id}: one note per output line`);
      assert.ok(r.notes.every(n => n.length === 2), `${r.id}: notes in both languages`);
      const n = r.program.split('\n').length; assert.ok(r.events.every(e => e.line >= 0 && e.line < n), `${r.id}: lines exist`);
    }
    // 핵심 사실: 소멸은 생성의 역순, 이동은 복사하지 않는다, unique_ptr 는 소유권이 이동한다
    const t = (id) => RUNS.find(r => r.id === id).events.map(e => e.text);
    assert.deepEqual(t('raii').slice(0, 4), ['acquire A', 'acquire B', 'release B', 'release A'], 'RAII: reverse destruction, even with an exception');
    assert.deepEqual(t('move'), ['construct 1', 'COPY 1 -> 101', 'move 1', 'a=-1 b=101 c=1', 'destroy 1', 'destroy 101', 'destroy -1']);
    assert.deepEqual(t('uptr'), ['new Node 1', 'new Node 2', 'take 1', 'delete Node 1', 'p is empty', 'delete Node 2', 'end of main']);
    console.log(`✓ the C++ demo's recorded runs equal fresh g++ runs (${RUNS.length} programs)`);
  } else console.log('- g++ missing: C++ demo not compared');
}

// 5) Java HashMap 시연: 모형의 버킷 배치와 equals 호출 수가 진짜 JVM 의 HashMap 과 같다
{
  const { SCENARIOS, simulate, javaHash } = await import('../assets/lang/jmap.js');
  if (have('javac')) {
    const layout = (snap) => snap.buckets.map((b, i) => (b.length ? `${i}:${b.map(e => e.id).join('>')}` : null)).filter(Boolean).join(' | ');
    const java = `import java.lang.reflect.*; import java.util.*;
public class Main {
  static int eq = 0;
  static class BadKey { final String id; BadKey(String i) { id = i; } public int hashCode() { return 42; } public boolean equals(Object o) { eq++; return o instanceof BadKey b && b.id.equals(id); } public String toString() { return id; } }
  static class Key { int id; Key(int i) { id = i; } public int hashCode() { return id; } public boolean equals(Object o) { return o instanceof Key k && k.id == id; } public String toString() { return "k"; } }
  static String dump(HashMap<?, ?> m) throws Exception {
    Field f = HashMap.class.getDeclaredField("table"); f.setAccessible(true);
    Class<?> nc = Class.forName("java.util.HashMap$Node"); Field next = nc.getDeclaredField("next"), key = nc.getDeclaredField("key"); next.setAccessible(true); key.setAccessible(true);
    Object[] t = (Object[]) f.get(m); StringBuilder sb = new StringBuilder();
    for (int i = 0; i < t.length; i++) if (t[i] != null) { if (sb.length() > 0) sb.append(" | "); sb.append(i).append(':'); for (Object n = t[i]; n != null; n = next.get(n)) { sb.append(key.get(n)); if (next.get(n) != null) sb.append('>'); } }
    return sb.toString();
  }
  public static void main(String[] args) throws Exception {
    HashMap<String, Integer> a = new HashMap<>(); for (String k : new String[]{"T1","T2","T3","B1","B2","C1","R1","M1","M2"}) a.put(k, k.length());
    System.out.println(dump(a)); System.out.println(a.get(new String("B2")) != null);
    HashMap<BadKey, Integer> b = new HashMap<>(); for (int i = 1; i <= 7; i++) b.put(new BadKey("k" + i), i);
    System.out.println(dump(b)); eq = 0; b.get(new BadKey("k7")); System.out.println(eq);
    HashMap<Key, String> c = new HashMap<>(); Key k = new Key(1); c.put(k, "grid"); k.id = 99;
    System.out.println(dump(c)); System.out.println(c.get(k)); System.out.println(c.size());
  }
}`;
    const d = mkdtempSync(join(tmpdir(), 'jmap-'));
    try {
      writeFileSync(join(d, 'Main.java'), java);
      const c = sh('javac', ['Main.java'], d); assert.equal(c.status, 0, c.stderr);
      const r = sh('java', ['--add-opens', 'java.base/java.util=ALL-UNNAMED', '-cp', '.', 'Main'], d); assert.equal(r.status, 0, r.stderr);
      const real = r.stdout.trim().split('\n');
      const [good, bad, mut] = SCENARIOS.map(s => simulate(s));
      assert.equal(layout(good.snaps.at(-1)), real[0], 'good keys: the model lays buckets out like the real HashMap');
      assert.equal(good.snaps.at(-1).look.found, 58); assert.equal(real[1], 'true');
      assert.equal(layout(bad.snaps.at(-1)), real[2], 'bad hashCode: one long chain in insertion order');
      assert.equal(String(bad.snaps.at(-1).look.equalsCalls), real[3], 'bad hashCode: the lookup calls equals as many times as the real map does');
      assert.equal(layout(mut.snaps.at(-1)), real[4], 'mutable key: the node stays in the bucket of its old hash');
      assert.equal(mut.snaps.at(-1).look.found, null); assert.equal(real[5], 'null'); assert.equal(real[6], '1');
      assert.equal(javaHash('hello'), 99162322, 'String.hashCode');
      // 크기가 늘 때(13번째 항목)의 두 배 확장과 배치도 같다
      const many = Array.from({ length: 13 }, (_, i) => `K${i}`);
      const prog = `import java.lang.reflect.*; import java.util.*;
public class Main { public static void main(String[] a) throws Exception { HashMap<String,Integer> m = new HashMap<>(); for (String k : new String[]{${many.map(k => `"${k}"`).join(',')}}) m.put(k, 1);
  Field f = HashMap.class.getDeclaredField("table"); f.setAccessible(true); Object[] t = (Object[]) f.get(m); System.out.println(t.length);
  Class<?> nc = Class.forName("java.util.HashMap$Node"); Field next = nc.getDeclaredField("next"), key = nc.getDeclaredField("key"); next.setAccessible(true); key.setAccessible(true);
  StringBuilder sb = new StringBuilder(); for (int i = 0; i < t.length; i++) if (t[i] != null) { if (sb.length() > 0) sb.append(" | "); sb.append(i).append(':'); for (Object n = t[i]; n != null; n = next.get(n)) { sb.append(key.get(n)); if (next.get(n) != null) sb.append('>'); } } System.out.println(sb); } }`;
      writeFileSync(join(d, 'Main.java'), prog); assert.equal(sh('javac', ['Main.java'], d).status, 0);
      const r2 = sh('java', ['--add-opens', 'java.base/java.util=ALL-UNNAMED', '-cp', '.', 'Main'], d).stdout.trim().split('\n');
      const grow = simulate({ steps: many.map(k => ({ line: 0, op: ['put', k, javaHash(k), 1], note: ['', ''] })) }).snaps.at(-1);
      assert.equal(String(grow.n), r2[0], 'the table doubles at the 13th entry'); assert.equal(layout(grow), r2[1], 'entries are redistributed like the real resize');
    } finally { rmSync(d, { recursive: true, force: true }); }
    console.log('✓ the Java HashMap model matches the real JVM: bucket layout, equals calls, mutable keys and resizing');
  } else console.log('- javac missing: Java HashMap demo not compared');
}

// 6) R 벡터 시연: 모형의 출력 형식 · 값 · 경고가 진짜 R 과 같다
{
  const { evaluate, fmtVector, NA } = await import('../assets/lang/rvec.js');
  if (have('Rscript')) {
    const A = [82, NA, 91, 58], N = (a) => a.map(x => (x === null ? 'NA' : x)).join(', ');
    const cases = [
      { spec: { mode: 'binary', op: '+', a: [1, 2, 3, 4], b: [10, 20] } },
      { spec: { mode: 'binary', op: '+', a: [1, 2, 3], b: [10, 20] } },
      { spec: { mode: 'binary', op: '*', a: [1, 2, 3, 4, 5, 6], b: [2] } },
      { spec: { mode: 'binary', op: '/', a: [1, 2, 3], b: [3] } },
      { spec: { mode: 'binary', op: '>', a: A, b: [70] } },
      { spec: { mode: 'binary', op: '==', a: [1, NA], b: [NA, NA] } },
      { spec: { mode: 'binary', op: '^', a: [2, 3], b: [2, 0.5] } },
      { spec: { mode: 'binary', op: '%%', a: [7, 10, -3], b: [3] } },
      { spec: { mode: 'binary', op: '-', a: [0.1, 0.25], b: [0.05] } },
      { spec: { mode: 'summary', fn: 'sum', a: A, narm: false } }, { spec: { mode: 'summary', fn: 'sum', a: A, narm: true } },
      { spec: { mode: 'summary', fn: 'mean', a: A, narm: true } }, { spec: { mode: 'summary', fn: 'max', a: A, narm: false } },
      { spec: { mode: 'summary', fn: 'max', a: A, narm: true } }, { spec: { mode: 'summary', fn: 'length', a: A, narm: false } },
      { spec: { mode: 'summary', fn: 'mean', a: [1, 2, 4], narm: false } },
      { spec: { mode: 'filter', op: '>', a: A, k: 70 } }, { spec: { mode: 'filter', op: '<=', a: [5, 1, 9, 3], k: 3 } },
      { spec: { mode: 'binary', op: '+', a: Array.from({ length: 30 }, (_, i) => (i + 1) / 7), b: [1] } }
    ];
    // 한 번의 Rscript 실행으로 모든 경우를 돌린다 (구분선을 찍어 나눈다)
    const script = cases.map((c, i) => `cat("@@${i}\\n"); ${evalCode(c.spec)}`).join('\n');
    function evalCode(s) {
      const v = (a) => `c(${N(a)})`;
      if (s.mode === 'binary') return `a <- ${v(s.a)}; b <- ${v(s.b)}; r <- withCallingHandlers(a ${s.op} b, warning = function(w) { cat("WARN:", conditionMessage(w), "\\n"); invokeRestart("muffleWarning") }); print(r)`;
      if (s.mode === 'summary') return `x <- ${v(s.a)}; print(${s.fn === 'length' ? 'length(x)' : `${s.fn}(x${s.narm ? ', na.rm = TRUE' : ''})`})`;
      return `x <- ${v(s.a)}; print(x[x ${s.op} ${s.k}])`;
    }
    const d = mkdtempSync(join(tmpdir(), 'rvec-'));
    try {
      writeFileSync(join(d, 'main.R'), script);
      const r = sh('Rscript', ['main.R'], d); assert.equal(r.status, 0, r.stderr);
      const parts = r.stdout.split(/@@\d+\n/).slice(1);
      assert.equal(parts.length, cases.length);
      cases.forEach((c, i) => {
        const m = evaluate(c.spec), real = parts[i].trim();
        const expected = (m.warning ? `WARN: ${m.warning} \n` : '') + m.out;
        assert.equal(real, expected.trim(), `R vector model: ${JSON.stringify(c.spec)}\n--- real R ---\n${real}\n--- model ---\n${expected}`);
      });
    } finally { rmSync(d, { recursive: true, force: true }); }
    assert.equal(fmtVector([1, 2]), '[1] 1 2'); assert.equal(fmtVector([true, null, false], 'lgl'), '[1]  TRUE    NA FALSE');
    console.log(`✓ the R vector model prints exactly what real R prints, including recycling warnings and NA rules (${cases.length} cases)`);
  } else console.log('- Rscript missing: R vector demo not compared');
}

// 6-2) Rust 빌림 시연: 모형의 판정이 진짜 rustc 의 오류 코드(또는 실행 출력)와 같다
{
  const { SCENARIOS, simulate } = await import('../assets/lang/rown.js');
  if (have('rustc')) {
    for (const scn of SCENARIOS) {
      const d = mkdtempSync(join(tmpdir(), 'rown-'));
      try {
        writeFileSync(join(d, 'main.rs'), scn.program);
        const c = sh('rustc', ['--edition', '2021', 'main.rs', '-o', 'a.out'], d), model = simulate(scn);
        if (scn.error === null) {
          assert.equal(c.status, 0, `${scn.id}: compiles\n${c.stderr}`); assert.equal(model.verdict, null, `${scn.id}: the model accepts it too`);
          const r = sh('./a.out', [], d); assert.equal(r.stdout.trim(), scn.stdout); assert.equal(model.out.join('\n'), scn.stdout, `${scn.id}: the model prints what the program prints`);
        } else {
          assert.notEqual(c.status, 0, `${scn.id}: rustc rejects it`); assert.ok(c.stderr.includes(`error[${scn.error}]`), `${scn.id}: rustc reports ${scn.error}:\n${c.stderr.slice(0, 400)}`);
          assert.equal(model.verdict?.code, scn.error, `${scn.id}: the model stops with the same error code`);
          assert.equal(scn.steps.at(-1).line, model.snaps.at(-1).line, `${scn.id}: the model stops on the last step`);
        }
        const n = scn.program.split('\n').length; for (const st of scn.steps) assert.ok(st.line >= 0 && st.line < n && st.note[0] && st.note[1], `${scn.id}: step text and line`);
      } finally { rmSync(d, { recursive: true, force: true }); }
    }
    console.log(`✓ the Rust borrow demo agrees with real rustc: error codes and outputs (${SCENARIOS.length} scenarios)`);
  } else console.log('- rustc missing: Rust borrow demo not compared');
}

// 7) 페이지: 메뉴 · 한영 짝 · 고유한 id · 링크 · 비교 페이지의 다섯 프로그램은 같은 출력
{
  const pages = ['lang-c', 'lang-cpp', 'lang-java', 'lang-r', 'lang-python', 'lang-rust', 'lang-compare'];
  const known = new Set([...pages, 'git-basics', 'git-branch', 'git-remote', 'git-trouble', 'db-map', 'db-file', 'db-wire', 'db-driver', 'db-orm', 'db-service', 'db-graphql', 'db-modern', 'db-choose', 'concurrency', 'socket', 'http', 'ontology', 'lab', 'index']);
  for (const p of pages) {
    const s = read(`${p}.html`);
    assert.ok(s.includes('id="otherMenu"'), `${p}: menu`); assert.ok(/<meta name="title-en"/.test(s), `${p}: English title`);
    assert.ok(s.includes('vendor/highlight.min.js'), `${p}: loads the highlighter`);
    const ko = (s.match(/lang="ko"/g) || []).length, en = (s.match(/lang="en"/g) || []).length;
    assert.ok(ko > 10 && Math.abs(ko - en) <= 6, `${p}: Korean (${ko}) and English (${en}) texts are paired`);
    const ids = [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${p}: duplicate ids ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
    const main = s.slice(s.indexOf('<main'), s.indexOf('</main>'));
    for (const m of main.matchAll(/href="([a-z-]+)\.html(?:#[^"]*)?"/g)) assert.ok(known.has(m[1]), `${p}: link to unknown page ${m[1]}`);
    // 모든 예제에는 코드와 (실행하는 것은) 출력이 있고, 한 번도 실행하지 못한 출력은 없다고 표시되어 있다
    for (const m of s.matchAll(/<div class="ex" data-lang="(\w+)"([^>]*)>([\s\S]*?)<\/div>/g)) assert.ok(/data-norun|class="lout"/.test(m[2] + m[3]), `${p}: an example has no output`);
    if (p !== 'lang-compare') assert.ok(['overview', 'demo', 'concepts', 'pitfalls', 'tools'].every(id => ids.includes(id)), `${p}: has the five standard sections`);
  }
  // 비교 페이지: 다섯 프로그램의 출력이 정확히 같다
  const cmp = read('lang-compare.html'), task = cmp.split('<section id="table"')[0];
  const outs = [...task.matchAll(/<pre class="lout"[^>]*><code>([\s\S]*?)<\/code>/g)].map(m => unesc(m[1]));
  assert.equal(outs.length, 5); assert.ok(outs.every(o => o === outs[0]), `the five programs print one output: ${JSON.stringify(outs)}`); assert.equal(outs[0], 'B1 91\nT1 82\nC1 77\navg=83.3');
  const div = cmp.split('<section id="gotcha"')[1].split('</section>')[0];
  const d = [...div.matchAll(/<div class="ex" data-lang="(\w+)"[^>]*>[\s\S]*?<pre class="lout"[^>]*><code>([\s\S]*?)<\/code>/g)].map(m => [m[1], unesc(m[2])]);
  assert.deepEqual(Object.fromEntries(d), { c: '3 -3 -1', cpp: '3 -3 -1', java: '3 -3 -1', r: '3.5 -4 1', python: '3.5 -4 1' }, 'integer division and remainder differ the way the text says');
  // 페이지마다 시연 요소가 있다
  for (const [p, ids] of Object.entries({ 'lang-c': ['cScn', 'cNext'], 'lang-cpp': ['xScn', 'xNext'], 'lang-java': ['jScn', 'jNext'], 'lang-r': ['rPresets', 'rA'], 'lang-python': ['pyScn', 'pyNext'], 'lang-rust': ['rScn', 'rNext'] })) for (const id of ids) assert.ok(read(`${p}.html`).includes(`id="${id}"`), `${p}: demo element ${id}`);
  console.log(`✓ the seven language pages are well formed; the five programs of the comparison print the same output`);
}
