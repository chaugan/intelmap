import { getDb } from '../db/index.js';
import { purgeOrgFiles } from '../lib/org-utils.js';

const CLEANUP_HOUR = 3; // Run at 03:00

/**
 * Permanently deletes organizations that have passed their delete_permanently_at date.
 */
export function purgeExpiredOrgs() {
  const db = getDb();
  const expired = db.prepare(`
    SELECT * FROM organizations
    WHERE delete_permanently_at IS NOT NULL
      AND delete_permanently_at <= datetime('now')
  `).all();

  for (const org of expired) {
    console.log(`[OrgCleanup] Permanently deleting org: ${org.name} (${org.id})`);
    try {
      purgeOrgFiles(db, org.id);
      db.prepare('DELETE FROM organizations WHERE id = ?').run(org.id);
      console.log(`[OrgCleanup] Deleted org: ${org.name} (${org.id})`);
    } catch (err) {
      console.error(`[OrgCleanup] Failed to delete org ${org.id}:`, err.message);
    }
  }

  if (expired.length > 0) {
    console.log(`[OrgCleanup] Purged ${expired.length} expired organization(s)`);
  }
}

/**
 * Starts the nightly cleanup scheduler.
 * Runs once daily at CLEANUP_HOUR (03:00 by default).
 */
export function startOrgCleanupScheduler() {
  // Calculate delay until next run
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(CLEANUP_HOUR, 0, 0, 0);
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  const initialDelay = nextRun - now;

  console.log(`[OrgCleanup] Next run at ${nextRun.toLocaleString()} (in ${Math.round(initialDelay / 60000)} min)`);

  // First run after delay, then every 24 hours
  setTimeout(() => {
    purgeExpiredOrgs();
    setInterval(purgeExpiredOrgs, 24 * 60 * 60 * 1000);
  }, initialDelay);
}
