// Cloudflare Worker for Team Task Manager
// Uses D1 Database, Supabase Auth, and JWT-based authentication

import { jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';

// Shared modules
const { generateId, getCurrentTimestamp, sanitizeString, generateDiscordLinkCode, isHexColor } = require('./shared/helpers');
const { validateString, validateEmail, validateUsername, validatePassword, validatePriority, validateStatus } = require('./shared/validators');
const businessLogic = require('./shared/business-logic');
const { ValidationError, AuthenticationError, PermissionError, NotFoundError, ConflictError } = require('./shared/errors');
const { verifyDiscordRequest, getHeadersFromWorkersRequest } = require('./shared/discord-auth');

// Discord Interactions modules
const {
    InteractionType,
    InteractionResponseType,
    verifyDiscordRequest: verifyDiscordInteraction,
    createResponse,
    getOption
} = require('./shared/discord-interactions');

// Discord command handlers
const {
    handleTasksCommand,
    handleCreateCommand,
    handleCompleteCommand,
    handleSummaryCommand,
    handlePrioritiesCommand,
    handleClaudeCommand,
    handleLinkCommand,
    handleHelpCommand
} = require('./shared/discord-commands');

// ==================== HELPER FUNCTIONS ====================

// Basic rate limiting (KV optional; in-memory fallback)
const memoryBuckets = new Map();
async function rateLimit(request, env, key, windowSec = 900, max = 5) {
    try {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const bucketKey = `rl:${key}:${ip}`;
        const now = Math.floor(Date.now() / 1000);
        const windowStart = now - (now % windowSec);
        const storageKey = `${bucketKey}:${windowStart}`;

        // KV if available
        if (env.RL_KV && typeof env.RL_KV.get === 'function') {
            const current = parseInt((await env.RL_KV.get(storageKey)) || '0', 10);
            if (current >= max) return false;
            await env.RL_KV.put(storageKey, String(current + 1), { expirationTtl: windowSec + 5 });
            return true;
        }

        // In-memory fallback (best-effort)
        const entry = memoryBuckets.get(storageKey) || { count: 0, exp: windowStart + windowSec };
        if (entry.count >= max) return false;
        entry.count += 1;
        memoryBuckets.set(storageKey, entry);
        // Cleanup old buckets opportunistically
        for (const [k, v] of memoryBuckets) {
            if (v.exp < now) memoryBuckets.delete(k);
        }
        return true;
    } catch {
        return true; // fail-open to avoid blocking legit traffic on errors
    }
}

// JWT Helper Functions
async function createJWT(payload, secret, expiresIn = '24h') {
    const secretKey = new TextEncoder().encode(secret);
    const jwt = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(secretKey);
    return jwt;
}

async function verifyJWT(token, secret) {
    try {
        const secretKey = new TextEncoder().encode(secret);
        const { payload } = await jwtVerify(token, secretKey, {
            algorithms: ['HS256']
        });
        return payload;
    } catch (error) {
        return null;
    }
}

async function verifySupabaseJWT(token, env) {
    const supabaseUrl = env.SUPABASE_URL;
    if (!supabaseUrl) return null;
    const expectedIss = new URL('/auth/v1', supabaseUrl).toString();
    try {
        const jwks = createRemoteJWKSet(new URL('/auth/v1/jwks', supabaseUrl));
        const { payload } = await jwtVerify(token, jwks, { algorithms: ['RS256'] });
        if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('Token expired');
        if (payload.iss && payload.iss !== expectedIss) throw new Error('Invalid issuer');
        if (payload.aud && payload.aud !== 'authenticated') throw new Error('Invalid audience');
        return payload;
    } catch (e) {
        if (env.SUPABASE_JWT_SECRET) {
            try {
                const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
                const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
                if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('Token expired');
                if (payload.iss && payload.iss !== expectedIss) throw new Error('Invalid issuer');
                if (payload.aud && payload.aud !== 'authenticated') throw new Error('Invalid audience');
                return payload;
            } catch (err) {
                console.error('HS256 verification failed:', err);
                return null;
            }
        }
        console.error('RS256 verification failed:', e);
        return null;
    }
}

// Cookie helpers
function getCookie(request, name) {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const cookie of cookies) {
        const [key, value] = cookie.split('=');
        if (key === name) return decodeURIComponent(value);
    }
    return null;
}

