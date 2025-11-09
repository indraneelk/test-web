require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const claudeService = require('./claude-service');
const dataService = require('./data-service');
const supabaseService = require('./supabase-service');

// Shared modules
const { generateId, getCurrentTimestamp, sanitizeString, generateDiscordLinkCode, isHexColor } = require('./shared/helpers');
const { validateString, validateEmail, validateUsername, validatePassword, validatePriority, validateStatus } = require('./shared/validators');
const businessLogic = require('./shared/business-logic');
const { ValidationError, AuthenticationError, PermissionError, NotFoundError, ConflictError } = require('./shared/errors');
const { verifyDiscordRequest, getHeadersFromExpressRequest } = require('./shared/discord-auth');
const { SERVER, SECURITY, ERRORS, HTTP } = require('./shared/constants');
const { errorHandler, asyncHandler } = require('./shared/error-handler');

const app = express();
const PORT = process.env.PORT || SERVER.DEFAULT_PORT;

// CORS Configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : SERVER.DEFAULT_ALLOWED_ORIGINS;

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],  // Allow onclick handlers
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co"]  // Allow Supabase API calls and WebSockets
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

app.use(cors({
    origin: function (origin, callback) {
        // Allow same-origin requests (no origin header)
        if (!origin) {
            callback(null, true);
            return;
        }
        // Allow explicit origins
        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`⚠️  Blocked CORS request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Request body size limit to prevent DoS
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CRITICAL: Validate session secret
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ FATAL: SESSION_SECRET must be set in production');
        console.error('❌ Refusing to start without a secure session secret');
        process.exit(1);  // Exit immediately in production
    }
    console.warn('⚠️  WARNING: SESSION_SECRET not set - using random development secret');
    console.warn('⚠️  This secret will change on restart - sessions will be invalidated');
}

app.use(session({
    secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'), // Random fallback for dev
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true,
        sameSite: 'lax', // CSRF protection while allowing OAuth redirects
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(express.static('public'));
// Serve local UMD build of supabase-js to satisfy CSP 'self'
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/@supabase/supabase-js/dist/umd')));
app.get('/vendor/supabase.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
});

// Helper functions
const logActivity = async (userId, action, details, taskId = null, projectId = null) => {
    await dataService.logActivity({
        id: generateId('activity'),
        user_id: userId,
        task_id: taskId,
        project_id: projectId,
        action,
        details,
        timestamp: new Date().toISOString()
    });
};

// Supabase JWT verification using JWT secret (HS256)
const { jwtVerify } = require('jose');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

function getProjectRefFromUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.hostname.split('.')[0];
    } catch {
        return '';
    }
}

async function verifySupabaseJWT(token) {
    if (!SUPABASE_JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET not configured');
    const ref = getProjectRefFromUrl(SUPABASE_URL);
    if (!ref) throw new Error('SUPABASE_URL not configured');

    // Create secret key from JWT secret string
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

    const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256']
    });

    if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('Token expired');
    if (payload.iss && !String(payload.iss).includes(ref)) throw new Error('Invalid issuer');
    return payload; // { sub, email, user_metadata?, ... }
}

// Rate Limiting
const authLimiter = rateLimit({
    windowMs: SECURITY.LOGIN_RATE_LIMIT_WINDOW_MS,
    max: SECURITY.LOGIN_RATE_LIMIT_MAX_REQUESTS,
    message: { error: 'Too many login attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
});

const magicLinkLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1, // 1 magic link per minute
    message: { error: 'Too many magic link requests. Please wait 60 seconds and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req /*, res*/) => {
        try {
            const email = (req.body && typeof req.body.email === 'string') ? req.body.email.toLowerCase().trim() : '';
            const ip = (req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString();
            return `${email}|${ip}`;
        } catch {
            return req.ip || 'unknown';
        }
    }
});

// Authentication Middleware - supports Discord User ID, Bearer tokens, and sessions
const requireAuth = async (req, res, next) => {
    // Try Discord User ID first (from Discord bot) with HMAC signature verification
    const discordUserId = req.headers['x-discord-user-id'];
    if (discordUserId) {
        // Verify HMAC signature to prevent impersonation attacks
        const headers = getHeadersFromExpressRequest(req);
        const secret = process.env.DISCORD_BOT_SECRET;
        const verifiedUserId = verifyDiscordRequest(headers, secret);

        if (!verifiedUserId) {
            // Invalid signature or missing headers
            return res.status(HTTP.UNAUTHORIZED).json({
                error: ERRORS.DISCORD_INVALID_SIGNATURE
            });
        }

        try {
            const user = await dataService.getUserByDiscordId(verifiedUserId);
            if (user) {
                req.userId = user.id;
                req.user = user;
                return next();
            } else {
                return res.status(HTTP.FORBIDDEN).json({
                    error: ERRORS.DISCORD_NOT_LINKED
                });
            }
        } catch (error) {
            console.error('Discord auth error:', error);
            return res.status(500).json({ error: 'Authentication failed' });
        }
    }

    // Try Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            const payload = await verifySupabaseJWT(token);
            // Look up user by ID (user.id = Supabase sub)
            const user = await dataService.getUserById(payload.sub);
            if (user) {
                req.user = user;
                req.userId = user.id;
                return next();
            }
        } catch (err) {
            // Invalid token - return 401 immediately for Bearer auth failures
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    }

    // Fallback to session-based auth
    if (req.session && req.session.userId) {
        req.userId = req.session.userId;
        return next();
    }

    return res.status(401).json({ error: 'Authentication required' });
};

const requireAdmin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const user = await dataService.getUserById(req.session.userId);
        if (!user || !user.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Authentication check failed' });
    }
};

// Super admin check - only for Indraneel.kasmalkar@gmail.com
const requireSuperAdmin = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const user = await dataService.getUserById(req.session.userId);
        if (!user || user.email !== 'Indraneel.kasmalkar@gmail.com') {
            return res.status(403).json({ error: 'Super admin access required' });
        }
        req.user = user; // Attach user to request
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Authentication check failed' });
    }
};

// Check if user is project member or owner
const isProjectMember = async (userId, projectId) => {
    try {
        const project = await dataService.getProjectById(projectId);
        if (!project) return false;
        if (project.owner_id === userId) return true;

        // In D1, members are in project_members table
        // In JSON, members are in project.members array
        if (Array.isArray(project.members)) {
            return project.members.includes(userId);
        } else {
            const members = await dataService.getProjectMembers(projectId);
            return members.some(m => m.id === userId || m.user_id === userId);
        }
    } catch (error) {
        console.error('isProjectMember error:', error);
        return false;
    }
};

// Check if user is project owner
const isProjectOwner = async (userId, projectId) => {
    try {
        const project = await dataService.getProjectById(projectId);
        return project && project.owner_id === userId;
    } catch (error) {
        console.error('isProjectOwner error:', error);
        return false;
    }
};

// ==================== AUTH ROUTES ====================

// Register new user
// ==================== LEGACY AUTH REMOVED ====================
// Old bcrypt-based registration and login have been removed.
// System now uses Supabase-only authentication:
//   - Magic links for first-time user invites
//   - Email/password login managed by Supabase
//   - See /api/auth/supabase-login for the current login endpoint

// Logout
app.post('/api/auth/logout', (req, res) => {
    const userId = req.session?.userId;

    // Log activity if we have a userId
    if (userId) {
        logActivity(userId, 'user_logout', 'User logged out');
    }

    // Destroy session
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destruction error:', err);
        }

        // Clear session cookie explicitly
        res.clearCookie('connect.sid', {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });

        res.json({ message: 'Logged out successfully' });
    });
});

// Check session
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await dataService.getUserById(req.session.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password_hash: _, ...userWithoutPassword } = user;
        res.json({ user: userWithoutPassword });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// ==================== SUPABASE AUTH ROUTES ====================

// Send magic link
app.post('/api/auth/magic-link', magicLinkLimiter, async (req, res) => {
    try {
        if (!supabaseService.isEnabled()) {
            return res.status(501).json({
                error: 'Supabase authentication is not configured',
                hint: 'Add SUPABASE_URL and SUPABASE_ANON_KEY to your .env file'
            });
        }

        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const redirectTo = req.body.redirectTo || `${req.protocol}://${req.get('host')}/auth/callback`;

        await supabaseService.sendMagicLink(email, redirectTo);

        res.json({
            success: true,
            message: 'Magic link sent! Check your email.',
            email: email
        });
    } catch (error) {
        console.error('Magic link error:', error);
        res.status(500).json({
            error: 'Failed to send magic link',
            details: error.message
        });
    }
});

// Handle Supabase auth callback (verify and create/update user)
app.post('/api/auth/supabase-callback', authLimiter, async (req, res) => {
    try {
        if (!supabaseService.isEnabled()) {
            return res.status(501).json({ error: 'Supabase authentication is not configured' });
        }

        const { access_token, refresh_token } = req.body;

        if (!access_token) {
            return res.status(400).json({ error: 'Access token is required' });
        }

        // Verify token and get claims
        const claims = await verifySupabaseJWT(access_token);
        const sub = claims.sub;
        const email = claims.email || null;
        const meta = claims.user_metadata || {};
        const derivedName = meta.full_name || meta.name || (email ? email.split('@')[0] : 'User');

        // Check if user already exists in our system (by id=sub)
        let user = await dataService.getUserById(sub);

        if (!user) {
            // Check if user exists by email (for migration)
            user = email ? await dataService.getUserByEmail(email) : null;

            // If found by email, migrate: set id to sub is not trivial. Prefer creating new user ID=sub.
        }

        // Return user info and whether profile setup is needed
        const needsProfileSetup = !user;

        if (user) {
            // Set session
            req.session.userId = user.id;
            req.session.supabaseAccessToken = access_token;
            if (refresh_token) {
                req.session.supabaseRefreshToken = refresh_token;
            }

            await logActivity(user.id, 'user_login', `User ${user.name} logged in via Supabase`);

            const { password_hash: _, ...userWithoutPassword } = user;
            res.json({
                success: true,
                user: userWithoutPassword,
                needsProfileSetup: false
            });
        } else {
            // New user - needs to complete profile setup
            res.json({
                success: true,
                needsProfileSetup: true,
                supabaseUser: { id: sub, email: email, name: derivedName },
                tempToken: access_token
            });
        }
    } catch (error) {
        console.error('Supabase callback error:', error);
        res.status(500).json({
            error: 'Authentication failed'
            // Removed error.message to prevent information disclosure
        });
    }
});

// Complete profile setup for Supabase user
app.post('/api/auth/profile-setup', authLimiter, async (req, res) => {
    try {
        const { access_token, username, name, initials, color } = req.body;

        if (!access_token) {
            return res.status(400).json({ error: 'Access token is required' });
        }

        if (!username || !name || !initials) {
            return res.status(400).json({ error: 'Username, name, and initials are required' });
        }
        if (!validateUsername(username)) {
            return res.status(400).json({ error: 'Username must be 3-30 chars, letters/numbers/underscore only' });
        }
        if (!validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Name must be 1-100 characters' });
        }
        const initStr = String(initials).trim();
        if (!/^[A-Za-z]{1,4}$/.test(initStr)) {
            return res.status(400).json({ error: 'Initials must be 1-4 letters' });
        }

        const claims = await verifySupabaseJWT(access_token);
        const sub = claims.sub;
        const email = claims.email || null;
        const userExists = await dataService.getUserById(sub);
        if (userExists) {
            return res.status(400).json({ error: 'User already exists' });
        }
        // Enforce username uniqueness
        const allUsers = await dataService.getUsers();
        const taken = allUsers.find(u => u.username === username);
        if (taken) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const newUser = {
            id: sub,
            username: sanitizeString(username),
            name: sanitizeString(name),
            email: email ? sanitizeString(email) : null,
            initials: initStr.toUpperCase(),
            is_admin: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await dataService.createUser(newUser);

        // Check if this email was invited and mark invitation as accepted
        if (email) {
            const invitation = await dataService.getInvitationByEmail(email);
            if (invitation && invitation.status === 'pending') {
                await dataService.updateInvitation(email, {
                    status: 'accepted',
                    joined_at: newUser.created_at,
                    joined_user_id: newUser.id
                });
            }
        }

        // Create personal project for the new user
        const personalProject = {
            id: generateId('project'),
            name: `${newUser.name}'s Personal Tasks`,
            description: 'Personal tasks and to-dos',
            color: color || '#667eea',
            owner_id: newUser.id,
            members: [],
            is_personal: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await dataService.createProject(personalProject);
        await logActivity(newUser.id, 'project_created', `Personal project created`, null, personalProject.id);

        // Set session
        req.session.userId = newUser.id;
        req.session.supabaseAccessToken = access_token;

        await logActivity(newUser.id, 'user_registered', `User ${newUser.name} registered via Supabase`);

        // Return user without sensitive info
        const { password_hash: _, ...userWithoutPassword } = newUser;
        res.status(201).json({
            success: true,
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Profile setup error');
        res.status(500).json({
            error: 'Profile setup failed'
        });
    }
});

// Handle Supabase email/password login
app.post('/api/auth/supabase-login', authLimiter, async (req, res) => {
    try {
        const { access_token } = req.body;
        if (!access_token) return res.status(400).json({ error: 'Access token is required' });

        const claims = await verifySupabaseJWT(access_token);
        const sub = claims.sub;
        let user = await dataService.getUserById(sub);
        if (!user) {
            return res.status(404).json({ error: 'User not found. Please complete profile setup first.', needsProfileSetup: true });
        }
        req.session.regenerate(() => {});
        req.session.userId = user.id;
        req.session.supabaseAccessToken = access_token;
        const { password_hash: _, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
        console.error('Supabase login error:', error);
        res.status(401).json({ error: 'Invalid access token' });
    }
});

// Create a server session from a Supabase access token
app.post('/api/auth/supabase', authLimiter, async (req, res) => {
    try {
        const { access_token } = req.body || {};
        if (!access_token) {
            return res.status(400).json({ error: 'Missing access_token' });
        }
        const payload = await verifySupabaseJWT(access_token);
        const supaUserId = payload.sub;
        const email = payload.email || null;
        const meta = payload.user_metadata || {};
        let name = meta.full_name || meta.name || (email ? email.split('@')[0] : 'User');

        // Ensure local user
        let user = await dataService.getUserById(supaUserId);
        if (!user) {
            // No password_hash needed - all auth is managed by Supabase
            const newUser = {
                id: supaUserId,
                username: (email ? email.split('@')[0] : `user_${supaUserId.slice(0,8)}`),
                password_hash: null, // Auth managed by Supabase
                name: sanitizeString(name),
                email: email ? sanitizeString(email) : null,
                is_admin: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            await dataService.createUser(newUser);

            // Create personal project
            const personalProject = {
                id: generateId('project'),
                name: `${newUser.name}'s Personal Tasks`,
                description: 'Personal tasks and to-dos',
                color: '#f06a6a',
                owner_id: newUser.id,
                members: [],
                is_personal: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            await dataService.createProject(personalProject);
            await logActivity(newUser.id, 'user_linked', 'User created via Supabase', null, personalProject.id);
            user = await dataService.getUserById(supaUserId);
        }

        // Regenerate session to prevent fixation
        await new Promise(resolve => req.session.regenerate(() => resolve()))
        req.session.userId = supaUserId;
        const { password_hash: _, ...userWithoutPass } = user;
        res.json({ user: userWithoutPass });
    } catch (err) {
        console.error('Supabase session error:', err.message);
        res.status(401).json({ error: 'Invalid Supabase token' });
    }
});

// Public config for frontend (safe to expose anon key)
app.get('/api/config/public', (req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
    });
});

// ==================== USER MANAGEMENT ROUTES ====================

// Get all users (for admin and project member selection)
app.get('/api/users', requireAuth, async (req, res) => {
    try {
        const users = await dataService.getUsers();
        const usersWithoutPasswords = users.map(({ password_hash, ...user }) => user);
        res.json(usersWithoutPasswords);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get user by ID
app.get('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const user = await dataService.getUserById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password_hash: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Update current user's profile
// Note: Password changes must be done through Supabase, not this endpoint
app.put('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const { name, email, initials, username, color } = req.body || {};

        // Validate fields if provided
        if (name !== undefined && !validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Name must be 1-100 characters' });
        }
        if (email !== undefined && !validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (initials !== undefined) {
            const str = String(initials).trim();
            if (str && !/^[A-Za-z]{1,4}$/.test(str)) {
                return res.status(400).json({ error: 'Initials must be 1-4 letters' });
            }
        }
        if (username !== undefined) {
            if (!validateUsername(username)) {
                return res.status(400).json({ error: 'Username must be 3-30 chars, letters/numbers/underscore only' });
            }
            const allUsers = await dataService.getUsers();
            const exists = allUsers.find(u => u.username === username && u.id !== req.userId);
            if (exists) {
                return res.status(400).json({ error: 'Username already taken' });
            }
        }

        const user = await dataService.getUserById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Update local user profile (password is handled client-side via Supabase)
        const updates = {
            name: name !== undefined ? sanitizeString(name) : user.name,
            email: email !== undefined ? sanitizeString(email) : user.email,
            initials: initials !== undefined ? sanitizeString(initials || '') : (user.initials || null),
            username: username !== undefined ? sanitizeString(username) : user.username,
            color: color !== undefined ? sanitizeString(color) : user.color
        };

        const updated = await dataService.updateUser(req.userId, updates);
        const { password_hash: _, ...withoutPass } = updated || {};
        res.json({ user: withoutPass });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await dataService.getUserById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Note: Delete user functionality needs to be added to dataService
        // For now, just return an error
        res.status(501).json({ error: 'User deletion not yet implemented for data service' });

        // TODO: Implement deleteUser in dataService
        // await dataService.deleteUser(req.params.id);
        // await logActivity(req.session.userId, 'user_deleted', `User ${user.name} deleted`);
        // res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Update Discord handle for current user
app.put('/api/user/discord-handle', requireAuth, async (req, res) => {
    try {
        const { discordHandle, discordUserId } = req.body;

        if (!discordHandle || !discordUserId) {
            return res.status(400).json({ error: 'Discord handle and user ID are required' });
        }

        // Validate Discord User ID format (17-19 digit number)
        if (!/^\d{17,19}$/.test(discordUserId)) {
            return res.status(400).json({ error: 'Invalid Discord User ID format. Must be a 17-19 digit number.' });
        }

        // Validate Discord handle (alphanumeric, underscores, periods, 2-32 chars, optional discriminator)
        const handleWithoutDiscriminator = discordHandle.replace(/#\d{4}$/, '');
        if (!/^[a-zA-Z0-9_.]{2,32}$/.test(handleWithoutDiscriminator)) {
            return res.status(400).json({ error: 'Invalid Discord handle format' });
        }

        // Check if Discord user ID is already taken by another user
        const existingUser = await dataService.getUserByDiscordId(discordUserId);
        if (existingUser && existingUser.id !== req.userId) {
            return res.status(400).json({ error: 'This Discord account is already linked to another user' });
        }

        const updatedUser = await dataService.updateUserDiscordHandle(req.userId, discordHandle, discordUserId);

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'Discord handle updated successfully',
            user: {
                id: updatedUser.id,
                name: updatedUser.name,
                email: updatedUser.email,
                discord_handle: updatedUser.discord_handle,
                discord_verified: updatedUser.discord_verified
            }
        });
    } catch (error) {
        console.error('Error updating Discord handle:', error);
        res.status(500).json({ error: 'Failed to update Discord handle' });
    }
});

// Get Discord handle for current user
app.get('/api/user/discord-handle', requireAuth, async (req, res) => {
    try {
        const user = await dataService.getUserById(req.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            discord_handle: user.discord_handle || null,
            discord_user_id: user.discord_user_id || null,
            discord_verified: user.discord_verified || 0
        });
    } catch (error) {
        console.error('Error fetching Discord handle:', error);
        res.status(500).json({ error: 'Failed to fetch Discord handle' });
    }
});

// Generate Discord link code (for logged-in users)
app.post('/api/discord/generate-link-code', requireAuth, async (req, res) => {
    try {
        const db = dataService.db;

        // Clean up expired codes for this user first
        const now = new Date().toISOString();
        await db.run('DELETE FROM discord_link_codes WHERE user_id = ? AND expires_at < ?', [req.userId, now]);

        // Check if user already has a valid unused code
        const existingCode = await db.get(
            'SELECT code, expires_at FROM discord_link_codes WHERE user_id = ? AND used = 0 AND expires_at > ?',
            [req.userId, now]
        );

        if (existingCode) {
            const expiresAt = new Date(existingCode.expires_at);
            const secondsRemaining = Math.floor((expiresAt - new Date()) / 1000);
            return res.json({
                code: existingCode.code,
                expiresIn: secondsRemaining
            });
        }

        // Generate new code
        let code;
        let attempts = 0;
        while (attempts < 10) {
            code = generateDiscordLinkCode();
            const existing = await db.get('SELECT id FROM discord_link_codes WHERE code = ?', [code]);
            if (!existing) break;
            attempts++;
        }

        if (attempts >= 10) {
            return res.status(500).json({ error: 'Failed to generate unique code' });
        }

        // Code expires in 5 minutes
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const createdAt = new Date().toISOString();

        await db.run(
            'INSERT INTO discord_link_codes (code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
            [code, req.userId, expiresAt, createdAt]
        );

        res.json({
            code,
            expiresIn: 300 // 5 minutes in seconds
        });
    } catch (error) {
        console.error('Error generating Discord link code:', error);
        res.status(500).json({ error: 'Failed to generate link code' });
    }
});

// Check Discord link status (for polling)
app.get('/api/discord/link-status/:code', requireAuth, async (req, res) => {
    try {
        const { code } = req.params;
        const db = dataService.db;

        const linkCode = await db.get(
            'SELECT used, expires_at FROM discord_link_codes WHERE code = ? AND user_id = ?',
            [code, req.userId]
        );

        if (!linkCode) {
            return res.status(404).json({ error: 'Code not found' });
        }

        const now = new Date().toISOString();
        if (linkCode.expires_at < now) {
            return res.json({ status: 'expired' });
        }

        if (linkCode.used) {
            // Get updated user info
            const user = await dataService.getUserById(req.userId);
            return res.json({
                status: 'linked',
                discord_handle: user.discord_handle,
                discord_user_id: user.discord_user_id
            });
        }

        res.json({ status: 'pending' });
    } catch (error) {
        console.error('Error checking link status:', error);
        res.status(500).json({ error: 'Failed to check status' });
    }
});

// Verify Discord link code (called by Discord bot)
app.post('/api/discord/verify-link-code', async (req, res) => {
    try {
        const { code, discordUserId, discordHandle } = req.body;

        if (!code || !discordUserId || !discordHandle) {
            return res.status(400).json({ error: 'Code, Discord User ID, and handle are required' });
        }

        // Validate Discord User ID format
        if (!/^\d{17,19}$/.test(discordUserId)) {
            return res.status(400).json({ error: 'Invalid Discord User ID format' });
        }

        const db = dataService.db;
        const now = new Date().toISOString();

        // Find the link code
        const linkCode = await db.get(
            'SELECT id, user_id, expires_at, used FROM discord_link_codes WHERE code = ?',
            [code]
        );

        if (!linkCode) {
            return res.status(404).json({ error: 'Invalid code' });
        }

        if (linkCode.expires_at < now) {
            return res.status(400).json({ error: 'Code expired' });
        }

        if (linkCode.used) {
            return res.status(400).json({ error: 'Code already used' });
        }

        // Check if Discord ID is already linked to another user
        const existingUser = await dataService.getUserByDiscordId(discordUserId);
        if (existingUser && existingUser.id !== linkCode.user_id) {
            return res.status(400).json({ error: 'This Discord account is already linked to another user' });
        }

        // Mark code as used
        await db.run('UPDATE discord_link_codes SET used = 1 WHERE id = ?', [linkCode.id]);

        // Update user with Discord info
        await dataService.updateUserDiscordHandle(linkCode.user_id, discordHandle, discordUserId);

        res.json({
            success: true,
            message: 'Discord account linked successfully'
        });
    } catch (error) {
        console.error('Error verifying link code:', error);
        res.status(500).json({ error: 'Failed to verify code' });
    }
});

// ==================== PROJECT ROUTES ====================

// Get all projects for current user
app.get('/api/projects', requireAuth, async (req, res) => {
    try {
        const projects = await dataService.getProjects();
        const userId = req.userId;

        // Return projects where user is owner or member
        const userProjects = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjects.push(p);
            }
        }

        res.json(userProjects);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// Get single project
app.get('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user has access
        if (!(await isProjectMember(req.userId, project.id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(project);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// Create new project
app.post('/api/projects', requireAuth, async (req, res) => {
    try {
        const project = await businessLogic.createProject(dataService, req.userId, req.body);
        await logActivity(req.userId, 'project_created', `Project "${project.name}" created`, null, project.id);
        res.status(201).json(project);
    } catch (error) {
        if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
        if (error instanceof PermissionError) return res.status(403).json({ error: error.message });
        if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// Update project
app.put('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const updatedProject = await businessLogic.updateProject(dataService, req.userId, req.params.id, req.body);
        await logActivity(req.userId, 'project_updated', `Project "${updatedProject.name}" updated`, null, req.params.id);
        res.json(updatedProject);
    } catch (error) {
        if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
        if (error instanceof PermissionError) return res.status(403).json({ error: error.message });
        if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// Delete project
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        // Get project before deletion for logging
        const project = await dataService.getProjectById(req.params.id);

        await businessLogic.deleteProject(dataService, req.userId, req.params.id);
        await logActivity(req.userId, 'project_deleted', `Project "${project.name}" deleted`, null, req.params.id);

        res.json({ message: 'Project deleted successfully', project: project });
    } catch (error) {
        if (error instanceof PermissionError) return res.status(403).json({ error: error.message });
        if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// Add member to project
app.post('/api/projects/:id/members', requireAuth, async (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if current user is owner
        if (!(await isProjectOwner(req.userId, req.params.id))) {
            return res.status(403).json({ error: 'Only project owner can add members' });
        }

        // Prevent adding members to personal projects
        if (project.is_personal) {
            return res.status(403).json({ error: 'Cannot add members to personal project' });
        }

        // Check if user exists
        const userToAdd = await dataService.getUserById(user_id);
        if (!userToAdd) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if already owner
        if (project.owner_id === user_id) {
            return res.status(400).json({ error: 'User is already the project owner' });
        }

        // Check if already member
        if (await isProjectMember(user_id, req.params.id)) {
            return res.status(400).json({ error: 'User is already a member' });
        }

        await dataService.addProjectMember(req.params.id, user_id);

        await logActivity(req.userId, 'member_added', `${userToAdd.name} added to project "${project.name}"`, null, req.params.id);

        const updatedProject = await dataService.getProjectById(req.params.id);
        res.json(updatedProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add member' });
    }
});

// Remove member from project
app.delete('/api/projects/:id/members/:userId', requireAuth, async (req, res) => {
    try {
        const projectId = req.params.id;
        const targetUserId = req.params.userId;
        const project = await dataService.getProjectById(projectId);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const selfRemoval = targetUserId === req.userId;
        if (selfRemoval) {
            if (project.owner_id === req.userId) {
                return res.status(400).json({ error: 'Project owners cannot leave their own project' });
            }
            if (!(await isProjectMember(req.userId, projectId))) {
                return res.status(404).json({ error: 'You are not a member of this project' });
            }
            await dataService.removeProjectMember(projectId, req.userId);
            // Unassign tasks in this project assigned to this user
            const tasks = await dataService.getTasks();
            const myTasks = tasks.filter(t => t.project_id === projectId && t.assigned_to_id === req.userId);
            for (const task of myTasks) {
                await dataService.updateTask(task.id, { ...task, assigned_to_id: null });
            }
            await logActivity(req.userId, 'member_removed', `You left the project "${project.name}"`, null, projectId);
            return res.json({ message: 'You left the project' });
        }

        // Removing someone else requires owner or admin
        const user = await dataService.getUserById(req.userId);
        const owner = await isProjectOwner(req.userId, projectId);
        if (!owner && !user?.is_admin) {
            return res.status(403).json({ error: 'Only project owner can remove members' });
        }
        if (project.is_personal) {
            return res.status(403).json({ error: 'Cannot remove members from personal project' });
        }
        if (!(await isProjectMember(targetUserId, projectId))) {
            return res.status(404).json({ error: 'Member not found' });
        }

        await dataService.removeProjectMember(projectId, targetUserId);
        // Unassign tasks in this project assigned to removed user
        const tasks = await dataService.getTasks();
        const theirTasks = tasks.filter(t => t.project_id === projectId && t.assigned_to_id === targetUserId);
        for (const task of theirTasks) {
            await dataService.updateTask(task.id, { ...task, assigned_to_id: null });
        }

        const removedUser = await dataService.getUserById(targetUserId);
        await logActivity(req.userId, 'member_removed', `${removedUser?.name || 'User'} removed from project "${project.name}"`, null, projectId);

        const updatedProject = await dataService.getProjectById(projectId);
        res.json(updatedProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

// ==================== TASK ROUTES ====================

// Get all tasks (filtered by user's projects)
app.get('/api/tasks', requireAuth, async (req, res) => {
    try {
        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const userId = req.userId;

        // Auto-archive tasks that have been completed for 7+ days
        const now = new Date();
        const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

        for (const task of tasks) {
            if (task.status === 'completed' && task.completed_at && !task.archived) {
                const completedDate = new Date(task.completed_at);
                const daysSinceCompletion = now - completedDate;

                if (daysSinceCompletion >= sevenDaysInMs) {
                    await dataService.updateTask(task.id, { ...task, archived: true });
                    task.archived = true; // Update in memory for this response
                }
            }
        }

        // Get user's project IDs
        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        // Filter tasks by user's projects
        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));

        res.json(userTasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Get single task
app.get('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const task = await dataService.getTaskById(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user has access to the project
        if (!(await isProjectMember(req.userId, task.project_id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

// Create new task
app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
        const task = await businessLogic.createTask(dataService, req.userId, req.body);
        await logActivity(req.userId, 'task_created', `Task "${task.name}" created`, task.id, task.project_id);
        res.status(201).json(task);
    } catch (error) {
        if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
        if (error instanceof PermissionError) return res.status(403).json({ error: error.message });
        if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update task
app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        // Get old task to track status changes for celebration
        const oldTask = await dataService.getTaskById(req.params.id);
        const oldStatus = oldTask ? oldTask.status : null;

        const updatedTask = await businessLogic.updateTask(dataService, req.userId, req.params.id, req.body);
        await logActivity(req.userId, 'task_updated', `Task "${updatedTask.name}" updated`, req.params.id, updatedTask.project_id);

        // Return status change info for celebration
        res.json({
            ...updatedTask,
            _statusChanged: oldStatus !== updatedTask.status,
            _wasCompleted: oldStatus !== 'completed' && updatedTask.status === 'completed'
        });
    } catch (error) {
        if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
        if (error instanceof PermissionError) return res.status(403).json({ error: error.message });
        if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Delete task
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        // Get task before deletion for logging
        const task = await dataService.getTaskById(req.params.id);

        await businessLogic.deleteTask(dataService, req.userId, req.params.id);
        await logActivity(req.userId, 'task_deleted', `Task "${task.name}" deleted`, req.params.id, task.project_id);

        res.json({ message: 'Task deleted successfully', task: task });
    } catch (error) {
        if (error instanceof PermissionError) return res.status(403).json({ error: error.message });
        if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// ==================== ACTIVITY LOG ROUTES ====================

// Get activity log
app.get('/api/activity', requireAuth, async (req, res) => {
    try {
        const activities = await dataService.getActivityLog();
        const projects = await dataService.getProjects();
        const userId = req.userId;

        // Get user's project IDs
        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        // Filter activities by user's projects or own activities
        const userActivities = activities.filter(a =>
            a.user_id === userId ||
            (a.project_id && userProjectIds.includes(a.project_id))
        );

        res.json(userActivities);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

// ==================== CLAUDE AI ROUTES ====================

// Ask Claude a question about tasks
app.post('/api/claude/ask', requireAuth, async (req, res) => {
    try {
        const { question } = req.body;

        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        // Validate question length
        if (!validateString(question, 1, 500)) {
            return res.status(400).json({ error: 'Question must be 1-500 characters' });
        }

        const userId = req.userId;

        // Get user's data
        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const users = await dataService.getUsers();

        // Filter to user's accessible data
        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));
        const userProjects = projects.filter(p => userProjectIds.includes(p.id));

        // Query Claude
        const response = await claudeService.ask(question, userTasks, userProjects, users);

        res.json({
            question: question,
            answer: response,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude query error:', error);
        res.status(500).json({
            error: 'Failed to get response from Claude',
            details: error.message
        });
    }
});

// Get task summary from Claude
app.get('/api/claude/summary', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;

        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const users = await dataService.getUsers();

        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));
        const userProjects = projects.filter(p => userProjectIds.includes(p.id));

        const summary = await claudeService.getSummary(userTasks, userProjects, users);

        res.json({
            summary: summary,
            taskCount: userTasks.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude summary error:', error);
        res.status(500).json({
            error: 'Failed to get summary from Claude',
            details: error.message
        });
    }
});

// Get task priorities from Claude
app.get('/api/claude/priorities', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;

        const tasks = await dataService.getTasks();
        const projects = await dataService.getProjects();
        const users = await dataService.getUsers();

        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        const userTasks = tasks.filter(t => userProjectIds.includes(t.project_id));
        const userProjects = projects.filter(p => userProjectIds.includes(p.id));

        const priorities = await claudeService.getPriorities(userTasks, userProjects, users);

        res.json({
            priorities: priorities,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Claude priorities error:', error);
        res.status(500).json({
            error: 'Failed to get priorities from Claude',
            details: error.message
        });
    }
});

// Check Claude service status
app.get('/api/claude/status', requireAuth, (req, res) => {
    const stats = claudeService.getStats();
    res.json(stats);
});

// Parse natural language task creation request
app.post('/api/claude/parse-task', requireAuth, async (req, res) => {
    try {
        const { input } = req.body;

        if (!input) {
            return res.status(400).json({ error: 'Task input is required' });
        }

        // Validate input length
        if (!validateString(input, 1, 500)) {
            return res.status(400).json({ error: 'Task input must be 1-500 characters' });
        }

        const userId = req.userId;

        // Get user's accessible projects and all users
        const projects = await dataService.getProjects();
        const users = await dataService.getUsers();

        const userProjectIds = [];
        for (const p of projects) {
            if (p.owner_id === userId || await isProjectMember(userId, p.id)) {
                userProjectIds.push(p.id);
            }
        }

        const userProjects = projects.filter(p => userProjectIds.includes(p.id));

        // Parse task using Claude
        const parsed = await claudeService.parseTaskRequest(input, userProjects, users);

        res.json(parsed);
    } catch (error) {
        console.error('Claude parse task error:', error);
        res.status(500).json({
            error: 'Failed to parse task request',
            details: error.message
        });
    }
});

// ==================== ADMIN INVITATION ROUTES ====================

// Send invitation
app.post('/api/admin/invitations', requireSuperAdmin, magicLinkLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        // Validate email
        if (!validateEmail(email) || !email) {
            return res.status(400).json({ error: 'Valid email is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user already exists
        const existingUser = await dataService.getUserByEmail(normalizedEmail);
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        // Check if invitation already exists
        let invitation = await dataService.getInvitationByEmail(normalizedEmail);

        if (!invitation) {
            // Create new invitation
            invitation = {
                id: generateId('inv'),
                email: normalizedEmail,
                invited_by_user_id: req.user.id,
                invited_at: new Date().toISOString(),
                magic_link_sent_at: new Date().toISOString(),
                status: 'pending'
            };
            await dataService.createInvitation(invitation);
        } else {
            // Update existing invitation
            await dataService.updateInvitation(normalizedEmail, {
                magic_link_sent_at: new Date().toISOString(),
                status: 'pending' // Reset to pending if was expired
            });
        }

        // Send magic link via Supabase
        if (!supabaseService.isEnabled()) {
            return res.status(501).json({
                error: 'Supabase is not configured. Magic links require Supabase authentication.'
            });
        }

        const redirectTo = `${process.env.ALLOWED_ORIGINS?.split(',')[0]}/profile-setup.html`;
        await supabaseService.sendMagicLink(normalizedEmail, redirectTo);

        await logActivity(req.user.id, 'invitation_sent', `Invitation sent to ${normalizedEmail}`);

        res.json({
            message: 'Invitation sent successfully',
            email: normalizedEmail
        });

    } catch (error) {
        console.error('Send invitation error:', error);
        res.status(500).json({
            error: 'Failed to send invitation',
            details: error.message
        });
    }
});

// Get all invitations
app.get('/api/admin/invitations', requireSuperAdmin, async (req, res) => {
    try {
        const invitations = await dataService.getInvitations();
        res.json({ invitations });
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ error: 'Failed to fetch invitations' });
    }
});

// Resend invitation
app.post('/api/admin/invitations/:email/resend', requireSuperAdmin, magicLinkLimiter, async (req, res) => {
    try {
        const email = req.params.email.toLowerCase().trim();

        const invitation = await dataService.getInvitationByEmail(email);
        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        if (invitation.status === 'accepted') {
            return res.status(400).json({ error: 'User has already accepted this invitation' });
        }

        // Check if user exists (shouldn't if invitation is pending)
        const existingUser = await dataService.getUserByEmail(email);
        if (existingUser) {
            // Auto-mark as accepted
            await dataService.updateInvitation(email, {
                status: 'accepted',
                joined_at: existingUser.created_at,
                joined_user_id: existingUser.id
            });
            return res.status(400).json({ error: 'User has already registered' });
        }

        // Send magic link
        if (!supabaseService.isEnabled()) {
            return res.status(501).json({ error: 'Supabase not configured' });
        }

        const redirectTo = `${process.env.ALLOWED_ORIGINS?.split(',')[0]}/profile-setup.html`;
        await supabaseService.sendMagicLink(email, redirectTo);

        // Update invitation
        await dataService.updateInvitation(email, {
            magic_link_sent_at: new Date().toISOString(),
            status: 'pending'
        });

        await logActivity(req.user.id, 'invitation_resent', `Invitation resent to ${email}`);

        res.json({ message: 'Invitation resent successfully' });

    } catch (error) {
        console.error('Resend invitation error:', error);
        res.status(500).json({ error: 'Failed to resend invitation' });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    // Serve main app (it will redirect to login if not authenticated)
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Claude service (only if API key is configured)
if (process.env.ANTHROPIC_API_KEY) {
    claudeService.start();

    claudeService.on('ready', () => {
        console.log('🤖 Claude AI assistant is ready to help with your tasks!\n');
    });

    claudeService.on('error', (error) => {
        console.error('❌ Claude service error:', error);
    });
} else {
    console.log('⚠️  Claude AI not configured. Claude features will be disabled.');
    console.log('   Add ANTHROPIC_API_KEY to .env to enable AI features.\n');
}

// Global Error Handler - must be defined after all routes
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Task Manager server running on http://localhost:${PORT}`);
    console.log(`\n📝 Access the app:`);
    console.log(`   Main app: http://localhost:${PORT}/`);
    console.log(`   Login page: http://localhost:${PORT}/login.html`);
    console.log(`\n🔑 Default credentials:`);
    console.log(`   Username: admin`);
    console.log(`   Password: admin123`);
    console.log(`\n🤖 Claude AI endpoints:`);
    console.log(`   POST /api/claude/ask - Ask Claude anything`);
    console.log(`   GET  /api/claude/summary - Get task summary`);
    console.log(`   GET  /api/claude/priorities - Get priority suggestions\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    if (process.env.ANTHROPIC_API_KEY) {
        claudeService.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    if (process.env.ANTHROPIC_API_KEY) {
        claudeService.stop();
    }
    process.exit(0);
});
