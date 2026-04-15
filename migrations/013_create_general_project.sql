-- Create the shared General project visible to all users
INSERT OR IGNORE INTO projects (id, name, description, color, owner_id, is_personal, created_at, updated_at)
VALUES ('general-shared-project', 'General', 'Shared project for all team members', '#4facfe', (SELECT id FROM users WHERE is_admin = 1 LIMIT 1), 0, datetime('now'), datetime('now'));

-- Add all existing users as members of the General project
INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at)
SELECT 'general-shared-project', id, 'member', datetime('now')
FROM users;
