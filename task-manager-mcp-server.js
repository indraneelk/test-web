#!/usr/bin/env node

/**
 * Task Manager MCP Server
 *
 * Provides Model Context Protocol tools for interacting with the Task Manager D1 database.
 * This server offers high-level, context-aware tools that understand the task manager's
 * data structure and relationships.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const D1Client = require('./d1-client');

// Initialize D1 client
const d1 = new D1Client();

// Create MCP server
const server = new Server(
    {
        name: 'task-manager',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * Helper: Format task with related data
 */
async function enrichTaskData(tasks) {
    if (!Array.isArray(tasks)) {
        tasks = [tasks];
    }

    const enriched = [];
    for (const task of tasks) {
        const project = task.project_id ? await d1.query(
            'SELECT * FROM projects WHERE id = ?',
            [task.project_id]
        ) : null;

        const assignee = task.assigned_to_id ? await d1.query(
            'SELECT id, name, email, initials FROM users WHERE id = ?',
            [task.assigned_to_id]
        ) : null;

        const creator = task.created_by_id ? await d1.query(
            'SELECT id, name, email FROM users WHERE id = ?',
            [task.created_by_id]
        ) : null;

        enriched.push({
            ...task,
            project: project?.results?.[0] || null,
            assignee: assignee?.results?.[0] || null,
            creator: creator?.results?.[0] || null,
        });
    }

    return enriched;
}

