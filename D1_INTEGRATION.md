# D1 Database Integration Guide

This guide explains **all the ways** Claude can access your Cloudflare D1 database.

## Understanding the Architecture

Claude AI (Anthropic API) **cannot directly access D1**. You need an intermediary. Here are your options:

## Option 1: Express Server → D1 API → Claude (Easiest)

**Best for:** Your current setup with Express server

```
┌──────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────┐
│ Discord  │───→│   Express   │───→│ Cloudflare   │    │ Claude   │
│   Bot    │    │   Server    │───→│  D1 API      │    │   API    │
└──────────┘    └──────┬──────┘    └──────────────┘    └────▲─────┘
                       │                                      │
                       │  1. Fetch data from D1              │
                       │  2. Pass to Claude Service          │
                       └──────────────────────────────────────┘
```

### How It Works

1. **Express server** calls Cloudflare API to query D1
2. Gets task/project data back
3. Passes that data to **Claude Service** (your `claude-service.js`)
4. Claude analyzes and returns response

### Setup

**Step 1: Get Cloudflare Credentials**

```bash
# 1. Account ID
# Go to: https://dash.cloudflare.com → Select domain → Copy Account ID from sidebar

# 2. Create D1 Database
wrangler d1 create task-manager
# Copy the database_id from output

# 3. Create API Token
# Go to: https://dash.cloudflare.com → Profile → API Tokens → Create Token
# Use template: "Edit Cloudflare Workers"
# Or create custom with: Account.D1 Read/Write
```

**Step 2: Configure Environment**

Add to `.env`:
```bash
CLOUDFLARE_ACCOUNT_ID=abc123...
CLOUDFLARE_D1_DATABASE_ID=def456...
CLOUDFLARE_API_TOKEN=your-token-here
```

**Step 3: Initialize D1 Database**

```bash
# Run schema
wrangler d1 execute task-manager --file=./schema.sql
```

**Step 4: Update Server (already done!)**

The `d1-client.js` I created handles this. Your server automatically uses D1 when configured, or falls back to JSON files.

### Pros & Cons

✅ **Pros:**
- Simple to set up
- Works with existing architecture
- No code changes to Claude service
- Secure (API token stays on server)

❌ **Cons:**
- Requires internet connection to Cloudflare
- API rate limits apply
- Slight latency from API calls

---

## Option 2: Cloudflare Workers → D1 → Claude (Production)

**Best for:** Production deployment on Cloudflare

```
┌──────────┐    ┌─────────────┐    ┌──────────┐    ┌──────────┐
│ Discord  │───→│ Cloudflare  │───→│    D1    │    │ Claude   │
│   Bot    │    │   Worker    │    │ Database │    │   API    │
└──────────┘    └──────┬──────┘    └──────────┘    └────▲─────┘
                       │                                  │
                       │  Direct D1 binding               │
                       │  Call Claude API                 │
                       └──────────────────────────────────┘
```

### How It Works

1. Deploy your Express app as a **Cloudflare Worker**
2. Worker has **direct D1 binding** (fastest access)
3. Worker calls Claude API with D1 data
4. Returns response

### Setup

**Create `wrangler.toml`:**

```toml
name = "task-manager"
main = "worker.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "task-manager"
database_id = "your-database-id-here"

[vars]
ANTHROPIC_API_KEY = "sk-ant-..."  # Don't commit! Use secrets instead
```

**Create Worker:**

```javascript
// worker.js
export default {
  async fetch(request, env) {
    // env.DB is your D1 database (direct binding!)

    // Example: Get tasks
    const tasks = await env.DB.prepare(
      'SELECT * FROM tasks WHERE assigned_to_id = ?'
    ).bind(userId).all();

    // Call Claude
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `Analyze these tasks: ${JSON.stringify(tasks.results)}`
        }]
      })
    });

    return response;
  }
}
```

**Deploy:**

```bash
wrangler deploy
```

### Pros & Cons

✅ **Pros:**
- Fastest (direct D1 binding)
- Scales automatically
- No server management
- Global edge network

❌ **Cons:**
- Requires rewriting Express to Workers
- Different deployment process
- Learning curve for Workers API

---

## Option 3: MCP Server (For Claude Desktop Only)

**Best for:** Using Claude Desktop app, not API

```
┌──────────────┐    ┌─────────────┐    ┌──────────┐
│    Claude    │───→│     MCP     │───→│    D1    │
│   Desktop    │    │   Server    │    │ Database │
└──────────────┘    └─────────────┘    └──────────┘
```

### Important: This is NOT for your use case!

MCP (Model Context Protocol) is for **Claude Desktop app**, not the Anthropic API. Since you want:
- Discord bot integration
- Web API access
- Server-side Claude

**You don't need MCP.** Skip this option.

### But if you were curious...

MCP lets Claude Desktop directly access your data sources. You'd create an MCP server that queries D1 and exposes tools to Claude Desktop.

**Not suitable because:**
- Only works with Claude Desktop (not API)
- Requires local Claude Desktop app
- Can't integrate with Discord bot
- Not designed for server deployments

---

## Recommended Approach for Your Setup

**Use Option 1: Express → D1 API → Claude**

Why?
1. ✅ Works with your existing Express server
2. ✅ Minimal code changes
3. ✅ Easy to test (can switch between JSON and D1)
4. ✅ Compatible with Discord bot
5. ✅ Secure (credentials on server only)

**Migration Path:**

