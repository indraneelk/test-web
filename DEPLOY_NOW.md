# Deploy to Cloudflare - Quick Start Guide

## Prerequisites (5 minutes)

1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com (free tier works)
2. **Wrangler CLI**: Install globally
   ```bash
   npm install -g wrangler
   wrangler login
   ```

## Step 1: Create D1 Database (2 minutes)

```bash
# Create the database
wrangler d1 create task-manager-db

# Copy the database_id from the output
# It looks like: database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Edit `wrangler.toml` line 9** and paste your database_id:
```toml
database_id = "your-database-id-here"
```

## Step 2: Run Database Migrations (2 minutes)

```bash
# Apply the schema
wrangler d1 execute task-manager-db --file=./migrations/0001_initial_schema.sql

# Apply all migrations in order (if starting fresh, skip the old ones)
wrangler d1 execute task-manager-db --file=./migrations/002_add_color_to_projects.sql
wrangler d1 execute task-manager-db --file=./migrations/003_add_is_personal_to_projects.sql
wrangler d1 execute task-manager-db --file=./migrations/004_add_initials_to_users.sql
wrangler d1 execute task-manager-db --file=./migrations/005_add_supabase_support.sql
```

## Step 2.5: Migrate Existing Data (Optional, 3 minutes)

**If you have existing data in local JSON files** (e.g., `data/users.json`, `data/tasks.json`), migrate it to D1:

```bash
# Generate migration SQL from JSON files
node migrate-data-to-d1.js

# Review the generated migration file
cat migrations/006_migrate_json_data.sql

# Execute the migration
wrangler d1 execute task-manager-db --file=./migrations/006_migrate_json_data.sql

# OR use the --execute flag to do it all in one step
node migrate-data-to-d1.js --execute
```

**If you're starting fresh**, skip this step and create your first user after deployment.

## Step 3: Configure Secrets (3 minutes)

Your Supabase project: `https://oxbaswpyxryvygamgtsu.supabase.co`

```bash
# Required for authentication
wrangler secret put SUPABASE_ANON_KEY
# Paste your Supabase anon key when prompted

wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Paste your Supabase service role key when prompted

# Optional: JWT secret (only if using HS256, otherwise JWKS will be used)
wrangler secret put SUPABASE_JWT_SECRET
# Paste your JWT secret when prompted

# Optional: Session secret for cookie fallback
wrangler secret put SESSION_SECRET
# Type any random string (e.g., generate with: openssl rand -base64 32)
```

**Where to find Supabase keys:**
1. Go to https://app.supabase.com
2. Select your project
3. Settings → API
4. Copy `anon` `public` key and `service_role` `secret` key

## Step 4: Deploy Worker (1 minute)

```bash
# Deploy the API worker
wrangler deploy
```

You'll get a URL like: `https://team-task-manager.your-username.workers.dev`

## Step 5: Deploy Frontend (1 minute)

```bash
# Deploy the static frontend to Cloudflare Pages
wrangler pages deploy public --project-name=team-task-manager
```

You'll get a URL like: `https://team-task-manager.pages.dev`

## Step 6: Test Your Deployment (2 minutes)

1. **Visit your Pages URL**: `https://team-task-manager.pages.dev`
2. **Test API health**: `https://team-task-manager.your-username.workers.dev/api/health`
   - Should return: `{"ok":true}`
3. **Test database**: `https://team-task-manager.your-username.workers.dev/api/db-check`
   - Should return user/project/task counts

## Deployment Complete! 🎉

Your application is now live on Cloudflare's global network:
- **Frontend**: Cloudflare Pages (CDN-backed)
- **API**: Cloudflare Workers (serverless, auto-scaling)
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Auth**: Supabase (OAuth + JWT)
- **Real-time**: Supabase Realtime (WebSocket broadcasts)

---

## Optional: Configure Custom Domain

1. Go to Cloudflare Dashboard → Pages → team-task-manager → Custom domains
2. Add your domain (e.g., `tasks.yourdomain.com`)
3. Update DNS records as instructed

---

## Troubleshooting

### Issue: "Database not found"
- Check `wrangler.toml` has correct `database_id`
- Run: `wrangler d1 list` to see all databases

### Issue: "Authentication failed"
- Verify secrets are set: `wrangler secret list`
- Check Supabase keys are correct in Supabase dashboard

### Issue: "CORS errors"
- Add CORS headers to worker.js (already configured)
- Check browser console for specific error

### Issue: Frontend shows "API not configured"
- Check `/api/config/public` endpoint returns Supabase URL
- Verify worker deployment succeeded

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│  Cloudflare Pages (Frontend)        │
│  https://team-task-manager.pages.dev│
└──────────────┬──────────────────────┘
               │ API Calls (Bearer tokens)
               ↓
┌─────────────────────────────────────┐
│  Cloudflare Worker (Backend)        │
│  - JWKS (RS256) JWT verification    │
│  - All API Endpoints                │
│  - Supabase Realtime broadcasts     │
└──────────┬──────────────────────────┘
           │
           ↓
┌─────────────────────────────────────┐
│  Cloudflare D1 (Database)           │
│  - users, tasks, projects           │
│  - activity_logs, project_members   │
└─────────────────────────────────────┘

External Services:
├─ Supabase Auth (email/password, magic links)
└─ Supabase Realtime (WebSocket broadcasts for instant updates)
```

---

## Features Enabled

✅ **Plan A - Polling**: UI refreshes every 60 seconds + on tab focus
✅ **Plan B - Realtime**: Instant updates via Supabase Realtime broadcasts
✅ **Stateless Auth**: JWT Bearer tokens (horizontally scalable)
✅ **Cookie Fallback**: Session-based auth for legacy clients
✅ **Auto-archiving**: Completed tasks archived after 7 days
✅ **Activity Logs**: Full audit trail of all actions
✅ **Project Members**: Normalized many-to-many relationship

---

## Next Steps

1. **Create your first user** via Supabase Auth UI or magic link
2. **Invite team members** by adding them to projects
3. **Monitor usage** in Cloudflare Dashboard → Analytics
4. **Set up alerts** in Supabase Dashboard → Monitoring

---

## Cost Estimate (Free Tier)

- Cloudflare Workers: 100,000 requests/day (free)
- Cloudflare D1: 5GB storage + 5M reads/day (free)
- Cloudflare Pages: Unlimited bandwidth (free)
- Supabase: 50,000 monthly active users (free)

**Total monthly cost**: $0 for small teams (up to ~50 users)

---

## Support

- Cloudflare Docs: https://developers.cloudflare.com
- Supabase Docs: https://supabase.com/docs
- Wrangler CLI: `wrangler --help`
