import { getClient } from '../supabase.js';
import { getSession } from '../config.js';
import pc from 'picocolors';

export async function listProjects({ json = false }) {
    const supabase = getClient();
    const session = getSession();
    if (!session?.user) {
        console.error(pc.red('Not logged in. Run: tm login'));
        process.exit(1);
    }

    const { data, error } = await supabase
        .from('projects')
        .select('*, project_members(count)')
        .or(`owner_id.eq.${session.user.id},project_members.user_id.eq.${session.user.id}`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(pc.red(`Failed to load projects: ${error.message}`));
        process.exit(1);
    }

    if (!data || data.length === 0) {
        if (json) {
            console.log(JSON.stringify({ projects: [] }));
        } else {
            console.log(pc.gray('No projects found.'));
        }
        return;
    }

    if (json) {
        console.log(JSON.stringify({ projects: data }, null, 2));
        return;
    }

    console.log(pc.bold(`\n  ${data.length} project${data.length === 1 ? '' : 's'}\n`));

    for (const proj of data) {
        const color = proj.color || '#f06a6a';
        const badge = pc.bgHex(color)(pc.black(` ${proj.name} `));
        const memberCount = proj.project_members?.[0]?.count ?? 0;

        console.log(`  ${badge}  ${pc.gray(`${memberCount} member${memberCount === 1 ? '' : 's'}`)}`);
        if (proj.description) {
            const desc = proj.description.length > 60
                ? proj.description.substring(0, 57) + '...'
                : proj.description;
            console.log(`       ${pc.italic(pc.gray(desc))}`);
        }
        if (proj.is_personal) {
            console.log(`       ${pc.cyan('Personal')}`);
        }
        console.log();
    }
}

export async function createProject({ name, description, color, json = false }) {
    const supabase = getClient();
    const session = getSession();
    if (!session?.user) {
        console.error(pc.red('Not logged in. Run: tm login'));
        process.exit(1);
    }

    if (!name) {
        console.error(pc.red('Project name is required. Use: tm projects create -n "My Project"'));
        process.exit(1);
    }

    const { data, error } = await supabase
        .from('projects')
        .insert({
            name,
            description: description || null,
            color: color || '#f06a6a',
            owner_id: session.user.id,
            is_personal: false
        })
        .select()
        .single();

    if (error) {
        console.error(pc.red(`Failed to create project: ${error.message}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ project: data }, null, 2));
    } else {
        console.log(pc.green(`✓ Project created: "${data.name}"`));
        console.log(pc.gray(`  ID: ${data.id}`));
    }
}

export async function deleteProject(id, json = false) {
    const supabase = getClient();
    const session = getSession();
    if (!session?.user) {
        console.error(pc.red('Not logged in. Run: tm login'));
        process.exit(1);
    }

    const { data: proj, error: fetchErr } = await supabase
        .from('projects')
        .select('owner_id')
        .eq('id', id)
        .single();

    if (fetchErr || !proj) {
        console.error(pc.red('Project not found.'));
        process.exit(1);
    }

    if (proj.owner_id !== session.user.id) {
        console.error(pc.red('Only the project owner can delete it.'));
        process.exit(1);
    }

    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

    if (error) {
        console.error(pc.red(`Failed to delete project: ${error.message}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ deleted: id }));
    } else {
        console.log(pc.green(`✓ Project deleted`));
    }
}

export async function getProject(id, json = false) {
    const supabase = getClient();

    const { data, error } = await supabase
        .from('projects')
        .select('*, project_members(user_id, role, profiles(username, name, color))')
        .eq('id', id)
        .single();

    if (error) {
        console.error(pc.red(`Project not found: ${id}`));
        process.exit(1);
    }

    if (json) {
        console.log(JSON.stringify({ project: data }, null, 2));
        return;
    }

    const color = data.color || '#f06a6a';
    console.log(pc.bold(`\n  ${pc.bgHex(color)(pc.black(` ${data.name} `))}\n`));
    console.log(`  ${pc.gray('ID')}:          ${data.id}`);
    console.log(`  ${pc.gray('Description')}: ${data.description || pc.gray('none')}`);
    console.log(`  ${pc.gray('Owner ID')}:    ${data.owner_id}`);
    if (data.is_personal) {
        console.log(`  ${pc.cyan('Personal project')}`);
    }
    const members = data.project_members || [];
    if (members.length > 0) {
        console.log(`\n  ${pc.gray('Members:')}`);
        for (const m of members) {
            console.log(`    • ${m.profiles?.username || m.profiles?.name || m.user_id} (${m.role})`);
        }
    }
    console.log();
}
