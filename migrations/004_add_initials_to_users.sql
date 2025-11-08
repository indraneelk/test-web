-- Add initials column to users
-- Run with: wrangler d1 execute DB_NAME --file=migrations/004_add_initials_to_users.sql

ALTER TABLE users ADD COLUMN initials TEXT;

