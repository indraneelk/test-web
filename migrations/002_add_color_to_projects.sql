-- Add color column to projects table
-- Run with: wrangler d1 execute DB_NAME --file=migrations/002_add_color_to_projects.sql

ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT '#f06a6a';

-- Backfill any NULLs just in case
UPDATE projects SET color = '#f06a6a' WHERE color IS NULL OR color = '';

