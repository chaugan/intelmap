import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getDb } from '../db/index.js';

const router = Router();
router.use(requireAuth);

const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://127.0.0.1:8080';

function requireSignalEnabled(req, res) {
  const db = getDb();
  if (req.user.orgId) {
    const org = db.prepare('SELECT feature_signal FROM organizations WHERE id = ?').get(req.user.orgId);
    if (!org?.feature_signal) {
      res.status(403).json({ error: 'Signal not enabled for your organization' });
      return false;
    }
  }
  const user = db.prepare('SELECT signal_enabled FROM users WHERE id = ?').get(req.user.id);
  if (!user?.signal_enabled) {
    res.status(403).json({ error: 'Signal not enabled for your account' });
    return false;
  }
  return true;
}

/**
 * GET /api/signal/status — Check if user has a linked Signal device
 */
router.get('/status', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT signal_enabled, signal_phone, signal_linked_at FROM users WHERE id = ?')
    .get(req.user.id);

  res.json({
    enabled: !!user?.signal_enabled,
    linked: !!user?.signal_phone,
    phone: user?.signal_phone || null,
    linkedAt: user?.signal_linked_at || null,
  });
});

/**
 * POST /api/signal/link — Start device linking (returns QR code)
 */
router.post('/link', async (req, res) => {
  if (!requireSignalEnabled(req, res)) return;

  try {
    const deviceName = `intelmap-${req.user.id.slice(0, 8)}`;
    const response = await fetch(
      `${SIGNAL_API}/v1/qrcodelink?device_name=${encodeURIComponent(deviceName)}`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error('[Signal] QR link failed:', response.status, text);
      return res.status(502).json({ error: 'Failed to start Signal linking' });
    }

    // The response is a PNG image
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('image')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString('base64');
      return res.json({ qrCode: `data:image/png;base64,${base64}` });
    }

    // JSON response (some versions return JSON with URI)
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    console.error('[Signal] Link error:', err.message);
    return res.status(502).json({ error: 'Signal service unavailable' });
  }
});

/**
 * POST /api/signal/confirm-link — Confirm linking with phone number
 */
router.post('/confirm-link', (req, res) => {
  if (!requireSignalEnabled(req, res)) return;

  const { phone } = req.body;
  if (!phone || !/^\+\d{8,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number format (e.g. +4712345678)' });
  }

  const db = getDb();
  db.prepare(
    "UPDATE users SET signal_phone = ?, signal_linked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(phone, req.user.id);

  res.json({ ok: true, phone });
});

/**
 * GET /api/signal/accounts — List registered accounts on the Signal service
 */
router.get('/accounts', async (req, res) => {
  if (!requireSignalEnabled(req, res)) return;

  try {
    const response = await fetch(`${SIGNAL_API}/v1/accounts`);
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to list Signal accounts' });
    }
    const accounts = await response.json();
    res.json(accounts);
  } catch (err) {
    console.error('[Signal] Accounts error:', err.message);
    res.status(502).json({ error: 'Signal service unavailable' });
  }
});

/**
 * GET /api/signal/groups — List Signal groups for the user's linked phone
 */
router.get('/groups', async (req, res) => {
  if (!requireSignalEnabled(req, res)) return;

  const db = getDb();
  const user = db.prepare('SELECT signal_phone FROM users WHERE id = ?').get(req.user.id);
  if (!user?.signal_phone) {
    return res.status(400).json({ error: 'No linked Signal account' });
  }

  try {
    const response = await fetch(
      `${SIGNAL_API}/v1/groups/${encodeURIComponent(user.signal_phone)}`
    );
    if (!response.ok) {
      const text = await response.text();
      console.error('[Signal] Groups failed:', response.status, text);
      return res.status(502).json({ error: 'Failed to list Signal groups' });
    }
    const groups = await response.json();
    // Map to simpler format
    const result = (Array.isArray(groups) ? groups : []).map(g => ({
      id: g.id || g.internal_id,
      name: g.name || 'Unnamed Group',
      membersCount: g.members?.length || 0,
    }));
    res.json(result);
  } catch (err) {
    console.error('[Signal] Groups error:', err.message);
    res.status(502).json({ error: 'Signal service unavailable' });
  }
});

/**
 * POST /api/signal/send — Send photo to a Signal group
 */
router.post('/send', async (req, res) => {
  if (!requireSignalEnabled(req, res)) return;

  const { groupId, image, caption, filename } = req.body;
  if (!groupId || !image) {
    return res.status(400).json({ error: 'groupId and image are required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT signal_phone FROM users WHERE id = ?').get(req.user.id);
  if (!user?.signal_phone) {
    return res.status(400).json({ error: 'No linked Signal account' });
  }

  try {
    // Strip data URI prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const payload = {
      number: user.signal_phone,
      recipients: [groupId],
      message: caption || '',
      base64_attachments: [`data:image/png;filename=${filename || 'image.png'};base64,${base64Data}`],
    };

    const response = await fetch(`${SIGNAL_API}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[Signal] Send failed:', response.status, text);
      return res.status(502).json({ error: 'Failed to send Signal message' });
    }

    const result = await response.json();
    res.json({ ok: true, timestamp: result.timestamp });
  } catch (err) {
    console.error('[Signal] Send error:', err.message);
    res.status(502).json({ error: 'Signal service unavailable' });
  }
});

/**
 * DELETE /api/signal/unlink — Unlink Signal device
 */
router.delete('/unlink', (req, res) => {
  if (!requireSignalEnabled(req, res)) return;

  const db = getDb();
  db.prepare(
    "UPDATE users SET signal_phone = NULL, signal_linked_at = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(req.user.id);

  res.json({ ok: true });
});

export default router;
