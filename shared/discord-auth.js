/**
 * Discord Bot Authentication with HMAC Signature Verification
 *
 * Security measures:
 * - HMAC-SHA256 signature verification
 * - Timestamp validation (prevents replay attacks)
 * - Constant-time comparison (prevents timing attacks)
 */

const crypto = require('crypto');

/**
 * Verify Discord bot request authenticity using HMAC signature
 * @param {Object} headers - Request headers object
 * @param {string} secret - Shared secret key (DISCORD_BOT_SECRET)
 * @returns {string|null} Discord user ID if valid, null if invalid
 */
function verifyDiscordRequest(headers, secret) {
    try {
        // Extract headers
        const discordUserId = headers['x-discord-user-id'];
        const timestamp = headers['x-discord-timestamp'];
        const receivedSig = headers['x-discord-signature'];

        // Validate presence of required headers
        if (!discordUserId || !timestamp || !receivedSig) {
            console.log('Discord auth failed: Missing required headers');
            return null;
        }

        // Validate secret is configured
        if (!secret || secret === 'your-secret-here') {
            console.error('DISCORD_BOT_SECRET not configured or using default value!');
            return null;
        }

        // Validate timestamp format
        const timestampNum = parseInt(timestamp, 10);
        if (isNaN(timestampNum)) {
            console.log('Discord auth failed: Invalid timestamp format');
            return null;
        }

        // Check timestamp freshness (prevent replay attacks)
        // Allow 60 seconds in the past, 5 seconds in the future (clock skew)
        const now = Date.now();
        const age = now - timestampNum;

        if (age > 60000) {
            console.log(`Discord auth failed: Request too old (${age}ms)`);
            return null;
        }

        if (age < -5000) {
            console.log(`Discord auth failed: Timestamp too far in future (${age}ms)`);
            return null;
        }

        // Compute expected signature
        // Payload format: discordUserId|timestamp
        const payload = `${discordUserId}|${timestamp}`;
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        // Validate signature length (64 hex chars = 32 bytes)
        if (receivedSig.length !== 64) {
            console.log('Discord auth failed: Invalid signature length');
            return null;
        }

        // Constant-time comparison to prevent timing attacks
        try {
            const receivedBuffer = Buffer.from(receivedSig, 'hex');
            const expectedBuffer = Buffer.from(expectedSig, 'hex');

            if (receivedBuffer.length !== expectedBuffer.length) {
                console.log('Discord auth failed: Signature length mismatch');
                return null;
            }

            if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
                console.log('Discord auth failed: Signature mismatch');
                return null;
            }
        } catch (error) {
            console.log('Discord auth failed: Signature comparison error:', error.message);
            return null;
        }

        // ✅ All checks passed - request is authentic
        return discordUserId;

    } catch (error) {
        console.error('Discord auth error:', error);
        return null;
    }
}

/**
 * Get headers from Express request
 * @param {Object} req - Express request object
 * @returns {Object} Headers object
 */
function getHeadersFromExpressRequest(req) {
    return {
        'x-discord-user-id': req.headers['x-discord-user-id'],
        'x-discord-timestamp': req.headers['x-discord-timestamp'],
        'x-discord-signature': req.headers['x-discord-signature']
    };
}

/**
 * Get headers from Cloudflare Workers request
 * @param {Request} request - Cloudflare Workers request object
 * @returns {Object} Headers object
 */
function getHeadersFromWorkersRequest(request) {
    return {
        'x-discord-user-id': request.headers.get('X-Discord-User-ID'),
        'x-discord-timestamp': request.headers.get('X-Discord-Timestamp'),
        'x-discord-signature': request.headers.get('X-Discord-Signature')
    };
}

module.exports = {
    verifyDiscordRequest,
    getHeadersFromExpressRequest,
    getHeadersFromWorkersRequest
};
