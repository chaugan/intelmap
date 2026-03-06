import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/index.js';
import { hashPassword } from '../auth/passwords.js';
import { sanitizeUsername, validatePassword } from '../auth/sanitize.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { requireAdmin } from '../auth/middleware.js';
import { disconnectUser } from '../socket/index.js';
import { eventLogger } from '../lib/event-logger.js';
import { monitorService } from '../monitoring/monitor-service.js';
import { vlmClient } from '../monitoring/vlm-client.js';
import config, { getNtfyUrl, getNtfyToken, getAdminNtfyChannel, getAdminNtfyLevels } from '../config.js';
import crypto from 'crypto';

const router = Router();
router.use(requireAdmin);

// Helper: get org setting with fallback to app_settings
function getOrgSetting(db, orgId, key) {
  if (orgId) {
    const row = db.prepare('SELECT value FROM org_settings WHERE org_id = ? AND key = ?').get(orgId, key);
    if (row) return row.value;
  }
  const fallback = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return fallback?.value || null;
}

// Helper: set org setting
function setOrgSetting(db, orgId, key, value) {
  if (orgId) {
    db.prepare(`
      INSERT INTO org_settings (org_id, key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(orgId, key, value);
  } else {
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  }
}

// Helper: delete org setting
function deleteOrgSetting(db, orgId, key) {
  if (orgId) {
    db.prepare('DELETE FROM org_settings WHERE org_id = ? AND key = ?').run(orgId, key);
  } else {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }
}

// List all users (no hashes) with storage stats — filtered by org
router.get('/users', (req, res) => {
  const db = getDb();
  const orgId = req.user.orgId;
  const users = db.prepare(
    'SELECT id, username, role, must_change_password, locked, ai_chat_enabled, timelapse_enabled, wasos_enabled, infraview_enabled, created_at, updated_at FROM users WHERE org_id = ? ORDER BY created_at'
  ).all(orgId);

  // Calculate storage for each user
  const result = users.map(u => {
    // Get detection storage stats
    const detectionStats = monitorService.getUserStorageStats(u.id);

    // Get timelapse storage: frames from subscribed cameras + exports
    let timelapseBytes = 0;

    // Get user's active timelapse subscriptions
    const subs = db.prepare(`
      SELECT camera_id FROM timelapse_subscriptions
      WHERE user_id = ? AND is_active = 1
    `).all(u.id);

    // Sum frames storage for each subscribed camera
    for (const sub of subs) {
      const framesDir = path.join(config.dataDir, 'timelapse', sub.camera_id, 'frames');
      if (fs.existsSync(framesDir)) {
        try {
          const files = fs.readdirSync(framesDir);
          for (const file of files) {
            if (!file.endsWith('.jpg')) continue;
            const filePath = path.join(framesDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.isFile()) {
                timelapseBytes += stat.size;
              }
            } catch {}
          }
        } catch {}
      }
    }

    // Also add exports storage
    const exportsDir = path.join(config.dataDir, 'exports', u.id);
    if (fs.existsSync(exportsDir)) {
      try {
        const files = fs.readdirSync(exportsDir);
        for (const file of files) {
          const filePath = path.join(exportsDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              timelapseBytes += stat.size;
            }
          } catch {}
        }
      } catch {}
    }

    return {
      ...u,
      mustChangePassword: !!u.must_change_password,
      locked: !!u.locked,
      aiChatEnabled: !!u.ai_chat_enabled,
      timelapseEnabled: !!u.timelapse_enabled,
      wasosEnabled: !!u.wasos_enabled,
      infraviewEnabled: !!u.infraview_enabled,
      timelapseBytes,
      detectionBytes: detectionStats.detectionBytes,
      detectionCount: detectionStats.detectionCount,
    };
  });

  res.json(result);
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
  const orgId = req.user.orgId;
  db.prepare(
    `INSERT INTO users (id, username, password_hash, salt, role, org_id, must_change_password, ai_chat_enabled)
     VALUES (?, ?, ?, ?, 'user', ?, 1, 0)`
  ).run(id, username, hash, salt, orgId);

  // Auto-add new user to all existing groups in the org as viewer
  const groups = db.prepare('SELECT id FROM groups WHERE org_id = ?').all(orgId);
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'viewer', datetime('now'))`
  );
  for (const g of groups) {
    insertMember.run(g.id, id);
  }

  // Create default "Standard" project for new user
  const projectId = crypto.randomUUID();
  db.prepare('INSERT INTO projects_v2 (id, user_id, name, settings, org_id) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, id, 'Standard', '{}', orgId);

  res.status(201).json({ id, username, role: 'user', mustChangePassword: true, locked: false, aiChatEnabled: false });
});

// Delete user
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ? AND org_id = ?').run(req.params.id, req.user.orgId);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  disconnectUser(req.params.id);
  res.json({ ok: true });
});

