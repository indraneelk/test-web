require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const crypto = require('crypto');

// Configuration
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SECRET = process.env.DISCORD_BOT_SECRET;

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN environment variable is required');
    process.exit(1);
}

if (!DISCORD_SECRET) {
    console.error('❌ DISCORD_BOT_SECRET environment variable is required');
    process.exit(1);
}

/**
 * Generate HMAC signature for Discord bot authentication
 * @param {string} discordUserId - Discord user ID
 * @param {number} timestamp - Request timestamp
 * @returns {string} HMAC signature
 */
function generateSignature(discordUserId, timestamp) {
    const payload = `${discordUserId}|${timestamp}`;
    return crypto
        .createHmac('sha256', DISCORD_SECRET)
        .update(payload)
        .digest('hex');
}

/**
 * Make authenticated API request with HMAC signature
 * @param {string} discordUserId - Discord user ID
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request data (for POST/PUT)
 * @returns {Promise} Axios response
 */
function authenticatedRequest(discordUserId, method, endpoint, data = null) {
    const timestamp = Date.now().toString();
    const signature = generateSignature(discordUserId, timestamp);

    const config = {
        method,
        url: `${API_BASE}${endpoint}`,
        headers: {
            'X-Discord-User-ID': discordUserId,
            'X-Discord-Timestamp': timestamp,
            'X-Discord-Signature': signature,
            'Content-Type': 'application/json'
        }
    };

    if (data && (method === 'POST' || method === 'PUT')) {
        config.data = data;
    }

    return axios(config);
}

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Channel, // Required to receive DMs
        Partials.Message,
    ]
});

client.once('ready', () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
});

// Handle messages
client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only respond to messages that mention the bot or are DMs
    const isMentioned = message.mentions.has(client.user);
    const isDM = message.channel.type === 1; // DM channel type

    if (!isMentioned && !isDM) return;

    // Remove bot mention from message
    let content = message.content.replace(`<@${client.user.id}>`, '').trim();

    // Parse command
    const args = content.split(' ');
    const command = args[0].toLowerCase();

    try {
        switch (command) {
            case 'tasks':
                await handleTasks(message);
                break;
            case 'create':
                await handleCreate(message, args);
                break;
            case 'update':
                await handleUpdate(message, args);
                break;
            case 'complete':
                await handleComplete(message, args);
                break;
            case 'summary':
                await handleSummary(message);
                break;
            case 'priorities':
                await handlePriorities(message);
                break;
            case 'claude':
                await handleAsk(message, args);
                break;
            case 'link':
                await handleLink(message, args);
                break;
            case 'help':
                await handleHelp(message);
                break;
            default:
                // If no command, treat as question for Claude
                if (content.length > 0) {
                    await handleAsk(message, [content]);
                } else {
                    await message.reply('Type `help` to see available commands!');
                }
        }
    } catch (error) {
        console.error('Command error:', error);
        await message.reply(`❌ Error: ${error.message}`);
    }
});

// Link Discord account using code from website
async function handleLink(message, args) {
    if (args.length < 2) {
        return message.reply('Usage: `link <CODE>`\n\nGet your link code from the website Settings page.');
    }

    const code = args[1].toUpperCase();
    const discordUserId = message.author.id;
    const discordHandle = message.author.username;

    try {
        const response = await axios.post(`${API_BASE}/discord/verify-link-code`, {
            code,
            discordUserId,
            discordHandle
        });

        if (response.data.success) {
            await message.reply(`✅ Success! Your Discord account (@${discordHandle}) has been linked.\n\nYou can now use all bot commands!`);
        }
    } catch (error) {
        if (error.response?.status === 404) {
            return message.reply('❌ Invalid code. Please check the code from the website and try again.');
        }
        if (error.response?.status === 400) {
            const errorMsg = error.response.data.error || 'Invalid request';
            return message.reply(`❌ ${errorMsg}`);
        }
        console.error('Link error:', error);
        await message.reply('❌ Failed to link account. Please try again or contact support.');
    }
}

