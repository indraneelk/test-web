-- Data Migration from JSON to D1 (CORRECTED)
-- This migration is a TEMPLATE - replace with actual data when migrating
-- Field mapping fixes applied:
--   ✓ activity_log (not activity_logs)
--   ✓ timestamp (not created_at)
--   ✓ INTEGER id for activity_log (not TEXT)
--   ✓ Projects include owner_id
--   ✓ Tasks use correct field names

-- NOTE: This is a template. Run the actual migration script that reads from JSON files
-- when you're ready to migrate production data.

-- Example of correct user insertion:
-- INSERT OR IGNORE INTO users (id, username, password_hash, name, email, initials, color, is_admin, created_at, updated_at)
-- VALUES ('user-xxx', 'username', NULL, 'Full Name', 'email@example.com', 'FN', '#3b82f6', 0, datetime('now'), datetime('now'));

-- Example of correct project insertion with owner_id:
-- INSERT OR IGNORE INTO projects (id, name, description, color, owner_id, members, is_personal, created_at, updated_at)
-- VALUES ('project-xxx', 'Project Name', 'Description', '#4facfe', 'user-xxx', '["user-yyy"]', 0, datetime('now'), datetime('now'));

-- Example of correct project_members insertion:
-- INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
-- VALUES ('project-xxx', 'user-yyy', 'member', datetime('now'));

-- Example of correct task insertion:
-- INSERT OR IGNORE INTO tasks (id, name, description, date, project_id, assigned_to_id, created_by_id, status, priority, archived, completed_at, created_at, updated_at)
-- VALUES ('task-xxx', 'Task Name', 'Description', '2025-11-08', 'project-xxx', 'user-xxx', 'user-yyy', 'pending', 'medium', 0, NULL, datetime('now'), datetime('now'));

-- Example of correct activity_log insertion:
-- INSERT OR IGNORE INTO activity_log (user_id, task_id, project_id, action, details, timestamp)
-- VALUES ('user-xxx', 'task-xxx', 'project-xxx', 'task_created', 'Task created', datetime('now'));

-- To generate actual migration from JSON:
-- Run: node scripts/generate-migration-from-json.js > migrations/006_migrate_json_data.sql
