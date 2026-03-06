import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { sanitizeUsername, validatePassword } from '../auth/sanitize.js';
import { createSession, deleteSession, deleteUserSessions } from '../auth/sessions.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { getOrgSetting } from '../lib/org-utils.js';
import {
  generateTotpSecret, verifyTotpToken,
  generateBackupCodes, hashBackupCode, verifyAndConsumeBackupCode,
} from '../auth/mfa.js';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// In-memory rate limiter: 10 attempts per 15 min per IP
const loginAttempts = new Map(); // ip → { count, resetAt }
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 min

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

// Periodic cleanup of expired entries (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

// Helper: build user response with org features
function buildUserResponse(db, user, org) {
  const orgName = org?.name || null;
  const hasWebauthn = db.prepare(
    'SELECT COUNT(*) as c FROM webauthn_credentials WHERE user_id = ?'
  ).get(user.id)?.c > 0;
  const hasMfa = !!user.totp_enabled || hasWebauthn;

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    orgId: user.org_id || null,
    orgName,
    mustChangePassword: !!user.must_change_password,
    aiChatEnabled: !!user.ai_chat_enabled,
    timelapseEnabled: !!user.timelapse_enabled,
    wasosEnabled: !!user.wasos_enabled,
    infraviewEnabled: !!user.infraview_enabled,
    upscaleEnabled: !!user.upscale_enabled,
    exportMarking: getOrgSetting(db, user.org_id, 'export_marking') || 'none',
    exportMarkingCorner: getOrgSetting(db, user.org_id, 'export_marking_corner') || 'top-center',
    exportMarkingText: getOrgSetting(db, user.org_id, 'export_marking_text') || '',
    orgFeatureAiChat: !!org?.feature_ai_chat,
    orgFeatureWasos: !!org?.feature_wasos,
    orgFeatureInfraview: !!org?.feature_infraview,
    orgFeatureUpscale: !!org?.feature_upscale,
    orgFeatureMfa: user.role === 'super_admin' ? true : !!org?.feature_mfa,
    orgMfaRequired: !!org?.mfa_required,
    totpEnabled: !!user.totp_enabled,
    hasMfa,
    mfaSetupRequired: !!org?.mfa_required && !hasMfa,
  };
}

router.post('/login', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const username = sanitizeUsername(req.body.username);
  if (!username) return res.status(400).json({ error: 'Invalid username' });

  const password = req.body.password;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.locked) return res.status(403).json({ error: 'Account locked' });

  // Check if user's org is soft-deleted (super_admins have org_id = NULL, skip check)
  let org = null;
  if (user.org_id) {
    org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    if (!org || org.deleted_at) {
      return res.status(403).json({ error: 'Organization has been deactivated' });
    }
  }

  if (!verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  clearRateLimit(ip);

  // Check if user has MFA enabled
  const hasWebauthn = db.prepare(
    'SELECT COUNT(*) as c FROM webauthn_credentials WHERE user_id = ?'
  ).get(user.id)?.c > 0;
  const hasMfa = !!user.totp_enabled || hasWebauthn;

  if (hasMfa) {
    // MFA required - create pending token, don't create session yet
    const mfaToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    // Clean up any existing pending for this user
    db.prepare('DELETE FROM mfa_pending WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO mfa_pending (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(mfaToken, user.id, expiresAt);

    const methods = [];
    if (user.totp_enabled) methods.push('totp');
    if (hasWebauthn) methods.push('webauthn');
    if (user.mfa_backup_codes) {
      const codes = JSON.parse(user.mfa_backup_codes);
      if (codes.length > 0) methods.push('backup');
    }

    return res.json({ mfaRequired: true, mfaToken, methods });
  }

  const session = createSession(user.id);
  res.cookie('session', session.id, COOKIE_OPTS);
  res.json(buildUserResponse(db, user, org));
});

