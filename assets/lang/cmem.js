// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// C 메모리 시연의 모형: 스택 변수와 힙 블록, 포인터가 어디를 가리키는지를 한 줄씩 따라가며 누수 · 해제 후 사용 · 이중 해제 · 범위 밖 쓰기를 알려 준다.
// 각 시나리오의 program 은 진짜 gcc + AddressSanitizer 로 돌려, 모형의 판정(asan)과 같은 종류의 오류를 보고하는지 tests/lang.test.mjs 가 확인한다.

// op: malloc 변수 크기 · store 변수 값 · print 변수 · free 변수 · null 변수 · arr 이름 [값…] · aset 이름 칸 값 · end
export const SCENARIOS = [
  { id: 'ok', ko: '올바른 사용', en: 'Correct use', asan: null, stdout: '42',
    program: '#include <stdio.h>\n#include <stdlib.h>\nint main(void) {\n    int *p = malloc(sizeof *p);\n    *p = 42;\n    printf("%d\\n", *p);\n    free(p);\n    p = NULL;\n    return 0;\n}',
    steps: [
      { line: 3, op: ['malloc', 'p', 4], note: ['힙에 4바이트 블록 #1 을 얻고, 그 주소를 지역 변수 p 에 담습니다. p 자신은 스택에 있습니다.', 'A 4-byte block #1 is obtained on the heap and its address stored in the local p. p itself lives on the stack.'] },
      { line: 4, op: ['store', 'p', 42], note: ['*p = 42 는 p 가 가리키는 힙 블록에 씁니다.', '*p = 42 writes into the heap block p points at.'] },
      { line: 5, op: ['print', 'p'], note: ['*p 를 읽어 출력합니다.', 'Reads *p and prints it.'] },
      { line: 6, op: ['free', 'p'], note: ['블록을 돌려줍니다. 하지만 p 에는 옛 주소가 그대로 남습니다 (이제 "매달린 포인터").', 'The block is given back, but p still holds the old address (now a "dangling pointer").'] },
      { line: 7, op: ['null', 'p'], note: ['p 를 NULL 로 바꿔 실수로 다시 쓰는 일을 막습니다.', 'Setting p to NULL guards against using it by mistake.'] },
      { line: 8, op: ['end'], note: ['끝날 때 해제하지 않은 블록이 없습니다. 누수 없음.', 'No unfreed block at exit. No leak.'] }] },
  { id: 'leak', ko: '메모리 누수', en: 'Memory leak', asan: 'LeakSanitizer', stdout: '',
    program: '#include <stdlib.h>\nint main(void) {\n    int *p = malloc(sizeof *p);\n    *p = 1;\n    p = malloc(sizeof *p);\n    *p = 2;\n    free(p);\n    return 0;\n}',
    steps: [
      { line: 2, op: ['malloc', 'p', 4], note: ['블록 #1 을 얻어 p 가 가리킵니다.', 'Block #1 is obtained and p points at it.'] },
      { line: 3, op: ['store', 'p', 1], note: ['#1 에 1 을 씁니다.', 'Writes 1 into #1.'] },
      { line: 4, op: ['malloc', 'p', 4], note: ['p 에 새 블록 #2 의 주소를 덮어씁니다. #1 의 주소를 아는 포인터가 이제 없습니다 — 해제할 방법을 잃었습니다.', 'p is overwritten with the new block #2. No pointer knows #1\'s address any more: the way to free it is lost.'] },
      { line: 5, op: ['store', 'p', 2], note: ['#2 에 씁니다.', 'Writes into #2.'] },
      { line: 6, op: ['free', 'p'], note: ['#2 만 해제됩니다.', 'Only #2 is freed.'] },
      { line: 7, op: ['end'], note: ['프로그램 종료 시 #1 이 해제되지 않고 남았습니다 → 누수.', 'At exit #1 is still unfreed → a leak.'] }] },
  { id: 'uaf', ko: '해제 후 사용', en: 'Use after free', asan: 'heap-use-after-free', stdout: null,
    program: '#include <stdio.h>\n#include <stdlib.h>\nint main(void) {\n    int *p = malloc(sizeof *p);\n    *p = 7;\n    free(p);\n    printf("%d\\n", *p);\n    return 0;\n}',
    steps: [
      { line: 3, op: ['malloc', 'p', 4], note: ['블록 #1 을 얻습니다.', 'Block #1 is obtained.'] },
      { line: 4, op: ['store', 'p', 7], note: ['#1 에 7 을 씁니다.', 'Writes 7 into #1.'] },
      { line: 5, op: ['free', 'p'], note: ['#1 을 돌려주었습니다. p 는 여전히 #1 의 주소를 가지고 있습니다.', '#1 is given back. p still holds #1\'s address.'] },
      { line: 6, op: ['print', 'p'], note: ['해제된 #1 을 읽습니다. C 는 막지 않고 "정의되지 않은 동작"이 됩니다 — 때로는 7 이 그대로 나와서 버그가 숨어 있다가 나중에 터집니다.', 'It reads the freed #1. C does not stop you: it is "undefined behaviour"; sometimes 7 still comes out so the bug hides and explodes later.'] }] },
  { id: 'dfree', ko: '이중 해제', en: 'Double free', asan: 'attempting double-free', stdout: null,
    program: '#include <stdlib.h>\nint main(void) {\n    char *s = malloc(16);\n    free(s);\n    free(s);\n    return 0;\n}',
    steps: [
      { line: 2, op: ['malloc', 's', 16], note: ['16바이트 블록 #1 을 얻습니다.', 'A 16-byte block #1 is obtained.'] },
      { line: 3, op: ['free', 's'], note: ['첫 번째 free — 정상입니다.', 'The first free is fine.'] },
      { line: 4, op: ['free', 's'], note: ['같은 블록을 또 해제합니다. 할당기의 내부 목록이 망가져 나중에 엉뚱한 곳에서 충돌합니다.', 'Freeing the same block again corrupts the allocator\'s bookkeeping and crashes somewhere unrelated later.'] }] },
  { id: 'oob', ko: '배열 범위 밖 쓰기', en: 'Out-of-bounds write', asan: 'stack-buffer-overflow', stdout: null,
    program: '#include <stdio.h>\nint main(void) {\n    int a[4] = {1, 2, 3, 4};\n    int i = 4;\n    a[i] = 99;\n    printf("%d\\n", a[0]);\n    return 0;\n}',
    steps: [
      { line: 2, op: ['arr', 'a', [1, 2, 3, 4]], note: ['스택에 int 4개짜리 배열. 유효한 인덱스는 0~3 입니다.', 'A 4-int array on the stack. Valid indexes are 0 to 3.'] },
      { line: 3, op: ['int', 'i', 4], note: ['i = 4.', 'i = 4.'] },
      { line: 4, op: ['aset', 'a', 4, 99], note: ['a[4] 는 배열 바로 뒤의 메모리입니다. C 는 범위를 검사하지 않아 이웃 변수나 반환 주소를 덮어쓸 수 있습니다 (보안 취약점의 대표 원인).', 'a[4] is the memory just past the array. C does not check bounds, so it can overwrite neighbouring variables or the return address (a classic security hole).'] }] }
];

