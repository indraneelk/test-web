# Team Task Manager

A full-stack task management application similar to Asana, with celebration animations, AI-powered insights, and team collaboration features.

## Features

- ✅ **Task Management**: Create, edit, delete, and complete tasks
- 🎉 **Celebrations**: Confetti animations when tasks are completed (Asana-style)
- 👥 **Team Collaboration**: Assign tasks to team members and organize by projects
- 🔍 **Smart Filtering**: Filter by team member, project, and status
- 🤖 **AI Integration**: Claude API for task summaries and natural language queries
- 📊 **Real-time Stats**: Track total, completed, and pending tasks
- 🎨 **Beautiful UI**: Clean, modern interface with smooth animations
- ☁️ **Cloud-Ready**: Deployable to Cloudflare Workers with D1 database

## Quick Start (Local Development)

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Local Server

```bash
npm start
```

The app will be available at `http://localhost:3000`

### 3. Test the Application

Open your browser and navigate to `http://localhost:3000`. You can:

- Click "New Task" to create a task
- Click the checkbox on a task card to mark it complete (watch the confetti! 🎉)
- Click the edit button (✏️) to modify a task
- Click the delete button (🗑️) to remove a task
- Use the filters in the sidebar to organize your view
- Search tasks using the search bar

## Project Structure

```
test-web/
├── public/                 # Frontend files
│   ├── index.html         # Main HTML structure
│   ├── styles.css         # Styling and animations
│   └── app.js             # Frontend JavaScript
├── server.js              # Express backend (local development)
├── worker.js              # Cloudflare Worker (production)
├── schema.sql             # D1 Database schema
├── wrangler.toml          # Cloudflare configuration
├── mcp-server.js          # MCP server for Claude integration
├── package.json           # Dependencies
└── tasks.json             # Local data storage
```

## Deployment to Cloudflare (Production)

### Prerequisites

- Cloudflare account
- Wrangler CLI installed (`npm install -g wrangler`)
- Anthropic API key (for Claude integration)

### 1. Login to Cloudflare

```bash
wrangler login
```

### 2. Create D1 Database

```bash
wrangler d1 create task-manager-db
```

Copy the database ID and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "task-manager-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 3. Initialize Database Schema

```bash
wrangler d1 execute task-manager-db --file=schema.sql
```

### 4. Set Environment Variables

Add your Anthropic API key:

```bash
wrangler secret put CLAUDE_API_KEY
# Enter your API key when prompted
```

### 5. Deploy to Cloudflare

```bash
wrangler deploy
```

Your app will be live at `https://team-task-manager.YOUR_SUBDOMAIN.workers.dev`

## MCP Server Setup (Claude Integration)

The MCP server allows Claude to interact with your task database directly.

### 1. Set Environment Variable

```bash
export WORKER_URL=http://localhost:3000
# or your Cloudflare Workers URL for production
```

### 2. Run MCP Server

```bash
node mcp-server.js
```

### 3. Configure in Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "task-manager": {
      "command": "node",
      "args": ["/path/to/test-web/mcp-server.js"],
      "env": {
        "WORKER_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Available MCP Tools

- `get_tasks`: Get all tasks
- `get_task`: Get specific task by ID
- `create_task`: Create new task
- `update_task`: Update existing task
- `delete_task`: Delete a task
- `get_summary`: Get AI-powered summary of all tasks
- `ask_about_tasks`: Ask natural language questions about tasks
- `get_activity`: Get recent activity log

## API Endpoints

### Tasks

- `GET /api/tasks` - Get all tasks
- `GET /api/tasks/:id` - Get single task
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Claude AI

- `POST /api/claude/ask` - Ask questions about tasks
  ```json
  {
    "question": "What tasks are due this week?"
  }
  ```

- `GET /api/claude/summary` - Get AI summary of all tasks

### Activity Log

- `GET /api/activity` - Get recent activity

## Task Schema

```json
{
  "id": "unique-id",
  "name": "Task name",
  "description": "Task description",
  "date": "2024-01-15",
  "project": "Project name",
  "poc": "Person name",
  "status": "pending|in-progress|completed",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

## Development Tips

### Local Testing

1. The local server uses `tasks.json` for data storage
2. Data persists between restarts
3. No database setup required for local development

### Adding Sample Data

You can manually add tasks through the UI or directly edit `tasks.json`:

```json
[
  {
    "id": "abc123",
    "name": "Design homepage",
    "description": "Create mockups for the new homepage design",
    "date": "2024-01-20",
    "project": "Website Redesign",
    "poc": "Jane Smith",
    "status": "in-progress",
    "created_at": "2024-01-10T10:00:00Z",
    "updated_at": "2024-01-10T10:00:00Z"
  }
]
```

### Debugging

- Check browser console for frontend errors
- Check terminal for backend errors
- Use browser DevTools Network tab to inspect API calls

## Key Features Explained

### Celebration Animations

When you mark a task as complete, the app triggers a confetti animation:
- 3-second duration
- Colorful particles falling
- Positive feedback message
- Inspired by Asana's celebrations

### Smart Filtering

- Filter by team member (POC)
- Filter by project
- Filter by status (pending/in-progress/completed)
- Search across all fields
- Filters combine for precise results

### Task Completion

Two ways to complete tasks:
1. **Quick Complete**: Click the checkbox on the task card
2. **Edit Modal**: Change status to "completed" in the edit form

Both trigger the celebration animation!

### Visual Indicators

- **Color-coded borders**: Tasks have different colored left borders based on status
- **Overdue highlighting**: Overdue tasks show in red
- **Completed styling**: Completed tasks have strikethrough text
- **Hover effects**: Smooth transitions on all interactive elements

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers supported

## Performance

- Optimized for large task lists
- Efficient rendering with minimal reflows
- Smooth animations (60fps)
- Fast API responses
- Indexed database queries

## Security

- Input sanitization to prevent XSS
- CORS enabled for API access
- No authentication (add auth for production use)
- Environment variables for secrets

## Future Enhancements

- [ ] User authentication
- [ ] Advanced project management with owners and members
- [ ] File attachments
- [ ] Task comments and activity feed
- [ ] Email notifications
- [ ] Calendar view
- [ ] Kanban board view
- [ ] Recurring tasks
- [ ] Task dependencies
- [ ] Mobile app

## Troubleshooting

### Port 3000 already in use

```bash
# Change port in server.js or kill the process
lsof -ti:3000 | xargs kill
```

### Tasks not loading

1. Check if server is running
2. Check browser console for errors
3. Verify `tasks.json` exists and has valid JSON
4. Check network requests in DevTools

### Confetti not showing

1. Ensure you're marking a task as "completed"
2. Check browser console for JavaScript errors
3. Try refreshing the page

### Cloudflare deployment issues

1. Verify database ID in `wrangler.toml`
2. Check that schema was applied: `wrangler d1 execute task-manager-db --command "SELECT * FROM tasks"`
3. Ensure API key is set: `wrangler secret list`

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - feel free to use this project however you like.

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review browser console logs
3. Check network requests
4. Create an issue with details

---

Built with ❤️ using vanilla JavaScript, Express, and Cloudflare Workers
