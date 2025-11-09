# Team Task Manager

> **🚀 TURNKEY READY**: Clone, run `npm run setup`, answer prompts, done!

A production-ready task management application with Asana-like features, AI-powered insights, and Discord integration.

## ⚡ Quick Start (3 Steps)

```bash
# 1. Clone and enter directory
git clone <repo-url> && cd test-web

# 2. Interactive setup (installs deps, configures everything)
npm run setup

# 3. Start!
npm start
```

**That's it!** Open http://localhost:3000 and login with `admin`/`admin123`

📖 **Want details?** See **[QUICKSTART.md](QUICKSTART.md)** for the complete 5-minute guide.

## ☁️ Deploy to Cloudflare Pages

**Quick Deploy (5 minutes):**

```bash
wrangler pages deploy public --project-name=mmw-tm
```

Then set environment variables in Cloudflare Dashboard and you're done!

📚 **Deployment Guides:**
- **[QUICK_DEPLOY.md](QUICK_DEPLOY.md)** - Fast deployment checklist
- **[CLOUDFLARE_PAGES_SETUP.md](CLOUDFLARE_PAGES_SETUP.md)** - Complete setup guide with troubleshooting
- **[DISCORD_SETUP.md](DISCORD_SETUP.md)** - Discord bot configuration

---

## 🎯 Features

### Simple Version (index.html + app.js)
- ✅ Task CRUD operations
- 🎉 Celebration animations on task completion
- 🔍 Filtering and search
- 📊 Real-time statistics
- 🎨 Beautiful Asana-inspired UI

### Multi-User Version (index.html + app-auth.js)
- 🔐 **User Authentication** - Secure login/registration system
- 👥 **Multi-user Support** - Multiple team members
- 📁 **Project Management** - Create and manage projects
- 🔒 **Access Control** - Project owners and members
- 👤 **User Assignment** - Assign tasks to team members
- ⚙️ **Project Settings** - Manage team members, project details
- 🎯 **View Filtering** - See all tasks, your tasks, or by project
- 📈 **Activity Tracking** - Log of all actions

## 🚀 Quick Start

### Prerequisites
```bash
npm install
```

### Running Simple Version
```bash
npm start
# Visit: http://localhost:3000
# Uses: index.html + app.js + server.js
```

### Running Multi-User Version
```bash
# Use the authentication-enabled server
node server-auth.js
# Visit: http://localhost:3000/
# or login at: http://localhost:3000/login.html

## Supabase Auth (optional)

Set environment variables:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=... (frontend-safe)
SUPABASE_SERVICE_ROLE_KEY=... (server-only)
```

Authentication model: stateless JWT (Authorization: Bearer). Clients attach the Supabase access token to API calls; the Worker verifies it with JOSE (JWKS preferred, HS256 fallback). Use `/api/config/public` to hydrate frontend with URL + anon key.


