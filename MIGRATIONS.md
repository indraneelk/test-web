# Database Schema and Migrations (Canonical)

This document defines the canonical database schema used by the Cloudflare Worker (production) and how to apply/maintain migrations across environments.

## Canonical Schema (D1/SQLite)

- users
  - id TEXT PRIMARY KEY            // equals Supabase `sub` (stateless auth)
  - username TEXT UNIQUE NOT NULL
  - password_hash TEXT             // for legacy/bcrypt users; use placeholder 'supabase' for Supabase
  - name TEXT NOT NULL
  - email TEXT
  - initials TEXT
  - color TEXT                      // UI avatar color
  - is_admin INTEGER DEFAULT 0
  - created_at TEXT NOT NULL
  - updated_at TEXT NOT NULL

- projects
  - id TEXT PRIMARY KEY
  - name TEXT NOT NULL UNIQUE
  - description TEXT
  - color TEXT NOT NULL DEFAULT '#f06a6a'
  - is_personal INTEGER NOT NULL DEFAULT 0
  - owner_id TEXT NOT NULL REFERENCES users(id)
  - created_at TEXT NOT NULL
  - updated_at TEXT NOT NULL

- project_members (normalized membership)
  - id INTEGER PRIMARY KEY AUTOINCREMENT
  - project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  - user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  - role TEXT DEFAULT 'member'
  - added_at TEXT NOT NULL
  - UNIQUE(project_id, user_id)

- tasks
  - id TEXT PRIMARY KEY
  - name TEXT NOT NULL
  - description TEXT NOT NULL
  - date TEXT NOT NULL              // ISO date (YYYY-MM-DD)
  - project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  - assigned_to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  - created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  - status TEXT NOT NULL DEFAULT 'pending'
  - priority TEXT NOT NULL DEFAULT 'none'   // 'high' | 'medium' | 'low' | 'none'
  - archived INTEGER NOT NULL DEFAULT 0
  - completed_at TEXT                     // nullable
  - created_at TEXT NOT NULL
  - updated_at TEXT NOT NULL

- activity_logs
  - id TEXT PRIMARY KEY
  - user_id TEXT REFERENCES users(id) ON DELETE SET NULL
  - task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE
  - project_id TEXT REFERENCES projects(id) ON DELETE CASCADE
  - action TEXT NOT NULL
  - details TEXT
  - created_at TEXT NOT NULL

Indexes (recommended):
- users(username)
- projects(owner_id)
- project_members(project_id), project_members(user_id)
- tasks(project_id), tasks(assigned_to_id), tasks(status), tasks(priority), tasks(date)
- activity_logs(user_id), activity_logs(project_id), activity_logs(created_at)

Notes:
- We standardized on `users.id = Supabase sub` (JWT subject). The optional `supabase_id` column present in older migrations is now deprecated; keep it if it exists, but it is not used by production code.
- `projects.members` JSON is deprecated. Use `project_members` instead.

## Migration Series (Repo)

The repo contains the following migration files (some are legacy):

1) 0001_initial_schema.sql (legacy baseline)
   - Creates users, projects (with a JSON `members` column), tasks (includes `archived`, `completed_at`), activity_logs.
   - Legacy design. Current code uses normalized membership.

2) 001_add_priority_to_tasks.sql
   - Adds `priority` to tasks + index.

3) 002_add_color_to_projects.sql
   - Adds `color` to projects + backfill.

4) 003_add_is_personal_to_projects.sql
   - Adds `is_personal` to projects + backfill heuristic.

5) 004_add_initials_to_users.sql
   - Adds `initials` to users.

6) 005_add_supabase_support.sql (optional legacy)
   - Adds `supabase_id` and `users.color`, and an index on `supabase_id`.
   - With the canonical model, prefer `users.id = sub` and treat `supabase_id` as deprecated.

7) 006_migrate_json_data.sql (example data import)
   - Data import helper from JSON era. Requires column name remapping (see below) before use.

## Normalization: Members JSON → project_members

If your DB was created from the legacy 0001 with `projects.members` JSON, create a normalization migration to:
1. Create `project_members` table (see canonical schema)
2. Backfill rows by reading each project's `members` array (owner is implicit; do not duplicate as member)
3. Remove or ignore `projects.members`

This step is required for production code which expects `project_members`.

## 006 Data Import: Column Mapping

The sample 006 script uses older names; remap before running:
- tasks.title → tasks.name
- tasks.due_date → tasks.date
- tasks.assignee_id → tasks.assigned_to_id
- projects must include `owner_id` (set appropriately)
- Ensure `archived` (0/1) and `completed_at` are handled

Always validate imports in a staging DB first with `wrangler d1 execute`.

## Applying Migrations

Recommended: create DB, then apply in order with your normalization migration inserted when needed.

```bash
wrangler d1 execute <DB_NAME> --file=./migrations/0001_initial_schema.sql
wrangler d1 execute <DB_NAME> --file=./migrations/001_add_priority_to_tasks.sql
wrangler d1 execute <DB_NAME> --file=./migrations/002_add_color_to_projects.sql
wrangler d1 execute <DB_NAME> --file=./migrations/003_add_is_personal_to_projects.sql
wrangler d1 execute <DB_NAME> --file=./migrations/004_add_initials_to_users.sql
# Optional legacy:
wrangler d1 execute <DB_NAME> --file=./migrations/005_add_supabase_support.sql
# Your normalization migration here (if you started from JSON members)
# Optional data import after mapping corrections:
wrangler d1 execute <DB_NAME> --file=./migrations/006_migrate_json_data.sql
```

## Production Expectations

The Worker (`worker.js`) expects:
- Normalized membership (`project_members`)
- `tasks` has `archived` and optionally `completed_at`
- `users.id == Supabase sub`

Keep schema and migrations aligned with the above to avoid runtime issues.

