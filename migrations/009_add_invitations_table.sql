-- Migration: Add invitations tracking for admin panel
-- Allows admins to send magic links and track who has joined

CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    invited_by_user_id TEXT NOT NULL,
    invited_at TEXT NOT NULL DEFAULT (datetime('now')),
    magic_link_sent_at TEXT,
    joined_at TEXT,
    joined_user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    -- status: 'pending', 'accepted', 'expired'
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (joined_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON invitations(invited_by_user_id);
