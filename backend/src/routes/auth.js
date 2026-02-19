import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { sanitizeUsername, validatePassword } from '../auth/sanitize.js';
import { createSession, deleteSession, deleteUserSessions } from '../auth/sessions.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';

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

  if (!verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  clearRateLimit(ip);
  const session = createSession(user.id);
  res.cookie('session', session.id, COOKIE_OPTS);
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: !!user.must_change_password,
    aiChatEnabled: !!user.ai_chat_enabled,
  });
});

router.post('/logout', requireAuth, (req, res) => {
  deleteSession(req.user.sessionId);
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) return res.json(null);
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    mustChangePassword: req.user.mustChangePassword,
    aiChatEnabled: req.user.aiChatEnabled,
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

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: false,
    aiChatEnabled: !!user.ai_chat_enabled,
  });
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