export function simulate(scn) {
  const vars = new Map(), heap = new Map(), out = [], snaps = [];
  let nextId = 1, verdict = null;
  const reach = () => { const r = new Set(); for (const v of vars.values()) if (v.kind === 'ptr' && v.ptr) r.add(v.ptr); return r; };
  const snap = (step) => snaps.push({
    line: step ? step.line : -1, note: step ? step.note : null, out: [...out], verdict,
    vars: [...vars].map(([name, v]) => ({ name, ...JSON.parse(JSON.stringify(v)) })),
    heap: [...heap].map(([id, b]) => ({ id, ...b }))
  });
  snap(null);
  for (const step of scn.steps) {
    const [op, a, b, c] = step.op;
    if (verdict) break;
    if (op === 'malloc') {
      const id = nextId++;
      heap.set(id, { size: b, freed: false, val: null, lost: false });
      if (!vars.has(a)) vars.set(a, { kind: 'ptr', ptr: null });
      vars.get(a).ptr = id;
      for (const [bid, blk] of heap) if (!blk.freed && !reach().has(bid)) blk.lost = true;
    } else if (op === 'int') vars.set(a, { kind: 'int', val: b });
    else if (op === 'arr') vars.set(a, { kind: 'arr', items: [...b] });
    else if (op === 'store' || op === 'print') {
      const p = vars.get(a), blk = heap.get(p.ptr);
      if (!blk) verdict = { kind: 'null', ko: 'NULL 을 거치는 접근 → 프로그램이 멈춥니다(세그멘테이션 오류).', en: 'Access through NULL → the program crashes (segmentation fault).' };
      else if (blk.freed) verdict = { kind: 'uaf', ko: `해제된 블록 #${p.ptr} 을 사용했습니다 → 정의되지 않은 동작 (해제 후 사용).`, en: `Used the freed block #${p.ptr} → undefined behaviour (use after free).` };
      else if (op === 'store') blk.val = b; else out.push(String(blk.val));
    } else if (op === 'free') {
      const p = vars.get(a);
      if (p.ptr === null) { /* free(NULL) 은 아무 일도 안 함 */ }
      else if (heap.get(p.ptr).freed) verdict = { kind: 'dfree', ko: `블록 #${p.ptr} 을 두 번 해제했습니다 → 정의되지 않은 동작 (이중 해제).`, en: `Freed block #${p.ptr} twice → undefined behaviour (double free).` };
      else heap.get(p.ptr).freed = true;
    } else if (op === 'null') vars.get(a).ptr = null;
    else if (op === 'aset') {
      const arr = vars.get(a);
      if (b < 0 || b >= arr.items.length) verdict = { kind: 'oob', ko: `a[${b}] 는 범위 밖(유효 0~${arr.items.length - 1}) → 정의되지 않은 동작 (버퍼 오버플로).`, en: `a[${b}] is out of range (valid 0 to ${arr.items.length - 1}) → undefined behaviour (buffer overflow).` };
      else arr.items[b] = c;
    } else if (op === 'end') {
      const leaked = [...heap].filter(([id, blk]) => !blk.freed);
      if (leaked.length) verdict = { kind: 'leak', ko: `해제하지 않은 블록 ${leaked.map(([id, b]) => `#${id}(${b.size}바이트)`).join(', ')} → 메모리 누수.`, en: `Unfreed block(s) ${leaked.map(([id, b]) => `#${id} (${b.size} bytes)`).join(', ')} → memory leak.` };
    }
    snap(step);
  }
  return { snaps, out, verdict };
}
