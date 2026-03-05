import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';

const router = Router();

// Get user's group IDs
function getUserGroupIds(db, userId) {
  return db.prepare('SELECT group_id FROM group_members WHERE user_id = ?')
    .all(userId)
    .map((r) => r.group_id);
}

// Get the highest role a user has in any group the theme is shared with
function getUserRoleInThemeGroups(db, themeId, userId) {
  const result = db.prepare(`
    SELECT gm.role FROM theme_shares ts
    JOIN group_members gm ON ts.group_id = gm.group_id
    WHERE ts.theme_id = ? AND gm.user_id = ?
    ORDER BY CASE gm.role WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END
    LIMIT 1
  `).get(themeId, userId);
  return result?.role || null;
}

// List themes visible to current user:
// - Anonymous: only public themes
// - Logged in: own + shared + public themes
router.get('/', optionalAuth, (req, res) => {
  const db = getDb();
  const userId = req.user?.id;
  const isAdmin = req.user?.role === 'admin';

  let themes;
  if (!userId) {
    // Anonymous user - only public themes
    themes = db.prepare(
      `SELECT t.*, u.username as created_by_name
       FROM map_themes t
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.is_public = 1
       ORDER BY t.name`
    ).all();
  } else if (isAdmin) {
    // Admin sees all themes in their org
    themes = db.prepare(
      `SELECT t.*, u.username as created_by_name
       FROM map_themes t
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.org_id = ?
       ORDER BY t.name`
    ).all(req.user.orgId);
  } else {
    const userGroupIds = getUserGroupIds(db, userId);
    if (userGroupIds.length === 0) {
      // User not in any groups - own themes + public themes (within org)
      themes = db.prepare(
        `SELECT t.*, u.username as created_by_name
         FROM map_themes t
         LEFT JOIN users u ON t.created_by = u.id
         WHERE t.org_id = ? AND (t.created_by = ? OR t.is_public = 1)
         ORDER BY t.name`
      ).all(req.user.orgId, userId);
    } else {
      // User's own themes + themes shared with their groups + public themes (within org)
      const placeholders = userGroupIds.map(() => '?').join(',');
      themes = db.prepare(
        `SELECT DISTINCT t.*, u.username as created_by_name
         FROM map_themes t
         LEFT JOIN users u ON t.created_by = u.id
         LEFT JOIN theme_shares ts ON t.id = ts.theme_id
         WHERE t.org_id = ? AND (t.created_by = ? OR ts.group_id IN (${placeholders}) OR t.is_public = 1)
         ORDER BY t.name`
      ).all(req.user.orgId, userId, ...userGroupIds);
    }
  }

  // Attach shared groups and user's group role to each theme
  const getSharedGroups = db.prepare(
    `SELECT g.id, g.name FROM theme_shares ts
     JOIN groups g ON ts.group_id = g.id
     WHERE ts.theme_id = ?`
  );

  for (const theme of themes) {
    theme.sharedGroups = getSharedGroups.all(theme.id);
    theme.isOwner = userId ? theme.created_by === userId : false;
    theme.isPublic = !!theme.is_public;
    // Include user's role in theme's shared groups (for delete permission)
    if (userId) {
      theme.userGroupRole = getUserRoleInThemeGroups(db, theme.id, userId);
    }
    // Parse state from JSON string
    if (typeof theme.state === 'string') {
      try { theme.state = JSON.parse(theme.state); } catch { /* keep as string */ }
    }
  }

  res.json(themes);
});

// Check access to a theme (for deep linking)
router.get('/:id/access', optionalAuth, (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);

  if (!theme) {
    return res.json({ canAccess: false, error: 'notFound' });
  }

  const userId = req.user?.id;
  const isAdmin = req.user?.role === 'admin';
  const isOwner = userId && theme.created_by === userId;
  const isPublic = !!theme.is_public;

  // Check if user is in a shared group
  let inSharedGroup = false;
  if (userId && !isOwner && !isAdmin && !isPublic) {
    const userGroupIds = getUserGroupIds(db, userId);
    if (userGroupIds.length > 0) {
      const placeholders = userGroupIds.map(() => '?').join(',');
      const share = db.prepare(
        `SELECT 1 FROM theme_shares WHERE theme_id = ? AND group_id IN (${placeholders}) LIMIT 1`
      ).get(req.params.id, ...userGroupIds);
      inSharedGroup = !!share;
    }
  }

  const canAccess = isPublic || isOwner || isAdmin || inSharedGroup;

  if (!canAccess) {
    return res.json({ canAccess: false, error: 'permissionDenied' });
  }

  // Parse state
  if (typeof theme.state === 'string') {
    try { theme.state = JSON.parse(theme.state); } catch { /* keep as string */ }
  }

  res.json({ canAccess: true, theme: { id: theme.id, name: theme.name, state: theme.state } });
});

// Create theme (any authenticated user)
router.post('/', requireAuth, (req, res) => {
  const name = req.body.name?.trim();
  const state = req.body.state;
  if (!name || name.length > 100) return res.status(400).json({ error: 'Theme name required (1-100 chars)' });
  if (!state) return res.status(400).json({ error: 'Theme state required' });

  const stateJson = typeof state === 'string' ? state : JSON.stringify(state);
  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare('INSERT INTO map_themes (id, name, state, created_by, org_id) VALUES (?, ?, ?, ?, ?)').run(id, name, stateJson, req.user.id, req.user.orgId);
  res.status(201).json({ id, name, state: stateJson, created_by: req.user.id, isOwner: true, isPublic: false, sharedGroups: [] });
});

// Update theme (owner, admin, or editor in shared group)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  // Check permissions: owner, admin, or editor/admin in shared group
  const isOwner = theme.created_by === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const groupRole = getUserRoleInThemeGroups(db, req.params.id, req.user.id);
  const canEdit = isOwner || isAdmin || groupRole === 'editor' || groupRole === 'admin';

  if (!canEdit) {
    return res.status(403).json({ error: 'Not authorized to edit this theme' });
  }

  const name = req.body.name?.trim() || theme.name;
  const state = req.body.state || JSON.parse(theme.state);
  const stateJson = typeof state === 'string' ? state : JSON.stringify(state);

  db.prepare("UPDATE map_themes SET name = ?, state = ?, updated_at = datetime('now') WHERE id = ?").run(name, stateJson, req.params.id);
  res.json({ id: req.params.id, name, state: stateJson });
});

// Toggle public sharing (owner or admin only)
router.post('/:id/public', requireAuth, (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  // Check ownership
  if (theme.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to change public status' });
  }

  const isPublic = req.body.isPublic ? 1 : 0;
  db.prepare("UPDATE map_themes SET is_public = ?, updated_at = datetime('now') WHERE id = ?").run(isPublic, req.params.id);
  res.json({ ok: true, isPublic: !!isPublic });
});

// Share theme with a group (owner or admin only)
router.post('/:id/share', requireAuth, (req, res) => {
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
router.delete('/:id/share/:groupId', requireAuth, (req, res) => {
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

// Delete theme (owner, admin, or editor in shared group)
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM map_themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  // Check permissions: owner, admin, or editor/admin in shared group
  const isOwner = theme.created_by === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const groupRole = getUserRoleInThemeGroups(db, req.params.id, req.user.id);
  const canDelete = isOwner || isAdmin || groupRole === 'editor' || groupRole === 'admin';

  if (!canDelete) {
    return res.status(403).json({ error: 'Not authorized to delete this theme' });
  }

  db.prepare('DELETE FROM map_themes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
