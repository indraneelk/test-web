/**
 * Shared Validation Functions
 * Used by both server-auth.js (Express) and worker.js (Cloudflare Workers)
 */

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
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate username format
 * 3-30 characters, alphanumeric and underscores only
 * @param {any} username - Username to validate
 * @returns {boolean} True if valid
 */
function validateUsername(username) {
    if (typeof username !== 'string') return false;
    const trimmed = username.trim();
    return /^[a-zA-Z0-9_]{3,30}$/.test(trimmed);
}

/**
 * Validate password strength
 * At least 8 characters with complexity requirements
 * Requires at least 3 of: uppercase, lowercase, numbers, special chars
 * @param {any} password - Password to validate
 * @returns {boolean} True if valid
 */
function validatePassword(password) {
    if (typeof password !== 'string') return false;
    if (password.length < 8) return false;

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
    return ['none', 'low', 'medium', 'high'].includes(s);
}

/**
 * Validate task status
 * @param {any} v - Status value to validate
 * @returns {boolean} True if valid
 */
function validateStatus(v) {
    if (v == null) return true;
    const s = String(v).toLowerCase().trim();
    return ['pending', 'in-progress', 'completed'].includes(s);
}

module.exports = {
    validateString,
    validateEmail,
    validateUsername,
    validatePassword,
    validatePriority,
    validateStatus
};
