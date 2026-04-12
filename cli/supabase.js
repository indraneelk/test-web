import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnv, getSession } from './config.js';

let _client = null;

export function getClient() {
    if (_client) return _client;

    const { url, anonKey } = getSupabaseEnv();

    if (!url || !anonKey) {
        throw new Error(
            'Supabase not configured. Run: tm config set-url <url> <anon-key>\n' +
            'Or set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
        );
    }

    const session = getSession();
    _client = createClient(url, anonKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    if (session?.access_token) {
        _client.auth.setSession(session);
    }

    return _client;
}

export function resetClient() {
    _client = null;
}