function setCookie(name, value, options = {}) {
    const { maxAge = 86400, httpOnly = true, secure = true, sameSite = 'Lax', path = '/' } = options;

    let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`;
    if (httpOnly) cookie += '; HttpOnly';
    if (secure) cookie += '; Secure';

    return cookie;
}

function clearCookie(name) {
    return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

async function createAuthCookie(userId, env) {
    const token = await createJWT({ userId }, env.SESSION_SECRET || 'fallback-secret', '24h');
    return setCookie('auth_token', token, { maxAge: 86400 });
}

// Plan B: Supabase Realtime Broadcast Helper
async function broadcastChange(env, eventType, payload) {
    try {
        // Use Supabase REST API to send broadcast to 'task-updates' channel
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/broadcast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                messages: [{
                    topic: 'task-updates',
                    event: eventType,
                    payload
                }]
            })
        });

        if (!response.ok) {
            console.error('Broadcast failed:', await response.text());
        }
    } catch (error) {
        console.error('Broadcast error:', error);
    }
}

// ==================== DATABASE HELPERS ====================

async function logActivity(db, userId, action, details, taskId = null, projectId = null) {
    try {
        await db.prepare(
            'INSERT INTO activity_log (id, user_id, task_id, project_id, action, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
            generateId('activity'),
            userId,
            taskId,
            projectId,
            action,
            details,
            getCurrentTimestamp()
        ).run();
        // Simple retention: occasionally prune entries older than 90 days
        if (Math.random() < 0.05) {
            await db.prepare("DELETE FROM activity_log WHERE timestamp < datetime('now','-90 days')").run();
        }
    } catch (error) {
        console.error('Failed to log activity:', error);
    }
}

async function getUserById(db, userId) {
    return await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
}

async function getUserByEmail(db, email) {
    return await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

async function getUserByDiscordId(db, discordUserId) {
    return await db.prepare('SELECT * FROM users WHERE discord_user_id = ?').bind(discordUserId).first();
}

// Removed getUserBySupabaseId: we standardize on id = Supabase sub

async function getProjectById(db, projectId) {
    return await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
}

async function isProjectMember(db, userId, projectId) {
    const project = await getProjectById(db, projectId);
    if (!project) return false;
    if (project.owner_id === userId) return true;
    const row = await db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
        .bind(projectId, userId).first();
    return !!row;
}

async function isProjectOwner(db, userId, projectId) {
    const project = await getProjectById(db, projectId);
    return project && project.owner_id === userId;
}

// Create dataService wrapper for business logic
function createDataService(db) {
    return {
        getTaskById: async (taskId) => {
            return await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
        },
        createTask: async (task) => {
            await db.prepare(
                'INSERT INTO tasks (id, name, description, date, project_id, assigned_to_id, created_by_id, status, priority, archived, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(
                task.id,
                task.name,
                task.description,
                task.date,
                task.project_id,
                task.assigned_to_id,
                task.created_by_id,
                task.status,
                task.priority,
                task.archived ? 1 : 0,
                task.completed_at,
                task.created_at,
                task.updated_at
            ).run();
        },
        updateTask: async (taskId, updates) => {
            const fields = [];
            const values = [];
            for (const [key, value] of Object.entries(updates)) {
                if (key === 'archived') {
                    fields.push(`${key} = ?`);
                    values.push(value ? 1 : 0);
                } else {
                    fields.push(`${key} = ?`);
                    values.push(value);
                }
            }
            values.push(taskId);
            await db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        },
        deleteTask: async (taskId) => {
            await db.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
        },
        getProjectById: async (projectId) => {
            return await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
        },
        createProject: async (project) => {
            await db.prepare(
                'INSERT INTO projects (id, name, description, color, owner_id, is_personal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(
                project.id,
                project.name,
                project.description,
                project.color,
                project.owner_id,
                project.is_personal ? 1 : 0,
                project.created_at,
                project.updated_at
            ).run();

            // Add members if provided
            if (Array.isArray(project.members) && project.members.length > 0) {
                for (const memberId of project.members) {
                    await db.prepare(
                        'INSERT INTO project_members (project_id, user_id, added_at) VALUES (?, ?, ?)'
                    ).bind(project.id, memberId, project.created_at).run();
                }
            }
        },
        updateProject: async (projectId, updates) => {
            const fields = [];
            const values = [];
            for (const [key, value] of Object.entries(updates)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
            values.push(projectId);
            await db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        },
        deleteProject: async (projectId) => {
            // Delete associated tasks and members first
            await db.prepare('DELETE FROM tasks WHERE project_id = ?').bind(projectId).run();
            await db.prepare('DELETE FROM project_members WHERE project_id = ?').bind(projectId).run();
            await db.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();
        },
        getProjectMembers: async (projectId) => {
            const { results } = await db.prepare('SELECT user_id FROM project_members WHERE project_id = ?')
                .bind(projectId).all();
            return results.map(r => ({ id: r.user_id, user_id: r.user_id }));
        },
        addProjectMember: async (projectId, userId) => {
            await db.prepare('INSERT INTO project_members (project_id, user_id, added_at) VALUES (?, ?, ?)')
                .bind(projectId, userId, getCurrentTimestamp()).run();
        }
    };
}

// ==================== AUTHENTICATION MIDDLEWARE ====================

async function authenticate(request, env) {
    console.log('=== AUTHENTICATE DEBUG ===');
    console.log('Request URL:', request.url);
    console.log('Cookie header:', request.headers.get('Cookie'));
    console.log('Authorization header:', request.headers.get('Authorization') ? 'present' : 'none');

    // Try Discord User ID first (from Discord bot) with HMAC signature verification
    const discordUserId = request.headers.get('X-Discord-User-ID');
    if (discordUserId) {
        console.log('Discord auth path');
        // Verify HMAC signature to prevent impersonation attacks
        const headers = getHeadersFromWorkersRequest(request);
        const secret = env.DISCORD_BOT_SECRET;
        const verifiedUserId = verifyDiscordRequest(headers, secret);

        if (!verifiedUserId) {
            // Invalid signature or missing headers - reject immediately
            console.log('Discord authentication failed: Invalid signature');
            return null;
        }

        const user = await getUserByDiscordId(env.DB, verifiedUserId);
        if (user) {
            console.log('Discord auth success, user:', user.id);
            return user;
        }
        // If Discord ID provided but not found, return null (will trigger 401)
        return null;
    }

    // Try Authorization: Bearer <access_token> (stateless)
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
        console.log('Bearer token auth path');
        const token = auth.slice(7);
        const claims = await verifySupabaseJWT(token, env);
        console.log('JWT claims:', claims ? 'valid' : 'invalid');
        if (claims && claims.sub) {
            const user = await getUserById(env.DB, claims.sub);
            if (user) {
                console.log('Bearer auth success, user:', user.id);
                return user;
            } else {
                console.log('Bearer token valid but user not found:', claims.sub);
            }
        }
    }

    // Fallback to cookie session (if present)
    const token = getCookie(request, 'auth_token');
    console.log('Cookie token:', token ? 'present' : 'none');
    if (token && env.SESSION_SECRET) {
        console.log('Cookie auth path');
        const payload = await verifyJWT(token, env.SESSION_SECRET);
        console.log('Cookie payload:', payload ? 'valid' : 'invalid');
        if (payload && payload.userId) {
            const user = await getUserById(env.DB, payload.userId);
            if (user) {
                console.log('Cookie auth success, user:', user.id);
                return user;
            } else {
                console.log('Cookie valid but user not found:', payload.userId);
            }
        }
    }

    console.log('All auth methods failed');
    return null;
}

// Super admin check - only for indraneel.kasmalkar@gmail.com
async function requireSuperAdmin(request, env) {
    const user = await authenticate(request, env);
    if (!user || !user.email || user.email.toLowerCase() !== 'indraneel.kasmalkar@gmail.com') {
        return null;
    }
    return user;
}

// ==================== API RESPONSE HELPERS ====================

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = [
        'http://localhost:5001',
        'http://127.0.0.1:5001',
        'https://mmw-tm.pages.dev',
        'https://team-task-manager.moovmyway.workers.dev'
    ];

    const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[2];

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
        'Access-Control-Allow-Credentials': 'true'
    };
}

function jsonResponse(data, status = 200, headers = {}, request = null) {
    const corsHeaders = request ? getCorsHeaders(request) : {
        'Access-Control-Allow-Origin': 'https://mmw-tm.pages.dev',
        'Access-Control-Allow-Credentials': 'true'
    };
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers }
    });
}

function errorResponse(error, status = 400) {
    return jsonResponse({ error }, status);
}

// ==================== ROUTE HANDLERS ====================

// Auth Handlers
async function handleSupabaseLogin(request, env) {
    try {
        // Rate limit: 5 per 15m per IP
        const allowed = await rateLimit(request, env, 'supabase-login', 900, 5);
        if (!allowed) return errorResponse('Too many login attempts. Please try again later.', 429);
        const body = await request.json();
        const { access_token } = body;

        if (!access_token) {
            return errorResponse('Access token required', 400);
        }

        // Verify Supabase JWT
        const payload = await verifySupabaseJWT(access_token, env);
        if (!payload) {
            return errorResponse('Invalid token', 401);
        }

        const { sub, email } = payload;
        // Find or create user by id=sub
        let user = await getUserById(env.DB, sub);
        if (!user) {
            const now = getCurrentTimestamp();
            const name = email ? email.split('@')[0] : 'User';
            const initials = name.substring(0, 2).toUpperCase();
            const username = name.toLowerCase();
            // Satisfy NOT NULL password_hash with a placeholder
            await env.DB.prepare(
                'INSERT INTO users (id, username, password_hash, name, email, initials, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(sub, username, 'supabase', name, email || null, initials, 0, now, now).run();
            user = await getUserById(env.DB, sub);

            // Check if this email was invited and mark invitation as accepted
            if (email) {
                const invitation = await env.DB.prepare(
                    'SELECT * FROM invitations WHERE email = ? AND status = ?'
                ).bind(email, 'pending').first();

                if (invitation) {
                    await env.DB.prepare(
                        'UPDATE invitations SET status = ?, joined_at = ?, joined_user_id = ? WHERE email = ?'
                    ).bind('accepted', now, sub, email).run();
                }
            }
        }
        const { password_hash, ...userWithoutPassword } = user;

        // Create auth cookie for session management
        const cookie = await createAuthCookie(user.id, env);
        return jsonResponse({ user: userWithoutPassword }, 200, { 'Set-Cookie': cookie }, request);
    } catch (error) {
        console.error('Supabase login error');
        return errorResponse('Login failed', 500);
    }
}

async function handleSupabaseCallback(request, env) {
    try {
        // Rate limit: 10 per 15m per IP
        const allowed = await rateLimit(request, env, 'supabase-callback', 900, 10);
        if (!allowed) return errorResponse('Too many authentication attempts. Please try again later.', 429);
        const body = await request.json();
        const { access_token } = body;

        if (!access_token) {
            return errorResponse('Access token required', 400);
        }

        const payload = await verifySupabaseJWT(access_token, env);
        if (!payload) {
            return errorResponse('Invalid token', 401);
        }

        const { sub, email, user_metadata } = payload;
        let user = await getUserById(env.DB, sub);

        if (!user) {
            // New user - needs profile setup
            return jsonResponse({
                needsProfileSetup: true,
                supabaseUser: {
                    id: sub,
                    email,
                    name: user_metadata?.name || email?.split('@')[0] || 'User'
                },
                access_token // Send back the token for profile setup
            });
        }

        const { password_hash, ...userWithoutPassword } = user;

        // Create auth cookie for session management
        const cookie = await createAuthCookie(user.id, env);
        return jsonResponse({ user: userWithoutPassword }, 200, { 'Set-Cookie': cookie }, request);
    } catch (error) {
        console.error('Supabase callback error');
        return errorResponse('Authentication failed', 500);
    }
}

async function handleProfileSetup(request, env) {
    try {
        const body = await request.json();
        const { access_token, username, name } = body;

        if (!access_token || !username || !name) {
            return errorResponse('Access token, username, and name are required', 400);
        }

        // Verify the Supabase token
        const payload = await verifySupabaseJWT(access_token, env);
        if (!payload) {
            return errorResponse('Invalid token', 401);
        }

        const { sub, email } = payload;

        // Check if user already exists
        const existingUser = await getUserById(env.DB, sub);
        if (existingUser) {
            return errorResponse('User already exists', 400);
        }

        // Create the user
        const now = getCurrentTimestamp();
        const initials = name.substring(0, 2).toUpperCase();
        await env.DB.prepare(
            'INSERT INTO users (id, username, password_hash, name, email, initials, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(sub, username.toLowerCase(), 'supabase', name, email || null, initials, 0, now, now).run();

        const user = await getUserById(env.DB, sub);
        await logActivity(env.DB, sub, 'user_created', `User ${name} created via profile setup`);

        // Check if this email was invited and mark invitation as accepted
        if (email) {
            const invitation = await env.DB.prepare(
                'SELECT * FROM invitations WHERE email = ? AND status = ?'
            ).bind(email, 'pending').first();

            if (invitation) {
                await env.DB.prepare(
                    'UPDATE invitations SET status = ?, joined_at = ?, joined_user_id = ? WHERE email = ?'
                ).bind('accepted', now, sub, email).run();
            }
        }

        // Create personal project for new user
        const personalProjectId = generateId('project');
        const personalProjectName = `${username}-Personal`;
        await env.DB.prepare(
            'INSERT INTO projects (id, name, description, color, owner_id, is_personal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(personalProjectId, personalProjectName, 'Personal tasks and notes', '#667eea', sub, 1, now, now).run();

        // Add user as member of their personal project
        await env.DB.prepare(
            'INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
        ).bind(personalProjectId, sub, 'owner', now).run();

        await logActivity(env.DB, sub, 'project_created', 'Personal project created', null, personalProjectId);

        const { password_hash, ...userWithoutPassword } = user;

        // Create auth cookie for session management
        const cookie = await createAuthCookie(user.id, env);
        return jsonResponse({ user: userWithoutPassword }, 200, { 'Set-Cookie': cookie }, request);
    } catch (error) {
        console.error('Profile setup error:', error);
        return errorResponse('Failed to complete profile setup', 500);
    }
}

async function handleLogout(request, env) {
    const user = await authenticate(request, env);
    if (user) {
        await logActivity(env.DB, user.id, 'user_logout', 'User logged out');
    }

    return jsonResponse({ message: 'Logged out successfully' }, 200, {
        'Set-Cookie': clearCookie('auth_token')
    });
}

async function handleGetMe(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const { password_hash, ...userWithoutPassword } = user;
    return jsonResponse({ user: userWithoutPassword });
}

async function handleUpdateMe(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const body = await request.json();
        const { name, initials, username, color } = body;

        const updates = [];
        const values = [];

        if (name) {
            updates.push('name = ?');
            values.push(name.trim());
        }
        if (initials) {
            updates.push('initials = ?');
            values.push(initials.trim().substring(0, 2).toUpperCase());
        }
        if (typeof username === 'string' && username.trim().length > 0) {
            // Ensure username is unique
            const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(username.trim(), user.id).first();
            if (existing) {
                return errorResponse('Username is already taken', 400);
            }
            updates.push('username = ?');
            values.push(username.trim());
        }
        if (typeof color === 'string' && color.trim().length > 0) {
            updates.push('color = ?');
            values.push(color.trim());
        }

        if (updates.length === 0) {
            return errorResponse('No valid fields to update', 400);
        }

        updates.push('updated_at = ?');
        values.push(getCurrentTimestamp());
        values.push(user.id);

        await env.DB.prepare(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();

        await logActivity(env.DB, user.id, 'user_profile_updated', 'User profile updated');

        const updatedUser = await getUserById(env.DB, user.id);
        const { password_hash, ...userWithoutPassword } = updatedUser;

        return jsonResponse({ user: userWithoutPassword });
    } catch (error) {
        console.error('Update user error:', error);
        return errorResponse('Failed to update user', 500);
    }
}

// Config Handler
async function handleGetConfig(request, env) {
    return jsonResponse({
        supabaseUrl: env.SUPABASE_URL,
        supabaseAnonKey: env.SUPABASE_ANON_KEY
    });
}

// User Handlers
async function handleGetUsers(request, env) {
    try {
        const user = await authenticate(request, env);
        if (!user) {
            return errorResponse('Authentication required', 401);
        }

        const { results } = await env.DB.prepare(
            'SELECT id, username, name, email, initials, color, is_admin, created_at FROM users ORDER BY name ASC'
        ).all();

        return jsonResponse(results || []);
    } catch (error) {
        console.error('Get users error:', error);
        return errorResponse('Failed to fetch users', 500);
    }
}

async function handleGetUser(request, env, userId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const targetUser = await getUserById(env.DB, userId);
    if (!targetUser) {
        return errorResponse('User not found', 404);
    }

    const { password_hash, ...userWithoutPassword } = targetUser;
    return jsonResponse(userWithoutPassword);
}

// Discord Handle Handlers
async function handleUpdateDiscordHandle(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const { discordHandle, discordUserId } = await request.json();

    if (!discordHandle || !discordUserId) {
        return errorResponse('Discord handle and user ID are required', 400);
    }

    // Validate Discord User ID format (17-19 digit number)
    if (!/^\d{17,19}$/.test(discordUserId)) {
        return errorResponse('Invalid Discord User ID format. Must be a 17-19 digit number.', 400);
    }

    // Validate Discord handle (alphanumeric, underscores, periods, 2-32 chars, optional discriminator)
    const handleWithoutDiscriminator = discordHandle.replace(/#\d{4}$/, '');
    if (!/^[a-zA-Z0-9_.]{2,32}$/.test(handleWithoutDiscriminator)) {
        return errorResponse('Invalid Discord handle format', 400);
    }

    // Check if Discord user ID is already taken by another user
    const { results } = await env.DB.prepare(
        'SELECT id FROM users WHERE discord_user_id = ? AND id != ?'
    ).bind(discordUserId, user.id).all();

    if (results.length > 0) {
        return errorResponse('This Discord account is already linked to another user', 400);
    }

    // Update user's Discord handle
    await env.DB.prepare(
        'UPDATE users SET discord_handle = ?, discord_user_id = ?, discord_verified = 1, updated_at = ? WHERE id = ?'
    ).bind(discordHandle, discordUserId, new Date().toISOString(), user.id).run();

    const updatedUser = await getUserById(env.DB, user.id);

    return jsonResponse({
        message: 'Discord handle updated successfully',
        user: {
            id: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email,
            discord_handle: updatedUser.discord_handle,
            discord_verified: updatedUser.discord_verified
        }
    });
}

async function handleGetDiscordHandle(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const currentUser = await getUserById(env.DB, user.id);

    if (!currentUser) {
        return errorResponse('User not found', 404);
    }

    return jsonResponse({
        discord_handle: currentUser.discord_handle || null,
        discord_user_id: currentUser.discord_user_id || null,
        discord_verified: currentUser.discord_verified || 0
    });
}

// Generate Discord link code
async function handleGenerateDiscordLinkCode(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    // Unlink existing Discord account first (for relink functionality)
    await env.DB.prepare('UPDATE users SET discord_handle = NULL, discord_user_id = NULL, discord_verified = 0 WHERE id = ?')
        .bind(user.id).run();

    // Delete ALL existing codes for this user (regardless of expiry)
    // This ensures regenerate always creates a fresh code
    await env.DB.prepare('DELETE FROM discord_link_codes WHERE user_id = ?')
        .bind(user.id).run();

    // Generate new code
    let code;
    let attempts = 0;
    while (attempts < 10) {
        code = generateDiscordLinkCode();
        const existingCode = await env.DB.prepare('SELECT id FROM discord_link_codes WHERE code = ?')
            .bind(code).first();
        if (!existingCode) break;
        attempts++;
    }

    if (attempts >= 10) {
        return errorResponse('Failed to generate unique code', 500);
    }

    // Code expires in 5 minutes
    const expiryTimestamp = Date.now() + (5 * 60 * 1000); // 5 minutes from now
    const expiresAt = new Date(expiryTimestamp).toISOString();
    const createdAt = getCurrentTimestamp();

    await env.DB.prepare(
        'INSERT INTO discord_link_codes (code, user_id, expires_at, created_at, used) VALUES (?, ?, ?, ?, 0)'
    ).bind(code, user.id, expiresAt, createdAt).run();

    return jsonResponse({
        code,
        expiresAt: expiryTimestamp // Return the actual expiry timestamp in ms
    });
}

// Check Discord link status
async function handleCheckDiscordLinkStatus(request, env, code) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const linkCode = await env.DB.prepare(
        'SELECT used, expires_at FROM discord_link_codes WHERE code = ? AND user_id = ?'
    ).bind(code, user.id).first();

    if (!linkCode) {
        return errorResponse('Code not found', 404);
    }

    const now = getCurrentTimestamp();
    if (linkCode.expires_at < now) {
        return jsonResponse({ status: 'expired' });
    }

    if (linkCode.used) {
        // Get updated user info
        const currentUser = await getUserById(env.DB, user.id);
        return jsonResponse({
            status: 'linked',
            discord_handle: currentUser.discord_handle,
            discord_user_id: currentUser.discord_user_id
        });
    }

    return jsonResponse({ status: 'pending' });
}

// Verify Discord link code (called by Discord bot)
async function handleVerifyDiscordLinkCode(request, env) {
    const { code, discordUserId, discordHandle } = await request.json();

    if (!code || !discordUserId || !discordHandle) {
        return errorResponse('Code, Discord User ID, and handle are required', 400);
    }

    // Validate Discord User ID format
    if (!/^\d{17,19}$/.test(discordUserId)) {
        return errorResponse('Invalid Discord User ID format', 400);
    }

    const now = getCurrentTimestamp();

    // Find the link code
    const linkCode = await env.DB.prepare(
        'SELECT id, user_id, expires_at, used FROM discord_link_codes WHERE code = ?'
    ).bind(code).first();

    if (!linkCode) {
        return errorResponse('Invalid code', 404);
    }

    if (linkCode.expires_at < now) {
        return errorResponse('Code expired', 400);
    }

    if (linkCode.used) {
        return errorResponse('Code already used', 400);
    }

    // Check if Discord ID is already linked to another user
    const existingUser = await getUserByDiscordId(env.DB, discordUserId);
    if (existingUser && existingUser.id !== linkCode.user_id) {
        return errorResponse('This Discord account is already linked to another user', 400);
    }

    // Mark code as used
    await env.DB.prepare('UPDATE discord_link_codes SET used = 1 WHERE id = ?')
        .bind(linkCode.id).run();

    // Update user with Discord info
    await env.DB.prepare(
        'UPDATE users SET discord_handle = ?, discord_user_id = ?, discord_verified = 1, updated_at = ? WHERE id = ?'
    ).bind(discordHandle, discordUserId, getCurrentTimestamp(), linkCode.user_id).run();

    return jsonResponse({
        success: true,
        message: 'Discord account linked successfully'
    });
}

// Discord Bot API Handlers (called from discord-worker)
// Discord /tasks command handler - DEPLOYED 2025-11-09
async function handleDiscordGetTasks(request, env) {
    try {
        console.log('[handleDiscordGetTasks] Starting...');
        const headers = getHeadersFromWorkersRequest(request);
        const discordUserId = verifyDiscordRequest(headers, env.DISCORD_BOT_SECRET);

        console.log('[handleDiscordGetTasks] Verified Discord User ID:', discordUserId);

        if (!discordUserId) {
            console.log('[handleDiscordGetTasks] No Discord User ID - unauthorized');
            return errorResponse('Unauthorized Discord request', 401);
        }

        // Get user by Discord ID
        const user = await getUserByDiscordId(env.DB, discordUserId);
        console.log('[handleDiscordGetTasks] Found user:', user ? { id: user.id, discord_handle: user.discord_handle } : null);

        if (!user) {
            console.log('[handleDiscordGetTasks] User not found for Discord ID:', discordUserId);
            return errorResponse('Discord account not linked. Use /link command first.', 404);
        }

        // Get tasks assigned to this user
        const tasks = await env.DB.prepare(
            'SELECT * FROM tasks WHERE assigned_to_id = ? AND archived = 0 ORDER BY created_at DESC'
        ).bind(user.id).all();

        console.log('[handleDiscordGetTasks] Retrieved tasks:', tasks.results ? tasks.results.length : 0);

        return jsonResponse({ data: tasks.results || [] });
    } catch (error) {
        console.error('[handleDiscordGetTasks] Error:', error);
        return errorResponse(`Internal server error: ${error.message}`, 500);
    }
}

async function handleDiscordCreateTask(request, env) {
    const headers = getHeadersFromWorkersRequest(request);
    const discordUserId = verifyDiscordRequest(headers, env.DISCORD_BOT_SECRET);

    if (!discordUserId) {
        return errorResponse('Unauthorized Discord request', 401);
    }

    // Get user by Discord ID
    const user = await getUserByDiscordId(env.DB, discordUserId);
    if (!user) {
        return errorResponse('Discord account not linked. Use /link command first.', 404);
    }

    const { name, date, priority } = await request.json();

    if (!name || !date) {
        return errorResponse('Task name and date are required', 400);
    }

    // Get user's personal project
    const personalProject = await env.DB.prepare(
        'SELECT id FROM projects WHERE owner_id = ? AND is_personal = 1'
    ).bind(user.id).first();

    if (!personalProject) {
        return errorResponse('Personal project not found', 404);
    }

    const taskId = generateId('task');
    const now = getCurrentTimestamp();

    await env.DB.prepare(
        'INSERT INTO tasks (id, name, description, status, priority, date, created_by_id, assigned_to_id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(taskId, name, '', 'pending', priority || 'none', date, user.id, user.id, personalProject.id, now, now).run();

    const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
    return jsonResponse({ data: task });
}

async function handleDiscordCompleteTask(request, env, taskIdentifier) {
    const headers = getHeadersFromWorkersRequest(request);
    const discordUserId = verifyDiscordRequest(headers, env.DISCORD_BOT_SECRET);

    if (!discordUserId) {
        return errorResponse('Unauthorized Discord request', 401);
    }

    // Get user by Discord ID
    const user = await getUserByDiscordId(env.DB, discordUserId);
    if (!user) {
        return errorResponse('Discord account not linked. Use /link command first.', 404);
    }

    // Find task by ID or name (check if assigned to user)
    let task;
    if (taskIdentifier.startsWith('task-')) {
        task = await env.DB.prepare(
            'SELECT * FROM tasks WHERE id = ? AND assigned_to_id = ?'
        ).bind(taskIdentifier, user.id).first();
    } else {
        task = await env.DB.prepare(
            'SELECT * FROM tasks WHERE name LIKE ? AND assigned_to_id = ? AND status != ?'
        ).bind(`%${taskIdentifier}%`, user.id, 'completed').first();
    }

    if (!task) {
        return errorResponse('Task not found', 404);
    }

    const now = getCurrentTimestamp();
    await env.DB.prepare(
        'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('completed', now, task.id).run();

    const updatedTask = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(task.id).first();
    return jsonResponse({ data: updatedTask });
}

async function handleDiscordLink(request, env) {
    console.log('[handleDiscordLink] Raw headers received:', Object.fromEntries([...request.headers]));
    const headers = getHeadersFromWorkersRequest(request);
    console.log('[handleDiscordLink] Extracted headers:', headers);
    const discordUserId = verifyDiscordRequest(headers, env.DISCORD_BOT_SECRET);

    if (!discordUserId) {
        return errorResponse('Unauthorized Discord request', 401);
    }

    const { code } = await request.json();

    if (!code) {
        return errorResponse('Link code is required', 400);
    }

    // Validate Discord User ID format
    if (!/^\d{17,19}$/.test(discordUserId)) {
        return errorResponse('Invalid Discord User ID format', 400);
    }

    const now = getCurrentTimestamp();

    // Find the link code
    const linkCode = await env.DB.prepare(
        'SELECT id, user_id, expires_at, used FROM discord_link_codes WHERE code = ?'
    ).bind(code).first();

    if (!linkCode) {
        return errorResponse('Invalid or expired link code', 404);
    }

    if (linkCode.expires_at < now) {
        return errorResponse('Link code has expired', 400);
    }

    if (linkCode.used) {
        return errorResponse('Link code has already been used', 400);
    }

    // Check if Discord ID is already linked to another user
    const existingUser = await getUserByDiscordId(env.DB, discordUserId);
    if (existingUser && existingUser.id !== linkCode.user_id) {
        return errorResponse('This Discord account is already linked to another user', 400);
    }

    // Get Discord username from header (passed by discord-worker)
    const discordUsername = headers['x-discord-username'] || `User#${discordUserId}`;

    console.log('[handleDiscordLink] Linking user:', {
        userId: linkCode.user_id,
        discordUserId,
        discordUsername,
        fromHeader: headers['x-discord-username'],
        usingFallback: !headers['x-discord-username']
    });

    if (discordUsername.startsWith('User#')) {
        console.warn('[handleDiscordLink] ⚠️ Using fallback username - X-Discord-Username header may be missing or empty');
    }

    // Mark code as used
    await env.DB.prepare('UPDATE discord_link_codes SET used = 1 WHERE id = ?')
        .bind(linkCode.id).run();

    // Update user with Discord info
    await env.DB.prepare(
        'UPDATE users SET discord_handle = ?, discord_user_id = ?, discord_verified = 1, updated_at = ? WHERE id = ?'
    ).bind(discordUsername, discordUserId, getCurrentTimestamp(), linkCode.user_id).run();

    const user = await getUserById(env.DB, linkCode.user_id);

    return jsonResponse({
        success: true,
        message: 'Discord account linked successfully',
        data: {
            discord_handle: user.discord_handle
        }
    });
}

