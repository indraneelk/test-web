// Cloudflare Worker for Team Task Manager
// Uses D1 Database, Supabase Auth, and JWT-based authentication

import { jwtVerify, SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';

// ==================== HELPER FUNCTIONS ====================

function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getCurrentTimestamp() {
    return new Date().toISOString();
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
    try {
        const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ['HS256']
        });

        if (payload.exp && Date.now() / 1000 > payload.exp) {
            throw new Error('Token expired');
        }
        return payload;
    } catch (error) {
        console.error('JWT verification failed:', error);
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

async function getUserBySupabaseId(db, supabaseId) {
    return await db.prepare('SELECT * FROM users WHERE supabase_id = ?').bind(supabaseId).first();
}

async function getProjectById(db, projectId) {
    return await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
}

async function isProjectMember(db, userId, projectId) {
    const project = await getProjectById(db, projectId);
    if (!project) return false;
    if (project.owner_id === userId) return true;

    // Check if members is stored as JSON string
    if (project.members) {
        try {
            const members = typeof project.members === 'string'
                ? JSON.parse(project.members)
                : project.members;
            return Array.isArray(members) && members.includes(userId);
        } catch (e) {
            return false;
        }
    }
    return false;
}

async function isProjectOwner(db, userId, projectId) {
    const project = await getProjectById(db, projectId);
    return project && project.owner_id === userId;
}

// ==================== AUTHENTICATION MIDDLEWARE ====================

async function authenticate(request, env) {
    const token = getCookie(request, 'auth_token');
    if (!token) return null;

    const payload = await verifyJWT(token, env.SESSION_SECRET);
    if (!payload || !payload.userId) return null;

    const user = await getUserById(env.DB, payload.userId);
    if (!user) return null;

    return user;
}

// ==================== API RESPONSE HELPERS ====================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie',
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

        // Find or create user
        let user = await getUserBySupabaseId(env.DB, sub);

        if (!user && email) {
            // Check by email for migration
            user = await getUserByEmail(env.DB, email);
            if (user) {
                // Update with Supabase ID
                await env.DB.prepare(
                    'UPDATE users SET supabase_id = ?, updated_at = ? WHERE id = ?'
                ).bind(sub, getCurrentTimestamp(), user.id).run();
                user.supabase_id = sub;
            }
        }

        if (!user) {
            // Create new user
            const userId = generateId('user');
            const now = getCurrentTimestamp();
            const initials = email ? email.substring(0, 2).toUpperCase() : 'U';
            const colors = ['#355C7D', '#6C5B7B', '#C06C84', '#F67280', '#F8B195'];
            const color = colors[Math.floor(Math.random() * colors.length)];

            await env.DB.prepare(
                'INSERT INTO users (id, supabase_id, email, username, name, initials, color, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(userId, sub, email, email?.split('@')[0] || 'user', email || 'User', initials, color, 0, now, now).run();

            user = await getUserById(env.DB, userId);
        }

        // Create session JWT
        const sessionToken = await createJWT({ userId: user.id }, env.SESSION_SECRET, '24h');

        const { password_hash, ...userWithoutPassword } = user;

        return jsonResponse({ user: userWithoutPassword }, 200, {
            'Set-Cookie': setCookie('auth_token', sessionToken, { maxAge: 86400 })
        });
    } catch (error) {
        console.error('Supabase login error:', error);
        return errorResponse('Login failed: ' + error.message, 500);
    }
}

