// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 여러 페이지 스크립트가 함께 쓰는 작은 도우미. 예전에는 파일마다 같은 줄을 복사해 두었다
//
//   import { $, esc, T, t, css, dark, fit } from './lib/dom.js';

export const $ = (id) => document.getElementById(id);

// HTML 에 넣을 글자 이스케이프 (없는 값은 빈 글자)
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 지금 언어의 글: t({ ko, en }) 또는 T(ko, en). window.t 는 모든 페이지의 <head> 가 만든다 (tools/build_nav.py)
export const t = (o) => (window.t ? window.t(o) : o.ko);
export const T = (ko, en) => t({ ko, en });

// 색 변수 값 (assets/site.css 의 --text, --line …) 과 지금 어두운 화면인지
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const dark = () => document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

// 캔버스를 화면 배율(레티나)에 맞춰 준비. aspect = 세로/가로 비율을 주면 그 비율로 높이를 정하고, 없으면 CSS 높이 그대로
export function fit(canvas, aspect) {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth;
  const ch = aspect ? cw * aspect : canvas.clientHeight;
  if (aspect) canvas.style.height = ch + 'px';
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cw, ch, dpr };
}
