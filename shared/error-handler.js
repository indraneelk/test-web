/**
 * Global Error Handler Middleware
 * Provides consistent error responses across all endpoints
 */

const { ValidationError, AuthenticationError, PermissionError, NotFoundError, ConflictError } = require('./errors');
const { HTTP } = require('./constants');

/**
 * Express error handling middleware
 * Maps custom error types to HTTP status codes
 *
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function errorHandler(err, req, res, next) {
    // Log error for debugging
    console.error(`[${new Date().toISOString()}] Error:`, {
        type: err.name,
        message: err.message,
        path: req.path,
        method: req.method,
        userId: req.userId || 'anonymous'
    });

    // Handle custom errors with specific status codes
    if (err instanceof ValidationError) {
        return res.status(err.statusCode || HTTP.BAD_REQUEST).json({
            error: err.message,
            type: 'ValidationError'
        });
    }

    if (err instanceof AuthenticationError) {
        return res.status(err.statusCode || HTTP.UNAUTHORIZED).json({
            error: err.message,
            type: 'AuthenticationError'
        });
    }

    if (err instanceof PermissionError) {
        return res.status(err.statusCode || HTTP.FORBIDDEN).json({
            error: err.message,
            type: 'PermissionError'
        });
    }

    if (err instanceof NotFoundError) {
        return res.status(err.statusCode || HTTP.NOT_FOUND).json({
            error: err.message,
            type: 'NotFoundError'
        });
    }

    if (err instanceof ConflictError) {
        return res.status(err.statusCode || HTTP.CONFLICT).json({
            error: err.message,
            type: 'ConflictError'
        });
    }

    // Handle unexpected errors
    console.error('Unexpected error:', err);
    return res.status(HTTP.INTERNAL_SERVER_ERROR).json({
        error: process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : err.message,
        type: 'InternalError'
    });
}

/**
 * Async route handler wrapper
 * Catches errors from async route handlers and passes them to error handler
 *
 * Usage:
 * app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
 *     const tasks = await getTasks();
 *     res.json(tasks);
 * }));
 *
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express middleware function
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    errorHandler,
    asyncHandler
};