// Reset password
router.post('/users/:id/reset-password', (req, res) => {
  const password = req.body.password;
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 6-128 characters' });

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.user.orgId);
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
  const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.user.orgId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newRole = user.role === 'admin' ? 'user' : 'admin';
  db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(newRole, req.params.id);
  res.json({ ok: true, role: newRole });
});

// Unlock account
router.post('/users/:id/unlock', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.user.orgId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare("UPDATE users SET locked = 0, must_change_password = 1, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  deleteUserSessions(req.params.id);
  disconnectUser(req.params.id);
  res.json({ ok: true });
});

// Toggle AI chat access
router.post('/users/:id/toggle-ai-chat', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, ai_chat_enabled FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.user.orgId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVal = user.ai_chat_enabled ? 0 : 1;
  db.prepare("UPDATE users SET ai_chat_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  res.json({ ok: true, aiChatEnabled: !!newVal });
});

// Toggle timelapse access
router.post('/users/:id/toggle-timelapse', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, timelapse_enabled FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.user.orgId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVal = user.timelapse_enabled ? 0 : 1;
  db.prepare("UPDATE users SET timelapse_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  res.json({ ok: true, timelapseEnabled: !!newVal });
});

// Toggle WaSOS access
router.post('/users/:id/toggle-wasos', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, wasos_enabled FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.user.orgId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVal = user.wasos_enabled ? 0 : 1;
  // If disabling, also clear credentials and session
  if (newVal === 0) {
    db.prepare("UPDATE users SET wasos_enabled = 0, wasos_credentials = NULL, wasos_session = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
  } else {
    db.prepare("UPDATE users SET wasos_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  }
  res.json({ ok: true, wasosEnabled: !!newVal });
});

// Toggle InfraView access
router.post('/users/:id/toggle-infraview', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, infraview_enabled FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.user.orgId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVal = user.infraview_enabled ? 0 : 1;
  db.prepare("UPDATE users SET infraview_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  res.json({ ok: true, infraviewEnabled: !!newVal });
});

// --- AI Configuration ---

// Get AI config (model + whether key is set)
router.get('/ai-config', (req, res) => {
  const db = getDb();
  const hasKey = !!getOrgSetting(db, req.user.orgId, 'anthropic_api_key');
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
  setOrgSetting(db, req.user.orgId, 'anthropic_api_key', apiKey.trim());
  res.json({ ok: true });
});

// Remove AI API key
router.delete('/ai-config', (req, res) => {
  const db = getDb();
  deleteOrgSetting(db, req.user.orgId, 'anthropic_api_key');
  res.json({ ok: true });
});

// --- Export Configuration (security markings) ---

const VALID_MARKINGS = ['none', 'internt', 'tjenstlig'];
const VALID_CORNERS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-right'];

router.get('/export-config', (req, res) => {
  const db = getDb();
  res.json({
    marking: getOrgSetting(db, req.user.orgId, 'export_marking') || 'none',
    corner: getOrgSetting(db, req.user.orgId, 'export_marking_corner') || 'top-center',
  });
});

router.put('/export-config', (req, res) => {
  const { marking, corner } = req.body;
  if (marking && !VALID_MARKINGS.includes(marking)) {
    return res.status(400).json({ error: 'Invalid marking value' });
  }
  if (corner && !VALID_CORNERS.includes(corner)) {
    return res.status(400).json({ error: 'Invalid corner value' });
  }
  const db = getDb();
  if (marking === 'none') {
    deleteOrgSetting(db, req.user.orgId, 'export_marking');
    deleteOrgSetting(db, req.user.orgId, 'export_marking_corner');
  } else {
    if (marking) setOrgSetting(db, req.user.orgId, 'export_marking', marking);
    if (corner) setOrgSetting(db, req.user.orgId, 'export_marking_corner', corner);
  }
  res.json({ ok: true });
});

router.delete('/export-config', (req, res) => {
  const db = getDb();
  deleteOrgSetting(db, req.user.orgId, 'export_marking');
  deleteOrgSetting(db, req.user.orgId, 'export_marking_corner');
  res.json({ ok: true });
});

// --- Maps Configuration ---

// Get Maps config (whether Google Maps API key is set)
router.get('/maps-config', (req, res) => {
  const db = getDb();
  const hasKey = !!getOrgSetting(db, req.user.orgId, 'google_maps_api_key');
  res.json({ hasKey });
});

// Set Google Maps API key
router.put('/maps-config', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid API key' });
  }

  const db = getDb();
  setOrgSetting(db, req.user.orgId, 'google_maps_api_key', apiKey.trim());
  res.json({ ok: true });
});

