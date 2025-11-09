# Cloudflare Deployment Guide

This guide will help you deploy the Task Manager to Cloudflare Workers with Discord integration.

## Architecture Overview

```
┌─────────────────────────────────────────┐
│   Cloudflare Pages (Frontend)          │
│   - Static HTML/CSS/JS                  │
│   - public/ directory                   │
└──────────────┬──────────────────────────┘
               │ API Calls
               ▼
┌─────────────────────────────────────────┐
│   Cloudflare Worker (Backend)          │
│   - team-task-manager                   │
│   - All API endpoints                   │
│   - Authentication (JWT + Supabase)     │
│   - Discord integration                 │
└──────────────┬──────────────────────────┘
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
   ┌─────┐  ┌──────┐  ┌──────────┐
   │ D1  │  │Supa- │  │ Discord  │
   │ DB  │  │base  │  │   Bot    │
   └─────┘  └──────┘  └──────────┘
```

## Prerequisites

1. **Cloudflare Account** - [Sign up](https://dash.cloudflare.com/sign-up)
2. **Wrangler CLI** - Already in package dependencies
3. **Discord Bot Token** - [Discord Developer Portal](https://discord.com/developers/applications)
4. **Supabase Account** - [Sign up](https://supabase.com) (optional but recommended)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Authenticate with Cloudflare

```bash
npx wrangler login
```

This will open a browser window to authenticate.

## Step 3: Create D1 Database

The database is already configured in `wrangler.toml`, but if you need to create a new one:

```bash
# Create D1 database
npx wrangler d1 create task-manager-db

# Update wrangler.toml with the new database_id
# Copy the database_id from the output
```

## Step 4: Run Database Migrations

```bash
# Run migrations in order
npx wrangler d1 execute task-manager-db --remote --file=./migrations/0001_initial_schema.sql
npx wrangler d1 execute task-manager-db --remote --file=./migrations/001_add_priority_to_tasks.sql
npx wrangler d1 execute task-manager-db --remote --file=./migrations/002_add_color_to_projects.sql
npx wrangler d1 execute task-manager-db --remote --file=./migrations/003_add_is_personal_to_projects.sql
npx wrangler d1 execute task-manager-db --remote --file=./migrations/004_add_initials_to_users.sql
npx wrangler d1 execute task-manager-db --remote --file=./migrations/005_add_supabase_support.sql
npx wrangler d1 execute task-manager-db --remote --file=./migrations/007_make_assignee_optional.sql
npx wrangler d1 execute task-manager-db --remote --file=./migrations/008_normalize_project_members.sql
```

## Step 5: Configure Secrets

Set all required secrets using Wrangler:

```bash
# Required secrets
npx wrangler secret put SESSION_SECRET
# Enter a random string (e.g., openssl rand -base64 32)

npx wrangler secret put SUPABASE_URL
# Enter: https://your-project.supabase.co

npx wrangler secret put SUPABASE_ANON_KEY
# Get from Supabase Dashboard > Settings > API

npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Get from Supabase Dashboard > Settings > API (keep this secret!)

npx wrangler secret put SUPABASE_JWT_SECRET
# Get from Supabase Dashboard > Settings > API > JWT Secret

# Optional: For Discord bot integration
npx wrangler secret put DISCORD_BOT_API_KEY
# Enter a random string (e.g., openssl rand -hex 32)

# Optional: For Claude AI integration
npx wrangler secret put ANTHROPIC_API_KEY
# Get from https://console.anthropic.com/
```

## Step 6: Deploy Worker

```bash
# Deploy to production
npm run deploy

# Or deploy to dev environment
npm run deploy-dev
```

After deployment, you'll get a URL like:
```
https://team-task-manager.your-subdomain.workers.dev
```

## Step 7: Configure Discord Bot (Optional)

### 7.1 Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Go to "Bot" section
4. Click "Add Bot"
5. Under "Privileged Gateway Intents", enable:
   - MESSAGE CONTENT INTENT
   - SERVER MEMBERS INTENT (optional)
6. Copy the Bot Token

### 7.2 Configure Discord Bot Environment

Create a `.env` file for the Discord bot:

```bash
cat > .env.discord << EOF
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_BOT_API_KEY=your_api_key_from_step_5
WORKER_URL=https://team-task-manager.your-subdomain.workers.dev
EOF
```

### 7.3 Run Discord Bot

```bash
# Load environment variables and start bot
export $(cat .env.discord | xargs) && npm run discord-cloudflare
```

For production, use a process manager like PM2:

```bash
npm install -g pm2
pm2 start discord-bot-cloudflare.js --name task-manager-bot
pm2 save
```

## Step 8: Deploy Frontend (Pages)

You have two options:

### Option A: Deploy with Worker (Recommended)

The worker already serves static files. Just make sure your frontend points to the worker URL.

Update `public/app-auth.js`:
```javascript
const API_BASE = 'https://team-task-manager.your-subdomain.workers.dev/api';
```

### Option B: Separate Pages Deployment

```bash
npx wrangler pages deploy public --project-name=task-manager
```

## Step 9: Test Your Deployment

### Test the Worker

```bash
# Health check
curl https://team-task-manager.your-subdomain.workers.dev/api/health

# Database check
curl https://team-task-manager.your-subdomain.workers.dev/api/db-check
```

### Test Discord Bot

1. Invite bot to your server using this URL (replace CLIENT_ID):
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2048&scope=bot
   ```

2. In Discord, type:
   ```
   @YourBot help
   ```

3. Login (use DM for security):
   ```
   @YourBot login your_username
   ```

4. Test commands:
   ```
   @YourBot tasks
   @YourBot summary
   @YourBot ask What should I focus on today?
   ```

## Troubleshooting

### Worker Issues

**"D1 binding not found"**
- Run migrations (Step 4)
- Verify database_id in wrangler.toml matches your D1 database

**"Authentication required"**
- Check that secrets are set correctly (Step 5)
- Verify SUPABASE_URL and JWT_SECRET match your Supabase project

**"CORS errors"**
- Update allowed origins in worker.js if needed
- For development, CORS is set to `*` (change for production)

### Discord Bot Issues

**Bot doesn't respond**
- Check bot has MESSAGE CONTENT INTENT enabled
- Verify DISCORD_BOT_TOKEN is correct
- Check bot has permissions to read/send messages

**"Not logged in" error**
- Make sure you ran `login <username>` command first
- Username must exist in the task manager database
- Check DISCORD_BOT_API_KEY matches between bot and worker

**Claude not working**
- Verify ANTHROPIC_API_KEY is set in Cloudflare secrets
- Check API key is valid and has credits

### Database Issues

**"Table does not exist"**
- Run all migrations in order (Step 4)
- Check migration files executed successfully

**"No users found"**
- Create users through Supabase Auth
- Or use the frontend to sign up

## Security Checklist

Before going to production:

- [ ] Change CORS settings in worker.js to specific origins
- [ ] Set strong SESSION_SECRET (32+ characters)
- [ ] Keep DISCORD_BOT_API_KEY secret
- [ ] Never commit .env files to git
- [ ] Enable Cloudflare rate limiting
- [ ] Review Supabase Row Level Security policies
- [ ] Use HTTPS for all API calls
- [ ] Regularly rotate API keys

## Monitoring

### View Worker Logs

```bash
npx wrangler tail
```

### View D1 Database

```bash
npx wrangler d1 execute task-manager-db --remote --command="SELECT * FROM users"
```

### Discord Bot Logs

```bash
# If using PM2
pm2 logs task-manager-bot

# Or check console output
```

## Cost Estimate

**Cloudflare Workers:**
- Free tier: 100,000 requests/day
- Paid: $5/month for 10M requests

**Cloudflare D1:**
- Free tier: 5M reads, 100K writes per day
- Paid: $5/month for 25M reads, 50M writes

**Discord Bot:**
- Free (runs on your server)

**Supabase:**
- Free tier: Unlimited API requests
- Paid: Starting at $25/month

**Claude AI:**
- Pay-as-you-go: ~$0.003 per request
- Budget: ~$10/month for moderate use

**Total:** Free tier covers most use cases!

## Next Steps

1. **Custom Domain:** Add a custom domain in Cloudflare Dashboard
2. **Analytics:** Enable Workers Analytics
3. **Backups:** Set up automated D1 backups
4. **CI/CD:** Integrate with GitHub Actions for automated deploys
5. **Monitoring:** Set up alerts for errors and downtime

## Support

- Cloudflare Docs: https://developers.cloudflare.com/workers/
- Discord.js Guide: https://discordjs.guide/
- Supabase Docs: https://supabase.com/docs

## Files Reference

- `worker.js` - Main Cloudflare Worker with all API endpoints
- `discord-bot-cloudflare.js` - Discord bot for Cloudflare deployment
- `wrangler.toml` - Cloudflare Worker configuration
- `schema.sql` - Database schema
- `migrations/` - Database migration files
- `public/` - Frontend files

---

Happy deploying! 🚀
