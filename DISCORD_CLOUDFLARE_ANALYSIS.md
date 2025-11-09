# Discord Integration & Cloudflare Deployment - Comprehensive Overview

**Project**: Team Task Manager  
**Current Branch**: `claude/fix-discord-cloudflare-setup-011CUxzRHdbFNQhCqwqhguw7`  
**Status**: Development Ready (with optional Discord and Cloudflare features)

---

## 1. Discord Integration - Current Implementation

### Architecture Overview

The Discord integration is implemented as a **standalone bot client** using `discord.js`:

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Bot Process                      │
│                   (discord-bot.js)                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Message Handler → Parse Commands → API Calls              │
│                                                              │
│  Supported Commands:                                        │
│  • login <username> <password>   - Authenticate user        │
│  • tasks                         - List user's tasks        │
│  • summary                       - Get AI summary            │
│  • priorities                    - Get priority analysis     │
│  • ask <question>                - Ask Claude anything       │
│  • help                          - Show commands             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                        ↓ HTTP
        ┌───────────────────────────────────┐
        │   Express Server (server-auth.js) │
        │   http://localhost:3000/api       │
        └───────────────────────────────────┘
```

### Key Files

**File**: `/home/user/test-web/discord-bot.js`  
**Type**: Standalone bot application (Node.js)  
**Size**: 313 lines  
**Dependencies**:
- `discord.js` (v14.14.1) - Discord API client
- `axios` (v1.6.7) - HTTP client for API calls

### Configuration & Environment Variables

**Required Environment Variables**:
```bash
DISCORD_BOT_TOKEN=your-discord-bot-token-here
API_BASE_URL=http://localhost:3000/api
```

**Optional Environment Variables**:
```bash
NODE_ENV=production
```

**Configuration in Code** (discord-bot.js lines 5-11):
```javascript
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN environment variable is required');
    process.exit(1);
}
```

### How It Works

#### 1. **Message Handling** (lines 31-80)
- Bot listens for mentions or DMs
- Parses commands from message content
- Routes to appropriate handler functions
- Supports 6 main commands + fallback to Claude

#### 2. **Authentication Flow** (lines 83-115)
```javascript
handleLogin(message, args)
  → axios.post(`${API_BASE}/auth/login`, { username, password })
  → Server returns session cookie in Set-Cookie header
  → Cookie stored in userSessions Map: Discord_User_ID → Cookie
  → Cookie used in subsequent requests
```

**Key Issue Found**: Stores cookies in-memory using `Map()` (line 14). This is **lost on bot restart**.

#### 3. **API Endpoints Called**

| Command | Endpoint | Method | Auth | Purpose |
|---------|----------|--------|------|---------|
| login | `/auth/login` | POST | None | Creates session cookie |
| tasks | `/tasks` | GET | Cookie | Lists user's tasks |
| summary | `/claude/summary` | GET | Cookie | Gets AI task summary |
| priorities | `/claude/priorities` | GET | Cookie | Gets priority analysis |
| ask | `/claude/ask` | POST | Cookie | Asks Claude question |

#### 4. **Session Management** (lines 14, 98-99)
```javascript
const userSessions = new Map(); // In-memory storage
// After successful login:
const cookies = response.headers['set-cookie'];
userSessions.set(message.author.id, cookies);
```

**Problem**: Sessions are ephemeral and lost on restart

#### 5. **Response Formatting** (lines 140-161, 182-191, etc.)
- Uses Discord embeds for rich formatting
- Splits long responses (>2000 chars) for Discord limits
- Includes metadata (timestamps, fields, colors)

### Discord Commands Implemented

```
1. login <username> <password>
   → Authenticates user via server
   → Warns to use DMs for security
   → Deletes message if in guild (prevents logging)

2. tasks
   → Lists pending, in-progress, completed task counts
   → Shows first 5 tasks with status
   → Requires prior login

3. summary
   → Calls /api/claude/summary
   → Returns AI-generated task analysis
   → Displays in formatted embed

4. priorities
   → Calls /api/claude/priorities
   → Returns priority recommendations from Claude
   → Displays as formatted embed

5. ask <question>
   → Posts custom question to Claude
   → Example: "ask what tasks are overdue?"
   → Handles long responses with pagination

6. help
   → Shows all available commands
   → Provides usage examples
   → Lists authentication requirements
