import { getDb } from '../db/index.js';

/**
 * Get a user's role for a specific project.
 * @returns 'admin' | 'editor' | 'viewer' | null
 *
 * - Project owner → 'admin'
 * - Site admin → 'admin' (always has access)
 * - Group member (if project is shared with groups via project_shares) → best group role
 * - Otherwise → null (no access)
 */
export function getProjectRole(userId, projectId) {
  const db = getDb();

  // Get the project
  const project = db.prepare('SELECT user_id FROM projects_v2 WHERE id = ?').get(projectId);
  if (!project) return null;

  // Owner always has admin
  if (project.user_id === userId) return 'admin';

  // Check if user is a site admin
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (user?.role === 'admin') return 'admin';

  // Check all groups this project is shared with
  const shares = db.prepare(
    'SELECT group_id FROM project_shares WHERE project_id = ?'
  ).all(projectId);

  const rolePriority = { admin: 3, editor: 2, viewer: 1 };
  let bestRole = null;

  for (const share of shares) {
    const membership = db.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(share.group_id, userId);
    if (membership) {
      if (!bestRole || rolePriority[membership.role] > rolePriority[bestRole]) {
        bestRole = membership.role;
      }
    }
  }

  return bestRole;
}

/**
 * Check if a user can mutate (add/update/delete) data in a project.
 * Requires 'admin' or 'editor' role.
 */
export function canMutateProject(userId, projectId) {
  const role = getProjectRole(userId, projectId);
  return role === 'admin' || role === 'editor';
}
