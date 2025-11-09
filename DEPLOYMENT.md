# Deployment Guide

## ⚠️ Updated Architecture (Simplified)

This project now uses a **simplified single-service architecture** with Cloudflare Pages Functions:

```
┌──────────────────────────────────────────────────┐
│         Cloudflare Pages (mmw-tm.pages.dev)      │
│  ┌────────────────┐  ┌────────────────────────┐  │
│  │ Static Files   │  │ Pages Functions        │  │
│  │ (public/)      │  │ (functions/_worker.js) │  │
│  │                │  │ • API routes (/api/*)  │  │
│  │ • HTML/CSS/JS  │  │ • Discord auth         │  │
│  └────────────────┘  │ • D1 database          │  │
│                      └────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ Single deployment (no separate Worker needed)
- ✅ Simpler environment variable management
- ✅ No CORS issues (same origin)
- ✅ Lower cost

## Deployment Files

- **`wrangler.toml`** - Pages configuration (main deployment)
- **`wrangler-worker.toml`** - Optional separate Worker (not needed for basic setup)
- **`wrangler-discord.toml`** - Optional Discord bot Worker (for slash commands)

## Quick Start

### 1. Deploy to Cloudflare Pages

```bash
# Deploy (creates project on first run)
npx wrangler pages deploy public --project-name mmw-tm
```

### 2. Set Environment Variables

Set secrets via **Cloudflare Dashboard**:
1. Go to https://dash.cloudflare.com
2. Workers & Pages → mmw-tm → Settings → Environment Variables
3. Add for "Production" environment:
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET`
   - `SESSION_SECRET` (generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `DISCORD_BOT_SECRET` (generate same way)

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
