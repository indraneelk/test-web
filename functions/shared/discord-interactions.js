/**
 * Discord Interactions Handler for Cloudflare Workers
 *
 * Handles Discord slash commands via webhooks (Interactions API)
 * Works on Cloudflare Workers without requiring a persistent connection
 */

// Discord Interaction Types
const InteractionType = {
    PING: 1,
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT: 3,
    APPLICATION_COMMAND_AUTOCOMPLETE: 4,
    MODAL_SUBMIT: 5
};

// Discord Interaction Response Types
const InteractionResponseType = {
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
    DEFERRED_UPDATE_MESSAGE: 6,
    UPDATE_MESSAGE: 7,
    APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
    MODAL: 9
};

/**
 * Verify Discord request signature
 * @param {Request} request - Cloudflare Workers request
 * @param {string} publicKey - Discord application public key
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyDiscordRequest(request, publicKey) {
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const body = await request.clone().text();

    console.log('[Discord Verify] Starting verification:', {
        hasSignature: !!signature,
        hasTimestamp: !!timestamp,
        hasPublicKey: !!publicKey,
        bodyLength: body.length
    });

    if (!signature || !timestamp) {
        console.log('[Discord Verify] Missing signature or timestamp');
        return false;
    }

    try {
        // Import the public key
        const encoder = new TextEncoder();
        const keyData = hexToUint8Array(publicKey);

        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            {
                name: 'Ed25519',
                namedCurve: 'Ed25519'
            },
            false,
            ['verify']
        );

        // Verify the signature
        const signatureData = hexToUint8Array(signature);
        const message = encoder.encode(timestamp + body);

        const isValid = await crypto.subtle.verify(
            'Ed25519',
            key,
            signatureData,
            message
        );

        console.log('[Discord Verify] Verification result:', isValid);
        return isValid;
    } catch (error) {
        console.error('[Discord Verify] Signature verification error:', error);
        return false;
    }
}

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex) {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return new Uint8Array();
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

/**
 * Define all Discord slash commands
 */
const COMMANDS = [
    {
        name: 'tasks',
        description: 'View your tasks',
        options: []
    },
    {
        name: 'create',
        description: 'Create a new task',
        options: [
            {
                name: 'title',
                description: 'Task title',
                type: 3, // STRING
                required: true
            },
            {
                name: 'due',
                description: 'Due date (YYYY-MM-DD)',
                type: 3,
                required: true
            },
            {
                name: 'priority',
                description: 'Priority level',
                type: 3,
                required: false,
                choices: [
                    { name: 'Low', value: 'low' },
                    { name: 'Medium', value: 'medium' },
                    { name: 'High', value: 'high' }
                ]
            }
        ]
    },
    {
        name: 'complete',
        description: 'Mark a task as complete',
        options: [
            {
                name: 'task',
                description: 'Task name or ID',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'summary',
        description: 'Get your task summary'
    },
    {
        name: 'priorities',
        description: 'View high priority tasks'
    },
    {
        name: 'claude',
        description: 'Ask Claude AI or manage tasks with natural language',
        options: [
            {
                name: 'query',
                description: 'Your question or command',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'link',
        description: 'Link your Discord account',
        options: [
            {
                name: 'code',
                description: 'Link code from website settings',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'help',
        description: 'Show available commands'
    }
];

/**
 * Create response for Discord interaction
 */
function createResponse(content, ephemeral = false) {
    const data = { content };
    if (ephemeral) {
        data.flags = 64; // EPHEMERAL flag
    }
    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data
    };
}

/**
 * Create embed response
 */
function createEmbedResponse(embed, ephemeral = false) {
    const data = { embeds: [embed] };
    if (ephemeral) {
        data.flags = 64; // EPHEMERAL flag
    }
    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data
    };
}

/**
 * Get option value from interaction data
 */
function getOption(options, name) {
    if (!options) return null;
    const option = options.find(opt => opt.name === name);
    return option ? option.value : null;
}

module.exports = {
    InteractionType,
    InteractionResponseType,
    COMMANDS,
    verifyDiscordRequest,
    createResponse,
    createEmbedResponse,
    getOption
};
