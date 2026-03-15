import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { eventLogger } from '../lib/event-logger.js';
import config from '../config.js';

const router = Router();
const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://127.0.0.1:8080';

function generateToken(userId, createdAt) {
  const userIdB64 = Buffer.from(userId).toString('base64url');
  const hmac = crypto.createHmac('sha256', config.sessionSecret)
    .update('signal-emergency:' + userId + ':' + (createdAt || ''))
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
  if (!user.signal_enabled || !user.signal_phone) return null;

  // Check org has feature_signal enabled
  if (!user.org_id) return null;
  const org = db.prepare('SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL').get(user.org_id);
  if (!org || !org.feature_signal) return null;

  // Verify HMAC
  const expectedHmac = crypto.createHmac('sha256', config.sessionSecret)
    .update('signal-emergency:' + userId + ':' + (user.created_at || ''))
    .digest('hex')
    .slice(0, 32);

  const a = Buffer.from(hmacFragment, 'hex');
  const b = Buffer.from(expectedHmac, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return { user, org };
}

// GET /token — authenticated, returns URL
router.get('/token', requireAuth, (req, res) => {
  if (req.user.isImpersonating) return res.status(403).json({ error: 'Cannot use while impersonating' });
  if (req.user.role === 'super_admin') return res.status(403).json({ error: 'Super-admins cannot use this' });

  const db = getDb();
  if (!req.user.orgId) return res.status(403).json({ error: 'No organization' });

  const org = db.prepare('SELECT feature_signal FROM organizations WHERE id = ?').get(req.user.orgId);
  if (!org || !org.feature_signal) {
    return res.status(403).json({ error: 'Signal not enabled for your organization' });
  }

  const user = db.prepare('SELECT signal_enabled, signal_phone, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user?.signal_enabled || !user?.signal_phone) {
    return res.status(403).json({ error: 'Signal not linked' });
  }

  const token = generateToken(req.user.id, user.created_at);
  res.json({ url: '/api/signal-emergency/' + token });
});

// GET /manifest.json — PWA manifest
router.get('/manifest.json', (req, res) => {
  const token = req.query.token;
  const startUrl = token ? `/api/signal-emergency/${token}` : '/api/signal-emergency/offline';
  res.json({
    name: 'Signal Leave',
    short_name: 'SigLeave',
    start_url: startUrl,
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#f59e0b',
    icons: [
      { src: '/api/self-destruct/touch-icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/api/self-destruct/touch-icon.png', sizes: '192x192', type: 'image/png' },
    ],
  });
});

// GET /sw.js — minimal service worker
router.get('/sw.js', (req, res) => {
  res.type('application/javascript').send(`// Minimal service worker for PWA installability - pass through all requests`);
});

// GET /offline — fallback
router.get('/offline', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signal Emergency Leave</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; text-align: center; }
    h1 { font-size: 1.5rem; color: #f59e0b; margin-bottom: 1rem; }
    p { color: #94a3b8; max-width: 350px; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Signal Emergency Leave</h1>
  <p>This link has expired. Open IntelMap and tap "Signal Emergency Leave!" to get a new link.</p>
</body>
</html>`);
});

// GET /:token — serve standalone HTML page
router.get('/:token', async (req, res) => {
  const result = validateToken(req.params.token);
  if (!result) return res.status(403).send('Invalid or expired link.');

  const { user } = result;
  const confirmUrl = `/api/signal-emergency/${req.params.token}/confirm`;
  const fromIntelMap = req.query.ref === 'intelmap';

  // Fetch groups from Signal
  let groups = [];
  try {
    const response = await fetch(
      `${SIGNAL_API}/v1/groups/${encodeURIComponent(user.signal_phone)}`
    );
    if (response.ok) {
      const raw = await response.json();
      groups = (Array.isArray(raw) ? raw : []).map(g => ({
        id: g.id || g.internal_id,
        name: g.name || 'Unnamed Group',
        membersCount: g.members?.length || 0,
      }));
    }
  } catch {}

  // Read keep list
  let keepIds = [];
  try { keepIds = JSON.parse(user.signal_keep_groups || '[]'); } catch {}

  const keepSet = new Set(keepIds);
  const leaveGroups = groups.filter(g => !keepSet.has(g.id));
  const keepGroups = groups.filter(g => keepSet.has(g.id));

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signal Emergency Leave</title>
  <link rel="manifest" href="/api/signal-emergency/manifest.json?token=${req.params.token}">
  <link rel="apple-touch-icon" href="/api/self-destruct/touch-icon.png">
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
    .username { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .groups-section { width: 100%; max-width: 400px; margin-bottom: 1.5rem; }
    .section-header {
      font-size: 0.85rem;
      font-weight: 700;
      padding: 0.5rem 0.75rem;
      border-radius: 6px 6px 0 0;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .leave-header { background: #7f1d1d; color: #fca5a5; }
    .keep-header { background: #14532d; color: #86efac; }
    .group-list {
      border: 1px solid #334155;
      border-top: none;
      border-radius: 0 0 6px 6px;
      max-height: 200px;
      overflow-y: auto;
    }
    .group-item {
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .group-item:last-child { border-bottom: none; }
    .group-item .name { color: #e2e8f0; }
    .group-item .members { color: #64748b; font-size: 0.7rem; }
    .group-item.leave { background: #450a0a; }
    .group-item.keep { background: #052e16; }
    .empty-list { padding: 0.75rem; color: #64748b; font-size: 0.8rem; text-align: center; border: 1px solid #334155; border-top: none; border-radius: 0 0 6px 6px; }
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
    .status { font-size: 1rem; color: #94a3b8; min-height: 2rem; }
    .progress-list { width: 100%; max-width: 400px; margin-top: 1rem; }
    .progress-item {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.3rem 0; font-size: 0.8rem;
    }
    .progress-item .spinner { width: 16px; height: 16px; border: 2px solid #334155; border-top-color: #f59e0b; border-radius: 50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-item .check { color: #22c55e; font-weight: bold; }
    .progress-item .fail { color: #ef4444; font-weight: bold; }
    .done { font-size: 2rem; font-weight: bold; color: #22c55e; }
    .error { color: #ef4444; }
    .summary { text-align: center; margin-top: 1rem; font-size: 0.9rem; color: #94a3b8; }
    .install-section {
      margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #334155;
      text-align: center; max-width: 400px; width: 100%;
    }
    .install-section h2 { font-size: 0.9rem; color: #64748b; margin-bottom: 0.75rem; font-weight: 500; }
    .install-btn {
      padding: 0.6rem 1.5rem; border-radius: 8px; border: 2px solid #3b82f6;
      background: #3b82f6; color: white; font-size: 0.9rem; font-weight: 600;
      cursor: pointer; transition: all 0.15s ease;
    }
    .install-btn:hover { background: #2563eb; border-color: #2563eb; }
    .ios-guide { color: #94a3b8; font-size: 0.8rem; line-height: 1.6; text-align: left; }
    .ios-guide ol { padding-left: 1.2rem; }
    .ios-guide li { margin-bottom: 0.4rem; }
    .back-link {
      position: absolute; top: 1rem; left: 1rem;
      color: #3b82f6; text-decoration: none; font-size: 0.9rem; font-weight: 500;
      display: flex; align-items: center; gap: 0.4rem;
    }
    .back-link:hover { color: #60a5fa; }
  </style>
</head>
<body>
  ${fromIntelMap ? '<a href="/" class="back-link"><span style="font-size:1.2rem">&larr;</span> Back to IntelMap</a>' : ''}
  <h1>Signal Emergency Leave</h1>
  <div class="username">${user.username} &middot; ${user.signal_phone}</div>

  <div id="preConfirm">
    ${leaveGroups.length > 0 ? `
    <div class="groups-section">
      <div class="section-header leave-header">Leaving (${leaveGroups.length})</div>
      <div class="group-list">
        ${leaveGroups.map(g => `<div class="group-item leave"><span class="name">${escapeHtml(g.name)}</span><span class="members">${g.membersCount} members</span></div>`).join('')}
      </div>
    </div>` : ''}

    ${keepGroups.length > 0 ? `
    <div class="groups-section">
      <div class="section-header keep-header">Keeping (${keepGroups.length})</div>
      <div class="group-list">
        ${keepGroups.map(g => `<div class="group-item keep"><span class="name">${escapeHtml(g.name)}</span><span class="members">${g.membersCount} members</span></div>`).join('')}
      </div>
    </div>` : ''}

    ${leaveGroups.length === 0 ? `
    <div class="warning">No groups to leave${keepGroups.length > 0 ? ' — all groups are in your keep list' : ' — no groups found'}.</div>` : `
    <div class="warning">
      Press all 3 buttons to leave ${leaveGroups.length} group${leaveGroups.length !== 1 ? 's' : ''}.
    </div>

    <div class="buttons">
      <button class="arm-btn" data-arm="1" onclick="arm(this, 1)">ARM 1</button>
      <button class="arm-btn" data-arm="2" onclick="arm(this, 2)">ARM 2</button>
      <button class="arm-btn" data-arm="3" onclick="arm(this, 3)">ARM 3</button>
    </div>`}

    <div class="status" id="status"></div>
  </div>

  <div id="progressArea" hidden>
    <div class="progress-list" id="progressList"></div>
    <div class="summary" id="summaryText"></div>
  </div>

  <div class="install-section" id="installSection" hidden>
    <h2>Save to Home Screen</h2>
    <button class="install-btn" id="installBtn" hidden>Install App</button>
    <div class="ios-guide" id="iosGuide" hidden>
      <ol>
        <li>Tap the <strong>Share</strong> button in Safari</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
        <li>Tap <strong>Add</strong> to confirm</li>
      </ol>
    </div>
  </div>

  <script>
    const armed = new Set();
    const statusEl = document.getElementById('status');
    const leaveCount = ${leaveGroups.length};
    let done = false;

    async function arm(btn, n) {
      if (done || armed.has(n) || leaveCount === 0) return;
      armed.add(n);
      btn.classList.add('depressed');

      if (armed.size < 3) {
        statusEl.textContent = armed.size + '/3 armed';
        return;
      }

      statusEl.textContent = 'Leaving groups...';
      document.querySelectorAll('.arm-btn').forEach(b => b.style.pointerEvents = 'none');

      try {
        const res = await fetch('${confirmUrl}', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          done = true;
          document.getElementById('preConfirm').hidden = true;
          const progressArea = document.getElementById('progressArea');
          progressArea.hidden = false;
          const list = document.getElementById('progressList');

          // Show left groups
          (data.left || []).forEach(name => {
            const el = document.createElement('div');
            el.className = 'progress-item';
            el.innerHTML = '<span class="check">✓</span> <span>' + escapeHtml(name) + '</span>';
            list.appendChild(el);
          });
          // Show errors
          (data.errors || []).forEach(err => {
            const el = document.createElement('div');
            el.className = 'progress-item';
            el.innerHTML = '<span class="fail">✗</span> <span>' + escapeHtml(err) + '</span>';
            list.appendChild(el);
          });

          const summary = document.getElementById('summaryText');
          const leftCount = (data.left || []).length;
          const keptCount = (data.kept || []).length;
          const errCount = (data.errors || []).length;
          summary.innerHTML = '<div class="done">DONE</div>' +
            'Left ' + leftCount + ' group' + (leftCount !== 1 ? 's' : '') + '. ' +
            'Kept ' + keptCount + ' group' + (keptCount !== 1 ? 's' : '') + '.' +
            (errCount > 0 ? ' <span class="error">' + errCount + ' error(s).</span>' : '');
        } else {
          statusEl.className = 'status error';
          statusEl.textContent = data.error || 'Failed';
        }
      } catch (e) {
        statusEl.className = 'status error';
        statusEl.textContent = 'Network error';
      }
    }

    function escapeHtml(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    // PWA install logic
    (function() {
      const fromIntelMap = new URLSearchParams(window.location.search).get('ref') === 'intelmap';
      if (!fromIntelMap) return;

      const installSection = document.getElementById('installSection');
      const installBtn = document.getElementById('installBtn');
      const iosGuide = document.getElementById('iosGuide');

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/api/signal-emergency/sw.js', { scope: '/api/signal-emergency/' });
      }

      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      if (isStandalone) return;

      if (isIOS) {
        installSection.hidden = false;
        iosGuide.hidden = false;
      } else {
        let deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
          e.preventDefault();
          deferredPrompt = e;
          installSection.hidden = false;
          installBtn.hidden = false;
        });
        installBtn.addEventListener('click', async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          const result = await deferredPrompt.userChoice;
          deferredPrompt = null;
          installBtn.hidden = true;
          if (result.outcome === 'accepted') installSection.hidden = true;
        });
        window.addEventListener('appinstalled', () => { installSection.hidden = true; });
      }
    })();
  </script>
</body>
</html>`);
});

