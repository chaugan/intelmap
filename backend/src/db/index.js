import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { setDbGetter } from '../config.js';
import { hashPassword } from '../auth/passwords.js';
import { runMigration } from './migrate.js';
import { migrateOrgs } from './migrate-orgs.js';
import { importAddresses } from './import-addresses.js';
import { importPlaces } from './import-places.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

export function initDb() {
  const dbPath = path.join(config.dataDir, 'intelmap.db');
  fs.mkdirSync(config.dataDir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // Seed admin if no users exist
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    const { hash, salt } = hashPassword('admin123');
    db.prepare(
      `INSERT INTO users (id, username, password_hash, salt, role, must_change_password, ai_chat_enabled)
       VALUES (?, ?, ?, ?, 'admin', 1, 1)`
    ).run(crypto.randomUUID(), 'admin', hash, salt);
    console.log('Seeded admin user: admin / admin123 (must change password on first login)');
  }

  // Wire up DB getter for config (API key from DB)
  setDbGetter(() => db);

  // Run Phase 2 migration (one-time, idempotent)
  runMigration();

  // Migrate group_id → project_shares (one-time, idempotent)
  const projectsWithGroup = db.prepare(
    'SELECT id, group_id FROM projects_v2 WHERE group_id IS NOT NULL'
  ).all();
  if (projectsWithGroup.length > 0) {
    const insertShare = db.prepare(
      'INSERT OR IGNORE INTO project_shares (project_id, group_id) VALUES (?, ?)'
    );
    for (const p of projectsWithGroup) {
      insertShare.run(p.id, p.group_id);
    }
    // Clear old group_id column (data now lives in project_shares)
    db.prepare("UPDATE projects_v2 SET group_id = NULL WHERE group_id IS NOT NULL").run();
  }

  // Add has_image column to monitor_detections if not exists
  const detectionCols = db.prepare("PRAGMA table_info(monitor_detections)").all();
  if (!detectionCols.find(c => c.name === 'has_image')) {
    db.prepare("ALTER TABLE monitor_detections ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0").run();
  }

  // Add has_raw_image column to monitor_detections if not exists
  const detectionColsUpdated = db.prepare("PRAGMA table_info(monitor_detections)").all();
  if (!detectionColsUpdated.find(c => c.name === 'has_raw_image')) {
    db.prepare("ALTER TABLE monitor_detections ADD COLUMN has_raw_image INTEGER NOT NULL DEFAULT 0").run();
  }

  // Create theme_shares table if not exists (for theme group sharing)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS theme_shares (
      theme_id TEXT NOT NULL REFERENCES map_themes(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      shared_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (theme_id, group_id)
    )
  `).run();

  // Add is_public column to map_themes if not exists
  const themeCols = db.prepare("PRAGMA table_info(map_themes)").all();
  if (!themeCols.find(c => c.name === 'is_public')) {
    db.prepare("ALTER TABLE map_themes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0").run();
  }

  // Add org_shared column to projects_v2 if not exists
  const projectCols = db.prepare("PRAGMA table_info(projects_v2)").all();
  if (!projectCols.find(c => c.name === 'org_shared')) {
    db.prepare("ALTER TABLE projects_v2 ADD COLUMN org_shared TEXT DEFAULT NULL").run();
  }

  // Add category column to project_layers if not exists
  const layerCols = db.prepare("PRAGMA table_info(project_layers)").all();
  if (!layerCols.find(c => c.name === 'category')) {
    db.prepare("ALTER TABLE project_layers ADD COLUMN category TEXT NOT NULL DEFAULT 'active'").run();
  }

  // Add last_login_at column to users if not exists
  const userCols = db.prepare("PRAGMA table_info(users)").all();
  if (!userCols.find(c => c.name === 'last_login_at')) {
    db.prepare("ALTER TABLE users ADD COLUMN last_login_at TEXT").run();
  }

  // Run organizations migration (one-time, idempotent)
  migrateOrgs();

  // Import addresses in background (don't block startup)
  const csvPath = process.env.MATRIKKEL_CSV || path.join(config.dataDir, 'addresses', 'matrikkelenAdresse.csv');
  importAddresses(csvPath).catch(err => console.error('Address import failed:', err.message));

  // Import places in background (don't block startup)
  const placesPath = process.env.PLACES_JSON || path.join(config.dataDir, 'places.json');
  importPlaces(placesPath).catch(err => console.error('Places import failed:', err.message));

  // Backfill default "Standard" project for users missing one
  const backfilled = db.prepare("SELECT value FROM app_settings WHERE key = 'default_projects_backfilled_v2'").get();
  if (!backfilled) {
    const usersWithout = db.prepare(
      "SELECT u.id, u.org_id FROM users u WHERE NOT EXISTS (SELECT 1 FROM projects_v2 WHERE user_id = u.id AND name = 'Standard')"
    ).all();
    if (usersWithout.length > 0) {
      const insertProject = db.prepare(
        "INSERT INTO projects_v2 (id, user_id, name, settings, org_id) VALUES (?, ?, 'Standard', '{}', ?)"
      );
      for (const u of usersWithout) {
        insertProject.run(crypto.randomUUID(), u.id, u.org_id);
      }
      console.log(`Backfilled default project for ${usersWithout.length} user(s)`);
    }
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('default_projects_backfilled_v2', '1', datetime('now')) ON CONFLICT(key) DO NOTHING"
    ).run();
  }

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}
