import crypto from 'crypto';
import { getDb } from './index.js';

/**
 * Idempotent migration: adds org_id columns to all tenant-scoped tables,
 * creates the "Gunnerside" organization, and migrates existing data into it.
 */
export function migrateOrgs() {
  const db = getDb();

  // Check if already migrated
  const flag = db.prepare("SELECT value FROM app_settings WHERE key = 'orgs_migrated'").get();
  if (flag) return;

  console.log('[OrgMigration] Starting organizations migration...');

  // 1. Add org_id columns to all tenant-scoped tables (nullable initially)
  const tablesNeedingOrgId = [
    'users',
    'groups',
    'projects_v2',
    'map_themes',
    'timelapse_cameras',
    'timelapse_subscriptions',
    'timelapse_exports',
    'monitor_subscriptions',
    'monitor_detections',
    'monitor_cameras',
    'admin_events',
  ];

  for (const table of tablesNeedingOrgId) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.find(c => c.name === 'org_id')) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`).run();
      console.log(`[OrgMigration] Added org_id to ${table}`);
    }
  }

  // 2. Create "Gunnerside" organization for pre-existing data
  const orgId = crypto.randomUUID();
  const slug = 'gunnerside';

  db.prepare(`
    INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at)
    VALUES (?, 'Gunnerside', ?, NULL, datetime('now'), datetime('now'))
  `).run(orgId, slug);
  console.log(`[OrgMigration] Created org "Gunnerside" (${orgId})`);

  // 3. Assign all existing data to the Gunnerside org
  for (const table of tablesNeedingOrgId) {
    const result = db.prepare(`UPDATE ${table} SET org_id = ? WHERE org_id IS NULL`).run(orgId);
    if (result.changes > 0) {
      console.log(`[OrgMigration] Assigned ${result.changes} rows in ${table} to Gunnerside`);
    }
  }

  // 4. Promote the first admin user to super_admin
  const firstAdmin = db.prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get();
  if (firstAdmin) {
    db.prepare("UPDATE users SET role = 'super_admin', org_id = NULL WHERE id = ?").run(firstAdmin.id);
    console.log(`[OrgMigration] Promoted "${firstAdmin.username}" to super_admin`);
  }

  // 5. Copy per-org API keys from app_settings into org_settings
  const orgSettingKeys = [
    'anthropic_api_key',
    'google_maps_api_key',
    'barentswatch_client_id',
    'barentswatch_client_secret',
    'ntfy_url',
    'ntfy_token',
    'vlm_url',
    'vlm_api_token',
  ];

  const insertOrgSetting = db.prepare(`
    INSERT OR IGNORE INTO org_settings (org_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  for (const key of orgSettingKeys) {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
    if (row) {
      insertOrgSetting.run(orgId, key, row.value);
      console.log(`[OrgMigration] Copied ${key} to org_settings for Gunnerside`);
    }
  }

  // 6. Create org-scoped indexes
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)').run(); } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_groups_org ON groups(org_id)').run(); } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_projects_org ON projects_v2(org_id)').run(); } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_themes_org ON map_themes(org_id)').run(); } catch {}

  // 7. Mark migration complete
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('orgs_migrated', '1', datetime('now'))
  `).run();

  console.log('[OrgMigration] Migration complete.');
}