// Remove Google Maps API key
router.delete('/maps-config', (req, res) => {
  const db = getDb();
  deleteOrgSetting(db, req.user.orgId, 'google_maps_api_key');
  res.json({ ok: true });
});

// --- AIS Configuration ---

// Get AIS config (whether BarentsWatch credentials are set)
router.get('/ais-config', (req, res) => {
  const db = getDb();
  const hasClientId = !!getOrgSetting(db, req.user.orgId, 'barentswatch_client_id');
  const hasClientSecret = !!getOrgSetting(db, req.user.orgId, 'barentswatch_client_secret');
  res.json({ hasClientId, hasClientSecret });
});

// Set BarentsWatch credentials
router.put('/ais-config', (req, res) => {
  const { clientId, clientSecret } = req.body;

  const db = getDb();
  if (clientId && typeof clientId === 'string' && clientId.trim().length >= 1) {
    setOrgSetting(db, req.user.orgId, 'barentswatch_client_id', clientId.trim());
  }
  if (clientSecret && typeof clientSecret === 'string' && clientSecret.trim().length >= 1) {
    setOrgSetting(db, req.user.orgId, 'barentswatch_client_secret', clientSecret.trim());
  }

  res.json({ ok: true });
});

// Remove BarentsWatch credentials
router.delete('/ais-config', (req, res) => {
  const db = getDb();
  deleteOrgSetting(db, req.user.orgId, 'barentswatch_client_id');
  deleteOrgSetting(db, req.user.orgId, 'barentswatch_client_secret');
  res.json({ ok: true });
});

// --- ntfy Configuration ---

