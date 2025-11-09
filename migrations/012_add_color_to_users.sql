-- Add color column to users table for avatar customization
ALTER TABLE users ADD COLUMN color TEXT DEFAULT '#667eea';
