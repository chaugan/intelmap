import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config.js';
import { getDb } from './index.js';

/**
 * One-time migration from Phase 1 data into normalized Phase 2 tables.
 *
 * 1. If old `projects` table has rows → parse snapshots, create projects_v2 rows + normalized data
 * 2. If state.json exists with content → create a "Felles kartdata" project for admin, import data
 */
export function runMigration() {
  const db = getDb();

  // Add auto_add_users column to groups table (if not exists)
  const groupCols = db.prepare("PRAGMA table_info(groups)").all();
  if (!groupCols.some(c => c.name === 'auto_add_users')) {
    db.prepare("ALTER TABLE groups ADD COLUMN auto_add_users INTEGER NOT NULL DEFAULT 0").run();
  }

  // Add layer_id column to share_tokens table (if not exists)
  const shareTokenCols = db.prepare("PRAGMA table_info(share_tokens)").all();
  if (!shareTokenCols.some(c => c.name === 'layer_id')) {
    db.prepare("ALTER TABLE share_tokens ADD COLUMN layer_id TEXT").run();
  }

  // Get admin user for migrations
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const adminId = admin?.id || 'system';

  // Add timelapse_enabled column to users table (if not exists)
  const userCols = db.prepare("PRAGMA table_info(users)").all();
  if (!userCols.some(c => c.name === 'timelapse_enabled')) {
    db.prepare("ALTER TABLE users ADD COLUMN timelapse_enabled INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added timelapse_enabled column to users table');
  }

  // Add ntfy_hash column to users table (if not exists)
  if (!userCols.some(c => c.name === 'ntfy_hash')) {
    db.prepare("ALTER TABLE users ADD COLUMN ntfy_hash TEXT").run();
    console.log('Added ntfy_hash column to users table');
  }

  // Add lat/lon columns to timelapse_cameras table (if not exists)
  const timelapseCols = db.prepare("PRAGMA table_info(timelapse_cameras)").all();
  if (timelapseCols.length > 0 && !timelapseCols.some(c => c.name === 'lat')) {
    db.prepare("ALTER TABLE timelapse_cameras ADD COLUMN lat REAL").run();
    db.prepare("ALTER TABLE timelapse_cameras ADD COLUMN lon REAL").run();
    console.log('Added lat/lon columns to timelapse_cameras table');
  }

  // Add camera_name, lat, lon columns to monitor_subscriptions table (if not exists)
  const monitorSubsCols = db.prepare("PRAGMA table_info(monitor_subscriptions)").all();
  if (monitorSubsCols.length > 0 && !monitorSubsCols.some(c => c.name === 'camera_name')) {
    db.prepare("ALTER TABLE monitor_subscriptions ADD COLUMN camera_name TEXT").run();
    db.prepare("ALTER TABLE monitor_subscriptions ADD COLUMN lat REAL").run();
    db.prepare("ALTER TABLE monitor_subscriptions ADD COLUMN lon REAL").run();
    console.log('Added camera_name, lat, lon columns to monitor_subscriptions table');
  }

  // Add is_paused column to monitor_subscriptions (for pausing notifications per camera)
  if (monitorSubsCols.length > 0 && !monitorSubsCols.some(c => c.name === 'is_paused')) {
    db.prepare("ALTER TABLE monitor_subscriptions ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added is_paused column to monitor_subscriptions table');
  }

  // MFA columns on users
  if (!userCols.some(c => c.name === 'totp_secret')) {
    db.prepare("ALTER TABLE users ADD COLUMN totp_secret TEXT").run();
    db.prepare("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("ALTER TABLE users ADD COLUMN mfa_backup_codes TEXT").run();
    console.log('Added MFA columns to users table');
  }

  // Feature gating columns on organizations
  const orgCols = db.prepare("PRAGMA table_info(organizations)").all();
  if (!orgCols.some(c => c.name === 'feature_ai_chat')) {
    db.prepare("ALTER TABLE organizations ADD COLUMN feature_ai_chat INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("ALTER TABLE organizations ADD COLUMN feature_wasos INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("ALTER TABLE organizations ADD COLUMN feature_infraview INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("ALTER TABLE organizations ADD COLUMN feature_upscale INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("ALTER TABLE organizations ADD COLUMN feature_mfa INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("ALTER TABLE organizations ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added feature gating columns to organizations table');
  }

  // Signal feature flag on organizations
  if (!orgCols.some(c => c.name === 'feature_signal')) {
    db.prepare("ALTER TABLE organizations ADD COLUMN feature_signal INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added feature_signal column to organizations table');
  }

  // Fire Report feature flag on organizations
  if (!orgCols.some(c => c.name === 'feature_fire_report')) {
    db.prepare("ALTER TABLE organizations ADD COLUMN feature_fire_report INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added feature_fire_report column to organizations table');
  }

  // Upscale column
  if (!userCols.some(c => c.name === 'upscale_enabled')) {
    db.prepare("ALTER TABLE users ADD COLUMN upscale_enabled INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added upscale_enabled column to users table');
  }

  // InfraView column
  if (!userCols.some(c => c.name === 'infraview_enabled')) {
    db.prepare("ALTER TABLE users ADD COLUMN infraview_enabled INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added infraview_enabled column to users table');
  }

  // Signal integration columns
  if (!userCols.some(c => c.name === 'signal_enabled')) {
    db.prepare("ALTER TABLE users ADD COLUMN signal_enabled INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("ALTER TABLE users ADD COLUMN signal_phone TEXT").run();
    db.prepare("ALTER TABLE users ADD COLUMN signal_linked_at TEXT").run();
    console.log('Added Signal columns to users table');
  }

  // Fire Report column on users
  if (!userCols.some(c => c.name === 'fire_report_enabled')) {
    db.prepare("ALTER TABLE users ADD COLUMN fire_report_enabled INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added fire_report_enabled column to users table');
  }

  // WaSOS integration columns
  if (!userCols.some(c => c.name === 'wasos_enabled')) {
    db.prepare("ALTER TABLE users ADD COLUMN wasos_enabled INTEGER NOT NULL DEFAULT 0").run();
    console.log('Added wasos_enabled column to users table');
  }
  if (!userCols.some(c => c.name === 'wasos_credentials')) {
    db.prepare("ALTER TABLE users ADD COLUMN wasos_credentials TEXT").run();
    console.log('Added wasos_credentials column to users table');
  }
  if (!userCols.some(c => c.name === 'wasos_session')) {
    db.prepare("ALTER TABLE users ADD COLUMN wasos_session TEXT").run();
    console.log('Added wasos_session column to users table');
  }

  // Per-org username uniqueness migration: remove global UNIQUE on username, add partial unique indexes
  const perOrgFlag = db.prepare("SELECT value FROM app_settings WHERE key = 'per_org_username_v1'").get();
  if (!perOrgFlag) {
    // Check if the global UNIQUE index exists on username (SQLite auto-creates it)
    const indexes = db.prepare("PRAGMA index_list(users)").all();
    const hasGlobalUnique = indexes.some(idx => {
      const cols = db.prepare(`PRAGMA index_info("${idx.name}")`).all();
      return idx.unique && cols.length === 1 && cols[0].name === 'username';
    });

    if (hasGlobalUnique) {
      console.log('Migrating users table: removing global UNIQUE on username, adding per-org uniqueness...');
      // Get current columns dynamically
      const cols = db.prepare("PRAGMA table_info(users)").all();
      const colNames = cols.map(c => c.name).join(', ');

      db.pragma('foreign_keys = OFF');
      const migrate = db.transaction(() => {
        db.exec(`CREATE TABLE users_new AS SELECT ${colNames} FROM users`);
        db.exec('DROP TABLE users');
        // Recreate table without UNIQUE on username
        const colDefs = cols.map(c => {
          let def = `${c.name} ${c.type}`;
          if (c.notnull) def += ' NOT NULL';
          if (c.dflt_value !== null) {
            // Wrap expression defaults (e.g. datetime('now')) in parentheses if not already
            const dv = c.dflt_value;
            const needsWrap = dv.includes('(') && !dv.startsWith('(');
            def += ` DEFAULT ${needsWrap ? `(${dv})` : dv}`;
          }
          if (c.pk) def += ' PRIMARY KEY';
          return def;
        }).join(', ');
        db.exec(`CREATE TABLE users (${colDefs})`);
        db.exec(`INSERT INTO users SELECT ${colNames} FROM users_new`);
        db.exec('DROP TABLE users_new');
        // Add partial unique indexes
        db.exec('CREATE UNIQUE INDEX idx_users_username_org ON users(username, org_id) WHERE org_id IS NOT NULL');
        db.exec('CREATE UNIQUE INDEX idx_users_username_super ON users(username) WHERE org_id IS NULL');
      });
      migrate();
      db.pragma('foreign_keys = ON');
      console.log('Users table migrated: per-org username uniqueness enabled');
    }

    // Mark migration as done
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('per_org_username_v1', '1', datetime('now'))").run();
  }

  // Add impersonating_user_id column to sessions table (for super-admin impersonation)
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all();
  if (!sessionCols.some(c => c.name === 'impersonating_user_id')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN impersonating_user_id TEXT").run();
    console.log('Added impersonating_user_id column to sessions table');
  }

  // Backfill org_id on timelapse_cameras and timelapse_subscriptions (fix for multi-tenancy migration)
  const nullOrgCameras = db.prepare("SELECT COUNT(*) as c FROM timelapse_cameras WHERE org_id IS NULL").get()?.c || 0;
  if (nullOrgCameras > 0) {
    // Set org_id from the subscribing user's org
    db.prepare(`
      UPDATE timelapse_cameras SET org_id = (
        SELECT u.org_id FROM timelapse_subscriptions s
        JOIN users u ON s.user_id = u.id
        WHERE s.camera_id = timelapse_cameras.camera_id AND u.org_id IS NOT NULL
        LIMIT 1
      ) WHERE org_id IS NULL
    `).run();
    db.prepare(`
      UPDATE timelapse_subscriptions SET org_id = (
        SELECT u.org_id FROM users u WHERE u.id = timelapse_subscriptions.user_id
      ) WHERE org_id IS NULL
    `).run();
    const fixed = nullOrgCameras - (db.prepare("SELECT COUNT(*) as c FROM timelapse_cameras WHERE org_id IS NULL").get()?.c || 0);
    console.log(`Backfilled org_id on ${fixed} timelapse cameras`);
  }

  // Create project_viewsheds table (if not exists)
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_viewsheds (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      layer_id TEXT,
      longitude REAL,
      latitude REAL,
      observer_height REAL,
      radius_km REAL,
      geojson TEXT,
      stats TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add layer_id column to project_viewsheds if missing (migration for existing installs)
  const viewshedCols = db.prepare("PRAGMA table_info(project_viewsheds)").all();
  if (viewshedCols.length > 0 && !viewshedCols.some(c => c.name === 'layer_id')) {
    db.prepare("ALTER TABLE project_viewsheds ADD COLUMN layer_id TEXT").run();
    console.log('Added layer_id column to project_viewsheds table');
  }

  // Create project_rf_coverages table (if not exists)
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_rf_coverages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      layer_id TEXT,
      longitude REAL,
      latitude REAL,
      antenna_height REAL,
      tx_power_watts REAL,
      frequency_mhz REAL,
      radius_km REAL,
      geojson TEXT,
      stats TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add show_label column to project_rf_coverages
  const rfCols = db.prepare("PRAGMA table_info(project_rf_coverages)").all();
  if (rfCols.length > 0 && !rfCols.some(c => c.name === 'show_label')) {
    db.prepare("ALTER TABLE project_rf_coverages ADD COLUMN show_label INTEGER DEFAULT 0").run();
    console.log('Added show_label column to project_rf_coverages table');
  }

  // Add color and label columns to project_viewsheds
  if (viewshedCols.length > 0 && !viewshedCols.some(c => c.name === 'color')) {
    db.prepare("ALTER TABLE project_viewsheds ADD COLUMN color TEXT").run();
    console.log('Added color column to project_viewsheds table');
  }
  if (viewshedCols.length > 0 && !viewshedCols.some(c => c.name === 'label')) {
    db.prepare("ALTER TABLE project_viewsheds ADD COLUMN label TEXT").run();
    console.log('Added label column to project_viewsheds table');
  }

  // Add type column to project_viewsheds (viewshed | horizon)
  if (viewshedCols.length > 0 && !viewshedCols.some(c => c.name === 'type')) {
    db.prepare("ALTER TABLE project_viewsheds ADD COLUMN type TEXT DEFAULT 'viewshed'").run();
    console.log('Added type column to project_viewsheds table');
  }

  // Create project_firing_ranges table (if not exists)
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_firing_ranges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      layer_id TEXT,
      longitude REAL,
      latitude REAL,
      gun_altitude REAL,
      weapon_preset TEXT,
      max_range_km REAL,
      min_elevation_mils REAL,
      max_elevation_mils REAL,
      muzzle_velocity REAL,
      geojson TEXT,
      stats TEXT,
      color TEXT,
      label TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create project_audit_log table (if not exists)
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_project_created ON project_audit_log(project_id, created_at DESC)`);

  // 1. Migrate old projects table snapshots (only if projects_v2 is empty)
  const v2Count = db.prepare('SELECT COUNT(*) as c FROM projects_v2').get().c;
  const oldProjects = v2Count === 0 ? db.prepare('SELECT * FROM projects').all() : [];
  if (oldProjects.length > 0) {
    console.log('Running Phase 2 data migration...');
    console.log(`Migrating ${oldProjects.length} old project(s)...`);
    const insertProject = db.prepare(
      'INSERT INTO projects_v2 (id, user_id, name, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertLayer = db.prepare(
      'INSERT INTO project_layers (id, project_id, name, visible, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMarker = db.prepare(
      `INSERT INTO project_markers (id, project_id, layer_id, sidc, lat, lon, designation, higher_formation, additional_info, custom_label, source, created_by, properties, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertDrawing = db.prepare(
      `INSERT INTO project_drawings (id, project_id, layer_id, drawing_type, geometry, properties, source, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const migrateProject = db.transaction((p) => {
      let snapshot;
      try {
        snapshot = JSON.parse(p.snapshot);
      } catch {
        console.warn(`Skipping project ${p.id}: invalid snapshot JSON`);
        return;
      }

      const settings = JSON.stringify({
        viewport: snapshot.viewport || null,
        baseLayer: snapshot.baseLayer || 'topo',
        overlays: snapshot.overlays || {},
      });

      insertProject.run(p.id, p.user_id, p.name, settings, p.created_at, p.updated_at);

      // Migrate layers
      const layerIdMap = new Map(); // old id → new id (in case we need to remap)
      if (snapshot.layers?.length) {
        for (const l of snapshot.layers) {
          const layerId = l.id || crypto.randomUUID();
          insertLayer.run(layerId, p.id, l.name || 'Unnamed', l.visible ? 1 : 0, l.source || 'user', l.createdBy || '', l.createdAt || p.created_at);
          layerIdMap.set(l.id, layerId);
        }
      }

      // Migrate markers
      if (snapshot.markers?.length) {
        for (const m of snapshot.markers) {
          const markerId = m.id || crypto.randomUUID();
          const layerId = m.layerId && layerIdMap.has(m.layerId) ? layerIdMap.get(m.layerId) : null;
          insertMarker.run(
            markerId, p.id, layerId,
            m.sidc || '', m.lat || 0, m.lon || 0,
            m.designation || '', m.higherFormation || '', m.additionalInfo || '',
            m.customLabel || '', m.source || 'user', m.createdBy || '',
            JSON.stringify(m.properties || {}),
            m.createdAt || p.created_at, m.updatedAt || p.updated_at
          );
        }
      }

      // Migrate drawings
      if (snapshot.drawings?.length) {
        for (const d of snapshot.drawings) {
          const drawingId = d.id || crypto.randomUUID();
          const layerId = d.layerId && layerIdMap.has(d.layerId) ? layerIdMap.get(d.layerId) : null;
          insertDrawing.run(
            drawingId, p.id, layerId,
            d.drawingType || 'line',
            JSON.stringify(d.geometry || {}),
            JSON.stringify(d.properties || {}),
            d.source || 'user', d.createdBy || '',
            d.createdAt || p.created_at, d.updatedAt || p.updated_at
          );
        }
      }
    });

    for (const p of oldProjects) {
      migrateProject(p);
    }
    console.log('Old projects migrated to projects_v2.');
  }

  // 2. Migrate state.json if it exists (independent of old projects migration)
  const stateFile = path.join(config.dataDir, 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const raw = fs.readFileSync(stateFile, 'utf-8');
      const data = JSON.parse(raw);
      const hasData = (data.markers?.length > 0) || (data.drawings?.length > 0) || (data.layers?.length > 0);

      if (hasData) {
        // Check if data was already migrated from old projects (same IDs may exist)
        const existingMarkerIds = new Set(
          db.prepare('SELECT id FROM project_markers').all().map(r => r.id)
        );
        const existingDrawingIds = new Set(
          db.prepare('SELECT id FROM project_drawings').all().map(r => r.id)
        );

        // Filter out items that were already migrated from project snapshots
        const newMarkers = (data.markers || []).filter(m => !existingMarkerIds.has(m.id));
        const newDrawings = (data.drawings || []).filter(d => !existingDrawingIds.has(d.id));
        const newLayers = (data.layers || []).filter(l => {
          // Check if layer already exists
          return !db.prepare('SELECT id FROM project_layers WHERE id = ?').get(l.id);
        });

        if (newMarkers.length === 0 && newDrawings.length === 0 && newLayers.length === 0) {
          console.log('state.json data already migrated via project snapshots, skipping.');
          fs.renameSync(stateFile, stateFile + '.migrated');
          return;
        }

        console.log(`Migrating state.json into "Felles kartdata" project (${newMarkers.length} markers, ${newDrawings.length} drawings, ${newLayers.length} layers)...`);
        const projectId = crypto.randomUUID();
        db.prepare(
          'INSERT INTO projects_v2 (id, user_id, name, settings) VALUES (?, ?, ?, ?)'
        ).run(projectId, adminId, 'Felles kartdata', '{}');

        // Layers
        const layerIdMap = new Map();
        if (data.layers?.length) {
          for (const l of data.layers) {
            const layerId = l.id || crypto.randomUUID();
            db.prepare(
              'INSERT INTO project_layers (id, project_id, name, visible, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).run(layerId, projectId, l.name || 'Unnamed', l.visible ? 1 : 0, l.source || 'user', l.createdBy || '', l.createdAt || new Date().toISOString());
            layerIdMap.set(l.id, layerId);
          }
        }

        // Markers
        if (data.markers?.length) {
          const stmt = db.prepare(
            `INSERT INTO project_markers (id, project_id, layer_id, sidc, lat, lon, designation, higher_formation, additional_info, custom_label, source, created_by, properties, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const m of data.markers) {
            const layerId = m.layerId && layerIdMap.has(m.layerId) ? layerIdMap.get(m.layerId) : null;
            stmt.run(
              m.id || crypto.randomUUID(), projectId, layerId,
              m.sidc || '', m.lat || 0, m.lon || 0,
              m.designation || '', m.higherFormation || '', m.additionalInfo || '',
              m.customLabel || '', m.source || 'user', m.createdBy || '',
              JSON.stringify(m.properties || {}),
              m.createdAt || new Date().toISOString(), m.updatedAt || new Date().toISOString()
            );
          }
        }

        // Drawings
        if (data.drawings?.length) {
          const stmt = db.prepare(
            `INSERT INTO project_drawings (id, project_id, layer_id, drawing_type, geometry, properties, source, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const d of data.drawings) {
            const layerId = d.layerId && layerIdMap.has(d.layerId) ? layerIdMap.get(d.layerId) : null;
            stmt.run(
              d.id || crypto.randomUUID(), projectId, layerId,
              d.drawingType || 'line',
              JSON.stringify(d.geometry || {}),
              JSON.stringify(d.properties || {}),
              d.source || 'user', d.createdBy || '',
              d.createdAt || new Date().toISOString(), d.updatedAt || new Date().toISOString()
            );
          }
        }

        // Rename state.json so it's not processed again
        fs.renameSync(stateFile, stateFile + '.migrated');
        console.log('state.json migrated and renamed to state.json.migrated');
      }
    } catch (err) {
      console.error('Failed to migrate state.json:', err.message);
    }
  }
}
