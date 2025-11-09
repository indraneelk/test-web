# Quick Deployment Reference

## Current Status ✅

- **Pages**: https://mmw-tm.pages.dev (Frontend + API Proxy)
- **Worker**: https://team-task-manager.moovmyway.workers.dev (Backend API)
- **Database**: D1 `task-manager-db-v2` (Connected to Worker)

## Deploy Commands

```bash
# Deploy everything (recommended)
npm run deploy:all

# Or deploy individually:
npm run deploy:worker  # Backend API
npm run deploy:pages   # Frontend

# Sync shared modules before deploying worker
npm run sync:shared
```

## What Was Fixed

1. ✅ **Database Schema**: Added `archived` and `completed_at` columns
2. ✅ **Worker Binding**: Connected D1 database to Worker  
3. ✅ **Pages Proxy**: Restored API proxy from Pages to Worker
4. ✅ **Deployment Scripts**: Added npm scripts for easy deployment

## Architecture

```
User Browser
    ↓
mmw-tm.pages.dev (Cloudflare Pages)
    ├─ Serves: HTML, CSS, JS
    └─ /api/* → Proxies to Worker
             ↓
team-task-manager.moovmyway.workers.dev (Cloudflare Worker)
    ├─ Handles: All API requests
    ├─ Auth: Supabase JWT verification
    └─ Database: D1 (task-manager-db-v2)
```

## Files Modified

- `functions/_worker.js` - Main worker code
- `functions/api/[[path]].js` - API proxy (Pages function)
- `functions/shared/` - Shared modules (copied from `/shared/`)
- `wrangler-worker.toml` - Worker config with D1 binding
- `package.json` - Deployment scripts

## Next Time You Deploy

1. Make code changes in `functions/_worker.js` or `/shared/*`
2. If you changed `/shared/*`, run: `npm run sync:shared`
3. Deploy: `npm run deploy:all`
4. Verify: Visit https://mmw-tm.pages.dev

## Troubleshooting

**Task creation fails with 500 error:**
- Check Worker has D1 binding: `npm run deploy:worker`

**API returns HTML instead of JSON:**
- Redeploy Pages: `npm run deploy:pages`

**Missing columns error:**
- Apply migration: `npx wrangler d1 execute task-manager-db-v2 --remote --command "ALTER TABLE tasks ADD COLUMN column_name TYPE;"`
