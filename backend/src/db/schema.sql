CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  must_change_password INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  ai_chat_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Groups (admin-managed teams)
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Group membership with roles
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

-- Projects v2: normalized, group-shareable
CREATE TABLE IF NOT EXISTS projects_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- App settings (key-value store)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Project-to-group sharing (many-to-many)
CREATE TABLE IF NOT EXISTS project_shares (
  project_id TEXT NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  shared_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, group_id)
);

-- Pinned items (sticky webcams, context balloons) per project
CREATE TABLE IF NOT EXISTS project_pins (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  layer_id TEXT REFERENCES project_layers(id) ON DELETE SET NULL,
  pin_type TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  source TEXT DEFAULT 'user',
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Normalized tactical data (per-project)
CREATE TABLE IF NOT EXISTS project_layers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  source TEXT DEFAULT 'user',
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_markers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  layer_id TEXT REFERENCES project_layers(id) ON DELETE SET NULL,
  sidc TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  designation TEXT DEFAULT '',
  higher_formation TEXT DEFAULT '',
  additional_info TEXT DEFAULT '',
  custom_label TEXT DEFAULT '',
  source TEXT DEFAULT 'user',
  created_by TEXT DEFAULT '',
  properties TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_drawings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_v2(id) ON DELETE CASCADE,
  layer_id TEXT REFERENCES project_layers(id) ON DELETE SET NULL,
  drawing_type TEXT NOT NULL,
  geometry TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  source TEXT DEFAULT 'user',
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
