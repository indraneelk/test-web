# Quick Start Guide

Get your task manager running in **5 minutes**.

## Prerequisites

- **Node.js 16+** ([Download](https://nodejs.org/))
- **Git** (to clone the repo)

## Setup Steps

### 1. Clone & Enter Directory

```bash
git clone <your-repo-url>
cd test-web
```

### 2. Run Interactive Setup

```bash
npm run setup
```

This will:
- ✅ Install all dependencies automatically
- ✅ Guide you through configuration (API keys, ports, etc.)
- ✅ Generate secure secrets
- ✅ Create `.env` file
- ✅ Validate everything

**Just answer the prompts!** It takes 2-3 minutes.

### 3. Start the Server

```bash
npm start
```

### 4. Open Your Browser

```
http://localhost:3000
```

**Default Login:**
- Username: `admin`
- Password: `admin123`

---

## That's It! 🎉

You now have:
- ✅ Task manager web app running
- ✅ RESTful API available
- ✅ Authentication working
- ✅ Database ready (JSON or D1)

---

## Optional: API Keys

### Get Claude AI Working (Recommended)

1. Get API key: https://console.anthropic.com/settings/keys
2. During setup, paste it when prompted
3. Enjoy AI-powered task summaries!

### Get Discord Bot Working (Optional)

1. Create bot: https://discord.com/developers/applications
2. Get bot token
3. During setup, paste it when prompted
4. Run: `npm run dev-all` (starts server + bot)

---

## What You Get

### Web Interface
- 📋 Create and manage tasks
- 📁 Organize by projects
- 👥 Team collaboration
- ✅ Beautiful Asana-like UI
- 🎉 Celebration animations

### API Endpoints
```bash
# Authentication
POST /api/auth/login
POST /api/auth/register
GET  /api/auth/me

# Tasks
GET    /api/tasks
POST   /api/tasks
PUT    /api/tasks/:id
DELETE /api/tasks/:id

# Projects
GET    /api/projects
POST   /api/projects
PUT    /api/projects/:id
DELETE /api/projects/:id

# Claude AI (if configured)
POST /api/claude/ask
GET  /api/claude/summary
GET  /api/claude/priorities
```

### Discord Bot (if configured)
```
@TaskBot login username password
@TaskBot tasks
@TaskBot summary
@TaskBot ask what should I work on?
```

---

## Commands

```bash
npm run setup       # Interactive setup (run first time)
npm start           # Start server with validation
npm run server      # Start server only (no validation)
npm run discord     # Start Discord bot only
npm run dev-all     # Start server + Discord bot
```

---

## Configuration Modes

### Development (Default)
- Uses JSON files for data storage
- No cloud dependencies
- Fast and simple
- Perfect for local testing

```bash
# No D1 credentials in .env
SESSION_SECRET=abc123
ANTHROPIC_API_KEY=sk-ant-...
```

### Production
- Uses Cloudflare D1 database
- Scalable and persistent
- Global distribution

```bash
# Add D1 credentials in .env
SESSION_SECRET=abc123
ANTHROPIC_API_KEY=sk-ant-...
CLOUDFLARE_ACCOUNT_ID=your-id
CLOUDFLARE_D1_DATABASE_ID=your-db-id
CLOUDFLARE_API_TOKEN=your-token
```

The app **automatically detects** which mode to use!

---

## Troubleshooting

### "No .env file found"
```bash
npm run setup
```

### "Dependencies not installed"
```bash
npm install
```

### "Port already in use"
Edit `.env` and change `PORT=3000` to another port.

### "Claude AI not working"
Make sure `ANTHROPIC_API_KEY` is set in `.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### "Can't login"
Default credentials:
- Username: `admin`
- Password: `admin123`

---

## Next Steps

✅ **You're all set!** The app is running.

Want to customize?
- 📖 See [README.md](README.md) for full documentation
- 🤖 See [CLAUDE_INTEGRATION.md](CLAUDE_INTEGRATION.md) for AI features
- 🗄️ See [D1_INTEGRATION.md](D1_INTEGRATION.md) for production database
- 🏗️ See [DATA_SERVICE_ARCHITECTURE.md](DATA_SERVICE_ARCHITECTURE.md) for technical details

Want to deploy?
- Deploy to any VPS (DigitalOcean, Linode, AWS EC2)
- Or use Cloudflare Workers (see D1_INTEGRATION.md)
- Set production environment variables
- Run `npm start`

---

## Support

**Something not working?**

1. Check the logs for error messages
2. Make sure all environment variables are set
3. Try running `npm run setup` again
4. Check the documentation files

**Still stuck?** Open an issue with:
- Error message
- Your Node.js version (`node -v`)
- Your operating system
- Steps to reproduce

---

## License

MIT - See [LICENSE](LICENSE) file for details.

---

Made with ❤️ for productivity
