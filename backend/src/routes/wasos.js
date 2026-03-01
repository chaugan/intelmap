import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getDb } from '../db/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { wasosLogin, wasosRefresh, isSessionValid, canRefresh } from '../lib/wasos.js';

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
      loggedIn = isSessionValid(session) || canRefresh(session);
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

    // Store session tokens
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
 * Get valid access token for API calls
 * Automatically refreshes if expired
 */
router.get('/token', async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT wasos_enabled, wasos_credentials, wasos_session FROM users WHERE id = ?')
    .get(req.user.id);

  if (!user?.wasos_enabled) {
    return res.status(403).json({ error: 'WaSOS not enabled' });
  }

  if (!user.wasos_session) {
    return res.status(401).json({ error: 'Not logged in to WaSOS' });
  }

  let session;
  try {
    session = JSON.parse(user.wasos_session);
  } catch {
    return res.status(401).json({ error: 'Invalid session data' });
  }

  // Check if token is still valid
  if (isSessionValid(session)) {
    return res.json({ access_token: session.access_token, expires_at: session.expires_at });
  }

  // Try to refresh
  if (canRefresh(session)) {
    try {
      const newSession = await wasosRefresh(session.refresh_token);
      db.prepare(`
        UPDATE users
        SET wasos_session = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(newSession), req.user.id);

      return res.json({ access_token: newSession.access_token, expires_at: newSession.expires_at });
    } catch (err) {
      console.error('WaSOS token refresh failed:', err.message);
      // Refresh failed, try re-login with stored credentials
    }
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

      return res.json({ access_token: newSession.access_token, expires_at: newSession.expires_at });
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
