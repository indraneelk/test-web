# Cloudflare Deployment Guide

## Summary

This guide walks you through deploying your Task Manager to Cloudflare with:
- ✅ Cloudflare Workers (backend API)
- ✅ Cloudflare D1 (database)
- ✅ Cloudflare Pages (frontend hosting)
- ✅ JWT-based authentication (stateless)
- ✅ Plan A: Polling for updates (30-60s)
- ✅ Plan B: Supabase Realtime for instant updates

## Prerequisites

1. Cloudflare account (free tier works)
2. Wrangler CLI installed: `npm install -g wrangler`
3. Authenticated: `wrangler login`

## Step 1: Create D1 Database

```bash
# Create database
wrangler d1 create task-manager-db

# Copy the database_id from output and update wrangler.toml
# It will look like: database_id = "xxxxx-xxxx-xxxx-xxxx-xxxxxxx"
```

Update `wrangler.toml` line 9 with your database_id.

## Step 2: Run Database Migrations

Apply the schema and repo migrations:

```bash
wrangler d1 execute task-manager-db --file=./schema.sql
wrangler d1 execute task-manager-db --file=./migrations/002_add_color_to_projects.sql
wrangler d1 execute task-manager-db --file=./migrations/003_add_is_personal_to_projects.sql
wrangler d1 execute task-manager-db --file=./migrations/004_add_initials_to_users.sql
```

## Step 3: Add Secrets (provide your own values)

```bash
wrangler secret put SUPABASE_URL              # e.g. https://<project-ref>.supabase.co
wrangler secret put SUPABASE_ANON_KEY         # public anon key (safe for client)
wrangler secret put SUPABASE_JWT_SECRET       # ONLY if your project uses HS256
wrangler secret put SESSION_SECRET            # if you keep cookie sessions (not needed for pure Bearer)

# Optional: only if you plan server-side admin calls to Supabase
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## Step 4: Choose a Topology

### Option 1 (Recommended): Pages + Pages Functions (single domain)

- Host UI and API together. Add a `functions/` directory (or a root `_worker.js`) for API routes.
- Bind D1 and secrets to the Pages project in `wrangler.toml`.

Deploy:

```bash
wrangler pages deploy public --project-name=team-task-manager
```

### Option 2: Separate Worker (API) + Pages (UI)

- Deploy the API Worker and the static UI via Pages.

```bash
wrangler deploy
wrangler pages deploy public --project-name=team-task-manager
```

Frontend configuration for Option 2:
- Expose `/api/config/public` from the Worker to return API base URL and Supabase public info.
- The UI fetches that JSON and configures endpoints dynamically; avoid hardcoded domains in code.

## Architecture Overview

```
┌─────────────────────────────────────┐
│  Cloudflare Pages (Frontend)        │
│  https://your-app.pages.dev         │
└──────────────┬──────────────────────┘
               │ API Calls
               ↓
┌─────────────────────────────────────┐
│  Cloudflare Worker (Backend)        │
│  - JWT Authentication               │
│  - All API Endpoints                │
│  - Supabase Realtime Integration    │
└──────────┬──────────────────────────┘
           │
           ↓
┌─────────────────────────────────────┐
│  D1 Database                        │
│  - users, tasks, projects           │
│  - activity_logs                    │
└─────────────────────────────────────┘

External Services:
- Supabase Auth (email/password, magic links)
- Supabase Realtime (Plan B - instant updates)
```

## Key Differences from Local Setup

### Authentication
- **Local**: Express sessions (Node)
- **Cloudflare**: Stateless JWT verification per request (Authorization: Bearer). Prefer this across Pages/Workers.

### Database
- **Local**: JSON files in `data/`
- **Cloudflare**: D1 SQL database

### Real-time Updates
- **Plan A**: Polling every 30–60s + refetch on tab focus and after writes
- **Plan B**: Supabase Realtime broadcast channels

## Plan B: Supabase Realtime Implementation

The `broadcastChange()` function in worker.js is ready to use. To complete Plan B:

### Backend (worker.js)
Add broadcast calls after each mutation (example):

```javascript
// After creating a task
await broadcastChange(env, 'task-created', { task });

// After updating a task
await broadcastChange(env, 'task-updated', { task: updatedTask });

// After deleting a task
await broadcastChange(env, 'task-deleted', { taskId });

