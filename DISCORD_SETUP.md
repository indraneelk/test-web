# Discord Bot Setup for Cloudflare Workers

This guide will help you set up Discord slash commands to work with Cloudflare Workers using the Interactions API.

## Architecture

We now have two separate Cloudflare Workers:

1. **team-task-manager** - Main web API (existing)
2. **discord-bot** - Discord Interactions webhook handler (new)

This separation keeps concerns isolated and allows independent scaling.

## Step 1: Get Discord Credentials

Go to https://discord.com/developers/applications and select your application.

### Required Credentials:

1. **Application ID**
   - Found on the "General Information" page
   - Copy the value under "APPLICATION ID"

2. **Public Key**
   - Found on the "General Information" page
   - Copy the value under "PUBLIC KEY" (64 character hex string)
   - This is used for Ed25519 signature verification

3. **Bot Token** (you already have this in .env)
   - Found on the "Bot" page
   - Used for registering commands

## Step 2: Add Application ID to .env

Add this line to your `.env` file:

```env
DISCORD_APPLICATION_ID=your_application_id_here
```

## Step 3: Register Slash Commands

Run the registration script:

```bash
node register-commands.js
```

This will register all 8 slash commands with Discord:
- `/tasks` - View your tasks
- `/create` - Create a new task
- `/complete` - Mark a task complete
- `/summary` - Get task summary
- `/priorities` - View high priority tasks
- `/claude` - AI assistant
- `/link` - Link Discord account
- `/help` - Show help

## Step 4: Set Cloudflare Secrets

Set the required secrets for the Discord worker:

```bash
# Set Discord Public Key
wrangler secret put DISCORD_PUBLIC_KEY --config wrangler-discord.toml

# Set Discord Bot Secret (for HMAC auth with main worker)
echo "5f79fbeea47d5978cf1f13e241499a86e85e47fa7f794f7bfca4e0ddcd8b99b8" | wrangler secret put DISCORD_BOT_SECRET --config wrangler-discord.toml
```

## Step 5: Deploy Discord Worker

Deploy the Discord worker to Cloudflare:

```bash
wrangler deploy --config wrangler-discord.toml
```

You'll get a URL like: `https://discord-bot.YOUR_SUBDOMAIN.workers.dev`

## Step 6: Configure Discord Application

1. Go back to https://discord.com/developers/applications
2. Select your application
3. Go to "General Information"
4. Find "INTERACTIONS ENDPOINT URL"
5. Enter your Discord worker URL with the `/interactions` path:
   ```
   https://discord-bot.YOUR_SUBDOMAIN.workers.dev/interactions
   ```
6. Click "Save Changes"

Discord will immediately send a PING request to verify the endpoint.

## Step 7: Test

In your Discord server, try the slash commands:

```
/help
/tasks
/create title:Test Task due:2025-12-31 priority:high
```

## Troubleshooting

### Commands not showing up
- Make sure you ran `register-commands.js`
- Wait a few minutes for Discord to sync
- Try leaving and rejoining the server

### "Invalid signature" errors
- Verify you set the correct DISCORD_PUBLIC_KEY
- Check the Cloudflare Workers logs: `wrangler tail --config wrangler-discord.toml`

### "API error" responses
- Check that the main worker (team-task-manager) is deployed and accessible
- Verify DISCORD_BOT_SECRET matches on both workers
- Check MAIN_WORKER_URL in wrangler-discord.toml

## Architecture Flow

```
Discord User
    ↓
    /command
    ↓
Discord API
    ↓
    POST /interactions (webhook)
    ↓
discord-bot worker (Cloudflare)
    ↓
    Verifies signature
    Routes to shared command handler
    ↓
    Makes authenticated API call
    ↓
team-task-manager worker (Cloudflare)
    ↓
    Processes request using D1 database
    ↓
    Returns data
    ↓
discord-bot worker
    ↓
    Formats Discord response
    ↓
Discord API
    ↓
User sees response
```

## Local Development

For local development, you can still use the gateway-based bot:

```bash
# Terminal 1: Run web server
npm start

# Terminal 2: Run Discord gateway bot
node discord-bot.js
```

The gateway bot connects directly to Discord and doesn't require webhook configuration.
