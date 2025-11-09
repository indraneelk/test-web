-- Add Discord integration fields to users table
ALTER TABLE users ADD COLUMN discord_handle TEXT;
ALTER TABLE users ADD COLUMN discord_user_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN discord_verified INTEGER DEFAULT 0;

-- Create index for faster Discord user lookups
CREATE INDEX IF NOT EXISTS idx_users_discord_user_id ON users(discord_user_id);