async function handleSupabaseCallback(request, env) {
    try {
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

        // Find user by Supabase ID
        let user = await getUserBySupabaseId(env.DB, sub);

        if (!user && email) {
            user = await getUserByEmail(env.DB, email);
        }

        if (!user) {
            // New user - create account
            const userId = generateId('user');
            const now = getCurrentTimestamp();
            const name = user_metadata?.name || email?.split('@')[0] || 'User';
            const initials = name.substring(0, 2).toUpperCase();
            const colors = ['#355C7D', '#6C5B7B', '#C06C84', '#F67280', '#F8B195'];
            const color = colors[Math.floor(Math.random() * colors.length)];

            await env.DB.prepare(
                'INSERT INTO users (id, supabase_id, email, username, name, initials, color, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(userId, sub, email, email?.split('@')[0] || 'user', name, initials, color, 0, now, now).run();

            user = await getUserById(env.DB, userId);
            await logActivity(env.DB, userId, 'user_created', `User ${name} created via magic link`);
        } else if (!user.supabase_id) {
            // Update existing user with Supabase ID
            await env.DB.prepare(
                'UPDATE users SET supabase_id = ?, updated_at = ? WHERE id = ?'
            ).bind(sub, getCurrentTimestamp(), user.id).run();
            user.supabase_id = sub;
        }

        // Create session JWT
        const sessionToken = await createJWT({ userId: user.id }, env.SESSION_SECRET, '24h');

        const { password_hash, ...userWithoutPassword } = user;

        return jsonResponse({ user: userWithoutPassword }, 200, {
            'Set-Cookie': setCookie('auth_token', sessionToken, { maxAge: 86400 })
        });
    } catch (error) {
        console.error('Supabase callback error:', error);
        return errorResponse('Authentication failed: ' + error.message, 500);
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
    return jsonResponse(userWithoutPassword);
}

async function handleUpdateMe(request, env) {
    const user = await authenticate(request, env);
    if (!user) {
        return errorResponse('Authentication required', 401);
    }

    try {
        const body = await request.json();
        const { name, initials, color } = body;

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
        if (color) {
            updates.push('color = ?');
            values.push(color);
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

        return jsonResponse(userWithoutPassword);
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

    const { results } = await env.DB.prepare(
        'SELECT * FROM projects ORDER BY created_at DESC'
    ).all();

    // Filter projects user has access to and parse members JSON
    const userProjects = results.filter(p => {
        if (p.owner_id === user.id) return true;
        if (p.members) {
            try {
                const members = typeof p.members === 'string' ? JSON.parse(p.members) : p.members;
                return Array.isArray(members) && members.includes(user.id);
            } catch (e) {
                return false;
            }
        }
        return false;
    }).map(p => ({
        ...p,
        members: p.members ? (typeof p.members === 'string' ? JSON.parse(p.members) : p.members) : []
    }));

    return jsonResponse(userProjects);
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

    // Parse members JSON if string
    if (project.members && typeof project.members === 'string') {
        project.members = JSON.parse(project.members);
    }

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

        const projectId = generateId('project');
        const now = getCurrentTimestamp();

        await env.DB.prepare(
            'INSERT INTO projects (id, name, description, color, owner_id, members, is_personal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
            projectId,
            name.trim(),
            description?.trim() || '',
            color,
            user.id,
            JSON.stringify([]),
            is_personal ? 1 : 0,
            now,
            now
        ).run();

        await logActivity(env.DB, user.id, 'project_created', `Project "${name}" created`, null, projectId);

        const project = await getProjectById(env.DB, projectId);
        project.members = [];

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

        if (name) {
            updates.push('name = ?');
            values.push(name.trim());
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description.trim());
        }
        if (color) {
            updates.push('color = ?');
            values.push(color);
        }

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
        if (project.members && typeof project.members === 'string') {
            project.members = JSON.parse(project.members);
        }

        return jsonResponse(project);
    } catch (error) {
        console.error('Update project error:', error);
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

        // Delete associated tasks
        await env.DB.prepare('DELETE FROM tasks WHERE project_id = ?').bind(projectId).run();

        // Delete project
        await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();

        await logActivity(env.DB, user.id, 'project_deleted', `Project "${project.name}" deleted`, null, projectId);

        return jsonResponse({ message: 'Project deleted successfully' });
    } catch (error) {
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
        const body = await request.json();
        const { userId: newMemberId } = body;

        if (!newMemberId) {
            return errorResponse('User ID required', 400);
        }

        const newMember = await getUserById(env.DB, newMemberId);
        if (!newMember) {
            return errorResponse('User not found', 404);
        }

        const project = await getProjectById(env.DB, projectId);
        let members = project.members ? (typeof project.members === 'string' ? JSON.parse(project.members) : project.members) : [];

        if (members.includes(newMemberId)) {
            return errorResponse('User is already a member', 400);
        }

        members.push(newMemberId);

        await env.DB.prepare(
            'UPDATE projects SET members = ?, updated_at = ? WHERE id = ?'
        ).bind(JSON.stringify(members), getCurrentTimestamp(), projectId).run();

        await logActivity(env.DB, user.id, 'project_member_added', `Added ${newMember.name} to project`, null, projectId);

        return jsonResponse({ message: 'Member added successfully', members });
    } catch (error) {
        console.error('Add member error:', error);
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
        let members = project.members ? (typeof project.members === 'string' ? JSON.parse(project.members) : project.members) : [];

        members = members.filter(id => id !== memberId);

        await env.DB.prepare(
            'UPDATE projects SET members = ?, updated_at = ? WHERE id = ?'
        ).bind(JSON.stringify(members), getCurrentTimestamp(), projectId).run();

        const removedUser = await getUserById(env.DB, memberId);
        await logActivity(env.DB, user.id, 'project_member_removed', `Removed ${removedUser?.name || memberId} from project`, null, projectId);

        return jsonResponse({ message: 'Member removed successfully', members });
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
    const { results: allTasks } = await env.DB.prepare(
        'SELECT * FROM tasks ORDER BY date ASC'
    ).all();

    // Filter tasks based on project access
    const accessibleTasks = [];
    for (const task of allTasks) {
        const isMember = await isProjectMember(env.DB, user.id, task.project_id);
        if (isMember) {
            accessibleTasks.push(task);
        }
    }

    // Auto-archive completed tasks > 7 days
    const now = new Date();
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

    for (const task of accessibleTasks) {
        if (task.status === 'completed' && task.completed_at && !task.archived) {
            const completedDate = new Date(task.completed_at);
            const daysSinceCompletion = now - completedDate;

            if (daysSinceCompletion >= sevenDaysInMs) {
                await env.DB.prepare(
                    'UPDATE tasks SET archived = 1, updated_at = ? WHERE id = ?'
                ).bind(getCurrentTimestamp(), task.id).run();
                task.archived = 1;
            }
        }
    }

    return jsonResponse(accessibleTasks);
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
        const { name, description, date, project_id, assigned_to_id, priority = 'none' } = body;

        if (!name || !date || !project_id || !assigned_to_id) {
            return errorResponse('Missing required fields: name, date, project_id, assigned_to_id', 400);
        }

        const isMember = await isProjectMember(env.DB, user.id, project_id);
        if (!isMember) {
            return errorResponse('Access denied to this project', 403);
        }

        const taskId = generateId('task');
        const now = getCurrentTimestamp();

        await env.DB.prepare(
            'INSERT INTO tasks (id, name, description, date, project_id, assigned_to_id, created_by_id, status, priority, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
            taskId,
            name.trim(),
            description?.trim() || '',
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

        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();

        return jsonResponse(task, 201);
    } catch (error) {
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

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name.trim());
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description.trim());
        }
        if (date !== undefined) {
            updates.push('date = ?');
            values.push(date);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);

            // Track completion
            if (status === 'completed' && task.status !== 'completed') {
                updates.push('completed_at = ?');
                values.push(getCurrentTimestamp());
            }
        }
        if (priority !== undefined) {
            updates.push('priority = ?');
            values.push(priority);
        }
        if (archived !== undefined) {
            updates.push('archived = ?');
            values.push(archived ? 1 : 0);
        }
        if (assigned_to_id !== undefined) {
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

        const updatedTask = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();

        return jsonResponse(updatedTask);
    } catch (error) {
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
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
        if (!task) {
            return errorResponse('Task not found', 404);
        }

        const isMember = await isProjectMember(env.DB, user.id, task.project_id);
        if (!isMember) {
            return errorResponse('Access denied', 403);
        }

        await logActivity(env.DB, user.id, 'task_deleted', `Deleted task "${task.name}"`, taskId, task.project_id);

        await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();

        return jsonResponse({ message: 'Task deleted successfully' });
    } catch (error) {
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

            // 404 for unknown API routes
            return errorResponse('Not found', 404);

        } catch (error) {
            console.error('Worker error:', error);
            return errorResponse('Internal server error: ' + error.message, 500);
        }
    }
};
