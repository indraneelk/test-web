-- Migration 008: Normalize project members from JSON to table
-- Migrate from projects.members (JSON array) to project_members table

-- Create project_members table if it doesn't exist
CREATE TABLE IF NOT EXISTS project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(project_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);

-- NOTE: Manual step required
-- You need to parse the JSON members array from each project and insert into project_members
-- SQLite doesn't have built-in JSON array parsing for this use case
--
-- Example for a project with members: '["user-1", "user-2"]'
-- INSERT INTO project_members (project_id, user_id) VALUES ('project-id', 'user-1');
-- INSERT INTO project_members (project_id, user_id) VALUES ('project-id', 'user-2');
--
-- After migration, you can optionally drop the members column:
-- ALTER TABLE projects DROP COLUMN members;
-- (Note: SQLite doesn't support DROP COLUMN directly, requires table recreation)