```

### Potential Issues Found

#### Issue 1: In-Memory Session Storage ⚠️
- **Location**: discord-bot.js line 14
- **Problem**: Sessions stored in memory, lost on bot restart
- **Impact**: Users must re-login after bot restarts
- **Solution Options**:
  1. Use Redis/Memcached for persistent sessions
  2. Use SQLite for Discord user sessions
  3. Use database to map Discord User ID → API Token
  4. Implement long-lived API tokens instead of session cookies

#### Issue 2: No Token Refresh ⚠️
- **Location**: discord-bot.js (no token refresh logic)
- **Problem**: If session expires (24h), user must login again
- **Impact**: Bot needs manual user re-authentication
- **Solution**: Implement token refresh mechanism

#### Issue 3: Cookie Extraction ⚠️
- **Location**: discord-bot.js lines 98-99
- **Problem**: Assumes `Set-Cookie` header is string/array
- **Impact**: May fail if header format unexpected
- **Better Approach**: Use Bearer tokens instead of cookies

#### Issue 4: No Error Recovery ⚠️
- **Location**: Lines 76-79 generic error handler
- **Problem**: Limited context on why API calls fail
- **Impact**: Hard to debug connectivity issues
- **Solution**: Add specific error handling for auth vs. other failures

#### Issue 5: Hardcoded API URL ⚠️
- **Location**: discord-bot.js line 5
- **Problem**: Defaults to `http://localhost:3000/api`
- **Impact**: Must explicitly set `API_BASE_URL` for production
- **Note**: env variable fallback works but local default could cause confusion

---

## 2. Cloudflare Configuration

### Current State

**File**: `/home/user/test-web/wrangler.toml`

```toml
name = "team-task-manager"
main = "worker.js"
compatibility_date = "2024-01-01"

# D1 Database binding
[[d1_databases]]
binding = "DB"
database_name = "task-manager-db"
database_id = "005ae015-b328-4465-aa8a-eb209c0421b5"

# Environment variables (non-sensitive)
[vars]
ENVIRONMENT = "production"
SUPABASE_URL = "https://oxbaswpyxryvygamgtsu.supabase.co"

# Secrets (requires: wrangler secret put <NAME>)
# SUPABASE_ANON_KEY
# SUPABASE_SERVICE_ROLE_KEY
# SUPABASE_JWT_SECRET
# SESSION_SECRET
# ANTHROPIC_API_KEY (optional)

# Development environment
[env.dev]
name = "team-task-manager-dev"
[env.dev.vars]
ENVIRONMENT = "development"
```

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              Cloudflare Pages (Frontend)                     │
│         https://your-app.pages.dev                           │
└────────────────────┬─────────────────────────────────────────┘
                     │ API Calls (Bearer Token)
                     ↓
┌──────────────────────────────────────────────────────────────┐
│         Cloudflare Pages Functions                           │
│         (functions/_worker.js)                               │
│  - JWT Verification (JOSE library)                           │
│  - Health checks                                             │
│  - Auth endpoints                                            │
│  - D1 Database access                                        │
└────────────┬───────────────────────────────────────────────────┘
             │
             ↓
┌──────────────────────────────────────────────────────────────┐
│           Cloudflare D1 Database (PostgreSQL)                │
│         (task-manager-db)                                    │
│  Tables:                                                     │
│  - users                                                     │
│  - projects                                                  │
│  - tasks                                                     │
│  - activity_logs                                             │
│  - project_members                                           │
└──────────────────────────────────────────────────────────────┘

External Services:
  - Supabase Auth (JWT tokens, email/password auth)
  - Anthropic Claude API (optional)
