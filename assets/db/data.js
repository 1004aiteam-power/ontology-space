// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 데이터베이스 접근 페이지들이 함께 쓰는 예제 데이터: 가상 변전소 3곳과 설비 12개. 모든 페이지가 같은 데이터로 접근 방식만 바꿔 보여 준다
import { Database } from './minisql.js?v=7ebfcdc8';

export const SUBSTATIONS = [
  { id: 'S1', name: 'Sub-A', region: 'Seoul' },
  { id: 'S2', name: 'Sub-B', region: 'Gyeonggi' },
  { id: 'S3', name: 'Sub-C', region: 'Gangwon' }
];

export const ASSETS = [
  { id: 'T1', substation_id: 'S1', type: 'transformer', name: 'MTr-1', health: 82, installed: 2008 },
  { id: 'T2', substation_id: 'S1', type: 'transformer', name: 'MTr-2', health: 64, installed: 2003 },
  { id: 'B1', substation_id: 'S1', type: 'breaker', name: 'CB-101', health: 91, installed: 2015 },
  { id: 'B2', substation_id: 'S1', type: 'breaker', name: 'CB-102', health: 58, installed: 1999 },
  { id: 'C1', substation_id: 'S1', type: 'cable', name: 'Cable-A1', health: 77, installed: 2012 },
  { id: 'T3', substation_id: 'S2', type: 'transformer', name: 'MTr-3', health: 95, installed: 2019 },
  { id: 'B3', substation_id: 'S2', type: 'breaker', name: 'CB-201', health: 70, installed: 2010 },
  { id: 'B4', substation_id: 'S2', type: 'breaker', name: 'CB-202', health: 88, installed: 2016 },
  { id: 'R1', substation_id: 'S2', type: 'relay', name: 'Relay-21', health: 66, installed: 2007 },
  { id: 'T4', substation_id: 'S3', type: 'transformer', name: 'MTr-4', health: 49, installed: 1995 },
  { id: 'B5', substation_id: 'S3', type: 'breaker', name: 'CB-301', health: 73, installed: 2011 },
  { id: 'C2', substation_id: 'S3', type: 'cable', name: 'Cable-C1', health: 81, installed: 2014 }
];

export const SCHEMA = {
  substations: ['id', 'name', 'region'],
  assets: ['id', 'substation_id', 'type', 'name', 'health', 'installed']
};

export const ASSET_TYPES = ['transformer', 'breaker', 'cable', 'relay'];

// 새 데이터베이스 한 벌 (호출마다 복사본이라 DROP · UPDATE 를 해도 원본은 그대로)
export function makeDB() {
  return new Database({
    substations: { cols: SCHEMA.substations, rows: SUBSTATIONS },
    assets: { cols: SCHEMA.assets, rows: ASSETS }
  });
}

// 시계열 예: 설비의 월별 건전도 측정값 (결정적 — 같은 설비는 늘 같은 값)
export function readings(assetId, months = 6) {
  const a = ASSETS.find(x => x.id === assetId);
  if (!a) return [];
  let seed = 0;
  for (const c of assetId) seed = (seed * 31 + c.charCodeAt(0)) % 997;
  const out = [];
  for (let m = 0; m < months; m++) {
    seed = (seed * 73 + 41) % 997;
    const drift = Math.round((months - 1 - m) * 0.6 + ((seed % 7) - 3) * 0.4);
    out.push({ month: `2026-${String(m + 1).padStart(2, '0')}`, health: Math.max(0, Math.min(100, a.health + drift)) });
  }
  out[months - 1].health = a.health;
  return out;
}