```javascript
// server-auth.js - Hybrid approach

const D1Client = require('./d1-client');
const d1 = new D1Client();

// Check if D1 is configured
const useD1 = process.env.CLOUDFLARE_ACCOUNT_ID &&
              process.env.CLOUDFLARE_D1_DATABASE_ID;

async function getTasks(userId) {
  if (useD1) {
    // Use D1
    return await d1.getUserTasks(userId);
  } else {
    // Fall back to JSON files
    return readJSON(TASKS_FILE);
  }
}
```

This way:
- Development: Use JSON files (fast, no API calls)
- Production: Use D1 (scalable, persistent)
- Same code works for both!

---

## Authentication & API Keys

### What You Need

1. **Cloudflare API Token**
   - Purpose: Authenticate Express server → D1 API calls
   - Get from: https://dash.cloudflare.com → Profile → API Tokens
   - Permissions: `Account.D1 Read/Write`
   - Store in: `.env` file (never commit!)

2. **Anthropic API Key**
   - Purpose: Claude service → Anthropic API calls
   - Get from: https://console.anthropic.com/settings/keys
   - Store in: `.env` file (never commit!)

3. **Cloudflare Account ID**
   - Purpose: Identify your Cloudflare account
   - Get from: Dashboard sidebar
   - Not secret (but don't share publicly)

4. **D1 Database ID**
   - Purpose: Identify which D1 database to use
   - Get from: `wrangler d1 create` output
   - Not secret (but specific to your database)

### Security Best Practices

```bash
# .env file (NEVER commit this!)
CLOUDFLARE_API_TOKEN=very-secret-token-here
ANTHROPIC_API_KEY=sk-ant-very-secret-here
SESSION_SECRET=random-secret-here

# .gitignore
.env
.env.*
!.env.example
```

**In production:**
- Use environment variables (Cloudflare secrets, Heroku config vars, etc.)
- Rotate API keys regularly
- Monitor API usage
- Set up billing alerts

---

## Step-by-Step Setup

### 1. Create D1 Database

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create database
wrangler d1 create task-manager

# Output will show:
# database_id = "abc-123-def"
# Copy this!
```

### 2. Initialize Schema

```bash
# Run your schema.sql
wrangler d1 execute task-manager --file=./schema.sql

# Verify
wrangler d1 execute task-manager --command="SELECT * FROM users"
```

### 3. Get API Token

```bash
# Go to: https://dash.cloudflare.com/profile/api-tokens
# Click: Create Token
# Template: "Edit Cloudflare Workers" OR
# Custom: Account.D1 Read/Write

# Copy the token (you'll only see it once!)
```

### 4. Configure Application

```bash
# Create .env file
cat > .env <<EOF
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_D1_DATABASE_ID=your-database-id
CLOUDFLARE_API_TOKEN=your-api-token
ANTHROPIC_API_KEY=sk-ant-your-key
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EOF
```

### 5. Test Connection

```javascript
// test-d1.js
const D1Client = require('./d1-client');

async function test() {
  const d1 = new D1Client();
  const users = await d1.getUsers();
  console.log('Users:', users);
}

test();
```

```bash
node test-d1.js
```

---

## Troubleshooting

### Error: "D1 credentials not configured"

**Cause:** Missing environment variables

**Fix:**
```bash
# Check .env file exists
cat .env

# Verify variables are set
echo $CLOUDFLARE_ACCOUNT_ID
```

### Error: "Authentication failed"

**Cause:** Invalid or expired API token

**Fix:**
1. Check token in Cloudflare dashboard
2. Verify it has D1 permissions
3. Create new token if expired

### Error: "Database not found"

**Cause:** Wrong database ID or database doesn't exist

**Fix:**
```bash
# List your databases
wrangler d1 list

# Verify ID matches .env
```

### Error: "SQL error: no such table"

**Cause:** Schema not initialized

**Fix:**
```bash
# Run schema
wrangler d1 execute task-manager --file=./schema.sql

# Verify tables exist
wrangler d1 execute task-manager --command="SELECT name FROM sqlite_master WHERE type='table'"
```

---

## Cost Considerations

### Cloudflare D1 Pricing

**Free Tier:**
- 100,000 reads/day
- 50,000 writes/day
- 5 GB storage
- Plenty for small teams!

**Paid (Workers Paid plan - $5/month):**
- 25M reads/month
- 50M writes/month
- Unlimited databases

### API Calls

- **D1 API calls:** Count toward Cloudflare API limits (very high)
- **Claude API calls:** Metered by tokens (see Anthropic pricing)

**Optimization:**
- Cache frequently accessed data
- Batch queries when possible
- Use database indexes
- Monitor usage in Cloudflare dashboard

---

## Next Steps

1. **Test locally with JSON files** (already working!)
2. **Create D1 database** when ready for production
3. **Configure credentials** in `.env`
4. **Server auto-detects** and uses D1 if configured
5. **Monitor** usage in Cloudflare dashboard

## Summary

**For your Discord bot + Claude integration:**

✅ **Use Option 1** (Express → D1 API → Claude)
✅ **Set 3 environment variables** (account ID, database ID, API token)
✅ **Code already supports it** (hybrid JSON/D1 approach)
✅ **No MCP needed** (that's for Claude Desktop only)

The data flow is simple:
1. Discord command → Express server
2. Express → Fetch from D1 (via API)
3. Express → Pass to Claude service
4. Claude service → Call Anthropic API
5. Response → Back through chain

All authenticated with API keys in `.env` file!
