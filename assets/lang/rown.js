// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Rust 소유권 시연의 모형: 컴파일러의 빌림 검사기가 하는 일을 한 줄씩 따라간다.
// 변수 · 힙 블록 · 빌림(참조)을 보여 주고, 이동한 값을 쓰거나(E0382) 빌려 준 동안 바꾸거나(E0502) 먼저 사라지는 값을 빌리면(E0597) 멈춘다.
// 각 시나리오의 program 은 진짜 rustc 로 컴파일해, 오류 코드(error)나 실행 출력이 모형과 같은지 tests/lang.test.mjs 가 확인한다.

// op: string 이름 값 · vec 이름 [값…] · int 이름 값 · decl 이름 · move 원래 새 · clone 원래 새 · borrow 참조 대상 shared|mut
//     unborrow 참조 · push 이름 값 · print [쓰는 변수…] 출력 · enter · exit · end
export const SCENARIOS = [
  { id: 'move', ko: '이동 후 사용', en: 'Use after move', error: 'E0382', stdout: null,
    program: 'fn main() {\n    let s = String::from("grid");\n    let t = s;\n    println!("{t}");\n    println!("{s}");\n}',
    steps: [
      { line: 1, op: ['string', 's', 'grid'], note: ['힙에 "grid" 를 담은 블록 #1 을 만들고, s 가 그 주인이 됩니다. 값마다 주인은 딱 하나입니다.', 'A heap block #1 holding "grid" is created and s becomes its owner. Every value has exactly one owner.'] },
      { line: 2, op: ['move', 's', 't'], note: ['let t = s 는 복사가 아니라 이동(move)입니다. 주인이 t 로 바뀌고 s 는 더는 쓸 수 없습니다. 힙 블록은 그대로 하나뿐이라 두 번 해제될 일이 없습니다.', 'let t = s is a move, not a copy. Ownership passes to t and s can no longer be used. There is still only one heap block, so it can never be freed twice.'] },
      { line: 3, op: ['print', ['t'], 'grid'], note: ['새 주인 t 로 읽는 것은 괜찮습니다.', 'Reading through the new owner t is fine.'] },
      { line: 4, op: ['print', ['s'], ''], note: ['이동해 버린 s 를 읽으려 합니다. C 라면 해제 후 사용 버그가 될 자리를 Rust 는 컴파일 단계에서 막습니다.', 'This tries to read s, which was moved away. Where C would have a use-after-free bug, Rust stops it at compile time.'] }] },
  { id: 'clone', ko: '복제와 drop', en: 'Clone and drop', error: null, stdout: 'grid grid',
    program: 'fn main() {\n    let s = String::from("grid");\n    let t = s.clone();\n    println!("{s} {t}");\n}',
    steps: [
      { line: 1, op: ['string', 's', 'grid'], note: ['s 가 힙 블록 #1 의 주인입니다.', 's owns heap block #1.'] },
      { line: 2, op: ['clone', 's', 't'], note: ['clone() 은 힙 내용까지 복사해 새 블록 #2 를 만듭니다. 주인이 둘이 아니라, 블록이 둘이 됩니다. 비용이 드는 복사는 이렇게 코드에 드러납니다.', 'clone() copies the heap contents into a new block #2. Not two owners but two blocks. Costly copies are visible in the code.'] },
      { line: 3, op: ['print', ['s', 't'], 'grid grid'], note: ['둘 다 자기 블록의 주인이라 둘 다 쓸 수 있습니다.', 'Each owns its own block, so both can be used.'] },
      { line: 4, op: ['end'], note: ['범위가 끝나면 선언의 역순으로 t, s 가 drop 되며 블록이 해제됩니다. free 를 직접 부르지 않아도 되고 빠뜨릴 수도 없습니다.', 'At the end of scope t, then s, are dropped in reverse order and their blocks freed. No free to call, and none to forget.'] }] },
  { id: 'borrow', ko: '빌려 주기', en: 'Borrowing', error: null, stdout: 'feeder 6',
    program: 'fn len(x: &String) -> usize {\n    x.len()\n}\n\nfn main() {\n    let s = String::from("feeder");\n    let n = len(&s);\n    println!("{s} {n}");\n}',
    steps: [
      { line: 5, op: ['string', 's', 'feeder'], note: ['s 가 블록 #1 의 주인입니다.', 's owns block #1.'] },
      { line: 6, op: ['borrow', 'x', 's', 'shared'], note: ['&s 는 소유권을 넘기지 않고 "읽기 빌림(공유 참조)"만 줍니다. 함수 len 의 매개변수 x 가 s 를 가리킵니다.', '&s hands over no ownership, only a shared (read-only) borrow. The parameter x of len points at s.'] },
      { line: 1, op: ['print', ['x'], ''], note: ['x.len() 은 빌린 값을 읽기만 합니다.', 'x.len() only reads the borrowed value.'] },
      { line: 6, op: ['unborrow', 'x'], note: ['함수가 끝나면 빌림도 끝납니다. 블록은 해제되지 않습니다. 주인은 여전히 s 입니다.', 'The borrow ends with the function. The block is not freed: s is still the owner.'] },
      { line: 6, op: ['int', 'n', 6], note: ['n = 6 (정수는 스택에만 있는 Copy 타입).', 'n = 6 (an integer is a Copy type living only on the stack).'] },
      { line: 7, op: ['print', ['s', 'n'], 'feeder 6'], note: ['빌려 주었을 뿐이므로 s 를 계속 쓸 수 있습니다.', 'It was only lent, so s can still be used.'] },
      { line: 8, op: ['end'], note: ['s 가 drop 되며 블록 #1 이 해제됩니다.', 's is dropped and block #1 freed.'] }] },
  { id: 'alias', ko: '빌려 준 동안 바꾸기', en: 'Mutating while borrowed', error: 'E0502', stdout: null,
    program: 'fn main() {\n    let mut v = vec![1, 2, 3];\n    let first = &v[0];\n    v.push(4);\n    println!("{first}");\n}',
    steps: [
      { line: 1, op: ['vec', 'v', [1, 2, 3]], note: ['v 가 원소 3개짜리 힙 버퍼 #1 의 주인입니다.', 'v owns a heap buffer #1 with three elements.'] },
      { line: 2, op: ['borrow', 'first', 'v', 'shared'], note: ['first 는 버퍼 안의 첫 칸을 가리키는 읽기 빌림입니다. 5번째 줄에서 다시 쓰이므로 그때까지 살아 있습니다.', 'first is a shared borrow pointing into the buffer. It is used again on line 5, so it stays alive until then.'] },
      { line: 3, op: ['push', 'v', 4], note: ['push 는 v 를 바꾸는 쓰기(&mut v)입니다. 용량이 모자라면 버퍼를 새로 잡아 옮기므로 first 가 옛 주소를 가리키게 됩니다. "읽기 빌림이 살아 있는 동안 쓰기 금지" 규칙이 이를 막습니다.', 'push mutates v (it needs &mut v). If capacity runs out the buffer is reallocated, leaving first pointing at the old address. The rule "no writing while a shared borrow is alive" prevents this.'] }] },
  { id: 'fixed', ko: '고친 버전 (Copy)', en: 'Fixed (Copy)', error: null, stdout: '1 4',
    program: 'fn main() {\n    let mut v = vec![1, 2, 3];\n    let first = v[0];\n    v.push(4);\n    println!("{first} {}", v.len());\n}',
    steps: [
      { line: 1, op: ['vec', 'v', [1, 2, 3]], note: ['v 가 버퍼 #1 의 주인입니다.', 'v owns buffer #1.'] },
      { line: 2, op: ['int', 'first', 1], note: ['& 없이 v[0] 을 꺼내면 i32 는 Copy 타입이라 값이 복사됩니다. 빌림이 남지 않습니다.', 'Taking v[0] without & copies it, because i32 is a Copy type. No borrow remains.'] },
      { line: 3, op: ['push', 'v', 4], note: ['살아 있는 빌림이 없으니 바꿔도 됩니다.', 'No live borrow, so mutation is allowed.'] },
      { line: 4, op: ['print', ['first', 'v'], '1 4'], note: ['복사해 둔 first 와 늘어난 v 를 출력합니다.', 'Prints the copied first and the grown v.'] },
      { line: 5, op: ['end'], note: ['v 가 drop 되며 버퍼가 해제됩니다.', 'v is dropped and its buffer freed.'] }] },
  { id: 'dangle', ko: '먼저 사라지는 값', en: 'Value dies first', error: 'E0597', stdout: null,
    program: 'fn main() {\n    let r;\n    {\n        let x = 5;\n        r = &x;\n    }\n    println!("{r}");\n}',
    steps: [
      { line: 1, op: ['decl', 'r'], note: ['r 을 선언만 해 둡니다.', 'r is declared but not yet set.'] },
      { line: 2, op: ['enter'], note: ['안쪽 범위({ … })에 들어갑니다.', 'Enter the inner scope ({ … }).'] },
      { line: 3, op: ['int', 'x', 5], note: ['x 는 안쪽 범위의 지역 변수입니다.', 'x is local to the inner scope.'] },
      { line: 4, op: ['borrow', 'r', 'x', 'shared'], note: ['r 이 x 를 빌립니다. r 은 7번째 줄에서 쓰이므로 그때까지 x 가 살아 있어야 합니다.', 'r borrows x. r is used on line 7, so x must live until then.'] },
      { line: 5, op: ['exit'], note: ['범위가 끝나 x 가 사라집니다. 그런데 r 은 아직 쓰일 예정입니다 — C 의 "지역 변수 주소 반환"과 같은 매달린 참조입니다. 컴파일러는 빌림이 대상보다 오래 살 수 없다(수명 규칙)며 거부합니다.', 'The scope ends and x is gone, yet r is still to be used: a dangling reference, like returning a local\'s address in C. The compiler refuses because a borrow cannot outlive its value (the lifetime rule).'] }] }
];