// After creating/updating/deleting projects
await broadcastChange(env, 'project-created', { project });
await broadcastChange(env, 'project-updated', { project });
await broadcastChange(env, 'project-deleted', { projectId });
```

### Frontend (app-auth.js)
Add Supabase Realtime subscription after loadData():

```javascript
// Initialize Supabase client (add near top of file)
const supabase = window.supabase.createClient(
    'SUPABASE_URL',  // From /api/config/public
    'SUPABASE_ANON_KEY'
);

// Subscribe to realtime channel (in DOMContentLoaded)
const channel = supabase.channel('task-updates')
    .on('broadcast', { event: 'task-created' }, () => loadData())
    .on('broadcast', { event: 'task-updated' }, () => loadData())
    .on('broadcast', { event: 'task-deleted' }, () => loadData())
    .on('broadcast', { event: 'project-created' }, () => loadData())
    .on('broadcast', { event: 'project-updated' }, () => loadData())
    .on('broadcast', { event: 'project-deleted' }, () => loadData())
    .subscribe();
```

## Next Steps

1. **Implement Functions/_worker.js** – Port API endpoints (stateless JWT, D1 binding)
2. **Add Plan A polling** – Frontend refetches tasks periodically + on focus/after POST/PUT
3. **Add Plan B Supabase Realtime** – Server publishes broadcast after D1 writes; clients refetch scope
4. **Test authentication flow** – JOSE verify with JWKS (RS256) or HMAC (HS256); validate iss/aud
5. **Migrate existing data** – Export from JSON, import to D1 using schema+migrations

## Files Created/Modified

- ✅ `schema.sql` + `migrations/002/003/004` – D1 schema + migrations
- ✅ `wrangler.toml` – Bind D1 and secrets
- ✅ `functions/_worker.js` (or `worker.js`) – Stateless API (scaffolded)
- ✅ `public/app-auth.js` – Plan A polling + Bearer wiring; optional Plan B subscription
- ⏳ `public/realtime.js` – Optional helper for Plan B

## Status

- [x] D1 Schema/Migrations ready
- [x] Wrangler configuration updated
- [x] Functions/_worker.js scaffold added (health, db-check, auth/me)
- [x] Plan A polling implemented in frontend
- [~] Plan B Supabase Realtime hooks: server helper + client subscription placeholder
- [ ] Deployment testing

## Developer Notes

The current Worker scaffold is outdated and doesn't include:
- Stateless JWT verification (JOSE), strict `iss`/`aud` checks
- API endpoints ported from server-auth.js
- Supabase Realtime publish logic

Recommendation:
- Use Pages Functions or `_worker.js` and verify JWT per request (JOSE + JWKS, HS256 fallback).
- Use `env.DB` for D1.

## Frontend Authorization: Bearer

The UI sends Supabase access tokens automatically with each API call.

Pattern used in `public/app-auth.js`:

```js
async function ensureSupabase() {
  if (window.supabase && !window._supa) {
    const cfg = await (await fetch('/api/config/public')).json();
    window._supa = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  return window._supa || null;
}

async function getAccessToken() {
  try {
    const client = await ensureSupabase();
    if (client) {
      const { data } = await client.auth.getSession();
      if (data?.session?.access_token) return data.session.access_token;
    }
  } catch {}
  return sessionStorage.getItem('sb_at') || null;
}

async function authFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers, credentials: token ? undefined : 'include' });
}
```

Notes:
- When a Supabase token is available, we attach `Authorization: Bearer <token>` and do not send cookies.
- If no token is found, we fall back to cookie mode for local dev.
- Login stores the Supabase access token in `sessionStorage` as `sb_at` for immediate use.

## Pages Functions Scaffold

Added a minimal `functions/_worker.js` with:
- JOSE JWT verification (JWKS preferred, HS256 fallback) and strict `iss`/`aud` checks
- `GET /api/health` → { ok: true }
- `GET /api/db-check` → counts from D1 (users/projects/tasks)
- `GET /api/auth/me` → returns the current user (by Supabase `sub`)

Bind your D1 and secrets in `wrangler.toml` for the Pages project. Example:

```toml
[[d1_databases]]
binding = "DB"
database_name = "task-manager-db"
database_id = "<your-database-id>"
```

## Plan B: Notes

- Server helper `broadcastChange()` exists in `worker.js` to publish to a `task-updates` channel.
- Clients subscribe when `window.supabase` is available; otherwise Plan B is skipped gracefully.
- Scope channels per project later (e.g., `tasks-<projectId>`) to reduce reloads.
- Prefer Bearer tokens over cookies across domains.
- Optionally prewarm JWKS on boot to reduce cold-start latency.
