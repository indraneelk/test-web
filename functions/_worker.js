// Cloudflare Pages Functions Worker (scaffold)
// Minimal JWT verification and D1 sample queries

import { jwtVerify, createRemoteJWKSet } from 'jose';

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

async function getCurrentUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const claims = await verifySupabaseJWT(token, env);
  if (!claims?.sub) return null;
  const user = await env.DB.prepare('SELECT id, username, name, email, initials, is_admin FROM users WHERE id = ?')
    .bind(claims.sub).first();
  return user || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (pathname === '/api/health' && method === 'GET') {
      return json({ ok: true, ts: new Date().toISOString() });
    }

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

    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = await getCurrentUser(request, env);
      if (!user) return error('Authentication required', 401);
      return json({ user });
    }

    return error('Not found', 404);
  },
};

