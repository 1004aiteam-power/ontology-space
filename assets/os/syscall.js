// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 시스템 호출 · 인터럽트 · 예외가 사용자 공간 → 커널 → 하드웨어를 오가는 과정을 단계로 적은 시나리오 (리눅스 x86-64 기준으로 단순화).
// 각 단계: { at: 상자 id, mode: 'user' | 'kernel', gate?: 'syscall' | 'sysret' | 'irq' | 'iret' | 'fault', ko, en, regs?, ps? (프로세스 상태) }
// 테스트: tests/os.test.mjs (사용자 모드 ↔ 커널 모드는 gate 가 있는 단계에서만 바뀐다, 시스템 호출 번호)

export const BOXES = {
  app: { ko: '응용 프로그램', en: 'Application', space: 'user' }, lib: { ko: 'C 라이브러리 (libc)', en: 'C library (libc)', space: 'user' },
  entry: { ko: '진입점 · 시스템 호출 표', en: 'Entry · syscall table', space: 'kernel' }, fs: { ko: 'VFS · 파일시스템 · 페이지 캐시', en: 'VFS · file system · page cache', space: 'kernel' },
  sched: { ko: '스케줄러', en: 'Scheduler', space: 'kernel' }, drv: { ko: '장치 드라이버', en: 'Device drivers', space: 'kernel' }, sig: { ko: '시그널 · 프로세스 관리', en: 'Signals · process mgmt', space: 'kernel' },
  cpu: { ko: 'CPU', en: 'CPU', space: 'hw' }, timer: { ko: '타이머', en: 'Timer', space: 'hw' }, kbd: { ko: '키보드', en: 'Keyboard', space: 'hw' }, disk: { ko: 'SSD', en: 'SSD', space: 'hw' }
};
export const NR = { read: 0, write: 1, getpid: 39 };          // 리눅스 x86-64 시스템 호출 번호 (arch/x86/entry/syscalls/syscall_64.tbl)

