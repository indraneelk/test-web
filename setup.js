#!/usr/bin/env node

/**
 * Interactive setup script for Task Manager
 * Guides user through initial configuration
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const crypto = require('crypto');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        🚀 Task Manager - Interactive Setup                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

This script will help you set up your task manager in minutes.

`);

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

function generateSecret() {
    return crypto.randomBytes(32).toString('hex');
}

async function checkNodeVersion() {
    console.log('📋 Checking Node.js version...');
    const version = process.version;
    const major = parseInt(version.split('.')[0].slice(1));

    if (major < 16) {
        console.log(`❌ Node.js 16+ required. You have ${version}`);
        console.log('   Download from: https://nodejs.org/');
        process.exit(1);
    }

    console.log(`✅ Node.js ${version} detected\n`);
}

async function installDependencies() {
    console.log('📦 Installing dependencies...');

    return new Promise((resolve, reject) => {
        exec('npm install', (error, stdout, stderr) => {
            if (error) {
                console.log('❌ Failed to install dependencies');
                console.log(stderr);
                reject(error);
                return;
            }
            console.log('✅ Dependencies installed\n');
            resolve();
        });
    });
}

async function setupEnvironment() {
    console.log('⚙️  Environment Configuration\n');
    console.log('I\'ll help you configure the required environment variables.\n');

    const config = {};

    // Server config
    console.log('━━━ Server Configuration ━━━\n');

    const port = await question('Port (default: 3000): ');
    config.PORT = port || '3000';

    const nodeEnv = await question('Environment (development/production) [development]: ');
    config.NODE_ENV = nodeEnv || 'development';

    // Session secret
    console.log('\n━━━ Security ━━━\n');
    const generateNew = await question('Generate random session secret? (Y/n): ');
    if (generateNew.toLowerCase() !== 'n') {
        config.SESSION_SECRET = generateSecret();
        console.log('✅ Generated secure session secret');
    } else {
        config.SESSION_SECRET = await question('Enter session secret: ');
    }

    // CORS
    const allowedOrigins = await question(`\nAllowed CORS origins [http://localhost:${config.PORT}]: `);
    config.ALLOWED_ORIGINS = allowedOrigins || `http://localhost:${config.PORT}`;

    // Claude AI
    console.log('\n━━━ Claude AI Integration ━━━\n');
    console.log('Get your API key from: https://console.anthropic.com/settings/keys\n');

    const enableClaude = await question('Enable Claude AI features? (Y/n): ');
    if (enableClaude.toLowerCase() !== 'n') {
        const claudeKey = await question('Enter Anthropic API key (sk-ant-...): ');
        if (claudeKey && claudeKey.startsWith('sk-ant-')) {
            config.ANTHROPIC_API_KEY = claudeKey;
            console.log('✅ Claude AI enabled');
        } else {
            console.log('⚠️  Invalid API key. Claude features will be disabled.');
        }
    } else {
        console.log('⚠️  Claude AI features disabled. You can add the key later in .env');
    }

    // Discord Bot
    console.log('\n━━━ Discord Bot (Optional) ━━━\n');
    const enableDiscord = await question('Enable Discord bot? (y/N): ');
    if (enableDiscord.toLowerCase() === 'y') {
        console.log('\nCreate a bot at: https://discord.com/developers/applications\n');
        const discordToken = await question('Enter Discord bot token: ');
        if (discordToken) {
            config.DISCORD_BOT_TOKEN = discordToken;
            config.API_BASE_URL = `http://localhost:${config.PORT}/api`;
            console.log('✅ Discord bot enabled');
        }
    }

    // Cloudflare D1
    console.log('\n━━━ Cloudflare D1 Database (Optional) ━━━\n');
    console.log('For production deployment. Leave empty for local development with JSON files.\n');

    const enableD1 = await question('Configure Cloudflare D1? (y/N): ');
    if (enableD1.toLowerCase() === 'y') {
        console.log('\nGet these from: https://dash.cloudflare.com\n');
        const accountId = await question('Cloudflare Account ID: ');
        const databaseId = await question('D1 Database ID: ');
        const apiToken = await question('Cloudflare API Token: ');

        if (accountId && databaseId && apiToken) {
            config.CLOUDFLARE_ACCOUNT_ID = accountId;
            config.CLOUDFLARE_D1_DATABASE_ID = databaseId;
            config.CLOUDFLARE_API_TOKEN = apiToken;
            console.log('✅ D1 database configured');
        } else {
            console.log('⚠️  Incomplete D1 config. Using JSON file storage.');
        }
    } else {
        console.log('✅ Using JSON file storage for development');
    }

    return config;
}

function writeEnvFile(config) {
    console.log('\n📝 Writing .env file...');

    let envContent = '# Task Manager Configuration\n';
    envContent += '# Generated by setup script\n\n';

    envContent += '# Server\n';
    envContent += `PORT=${config.PORT}\n`;
    envContent += `NODE_ENV=${config.NODE_ENV}\n\n`;

    envContent += '# Security\n';
    envContent += `SESSION_SECRET=${config.SESSION_SECRET}\n`;
    envContent += `ALLOWED_ORIGINS=${config.ALLOWED_ORIGINS}\n\n`;

    if (config.ANTHROPIC_API_KEY) {
        envContent += '# Claude AI\n';
        envContent += `ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY}\n\n`;
    }

    if (config.DISCORD_BOT_TOKEN) {
        envContent += '# Discord Bot\n';
        envContent += `DISCORD_BOT_TOKEN=${config.DISCORD_BOT_TOKEN}\n`;
        envContent += `API_BASE_URL=${config.API_BASE_URL}\n\n`;
    }

    if (config.CLOUDFLARE_ACCOUNT_ID) {
        envContent += '# Cloudflare D1\n';
        envContent += `CLOUDFLARE_ACCOUNT_ID=${config.CLOUDFLARE_ACCOUNT_ID}\n`;
        envContent += `CLOUDFLARE_D1_DATABASE_ID=${config.CLOUDFLARE_D1_DATABASE_ID}\n`;
        envContent += `CLOUDFLARE_API_TOKEN=${config.CLOUDFLARE_API_TOKEN}\n\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('✅ .env file created\n');
}

async function setupGitignore() {
    const gitignorePath = path.join(__dirname, '.gitignore');

    if (!fs.existsSync(gitignorePath)) {
        const gitignoreContent = `# Dependencies
node_modules/

# Environment
.env
.env.*
!.env.example

# Data (local dev)
data/

# Logs
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
`;
        fs.writeFileSync(gitignorePath, gitignoreContent);
        console.log('✅ .gitignore created');
    }
}

async function finalChecks(config) {
    console.log('\n🔍 Running final checks...\n');

    // Check if .env exists
    if (fs.existsSync(envPath)) {
        console.log('✅ .env file configured');
    }

    // Check if dependencies are installed
    if (fs.existsSync(path.join(__dirname, 'node_modules'))) {
        console.log('✅ Dependencies installed');
    }

    // Check data storage
    if (config.CLOUDFLARE_ACCOUNT_ID) {
        console.log('✅ Cloudflare D1 configured (production mode)');
    } else {
        console.log('✅ JSON file storage configured (development mode)');
    }

    // Check Claude
    if (config.ANTHROPIC_API_KEY) {
        console.log('✅ Claude AI enabled');
    } else {
        console.log('⚠️  Claude AI disabled (can be enabled later)');
    }

    // Check Discord
    if (config.DISCORD_BOT_TOKEN) {
        console.log('✅ Discord bot configured');
    } else {
        console.log('ℹ️  Discord bot not configured (optional)');
    }

    console.log('\n');
}

async function showNextSteps(config) {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        ✅ Setup Complete!                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

📚 Next Steps:

1. Start the server:
   ${config.DISCORD_BOT_TOKEN ? 'npm run dev-all    # Server + Discord bot' : 'npm start          # Server only'}

2. Open your browser:
   http://localhost:${config.PORT}

3. Default login:
   Username: admin
   Password: admin123

4. Access the API:
   http://localhost:${config.PORT}/api

${config.ANTHROPIC_API_KEY ? `
5. Try Claude AI features:
   - Ask questions about your tasks
   - Get smart summaries
   - Priority recommendations
` : ''}

📖 Documentation:
   - README.md               - Overview and features
   - CLAUDE_INTEGRATION.md   - Claude AI setup
   - D1_INTEGRATION.md       - Database configuration
   - DATA_SERVICE_ARCHITECTURE.md - Technical details

🛠️  Commands:
   npm start          - Start server
   npm run discord    - Start Discord bot
   npm run dev-all    - Start everything
   npm run setup      - Run this setup again

💡 Tips:
   - Edit .env to update configuration
   - Check logs if anything doesn't work
   - See README.md for troubleshooting

${!config.ANTHROPIC_API_KEY ? `
⚠️  Remember to add your ANTHROPIC_API_KEY to .env
   to enable Claude AI features!
` : ''}

Happy task managing! 🚀
`);
}

async function main() {
    try {
        // Check Node version
        await checkNodeVersion();

        // Check if already configured
        if (fs.existsSync(envPath)) {
            console.log('⚠️  .env file already exists!\n');
            const overwrite = await question('Overwrite existing configuration? (y/N): ');
            if (overwrite.toLowerCase() !== 'y') {
                console.log('\n✅ Keeping existing configuration\n');
                rl.close();
                return;
            }
            console.log('\n');
        }

        // Install dependencies
        await installDependencies();

        // Setup environment
        const config = await setupEnvironment();

        // Write .env file
        writeEnvFile(config);

        // Setup .gitignore
        await setupGitignore();

        // Final checks
        await finalChecks(config);

        // Show next steps
        await showNextSteps(config);

        rl.close();

    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        console.error('\nPlease check the error and try again.');
        rl.close();
        process.exit(1);
    }
}

// Run setup
main();
