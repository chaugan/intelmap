import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth);

// List all themes (any authenticated user)
router.get('/', (req, res) => {
  const db = getDb();
  const themes = db.prepare(
    `SELECT t.*, u.username as created_by_name
     FROM map_themes t
     LEFT JOIN users u ON t.created_by = u.id
     ORDER BY t.name`
  ).all();
  res.json(themes);
});

// Create or upsert theme (admin only)
router.post('/', requireAdmin, (req, res) => {
  const name = req.body.name?.trim();
  const state = req.body.state;
  if (!name || name.length > 100) return res.status(400).json({ error: 'Theme name required (1-100 chars)' });
  if (!state) return res.status(400).json({ error: 'Theme state required' });

  const stateJson = typeof state === 'string' ? state : JSON.stringify(state);
  const db = getDb();

  // Upsert by name
  const existing = db.prepare('SELECT id FROM map_themes WHERE name = ?').get(name);
  if (existing) {
    db.prepare("UPDATE map_themes SET state = ?, updated_at = datetime('now') WHERE id = ?").run(stateJson, existing.id);
    res.json({ id: existing.id, name, state: stateJson });
  } else {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO map_themes (id, name, state, created_by) VALUES (?, ?, ?, ?)').run(id, name, stateJson, req.user.id);
    res.status(201).json({ id, name, state: stateJson });
  }
});

// Delete theme (admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM map_themes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Theme not found' });
  res.json({ ok: true });
});

export default router;
