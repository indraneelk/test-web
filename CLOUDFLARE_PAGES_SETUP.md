# Cloudflare Pages Setup Guide - Discord Integration

This guide explains how to deploy your app to Cloudflare Pages with Discord integration working properly.

## 🏗️ Architecture Overview

**Simplified Single-Service Architecture:**

```
┌──────────────────────────────────────────────────────────┐
│         Cloudflare Pages (mmw-tm.pages.dev)             │
│                                                          │
│  ┌────────────────┐    ┌─────────────────────────────┐  │
│  │  Static Files  │    │   Pages Functions            │  │
│  │  (public/)     │    │   (functions/_worker.js)     │  │
│  │                │    │                              │  │
│  │  • HTML        │    │  • API routes (/api/*)       │  │
│  │  • CSS         │    │  • Discord auth              │  │
│  │  • JavaScript  │    │  • D1 database access        │  │
│  └────────────────┘    │  • Supabase integration      │  │
│                        └──────────┬───────────────────┘  │
└───────────────────────────────────┼──────────────────────┘
                                    │
                                    ▼
                        ┌────────────────────────┐
                        │   Cloudflare D1        │
                        │   (task-manager-db-v2) │
                        └────────────────────────┘
```

**Key Points:**
- ✅ Single deployment (Pages only)
- ✅ No separate Worker needed
- ✅ Same-origin (no CORS issues)
- ✅ Simpler environment variable management
- ✅ Lower cost

## 📋 Prerequisites

1. **Cloudflare Account** - Sign up at https://dash.cloudflare.com
2. **Wrangler CLI** - Install: `npm install -g wrangler`
3. **Authentication** - Login: `wrangler login`

## 🚀 Deployment Steps

### Step 1: Prepare Environment Variables

You'll need these secrets. Generate them first:

```bash
# Generate SESSION_SECRET (64 random hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate DISCORD_BOT_SECRET (64 random hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Get from Supabase Dashboard** (https://app.supabase.com):
- Project Settings → API
  - `SUPABASE_URL` (already in wrangler.toml)
  - `SUPABASE_ANON_KEY` (public/anon key)
  - `SUPABASE_SERVICE_ROLE_KEY` (service_role secret)

- Project Settings → Configuration → JWT Settings
  - `SUPABASE_JWT_SECRET` (JWT Secret)

### Step 2: Create D1 Database (if not exists)

```bash
# Check if database exists
wrangler d1 list

# If not exists, create it
wrangler d1 create task-manager-db-v2

# Note the database_id and update it in wrangler.toml
```

### Step 3: Run Database Migrations

```bash
# Apply all migrations
wrangler d1 execute task-manager-db-v2 --remote --file migrations/001_initial_schema.sql
wrangler d1 execute task-manager-db-v2 --remote --file migrations/002_add_user_fields.sql
# ... continue with all migration files in order

# Or use the migration script (if available)
node migrate.js
```

### Step 4: Deploy to Cloudflare Pages

```bash
# First deployment - creates the Pages project
wrangler pages deploy public --project-name=mmw-tm

# Subsequent deployments
wrangler pages deploy public --project-name=mmw-tm
```

**Note:** On first deployment, Cloudflare will:
- Create the Pages project
- Bind your D1 database (from wrangler.toml)
- Deploy your static files and Functions

### Step 5: Configure Environment Variables (Secrets)

Set all required secrets via Cloudflare Dashboard or CLI:

**Option A: Via Cloudflare Dashboard (Recommended)**

1. Go to https://dash.cloudflare.com
2. Workers & Pages → mmw-tm → Settings → Environment Variables
3. Add these secrets for "Production" environment:

| Variable Name | Value | How to Get |
|--------------|-------|------------|
| `SUPABASE_ANON_KEY` | eyJ... | Supabase Dashboard → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | eyJ... | Supabase Dashboard → API → service_role key |
| `SUPABASE_JWT_SECRET` | your-jwt-secret | Supabase Dashboard → Configuration → JWT Settings |
| `SESSION_SECRET` | Generated hex string | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DISCORD_BOT_SECRET` | Generated hex string | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**Option B: Via Wrangler CLI**

```bash
# Set secrets via CLI
echo "your-supabase-anon-key" | wrangler pages secret put SUPABASE_ANON_KEY --project-name=mmw-tm
echo "your-supabase-service-role-key" | wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name=mmw-tm
echo "your-supabase-jwt-secret" | wrangler pages secret put SUPABASE_JWT_SECRET --project-name=mmw-tm
echo "your-generated-session-secret" | wrangler pages secret put SESSION_SECRET --project-name=mmw-tm
echo "your-generated-discord-secret" | wrangler pages secret put DISCORD_BOT_SECRET --project-name=mmw-tm
```

### Step 6: Redeploy After Setting Secrets

After adding secrets, redeploy to ensure they're picked up:

```bash
wrangler pages deploy public --project-name=mmw-tm
```

## 🔗 Discord Bot Setup

### Option 1: Discord Slash Commands (Interactions API)

If you want slash commands in Discord:

1. **Deploy Separate Discord Worker** (optional):
   ```bash
   wrangler deploy --config wrangler-discord.toml

   # Set secrets
   echo "your-discord-public-key" | wrangler secret put DISCORD_PUBLIC_KEY --config wrangler-discord.toml
   echo "same-discord-bot-secret-as-above" | wrangler secret put DISCORD_BOT_SECRET --config wrangler-discord.toml
   ```