async function handleDiscordSummary(request, env) {
    try {
        const headers = getHeadersFromWorkersRequest(request);
        const discordUserId = verifyDiscordRequest(headers, env.DISCORD_BOT_SECRET);

        if (!discordUserId) {
            return errorResponse('Unauthorized Discord request', 401);
        }

        const user = await getUserByDiscordId(env.DB, discordUserId);
        if (!user) {
            return errorResponse('Discord account not linked. Use /link command first.', 404);
        }

        // Get all tasks assigned to this user
        const allTasks = await env.DB.prepare(
            'SELECT * FROM tasks WHERE assigned_to_id = ? AND archived = 0'
        ).bind(user.id).all();

        const tasks = allTasks.results || [];
        const totalTasks = tasks.length;
        const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in-progress').length;
        const completedTasks = tasks.filter(t => t.status === 'completed').length;

        // Count overdue tasks (tasks with date < today and not completed)
        const today = new Date().toISOString().split('T')[0];
        const overdueTasks = tasks.filter(t =>
            t.date < today && t.status !== 'completed'
        ).length;

        // Get total projects user has access to
        const ownedProjects = await env.DB.prepare(
            'SELECT COUNT(*) as count FROM projects WHERE owner_id = ?'
        ).bind(user.id).first();

        const memberProjects = await env.DB.prepare(
            'SELECT COUNT(*) as count FROM project_members WHERE user_id = ?'
        ).bind(user.id).first();

        const totalProjects = (ownedProjects?.count || 0) + (memberProjects?.count || 0);

        return jsonResponse({
            data: {
                totalTasks,
                pendingTasks,
                completedTasks,
                overdueTasks,
                totalProjects
            }
        });
    } catch (error) {
        console.error('[handleDiscordSummary] Error:', error);
        return errorResponse(`Internal server error: ${error.message}`, 500);
    }
}

