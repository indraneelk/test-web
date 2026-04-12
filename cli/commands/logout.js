import { getClient } from '../supabase.js';
import { clearSession } from '../config.js';
import { resetClient } from '../supabase.js';
import pc from 'picocolors';

export async function logout() {
    const supabase = getClient();
    await supabase.auth.signOut();
    clearSession();
    resetClient();
    console.log(pc.green('Logged out successfully.'));
}
