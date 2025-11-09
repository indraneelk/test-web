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

const app = express();
const PORT = process.env.PORT || 5001;

// CORS Configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5001', 'http://127.0.0.1:5001'];

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
const generateId = (prefix = 'id') => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

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

// Validation helpers
const validateString = (str, minLength = 1, maxLength = 500) => {
    if (typeof str !== 'string') return false;
    const trimmed = str.trim();
    return trimmed.length >= minLength && trimmed.length <= maxLength;
};

const validateEmail = (email) => {
    if (!email) return true; // Email is optional
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const validateUsername = (username) => {
    if (typeof username !== 'string') return false;
    const trimmed = username.trim();
    // Username: 3-30 chars, alphanumeric and underscores only
    return /^[a-zA-Z0-9_]{3,30}$/.test(trimmed);
};

const validatePassword = (password) => {
    if (typeof password !== 'string') return false;
    // Password: at least 8 characters with complexity requirements
    if (password.length < 8) return false;

    // Require at least 3 of: uppercase, lowercase, numbers, special chars
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const complexityCount = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar].filter(Boolean).length;
    return complexityCount >= 3;
};

const sanitizeString = (str) => {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, 1000); // Limit length and trim
};

// Rate Limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
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
    // Try Discord User ID first (from Discord bot)
    const discordUserId = req.headers['x-discord-user-id'];
    if (discordUserId) {
        try {
            const user = await dataService.getUserByDiscordId(discordUserId);
            if (user) {
                req.userId = user.id;
                req.user = user;
                return next();
            } else {
                return res.status(403).json({
                    error: 'Discord account not linked. Please link your Discord account on the website.'
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
// Helper to pick a stable random color for personal projects
function pickRandomProjectColor() {
    const colors = ['#f06a6a', '#ffc82c', '#13ce66', '#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b'];
    return colors[Math.floor(Math.random() * colors.length)];
}

app.post('/api/projects', requireAuth, async (req, res) => {
    try {
        const { name, description, color, members } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({ error: 'Project name is required' });
        }

        // Validate project name
        if (!validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Project name must be 1-100 characters' });
        }

        // Validate description if provided
        if (description && !validateString(description, 0, 1000)) {
            return res.status(400).json({ error: 'Description must be less than 1000 characters' });
        }

        // Validate color if provided
        let projectColor = '#f06a6a';
        if (typeof color === 'string' && color.trim() !== '') {
            const hex = color.trim();
            const isValidHex = /^#([0-9A-Fa-f]{6})$/.test(hex);
            if (!isValidHex) {
                return res.status(400).json({ error: 'Invalid color. Use 6-digit hex like #f06a6a' });
            }
            projectColor = hex.toLowerCase();
        }

        // Validate members if provided
        let projectMembers = [];
        if (Array.isArray(members)) {
            // Verify all member IDs exist and are valid users
            const allUsers = await dataService.getUsers();
            for (const memberId of members) {
                if (!allUsers.find(u => u.id === memberId)) {
                    return res.status(400).json({ error: `Invalid member ID: ${memberId}` });
                }
            }
            projectMembers = members;
        }

        const projects = await dataService.getProjects();

        // Check for duplicate name
        if (projects.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase())) {
            return res.status(400).json({ error: 'Project name already exists' });
        }

        const newProject = {
            id: generateId('project'),
            name: sanitizeString(name),
            description: description ? sanitizeString(description) : '',
            color: projectColor,
            is_personal: 0,
            owner_id: req.userId,
            members: projectMembers,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await dataService.createProject(newProject);

        await logActivity(req.userId, 'project_created', `Project "${newProject.name}" created`, null, newProject.id);

        res.status(201).json(newProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// Update project
app.put('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user is owner or admin
        const user = await dataService.getUserById(req.userId);
        const isOwner = await isProjectOwner(req.userId, req.params.id);
        if (!isOwner && !user?.is_admin) {
            return res.status(403).json({ error: 'Only project owner or admin can update project' });
        }

        const { name, description, color } = req.body;

        // Validate name if provided
        if (project.is_personal) {
            return res.status(403).json({ error: 'Personal projects cannot be edited' });
        }

        // Validate name if provided
        if (name !== undefined && !validateString(name, 1, 100)) {
            return res.status(400).json({ error: 'Project name must be 1-100 characters' });
        }

        // Validate description if provided
        if (description !== undefined && description !== null && !validateString(description, 0, 1000)) {
            return res.status(400).json({ error: 'Description must be less than 1000 characters' });
        }

        // Validate color if provided
        let updateColor = project.color || '#f06a6a';
        if (color !== undefined && color !== null) {
            const hex = String(color).trim();
            const isValidHex = /^#([0-9A-Fa-f]{6})$/.test(hex);
            if (!isValidHex) {
                return res.status(400).json({ error: 'Invalid color. Use 6-digit hex like #f06a6a' });
            }
            updateColor = hex.toLowerCase();
        }

        const updates = {
            name: name ? sanitizeString(name) : project.name,
            description: description !== undefined ? sanitizeString(description || '') : project.description,
            color: updateColor
        };

        const updatedProject = await dataService.updateProject(req.params.id, updates);

        await logActivity(req.userId, 'project_updated', `Project "${updatedProject.name}" updated`, null, req.params.id);

        res.json(updatedProject);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// Delete project
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const project = await dataService.getProjectById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if user is owner or admin
        const user = await dataService.getUserById(req.userId);
        const isOwner = await isProjectOwner(req.userId, req.params.id);
        if (!isOwner && !user?.is_admin) {
            return res.status(403).json({ error: 'Only project owner or admin can delete project' });
        }

        // Prevent deletion of personal projects (except by admin)
        if (project.is_personal && !user?.is_admin) {
            return res.status(403).json({ error: 'Cannot delete personal project' });
        }

        await dataService.deleteProject(req.params.id);

        await logActivity(req.userId, 'project_deleted', `Project "${project.name}" deleted`, null, req.params.id);

        res.json({ message: 'Project deleted successfully', project: project });
    } catch (error) {
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
        const { name, description, date, project_id, assigned_to_id, priority } = req.body;

        // Validate required fields (assigned_to_id and description are optional)
        if (!name || !date || !project_id) {
            return res.status(400).json({
                error: 'Missing required fields: name, date, project_id'
            });
        }

        // Validate task name
        if (!validateString(name, 1, 200)) {
            return res.status(400).json({ error: 'Task name must be 1-200 characters' });
        }

        // Validate description (optional)
        if (!validateString(description, 0, 2000)) {
            return res.status(400).json({ error: 'Description must be less than 2000 characters' });
        }

        // Validate date format
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Validate priority
        const validPriorities = ['none', 'low', 'medium', 'high'];
        if (priority && !validPriorities.includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority. Must be: none, low, medium, or high' });
        }

        // Check if user is member of the project
        if (!(await isProjectMember(req.userId, project_id))) {
            return res.status(403).json({ error: 'You are not a member of this project' });
        }

        // Check if assigned user is member of the project (only if assignee is provided)
        if (assigned_to_id && assigned_to_id.trim() !== '' && !(await isProjectMember(assigned_to_id, project_id))) {
            return res.status(400).json({ error: 'Assigned user is not a member of this project' });
        }

        const newTask = {
            id: generateId('task'),
            name: sanitizeString(name),
            description: sanitizeString(description),
            date: date,
            project_id: project_id,
            assigned_to_id: (assigned_to_id && assigned_to_id.trim() !== '') ? assigned_to_id : null,
            created_by_id: req.userId,
            status: 'pending',
            priority: priority || 'none',
            archived: false,
            completed_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await dataService.createTask(newTask);

        await logActivity(req.userId, 'task_created', `Task "${newTask.name}" created`, newTask.id, project_id);

        res.status(201).json(newTask);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update task
app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const task = await dataService.getTaskById(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user is member of the project
        if (!(await isProjectMember(req.userId, task.project_id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { name, description, date, assigned_to_id, status, priority, project_id } = req.body;

        // Validate name if provided
        if (name !== undefined && !validateString(name, 1, 200)) {
            return res.status(400).json({ error: 'Task name must be 1-200 characters' });
        }

        // Validate description if provided
        if (description !== undefined && !validateString(description, 0, 2000)) {
            return res.status(400).json({ error: 'Description must be less than 2000 characters' });
        }

        // Validate date if provided
        if (date !== undefined) {
            const dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) {
                return res.status(400).json({ error: 'Invalid date format' });
            }
        }

        // Validate status if provided (for checkbox completion)
        const validStatuses = ['pending', 'in-progress', 'completed'];
        if (status !== undefined && !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be: pending, in-progress, or completed' });
        }

        // Validate priority if provided
        const validPriorities = ['none', 'low', 'medium', 'high'];
        if (priority !== undefined && !validPriorities.includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority. Must be: none, low, medium, or high' });
        }

        // If changing assignee, verify they're in the correct project (old or new if provided)
        const targetProjectId = project_id && project_id !== task.project_id ? project_id : task.project_id;
        if (assigned_to_id && assigned_to_id.trim() !== '' && !(await isProjectMember(assigned_to_id, targetProjectId))) {
            return res.status(400).json({ error: 'Assigned user is not a member of the target project' });
        }

        // If changing project, verify requester can access target project
        if (project_id && project_id !== task.project_id) {
            if (!(await isProjectMember(req.userId, project_id))) {
                return res.status(403).json({ error: 'Access denied to target project' });
            }
            // If assignee unchanged, verify current assignee can belong to new project
            if ((!assigned_to_id || assigned_to_id.trim() === '') && task.assigned_to_id) {
                if (!(await isProjectMember(task.assigned_to_id, project_id))) {
                    return res.status(400).json({ error: 'Current assignee is not a member of the target project' });
                }
            }
        }

        const oldStatus = task.status;
        const newStatus = status !== undefined ? status : task.status;

        const updates = {
            name: name ? sanitizeString(name) : task.name,
            description: description !== undefined ? sanitizeString(description) : task.description,
            date: date || task.date,
            assigned_to_id: assigned_to_id !== undefined ? ((assigned_to_id && assigned_to_id.trim() !== '') ? assigned_to_id : null) : task.assigned_to_id,
            status: newStatus,
            priority: priority !== undefined ? priority : (task.priority || 'none'),
            completed_at: (oldStatus !== 'completed' && newStatus === 'completed') ? new Date().toISOString() : task.completed_at,
            archived: task.archived !== undefined ? task.archived : false
        };
        if (project_id && project_id !== task.project_id) {
            updates.project_id = project_id;
        }

        const updatedTask = await dataService.updateTask(req.params.id, updates);

        await logActivity(req.userId, 'task_updated', `Task "${updatedTask.name}" updated`, req.params.id, updatedTask.project_id);

        // Return status change info for celebration
        res.json({
            ...updatedTask,
            _statusChanged: oldStatus !== updatedTask.status,
            _wasCompleted: oldStatus !== 'completed' && updatedTask.status === 'completed'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Delete task
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
        const task = await dataService.getTaskById(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Check if user is member of the project
        if (!(await isProjectMember(req.userId, task.project_id))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await dataService.deleteTask(req.params.id);

        await logActivity(req.userId, 'task_deleted', `Task "${task.name}" deleted`, req.params.id, task.project_id);

        res.json({ message: 'Task deleted successfully', task: task });
    } catch (error) {
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
    // Serve authenticated app (it will redirect to login if not authenticated)
    res.sendFile(path.join(__dirname, 'public', 'app-auth.html'));
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
