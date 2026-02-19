import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { sanitizeProjectName } from '../auth/sanitize.js';
import { requireAuth } from '../auth/middleware.js';
import { getProjectRole } from '../auth/project-access.js';
import { projectStore } from '../store/index.js';

const router = Router();
router.use(requireAuth);

// List own + group-shared projects (metadata + counts, no tactical data)
router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user.id;

  const projects = db.prepare(`
    SELECT DISTINCT
      p.id, p.name, p.user_id, p.settings, p.created_at, p.updated_at,
      u.username as owner_username,
      (SELECT COUNT(*) FROM project_markers WHERE project_id = p.id) as marker_count,
      (SELECT COUNT(*) FROM project_drawings WHERE project_id = p.id) as drawing_count,
      (SELECT COUNT(*) FROM project_layers WHERE project_id = p.id) as layer_count
    FROM projects_v2 p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN project_shares ps ON ps.project_id = p.id
    LEFT JOIN group_members gm ON gm.group_id = ps.group_id AND gm.user_id = ?
    WHERE p.user_id = ?
       OR gm.user_id IS NOT NULL
       OR ? = 'admin'
    ORDER BY p.updated_at DESC
  `).all(userId, userId, req.user.role);

  // Fetch shared groups for each project
  const getShares = db.prepare(`
    SELECT ps.group_id, g.name as group_name
    FROM project_shares ps
    JOIN groups g ON ps.group_id = g.id
    WHERE ps.project_id = ?
  `);

  res.json(projects.map(p => {
    const shares = getShares.all(p.id);
    return {
      id: p.id,
      name: p.name,
      ownerId: p.user_id,
      ownerUsername: p.owner_username,
      sharedGroups: shares.map(s => ({ id: s.group_id, name: s.group_name })),
      role: getProjectRole(userId, p.id),
      markerCount: p.marker_count,
      drawingCount: p.drawing_count,
      layerCount: p.layer_count,
      settings: tryParseJson(p.settings, {}),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }));
});

// Create new empty project
router.post('/', (req, res) => {
  const name = sanitizeProjectName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Project name required (1-100 chars)' });

  const db = getDb();
  const id = crypto.randomUUID();
  const settings = JSON.stringify(req.body.settings || {});
  db.prepare('INSERT INTO projects_v2 (id, user_id, name, settings) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, name, settings);

  // Optionally share with a group on creation
  const groupId = req.body.groupId || null;
  if (groupId) {
    const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
    if (group) {
      db.prepare('INSERT OR IGNORE INTO project_shares (project_id, group_id) VALUES (?, ?)').run(id, groupId);
    }
  }

  res.status(201).json({
    id, name, ownerId: req.user.id, ownerUsername: req.user.username,
    sharedGroups: [], role: 'admin',
    markerCount: 0, drawingCount: 0, layerCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
});

// Get project with full tactical data
router.get('/:id', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (!role) return res.status(404).json({ error: 'Project not found' });

  const db = getDb();
  const project = db.prepare('SELECT * FROM projects_v2 WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const state = projectStore.getProjectState(req.params.id);

  res.json({
    id: project.id,
    name: project.name,
    ownerId: project.user_id,
    settings: tryParseJson(project.settings, {}),
    role,
    ...state,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  });
});

// Update project name/settings
router.put('/:id', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const db = getDb();
  const updates = [];
  const values = [];

  if (req.body.name !== undefined) {
    const name = sanitizeProjectName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Invalid project name' });
    updates.push('name = ?');
    values.push(name);
  }

  if (req.body.settings !== undefined) {
    updates.push('settings = ?');
    values.push(JSON.stringify(req.body.settings));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE projects_v2 SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

// Delete project (owner or group admin)
router.delete('/:id', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const db = getDb();
  const result = db.prepare('DELETE FROM projects_v2 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });
  res.json({ ok: true });
});

// Share project with a group (additive — can share with multiple groups)
router.put('/:id/share', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId required' });

  const db = getDb();
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  db.prepare('INSERT OR IGNORE INTO project_shares (project_id, group_id) VALUES (?, ?)').run(req.params.id, groupId);
  db.prepare("UPDATE projects_v2 SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Unshare project from a specific group
router.delete('/:id/share/:groupId', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const db = getDb();
  db.prepare('DELETE FROM project_shares WHERE project_id = ? AND group_id = ?').run(req.params.id, req.params.groupId);
  db.prepare("UPDATE projects_v2 SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Unshare project from all groups (make private)
router.delete('/:id/share', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const db = getDb();
  db.prepare('DELETE FROM project_shares WHERE project_id = ?').run(req.params.id);
  db.prepare("UPDATE projects_v2 SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

function tryParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

export default router;
