# Discord Bot + Cloudflare Deployment Guide

This guide explains how to set up the Discord bot to work with both local development and Cloudflare Workers deployment.

## Problem Solved

The Discord bot now works with **both** local and Cloudflare deployments using **JWT Bearer tokens** instead of session cookies.

### What Changed:

1. **New JWT Login Endpoint** (`/api/auth/login`):
   - Returns JWT tokens instead of session cookies
   - Works with username/password authentication
   - Compatible with both local and Cloudflare

2. **Discord Bot Updated**:
   - Uses Bearer tokens (`Authorization: Bearer <token>`)
   - Stores JWT tokens in memory (instead of cookies)
   - Works seamlessly with both environments

3. **Cloudflare Functions Complete**:
   - All Discord bot endpoints implemented
   - JWT authentication support
   - Claude AI integration ready

---

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file (or run `npm run setup`):

```bash
# Required
PORT=3000
NODE_ENV=development
SESSION_SECRET=your-secret-key-here

# Discord Bot (Optional)
DISCORD_BOT_TOKEN=your-discord-bot-token-here
API_BASE_URL=http://localhost:3000/api

# Claude AI (Optional - for Discord bot AI features)
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# Supabase (Optional - for magic link auth)
SUPABASE_URL=your-supabase-url-here
SUPABASE_ANON_KEY=your-supabase-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### 3. Start the Local Server

```bash
npm start
```

The server will start at `http://localhost:3000`

### 4. Start the Discord Bot (Optional)

In a separate terminal:

```bash
npm run discord
```

---

## Cloudflare Deployment

### 1. Migrate Data to D1 Database

First, migrate your local JSON data to Cloudflare D1:

```bash
# Create the D1 database (if not already done)
wrangler d1 create task-manager-db

# Apply the schema
wrangler d1 execute task-manager-db --file=schema.sql

# Migrate data from JSON files (if you have local data)
node migrate-data-to-d1.js
```

### 2. Set Cloudflare Secrets

Set all required secrets using `wrangler secret put`:

```bash
# REQUIRED: Generate and set SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copy the output and run:
wrangler secret put SESSION_SECRET
# Paste the generated secret when prompted

# OPTIONAL: For Claude AI features (Discord bot needs this)
wrangler secret put ANTHROPIC_API_KEY
# Enter your Anthropic API key from https://console.anthropic.com/settings/keys

# OPTIONAL: For Supabase authentication
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_JWT_SECRET
```

### 3. Deploy to Cloudflare Pages

```bash
# Deploy the Pages Functions
wrangler pages deploy

# Or for production
npm run deploy
```

### 4. Configure Discord Bot for Cloudflare

Update your Discord bot's `API_BASE_URL` to point to your Cloudflare deployment:

```bash
# In your .env file:
API_BASE_URL=https://your-app.pages.dev/api
```

**Important**: The Discord bot itself runs **locally or on your server**, not on Cloudflare. Only the API runs on Cloudflare.

---

## Testing

### Test Local Setup

1. **Start the server**: `npm start`
2. **Login test**:
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'
   ```
3. **Expected response**:
   ```json
   {
     "success": true,
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "user": {...}
   }
   ```

### Test Discord Bot (Local)

1. Start the bot: `npm run discord`
2. In Discord, mention the bot: `@YourBot login admin admin123`
3. Try commands:
   - `@YourBot tasks` - View your tasks
   - `@YourBot summary` - Get AI summary (requires ANTHROPIC_API_KEY)
   - `@YourBot ask what should I do today?`

### Test Cloudflare Deployment

1. **Health check**:
   ```bash
   curl https://your-app.pages.dev/api/health
   ```

2. **Login test**:
   ```bash
   curl -X POST https://your-app.pages.dev/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'
   ```

3. **Test with token**:
   ```bash
   # Replace YOUR_TOKEN with the token from login
   curl https://your-app.pages.dev/api/tasks \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

### Test Discord Bot with Cloudflare

1. Update `.env`: `API_BASE_URL=https://your-app.pages.dev/api`
2. Restart the bot: `npm run discord`
3. Test commands in Discord (same as local)

---

## Architecture

### Local Development
```
Discord Bot (local) → Express Server (local) → JSON Files
                      ↓
                   Session Cookies OR Bearer Tokens
```