async function handleDiscordPriorities(request, env) {
    try {
        const headers = getHeadersFromWorkersRequest(request);
        const discordUserId = verifyDiscordRequest(headers, env.DISCORD_BOT_SECRET);

        if (!discordUserId) {
            return errorResponse('Unauthorized Discord request', 401);
        }

        const user = await getUserByDiscordId(env.DB, discordUserId);
        if (!user) {
            return errorResponse('Discord account not linked. Use /link command first.', 404);
        }

        // Get high priority tasks assigned to this user
        const highPriorityTasks = await env.DB.prepare(
            'SELECT * FROM tasks WHERE assigned_to_id = ? AND priority = ? AND archived = 0 ORDER BY date ASC'
        ).bind(user.id, 'high').all();

        return jsonResponse({ data: highPriorityTasks.results || [] });
    } catch (error) {
        console.error('[handleDiscordPriorities] Error:', error);
        return errorResponse(`Internal server error: ${error.message}`, 500);
    }
}

// Project Handlers
async function handleGetProjects(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    // Owned projects
    const { results: owned } = await env.DB.prepare(
        'SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();

    // Member projects
    const { results: memberRows } = await env.DB.prepare(
        'SELECT p.* FROM projects p INNER JOIN project_members m ON p.id = m.project_id WHERE m.user_id = ? ORDER BY p.created_at DESC'
    ).bind(user.id).all();

    // Deduplicate
    const projectMap = new Map();
    [...owned, ...memberRows].forEach(p => projectMap.set(p.id, p));
    const projects = Array.from(projectMap.values());

    // Attach members array
    for (const p of projects) {
        const { results: members } = await env.DB.prepare('SELECT user_id FROM project_members WHERE project_id = ?')
            .bind(p.id).all();
        p.members = members.map(r => r.user_id);
    }

    return jsonResponse(projects);
}

async function handleGetProject(request, env, projectId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const project = await getProjectById(env.DB, projectId);
    if (!project) {
        return errorResponse('Project not found', 404);
    }

    const isMember = await isProjectMember(env.DB, user.id, projectId);
    if (!isMember) {
        return errorResponse('Access denied', 403);
    }

    const { results: members } = await env.DB.prepare('SELECT user_id FROM project_members WHERE project_id = ?')
        .bind(projectId).all();
    project.members = members.map(r => r.user_id);
    return jsonResponse(project);
}

async function handleCreateProject(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const body = await request.json();
        const dataService = createDataService(env.DB);
        const project = await businessLogic.createProject(dataService, user.id, body);

        await logActivity(env.DB, user.id, 'project_created', `Project "${project.name}" created`, null, project.id);
        await broadcastChange(env, 'project-created', { project });

        return jsonResponse(project, 201);
    } catch (error) {
        if (error instanceof ValidationError) return errorResponse(error.message, 400);
        if (error instanceof PermissionError) return errorResponse(error.message, 403);
        if (error instanceof NotFoundError) return errorResponse(error.message, 404);
        console.error('Create project error:', error);
        return errorResponse('Failed to create project', 500);
    }
}

