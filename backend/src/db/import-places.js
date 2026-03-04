import fs from 'fs';
import { getDb } from './index.js';

export async function importPlaces(jsonPath) {
  const db = getDb();

  // Check if already imported
  const meta = db.prepare("SELECT value FROM app_settings WHERE key = 'places_imported'").get();
  if (meta?.value === 'true') {
    const count = db.prepare('SELECT COUNT(*) as c FROM places').get();
    if (count.c > 0) {
      console.log(`Places database already populated (${count.c} records), skipping import.`);
      return;
    }
  }

  if (!fs.existsSync(jsonPath)) {
    console.warn(`Places JSON not found at ${jsonPath}, skipping import.`);
    return;
  }

  console.log('Importing Kartverket place names into SQLite...');
  const startTime = Date.now();

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stedsnummer INTEGER UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      municipality TEXT,
      county TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_places_name ON places(name);
    CREATE INDEX IF NOT EXISTS idx_places_type ON places(type);
  `);

  // FTS5 virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS places_fts USING fts5(
      name, type, municipality, county,
      content='places', content_rowid='id'
    );
  `);

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const places = JSON.parse(raw);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO places (stedsnummer, name, type, municipality, county, lat, lon)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const BATCH_SIZE = 10000;
  let totalRows = 0;

  const insertMany = db.transaction((batch) => {
    for (const p of batch) {
      insertStmt.run(p.stedsnummer, p.name, p.type, p.municipality || '', p.county || '', p.lat, p.lon);
    }
  });

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    insertMany(batch);
    totalRows += batch.length;
    if (totalRows % 50000 === 0) {
      console.log(`  Imported ${totalRows} places...`);
    }
  }

  // Populate FTS index
  console.log('Building places full-text search index...');
  db.exec(`
    INSERT INTO places_fts(places_fts) VALUES('rebuild');
  `);

  // Mark as imported
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('places_imported', 'true', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = datetime('now')
  `).run();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Places import complete: ${totalRows} records imported in ${elapsed}s`);
}
