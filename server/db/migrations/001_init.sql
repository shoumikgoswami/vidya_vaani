-- Vidya Vaani schema (spec section 9, extended for Clerk sign-in and email linking).

CREATE TABLE school (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT,
  logo_path     TEXT,
  qr_mode       TEXT NOT NULL DEFAULT 'per_student' CHECK (qr_mode IN ('per_student','per_school')),
  school_token  TEXT NOT NULL UNIQUE,
  default_lang  TEXT NOT NULL DEFAULT 'hi',
  enabled_langs TEXT NOT NULL DEFAULT '[]',
  academic_year TEXT NOT NULL,
  retention_years INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE user (
  id            INTEGER PRIMARY KEY,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  clerk_user_id TEXT UNIQUE,
  name          TEXT,
  ui_lang       TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE membership (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  school_id   INTEGER NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin','teacher')),
  admin_level TEXT CHECK (admin_level IN ('owner','staff')),
  speak_lang  TEXT,
  subjects    TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, school_id, role)
);

CREATE TABLE class (
  id               INTEGER PRIMARY KEY,
  school_id        INTEGER NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  section          TEXT NOT NULL DEFAULT '',
  academic_year    TEXT NOT NULL,
  class_teacher_id INTEGER REFERENCES membership(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  UNIQUE (school_id, name, section, academic_year)
);

CREATE TABLE class_teacher (
  class_id      INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
  membership_id INTEGER NOT NULL REFERENCES membership(id) ON DELETE CASCADE,
  subjects      TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (class_id, membership_id)
);

CREATE TABLE student (
  id               INTEGER PRIMARY KEY,
  school_id        INTEGER NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  name_normalised  TEXT NOT NULL,
  roll_no          TEXT,
  parent_phone     TEXT,
  parent_email     TEXT,
  token            TEXT NOT NULL UNIQUE,
  token_rotated_at TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);
CREATE INDEX student_class ON student(class_id, active);
CREATE INDEX student_phone ON student(parent_phone);
CREATE INDEX student_email ON student(parent_email);

CREATE TABLE retired_token (
  token      TEXT PRIMARY KEY,
  student_id INTEGER REFERENCES student(id) ON DELETE CASCADE,
  retired_at TEXT NOT NULL
);

CREATE TABLE student_history (
  id            INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  class_id      INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  from_date     TEXT NOT NULL,
  to_date       TEXT
);

CREATE TABLE guardian_link (
  id            INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  relation      TEXT,
  read_lang     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active','pending','rejected','revoked')),
  auto_verified INTEGER NOT NULL DEFAULT 0,
  approved_by   INTEGER REFERENCES membership(id) ON DELETE SET NULL,
  consent_at    TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (student_id, user_id)
);

CREATE TABLE note (
  id                  INTEGER PRIMARY KEY,
  school_id           INTEGER NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  class_id            INTEGER NOT NULL REFERENCES class(id) ON DELETE CASCADE,
  author_user_id      INTEGER REFERENCES user(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('teacher_note','parent_reply')),
  parent_note_id      INTEGER REFERENCES note(id) ON DELETE SET NULL,
  audio_path          TEXT,
  audio_mime          TEXT,
  duration_ms         INTEGER,
  snr_db              REAL,
  lang_hint           TEXT,
  transcript_raw      TEXT,
  transcript_clean    TEXT,
  transcript_lang     TEXT,
  transcript_conf     REAL,
  words               TEXT,
  changes             TEXT,
  ambiguities         TEXT,
  mismatch            INTEGER NOT NULL DEFAULT 0,
  approximate         INTEGER NOT NULL DEFAULT 0,
  edited              INTEGER NOT NULL DEFAULT 0,
  browser_preview_text TEXT,
  stt_provider        TEXT,
  stt_model           TEXT,
  llm_model           TEXT,
  tier                TEXT CHECK (tier IN ('A','B','C','D')),
  status              TEXT NOT NULL DEFAULT 'uploaded'
                      CHECK (status IN ('uploaded','transcribing','ready','transcript_failed','audio_only')),
  capture_ms          INTEGER,
  published_at        TEXT,
  created_at          TEXT NOT NULL,
  client_uuid         TEXT UNIQUE
);
CREATE INDEX note_class ON note(class_id, published_at);

CREATE TABLE note_recipient (
  note_id    INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, student_id)
);
CREATE INDEX recipient_student ON note_recipient(student_id);

CREATE TABLE note_tag (
  id       INTEGER PRIMARY KEY,
  note_id  INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  type     TEXT NOT NULL CHECK (type IN ('homework','fee','exam','event','holiday','notice')),
  subject  TEXT,
  due_date TEXT,
  source   TEXT NOT NULL CHECK (source IN ('llm','rules','teacher'))
);
CREATE INDEX tag_note ON note_tag(note_id);

CREATE TABLE note_translation (
  note_id         INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  lang            TEXT NOT NULL,
  text            TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT,
  machine_warning INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (note_id, lang)
);

CREATE TABLE listen_receipt (
  note_id         INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  first_played_at TEXT NOT NULL,
  play_count      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (note_id, student_id, user_id)
);

CREATE TABLE job (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  run_after  INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','failed')),
  last_error TEXT
);
CREATE INDEX job_due ON job(status, run_after);

CREATE TABLE ai_usage (
  day          TEXT NOT NULL,
  model        TEXT NOT NULL,
  calls        INTEGER NOT NULL DEFAULT 0,
  errors_429   INTEGER NOT NULL DEFAULT 0,
  errors_other INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);

CREATE TABLE otp (
  phone        TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent_count   INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);

CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  device_label TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE push_subscription (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  keys       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE reminder_sent (
  note_id INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  PRIMARY KEY (note_id, user_id, due_date)
);

CREATE TABLE outcome (
  id                INTEGER PRIMARY KEY,
  school_id         INTEGER NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  class_id          INTEGER REFERENCES class(id) ON DELETE SET NULL,
  period            TEXT NOT NULL,
  homework_done_pct INTEGER,
  fee_missed_count  INTEGER,
  entered_by        INTEGER REFERENCES user(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE tts_cache (
  lang       TEXT NOT NULL,
  voice      TEXT NOT NULL,
  text_hash  TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  PRIMARY KEY (lang, voice, text_hash)
);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY,
  actor_user_id INTEGER,
  school_id     INTEGER,
  action        TEXT NOT NULL,
  entity        TEXT,
  entity_id     TEXT,
  meta          TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