router.post('/logout', requireAuth, (req, res) => {
  deleteSession(req.user.sessionId);
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) return res.json(null);
  const db = getDb();
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    orgId: req.user.orgId || null,
    orgName: req.user.orgName || null,
    mustChangePassword: req.user.mustChangePassword,
    aiChatEnabled: req.user.aiChatEnabled,
    timelapseEnabled: req.user.timelapseEnabled,
    wasosEnabled: req.user.wasosEnabled,
    infraviewEnabled: req.user.infraviewEnabled,
    upscaleEnabled: req.user.upscaleEnabled,
    exportMarking: getOrgSetting(db, req.user.orgId, 'export_marking') || 'none',
    exportMarkingCorner: getOrgSetting(db, req.user.orgId, 'export_marking_corner') || 'top-center',
    exportMarkingText: getOrgSetting(db, req.user.orgId, 'export_marking_text') || '',
    orgFeatureAiChat: req.user.orgFeatureAiChat,
    orgFeatureWasos: req.user.orgFeatureWasos,
    orgFeatureInfraview: req.user.orgFeatureInfraview,
    orgFeatureUpscale: req.user.orgFeatureUpscale,
    orgFeatureMfa: req.user.orgFeatureMfa,
    orgMfaRequired: req.user.orgMfaRequired,
    totpEnabled: req.user.totpEnabled,
    hasMfa: req.user.hasMfa,
    mfaSetupRequired: req.user.mfaSetupRequired,
  });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: 'Password must be 6-128 characters' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // If not forced change, verify current password
  if (!user.must_change_password) {
    if (!currentPassword || !verifyPassword(currentPassword, user.password_hash, user.salt)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0, updated_at = datetime(\'now\') WHERE id = ?')
    .run(hash, salt, user.id);

  // Delete other sessions so only current one remains
  deleteUserSessions(user.id);
  const session = createSession(user.id);
  res.cookie('session', session.id, COOKIE_OPTS);

  // Refetch user to get updated data
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  let cpOrg = null;
  if (updatedUser.org_id) {
    cpOrg = db.prepare('SELECT * FROM organizations WHERE id = ?').get(updatedUser.org_id);
  }

  res.json(buildUserResponse(db, updatedUser, cpOrg));
});

// --- MFA verification (during login) ---

router.post('/mfa/verify', (req, res) => {
  const { mfaToken, method, code, credential } = req.body;
  if (!mfaToken) return res.status(400).json({ error: 'MFA token required' });

  const db = getDb();
  const pending = db.prepare(
    "SELECT * FROM mfa_pending WHERE token = ? AND expires_at > datetime('now')"
  ).get(mfaToken);
  if (!pending) return res.status(401).json({ error: 'MFA session expired. Please log in again.' });

  if (pending.attempts >= 5) {
    db.prepare('DELETE FROM mfa_pending WHERE token = ?').run(mfaToken);
    return res.status(429).json({ error: 'Too many attempts. Please log in again.' });
  }

  db.prepare('UPDATE mfa_pending SET attempts = attempts + 1 WHERE token = ?').run(mfaToken);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pending.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  let verified = false;

  if (method === 'totp') {
    if (!code || !user.totp_secret) return res.status(400).json({ error: 'Invalid TOTP code' });
    verified = verifyTotpToken(user.totp_secret, code);
  } else if (method === 'backup') {
    if (!code || !user.mfa_backup_codes) return res.status(400).json({ error: 'Invalid backup code' });
    const result = verifyAndConsumeBackupCode(code, user.mfa_backup_codes);
    if (result.valid) {
      verified = true;
      db.prepare('UPDATE users SET mfa_backup_codes = ? WHERE id = ?')
        .run(JSON.stringify(result.remaining), user.id);
    }
  } else if (method === 'webauthn') {
    // WebAuthn verification is handled via a separate endpoint flow
    return res.status(400).json({ error: 'Use /mfa/webauthn/auth-verify for WebAuthn' });
  } else {
    return res.status(400).json({ error: 'Invalid MFA method' });
  }

  if (!verified) return res.status(401).json({ error: 'Invalid code' });

  // MFA verified - clean up and create session
  db.prepare('DELETE FROM mfa_pending WHERE token = ?').run(mfaToken);

  let org = null;
  if (user.org_id) {
    org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
  }

  const session = createSession(user.id);
  res.cookie('session', session.id, COOKIE_OPTS);
  res.json(buildUserResponse(db, user, org));
});

