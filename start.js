#!/usr/bin/env node

/**
 * Smart start script - validates configuration and starts services
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const envPath = path.join(__dirname, '.env');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║      🚀 Task Manager - Starting Services                  ║
╚═══════════════════════════════════════════════════════════╝
`);

// Load environment variables
if (fs.existsSync(envPath)) {
    require('dotenv').config();
    console.log('✅ Loaded .env configuration\n');
} else {
    console.log('❌ No .env file found!\n');
    console.log('Please run: npm run setup\n');
    process.exit(1);
}

// Validation checks
const checks = {
    nodeModules: fs.existsSync(path.join(__dirname, 'node_modules')),
    sessionSecret: !!process.env.SESSION_SECRET,
    hasData: fs.existsSync(path.join(__dirname, 'data')) ||
             (process.env.CLOUDFLARE_ACCOUNT_ID &&
              process.env.CLOUDFLARE_D1_DATABASE_ID &&
              process.env.CLOUDFLARE_API_TOKEN),
    claudeAI: !!process.env.ANTHROPIC_API_KEY,
    discord: !!process.env.DISCORD_BOT_TOKEN
};

console.log('🔍 Pre-flight checks:\n');

if (!checks.nodeModules) {
    console.log('❌ Dependencies not installed');
    console.log('   Run: npm install\n');
    process.exit(1);
}
console.log('✅ Dependencies installed');

if (!checks.sessionSecret) {
    console.log('❌ SESSION_SECRET not configured');
    console.log('   Run: npm run setup\n');
    process.exit(1);
}
console.log('✅ Session secret configured');

if (checks.hasData) {
    if (process.env.CLOUDFLARE_ACCOUNT_ID) {
        console.log('✅ Cloudflare D1 configured (production mode)');
    } else {
        console.log('✅ JSON file storage configured (development mode)');
    }
} else {
    console.log('⚠️  No data storage configured (will use JSON files)');
}

if (checks.claudeAI) {
    console.log('✅ Claude AI enabled');
} else {
    console.log('⚠️  Claude AI not configured (features disabled)');
}

if (checks.discord) {
    console.log('✅ Discord bot configured');
} else {
    console.log('ℹ️  Discord bot not configured (optional)');
}

const PORT = process.env.PORT || 3000;
const mode = process.env.NODE_ENV || 'development';

console.log(`
📊 Configuration:
   Mode: ${mode}
   Port: ${PORT}
   URL:  http://localhost:${PORT}

🎯 Starting services...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`);

// Start the server
const server = spawn('node', ['server-auth.js'], {
    stdio: 'inherit',
    env: process.env
});

server.on('error', (error) => {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
});

server.on('exit', (code) => {
    if (code !== 0) {
        console.error(`\n❌ Server exited with code ${code}`);
        process.exit(code);
    }
});

// Handle shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    server.kill('SIGINT');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    server.kill('SIGTERM');
    process.exit(0);
});