# Default credentials:
# Username: admin
# Password: admin123
```

## 📂 Project Structure

```
test-web/
├── public/
│   ├── index.html           # Simple version HTML
│   ├── app.js              # Simple version JS
│   ├── app-auth.html       # Multi-user version HTML
│   ├── app-auth.js         # Multi-user version JS
│   ├── login.html          # Login page
│   ├── styles.css          # Main styles
│   └── styles-auth.css     # Additional auth styles
├── server.js               # Simple Express server
├── server-auth.js          # Authentication-enabled server
├── worker.js               # Cloudflare Worker (production)
├── schema.sql              # D1 Database schema
├── mcp-server.js           # MCP server for Claude
├── package.json
└── README.md
```

## 🔐 Authentication System

### User Management
- **Registration**: Create new user accounts
- **Login/Logout**: Secure session management
- **Admin Users**: Special privileges for user management

### Default Users
```
Username: admin
Password: admin123
Role: Admin
```

## 🤖 Discord Bot Authentication

### Overview
The Discord bot integration uses **HMAC-SHA256 signature verification** to securely authenticate requests. This prevents attackers from impersonating Discord users by forging API requests.

### Security Architecture

**Problem:** Without authentication, anyone could send a request with `X-Discord-User-ID: 123456789` and gain access to that user's tasks.

**Solution:** HMAC (Hash-based Message Authentication Code) ensures only requests from your legitimate Discord bot are accepted.

### How It Works

1. **Shared Secret**: Both your Discord bot and server share a secret key (`DISCORD_BOT_SECRET`)
2. **Signature Generation**: Bot creates HMAC signature: `HMAC-SHA256(userId|timestamp, secret)`
3. **Request Headers**: Bot sends three headers with each API request:
   - `X-Discord-User-ID`: Discord user ID
   - `X-Discord-Timestamp`: Current timestamp (milliseconds)
   - `X-Discord-Signature`: HMAC signature (64-char hex)
4. **Server Verification**: Server recomputes signature and verifies it matches
5. **Timestamp Check**: Request must be within 60 seconds (prevents replay attacks)

### Setup Instructions

#### 1. Generate Secret (Automatic)

The setup script automatically generates a secure secret:

```bash
npm run setup
# When prompted about Discord bot, choose "Yes"
# The script will generate DISCORD_BOT_SECRET and display it
```

#### 2. Manual Configuration (Alternative)

If you need to generate a secret manually:

```bash
# Generate 64-character hex secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env`:
```bash
DISCORD_BOT_SECRET=<your-generated-secret>
```

#### 3. Configure Your Discord Bot

See `discord-bot-example.js` for complete integration code.

**Basic Example:**
```javascript
const crypto = require('crypto');

const DISCORD_BOT_SECRET = process.env.DISCORD_BOT_SECRET;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Create HMAC signature
function createDiscordSignature(discordUserId, timestamp) {
    const payload = `${discordUserId}|${timestamp}`;
    return crypto.createHmac('sha256', DISCORD_BOT_SECRET)
        .update(payload)
        .digest('hex');
}

// Make authenticated request
async function authenticatedRequest(discordUserId, endpoint, options = {}) {
    const timestamp = Date.now().toString();
    const signature = createDiscordSignature(discordUserId, timestamp);

    return fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Discord-User-ID': discordUserId,
            'X-Discord-Timestamp': timestamp,
            'X-Discord-Signature': signature,
            ...options.headers
        }
    });
}

// Example: Get user's tasks
const response = await authenticatedRequest('123456789012345678', '/api/tasks', {
    method: 'GET'
});
```

### Security Features

- **HMAC-SHA256**: Cryptographically secure one-way hash function
- **Timestamp Validation**: 60-second window prevents replay attacks
- **Constant-Time Comparison**: Prevents timing attacks via `crypto.timingSafeEqual()`
- **Secret Validation**: Rejects default/missing secrets
- **Length Validation**: Verifies signature is exactly 64 hex characters

### Example Discord Bot Commands

See `discord-bot-example.js` for complete Discord.js integration, including:
- `/createtask` - Create a new task
- `/mytasks` - View your tasks
- Task updates and deletions
- Full error handling

### Troubleshooting

**"Invalid Discord authentication" error:**
- Verify `DISCORD_BOT_SECRET` matches on both bot and server
- Check timestamp is within 60 seconds
- Ensure signature is 64-character hex string
- Verify payload format: `userId|timestamp`

**"Request too old" error:**
- Server and bot clocks may be out of sync
- Ensure system time is accurate (NTP recommended)

**Testing Authentication:**
```bash
# Test HMAC signing (doesn't require server)
node discord-bot-example.js

# This will show generated signatures and headers
```

### Files Reference

- `shared/discord-auth.js` - HMAC verification logic
- `discord-bot-example.js` - Complete Discord bot integration guide
- `server-auth.js` - Express middleware for Discord auth
- `worker.js` - Cloudflare Workers authentication

