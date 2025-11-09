/**
 * Shared Helper Functions
 * Used by both server-auth.js (Express) and worker.js (Cloudflare Workers)
 */

/**
 * Generate unique ID with prefix
 * @param {string} prefix - Prefix for the ID (e.g., 'task', 'project', 'user')
 * @returns {string} Unique ID
 */
function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current timestamp in ISO format
 * @returns {string} ISO timestamp
 */
function getCurrentTimestamp() {
    return new Date().toISOString();
}

/**
 * Sanitize and truncate string input
 * @param {any} str - Input to sanitize
 * @param {number} maxLen - Maximum length (default 1000)
 * @returns {string} Sanitized string
 */
function sanitizeString(str, maxLen = 1000) {
    if (typeof str !== 'string') return '';
    const s = str.trim();
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Generate secure Discord link code
 * Format: LINK-XXXXX (5 random alphanumeric characters)
 * @returns {string} Discord link code
 */
function generateDiscordLinkCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'LINK-';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Validate hex color format
 * @param {any} str - Color string to validate
 * @returns {boolean} True if valid hex color
 */
function isHexColor(str) {
    return typeof str === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str.trim());
}

module.exports = {
    generateId,
    getCurrentTimestamp,
    sanitizeString,
    generateDiscordLinkCode,
    isHexColor
};
