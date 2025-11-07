# Claude AI Integration Guide

This guide explains how to set up and use Claude AI integration with your task manager.

## Features

- 🤖 **AI-Powered Task Analysis**: Claude analyzes your tasks and provides intelligent summaries
- 🎯 **Priority Recommendations**: Get AI-driven suggestions on which tasks need attention
- 💬 **Natural Language Queries**: Ask Claude anything about your tasks in plain English
- 🔄 **Auto-Recovery**: Service automatically restarts on failures
- 📊 **Health Monitoring**: Built-in health checks and error tracking
- 🔐 **Secure**: Uses Anthropic API with proper authentication

## Setup

### 1. Get Your Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Create a new API key
3. Copy the key (starts with `sk-ant-api03-...`)

### 2. Configure Environment

Create a `.env` file in the project root:

```bash
# Required for Claude AI
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here

# Server configuration
PORT=3000
SESSION_SECRET=your-secret-here
ALLOWED_ORIGINS=http://localhost:3000
```

### 3. Install Dependencies

```bash
npm install
```

This will install:
- `@anthropic-ai/sdk` - Official Anthropic SDK
- All other required dependencies

### 4. Start the Server

```bash
npm start
```

You should see:
```
🤖 Initializing Claude API service...
✅ Claude API service ready
🚀 Task Manager server running on http://localhost:3000
```

## API Endpoints

All endpoints require authentication (login first).

### POST `/api/claude/ask`

Ask Claude a question about your tasks.

**Request:**
```json
{
  "question": "What tasks should I prioritize today?"
}
```

**Response:**
```json
{
  "question": "What tasks should I prioritize today?",
  "answer": "Based on your tasks, here are the priorities:\n1. Fix critical bug (overdue)\n2. Review PR #123 (due today)\n3. Update documentation (due tomorrow)",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET `/api/claude/summary`

Get an AI-generated summary of your tasks.

**Response:**
```json
{
  "summary": "You have 15 active tasks across 3 projects. 2 tasks are overdue and need immediate attention. Your 'Website Redesign' project has the most pending tasks.",
  "taskCount": 15,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET `/api/claude/priorities`

Get AI-driven priority recommendations.

**Response:**
```json
{
  "priorities": "Top 5 priorities:\n1. Fix login bug (URGENT - overdue)\n2. Deploy hotfix (due today)\n3. Review security audit (due tomorrow)\n4. Update API docs (in progress)\n5. Team standup prep (due this week)",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET `/api/claude/status`

Check Claude service health.

**Response:**
```json
{
  "ready": true,
  "requestCount": 42,
  "errorCount": 0,
  "lastHealthCheck": "2024-01-15T10:29:00.000Z",
  "uptime": 60000
}
```

## Using with Discord Bot

The Discord bot provides a conversational interface to Claude.

### Setup Discord Bot

1. Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Get the bot token
3. Add to `.env`:
```bash
DISCORD_BOT_TOKEN=your-discord-token
API_BASE_URL=http://localhost:3000/api
```

4. Start the bot:
```bash
npm run discord
```

### Discord Commands

**In Discord channel (mention the bot):**
```
@TaskBot login myusername mypassword
@TaskBot tasks
@TaskBot summary
@TaskBot priorities
@TaskBot ask what should I work on today?
```

**Or use DMs for privacy:**
```
login myusername mypassword
tasks
summary
ask what tasks are overdue?
```

## Architecture

```
┌─────────────┐
│   Discord   │
│     Bot     │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐      ┌──────────────┐
│   Express   │◄────►│    Claude    │
│   Server    │      │   Service    │
└──────┬──────┘      └──────┬───────┘
       │                     │
       │                     │ API
       ▼                     ▼
┌─────────────┐      ┌──────────────┐
│  JSON Files │      │  Anthropic   │
│  (Database) │      │     API      │
└─────────────┘      └──────────────┘
```

## Features in Detail

### Health Monitoring

The Claude service includes:
- **Automatic health checks** every 5 minutes
- **Auto-restart** on 3 consecutive failures
- **Exponential backoff** for retries
- **Error tracking** and logging

### Rate Limit Handling

The service automatically:
- Detects rate limits (429 errors)
- Waits for the specified retry period
- Retries up to 3 times
- Provides clear error messages

### Error Recovery

The service handles:
- **API authentication errors** - Stops service and logs clearly
- **Network errors** - Retries with exponential backoff
- **Server errors (5xx)** - Automatic retry
- **Invalid requests (4xx)** - Immediate failure with details

## Example Queries

Here are some example questions you can ask Claude:

### Task Analysis
- "What tasks are overdue?"
- "Show me tasks due this week"
- "Which project has the most pending work?"
- "What's the status of the website redesign project?"

### Prioritization
- "What should I focus on today?"
- "Which tasks are most urgent?"
- "Help me organize my tasks by priority"
- "What can I work on next?"

### Insights
- "How am I doing on my deadlines?"
- "What's blocking my team?"
- "Summarize project X progress"
- "What tasks can I delegate?"

## Troubleshooting

### Claude service not starting

**Error:** `ANTHROPIC_API_KEY environment variable is not set`

**Solution:** Make sure `.env` file exists and contains your API key:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

### Authentication failed

**Error:** `Authentication failed. Check ANTHROPIC_API_KEY`

**Solution:**
1. Verify your API key is valid
2. Check [Anthropic Console](https://console.anthropic.com/settings/keys)
3. Make sure the key hasn't expired
4. Verify you have API credits

### Rate limiting

**Error:** `Rate limited`

**Solution:** The service automatically handles this with retries. If it persists:
1. Reduce request frequency
2. Check your API usage limits
3. Upgrade your Anthropic plan if needed

### Service keeps restarting

Check the logs for specific errors:
- Network connectivity issues
- Invalid API responses
- Server errors from Anthropic

## Cost Considerations

Claude API usage is metered:
- Each query costs based on tokens used
- Monitor your usage in [Anthropic Console](https://console.anthropic.com/settings/usage)
- Set up billing alerts
- Consider caching common queries

## Security Best Practices

1. **Never commit `.env` file** - It contains secrets
2. **Use environment variables** - Don't hardcode API keys
3. **Rotate API keys** regularly
4. **Monitor API usage** for anomalies
5. **Use HTTPS in production**
6. **Restrict Discord bot** to specific channels/users

## Production Deployment

For production:

1. **Use process manager** (PM2, systemd):
```bash
pm2 start server-auth.js --name task-manager
pm2 start discord-bot.js --name discord-bot
```

2. **Set up monitoring**:
- Check `/api/claude/status` endpoint
- Alert on error count increases
- Monitor API costs

3. **Configure rate limiting**:
- Limit requests per user
- Implement request queuing
- Cache frequent queries

4. **Secure your deployment**:
- Use HTTPS
- Set proper CORS origins
- Use strong session secrets
- Enable secure cookies

## Support

- **Anthropic Documentation**: https://docs.anthropic.com
- **Discord.js Guide**: https://discordjs.guide
- **Task Manager Issues**: Check your server logs

## License

Same as main project (MIT)
