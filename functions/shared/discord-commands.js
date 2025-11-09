/**
 * Shared Discord Command Handlers
 * Works with both Gateway (discord-bot.js) and Interactions (Cloudflare Worker)
 */

/**
 * Handle /tasks command - show user's tasks
 */
async function handleTasksCommand(fetchAPI, discordUserId) {
    const response = await fetchAPI(discordUserId, 'GET', '/discord/tasks');
    const tasks = response.data;

    if (tasks.length === 0) {
        return {
            content: '📝 You have no tasks. Create one with `/create`!'
        };
    }

    const pending = tasks.filter(t => t.status === 'pending' || t.status === 'in-progress');
    const completed = tasks.filter(t => t.status === 'completed');
    const sampleTasks = tasks.slice(0, 5);

    const embed = {
        color: 0x4f46e5,
        title: '📋 Your Tasks',
        description: `Here's an overview of all your tasks\n\u200b`,
        fields: [
            { name: '⏳ Pending', value: `**${pending.length}** tasks` },
            { name: '✅ Completed', value: `**${completed.length}** tasks` },
            { name: '\u200b', value: '\u200b' }
        ],
        timestamp: new Date().toISOString()
    };

    if (sampleTasks.length > 0) {
        embed.fields.push({
            name: '📌 Recent Tasks',
            value: sampleTasks.map(t =>
                `${t.status === 'completed' ? '✅' : '⏳'} **${t.name}**\n   Due: ${t.date}\n\u200b`
            ).join('\n')
        });
    }

    return { embeds: [embed] };
}

/**
 * Handle /create command - create a new task
 */
async function handleCreateCommand(fetchAPI, discordUserId, params) {
    const { title, due, priority } = params;

    if (!title || !due) {
        return {
            content: '❌ Please provide task title and due date.\nUsage: `/create title:My Task due:2025-12-31 priority:high`'
        };
    }

    const response = await fetchAPI(discordUserId, 'POST', '/discord/tasks', {
        name: title,
        date: due,
        priority: priority || 'none'
    });

    const task = response.data;

    return {
        embeds: [{
            color: 0x13ce66,
            title: '✅ Task Created',
            description: `Successfully created new task\n\u200b`,
            fields: [
                { name: '📝 Title', value: task.name },
                { name: '📅 Due Date', value: task.date },
                { name: '⭐ Priority', value: task.priority || 'none' }
            ],
            timestamp: new Date().toISOString()
        }]
    };
}

/**
 * Handle /complete command - mark task as complete
 */
async function handleCompleteCommand(fetchAPI, discordUserId, params) {
    const { task } = params;

    if (!task) {
        return {
            content: '❌ Please specify a task to complete.\nUsage: `/complete task:Task Name or ID`'
        };
    }

    const response = await fetchAPI(discordUserId, 'PUT', `/discord/tasks/${encodeURIComponent(task)}/complete`);
    const updatedTask = response.data;

    return {
        embeds: [{
            color: 0x13ce66,
            title: '✅ Task Completed',
            description: `Marked task as completed\n\u200b`,
            fields: [
                { name: '📝 Task', value: updatedTask.name },
                { name: '📅 Completed', value: new Date().toLocaleDateString() }
            ],
            timestamp: new Date().toISOString()
        }]
    };
}

/**
 * Handle /summary command - get task summary
 */
async function handleSummaryCommand(fetchAPI, discordUserId) {
    const response = await fetchAPI(discordUserId, 'GET', '/discord/summary');
    const summary = response.data;

    const embed = {
        color: 0x4f46e5,
        title: '📊 Task Summary',
        description: `Overview of your tasks and projects\n\u200b`,
        fields: [
            { name: '📋 Total Tasks', value: summary.totalTasks.toString() },
            { name: '⏳ Pending', value: summary.pendingTasks.toString() },
            { name: '✅ Completed', value: summary.completedTasks.toString() }
        ],
        timestamp: new Date().toISOString()
    };

    if (summary.overdueTasks > 0) {
        embed.fields.push({
            name: '⚠️ Overdue',
            value: summary.overdueTasks.toString()
        });
    }

    embed.fields.push({ name: '\u200b', value: '\u200b' });
    embed.fields.push({
        name: '📁 Projects',
        value: summary.totalProjects.toString()
    });

    return { embeds: [embed] };
}

