// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// NEAT 신경망 그리기: 자율주행 · 스네이크 · 드론 페이지가 함께 쓴다 (예전에는 세 파일에 같은 코드가 따로 있었다)
//
//   drawNetwork(ctx, genome, net, box, { colors, pad, vertical, mini, font, label, … })
//
// 층은 입력에서의 최장 경로로 정한다. 기본은 왼쪽(입력) → 오른쪽(출력), vertical 이면 아래(입력) → 위(출력).
// 노드 옆 글자는 페이지마다 달라서 label(n, p, v) 로 받는다 (n = 노드, p = 화면 위치, v = 지금 활성값)
import { css, dark } from '../lib/dom.js?v=3b73d59c';

// 양(+) · 음(−) 색: dataviz 기준 팔레트 (밝은 · 어두운 화면 각각 색각 이상 검증 통과). 차트의 두 계열 색으로도 쓴다
export const SERIES = () => dark() ? ['#3987e5', '#d95926'] : ['#2a78d6', '#eb6834'];

// 노드를 층별로 묶는다: { cols: Map(층 → [노드 id]), maxD: 출력층 번호 }
export function netLayout(genome) {
  const nIn = genome.cfg.nInputs, depth = new Map(), on = [...genome.conns.values()].filter(c => c.on);
  for (const id of genome.nodes.keys()) depth.set(id, id < nIn ? 0 : 1);
  for (let it = 0; it < genome.nodes.size; it++) for (const c of on) if (depth.get(c.b) < depth.get(c.a) + 1 && genome.nodes.get(c.b).type !== 'out') depth.set(c.b, depth.get(c.a) + 1);
  const maxD = Math.max(1, ...[...genome.nodes.values()].filter(n => n.type === 'hid').map(n => depth.get(n.id))) + 1;
  for (const n of genome.nodes.values()) if (n.type === 'out') depth.set(n.id, maxD);
  const cols = new Map();
  for (const n of genome.nodes.values()) { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n.id); }
  return { cols, maxD };
}

// o.pad        { l, r, t, b } 그림 둘레에 글자를 적을 여백
// o.vertical   true 면 아래에서 위로
// o.mini       작은 그림 (순위표 등): 꺼진 연결은 그리지 않고 선 · 노드를 가늘게
// o.across     (출력층인가, 순서, 개수) → 층 안에서의 위치 0~1. 없으면 고르게
// o.sortOutputs(ids) 출력 노드의 순서를 바꿈
// o.linkAlpha  (신호 세기, 가중치) → 선의 진하기. 없으면 지금 흐르는 신호가 셀수록 진하게
// o.ring       (노드) → { color, width } 강조할 노드의 테두리. 없으면 보통 테두리
export function drawNetwork(ctx, genome, net, box, o) {
  const { cols, maxD } = netLayout(genome), mini = !!o.mini, pad = o.pad, pos = new Map();
  o.sortOutputs?.(cols.get(maxD));
  for (const [d, ids] of cols) ids.forEach((id, i) => {
    const along = d / maxD, across = ids.length === 1 ? 0.5 : (o.across ? o.across(d === maxD, i, ids.length) : i / (ids.length - 1));
    pos.set(id, o.vertical
      ? { x: box.x + pad.l + (box.w - pad.l - pad.r) * across, y: box.y + box.h - pad.b - (box.h - pad.t - pad.b) * along }
      : { x: box.x + pad.l + (box.w - pad.l - pad.r) * along, y: box.y + pad.t + (box.h - pad.t - pad.b) * across });
  });
  const [pos1, neg1] = o.colors || SERIES(), k = mini ? 0.5 : 1;
  for (const c of genome.conns.values()) {
    const a = pos.get(c.a), b = pos.get(c.b);
    if (!a || !b || (mini && !c.on)) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    if (!c.on) { ctx.setLineDash([3, 4]); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; }
    else {
      ctx.setLineDash([]); ctx.strokeStyle = c.w > 0 ? pos1 : neg1;
      const sig = Math.abs((net?.values.get(c.a) ?? 0.5) * c.w);
      ctx.globalAlpha = o.linkAlpha ? o.linkAlpha(sig, c.w) : 0.15 + Math.min(0.85, sig / 2);
      ctx.lineWidth = Math.min(4, 0.6 + Math.abs(c.w)) * k;
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  ctx.font = o.font; ctx.textBaseline = 'middle';
  for (const n of genome.nodes.values()) {
    const p = pos.get(n.id), v = net?.values.get(n.id) ?? 0;
    const r = (n.type === 'hid' ? 6 : 8) * (mini ? 0.55 : 1);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fillStyle = css('--surface'); ctx.fill();
    ctx.globalAlpha = Math.min(1, Math.abs(v)); ctx.fillStyle = v >= 0 ? pos1 : neg1; ctx.fill(); ctx.globalAlpha = 1;
    const ring = o.ring?.(n);
    ctx.strokeStyle = ring ? ring.color : css('--muted'); ctx.lineWidth = ring ? ring.width : (mini ? 0.8 : 1.2); ctx.stroke();
    ctx.fillStyle = css('--text');
    o.label(n, p, v);
  }
}
