import fs from 'fs';
import readline from 'readline';
import proj4 from 'proj4';
import { getDb } from './index.js';

// EPSG:25833 (UTM zone 33N) → WGS84
proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

export async function importAddresses(csvPath) {
  const db = getDb();

  // Check if already imported
  const meta = db.prepare("SELECT value FROM app_settings WHERE key = 'addresses_imported'").get();
  if (meta?.value === 'true') {
    const count = db.prepare('SELECT COUNT(*) as c FROM addresses').get();
    if (count.c > 0) {
      console.log(`Address database already populated (${count.c} records), skipping import.`);
      return;
    }
  }

  if (!fs.existsSync(csvPath)) {
    console.warn(`Address CSV not found at ${csvPath}, skipping import.`);
    return;
  }

  console.log('Importing matrikkel addresses into SQLite...');
  const startTime = Date.now();

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      street TEXT,
      number INTEGER,
      letter TEXT,
      postcode TEXT,
      city TEXT,
      municipality TEXT,
      lat REAL,
      lon REAL
    );

    CREATE INDEX IF NOT EXISTS idx_addresses_street ON addresses(street);
    CREATE INDEX IF NOT EXISTS idx_addresses_postcode ON addresses(postcode);
  `);

  // FTS5 virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS addresses_fts USING fts5(
      street, postcode, city, municipality,
      content='addresses', content_rowid='id'
    );
  `);

  const insertStmt = db.prepare(`
    INSERT INTO addresses (street, number, letter, postcode, city, municipality, lat, lon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((batch) => {
    for (const row of batch) {
      insertStmt.run(row.street, row.number, row.letter, row.postcode, row.city, row.municipality, row.lat, row.lon);
    }
  });

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let header = null;
  let batch = [];
  let totalRows = 0;
  let skipped = 0;
  const BATCH_SIZE = 10000;

  for await (const line of rl) {
    if (!header) {
      // Parse header — handle BOM
      const clean = line.replace(/^\uFEFF/, '');
      header = clean.split(';');
      continue;
    }

    const cols = line.split(';');
    const get = (name) => cols[header.indexOf(name)] || '';

    // Only import vegadresse (has street name)
    const adressetype = get('adressetype');
    const street = get('adressenavn');
    if (adressetype !== 'vegadresse' || !street) {
      skipped++;
      continue;
    }

    const nord = parseFloat(get('Nord'));
    const ost = parseFloat(get('Øst'));
    if (isNaN(nord) || isNaN(ost)) {
      skipped++;
      continue;
    }

    // Convert UTM33N to WGS84
    const [lon, lat] = proj4('EPSG:25833', 'EPSG:4326', [ost, nord]);

    batch.push({
      street,
      number: parseInt(get('nummer')) || null,
      letter: get('bokstav') || null,
      postcode: get('postnummer') || null,
      city: get('poststed') || null,
      municipality: get('kommunenavn') || null,
      lat,
      lon,
    });

    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      totalRows += batch.length;
      if (totalRows % 100000 === 0) {
        console.log(`  Imported ${totalRows} addresses...`);
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    insertMany(batch);
    totalRows += batch.length;
  }

  // Populate FTS index
  console.log('Building full-text search index...');
  db.exec(`
    INSERT INTO addresses_fts(addresses_fts) VALUES('rebuild');
  `);

  // Mark as imported
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('addresses_imported', 'true', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = datetime('now')
  `).run();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Address import complete: ${totalRows} records imported, ${skipped} skipped in ${elapsed}s`);
}