const s = (at, mode, ko, en, x = {}) => ({ at, mode, ko, en, ...x });
export const SCENARIOS = [
  { id: 'write', ko: '파일에 쓰기: write()', en: 'Write to a file: write()', code: 'n = write(fd, "hi\\n", 3);', steps: [
    s('app', 'user', '프로그램이 <code>write(fd, "hi\\n", 3)</code>을 부릅니다. 평범한 함수 호출처럼 보이지만 실제 일은 커널이 해야 합니다.', 'The program calls <code>write(fd, "hi\\n", 3)</code>. It looks like an ordinary function call, but the kernel must do the real work.', { ps: 'run' }),
    s('lib', 'user', 'libc가 레지스터에 요청을 담습니다: <b>rax = 1</b>(write의 번호), rdi = 파일 번호, rsi = 버퍼 주소, rdx = 길이. 그리고 <code>syscall</code> 명령을 실행합니다.', 'libc loads the request into registers: <b>rax = 1</b> (the number of write), rdi = file descriptor, rsi = buffer address, rdx = length. Then it executes the <code>syscall</code> instruction.', { regs: { rax: 1, rdi: 3, rsi: '0x7ffd…a0', rdx: 3 } }),
    s('entry', 'kernel', 'CPU가 <b>사용자 모드(ring 3)에서 커널 모드(ring 0)로</b>바뀌며 커널이 미리 정해 둔 진입점으로 뜁니다. 사용자 레지스터를 커널 스택에 저장하고, rax = 1을 보고 시스템 호출 표에서 <code>sys_write</code>를 찾습니다.', 'The CPU switches <b>from user mode (ring 3) to kernel mode (ring 0)</b> and jumps to an entry point the kernel set up in advance. It saves the user registers on the kernel stack and uses rax = 1 to find <code>sys_write</code> in the syscall table.', { gate: 'syscall' }),
    s('fs', 'kernel', '이 프로세스의 파일 표에서 3번이 가리키는 열린 파일을 찾고, 쓰기 권한을 확인합니다. 버퍼 주소가 정말 이 프로세스의 메모리인지 확인한 뒤 <b>사용자 메모리에서 3바이트를 복사</b>해 페이지 캐시에 넣고 "dirty"로 표시합니다.', 'It looks up descriptor 3 in this process\'s file table and checks write permission. After verifying the buffer address really belongs to the process, it <b>copies 3 bytes from user memory</b> into the page cache and marks the page dirty.'),
    s('entry', 'kernel', '돌려줄 값(쓴 바이트 수 3)을 rax에 넣고 저장해 둔 레지스터를 되살립니다.', 'It puts the return value (3 bytes written) into rax and restores the saved registers.', { regs: { rax: 3 } }),
    s('app', 'user', '<code>sysret</code>으로 사용자 모드로 돌아와 <code>write</code> 다음 줄부터 계속합니다. 아직 디스크에는 쓰지 않았습니다.', '<code>sysret</code> returns to user mode, continuing right after <code>write</code>. Nothing has reached the disk yet.', { gate: 'sysret' }),
    s('fs', 'kernel', '(몇 초 뒤) 커널의 쓰기 스레드가 dirty 페이지를 모아 블록 계층으로 내려보냅니다. 이 프로그램과는 따로 움직입니다.', '(A few seconds later) a kernel writeback thread gathers dirty pages and sends them down to the block layer, independently of the program.', { gate: 'irq', bg: true }),
    s('drv', 'kernel', 'NVMe 드라이버가 SSD에 "이 메모리를 이 위치에 써라"라는 명령을 넣습니다(DMA: CPU가 바이트를 하나씩 옮기지 않음).', 'The NVMe driver queues a command telling the SSD "write this memory to this location" (DMA: the CPU does not copy bytes one by one).', { bg: true }),
    s('disk', 'kernel', 'SSD가 쓰기를 끝내고 <b>인터럽트</b>로 알립니다. 드라이버가 완료를 처리하고 페이지의 dirty 표시를 지웁니다.', 'The SSD finishes and signals an <b>interrupt</b>. The driver handles the completion and clears the page\'s dirty mark.', { bg: true }),
    s('app', 'user', '하던 일로 돌아갑니다. 끝까지 디스크에 닿았는지 확인하려면 <code>fsync()</code>를 따로 불러야 합니다(<a href="os-file.html">파일시스템</a>).', 'Back to whatever was running. To be sure the data reached the disk, a separate <code>fsync()</code> is needed (<a href="os-file.html">file systems</a>).', { gate: 'iret', bg: true })
  ] },
  { id: 'read', ko: '키보드 입력 기다리기: read()', en: 'Wait for keyboard input: read()', code: 'n = read(0, buf, 100);', steps: [
    s('app', 'user', '프로그램이 터미널(0번 파일)에서 최대 100바이트를 읽으려 합니다.', 'The program asks to read up to 100 bytes from the terminal (descriptor 0).', { ps: 'run' }),
    s('lib', 'user', 'rax = <b>0</b>(read), rdi = 0, rsi = 버퍼, rdx = 100을 담고 <code>syscall</code>.', 'Load rax = <b>0</b> (read), rdi = 0, rsi = buffer, rdx = 100 and execute <code>syscall</code>.', { regs: { rax: 0, rdi: 0, rsi: '0x7ffd…40', rdx: 100 } }),
    s('entry', 'kernel', '커널 모드로 들어와 <code>sys_read</code>로 갑니다.', 'Enter kernel mode and dispatch to <code>sys_read</code>.', { gate: 'syscall' }),
    s('drv', 'kernel', '터미널 드라이버의 입력 버퍼가 비어 있습니다. 읽을 것이 없으니 이 프로세스를 <b>대기(잠듦)</b> 상태로 바꾸고 대기 줄에 올립니다.', 'The terminal driver\'s input buffer is empty. With nothing to read, the process is put into the <b>waiting (sleeping)</b> state on a wait queue.', { ps: 'wait' }),
    s('sched', 'kernel', '스케줄러가 다른 준비된 프로세스를 골라 CPU를 넘깁니다. 기다리는 동안 CPU를 쓰지 않습니다(<a href="os-process.html">스케줄링</a>).', 'The scheduler picks another ready process and hands it the CPU. Waiting costs no CPU time (<a href="os-process.html">scheduling</a>).'),
    s('kbd', 'kernel', '사용자가 키를 누르면 키보드 컨트롤러가 <b>하드웨어 인터럽트</b>를 겁니다. 어떤 프로세스가 돌고 있었든 CPU는 커널의 인터럽트 처리기로 뜁니다.', 'A key press makes the keyboard controller raise a <b>hardware interrupt</b>. Whatever was running, the CPU jumps to the kernel\'s interrupt handler.', { gate: 'irq' }),
    s('drv', 'kernel', '드라이버가 글자를 터미널 입력 버퍼에 넣고, Enter가 오면 잠든 프로세스를 깨워 <b>준비</b> 상태로 돌립니다.', 'The driver puts the character in the terminal input buffer; on Enter it wakes the sleeping process, making it <b>ready</b>.', { ps: 'ready' }),
    s('sched', 'kernel', '스케줄러가 차례가 된 이 프로세스를 다시 고릅니다.', 'The scheduler picks this process again when its turn comes.', { ps: 'run' }),
    s('fs', 'kernel', '입력 버퍼의 글자를 <b>사용자 메모리로 복사</b>하고 rax에 읽은 바이트 수를 넣습니다.', 'The characters are <b>copied into user memory</b> and the number of bytes read goes into rax.', { regs: { rax: 6 } }),
    s('app', 'user', '사용자 모드로 돌아와 <code>read</code>가 6("hello\\n")을 돌려줍니다. 프로그램 입장에서는 함수 하나가 오래 걸렸을 뿐입니다.', 'Back in user mode, <code>read</code> returns 6 ("hello\\n"). From the program\'s view, one function call just took a while.', { gate: 'sysret' })
  ] },
  { id: 'getpid', ko: '가장 짧은 호출: getpid()', en: 'The shortest call: getpid()', code: 'pid = getpid();', steps: [
    s('app', 'user', '자기 프로세스 번호를 묻습니다.', 'The program asks for its own process ID.', { ps: 'run' }),
    s('lib', 'user', 'rax = <b>39</b>(getpid)만 담고 <code>syscall</code>. 인자가 없습니다.', 'Only rax = <b>39</b> (getpid), then <code>syscall</code>. No arguments.', { regs: { rax: 39 } }),
    s('entry', 'kernel', '커널 모드로 들어와 현재 프로세스 구조체에서 번호를 꺼내 rax에 넣습니다.', 'Enter kernel mode, read the ID from the current task structure, put it in rax.', { gate: 'syscall', regs: { rax: 4242 } }),
    s('app', 'user', '돌아옵니다. 일 자체는 거의 없지만 모드를 오가는 비용(수십~수백 ns)이 듭니다. 그래서 자주 부르는 <code>clock_gettime</code> 같은 호출은 커널이 사용자 공간에 넣어 둔 코드(vDSO)로 모드 전환 없이 처리합니다.', 'Return. There is almost no work, but switching modes still costs tens to hundreds of ns. That is why frequent calls such as <code>clock_gettime</code> are served without a mode switch by code the kernel maps into user space (the vDSO).', { gate: 'sysret' })
  ] },
  { id: 'efault', ko: '잘못된 주소를 넘기면', en: 'Passing a bad address', code: 'n = write(1, (char *)0x10, 5);', steps: [
    s('app', 'user', '버그 때문에 엉뚱한 주소(0x10)를 버퍼로 넘깁니다.', 'A bug passes a nonsense address (0x10) as the buffer.', { ps: 'run' }),
    s('lib', 'user', 'rax = 1, rsi = 0x10으로 <code>syscall</code>.', '<code>syscall</code> with rax = 1, rsi = 0x10.', { regs: { rax: 1, rdi: 1, rsi: '0x10', rdx: 5 } }),
    s('entry', 'kernel', '커널 모드로 들어옵니다.', 'Enter kernel mode.', { gate: 'syscall' }),
    s('fs', 'kernel', '사용자 메모리를 복사하려다 0x10이 이 프로세스에 <a href="os-memory.html">할당되지 않은 주소</a>임을 알게 됩니다. 커널은 죽지 않고 오류 번호 <b>EFAULT(14)</b>를 돌려주기로 합니다.', 'While copying from user memory it finds 0x10 is <a href="os-memory.html">not mapped</a> in this process. The kernel does not crash; it decides to return error <b>EFAULT (14)</b>.', { regs: { rax: -14 } }),
    s('lib', 'user', '사용자 모드로 돌아오면 libc가 음수 값을 보고 <code>errno = EFAULT</code>로 정하고 −1을 돌려줍니다. 커널은 사용자가 넘긴 값을 절대 그대로 믿지 않습니다.', 'Back in user mode, libc sees the negative value, sets <code>errno = EFAULT</code> and returns −1. The kernel never trusts values passed from user space.', { gate: 'sysret' }),
    s('app', 'user', '<code>write</code>가 −1을 돌려줍니다. 프로그램이 오류를 확인하지 않으면 모른 채 지나갑니다.', '<code>write</code> returns −1. If the program does not check, it never notices.')
  ] },
  { id: 'priv', ko: '특권 명령을 실행하면', en: 'Executing a privileged instruction', code: 'asm("hlt");  /* CPU 멈추기 */', steps: [
    s('app', 'user', '사용자 프로그램이 CPU를 멈추는 <code>hlt</code> 명령을 직접 실행하려 합니다.', 'A user program tries to execute <code>hlt</code>, which halts the CPU.', { ps: 'run' }),
    s('cpu', 'kernel', 'CPU는 지금이 ring 3임을 보고 명령을 실행하지 않고 <b>일반 보호 예외</b>를 일으켜 커널로 넘어갑니다. 하드웨어가 지키는 경계입니다.', 'The CPU sees it is in ring 3, refuses, and raises a <b>general protection fault</b> into the kernel. The boundary is enforced by hardware.', { gate: 'fault' }),
    s('sig', 'kernel', '커널은 이 프로세스에 <b>SIGSEGV</b>를 보냅니다. 처리기가 없으면 프로세스를 끝내고 메모리 · 파일을 회수합니다.', 'The kernel sends the process <b>SIGSEGV</b>. Without a handler, the process is terminated and its memory and files are reclaimed.', { ps: 'done' }),
    s('sched', 'kernel', '다른 프로세스를 골라 계속 돌립니다. 프로그램 하나가 잘못해도 컴퓨터 전체는 멀쩡합니다.', 'Another process is picked and carries on. One misbehaving program does not take down the machine.'),
    s('app', 'user', '(다른 프로세스) 셸에 "Segmentation fault"가 찍힙니다.', '(Another process) the shell prints "Segmentation fault".', { gate: 'iret', other: true })
  ] },
  { id: 'timer', ko: '타이머 인터럽트로 빼앗기', en: 'Preempted by the timer', code: 'while (1) { x++; }  /* 무한 루프 */', steps: [
    s('app', 'user', '프로그램이 시스템 호출 없이 계산만 하는 무한 루프를 돕니다. 스스로 CPU를 내놓을 일이 없습니다.', 'The program spins in a loop that only computes and never makes a system call. It will never give up the CPU by itself.', { ps: 'run' }),
    s('timer', 'kernel', '몇 ms마다 <b>타이머</b>가 인터럽트를 겁니다. CPU는 루프 도중에 커널로 뜁니다.', 'Every few ms the <b>timer</b> raises an interrupt. The CPU jumps into the kernel in the middle of the loop.', { gate: 'irq' }),
    s('sched', 'kernel', '스케줄러가 이 프로세스가 할당량을 다 썼는지 봅니다. 다 썼으니 <b>준비</b> 상태로 돌리고 다른 프로세스를 고릅니다(문맥 전환).', 'The scheduler checks whether the process used up its time slice. It has, so it goes back to <b>ready</b> and another process is chosen (a context switch).', { ps: 'ready' }),
    s('app', 'user', '다른 프로세스가 돌아갑니다. 나중에 차례가 오면 무한 루프는 멈췄던 곳에서 이어집니다. 이것이 <a href="os-process.html">선점</a>이고, 무한 루프 하나가 컴퓨터를 멈추지 못하는 이유입니다.', 'Another process runs. When its turn comes back, the loop continues exactly where it stopped. This is <a href="os-process.html">preemption</a>, and why one infinite loop cannot freeze the machine.', { gate: 'iret', other: true })
  ] }
];
