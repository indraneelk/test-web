-- Migration: Add Supabase authentication support
-- Adds supabase_id and color fields to users table

-- Add supabase_id column (for linking to Supabase auth users)
ALTER TABLE users ADD COLUMN supabase_id TEXT UNIQUE;

-- Add color column (for user avatars/identification)
ALTER TABLE users ADD COLUMN color TEXT DEFAULT '#4ECDC4';

-- Make password_hash nullable (since Supabase users won't have passwords)
-- Note: SQLite doesn't support ALTER COLUMN directly, so we work around it

-- Create index for faster Supabase ID lookups
CREATE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_id);

-- Update existing users to have colors
UPDATE users SET color = '#FF6B6B' WHERE color IS NULL;
