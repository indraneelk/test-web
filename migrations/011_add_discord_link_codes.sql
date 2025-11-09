-- Add discord_link_codes table for secure Discord account linking
CREATE TABLE IF NOT EXISTS discord_link_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for faster code lookups
CREATE INDEX IF NOT EXISTS idx_discord_link_codes_code ON discord_link_codes(code);
CREATE INDEX IF NOT EXISTS idx_discord_link_codes_user_id ON discord_link_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_link_codes_expires_at ON discord_link_codes(expires_at);