```

### Deployment Options

#### Option 1: Local Development (Current) ✅ ACTIVE
- **Server**: Express.js (server-auth.js)
- **Database**: JSON files in `/data` directory
- **Port**: http://localhost:3000
- **Discord Bot**: Separate Node.js process (discord-bot.js)

#### Option 2: Cloudflare Workers + D1 + Pages (Recommended for Production)
- **Frontend**: Cloudflare Pages (public folder)
- **API**: Cloudflare Workers or Pages Functions
- **Database**: D1 (PostgreSQL-compatible)
- **Authentication**: Stateless JWT verification (Bearer tokens)

### Key Configuration Details

**D1 Database ID**: `005ae015-b328-4465-aa8a-eb209c0421b5`  
**D1 Database Name**: `task-manager-db`  
**Database Binding**: `DB` (used in worker.js as `env.DB`)

**Required Secrets** (must be set with `wrangler secret put`):
1. `SUPABASE_ANON_KEY` - Frontend-safe Supabase key
2. `SUPABASE_SERVICE_ROLE_KEY` - Server-only Supabase key
3. `SUPABASE_JWT_SECRET` - For JWT verification
4. `SESSION_SECRET` - For session management
5. `ANTHROPIC_API_KEY` - Optional, for Claude AI features

### Pages Functions Scaffold

**File**: `/home/user/test-web/functions/_worker.js`  
**Status**: Minimal scaffold with basic endpoints

Implemented endpoints:
- `GET /api/health` - Health check
- `GET /api/db-check` - Database connectivity test
- `GET /api/auth/me` - Get current user (requires Bearer token)

**Issues Found**:
- Incomplete port from `server-auth.js` (missing most endpoints)
- No Discord integration in worker (bot only talks to Express server)
- Missing task/project CRUD operations
- No Claude AI endpoints in worker

---

## 3. Environment Variables

### `.env.example` File Location
`/home/user/test-web/.env.example` (40 lines)

### Required Variables

#### Server Configuration
```bash
PORT=3000                          # Server listening port
NODE_ENV=development               # development or production
```

#### Session & Security
```bash
SESSION_SECRET=your-secret-key-here
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

#### Claude AI Integration (Optional)
```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

#### Discord Bot Integration (Optional)
```bash
DISCORD_BOT_TOKEN=your-discord-bot-token-here
API_BASE_URL=http://localhost:3000/api
```

#### Supabase Authentication (Optional)
```bash
SUPABASE_URL=https://oxbaswpyxryvygamgtsu.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

#### Cloudflare D1 (Optional, for Production)
```bash
CLOUDFLARE_ACCOUNT_ID=your-account-id-here
CLOUDFLARE_D1_DATABASE_ID=your-database-id-here
CLOUDFLARE_API_TOKEN=your-api-token-here
```

### How Environment Variables Are Loaded

**Local Development**:
1. `start.js` loads `.env` via `dotenv` (line 21 in start.js)
2. Express server reads via `process.env`
3. Bot reads via `process.env`

**Cloudflare Production**:
1. Variables defined in `wrangler.toml` [vars] section
2. Secrets stored via `wrangler secret put` command
3. Accessed via `env` parameter in worker/pages functions

### Issues Found

#### Issue 1: Missing .env File ⚠️
- `.env.example` exists but actual `.env` must be created
- Running without `.env` shows: "❌ No .env file found!" (start.js line 24)
- Solution: `npm run setup` creates it interactively

#### Issue 2: No Automatic Validation ⚠️
- Discord bot will crash if `DISCORD_BOT_TOKEN` missing (intentional)
- Server won't crash (Discord optional)
- But unclear which variables are truly required vs. optional
- Solution: Document required vs. optional in `.env.example`

#### Issue 3: API_BASE_URL Mismatch ⚠️
- Discord bot uses `API_BASE_URL` env var
- But `/api` path is hardcoded in server routes
- If user sets `API_BASE_URL=http://localhost:3000` (without `/api`), bot will fail
- Example of proper setup: `API_BASE_URL=http://localhost:3000/api`

#### Issue 4: Port Duplication ⚠️
- `.env` has `PORT=3000`
- `wrangler.toml` has implicit Cloudflare port
- Local dev and Cloudflare use different port systems
- Not a breaking issue but confusing for developers

---

## 4. API Routes & Endpoints

### Local Development (Express Server)

**File**: `/home/user/test-web/server-auth.js` (1400+ lines)

#### Authentication Routes
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/logout` | POST | Session | Logout user |
| `/api/auth/me` | GET | Session | Get current user |
| `/api/auth/magic-link` | POST | None | Send magic link email |
| `/api/auth/supabase-callback` | POST | None | Supabase OAuth callback |
| `/api/auth/profile-setup` | POST | Session | Complete profile |
| `/api/auth/supabase-login` | POST | None | Supabase email login |
| `/api/auth/supabase` | POST | None | Generic Supabase auth |

#### User Management Routes
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/users` | GET | Session | List all users |
| `/api/users/:id` | GET | Session | Get user details |
| `/api/auth/me` | PUT | Session | Update user profile |
| `/api/users/:id` | DELETE | Admin | Delete user |

