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

```bash
# Apply the schema
wrangler d1 execute task-manager-db --file=./migrations/0001_initial_schema.sql
```

## Step 3: Add Secrets

```bash
# Add all required secrets
wrangler secret put SUPABASE_ANON_KEY
# Paste: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94YmFzd3B5eHJ5dnlnYW1ndHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1Njc2NjQsImV4cCI6MjA3ODE0MzY2NH0.Et4f6gG_wDecBkvLvuZLtvaumkUo_URTPj5hw7nD1fI

wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Paste: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94YmFzd3B5eHJ5dnlnYW1ndHN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjU2NzY2NCwiZXhwIjoyMDc4MTQzNjY0fQ.kXbCxeNwuzfK_nZJ-XRyD8lZdSmi-CeHeOUU7icox8U

wrangler secret put SUPABASE_JWT_SECRET
# Paste: Wj0qMDoTMW1MsmSulmFy7In5uJniONjo1Ec1aDqH7Lk26ZzG5JEMKSilPSeKl4NBfquZVn8H9s8UCOqQkXVGCw==

wrangler secret put SESSION_SECRET
# Generate a random string: openssl rand -base64 32
```

## Step 4: Deploy Worker

```bash
# Deploy to Cloudflare
wrangler deploy

# Your API will be available at:
# https://team-task-manager.<your-subdomain>.workers.dev
```

## Step 5: Deploy Frontend (Pages)

```bash
# Deploy static files
wrangler pages deploy public --project-name=team-task-manager

# Your frontend will be at:
# https://team-task-manager.pages.dev
```

## Step 6: Update Frontend API URL

Edit `public/app-auth.js` and update the API URLs to point to your Worker:

```javascript
// Change from:
const API_AUTH = '/api/auth';
const API_TASKS = '/api/tasks';

// To:
const API_AUTH = 'https://team-task-manager.<your-subdomain>.workers.dev/api/auth';
const API_TASKS = 'https://team-task-manager.<your-subdomain>.workers.dev/api/tasks';
```

Or use environment-based configuration:
```javascript
const WORKER_URL = window.location.hostname.includes('localhost')
    ? 'http://localhost:5001'
    : 'https://team-task-manager.<your-subdomain>.workers.dev';
```

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
│  - refresh_tokens                   │
└─────────────────────────────────────┘

External Services:
- Supabase Auth (email/password, magic links)
- Supabase Realtime (Plan B - instant updates)
```

## Key Differences from Local Setup

### Authentication
- **Local**: Express sessions stored in files
- **Cloudflare**: JWT tokens in httpOnly cookies

### Database
- **Local**: JSON files in `data/`
- **Cloudflare**: D1 SQL database

### Real-time Updates
- **Plan A**: Polling every 30-60s
- **Plan B**: Supabase Realtime channels

## Next Steps

1. **Complete worker.js** - Full implementation needed (currently the old version exists)
2. **Add Plan A polling** - Frontend refetches tasks periodically
3. **Add Plan B Supabase Realtime** - Worker broadcasts changes
4. **Test authentication flow** - Ensure JWT cookies work
5. **Migrate existing data** - Export from JSON, import to D1

## Files Created/Modified

- ✅ `migrations/0001_initial_schema.sql` - D1 database schema
- ✅ `wrangler.toml` - Updated configuration
- ⏳ `worker.js` - Needs complete rewrite (partially done)
- ⏳ `public/app-auth.js` - Needs Plan A + Plan B additions
- ⏳ `public/realtime.js` - New file for Plan B

## Status

- [x] D1 Schema created
- [x] Wrangler configuration updated
- [ ] Worker.js implementation (IN PROGRESS - needs developer completion)
- [ ] Plan A polling implementation
- [ ] Plan B Supabase Realtime implementation
- [ ] Deployment testing

## Developer Notes

The current `worker.js` file is outdated and doesn't include:
- JWT authentication
- All API endpoints from server-auth.js
- Supabase integration
- Plan B broadcast logic

**Recommendation**: Use server-auth.js as reference and port all endpoints to Worker format.
