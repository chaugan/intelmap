import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { sanitizeProjectName } from '../auth/sanitize.js';
import { requireAuth } from '../auth/middleware.js';
import { getProjectRole } from '../auth/project-access.js';
import { projectStore } from '../store/index.js';

const router = Router();

// Public route: shared-view via token (no auth required) - must be before requireAuth
router.get('/:id/shared-view', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM share_tokens WHERE token = ? AND resource_type = 'project' AND resource_id = ?`
  ).get(token, req.params.id);

  if (!row) return res.status(403).json({ error: 'Invalid or expired token' });
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Token expired' });
  }

  const project = db.prepare('SELECT * FROM projects_v2 WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const state = projectStore.getProjectState(req.params.id);
  let settings = {};
  try { settings = JSON.parse(project.settings); } catch { /* fallback */ }

  res.json({
    id: project.id,
    name: project.name,
    settings,
    readOnly: true,
    ...state,
  });
});

router.use(requireAuth);

// List own + group-shared projects (metadata + counts, no tactical data)
router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user.id;

  const projects = db.prepare(`
    SELECT DISTINCT
      p.id, p.name, p.user_id, p.settings, p.org_shared, p.created_at, p.updated_at,
      u.username as owner_username,
      (SELECT COUNT(*) FROM project_markers WHERE project_id = p.id) as marker_count,
      (SELECT COUNT(*) FROM project_drawings WHERE project_id = p.id) as drawing_count,
      (SELECT COUNT(*) FROM project_layers WHERE project_id = p.id) as layer_count
    FROM projects_v2 p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN project_shares ps ON ps.project_id = p.id
    LEFT JOIN group_members gm ON gm.group_id = ps.group_id AND gm.user_id = ?
    WHERE p.org_id = ?
      AND (p.user_id = ?
           OR gm.user_id IS NOT NULL
           OR p.org_shared IS NOT NULL)
    ORDER BY p.updated_at DESC
  `).all(userId, req.user.orgId, userId);

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
      orgShared: p.org_shared || null,
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
  db.prepare('INSERT INTO projects_v2 (id, user_id, name, settings, org_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, name, settings, req.user.orgId);

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

  const ALLOWED_FIELDS = ['name = ?', 'settings = ?', "updated_at = datetime('now')"];
  if (!updates.every(u => ALLOWED_FIELDS.includes(u))) {
    return res.status(400).json({ error: 'Invalid field' });
  }

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

// Copy project with all tactical data
router.post('/:id/copy', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (!role) return res.status(404).json({ error: 'Project not found' });

  const db = getDb();
  const original = db.prepare('SELECT * FROM projects_v2 WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Project not found' });

  const newId = crypto.randomUUID();
  const newName = `${original.name} (Kopi)`;

  const copyTx = db.transaction(() => {
    db.prepare('INSERT INTO projects_v2 (id, user_id, name, settings, org_id) VALUES (?, ?, ?, ?, ?)')
      .run(newId, req.user.id, newName, original.settings, req.user.orgId);

    // Copy layers, build old→new ID map
    const layers = db.prepare('SELECT * FROM project_layers WHERE project_id = ?').all(req.params.id);
    const layerMap = new Map();
    for (const l of layers) {
      const nlId = crypto.randomUUID();
      layerMap.set(l.id, nlId);
      db.prepare('INSERT INTO project_layers (id, project_id, name, visible, source, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nlId, newId, l.name, l.visible, l.source, req.user.id);
    }

    // Copy markers
    const markers = db.prepare('SELECT * FROM project_markers WHERE project_id = ?').all(req.params.id);
    for (const m of markers) {
      db.prepare('INSERT INTO project_markers (id, project_id, layer_id, sidc, lat, lon, designation, higher_formation, additional_info, custom_label, source, created_by, properties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), newId, layerMap.get(m.layer_id) || null, m.sidc, m.lat, m.lon, m.designation, m.higher_formation, m.additional_info, m.custom_label, m.source, req.user.id, m.properties);
    }

    // Copy drawings
    const drawings = db.prepare('SELECT * FROM project_drawings WHERE project_id = ?').all(req.params.id);
    for (const d of drawings) {
      db.prepare('INSERT INTO project_drawings (id, project_id, layer_id, drawing_type, geometry, properties, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), newId, layerMap.get(d.layer_id) || null, d.drawing_type, d.geometry, d.properties, d.source, req.user.id);
    }

    // Copy pins
    const pins = db.prepare('SELECT * FROM project_pins WHERE project_id = ?').all(req.params.id);
    for (const pin of pins) {
      db.prepare('INSERT INTO project_pins (id, project_id, layer_id, pin_type, lat, lon, properties, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), newId, layerMap.get(pin.layer_id) || null, pin.pin_type, pin.lat, pin.lon, pin.properties, pin.source, req.user.id);
    }
  });

  copyTx();

  res.status(201).json({
    id: newId, name: newName, ownerId: req.user.id, ownerUsername: req.user.username,
    orgShared: null,
    sharedGroups: [], role: 'admin',
    markerCount: db.prepare('SELECT COUNT(*) as c FROM project_markers WHERE project_id = ?').get(newId).c,
    drawingCount: db.prepare('SELECT COUNT(*) as c FROM project_drawings WHERE project_id = ?').get(newId).c,
    layerCount: db.prepare('SELECT COUNT(*) as c FROM project_layers WHERE project_id = ?').get(newId).c,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
});

// Copy a single layer (with all items) to same or different project
router.post('/:id/layers/:layerId/copy', (req, res) => {
  const sourceRole = getProjectRole(req.user.id, req.params.id);
  if (!sourceRole) return res.status(404).json({ error: 'Project not found' });

  const targetProjectId = req.body.targetProjectId || req.params.id;
  const targetRole = getProjectRole(req.user.id, targetProjectId);
  if (!targetRole || (targetRole !== 'admin' && targetRole !== 'editor')) {
    return res.status(403).json({ error: 'Editor access required on target project' });
  }

  const db = getDb();
  const layer = db.prepare('SELECT * FROM project_layers WHERE id = ? AND project_id = ?').get(req.params.layerId, req.params.id);
  if (!layer) return res.status(404).json({ error: 'Layer not found' });

  const targetCategory = req.body.targetCategory === 'not_in_use' ? 'not_in_use' : 'active';

  let result;
  const copyTx = db.transaction(() => {
    const newLayerId = crypto.randomUUID();
    const newName = `${layer.name} (Kopi)`;
    db.prepare('INSERT INTO project_layers (id, project_id, name, visible, category, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newLayerId, targetProjectId, newName, 1, targetCategory, 'user', req.user.id);

    // Copy markers
    const markers = db.prepare('SELECT * FROM project_markers WHERE project_id = ? AND layer_id = ?').all(req.params.id, req.params.layerId);
    for (const m of markers) {
      db.prepare('INSERT INTO project_markers (id, project_id, layer_id, sidc, lat, lon, designation, higher_formation, additional_info, custom_label, source, created_by, properties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), targetProjectId, newLayerId, m.sidc, m.lat, m.lon, m.designation, m.higher_formation, m.additional_info, m.custom_label, m.source, req.user.id, m.properties);
    }

    // Copy drawings
    const drawings = db.prepare('SELECT * FROM project_drawings WHERE project_id = ? AND layer_id = ?').all(req.params.id, req.params.layerId);
    for (const d of drawings) {
      db.prepare('INSERT INTO project_drawings (id, project_id, layer_id, drawing_type, geometry, properties, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), targetProjectId, newLayerId, d.drawing_type, d.geometry, d.properties, d.source, req.user.id);
    }

    // Copy pins
    const pins = db.prepare('SELECT * FROM project_pins WHERE project_id = ? AND layer_id = ?').all(req.params.id, req.params.layerId);
    for (const pin of pins) {
      db.prepare('INSERT INTO project_pins (id, project_id, layer_id, pin_type, lat, lon, properties, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), targetProjectId, newLayerId, pin.pin_type, pin.lat, pin.lon, pin.properties, pin.source, req.user.id);
    }

    result = {
      layer: { id: newLayerId, name: newName, visible: true },
      markerCount: markers.length,
      drawingCount: drawings.length,
      pinCount: pins.length,
    };
  });

  copyTx();

  // Notify clients in the target project room
  const io = req.app.get('io');
  if (io) {
    io.to(`project:${targetProjectId}`).emit('server:project:refresh', { projectId: targetProjectId });
  }

  res.status(201).json(result);
});

// Share project with entire organization
router.put('/:id/org-share', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { orgRole } = req.body;
  if (!orgRole || !['viewer', 'editor'].includes(orgRole)) {
    return res.status(400).json({ error: 'orgRole must be "viewer" or "editor"' });
  }

  const db = getDb();
  db.prepare("UPDATE projects_v2 SET org_shared = ?, updated_at = datetime('now') WHERE id = ?").run(orgRole, req.params.id);
  res.json({ ok: true });
});

// Revoke org-wide sharing
router.delete('/:id/org-share', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const db = getDb();
  db.prepare("UPDATE projects_v2 SET org_shared = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Share Token management for projects ---

function generateToken() {
  const bytes = crypto.randomBytes(32);
  return bytes.toString('base64url');
}

function parseExpiresIn(expiresIn) {
  if (!expiresIn || expiresIn === 'never') return null;
  const now = Date.now();
  switch (expiresIn) {
    case '24h': return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    case '7d': return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return null;
  }
}

// Create share token for a project
router.post('/:id/share-token', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const db = getDb();
  const id = crypto.randomUUID();
  const token = generateToken();
  const expiresAt = parseExpiresIn(req.body.expiresIn);
  const layerId = req.body.layerId || null;

  db.prepare(
    'INSERT INTO share_tokens (id, token, resource_type, resource_id, created_by, org_id, expires_at, layer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, token, 'project', req.params.id, req.user.id, req.user.orgId, expiresAt, layerId);

  const url = `${req.protocol}://${req.get('host')}/?share=${token}`;
  res.status(201).json({ id, token, url, expiresAt, layerId });
});

// List share tokens for a project
router.get('/:id/share-tokens', (req, res) => {
  const role = getProjectRole(req.user.id, req.params.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const db = getDb();
  const tokens = db.prepare(
    `SELECT id, token, layer_id, expires_at, created_at FROM share_tokens
     WHERE resource_type = 'project' AND resource_id = ?
     ORDER BY created_at DESC`
  ).all(req.params.id);

  res.json(tokens);
});

// Revoke a share token for a project
router.delete('/share-token/:tokenId', (req, res) => {
  const db = getDb();
  const tokenRow = db.prepare('SELECT * FROM share_tokens WHERE id = ?').get(req.params.tokenId);
  if (!tokenRow) return res.status(404).json({ error: 'Token not found' });

  if (tokenRow.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  db.prepare('DELETE FROM share_tokens WHERE id = ?').run(req.params.tokenId);
  res.json({ ok: true });
});

function tryParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

export default router;
