import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth);

// List groups the current user belongs to
router.get('/', (req, res) => {
  const db = getDb();
  let groups;
  if (req.user.role === 'admin') {
    // Admin sees all groups
    groups = db.prepare(
      `SELECT g.*, u.username as created_by_name,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
       FROM groups g
       LEFT JOIN users u ON g.created_by = u.id
       ORDER BY g.name`
    ).all();
  } else {
    groups = db.prepare(
      `SELECT g.*, u.username as created_by_name, gm.role as my_role,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       LEFT JOIN users u ON g.created_by = u.id
       WHERE gm.user_id = ?
       ORDER BY g.name`
    ).all(req.user.id);
  }
  res.json(groups);
});

// Get group details with members
router.get('/:id', (req, res) => {
  const db = getDb();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Check membership (or admin)
  if (req.user.role !== 'admin') {
    const membership = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Not a member of this group' });
  }

  const members = db.prepare(
    `SELECT gm.user_id, gm.role, gm.created_at, u.username
     FROM group_members gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = ?
     ORDER BY u.username`
  ).all(req.params.id);

  res.json({ ...group, members });
});

// Create group (site admin only)
router.post('/', requireAdmin, (req, res) => {
  const name = req.body.name?.trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'Group name required (1-100 chars)' });

  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO groups (id, name, created_by) VALUES (?, ?, ?)').run(id, name, req.user.id);
  res.status(201).json({ id, name, created_by: req.user.id, member_count: 0 });
});

// Update group name (site admin only)
router.put('/:id', requireAdmin, (req, res) => {
  const name = req.body.name?.trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'Group name required (1-100 chars)' });

  const db = getDb();
  const result = db.prepare("UPDATE groups SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

// Delete group (site admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

// Add member to group (site admin only)
router.post('/:id/members', requireAdmin, (req, res) => {
  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const db = getDb();
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(req.params.id, userId, role);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.message.includes('UNIQUE') || err.message.includes('PRIMARY')) {
      return res.status(409).json({ error: 'User already in group' });
    }
    throw err;
  }
});

// Update member role (site admin only)
router.put('/:id/members/:uid', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const db = getDb();
  const result = db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(role, req.params.id, req.params.uid);
  if (result.changes === 0) return res.status(404).json({ error: 'Member not found' });
  res.json({ ok: true });
});

// Remove member from group (site admin only)
router.delete('/:id/members/:uid', requireAdmin, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.params.id, req.params.uid);
  if (result.changes === 0) return res.status(404).json({ error: 'Member not found' });
  res.json({ ok: true });
});

export default router;
