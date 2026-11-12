// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 배전 공사현장 안전조치 시뮬레이션 코어 (화면 없이 동작 → 테스트 가능). 단위: 미터, 초
//
// 장면: 왕복 2차로 도로(x축 방향), 북쪽 보도 위 전주 4기(-70 개폐기 · -35 접지 · 0 작업 · 35), 고압 3상 + 중성선 (저압선 없음)
//   시나리오 'pole'    가공 배전선로 애자·완금 교체 (정전 작업) — 안전수칙 1~8, 11(배전)
//   시나리오 'manhole' 지중 배전 맨홀 내 케이블 점검 — 안전수칙 1, 3, 9, 10, 11(토목: 개구부 방호)
// 각 단계 = 여러 줄(lane)의 할 일(task)을 동시에 진행. 매 틱 안전 규칙(불변식)을 확인해 위반을 기록
//
// ⚠ 교육용으로 단순화한 가상 현장입니다. 실제 작업은 소속 기관의 작업기준·안전수칙을 따르세요.

// 파일 구성: core.js (공통) · scn-pole.js · scn-manhole.js · scn-transformer.js · scn-tower.js (시나리오) · 이 파일 (시나리오 목록 · 시뮬레이터 · 훈련 보기)

import { GEO, bucketPos, hookXY, L, dist2, inPoly, act } from './core.js?v=a3a7c3c2';
import { poleWorld, person, poleSteps } from './scn-pole.js?v=9f79de89';
import { gasOK, GAS_GOOD, manholeWorld, manholeSteps } from './scn-manhole.js?v=087db54d';
import { TX, txWorld, txSteps } from './scn-transformer.js?v=a45545bf';
import { TW, towerLeg, PULLEY, towerWorld, towerSteps } from './scn-tower.js?v=f2381739';
export * from './core.js?v=a3a7c3c2';
export { GAS_LIMIT, gasOK } from './scn-manhole.js?v=087db54d';
export { TX } from './scn-transformer.js?v=a45545bf';
export { TW, towerLeg, PULLEY } from './scn-tower.js?v=f2381739';

export const SCENARIOS = {
  pole: { scene: 'pole', title: L('가공 배전 애자·완금 교체 (정전 작업)', 'Overhead line: replace insulators & crossarm (de-energised)'), world: poleWorld, steps: poleSteps },
  tx: { scene: 'pole', title: L('배전 변압기 교체 (COS 개방, 본선 활선)', 'Distribution: replace a pole transformer (cut-out open, main line live)'), world: txWorld, steps: txSteps },
  manhole: { scene: 'manhole', title: L('지중 배전 맨홀 작업 (밀폐공간)', 'Underground: manhole work (confined space)'), world: manholeWorld, steps: manholeSteps },
  tower: { scene: 'tower', title: L('송전 철탑 승탑 (추락방지)', 'Transmission: climbing a tower (fall arrest)'), world: towerWorld, steps: towerSteps }
};

// ---- 보행자 ----------------------------------------------------------------------------
function makePeds(scenario) {
  const north = SCENARIOS[scenario].scene === 'pole';                // 변압기 교체는 낙하 반경을 피해 보도 바깥쪽으로
  const y = north ? (scenario === 'tx' ? 7.3 : GEO.pedY) : GEO.pedYm;
  return [{ x: -40, y, dir: 1, sp: 1.25, k: 0 }, { x: 30, y: y + (north ? (scenario === 'tx' ? 0.15 : 0.3) : -0.4), dir: -1, sp: 1.05, k: 0.5 }];
}

