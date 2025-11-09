# Quick Deploy to Cloudflare Pages

**TL;DR:** Deploy your app to Cloudflare Pages in 5 minutes.

## Prerequisites

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

## Deploy Steps

### 1. Deploy to Pages

```bash
wrangler pages deploy public --project-name=mmw-tm
```

### 2. Set Environment Variables

Go to: https://dash.cloudflare.com → Workers & Pages → mmw-tm → Settings → Environment Variables

Add these for **Production**:

| Variable | How to Get |
|----------|------------|
| `SUPABASE_ANON_KEY` | Supabase Dashboard → API → anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → API → service_role key |
| `SUPABASE_JWT_SECRET` | Supabase Dashboard → Configuration → JWT Settings |
| `SESSION_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DISCORD_BOT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### 3. Run Migrations

```bash
# Apply database migrations
wrangler d1 execute task-manager-db-v2 --remote --file migrations/001_initial_schema.sql
# ... repeat for all migration files
```

### 4. Redeploy

```bash
wrangler pages deploy public --project-name=mmw-tm
```

## Test

Visit: https://mmw-tm.pages.dev

## Discord Setup (Optional)

See [DISCORD_SETUP.md](DISCORD_SETUP.md) for Discord bot configuration.

## Full Guide

For detailed setup, troubleshooting, and architecture info, see [CLOUDFLARE_PAGES_SETUP.md](CLOUDFLARE_PAGES_SETUP.md).

## Local Development

```bash
# Test locally
wrangler pages dev public --d1 DB=task-manager-db-v2

# Or use the dev server
npm start
```

## Common Issues

**"Missing environment variables"**
- Make sure you set all secrets in Cloudflare Dashboard
- Redeploy after setting secrets

**"Database not found"**
- Run migrations: `wrangler d1 execute task-manager-db-v2 --remote --file migrations/...`

**"Discord auth fails"**
- Set `DISCORD_BOT_SECRET` in environment variables
- Use same secret in Discord worker (if using separate worker)

## Need Help?

- 📖 [Full Setup Guide](CLOUDFLARE_PAGES_SETUP.md)
- 🤖 [Discord Setup Guide](DISCORD_SETUP.md)
- 📚 [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