// Get ntfy config (whether token is set)
router.get('/ntfy-config', (req, res) => {
  const db = getDb();
  const hasToken = !!getOrgSetting(db, req.user.orgId, 'ntfy_token');
  const url = getOrgSetting(db, req.user.orgId, 'ntfy_url') || '';
  res.json({ hasToken, url });
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
    setOrgSetting(db, req.user.orgId, 'ntfy_url', ntfyUrl);

    if (ntfyToken) {
      setOrgSetting(db, req.user.orgId, 'ntfy_token', ntfyToken);
    } else {
      deleteOrgSetting(db, req.user.orgId, 'ntfy_token');
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
  deleteOrgSetting(db, req.user.orgId, 'ntfy_token');
  deleteOrgSetting(db, req.user.orgId, 'ntfy_url');
  res.json({ ok: true });
});

// --- VLM Configuration ---

// Get VLM config (whether token is set + URL)
router.get('/vlm-config', (req, res) => {
  const db = getDb();
  const hasToken = !!getOrgSetting(db, req.user.orgId, 'vlm_api_token');
  const url = getOrgSetting(db, req.user.orgId, 'vlm_url') || 'https://vision.homeprem.no';
  res.json({ hasToken, url });
});

// Validate and set VLM credentials
router.put('/vlm-config', async (req, res) => {
  const { token, url } = req.body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!token || typeof token !== 'string' || token.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid API token' });
  }

  const vlmUrl = url.trim().replace(/\/$/, ''); // Remove trailing slash
  const vlmToken = token.trim();

  // Test connection by calling the API status endpoint (no auth required)
  // Then verify the token is valid format (we trust it since we can't test without an image)
  const testUrl = `${vlmUrl}/api/v1/status`;

  try {
    const response = await fetch(testUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      return res.status(400).json({
        error: `Failed to connect to VLM API: ${response.status} ${response.statusText}`
      });
    }

    const statusData = await response.json();
    if (statusData.vllm_status !== 'online') {
      return res.status(400).json({
        error: 'VLM server is offline. Please check the server status.'
      });
    }

    // Connection successful, save settings
    const db = getDb();
    setOrgSetting(db, req.user.orgId, 'vlm_url', vlmUrl);
    setOrgSetting(db, req.user.orgId, 'vlm_api_token', vlmToken);

    res.json({ ok: true, message: 'VLM API configured successfully' });

  } catch (err) {
    return res.status(400).json({
      error: `Failed to connect to VLM API: ${err.message}`
    });
  }
});

// Get VLM service status (live data from API)
router.get('/vlm-status', async (req, res) => {
  const db = getDb();
  const vlmUrl = getOrgSetting(db, req.user.orgId, 'vlm_url');
  const vlmToken = getOrgSetting(db, req.user.orgId, 'vlm_api_token');

  if (!vlmUrl || !vlmToken) {
    return res.status(400).json({ error: 'VLM not configured' });
  }

  try {
    // Status endpoint doesn't require auth
    const response = await fetch(`${vlmUrl}/api/v1/status`, {
      method: 'GET',
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch VLM status', offline: true });
    }

    const data = await response.json();
    res.json({
      vllmStatus: data.vllm_status || 'unknown',
      model: data.model || null,
      uptimeSeconds: data.uptime_seconds || 0,
      requestsServed: data.requests_served || 0,
      totalTokensGenerated: data.total_tokens_generated || 0,
      cachedJobs: data.cached_jobs || 0,
      gpu: data.gpu ? {
        name: data.gpu.gpu_name,
        utilization: data.gpu.gpu_utilization_percent,
        memoryUsedMb: data.gpu.memory_used_mb,
        memoryTotalMb: data.gpu.memory_total_mb,
        memoryPercent: data.gpu.memory_percent,
        temperatureC: data.gpu.temperature_c,
      } : null,
      error: data.error || null,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message, offline: true });
  }
});

// Remove VLM credentials
router.delete('/vlm-config', (req, res) => {
  const db = getDb();
  deleteOrgSetting(db, req.user.orgId, 'vlm_api_token');
  deleteOrgSetting(db, req.user.orgId, 'vlm_url');
  eventLogger.config.info('VLM credentials removed');
  res.json({ ok: true });
});

// Get VLM prompt template
router.get('/vlm-prompt', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'vlm_prompt'").get();
  res.json({
    prompt: row?.value || null,
    defaultPrompt: vlmClient.getDefaultPrompt(),
    isCustom: !!row?.value,
  });
});

// Set VLM prompt template
router.put('/vlm-prompt', (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 20) {
    return res.status(400).json({ error: 'Prompt must be at least 20 characters' });
  }

  if (!prompt.includes('${labelList}')) {
    return res.status(400).json({ error: 'Prompt must contain ${labelList} placeholder' });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('vlm_prompt', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(prompt.trim());

  eventLogger.config.info('VLM prompt template updated');
  res.json({ ok: true });
});

// Reset VLM prompt to default
router.delete('/vlm-prompt', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key = 'vlm_prompt'").run();
  eventLogger.config.info('VLM prompt reset to default');
  res.json({ ok: true });
});

// --- Admin Events ---