async function handleUpdateProject(request, env, projectId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const body = await request.json();
        const dataService = createDataService(env.DB);
        const updatedProject = await businessLogic.updateProject(dataService, user.id, projectId, body);

        await logActivity(env.DB, user.id, 'project_updated', `Project "${updatedProject.name}" updated`, null, projectId);
        await broadcastChange(env, 'project-updated', { project: updatedProject });

        return jsonResponse(updatedProject);
    } catch (error) {
        if (error instanceof ValidationError) return errorResponse(error.message, 400);
        if (error instanceof PermissionError) return errorResponse(error.message, 403);
        if (error instanceof NotFoundError) return errorResponse(error.message, 404);
        console.error('Update project error:', error);
        return errorResponse('Failed to update project', 500);
    }
}

async function handleDeleteProject(request, env, projectId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        // Get project before deletion for logging
        const project = await getProjectById(env.DB, projectId);

        const dataService = createDataService(env.DB);
        await businessLogic.deleteProject(dataService, user.id, projectId);

        await logActivity(env.DB, user.id, 'project_deleted', `Project "${project.name}" deleted`, null, projectId);
        await broadcastChange(env, 'project-deleted', { projectId });

        return jsonResponse({ message: 'Project deleted successfully' });
    } catch (error) {
        if (error instanceof PermissionError) return errorResponse(error.message, 403);
        if (error instanceof NotFoundError) return errorResponse(error.message, 404);
        console.error('Delete project error:', error);
        return errorResponse('Failed to delete project', 500);
    }
}

async function handleAddProjectMember(request, env, projectId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const isOwner = await isProjectOwner(env.DB, user.id, projectId);
    if (!isOwner) {
        return errorResponse('Only project owner can add members', 403);
    }

    try {
        const project = await getProjectById(env.DB, projectId);
        if (project?.is_personal) {
            return errorResponse('Cannot modify members of a personal project', 403);
        }
        const body = await request.json();
        const { userId: newMemberId, user_id } = body;
        const targetId = newMemberId || user_id;

        if (!targetId) {
            return errorResponse('User ID required', 400);
        }

        const newMember = await getUserById(env.DB, targetId);
        if (!newMember) {
            return errorResponse('User not found', 404);
        }

        // Check if already a member
        const exists = await env.DB.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
            .bind(projectId, targetId).first();
        if (exists) return errorResponse('User is already a member', 400);

        await env.DB.prepare('INSERT INTO project_members (project_id, user_id, added_at) VALUES (?, ?, ?)')
            .bind(projectId, targetId, getCurrentTimestamp()).run();

        await logActivity(env.DB, user.id, 'project_member_added', `Added ${newMember.name} to project`, null, projectId);
        await broadcastChange(env, 'project-updated', { projectId });
        return jsonResponse({ message: 'Member added successfully' });
    } catch (error) {
        console.error('Add member error');
        return errorResponse('Failed to add member', 500);
    }
}

async function handleRemoveProjectMember(request, env, projectId, memberId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const isOwner = await isProjectOwner(env.DB, user.id, projectId);
    const isSelfRemoval = user.id === memberId;

    console.log('Remove member attempt:', { userId: user.id, projectId, memberId, isOwner, isSelfRemoval });

    // Allow either: owner removing anyone OR member removing themselves
    if (!isOwner && !isSelfRemoval) {
        console.log('Permission denied: not owner and not self-removal');
        return errorResponse('Only project owner can remove other members', 403);
    }

    try {
        const project = await getProjectById(env.DB, projectId);
        console.log('Project details:', { id: project?.id, is_personal: project?.is_personal, owner_id: project?.owner_id });

        if (project?.is_personal) {
            console.log('Blocked: personal project');
            return errorResponse('Cannot modify members of a personal project', 403);
        }

        // Prevent owner from removing themselves (they should delete the project instead)
        if (isSelfRemoval && isOwner) {
            console.log('Blocked: owner trying to leave');
            return errorResponse('Project owner cannot leave the project. Delete the project instead.', 403);
        }

        console.log('Executing delete from project_members');
        await env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
            .bind(projectId, memberId).run();

        const removedUser = await getUserById(env.DB, memberId);
        const actionMessage = isSelfRemoval
            ? `Left project`
            : `Removed ${removedUser?.name || memberId} from project`;
        await logActivity(env.DB, user.id, 'project_member_removed', actionMessage, null, projectId);
        await broadcastChange(env, 'project-updated', { projectId });
        console.log('Remove member successful');
        return jsonResponse({ message: 'Member removed successfully' });
    } catch (error) {
        console.error('Remove member error:', error);
        return errorResponse('Failed to remove member', 500);
    }
}

// Task Handlers
async function handleGetTasks(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    // Get all tasks
    // Fetch tasks only for projects the user can access
    const { results } = await env.DB.prepare(
        `SELECT t.* FROM tasks t
         WHERE t.project_id IN (
            SELECT id FROM projects WHERE owner_id = ?
            UNION
            SELECT project_id FROM project_members WHERE user_id = ?
         )
         ORDER BY t.date ASC`
    ).bind(user.id, user.id).all();

    return jsonResponse(results);
}

async function handleGetTask(request, env, taskId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
    if (!task) {
        return errorResponse('Task not found', 404);
    }

    const isMember = await isProjectMember(env.DB, user.id, task.project_id);
    if (!isMember) {
        return errorResponse('Access denied', 403);
    }

    return jsonResponse(task);
}

async function handleCreateTask(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const body = await request.json();
        const dataService = createDataService(env.DB);
        const task = await businessLogic.createTask(dataService, user.id, body);

        await logActivity(env.DB, user.id, 'task_created', `Created task "${task.name}"`, task.id, task.project_id);
        await broadcastChange(env, 'task-created', { taskId: task.id, projectId: task.project_id });

        return jsonResponse(task, 201);
    } catch (error) {
        console.error('Create task error:', error.message, error.stack);
        if (error instanceof ValidationError) return errorResponse(error.message, 400);
        if (error instanceof PermissionError) return errorResponse(error.message, 403);
        if (error instanceof NotFoundError) return errorResponse(error.message, 404);
        return errorResponse('Failed to create task', 500);
    }
}

