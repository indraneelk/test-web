const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// Configuration
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN environment variable is required');
    process.exit(1);
}

// Store user sessions (Discord User ID -> Cookie)
const userSessions = new Map();

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
                await handleAsk(message, args);
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

// Login command
async function handleLogin(message, args) {
    if (args.length < 3) {
        return message.reply('Usage: `login <username> <password>`\n⚠️ For security, use this in DMs only!');
    }

    const username = args[1];
    const password = args[2];

    try {
        const response = await axios.post(`${API_BASE}/auth/login`, {
            username,
            password
        });

        // Store session cookie
        const cookies = response.headers['set-cookie'];
        userSessions.set(message.author.id, cookies);

        const user = response.data.user;
        await message.reply(`✅ Welcome back, ${user.name}! You're now logged in.`);

        // Delete the message with credentials if in a guild
        if (message.guild) {
            try {
                await message.delete();
            } catch (e) {
                // Ignore if we can't delete (missing permissions)
            }
        }
    } catch (error) {
        await message.reply('❌ Login failed. Check your credentials.');
    }
}

// Get tasks
async function handleTasks(message) {
    const session = userSessions.get(message.author.id);
    if (!session) {
        return message.reply('❌ Please login first: `login <username> <password>`');
    }

    try {
        const response = await axios.get(`${API_BASE}/tasks`, {
            headers: { Cookie: session }
        });

        const tasks = response.data;

        if (tasks.length === 0) {
            return message.reply('📭 No tasks found!');
        }

        // Group tasks by status
        const pending = tasks.filter(t => t.status === 'pending');
        const inProgress = tasks.filter(t => t.status === 'in-progress');
        const completed = tasks.filter(t => t.status === 'completed');

        const embed = new EmbedBuilder()
            .setColor(0x4f46e5)
            .setTitle('📋 Your Tasks')
            .addFields(
                { name: '⏳ Pending', value: `${pending.length} tasks`, inline: true },
                { name: '🚧 In Progress', value: `${inProgress.length} tasks`, inline: true },
                { name: '✅ Completed', value: `${completed.length} tasks`, inline: true }
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
        await message.reply('❌ Failed to fetch tasks. You may need to login again.');
    }
}

// Get summary from Claude
async function handleSummary(message) {
    const session = userSessions.get(message.author.id);
    if (!session) {
        return message.reply('❌ Please login first: `login <username> <password>`');
    }

    const thinking = await message.reply('🤔 Analyzing your tasks...');

    try {
        const response = await axios.get(`${API_BASE}/claude/summary`, {
            headers: { Cookie: session }
        });

        const embed = new EmbedBuilder()
            .setColor(0x13ce66)
            .setTitle('📊 Task Summary')
            .setDescription(response.data.summary)
            .addFields({
                name: 'Total Tasks',
                value: `${response.data.taskCount}`,
                inline: true
            })
            .setTimestamp();

        await thinking.edit({ content: null, embeds: [embed] });
    } catch (error) {
        console.error('Summary error:', error);
        await thinking.edit('❌ Failed to get summary. Claude service may not be ready.');
    }
}

// Get priorities from Claude
async function handlePriorities(message) {
    const session = userSessions.get(message.author.id);
    if (!session) {
        return message.reply('❌ Please login first: `login <username> <password>`');
    }

    const thinking = await message.reply('🤔 Analyzing task priorities...');

    try {
        const response = await axios.get(`${API_BASE}/claude/priorities`, {
            headers: { Cookie: session }
        });

        const embed = new EmbedBuilder()
            .setColor(0xff4949)
            .setTitle('🎯 Priority Recommendations')
            .setDescription(response.data.priorities)
            .setTimestamp();

        await thinking.edit({ content: null, embeds: [embed] });
    } catch (error) {
        console.error('Priorities error:', error);
        await thinking.edit('❌ Failed to get priorities. Claude service may not be ready.');
    }
}

// Ask Claude a question
async function handleAsk(message, args) {
    const session = userSessions.get(message.author.id);
    if (!session) {
        return message.reply('❌ Please login first: `login <username> <password>`');
    }

    // Get question (everything after 'ask')
    const question = args.slice(1).join(' ');

    if (!question || question.length === 0) {
        return message.reply('Usage: `ask <your question>`\nExample: `ask what tasks are overdue?`');
    }

    const thinking = await message.reply('🤔 Thinking...');

    try {
        const response = await axios.post(`${API_BASE}/claude/ask`,
            { question },
            { headers: { Cookie: session } }
        );

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
        await thinking.edit('❌ Failed to get answer. Claude service may not be ready.');
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
                name: '🔐 Authentication',
                value: '`login <username> <password>` - Login to your account\n⚠️ Use in DMs for security!'
            },
            {
                name: '📋 Tasks',
                value: '`tasks` - View your tasks\n`summary` - Get AI summary from Claude\n`priorities` - Get priority suggestions from Claude'
            },
            {
                name: '💬 Ask Claude',
                value: '`ask <question>` - Ask Claude anything about your tasks\nExamples:\n• `ask what should I focus on today?`\n• `ask which tasks are overdue?`\n• `ask summarize project X`'
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
