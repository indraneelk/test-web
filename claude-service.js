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
            // Make a minimal API call to verify connectivity
            const response = await this.client.messages.create({
                model: 'claude-3-5-sonnet-20241022',
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
                model: 'claude-3-5-sonnet-20241022',
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
                pending: tasks.filter(t => t.status === 'pending').length,
                inProgress: tasks.filter(t => t.status === 'in-progress').length,
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
- Task status (in-progress before pending)
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
