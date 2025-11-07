// Cloudflare Worker with D1 Database and Claude API Integration

// Helper function to generate unique IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Helper function to get current timestamp
function getCurrentTimestamp() {
    return new Date().toISOString();
}

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle CORS preflight requests
function handleOptions() {
    return new Response(null, {
        headers: corsHeaders
    });
}

// Claude API Integration
async function askClaude(env, prompt, tasksContext) {
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: `You are a helpful task management assistant. Here is the current task data:\n\n${JSON.stringify(tasksContext, null, 2)}\n\nUser question: ${prompt}`
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`Claude API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.content[0].text;
    } catch (error) {
        console.error('Claude API error:', error);
        return `Error: ${error.message}`;
    }
}

// Main request handler
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return handleOptions();
        }

        // Serve static files for paths without /api
        if (!path.startsWith('/api')) {
            return env.ASSETS.fetch(request);
        }

        try {
            // API Routes
            if (path === '/api/tasks' && method === 'GET') {
                // Get all tasks
                const { results } = await env.DB.prepare(
                    'SELECT * FROM tasks ORDER BY date ASC'
                ).all();

                return new Response(JSON.stringify(results), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'GET') {
                // Get single task
                const id = path.split('/')[3];
                const result = await env.DB.prepare(
                    'SELECT * FROM tasks WHERE id = ?'
                ).bind(id).first();

                if (!result) {
                    return new Response(JSON.stringify({ error: 'Task not found' }), {
                        status: 404,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                return new Response(JSON.stringify(result), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            if (path === '/api/tasks' && method === 'POST') {
                // Create new task
                const body = await request.json();
                const { name, description, date, project, poc, status = 'pending' } = body;

                // Validation
                if (!name || !description || !date || !project || !poc) {
                    return new Response(JSON.stringify({
                        error: 'Missing required fields: name, description, date, project, poc'
                    }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const id = generateId();
                const timestamp = getCurrentTimestamp();

                await env.DB.prepare(
                    'INSERT INTO tasks (id, name, description, date, project, poc, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                ).bind(id, name, description, date, project, poc, status, timestamp, timestamp).run();

                // Log activity
                await env.DB.prepare(
                    'INSERT INTO activity_log (task_id, action, details) VALUES (?, ?, ?)'
                ).bind(id, 'created', `Task "${name}" created`).run();

                const newTask = {
                    id,
                    name,
                    description,
                    date,
                    project,
                    poc,
                    status,
                    created_at: timestamp,
                    updated_at: timestamp
                };

                return new Response(JSON.stringify(newTask), {
                    status: 201,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'PUT') {
                // Update task
                const id = path.split('/')[3];
                const body = await request.json();
                const { name, description, date, project, poc, status } = body;

                // Check if task exists
                const existing = await env.DB.prepare(
                    'SELECT * FROM tasks WHERE id = ?'
                ).bind(id).first();

                if (!existing) {
                    return new Response(JSON.stringify({ error: 'Task not found' }), {
                        status: 404,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const timestamp = getCurrentTimestamp();

                await env.DB.prepare(
                    'UPDATE tasks SET name = ?, description = ?, date = ?, project = ?, poc = ?, status = ?, updated_at = ? WHERE id = ?'
                ).bind(
                    name || existing.name,
                    description || existing.description,
                    date || existing.date,
                    project || existing.project,
                    poc || existing.poc,
                    status || existing.status,
                    timestamp,
                    id
                ).run();

                // Log activity
                await env.DB.prepare(
                    'INSERT INTO activity_log (task_id, action, details) VALUES (?, ?, ?)'
                ).bind(id, 'updated', `Task "${name || existing.name}" updated`).run();

                const updatedTask = await env.DB.prepare(
                    'SELECT * FROM tasks WHERE id = ?'
                ).bind(id).first();

                return new Response(JSON.stringify(updatedTask), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'DELETE') {
                // Delete task
                const id = path.split('/')[3];

                // Check if task exists
                const existing = await env.DB.prepare(
                    'SELECT * FROM tasks WHERE id = ?'
                ).bind(id).first();

                if (!existing) {
                    return new Response(JSON.stringify({ error: 'Task not found' }), {
                        status: 404,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // Log activity before deletion
                await env.DB.prepare(
                    'INSERT INTO activity_log (task_id, action, details) VALUES (?, ?, ?)'
                ).bind(id, 'deleted', `Task "${existing.name}" deleted`).run();

                await env.DB.prepare(
                    'DELETE FROM tasks WHERE id = ?'
                ).bind(id).run();

                return new Response(JSON.stringify({
                    message: 'Task deleted successfully',
                    task: existing
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Claude AI Integration - Ask questions about tasks
            if (path === '/api/claude/ask' && method === 'POST') {
                const body = await request.json();
                const { question } = body;

                if (!question) {
                    return new Response(JSON.stringify({ error: 'Question is required' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // Get all tasks for context
                const { results: tasks } = await env.DB.prepare(
                    'SELECT * FROM tasks ORDER BY date ASC'
                ).all();

                const answer = await askClaude(env, question, tasks);

                return new Response(JSON.stringify({ question, answer, taskCount: tasks.length }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Get task summary from Claude
            if (path === '/api/claude/summary' && method === 'GET') {
                // Get all tasks
                const { results: tasks } = await env.DB.prepare(
                    'SELECT * FROM tasks ORDER BY date ASC'
                ).all();

                const summary = await askClaude(
                    env,
                    'Please provide a concise summary of all tasks, highlighting: 1) Overall progress, 2) Upcoming deadlines, 3) Tasks by status, 4) Key insights or recommendations.',
                    tasks
                );

                return new Response(JSON.stringify({ summary, taskCount: tasks.length }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Get activity log
            if (path === '/api/activity' && method === 'GET') {
                const { results } = await env.DB.prepare(
                    'SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 50'
                ).all();

                return new Response(JSON.stringify(results), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // 404 for unknown routes
            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({
                error: 'Internal server error',
                message: error.message
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};
