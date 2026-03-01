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

export function getNtfyToken() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ntfy_token'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.NTFY_TOKEN || '';
}

export function getNtfyUrl() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ntfy_url'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.NTFY_URL || 'https://ntfy.intelmap.no';
}

export function getVlmApiToken() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'vlm_api_token'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.VLM_API_TOKEN || '';
}

export function getVlmUrl() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'vlm_url'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.VLM_URL || 'https://vision.homeprem.no';
}

export function getPublicUrl() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'public_url'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return process.env.PUBLIC_URL || 'https://intelmap.homeprem.no';
}

export function getAdminNtfyChannel() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'admin_ntfy_channel'").get();
      if (row?.value) return row.value;
    } catch {}
  }
  return '';
}

export function getAdminNtfyLevels() {
  if (_getDb) {
    try {
      const db = _getDb();
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'admin_ntfy_levels'").get();
      if (row?.value) {
        try {
          return JSON.parse(row.value);
        } catch {}
      }
    } catch {}
  }
  return [];
}

export default config;
