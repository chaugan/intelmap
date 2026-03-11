import { getDb } from '../db/index.js';

const MAX_ENTRIES_PER_PROJECT = 7500;

export function logAudit(io, projectId, userId, username, action, entityType, entityId, summary, details = null) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO project_audit_log (project_id, user_id, username, action, entity_type, entity_id, summary, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(projectId, userId, username, action, entityType, entityId, summary, details ? JSON.stringify(details) : null);

  const entry = db.prepare('SELECT * FROM project_audit_log WHERE id = ?').get(result.lastInsertRowid);

  // Push to all clients in the project room
  if (io) io.to(`project:${projectId}`).emit('server:audit:entry', entry);

  // Auto-prune oldest entries beyond limit per project
  scheduleCleanup(projectId);
  return entry;
}

const pending = new Set();
function scheduleCleanup(projectId) {
  if (pending.has(projectId)) return;
  pending.add(projectId);
  setTimeout(() => {
    try {
      const db = getDb();
      const { c } = db.prepare('SELECT COUNT(*) as c FROM project_audit_log WHERE project_id = ?').get(projectId);
      if (c > MAX_ENTRIES_PER_PROJECT) {
        db.prepare(`DELETE FROM project_audit_log WHERE project_id = ? AND id IN (
          SELECT id FROM project_audit_log WHERE project_id = ? ORDER BY created_at ASC LIMIT ?
        )`).run(projectId, projectId, c - MAX_ENTRIES_PER_PROJECT);
      }
    } catch {}
    pending.delete(projectId);
  }, 10000);
}