// POST /:token/confirm — execute group leaves
router.post('/:token/confirm', async (req, res) => {
  const result = validateToken(req.params.token);
  if (!result) return res.status(403).json({ error: 'Invalid or expired link' });

  const { user } = result;
  const phone = user.signal_phone;

  // Fetch current groups
  let groups = [];
  try {
    const response = await fetch(`${SIGNAL_API}/v1/groups/${encodeURIComponent(phone)}`);
    if (response.ok) {
      const raw = await response.json();
      groups = (Array.isArray(raw) ? raw : []).map(g => ({
        id: g.id || g.internal_id,
        name: g.name || 'Unnamed Group',
      }));
    }
  } catch {
    return res.status(502).json({ error: 'Failed to fetch Signal groups' });
  }

  // Read keep list
  let keepIds = [];
  try { keepIds = JSON.parse(user.signal_keep_groups || '[]'); } catch {}
  const keepSet = new Set(keepIds);

  const toLeave = groups.filter(g => !keepSet.has(g.id));
  const toKeep = groups.filter(g => keepSet.has(g.id));

  const left = [];
  const errors = [];

  for (const group of toLeave) {
    try {
      const quitRes = await fetch(
        `${SIGNAL_API}/v1/groups/${encodeURIComponent(phone)}/${encodeURIComponent(group.id)}/quit`,
        { method: 'POST' }
      );
      if (quitRes.ok) {
        left.push(group.name);
      } else {
        const text = await quitRes.text().catch(() => '');
        errors.push(`${group.name}: ${text || quitRes.status}`);
      }
    } catch (err) {
      errors.push(`${group.name}: ${err.message}`);
    }
    // Small delay between calls
    await new Promise(r => setTimeout(r, 100));
  }

  eventLogger.config.info(`User ${user.username} emergency-left ${left.length} Signal groups`, {
    userId: user.id,
    orgId: user.org_id,
    leftCount: left.length,
    keptCount: toKeep.length,
    errorCount: errors.length,
  });

  res.json({
    ok: true,
    left: left,
    kept: toKeep.map(g => g.name),
    errors,
  });
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default router;
