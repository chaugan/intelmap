import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hashPassword } from '../auth/passwords.js';
import { sanitizeUsername, validatePassword } from '../auth/sanitize.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { requireAdmin } from '../auth/middleware.js';
import { disconnectUser } from '../socket/index.js';
import config from '../config.js';

const router = Router();
router.use(requireAdmin);

// List all users (no hashes)
router.get('/users', (req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, username, role, must_change_password, locked, ai_chat_enabled, timelapse_enabled, created_at, updated_at FROM users ORDER BY created_at'
  ).all();
  res.json(users.map(u => ({
    ...u,
    mustChangePassword: !!u.must_change_password,
    locked: !!u.locked,
    aiChatEnabled: !!u.ai_chat_enabled,
    timelapseEnabled: !!u.timelapse_enabled,
  })));
});

// Create user
router.post('/users', (req, res) => {
  const username = sanitizeUsername(req.body.username);
  if (!username) return res.status(400).json({ error: 'Invalid username (2-32 chars, alphanumeric/underscore/hyphen)' });

  const password = req.body.password;
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 6-128 characters' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const { hash, salt } = hashPassword(password);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, salt, role, must_change_password, ai_chat_enabled)
     VALUES (?, ?, ?, ?, 'user', 1, 0)`
  ).run(id, username, hash, salt);

  // Auto-add new user to all existing groups as viewer
  const groups = db.prepare('SELECT id FROM groups').all();
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'viewer', datetime('now'))`
  );
  for (const g of groups) {
    insertMember.run(g.id, id);
  }

  res.status(201).json({ id, username, role: 'user', mustChangePassword: true, locked: false, aiChatEnabled: false });
});

// Delete user
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  disconnectUser(req.params.id);
  res.json({ ok: true });
});

// Reset password
router.post('/users/:id/reset-password', (req, res) => {
  const password = req.body.password;
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 6-128 characters' });

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { hash, salt } = hashPassword(password);
  db.prepare("UPDATE users SET password_hash = ?, salt = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?")
    .run(hash, salt, req.params.id);
  deleteUserSessions(req.params.id);
  disconnectUser(req.params.id);
  res.json({ ok: true });
});

// Toggle admin role
router.post('/users/:id/toggle-admin', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot change your own role' });

  const db = getDb();
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newRole = user.role === 'admin' ? 'user' : 'admin';
  db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(newRole, req.params.id);
  res.json({ ok: true, role: newRole });
});

// Unlock account
router.post('/users/:id/unlock', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare("UPDATE users SET locked = 0, must_change_password = 1, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  deleteUserSessions(req.params.id);
  disconnectUser(req.params.id);
  res.json({ ok: true });
});

// Toggle AI chat access
router.post('/users/:id/toggle-ai-chat', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, ai_chat_enabled FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVal = user.ai_chat_enabled ? 0 : 1;
  db.prepare("UPDATE users SET ai_chat_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  res.json({ ok: true, aiChatEnabled: !!newVal });
});

// Toggle timelapse access
router.post('/users/:id/toggle-timelapse', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, timelapse_enabled FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVal = user.timelapse_enabled ? 0 : 1;
  db.prepare("UPDATE users SET timelapse_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  res.json({ ok: true, timelapseEnabled: !!newVal });
});

// --- AI Configuration ---

// Get AI config (model + whether key is set)
router.get('/ai-config', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'").get();
  const hasKey = !!(row?.value);
  res.json({
    model: config.claudeModel,
    hasKey,
  });
});

// Set AI API key
router.put('/ai-config', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid API key' });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('anthropic_api_key', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(apiKey.trim());

  res.json({ ok: true });
});

// Remove AI API key
router.delete('/ai-config', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key = 'anthropic_api_key'").run();
  res.json({ ok: true });
});

// --- Maps Configuration ---

// Get Maps config (whether Google Maps API key is set)
router.get('/maps-config', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'google_maps_api_key'").get();
  res.json({ hasKey: !!(row?.value) });
});

// Set Google Maps API key
router.put('/maps-config', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid API key' });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('google_maps_api_key', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(apiKey.trim());

  res.json({ ok: true });
});

// Remove Google Maps API key
router.delete('/maps-config', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key = 'google_maps_api_key'").run();
  res.json({ ok: true });
});

// --- AIS Configuration ---

// Get AIS config (whether BarentsWatch credentials are set)
router.get('/ais-config', (req, res) => {
  const db = getDb();
  const idRow = db.prepare("SELECT value FROM app_settings WHERE key = 'barentswatch_client_id'").get();
  const secretRow = db.prepare("SELECT value FROM app_settings WHERE key = 'barentswatch_client_secret'").get();
  res.json({
    hasClientId: !!(idRow?.value),
    hasClientSecret: !!(secretRow?.value),
  });
});