// Get tasks
async function handleTasks(message) {
    const discordUserId = message.author.id;

    try {
        const response = await authenticatedRequest(discordUserId, 'GET', '/tasks');

        const tasks = response.data;

        if (tasks.length === 0) {
            return message.reply('📭 No tasks found!');
        }

        // Group tasks by status (combine pending + in-progress as "Pending")
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'in-progress');
        const completed = tasks.filter(t => t.status === 'completed');

        const embed = new EmbedBuilder()
            .setColor(0x4f46e5)
            .setTitle('📋 Your Tasks')
            .addFields(
                { name: '⏳ Pending', value: `${pending.length} tasks` },
                { name: '✅ Completed', value: `${completed.length} tasks` }
            )
            .setTimestamp();

        // Add sample tasks
        const sampleTasks = tasks.slice(0, 5);
        if (sampleTasks.length > 0) {
            embed.addFields({
                name: 'Recent Tasks',
                value: sampleTasks.map(t =>
                    `${t.status === 'completed' ? '✅' : '⏳'} **${t.name}**\n└ Due: ${t.date}`
                ).join('\n\n')
            });
        }

        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Tasks error:', error);
        if (error.response?.status === 403 || error.response?.status === 401) {
            return message.reply('❌ Please link your Discord account on the website first. Go to Settings and add your Discord handle.');
        }
        await message.reply('❌ Failed to fetch tasks. Please try again.');
    }
}

// Get summary from Claude
async function handleSummary(message) {
    const discordUserId = message.author.id;
    const thinking = await message.reply('🤔 Analyzing your tasks...');

    try {
        const response = await authenticatedRequest(discordUserId, 'GET', '/claude/summary');

        const embed = new EmbedBuilder()
            .setColor(0x13ce66)
            .setTitle('📊 Task Summary')
            .setDescription(response.data.summary)
            .addFields({
                name: 'Total Tasks',
                value: `${response.data.taskCount}`
            })
            .setTimestamp();

        await thinking.edit({ content: null, embeds: [embed] });
    } catch (error) {
        console.error('Summary error:', error);
        if (error.response?.status === 403 || error.response?.status === 401) {
            return await thinking.edit('❌ Please link your Discord account on the website first. Go to Settings and add your Discord handle.');
        }
        await thinking.edit('❌ Failed to get summary. Claude service may not be ready.');
    }
}

// Get priorities from Claude
async function handlePriorities(message) {
    const discordUserId = message.author.id;
    const thinking = await message.reply('🤔 Analyzing task priorities...');

    try {
        const response = await authenticatedRequest(discordUserId, 'GET', '/claude/priorities');

        const embed = new EmbedBuilder()
            .setColor(0xff4949)
            .setTitle('🎯 Priority Recommendations')
            .setDescription(response.data.priorities)
            .setTimestamp();

        await thinking.edit({ content: null, embeds: [embed] });
    } catch (error) {
        console.error('Priorities error:', error);
        if (error.response?.status === 403 || error.response?.status === 401) {
            return await thinking.edit('❌ Please link your Discord account on the website first. Go to Settings and add your Discord handle.');
        }
        await thinking.edit('❌ Failed to get priorities. Claude service may not be ready.');
    }
}

// Ask Claude a question
async function handleAsk(message, args) {
    const discordUserId = message.author.id;

    // Get question (everything after 'claude')
    const question = args.slice(1).join(' ');

    if (!question || question.length === 0) {
        return message.reply('Usage: `claude <your question>`\nExample: `claude what tasks are overdue?`');
    }

    const thinking = await message.reply('🤔 Thinking...');

    try {
        const response = await authenticatedRequest(discordUserId, 'POST', '/claude/ask', { question });

        // Split long responses
        const answer = response.data.answer;

        if (answer.length <= 2000) {
            const embed = new EmbedBuilder()
                .setColor(0x4f46e5)
                .setTitle('🤖 Claude\'s Answer')
                .setDescription(answer)
                .setFooter({ text: `Question: ${question}` })
                .setTimestamp();

            await thinking.edit({ content: null, embeds: [embed] });
        } else {
            // Split into chunks for long responses
            await thinking.edit(`🤖 **Claude's Answer:**\n\n${answer.slice(0, 1900)}...`);
        }
    } catch (error) {
        console.error('Ask error:', error);
        if (error.response?.status === 403 || error.response?.status === 401) {
            return await thinking.edit('❌ Please link your Discord account on the website first. Go to Settings and add your Discord handle.');
        }
        await thinking.edit('❌ Failed to get answer. Claude service may not be ready.');
    }
}