2. **Configure Discord Application**:
   - Go to https://discord.com/developers/applications
   - Select your application
   - General Information → Interactions Endpoint URL:
     - Enter: `https://discord-bot.YOUR_SUBDOMAIN.workers.dev/interactions`

3. **Register Slash Commands**:
   ```bash
   # Create .env file with Discord credentials
   echo "DISCORD_BOT_TOKEN=your-bot-token" > .env
   echo "DISCORD_APPLICATION_ID=your-app-id" >> .env

   # Register commands
   node register-commands.js
   ```

### Option 2: Discord Gateway Bot (Simpler for Development)

For local development or if you don't need slash commands:

```bash
# Run locally
node discord-bot.js
```

## 🧪 Testing

### Test the Deployment

1. **Visit your Pages URL**: https://mmw-tm.pages.dev

2. **Test API endpoint**:
   ```bash
   curl https://mmw-tm.pages.dev/api/config/public
   ```

3. **Test Discord linking flow**:
   - Login to your app
   - Go to Settings/Profile
   - Click "Link Discord Account"
   - Generate a code
   - Use the code in Discord (via `/link` command or bot)

### Test Locally

```bash
# Run Pages Functions locally with wrangler
wrangler pages dev public --d1 DB=task-manager-db-v2

# Or use the local server for development
npm start
```

## 🐛 Troubleshooting

### Issue: "Missing environment variables"

**Symptoms:** API returns 500 errors, logs show missing SUPABASE_URL, SESSION_SECRET, etc.

**Solution:**
1. Check secrets are set: Cloudflare Dashboard → Workers & Pages → mmw-tm → Settings → Environment Variables
2. Verify wrangler.toml has `SUPABASE_URL` in `[vars]` section
3. Redeploy after setting secrets

### Issue: "Discord authentication failed"

**Symptoms:** Discord commands return "Authentication required" or signature verification fails

**Solution:**
1. Verify `DISCORD_BOT_SECRET` is set in BOTH:
   - Pages (mmw-tm) environment variables
   - Discord Worker (if using separate worker)
2. Ensure both use the EXACT same value
3. Check Discord bot has proper headers (X-Discord-User-ID, X-Discord-Signature, X-Discord-Timestamp)

### Issue: "Database not found"

**Symptoms:** API returns errors about DB not being defined

**Solution:**
1. Check D1 binding in wrangler.toml:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "task-manager-db-v2"
   database_id = "your-database-id"
   ```
2. Verify database exists: `wrangler d1 list`
3. Run migrations: `wrangler d1 execute task-manager-db-v2 --remote --file migrations/...`

### Issue: "CORS errors"

**Symptoms:** Browser console shows CORS errors when calling API

**Solution:**
- This shouldn't happen with Pages Functions (same origin)
- If you see this, check you're not using `functions/api/[[path]].js` proxy
- Verify you deleted the proxy file: `ls functions/api/` should show "No such file or directory"

## 📝 Development Workflow

### Making Changes

1. **Edit code locally**
2. **Test locally**:
   ```bash
   wrangler pages dev public --d1 DB=task-manager-db-v2
   ```
3. **Deploy to production**:
   ```bash
   wrangler pages deploy public --project-name=mmw-tm
   ```

### Database Changes

1. **Create migration file**: `migrations/XXX_description.sql`
2. **Test locally**:
   ```bash
   wrangler d1 execute task-manager-db-v2 --local --file migrations/XXX_description.sql
   ```
3. **Apply to production**:
   ```bash
   wrangler d1 execute task-manager-db-v2 --remote --file migrations/XXX_description.sql
   ```

## 🎯 Key Files Reference

| File | Purpose |
|------|---------|
| `wrangler.toml` | Pages configuration, D1 binding, environment vars |
| `functions/_worker.js` | Main API handler (2300+ lines) |
| `functions/shared/*` | Shared modules (business logic, Discord auth, etc.) |
| `public/*` | Static frontend files |
| `migrations/*` | Database schema migrations |

## 🔐 Security Notes

1. **Never commit secrets** - Use `.gitignore` for `.env` files
2. **Use environment variables** - Set via Cloudflare Dashboard or wrangler CLI
3. **DISCORD_BOT_SECRET** - Must be the same in Pages and Discord Worker (if using)
4. **Rotate secrets periodically** - Update in Cloudflare Dashboard and redeploy

## 📚 Additional Resources

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Discord Developer Portal](https://discord.com/developers/docs)
- [Supabase Docs](https://supabase.com/docs)

## ✅ Deployment Checklist

- [ ] D1 database created and migrations applied
- [ ] All secrets set in Cloudflare Pages environment variables
- [ ] Deployed to Cloudflare Pages (`wrangler pages deploy`)
- [ ] Tested public API endpoint (`/api/config/public`)
- [ ] Tested authentication flow (login/signup)
- [ ] Discord bot configured (if using slash commands)
- [ ] Discord commands registered (if using slash commands)
- [ ] Tested Discord linking flow

## 🎉 Success!

Your app should now be live at: **https://mmw-tm.pages.dev**

Test it by:
1. Creating an account
2. Logging in
3. Creating a task
4. Linking Discord (if configured)
