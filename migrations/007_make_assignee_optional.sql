-- Migration: Make assigned_to_id optional in tasks table
-- This allows tasks to be created without an assignee

-- Create a new tasks table with nullable assigned_to_id
CREATE TABLE IF NOT EXISTS tasks_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL,
    project_id TEXT NOT NULL,
    assigned_to_id TEXT, -- Made nullable
    created_by_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'none',
    archived INTEGER DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (assigned_to_id) REFERENCES users(id),
    FOREIGN KEY (created_by_id) REFERENCES users(id)
);

-- Copy existing data
INSERT INTO tasks_new
SELECT id, name, description, date, project_id, assigned_to_id, created_by_id,
       status, priority, archived, completed_at, created_at, updated_at
FROM tasks;

-- Drop old table
DROP TABLE tasks;

-- Rename new table
ALTER TABLE tasks_new RENAME TO tasks;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived);
