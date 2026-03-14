import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { disconnectUser } from '../socket/index.js';
import { eventLogger } from '../lib/event-logger.js';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

function generateToken(userId, salt) {
  const userIdB64 = Buffer.from(userId).toString('base64url');
  const hmac = crypto.createHmac('sha256', config.sessionSecret)
    .update('self-destruct:' + userId + ':' + (salt || ''))
    .digest('hex')
    .slice(0, 32);
  return userIdB64 + '.' + hmac;
}

function validateToken(token) {
  if (!token || !token.includes('.')) return null;
  const [userIdB64, hmacFragment] = token.split('.');
  if (!userIdB64 || !hmacFragment || hmacFragment.length !== 32) return null;

  let userId;
  try {
    userId = Buffer.from(userIdB64, 'base64url').toString();
  } catch { return null; }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || user.locked) return null;
  if (user.role === 'super_admin') return null;

  // Check org has both flags enabled
  if (!user.org_id) return null;
  const org = db.prepare('SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL').get(user.org_id);
  if (!org || !org.feature_self_delete || !org.self_delete_enabled) return null;

  // Verify HMAC
  const expectedHmac = crypto.createHmac('sha256', config.sessionSecret)
    .update('self-destruct:' + userId + ':' + (user.salt || ''))
    .digest('hex')
    .slice(0, 32);

  const a = Buffer.from(hmacFragment, 'hex');
  const b = Buffer.from(expectedHmac, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return { user, org };
}

// GET /token — authenticated, returns URL
router.get('/token', requireAuth, (req, res) => {
  if (req.user.isImpersonating) return res.status(403).json({ error: 'Cannot self-destruct while impersonating' });
  if (req.user.role === 'super_admin') return res.status(403).json({ error: 'Super-admins cannot self-destruct' });

  const db = getDb();
  if (!req.user.orgId) return res.status(403).json({ error: 'No organization' });
  const org = db.prepare('SELECT feature_self_delete, self_delete_enabled FROM organizations WHERE id = ?').get(req.user.orgId);
  if (!org || !org.feature_self_delete || !org.self_delete_enabled) {
    return res.status(403).json({ error: 'Self-delete not enabled for your organization' });
  }

  const user = db.prepare('SELECT salt FROM users WHERE id = ?').get(req.user.id);
  const token = generateToken(req.user.id, user?.salt);
  res.json({ url: '/api/self-destruct/' + token });
});

// GET /favicon.ico — serve the custom icon
router.get('/favicon.ico', (req, res) => {
  const icoPath = path.join(__dirname, '..', 'assets', 'self-destruct.ico');
  if (fs.existsSync(icoPath)) {
    res.type('image/x-icon').sendFile(icoPath);
  } else {
    res.status(404).end();
  }
});

// GET /:token — serve standalone HTML page (unauthenticated)
router.get('/:token', (req, res) => {
  const result = validateToken(req.params.token);
  if (!result) return res.status(403).send('Invalid or expired self-destruct link.');

  const { user } = result;
  const confirmUrl = `/api/self-destruct/${req.params.token}/confirm`;

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Self-Destruct</title>
  <link rel="icon" type="image/png" href="data:image/png;base64,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">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f172a;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
    }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; color: #f59e0b; }
    .username { color: #94a3b8; font-size: 0.9rem; margin-bottom: 2rem; }
    .warning {
      color: #ef4444;
      font-size: 0.85rem;
      max-width: 400px;
      text-align: center;
      margin-bottom: 2rem;
      line-height: 1.5;
    }
    .buttons { display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; justify-content: center; }
    .arm-btn {
      width: 120px;
      height: 120px;
      border-radius: 16px;
      border: 3px solid #eab308;
      background: #eab308;
      color: #0f172a;
      font-size: 1.1rem;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .arm-btn:hover:not(.depressed) { background: #facc15; border-color: #facc15; }
    .arm-btn.depressed {
      background: #a16207;
      border-color: #854d0e;
      transform: scale(0.95);
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
      cursor: default;
    }
    .status {
      font-size: 1rem;
      color: #94a3b8;
      min-height: 2rem;
    }
    .done {
      font-size: 2rem;
      font-weight: bold;
      color: #22c55e;
    }
    .error { color: #ef4444; }
  </style>
</head>
<body>
  <h1>Account Self-Destruct</h1>
  <div class="username">${user.username}</div>
  <div class="warning">
    This action is PERMANENT and IRREVERSIBLE.<br>
    Your account and all associated data will be deleted.<br>
    Press all 3 buttons to confirm.
  </div>
  <div class="buttons">
    <button class="arm-btn" data-arm="1" onclick="arm(this, 1)">ARM 1</button>
    <button class="arm-btn" data-arm="2" onclick="arm(this, 2)">ARM 2</button>
    <button class="arm-btn" data-arm="3" onclick="arm(this, 3)">ARM 3</button>
  </div>
  <div class="status" id="status"></div>
  <script>
    const armed = new Set();
    const statusEl = document.getElementById('status');
    let done = false;

    async function arm(btn, n) {
      if (done || armed.has(n)) return;
      armed.add(n);
      btn.classList.add('depressed');

      if (armed.size < 3) {
        statusEl.textContent = armed.size + '/3 armed';
        return;
      }

      statusEl.textContent = 'Confirming...';
      document.querySelectorAll('.arm-btn').forEach(b => b.style.pointerEvents = 'none');

      try {
        const res = await fetch('${confirmUrl}', { method: 'POST' });
        if (res.ok) {
          done = true;
          statusEl.className = 'status done';
          statusEl.textContent = 'DONE!';
          document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        } else {
          const data = await res.json().catch(() => ({}));
          statusEl.className = 'status error';
          statusEl.textContent = data.error || 'Failed';
        }
      } catch (e) {
        statusEl.className = 'status error';
        statusEl.textContent = 'Network error';
      }
    }
  </script>
</body>
</html>`);
});

// POST /:token/confirm — execute self-destruct (unauthenticated)
router.post('/:token/confirm', (req, res) => {
  const result = validateToken(req.params.token);
  if (!result) return res.status(403).json({ error: 'Invalid or expired self-destruct link' });

  const { user } = result;
  const db = getDb();

  // Immediately lock user and clear sessions
  db.prepare("UPDATE users SET locked = 1, updated_at = datetime('now') WHERE id = ?").run(user.id);
  deleteUserSessions(user.id);
  disconnectUser(user.id);

  eventLogger.config.info(`User ${user.username} self-destructed their account`, {
    userId: user.id,
    orgId: user.org_id,
  });

  // Hard-delete after 30 seconds
  setTimeout(() => {
    try {
      const db2 = getDb();
      // Clean up related data
      db2.prepare('DELETE FROM webauthn_credentials WHERE user_id = ?').run(user.id);
      db2.prepare('DELETE FROM timelapse_subscriptions WHERE user_id = ?').run(user.id);
      db2.prepare('DELETE FROM monitor_subscriptions WHERE user_id = ?').run(user.id);
      db2.prepare('DELETE FROM group_members WHERE user_id = ?').run(user.id);
      db2.prepare('DELETE FROM mfa_pending WHERE user_id = ?').run(user.id);
      db2.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').run(user.id);
      db2.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db2.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      console.log(`Self-destruct complete: user ${user.username} (${user.id}) deleted`);
    } catch (err) {
      console.error(`Self-destruct cleanup failed for ${user.id}:`, err.message);
    }
  }, 30000);

  res.json({ ok: true });
});

export default router;
