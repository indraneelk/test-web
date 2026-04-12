import { getClient } from '../supabase.js';
import { getSession } from '../config.js';
import pc from 'picocolors';

export async function whoami(json = false) {
    const session = getSession();

    if (!session?.user) {
        if (json) {
            console.log(JSON.stringify({ authenticated: false }));
        } else {
            console.log(pc.yellow('Not logged in. Run: tm login'));
        }
        return;
    }

    const user = session.user;

    if (json) {
        console.log(JSON.stringify({
            authenticated: true,
            id: user.id,
            email: user.email,
            created_at: user.created_at
        }, null, 2));
        return;
    }

    console.log(pc.bold('Authenticated as:'));
    console.log(`  ${pc.blue('Email')}:    ${user.email}`);
    console.log(`  ${pc.blue('User ID')}: ${user.id}`);
    console.log(`  ${pc.blue('Since')}:   ${new Date(user.created_at).toLocaleDateString()}`);
}
