#!/usr/bin/env node

/**
 * MCP Server for Task Manager D1 Database
 *
 * This MCP server allows Claude to interact with the Task Manager database
 * through the Model Context Protocol.
 *
 * Available tools:
 * - get_tasks: Retrieve all tasks or filter by criteria
 * - get_task: Get a specific task by ID
 * - create_task: Create a new task
 * - update_task: Update an existing task
 * - delete_task: Delete a task
 * - get_summary: Get AI-powered summary of tasks
 * - ask_about_tasks: Ask natural language questions about tasks
 * - get_activity: Get recent activity log
 */

const API_BASE_URL = process.env.WORKER_URL || 'http://localhost:8787';

// MCP Server Implementation
const server = {
    name: 'task-manager-d1',
    version: '1.0.0',

    tools: [
        {
            name: 'get_tasks',
            description: 'Retrieve all tasks from the database. Returns a list of tasks with their details including id, name, description, date, project, poc, and status.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: []
            }
        },
        {
            name: 'get_task',
            description: 'Get a specific task by its ID',
            inputSchema: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'The task ID'
                    }
                },
                required: ['id']
            }
        },
        {
            name: 'create_task',
            description: 'Create a new task in the database',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Task name'
                    },
                    description: {
                        type: 'string',
                        description: 'Task description'
                    },
                    date: {
                        type: 'string',
                        description: 'Due date (YYYY-MM-DD format)'
                    },
                    project: {
                        type: 'string',
                        description: 'Project name'
                    },
                    poc: {
                        type: 'string',
                        description: 'Point of contact (person responsible)'
                    },
                    status: {
                        type: 'string',
                        description: 'Task status',
                        enum: ['pending', 'in-progress', 'completed']
                    }
                },
                required: ['name', 'description', 'date', 'project', 'poc']
            }
        },
        {
            name: 'update_task',
            description: 'Update an existing task',
            inputSchema: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'The task ID to update'
                    },
                    name: {
                        type: 'string',
                        description: 'Task name'
                    },
                    description: {
                        type: 'string',
                        description: 'Task description'
                    },
                    date: {
                        type: 'string',
                        description: 'Due date (YYYY-MM-DD format)'
                    },
                    project: {
                        type: 'string',
                        description: 'Project name'
                    },
                    poc: {
                        type: 'string',
                        description: 'Point of contact'
                    },
                    status: {
                        type: 'string',
                        description: 'Task status',
                        enum: ['pending', 'in-progress', 'completed']
                    }
                },
                required: ['id']
            }
        },
        {
            name: 'delete_task',
            description: 'Delete a task from the database',
            inputSchema: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'The task ID to delete'
                    }
                },
                required: ['id']
            }
        },
        {
            name: 'get_summary',
            description: 'Get an AI-powered summary of all tasks, including progress, deadlines, and insights',
            inputSchema: {
                type: 'object',
                properties: {},
                required: []
            }
        },
        {
            name: 'ask_about_tasks',
            description: 'Ask natural language questions about the tasks. Claude will analyze the task data and provide relevant answers.',
            inputSchema: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to ask about the tasks'
                    }
                },
                required: ['question']
            }
        },
        {
            name: 'get_activity',
            description: 'Get recent activity log showing task creation, updates, and deletions',
            inputSchema: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    ],

    async handleToolCall(toolName, args) {
        try {
            switch (toolName) {
                case 'get_tasks': {
                    const response = await fetch(`${API_BASE_URL}/api/tasks`);
                    const tasks = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify(tasks, null, 2)
                        }]
                    };
                }

                case 'get_task': {
                    const response = await fetch(`${API_BASE_URL}/api/tasks/${args.id}`);
                    const task = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify(task, null, 2)
                        }]
                    };
                }

                case 'create_task': {
                    const response = await fetch(`${API_BASE_URL}/api/tasks`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(args)
                    });
                    const newTask = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: `Task created successfully:\n${JSON.stringify(newTask, null, 2)}`
                        }]
                    };
                }

                case 'update_task': {
                    const { id, ...updateData } = args;
                    const response = await fetch(`${API_BASE_URL}/api/tasks/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updateData)
                    });
                    const updatedTask = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: `Task updated successfully:\n${JSON.stringify(updatedTask, null, 2)}`
                        }]
                    };
                }

                case 'delete_task': {
                    const response = await fetch(`${API_BASE_URL}/api/tasks/${args.id}`, {
                        method: 'DELETE'
                    });
                    const result = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: `Task deleted successfully:\n${JSON.stringify(result, null, 2)}`
                        }]
                    };
                }

                case 'get_summary': {
                    const response = await fetch(`${API_BASE_URL}/api/claude/summary`);
                    const data = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: `Task Summary (${data.taskCount} tasks):\n\n${data.summary}`
                        }]
                    };
                }

                case 'ask_about_tasks': {
                    const response = await fetch(`${API_BASE_URL}/api/claude/ask`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ question: args.question })
                    });
                    const data = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: `Question: ${data.question}\n\nAnswer: ${data.answer}`
                        }]
                    };
                }

                case 'get_activity': {
                    const response = await fetch(`${API_BASE_URL}/api/activity`);
                    const activities = await response.json();
                    return {
                        content: [{
                            type: 'text',
                            text: `Recent Activity:\n${JSON.stringify(activities, null, 2)}`
                        }]
                    };
                }

                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `Error: ${error.message}`
                }],
                isError: true
            };
        }
    }
};

// Simple stdio-based MCP server
async function main() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    // Send server info on startup
    console.log(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
            serverInfo: {
                name: server.name,
                version: server.version
            },
            capabilities: {
                tools: server.tools
            }
        }
    }));

    // Handle incoming requests
    rl.on('line', async (line) => {
        try {
            const request = JSON.parse(line);

            if (request.method === 'tools/list') {
                console.log(JSON.stringify({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: server.tools
                    }
                }));
            } else if (request.method === 'tools/call') {
                const result = await server.handleToolCall(
                    request.params.name,
                    request.params.arguments || {}
                );
                console.log(JSON.stringify({
                    jsonrpc: '2.0',
                    id: request.id,
                    result
                }));
            }
        } catch (error) {
            console.error(JSON.stringify({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: error.message
                }
            }));
        }
    });
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = server;
