import { getClient } from '../supabase.js';
import { setSession } from '../config.js';
import pc from 'picocolors';

export async function login(email, password) {
    const supabase = getClient();

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        console.error(pc.red(`Login failed: ${error.message}`));
        process.exit(1);
    }

    setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: data.user
    });

    console.log(pc.green(`Logged in as ${data.user.email}`));
}
