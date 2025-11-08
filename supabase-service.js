const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase Authentication Service
 * Handles magic link auth, user profiles, and session management
 */
class SupabaseService {
    constructor() {
        this.enabled = !!(
            process.env.SUPABASE_URL &&
            process.env.SUPABASE_ANON_KEY
        );

        if (this.enabled) {
            // Client for general operations (uses anon key)
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_ANON_KEY
            );

            // Admin client for server-side operations (uses service role key)
            if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
                this.adminClient = createClient(
                    process.env.SUPABASE_URL,
                    process.env.SUPABASE_SERVICE_ROLE_KEY
                );
            }

            console.log('✅ Supabase authentication enabled');
        } else {
            console.log('⚠️  Supabase not configured. Using bcrypt authentication.');
        }
    }

    /**
     * Send magic link to email
     */
    async sendMagicLink(email, redirectTo) {
        if (!this.enabled) {
            throw new Error('Supabase is not configured');
        }

        const { data, error } = await this.supabase.auth.signInWithOtp({
            email: email,
            options: {
                emailRedirectTo: redirectTo || `${process.env.ALLOWED_ORIGINS?.split(',')[0]}/auth/callback`
            }
        });

        if (error) {
            throw error;
        }

        return data;
    }

    /**
     * Sign in with OAuth provider (Google, etc.)
     */
    async signInWithOAuth(provider, redirectTo) {
        if (!this.enabled) {
            throw new Error('Supabase is not configured');
        }

        const { data, error } = await this.supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: redirectTo || `${process.env.ALLOWED_ORIGINS?.split(',')[0]}/auth/callback`
            }
        });

        if (error) {
            throw error;
        }

        return data;
    }

    /**
     * Verify and get user from access token
     */
    async getUserFromToken(accessToken) {
        if (!this.enabled) {
            throw new Error('Supabase is not configured');
        }

        const { data, error } = await this.supabase.auth.getUser(accessToken);

        if (error) {
            throw error;
        }

        return data.user;
    }

    /**
     * Exchange auth code for session (for OAuth callback)
     */
    async exchangeCodeForSession(code) {
        if (!this.enabled) {
            throw new Error('Supabase is not configured');
        }

        const { data, error } = await this.supabase.auth.exchangeCodeForSession(code);

        if (error) {
            throw error;
        }

        return data;
    }

    /**
     * Sign out user
     */
    async signOut(accessToken) {
        if (!this.enabled) {
            throw new Error('Supabase is not configured');
        }

        // Set the session first
        await this.supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: '' // Not needed for sign out
        });

        const { error } = await this.supabase.auth.signOut();

        if (error) {
            throw error;
        }
    }

    /**
     * Generate user color based on email/name
     */
    generateUserColor(email, name) {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
            '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B195', '#F67280',
            '#C06C84', '#6C5B7B', '#355C7D', '#99B898', '#FECEAB'
        ];

        // Use email or name to consistently generate same color
        const seed = (email || name || '').toLowerCase();
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }

        return colors[Math.abs(hash) % colors.length];
    }

    /**
     * Generate initials from name
     */
    generateInitials(name) {
        if (!name) return '??';

        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) {
            return parts[0].substring(0, 2).toUpperCase();
        }

        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    /**
     * Create or update user profile in our database
     * Links Supabase auth user to our internal user system
     */
    async syncUserProfile(supabaseUser, profileData = {}) {
        if (!this.enabled) {
            throw new Error('Supabase is not configured');
        }

        // Extract user data from Supabase
        const email = supabaseUser.email;
        const supabaseId = supabaseUser.id;

        // Generate defaults if not provided
        const name = profileData.name || supabaseUser.user_metadata?.name || email?.split('@')[0] || 'User';
        const initials = profileData.initials || this.generateInitials(name);
        const color = profileData.color || this.generateUserColor(email, name);

        return {
            supabase_id: supabaseId,
            email: email,
            name: name,
            initials: initials,
            color: color,
            username: profileData.username || email?.split('@')[0]?.toLowerCase() || `user_${Date.now()}`,
            is_admin: profileData.is_admin || false
        };
    }

    /**
     * Check if Supabase is enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Get Supabase client (for server-side use)
     */
    getClient() {
        return this.supabase;
    }

    /**
     * Get admin client (for privileged operations)
     */
    getAdminClient() {
        return this.adminClient;
    }
}

// Export singleton instance
const supabaseService = new SupabaseService();
module.exports = supabaseService;
