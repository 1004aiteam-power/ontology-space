// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// Python 참조 시연의 모형: 변수(이름표)와 리스트 객체, 같은 객체를 가리키는지를 한 줄씩 따라간다.
// 각 시나리오의 program 은 실제 Python 으로 실행해 model 이 내는 출력과 같은지 tests/lang.test.mjs 가 확인한다.

// 단계: { line(원본 줄 번호, 0부터), op: [...], note: [한국어, English] }
// op: list 이름 [값…] · alias 새 원본 · copy 새 원본 · deepcopy 새 원본 · append 이름 값 · appendin 이름 칸 값 · setin 이름 칸 안칸 값
//     iadd 이름 [값…] · concat 이름 원본 [값…] · mulrow 이름 [행] n · comprow 이름 [행] n · print 이름 · printis 이름 이름
export const SCENARIOS = [
  { id: 'alias', ko: '별명(alias): b = a', en: 'Alias: b = a',
    program: 'a = [1, 2]\nb = a\nb.append(3)\nprint(a)\nprint(a is b)\nc = list(a)\nprint(c is a)',
    steps: [
      { line: 0, op: ['list', 'a', [1, 2]], note: ['리스트 객체 #1 이 만들어지고 이름 a 가 붙습니다.', 'List object #1 is created and the name a is attached.'] },
      { line: 1, op: ['alias', 'b', 'a'], note: ['b = a 는 복사가 아닙니다. 같은 객체 #1 에 이름이 하나 더 붙었을 뿐입니다.', 'b = a is not a copy: one more name on the same object #1.'] },
      { line: 2, op: ['append', 'b', 3], note: ['b 를 통해 객체를 고쳤습니다. 객체가 하나뿐이라 a 로 봐도 [1, 2, 3] 입니다.', 'The object was changed through b. With only one object, a sees [1, 2, 3] too.'] },
      { line: 3, op: ['print', 'a'], note: ['a 도 바뀌어 있습니다.', 'a changed as well.'] },
      { line: 4, op: ['printis', 'a', 'b'], note: ['a is b: 같은 객체인가? → True.', 'a is b: same object? → True.'] },
      { line: 5, op: ['copy', 'c', 'a'], note: ['list(a) 는 내용을 복사한 새 객체 #2 를 만듭니다.', 'list(a) makes a new object #2 holding a copy of the contents.'] },
      { line: 6, op: ['printis', 'c', 'a'], note: ['c 는 a 와 같은 값이지만 다른 객체입니다 → False.', 'c equals a in value but is a different object → False.'] }] },
  { id: 'iadd', ko: '+= 는 제자리, + 는 새 객체', en: '+= in place, + makes a new object',
    program: 'xs = [1, 2]\nys = xs\nxs += [3]\nprint(ys)\nxs = xs + [4]\nprint(ys)\nprint(xs)',
    steps: [
      { line: 0, op: ['list', 'xs', [1, 2]], note: ['xs 가 객체 #1 을 가리킵니다.', 'xs points at object #1.'] },
      { line: 1, op: ['alias', 'ys', 'xs'], note: ['ys 도 같은 객체 #1.', 'ys is the same object #1.'] },
      { line: 2, op: ['iadd', 'xs', [3]], note: ['리스트의 += 는 객체를 제자리에서 늘립니다. ys 에서도 보입니다.', 'List += extends the object in place; ys sees it too.'] },
      { line: 3, op: ['print', 'ys'], note: ['ys 가 [1, 2, 3] 으로 바뀌어 있습니다.', 'ys now shows [1, 2, 3].'] },
      { line: 4, op: ['concat', 'xs', 'xs', [4]], note: ['xs + [4] 는 새 객체 #2 를 만들고 이름 xs 만 거기로 옮깁니다. ys 는 그대로 #1.', 'xs + [4] builds a new object #2 and only the name xs moves there; ys stays on #1.'] },
      { line: 5, op: ['print', 'ys'], note: ['ys 는 바뀌지 않았습니다.', 'ys did not change.'] },
      { line: 6, op: ['print', 'xs'], note: ['xs 는 새 객체 #2 입니다.', 'xs is the new object #2.'] }] },
  { id: 'shallow', ko: '얕은 복사 vs 깊은 복사', en: 'Shallow vs deep copy',
    program: 'import copy\na = [[1], [2]]\nb = a.copy()\nb[0].append(9)\nprint(a)\nc = copy.deepcopy(a)\nc[1].append(8)\nprint(a)\nprint(c)',
    steps: [
      { line: 1, op: ['list', 'a', [[1], [2]]], note: ['바깥 리스트 #1 과 안쪽 리스트 #2, #3 — 객체가 셋입니다.', 'An outer list #1 and inner lists #2 and #3: three objects.'] },
      { line: 2, op: ['copy', 'b', 'a'], note: ['a.copy() 는 바깥 리스트만 새로 만들고(#4) 안쪽 #2, #3 은 그대로 공유합니다 (얕은 복사).', 'a.copy() makes only a new outer list (#4) and shares inner #2 and #3 (a shallow copy).'] },
      { line: 3, op: ['appendin', 'b', 0, 9], note: ['b[0] 은 #2 입니다. 거기에 9 를 넣으면 a[0] 도 같은 #2 라서 같이 바뀝니다.', 'b[0] is #2. Appending 9 there changes a[0] too since it is the same #2.'] },
      { line: 4, op: ['print', 'a'], note: ['a 도 [[1, 9], [2]] 가 되었습니다.', 'a became [[1, 9], [2]] as well.'] },
      { line: 5, op: ['deepcopy', 'c', 'a'], note: ['deepcopy 는 안쪽까지 모두 새 객체로 복사합니다 (#5, #6, #7).', 'deepcopy copies all the way down into new objects (#5, #6, #7).'] },
      { line: 6, op: ['appendin', 'c', 1, 8], note: ['c 의 안쪽을 고쳐도 a 와 공유하는 것이 없습니다.', 'Changing c\'s inner list shares nothing with a.'] },
      { line: 7, op: ['print', 'a'], note: ['a 는 그대로.', 'a is unchanged.'] },
      { line: 8, op: ['print', 'c'], note: ['c 만 바뀌었습니다.', 'Only c changed.'] }] },
  { id: 'rows', ko: '[[0]*3]*3 의 함정', en: 'The [[0]*3]*3 trap',
    program: 'm = [[0] * 3] * 3\nm[0][0] = 1\nprint(m)\nn = [[0] * 3 for _ in range(3)]\nn[0][0] = 1\nprint(n)',
    steps: [
      { line: 0, op: ['mulrow', 'm', [0, 0, 0], 3], note: ['안쪽 리스트 #1 하나를 만들고, 바깥 리스트 #2 가 그것을 세 번 가리킵니다. 행이 세 개처럼 보여도 객체는 하나입니다.', 'One inner list #1 is built and the outer list #2 points at it three times. It looks like three rows but is one object.'] },
      { line: 1, op: ['setin', 'm', 0, 0, 1], note: ['m[0][0] = 1 은 #1 을 고칩니다. 세 행이 모두 #1 이라 전부 바뀝니다.', 'm[0][0] = 1 modifies #1; all three rows are #1 so all change.'] },
      { line: 2, op: ['print', 'm'], note: ['세 행이 모두 [1, 0, 0].', 'All three rows are [1, 0, 0].'] },
      { line: 3, op: ['comprow', 'n', [0, 0, 0], 3], note: ['컴프리헨션은 행마다 새 리스트(#3, #4, #5)를 만듭니다.', 'The comprehension builds a new list per row (#3, #4, #5).'] },
      { line: 4, op: ['setin', 'n', 0, 0, 1], note: ['첫 행만 고칩니다.', 'Only the first row changes.'] },
      { line: 5, op: ['print', 'n'], note: ['의도한 결과입니다.', 'The intended result.'] }] },
  { id: 'default', ko: '가변 기본 인자', en: 'Mutable default argument',
    program: 'def add_item(x, items=[]):\n    items.append(x)\n    return items\nprint(add_item(1))\nprint(add_item(2))',
    steps: [
      { line: 0, op: ['list', 'items 기본값', []], note: ['def 를 실행하는 순간 기본값 [] 가 한 번 만들어져(#1) 함수에 붙어 있습니다.', 'The moment def runs, the default [] is built once (#1) and kept on the function.'] },
      { line: 3, op: ['note'], note: ['add_item(1) 호출 — items 를 안 주었으니 기본값 #1 을 씁니다.', 'add_item(1) is called; items was not given so the default #1 is used.'] },
      { line: 1, op: ['append', 'items 기본값', 1], note: ['#1 에 1 을 넣습니다.', '1 goes into #1.'] },
      { line: 3, op: ['print', 'items 기본값'], note: ['[1] 이 출력됩니다.', 'Prints [1].'] },
      { line: 4, op: ['note'], note: ['add_item(2) 호출 — 또 같은 #1 을 씁니다. 이전 호출의 값이 남아 있습니다.', 'add_item(2) is called; the same #1 again, still holding the earlier call\'s value.'] },
      { line: 1, op: ['append', 'items 기본값', 2], note: ['#1 에 2 를 넣으면 [1, 2].', 'Putting 2 into #1 gives [1, 2].'] },
      { line: 4, op: ['print', 'items 기본값'], note: ['[2] 를 기대했지만 [1, 2] 입니다.', 'You expected [2] but got [1, 2].'] }] }
];

