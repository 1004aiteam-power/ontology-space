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
