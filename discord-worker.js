/**
 * Discord Interactions Worker for Cloudflare
 *
 * Handles Discord slash command webhooks separately from the main web API.
 * This worker processes Discord Interactions and delegates business logic
 * to the shared command handlers.
 */

// Import shared Discord modules
const {
    InteractionType,
    InteractionResponseType,
    verifyDiscordRequest,
    createResponse,
    createEmbedResponse,
    getOption
} = require('./functions/shared/discord-interactions');

const {
    handleTasksCommand,
    handleCreateCommand,
    handleCompleteCommand,
    handleSummaryCommand,
    handlePrioritiesCommand,
    handleClaudeCommand,
    handleLinkCommand,
    handleHelpCommand
} = require('./functions/shared/discord-commands');

/**
 * Create API fetch wrapper for Discord commands
 * This makes authenticated requests to the main team-task-manager worker
 */
function createFetchAPI(env, discordUserId, discordUsername) {
    return async (userId, method, path, body = null) => {
        // Use the Discord bot's HMAC authentication
        const timestamp = Date.now().toString();
        const botSecret = env.DISCORD_BOT_SECRET;

        // Create HMAC signature
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(botSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const message = `${discordUserId}|${timestamp}`;
        const signature = await crypto.subtle.sign(
            'HMAC',
            key,
            encoder.encode(message)
        );

        const signatureHex = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Make request to main worker API
        const apiUrl = `${env.MAIN_WORKER_URL}${path}`;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Discord-User-ID': discordUserId,
                'X-Discord-Username': discordUsername,
                'X-Discord-Timestamp': timestamp,
                'X-Discord-Signature': signatureHex
            }
        };

        console.log('[Discord Worker] Sending headers:', {
            'X-Discord-User-ID': discordUserId,
            'X-Discord-Username': discordUsername,
            'X-Discord-Username-length': discordUsername?.length,
            'X-Discord-Username-type': typeof discordUsername
        });

        if (body) {
            options.body = JSON.stringify(body);
        }

        console.log('[Discord Worker] Making request:', {
            method,
            path,
            apiUrl,
            discordUserId,
            discordUsername,
            hasBody: !!body,
            bodyPreview: body ? JSON.stringify(body).substring(0, 100) : null
        });

        const response = await fetch(apiUrl, options);

        console.log('[Discord Worker] Response received:', {
            status: response.status,
            ok: response.ok,
            path
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Discord Worker] API error:', {
                status: response.status,
                path,
                error: errorText
            });
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        return await response.json();
    };
}

/**
 * Handle Discord Interactions
 */
async function handleDiscordInteraction(request, env) {
    // Verify Discord signature
    const isValid = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!isValid) {
        return new Response('Invalid signature', { status: 401 });
    }

    const interaction = await request.json();

    // Handle PING (Discord verification)
    if (interaction.type === InteractionType.PING) {
        return new Response(JSON.stringify({
            type: InteractionResponseType.PONG
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Handle slash commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        const { name, options } = interaction.data;
        const discordUser = interaction.member?.user || interaction.user;
        const discordUserId = discordUser?.id;

        console.log('[Discord Worker] FULL INTERACTION:', JSON.stringify(interaction, null, 2));
        console.log('[Discord Worker] Discord user object:', JSON.stringify(discordUser));
        console.log('[Discord Worker] Username fields:', {
            username: discordUser?.username,
            global_name: discordUser?.global_name,
            display_name: discordUser?.display_name
        });

        // Try multiple possible username fields
        // Priority: global_name (display name/handle) > username > display_name
        const discordUsername = discordUser?.global_name ||
                              discordUser?.username ||
                              discordUser?.display_name ||
                              `User#${discordUserId}`;

        console.log('[Discord Worker] Selected field:', {
            isGlobalName: !!discordUser?.global_name,
            isUsername: !discordUser?.global_name && !!discordUser?.username,
            isFallback: !discordUser?.global_name && !discordUser?.username && !discordUser?.display_name,
            extractedValue: discordUsername
        });

        if (discordUsername.startsWith('User#')) {
            console.warn('[Discord Worker] ⚠️ Using fallback username format - Discord user object may be incomplete');
        }

        if (!discordUserId) {
            return new Response(JSON.stringify(
                createResponse('❌ Could not identify Discord user', true)
            ), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            // Create API wrapper for this Discord user
            const fetchAPI = createFetchAPI(env, discordUserId, discordUsername);

            let responseData;

            // Route to appropriate command handler
            switch (name) {
                case 'tasks':
                    responseData = await handleTasksCommand(fetchAPI, discordUserId);
                    break;

                case 'create':
                    const createParams = {
                        title: getOption(options, 'title'),
                        due: getOption(options, 'due'),
                        priority: getOption(options, 'priority')
                    };
                    responseData = await handleCreateCommand(fetchAPI, discordUserId, createParams);
                    break;

                case 'complete':
                    const completeParams = {
                        task: getOption(options, 'task')
                    };
                    responseData = await handleCompleteCommand(fetchAPI, discordUserId, completeParams);
                    break;

                case 'summary':
                    responseData = await handleSummaryCommand(fetchAPI, discordUserId);
                    break;

                case 'priorities':
                    responseData = await handlePrioritiesCommand(fetchAPI, discordUserId);
                    break;

                case 'claude':
                    const claudeParams = {
                        query: getOption(options, 'query')
                    };
                    responseData = await handleClaudeCommand(fetchAPI, discordUserId, claudeParams);
                    break;

                case 'link':
                    const linkParams = {
                        code: getOption(options, 'code')
                    };

                    // DEBUG: Show what we extracted
                    console.log('[DEBUG LINK] User fields from Discord:', {
                        username: discordUser?.username,
                        global_name: discordUser?.global_name,
                        discriminator: discordUser?.discriminator,
                        selectedUsername: discordUsername
                    });

                    responseData = await handleLinkCommand(fetchAPI, discordUserId, linkParams);
                    break;

                case 'help':
                    responseData = await handleHelpCommand();
                    break;

                default:
                    responseData = createResponse(`❌ Unknown command: ${name}`, true);
            }

            // Format response for Discord Interactions
            const response = {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: responseData
            };

            return new Response(JSON.stringify(response), {
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Command error:', error);

            // Return error message to user
            return new Response(JSON.stringify(
                createResponse(`❌ Error: ${error.message}`, true)
            ), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // Unknown interaction type
    return new Response(JSON.stringify(
        createResponse('❌ Unknown interaction type', true)
    ), {
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * Main worker export
 */
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Handle Discord Interactions endpoint
        if (url.pathname === '/interactions' && request.method === 'POST') {
            return await handleDiscordInteraction(request, env);
        }

        // Health check endpoint
        if (url.pathname === '/health' && request.method === 'GET') {
            return new Response(JSON.stringify({
                status: 'healthy',
                service: 'discord-bot',
                timestamp: new Date().toISOString()
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Default 404
        return new Response('Not Found', { status: 404 });
    }
};