/**
 * List all available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'get_schema',
                description: 'Get the complete database schema with tables, columns, relationships, and indexes. Essential for understanding the data structure.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'query_tasks',
                description: 'Query tasks with filters and enriched context. Returns tasks with project, assignee, and creator information.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            description: 'Filter by status: pending, in-progress, completed',
                            enum: ['pending', 'in-progress', 'completed'],
                        },
                        priority: {
                            type: 'string',
                            description: 'Filter by priority: high, medium, low, none',
                            enum: ['high', 'medium', 'low', 'none'],
                        },
                        project_id: {
                            type: 'string',
                            description: 'Filter by project ID',
                        },
                        assigned_to_id: {
                            type: 'string',
                            description: 'Filter by assignee user ID',
                        },
                        overdue: {
                            type: 'boolean',
                            description: 'Show only overdue tasks (due date < today and status != completed)',
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum number of tasks to return (default: 50)',
                        },
                    },
                },
            },
            {
                name: 'get_task_context',
                description: 'Get comprehensive context for a specific task including its project, assignee, creator, and recent activity.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        task_id: {
                            type: 'string',
                            description: 'The task ID',
                        },
                    },
                    required: ['task_id'],
                },
            },
            {
                name: 'get_project_summary',
                description: 'Get detailed summary of a project including all tasks, members, and statistics.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        project_id: {
                            type: 'string',
                            description: 'The project ID',
                        },
                    },
                    required: ['project_id'],
                },
            },
            {
                name: 'get_user_workload',
                description: 'Analyze a user\'s workload including assigned tasks, projects, and statistics.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: {
                            type: 'string',
                            description: 'The user ID',
                        },
                    },
                    required: ['user_id'],
                },
            },
            {
                name: 'search_tasks',
                description: 'Full-text search across task names and descriptions.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query',
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum results (default: 20)',
                        },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'get_activity_log',
                description: 'Get recent activity log with optional filters.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: {
                            type: 'string',
                            description: 'Filter by user',
                        },
                        task_id: {
                            type: 'string',
                            description: 'Filter by task',
                        },
                        project_id: {
                            type: 'string',
                            description: 'Filter by project',
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum activities to return (default: 50)',
                        },
                    },
                },
            },
            {
                name: 'get_overview_stats',
                description: 'Get high-level overview statistics of the entire task manager system.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'execute_sql',
                description: 'Execute a custom SQL query on the D1 database. Use this for complex queries not covered by other tools.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sql: {
                            type: 'string',
                            description: 'SQL query to execute',
                        },
                        params: {
                            type: 'array',
                            description: 'Query parameters (optional)',
                            items: {
                                type: 'string',
                            },
                        },
                    },
                    required: ['sql'],
                },
            },
        ],
    };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'get_schema': {
                const schema = {
                    database: 'Task Manager D1',
                    description: 'Task management system with users, projects, tasks, and activity logging',
                    tables: {
                        users: {
                            description: 'User accounts (authenticated via Supabase, id = Supabase sub)',
                            columns: {
                                id: 'TEXT PRIMARY KEY (Supabase JWT subject)',
                                username: 'TEXT UNIQUE',
                                password_hash: 'TEXT (nullable - Supabase manages auth)',
                                name: 'TEXT',
                                email: 'TEXT',
                                initials: 'TEXT (user profile initials)',
                                color: 'TEXT (user profile color hex)',
                                is_admin: 'INTEGER (boolean)',
                                created_at: 'TEXT (ISO timestamp)',
                                updated_at: 'TEXT (ISO timestamp)',
                            },
                            indexes: ['username'],
                        },
                        projects: {
                            description: 'Projects that contain tasks',
                            columns: {
                                id: 'TEXT PRIMARY KEY',
                                name: 'TEXT UNIQUE',
                                description: 'TEXT',
                                color: 'TEXT (hex color)',
                                is_personal: 'INTEGER (boolean)',
                                owner_id: 'TEXT (FK → users.id)',
                                created_at: 'TEXT (ISO timestamp)',
                                updated_at: 'TEXT (ISO timestamp)',
                            },
                            indexes: ['owner_id'],
                            relationships: {
                                owner: 'users (owner_id → users.id)',
                                members: 'project_members (many-to-many)',
                                tasks: 'tasks (one-to-many)',
                            },
                        },
                        project_members: {
                            description: 'Many-to-many relationship between projects and users',
                            columns: {
                                project_id: 'TEXT (FK → projects.id)',
                                user_id: 'TEXT (FK → users.id)',
                                role: 'TEXT (member role)',
                                added_at: 'TEXT (ISO timestamp)',
                            },
                            indexes: ['project_id', 'user_id'],
                            constraints: ['UNIQUE(project_id, user_id)'],
                        },
                        tasks: {
                            description: 'Individual tasks assigned to projects',
                            columns: {
                                id: 'TEXT PRIMARY KEY',
                                name: 'TEXT',
                                description: 'TEXT',
                                date: 'TEXT (due date, YYYY-MM-DD)',
                                project_id: 'TEXT (FK → projects.id)',
                                assigned_to_id: 'TEXT (FK → users.id, nullable)',
                                created_by_id: 'TEXT (FK → users.id)',
                                status: 'TEXT (pending|in-progress|completed)',
                                priority: 'TEXT (high|medium|low|none)',
                                archived: 'INTEGER (boolean)',
                                completed_at: 'TEXT (ISO timestamp, nullable)',
                                created_at: 'TEXT (ISO timestamp)',
                                updated_at: 'TEXT (ISO timestamp)',
                            },
                            indexes: ['project_id', 'assigned_to_id', 'created_by_id', 'status', 'priority', 'date'],
                            relationships: {
                                project: 'projects (project_id → projects.id)',
                                assignee: 'users (assigned_to_id → users.id)',
                                creator: 'users (created_by_id → users.id)',
                            },
                        },
                        activity_logs: {
                            description: 'Audit log of all actions in the system',
                            columns: {
                                id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
                                user_id: 'TEXT (FK → users.id, nullable)',
                                task_id: 'TEXT (FK → tasks.id, nullable)',
                                project_id: 'TEXT (FK → projects.id, nullable)',
                                action: 'TEXT (action type)',
                                details: 'TEXT (additional details)',
                                created_at: 'TEXT (ISO timestamp)',
                            },
                            indexes: ['user_id', 'task_id', 'project_id', 'created_at'],
                        },
                    },
                    common_queries: {
                        overdue_tasks: "SELECT * FROM tasks WHERE date < date('now') AND status != 'completed'",
                        user_tasks: 'SELECT * FROM tasks WHERE assigned_to_id = ?',
                        project_tasks: 'SELECT t.*, p.name as project_name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.project_id = ?',
                        user_projects: 'SELECT p.* FROM projects p LEFT JOIN project_members pm ON p.id = pm.project_id WHERE p.owner_id = ? OR pm.user_id = ?',
                    },
                };

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(schema, null, 2),
                        },
                    ],
                };
            }

            case 'query_tasks': {
                let sql = 'SELECT * FROM tasks WHERE 1=1';
                const params = [];

                if (args.status) {
                    sql += ' AND status = ?';
                    params.push(args.status);
                }

                if (args.priority) {
                    sql += ' AND priority = ?';
                    params.push(args.priority);
                }

                if (args.project_id) {
                    sql += ' AND project_id = ?';
                    params.push(args.project_id);
                }

                if (args.assigned_to_id) {
                    sql += ' AND assigned_to_id = ?';
                    params.push(args.assigned_to_id);
                }

                if (args.overdue) {
                    sql += " AND date < date('now') AND status != 'completed'";
                }

                sql += ' ORDER BY date ASC';

                if (args.limit) {
                    sql += ' LIMIT ?';
                    params.push(args.limit);
                } else {
                    sql += ' LIMIT 50';
                }

                const result = await d1.query(sql, params);
                const tasks = result.results || [];
                const enriched = await enrichTaskData(tasks);

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ count: enriched.length, tasks: enriched }, null, 2),
                        },
                    ],
                };
            }

            case 'get_task_context': {
                const taskResult = await d1.query('SELECT * FROM tasks WHERE id = ?', [args.task_id]);
                if (!taskResult.results || taskResult.results.length === 0) {
                    throw new Error('Task not found');
                }

                const task = taskResult.results[0];
                const enriched = (await enrichTaskData(task))[0];

                // Get recent activity
                const activityResult = await d1.query(
                    'SELECT * FROM activity_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 10',
                    [args.task_id]
                );

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                task: enriched,
                                recent_activity: activityResult.results || [],
                            }, null, 2),
                        },
                    ],
                };
            }

            case 'get_project_summary': {
                const projectResult = await d1.query('SELECT * FROM projects WHERE id = ?', [args.project_id]);
                if (!projectResult.results || projectResult.results.length === 0) {
                    throw new Error('Project not found');
                }

                const project = projectResult.results[0];

                // Get owner
                const ownerResult = await d1.query('SELECT id, name, email FROM users WHERE id = ?', [project.owner_id]);

                // Get members
                const membersResult = await d1.query(
                    'SELECT u.id, u.name, u.email, pm.role FROM users u JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ?',
                    [args.project_id]
                );

                // Get tasks with stats
                const tasksResult = await d1.query('SELECT * FROM tasks WHERE project_id = ?', [args.project_id]);
                const tasks = tasksResult.results || [];

                const stats = {
                    total: tasks.length,
                    pending: tasks.filter(t => t.status === 'pending').length,
                    inProgress: tasks.filter(t => t.status === 'in-progress').length,
                    completed: tasks.filter(t => t.status === 'completed').length,
                    overdue: tasks.filter(t => new Date(t.date) < new Date() && t.status !== 'completed').length,
                };

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                project,
                                owner: ownerResult.results?.[0] || null,
                                members: membersResult.results || [],
                                stats,
                                tasks: await enrichTaskData(tasks),
                            }, null, 2),
                        },
                    ],
                };
            }

            case 'get_user_workload': {
                const userResult = await d1.query('SELECT * FROM users WHERE id = ?', [args.user_id]);
                if (!userResult.results || userResult.results.length === 0) {
                    throw new Error('User not found');
                }

                const user = userResult.results[0];

                // Get assigned tasks
                const tasksResult = await d1.query('SELECT * FROM tasks WHERE assigned_to_id = ?', [args.user_id]);
                const tasks = tasksResult.results || [];

                // Get projects (owned + member of)
                const projectsResult = await d1.query(
                    'SELECT DISTINCT p.* FROM projects p LEFT JOIN project_members pm ON p.id = pm.project_id WHERE p.owner_id = ? OR pm.user_id = ?',
                    [args.user_id, args.user_id]
                );

                const stats = {
                    tasks: {
                        total: tasks.length,
                        pending: tasks.filter(t => t.status === 'pending').length,
                        inProgress: tasks.filter(t => t.status === 'in-progress').length,
                        completed: tasks.filter(t => t.status === 'completed').length,
                        overdue: tasks.filter(t => new Date(t.date) < new Date() && t.status !== 'completed').length,
                    },
                    projects: (projectsResult.results || []).length,
                };

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                user: {
                                    id: user.id,
                                    name: user.name,
                                    email: user.email,
                                    initials: user.initials,
                                },
                                stats,
                                tasks: await enrichTaskData(tasks),
                                projects: projectsResult.results || [],
                            }, null, 2),
                        },
                    ],
                };
            }

            case 'search_tasks': {
                const searchTerm = `%${args.query}%`;
                const limit = args.limit || 20;

                const result = await d1.query(
                    'SELECT * FROM tasks WHERE name LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT ?',
                    [searchTerm, searchTerm, limit]
                );

                const tasks = result.results || [];
                const enriched = await enrichTaskData(tasks);

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ count: enriched.length, tasks: enriched }, null, 2),
                        },
                    ],
                };
            }

            case 'get_activity_log': {
                let sql = 'SELECT * FROM activity_logs WHERE 1=1';
                const params = [];

                if (args.user_id) {
                    sql += ' AND user_id = ?';
                    params.push(args.user_id);
                }

                if (args.task_id) {
                    sql += ' AND task_id = ?';
                    params.push(args.task_id);
                }

                if (args.project_id) {
                    sql += ' AND project_id = ?';
                    params.push(args.project_id);
                }

                sql += ' ORDER BY created_at DESC LIMIT ?';
                params.push(args.limit || 50);

                const result = await d1.query(sql, params);

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ activities: result.results || [] }, null, 2),
                        },
                    ],
                };
            }

            case 'get_overview_stats': {
                const [users, projects, tasks, activity] = await Promise.all([
                    d1.query('SELECT COUNT(*) as count FROM users'),
                    d1.query('SELECT COUNT(*) as count FROM projects'),
                    d1.query('SELECT status, priority, COUNT(*) as count FROM tasks GROUP BY status, priority'),
                    d1.query('SELECT COUNT(*) as count FROM activity_logs WHERE created_at > datetime("now", "-7 days")'),
                ]);

                const taskStats = (tasks.results || []).reduce((acc, row) => {
                    acc[row.status] = (acc[row.status] || 0) + row.count;
                    return acc;
                }, {});

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                users: users.results?.[0]?.count || 0,
                                projects: projects.results?.[0]?.count || 0,
                                tasks: taskStats,
                                recent_activity_count: activity.results?.[0]?.count || 0,
                            }, null, 2),
                        },
                    ],
                };
            }

            case 'execute_sql': {
                const result = await d1.query(args.sql, args.params || []);

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Task Manager MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
