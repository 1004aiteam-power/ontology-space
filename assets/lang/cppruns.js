// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// C++ 시연 자료: 아래 program 을 실제로 g++ (C++20) 로 컴파일해 실행한 기록(events)과 설명(notes).
// 생성 파일이므로 직접 고치지 말고 프로그램을 바꿀 때는 기록을 다시 만든다. tests/lang.test.mjs 가 지금도 같은 기록이 나오는지 다시 실행해 확인한다.
// events[i].line = 그 출력을 낸 소스 줄 (0부터), text = 출력 내용
export const RUNS = [
 {
  "id": "raii",
  "ko": "RAII: 소멸 순서와 예외",
  "en": "RAII: destruction order and exceptions",
  "program": "#include <iostream>\n#include <stdexcept>\n#include <string>\n#define LOG(msg) std::cout << __LINE__ << \":\" << msg << \"\\n\"\n\nstruct Res {\n    std::string name;\n    explicit Res(std::string n) : name(std::move(n)) { LOG(\"acquire \" << name); }\n    ~Res() { LOG(\"release \" << name); }\n};\n\nvoid work(bool fail) {\n    Res a(\"A\");\n    Res b(\"B\");\n    if (fail) throw std::runtime_error(\"boom\");\n    LOG(\"work done\");\n}\n\nint main() {\n    try { work(true); } catch (const std::exception& e) { LOG(\"caught \" << e.what()); }\n    work(false);\n}",
  "events": [
   {
    "line": 7,
    "text": "acquire A"
   },
   {
    "line": 7,
    "text": "acquire B"
   },
   {
    "line": 8,
    "text": "release B"
   },
   {
    "line": 8,
    "text": "release A"
   },
   {
    "line": 19,
    "text": "caught boom"
   },
   {
    "line": 7,
    "text": "acquire A"
   },
   {
    "line": 7,
    "text": "acquire B"
   },
   {
    "line": 15,
    "text": "work done"
   },
   {
    "line": 8,
    "text": "release B"
   },
   {
    "line": 8,
    "text": "release A"
   }
  ],
  "notes": [
   [
    "A 를 얻습니다 (생성자).",
    "A is acquired (constructor)."
   ],
   [
    "B 를 얻습니다.",
    "B is acquired."
   ],
   [
    "예외가 던져지면 함수를 빠져나가면서 <b>이미 만들어진 지역 객체의 소멸자가 거꾸로</b>(B 먼저) 실행됩니다 — 스택 풀기(stack unwinding).",
    "When the exception is thrown, leaving the function runs <b>the destructors of the locals already built, in reverse</b> (B first): stack unwinding."
   ],
   [
    "A 도 해제됩니다. 자원 해제 코드를 따로 쓰지 않았는데도 새지 않습니다.",
    "A is released too. No cleanup code was written, yet nothing leaks."
   ],
   [
    "이제 catch 에서 예외를 받습니다. 자원은 이미 정리된 뒤입니다.",
    "Now the catch block receives the exception; the resources are already cleaned up."
   ],
   [
    "이번에는 예외 없이 A 를 얻고…",
    "This time A is acquired with no exception…"
   ],
   [
    "B 를 얻고…",
    "B is acquired…"
   ],
   [
    "끝까지 일을 마칩니다.",
    "The work completes."
   ],
   [
    "정상 종료 때도 같은 규칙: 블록을 벗어나면 만든 순서의 <b>역순</b>으로 소멸합니다 (B 먼저).",
    "Normal exit follows the same rule: leaving the block destroys in <b>reverse order</b> of construction (B first)."
   ],
   [
    "A 가 마지막.",
    "A goes last."
   ]
  ]
 },
 {
  "id": "move",
  "ko": "복사 vs 이동",
  "en": "Copy vs move",
  "program": "#include <iostream>\n#include <utility>\n#define LOG(msg) std::cout << __LINE__ << \":\" << msg << \"\\n\"\n\nstruct Buf {\n    int id;\n    explicit Buf(int i) : id(i) { LOG(\"construct \" << id); }\n    Buf(const Buf& o) : id(o.id + 100) { LOG(\"COPY \" << o.id << \" -> \" << id); }\n    Buf(Buf&& o) noexcept : id(o.id) { LOG(\"move \" << o.id); o.id = -1; }\n    ~Buf() { LOG(\"destroy \" << id); }\n};\n\nint main() {\n    Buf a(1);\n    Buf b = a;\n    Buf c = std::move(a);\n    LOG(\"a=\" << a.id << \" b=\" << b.id << \" c=\" << c.id);\n}",
  "events": [
   {
    "line": 6,
    "text": "construct 1"
   },
   {
    "line": 7,
    "text": "COPY 1 -> 101"
   },
   {
    "line": 8,
    "text": "move 1"
   },
   {
    "line": 16,
    "text": "a=-1 b=101 c=1"
   },
   {
    "line": 9,
    "text": "destroy 1"
   },
   {
    "line": 9,
    "text": "destroy 101"
   },
   {
    "line": 9,
    "text": "destroy -1"
   }
  ],
  "notes": [
   [
    "값 1 인 a 를 만듭니다.",
    "a with value 1 is constructed."
   ],
   [
    "<code>Buf b = a;</code> → <b>복사 생성자</b>. 내용을 새로 복제합니다(큰 객체면 비쌉니다).",
    "<code>Buf b = a;</code> → the <b>copy constructor</b>: a new duplicate (costly for big objects)."
   ],
   [
    "<code>Buf c = std::move(a);</code> → <b>이동 생성자</b>. 내용물을 훔쳐 오고 a 는 빈 껍데기(-1)가 됩니다. 복제가 없어 빠릅니다.",
    "<code>Buf c = std::move(a);</code> → the <b>move constructor</b>: it steals the contents and leaves a an empty shell (-1). No duplication, so it is fast."
   ],
   [
    "a 는 \"유효하지만 비어 있는 상태\"입니다. 이동 뒤에는 대입이나 소멸 외에는 쓰지 않는 것이 규칙입니다.",
    "a is in a \"valid but unspecified\" state; after a move, only assign to it or let it be destroyed."
   ],
   [
    "main 이 끝나면 c, b, a 순으로(만든 순서의 역순) 소멸합니다.",
    "At the end of main they are destroyed c, b, a (reverse of construction)."
   ],
   [
    "",
    ""
   ],
   [
    "",
    ""
   ]
  ]
 },
 {
  "id": "uptr",
  "ko": "unique_ptr 소유권 이전",
  "en": "unique_ptr ownership transfer",
  "program": "#include <iostream>\n#include <memory>\n#define LOG(msg) std::cout << __LINE__ << \":\" << msg << \"\\n\"\n\nstruct Node {\n    int v;\n    explicit Node(int x) : v(x) { LOG(\"new Node \" << v); }\n    ~Node() { LOG(\"delete Node \" << v); }\n};\n\nstd::unique_ptr<Node> make(int v) { return std::make_unique<Node>(v); }\nvoid take(std::unique_ptr<Node> p) { LOG(\"take \" << p->v); }\n\nint main() {\n    auto p = make(1);\n    auto q = make(2);\n    take(std::move(p));\n    LOG(\"p is \" << (p ? \"owner\" : \"empty\"));\n    q.reset();\n    LOG(\"end of main\");\n}",
  "events": [
   {
    "line": 6,
    "text": "new Node 1"
   },
   {
    "line": 6,
    "text": "new Node 2"
   },
   {
    "line": 11,
    "text": "take 1"
   },
   {
    "line": 7,
    "text": "delete Node 1"
   },
   {
    "line": 17,
    "text": "p is empty"
   },
   {
    "line": 7,
    "text": "delete Node 2"
   },
   {
    "line": 19,
    "text": "end of main"
   }
  ],
  "notes": [
   [
    "Node 1 이 만들어지고 p 가 단독 소유합니다.",
    "Node 1 is created and solely owned by p."
   ],
   [
    "Node 2 도 q 가 소유합니다.",
    "Node 2 is owned by q."
   ],
   [
    "<code>take(std::move(p))</code>: 소유권이 함수의 매개변수로 <b>이동</b>했습니다.",
    "<code>take(std::move(p))</code>: ownership <b>moved</b> into the function's parameter."
   ],
   [
    "함수가 끝나면 매개변수 p 가 사라지며 Node 1 도 삭제됩니다 — 주인이 사라졌으니까요.",
    "When the function ends the parameter p goes away and Node 1 is deleted with it — its owner is gone."
   ],
   [
    "원래의 p 는 이제 비었습니다 (소유권이 없음).",
    "The original p is now empty (it owns nothing)."
   ],
   [
    "<code>q.reset()</code>: 소유자가 명시적으로 놓으면 Node 2 가 삭제됩니다.",
    "<code>q.reset()</code>: when the owner lets go explicitly, Node 2 is deleted."
   ],
   [
    "",
    ""
   ]
  ]
 }
];
