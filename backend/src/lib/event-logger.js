import { getDb } from '../db/index.js';

/**
 * EventLogger - Structured logging for admin console
 *
 * Writes events to both console and database for admin visibility.
 * Automatically truncates old events to prevent unbounded growth.
 */

const CATEGORIES = {
  SYSTEM: 'system',
  AUTH: 'auth',
  MONITORING: 'monitoring',
  TIMELAPSE: 'timelapse',
  INFERENCE: 'inference',
  NOTIFICATION: 'notification',
  API: 'api',
  CONFIG: 'config',
};

const LEVELS = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

// Keep max 1000 events
const MAX_EVENTS = 1000;

let cleanupScheduled = false;

function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setTimeout(() => {
    try {
      const db = getDb();
      const count = db.prepare('SELECT COUNT(*) as c FROM admin_events').get().c;
      if (count > MAX_EVENTS) {
        const toDelete = count - MAX_EVENTS;
        db.prepare(`
          DELETE FROM admin_events WHERE id IN (
            SELECT id FROM admin_events ORDER BY created_at ASC LIMIT ?
          )
        `).run(toDelete);
      }
    } catch {}
    cleanupScheduled = false;
  }, 5000);
}

function logEvent(level, category, message, details = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${category}]`;

  // Console output
  const consoleMsg = `${prefix} ${message}`;
  if (level === LEVELS.ERROR) {
    console.error(consoleMsg);
  } else if (level === LEVELS.WARNING) {
    console.warn(consoleMsg);
  } else {
    console.log(consoleMsg);
  }

  // Database storage
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO admin_events (level, category, message, details, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(level, category, message, details ? JSON.stringify(details) : null, timestamp);

    scheduleCleanup();
  } catch (err) {
    // Silently fail - don't let logging break the app
  }
}

export const eventLogger = {
  // Convenience methods by level
  error: (category, message, details) => logEvent(LEVELS.ERROR, category, message, details),
  warning: (category, message, details) => logEvent(LEVELS.WARNING, category, message, details),
  info: (category, message, details) => logEvent(LEVELS.INFO, category, message, details),

  // Category-specific helpers
  system: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.SYSTEM, msg, details),
    error: (msg, details) => logEvent(LEVELS.ERROR, CATEGORIES.SYSTEM, msg, details),
  },
  auth: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.AUTH, msg, details),
    warning: (msg, details) => logEvent(LEVELS.WARNING, CATEGORIES.AUTH, msg, details),
    error: (msg, details) => logEvent(LEVELS.ERROR, CATEGORIES.AUTH, msg, details),
  },
  monitoring: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.MONITORING, msg, details),
    warning: (msg, details) => logEvent(LEVELS.WARNING, CATEGORIES.MONITORING, msg, details),
    error: (msg, details) => logEvent(LEVELS.ERROR, CATEGORIES.MONITORING, msg, details),
  },
  timelapse: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.TIMELAPSE, msg, details),
    warning: (msg, details) => logEvent(LEVELS.WARNING, CATEGORIES.TIMELAPSE, msg, details),
    error: (msg, details) => logEvent(LEVELS.ERROR, CATEGORIES.TIMELAPSE, msg, details),
  },
  inference: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.INFERENCE, msg, details),
    warning: (msg, details) => logEvent(LEVELS.WARNING, CATEGORIES.INFERENCE, msg, details),
    error: (msg, details) => logEvent(LEVELS.ERROR, CATEGORIES.INFERENCE, msg, details),
  },
  notification: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.NOTIFICATION, msg, details),
    warning: (msg, details) => logEvent(LEVELS.WARNING, CATEGORIES.NOTIFICATION, msg, details),
    error: (msg, details) => logEvent(LEVELS.ERROR, CATEGORIES.NOTIFICATION, msg, details),
  },
  api: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.API, msg, details),
    warning: (msg, details) => logEvent(LEVELS.WARNING, CATEGORIES.API, msg, details),
    error: (msg, details) => logEvent(LEVELS.ERROR, CATEGORIES.API, msg, details),
  },
  config: {
    info: (msg, details) => logEvent(LEVELS.INFO, CATEGORIES.CONFIG, msg, details),
    warning: (msg, details) => logEvent(LEVELS.WARNING, CATEGORIES.CONFIG, msg, details),
  },

  // Categories and levels for reference
  CATEGORIES,
  LEVELS,
};
