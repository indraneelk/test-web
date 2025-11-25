/**
 * Custom Error Classes for Business Logic
 * These allow business logic to throw typed errors that HTTP handlers can translate to appropriate status codes
 */

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
    }
}

class AuthenticationError extends Error {
    constructor(message = 'Authentication required') {
        super(message);
        this.name = 'AuthenticationError';
        this.statusCode = 401;
    }
}

class PermissionError extends Error {
    constructor(message = 'Access denied') {
        super(message);
        this.name = 'PermissionError';
        this.statusCode = 403;
    }
}

class NotFoundError extends Error {
    constructor(message = 'Resource not found') {
        super(message);
        this.name = 'NotFoundError';
        this.statusCode = 404;
    }
}

class ConflictError extends Error {
    constructor(message = 'Resource already exists') {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
    }
}

module.exports = {
    ValidationError,
    AuthenticationError,
    PermissionError,
    NotFoundError,
    ConflictError
};
