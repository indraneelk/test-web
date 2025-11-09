// Authentication Helper - Global fetch interceptor
// This automatically adds Supabase Bearer tokens to all /api/ requests
// Bypasses cookie issues with Cloudflare Pages -> Worker proxy

(function() {
    console.log('[Auth Helper] Initializing global fetch interceptor');

    // Store original fetch
    const originalFetch = window.fetch;

    // Global Supabase client reference
    window.supa = null;

    async function getSupabaseClient() {
        if (!window.supa && window.supabase) {
            try {
                const resp = await originalFetch('/api/config/public');
                const cfg = await resp.json();
                if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
                    window.supa = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
                    console.log('[Auth Helper] Supabase client initialized');
                }
            } catch (error) {
                console.error('[Auth Helper] Failed to init Supabase:', error);
            }
        }
        return window.supa;
    }

    // Override fetch globally
    window.fetch = async function(url, options = {}) {
        // Only intercept /api/ requests
        if (typeof url === 'string' && url.includes('/api/')) {
            try {
                const client = await getSupabaseClient();
                if (client) {
                    const { data: { session } } = await client.auth.getSession();

                    if (session?.access_token) {
                        console.log(`[Auth Helper] Adding Bearer token to ${url}`);
                        options.headers = {
                            ...options.headers,
                            'Authorization': `Bearer ${session.access_token}`
                        };
                    } else {
                        console.log(`[Auth Helper] No session found for ${url}`);
                    }
                }
            } catch (error) {
                console.error('[Auth Helper] Error adding auth header:', error);
            }
        }

        // Call original fetch
        return originalFetch(url, options);
    };

    console.log('[Auth Helper] Global fetch interceptor ready');
})();
