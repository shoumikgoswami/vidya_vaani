-- Which sign-in a session came through: 'family' (teachers and parents) or 'school' (office staff).
ALTER TABLE session ADD COLUMN portal TEXT NOT NULL DEFAULT 'family' CHECK (portal IN ('family','school'));