const ERR = {
  E0382: (v) => ({ ko: `이동한 값 ${v} 를 사용 → 컴파일 오류 error[E0382]: borrow of moved value`, en: `Used ${v} after it was moved → compile error error[E0382]: borrow of moved value` }),
  E0502: (v, r) => ({ ko: `${r} 가 ${v} 를 읽기 빌림하는 동안 ${v} 를 바꾸려 함 → 컴파일 오류 error[E0502]`, en: `Tried to mutate ${v} while ${r} still borrows it → compile error error[E0502]` }),
  E0499: (v, r) => ({ ko: `${r} 가 ${v} 를 쓰기 빌림하는 동안 또 쓰기 → 컴파일 오류 error[E0499]`, en: `A second mutable use of ${v} while ${r} holds &mut → compile error error[E0499]` }),
  E0597: (v, r) => ({ ko: `${v} 가 사라진 뒤에도 ${r} 가 쓰임 → 컴파일 오류 error[E0597]: \`${v}\` does not live long enough`, en: `${r} is used after ${v} is gone → compile error error[E0597]: \`${v}\` does not live long enough` })
};

export function simulate(scn) {
  const vars = new Map(), heap = new Map(), out = [], snaps = [], scopes = [[]];
  let nextId = 1, verdict = null;
  // 빌림이 "살아 있다" = 이후 단계에서 다시 쓰인다 (컴파일러의 NLL 과 같은 생각)
  const lines = scn.program.split('\n');
  const usedLater = (k, name) => lines.slice(scn.steps[k].line + 1).some(l => new RegExp(`\\b${name}\\b`).test(l));
  const declare = (name, v) => { vars.set(name, v); scopes.at(-1).push(name); };
  const dropVar = (name) => { const v = vars.get(name); if (v && v.block && !v.moved) heap.get(v.block).freed = true; vars.delete(name); };
  const snap = (step) => snaps.push({
    line: step ? step.line : -1, note: step ? step.note : null, out: [...out], verdict,
    vars: [...vars].map(([name, v]) => ({ name, ...JSON.parse(JSON.stringify(v)) })),
    heap: [...heap].map(([id, b]) => ({ id, ...b }))
  });
  snap(null);
  scn.steps.forEach((step, k) => {
    if (verdict) return;
    const [op, a, b, c] = step.op;
    if (op === 'string' || op === 'vec') { const id = nextId++; heap.set(id, { val: op === 'string' ? `"${b}"` : `[${b.join(', ')}]`, owner: a, freed: false }); declare(a, { kind: op, block: id, moved: false }); }
    else if (op === 'int') declare(a, { kind: 'int', val: b });
    else if (op === 'decl') declare(a, { kind: 'ref', to: null });
    else if (op === 'move') { const v = vars.get(a); v.moved = true; heap.get(v.block).owner = b; declare(b, { kind: v.kind, block: v.block, moved: false }); }
    else if (op === 'clone') { const v = vars.get(a), id = nextId++; heap.set(id, { val: heap.get(v.block).val, owner: b, freed: false }); declare(b, { kind: v.kind, block: id, moved: false }); }
    else if (op === 'borrow') { if (vars.has(a)) Object.assign(vars.get(a), { to: b, mode: c }); else declare(a, { kind: 'ref', to: b, mode: c }); }
    else if (op === 'unborrow') { vars.delete(a); scopes.forEach(s => { const i = s.indexOf(a); if (i >= 0) s.splice(i, 1); }); }
    else if (op === 'push') {
      for (const [name, v] of vars) if (v.kind === 'ref' && v.to === a && usedLater(k, name)) { verdict = { code: v.mode === 'mut' ? 'E0499' : 'E0502', ...ERR[v.mode === 'mut' ? 'E0499' : 'E0502'](a, name) }; break; }
      if (!verdict) { const blk = heap.get(vars.get(a).block); blk.val = blk.val.replace(/\]$/, `, ${b}]`); }
    } else if (op === 'print') {
      const bad = a.find(n => vars.get(n)?.moved);
      if (bad) verdict = { code: 'E0382', ...ERR.E0382(bad) };
      else if (b) out.push(b);
    } else if (op === 'enter') scopes.push([]);
    else if (op === 'exit') {
      const gone = scopes.pop();
      for (const [name, v] of vars) if (v.kind === 'ref' && gone.includes(v.to) && !gone.includes(name) && usedLater(k, name)) { verdict = { code: 'E0597', ...ERR.E0597(v.to, name) }; break; }
      [...gone].reverse().forEach(dropVar);
    } else if (op === 'end') [...scopes[0]].reverse().forEach(dropVar);
    snap(step);
  });
  return { snaps, out, verdict };
}
