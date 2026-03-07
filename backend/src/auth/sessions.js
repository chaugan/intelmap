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
  const session = db.prepare(
    "SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).get(sessionId);
  if (!session) return null;

  // Determine effective user: impersonated or session owner
  const isImpersonating = !!session.impersonating_user_id;
  const effectiveUserId = isImpersonating ? session.impersonating_user_id : session.user_id;

  const row = db.prepare(
    `SELECT u.id as user_id, u.username, u.role, u.org_id,
            u.must_change_password, u.locked, u.ai_chat_enabled,
            u.timelapse_enabled, u.wasos_enabled, u.signal_enabled, u.infraview_enabled, u.upscale_enabled,
            u.totp_enabled,
            o.name as org_name,
            o.feature_ai_chat, o.feature_wasos, o.feature_signal, o.feature_infraview,
            o.feature_upscale, o.feature_mfa, o.mfa_required
     FROM users u
     LEFT JOIN organizations o ON u.org_id = o.id
     WHERE u.id = ?
       AND (u.org_id IS NULL OR o.deleted_at IS NULL)`
  ).get(effectiveUserId);
  if (!row) return null;

  // Check if user has any MFA method enabled
  const hasWebauthn = row.org_id ? db.prepare(
    'SELECT COUNT(*) as c FROM webauthn_credentials WHERE user_id = ?'
  ).get(row.user_id)?.c > 0 : false;
  const hasMfa = !!row.totp_enabled || hasWebauthn;

  const result = {
    sessionId: session.id,
    id: row.user_id,
    username: row.username,
    role: row.role,
    orgId: row.org_id,
    mustChangePassword: !!row.must_change_password,
    locked: !!row.locked,
    aiChatEnabled: !!row.ai_chat_enabled,
    timelapse_enabled: !!row.timelapse_enabled,
    timelapseEnabled: !!row.timelapse_enabled,
    wasosEnabled: !!row.wasos_enabled,
    signalEnabled: !!row.signal_enabled,
    infraviewEnabled: !!row.infraview_enabled,
    upscaleEnabled: !!row.upscale_enabled,
    orgName: row.org_name || null,
    orgFeatureAiChat: !!row.feature_ai_chat,
    orgFeatureWasos: !!row.feature_wasos,
    orgFeatureSignal: !!row.feature_signal,
    orgFeatureInfraview: !!row.feature_infraview,
    orgFeatureUpscale: !!row.feature_upscale,
    orgFeatureMfa: row.role === 'super_admin' ? true : !!row.feature_mfa,
    orgMfaRequired: !!row.mfa_required,
    totpEnabled: !!row.totp_enabled,
    hasMfa,
    mfaSetupRequired: !!row.mfa_required && !hasMfa,
  };

  if (isImpersonating) {
    const realUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(session.user_id);
    result.isImpersonating = true;
    result.realUser = realUser ? { id: realUser.id, username: realUser.username } : null;
  }

  return result;
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

  // Clean expired MFA pending tokens and WebAuthn challenges
  db.prepare("DELETE FROM mfa_pending WHERE expires_at <= datetime('now')").run();
  db.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= datetime('now')").run();
}