// Set BarentsWatch credentials
router.put('/ais-config', (req, res) => {
  const { clientId, clientSecret } = req.body;

  const db = getDb();
  if (clientId && typeof clientId === 'string' && clientId.trim().length >= 1) {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('barentswatch_client_id', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(clientId.trim());
  }
  if (clientSecret && typeof clientSecret === 'string' && clientSecret.trim().length >= 1) {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('barentswatch_client_secret', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(clientSecret.trim());
  }

  res.json({ ok: true });
});

// Remove BarentsWatch credentials
router.delete('/ais-config', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key IN ('barentswatch_client_id', 'barentswatch_client_secret')").run();
  res.json({ ok: true });
});

// --- ntfy Configuration ---

// Get ntfy config (whether token is set)
router.get('/ntfy-config', (req, res) => {
  const db = getDb();
  const tokenRow = db.prepare("SELECT value FROM app_settings WHERE key = 'ntfy_token'").get();
  const urlRow = db.prepare("SELECT value FROM app_settings WHERE key = 'ntfy_url'").get();
  res.json({
    hasToken: !!(tokenRow?.value),
    url: urlRow?.value || '',
  });
});

// Validate and set ntfy credentials
router.put('/ntfy-config', async (req, res) => {
  const { token, url } = req.body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const ntfyUrl = url.trim().replace(/\/$/, ''); // Remove trailing slash
  const ntfyToken = token?.trim() || '';

  // Test connection by publishing to a test topic
  const testTopic = `_intelmap_config_test_${Date.now()}`;
  const testUrl = `${ntfyUrl}/${testTopic}`;

  try {
    const headers = { 'Content-Type': 'text/plain' };
    if (ntfyToken) {
      headers['Authorization'] = `Bearer ${ntfyToken}`;
    }

    const response = await fetch(testUrl, {
      method: 'POST',
      headers,
      body: 'IntelMap configuration test',
    });

    if (response.status === 401 || response.status === 403) {
      if (!ntfyToken) {
        return res.status(400).json({
          error: 'This ntfy server requires authentication. Please provide a token.',
          requiresAuth: true
        });
      } else {
        return res.status(400).json({
          error: 'Invalid token. The server rejected the provided token.',
          invalidToken: true
        });
      }
    }

    if (!response.ok) {
      return res.status(400).json({
        error: `Failed to connect to ntfy server: ${response.status} ${response.statusText}`
      });
    }

    // Connection successful, save settings
    const db = getDb();
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('ntfy_url', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(ntfyUrl);

    if (ntfyToken) {
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('ntfy_token', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).run(ntfyToken);
    } else {
      // Remove any existing token if not provided
      db.prepare("DELETE FROM app_settings WHERE key = 'ntfy_token'").run();
    }

    res.json({
      ok: true,
      message: ntfyToken ? 'Connected with authentication' : 'Connected (no authentication required)'
    });

  } catch (err) {
    return res.status(400).json({
      error: `Failed to connect to ntfy server: ${err.message}`
    });
  }
});

// Remove ntfy credentials
router.delete('/ntfy-config', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key IN ('ntfy_token', 'ntfy_url')").run();
  res.json({ ok: true });
});

// --- YOLO Configuration ---

// Get YOLO config (whether token is set + project ID)
router.get('/yolo-config', (req, res) => {
  const db = getDb();
  const tokenRow = db.prepare("SELECT value FROM app_settings WHERE key = 'yolo_api_token'").get();
  const projectRow = db.prepare("SELECT value FROM app_settings WHERE key = 'yolo_project_id'").get();
  res.json({
    hasToken: !!(tokenRow?.value),
    projectId: projectRow?.value || 'fac23eeac522',
  });
});

// Validate and set YOLO credentials
router.put('/yolo-config', async (req, res) => {
  const { token, projectId } = req.body;

  if (!token || typeof token !== 'string' || token.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid API token' });
  }

  const yoloToken = token.trim();
  const yoloProjectId = (projectId?.trim() || 'fac23eeac522');

  // Test connection by calling the API
  const testUrl = 'https://yolo.intelmap.no/api/v1/health';

  try {
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${yoloToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      return res.status(400).json({
        error: 'Invalid API token. The server rejected the provided token.',
        invalidToken: true
      });
    }

    if (!response.ok) {
      return res.status(400).json({
        error: `Failed to connect to YOLO API: ${response.status} ${response.statusText}`
      });
    }

    // Connection successful, save settings
    const db = getDb();
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('yolo_api_token', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(yoloToken);

    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('yolo_project_id', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(yoloProjectId);

    res.json({ ok: true, message: 'YOLO API configured successfully' });

  } catch (err) {
    return res.status(400).json({
      error: `Failed to connect to YOLO API: ${err.message}`
    });
  }
});

// Remove YOLO credentials
router.delete('/yolo-config', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key IN ('yolo_api_token', 'yolo_project_id')").run();
  res.json({ ok: true });
});

export default router;
