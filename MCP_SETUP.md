# Task Manager MCP Server Setup Guide

This guide explains how to set up Model Context Protocol (MCP) integration for your Task Manager, giving Claude Code and other MCP clients direct, intelligent access to your D1 database.

## Why Use MCP?

**Before MCP:** Claude gets pre-filtered JSON snapshots
- Every query fetches ALL tasks, projects, users
- No schema awareness
- ~2000+ tokens per query
- Can't do follow-up queries efficiently

**After MCP:** Claude queries D1 directly with context
- On-demand, specific queries
- Full schema understanding
- ~100-500 tokens per query
- Can refine queries based on results

## Architecture

```
┌─────────────┐
│ Claude Code │
│  / Desktop  │
└──────┬──────┘
       │ MCP Protocol
       ▼
┌─────────────────────────────────┐
│  Task Manager MCP Server        │
│  (task-manager-mcp-server.js)   │
└──────┬──────────────────────────┘
       │
       │ Direct SQL
       ▼
┌─────────────────────────────────┐
│   Cloudflare D1 Database        │
│   (via D1 REST API)             │
└─────────────────────────────────┘
```

## Prerequisites

1. **Node.js** 18+ installed
2. **Cloudflare D1 database** set up
3. **Claude Desktop** or **Claude Code** (or any MCP-compatible client)

## Installation

### 1. Install MCP SDK

```bash
cd /path/to/test-web
npm install @modelcontextprotocol/sdk
```

### 2. Make MCP Server Executable

```bash
chmod +x task-manager-mcp-server.js
```

### 3. Configure Environment Variables

Create or update `.env` with your Cloudflare credentials:

```bash
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_D1_DATABASE_ID=your-database-id
CLOUDFLARE_API_TOKEN=your-api-token
```

**How to get these:**

1. **Account ID**: Cloudflare Dashboard → Any domain → Copy from sidebar
2. **Database ID**: Run `wrangler d1 list` or check Cloudflare Dashboard
3. **API Token**: Cloudflare Dashboard → Profile → API Tokens → Create Token
   - Use "Edit Cloudflare Workers" template
   - Or custom token with `Account.D1` Read/Write permissions

## Configuration

### For Claude Code (Web)

Add to your MCP configuration:

```bash
claude mcp add task-manager
```

Then configure with:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/test-web/task-manager-mcp-server.js"],
  "env": {
    "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
    "CLOUDFLARE_D1_DATABASE_ID": "your-db-id",
    "CLOUDFLARE_API_TOKEN": "your-token"
  }
}
```

### For Claude Desktop

Edit your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cloudflare-bindings": {
      "command": "npx",
      "args": ["mcp-remote", "https://bindings.mcp.cloudflare.com/mcp"]
    },
    "task-manager": {
      "command": "node",
      "args": ["/absolute/path/to/test-web/task-manager-mcp-server.js"],
      "env": {
        "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
        "CLOUDFLARE_D1_DATABASE_ID": "your-db-id",
        "CLOUDFLARE_API_TOKEN": "your-token"
      }
    }
  }
}
```

**Important:** Use absolute paths, not relative paths!

### Using Both Cloudflare Bindings + Custom Tools

The configuration above includes BOTH:

1. **`cloudflare-bindings`**: Official Cloudflare MCP server
   - Raw D1 query capabilities
   - KV, R2, and other Cloudflare services
   - Good for ad-hoc queries

2. **`task-manager`**: Your custom MCP server
   - High-level, context-aware tools
   - Understands task/project relationships
   - Returns enriched data

Use both together for maximum flexibility!

## Available Tools

Your custom MCP server provides these intelligent tools:

### 1. `get_schema`
Get complete database schema with relationships.

**Example:**
```
Claude, use the task-manager MCP to get the schema
```

### 2. `query_tasks`
Query tasks with filters and enriched context.

**Parameters:**
- `status`: pending, in-progress, completed
- `priority`: high, medium, low, none
- `project_id`: Filter by project
- `assigned_to_id`: Filter by assignee
- `overdue`: boolean - show only overdue tasks
- `limit`: max results

**Example:**
```
Show me all high-priority overdue tasks
```

### 3. `get_task_context`
Get comprehensive context for a specific task.

**Example:**
```
Get full context for task task-abc123
```

### 4. `get_project_summary`
Detailed summary of a project including tasks, members, and stats.

**Example:**
```
Summarize the "Website Redesign" project
```

### 5. `get_user_workload`
Analyze a user's workload.

**Example:**
```
What's Alice's current workload?
```

### 6. `search_tasks`
Full-text search across task names and descriptions.

**Example:**
```
Search for tasks mentioning "API refactor"
```

### 7. `get_activity_log`
Get recent activity with filters.

**Example:**
```
Show recent activity for project-xyz
```

### 8. `get_overview_stats`
High-level system statistics.

**Example:**
```
Give me an overview of the task manager
```

### 9. `execute_sql`
Execute custom SQL queries for advanced use cases.

**Example:**
```
Execute SQL: SELECT project_id, COUNT(*) FROM tasks GROUP BY project_id
```

