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
