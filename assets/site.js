// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 공통: 테마 전환, 한/영 전환, 코드 하이라이트, 코드 뷰어
(function () {
  const root = document.documentElement;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ---- 언어 ----
  const initialLang = store.get('lang') || ((navigator.language || 'ko').startsWith('ko') ? 'ko' : 'en');
  function setLang(lang) {
    root.lang = lang;
    store.set('lang', lang);
    const btn = document.getElementById('langBtn');
    if (btn) { btn.textContent = lang === 'ko' ? 'EN' : '한'; btn.title = lang === 'ko' ? 'English' : '한국어'; }
    const t = document.querySelector('meta[name="title-' + lang + '"]');
    if (t) document.title = t.content;
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  }
  root.classList.add('js');
  root.lang = initialLang;  // 첫 화면 깜빡임 방지: body가 그려지기 전에 적용
  window.currentLang = () => root.lang;
  window.t = (obj) => obj[root.lang] ?? obj.ko;

  // ---- 테마 ----
  const savedTheme = store.get('theme');
  if (savedTheme) root.dataset.theme = savedTheme;

  document.addEventListener('DOMContentLoaded', () => {
    setLang(initialLang);
    document.getElementById('langBtn')?.addEventListener('click', () => setLang(root.lang === 'ko' ? 'en' : 'ko'));
    document.getElementById('themeBtn')?.addEventListener('click', () => {
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      store.set('theme', root.dataset.theme);
    });
    if (window.hljs) document.querySelectorAll('pre code[class*="language-"]').forEach(el => hljs.highlightElement(el));
    initEasy();
    initViewers();
    initMenus();
    initNavToggle();
  });

  // ---- 💡 쉬운 설명 켜기/끄기 (쉬운 설명이 있는 페이지에만 버튼 표시) ----
  function initEasy() {
    if (!document.querySelector('.easy')) return;
    const tools = document.querySelector('header .tools');
    const btn = document.createElement('button');
    btn.id = 'easyBtn'; btn.textContent = '💡';
    const apply = (on) => {
      root.classList.toggle('hide-easy', !on);
      btn.setAttribute('aria-pressed', on);
      btn.title = on ? t({ ko: '쉬운 설명 숨기기', en: 'Hide plain-language notes' }) : t({ ko: '쉬운 설명 보기', en: 'Show plain-language notes' });
    };
    apply(store.get('easy') !== 'off');
    btn.addEventListener('click', () => { const on = root.classList.contains('hide-easy'); store.set('easy', on ? 'on' : 'off'); apply(on); });
    document.addEventListener('langchange', () => apply(!root.classList.contains('hide-easy')));
    tools.prepend(btn);
  }

  // ---- 좁은 화면: ☰ 버튼으로 위쪽 메뉴 열고 닫기 (모양은 site.css의 .nav-toggle · nav.open) ----
  function initNavToggle() {
    const nav = document.querySelector('header.top nav'), tools = document.querySelector('header.top .tools');
    if (!nav || !tools) return;
    nav.id = nav.id || 'siteNav';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nav-toggle'; btn.textContent = '☰';
    btn.setAttribute('aria-controls', nav.id);
    const label = () => { const s = t({ ko: '메뉴', en: 'Menu' }); btn.setAttribute('aria-label', s); btn.title = s; };
    const set = (on) => { nav.classList.toggle('open', on); btn.setAttribute('aria-expanded', on); btn.textContent = on ? '✕' : '☰'; };
    label(); set(false);
    document.addEventListener('langchange', label);
    btn.addEventListener('click', e => { e.stopPropagation(); set(!nav.classList.contains('open')); });
    nav.addEventListener('click', e => { if (e.target.closest('a')) set(false); });          // 같은 페이지 안의 #링크로 갈 때도 닫음
    document.addEventListener('click', e => { if (!nav.contains(e.target)) set(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus(); } });
    tools.append(btn);
  }

  // ---- nav 드롭다운 (피지컬 AI · 온톨로지 설계실) ----
  function initMenus() {
    const closers = [];
    document.querySelectorAll('.menu-btn').forEach(btn => {
      const menu = document.getElementById(btn.getAttribute('aria-controls'));
      if (!menu) return;
      const header = btn.closest('header') || document.body;
      const place = () => {
        const b = btn.getBoundingClientRect(), h = header.getBoundingClientRect();
        // header에 backdrop-filter가 있어 fixed 기준이 header가 됨
        const w = menu.offsetWidth || 220;
        const left = Math.max(8, Math.min(b.left, innerWidth - w - 8));
        menu.style.left = (left - h.left) + 'px';
        menu.style.top = (b.bottom - h.top + 4) + 'px';
      };
      const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
      closers.push(close);
      const open = () => { closers.forEach(c => c()); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); place(); };   // 한 번에 하나만 열림
      btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? open() : close(); });
      document.addEventListener('click', e => { if (!menu.contains(e.target)) close(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
      addEventListener('resize', () => { if (!menu.hidden) place(); });
      btn.closest('nav')?.addEventListener('scroll', () => { if (!menu.hidden) place(); }, {passive: true});
    });
  }

  // ---- 코드 뷰어: 같은 사이트의 파일을 불러와 표시 ----
  const GH = 'https://github.com/1004aiteam-power/ontology-space/blob/main/';
  function initViewers() {
    document.querySelectorAll('[data-viewer]').forEach(box => {
      const tabs = box.querySelectorAll('.tabs button');
      const view = box.querySelector('code');
      async function show(btn) {
        tabs.forEach(b => b.setAttribute('aria-selected', b === btn));
        const file = btn.dataset.file;
        box.querySelector('.path').textContent = file;
        box.querySelector('.gh').href = GH + file;
        view.className = file.endsWith('.py') ? 'language-python' : 'nohighlight';
        try {
          const res = await fetch(file);
          if (!res.ok) throw new Error(res.status);
          view.textContent = await res.text();
        } catch (e) {
          view.textContent = t({ ko: "# 코드를 불러오지 못했습니다. 'GitHub에서 보기'를 이용하세요.",
                                 en: "# Could not load the file. Use 'View on GitHub'." });
        }
        view.removeAttribute('data-highlighted');
        if (window.hljs) hljs.highlightElement(view);
      }
      tabs.forEach(b => b.addEventListener('click', () => show(b)));
      if (tabs.length) show(tabs[0]);
    });
  }
})();
