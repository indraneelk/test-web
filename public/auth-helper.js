// Authentication Helper — Supabase direct (no Express)

(function() {
    const SUPABASE_URL = 'https://tfltkqgxxceykzbjuziv.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmbHRrcWd4eGNleWt6Ymp1eml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NTc0MDksImV4cCI6MjA5MTUzMzQwOX0.zJ6ChtJTURUp259v38CE4m8_auTY_Iou-AccpFybxVM';

    let _client = null;

    function getSupabaseClient() {
        if (!_client) {
            if (!window.supabase) {
                console.error('[Auth Helper] window.supabase not loaded yet');
                return null;
            }
            _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
        return _client;
    }

    async function getAuthToken() {
        try {
            const client = getSupabaseClient();
            if (!client) return null;
            const { data } = await client.auth.getSession();
            return data?.session?.access_token || null;
        } catch (err) {
            console.error('[Auth Helper] getAuthToken error:', err);
            return null;
        }
    }

    // Expose on window — no apiFetch needed, use getSupabaseClient() directly
    window.getSupabaseClient = getSupabaseClient;
    window.getAuthToken = getAuthToken;

    // Convenience alias: window.supa → getSupabaseClient()
    Object.defineProperty(window, 'supa', {
        get: function() { return getSupabaseClient(); },
        configurable: true
    });
})();