async function handleUpdateTask(request, env, taskId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const body = await request.json();
        const dataService = createDataService(env.DB);
        const updatedTask = await businessLogic.updateTask(dataService, user.id, taskId, body);

        await logActivity(env.DB, user.id, 'task_updated', `Updated task "${updatedTask.name}"`, taskId, updatedTask.project_id);
        await broadcastChange(env, 'task-updated', { taskId, projectId: updatedTask.project_id });

        return jsonResponse(updatedTask);
    } catch (error) {
        if (error instanceof ValidationError) return errorResponse(error.message, 400);
        if (error instanceof PermissionError) return errorResponse(error.message, 403);
        if (error instanceof NotFoundError) return errorResponse(error.message, 404);
        console.error('Update task error:', error);
        return errorResponse('Failed to update task', 500);
    }
}

async function handleDeleteTask(request, env, taskId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        // Get task before deletion for logging
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();

        const dataService = createDataService(env.DB);
        await businessLogic.deleteTask(dataService, user.id, taskId);

        await logActivity(env.DB, user.id, 'task_deleted', `Deleted task "${task.name}"`, taskId, task.project_id);
        await broadcastChange(env, 'task-deleted', { taskId, projectId: task.project_id });

        return jsonResponse({ message: 'Task deleted successfully' });
    } catch (error) {
        if (error instanceof PermissionError) return errorResponse(error.message, 403);
        if (error instanceof NotFoundError) return errorResponse(error.message, 404);
        console.error('Delete task error:', error);
        return errorResponse('Failed to delete task', 500);
    }
}

// Activity Handler
async function handleGetActivity(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const { results } = await env.DB.prepare(
        'SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 100'
    ).all();

    return jsonResponse(results);
}

// ==================== ADMIN INVITATION HANDLERS ====================

// Send invitation
async function handleSendInvitation(request, env) {
    const user = await requireSuperAdmin(request, env);
    if (!user) {
        return errorResponse('Super admin access required', 403);
    }

    // Rate limit
    const allowed = await rateLimit(request, env, 'magic-link', 60, 1);
    if (!allowed) {
        return errorResponse('Too many magic link requests. Please wait 60 seconds and try again.', 429);
    }

    try {
        const { email } = await request.json();

        if (!email || typeof email !== 'string') {
            return errorResponse('Valid email is required', 400);
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user already exists
        const existingUser = await env.DB.prepare(
            'SELECT id FROM users WHERE email = ?'
        ).bind(normalizedEmail).first();

        if (existingUser) {
            return errorResponse('User with this email already exists', 400);
        }

        // Check if invitation already exists
        const existingInv = await env.DB.prepare(
            'SELECT * FROM invitations WHERE email = ?'
        ).bind(normalizedEmail).first();

        const now = getCurrentTimestamp();

        if (!existingInv) {
            // Create new invitation
            await env.DB.prepare(
                'INSERT INTO invitations (email, invited_by_user_id, invited_at, magic_link_sent_at, status) VALUES (?, ?, ?, ?, ?)'
            ).bind(normalizedEmail, user.id, now, now, 'pending').run();
        } else {
            // Update existing invitation
            await env.DB.prepare(
                'UPDATE invitations SET magic_link_sent_at = ?, status = ? WHERE email = ?'
            ).bind(now, 'pending', normalizedEmail).run();
        }

        // Send signup invitation via Supabase (triggers "Confirm signup" email)
        const origin = request.headers.get('Origin') || 'https://mmw-tm.pages.dev';
        const redirectTo = `${origin}/auth/callback.html`;

        const supabaseResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': env.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                email: normalizedEmail,
                password: crypto.randomUUID(), // Random password (user won't use it - they'll use magic links)
                options: {
                    emailRedirectTo: redirectTo,
                    data: {
                        invited: true
                    }
                }
            })
        });

        if (!supabaseResponse.ok) {
            const errorData = await supabaseResponse.text();
            console.error('Supabase signup error:', errorData);

            // Check if user already exists
            if (errorData.includes('already registered')) {
                // User exists, send them a magic link instead
                const otpResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': env.SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({
                        email: normalizedEmail,
                        options: {
                            emailRedirectTo: redirectTo
                        }
                    })
                });

                if (!otpResponse.ok) {
                    throw new Error('User already exists but failed to send login link');
                }
            } else {
                throw new Error('Failed to send invitation email');
            }
        }

        await logActivity(env.DB, user.id, 'invitation_sent', `Invitation sent to ${normalizedEmail}`);

        return jsonResponse({
            message: 'Invitation sent successfully',
            email: normalizedEmail
        });

    } catch (error) {
        console.error('Send invitation error:', error);
        return errorResponse('Failed to send invitation', 500);
    }
}

// Get all invitations
async function handleGetInvitations(request, env) {
    const user = await requireSuperAdmin(request, env);
    if (!user) {
        return errorResponse('Super admin access required', 403);
    }

    try {
        const { results } = await env.DB.prepare(`
            SELECT
                i.id, i.email, i.invited_at, i.magic_link_sent_at,
                i.joined_at, i.status,
                u.id as user_id, u.name as user_name, u.username
            FROM invitations i
            LEFT JOIN users u ON i.joined_user_id = u.id
            ORDER BY i.invited_at DESC
        `).all();

        return jsonResponse({ invitations: results || [] });
    } catch (error) {
        console.error('Get invitations error:', error);
        return errorResponse('Failed to fetch invitations', 500);
    }
}

// Resend invitation
async function handleResendInvitation(request, env, email) {
    const user = await requireSuperAdmin(request, env);
    if (!user) {
        return errorResponse('Super admin access required', 403);
    }

    // Rate limit
    const allowed = await rateLimit(request, env, 'magic-link', 60, 1);
    if (!allowed) {
        return errorResponse('Too many magic link requests. Please wait 60 seconds and try again.', 429);
    }

    try {
        const normalizedEmail = decodeURIComponent(email).toLowerCase().trim();

        const invitation = await env.DB.prepare(
            'SELECT * FROM invitations WHERE email = ?'
        ).bind(normalizedEmail).first();

        if (!invitation) {
            return errorResponse('Invitation not found', 404);
        }

        if (invitation.status === 'accepted') {
            return errorResponse('User has already accepted this invitation', 400);
        }

        // Check if user exists
        const existingUser = await env.DB.prepare(
            'SELECT * FROM users WHERE email = ?'
        ).bind(normalizedEmail).first();

        if (existingUser) {
            // Auto-mark as accepted
            await env.DB.prepare(
                'UPDATE invitations SET status = ?, joined_at = ?, joined_user_id = ? WHERE email = ?'
            ).bind('accepted', existingUser.created_at, existingUser.id, normalizedEmail).run();
            return errorResponse('User has already registered', 400);
        }

        // Update invitation
        const now = getCurrentTimestamp();
        await env.DB.prepare(
            'UPDATE invitations SET magic_link_sent_at = ?, status = ? WHERE email = ?'
        ).bind(now, 'pending', normalizedEmail).run();

        // Resend invitation - use magic link for existing users
        const origin = request.headers.get('Origin') || 'https://mmw-tm.pages.dev';
        const redirectTo = `${origin}/auth/callback.html`;

        const supabaseResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': env.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                email: normalizedEmail,
                options: {
                    emailRedirectTo: redirectTo
                }
            })
        });

        if (!supabaseResponse.ok) {
            const errorData = await supabaseResponse.text();
            console.error('Supabase OTP error:', errorData);
            throw new Error('Failed to resend invitation email');
        }

        await logActivity(env.DB, user.id, 'invitation_resent', `Invitation resent to ${normalizedEmail}`);

        return jsonResponse({ message: 'Invitation resent successfully' });

    } catch (error) {
        console.error('Resend invitation error:', error);
        return errorResponse('Failed to resend invitation', 500);
    }
}

// Get all users (admin only)
async function handleGetAllUsers(request, env) {
    const user = await requireSuperAdmin(request, env);
    if (!user) {
        return errorResponse('Super admin access required', 403);
    }

    try {
        const { results } = await env.DB.prepare(`
            SELECT
                id, username, name, email, initials, color, is_admin,
                created_at, updated_at,
                (SELECT COUNT(*) FROM tasks WHERE assigned_to_id = users.id) as task_count
            FROM users
            ORDER BY created_at DESC
        `).all();

        return jsonResponse({ users: results || [] });
    } catch (error) {
        console.error('Get all users error:', error);
        return errorResponse('Failed to fetch users', 500);
    }
}