export function simulate(scn) {
  const vars = new Map(), objs = new Map();
  let next = 1;
  const out = [], snaps = [];
  const newObj = (items) => { const id = next++; objs.set(id, { items }); return id; };
  const lit = (x) => (Array.isArray(x) ? { ref: newObj(x.map(lit)) } : { v: x });
  const repr = (id) => '[' + objs.get(id).items.map(it => (it.ref ? repr(it.ref) : String(it.v))).join(', ') + ']';
  const clone = (id, deep) => newObj(objs.get(id).items.map(it => (it.ref ? { ref: deep ? clone(it.ref, true) : it.ref } : { ...it })));
  const snap = (step) => snaps.push({ line: step ? step.line : -1, note: step ? step.note : null, vars: Object.fromEntries(vars), objs: JSON.parse(JSON.stringify(Object.fromEntries(objs))), out: [...out] });
  snap(null);
  for (const step of scn.steps) {
    const [op, a, b, c, d] = step.op;
    if (op === 'list') vars.set(a, lit(b).ref);
    else if (op === 'alias') vars.set(a, vars.get(b));
    else if (op === 'copy') vars.set(a, clone(vars.get(b), false));
    else if (op === 'deepcopy') vars.set(a, clone(vars.get(b), true));
    else if (op === 'append') objs.get(vars.get(a)).items.push({ v: b });
    else if (op === 'appendin') objs.get(objs.get(vars.get(a)).items[b].ref).items.push({ v: c });
    else if (op === 'setin') objs.get(objs.get(vars.get(a)).items[b].ref).items[c] = { v: d };
    else if (op === 'iadd') objs.get(vars.get(a)).items.push(...b.map(v => ({ v })));
    else if (op === 'concat') vars.set(a, newObj([...objs.get(vars.get(b)).items, ...c.map(v => ({ v }))]));
    else if (op === 'mulrow') { const inner = newObj(b.map(v => ({ v }))); vars.set(a, newObj(Array.from({ length: c }, () => ({ ref: inner })))); }
    else if (op === 'comprow') vars.set(a, newObj(Array.from({ length: c }, () => ({ ref: newObj(b.map(v => ({ v }))) }))));
    else if (op === 'print') out.push(repr(vars.get(a)));
    else if (op === 'printis') out.push(vars.get(a) === vars.get(b) ? 'True' : 'False');
    snap(step);
  }
  return { snaps, out, repr: (s, id) => reprIn(s, id) };
}
export function reprIn(snap, id) { const o = snap.objs[id]; return '[' + o.items.map(it => (it.ref ? reprIn(snap, it.ref) : String(it.v))).join(', ') + ']'; }
