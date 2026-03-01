import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getDb } from '../db/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { wasosLogin, isSessionValid } from '../lib/wasos.js';

const router = Router();
router.use(requireAuth);

/**
 * Get WaSOS status for current user
 * Returns whether WaSOS is enabled and login status
 */
router.get('/status', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT wasos_enabled, wasos_credentials, wasos_session FROM users WHERE id = ?')
    .get(req.user.id);

  const enabled = !!user?.wasos_enabled;
  const hasCredentials = !!user?.wasos_credentials;

  let loggedIn = false;
  if (user?.wasos_session) {
    try {
      const session = JSON.parse(user.wasos_session);
      loggedIn = isSessionValid(session);
    } catch {}
  }

  res.json({ enabled, hasCredentials, loggedIn });
});

/**
 * Save WaSOS credentials and perform initial login
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const db = getDb();

  // Check if user has WaSOS enabled
  const user = db.prepare('SELECT wasos_enabled FROM users WHERE id = ?').get(req.user.id);
  if (!user?.wasos_enabled) {
    return res.status(403).json({ error: 'WaSOS not enabled for this user' });
  }

  try {
    // Attempt login to WaSOS
    const session = await wasosLogin(username, password);

    // Encrypt and store credentials for auto-login
    const credentials = encrypt(JSON.stringify({ username, password }));

    // Store session (cookies + expiry)
    db.prepare(`
      UPDATE users
      SET wasos_credentials = ?, wasos_session = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(credentials, JSON.stringify(session), req.user.id);

    res.json({ ok: true, loggedIn: true });
  } catch (err) {
    console.error('WaSOS login failed:', err.message);
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

/**
 * Logout from WaSOS - clear session and optionally credentials
 */
router.delete('/logout', (req, res) => {
  const { clearCredentials } = req.query;
  const db = getDb();

  if (clearCredentials === 'true') {
    // Clear both session and stored credentials
    db.prepare(`
      UPDATE users
      SET wasos_credentials = NULL, wasos_session = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id);
  } else {
    // Only clear session, keep credentials for re-login
    db.prepare(`
      UPDATE users
      SET wasos_session = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id);
  }

  res.json({ ok: true });
});

/**
 * Get valid session cookies for API calls
 * Automatically re-logins if session expired
 */
router.get('/session', async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT wasos_enabled, wasos_credentials, wasos_session FROM users WHERE id = ?')
    .get(req.user.id);

  if (!user?.wasos_enabled) {
    return res.status(403).json({ error: 'WaSOS not enabled' });
  }

  if (!user.wasos_session && !user.wasos_credentials) {
    return res.status(401).json({ error: 'Not logged in to WaSOS' });
  }

  let session;
  try {
    session = user.wasos_session ? JSON.parse(user.wasos_session) : null;
  } catch {
    session = null;
  }

  // Check if session is still valid
  if (session && isSessionValid(session)) {
    return res.json({ cookies: session.cookies, expires_at: session.expires_at });
  }

  // Try auto-login with stored credentials
  if (user.wasos_credentials) {
    try {
      const creds = JSON.parse(decrypt(user.wasos_credentials));
      const newSession = await wasosLogin(creds.username, creds.password);

      db.prepare(`
        UPDATE users
        SET wasos_session = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(newSession), req.user.id);

      return res.json({ cookies: newSession.cookies, expires_at: newSession.expires_at });
    } catch (err) {
      console.error('WaSOS auto-login failed:', err.message);
      // Clear invalid session
      db.prepare("UPDATE users SET wasos_session = NULL WHERE id = ?").run(req.user.id);
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
  }

  return res.status(401).json({ error: 'Session expired, please log in again' });
});

export default router;