### Cloudflare Production
```
Discord Bot (local/server) → Cloudflare Workers → D1 Database
                             ↓
                          Bearer Tokens (JWT)
```

### Authentication Flow

1. **Login**: Discord bot sends `username` + `password` to `/api/auth/login`
2. **JWT Token**: Server returns JWT token (24h expiration)
3. **Storage**: Bot stores token in memory (Map: Discord User ID → JWT)
4. **API Calls**: Bot sends `Authorization: Bearer <token>` header
5. **Verification**: Server verifies JWT and returns user data

---

## API Endpoints

All endpoints implemented in both local and Cloudflare:

### Authentication
- `POST /api/auth/login` - Username/password login (returns JWT)
- `GET /api/auth/me` - Get current user

### Tasks
- `GET /api/tasks` - Get user's tasks

### Claude AI
- `GET /api/claude/summary` - AI task summary
- `GET /api/claude/priorities` - Priority recommendations
- `POST /api/claude/ask` - Ask questions about tasks

### Utility
- `GET /api/health` - Health check
- `GET /api/db-check` - Database connection check

---

## Environment Variables Reference

### Local Development (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `SESSION_SECRET` | **Yes** | Secret for JWT signing |
| `DISCORD_BOT_TOKEN` | No | Discord bot token |
| `API_BASE_URL` | No | API URL for Discord bot |
| `ANTHROPIC_API_KEY` | No | Claude AI API key |
| `SUPABASE_URL` | No | Supabase project URL |
| `SUPABASE_ANON_KEY` | No | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase service role key |

### Cloudflare (Secrets)

| Secret | Required | Command |
|--------|----------|---------|
| `SESSION_SECRET` | **Yes** | `wrangler secret put SESSION_SECRET` |
| `ANTHROPIC_API_KEY` | No | `wrangler secret put ANTHROPIC_API_KEY` |
| `SUPABASE_ANON_KEY` | No | `wrangler secret put SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | No | `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` |
| `SUPABASE_JWT_SECRET` | No | `wrangler secret put SUPABASE_JWT_SECRET` |

---

## Troubleshooting

### Discord Bot Can't Login

**Error**: `❌ Login failed. Check your credentials.`

**Solutions**:
1. Check username/password are correct (default: `admin` / `admin123`)
2. Verify API_BASE_URL ends with `/api` (not just `/`)
3. Check server is running: `curl http://localhost:3000/api/health`

### Token Expired

**Error**: `❌ Failed to fetch tasks. You may need to login again.`

**Solution**: JWT tokens expire after 24 hours. Re-login with:
```
@YourBot login <username> <password>
```

### Claude AI Not Working

**Error**: `❌ Failed to get summary. Claude service may not be ready.`

**Solutions**:
1. Check `ANTHROPIC_API_KEY` is set in `.env` (local) or Cloudflare secrets
2. Verify API key is valid: https://console.anthropic.com/settings/keys
3. Check Claude API usage limits

### Cloudflare Deployment Issues

**Error**: `D1 query failed`

**Solutions**:
1. Verify D1 database is created: `wrangler d1 list`
2. Check database ID matches in `wrangler.toml`
3. Apply schema: `wrangler d1 execute task-manager-db --file=schema.sql`

---

## Security Notes

1. **Never commit** `.env` file to Git
2. **Generate strong** SESSION_SECRET (use crypto.randomBytes)
3. **Use HTTPS** in production (Cloudflare provides this)
4. **Rotate secrets** periodically
5. **Discord bot tokens** are sensitive - keep them secret!

---

## Next Steps

### Immediate (You're Done!)
- [x] JWT authentication working
- [x] Discord bot using Bearer tokens
- [x] Cloudflare Functions complete

### Optional Improvements
- [ ] Add rate limiting to prevent abuse
- [ ] Implement token refresh mechanism
- [ ] Add persistent session storage (Redis/KV)
- [ ] Add more Discord commands
- [ ] Set up monitoring and logging

---

## Support

For issues or questions:
- Check the troubleshooting section above
- Review the generated analysis: `DISCORD_CLOUDFLARE_ANALYSIS.md`
- Check Cloudflare Logs: `wrangler tail`

---

**Status**: ✅ Ready for local development and Cloudflare deployment!