#### Project Management Routes
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/projects` | GET | Session | List user's projects |
| `/api/projects/:id` | GET | Session | Get project details |
| `/api/projects` | POST | Session | Create project |
| `/api/projects/:id` | PUT | Session | Update project |
| `/api/projects/:id` | DELETE | Session | Delete project |
| `/api/projects/:id/members` | POST | Session | Add member |
| `/api/projects/:id/members/:userId` | DELETE | Session | Remove member |

#### Task Management Routes
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/tasks` | GET | Session | List user's tasks |
| `/api/tasks/:id` | GET | Session | Get task details |
| `/api/tasks` | POST | Session | Create task |
| `/api/tasks/:id` | PUT | Session | Update task |
| `/api/tasks/:id` | DELETE | Session | Delete task |

#### Claude AI Routes
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/claude/ask` | POST | Session | Ask Claude question |
| `/api/claude/summary` | GET | Session | Get task summary |
| `/api/claude/priorities` | GET | Session | Get priority analysis |
| `/api/claude/status` | GET | Session | Check Claude health |

#### Activity & Config Routes
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/activity` | GET | Session | Get activity log |
| `/api/config/public` | GET | None | Get public config (Supabase URL/key) |

### Cloudflare Production (Partial Implementation)

**File**: `/home/user/test-web/functions/_worker.js` (95 lines)

Only 3 endpoints implemented (incomplete scaffold):
- `GET /api/health` ✅
- `GET /api/db-check` ✅
- `GET /api/auth/me` ✅

**Missing Endpoints** (need to be ported from server-auth.js):
- All project management endpoints
- All task management endpoints
- All Claude AI endpoints
- Auth/register endpoint
- Activity logging
- ~25+ other routes

---

## 5. Discord vs. Cloudflare Workers Communication

### Current Setup (Local Dev)

```
Discord Bot                  Cloudflare D1
    ↓ HTTP (axios)              ↓
Express Server (server-auth.js)   ← Uses JSON files
    ↓
User Sessions stored in:
- In-memory Map (Discord bot)
- Express sessions (Server)
- Supabase (optional)
```

### Production Setup (Intended)

```
Discord Bot                  Cloudflare Pages Functions
    ↓ HTTP (axios)               ↓
    ├─────────────────────────────┤
    │  Bearer Token Auth?         │
    │  (Issue: Not yet            │
    │   implemented in bot)       │
    └─────────────────────────────┘
                ↓
            D1 Database
```

### Key Issue: Discord Bot Not Adapted for Cloudflare ⚠️

**Problem**: Discord bot is hardcoded to talk to Express server:

```javascript
// discord-bot.js line 5
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';

// It makes requests like:
axios.post(`${API_BASE}/auth/login`, { username, password })
axios.get(`${API_BASE}/tasks`, { headers: { Cookie: session } })
```

**In production, when migrating to Cloudflare**:
1. Set `API_BASE_URL=https://your-app.pages.dev/api`
2. Bot would send cookies to Pages Functions
3. But Pages Functions verify Bearer tokens, not sessions
4. **Result**: Bot auth will fail

**Solution Required**:
Either:
1. Keep Express server running for Discord bot communication
2. Refactor Discord bot to use Bearer tokens
3. Create adapter endpoints that handle both cookie + Bearer auth

---

## 6. Local vs. Production Environment Differences

### Local Development

