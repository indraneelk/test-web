/**
 * Test script to verify Discord API endpoints with proper HMAC authentication
 */

const crypto = require('crypto');

const DISCORD_USER_ID = '1297479046287986742';
const DISCORD_USERNAME = 'neel.gk';
const API_URL = 'https://mmw-tm.pages.dev/api/discord/tasks';

// Get DISCORD_BOT_SECRET from environment
const DISCORD_BOT_SECRET = process.env.DISCORD_BOT_SECRET;

if (!DISCORD_BOT_SECRET) {
    console.error('Error: DISCORD_BOT_SECRET environment variable not set');
    console.log('Usage: DISCORD_BOT_SECRET=your_secret node test-discord-api.js');
    process.exit(1);
}

async function testDiscordAPI() {
    // Create HMAC signature
    const timestamp = Date.now().toString();
    const message = `${DISCORD_USER_ID}|${timestamp}`;

    const signature = crypto
        .createHmac('sha256', DISCORD_BOT_SECRET)
        .update(message)
        .digest('hex');

    console.log('Testing Discord API endpoint:',API_URL);
    console.log('Discord User ID:', DISCORD_USER_ID);
    console.log('Timestamp:', timestamp);
    console.log('Signature:', signature.substring(0, 16) + '...');

    const response = await fetch(API_URL, {
        method: 'GET',
        headers: {
            'X-Discord-User-ID': DISCORD_USER_ID,
            'X-Discord-Username': DISCORD_USERNAME,
            'X-Discord-Timestamp': timestamp,
            'X-Discord-Signature': signature
        }
    });

    console.log('\nResponse Status:', response.status);
    console.log('Response OK:', response.ok);

    const data = await response.text();
    console.log('\nResponse Body:');
    try {
        console.log(JSON.stringify(JSON.parse(data), null, 2));
    } catch (e) {
        console.log(data);
    }
}

testDiscordAPI().catch(console.error);
