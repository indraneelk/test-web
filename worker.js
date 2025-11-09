// Cloudflare Worker for Team Task Manager
// Uses D1 Database, Supabase Auth, and JWT-based authentication

import { jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';

// Shared modules
const { generateId, getCurrentTimestamp, sanitizeString, generateDiscordLinkCode, isHexColor } = require('./shared/helpers');
const { validateString, validateEmail, validateUsername, validatePassword, validatePriority, validateStatus } = require('./shared/validators');
const businessLogic = require('./shared/business-logic');
const { ValidationError, AuthenticationError, PermissionError, NotFoundError, ConflictError } = require('./shared/errors');
const { verifyDiscordRequest, getHeadersFromWorkersRequest } = require('./shared/discord-auth');

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
    const { maxAge = 86400, httpOnly = true, secure = true, sameSite = 'Strict', path = '/' } = options;

    let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`;
    if (httpOnly) cookie += '; HttpOnly';
    if (secure) cookie += '; Secure';

    return cookie;
}

function clearCookie(name) {
    return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

async function createAuthCookie(userId, env) {
    const token = await createJWT({ userId }, env.SESSION_SECRET || 'fallback-secret', '24h');
    return setCookie('auth_token', token, { maxAge: 86400 });
}

// Plan B: Supabase Realtime Broadcast Helper
async function broadcastChange(env, eventType, payload) {
    try {
        // Use Supabase REST API to send broadcast to 'task-updates' channel
        const response = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': env.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                channel: 'task-updates',
                event: eventType,
                payload
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
            'INSERT INTO activity_logs (id, user_id, task_id, project_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
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
            await db.prepare("DELETE FROM activity_logs WHERE created_at < datetime('now','-90 days')").run();
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
        getProjectById,
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
    // Try Discord User ID first (from Discord bot) with HMAC signature verification
    const discordUserId = request.headers.get('X-Discord-User-ID');
    if (discordUserId) {
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
        if (user) return user;
        // If Discord ID provided but not found, return null (will trigger 401)
        return null;
    }

    // Try Authorization: Bearer <access_token> (stateless)
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.slice(7);
        const claims = await verifySupabaseJWT(token, env);
        if (claims && claims.sub) {
            const user = await getUserById(env.DB, claims.sub);
            if (user) return user;
        }
    }
    // Fallback to cookie session (if present)
    const token = getCookie(request, 'auth_token');
    if (token && env.SESSION_SECRET) {
        const payload = await verifyJWT(token, env.SESSION_SECRET);
        if (payload && payload.userId) {
            const user = await getUserById(env.DB, payload.userId);
            if (user) return user;
        }
    }
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

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
    'Access-Control-Allow-Credentials': 'true'
};

function jsonResponse(data, status = 200, headers = {}) {
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
        return jsonResponse({ user: userWithoutPassword });
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
            const now = getCurrentTimestamp();
            const name = user_metadata?.name || email?.split('@')[0] || 'User';
            const initials = name.substring(0, 2).toUpperCase();
            const username = (email?.split('@')[0] || 'user').toLowerCase();
            await env.DB.prepare(
                'INSERT INTO users (id, username, password_hash, name, email, initials, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(sub, username, 'supabase', name, email || null, initials, 0, now, now).run();
            user = await getUserById(env.DB, sub);
            await logActivity(env.DB, sub, 'user_created', `User ${name} created via magic link`);

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
            await env.DB.prepare(
                'INSERT INTO projects (id, name, description, color, owner_id, is_personal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(personalProjectId, 'My Tasks', 'Personal tasks and notes', '#667eea', sub, 1, now, now).run();

            // Add user as member of their personal project
            await env.DB.prepare(
                'INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
            ).bind(personalProjectId, sub, 'owner', now).run();

            await logActivity(env.DB, sub, 'project_created', 'Personal project created', null, personalProjectId);
        }
        const { password_hash, ...userWithoutPassword } = user;
        return jsonResponse({ user: userWithoutPassword });
    } catch (error) {
        console.error('Supabase callback error');
        return errorResponse('Authentication failed', 500);
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
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const { results } = await env.DB.prepare(
        'SELECT id, username, name, email, initials, color, is_admin, created_at FROM users ORDER BY name ASC'
    ).all();

    return jsonResponse(results);
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

    // Clean up expired codes for this user first
    const now = getCurrentTimestamp();
    await env.DB.prepare('DELETE FROM discord_link_codes WHERE user_id = ? AND expires_at < ?')
        .bind(user.id, now).run();

    // Check if user already has a valid unused code
    const existing = await env.DB.prepare(
        'SELECT code, expires_at FROM discord_link_codes WHERE user_id = ? AND used = 0 AND expires_at > ?'
    ).bind(user.id, now).first();

    if (existing) {
        const expiresAt = new Date(existing.expires_at);
        const secondsRemaining = Math.floor((expiresAt - new Date()) / 1000);
        return jsonResponse({
            code: existing.code,
            expiresIn: secondsRemaining
        });
    }

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
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const createdAt = getCurrentTimestamp();

    await env.DB.prepare(
        'INSERT INTO discord_link_codes (code, user_id, expires_at, created_at, used) VALUES (?, ?, ?, ?, 0)'
    ).bind(code, user.id, expiresAt, createdAt).run();

    return jsonResponse({
        code,
        expiresIn: 300 // 5 minutes in seconds
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
    if (!isOwner) {
        return errorResponse('Only project owner can remove members', 403);
    }

    try {
        const project = await getProjectById(env.DB, projectId);
        if (project?.is_personal) {
            return errorResponse('Cannot modify members of a personal project', 403);
        }
        await env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
            .bind(projectId, memberId).run();

        const removedUser = await getUserById(env.DB, memberId);
        await logActivity(env.DB, user.id, 'project_member_removed', `Removed ${removedUser?.name || memberId} from project`, null, projectId);
        await broadcastChange(env, 'project-updated', { projectId });
        return jsonResponse({ message: 'Member removed successfully' });
    } catch (error) {
        console.error('Remove member error');
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
        if (error instanceof ValidationError) return errorResponse(error.message, 400);
        if (error instanceof PermissionError) return errorResponse(error.message, 403);
        if (error instanceof NotFoundError) return errorResponse(error.message, 404);
        console.error('Create task error:', error);
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
        'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100'
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

        // Note: Actual magic link sending would require Supabase integration
        // For now, just log the action
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

        // 5. Delete user's Discord link if exists
        await env.DB.prepare(
            'DELETE FROM discord_links WHERE user_id = ?'
        ).bind(userId).run();

        // 6. Delete any invitations associated with this user
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

// ==================== MAIN REQUEST HANDLER ====================

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Auth routes
            if (path === '/api/auth/supabase-login' && method === 'POST') {
                return await handleSupabaseLogin(request, env);
            }
            if (path === '/api/auth/supabase-callback' && method === 'POST') {
                return await handleSupabaseCallback(request, env);
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
