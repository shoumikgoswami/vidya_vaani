-- A one-time code the school office hands to a new teacher. Only its fingerprint is kept.
CREATE TABLE teacher_code (
  membership_id INTEGER PRIMARY KEY REFERENCES membership(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL UNIQUE,
  expires_at    BIGINT NOT NULL,
  created_at    TEXT NOT NULL
);
