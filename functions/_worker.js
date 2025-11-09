// Cloudflare Pages Functions Worker
// Complete API implementation for Discord bot and web app

import { jwtVerify, createRemoteJWKSet, SignJWT } from 'jose';
import bcrypt from 'bcryptjs';
import Anthropic from '@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...headers },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

// Verify Supabase JWT
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
        return null;
      }
    }
    return null;
  }
}

// Verify local JWT (from username/password login)
async function verifyLocalJWT(token, env) {
  try {
    const secret = new TextEncoder().encode(env.SESSION_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('Token expired');
    return payload;
  } catch (err) {
    return null;
  }
}

// Get current user from request
async function getCurrentUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);

  // Try local JWT first
  let claims = await verifyLocalJWT(token, env);
  if (claims?.sub) {
    const user = await env.DB.prepare('SELECT id, username, name, email, initials, is_admin FROM users WHERE id = ?')
      .bind(claims.sub).first();
    return user || null;
  }

  // Try Supabase JWT
  claims = await verifySupabaseJWT(token, env);
  if (claims?.sub) {
    const user = await env.DB.prepare('SELECT id, username, name, email, initials, is_admin FROM users WHERE id = ?')
      .bind(claims.sub).first();
    return user || null;
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // Health check
    if (pathname === '/api/health' && method === 'GET') {
      return json({ ok: true, ts: new Date().toISOString() });
    }

    // Database check
    if (pathname === '/api/db-check' && method === 'GET') {
      try {
        const users = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first();
        const projects = await env.DB.prepare('SELECT COUNT(*) as c FROM projects').first();
        const tasks = await env.DB.prepare('SELECT COUNT(*) as c FROM tasks').first();
        return json({ users: users?.c || 0, projects: projects?.c || 0, tasks: tasks?.c || 0 });
      } catch (e) {
        return error('D1 query failed: ' + e.message, 500);
      }
    }

    // ==================== AUTH ENDPOINTS ====================

    // JWT-based username/password login
    if (pathname === '/api/auth/login' && method === 'POST') {
      try {
        const body = await request.json();
        const { username, password } = body;

        if (!username || !password) {
          return error('Username and password are required', 400);
        }

        // Find user by username
        const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
          .bind(username).first();

        if (!user) {
          return error('Invalid credentials', 401);
        }

        // Verify password (only works for bcrypt-based users)
        if (!user.password_hash) {
          return error('This account uses Supabase authentication', 401);
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
          return error('Invalid credentials', 401);
        }

        // Generate JWT token
        const secret = new TextEncoder().encode(env.SESSION_SECRET);
        const token = await new SignJWT({
          sub: user.id,
          username: user.username,
          email: user.email,
          is_admin: user.is_admin ? 1 : 0
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('24h')
          .setIssuedAt()
          .sign(secret);

        // Return token and user data (without password_hash)
        const { password_hash, ...userWithoutPassword } = user;
        return json({
          success: true,
          token,
          user: userWithoutPassword
        });
      } catch (e) {
        console.error('Login error:', e);
        return error('Login failed: ' + e.message, 500);
      }
    }

    // Get current user
    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = await getCurrentUser(request, env);
      if (!user) return error('Authentication required', 401);
      return json({ user });
    }

    // ==================== TASK ENDPOINTS ====================

    // Get user's tasks
    if (pathname === '/api/tasks' && method === 'GET') {
      const user = await getCurrentUser(request, env);
      if (!user) return error('Authentication required', 401);

      try {
        // Get all tasks assigned to the user or in projects they're a member of
        const tasks = await env.DB.prepare(`
          SELECT DISTINCT t.*
          FROM tasks t
          LEFT JOIN project_members pm ON t.project_id = pm.project_id
          WHERE t.assignee_id = ? OR pm.user_id = ?
          ORDER BY t.created_at DESC
        `).bind(user.id, user.id).all();

        return json(tasks.results || []);
      } catch (e) {
        console.error('Tasks error:', e);
        return error('Failed to fetch tasks: ' + e.message, 500);
      }
    }

    // ==================== CLAUDE AI ENDPOINTS ====================

    // Get task summary from Claude
    if (pathname === '/api/claude/summary' && method === 'GET') {
      const user = await getCurrentUser(request, env);
      if (!user) return error('Authentication required', 401);

      if (!env.ANTHROPIC_API_KEY) {
        return error('Claude AI is not configured', 501);
      }

      try {
        // Get user's tasks
        const tasks = await env.DB.prepare(`
          SELECT DISTINCT t.*
          FROM tasks t
          LEFT JOIN project_members pm ON t.project_id = pm.project_id
          WHERE t.assignee_id = ? OR pm.user_id = ?
        `).bind(user.id, user.id).all();

        const taskList = tasks.results || [];

        if (taskList.length === 0) {
          return json({
            summary: 'You have no tasks yet. Add some tasks to get started!',
            taskCount: 0
          });
        }

        // Call Claude API
        const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `Analyze these tasks and provide a brief summary (2-3 sentences):
${JSON.stringify(taskList, null, 2)}`
          }]
        });

        const summary = message.content[0].text;

        return json({
          summary,
          taskCount: taskList.length
        });
      } catch (e) {
        console.error('Claude summary error:', e);
        return error('Failed to generate summary: ' + e.message, 500);
      }
    }

    // Get priority recommendations from Claude
    if (pathname === '/api/claude/priorities' && method === 'GET') {
      const user = await getCurrentUser(request, env);
      if (!user) return error('Authentication required', 401);

      if (!env.ANTHROPIC_API_KEY) {
        return error('Claude AI is not configured', 501);
      }

      try {
        // Get user's tasks
        const tasks = await env.DB.prepare(`
          SELECT DISTINCT t.*
          FROM tasks t
          LEFT JOIN project_members pm ON t.project_id = pm.project_id
          WHERE t.assignee_id = ? OR pm.user_id = ?
        `).bind(user.id, user.id).all();

        const taskList = tasks.results || [];

        if (taskList.length === 0) {
          return json({
            priorities: 'No tasks to prioritize yet!'
          });
        }

        // Call Claude API
        const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `Analyze these tasks and recommend which ones to prioritize. Focus on urgency and importance:
${JSON.stringify(taskList, null, 2)}`
          }]
        });

        const priorities = message.content[0].text;

        return json({ priorities });
      } catch (e) {
        console.error('Claude priorities error:', e);
        return error('Failed to generate priorities: ' + e.message, 500);
      }
    }

    // Ask Claude a question about tasks
    if (pathname === '/api/claude/ask' && method === 'POST') {
      const user = await getCurrentUser(request, env);
      if (!user) return error('Authentication required', 401);

      if (!env.ANTHROPIC_API_KEY) {
        return error('Claude AI is not configured', 501);
      }

      try {
        const body = await request.json();
        const { question } = body;

        if (!question) {
          return error('Question is required', 400);
        }

        // Get user's tasks
        const tasks = await env.DB.prepare(`
          SELECT DISTINCT t.*
          FROM tasks t
          LEFT JOIN project_members pm ON t.project_id = pm.project_id
          WHERE t.assignee_id = ? OR pm.user_id = ?
        `).bind(user.id, user.id).all();

        const taskList = tasks.results || [];

        // Call Claude API
        const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `You are a helpful task management assistant. Here are the user's tasks:
${JSON.stringify(taskList, null, 2)}

User's question: ${question}

Please answer their question based on the tasks above.`
          }]
        });

        const answer = message.content[0].text;

        return json({ answer });
      } catch (e) {
        console.error('Claude ask error:', e);
        return error('Failed to get answer: ' + e.message, 500);
      }
    }

    return error('Not found', 404);
  },
};
