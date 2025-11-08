-- Migration: Add priority column to existing D1 database
-- Run this if upgrading from a version without priority support
-- For D1: wrangler d1 execute DB_NAME --file=migrate-add-priority.sql

-- Add priority column to tasks table
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

-- Update any NULL priorities to 'none' (just in case)
UPDATE tasks SET priority = 'none' WHERE priority IS NULL;
