// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 1004aiteam-power — Ontology Space (https://github.com/1004aiteam-power/ontology-space)
// 서비스 계층: DB를 직접 열어 주는 대신, 앞에 REST 서비스를 둔다. 인증 · 권한 · 검증 · 필드 숨김은 서비스가 맡고, SQL은 서비스 안에서만 만들어진다.
// handle(요청) → { status, headers, body, sql } (sql: 서비스가 DB에 보낸 문장들). 브라우저 없이 테스트: tests/db.test.mjs
import { ASSET_TYPES } from './data.js?v=b680931a';

export const TOKENS = { 'tok-viewer': { user: 'kim', role: 'viewer' }, 'tok-editor': { user: 'lee', role: 'editor' } };
const PUBLIC = ['id', 'substation_id', 'type', 'name', 'health'];            // viewer 에게는 installed(설치 연도)를 숨김
const pick = (row, role) => (role === 'editor' ? row : Object.fromEntries(PUBLIC.map(k => [k, row[k]])));

export function createService(db) {
  const respond = (status, body, headers = {}) => ({ status, headers: { 'Content-Type': 'application/json', ...headers }, body, sql: db.log.map(l => ({ sql: l.sql, params: l.params })) });
  return function handle({ method, path, query = {}, headers = {}, body = null }) {
    db.resetLog();
    const auth = TOKENS[(headers.Authorization || '').replace(/^Bearer /, '')];
    if (!auth) return respond(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    const m = /^\/api\/assets(?:\/([^/]+))?$/.exec(path);
    if (!m) return respond(404, { error: 'not found' });
    const id = m[1];
    const write = () => (auth.role === 'editor' ? null : respond(403, { error: 'editor role required' }));

    if (method === 'GET' && !id) {
      const w = [], p = [];
      if (query.type) { w.push('type = ?'); p.push(query.type); }
      if (query.min_health !== undefined) {
        const n = Number(query.min_health);
        if (!Number.isFinite(n)) return respond(400, { error: 'min_health must be a number' });
        w.push('health >= ?'); p.push(n);
      }
      const limit = Math.min(Number(query.limit) || 50, 100);
      const r = db.exec(`SELECT * FROM assets${w.length ? ' WHERE ' + w.join(' AND ') : ''} ORDER BY id LIMIT ${limit}`, p);
      return respond(200, r.rows.map(x => pick(x, auth.role)));
    }
    if (method === 'GET') {
      const r = db.exec('SELECT * FROM assets WHERE id = ?', [id]);
      return r.rowCount ? respond(200, pick(r.rows[0], auth.role)) : respond(404, { error: 'asset not found' });
    }
    if (method === 'POST' && !id) {
      const deny = write(); if (deny) return deny;
      const b = body || {};
      const errs = [];
      if (!/^[A-Z]\d+$/.test(b.id || '')) errs.push('id must look like T9');
      if (!ASSET_TYPES.includes(b.type)) errs.push(`type must be one of ${ASSET_TYPES.join('/')}`);
      if (!Number.isInteger(b.health) || b.health < 0 || b.health > 100) errs.push('health must be an integer 0–100');
      if (errs.length) return respond(422, { errors: errs });
      if (db.exec('SELECT id FROM assets WHERE id = ?', [b.id]).rowCount) return respond(409, { error: 'id already exists' });
      db.exec('INSERT INTO assets (id, substation_id, type, name, health, installed) VALUES (?, ?, ?, ?, ?, ?)', [b.id, b.substation_id ?? 'S1', b.type, b.name ?? b.id, b.health, b.installed ?? 2026]);
      return respond(201, db.exec('SELECT * FROM assets WHERE id = ?', [b.id]).rows[0], { Location: `/api/assets/${b.id}` });
    }
    if (method === 'PATCH' && id) {
      const deny = write(); if (deny) return deny;
      const b = body || {};
      if (!Number.isInteger(b.health) || b.health < 0 || b.health > 100) return respond(422, { errors: ['health must be an integer 0–100'] });
      const r = db.exec('UPDATE assets SET health = ? WHERE id = ?', [b.health, id]);
      return r.rowCount ? respond(200, db.exec('SELECT * FROM assets WHERE id = ?', [id]).rows[0]) : respond(404, { error: 'asset not found' });
    }
    if (method === 'DELETE' && id) {
      const deny = write(); if (deny) return deny;
      const r = db.exec('DELETE FROM assets WHERE id = ?', [id]);
      return r.rowCount ? respond(204, null) : respond(404, { error: 'asset not found' });
    }
    return respond(405, { error: 'method not allowed' }, { Allow: id ? 'GET, PATCH, DELETE' : 'GET, POST' });
  };
}
