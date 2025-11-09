// Cloudflare Worker for Team Task Manager
// Uses D1 Database, Supabase Auth, and JWT-based authentication

import { jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';

// ==================== HELPER FUNCTIONS ====================

function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getCurrentTimestamp() {
    return new Date().toISOString();
}

// Input validation and sanitization
function sanitizeString(str, maxLen = 1000) {
    if (typeof str !== 'string') return '';
    const s = str.trim();
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function isHexColor(str) {
    return typeof str === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str.trim());
}

function validatePriority(v) {
    if (v == null) return true;
    const s = String(v).toLowerCase().trim();
    return ['none', 'low', 'medium', 'high'].includes(s);
}

function validateStatus(v) {
    if (v == null) return true;
    const s = String(v).toLowerCase().trim();
    return ['pending', 'in-progress', 'completed'].includes(s);
}

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

// ==================== AUTHENTICATION MIDDLEWARE ====================

async function authenticate(request, env) {
    // Prefer Authorization: Bearer <access_token> (stateless)
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
        const { name, description, color = '#f06a6a', is_personal = false } = body;

        if (!name || !name.trim()) {
            return errorResponse('Project name is required', 400);
        }
        const cleanName = sanitizeString(name, 200);
        const cleanDesc = sanitizeString(description || '', 2000);
        const cleanColor = isHexColor(color) ? color : '#f06a6a';

        const projectId = generateId('project');
        const now = getCurrentTimestamp();

        await env.DB.prepare(
            'INSERT INTO projects (id, name, description, color, owner_id, is_personal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(projectId, cleanName, cleanDesc, cleanColor, user.id, is_personal ? 1 : 0, now, now).run();

        await logActivity(env.DB, user.id, 'project_created', `Project "${name}" created`, null, projectId);

        const project = await getProjectById(env.DB, projectId);
        await broadcastChange(env, 'project-created', { project });

        return jsonResponse(project, 201);
    } catch (error) {
        console.error('Create project error:', error);
        return errorResponse('Failed to create project', 500);
    }
}

async function handleUpdateProject(request, env, projectId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const isOwner = await isProjectOwner(env.DB, user.id, projectId);
    if (!isOwner) {
        return errorResponse('Only project owner can update project', 403);
    }

    try {
        const body = await request.json();
        const { name, description, color } = body;

        const updates = [];
        const values = [];

        if (name) { updates.push('name = ?'); values.push(sanitizeString(name, 200)); }
        if (description !== undefined) { updates.push('description = ?'); values.push(sanitizeString(description || '', 2000)); }
        if (color) { if (!isHexColor(color)) return errorResponse('Invalid color', 400); updates.push('color = ?'); values.push(color.trim()); }

        if (updates.length === 0) {
            return errorResponse('No valid fields to update', 400);
        }

        updates.push('updated_at = ?');
        values.push(getCurrentTimestamp());
        values.push(projectId);

        await env.DB.prepare(
            `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();

        await logActivity(env.DB, user.id, 'project_updated', `Project updated`, null, projectId);

        const project = await getProjectById(env.DB, projectId);
        await broadcastChange(env, 'project-updated', { project });
        return jsonResponse(project);
    } catch (error) {
        console.error('Update project error');
        return errorResponse('Failed to update project', 500);
    }
}

async function handleDeleteProject(request, env, projectId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    const isOwner = await isProjectOwner(env.DB, user.id, projectId);
    if (!isOwner) {
        return errorResponse('Only project owner can delete project', 403);
    }

    try {
        const project = await getProjectById(env.DB, projectId);
        if (project?.is_personal) {
            return errorResponse('Cannot delete personal project', 403);
        }

        // Delete associated tasks
        await env.DB.prepare('DELETE FROM tasks WHERE project_id = ?').bind(projectId).run();

        // Delete project
        await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();

        await logActivity(env.DB, user.id, 'project_deleted', `Project "${project.name}" deleted`, null, projectId);
        await broadcastChange(env, 'project-deleted', { projectId });

        return jsonResponse({ message: 'Project deleted successfully' });
    } catch (error) {
        console.error('Delete project error');
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
        let { name, description, date, project_id, assigned_to_id, priority = 'none' } = body;

        if (!name || !date || !project_id || !assigned_to_id) {
            return errorResponse('Missing required fields: name, date, project_id, assigned_to_id', 400);
        }

        name = sanitizeString(name, 200);
        description = sanitizeString(description || '', 4000);
        priority = String(priority || 'none').toLowerCase().trim();
        if (!validatePriority(priority)) return errorResponse('Invalid priority', 400);

        const isMember = await isProjectMember(env.DB, user.id, project_id);
        if (!isMember) {
            return errorResponse('Access denied to this project', 403);
        }

        // Assignee must be project owner or member
        const assigneeAllowed = await isProjectMember(env.DB, assigned_to_id, project_id);
        if (!assigneeAllowed) {
            return errorResponse('Assignee must be a project member', 400);
        }

        const taskId = generateId('task');
        const now = getCurrentTimestamp();

        await env.DB.prepare(
            'INSERT INTO tasks (id, name, description, date, project_id, assigned_to_id, created_by_id, status, priority, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
            taskId,
            name,
            description,
            date,
            project_id,
            assigned_to_id,
            user.id,
            'pending',
            priority,
            0,
            now,
            now
        ).run();

        await logActivity(env.DB, user.id, 'task_created', `Created task "${name}"`, taskId, project_id);
        await broadcastChange(env, 'task-created', { taskId, projectId: project_id });

        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();

        return jsonResponse(task, 201);
    } catch (error) {
        console.error('Create task error');
        return errorResponse('Failed to create task', 500);
    }
}

async function handleUpdateTask(request, env, taskId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
        if (!task) {
            return errorResponse('Task not found', 404);
        }

        const isMember = await isProjectMember(env.DB, user.id, task.project_id);
        if (!isMember) {
            return errorResponse('Access denied', 403);
        }

        const body = await request.json();
        const { name, description, date, status, priority, archived, assigned_to_id } = body;

        const updates = [];
        const values = [];

        if (name !== undefined) { updates.push('name = ?'); values.push(sanitizeString(name, 200)); }
        if (description !== undefined) { updates.push('description = ?'); values.push(sanitizeString(description || '', 4000)); }
        if (date !== undefined) {
            updates.push('date = ?');
            values.push(date);
        }
        if (status !== undefined) {
            if (!validateStatus(status)) return errorResponse('Invalid status', 400);
            updates.push('status = ?');
            values.push(status);

            // Track completion
            if (status === 'completed' && task.status !== 'completed') {
                updates.push('completed_at = ?');
                values.push(getCurrentTimestamp());
            }
        }
        if (priority !== undefined) {
            if (!validatePriority(priority)) return errorResponse('Invalid priority', 400);
            updates.push('priority = ?');
            values.push(priority);
        }
        if (archived !== undefined) {
            updates.push('archived = ?');
            values.push(archived ? 1 : 0);
        }
        if (assigned_to_id !== undefined) {
            const allowed = await isProjectMember(env.DB, assigned_to_id, task.project_id);
            if (!allowed) return errorResponse('Assignee must be a project member', 400);
            updates.push('assigned_to_id = ?');
            values.push(assigned_to_id);
        }

        if (updates.length === 0) {
            return errorResponse('No valid fields to update', 400);
        }

        updates.push('updated_at = ?');
        values.push(getCurrentTimestamp());
        values.push(taskId);

        await env.DB.prepare(
            `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();

        await logActivity(env.DB, user.id, 'task_updated', `Updated task "${name || task.name}"`, taskId, task.project_id);
        await broadcastChange(env, 'task-updated', { taskId, projectId: task.project_id });

        const updatedTask = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();

        return jsonResponse(updatedTask);
    } catch (error) {
        console.error('Update task error');
        return errorResponse('Failed to update task', 500);
    }
}

async function handleDeleteTask(request, env, taskId) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
        if (!task) {
            return errorResponse('Task not found', 404);
        }

        const isMember = await isProjectMember(env.DB, user.id, task.project_id);
        if (!isMember) {
            return errorResponse('Access denied', 403);
        }

        await logActivity(env.DB, user.id, 'task_deleted', `Deleted task "${task.name}"`, taskId, task.project_id);
        await broadcastChange(env, 'task-deleted', { taskId, projectId: task.project_id });

        await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();

        return jsonResponse({ message: 'Task deleted successfully' });
    } catch (error) {
        console.error('Delete task error');
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

// ==================== DISCORD BOT HANDLERS ====================

// Discord bot authentication - returns JWT for a user
async function handleDiscordAuth(request, env) {
    try {
        const body = await request.json();
        const { api_key, username } = body;

        // Verify Discord bot API key
        if (!api_key || api_key !== env.DISCORD_BOT_API_KEY) {
            return errorResponse('Invalid API key', 401);
        }

        if (!username) {
            return errorResponse('Username required', 400);
        }

        // Find user by username
        const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
            .bind(username.toLowerCase()).first();

        if (!user) {
            return errorResponse('User not found', 404);
        }

        // Create JWT for the user
        if (!env.SESSION_SECRET) {
            return errorResponse('Server configuration error', 500);
        }

        const token = await createJWT({
            userId: user.id,
            username: user.username,
            email: user.email
        }, env.SESSION_SECRET, '24h');

        return jsonResponse({
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                email: user.email,
                initials: user.initials
            }
        });
    } catch (error) {
        console.error('Discord auth error:', error);
        return errorResponse('Authentication failed', 500);
    }
}

// Discord bot Claude integration
async function handleDiscordClaude(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const body = await request.json();
        const { question, context } = body;

        if (!question) {
            return errorResponse('Question required', 400);
        }

        if (!env.ANTHROPIC_API_KEY) {
            return errorResponse('Claude AI is not configured', 503);
        }

        // Make request to Claude API
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
                    content: context ? `Context: ${context}\n\nQuestion: ${question}` : question
                }]
            })
        });

        if (!claudeResponse.ok) {
            console.error('Claude API error:', await claudeResponse.text());
            return errorResponse('Claude AI request failed', 502);
        }

        const result = await claudeResponse.json();
        const answer = result.content?.[0]?.text || 'No response from Claude';

        return jsonResponse({ answer });
    } catch (error) {
        console.error('Discord Claude error:', error);
        return errorResponse('Failed to process question', 500);
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

            // Discord bot routes
            if (path === '/api/discord/auth' && method === 'POST') {
                return await handleDiscordAuth(request, env);
            }
            if (path === '/api/discord/claude' && method === 'POST') {
                return await handleDiscordClaude(request, env);
            }

            // 404 for unknown API routes
            return errorResponse('Not found', 404);

        } catch (error) {
            console.error('Worker error');
            return errorResponse('Internal server error', 500);
        }
    }
};