## 📁 Project Management

### Creating Projects
1. Click "Projects" in sidebar
2. Click "+ New Project"
3. Enter name and description
4. You become the project owner

### Managing Projects
**As Project Owner:**
- Add/remove team members
- Edit project details
- Delete project (and all tasks)
- View project settings (⚙️ icon)

**As Project Member:**
- View project tasks
- Create tasks
- Complete tasks

### Project Features
- **Owner Control**: Only owners can modify project membership
- **Task Organization**: All tasks belong to a project
- **Team Collaboration**: Multiple members per project
- **Access Control**: Members only see their projects

## 📝 Task Management

### Creating Tasks
1. Select a project from dropdown
2. Assign to a team member (must be project member)
3. Set due date and description
4. Choose status

### Task Properties
- **Name**: Task title
- **Description**: Detailed information
- **Project**: Which project it belongs to
- **Assigned To**: Team member responsible
- **Due Date**: Deadline
- **Status**: Pending, In Progress, or Completed
- **Created By**: Automatically tracked

### Task Actions
- ✅ Quick complete with checkbox
- ✏️ Edit task details
- 🗑️ Delete task
- 🎉 Celebration on completion!

## 🎨 UI/UX Features

### Views
- **All Tasks**: See all tasks in your projects
- **My Tasks**: Only tasks assigned to you
- **Projects**: Grid view of all projects
- **Project View**: Tasks filtered by specific project

### Filters
- Status filter (Pending/In Progress/Completed)
- Search across task names and descriptions
- Project-specific views

### Visual Indicators
- Color-coded task borders by status
- Overdue task highlighting
- Project ownership badges
- Member count and task statistics
- Completion progress per project

### Animations
- Confetti celebration on task completion
- Smooth transitions and hover effects
- Slide-in notifications
- Modal animations

## 🗄️ Data Storage

### Local Development (server-auth.js)
- Stores data in `/data` directory as JSON files:
  - `users.json` - User accounts
  - `projects.json` - Projects and members
  - `tasks.json` - All tasks
  - `activity.json` - Activity log

### Production (Cloudflare Workers/Pages + D1)
- Stateless auth with Supabase JWT (Bearer)
- D1 relational schema with normalized project membership (see MIGRATIONS.md)
- Scalable and global

## 🌐 API Endpoints

### Authentication
```
POST   /api/auth/register    - Create new user
POST   /api/auth/login       - Login
POST   /api/auth/logout      - Logout
GET    /api/auth/me          - Get current user
```

### Users
```
GET    /api/users            - List all users
GET    /api/users/:id        - Get user by ID
DELETE /api/users/:id        - Delete user (admin only)
```

### Projects
```
GET    /api/projects         - List user's projects
GET    /api/projects/:id     - Get project details
POST   /api/projects         - Create project
PUT    /api/projects/:id     - Update project
DELETE /api/projects/:id     - Delete project
POST   /api/projects/:id/members        - Add member
DELETE /api/projects/:id/members/:userId - Remove member
```

### Tasks
```
GET    /api/tasks            - List tasks (filtered by user's projects)
GET    /api/tasks/:id        - Get task details
POST   /api/tasks            - Create task
PUT    /api/tasks/:id        - Update task
DELETE /api/tasks/:id        - Delete task
```

### Activity
```
GET    /api/activity         - Get activity log
```

## 🔒 Security Features

- **Password Hashing**: bcrypt with salt rounds
- **Session Management**: Secure HTTP-only cookies
- **Access Control**: Project-based permissions
- **Input Validation**: Server-side validation
- **XSS Protection**: HTML escaping
- **CSRF Protection**: Session-based authentication

## 📊 Database Schema

### Users Table
- id, username, password_hash, name, email, is_admin
- Unique username constraint

### Projects Table
- id, name, description, owner_id
- Foreign key to users

