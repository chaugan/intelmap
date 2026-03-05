-- Organizations (top-level tenant)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by TEXT,
  deleted_at TEXT,
  delete_permanently_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-org configuration (API keys, feature flags)
CREATE TABLE IF NOT EXISTS org_settings (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, key)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  must_change_password INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  ai_chat_enabled INTEGER NOT NULL DEFAULT 0,
  ntfy_hash TEXT,
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

-- Map visual themes (user-created, can be shared with groups)
CREATE TABLE IF NOT EXISTS map_themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Theme sharing with groups
CREATE TABLE IF NOT EXISTS theme_shares (
  theme_id TEXT NOT NULL REFERENCES map_themes(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  shared_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (theme_id, group_id)
);

-- Timelapse: camera capture jobs (ONE per camera, shared by all subscribers)
CREATE TABLE IF NOT EXISTS timelapse_cameras (
  camera_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  lat REAL,
  lon REAL,
  is_protected INTEGER NOT NULL DEFAULT 0,
  is_capturing INTEGER NOT NULL DEFAULT 0,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  last_frame_at TEXT,
  available_from TEXT,
  available_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Timelapse: user subscriptions (many users can subscribe to same camera)
CREATE TABLE IF NOT EXISTS timelapse_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camera_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, camera_id)
);

-- Timelapse: export jobs
CREATE TABLE IF NOT EXISTS timelapse_exports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camera_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  file_path TEXT,
  file_size INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_timelapse_subs_camera ON timelapse_subscriptions(camera_id);
CREATE INDEX IF NOT EXISTS idx_timelapse_subs_user ON timelapse_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_timelapse_exports_user ON timelapse_exports(user_id);

-- Timelapse: frame index for fast lookups (replaces filesystem scans)
CREATE TABLE IF NOT EXISTS timelapse_frames (
  id INTEGER PRIMARY KEY,
  camera_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  UNIQUE(camera_id, filename)
);
CREATE INDEX IF NOT EXISTS idx_frames_camera_ts ON timelapse_frames(camera_id, timestamp);

-- Timelapse: HLS segment tracking for incremental generation
CREATE TABLE IF NOT EXISTS timelapse_segments (
  id INTEGER PRIMARY KEY,
  camera_id TEXT NOT NULL,
  segment_name TEXT NOT NULL,
  start_timestamp TEXT NOT NULL,
  end_timestamp TEXT NOT NULL,
  frame_count INTEGER NOT NULL,
  duration_seconds REAL NOT NULL,
  UNIQUE(camera_id, segment_name)
);
CREATE INDEX IF NOT EXISTS idx_segments_camera ON timelapse_segments(camera_id, start_timestamp);

-- VLM Monitoring: user subscriptions (one per user per camera)
CREATE TABLE IF NOT EXISTS monitor_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camera_id TEXT NOT NULL,
  camera_name TEXT,
  lat REAL,
  lon REAL,
  labels TEXT NOT NULL DEFAULT '[]',
  snooze_minutes INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, camera_id)
);

-- VLM Monitoring: detection history (with annotated images)
CREATE TABLE IF NOT EXISTS monitor_detections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camera_id TEXT NOT NULL,
  labels_monitored TEXT NOT NULL,
  labels_detected TEXT NOT NULL,
  total_detections INTEGER NOT NULL,
  detected_at TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 1,
  has_image INTEGER NOT NULL DEFAULT 0,
  has_raw_image INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- VLM Monitoring: snooze state (when user was last notified per camera)
CREATE TABLE IF NOT EXISTS monitor_snooze_state (
  user_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  last_notified_at TEXT NOT NULL,
  PRIMARY KEY (user_id, camera_id)
);

-- VLM Monitoring: active camera monitors (aggregated across all users)
CREATE TABLE IF NOT EXISTS monitor_cameras (
  camera_id TEXT PRIMARY KEY,
  labels TEXT NOT NULL DEFAULT '[]',
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  is_capturing INTEGER NOT NULL DEFAULT 0,
  last_check_at TEXT,
  last_detection_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitor_subs_camera ON monitor_subscriptions(camera_id);
CREATE INDEX IF NOT EXISTS idx_monitor_subs_user ON monitor_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_detections_user ON monitor_detections(user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_detections_camera ON monitor_detections(camera_id);

-- Admin Event Log: system events for admin console
CREATE TABLE IF NOT EXISTS admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK(level IN ('error', 'warning', 'info')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_events_level ON admin_events(level);
CREATE INDEX IF NOT EXISTS idx_admin_events_category ON admin_events(category);
CREATE INDEX IF NOT EXISTS idx_admin_events_created ON admin_events(created_at DESC);

-- Share tokens (direct link access for themes/projects)
CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_share_tokens_resource ON share_tokens(resource_type, resource_id);

-- Organization indexes
CREATE INDEX IF NOT EXISTS idx_org_deleted ON organizations(delete_permanently_at)
  WHERE delete_permanently_at IS NOT NULL;
