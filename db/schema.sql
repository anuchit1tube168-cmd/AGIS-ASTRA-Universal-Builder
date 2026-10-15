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

CREATE TABLE IF NOT EXISTS skill_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  owner TEXT NOT NULL,
  source_path TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'DRAFT',
  test_status TEXT NOT NULL DEFAULT 'PENDING',
  security_status TEXT NOT NULL DEFAULT 'PENDING',
  distribution_targets TEXT NOT NULL DEFAULT '[]',
  production_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_skill_catalog_state ON skill_catalog(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS skill_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(skill_id) REFERENCES skill_catalog(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skill_events_skill_created ON skill_events(skill_id, created_at DESC);

CREATE TABLE IF NOT EXISTS skill_candidates (
  id TEXT PRIMARY KEY,
  source_task_id TEXT NOT NULL UNIQUE,
  extractor_task_id TEXT UNIQUE,
  suggested_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '0.1.0',
  owner TEXT NOT NULL DEFAULT 'ASTRA Skill Factory',
  capability TEXT NOT NULL DEFAULT '',
  procedure_json TEXT NOT NULL DEFAULT '[]',
  acceptance_tests_json TEXT NOT NULL DEFAULT '[]',
  failure_modes_json TEXT NOT NULL DEFAULT '[]',
  distribution_targets TEXT NOT NULL DEFAULT '["codex","hermes","opencode"]',
  status TEXT NOT NULL DEFAULT 'AWAITING_RUNTIME',
  test_status TEXT NOT NULL DEFAULT 'PENDING',
  security_status TEXT NOT NULL DEFAULT 'PENDING',
  review_note TEXT,
  raw_output TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_task_id) REFERENCES tasks(id),
  FOREIGN KEY(extractor_task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_skill_candidates_status_created ON skill_candidates(status, created_at DESC);

CREATE TABLE IF NOT EXISTS skill_sync_plans (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'dry-run',
  state_snapshot TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  executed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(skill_id) REFERENCES skill_catalog(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skill_sync_plans_skill_created ON skill_sync_plans(skill_id, created_at DESC);

INSERT OR IGNORE INTO agents(id,name,status,capability) VALUES
('astra6','ASTRA 6','primary','orchestration,architecture,routing'),
('hermes','Hermes','approved','24x7 runtime,telegram,skills'),
('codex','Codex','approved','coding,implementation,review'),
('context7','Context7','approved','current versioned documentation'),
('playwright','Playwright','approved','browser verification'),
('rea-scout','REA Scout','staging','authorized analysis,evidence,architecture,feature mapping,clean-room handoff'),
('skill-registry','ASTRA Skill Factory','staging','skill extraction,validation,promotion,registry governance'),
('skill-extractor','ASTRA Skill Extractor','staging','extract reusable patterns into review-gated skill candidates');

INSERT OR IGNORE INTO skill_catalog(
  id,name,version,owner,source_path,state,test_status,security_status,distribution_targets,production_approved
) VALUES
('rea-evidence-scout','REA Evidence Scout','1.0.0','REA Scout','agents/rea-scout/SKILL.md','SECURITY_REVIEWED','PASS','PASS','["codex","hermes","opencode"]',0),
('astra-skill-registry-management','ASTRA Skill Registry Management','1.0.0','ASTRA Skill Factory','agents/skill-registry/SKILL.md','VALIDATED','PASS','PENDING','["codex","hermes","opencode"]',0),
('astra-skill-extractor','ASTRA Skill Extractor','0.1.0','ASTRA Skill Factory','agents/skill-extractor/SKILL.md','DRAFT','PENDING','PENDING','["codex","hermes","opencode","antigravity"]',0);
