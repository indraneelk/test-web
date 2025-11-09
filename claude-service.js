const Anthropic = require('@anthropic-ai/sdk');
const EventEmitter = require('events');

/**
 * Claude API Service
 * Uses Anthropic API directly for reliable, authenticated access
 */
class ClaudeService extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.isReady = false;
        this.requestCount = 0;
        this.errorCount = 0;
        this.lastHealthCheck = null;
        this.healthCheckInterval = null;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
    }

    /**
     * Initialize the service
     */
    async start() {
        try {
            console.log('🤖 Initializing Claude API service...');

            // Check for API key
            if (!process.env.ANTHROPIC_API_KEY) {
                throw new Error('ANTHROPIC_API_KEY environment variable is not set');
            }

            // Initialize Anthropic client
            this.client = new Anthropic({
                apiKey: process.env.ANTHROPIC_API_KEY,
            });

            // Test the connection
            await this.healthCheck();

            // Start periodic health checks (every 5 minutes)
            this.healthCheckInterval = setInterval(() => {
                this.healthCheck().catch(err => {
                    console.error('Health check failed:', err);
                });
            }, 5 * 60 * 1000);

            this.isReady = true;
            console.log('✅ Claude API service ready');
            this.emit('ready');

        } catch (error) {
            console.error('❌ Failed to initialize Claude service:', error.message);
            this.emit('error', error);

            // Attempt restart after delay
            setTimeout(() => {
                console.log('🔄 Attempting to restart Claude service...');
                this.start();
            }, 10000);
        }
    }

    /**
     * Health check - verify API is accessible
     */
    async healthCheck() {
        try {
            // Make a minimal API call to verify connectivity using latest Haiku model
            const response = await this.client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 10,
                messages: [{
                    role: 'user',
                    content: 'ping'
                }]
            });

            this.lastHealthCheck = new Date();
            this.errorCount = 0; // Reset error count on success
            return true;
        } catch (error) {
            this.errorCount++;
            console.error(`Health check failed (errors: ${this.errorCount}):`, error.message);

            // If too many errors, try to restart
            if (this.errorCount >= 3) {
                console.log('🔄 Too many errors, restarting service...');
                this.isReady = false;
                this.stop();
                setTimeout(() => this.start(), 5000);
            }

            throw error;
        }
    }

    /**
     * Send a message to Claude with retry logic
     */
    async sendMessage(userMessage, systemPrompt = null, retryCount = 0) {
        if (!this.isReady || !this.client) {
            throw new Error('Claude service is not ready');
        }

        try {
            const messages = [{
                role: 'user',
                content: userMessage
            }];

            const options = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 2048,
                messages: messages
            };

            if (systemPrompt) {
                options.system = systemPrompt;
            }

            const response = await this.client.messages.create(options);

            this.requestCount++;

            // Extract text from response
            const text = response.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n');

            return text;

        } catch (error) {
            // Handle rate limits
            if (error.status === 429) {
                const retryAfter = error.headers?.['retry-after'] || 5;
                console.warn(`Rate limited. Retrying after ${retryAfter}s...`);

                if (retryCount < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    return this.sendMessage(userMessage, systemPrompt, retryCount + 1);
                }
            }

            // Handle temporary errors with retry
            if (error.status >= 500 && retryCount < this.maxRetries) {
                console.warn(`Server error (${error.status}). Retrying... (${retryCount + 1}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
                return this.sendMessage(userMessage, systemPrompt, retryCount + 1);
            }

            // Handle authentication errors
            if (error.status === 401) {
                console.error('❌ Authentication failed. Check ANTHROPIC_API_KEY');
                this.isReady = false;
            }

            this.errorCount++;
            throw error;
        }
    }

    /**
     * Query tasks with context
     */
    async queryTasks(query, tasks, projects, users) {
        // Build context
        const context = {
            tasks: tasks.map(t => {
                const project = projects.find(p => p.id === t.project_id);
                const assignee = users.find(u => u.id === t.assigned_to_id);
                return {
                    name: t.name,
                    description: t.description,
                    status: t.status,
                    dueDate: t.date,
                    project: project?.name || 'Unknown',
                    assignedTo: assignee?.name || 'Unassigned',
                    isOverdue: new Date(t.date) < new Date() && t.status !== 'completed'
                };
            }),
            summary: {
                totalTasks: tasks.length,
                completed: tasks.filter(t => t.status === 'completed').length,
                pending: tasks.filter(t => t.status === 'pending' || t.status === 'in-progress').length,
                overdue: tasks.filter(t => new Date(t.date) < new Date() && t.status !== 'completed').length,
                totalProjects: projects.length
            }
        };

        const systemPrompt = `You are a helpful task management assistant. You help users understand and organize their tasks.

Current task data:
${JSON.stringify(context, null, 2)}

Provide concise, actionable responses. When suggesting priorities, consider:
- Overdue tasks (highest priority)
- Due dates (sooner = higher priority)
- Task status (pending vs completed)
- Project context

Format your responses clearly with bullet points or numbered lists when appropriate.`;

        return await this.sendMessage(query, systemPrompt);
    }

    /**
     * Get task summary
     */
    async getSummary(tasks, projects, users) {
        return await this.queryTasks(
            'Provide a brief executive summary of the current tasks. Highlight what needs immediate attention and overall progress.',
            tasks,
            projects,
            users
        );
    }

    /**
     * Get task priorities
     */
    async getPriorities(tasks, projects, users) {
        return await this.queryTasks(
            'Analyze these tasks and create a prioritized list. Rank the top 5 tasks that need attention, with brief reasoning for each.',
            tasks,
            projects,
            users
        );
    }

    /**
     * Natural language query
     */
    async ask(question, tasks, projects, users) {
        return await this.queryTasks(question, tasks, projects, users);
    }

    /**
     * Parse natural language task creation request
     * Converts user input like "create a task to fix login bug, assign to john, due tomorrow"
     * into structured task data
     */
    async parseTaskRequest(userInput, projects, users) {
        const projectList = projects.map(p => ({ id: p.id, name: p.name }));
        const userList = users.map(u => ({ id: u.id, name: u.name, email: u.email }));

        const systemPrompt = `You are a task parser. Convert natural language task requests into JSON.

Available projects:
${JSON.stringify(projectList, null, 2)}

Available users:
${JSON.stringify(userList, null, 2)}

Parse the user's request and return ONLY a JSON object with this structure:
{
  "title": "task title",
  "description": "optional description",
  "dueDate": "YYYY-MM-DD format",
  "priority": "none|low|medium|high",
  "projectId": "id from available projects or null",
  "projectName": "name of project or null",
  "assignedToId": "user id or null",
  "assignedToName": "user name or null"
}

Rules:
- If no due date mentioned, use today's date
- If "tomorrow" mentioned, use tomorrow's date
- If "next week" mentioned, use 7 days from now
- Default priority is "none" unless specified
- Match project names case-insensitively
- Match user names or emails case-insensitively
- Return null for projectId/assignedToId if not found or not specified
- Extract description from context if available

Return ONLY valid JSON, no other text.`;

        try {
            const response = await this.sendMessage(userInput, systemPrompt);

            // Try to parse JSON from response
            // Claude might wrap it in markdown code blocks, so handle that
            let jsonStr = response.trim();
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/```\n?/g, '').replace(/```\n?$/g, '');
            }

            const parsed = JSON.parse(jsonStr);

            // Validate and normalize the parsed data
            const today = new Date();
            const result = {
                title: parsed.title || 'Untitled Task',
                description: parsed.description || '',
                dueDate: parsed.dueDate || today.toISOString().split('T')[0],
                priority: ['none', 'low', 'medium', 'high'].includes(parsed.priority) ? parsed.priority : 'none',
                projectId: parsed.projectId || null,
                projectName: parsed.projectName || null,
                assignedToId: parsed.assignedToId || null,
                assignedToName: parsed.assignedToName || null
            };

            return result;
        } catch (error) {
            console.error('Failed to parse task request:', error);
            throw new Error('Failed to parse task creation request. Please try being more specific.');
        }
    }

    /**
     * Smart request handler - detects intent and either answers questions, creates tasks, or edits tasks
     * Returns { type: 'question', answer: string } or { type: 'task', taskData: object } or { type: 'edit', editData: object }
     */
    async smartRequest(userInput, tasks, projects, users) {
        const systemPrompt = `You are an intent classifier. Analyze the user's input and determine if they want to:
1. Create a task (keywords: create, add, make, new task, etc.)
2. Edit/update a task (keywords: change, update, modify, edit, set, move, etc.)
3. Ask a question (anything else)

Return ONLY a JSON object with this structure:
{
  "intent": "create_task" or "edit_task" or "question"
}

Examples:
"create a task to fix the login bug" -> {"intent": "create_task"}
"what tasks are overdue?" -> {"intent": "question"}
"change the due date of the login bug to tomorrow" -> {"intent": "edit_task"}
"update the priority of testing task to high" -> {"intent": "edit_task"}
"show me my priorities" -> {"intent": "question"}

Return ONLY valid JSON, no other text.`;

        try {
            const response = await this.sendMessage(userInput, systemPrompt);

            // Parse the intent
            let jsonStr = response.trim();
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/```\n?/g, '').replace(/```\n?$/g, '');
            }

            const intent = JSON.parse(jsonStr);

            if (intent.intent === 'create_task') {
                // Parse the task creation request
                const taskData = await this.parseTaskRequest(userInput, projects, users);
                return {
                    type: 'task',
                    taskData: taskData
                };
            } else if (intent.intent === 'edit_task') {
                // Parse the task edit request
                const editData = await this.parseTaskEditRequest(userInput, tasks, projects, users);
                return {
                    type: 'edit',
                    editData: editData
                };
            } else {
                // Answer the question
                const answer = await this.ask(userInput, tasks, projects, users);
                return {
                    type: 'question',
                    answer: answer
                };
            }
        } catch (error) {
            console.error('Smart request error:', error);
            throw error;
        }
    }

    /**
     * Parse natural language task edit request
     * Converts input like "change the due date of the login bug task to tomorrow"
     * into structured edit data with task identification
     */
    async parseTaskEditRequest(userInput, tasks, projects, users) {
        const taskList = tasks.map(t => {
            const project = projects.find(p => p.id === t.project_id);
            const assignee = users.find(u => u.id === t.assigned_to_id);
            return {
                id: t.id,
                name: t.name,
                description: t.description,
                status: t.status,
                date: t.date,
                priority: t.priority,
                project: project?.name || 'Unknown',
                assignedTo: assignee?.name || 'Unassigned'
            };
        });
        const projectList = projects.map(p => ({ id: p.id, name: p.name }));
        const userList = users.map(u => ({ id: u.id, name: u.name, email: u.email }));

        const systemPrompt = `You are a task edit parser. Analyze the user's request to edit a task.

Available tasks:
${JSON.stringify(taskList, null, 2)}

Available projects:
${JSON.stringify(projectList, null, 2)}

Available users:
${JSON.stringify(userList, null, 2)}

Identify which task the user wants to edit and what changes they want to make.
Return ONLY a JSON object with this structure:
{
  "taskId": "id of the task to edit, or null if cannot identify uniquely",
  "confidence": "high|medium|low",
  "matchedTaskName": "the task name that was matched",
  "updates": {
    "name": "new name if mentioned, otherwise null",
    "description": "new description if mentioned, otherwise null",
    "date": "new due date in YYYY-MM-DD format if mentioned, otherwise null",
    "priority": "new priority (none|low|medium|high) if mentioned, otherwise null",
    "status": "new status (pending|in-progress|completed) if mentioned, otherwise null",
    "projectId": "new project id if mentioned, otherwise null",
    "assignedToId": "new assignee user id if mentioned, otherwise null"
  },
  "errorMessage": "if cannot identify task uniquely or no task matches, explain why"
}

Rules for task identification:
- Match task by name (case-insensitive, partial match OK if unique)
- If multiple tasks match, set confidence to "low" and list matches in errorMessage
- If no tasks match, set taskId to null and explain in errorMessage
- For date keywords: "tomorrow" = tomorrow's date, "next week" = 7 days from now, "today" = today
- Only set confidence to "high" if you're certain about the task match

Return ONLY valid JSON, no other text.`;

        try {
            const response = await this.sendMessage(userInput, systemPrompt);

            let jsonStr = response.trim();
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/```\n?/g, '').replace(/```\n?$/g, '');
            }

            const parsed = JSON.parse(jsonStr);

            // If task couldn't be identified, throw error with helpful message
            if (!parsed.taskId || parsed.confidence === 'low') {
                throw new Error(parsed.errorMessage || 'Could not identify which task to edit. Please be more specific about the task name.');
            }

            // Remove null values from updates
            const updates = {};
            for (const [key, value] of Object.entries(parsed.updates)) {
                if (value !== null && value !== undefined) {
                    updates[key] = value;
                }
            }

            return {
                taskId: parsed.taskId,
                taskName: parsed.matchedTaskName,
                updates: updates
            };
        } catch (error) {
            console.error('Failed to parse task edit request:', error);
            throw error;
        }
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            ready: this.isReady,
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            lastHealthCheck: this.lastHealthCheck,
            uptime: this.lastHealthCheck ? new Date() - this.lastHealthCheck : 0
        };
    }

    /**
     * Stop the service
     */
    stop() {
        console.log('🛑 Stopping Claude API service...');

        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        this.isReady = false;
        this.client = null;
    }
}

// Export singleton instance
const claudeService = new ClaudeService();
module.exports = claudeService;
