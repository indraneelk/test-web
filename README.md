# Team Task Manager

A full-stack task management application with two versions: a simple single-user version and a complete multi-user version with authentication and project management.

## 🎯 Features

### Simple Version (index.html + app.js)
- ✅ Task CRUD operations
- 🎉 Celebration animations on task completion
- 🔍 Filtering and search
- 📊 Real-time statistics
- 🎨 Beautiful Asana-inspired UI

### **NEW** Multi-User Version (app-auth.html + app-auth.js)
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
# Visit: http://localhost:3000/app-auth.html
# or login at: http://localhost:3000/login.html

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

### Production (Cloudflare Workers + D1)
- User authentication with bcrypt
- Relational database with proper foreign keys
- Session management
- Scalable cloud storage

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
- Multi-User Version: http://localhost:3000/app-auth.html
- Login: http://localhost:3000/login.html
