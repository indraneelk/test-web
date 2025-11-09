// Authentication Helper - Global fetch interceptor
// This automatically adds Supabase Bearer tokens to all /api/ requests
// Bypasses cookie issues with Cloudflare Pages -> Worker proxy

(function() {
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
                }
            } catch (error) {
                console.error('[Auth Helper] Failed to init Supabase:', error);
            }
        }
        return window.supa;
    }

    // Override fetch globally
    window.fetch = async function(url, options = {}) {
        // Skip intercepting config/public to avoid circular dependency
        if (typeof url === 'string' && url.includes('/api/config/public')) {
            return originalFetch(url, options);
        }

        // Only intercept other /api/ requests
        if (typeof url === 'string' && url.includes('/api/')) {
            try {
                const client = await getSupabaseClient();
                if (client) {
                    const { data: { session } } = await client.auth.getSession();

                    if (session?.access_token) {
                        // Properly merge headers - preserve existing headers like Content-Type
                        if (!options.headers) {
                            options.headers = {};
                        }

                        // Handle both Headers objects and plain objects
                        if (options.headers instanceof Headers) {
                            // Headers object - just add to it
                            options.headers.set('Authorization', `Bearer ${session.access_token}`);
                        } else {
                            // Plain object - simple assignment
                            options.headers = {
                                ...options.headers,
                                'Authorization': `Bearer ${session.access_token}`
                            };
                        }
                    }
                }
            } catch (error) {
                console.error('[Auth Helper] Error adding auth header:', error);
            }
        }

        // Call original fetch
        return originalFetch(url, options);
    };
})();
