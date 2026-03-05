import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// Resolve a share token to resource type + ID
router.get('/:token', (req, res) => {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM share_tokens WHERE token = ?`
  ).get(req.params.token);

  if (!row) {
    return res.json({ valid: false, error: 'invalidToken' });
  }

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return res.json({ valid: false, error: 'expired' });
  }

  // Verify the resource still exists
  if (row.resource_type === 'theme') {
    const theme = db.prepare('SELECT id, name, state FROM map_themes WHERE id = ?').get(row.resource_id);
    if (!theme) {
      return res.json({ valid: false, error: 'notFound' });
    }
    // Parse state
    let state = theme.state;
    if (typeof state === 'string') {
      try { state = JSON.parse(state); } catch { /* keep as string */ }
    }
    return res.json({
      valid: true,
      resourceType: 'theme',
      resourceId: row.resource_id,
      readOnly: true,
      theme: { id: theme.id, name: theme.name, state },
    });
  }

  if (row.resource_type === 'project') {
    const project = db.prepare('SELECT id, name FROM projects_v2 WHERE id = ?').get(row.resource_id);
    if (!project) {
      return res.json({ valid: false, error: 'notFound' });
    }
    return res.json({
      valid: true,
      resourceType: 'project',
      resourceId: row.resource_id,
      readOnly: true,
      project: { id: project.id, name: project.name },
    });
  }

  res.json({ valid: false, error: 'unknownType' });
});

export default router;
