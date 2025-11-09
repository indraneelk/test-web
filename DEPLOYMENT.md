# Deployment Guide

This project uses a **2-tier Cloudflare architecture**:

## Architecture

```
┌─────────────────────────────────────────┐
│  Cloudflare Pages (mmw-tm.pages.dev)   │
│  - Serves static frontend (HTML/CSS/JS) │
│  - Proxies /api/* to Worker              │
└────────────────┬────────────────────────┘
                 │ /api/* requests
                 ▼
┌─────────────────────────────────────────┐
│  Cloudflare Worker                       │
│  (team-task-manager.moovmyway.workers.dev)│
│  - Handles all API logic                 │
│  - Connected to D1 database              │
│  - Supabase auth integration             │
└─────────────────────────────────────────┘
```

## Deployment Files

- **`wrangler.toml`** - Pages configuration
- **`wrangler-worker.toml`** - Main Worker configuration
- **`wrangler-discord.toml`** - Discord bot Worker configuration

## Deployment Steps

### 1. Deploy the Main Worker (Backend API)

```bash
# Deploy the worker with D1 database binding
npx wrangler deploy --config wrangler-worker.toml

# Set secrets (only needed once or when changing)
npx wrangler secret put SUPABASE_ANON_KEY --config wrangler-worker.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler-worker.toml  
npx wrangler secret put SUPABASE_JWT_SECRET --config wrangler-worker.toml
npx wrangler secret put SESSION_SECRET --config wrangler-worker.toml
npx wrangler secret put DISCORD_BOT_SECRET --config wrangler-worker.toml
```

### 2. Deploy Pages (Frontend + API Proxy)

```bash
# Deploy to Cloudflare Pages
npx wrangler pages deploy public --project-name mmw-tm

# Set secrets (only needed once or when changing)
npx wrangler pages secret put SUPABASE_ANON_KEY --project-name mmw-tm
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name mmw-tm
npx wrangler pages secret put SUPABASE_JWT_SECRET --project-name mmw-tm
npx wrangler pages secret put SESSION_SECRET --project-name mmw-tm
```

### 3. Deploy Discord Worker (Optional)

```bash
# Deploy Discord interactions worker
npx wrangler deploy --config wrangler-discord.toml

# Set secrets
npx wrangler secret put DISCORD_PUBLIC_KEY --config wrangler-discord.toml
npx wrangler secret put DISCORD_BOT_SECRET --config wrangler-discord.toml
```

## Database Migrations

To apply database schema changes to production:

```bash
# Run individual migration
npx wrangler d1 execute task-manager-db-v2 --remote --file migrations/XXX_migration_name.sql

# Or run raw SQL
npx wrangler d1 execute task-manager-db-v2 --remote --command "ALTER TABLE tasks ADD COLUMN new_column TEXT;"
```

## Verification

After deployment, verify:

1. **Pages**: https://mmw-tm.pages.dev
2. **Worker API**: https://team-task-manager.moovmyway.workers.dev/api/config/public
3. **Discord Bot**: https://discord-bot.moovmyway.workers.dev (if deployed)

## Key Files

- `functions/_worker.js` - Main Worker code (also used for deployment)
- `functions/api/[[path]].js` - Pages API proxy to Worker
- `functions/shared/` - Shared code modules (copied from `/shared/`)
- `public/` - Static frontend files

## Important Notes

1. The `functions/shared/` directory is a **copy** of `/shared/` - keep them in sync
2. Pages proxies ALL `/api/*` requests to the Worker
3. Worker has direct D1 database access
4. Both Pages and Worker need Supabase secrets configured

## Troubleshooting

### Worker returns "db.prepare is not a function"
- Worker doesn't have D1 binding configured
- Redeploy with: `npx wrangler deploy --config wrangler-worker.toml`

### API returns HTML instead of JSON
- Pages is not proxying to Worker
- Check `functions/api/[[path]].js` exists
- Redeploy Pages

### Missing table columns errors
- Database schema out of sync
- Apply missing migrations with `wrangler d1 execute`