// Delete user (admin only)
async function handleDeleteUser(request, env, userId) {
    const adminUser = await requireSuperAdmin(request, env);
    if (!adminUser) {
        return errorResponse('Super admin access required', 403);
    }

    try {
        // Validate userId
        if (!userId || typeof userId !== 'string') {
            return errorResponse('Valid user ID is required', 400);
        }

        // Check if user exists
        const userToDelete = await env.DB.prepare(
            'SELECT id, username, email FROM users WHERE id = ?'
        ).bind(userId).first();

        if (!userToDelete) {
            return errorResponse('User not found', 404);
        }

        // Prevent self-deletion
        if (userToDelete.id === adminUser.id) {
            return errorResponse('Cannot delete your own account', 400);
        }

        // Start transaction-like operations
        // 1. Unassign all tasks assigned to this user
        await env.DB.prepare(
            'UPDATE tasks SET assigned_to_id = NULL WHERE assigned_to_id = ?'
        ).bind(userId).run();

        // 2. Get personal project IDs
        const { results: personalProjects } = await env.DB.prepare(
            'SELECT id FROM projects WHERE owner_id = ? AND is_personal = 1'
        ).bind(userId).all();

        // 3. Delete tasks in personal projects
        if (personalProjects && personalProjects.length > 0) {
            for (const project of personalProjects) {
                await env.DB.prepare(
                    'DELETE FROM tasks WHERE project_id = ?'
                ).bind(project.id).run();
            }

            // 4. Delete personal projects
            await env.DB.prepare(
                'DELETE FROM projects WHERE owner_id = ? AND is_personal = 1'
            ).bind(userId).run();
        }

        // 5. Remove user from project members
        await env.DB.prepare(
            'DELETE FROM project_members WHERE user_id = ?'
        ).bind(userId).run();

        // 6. Delete any invitations associated with this user
        // Delete invitations sent TO this user's email
        if (userToDelete.email) {
            await env.DB.prepare(
                'DELETE FROM invitations WHERE email = ?'
            ).bind(userToDelete.email).run();
        }

        // Delete invitations sent BY this user
        await env.DB.prepare(
            'DELETE FROM invitations WHERE invited_by_user_id = ?'
        ).bind(userId).run();

        // Nullify joined_user_id for invitations this user accepted
        await env.DB.prepare(
            'UPDATE invitations SET joined_user_id = NULL WHERE joined_user_id = ?'
        ).bind(userId).run();

        // 7. Finally, delete the user
        await env.DB.prepare(
            'DELETE FROM users WHERE id = ?'
        ).bind(userId).run();

        // Log the activity
        await logActivity(
            env.DB,
            adminUser.id,
            'user_deleted',
            `Deleted user: ${userToDelete.username} (${userToDelete.email})`
        );

        return jsonResponse({
            message: 'User deleted successfully',
            deletedUser: {
                id: userToDelete.id,
                username: userToDelete.username,
                email: userToDelete.email
            }
        });

    } catch (error) {
        console.error('Delete user error:', error);
        return errorResponse('Failed to delete user', 500);
    }
}

// ==================== DISCORD INTERACTIONS HANDLER ====================

/**
 * Handle Discord Interactions (slash commands) directly
 * This replaces the need for a separate discord-bot worker
 */