## Usage Examples

### Example 1: Understanding Project Health

```
You: "Claude, analyze the health of our active projects"

Claude uses:
1. get_overview_stats (get all projects)
2. get_project_summary for each project
3. Analyzes overdue tasks, completion rates, etc.
4. Provides actionable insights
```

### Example 2: User Workload Analysis

```
You: "Which team member is overloaded?"

Claude uses:
1. Lists all users
2. get_user_workload for each
3. Compares workloads
4. Identifies bottlenecks
```

### Example 3: Task Prioritization

```
You: "What should I work on today?"

Claude uses:
1. query_tasks with your user_id
2. Filters by status: pending, in-progress
3. Considers priorities and due dates
4. Suggests top 3 tasks
```

### Example 4: Cross-Project Insights

```
You: "Which projects have the most overdue tasks?"

Claude uses:
1. query_tasks with overdue: true
2. Groups by project_id
3. get_project_summary for context
4. Ranks projects by overdue count
```

## Benefits Over Express Endpoints

| Aspect | Express API | MCP Server |
|--------|-------------|------------|
| **Data Access** | Pre-filtered snapshots | On-demand queries |
| **Schema Awareness** | None | Full schema |
| **Query Flexibility** | Fixed endpoints | Dynamic SQL |
| **Token Efficiency** | 2000+ tokens/query | 100-500 tokens/query |
| **Follow-ups** | Re-fetch everything | Refine query |
| **Relationships** | Manual joins in code | Automatic enrichment |
| **Context** | Flat JSON | Rich, relational data |

## Troubleshooting

### MCP Server Won't Start

**Error:** "Cannot find module '@modelcontextprotocol/sdk'"

**Solution:**
```bash
npm install @modelcontextprotocol/sdk
```

### D1 Connection Fails

**Error:** "Cloudflare D1 credentials not configured"

**Solution:** Check your environment variables are set correctly in the MCP config.

### Schema Not Found

**Error:** "Error: Task not found"

**Solution:** Ensure your D1 database has the correct schema. Run migrations:
```bash
wrangler d1 execute task-manager --file=./migrations/0001_initial_schema.sql
```

### Claude Can't See Tools

**Solution:**
1. Restart Claude Desktop/Code
2. Check config file syntax (valid JSON)
3. Verify absolute paths in config
4. Check MCP server logs for errors

## Testing Your Setup

### 1. Test Direct Connection

```bash
node task-manager-mcp-server.js
```

Should output: "Task Manager MCP Server running on stdio"

### 2. Test with Claude

```
You: "Claude, list the available MCP tools"

Expected: Should see tools like get_schema, query_tasks, etc.
```

### 3. Test Schema Access

```
You: "Claude, show me the database schema"

Expected: Full schema with tables, columns, relationships
```

### 4. Test Query

```
You: "Claude, show me all pending tasks"

Expected: List of tasks with enriched project/assignee data
```

## Advanced Usage

### Combining with Cloudflare Bindings MCP

Use official Cloudflare MCP for raw D1 access:

```
You: "Claude, using cloudflare-bindings MCP, run this query:
     SELECT * FROM tasks WHERE priority = 'high'"
```

Then use task-manager MCP for context:

```
You: "Now use task-manager MCP to get full context for task task-abc"
```

### Custom Queries

```
You: "Claude, find the 5 users with the most completed tasks"

Claude uses:
execute_sql with:
SELECT u.id, u.name, COUNT(t.id) as completed
FROM users u
JOIN tasks t ON u.id = t.assigned_to_id
WHERE t.status = 'completed'
GROUP BY u.id
ORDER BY completed DESC
LIMIT 5
```

## Security Considerations

1. **API Token Permissions**: Use least-privilege tokens (D1 Read/Write only)
2. **Local Only**: MCP server runs locally, doesn't expose endpoints
3. **No Network Access**: Direct stdio communication with Claude
4. **Audit Logs**: All queries logged in activity_logs table

## Performance Tips

1. **Use Specific Tools**: Prefer `get_project_summary` over `execute_sql`
2. **Limit Results**: Always specify `limit` parameter
3. **Index Usage**: Schema includes indexes on common query fields
4. **Enrichment**: Tools automatically join related data (project, assignee, etc.)

## Next Steps

1. **Try Example Queries**: Test the examples above
2. **Explore Schema**: Ask Claude to explain the data structure
3. **Build Workflows**: Create complex analysis workflows
4. **Discord Integration**: Consider adding MCP to your Discord bot
5. **Custom Tools**: Extend task-manager-mcp-server.js with more tools

## Support

- **MCP Docs**: https://modelcontextprotocol.io
- **Cloudflare D1**: https://developers.cloudflare.com/d1
- **Task Manager Issues**: Check server-auth.js logs

## Summary

You now have:
✅ Direct D1 database access via MCP
✅ Schema-aware Claude interactions
✅ Efficient, on-demand queries
✅ Rich, contextual data
✅ Flexible SQL execution
✅ High-level analytical tools

Claude can now truly understand your task manager's structure and provide intelligent insights!
