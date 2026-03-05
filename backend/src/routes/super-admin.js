import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { hashPassword } from '../auth/passwords.js';
import { sanitizeUsername, validatePassword } from '../auth/sanitize.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { requireSuperAdmin } from '../auth/middleware.js';
import { disconnectUser } from '../socket/index.js';
import { eventLogger } from '../lib/event-logger.js';
import { purgeOrgFiles } from '../lib/org-utils.js';

const router = Router();
router.use(requireSuperAdmin);

// --- Organizations CRUD ---

// List all orgs (active + soft-deleted)
router.get('/orgs', (req, res) => {
  const db = getDb();
  const orgs = db.prepare(`
    SELECT o.*,
      (SELECT COUNT(*) FROM users WHERE org_id = o.id) as user_count
    FROM organizations o
    ORDER BY o.created_at DESC
  `).all();

  res.json(orgs.map(o => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    userCount: o.user_count,
    createdBy: o.created_by,
    deletedAt: o.deleted_at,
    deletePermanentlyAt: o.delete_permanently_at,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  })));
});

// Create org
router.post('/orgs', (req, res) => {
  const name = req.body.name?.trim();
  const slug = req.body.slug?.trim()?.toLowerCase()?.replace(/[^a-z0-9-]/g, '');

  if (!name || name.length > 100) return res.status(400).json({ error: 'Organization name required (1-100 chars)' });
  if (!slug || slug.length < 2 || slug.length > 50) return res.status(400).json({ error: 'Slug required (2-50 chars, lowercase alphanumeric and hyphens)' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
  if (existing) return res.status(409).json({ error: 'Slug already in use' });

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, name, slug, req.user.id);

  eventLogger.config.info(`Organization created: ${name} (${slug})`, { orgId: id });
  res.status(201).json({ id, name, slug, userCount: 0, createdBy: req.user.id });
});

// Update org name/slug
router.put('/orgs/:id', (req, res) => {
  const db = getDb();
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const name = req.body.name?.trim() || org.name;
  const slug = req.body.slug?.trim()?.toLowerCase()?.replace(/[^a-z0-9-]/g, '') || org.slug;

  if (slug !== org.slug) {
    const existing = db.prepare('SELECT id FROM organizations WHERE slug = ? AND id != ?').get(slug, req.params.id);
    if (existing) return res.status(409).json({ error: 'Slug already in use' });
  }

  db.prepare("UPDATE organizations SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name, slug, req.params.id);

  res.json({ ok: true });
});

// Soft-delete org (sets deleted_at + delete_permanently_at = now + 7 days)
// Use ?permanent=true for instant hard-delete
router.delete('/orgs/:id', (req, res) => {
  const db = getDb();
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  if (req.query.permanent === 'true') {
    // Instant hard-delete: remove all file storage first
    purgeOrgFiles(db, req.params.id);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(req.params.id);
    eventLogger.config.info(`Organization permanently deleted: ${org.name} (${org.id})`);
    return res.json({ ok: true, permanent: true });
  }

  // Soft-delete: set deleted_at and schedule permanent deletion in 7 days
  db.prepare(`
    UPDATE organizations
    SET deleted_at = datetime('now'),
        delete_permanently_at = datetime('now', '+7 days'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);

  // Log out all users in the org
  const orgUsers = db.prepare('SELECT id FROM users WHERE org_id = ?').all(req.params.id);
  for (const u of orgUsers) {
    deleteUserSessions(u.id);
    disconnectUser(u.id);
  }

  eventLogger.config.info(`Organization soft-deleted: ${org.name} (${org.id}), permanent deletion in 7 days`);
  res.json({ ok: true, permanent: false });
});

// Restore org from recycle bin
router.post('/orgs/:id/restore', (req, res) => {
  const db = getDb();
  const org = db.prepare('SELECT * FROM organizations WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found in recycle bin' });

  db.prepare(`
    UPDATE organizations
    SET deleted_at = NULL, delete_permanently_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);

  eventLogger.config.info(`Organization restored: ${org.name} (${org.id})`);
  res.json({ ok: true });
});

// --- Org user management ---

// List users in an org
router.get('/orgs/:id/users', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, username, role, locked, ai_chat_enabled, timelapse_enabled, wasos_enabled, infraview_enabled, created_at
    FROM users WHERE org_id = ?
    ORDER BY created_at
  `).all(req.params.id);

  res.json(users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    locked: !!u.locked,
    aiChatEnabled: !!u.ai_chat_enabled,
    timelapseEnabled: !!u.timelapse_enabled,
    wasosEnabled: !!u.wasos_enabled,
    infraviewEnabled: !!u.infraview_enabled,
    createdAt: u.created_at,
  })));
});

// Create user in org
router.post('/orgs/:id/users', (req, res) => {
  const username = sanitizeUsername(req.body.username);
  if (!username) return res.status(400).json({ error: 'Invalid username (2-32 chars, alphanumeric/underscore/hyphen)' });

  const password = req.body.password;
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 6-128 characters' });

  const db = getDb();

  // Verify org exists
  const org = db.prepare('SELECT id FROM organizations WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  // Check globally unique username
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already in use' });

  const { hash, salt } = hashPassword(password);
  const id = crypto.randomUUID();
  const role = req.body.role === 'admin' ? 'admin' : 'user';

  db.prepare(`
    INSERT INTO users (id, username, password_hash, salt, role, org_id, must_change_password, ai_chat_enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run(id, username, hash, salt, role, req.params.id);

  // Auto-add to all groups in the org
  const groups = db.prepare('SELECT id FROM groups WHERE org_id = ?').all(req.params.id);
  const insertMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, \'viewer\')');
  for (const g of groups) {
    insertMember.run(g.id, id);
  }

  res.status(201).json({ id, username, role, orgId: req.params.id });
});

// Promote user to org admin
router.post('/orgs/:id/promote-admin', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const db = getDb();
  const user = db.prepare('SELECT id, org_id FROM users WHERE id = ? AND org_id = ?').get(userId, req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found in this organization' });

  db.prepare("UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE id = ?").run(userId);
  res.json({ ok: true });
});

// --- Super-admin management ---

// List all super-admins
router.get('/admins', (req, res) => {
  const db = getDb();
  const admins = db.prepare("SELECT id, username, created_at FROM users WHERE role = 'super_admin' ORDER BY created_at").all();
  res.json(admins);
});

// Create super-admin
router.post('/admins', (req, res) => {
  const username = sanitizeUsername(req.body.username);
  if (!username) return res.status(400).json({ error: 'Invalid username' });

  const password = req.body.password;
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 6-128 characters' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already in use' });

  const { hash, salt } = hashPassword(password);
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO users (id, username, password_hash, salt, role, org_id, must_change_password, ai_chat_enabled)
    VALUES (?, ?, ?, ?, 'super_admin', NULL, 1, 0)
  `).run(id, username, hash, salt);

  eventLogger.config.info(`Super-admin created: ${username}`);
  res.status(201).json({ id, username, role: 'super_admin' });
});

// --- Org Settings ---

// Get org settings
router.get('/orgs/:id/settings', (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT key, value FROM org_settings WHERE org_id = ?').all(req.params.id);
  const result = {};
  for (const s of settings) {
    // Mask sensitive keys
    if (s.key.includes('key') || s.key.includes('secret') || s.key.includes('token')) {
      result[s.key] = { hasValue: true };
    } else {
      result[s.key] = s.value;
    }
  }
  res.json(result);
});

export default router;
