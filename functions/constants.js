/**
 * Application Constants
 * Centralized configuration values and magic numbers
 */

// ==================== VALIDATION LIMITS ====================

const VALIDATION = {
    // String length limits
    TASK_NAME_MIN: 1,
    TASK_NAME_MAX: 200,
    TASK_DESCRIPTION_MAX: 2000,

    PROJECT_NAME_MIN: 1,
    PROJECT_NAME_MAX: 100,
    PROJECT_DESCRIPTION_MAX: 1000,

    USERNAME_MIN: 3,
    USERNAME_MAX: 50,

    PASSWORD_MIN: 6,
    PASSWORD_MAX: 100,

    EMAIL_MAX: 255,

    DISCORD_LINK_CODE_LENGTH: 8,

    // Allowed values
    PRIORITIES: ['none', 'low', 'medium', 'high'],
    STATUSES: ['pending', 'in-progress', 'completed'],

    // Regex patterns
    HEX_COLOR_REGEX: /^#([0-9A-Fa-f]{6})$/,
    EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    USERNAME_REGEX: /^[a-zA-Z0-9_-]+$/
};

// ==================== SECURITY ====================

const SECURITY = {
    // Password hashing
    BCRYPT_SALT_ROUNDS: 10,

    // Session
    SESSION_SECRET_MIN_LENGTH: 32,
    SESSION_MAX_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds

    // Discord HMAC authentication
    DISCORD_HMAC_TIMESTAMP_WINDOW: 60000, // 60 seconds in milliseconds
    DISCORD_HMAC_FUTURE_TOLERANCE: 5000, // 5 seconds clock skew tolerance
    DISCORD_SIGNATURE_LENGTH: 64, // 64 hex characters = 32 bytes

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: 100,

    // Login rate limiting (stricter)
    LOGIN_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    LOGIN_RATE_LIMIT_MAX_REQUESTS: 5
};

// ==================== SERVER CONFIGURATION ====================

const SERVER = {
    // Default ports
    DEFAULT_PORT: 5001,
    DEFAULT_PORT_SIMPLE: 3000,

    // CORS
    DEFAULT_ALLOWED_ORIGINS: ['http://localhost:5001', 'http://127.0.0.1:5001'],

    // Body parser limits
    JSON_BODY_LIMIT: '10mb',

    // Node version requirement
    MIN_NODE_VERSION: 16
};

// ==================== DATABASE ====================

const DATABASE = {
    // Data directory for JSON storage
    DATA_DIR: './data',

    // File names
    USERS_FILE: 'users.json',
    PROJECTS_FILE: 'projects.json',
    TASKS_FILE: 'tasks.json',
    ACTIVITY_FILE: 'activity.json',

    // Migration tracking
    MIGRATIONS_DIR: './migrations',
    MIGRATIONS_TABLE: 'schema_migrations'
};

// ==================== UI/UX ====================

const UI = {
    // Project colors palette
    PROJECT_COLORS: [
        '#f06a6a', // Red
        '#ffc82c', // Yellow
        '#13ce66', // Green
        '#667eea', // Purple
        '#764ba2', // Dark purple
        '#f093fb', // Pink
        '#4facfe', // Blue
        '#43e97b'  // Light green
    ],

    // Activity log limits
    MAX_ACTIVITY_ITEMS: 100,

    // Default user settings
    DEFAULT_USER_ROLE: 'user',
    ADMIN_ROLE: 'admin'
};

// ==================== ID GENERATION ====================

const ID = {
    // ID prefixes
    PREFIX_USER: 'user',
    PREFIX_PROJECT: 'proj',
    PREFIX_TASK: 'task',
    PREFIX_ACTIVITY: 'activity',

    // ID format: prefix_timestamp_random
    RANDOM_SUFFIX_LENGTH: 6
};

// ==================== ACTIVITY TYPES ====================

const ACTIVITY = {
    TYPES: {
        USER_REGISTERED: 'user_registered',
        USER_DELETED: 'user_deleted',
        PROJECT_CREATED: 'project_created',
        PROJECT_UPDATED: 'project_updated',
        PROJECT_DELETED: 'project_deleted',
        TASK_CREATED: 'task_created',
        TASK_UPDATED: 'task_updated',
        TASK_DELETED: 'task_deleted',
        MEMBER_ADDED: 'member_added',
        MEMBER_REMOVED: 'member_removed'
    }
};

// ==================== HTTP STATUS CODES ====================

const HTTP = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500
};

// ==================== ERROR MESSAGES ====================

const ERRORS = {
    // Authentication
    AUTH_REQUIRED: 'Authentication required',
    INVALID_CREDENTIALS: 'Invalid username or password',
    SESSION_EXPIRED: 'Session expired',

    // Discord
    DISCORD_INVALID_SIGNATURE: 'Invalid Discord authentication. Request signature verification failed.',
    DISCORD_NOT_LINKED: 'Discord account not linked. Please link your Discord account on the website.',
    DISCORD_REQUEST_TOO_OLD: 'Request too old',
    DISCORD_REQUEST_FUTURE: 'Timestamp too far in future',
    DISCORD_MISSING_HEADERS: 'Missing required headers',

    // Validation
    VALIDATION_FAILED: 'Validation failed',
    MISSING_REQUIRED_FIELDS: 'Missing required fields',

    // Resources
    NOT_FOUND: 'Resource not found',
    PROJECT_NOT_FOUND: 'Project not found',
    TASK_NOT_FOUND: 'Task not found',
    USER_NOT_FOUND: 'User not found',

    // Permissions
    ACCESS_DENIED: 'Access denied',
    NOT_PROJECT_MEMBER: 'You are not a member of this project',
    NOT_PROJECT_OWNER: 'Only the project owner can perform this action',

    // Conflicts
    USERNAME_EXISTS: 'Username already exists',
    EMAIL_EXISTS: 'Email already exists',
    DISCORD_ID_EXISTS: 'Discord ID already linked to another account'
};

module.exports = {
    VALIDATION,
    SECURITY,
    SERVER,
    DATABASE,
    UI,
    ID,
    ACTIVITY,
    HTTP,
    ERRORS
};
