/**
 * Shared Validation Functions
 * Used by both server-auth.js (Express) and worker.js (Cloudflare Workers)
 */

const { VALIDATION } = require('./constants');

/**
 * Validate string length
 * @param {any} str - String to validate
 * @param {number} minLength - Minimum length (default 1)
 * @param {number} maxLength - Maximum length (default 500)
 * @returns {boolean} True if valid
 */
function validateString(str, minLength = 1, maxLength = 500) {
    if (typeof str !== 'string') return false;
    const trimmed = str.trim();
    return trimmed.length >= minLength && trimmed.length <= maxLength;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid or empty (email is optional)
 */
function validateEmail(email) {
    if (!email) return true; // Email is optional
    return VALIDATION.EMAIL_REGEX.test(email) && email.length <= VALIDATION.EMAIL_MAX;
}

/**
 * Validate username format
 * 3-50 characters, alphanumeric, underscores, and hyphens only
 * @param {any} username - Username to validate
 * @returns {boolean} True if valid
 */
function validateUsername(username) {
    if (typeof username !== 'string') return false;
    const trimmed = username.trim();
    if (trimmed.length < VALIDATION.USERNAME_MIN || trimmed.length > VALIDATION.USERNAME_MAX) {
        return false;
    }
    return VALIDATION.USERNAME_REGEX.test(trimmed);
}

/**
 * Validate password strength
 * Minimum length with complexity requirements
 * Requires at least 3 of: uppercase, lowercase, numbers, special chars
 * @param {any} password - Password to validate
 * @returns {boolean} True if valid
 */
function validatePassword(password) {
    if (typeof password !== 'string') return false;
    if (password.length < VALIDATION.PASSWORD_MIN || password.length > VALIDATION.PASSWORD_MAX) {
        return false;
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const complexityCount = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar].filter(Boolean).length;
    return complexityCount >= 3;
}

/**
 * Validate task priority
 * @param {any} v - Priority value to validate
 * @returns {boolean} True if valid
 */
function validatePriority(v) {
    if (v == null) return true;
    const s = String(v).toLowerCase().trim();
    return VALIDATION.PRIORITIES.includes(s);
}

/**
 * Validate task status
 * @param {any} v - Status value to validate
 * @returns {boolean} True if valid
 */
function validateStatus(v) {
    if (v == null) return true;
    const s = String(v).toLowerCase().trim();
    return VALIDATION.STATUSES.includes(s);
}

/**
 * Validate Discord ID (snowflake format)
 * Discord IDs are 17-19 digit integers
 * @param {any} id - Discord ID to validate
 * @returns {boolean} True if valid
 */
function validateDiscordId(id) {
    if (!id) return false;
    const str = String(id);
    return /^\d{17,19}$/.test(str);
}

/**
 * Validate hex color code
 * @param {any} color - Color to validate
 * @returns {boolean} True if valid
 */
function validateHexColor(color) {
    if (!color) return false;
    return VALIDATION.HEX_COLOR_REGEX.test(String(color).trim());
}

/**
 * Validate date is reasonable (not too far in past/future)
 * @param {any} date - Date to validate
 * @param {number} maxYearsInPast - Max years in past (default 10)
 * @param {number} maxYearsInFuture - Max years in future (default 10)
 * @returns {boolean} True if valid
 */
function validateDate(date, maxYearsInPast = 10, maxYearsInFuture = 10) {
    if (!date) return false;

    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return false;

    const now = new Date();
    const minDate = new Date();
    minDate.setFullYear(now.getFullYear() - maxYearsInPast);

    const maxDate = new Date();
    maxDate.setFullYear(now.getFullYear() + maxYearsInFuture);

    return dateObj >= minDate && dateObj <= maxDate;
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid
 */
function validateURL(url) {
    if (!url) return false;
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Validate ID format (our generated IDs)
 * Format: prefix_timestamp_random
 * @param {string} id - ID to validate
 * @param {string} prefix - Expected prefix (optional)
 * @returns {boolean} True if valid
 */
function validateId(id, prefix = null) {
    if (!id || typeof id !== 'string') return false;

    const parts = id.split('_');
    if (parts.length !== 3) return false;

    const [idPrefix, timestamp, random] = parts;

    // Check prefix if specified
    if (prefix && idPrefix !== prefix) return false;

    // Check timestamp is a number
    if (!/^\d+$/.test(timestamp)) return false;

    // Check random part exists
    if (!random || random.length === 0) return false;

    return true;
}

module.exports = {
    validateString,
    validateEmail,
    validateUsername,
    validatePassword,
    validatePriority,
    validateStatus,
    validateDiscordId,
    validateHexColor,
    validateDate,
    validateURL,
    validateId
};
