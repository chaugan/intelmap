import crypto from 'crypto';

const config = {
  port: process.env.PORT || 3001,
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  dataDir: process.env.DATA_DIR || './data',
  metUserAgent: 'IntelMap/1.0 github.com/intelmap',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
};

// Dynamic getter for API key — checks DB first, then env fallback
let _getDb = null;

export function setDbGetter(fn) {
  _getDb = fn;
}

export function getAnthropicApiKey() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.ANTHROPIC_API_KEY || '';
}

export function getGoogleMapsApiKey() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'google_maps_api_key'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.GOOGLE_MAPS_API_KEY || '';
}

export function getBarentsWatchClientId() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'barentswatch_client_id'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.BARENTSWATCH_CLIENT_ID || '';
}

export function getBarentsWatchClientSecret() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'barentswatch_client_secret'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.BARENTSWATCH_CLIENT_SECRET || '';
}

export default config;