// Create task command
async function handleCreate(message, args) {
    const discordUserId = message.author.id;

    // Get the task description (everything after 'create')
    const taskInput = args.slice(1).join(' ');

    if (!taskInput || taskInput.length === 0) {
        return message.reply('Usage: `create <task description>`\nExamples:\n• `create Fix login bug, assign to john, due tomorrow`\n• `create "Update documentation" --project Docs --due 2025-11-20`');
    }

    const thinking = await message.reply('🤔 Creating task...');

    try {
        // Check if it's a direct command (has quotes or --flags) or natural language
        const isDirectCommand = taskInput.includes('"') || taskInput.includes('--');

        let taskData;

        if (isDirectCommand) {
            // Parse direct command format: create "Title" --project X --due YYYY-MM-DD --priority high --assign user@email.com
            const titleMatch = taskInput.match(/"([^"]+)"/);
            const title = titleMatch ? titleMatch[1] : taskInput.split('--')[0].trim();

            const projectMatch = taskInput.match(/--project\s+(.+?)(?:\s+--|$)/i);
            const dueMatch = taskInput.match(/--due\s+(\S+)/i);
            const priorityMatch = taskInput.match(/--priority\s+(\S+)/i);
            const assignMatch = taskInput.match(/--assign\s+(\S+)/i);

            // For direct commands, we need to resolve project names and user emails to IDs
            // Fetch user's projects and all users
            const [projectsResp, usersResp] = await Promise.all([
                authenticatedRequest(discordUserId, 'GET', '/projects'),
                authenticatedRequest(discordUserId, 'GET', '/users')
            ]);

            const projects = projectsResp.data;
            const users = usersResp.data;

            // Resolve project name to ID
            let projectId = null;
            if (projectMatch) {
                const projectName = projectMatch[1].trim();
                const project = projects.find(p =>
                    p.name.toLowerCase() === projectName.toLowerCase()
                );
                if (project) {
                    projectId = project.id;
                } else {
                    return await thinking.edit(`❌ Project "${projectName}" not found. Available projects: ${projects.map(p => p.name).join(', ')}`);
                }
            }

            // Resolve user email to ID
            let assignedToId = null;
            if (assignMatch) {
                const email = assignMatch[1].trim();
                const user = users.find(u =>
                    u.email && u.email.toLowerCase() === email.toLowerCase()
                );
                if (user) {
                    assignedToId = user.id;
                } else {
                    return await thinking.edit(`❌ User "${email}" not found`);
                }
            }

            // If no project specified, use first available (usually personal project)
            if (!projectId && projects.length > 0) {
                projectId = projects[0].id;
            }

            if (!projectId) {
                return await thinking.edit('❌ No project specified and no projects available. Please specify --project <name>');
            }

            taskData = {
                name: title,
                description: '',
                date: dueMatch ? dueMatch[1] : new Date().toISOString().split('T')[0],
                priority: priorityMatch ? priorityMatch[1] : 'none',
                project_id: projectId,
                assigned_to_id: assignedToId
            };
        } else {
            // Use Claude to parse natural language
            const parseResponse = await authenticatedRequest(discordUserId, 'POST', '/claude/parse-task', { input: taskInput });

            const parsed = parseResponse.data;

            // If Claude didn't find a project, use first available
            let projectId = parsed.projectId;
            if (!projectId) {
                const projectsResp = await authenticatedRequest(discordUserId, 'GET', '/projects');
                const projects = projectsResp.data;
                if (projects.length > 0) {
                    projectId = projects[0].id;
                } else {
                    return await thinking.edit('❌ No projects available. Please create a project first.');
                }
            }

            taskData = {
                name: parsed.title,
                description: parsed.description || '',
                date: parsed.dueDate,
                priority: parsed.priority,
                project_id: projectId,
                assigned_to_id: parsed.assignedToId
            };
        }

        // Create the task
        const response = await authenticatedRequest(discordUserId, 'POST', '/tasks', taskData);

        const task = response.data;

        const embed = new EmbedBuilder()
            .setColor(0x13ce66)
            .setTitle('✅ Task Created')
            .addFields(
                { name: 'Title', value: task.name },
                { name: 'Due Date', value: task.date },
                { name: 'Priority', value: task.priority || 'none' }
            )
            .setTimestamp();

        await thinking.edit({ content: null, embeds: [embed] });
    } catch (error) {
        console.error('Create task error:', error);
        if (error.response?.status === 403 || error.response?.status === 401) {
            return await thinking.edit('❌ Please link your Discord account on the website first. Go to Settings and add your Discord handle.');
        }
        const errorMsg = error.response?.data?.error || error.message;
        await thinking.edit(`❌ Failed to create task: ${errorMsg}`);
    }
}

