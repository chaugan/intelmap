import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { setDbGetter } from '../config.js';
import { hashPassword } from '../auth/passwords.js';
import { runMigration } from './migrate.js';

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

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}
