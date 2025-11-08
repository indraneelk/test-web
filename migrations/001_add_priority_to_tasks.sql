-- Add priority column to tasks table
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';

-- Create index for priority
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