async function handleDiscordInteraction(request, env) {
    // Verify Discord signature
    const isValid = await verifyDiscordInteraction(request, env.DISCORD_PUBLIC_KEY);
    if (!isValid) {
        return new Response('Invalid signature', { status: 401 });
    }

    const interaction = await request.json();

    // Handle PING (Discord verification)
    if (interaction.type === InteractionType.PING) {
        return new Response(JSON.stringify({
            type: InteractionResponseType.PONG
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Handle slash commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        const { name, options } = interaction.data;
        const discordUser = interaction.member?.user || interaction.user;
        const discordUserId = discordUser?.id;
        const discordUsername = discordUser?.global_name || discordUser?.username || discordUser?.display_name || `User#${discordUserId}`;

        if (!discordUserId) {
            return new Response(JSON.stringify(
                createResponse('❌ Could not identify Discord user', true)
            ), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            // Get user from database
            const user = await getUserByDiscordId(env.DB, discordUserId);

            // Create a simple API wrapper for discord-commands.js handlers
            // This directly accesses the database - no HMAC needed since we're internal
            const fetchAPI = async (userId, method, path, body = null) => {
                // Ensure user is linked
                if (!user && !path.includes('/discord/link')) {
                    throw new Error('Discord account not linked. Use /link command first.');
                }

                // Route to appropriate handler based on path - direct database access
                if (path === '/discord/tasks' && method === 'GET') {
                    const tasks = await env.DB.prepare(
                        'SELECT * FROM tasks WHERE assigned_to_id = ? AND archived = 0 ORDER BY created_at DESC'
                    ).bind(user.id).all();
                    return { data: tasks.results || [] };
                }

                if (path === '/discord/tasks' && method === 'POST') {
                    const { name, date, priority } = body;
                    const taskId = generateId('task');
                    const now = getCurrentTimestamp();

                    // Get user's personal project
                    const personalProject = await env.DB.prepare(
                        'SELECT * FROM projects WHERE owner_id = ? AND name = ?'
                    ).bind(user.id, 'Personal').first();

                    await env.DB.prepare(
                        'INSERT INTO tasks (id, name, description, status, priority, date, created_by_id, assigned_to_id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                    ).bind(taskId, name, '', 'pending', priority || 'none', date, user.id, user.id, personalProject.id, now, now).run();

                    const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
                    return { data: task };
                }

                if (path.match(/^\/discord\/tasks\/.*\/complete$/) && method === 'PUT') {
                    const taskIdentifier = decodeURIComponent(path.split('/')[3]);

                    // Find task by ID or name
                    let task;
                    if (taskIdentifier.startsWith('task-')) {
                        task = await env.DB.prepare(
                            'SELECT * FROM tasks WHERE id = ? AND assigned_to_id = ?'
                        ).bind(taskIdentifier, user.id).first();
                    } else {
                        task = await env.DB.prepare(
                            'SELECT * FROM tasks WHERE name LIKE ? AND assigned_to_id = ? AND status != ?'
                        ).bind(`%${taskIdentifier}%`, user.id, 'completed').first();
                    }

                    if (!task) {
                        throw new Error('Task not found or not assigned to you');
                    }

                    const now = getCurrentTimestamp();
                    await env.DB.prepare(
                        'UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?'
                    ).bind('completed', now, now, task.id).run();

                    const updatedTask = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(task.id).first();
                    return { data: updatedTask };
                }

                if (path === '/discord/summary' && method === 'GET') {
                    const allTasks = await env.DB.prepare(
                        'SELECT * FROM tasks WHERE assigned_to_id = ? AND archived = 0'
                    ).bind(user.id).all();

                    const tasks = allTasks.results || [];
                    const today = new Date().toISOString().split('T')[0];

                    const ownedProjects = await env.DB.prepare(
                        'SELECT COUNT(*) as count FROM projects WHERE owner_id = ?'
                    ).bind(user.id).first();

                    const memberProjects = await env.DB.prepare(
                        'SELECT COUNT(*) as count FROM project_members WHERE user_id = ?'
                    ).bind(user.id).first();

                    return {
                        data: {
                            totalTasks: tasks.length,
                            pendingTasks: tasks.filter(t => t.status === 'pending' || t.status === 'in-progress').length,
                            completedTasks: tasks.filter(t => t.status === 'completed').length,
                            overdueTasks: tasks.filter(t => t.date < today && t.status !== 'completed').length,
                            totalProjects: (ownedProjects?.count || 0) + (memberProjects?.count || 0)
                        }
                    };
                }

                if (path === '/discord/priorities' && method === 'GET') {
                    const highPriorityTasks = await env.DB.prepare(
                        'SELECT * FROM tasks WHERE assigned_to_id = ? AND priority = ? AND archived = 0 ORDER BY date ASC'
                    ).bind(user.id, 'high').all();
                    return { data: highPriorityTasks.results || [] };
                }

                if (path === '/discord/link' && method === 'POST') {
                    const { code, discordUserId } = body;

                    // Find link code
                    const linkCode = await env.DB.prepare(
                        'SELECT * FROM discord_link_codes WHERE code = ? AND used = 0'
                    ).bind(code).first();

                    if (!linkCode) {
                        throw new Error('Invalid or expired link code');
                    }

                    // Update user with Discord info
                    await env.DB.prepare(
                        'UPDATE users SET discord_user_id = ?, discord_handle = ? WHERE id = ?'
                    ).bind(discordUserId, discordUsername, linkCode.user_id).run();

                    // Mark code as used
                    await env.DB.prepare(
                        'UPDATE discord_link_codes SET used = 1 WHERE code = ?'
                    ).bind(code).run();

                    const linkedUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(linkCode.user_id).first();
                    return { data: linkedUser };
                }

                // POST /claude/smart - AI assistant
                if (path === '/claude/smart' && method === 'POST') {
                    console.log('[Claude] Endpoint hit with body:', body);
                    const { input } = body;
                    console.log('[Claude] Input:', input);

                    if (!env.ANTHROPIC_API_KEY) {
                        throw new Error('ANTHROPIC_API_KEY not configured');
                    }

                    // Get user's tasks for context
                    const userTasks = await env.DB.prepare(
                        'SELECT * FROM tasks WHERE assigned_to_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT 50'
                    ).bind(user.id).all();

                    // Build context for Claude
                    const tasksContext = (userTasks.results || []).map(t =>
                        `- ${t.name} (${t.status}, priority: ${t.priority}, due: ${t.date})`
                    ).join('\n');

                    // Call Claude API
                    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': env.ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01'
                        },
                        body: JSON.stringify({
                            model: 'claude-3-5-sonnet-20241022',
                            max_tokens: 1024,
                            messages: [{
                                role: 'user',
                                content: `You are a task management assistant. Here are the user's current tasks:

${tasksContext || 'No tasks yet.'}

User question: ${input}

Please provide a helpful response. If the user wants to create/update tasks, respond with a clear summary of what should be done.`
                            }]
                        })
                    });

                    if (!claudeResponse.ok) {
                        const error = await claudeResponse.text();
                        console.error('[Claude] API error:', error);
                        throw new Error('Claude API error');
                    }

                    const claudeData = await claudeResponse.json();
                    const answer = claudeData.content[0].text;

                    console.log('[Claude] Response from API:', answer);

                    return {
                        data: {
                            type: 'answer',
                            answer: answer
                        }
                    };
                }

                throw new Error(`Unknown path: ${path}`);
            };

            let responseData;

            // Route to appropriate command handler
            switch (name) {
                case 'tasks':
                    responseData = await handleTasksCommand(fetchAPI, discordUserId);
                    break;

                case 'create':
                    const createParams = {
                        title: getOption(options, 'title'),
                        due: getOption(options, 'due'),
                        priority: getOption(options, 'priority')
                    };
                    responseData = await handleCreateCommand(fetchAPI, discordUserId, createParams);
                    break;

                case 'complete':
                    const completeParams = {
                        task: getOption(options, 'task')
                    };
                    responseData = await handleCompleteCommand(fetchAPI, discordUserId, completeParams);
                    break;

                case 'summary':
                    responseData = await handleSummaryCommand(fetchAPI, discordUserId);
                    break;

                case 'priorities':
                    responseData = await handlePrioritiesCommand(fetchAPI, discordUserId);
                    break;

                case 'claude':
                    const claudeParams = {
                        query: getOption(options, 'query')
                    };
                    responseData = await handleClaudeCommand(fetchAPI, discordUserId, claudeParams);
                    break;

                case 'link':
                    const linkParams = {
                        code: getOption(options, 'code')
                    };
                    responseData = await handleLinkCommand(fetchAPI, discordUserId, linkParams);
                    break;

                case 'help':
                    responseData = await handleHelpCommand();
                    break;

                default:
                    responseData = createResponse(`❌ Unknown command: ${name}`, true);
            }

            // Format response for Discord Interactions
            const response = {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: responseData
            };

            return new Response(JSON.stringify(response), {
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Discord interaction error:', error);

            // Return error message to user
            return new Response(JSON.stringify({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: createResponse(`❌ Error: ${error.message}`, true)
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // Unknown interaction type
    return new Response(JSON.stringify(
        createResponse('❌ Unknown interaction type', true)
    ), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// ==================== MAIN REQUEST HANDLER ====================

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Log all incoming Discord API requests
        if (path.startsWith('/api/discord/')) {
            console.log('[Main Worker] Incoming Discord API request:', {
                method,
                path,
                origin: request.headers.get('Origin'),
                hasDiscordUserId: !!request.headers.get('X-Discord-User-ID'),
                hasDiscordSignature: !!request.headers.get('X-Discord-Signature')
            });
        }

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return new Response(null, { headers: getCorsHeaders(request) });
        }

        // Discord Interactions endpoint (for slash commands)
        if (path === '/api/interactions' && method === 'POST') {
            return await handleDiscordInteraction(request, env);
        }

        try {
            // Auth routes
            if (path === '/api/auth/supabase-login' && method === 'POST') {
                return await handleSupabaseLogin(request, env);
            }
            if (path === '/api/auth/supabase-callback' && method === 'POST') {
                return await handleSupabaseCallback(request, env);
            }
            if (path === '/api/auth/profile-setup' && method === 'POST') {
                return await handleProfileSetup(request, env);
            }
            if (path === '/api/auth/logout' && method === 'POST') {
                return await handleLogout(request, env);
            }
            if (path === '/api/auth/me' && method === 'GET') {
                return await handleGetMe(request, env);
            }
            if (path === '/api/auth/me' && method === 'PUT') {
                return await handleUpdateMe(request, env);
            }

            // Config route
            if (path === '/api/config/public' && method === 'GET') {
                return await handleGetConfig(request, env);
            }

            // User routes
            if (path === '/api/users' && method === 'GET') {
                return await handleGetUsers(request, env);
            }
            if (path.match(/^\/api\/users\/[^/]+$/) && method === 'GET') {
                const userId = path.split('/')[3];
                return await handleGetUser(request, env, userId);
            }
            if (path === '/api/user/discord-handle' && method === 'GET') {
                return await handleGetDiscordHandle(request, env);
            }
            if (path === '/api/user/discord-handle' && method === 'PUT') {
                return await handleUpdateDiscordHandle(request, env);
            }

            // Discord linking routes
            if (path === '/api/discord/generate-link-code' && method === 'POST') {
                return await handleGenerateDiscordLinkCode(request, env);
            }
            if (path.match(/^\/api\/discord\/link-status\/[^/]+$/) && method === 'GET') {
                const code = path.split('/')[4];
                return await handleCheckDiscordLinkStatus(request, env, code);
            }
            if (path === '/api/discord/verify-link-code' && method === 'POST') {
                return await handleVerifyDiscordLinkCode(request, env);
            }

            // Discord Bot API routes (called by discord-worker)
            if (path === '/api/discord/tasks' && method === 'GET') {
                return await handleDiscordGetTasks(request, env);
            }
            if (path === '/api/discord/tasks' && method === 'POST') {
                return await handleDiscordCreateTask(request, env);
            }
            if (path.match(/^\/api\/discord\/tasks\/[^/]+\/complete$/) && method === 'PUT') {
                const taskIdentifier = decodeURIComponent(path.split('/')[4]);
                return await handleDiscordCompleteTask(request, env, taskIdentifier);
            }
            if (path === '/api/discord/link' && method === 'POST') {
                return await handleDiscordLink(request, env);
            }
            if (path === '/api/discord/summary' && method === 'GET') {
                return await handleDiscordSummary(request, env);
            }
            if (path === '/api/discord/priorities' && method === 'GET') {
                return await handleDiscordPriorities(request, env);
            }

            // Claude AI routes (can be called from Discord or web)
            if (path === '/api/claude/smart' && method === 'POST') {
                return await handleClaudeSmart(request, env);
            }

            // Project routes
            if (path === '/api/projects' && method === 'GET') {
                return await handleGetProjects(request, env);
            }
            if (path === '/api/projects' && method === 'POST') {
                return await handleCreateProject(request, env);
            }
            if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'GET') {
                const projectId = path.split('/')[3];
                return await handleGetProject(request, env, projectId);
            }
            if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'PUT') {
                const projectId = path.split('/')[3];
                return await handleUpdateProject(request, env, projectId);
            }
            if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'DELETE') {
                const projectId = path.split('/')[3];
                return await handleDeleteProject(request, env, projectId);
            }
            if (path.match(/^\/api\/projects\/[^/]+\/members$/) && method === 'POST') {
                const projectId = path.split('/')[3];
                return await handleAddProjectMember(request, env, projectId);
            }
            if (path.match(/^\/api\/projects\/[^/]+\/members\/[^/]+$/) && method === 'DELETE') {
                const parts = path.split('/');
                const projectId = parts[3];
                const memberId = parts[5];
                return await handleRemoveProjectMember(request, env, projectId, memberId);
            }

            // Task routes
            if (path === '/api/tasks' && method === 'GET') {
                return await handleGetTasks(request, env);
            }
            if (path === '/api/tasks' && method === 'POST') {
                return await handleCreateTask(request, env);
            }
            if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'GET') {
                const taskId = path.split('/')[3];
                return await handleGetTask(request, env, taskId);
            }
            if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'PUT') {
                const taskId = path.split('/')[3];
                return await handleUpdateTask(request, env, taskId);
            }
            if (path.match(/^\/api\/tasks\/[^/]+$/) && method === 'DELETE') {
                const taskId = path.split('/')[3];
                return await handleDeleteTask(request, env, taskId);
            }

            // Activity route
            if (path === '/api/activity' && method === 'GET') {
                return await handleGetActivity(request, env);
            }

            // Admin invitation routes
            if (path === '/api/admin/invitations' && method === 'POST') {
                return await handleSendInvitation(request, env);
            }
            if (path === '/api/admin/invitations' && method === 'GET') {
                return await handleGetInvitations(request, env);
            }
            if (path.match(/^\/api\/admin\/invitations\/[^/]+\/resend$/) && method === 'POST') {
                const email = path.split('/')[4];
                return await handleResendInvitation(request, env, email);
            }

            // Admin user management routes
            if (path === '/api/admin/users' && method === 'GET') {
                return await handleGetAllUsers(request, env);
            }
            if (path.match(/^\/api\/admin\/users\/[^/]+$/) && method === 'DELETE') {
                const userId = path.split('/')[4];
                return await handleDeleteUser(request, env, userId);
            }

            // 404 for unknown API routes
            return errorResponse('Not found', 404);

        } catch (error) {
            console.error('Worker error');
            return errorResponse('Internal server error', 500);
        }
    }
};
