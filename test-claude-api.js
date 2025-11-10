/**
 * Test Claude API connection
 * Reads ANTHROPIC_API_KEY from .env file
 */

const fs = require('fs');
const path = require('path');

// Read .env file
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

// Parse ANTHROPIC_API_KEY
let apiKey = null;
envContent.split('\n').forEach(line => {
    const match = line.match(/^ANTHROPIC_API_KEY=(.+)$/);
    if (match) {
        apiKey = match[1].trim().replace(/^["']|["']$/g, ''); // Remove quotes if present
    }
});

if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not found in .env file');
    process.exit(1);
}

async function testClaude() {
    console.log('Testing Claude API...');
    console.log('API Key:', apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4));

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: 'Say hello!'
                }]
            })
        });

        console.log('\nStatus:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('\nError response:', errorText);
            process.exit(1);
        }

        const data = await response.json();
        console.log('\nSuccess! Claude responded:');
        console.log(data.content[0].text);

    } catch (error) {
        console.error('\nError:', error.message);
        process.exit(1);
    }
}

testClaude();