// WebAuthn auth-options (during login MFA step)
router.post('/mfa/webauthn/auth-options', async (req, res) => {
  const { mfaToken } = req.body;
  if (!mfaToken) return res.status(400).json({ error: 'MFA token required' });

  const db = getDb();
  const pending = db.prepare(
    "SELECT * FROM mfa_pending WHERE token = ? AND expires_at > datetime('now')"
  ).get(mfaToken);
  if (!pending) return res.status(401).json({ error: 'MFA session expired' });

  const credentials = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ?')
    .all(pending.user_id);

  if (credentials.length === 0) {
    return res.status(400).json({ error: 'No security keys registered' });
  }

  try {
    const hostname = req.hostname;
    const options = await generateAuthenticationOptions({
      rpID: hostname,
      allowCredentials: credentials.map(c => ({
        id: c.id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      userVerification: 'preferred',
    });

    // Store challenge
    db.prepare(`
      INSERT INTO webauthn_challenges (user_id, challenge, expires_at)
      VALUES (?, ?, datetime('now', '+5 minutes'))
      ON CONFLICT(user_id) DO UPDATE SET challenge = excluded.challenge, expires_at = excluded.expires_at
    `).run(pending.user_id, options.challenge);

    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebAuthn auth-verify (during login MFA step)
router.post('/mfa/webauthn/auth-verify', async (req, res) => {
  const { mfaToken, credential } = req.body;
  if (!mfaToken || !credential) return res.status(400).json({ error: 'MFA token and credential required' });

  const db = getDb();
  const pending = db.prepare(
    "SELECT * FROM mfa_pending WHERE token = ? AND expires_at > datetime('now')"
  ).get(mfaToken);
  if (!pending) return res.status(401).json({ error: 'MFA session expired' });

  if (pending.attempts >= 5) {
    db.prepare('DELETE FROM mfa_pending WHERE token = ?').run(mfaToken);
    return res.status(429).json({ error: 'Too many attempts' });
  }

  db.prepare('UPDATE mfa_pending SET attempts = attempts + 1 WHERE token = ?').run(mfaToken);

  const challenge = db.prepare(
    "SELECT challenge FROM webauthn_challenges WHERE user_id = ? AND expires_at > datetime('now')"
  ).get(pending.user_id);
  if (!challenge) return res.status(401).json({ error: 'Challenge expired' });

  const storedCred = db.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').get(credential.id);
  if (!storedCred || storedCred.user_id !== pending.user_id) {
    return res.status(401).json({ error: 'Unknown credential' });
  }

  try {
    const hostname = req.hostname;
    const origin = `${req.protocol}://${req.get('host')}`;

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: hostname,
      credential: {
        id: storedCred.id,
        publicKey: Buffer.from(storedCred.public_key, 'base64url'),
        counter: storedCred.counter,
        transports: storedCred.transports ? JSON.parse(storedCred.transports) : undefined,
      },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: 'Verification failed' });
    }

    // Update counter
    db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, storedCred.id);

    // Clean up
    db.prepare('DELETE FROM mfa_pending WHERE token = ?').run(mfaToken);
    db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').run(pending.user_id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pending.user_id);
    let org = null;
    if (user.org_id) {
      org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    }

    const session = createSession(user.id);
    res.cookie('session', session.id, COOKIE_OPTS);
    res.json(buildUserResponse(db, user, org));
  } catch (err) {
    res.status(401).json({ error: 'Verification failed: ' + err.message });
  }
});

// --- MFA setup endpoints (require active session) ---

// Get MFA status
router.get('/mfa/status', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT totp_enabled, mfa_backup_codes FROM users WHERE id = ?').get(req.user.id);
  const webauthnCreds = db.prepare(
    'SELECT id, name, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at'
  ).all(req.user.id);

  const backupCodes = user.mfa_backup_codes ? JSON.parse(user.mfa_backup_codes) : [];

  res.json({
    totpEnabled: !!user.totp_enabled,
    webauthnCredentials: webauthnCreds.map(c => ({ id: c.id, name: c.name, createdAt: c.created_at })),
    backupCodesRemaining: backupCodes.length,
  });
});

// TOTP setup - generate secret + QR
router.post('/mfa/totp/setup', requireAuth, async (req, res) => {
  try {
    const result = await generateTotpSecret(req.user.username);
    // Store secret temporarily (not enabled yet) - overwrite any existing
    const db = getDb();
    db.prepare("UPDATE users SET totp_secret = ?, updated_at = datetime('now') WHERE id = ?")
      .run(result.secret, req.user.id);
    res.json({ secret: result.secret, qrDataUrl: result.qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TOTP confirm - verify code and enable
router.post('/mfa/totp/confirm', requireAuth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const db = getDb();
  const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.user.id);
  if (!user.totp_secret) return res.status(400).json({ error: 'Run setup first' });

  if (!verifyTotpToken(user.totp_secret, code)) {
    return res.status(401).json({ error: 'Invalid code. Try again.' });
  }

  // Generate backup codes
  const codes = generateBackupCodes();
  const hashedCodes = codes.map(hashBackupCode);

  db.prepare("UPDATE users SET totp_enabled = 1, mfa_backup_codes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(hashedCodes), req.user.id);

  res.json({ ok: true, backupCodes: codes });
});

// TOTP disable
router.delete('/mfa/totp', requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0, updated_at = datetime('now') WHERE id = ?")
    .run(req.user.id);

  // If no WebAuthn creds remain, also clear backup codes
  const webauthnCount = db.prepare('SELECT COUNT(*) as c FROM webauthn_credentials WHERE user_id = ?')
    .get(req.user.id)?.c || 0;
  if (webauthnCount === 0) {
    db.prepare("UPDATE users SET mfa_backup_codes = NULL WHERE id = ?").run(req.user.id);
  }

  res.json({ ok: true });
});

// WebAuthn register - generate options
router.post('/mfa/webauthn/register-options', requireAuth, async (req, res) => {
  const db = getDb();
  const existingCreds = db.prepare('SELECT id FROM webauthn_credentials WHERE user_id = ?')
    .all(req.user.id);

  try {
    const hostname = req.hostname;
    const options = await generateRegistrationOptions({
      rpName: 'IntelMap',
      rpID: hostname,
      userName: req.user.username,
      attestationType: 'none',
      excludeCredentials: existingCreds.map(c => ({ id: c.id })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge
    db.prepare(`
      INSERT INTO webauthn_challenges (user_id, challenge, expires_at)
      VALUES (?, ?, datetime('now', '+5 minutes'))
      ON CONFLICT(user_id) DO UPDATE SET challenge = excluded.challenge, expires_at = excluded.expires_at
    `).run(req.user.id, options.challenge);

    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebAuthn register - verify and store
router.post('/mfa/webauthn/register', requireAuth, async (req, res) => {
  const { credential, name } = req.body;
  if (!credential) return res.status(400).json({ error: 'Credential required' });

  const db = getDb();
  const challenge = db.prepare(
    "SELECT challenge FROM webauthn_challenges WHERE user_id = ? AND expires_at > datetime('now')"
  ).get(req.user.id);
  if (!challenge) return res.status(401).json({ error: 'Challenge expired' });

  try {
    const hostname = req.hostname;
    const origin = `${req.protocol}://${req.get('host')}`;

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: hostname,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    const { credential: regCred } = verification.registrationInfo;

    db.prepare(`
      INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      regCred.id,
      req.user.id,
      Buffer.from(regCred.publicKey).toString('base64url'),
      regCred.counter,
      credential.response?.transports ? JSON.stringify(credential.response.transports) : null,
      name || 'Security Key',
    );

    // Clean up challenge
    db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').run(req.user.id);

    // If user has no backup codes yet (first MFA method), generate them
    const user = db.prepare('SELECT mfa_backup_codes FROM users WHERE id = ?').get(req.user.id);
    let backupCodes = null;
    if (!user.mfa_backup_codes || JSON.parse(user.mfa_backup_codes).length === 0) {
      const codes = generateBackupCodes();
      const hashedCodes = codes.map(hashBackupCode);
      db.prepare("UPDATE users SET mfa_backup_codes = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(hashedCodes), req.user.id);
      backupCodes = codes;
    }

    res.json({ ok: true, backupCodes });
  } catch (err) {
    res.status(400).json({ error: 'Registration failed: ' + err.message });
  }
});

// WebAuthn remove credential
router.delete('/mfa/webauthn/:credentialId', requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const result = db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
    .run(req.params.credentialId, req.user.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Credential not found' });

  // If no MFA methods remain, clear backup codes
  const totpEnabled = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id)?.totp_enabled;
  const webauthnCount = db.prepare('SELECT COUNT(*) as c FROM webauthn_credentials WHERE user_id = ?')
    .get(req.user.id)?.c || 0;
  if (!totpEnabled && webauthnCount === 0) {
    db.prepare("UPDATE users SET mfa_backup_codes = NULL WHERE id = ?").run(req.user.id);
  }

  res.json({ ok: true });
});

// Regenerate backup codes
router.post('/mfa/backup-codes/regenerate', requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const codes = generateBackupCodes();
  const hashedCodes = codes.map(hashBackupCode);
  db.prepare("UPDATE users SET mfa_backup_codes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(hashedCodes), req.user.id);

  res.json({ backupCodes: codes });
});

router.post('/dismiss-password-change', requireAuth, (req, res) => {
  const db = getDb();
  // Lock the account and destroy all sessions
  db.prepare("UPDATE users SET locked = 1, updated_at = datetime('now') WHERE id = ?").run(req.user.id);
  deleteUserSessions(req.user.id);
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true, locked: true });
});

export default router;
