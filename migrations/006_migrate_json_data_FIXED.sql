-- Data Migration from JSON to D1 (FIXED VERSION)
-- This migration properly maps fields from JSON storage to D1 schema
-- Run after: 0001_initial_schema.sql and incremental migrations 001-005

-- Migrate Users
-- Note: Using COALESCE to provide defaults for NULL timestamps
INSERT OR IGNORE INTO users (id, username, password_hash, name, email, initials, color, is_admin, created_at, updated_at)
VALUES
  ('user-admin', 'admin', '$2a$10$JmKC3hTd0epIcqmkvg71LOO0Ge17pRvO4gR2wDLo5gjcV9ZeiJcEG', 'Admin User', 'admin@example.com', 'AU', '#3b82f6', 1,
   COALESCE(NULL, datetime('now')), COALESCE(NULL, datetime('now')));

-- Migrate Projects
-- Note: owner_id is now properly included; members field will be migrated to project_members table
INSERT OR IGNORE INTO projects (id, name, description, color, owner_id, members, is_personal, created_at, updated_at)
VALUES
  ('project-admin-personal', 'Admin User''s Personal Tasks', 'Personal tasks and to-dos', '#3b82f6', 'user-admin', '[]', 1,
   '2025-11-08T00:36:15.288Z', '2025-11-08T02:06:45.373Z');

-- Migrate Project Members from JSON arrays
-- Extract members from the JSON 'members' field and insert into project_members table
-- (This section would need custom logic per-project based on actual JSON data)

-- Migrate Tasks
-- Note: Field mapping fixes:
--   - JSON 'name' -> D1 'name' (was incorrectly mapped to 'title')
--   - JSON 'date' -> D1 'date' (was incorrectly mapped as 'due_date')
--   - JSON 'assigned_to_id' -> D1 'assigned_to_id' (was incorrectly mapped as 'assignee_id')
--   - Added: archived, completed_at fields (supported by schema)
INSERT OR IGNORE INTO tasks (id, name, description, date, project_id, assigned_to_id, created_by_id, status, priority, archived, completed_at, created_at, updated_at)
VALUES
  ('task-example-1', 'Example Task', 'Task description', '2025-11-08', 'project-admin-personal', 'user-admin', 'user-admin',
   'pending', 'medium', 0, NULL, '2025-11-08T02:01:04.589Z', '2025-11-08T02:31:08.029Z');

-- Migrate Activity Logs
-- Note: Using 'activity_log' (singular) to match schema.sql
-- Field renamed from 'created_at' to 'timestamp' to match actual schema
INSERT OR IGNORE INTO activity_log (id, user_id, action, details, task_id, project_id, timestamp)
VALUES
  (1, 'user-admin', 'user_login', 'User Admin User logged in', NULL, NULL, '2025-11-08T00:38:54.217Z');

-- TODO: Replace example data above with actual JSON data conversion
-- This is a TEMPLATE showing correct field mapping