// Get recent events — filtered by org
router.get('/events', (req, res) => {
  const db = getDb();
  const level = req.query.level; // filter by level
  const category = req.query.category; // filter by category
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);

  let query = 'SELECT * FROM admin_events WHERE org_id = ?';
  const params = [req.user.orgId];

  if (level) {
    query += ' AND level = ?';
    params.push(level);
  }
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const events = db.prepare(query).all(...params);
  res.json(events.map(e => ({
    ...e,
    details: e.details ? JSON.parse(e.details) : null,
  })));
});

// Clear events (optionally by level or category) — filtered by org
router.delete('/events', (req, res) => {
  const db = getDb();
  const level = req.query.level;
  const category = req.query.category;

  let query = 'DELETE FROM admin_events WHERE org_id = ?';
  const params = [req.user.orgId];

  if (level) {
    query += ' AND level = ?';
    params.push(level);
  }
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  const result = db.prepare(query).run(...params);
  eventLogger.config.info(`Cleared ${result.changes} events`);
  res.json({ ok: true, deleted: result.changes });
});

// Get event counts by level — filtered by org
router.get('/events/counts', (req, res) => {
  const db = getDb();
  const counts = db.prepare(`
    SELECT level, COUNT(*) as count
    FROM admin_events
    WHERE org_id = ?
    GROUP BY level
  `).all(req.user.orgId);

  const result = { error: 0, warning: 0, info: 0 };
  for (const row of counts) {
    result[row.level] = row.count;
  }
  res.json(result);
});

// --- Admin ntfy Channel Configuration ---

function generateAdminChannel() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let suffix = '';
  const randomBytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    suffix += chars[randomBytes[i] % chars.length];
  }
  return `intelmap-admin-${suffix}`;
}

// Get admin ntfy config
router.get('/admin-ntfy-config', (req, res) => {
  const channel = getAdminNtfyChannel();
  const levels = getAdminNtfyLevels();
  const ntfyUrl = getNtfyUrl();

  res.json({
    channel,
    levels,
    fullUrl: channel && ntfyUrl ? `${ntfyUrl}/${channel}` : '',
  });
});

// Set/update admin ntfy config
router.put('/admin-ntfy-config', async (req, res) => {
  const { levels } = req.body;

  // Validate levels
  const validLevels = ['error', 'warning', 'info'];
  if (!Array.isArray(levels) || !levels.every(l => validLevels.includes(l))) {
    return res.status(400).json({ error: 'Invalid levels. Must be array of error/warning/info.' });
  }

  const db = getDb();
  let channel = getAdminNtfyChannel();

  // Generate channel name if not exists
  if (!channel) {
    channel = generateAdminChannel();
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('admin_ntfy_channel', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(channel);
  }

  // Save levels
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('admin_ntfy_levels', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(JSON.stringify(levels));

  const ntfyUrl = getNtfyUrl();
  eventLogger.config.info('Admin ntfy channel configured', { channel, levels });

  res.json({
    ok: true,
    channel,
    levels,
    fullUrl: ntfyUrl ? `${ntfyUrl}/${channel}` : '',
  });
});

// Remove admin ntfy config
router.delete('/admin-ntfy-config', (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key IN ('admin_ntfy_channel', 'admin_ntfy_levels')").run();
  eventLogger.config.info('Admin ntfy channel removed');
  res.json({ ok: true });
});

// Test admin ntfy notification
router.post('/admin-ntfy-config/test', async (req, res) => {
  const channel = getAdminNtfyChannel();
  const ntfyUrl = getNtfyUrl();
  const ntfyToken = getNtfyToken();

  if (!channel || !ntfyUrl) {
    return res.status(400).json({ error: 'Admin ntfy channel not configured' });
  }

  try {
    const headers = {
      'Title': 'IntelMap Test Notification',
      'Tags': 'white_check_mark',
      'Priority': 'default',
    };
    if (ntfyToken) headers['Authorization'] = `Bearer ${ntfyToken}`;

    const response = await fetch(`${ntfyUrl}/${channel}`, {
      method: 'POST',
      headers,
      body: 'This is a test notification from IntelMap admin panel.',
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Failed to send: ${response.status} ${response.statusText}` });
    }

    res.json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

export default router;