| Aspect | Details |
|--------|---------|
| **Server** | Express.js (server-auth.js) |
| **Port** | 3000 (configurable via PORT env var) |
| **Database** | JSON files in `/data/` directory |
| **Data Files** | users.json, projects.json, tasks.json, activity.json |
| **Authentication** | Express sessions (cookies) |
| **JWT** | Optional Supabase JWT |
| **Discord Bot** | Separate Node.js process (discord-bot.js) |
| **API Calls** | Direct to Express (http://localhost:3000/api) |
| **Auth Method** | Session cookies |
| **File Serving** | Static files from `public/` via Express |
| **CORS** | Configured in server-auth.js for localhost |
| **Startup** | `npm start` or `npm run dev-all` (with bot) |

### Production (Cloudflare)

| Aspect | Details |
|--------|---------|
| **Server** | Cloudflare Pages + Workers |
| **Port** | Auto-assigned by Cloudflare |
| **Database** | D1 (PostgreSQL-compatible) |
| **Data Storage** | SQL tables (not JSON files) |
| **Authentication** | Stateless JWT (Bearer tokens) |
| **JWT** | Supabase RS256 (JWKS) or HS256 |
| **Discord Bot** | Still requires separate deployment |
| **API Calls** | To Cloudflare worker/pages domain |
| **Auth Method** | Bearer tokens in Authorization header |
| **File Serving** | Cloudflare Pages static hosting |
| **CORS** | Configured in Pages/Worker CORS headers |
| **Secrets** | `wrangler secret put` |
| **Deployment** | `wrangler deploy` or `wrangler pages deploy` |
| **API Response** | Bearer token from Supabase |

### Critical Differences Summary

1. **Authentication Model**: Sessions → Stateless JWT
2. **Database**: JSON → D1 SQL
3. **Server Runtime**: Node.js → Cloudflare Worker
4. **Deployment**: localhost:3000 → *.pages.dev
5. **Discord Bot**: Still requires separate Node.js process
6. **API Schema**: Same endpoints, different auth method

### Migration Challenges

1. **Discord Bot Must Change**: Cookie auth → Bearer token auth
2. **Session Storage**: In-memory → Must recreate in Cloudflare (KV storage)
3. **Data Migration**: Export JSON → Import to D1
4. **Schema Alignment**: Ensure D1 schema matches app expectations
5. **Rate Limiting**: Local memory → Cloudflare KV

---

## 7. Identified Issues & Recommendations

### Critical Issues

#### 🔴 Issue 1: Discord Bot Session Loss on Restart
- **Severity**: High
- **Location**: discord-bot.js line 14
- **Description**: In-memory session storage lost on bot restart
- **Impact**: All users must re-login after bot restarts
- **Recommendation**:
  ```javascript
  // Current (bad):
  const userSessions = new Map();
  
  // Better option 1 - Use API tokens instead:
  // Have server issue long-lived API tokens instead of session cookies
  // Store Discord User ID → Token mapping in database
  
  // Better option 2 - Use Redis:
  const redis = require('redis');
  const client = redis.createClient();
  // Store sessions in Redis for persistence across restarts
  ```

#### 🔴 Issue 2: Discord Bot Not Compatible with Cloudflare
- **Severity**: High
- **Location**: discord-bot.js (entire file uses cookies)
- **Description**: Bot won't work with Cloudflare Pages Functions JWT auth
- **Impact**: Cannot use Discord bot with Cloudflare deployment
- **Recommendation**:
  ```javascript
  // Create auth abstraction:
  // If API_BASE_URL points to Cloudflare (uses .pages.dev):
  //   Use Bearer token auth
  // If API_BASE_URL points to Express server:
  //   Use cookie auth
  
  // Or better - always use Bearer tokens:
  // Issue API tokens from server instead of relying on sessions
  ```

#### 🔴 Issue 3: Incomplete Cloudflare Worker Implementation
- **Severity**: High
- **Location**: functions/_worker.js (95 lines, only 3 endpoints)
- **Description**: Most API endpoints not ported to worker
- **Impact**: Cannot deploy to Cloudflare without completing worker
- **Recommendation**:
  Port all endpoints from server-auth.js (30+ routes) to worker.js, using D1 database and Bearer token auth

### High-Priority Issues

#### 🟠 Issue 4: No Token Refresh Mechanism
- **Severity**: High
- **Location**: Both Discord bot and server-auth.js
- **Description**: No token refresh; users must re-login after token expires
- **Recommendation**:
  ```javascript
  // Implement refresh token mechanism:
  // 1. Issue short-lived access token (15 min)
  // 2. Issue long-lived refresh token (30 days)
  // 3. Endpoint to refresh access token using refresh token
  ```

#### 🟠 Issue 5: Discord Bot Error Handling
- **Severity**: Medium-High
- **Location**: discord-bot.js lines 76-79, generic error handler
- **Description**: Poor error messages for debugging API failures
- **Recommendation**:
  ```javascript
  // Add specific error handling:
  if (error.response?.status === 401) {
    return message.reply('❌ Authentication failed. Please login again with: `login <username> <password>`');
  } else if (error.response?.status === 404) {
    return message.reply('❌ API endpoint not found. Server may be offline.');
  }
  // etc.
  ```

#### 🟠 Issue 6: No Rate Limiting on Discord Bot
- **Severity**: Medium
- **Location**: discord-bot.js (no rate limiting)
- **Description**: Bot not rate-limited; could spam API
- **Recommendation**:
  ```javascript
  // Implement per-user rate limiting:
  const userRateLimit = new Map(); // Discord User ID → request count
  
  function checkRateLimit(userId, maxRequests = 5, windowMs = 60000) {
    const now = Date.now();
    const userLimit = userRateLimit.get(userId) || { count: 0, resetAt: now + windowMs };
    
    if (now > userLimit.resetAt) {
      userRateLimit.set(userId, { count: 1, resetAt: now + windowMs });
      return true;
    }
    
    if (userLimit.count >= maxRequests) return false;
    userLimit.count++;
    return true;
  }
  ```

### Medium-Priority Issues

#### 🟡 Issue 7: API_BASE_URL Configuration Confusion
- **Severity**: Medium
- **Location**: discord-bot.js line 5, setup.js
- **Description**: Default localhost fallback could cause confusion in production
- **Recommendation**:
  - Remove localhost default in production builds
  - Validate API_BASE_URL is set to expected domain
  - Add validation that URL ends with `/api`

#### 🟡 Issue 8: No Message Deletion Error Handling
- **Severity**: Low-Medium
- **Location**: discord-bot.js lines 104-110
- **Description**: Tries to delete credential message but ignores all errors
- **Recommendation**:
  ```javascript
  // Current:
  try { await message.delete(); } 
  catch (e) { /* Ignore */ }
  
  // Better:
  try { await message.delete(); }
  catch (e) {
    if (e.code !== 'Unknown Message') console.warn('Failed to delete message:', e);
    // Only ignore already-deleted messages
  }
  ```

#### 🟡 Issue 9: Supabase JWT Verification Dual-Mode
- **Severity**: Low-Medium
- **Location**: worker.js lines 95-123
- **Description**: Falls back to HS256 if JWKS fails (RS256 primary)
- **Impact**: Unclear which algorithm should be used
- **Recommendation**:
  Document the auth flow clearly:
  1. Prefer RS256 with JWKS (remote key set)
  2. Fall back to HS256 with SUPABASE_JWT_SECRET
  3. Choose one standard for production

### Low-Priority Issues

#### 🟢 Issue 10: Missing Endpoint Documentation
- **Severity**: Low
- **Location**: Functions/_worker.js
- **Description**: Incomplete scaffold lacks documentation
- **Recommendation**: Add JSDoc comments for each endpoint

#### 🟢 Issue 11: No Graceful Shutdown Handler
- **Severity**: Low
- **Location**: discord-bot.js
- **Description**: Bot doesn't gracefully close on SIGTERM
- **Recommendation**:
  ```javascript
  process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    client.destroy();
    process.exit(0);
  });
  ```

---

## 8. Setup Instructions

### Prerequisites
- Node.js 16+ (checked in setup.js line 46)
- npm
- Optional: Cloudflare account (for production)
- Optional: Discord Developer account (for bot)

### Local Development Setup

```bash
# 1. Clone repository (already done)
cd test-web

# 2. Install dependencies
npm install

# 3. Interactive setup (creates .env and configures everything)
npm run setup
# Prompts for:
# - Port (default 3000)
# - Claude API key (optional)
# - Discord bot token (optional)
# - Cloudflare credentials (optional)

# 4. Start server
npm start
# Or with Discord bot:
npm run dev-all

# Server runs on: http://localhost:3000
# Default login: admin / admin123
```

### Discord Bot Setup

```bash
# 1. Create Discord application
#    Visit: https://discord.com/developers/applications
#    New Application → Copy bot token

# 2. Add to .env
DISCORD_BOT_TOKEN=your-token-here
API_BASE_URL=http://localhost:3000/api

# 3. Give bot permissions in Discord
#    Select: Send Messages, Read Message History, Read Messages/View Channels
#    Attach to server with: https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=67584

# 4. Start Discord bot
npm run discord
# Or together with server:
npm run dev-all
```

### Cloudflare Production Setup

```bash
# 1. Create D1 database
wrangler d1 create task-manager-db

# 2. Update wrangler.toml with database_id from output

# 3. Apply schema
wrangler d1 execute task-manager-db --file=./schema.sql

# 4. Set secrets
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put SESSION_SECRET

# 5. Deploy Pages
wrangler pages deploy public --project-name=team-task-manager

# 6. Deploy Worker (if separate)
wrangler deploy
```

---

## 9. Deployment Topology Options

### Option A: Local Development (Current) ✅

```
Browser → http://localhost:3000
          ↓
    Express Server (server-auth.js)
          ↓
    JSON Files (/data/)
    
Discord → axios calls to http://localhost:3000/api
```

**When to use**: Development, testing, small teams

### Option B: Express + Cloudflare D1 (Migration)

```
Browser → http://localhost:3000
          ↓
    Express Server (server-auth.js)
          ↓
    Cloudflare D1 Database (replace JSON)
    
Discord → axios calls to http://localhost:3000/api (still works)
```

**When to use**: When scaling JSON storage becomes bottleneck

### Option C: Cloudflare Pages + Workers + D1 (Full)

```
Browser → https://app.pages.dev
          ↓
    Cloudflare Pages (frontend)
          ↓
    Cloudflare Worker (API)
          ↓
    D1 Database
    
Discord → REQUIRES REFACTORING
          Must use Bearer tokens instead of cookies
```

**When to use**: Production, serverless, global edge


---

## 10. Testing Checklist

### Local Development

- [ ] `npm install` completes successfully
- [ ] `npm run setup` creates .env file
- [ ] `npm start` server starts without errors
- [ ] Server listens on http://localhost:3000
- [ ] Default admin user created (admin/admin123)
- [ ] Login page accessible at /login.html
- [ ] Dashboard loads after login
- [ ] Can create projects
- [ ] Can create tasks
- [ ] API endpoints respond (check /api/tasks)

### Discord Bot (if configured)

- [ ] Discord bot token set in .env
- [ ] API_BASE_URL points to correct server
- [ ] `npm run discord` bot starts
- [ ] Bot appears online in Discord
- [ ] Can mention bot in channel
- [ ] `@bot login username password` works
- [ ] `@bot tasks` shows task count
- [ ] `@bot summary` (if Claude configured) works
- [ ] Session persists across commands (in same session)

### Cloudflare Deployment (before deploying)

- [ ] wrangler.toml has correct database_id
- [ ] D1 database created: `wrangler d1 list`
- [ ] Schema applied: `wrangler d1 execute task-manager-db --file=./schema.sql`
- [ ] All secrets set: `wrangler secret list`
- [ ] Pages functions endpoint responds: `GET /api/health`
- [ ] Bearer token auth works: JWT verification in place
- [ ] D1 queries return results (db-check endpoint)

---

## Summary & Recommendations

### What's Working ✅
1. Discord bot code is well-structured with 6 commands
2. Express server has 30+ API endpoints
3. Environment variable system is flexible
4. Cloudflare configuration prepared (wrangler.toml ready)
5. D1 database schema defined in schema.sql

### What Needs Fixing 🔧
1. **Discord bot sessions** - Implement persistent storage (Redis/DB)
2. **Cloudflare Pages Functions** - Port all endpoints from server-auth.js
3. **Bearer token auth** - Discord bot must support stateless JWT
4. **Data migration** - Process to export JSON to D1 during migration
5. **Documentation** - Add migration guide for local → Cloudflare

### Recommended Next Steps 📋

**Immediate (Days 1-2)**:
1. Implement persistent session storage for Discord bot (use database)
2. Fix Discord bot error handling for better debugging
3. Document API authentication models

**Short-term (Week 1)**:
1. Complete Cloudflare Pages Functions (port all routes)
2. Refactor Discord bot to use Bearer tokens
3. Create D1 to/from JSON migration scripts

**Medium-term (Week 2-3)**:
1. Add token refresh mechanism
2. Implement Discord bot rate limiting
3. Full production deployment test

**Long-term**:
1. WebSocket support for real-time updates
2. Additional Discord commands (emoji reactions, buttons)
3. Advanced Cloudflare features (KV for caching, rate limiting)

---

**Document Generated**: 2025-11-09  
**Codebase Status**: Production-Ready (with noted issues for Cloudflare migration)  
**Recommendation**: Safe to use locally; complete Cloudflare port before production deployment
