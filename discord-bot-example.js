/**
 * Discord Bot Example - HMAC Signature Authentication
 *
 * This example shows how to securely authenticate Discord bot requests
 * to the Task Manager API using HMAC-SHA256 signatures.
 *
 * IMPORTANT: Set DISCORD_BOT_SECRET environment variable to the same value
 * on both the Discord bot and the API server.
 */

const crypto = require('crypto');

// ==================== CONFIGURATION ====================

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5001';
const DISCORD_BOT_SECRET = process.env.DISCORD_BOT_SECRET;

if (!DISCORD_BOT_SECRET) {
    console.error('ERROR: DISCORD_BOT_SECRET environment variable not set!');
    console.error('Generate a secret with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

// ==================== HMAC SIGNING FUNCTION ====================

/**
 * Create HMAC signature for Discord API request
 * @param {string} discordUserId - Discord user ID
 * @param {string} timestamp - Current timestamp in milliseconds
 * @returns {string} HMAC-SHA256 signature (hex)
 */
function createDiscordSignature(discordUserId, timestamp) {
    // Payload format must match server-side verification
    const payload = `${discordUserId}|${timestamp}`;

    return crypto
        .createHmac('sha256', DISCORD_BOT_SECRET)
        .update(payload)
        .digest('hex');
}

// ==================== API REQUEST HELPER ====================

/**
 * Make authenticated API request on behalf of Discord user
 * @param {string} discordUserId - Discord user ID
 * @param {string} endpoint - API endpoint (e.g., '/api/tasks')
 * @param {object} options - Fetch options (method, body, etc.)
 * @returns {Promise<Response>} Fetch response
 */
async function authenticatedRequest(discordUserId, endpoint, options = {}) {
    const timestamp = Date.now().toString();
    const signature = createDiscordSignature(discordUserId, timestamp);

    const headers = {
        'Content-Type': 'application/json',
        'X-Discord-User-ID': discordUserId,
        'X-Discord-Timestamp': timestamp,
        'X-Discord-Signature': signature,
        ...options.headers
    };

    const url = `${API_BASE_URL}${endpoint}`;

    console.log(`Making authenticated request for Discord user ${discordUserId}`);
    console.log(`  URL: ${url}`);
    console.log(`  Timestamp: ${timestamp}`);
    console.log(`  Signature: ${signature.substring(0, 16)}...`);

    return fetch(url, {
        ...options,
        headers
    });
}

// ==================== EXAMPLE USAGE ====================

/**
 * Example: Create a task for a Discord user
 */
async function createTaskForUser(discordUserId, taskData) {
    try {
        const response = await authenticatedRequest(discordUserId, '/api/tasks', {
            method: 'POST',
            body: JSON.stringify(taskData)
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('API Error:', error);
            return null;
        }

        const task = await response.json();
        console.log('✅ Task created:', task);
        return task;

    } catch (error) {
        console.error('Request failed:', error);
        return null;
    }
}

/**
 * Example: Get tasks for a Discord user
 */
async function getTasksForUser(discordUserId) {
    try {
        const response = await authenticatedRequest(discordUserId, '/api/tasks', {
            method: 'GET'
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('API Error:', error);
            return null;
        }

        const tasks = await response.json();
        console.log(`✅ Retrieved ${tasks.length} tasks for user ${discordUserId}`);
        return tasks;

    } catch (error) {
        console.error('Request failed:', error);
        return null;
    }
}

/**
 * Example: Update a task
 */
async function updateTask(discordUserId, taskId, updates) {
    try {
        const response = await authenticatedRequest(discordUserId, `/api/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('API Error:', error);
            return null;
        }

        const task = await response.json();
        console.log('✅ Task updated:', task);
        return task;

    } catch (error) {
        console.error('Request failed:', error);
        return null;
    }
}

// ==================== DISCORD.JS INTEGRATION EXAMPLE ====================

/**
 * Example Discord.js bot integration
 *
 * This shows how to use the authenticated request helper in a Discord bot.
 */

/*
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Example slash command: /createtask <name> <date> <project>
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'createtask') {
        const taskName = interaction.options.getString('name');
        const taskDate = interaction.options.getString('date');
        const projectId = interaction.options.getString('project');

        const discordUserId = interaction.user.id;

        // Create task via API with HMAC authentication
        const task = await createTaskForUser(discordUserId, {
            name: taskName,
            description: `Created from Discord by ${interaction.user.username}`,
            date: taskDate,
            project_id: projectId,
            assigned_to_id: discordUserId, // Assign to self
            priority: 'medium'
        });

        if (task) {
            await interaction.reply(`✅ Task "${task.name}" created successfully!`);
        } else {
            await interaction.reply('❌ Failed to create task. Make sure your Discord account is linked.');
        }
    }

    if (interaction.commandName === 'mytasks') {
        const discordUserId = interaction.user.id;

        const tasks = await getTasksForUser(discordUserId);

        if (tasks && tasks.length > 0) {
            const taskList = tasks.map(t => `- ${t.name} (${t.status})`).join('\n');
            await interaction.reply(`Your tasks:\n${taskList}`);
        } else {
            await interaction.reply('You have no tasks.');
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
*/

// ==================== TEST FUNCTION ====================

/**
 * Test the HMAC signing (for development only)
 */
async function testHMACAuth() {
    console.log('\n========== HMAC Authentication Test ==========\n');

    const testUserId = '123456789012345678'; // Example Discord user ID

    console.log('Configuration:');
    console.log(`  API URL: ${API_BASE_URL}`);
    console.log(`  Secret configured: ${DISCORD_BOT_SECRET ? 'Yes' : 'No'}`);
    console.log(`  Secret (first 8 chars): ${DISCORD_BOT_SECRET.substring(0, 8)}...`);
    console.log();

    // Test creating a signature
    const timestamp = Date.now().toString();
    const signature = createDiscordSignature(testUserId, timestamp);

    console.log('Generated signature:');
    console.log(`  User ID: ${testUserId}`);
    console.log(`  Timestamp: ${timestamp}`);
    console.log(`  Signature: ${signature}`);
    console.log();

    console.log('Headers that will be sent:');
    console.log(`  X-Discord-User-ID: ${testUserId}`);
    console.log(`  X-Discord-Timestamp: ${timestamp}`);
    console.log(`  X-Discord-Signature: ${signature}`);
    console.log();

    console.log('Test complete!');
}

// Run test if executed directly
if (require.main === module) {
    testHMACAuth();
}

// Export functions for use in Discord bot
module.exports = {
    createDiscordSignature,
    authenticatedRequest,
    createTaskForUser,
    getTasksForUser,
    updateTask
};
