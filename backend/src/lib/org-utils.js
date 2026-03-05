import fs from 'fs';
import path from 'path';
import config from '../config.js';

/**
 * Purge all file storage associated with an organization.
 * Call this before deleting the org from the DB (CASCADE handles DB rows).
 */
export function purgeOrgFiles(db, orgId) {
  // Delete timelapse frames for org's cameras
  const cameras = db.prepare('SELECT camera_id FROM timelapse_cameras WHERE org_id = ?').all(orgId);
  for (const cam of cameras) {
    const camDir = path.join(config.dataDir, 'timelapse', cam.camera_id);
    if (fs.existsSync(camDir)) {
      fs.rmSync(camDir, { recursive: true, force: true });
    }
  }

  // Delete exports and detections for org's users
  const users = db.prepare('SELECT id FROM users WHERE org_id = ?').all(orgId);
  for (const u of users) {
    const exportsDir = path.join(config.dataDir, 'exports', u.id);
    if (fs.existsSync(exportsDir)) {
      fs.rmSync(exportsDir, { recursive: true, force: true });
    }
    const detectionsDir = path.join(config.dataDir, 'detections', u.id);
    if (fs.existsSync(detectionsDir)) {
      fs.rmSync(detectionsDir, { recursive: true, force: true });
    }
  }
}

/**
 * Get an org-scoped setting with fallback to app_settings.
 */
export function getOrgSetting(db, orgId, key) {
  if (orgId) {
    const row = db.prepare('SELECT value FROM org_settings WHERE org_id = ? AND key = ?').get(orgId, key);
    if (row) return row.value;
  }
  const fallback = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return fallback?.value || null;
}
