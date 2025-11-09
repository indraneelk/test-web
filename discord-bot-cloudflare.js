const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// Configuration
const WORKER_URL = process.env.WORKER_URL || 'https://team-task-manager.your-subdomain.workers.dev';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_BOT_API_KEY = process.env.DISCORD_BOT_API_KEY;

if (!DISCORD_BOT_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN environment variable is required');
    process.exit(1);
}

if (!DISCORD_BOT_API_KEY) {
    console.error('❌ DISCORD_BOT_API_KEY environment variable is required');
    console.error('   This should match the DISCORD_BOT_API_KEY secret in your Cloudflare Worker');
    process.exit(1);
}

// Store user JWT tokens (Discord User ID -> JWT Token)
const userTokens = new Map();

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.once('ready', () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
    console.log(`🔗 Connected to: ${WORKER_URL}`);
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
            case 'login':
                await handleLogin(message, args);
                break;
            case 'tasks':
                await handleTasks(message);
                break;
            case 'summary':
                await handleSummary(message);
                break;
            case 'priorities':
                await handlePriorities(message);
                break;
            case 'ask':
                await handleAsk(message, args.slice(1).join(' '));
                break;
            case 'logout':
                await handleLogout(message);
                break;
            case 'help':
                await handleHelp(message);
                break;
            default:
                // If no command, treat as question for Claude
                if (content.length > 0) {
                    await handleAsk(message, content);
                } else {
                    await message.reply('Type `help` to see available commands!');
                }
        }
    } catch (error) {
        console.error('Command error:', error);
        await message.reply(`❌ Error: ${error.message}`);
    }
});

// Login command
async function handleLogin(message, args) {
    if (args.length < 2) {
        return message.reply('Usage: `login <username>`\n⚠️ For security, use this in DMs only!');
    }

    const username = args[1];

    try {
        const response = await axios.post(`${WORKER_URL}/api/discord/auth`, {
            api_key: DISCORD_BOT_API_KEY,
            username: username
        });

        // Store JWT token
        userTokens.set(message.author.id, response.data.token);

        const user = response.data.user;
        await message.reply(`✅ Logged in as **${user.name}** (@${user.username})`);
    } catch (error) {
        console.error('Login error:', error.response?.data || error.message);
        if (error.response?.status === 404) {
            await message.reply('❌ User not found. Please check your username.');
        } else if (error.response?.status === 401) {
            await message.reply('❌ Authentication failed. Please contact an administrator.');
        } else {
            await message.reply('❌ Login failed. Please try again later.');
        }
    }
}

// Logout command
async function handleLogout(message) {
    userTokens.delete(message.author.id);
    await message.reply('✅ Logged out successfully');
}

