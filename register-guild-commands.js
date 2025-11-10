/**
 * Register Guild-Specific Discord Slash Commands
 * Guild commands update INSTANTLY (vs up to 1 hour for global)
 *
 * Usage: GUILD_ID=your_guild_id node register-guild-commands.js
 */

require('dotenv').config();
const { COMMANDS } = require('./functions/shared/discord-interactions');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const GUILD_ID = process.env.GUILD_ID || process.argv[2];

if (!DISCORD_BOT_TOKEN || !APPLICATION_ID) {
    console.error('Error: Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID');
    process.exit(1);
}

if (!GUILD_ID) {
    console.error('Error: GUILD_ID required');
    console.log('\nUsage: GUILD_ID=your_guild_id node register-guild-commands.js');
    console.log('\nTo find your Guild ID:');
    console.log('1. Enable Developer Mode (User Settings > Advanced)');
    console.log('2. Right-click your server name');
    console.log('3. Click "Copy Server ID"\n');
    process.exit(1);
}

async function registerGuildCommands() {
    const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`;

    try {
        console.log(`Registering commands for guild ${GUILD_ID}...\n`);
        console.log(`Commands: ${COMMANDS.map(c => c.name).join(', ')}\n`);

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(COMMANDS)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Discord API error (${response.status}): ${error}`);
        }

        const data = await response.json();
        console.log('✅ Successfully registered guild commands!\n');
        console.log(`Registered ${data.length} commands (updates are INSTANT for guild commands):\n`);
        data.forEach(cmd => {
            const opts = cmd.options?.length || 0;
            console.log(`  - /${cmd.name}: ${cmd.description} (${opts} options)`);
        });

    } catch (error) {
        console.error('❌ Failed to register commands:', error.message);
        process.exit(1);
    }
}

registerGuildCommands();
