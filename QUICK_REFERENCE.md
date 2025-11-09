# Quick Reference: Discord & Cloudflare Setup

## Current State

- **Database**: JSON files (development mode)
- **Server**: Express.js (server-auth.js) running on http://localhost:3000
- **Discord Bot**: Optional standalone process (discord-bot.js)
- **Cloudflare**: Prepared but not fully ported (functions/_worker.js is incomplete scaffold)

## File Locations

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Discord Bot | `discord-bot.js` | 313 | Working (session issue) |
| Express Server | `server-auth.js` | 1400+ | Working |
| Cloudflare Config | `wrangler.toml` | 31 | Ready |
| Pages Functions | `functions/_worker.js` | 95 | Incomplete scaffold |
| Environment Variables | `.env.example` | 40 | Template only |
| Database Schema | `schema.sql` | - | Ready for Cloudflare |

## Critical Issues to Fix

### 1. Discord Bot Sessions Lost on Restart
- **File**: discord-bot.js line 14
- **Problem**: Uses in-memory Map
- **Solution**: Use persistent storage (Redis, SQLite, or database)

### 2. Discord Bot Won't Work with Cloudflare
- **File**: discord-bot.js lines 5, 98-99
- **Problem**: Uses session cookies, Pages Functions expect Bearer tokens
- **Solution**: Refactor bot to use API tokens or implement dual-auth

### 3. Incomplete Cloudflare Pages Functions
- **File**: functions/_worker.js
- **Missing**: 30+ endpoints from server-auth.js
- **Impact**: Cannot deploy to Cloudflare without completing

## Quick Start

```bash
# 1. Setup environment
npm run setup

# 2. Start server
npm start

# 3. Open browser
# http://localhost:3000
# Login: admin / admin123

# 4. Optional: Start Discord bot
# npm run discord
# (Requires DISCORD_BOT_TOKEN in .env)
```

## Environment Variables Needed

```bash
# Required for server
PORT=3000
SESSION_SECRET=<generate-strong-secret>
NODE_ENV=development

# Optional for Discord bot
DISCORD_BOT_TOKEN=<discord-token>
API_BASE_URL=http://localhost:3000/api

# Optional for Claude AI
ANTHROPIC_API_KEY=<anthropic-key>

# Optional for Supabase
SUPABASE_URL=<supabase-url>
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-key>
```

## Key API Endpoints

### Authentication
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Tasks
- `GET /api/tasks` - List tasks
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Claude AI
- `GET /api/claude/summary` - Task summary
- `GET /api/claude/priorities` - Priority analysis
- `POST /api/claude/ask` - Ask question

## Discord Bot Commands

- `login <username> <password>` - Authenticate
- `tasks` - Show task counts
- `summary` - Get AI summary
- `priorities` - Get priority analysis
- `ask <question>` - Ask Claude
- `help` - Show commands

## Migration to Cloudflare (TODO)

```bash
# 1. Create D1 database
wrangler d1 create task-manager-db

# 2. Update wrangler.toml with database_id

# 3. Apply schema
wrangler d1 execute task-manager-db --file=./schema.sql

# 4. Set secrets
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_JWT_SECRET

# 5. Complete functions/_worker.js (port from server-auth.js)

# 6. Deploy
wrangler pages deploy public --project-name=team-task-manager
```

## Testing

```bash
# Server health
curl http://localhost:3000/api/auth/me

# Create task (requires auth)
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","description":"Test task","project_id":"p1"}'

# Check Discord bot
npm run discord  # Starts bot
# In Discord: @bot help
```

## For More Details

See: `/home/user/test-web/DISCORD_CLOUDFLARE_ANALYSIS.md`

This document contains:
- Complete architecture overview
- All 11 identified issues with code examples
- Implementation recommendations
- Full testing checklist
- Migration guide