### Project Members Table
- project_id, user_id, role
- Many-to-many relationship

### Tasks Table
- id, name, description, date, status
- project_id, assigned_to_id, created_by_id
- Foreign keys to projects and users

### Activity Log
- Tracks all actions (create, update, delete)
- Links to users, projects, and tasks

## 🚀 Deployment

### Cloudflare Workers (Production)

1. **Create D1 Database**
```bash
wrangler d1 create task-manager-db
```

2. **Update wrangler.toml** with database ID

3. **Initialize Database**
```bash
wrangler d1 execute task-manager-db --file=schema.sql
```

4. **Set Secrets**
```bash
wrangler secret put CLAUDE_API_KEY
```

5. **Deploy**
```bash
wrangler deploy
```

## 🤖 MCP Server Integration

Connect Claude directly to your task database:

```bash
# Set environment variable
export WORKER_URL=http://localhost:3000

# Run MCP server
node mcp-server.js
```

### MCP Tools Available
- `get_tasks` - Retrieve tasks
- `create_task` - Create new task
- `update_task` - Update task
- `delete_task` - Delete task
- `get_projects` - List projects
- `get_summary` - AI-powered task summary
- `ask_about_tasks` - Natural language queries

## 📱 Responsive Design

- Mobile-friendly sidebar
- Adaptive grid layouts
- Touch-optimized controls
- Collapsible sections on small screens

## 🎯 Use Cases

### For Teams
- Project-based task organization
- Assign work to team members
- Track progress across projects
- Collaborate on shared goals

### For Individuals
- Personal task management
- Project organization
- Goal tracking with celebrations

### For Organizations
- Department-level task management
- Cross-functional project coordination
- Activity tracking and accountability

## 🔧 Development

### Adding New Features
1. Update schema.sql if database changes needed
2. Add API endpoints to server-auth.js
3. Update frontend in app-auth.js
4. Add styling to styles-auth.css
5. Test locally before deploying

### Code Organization
- **Backend**: Express.js with middleware
- **Frontend**: Vanilla JavaScript (no framework)
- **Styling**: CSS with custom properties
- **Data**: JSON files (local) or D1 (production)

## 📈 Performance

- Efficient rendering with minimal DOM updates
- Indexed database queries
- Client-side filtering and search
- Lazy loading of project members
- Optimized animations (60fps)

## 🐛 Troubleshooting

### "Authentication required" error
- Clear browser cookies
- Login again at /login.html

### Tasks not showing
- Check if you're a member of any projects
- Create a new project
- Verify server is running

### Cannot add members
- Ensure you're the project owner
- Check user exists in system
- Verify user not already a member

### Port 3000 in use
```bash
# Kill existing process
lsof -ti:3000 | xargs kill

# Or use different port
PORT=3001 node server-auth.js
```

## 🎓 Learning Resources

This project demonstrates:
- Authentication & Authorization
- Session Management
- RESTful API Design
- Project-based Access Control
- Multi-user Collaboration
- Responsive UI/UX
- Database Schema Design

## 📝 Future Enhancements

- [ ] Email notifications
- [ ] Task comments and attachments
- [ ] Calendar view
- [ ] Kanban board
- [ ] Task dependencies
- [ ] Recurring tasks
- [ ] Time tracking
- [ ] Reports and analytics
- [ ] Mobile app
- [ ] Real-time collaboration (WebSockets)

## 🤝 Contributing

This is a demonstration project. Feel free to fork and adapt for your needs!

## 📄 License

MIT License - Use however you like!

## 🙏 Acknowledgments

- Inspired by Asana's clean UI and positive UX
- Built with modern web standards
- Designed for team collaboration

---

**Version 2.0** - Now with multi-user support and project management!

**Quick Links:**
- Simple Version: http://localhost:3000
- Multi-User Version: http://localhost:3000/
- Login: http://localhost:3000/login.html
