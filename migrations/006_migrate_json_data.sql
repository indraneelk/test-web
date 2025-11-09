-- Data Migration from JSON to D1
-- Generated: 2025-11-09T15:46:13.903Z

-- Migrate Users (no password needed for Supabase auth users)
INSERT OR IGNORE INTO users (id, username, password_hash, name, email, initials, is_admin, discord_handle, discord_user_id, discord_verified, created_at, updated_at)
VALUES ('4a93c227-b18d-40b8-acf1-2c9ef07a815f', 'Neel', 'SUPABASE_AUTH', 'Indraneel Kasmalkar', 'indraneel.kasmalkar@gmail.com', 'IK', 0, 'neel.gk', '1297479046287986742', 1, '2025-11-08T23:39:05.456Z', '2025-11-09T15:35:36.905Z');

-- Migrate Projects
INSERT OR IGNORE INTO projects (id, name, description, color, is_personal, owner_id, created_at, updated_at)
VALUES ('project-1762645145457-5er3fbud1', 'Indraneel Kasmalkar''s Personal Tasks', 'Personal tasks and to-dos', '#4ECDC4', 1, '4a93c227-b18d-40b8-acf1-2c9ef07a815f', '2025-11-08T23:39:05.457Z', '2025-11-08T23:39:05.457Z');