// Update task command
async function handleUpdate(message, args) {
    const discordUserId = message.author.id;

    if (args.length < 3) {
        return message.reply('Usage: `update <task-id> <field> <value>`\nExample: `update task-123 status in-progress`');
    }

    const taskId = args[1];
    const field = args[2];
    const value = args.slice(3).join(' ');

    try {
        const updateData = {};

        if (field === 'status') {
            updateData.status = value;
        } else if (field === 'priority') {
            updateData.priority = value;
        } else if (field === 'name' || field === 'title') {
            updateData.name = value;
        } else if (field === 'due' || field === 'date') {
            updateData.date = value;
        } else {
            return message.reply('❌ Invalid field. Use: status, priority, name, or due');
        }

        const response = await authenticatedRequest(discordUserId, 'PUT', `/tasks/${taskId}`, updateData);

        await message.reply(`✅ Task updated: ${field} set to "${value}"`);
    } catch (error) {
        console.error('Update task error:', error);
        if (error.response?.status === 403 || error.response?.status === 401) {
            return message.reply('❌ Please link your Discord account on the website first. Go to Settings and add your Discord handle.');
        }
        const errorMsg = error.response?.data?.error || error.message;
        await message.reply(`❌ Failed to update task: ${errorMsg}`);
    }
}

// Complete task command
async function handleComplete(message, args) {
    const discordUserId = message.author.id;

    if (args.length < 2) {
        return message.reply('Usage: `complete <task-id>`\nExample: `complete task-123`');
    }

    const taskId = args[1];

    try {
        const response = await authenticatedRequest(discordUserId, 'PUT', `/tasks/${taskId}`, { status: 'completed' });

        await message.reply(`✅ Task marked as completed!`);
    } catch (error) {
        console.error('Complete task error:', error);
        if (error.response?.status === 403 || error.response?.status === 401) {
            return message.reply('❌ Please link your Discord account on the website first. Go to Settings and add your Discord handle.');
        }
        const errorMsg = error.response?.data?.error || error.message;
        await message.reply(`❌ Failed to complete task: ${errorMsg}`);
    }
}

// Help command
async function handleHelp(message) {
    const embed = new EmbedBuilder()
        .setColor(0x4f46e5)
        .setTitle('🤖 Task Manager Bot - Commands')
        .setDescription('Interact with your task manager through Discord!')
        .addFields(
            {
                name: '🔗 Link Your Account',
                value: '1. Go to the website Settings page\n2. Click "Link Discord Account" to get a code\n3. Send `link <CODE>` here\n\nExample: `link LINK-ABC12`'
            },
            {
                name: '📋 View Tasks',
                value: '`tasks` - View your tasks\n`summary` - Get AI summary from Claude\n`priorities` - Get priority suggestions from Claude'
            },
            {
                name: '✏️ Create & Modify',
                value: '`create <description>` - Create a new task (natural language or flags)\n`update <task-id> <field> <value>` - Update a task\n`complete <task-id>` - Mark task as complete'
            },
            {
                name: '💬 Ask Claude',
                value: '`claude <question>` - Ask Claude anything about your tasks\nExamples:\n• `claude what should I focus on today?`\n• `claude which tasks are overdue?`\n• `claude summarize project X`'
            },
            {
                name: '📝 Create Task Examples',
                value: '**Natural language:**\n• `create Fix login bug, assign to john, due tomorrow`\n• `create Update documentation for API`\n\n**Direct commands:**\n• `create "Fix bug" --project Core --due 2025-11-20 --priority high`\n• `create "Write tests" --assign john@example.com`'
            },
            {
                name: '❓ Help',
                value: '`help` - Show this message'
            }
        )
        .setFooter({ text: 'Mention me or DM me to use commands!' });

    await message.reply({ embeds: [embed] });
}

// Error handling
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Login
client.login(DISCORD_TOKEN);

console.log('🚀 Starting Discord bot...');