/**
 * Handle /priorities command - show high priority tasks
 */
async function handlePrioritiesCommand(fetchAPI, discordUserId) {
    const response = await fetchAPI(discordUserId, 'GET', '/discord/priorities');
    const tasks = response.data;

    if (tasks.length === 0) {
        return {
            content: '✅ You have no high priority tasks!'
        };
    }

    const embed = {
        color: 0xff6b6b,
        title: '⚡ High Priority Tasks',
        description: `Tasks that need immediate attention\n\u200b`,
        fields: tasks.slice(0, 10).map(t => ({
            name: `${t.status === 'completed' ? '✅' : '⏳'} ${t.name}`,
            value: `Due: ${t.date}\nPriority: ${t.priority}`
        })),
        timestamp: new Date().toISOString()
    };

    return { embeds: [embed] };
}

/**
 * Handle /claude command - AI assistant
 */
async function handleClaudeCommand(fetchAPI, discordUserId, params) {
    const { query } = params;

    if (!query) {
        return {
            content: '❌ Please provide a question or command.\nUsage: `/claude query:what tasks are overdue?`'
        };
    }

    // Send deferred response for longer processing
    const response = await fetchAPI(discordUserId, 'POST', '/claude/smart', { input: query });
    const result = response.data;

    if (result.type === 'task_created') {
        const task = result.task;
        return {
            embeds: [{
                color: 0x13ce66,
                title: '✅ Task Created via Claude',
                description: `${result.message}\n\u200b`,
                fields: [
                    { name: '📝 Title', value: task.name },
                    { name: '📅 Due Date', value: task.date },
                    { name: '⭐ Priority', value: task.priority || 'none' }
                ],
                timestamp: new Date().toISOString()
            }]
        };
    } else if (result.type === 'task_updated') {
        const task = result.task;
        return {
            embeds: [{
                color: 0x4f46e5,
                title: '📝 Task Updated via Claude',
                description: `${result.message}\n\u200b`,
                fields: [
                    { name: '📝 Task', value: task.name },
                    { name: '📅 Due Date', value: task.date },
                    { name: '📊 Status', value: task.status }
                ],
                timestamp: new Date().toISOString()
            }]
        };
    } else {
        // Question/answer
        return {
            content: `💬 **Claude says:**\n${result.answer}`
        };
    }
}

/**
 * Handle /link command - link Discord account
 */
async function handleLinkCommand(fetchAPI, discordUserId, params) {
    const { code } = params;

    if (!code) {
        return {
            content: '❌ Please provide a link code.\nGet your code from Settings on the website.\nUsage: `/link code:YOUR-CODE`'
        };
    }

    const response = await fetchAPI(discordUserId, 'POST', '/discord/link', {
        code: code,
        discordUserId: discordUserId
    });

    const linkedHandle = response.data?.discord_handle || 'your account';

    return {
        embeds: [{
            color: 0x13ce66,
            title: '✅ Discord Account Linked',
            description: `Successfully linked to **${linkedHandle}**!\nYou can now use all bot commands.`,
            timestamp: new Date().toISOString()
        }]
    };
}

/**
 * Handle /help command - show available commands
 */
async function handleHelpCommand() {
    return {
        embeds: [{
            color: 0x4f46e5,
            title: '🤖 Task Manager Bot - Help',
            description: 'Available commands:\n\u200b',
            fields: [
                {
                    name: '📋 Task Management',
                    value: '`/tasks` - View your tasks\n`/create` - Create a new task\n`/complete` - Mark a task as done\n`/summary` - Get task summary\n`/priorities` - View high priority tasks'
                },
                {
                    name: '🤖 AI Assistant',
                    value: '`/claude` - Ask Claude AI or manage tasks naturally\nExamples:\n• "what tasks are overdue?"\n• "create a task to review code"\n• "mark login bug as high priority"'
                },
                {
                    name: '🔗 Account',
                    value: '`/link` - Link your Discord account\n`/help` - Show this help message'
                }
            ],
            timestamp: new Date().toISOString()
        }]
    };
}

module.exports = {
    handleTasksCommand,
    handleCreateCommand,
    handleCompleteCommand,
    handleSummaryCommand,
    handlePrioritiesCommand,
    handleClaudeCommand,
    handleLinkCommand,
    handleHelpCommand
};
