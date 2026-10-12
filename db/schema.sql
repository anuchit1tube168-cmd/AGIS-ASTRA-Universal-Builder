PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  capability TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runtime_heartbeat (
  runtime_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  detail TEXT,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rea_cases (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  name TEXT NOT NULL,
  target_reference TEXT NOT NULL,
  target_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  authorization_confirmed INTEGER NOT NULL DEFAULT 0,
  environment TEXT NOT NULL DEFAULT 'staging-only',
  production_write INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'intake',
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_rea_cases_status_created ON rea_cases(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rea_cases_task ON rea_cases(task_id);

CREATE TABLE IF NOT EXISTS rea_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(case_id) REFERENCES rea_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rea_events_case_created ON rea_events(case_id, created_at DESC);

INSERT OR IGNORE INTO agents(id,name,status,capability) VALUES
('astra6','ASTRA 6','primary','orchestration,architecture,routing'),
('hermes','Hermes','approved','24x7 runtime,telegram,skills'),
('codex','Codex','approved','coding,implementation,review'),
('context7','Context7','approved','current versioned documentation'),
('playwright','Playwright','approved','browser verification'),
('rea-scout','REA Scout','staging','authorized analysis,evidence,architecture,feature mapping,clean-room handoff');