// ---- 시뮬레이터 -------------------------------------------------------------------------
export class SafetySim {
  constructor(opts = {}) {
    this.scenario = opts.scenario || 'pole';
    const S = SCENARIOS[this.scenario];
    this.scene = S.scene;
    this.w = S.world();
    this.steps = S.steps();
    this.peds = makePeds(this.scenario);
    this.t = 0; this.dt = opts.dt || 0.05;
    this.stepIdx = -1; this.lanes = null; this.stepT = 0;
    this.violations = []; this.log = [];
    this.w.t = 0;
  }
  get step() { return this.steps[this.stepIdx] || null; }
  // 다음 단계 시작 (현재 단계가 끝났을 때만)
  begin(i = this.stepIdx + 1) {
    if (this.lanes && this.lanes.some(l => l.length)) return false;
    if (i >= this.steps.length) return false;
    this.stepIdx = i; this.stepT = 0;
    this.lanes = this.steps[i].lanes.map(l => l.map(x => ({ ...x, el: 0, started: false })));
    this.log.push({ t: this.t, step: this.steps[i].id });
    return true;
  }
  stepDone() { return !!this.lanes && this.lanes.every(l => l.length === 0); }
  done() { return this.stepIdx === this.steps.length - 1 && this.stepDone(); }

  update() {
    const dt = this.dt, W = this.w;
    this.t += dt; W.t = this.t; this.stepT += dt;
    for (const p of Object.values(W.people)) {
      if (p.sayT > 0) { p.sayT -= dt; if (p.sayT <= 0) p.say = null; }
    }
    if (this.lanes) {
      const busy = new Set();
      for (const lane of this.lanes) {
        let guard = 0;
        while (lane.length && guard++ < 50) {
          const task = lane[0];
          if (task.w && busy.has(task.w) && !task.started) break;   // 한 사람은 한 번에 한 가지만
          if (this.run(task, dt)) { lane.shift(); continue; }
          if (task.w) busy.add(task.w);
          break;
        }
      }
    }
    for (const p of Object.values(W.people)) if (!p._busy) { p.anim = 'idle'; p.stick = null; }
    if (W.people.B.inBucket) { const T = bucketPos(W.truck); Object.assign(W.people.B, { x: T[0], y: T[1], z: T[2] }); }
    for (const p of Object.values(W.people)) p._busy = false;
    this.movePeds(dt);
    this.check();
  }
  // 할 일 하나 진행. 끝나면 true
  run(task, dt) {
    const W = this.w;
    if (task.dyn) { const list = task.dyn(W).map(x => ({ ...x, el: 0, started: false })); const lane = this.lanes.find(l => l[0] === task); lane.splice(1, 0, ...list); return true; }
    if (task.set) { task.set(W); return true; }
    if (task.until) return !!task.until(W);
    if (task.wait !== undefined) { task.el += dt; return task.el >= task.wait; }
    const p = task.w ? W.people[task.w] : null;
    if (p) p._busy = true;
    if (!task.started) {
      task.started = true;
      if (p && task.say) { p.say = task.say; p.sayT = Math.max(task.dur || 2, 1.6); }
    }
    if (task.go) {
      const [tx, ty] = task.go, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), sp = 1.6 * dt;
      p.anim = 'walk'; p.k += dt * 2.4;
      if (Math.abs(dx) > 0.02) p.face = Math.sign(dx);
      if (d <= sp) { p.x = tx; p.y = ty; p.anim = 'idle'; return true; }
      p.x += dx / d * sp; p.y += dy / d * sp; return false;
    }
    task.el += dt;
    const k = Math.min(1, task.el / task.dur);
    if (task.tween) { task.fx(W, k); if (k >= 1) { task.end?.(W); return true; } return false; }
    // act
    p.anim = task.act; p.k += dt;
    p.stick = task.stick ? { to: task.stick, tool: task.tool || 'stick' } : null;
    task.fx?.(W, k);
    if (k >= 1) { task.end?.(W); p.stick = null; return true; }
    return false;
  }
  movePeds(dt) {
    for (const q of this.peds) {
      q.x += q.dir * q.sp * dt; q.k += dt * 2.2;
      if (q.x > 55) q.dir = -1; if (q.x < -55) q.dir = 1;
    }
  }

  // ---- 안전 규칙 (매 틱) ----
  check() {
    const W = this.w, G = GEO, v = (rule, msg) => {
      const last = this.violations[this.violations.length - 1];
      if (!last || last.msg !== msg || this.t - last.t > 1) this.violations.push({ t: this.t, rule, msg, step: this.step?.id });
    };
    if (this.scene === 'pole') {
      const tr = W.truck, T = bucketPos(tr), up = T[2] > 4.2;
      if (up && !(tr.chocks.every(Boolean) && tr.outrig >= 1)) v(2, 'boom up without 4 chocks and full outriggers');
      if (up && !(W.people.B.inBucket && W.people.B.hooked)) v(7, 'boom up without hooked worker');
      if (tr.moving && W.people.B.inBucket) v(7, 'truck moving with a person in the bucket');
      if (tr.moving && tr.outrig > 0) v(4, 'truck moving with outriggers out');
      if (tr.moving === -1 && dist2([W.people.E.x, W.people.E.y], G.guideSpot) > 0.5) v(5, 'reversing without the guide in position');
      if (tr.moving && Object.entries(W.people).some(([k, p]) => !p.inCab && Math.abs(p.y - tr.y) < 1.7 && Math.abs(p.x - tr.c) < G.truckLen / 2 + 0.6)) v(5, 'person in the path of the moving truck');
      if (this.scenario === 'tx') this.checkTx(v, T, up);
      else {
      if (W.ground.line > 0 && !(W.ground.earth && W.tested.gnd && !W.sw.closed)) v(8, 'earth clamp without earth end / test / open switch');
      if (W.sw.closed && (W.ground.line > 0 || W.people.B.inBucket && up)) v(8, 'line energised with earth on or worker aloft');
      // 버킷 작업자 손이 고압선 1.2m 이내 → 검전·접지 끝났어야 함, 교체 작업은 방호 뒤에
      if (W.people.B.inBucket) {
        const hand = [T[0] + Math.cos(tr.boom.slew) * 0.5, T[1] + Math.sin(tr.boom.slew) * 0.5, T[2] + 1.2];
        const nearHV = G.phaseY.some(y => Math.hypot(hand[1] - y, hand[2] - G.armZ) < 1.2 && Math.abs(hand[0] - G.workX) < 3);
        if (nearHV && !(W.tested.work && W.ground.line === 3 && !W.sw.closed)) v(8, 'hands near HV before test & earth');
        if (nearHV && W.covers < 1 && W.load.state !== 'down') { /* 방호 중 이동은 허용: 작업(교체)은 covers=1에서만 */ }
        if (W.insul === 'old' && W.load.state === 'bucket' && W.covers < 1) v(8, 'working without covers');
      }
      }
      // 매달린 인양물 아래 사람 없음
      if ((W.load.state === 'hook' || W.txOld?.state === 'hook') && tr.hookDrop < 0.97) {
        const h = hookXY(tr);
        for (const [k, p] of Object.entries(W.people)) if (!p.inBucket && !p.inCab && Math.hypot(p.x - h[0], p.y - h[1]) < G.fallR) v(6, `person ${k} under suspended load`);
      }
    } else if (this.scene === 'tower') {
      const B = W.people.B, foot = towerLeg(0);
      if (B.z > 0.3) {
        if (!(W.arrester || W.lanyard)) v(7, 'aloft with no hook on');
        if (!B.ppe.harness) v(1, 'aloft without a full-body harness');
        if ((B.anim === 'work' || B.anim === 'reach') && B.z > 2 && !W.lanyard && !W.arrester) v(7, 'working aloft unclipped');
        if ((B.anim === 'work' || B.anim === 'reach') && Math.abs(B.z - TW.workZ) < 0.5 && !W.lanyard && this.step?.id !== 'tieoff' && this.step?.id !== 'tdown') v(7, 'working at height without the lanyard tied off');
      }
      if (B.anim === 'climb' && B.z > 0.3 && !(W.arrester && W.lifelineOK)) v(11, 'climbing without the checked fall-arrest wire');
      if (B.z > 2) for (const [k, p] of Object.entries(W.people)) if (k !== 'B' && Math.hypot(p.x - foot[0], p.y - foot[1]) < 3) v(5, `person ${k} under the climber`);
      if (W.bag.state === 'up' || W.bag.state === 'down') for (const [k, p] of Object.entries(W.people)) if (k !== 'B' && Math.hypot(p.x - PULLEY[0], p.y - PULLEY[1]) < G.fallR) v(6, `person ${k} under the hoisted bag`);
    } else {
      const M = W.mh;
      if (M.lid === 'open' && !(M.guard && W.cones.every(c => c.placed))) v(10, 'open manhole without guard or full zone');
      if (M.inside || W.people.B.z < -0.05) {
        if (!(M.permit && gasOK(M.gas) && M.measured && gasOK(M.measured) && M.vent && M.tripod && W.people.B.hooked)) v(9, 'entry without permit, safe air, ventilation, tripod and lifeline');
        if (dist2([W.people.C.x, W.people.C.y], G.mh) > 2.5) v(9, 'attendant away from the manhole');
      }
      // 환기: 가스가 적정 공기로
      const g = M.gas, k = M.vent ? 1 - Math.exp(-this.dt / 2.5) : 0;
      if (k) for (const key of ['o2', 'h2s', 'co']) g[key] += (GAS_GOOD[key] - g[key]) * k;
    }
    for (const q of this.peds) {
      const inside = this.scene === 'tower' ? Math.hypot(q.x - TW.x, q.y - TW.y) < 9 : inPoly([q.x, q.y], this.scene === 'pole' ? G.zone : G.mhZone);
      if (inside) v(5, 'pedestrian inside work zone');
    }
  }
  // 변압기 교체: 본선·COS 전원측은 살아 있음
  checkTx(v, T, up) {
    const W = this.w, G = GEO, B = W.people.B;
    if (W.txGround && !(W.txEarth && W.txTested && !W.cos.closed)) v(8, 'earth clamp without earth end / test / open cut-out');
    if (W.cos.closed && (W.txGround || (B.inBucket && up))) v(8, 'cut-out closed with earth on or worker aloft');
    if (!B.inBucket) return;
    const s = W.truck.boom.slew, hand = [T[0] + Math.cos(s) * 0.5, T[1] + Math.sin(s) * 0.5, T[2] + 1.2];
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const nearLive = G.phaseY.some(y => Math.hypot(hand[1] - y, hand[2] - (G.armZ + 0.26)) < 1.2 && Math.abs(hand[0] - G.workX) < 3) || d3(hand, [TX.cos[0], TX.cos[1], TX.cos[2] + 0.35]) < 1.2;
    if (nearLive) v(8, 'hands within 1.2 m of live HV');
    if (d3(hand, [TX.x, TX.y, TX.z1]) < 1.3 && !(W.txTested && W.txGround && !W.cos.closed && W.hvCover >= 1)) v(8, 'hands at the transformer before isolation, test, earth and covers');
  }

  // 처음부터 i번째 단계 시작 직전까지 빠르게 진행
  static jumpTo(opts, i) {
    const s = new SafetySim(opts);
    for (let k = 0; k < i; k++) { s.begin(k); let n = 0; while (!s.stepDone() && n++ < 40000) s.update(); }
    return s;
  }
}

// ---- 훈련 모드: 보기 3개 (정답 1) ---------------------------------------------------------
export function quizOptions(sim, i, rand = Math.random) {
  const st = sim.steps[i];
  const opts = [{ text: st.title, correct: true }, ...st.wrong.map(w => ({ text: w.text, correct: false, why: w.why }))];
  for (let k = opts.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [opts[k], opts[j]] = [opts[j], opts[k]]; }
  return opts;
}