// Get authenticated API client
function getAuthHeaders(userId) {
    const token = userTokens.get(userId);
    if (!token) {
        throw new Error('Not logged in. Use `login <username>` first.');
    }
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

// Tasks command
async function handleTasks(message) {
    try {
        const headers = getAuthHeaders(message.author.id);
        const response = await axios.get(`${WORKER_URL}/api/tasks`, { headers });

        const tasks = response.data;

        if (tasks.length === 0) {
            return message.reply('📋 No tasks found!');
        }

        // Group tasks by status
        const pending = tasks.filter(t => t.status === 'pending');
        const inProgress = tasks.filter(t => t.status === 'in-progress');
        const completed = tasks.filter(t => t.status === 'completed');

        const embed = new EmbedBuilder()
            .setTitle('📋 Your Tasks')
            .setColor('#5865F2')
            .setTimestamp();

        if (pending.length > 0) {
            embed.addFields({
                name: '⏳ Pending',
                value: pending.slice(0, 5).map(t => `• ${t.name}`).join('\n') || 'None',
                inline: false
            });
        }

        if (inProgress.length > 0) {
            embed.addFields({
                name: '🔄 In Progress',
                value: inProgress.slice(0, 5).map(t => `• ${t.name}`).join('\n') || 'None',
                inline: false
            });
        }

        if (completed.length > 0) {
            embed.addFields({
                name: '✅ Completed',
                value: `${completed.length} tasks completed`,
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Tasks error:', error.response?.data || error.message);
        if (error.message.includes('Not logged in')) {
            await message.reply(error.message);
        } else {
            await message.reply('❌ Failed to fetch tasks');
        }
    }
}

// Summary command
async function handleSummary(message) {
    try {
        const headers = getAuthHeaders(message.author.id);

        const [tasksRes, projectsRes] = await Promise.all([
            axios.get(`${WORKER_URL}/api/tasks`, { headers }),
            axios.get(`${WORKER_URL}/api/projects`, { headers })
        ]);

        const tasks = tasksRes.data;
        const projects = projectsRes.data;

        const pending = tasks.filter(t => t.status === 'pending').length;
        const inProgress = tasks.filter(t => t.status === 'in-progress').length;
        const completed = tasks.filter(t => t.status === 'completed').length;

        const embed = new EmbedBuilder()
            .setTitle('📊 Task Summary')
            .setColor('#57F287')
            .addFields(
                { name: '📁 Projects', value: String(projects.length), inline: true },
                { name: '📋 Total Tasks', value: String(tasks.length), inline: true },
                { name: '⏳ Pending', value: String(pending), inline: true },
                { name: '🔄 In Progress', value: String(inProgress), inline: true },
                { name: '✅ Completed', value: String(completed), inline: true }
            )
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Summary error:', error.response?.data || error.message);
        if (error.message.includes('Not logged in')) {
            await message.reply(error.message);
        } else {
            await message.reply('❌ Failed to fetch summary');
        }
    }
}

// Priorities command
async function handlePriorities(message) {
    try {
        const headers = getAuthHeaders(message.author.id);
        const response = await axios.get(`${WORKER_URL}/api/tasks`, { headers });

        const tasks = response.data;
        const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'completed');

        if (highPriority.length === 0) {
            return message.reply('✨ No high priority tasks!');
        }

        const embed = new EmbedBuilder()
            .setTitle('🔥 High Priority Tasks')
            .setColor('#ED4245')
            .setDescription(highPriority.slice(0, 10).map(t =>
                `• **${t.name}**\n  Status: ${t.status} | Due: ${t.date}`
            ).join('\n\n'))
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Priorities error:', error.response?.data || error.message);
        if (error.message.includes('Not logged in')) {
            await message.reply(error.message);
        } else {
            await message.reply('❌ Failed to fetch priorities');
        }
    }
}

// Ask Claude command
async function handleAsk(message, question) {
    if (!question || question.trim().length === 0) {
        return message.reply('Usage: `ask <your question>`');
    }

    try {
        const headers = getAuthHeaders(message.author.id);

        // Get user's tasks as context
        const tasksRes = await axios.get(`${WORKER_URL}/api/tasks`, { headers });
        const tasks = tasksRes.data;

        const context = `User has ${tasks.length} tasks. ` +
            `Pending: ${tasks.filter(t => t.status === 'pending').length}, ` +
            `In Progress: ${tasks.filter(t => t.status === 'in-progress').length}, ` +
            `Completed: ${tasks.filter(t => t.status === 'completed').length}`;

        const response = await axios.post(`${WORKER_URL}/api/discord/claude`, {
            question: question,
            context: context
        }, { headers });

        const answer = response.data.answer;

        // Split long answers into multiple messages
        if (answer.length > 2000) {
            const chunks = answer.match(/[\s\S]{1,2000}/g) || [];
            for (const chunk of chunks) {
                await message.reply(chunk);
            }
        } else {
            await message.reply(answer);
        }
    } catch (error) {
        console.error('Ask error:', error.response?.data || error.message);
        if (error.message.includes('Not logged in')) {
            await message.reply(error.message);
        } else if (error.response?.status === 503) {
            await message.reply('❌ Claude AI is not configured on the server');
        } else {
            await message.reply('❌ Failed to get answer from Claude');
        }
    }
}

// Help command
async function handleHelp(message) {
    const embed = new EmbedBuilder()
        .setTitle('🤖 Task Manager Bot - Help')
        .setColor('#5865F2')
        .setDescription('Manage your tasks directly from Discord!')
        .addFields(
            {
                name: '🔐 Authentication',
                value: '`login <username>` - Log in with your task manager username\n`logout` - Log out from the bot',
                inline: false
            },
            {
                name: '📋 Task Commands',
                value: '`tasks` - View all your tasks\n`summary` - Get a task summary\n`priorities` - View high priority tasks',
                inline: false
            },
            {
                name: '🤖 Claude AI',
                value: '`ask <question>` - Ask Claude AI a question\nOr just type your question without a command',
                inline: false
            },
            {
                name: '💡 Tips',
                value: '• Use DMs for login to keep your username private\n• Mention the bot (@bot) in channels\n• You can ask Claude about task management tips',
                inline: false
            }
        )
        .setFooter({ text: 'Task Manager Bot powered by Cloudflare Workers' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

// Start the bot
client.login(DISCORD_BOT_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down Discord bot...');
    client.destroy();
    process.exit(0);
});
