-- Add is_personal flag to projects
-- Run with: wrangler d1 execute DB_NAME --file=migrations/003_add_is_personal_to_projects.sql

ALTER TABLE projects ADD COLUMN is_personal INTEGER NOT NULL DEFAULT 0;

-- Backfill heuristic: mark projects that follow the personal naming pattern
UPDATE projects
SET is_personal = 1
WHERE name LIKE '%''s Personal Tasks' AND (is_personal IS NULL OR is_personal = 0);

