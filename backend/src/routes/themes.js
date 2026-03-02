import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth);

// Get user's group IDs
function getUserGroupIds(db, userId) {
  return db.prepare('SELECT group_id FROM group_members WHERE user_id = ?')
    .all(userId)
    .map((r) => r.group_id);
}

// List themes visible to current user:
// - Themes created by the user
// - Themes shared with groups the user belongs to
router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user.id;
  const userGroupIds = getUserGroupIds(db, userId);

  let themes;
  if (req.user.role === 'admin') {
    // Admin sees all themes
    themes = db.prepare(
      `SELECT t.*, u.username as created_by_name
       FROM map_themes t
       LEFT JOIN users u ON t.created_by = u.id
       ORDER BY t.name`
    ).all();
  } else if (userGroupIds.length === 0) {
    // User not in any groups - only own themes
    themes = db.prepare(
      `SELECT t.*, u.username as created_by_name
       FROM map_themes t
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.created_by = ?
       ORDER BY t.name`
    ).all(userId);
  } else {
    // User's own themes + themes shared with their groups
    const placeholders = userGroupIds.map(() => '?').join(',');
    themes = db.prepare(
      `SELECT DISTINCT t.*, u.username as created_by_name
       FROM map_themes t
       LEFT JOIN users u ON t.created_by = u.id
       LEFT JOIN theme_shares ts ON t.id = ts.theme_id
       WHERE t.created_by = ? OR ts.group_id IN (${placeholders})
       ORDER BY t.name`
    ).all(userId, ...userGroupIds);
  }

  // Attach shared groups to each theme
  const getSharedGroups = db.prepare(
    `SELECT g.id, g.name FROM theme_shares ts
     JOIN groups g ON ts.group_id = g.id
     WHERE ts.theme_id = ?`
  );

  for (const theme of themes) {
    theme.sharedGroups = getSharedGroups.all(theme.id);
    theme.isOwner = theme.created_by === userId;
    // Parse state from JSON string
    if (typeof theme.state === 'string') {
      try { theme.state = JSON.parse(theme.state); } catch { /* keep as string */ }
    }
  }

  res.json(themes);
});

// Create theme (any authenticated user)
router.post('/', (req, res) => {
  const name = req.body.name?.trim();
  const state = req.body.state;
  if (!name || name.length > 100) return res.status(400).json({ error: 'Theme name required (1-100 chars)' });
  if (!state) return res.status(400).json({ error: 'Theme state required' });

  const stateJson = typeof state === 'string' ? state : JSON.stringify(state);
  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare('INSERT INTO map_themes (id, name, state, created_by) VALUES (?, ?, ?, ?)').run(id, name, stateJson, req.user.id);
  res.status(201).json({ id, name, state: stateJson, created_by: req.user.id, isOwner: true, sharedGroups: [] });
});

// Update theme (owner or admin only)
router.put('/:id', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  // Check ownership
  if (theme.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to edit this theme' });
  }

  const name = req.body.name?.trim() || theme.name;
  const state = req.body.state || JSON.parse(theme.state);
  const stateJson = typeof state === 'string' ? state : JSON.stringify(state);

  db.prepare("UPDATE map_themes SET name = ?, state = ?, updated_at = datetime('now') WHERE id = ?").run(name, stateJson, req.params.id);
  res.json({ id: req.params.id, name, state: stateJson });
});

// Share theme with a group (owner or admin only)
router.post('/:id/share', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  // Check ownership
  if (theme.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to share this theme' });
  }

  const groupId = req.body.groupId;
  if (!groupId) return res.status(400).json({ error: 'groupId required' });

  // Verify user is member of the group (or admin)
  if (req.user.role !== 'admin') {
    const membership = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'You are not a member of this group' });
  }

  db.prepare('INSERT OR IGNORE INTO theme_shares (theme_id, group_id) VALUES (?, ?)').run(req.params.id, groupId);
  res.json({ ok: true });
});

// Unshare theme from a group (owner or admin only)
router.delete('/:id/share/:groupId', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  // Check ownership
  if (theme.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to unshare this theme' });
  }

  db.prepare('DELETE FROM theme_shares WHERE theme_id = ? AND group_id = ?').run(req.params.id, req.params.groupId);
  res.json({ ok: true });
});

// Delete theme (owner or admin only)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  // Check ownership
  if (theme.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to delete this theme' });
  }

  db.prepare('DELETE FROM map_themes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
