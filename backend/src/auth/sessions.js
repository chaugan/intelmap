import crypto from 'crypto';
import { getDb } from '../db/index.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSession(userId) {
  const db = getDb();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
  return { id, expiresAt };
}

export function validateSession(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT s.id, s.user_id, s.expires_at, u.username, u.role, u.must_change_password, u.locked, u.ai_chat_enabled
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).get(sessionId);
  if (!row) return null;
  return {
    sessionId: row.id,
    id: row.user_id,
    username: row.username,
    role: row.role,
    mustChangePassword: !!row.must_change_password,
    locked: !!row.locked,
    aiChatEnabled: !!row.ai_chat_enabled,
  };
}

export function deleteSession(sessionId) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteUserSessions(userId) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function cleanExpiredSessions() {
  const db = getDb();
  const result = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  if (result.changes > 0) {
    console.log(`Cleaned ${result.changes} expired sessions`);
  }
}
