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

/**
 * Get org-scoped setting with fallback to app_settings then env.
 * @param {string} key - Setting key
 * @param {string|null} orgId - Organization ID (null = global only)
 * @param {string} envFallback - Environment variable value
 */
function getSettingWithOrgFallback(key, orgId, envFallback) {
  if (_getDb) {
    try {
      const db = _getDb();
      // Try org_settings first if orgId provided
      if (orgId) {
        const orgRow = db.prepare('SELECT value FROM org_settings WHERE org_id = ? AND key = ?').get(orgId, key);
        if (orgRow?.value) return orgRow.value;
      }
      // Fallback to app_settings
      const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
      if (row?.value) return row.value;
    } catch {}
  }
  return envFallback;
}

export function getAnthropicApiKey(orgId = null) {
  return getSettingWithOrgFallback('anthropic_api_key', orgId, process.env.ANTHROPIC_API_KEY || '');
}

export function getGoogleMapsApiKey(orgId = null) {
  return getSettingWithOrgFallback('google_maps_api_key', orgId, process.env.GOOGLE_MAPS_API_KEY || '');
}

export function getBarentsWatchClientId(orgId = null) {
  return getSettingWithOrgFallback('barentswatch_client_id', orgId, process.env.BARENTSWATCH_CLIENT_ID || '');
}

export function getBarentsWatchClientSecret(orgId = null) {
  return getSettingWithOrgFallback('barentswatch_client_secret', orgId, process.env.BARENTSWATCH_CLIENT_SECRET || '');
}

export function getNtfyToken(orgId = null) {
  return getSettingWithOrgFallback('ntfy_token', orgId, process.env.NTFY_TOKEN || '');
}

export function getNtfyUrl(orgId = null) {
  return getSettingWithOrgFallback('ntfy_url', orgId, process.env.NTFY_URL || 'https://ntfy.intelmap.no');
}

export function getVlmApiToken(orgId = null) {
  return getSettingWithOrgFallback('vlm_api_token', orgId, process.env.VLM_API_TOKEN || '');
}

export function getVlmUrl(orgId = null) {
  return getSettingWithOrgFallback('vlm_url', orgId, process.env.VLM_URL || 'https://vision.homeprem.no');
}

export function getPublicUrl() {
  return getSettingWithOrgFallback('public_url', null, process.env.PUBLIC_URL || 'https://intelmap.homeprem.no');
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
