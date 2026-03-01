import { Router } from 'express';
import crypto from 'node:crypto';
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
 * Get username from stored credentials
 */
function getUsername(user) {
  if (!user?.wasos_credentials) return 'unknown';
  try {
    const creds = JSON.parse(decrypt(user.wasos_credentials));
    return creds.username || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Upload media to WaSOS
 * Expects: text, coordinates ([lon, lat]), image (base64), filename
 */
router.post('/upload', async (req, res) => {
  const { text, coordinates, image, filename } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'Image required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT wasos_enabled, wasos_credentials, wasos_session FROM users WHERE id = ?')
    .get(req.user.id);

  if (!user?.wasos_enabled) {
    return res.status(403).json({ error: 'WaSOS not enabled' });
  }

  // Get valid session (auto-refresh if needed)
  let session;
  try {
    session = user.wasos_session ? JSON.parse(user.wasos_session) : null;
  } catch {
    session = null;
  }

  if (!session || !isSessionValid(session)) {
    // Try auto-login
    if (user.wasos_credentials) {
      try {
        const creds = JSON.parse(decrypt(user.wasos_credentials));
        session = await wasosLogin(creds.username, creds.password);
        db.prepare(`
          UPDATE users SET wasos_session = ?, updated_at = datetime('now') WHERE id = ?
        `).run(JSON.stringify(session), req.user.id);
      } catch (err) {
        console.error('WaSOS auto-login failed:', err.message);
        return res.status(401).json({ error: 'Session expired, please log in again' });
      }
    } else {
      return res.status(401).json({ error: 'Not logged in to WaSOS' });
    }
  }

  try {
    const username = getUsername(user);
    const taskuuid = crypto.randomUUID();
    const description = text || 'Transfer from IntelMap';
    const coords = coordinates || [9.686164855957031, 59.670897004902216];

    const metadata = {
      taskuuid,
      username,
      usertext: description,
      geolocation: {
        type: 'Point',
        coordinates: coords,
      },
      mediaextra: {
        callsign: '',
      },
    };

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const fname = filename || 'upload.png';

    // Build multipart body exactly like the browser does
    const boundary = '----WebKitFormBoundary' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const metadataJson = JSON.stringify(metadata);

    // Construct body parts
    const parts = [];

    // Metadata part - plain text, no Content-Type header
    parts.push(`--${boundary}\r\n`);
    parts.push(`Content-Disposition: form-data; name="metadata"\r\n\r\n`);
    parts.push(metadataJson);
    parts.push('\r\n');

    // File part
    parts.push(`--${boundary}\r\n`);
    parts.push(`Content-Disposition: form-data; name="files"; filename="${fname}"\r\n`);
    parts.push(`Content-Type: image/png\r\n\r\n`);

    // End boundary
    const endBoundary = `\r\n--${boundary}--\r\n`;

    // Combine: text parts + image buffer + end
    const textParts = parts.join('');
    const textBuffer = Buffer.from(textParts, 'utf8');
    const body = Buffer.concat([textBuffer, imageBuffer, Buffer.from(endBoundary, 'utf8')]);

    console.log('WaSOS upload attempt:', { username, taskuuid, filename: fname, imageSize: imageBuffer.length, boundary });
    console.log('WaSOS body preview (first 500 chars):', textParts.slice(0, 500));
    console.log('WaSOS metadata JSON:', metadataJson);

    // POST to WaSOS
    const uploadRes = await fetch('https://wasos.no/wasosdb/media', {
      method: 'POST',
      headers: {
        'Cookie': session.cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Accept': '*/*',
      },
      body,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('WaSOS upload failed:', uploadRes.status, errText);
      return res.status(uploadRes.status).json({ error: `Upload failed: ${errText}` });
    }

    const result = await uploadRes.json();
    res.json({ ok: true, result });
  } catch (err) {
    console.error('WaSOS upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
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
