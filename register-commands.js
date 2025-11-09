/**
 * Register Discord Slash Commands
 * Run this once to register all slash commands with Discord
 *
 * Usage: node register-commands.js
 */

require('dotenv').config();
const { COMMANDS } = require('./shared/discord-interactions');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;

if (!DISCORD_BOT_TOKEN) {
    console.error('Error: DISCORD_BOT_TOKEN not found in environment');
    process.exit(1);
}

if (!APPLICATION_ID) {
    console.error('Error: DISCORD_APPLICATION_ID not found in environment');
    console.log('\nTo find your Application ID:');
    console.log('1. Go to https://discord.com/developers/applications');
    console.log('2. Click on your application');
    console.log('3. Copy the "Application ID" from the General Information page');
    console.log('4. Add it to your .env file as: DISCORD_APPLICATION_ID=your_id_here\n');
    process.exit(1);
}

async function registerCommands() {
    const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;

    try {
        console.log('Registering Discord slash commands...\n');
        console.log(`Commands to register: ${COMMANDS.map(c => c.name).join(', ')}\n`);

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
        console.log('✅ Successfully registered commands!');
        console.log(`\nRegistered ${data.length} commands:`);
        data.forEach(cmd => {
            console.log(`  - /${cmd.name}: ${cmd.description}`);
        });

        console.log('\n📝 Next steps:');
        console.log('1. Get your Discord Public Key from the General Information page');
        console.log('2. Set the secret: wrangler secret put DISCORD_PUBLIC_KEY --config wrangler-discord.toml');
        console.log('3. Set the bot secret: wrangler secret put DISCORD_BOT_SECRET --config wrangler-discord.toml');
        console.log('4. Deploy the worker: wrangler deploy --config wrangler-discord.toml');
        console.log('5. Copy the worker URL and set it as the Interactions Endpoint URL in Discord settings\n');

    } catch (error) {
        console.error('❌ Error registering commands:', error.message);
        process.exit(1);
    }
}

registerCommands();
